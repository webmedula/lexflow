import { describe, expect, it } from 'vitest';
import { ServicoLeitor } from '../../src/application/services/ServicoLeitor.js';
import {
  MniBloqueadoError,
  ProviderIndisponivelError,
  SemHabilitacaoNosAutosError,
} from '../../src/domain/errors/index.js';
import type { CredencialTribunal } from '../../src/domain/ports/ProvedorDePecas.js';
import { MniAdapter } from '../../src/infrastructure/adapters/mni/MniAdapter.js';
import { ArmazemEmDisco } from '../../src/infrastructure/arquivos/ArmazemEmDisco.js';
import { HttpClient } from '../../src/infrastructure/http/HttpClient.js';
import type { RespostaHttpBinaria } from '../../src/infrastructure/http/HttpClient.js';
import { loggerSilencioso } from '../../src/infrastructure/logging/ConsoleLogger.js';
import { QpdfMontador } from '../../src/infrastructure/pdf/QpdfMontador.js';
import { abrirBanco } from '../../src/infrastructure/persistencia/sqlite/banco.js';
import { FilaDeJobsSqlite } from '../../src/infrastructure/persistencia/sqlite/FilaDeJobsSqlite.js';
import { RepositorioCredenciaisSqlite } from '../../src/infrastructure/persistencia/sqlite/RepositorioCredenciaisSqlite.js';
import type { RateLimiter } from '../../src/infrastructure/ratelimit/TokenBucketRateLimiter.js';
import { Cofre } from '../../src/infrastructure/seguranca/cofre.js';
import { CONFIG_LEITOR_DE_TESTE } from '../helpers/aplicacao.js';
import {
  ClockFalso,
  PROCESSO_TJGO,
  PROCESSO_TJGO_DIGITOS,
  pastaTemporaria,
  pdfSintetico,
} from '../helpers/leitor.js';
import { idsPedidos, respostaMniSintetica } from '../helpers/mniSintetico.js';

const CREDENCIAL: CredencialTribunal = {
  tribunal: 'TJGO',
  identificacao: '00000000000',
  senha: 'senha-de-teste',
};

class HttpFalso extends HttpClient {
  readonly enviados: string[] = [];
  constructor(private readonly responder: (xml: string) => RespostaHttpBinaria) {
    super();
  }
  override async postXml(_url: string, xml: string): Promise<RespostaHttpBinaria> {
    this.enviados.push(xml);
    return this.responder(xml);
  }
}

const RESPOSTA_403: RespostaHttpBinaria = {
  status: 403,
  ok: false,
  contentType: 'text/html',
  bytes: new Uint8Array(),
};

/** Conta as fichas pedidas. É o MESMO balde para tudo que passa pelo adapter. */
class BaldeEspiao implements RateLimiter {
  fichas = 0;
  async adquirir(): Promise<void> {
    this.fichas += 1;
  }
  tentarAdquirir(): boolean {
    this.fichas += 1;
    return true;
  }
}

describe('MniAdapter — várias peças numa consulta', () => {
  it('pede todas as peças num envelope só, com movimentos=true', async () => {
    const http = new HttpFalso(() => respostaMniSintetica({ documentos: [] }));
    const adapter = new MniAdapter({ httpClient: http });
    await adapter.obterConteudosEmLote(
      PROCESSO_TJGO_DIGITOS,
      ['d1', 'd2', 'd3'],
      CREDENCIAL,
    );

    expect(http.enviados).toHaveLength(1);
    expect(idsPedidos(http.enviados[0] ?? '')).toEqual(['d1', 'd2', 'd3']);
    expect(http.enviados[0]).toContain('<tip:movimentos>true</tip:movimentos>');
  });

  it('nunca manda lista vazia — no MNI isso significa "todas as peças"', async () => {
    const http = new HttpFalso(() => respostaMniSintetica({ documentos: [] }));
    const adapter = new MniAdapter({ httpClient: http });
    const r = await adapter.obterConteudosEmLote(PROCESSO_TJGO_DIGITOS, [], CREDENCIAL);
    expect(http.enviados).toHaveLength(0);
    expect(r.conteudos).toHaveLength(0);
  });

  it('separa o que veio, o que veio sem arquivo e o que nem veio', async () => {
    const pdf = await pdfSintetico(1, 'X');
    const http = new HttpFalso(() =>
      respostaMniSintetica({
        documentos: [
          { id: 'ok', bytes: pdf },
          { id: 'sem-teor' },
          { id: 'vazio', bytes: new Uint8Array() },
          // Anexo de um documento: vem aninhado, e conta como entregue.
          { id: 'pai', bytes: pdf, vinculados: [{ id: 'anexo', bytes: pdf }] },
        ],
      }),
    );
    const adapter = new MniAdapter({ httpClient: http });
    const r = await adapter.obterConteudosEmLote(
      PROCESSO_TJGO_DIGITOS,
      ['ok', 'sem-teor', 'vazio', 'anexo', 'sumida'],
      CREDENCIAL,
    );

    expect(r.conteudos.map((c) => [c.id, c.bytes.length])).toEqual([
      ['ok', pdf.length],
      ['vazio', 0],
      ['anexo', pdf.length],
    ]);
    expect(Buffer.from(r.conteudos[0]?.bytes ?? []).equals(Buffer.from(pdf))).toBe(true);
    expect(r.semTeor).toEqual(['sem-teor']);
    expect(r.ausentes).toEqual(['sumida']);
    expect(r.bytesResposta).toBeGreaterThan(pdf.length);
  });

  it('sucesso sem movimento nem documento é negativa de acesso, não lote vazio', async () => {
    const http = new HttpFalso(() =>
      respostaMniSintetica({ documentos: [], movimentos: 0 }),
    );
    const adapter = new MniAdapter({ httpClient: http });
    await expect(
      adapter.obterConteudosEmLote(PROCESSO_TJGO_DIGITOS, ['d1'], CREDENCIAL),
    ).rejects.toBeInstanceOf(SemHabilitacaoNosAutosError);
  });

  it('lê o nível de sigilo do processo na listagem', async () => {
    const http = new HttpFalso(() =>
      respostaMniSintetica({ documentos: [{ id: 'a' }], nivelSigiloDoProcesso: 5 }),
    );
    const adapter = new MniAdapter({ httpClient: http });
    const atos = await adapter.listarAtos(PROCESSO_TJGO_DIGITOS, CREDENCIAL);
    expect(atos.nivelSigiloDoProcesso).toBe(5);
  });
});

