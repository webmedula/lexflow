import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { construirServidor } from '../../src/main/http/servidor.js';
import { carregarConfig } from '../../src/infrastructure/config/env.js';
import type { Config } from '../../src/infrastructure/config/env.js';
import { montarAplicacao } from '../../src/main/factories/makeProcessoSearchService.js';
import { NUMERO_TJSP_A, ProviderFalso } from '../helpers/fabricas.js';
import { aplicacaoDeTeste } from '../helpers/aplicacao.js';

/**
 * A API inteira é testada com `inject()`: sem abrir porta, sem esperar bind,
 * sem teste ficar instável em CI por concorrência de porta.
 */

const CHAVE = 'chave-de-teste-1234567890';

function configDeTeste(extra: Record<string, string> = {}): Config {
  return carregarConfig({
    // Banco EM MEMÓRIA, e não o caminho padrão em disco: o Vitest roda os
    // arquivos de teste em paralelo, e dois deles abrindo o mesmo
    // ./dados/lexflow.db disputam o arquivo — o sintoma é
    // "database is locked" num teste que não fala de banco nenhum, e que passa
    // ou falha conforme o número de núcleos da máquina.
    LEXFLOW_DB_PATH: ':memory:',
    LEXFLOW_PROVIDER_CHAIN: 'mock-crawler-tjsp',
    MOCK_CRAWLER_LATENCY_MS: '0',
    LOG_LEVEL: 'silent',
    LEXFLOW_API_KEYS: CHAVE,
    CACHE_ENABLED: 'false',
    ...extra,
  } as NodeJS.ProcessEnv);
}

function montar(extra: Record<string, string> = {}): FastifyInstance {
  const config = configDeTeste(extra);
  return construirServidor(montarAplicacao(config), config);
}

describe('API — autenticação', () => {
  let servidor: FastifyInstance;

  beforeEach(() => {
    servidor = montar();
  });
  afterEach(async () => {
    await servidor.close();
  });

  it('recusa requisição sem chave', async () => {
    const r = await servidor.inject({ method: 'GET', url: `/v1/processos/${NUMERO_TJSP_A}` });
    expect(r.statusCode).toBe(401);
    expect(r.json().erro).toBe('NAO_AUTENTICADO');
  });

  it('recusa chave errada', async () => {
    const r = await servidor.inject({
      method: 'GET',
      url: `/v1/processos/${NUMERO_TJSP_A}`,
      headers: { 'x-api-key': 'chave-errada-000000000000' },
    });
    expect(r.statusCode).toBe(401);
  });

  it('aceita a chave no header x-api-key', async () => {
    const r = await servidor.inject({
      method: 'GET',
      url: `/v1/processos/${NUMERO_TJSP_A}`,
      headers: { 'x-api-key': CHAVE },
    });
    expect(r.statusCode).toBe(200);
  });

  it('aceita a mesma chave como Authorization: Bearer', async () => {
    const r = await servidor.inject({
      method: 'GET',
      url: `/v1/processos/${NUMERO_TJSP_A}`,
      headers: { authorization: `Bearer ${CHAVE}` },
    });
    expect(r.statusCode).toBe(200);
  });

  it('nunca devolve a chave no corpo do erro', async () => {
    const r = await servidor.inject({
      method: 'GET',
      url: `/v1/processos/${NUMERO_TJSP_A}`,
      headers: { 'x-api-key': 'errada' },
    });
    expect(r.body).not.toContain(CHAVE);
  });

  it('libera as rotas de saúde sem autenticação', async () => {
    await expect(
      servidor.inject({ method: 'GET', url: '/health' }).then((r) => r.statusCode),
    ).resolves.toBe(200);
    await expect(
      servidor.inject({ method: 'GET', url: '/ready' }).then((r) => r.statusCode),
    ).resolves.toBe(200);
  });

  it('permite desativar a autenticação explicitamente', async () => {
    const aberto = montar({ LEXFLOW_API_KEYS: '', LEXFLOW_AUTH_DISABLED: 'true' });
    const r = await aberto.inject({
      method: 'GET',
      url: `/v1/processos/${NUMERO_TJSP_A}`,
    });
    expect(r.statusCode).toBe(200);
    await aberto.close();
  });
});

