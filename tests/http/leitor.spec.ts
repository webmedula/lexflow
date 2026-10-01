import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MniBloqueadoError } from '../../src/domain/errors/index.js';
import { carregarConfig } from '../../src/infrastructure/config/env.js';
import type { Aplicacao } from '../../src/main/factories/makeProcessoSearchService.js';
import { interpretarRange } from '../../src/main/http/rotas/leitor.js';
import { construirServidor } from '../../src/main/http/servidor.js';
import { aplicacaoDeTeste } from '../helpers/aplicacao.js';
import { ProviderFalso } from '../helpers/fabricas.js';
import {
  HTML_SINTETICO,
  MARCADOR_ATRIBUTO,
  MARCADOR_SCRIPT,
  OUTRO_PROCESSO,
  PROCESSO_TJGO,
  ProvedorDeLoteFalso,
  pastaTemporaria,
  pdfSintetico,
} from '../helpers/leitor.js';

const CHAVE_A = 'chave-da-advogada-a-1234567890';
const CHAVE_B = 'chave-do-advogado-b-1234567890';
const A = { 'x-api-key': CHAVE_A };
const B = { 'x-api-key': CHAVE_B };
const URL = `/v1/processos/${PROCESSO_TJGO}/leitor`;

let pasta: ReturnType<typeof pastaTemporaria>;
let servidor: FastifyInstance;
let app: Aplicacao;
let provedor: ProvedorDeLoteFalso;

beforeEach(async () => {
  pasta = pastaTemporaria();
  provedor = new ProvedorDeLoteFalso([
    { id: 'a', bytes: await pdfSintetico(2, 'A'), movimento: 1 },
    { id: 'b', bytes: await pdfSintetico(1, 'B'), movimento: 2 },
    { id: 'c' },
  ]);
  app = aplicacaoDeTeste([new ProviderFalso({ nome: 'falso' })], {
    provedorDePecas: provedor,
    leitor: { pasta: pasta.caminho },
  });
  servidor = construirServidor(
    app,
    carregarConfig({
      PROCESSOVIVO_PROVIDER_CHAIN: 'mock-crawler-tjsp',
      LOG_LEVEL: 'silent',
      CACHE_ENABLED: 'false',
      PROCESSOVIVO_API_KEYS: `${CHAVE_A},${CHAVE_B}`,
    } as NodeJS.ProcessEnv),
  );
  for (const h of [A, B]) {
    await servidor.inject({
      method: 'PUT',
      url: '/v1/credenciais',
      headers: h,
      payload: { tribunal: 'TJGO', identificacao: '00000000000', senha: 'segredo' },
    });
  }
});
afterEach(async () => {
  await servidor.close();
  pasta.apagar();
});

async function combinar(h = A, pecas = ['b', 'a', 'c']): Promise<string> {
  const r = await servidor.inject({
    method: 'POST',
    url: URL,
    headers: h,
    payload: { pecas },
  });
  expect(r.statusCode).toBe(202);
  const jobId = String(r.json().jobId);
  await app.leitor?.processarFila();
  return jobId;
}

