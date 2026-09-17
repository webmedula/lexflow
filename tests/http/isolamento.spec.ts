import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { carregarConfig } from '../../src/infrastructure/config/env.js';
import { construirServidor } from '../../src/main/http/servidor.js';
import { aplicacaoDeTeste } from '../helpers/aplicacao.js';
import { ProviderFalso } from '../helpers/fabricas.js';
import type { Aplicacao } from '../../src/main/factories/makeProcessoSearchService.js';

const CHAVE = 'chave-de-teste-1234567890';
const SENHA = 'uma-senha-boa-o-bastante';
const PROCESSO_A = '1234567-47.2023.8.26.0100';
const PROCESSO_B = '5818922-04.2026.8.09.0011';

function montar(autenticacaoAberta = false): {
  servidor: FastifyInstance;
  app: Aplicacao;
} {
  const app = aplicacaoDeTeste([new ProviderFalso({ nome: 'falso' })]);
  const config = carregarConfig({
    LEXFLOW_PROVIDER_CHAIN: 'mock-crawler-tjsp',
    LOG_LEVEL: 'silent',
    CACHE_ENABLED: 'false',
    COOKIE_SECURE: 'false',
    ...(autenticacaoAberta
      ? { LEXFLOW_AUTH_DISABLED: 'true' }
      : { LEXFLOW_API_KEYS: CHAVE }),
  } as NodeJS.ProcessEnv);
  return { servidor: construirServidor(app, config), app };
}

function cookieDe(r: { headers: Record<string, unknown> }): string {
  const bruto = r.headers['set-cookie'];
  const linha = Array.isArray(bruto) ? bruto[0] : bruto;
  return String(linha ?? '').split(';')[0] ?? '';
}

/**
 * Estes testes existem por causa de uma revisão de segurança que encontrou o
 * problema abaixo, e não por causa de um relato de uso. Vale registrar:
 *
 * `POST /v1/sincronizar` e `POST /v1/vigilancias/varrer` disparavam a varredura
 * GLOBAL — a mesma que o agendador roda. Qualquer conta autenticada mandava o
 * servidor consultar o tribunal sobre os processos de TODOS os assinantes,
 * gravando nos dados deles e gastando a cota compartilhada do CNJ em nome
 * deles. Nada do conteúdo alheio voltava na resposta, o que é justamente o que
 * faz isso passar despercebido.
 */