describe('MniAdapter — disjuntor de 403', () => {
  it('um 403 pausa TODAS as consultas MNI, sem nenhuma requisição durante a pausa', async () => {
    const clock = new ClockFalso();
    const http = new HttpFalso(() => RESPOSTA_403);
    const adapter = new MniAdapter({
      httpClient: http,
      clock,
      pausaApos403Ms: 30 * 60_000,
    });

    const erro = await adapter
      .obterConteudosEmLote(PROCESSO_TJGO_DIGITOS, ['d1'], CREDENCIAL)
      .catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(MniBloqueadoError);
    // Continua sendo indisponibilidade: quem já tratava 503 continua tratando.
    expect(erro).toBeInstanceOf(ProviderIndisponivelError);
    expect((erro as MniBloqueadoError).retomarEm.getTime()).toBe(clock.ms + 30 * 60_000);

    // Peça avulsa, listagem e lote: nenhum sai enquanto o disjuntor está aberto.
    await expect(
      adapter.listarPecas(PROCESSO_TJGO_DIGITOS, CREDENCIAL),
    ).rejects.toBeInstanceOf(MniBloqueadoError);
    await expect(
      adapter.obterConteudo(PROCESSO_TJGO_DIGITOS, 'd1', CREDENCIAL),
    ).rejects.toBeInstanceOf(MniBloqueadoError);
    expect(http.enviados).toHaveLength(1);
  });

  it('fecha sozinho depois da pausa', async () => {
    const clock = new ClockFalso();
    let responder403 = true;
    const http = new HttpFalso(() =>
      responder403 ? RESPOSTA_403 : respostaMniSintetica({ documentos: [{ id: 'a' }] }),
    );
    const adapter = new MniAdapter({ httpClient: http, clock, pausaApos403Ms: 60_000 });
    await adapter.listarPecas(PROCESSO_TJGO_DIGITOS, CREDENCIAL).catch(() => undefined);
    responder403 = false;

    clock.avancar(59_999);
    await expect(
      adapter.listarPecas(PROCESSO_TJGO_DIGITOS, CREDENCIAL),
    ).rejects.toBeInstanceOf(MniBloqueadoError);
    clock.avancar(1);
    await expect(
      adapter.listarPecas(PROCESSO_TJGO_DIGITOS, CREDENCIAL),
    ).resolves.toHaveLength(1);
    expect(http.enviados).toHaveLength(2);
  });

  it('enquanto o disjuntor está aberto, nem ficha do balde se gasta', async () => {
    const clock = new ClockFalso();
    const balde = new BaldeEspiao();
    const adapter = new MniAdapter({
      httpClient: new HttpFalso(() => RESPOSTA_403),
      rateLimiter: balde,
      clock,
    });
    await adapter.listarPecas(PROCESSO_TJGO_DIGITOS, CREDENCIAL).catch(() => undefined);
    await adapter.listarPecas(PROCESSO_TJGO_DIGITOS, CREDENCIAL).catch(() => undefined);
    expect(balde.fichas).toBe(1);
  });
});