describe('API — leitor de peças', () => {
  it('cria o pedido (202), informa estimativa e progresso, e entrega o PDF pronto', async () => {
    const r = await servidor.inject({
      method: 'POST',
      url: URL,
      headers: A,
      payload: { pecas: ['a', 'b'] },
    });
    expect(r.statusCode).toBe(202);
    expect(r.json()).toMatchObject({ estado: 'na_fila', total: 2 });
    expect(r.json().estimativaSegundos).toBeGreaterThan(0);

    // Antes de montar, o PDF ainda não existe: 409, não 404.
    const cedo = await servidor.inject({
      url: `${URL}/${r.json().jobId}/pdf`,
      headers: A,
    });
    expect(cedo.statusCode).toBe(409);

    await app.leitor?.processarFila();
    const p = await servidor.inject({ url: `${URL}/${r.json().jobId}`, headers: A });
    expect(p.json()).toMatchObject({
      estado: 'pronto',
      baixadas: 2,
      total: 2,
      paginas: 3,
    });
    expect(p.json().procedencia).toMatchObject({ fonte: 'mni', aoVivo: false });
    expect(p.json().procedencia.baixadoEm).toEqual(expect.any(String));
  });

  it('o progresso não expõe localizador, caminho em disco nem bytes de peça', async () => {
    const jobId = await combinar();
    const r = await servidor.inject({ url: `${URL}/${jobId}`, headers: A });
    expect(Object.keys(r.json()).sort()).toEqual([
      'atualizaDe',
      'atualizadoEm',
      'baixadas',
      'bytes',
      'criadoEm',
      'estado',
      'jobId',
      'mensagem',
      'numero',
      'paginas',
      'pendentes',
      'procedencia',
      'recusadas',
      'retomarEm',
      'total',
    ]);
    expect(r.body).not.toContain(pasta.caminho);
    expect(r.body).not.toContain('localizador');
  });

  it('parcial lista o que faltou e por quê', async () => {
    const jobId = await combinar();
    const r = await servidor.inject({ url: `${URL}/${jobId}`, headers: A });
    expect(r.json().estado).toBe('parcial');
    expect(r.json().recusadas).toEqual([
      expect.objectContaining({ pecaId: 'c', motivo: 'sem_teor' }),
    ]);
  });

  it('o índice traz páginas exatas na ordem dos autos', async () => {
    const jobId = await combinar();
    const r = await servidor.inject({ url: `${URL}/${jobId}/indice`, headers: A });
    expect(r.statusCode).toBe(200);
    expect(
      r
        .json()
        .indice.map((e: Record<string, unknown>) => [
          e['pecaId'],
          e['paginaInicial'],
          e['paginaFinal'],
          e['situacao'],
        ]),
    ).toEqual([
      ['a', 1, 2, 'incorporada'],
      ['b', 3, 3, 'incorporada'],
      ['c', 4, 4, 'nao_obtida'],
    ]);
  });

  it('serve o PDF com Range: 206 com o trecho certo, e 416 fora do arquivo', async () => {
    const jobId = await combinar();
    const inteiro = await servidor.inject({ url: `${URL}/${jobId}/pdf`, headers: A });
    expect(inteiro.statusCode).toBe(200);
    expect(inteiro.headers['accept-ranges']).toBe('bytes');
    expect(inteiro.headers['content-type']).toBe('application/pdf');
    expect(inteiro.headers['cache-control']).toBe('private, no-store');
    const total = inteiro.rawPayload.length;
    expect(inteiro.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');

    const trecho = await servidor.inject({
      url: `${URL}/${jobId}/pdf`,
      headers: { ...A, range: 'bytes=10-29' },
    });
    expect(trecho.statusCode).toBe(206);
    expect(trecho.headers['content-range']).toBe(`bytes 10-29/${total}`);
    expect(trecho.rawPayload.equals(inteiro.rawPayload.subarray(10, 30))).toBe(true);

    const fim = await servidor.inject({
      url: `${URL}/${jobId}/pdf`,
      headers: { ...A, range: 'bytes=-16' },
    });
    expect(fim.rawPayload.equals(inteiro.rawPayload.subarray(total - 16))).toBe(true);

    const fora = await servidor.inject({
      url: `${URL}/${jobId}/pdf`,
      headers: { ...A, range: `bytes=${total}-` },
    });
    expect(fora.statusCode).toBe(416);
    expect(fora.headers['content-range']).toBe(`bytes */${total}`);
  });

  it('o workspace B nunca lê o job, o índice nem o PDF do workspace A', async () => {
    const jobId = await combinar(A);
    for (const sufixo of ['', '/indice', '/pdf']) {
      const r = await servidor.inject({ url: `${URL}/${jobId}${sufixo}`, headers: B });
      expect(r.statusCode).toBe(404);
      expect(r.body).not.toContain('%PDF');
    }
    const atualizar = await servidor.inject({
      method: 'POST',
      url: `${URL}/${jobId}/atualizar`,
      headers: B,
    });
    expect(atualizar.statusCode).toBe(404);
    // E o dono continua lendo.
    const r = await servidor.inject({ url: `${URL}/${jobId}/pdf`, headers: A });
    expect(r.statusCode).toBe(200);
  });

  it('o id do job com o número de OUTRO processo não abre nada', async () => {
    const jobId = await combinar(A);
    const r = await servidor.inject({
      url: `/v1/processos/${OUTRO_PROCESSO}/leitor/${jobId}/pdf`,
      headers: A,
    });
    expect(r.statusCode).toBe(404);
  });

  it('id de job malformado é 404, não erro interno', async () => {
    const r = await servidor.inject({ url: `${URL}/..%2F..%2Fetc`, headers: A });
    expect(r.statusCode).toBe(404);
  });

  it('pedido sem peças é recusado com 400', async () => {
    const r = await servidor.inject({
      method: 'POST',
      url: URL,
      headers: A,
      payload: { pecas: [] },
    });
    expect(r.statusCode).toBe(400);
  });

  it('bloqueio do tribunal no atualizar vira 503 com a hora de retomada', async () => {
    const jobId = await combinar(A);
    provedor.assinaturaDeMudanca = async () => {
      throw new MniBloqueadoError('mni', new Date('2026-10-01T13:00:00.000Z'));
    };
    const r = await servidor.inject({
      method: 'POST',
      url: `${URL}/${jobId}/atualizar`,
      headers: A,
    });
    expect(r.statusCode).toBe(503);
    expect(r.json().erro).toBe('MNI_BLOQUEADO');
    expect(r.json().mensagem).toContain('2026-10-01T13:00:00.000Z');
  });

  it('sem leitor montado, a rota diz o que falta (501) em vez de fingir', async () => {
    const semLeitor = construirServidor(
      aplicacaoDeTeste([new ProviderFalso({ nome: 'falso' })]),
      carregarConfig({
        PROCESSOVIVO_PROVIDER_CHAIN: 'mock-crawler-tjsp',
        LOG_LEVEL: 'silent',
        PROCESSOVIVO_API_KEYS: CHAVE_A,
      } as NodeJS.ProcessEnv),
    );
    const r = await semLeitor.inject({
      method: 'POST',
      url: URL,
      headers: A,
      payload: { pecas: ['a'] },
    });
    expect(r.statusCode).toBe(501);
    expect(r.json().mensagem).toContain('qpdf');
    await semLeitor.close();
  });
});

describe('API — leitor com peça HTML', () => {
  it('a rota devolve html_convertida no índice e nenhum HTML cru em resposta alguma', async () => {
    provedor.pecas.push({
      id: 'certidao',
      mimetype: 'text/html',
      bytes: new Uint8Array(Buffer.from(HTML_SINTETICO, 'utf8')),
    });
    const jobId = await combinar(A, ['a', 'certidao']);
    const progresso = await servidor.inject({ url: `${URL}/${jobId}`, headers: A });
    const indice = await servidor.inject({ url: `${URL}/${jobId}/indice`, headers: A });
    expect(progresso.json().estado).toBe('pronto');
    expect(
      indice
        .json()
        .indice.find((e: Record<string, unknown>) => e['pecaId'] === 'certidao'),
    ).toMatchObject({ situacao: 'html_convertida' });
    for (const corpo of [progresso.body, indice.body]) {
      for (const proibido of [
        MARCADOR_SCRIPT,
        MARCADOR_ATRIBUTO,
        '<strong>',
        'iVBORw0KGgo',
        'Certifico',
      ]) {
        expect(corpo).not.toContain(proibido);
      }
    }
  });
});

describe('interpretarRange', () => {
  it('cobre as formas de uma faixa e ignora o que não sabe ler', () => {
    expect(interpretarRange('bytes=0-9', 100)).toEqual({ inicio: 0, fim: 9 });
    expect(interpretarRange('bytes=90-', 100)).toEqual({ inicio: 90, fim: 99 });
    expect(interpretarRange('bytes=-10', 100)).toEqual({ inicio: 90, fim: 99 });
    expect(interpretarRange('bytes=50-500', 100)).toEqual({ inicio: 50, fim: 99 });
    expect(interpretarRange('bytes=100-', 100)).toBe('insatisfazivel');
    expect(interpretarRange('bytes=0-1,5-9', 100)).toBeUndefined();
    expect(interpretarRange('itens=0-9', 100)).toBeUndefined();
    expect(interpretarRange(undefined, 100)).toBeUndefined();
  });
});
