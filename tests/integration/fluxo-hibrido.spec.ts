import { describe, expect, it } from 'vitest';
import { ProcessoSearchService } from '../../src/application/services/ProcessoSearchService.js';
import { BuscarProcessoPorNumero } from '../../src/domain/usecases/BuscarProcessoPorNumero.js';
import { BuscarProcessosPorOab } from '../../src/domain/usecases/BuscarProcessosPorOab.js';
import { ProcessoNaoEncontradoError } from '../../src/domain/errors/index.js';
import { MockCrawlerAdapter } from '../../src/infrastructure/adapters/crawler/MockCrawlerAdapter.js';
import { DataJudAdapter } from '../../src/infrastructure/adapters/datajud/DataJudAdapter.js';
import { CachedProcessoProvider } from '../../src/infrastructure/cache/CachedProcessoProvider.js';
import { InMemoryCache } from '../../src/infrastructure/cache/InMemoryCache.js';
import { HttpClient } from '../../src/infrastructure/http/HttpClient.js';
import type { RespostaHttp } from '../../src/infrastructure/http/HttpClient.js';
import { montarAplicacao } from '../../src/main/factories/makeProcessoSearchService.js';
import { carregarConfig } from '../../src/infrastructure/config/env.js';
import { NUMERO_TJSP_A, NUMERO_TRF1 } from '../helpers/fabricas.js';

/**
 * Testes de FLUXO: montam a cadeia real (crawler mock + DataJud com HTTP dublado)
 * e verificam que a abordagem híbrida se comporta como prometido.
 * Nenhuma chamada de rede acontece.
 */

class HttpDublado extends HttpClient {
  chamadas = 0;

  constructor(private readonly responder: () => RespostaHttp) {
    super();
  }

  override async postJson(): Promise<RespostaHttp> {
    this.chamadas++;
    return this.responder();
  }
}

function respostaDataJud(numeroSemMascara: string): RespostaHttp {
  return {
    status: 200,
    ok: true,
    corpo: JSON.stringify({
      hits: {
        hits: [
          {
            _source: {
              numeroProcesso: numeroSemMascara,
              tribunal: numeroSemMascara.slice(13, 16) === '826' ? 'TJSP' : 'TRF1',
              grau: 'G1',
              dataAjuizamento: '2023-03-14T09:12:00.000Z',
              classe: { codigo: 7, nome: 'Procedimento Comum Cível' },
              orgaoJulgador: { nome: 'Vara vinda do DataJud' },
              movimentos: [
                { codigo: 26, nome: 'Distribuição', dataHora: '2023-03-14T09:12:00.000Z' },
              ],
            },
          },
        ],
      },
    }),
  };
}

function montarCadeia(opcoes: {
  falhaDoCrawler?: boolean;
  respostaHttp?: () => RespostaHttp;
}): { servico: ProcessoSearchService; http: HttpDublado } {
  const http = new HttpDublado(
    opcoes.respostaHttp ?? (() => respostaDataJud('12345674720238260100')),
  );

  const crawler = new MockCrawlerAdapter({
    latenciaMs: 0,
    taxaDeFalha: opcoes.falhaDoCrawler ? 1 : 0,
    aleatorio: () => 0,
  });

  const datajud = new DataJudAdapter({
    apiKey: 'chave-de-teste',
    httpClient: http,
    rateLimiter: { adquirir: async () => {}, tentarAdquirir: () => true },
  });

  return {
    servico: new ProcessoSearchService({ providers: [crawler, datajud] }),
    http,
  };
}