describe('Leitor sobre o MniAdapter de verdade', () => {
  async function montar(responder: (xml: string) => RespostaHttpBinaria): Promise<{
    leitor: ServicoLeitor;
    http: HttpFalso;
    balde: BaldeEspiao;
    adapter: MniAdapter;
    apagar: () => void;
  }> {
    const pasta = pastaTemporaria();
    const db = abrirBanco(':memory:');
    const credenciais = new RepositorioCredenciaisSqlite(
      db,
      Cofre.comChaveBase64(Cofre.gerarChaveBase64()),
    );
    await credenciais.salvar('ws', CREDENCIAL);
    const http = new HttpFalso(responder);
    const balde = new BaldeEspiao();
    const clock = new ClockFalso();
    const adapter = new MniAdapter({ httpClient: http, rateLimiter: balde, clock });
    let seq = 0;
    const leitor = new ServicoLeitor({
      provedor: adapter,
      credenciais,
      fila: new FilaDeJobsSqlite(db),
      armazem: new ArmazemEmDisco(pasta.caminho),
      montador: new QpdfMontador(),
      logger: loggerSilencioso,
      clock,
      esperar: async (ms) => clock.avancar(ms),
      gerarId: () => (++seq).toString(16).padStart(32, 'b'),
      identificarCredencial: () => 'cred',
      config: { ...CONFIG_LEITOR_DE_TESTE, inicial: 2, maximo: 2 },
    });
    return { leitor, http, balde, adapter, apagar: pasta.apagar };
  }

  it('usa o MESMO balde do adapter: uma ficha por requisição, nenhuma a mais nem a menos', async () => {
    const pdf = await pdfSintetico(1, 'X');
    const docs = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, bytes: pdf }));
    const { leitor, http, balde, apagar } = await montar((xml) => {
      const ids = idsPedidos(xml);
      return respostaMniSintetica({
        documentos:
          ids.length > 0
            ? docs.filter((d) => ids.includes(d.id))
            : docs.map(({ id }) => ({ id })),
      });
    });
    try {
      const job = await leitor.criar('ws', PROCESSO_TJGO, ['a', 'b', 'c', 'd', 'e']);
      await leitor.processarFila();
      const final = await leitor.consultar('ws', PROCESSO_TJGO, job.id);

      expect(final.estado).toBe('pronto');
      // listagem + consultarAlteracao + 3 lotes de 2
      expect(http.enviados).toHaveLength(5);
      // Se o leitor tivesse balde próprio, ou contornasse o do adapter, os
      // números divergiriam.
      expect(balde.fichas).toBe(http.enviados.length);
    } finally {
      apagar();
    }
  });

  it('um 403 no meio do job pausa o leitor E a peça avulsa, sem nova requisição', async () => {
    const pdf = await pdfSintetico(1, 'X');
    let lotes = 0;
    const { leitor, http, adapter, apagar } = await montar((xml) => {
      const ids = idsPedidos(xml);
      if (ids.length === 0)
        return respostaMniSintetica({
          documentos: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
        });
      lotes += 1;
      if (lotes === 2) return RESPOSTA_403;
      return respostaMniSintetica({ documentos: ids.map((id) => ({ id, bytes: pdf })) });
    });
    try {
      const job = await leitor.criar('ws', PROCESSO_TJGO, ['a', 'b', 'c']);
      await leitor.processarFila();
      const pausado = await leitor.consultar('ws', PROCESSO_TJGO, job.id);
      expect(pausado.estado).toBe('pausado_por_bloqueio');
      expect(pausado.retomarEm).toBeDefined();

      const antes = http.enviados.length;
      await expect(
        adapter.obterConteudo(PROCESSO_TJGO_DIGITOS, 'a', CREDENCIAL),
      ).rejects.toBeInstanceOf(MniBloqueadoError);
      await leitor.processarFila();
      expect(http.enviados).toHaveLength(antes);
    } finally {
      apagar();
    }
  });
});

describe('Memória com resposta de lote grande (sintética)', () => {
  it('os arquivos do lote são VISTAS da resposta, não cópias', async () => {
    // 20 peças de 1,2 MB: uma resposta de ~24 MB, o dobro do limite padrão do
    // lote. A medição completa (pico de RSS por tamanho de resposta) está em
    // docs/leitor-medicoes-v0.30.0.md; aqui fica a propriedade que a sustenta.
    const docs = Array.from({ length: 20 }, (_, i) => ({
      id: `d${i}`,
      bytes: new Uint8Array(1_200_000).fill(i),
    }));
    const resposta = respostaMniSintetica({
      documentos: docs,
      movimentos: 385,
      pedagioBytes: 180_000,
    });
    const adapter = new MniAdapter({ httpClient: new HttpFalso(() => resposta) });

    const antes = process.memoryUsage().arrayBuffers;
    const r = await adapter.obterConteudosEmLote(
      PROCESSO_TJGO_DIGITOS,
      docs.map((d) => d.id),
      CREDENCIAL,
    );
    const depois = process.memoryUsage().arrayBuffers;

    expect(r.conteudos).toHaveLength(20);
    for (const c of r.conteudos) expect(c.bytes.buffer).toBe(resposta.bytes.buffer);
    expect(r.conteudos[7]?.bytes[0]).toBe(7);
    // Sem cópia por anexo, a memória externa não cresce na ordem da resposta.
    expect(depois - antes).toBeLessThan(resposta.bytes.length / 4);
  });
});