describe('Varredura manual — escopada a quem pediu', () => {
  let servidor: FastifyInstance;
  let app: Aplicacao;

  beforeEach(() => {
    ({ servidor, app } = montar());
  });
  afterEach(async () => {
    await servidor.close();
  });

  async function conta(email: string): Promise<string> {
    return cookieDe(
      await servidor.inject({
        method: 'POST',
        url: '/v1/contas',
        payload: { nome: 'Advogado', email, senha: SENHA },
      }),
    );
  }

  it('sincroniza só os processos de quem disparou', async () => {
    const ana = await conta('ana@a.com.br');
    const bruno = await conta('bruno@b.com.br');

    await servidor.inject({
      method: 'POST',
      url: '/v1/acompanhamentos',
      headers: { cookie: ana },
      payload: { numero: PROCESSO_A },
    });
    await servidor.inject({
      method: 'POST',
      url: '/v1/acompanhamentos',
      headers: { cookie: bruno },
      payload: { numero: PROCESSO_B },
    });

    const carimbo = async (cookie: string): Promise<string | null> => {
      const r = await servidor.inject({
        method: 'GET',
        url: '/v1/acompanhamentos',
        headers: { cookie },
      });
      return r.json().acompanhamentos[0].sincronizadoEm;
    };
    const antesAna = await carimbo(ana);
    const antesBruno = await carimbo(bruno);
    await new Promise((pronto) => setTimeout(pronto, 5));

    // Ana clica em "verificar agora". A rota responde 202 e segue em segundo
    // plano, então esperamos o suficiente para a varredura de UM processo.
    const disparo = await servidor.inject({
      method: 'POST',
      url: '/v1/sincronizar',
      headers: { cookie: ana },
    });
    expect(disparo.statusCode).toBe(202);
    await new Promise((pronto) => setTimeout(pronto, 80));

    // O de Ana foi consultado de novo; o de Bruno não foi tocado. Antes, o
    // clique dela consultava o tribunal sobre o processo dele e gravava nos
    // dados dele.
    expect(await carimbo(ana)).not.toBe(antesAna);
    expect(await carimbo(bruno)).toBe(antesBruno);
  });

  it('a varredura agendada continua vendo todo mundo', async () => {
    // O contrário também precisa valer: se o escopo vazasse para o agendador,
    // a vigilância pararia de funcionar para todos menos um, em silêncio.
    const ana = await conta('ana@a.com.br');
    const bruno = await conta('bruno@b.com.br');
    await servidor.inject({
      method: 'POST',
      url: '/v1/acompanhamentos',
      headers: { cookie: ana },
      payload: { numero: PROCESSO_A },
    });
    await servidor.inject({
      method: 'POST',
      url: '/v1/acompanhamentos',
      headers: { cookie: bruno },
      payload: { numero: PROCESSO_B },
    });

    const r = await app.acompanhamento.sincronizar();
    expect(r.verificados).toBe(2);
  });

  it('a rota exige autenticação antes de disparar qualquer coisa', async () => {
    const r = await servidor.inject({ method: 'POST', url: '/v1/sincronizar' });
    expect(r.statusCode).toBe(401);
  });
});

describe('Robustez das rotas de dados', () => {
  let servidor: FastifyInstance;

  beforeEach(() => {
    ({ servidor } = montar());
  });
  afterEach(async () => {
    await servidor.close();
  });

  it('parâmetro de dias inválido não vira erro 500', async () => {
    // `Number('x')` era NaN, virava `new Date(NaN).toISOString()` e estourava
    // RangeError — 500 e alarme de produção por query digitada errada.
    const r = await servidor.inject({
      method: 'GET',
      url: '/v1/acompanhamentos?ultimosDias=xis',
      headers: { 'x-api-key': CHAVE },
    });

    expect(r.statusCode).toBe(200);
  });

  it('dias negativo ou absurdo é ignorado em vez de quebrar', async () => {
    for (const valor of ['-5', '0', '999999']) {
      const r = await servidor.inject({
        method: 'GET',
        url: `/v1/acompanhamentos?ultimosDias=${valor}`,
        headers: { 'x-api-key': CHAVE },
      });
      expect(r.statusCode).toBe(200);
    }
  });
});

describe('Modo de rede interna (LEXFLOW_AUTH_DISABLED)', () => {
  let servidor: FastifyInstance;

  beforeEach(() => {
    ({ servidor } = montar(true));
  });
  afterEach(async () => {
    await servidor.close();
  });

  it('as rotas de dados funcionam, em vez de falhar sem ambiente', async () => {
    // Antes, sem chave nem sessão, `workspaceDe` estourava `Error` cru: 500 em
    // toda rota de dados. O modo estava documentado e simplesmente quebrado.
    const r = await servidor.inject({ method: 'GET', url: '/v1/acompanhamentos' });
    expect(r.statusCode).toBe(200);
  });

  it('todas as requisições caem no MESMO ambiente', async () => {
    // Inventar um ambiente por requisição faria cada chamada ver uma carteira
    // vazia diferente — pior do que não funcionar, porque parece funcionar.
    await servidor.inject({
      method: 'POST',
      url: '/v1/acompanhamentos',
      payload: { numero: PROCESSO_A },
    });
    const r = await servidor.inject({ method: 'GET', url: '/v1/acompanhamentos' });

    expect(r.json().total).toBe(1);
  });
});