describe('API — consulta de processo', () => {
  let servidor: FastifyInstance;
  const auth = { 'x-api-key': CHAVE };

  beforeEach(() => {
    servidor = montar();
  });
  afterEach(async () => {
    await servidor.close();
  });

  it('devolve o processo em JSON', async () => {
    const r = await servidor.inject({
      method: 'GET',
      url: `/v1/processos/${NUMERO_TJSP_A}`,
      headers: auth,
    });

    expect(r.statusCode).toBe(200);
    const corpo = r.json();
    expect(corpo.numero).toBe(NUMERO_TJSP_A);
    expect(corpo.tribunal).toBe('TJSP');
    expect(corpo.partes.length).toBeGreaterThan(0);
    expect(corpo.movimentacoes[0].data).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('aceita o número sem máscara', async () => {
    const r = await servidor.inject({
      method: 'GET',
      url: '/v1/processos/12345674720238260100',
      headers: auth,
    });
    expect(r.statusCode).toBe(200);
  });

  it('expõe a procedência em cabeçalhos', async () => {
    const r = await servidor.inject({
      method: 'GET',
      url: `/v1/processos/${NUMERO_TJSP_A}`,
      headers: auth,
    });

    expect(r.headers['x-lexflow-fonte']).toBe('mock-crawler-tjsp');
    expect(r.headers['x-lexflow-cache']).toBe('false');
  });

  it('400 para número CNJ com dígito verificador inválido', async () => {
    const r = await servidor.inject({
      method: 'GET',
      url: '/v1/processos/1234567-48.2023.8.26.0100',
      headers: auth,
    });

    expect(r.statusCode).toBe(400);
    expect(r.json().erro).toBe('NUMERO_CNJ_INVALIDO');
  });

  it('404 quando o processo não existe em nenhuma fonte', async () => {
    const r = await servidor.inject({
      method: 'GET',
      url: '/v1/processos/0000001-84.2020.8.26.0001',
      headers: auth,
    });

    expect(r.statusCode).toBe(404);
    expect(r.json().erro).toBe('PROCESSO_NAO_ENCONTRADO');
  });

  it('502 quando as fontes falham — problema rio acima, não bug nosso', async () => {
    const comFalha = montar({ MOCK_CRAWLER_FAILURE_RATE: '1' });
    const r = await comFalha.inject({
      method: 'GET',
      url: `/v1/processos/${NUMERO_TJSP_A}`,
      headers: auth,
    });

    expect(r.statusCode).toBe(502);
    expect(r.json().erro).toBe('TODAS_AS_FONTES_FALHARAM');
    expect(r.json().detalhes).toHaveLength(1);
    await comFalha.close();
  });

  it('404 com corpo estruturado para rota inexistente', async () => {
    const r = await servidor.inject({ method: 'GET', url: '/v1/nada', headers: auth });
    expect(r.statusCode).toBe(404);
    expect(r.json().erro).toBe('ROTA_NAO_ENCONTRADA');
  });
});

describe('API — carteira por OAB', () => {
  let servidor: FastifyInstance;
  const auth = { 'x-api-key': CHAVE };

  beforeEach(() => {
    servidor = montar();
  });
  afterEach(async () => {
    await servidor.close();
  });

  it('lista os processos do advogado', async () => {
    const r = await servidor.inject({
      method: 'GET',
      url: '/v1/advogados/SP/234567/processos',
      headers: auth,
    });

    expect(r.statusCode).toBe(200);
    expect(r.json().total).toBe(2);
    expect(r.json().processos).toHaveLength(2);
  });

  it('respeita a ordenação pedida', async () => {
    const r = await servidor.inject({
      method: 'GET',
      url: '/v1/advogados/SP/234567/processos?ordenarPor=DISTRIBUICAO',
      headers: auth,
    });

    const datas = r.json().processos.map((p: { dataDistribuicao: string }) => p.dataDistribuicao);
    expect(new Date(datas[0]).getTime()).toBeGreaterThan(new Date(datas[1]).getTime());
  });

  it('200 com lista vazia quando o advogado não tem processos', async () => {
    const r = await servidor.inject({
      method: 'GET',
      url: '/v1/advogados/SP/999999/processos',
      headers: auth,
    });

    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ total: 0, processos: [] });
  });

  it('400 para UF inexistente', async () => {
    const r = await servidor.inject({
      method: 'GET',
      url: '/v1/advogados/ZZ/234567/processos',
      headers: auth,
    });

    expect(r.statusCode).toBe(400);
    expect(r.json().erro).toBe('OAB_INVALIDA');
  });
});

