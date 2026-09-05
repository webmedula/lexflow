import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ProcessoSearchService } from '../../src/application/services/ProcessoSearchService.js';
import { DataJudAdapter } from '../../src/infrastructure/adapters/datajud/DataJudAdapter.js';
import { DjenAdapter } from '../../src/infrastructure/adapters/djen/DjenAdapter.js';
import { HttpClient } from '../../src/infrastructure/http/HttpClient.js';
import type { RespostaHttp } from '../../src/infrastructure/http/HttpClient.js';
import type { RateLimiter } from '../../src/infrastructure/ratelimit/TokenBucketRateLimiter.js';

/**
 * A tese do produto, exercitada de ponta a ponta contra as DUAS capturas reais.
 *
 * Nenhuma fonte brasileira sozinha entrega um processo inteiro. Este teste
 * existe para que a afirmação do README pare de ser afirmação: ele falha se o
 * enriquecimento parar de acontecer.
 */

const DATAJUD: unknown = JSON.parse(
  readFileSync(new URL('../fixtures/datajud-tjgo-real.json', import.meta.url), 'utf8'),
);
const DJEN: unknown = JSON.parse(
  readFileSync(new URL('../fixtures/djen-comunica-real.json', import.meta.url), 'utf8'),
);

/** Número do processo que está na captura real do DataJud (TJGO). */
const NUMERO = '0311517-22.2015.8.09.0051';

const limitador: RateLimiter = { adquirir: async () => {}, tentarAdquirir: () => true };

/**
 * Devolve o payload do DataJud para a URL do CNJ e o do DJEN para a do PJe,
 * com o número do DJEN reescrito para o mesmo processo — é o que permite
 * observar a FUSÃO em vez de dois processos soltos.
 */
function roteador(): HttpClient {
  const djen = JSON.parse(JSON.stringify(DJEN)) as {
    items: Array<{ numeroprocessocommascara: string; numero_processo: string }>;
  };
  for (const item of djen.items) {
    item.numeroprocessocommascara = NUMERO;
    item.numero_processo = NUMERO.replace(/\D/g, '');
  }

  class Roteador extends HttpClient {
    override async postJson(): Promise<RespostaHttp> {
      return { status: 200, ok: true, corpo: JSON.stringify(DATAJUD) };
    }
    override async get(url: string): Promise<RespostaHttp> {
      if (!url.includes('comunicaapi')) throw new Error(`URL inesperada: ${url}`);
      return { status: 200, ok: true, corpo: JSON.stringify(djen) };
    }
  }
  return new Roteador();
}

function cadeia(): ProcessoSearchService {
  const http = roteador();
  return new ProcessoSearchService({
    providers: [
      new DataJudAdapter({ apiKey: 'chave-de-teste', httpClient: http, rateLimiter: limitador }),
      new DjenAdapter({ httpClient: http, rateLimiter: limitador }),
    ],
  });
}

describe('busca híbrida DataJud + DJEN sobre capturas reais', () => {
  it('junta a linha do tempo do DataJud com as partes e o teor do DJEN', async () => {
    const processo = await cadeia().buscarPorNumero(NUMERO);

    // Do DataJud: metadado e data de distribuição, que o DJEN não tem.
    expect(processo.tribunal).toBe('TJGO');
    expect(processo.dataDistribuicao).toBeDefined();

    // Do DJEN: a parte com o advogado e a OAB — impossível no DataJud.
    expect(processo.partes.length).toBeGreaterThan(0);
    expect(processo.partes[0]?.advogados[0]?.oab).toBe('47383');

    // Do DJEN: inteiro teor. O DataJud só dá o rótulo da TPU.
    expect(processo.movimentacoes.some((m) => m.conteudo)).toBe(true);

    // A procedência diz honestamente que são duas fontes.
    expect(processo.procedencia.provider).toBe('datajud+djen');
  });

  it('a linha do tempo do DataJud NÃO é substituída pela do DJEN', async () => {
    // O DJEN só tem o que foi publicado. Se ele sobrescrevesse a linha do tempo,
    // um processo com 361 andamentos passaria a mostrar 8 — e o advogado
    // concluiria que não houve movimento.
    const soDataJud = await new ProcessoSearchService({
      providers: [
        new DataJudAdapter({
          apiKey: 'chave-de-teste',
          httpClient: roteador(),
          rateLimiter: limitador,
        }),
      ],
    }).buscarPorNumero(NUMERO);

    const hibrido = await cadeia().buscarPorNumero(NUMERO);

    expect(hibrido.movimentacoes.length).toBeGreaterThanOrEqual(
      soDataJud.movimentacoes.length,
    );
  });

  it('cada andamento carrega de qual fonte veio', async () => {
    const processo = await cadeia().buscarPorNumero(NUMERO);
    const fontes = new Set(processo.movimentacoes.map((m) => m.fonte));

    expect(fontes.has('datajud')).toBe(true);
    expect(fontes.has('djen')).toBe(true);
  });

  it('a busca por OAB atravessa a cadeia e chega ao DJEN', async () => {
    // O DataJud lança OperacaoNaoSuportadaError e é PULADO — não conta como
    // falha, não aciona fallback de erro, não aparece para o usuário.
    const processos = await cadeia().buscarPorOab('47383', 'GO');

    expect(processos.length).toBeGreaterThan(0);
    expect(processos[0]?.procedencia.provider).toBe('djen');
  });
});