describe('fluxo híbrido: crawler primário, DataJud como fallback', () => {
  it('quando o crawler responde, o DataJud não é chamado', async () => {
    const { servico, http } = montarCadeia({});
    const processo = await new BuscarProcessoPorNumero(servico).executar({
      numeroProcesso: NUMERO_TJSP_A,
    });

    expect(processo.procedencia.provider).toBe('mock-crawler-tjsp');
    expect(processo.partes.length).toBeGreaterThan(0);
    expect(http.chamadas).toBe(0);
  });

  it('quando o crawler cai, o DataJud assume e a consulta continua funcionando', async () => {
    const { servico, http } = montarCadeia({ falhaDoCrawler: true });
    const processo = await new BuscarProcessoPorNumero(servico).executar({
      numeroProcesso: NUMERO_TJSP_A,
    });

    expect(processo.procedencia.provider).toBe('datajud');
    expect(processo.vara).toBe('Vara vinda do DataJud');
    expect(http.chamadas).toBe(1);
  });

  it('o fallback devolve dados MENOS ricos — e isso fica visível, não escondido', async () => {
    const comCrawler = await montarCadeia({}).servico.buscarPorNumero(NUMERO_TJSP_A);
    const comFallback = await montarCadeia({
      falhaDoCrawler: true,
    }).servico.buscarPorNumero(NUMERO_TJSP_A);

    expect(comCrawler.temDetalhamento).toBe(true);
    expect(comFallback.temDetalhamento).toBe(false);
    expect(comFallback.partes).toEqual([]);
  });

  it('processo de tribunal fora do crawler vai direto ao DataJud', async () => {
    const { servico, http } = montarCadeia({
      respostaHttp: () => respostaDataJud('00008323520184013202'),
    });

    const processo = await servico.buscarPorNumero(NUMERO_TRF1);
    expect(processo.procedencia.provider).toBe('datajud');
    expect(http.chamadas).toBe(1);
  });

  it('busca por OAB usa só o crawler, porque o DataJud declara não suportar', async () => {
    const { servico, http } = montarCadeia({});
    const processos = await new BuscarProcessosPorOab(servico).executar({
      oab: '234567',
      uf: 'SP',
    });

    expect(processos).toHaveLength(2);
    expect(http.chamadas).toBe(0);
  });

  it('número inexistente nas duas fontes vira "não encontrado", não "sistema fora"', async () => {
    const { servico } = montarCadeia({
      respostaHttp: () => ({
        status: 200,
        ok: true,
        corpo: JSON.stringify({ hits: { total: { value: 0 }, hits: [] } }),
      }),
    });

    await expect(
      servico.buscarPorNumero('0000001-84.2020.8.26.0001'),
    ).rejects.toBeInstanceOf(ProcessoNaoEncontradoError);
  });

  it('com cache no topo, a segunda consulta não toca em nenhuma fonte', async () => {
    const { servico, http } = montarCadeia({ falhaDoCrawler: true });
    const comCache = new CachedProcessoProvider({
      provider: servico,
      cache: new InMemoryCache(),
    });

    await comCache.buscarPorNumero(NUMERO_TJSP_A);
    await comCache.buscarPorNumero(NUMERO_TJSP_A);

    expect(http.chamadas).toBe(1);
  });
});

describe('composition root', () => {
  it('monta a aplicação apenas com o crawler quando não há chave do DataJud', async () => {
    const app = montarAplicacao(
      carregarConfig({
        LEXFLOW_DB_PATH: ':memory:',
        LEXFLOW_PROVIDER_CHAIN: 'mock-crawler-tjsp,datajud',
        DATAJUD_API_KEY: '',
        MOCK_CRAWLER_LATENCY_MS: '0',
        LOG_LEVEL: 'silent',
      } as NodeJS.ProcessEnv),
    );

    const processo = await app.buscarProcessoPorNumero.executar({
      numeroProcesso: NUMERO_TJSP_A,
    });

    expect(processo.procedencia.provider).toBe('mock-crawler-tjsp');
    await expect(app.orquestrador.diagnostico()).resolves.toEqual([
      { provider: 'mock-crawler-tjsp', saudavel: true },
    ]);
  });

  it('deixa o DataJud fora da cadeia quando a chave é o texto de exemplo', async () => {
    // Reproduz o incidente: o bloco do DEPLOY.md colado sem substituir o valor.
    const app = montarAplicacao(
      carregarConfig({
        LEXFLOW_DB_PATH: ':memory:',
        LEXFLOW_PROVIDER_CHAIN: 'mock-crawler-tjsp,datajud',
        DATAJUD_API_KEY: 'COLE_AQUI_A_CHAVE_DO_CNJ_OU_DEIXE_VAZIO',
        MOCK_CRAWLER_LATENCY_MS: '0',
        LOG_LEVEL: 'silent',
      } as NodeJS.ProcessEnv),
    );

    // A fonte não entra na cadeia — e portanto não aparece reprovada no /ready
    // como se fosse um problema de disponibilidade.
    await expect(app.orquestrador.diagnostico()).resolves.toEqual([
      { provider: 'mock-crawler-tjsp', saudavel: true },
    ]);
  });

  it('recusa a montagem quando a cadeia não produz nenhum provider utilizável', () => {
    expect(() =>
      montarAplicacao(
        carregarConfig({
          LEXFLOW_DB_PATH: ':memory:',
          LEXFLOW_PROVIDER_CHAIN: 'inexistente',
          LOG_LEVEL: 'silent',
        } as NodeJS.ProcessEnv),
      ),
    ).toThrow(/Nenhum provider utilizável/);
  });

  it('rejeita configuração fora do formato no arranque', () => {
    expect(() =>
      carregarConfig({ DATAJUD_TIMEOUT_MS: 'oito segundos' } as NodeJS.ProcessEnv),
    ).toThrow(/Configuração inválida/);
  });
});
