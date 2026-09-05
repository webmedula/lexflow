import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { construirServidor } from '../../src/main/http/servidor.js';
import { carregarConfig } from '../../src/infrastructure/config/env.js';
import { montarAplicacao } from '../../src/main/factories/makeProcessoSearchService.js';

const CHAVE = 'chave-de-teste-1234567890';

function montar(): FastifyInstance {
  const config = carregarConfig({
    LEXFLOW_PROVIDER_CHAIN: 'mock-crawler-tjsp',
    MOCK_CRAWLER_LATENCY_MS: '0',
    LOG_LEVEL: 'silent',
    LEXFLOW_API_KEYS: CHAVE,
  } as NodeJS.ProcessEnv);
  return construirServidor(montarAplicacao(config), config);
}

describe('console web', () => {
  let servidor: FastifyInstance;

  beforeEach(() => {
    servidor = montar();
  });
  afterEach(async () => {
    await servidor.close();
  });

  it('a raiz serve HTML sem exigir chave', async () => {
    // É o ponto inteiro da página: digitar a URL no navegador tem que abrir o
    // sistema, não devolver {"erro":"NAO_AUTENTICADO"}.
    const r = await servidor.inject({ method: 'GET', url: '/' });

    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('text/html');
    expect(r.body).toContain('<title>LexFlow</title>');
  });

  it('mostra a versão em execução', async () => {
    const r = await servidor.inject({ method: 'GET', url: '/' });
    expect(r.body).toMatch(/v\d+\.\d+\.\d+/);
  });

  it('oferece consulta por número e por OAB', async () => {
    const r = await servidor.inject({ method: 'GET', url: '/' });
    expect(r.body).toContain('/v1/processos/');
    expect(r.body).toContain('/v1/advogados/');
  });

  it('não embute chave de API nenhuma no HTML', async () => {
    // A página pede a chave ao usuário; ela nunca é servida pelo servidor.
    const r = await servidor.inject({ method: 'GET', url: '/' });
    expect(r.body).not.toContain(CHAVE);
  });

  it('não é cacheada nem indexada', async () => {
    const r = await servidor.inject({ method: 'GET', url: '/' });
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['x-robots-tag']).toBe('noindex');
  });

  it('não carrega nada de fora — funciona sem internet', async () => {
    // Nenhum script, fonte ou CSS externo: a página é uma string do servidor.
    const r = await servidor.inject({ method: 'GET', url: '/' });
    expect(r.body).not.toMatch(/<script[^>]+src=/i);
    expect(r.body).not.toMatch(/<link[^>]+href="https?:/i);
  });

  it('as rotas de dados continuam protegidas', async () => {
    // Servir a página aberta não pode ter aberto a API junto.
    const r = await servidor.inject({
      method: 'GET',
      url: '/v1/processos/1234567-47.2023.8.26.0100',
    });
    expect(r.statusCode).toBe(401);
  });

  it('mantém a classificação de andamentos internos e marcos', async () => {
    // Se estas tabelas sumirem, a linha do tempo volta a ser um muro de 361
    // itens. Os códigos vieram de uma resposta REAL do TJGO.
    const r = await servidor.inject({ method: 'GET', url: '/' });

    expect(r.body).toMatch(/var INTERNOS=\{[^}]*12266/);
    expect(r.body).toMatch(/var MARCOS=\{[^}]*848/);
  });

  it('nunca descarta andamento: o recolhido é contado e reversível', async () => {
    // Sumir com movimentação em silêncio é como se perde prazo. O botão de
    // alternar e a contagem precisam existir na página.
    const r = await servidor.inject({ method: 'GET', url: '/' });

    expect(r.body).toContain('interno(s)');
    expect(r.body).toContain('Nada foi descartado');
    expect(r.body).toContain('alternar');
  });

  it('o console não consome cota do rate limit', async () => {
    for (let i = 0; i < 8; i++) {
      const r = await servidor.inject({ method: 'GET', url: '/' });
      expect(r.statusCode).toBe(200);
    }
  });
});