describe('API — saúde e rate limit', () => {
  it('/health responde sem tocar em fonte externa', async () => {
    // Todas as fontes quebradas: /health continua 200, porque o PROCESSO está
    // vivo. Se dependesse das fontes, o Easypanel reiniciaria um contêiner são.
    const servidor = montar({ MOCK_CRAWLER_FAILURE_RATE: '1' });
    const r = await servidor.inject({ method: 'GET', url: '/health' });

    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe('ok');
    await servidor.close();
  });

  it('/health informa a versão do serviço', async () => {
    // É como se confere, de fora, se o deploy realmente pegou.
    const servidor = montar();
    const r = await servidor.inject({ method: 'GET', url: '/health' });

    expect(r.json().versao).toMatch(/^\d+\.\d+\.\d+$/);
    await servidor.close();
  });

  it('/ready lista o estado de cada fonte', async () => {
    const servidor = montar();
    const r = await servidor.inject({ method: 'GET', url: '/ready' });

    expect(r.statusCode).toBe(200);
    expect(r.json().fontes).toEqual([
      { provider: 'mock-crawler-tjsp', saudavel: true },
    ]);
    await servidor.close();
  });

  it('/ready devolve 503 quando nenhuma fonte responde', async () => {
    // Cadeia montada à mão com uma fonte declaradamente fora do ar.
    const fonteMorta = new ProviderFalso({ nome: 'fonte-morta', saudavel: false });
    const servidor = construirServidor(
      aplicacaoDeTeste([fonteMorta]),
      configDeTeste(),
    );

    const r = await servidor.inject({ method: 'GET', url: '/ready' });
    expect(r.statusCode).toBe(503);
    expect(r.json().fontes).toEqual([{ provider: 'fonte-morta', saudavel: false }]);
    await servidor.close();
  });

  it('429 ao estourar o limite de requisições', async () => {
    const servidor = montar({ RATE_LIMIT_MAX: '3', RATE_LIMIT_WINDOW_MS: '60000' });
    const pedir = (): Promise<number> =>
      servidor
        .inject({
          method: 'GET',
          url: `/v1/processos/${NUMERO_TJSP_A}`,
          headers: { 'x-api-key': CHAVE },
        })
        .then((r) => r.statusCode);

    expect(await pedir()).toBe(200);
    expect(await pedir()).toBe(200);
    expect(await pedir()).toBe(200);

    const quarta = await servidor.inject({
      method: 'GET',
      url: `/v1/processos/${NUMERO_TJSP_A}`,
      headers: { 'x-api-key': CHAVE },
    });
    expect(quarta.statusCode).toBe(429);
    expect(quarta.json().erro).toBe('LIMITE_EXCEDIDO');
    await servidor.close();
  });

  it('health check não consome cota do rate limit', async () => {
    const servidor = montar({ RATE_LIMIT_MAX: '2' });
    for (let i = 0; i < 10; i++) {
      const r = await servidor.inject({ method: 'GET', url: '/health' });
      expect(r.statusCode).toBe(200);
    }
    await servidor.close();
  });
});
