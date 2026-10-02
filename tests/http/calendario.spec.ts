import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Movimentacao } from '../../src/domain/entities/Movimentacao.js';
import { carregarConfig } from '../../src/infrastructure/config/env.js';
import type { Aplicacao } from '../../src/main/factories/makeProcessoSearchService.js';
import { workspaceDaChave } from '../../src/main/http/chaves.js';
import { LIMITE_FEED_POR_MINUTO } from '../../src/main/http/rotas/calendario.js';
import { construirServidor } from '../../src/main/http/servidor.js';
import { aplicacaoDeTeste } from '../helpers/aplicacao.js';
import {
  NUMERO_TJSP_A,
  NUMERO_TJSP_B,
  ProviderFalso,
  umProcesso,
} from '../helpers/fabricas.js';

/* Textos, nomes e números sintéticos; relógio fixo e controlado pelo teste. */

const CHAVE_A = 'chave-da-advogada-a-1234567890';
const CHAVE_B = 'chave-do-advogado-b-1234567890';
const A = { 'x-api-key': CHAVE_A };
const B = { 'x-api-key': CHAVE_B };
const WS_A = workspaceDaChave(CHAVE_A);
const URL_BASE = 'https://processovivo.exemplo.invalid';

const DESIGNACAO: Movimentacao = {
  data: new Date('2026-09-20T13:00:00.000Z'),
  titulo: 'Intimação',
  conteudo:
    'Designo audiência de conciliação entre FULANA SINTÉTICA e a ré para 12/11/2026, às 14:30.',
};

let agora: Date;
let servidor: FastifyInstance;
let app: Aplicacao;

beforeEach(async () => {
  agora = new Date('2026-10-02T15:00:00.000Z');
  app = aplicacaoDeTeste(
    [
      new ProviderFalso({
        nome: 'falso',
        porNumero: async () => umProcesso({ movimentacoes: [DESIGNACAO] }),
      }),
    ],
    { agora: () => agora },
  );
  servidor = construirServidor(
    app,
    carregarConfig({
      PROCESSOVIVO_PROVIDER_CHAIN: 'mock-crawler-tjsp',
      LOG_LEVEL: 'silent',
      CACHE_ENABLED: 'false',
      PROCESSOVIVO_API_KEYS: `${CHAVE_A},${CHAVE_B}`,
      PROCESSOVIVO_URL_BASE: URL_BASE,
      RATE_LIMIT_MAX: '1000',
    } as NodeJS.ProcessEnv),
  );
  // A carteira da advogada A: a sincronização já sugere a audiência.
  await app.acompanhamento.acompanhar(WS_A, NUMERO_TJSP_A);
});
afterEach(async () => {
  await servidor.close();
});

const DE_ATE = 'de=2026-10-01&ate=2026-12-31';

async function eventos(h = A, extra = ''): Promise<LightMyRequestResponse> {
  return servidor.inject({
    method: 'GET',
    url: `/v1/calendario/eventos?${DE_ATE}${extra}`,
    headers: h,
  });
}

async function primeiroId(): Promise<string> {
  return String((await eventos()).json().eventos[0].id);
}

async function criarFeed(
  incluiSugeridos = false,
): Promise<{ url: string; caminho: string }> {
  const r = await servidor.inject({
    method: 'POST',
    url: '/v1/calendario/feed',
    headers: A,
    payload: { incluiSugeridos },
  });
  expect(r.statusCode).toBe(201);
  const url = String(r.json().url);
  return { url, caminho: url.slice(URL_BASE.length) };
}

describe('API — agenda', () => {
  it('exige autenticação', async () => {
    const r = await servidor.inject({
      method: 'GET',
      url: `/v1/calendario/eventos?${DE_ATE}`,
    });
    expect(r.statusCode).toBe(401);
  });

  it('lista a sugestão detectada, com procedência e sem nome de parte no trecho', async () => {
    const r = await eventos();
    expect(r.statusCode).toBe(200);
    const corpo = r.json();
    expect(corpo.total).toBe(1);
    expect(corpo.totalNoIntervalo).toBe(1);
    const [e] = corpo.eventos;
    expect(e).toMatchObject({
      tipo: 'audiencia',
      origem: 'detectado',
      estado: 'sugerido',
      dataLocal: '2026-11-12',
      horaLocal: '14:30',
      numeroFormatado: NUMERO_TJSP_A,
      revisar: false,
    });
    expect(e.procedencia.dataDoAndamento).toBe('2026-09-20T13:00:00.000Z');
    expect(e.procedencia.trecho).toContain('12/11/2026');
  });

  it('filtro de estado devolve o total sem filtro junto', async () => {
    const r = await eventos(A, '&estado=confirmado');
    expect(r.json()).toMatchObject({ total: 0, totalNoIntervalo: 1 });
  });

  it.each([
    ['data mal formada', 'de=12/11/2026&ate=2026-12-31'],
    ['data que não existe', 'de=2026-02-30&ate=2026-12-31'],
    ['"ate" antes de "de"', 'de=2026-12-31&ate=2026-01-01'],
    ['intervalo acima de 400 dias', 'de=2026-01-01&ate=2027-02-06'],
    ['estado desconhecido', `${DE_ATE}&estado=apagado`],
  ])('400 com %s', async (_nome, q) => {
    const r = await servidor.inject({
      method: 'GET',
      url: `/v1/calendario/eventos?${q}`,
      headers: A,
    });
    expect(r.statusCode).toBe(400);
  });

  it('aceita exatamente 400 dias', async () => {
    const r = await servidor.inject({
      method: 'GET',
      url: '/v1/calendario/eventos?de=2026-01-01&ate=2027-02-05',
      headers: A,
    });
    expect(r.statusCode).toBe(200);
  });

  it('cria evento manual já confirmado', async () => {
    const r = await servidor.inject({
      method: 'POST',
      url: '/v1/calendario/eventos',
      headers: A,
      payload: {
        numeroProcesso: NUMERO_TJSP_A,
        tipo: 'reuniao',
        titulo: 'Reunião de alinhamento',
        dataLocal: '2026-10-20',
        horaLocal: '09:00',
        duracaoMin: 30,
        observacao: 'levar os documentos',
      },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({
      origem: 'manual',
      estado: 'confirmado',
      tribunal: 'TJSP',
    });
  });

  it('recusa evento manual em processo fora da carteira, e corpo fora do contrato', async () => {
    const fora = await servidor.inject({
      method: 'POST',
      url: '/v1/calendario/eventos',
      headers: A,
      payload: {
        numeroProcesso: NUMERO_TJSP_B,
        tipo: 'reuniao',
        titulo: 'x',
        dataLocal: '2026-10-20',
      },
    });
    expect(fora.statusCode).toBe(400);
    const tipo = await servidor.inject({
      method: 'POST',
      url: '/v1/calendario/eventos',
      headers: A,
      payload: {
        numeroProcesso: NUMERO_TJSP_A,
        tipo: 'festa',
        titulo: 'x',
        dataLocal: '2026-10-20',
      },
    });
    expect(tipo.statusCode).toBe(400);
  });

  it('confirma, edita e descarta; descartado não volta a ser editado (409)', async () => {
    const id = await primeiroId();
    const conf = await servidor.inject({
      method: 'PATCH',
      url: `/v1/calendario/eventos/${id}`,
      headers: A,
      payload: { estado: 'confirmado', horaLocal: '15:00' },
    });
    expect(conf.json()).toMatchObject({
      estado: 'confirmado',
      horaLocal: '15:00',
      sequencia: 2,
    });

    const desc = await servidor.inject({
      method: 'POST',
      url: `/v1/calendario/eventos/${id}/descartar`,
      headers: A,
    });
    expect(desc.json()).toMatchObject({ estado: 'descartado' });

    const depois = await servidor.inject({
      method: 'PATCH',
      url: `/v1/calendario/eventos/${id}`,
      headers: A,
      payload: { titulo: 'de novo' },
    });
    expect(depois.statusCode).toBe(409);
  });

  it('PATCH com campo fora do contrato é 400', async () => {
    const id = await primeiroId();
    const r = await servidor.inject({
      method: 'PATCH',
      url: `/v1/calendario/eventos/${id}`,
      headers: A,
      payload: { estado: 'descartado' },
    });
    expect(r.statusCode).toBe(400);
  });

  describe('isolamento A × B', () => {
    it('B não vê, não edita e não descarta evento de A (404 igual a inexistente)', async () => {
      const id = await primeiroId();
      expect((await eventos(B)).json()).toMatchObject({ total: 0, totalNoIntervalo: 0 });

      const editar = await servidor.inject({
        method: 'PATCH',
        url: `/v1/calendario/eventos/${id}`,
        headers: B,
        payload: { estado: 'confirmado' },
      });
      const inexistente = await servidor.inject({
        method: 'PATCH',
        url: '/v1/calendario/eventos/nao-existe',
        headers: B,
        payload: { estado: 'confirmado' },
      });
      expect(editar.statusCode).toBe(404);
      expect(editar.json()).toEqual(inexistente.json());

      const descartar = await servidor.inject({
        method: 'POST',
        url: `/v1/calendario/eventos/${id}/descartar`,
        headers: B,
      });
      expect(descartar.statusCode).toBe(404);
      expect((await eventos()).json().eventos[0].estado).toBe('sugerido');
    });

    it('B não cria evento em processo que só A acompanha', async () => {
      const r = await servidor.inject({
        method: 'POST',
        url: '/v1/calendario/eventos',
        headers: B,
        payload: {
          numeroProcesso: NUMERO_TJSP_A,
          tipo: 'reuniao',
          titulo: 'x',
          dataLocal: '2026-10-20',
        },
      });
      expect(r.statusCode).toBe(400);
    });

    it('o feed de B não traz evento de A', async () => {
      const id = await primeiroId();
      await servidor.inject({
        method: 'PATCH',
        url: `/v1/calendario/eventos/${id}`,
        headers: A,
        payload: { estado: 'confirmado' },
      });
      const r = await servidor.inject({
        method: 'POST',
        url: '/v1/calendario/feed',
        headers: B,
        payload: {},
      });
      const caminho = String(r.json().url).slice(URL_BASE.length);
      const ics = await servidor.inject({ method: 'GET', url: caminho });
      expect(ics.statusCode).toBe(200);
      expect(ics.body).not.toContain('BEGIN:VEVENT');
    });
  });
});

describe('API — feed', () => {
  it('a URL completa sai uma vez; o GET nunca a devolve', async () => {
    const { url } = await criarFeed();
    expect(url).toMatch(
      /^https:\/\/processovivo\.exemplo\.invalid\/calendario\/feed\/[A-Za-z0-9_-]{43}\.ics$/,
    );
    const estado = await servidor.inject({
      method: 'GET',
      url: '/v1/calendario/feed',
      headers: A,
    });
    expect(estado.json()).toMatchObject({ existe: true, incluiSugeridos: false });
    const token = url.split('/').pop()?.replace('.ics', '') ?? '';
    expect(estado.body).not.toContain(token);
    expect(estado.body).not.toContain('url');
  });

  it('serve o ICS público sem autenticação, sem cookie, com cache privado', async () => {
    const id = await primeiroId();
    await servidor.inject({
      method: 'PATCH',
      url: `/v1/calendario/eventos/${id}`,
      headers: A,
      payload: { estado: 'confirmado' },
    });
    const { caminho } = await criarFeed();
    const r = await servidor.inject({ method: 'GET', url: caminho });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('text/calendar; charset=utf-8');
    expect(r.headers['cache-control']).toBe('private, max-age=300');
    expect(r.headers['set-cookie']).toBeUndefined();
    expect(r.body).toContain('BEGIN:VCALENDAR');
    expect(r.body).toContain('DTSTART;TZID=America/Sao_Paulo:20261112T143000');
    expect(r.body).not.toContain('FULANA');
    expect(r.body).not.toContain(WS_A);
  });

  it('sugerido só entra com "incluir sugeridos"', async () => {
    const sem = await criarFeed(false);
    expect(
      (await servidor.inject({ method: 'GET', url: sem.caminho })).body,
    ).not.toContain('BEGIN:VEVENT');
    const com = await criarFeed(true);
    expect((await servidor.inject({ method: 'GET', url: com.caminho })).body).toContain(
      'SUMMARY:[sugerido] Audiência',
    );
  });

  it('alterar "incluir sugeridos" não troca o token: a mesma URL passa a trazer a sugestão', async () => {
    const { caminho } = await criarFeed(false);
    expect((await servidor.inject({ method: 'GET', url: caminho })).body).not.toContain(
      'BEGIN:VEVENT',
    );

    const r = await servidor.inject({
      method: 'PATCH',
      url: '/v1/calendario/feed',
      headers: A,
      payload: { incluiSugeridos: true },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ existe: true, incluiSugeridos: true });
    expect(r.body).not.toContain('url');

    const depois = await servidor.inject({ method: 'GET', url: caminho });
    expect(depois.statusCode).toBe(200);
    expect(depois.body).toContain('SUMMARY:[sugerido] Audiência');
  });

  it('alterar o feed sem feed: 404 explicado; corpo fora do contrato: 400', async () => {
    const sem = await servidor.inject({
      method: 'PATCH',
      url: '/v1/calendario/feed',
      headers: B,
      payload: { incluiSugeridos: true },
    });
    expect(sem.statusCode).toBe(404);
    expect(sem.json().erro).toBe('FEED_DO_CALENDARIO_AUSENTE');

    await criarFeed();
    const ruim = await servidor.inject({
      method: 'PATCH',
      url: '/v1/calendario/feed',
      headers: A,
      payload: { incluiSugeridos: 'sim' },
    });
    expect(ruim.statusCode).toBe(400);
  });

  it('B não altera o feed de A', async () => {
    await criarFeed(false);
    await servidor.inject({
      method: 'PATCH',
      url: '/v1/calendario/feed',
      headers: B,
      payload: { incluiSugeridos: true },
    });
    const a = await servidor.inject({
      method: 'GET',
      url: '/v1/calendario/feed',
      headers: A,
    });
    expect(a.json()).toMatchObject({ incluiSugeridos: false });
  });

  it('regenerar mata o token antigo; revogar mata o atual', async () => {
    const antigo = await criarFeed();
    const novo = await criarFeed();
    expect(
      (await servidor.inject({ method: 'GET', url: antigo.caminho })).statusCode,
    ).toBe(404);
    expect((await servidor.inject({ method: 'GET', url: novo.caminho })).statusCode).toBe(
      200,
    );

    const del = await servidor.inject({
      method: 'DELETE',
      url: '/v1/calendario/feed',
      headers: A,
    });
    expect(del.json()).toEqual({ revogado: true });
    expect((await servidor.inject({ method: 'GET', url: novo.caminho })).statusCode).toBe(
      404,
    );
    expect(
      (
        await servidor.inject({ method: 'GET', url: '/v1/calendario/feed', headers: A })
      ).json(),
    ).toEqual({ existe: false });
  });

  it('404 IDÊNTICO para inválido, revogado, plano sem o recurso e assinatura bloqueada', async () => {
    const respostas: LightMyRequestResponse[] = [];

    respostas.push(
      await servidor.inject({
        method: 'GET',
        url: `/calendario/feed/${'x'.repeat(43)}.ics`,
      }),
    );
    respostas.push(
      await servidor.inject({ method: 'GET', url: '/calendario/feed/curto.ics' }),
    );
    respostas.push(
      await servidor.inject({ method: 'GET', url: '/calendario/feed/sem-extensao' }),
    );

    const revogado = await criarFeed();
    await servidor.inject({ method: 'DELETE', url: '/v1/calendario/feed', headers: A });
    respostas.push(await servidor.inject({ method: 'GET', url: revogado.caminho }));

    // Plano sem o recurso: o operador tirou o calendário do plano dela.
    await app.assinaturas.liberar({ workspace: WS_A, plano: 'acompanhamento', meses: 1 });
    const vivo = await criarFeed();
    expect((await servidor.inject({ method: 'GET', url: vivo.caminho })).statusCode).toBe(
      200,
    );
    await app.planos.atualizar('acompanhamento', {
      recursos: ['consulta', 'acompanhamento', 'vigilancia'],
    });
    respostas.push(await servidor.inject({ method: 'GET', url: vivo.caminho }));

    // Assinatura vencida além da carência, com o recurso de volta no plano.
    await app.planos.atualizar('acompanhamento', {
      recursos: ['consulta', 'acompanhamento', 'vigilancia', 'calendario'],
    });
    agora = new Date('2027-06-01T15:00:00.000Z');
    respostas.push(await servidor.inject({ method: 'GET', url: vivo.caminho }));

    const [primeira] = respostas;
    for (const r of respostas) {
      expect(r.statusCode).toBe(404);
      expect(r.body).toBe(primeira?.body);
      expect(r.headers['content-type']).toBe(primeira?.headers['content-type']);
      expect(r.headers['set-cookie']).toBeUndefined();
    }
    expect(primeira?.json()).toEqual({
      erro: 'NAO_ENCONTRADO',
      mensagem: 'Não encontrado.',
    });
  });

  it('o token não vai para o log de acesso nem para o de erro', async () => {
    const linhas: string[] = [];
    const espiao = {
      debug: (m: string, c?: unknown) => linhas.push(m + JSON.stringify(c ?? {})),
      info: (m: string, c?: unknown) => linhas.push(m + JSON.stringify(c ?? {})),
      warn: (m: string, c?: unknown) => linhas.push(m + JSON.stringify(c ?? {})),
      error: (m: string, c?: unknown) => linhas.push(m + JSON.stringify(c ?? {})),
      child: () => espiao,
    };
    const comLog = construirServidor(
      { ...app, logger: espiao },
      carregarConfig({
        PROCESSOVIVO_PROVIDER_CHAIN: 'mock-crawler-tjsp',
        LOG_LEVEL: 'silent',
        CACHE_ENABLED: 'false',
        PROCESSOVIVO_API_KEYS: `${CHAVE_A},${CHAVE_B}`,
        PROCESSOVIVO_URL_BASE: URL_BASE,
      } as NodeJS.ProcessEnv),
    );
    const r = await comLog.inject({
      method: 'POST',
      url: '/v1/calendario/feed',
      headers: A,
      payload: {},
    });
    const caminho = String(r.json().url).slice(URL_BASE.length);
    const token = caminho.split('/').pop()?.replace('.ics', '') ?? '';
    await comLog.inject({ method: 'GET', url: caminho });
    await comLog.inject({ method: 'DELETE', url: '/v1/calendario/feed', headers: A });
    await comLog.inject({ method: 'GET', url: caminho });
    await comLog.close();

    const tudo = linhas.join('\n');
    expect(tudo).toContain('/calendario/feed/:arquivo');
    expect(tudo).not.toContain(token);
  });

  it('limitador de taxa por IP no feed público', async () => {
    let ultima: LightMyRequestResponse | undefined;
    for (let i = 0; i <= LIMITE_FEED_POR_MINUTO; i++) {
      ultima = await servidor.inject({
        method: 'GET',
        url: `/calendario/feed/${'y'.repeat(43)}.ics`,
        remoteAddress: '203.0.113.7',
      });
    }
    expect(ultima?.statusCode).toBe(429);
    // Outro IP continua sendo atendido.
    const outro = await servidor.inject({
      method: 'GET',
      url: `/calendario/feed/${'y'.repeat(43)}.ics`,
      remoteAddress: '203.0.113.8',
    });
    expect(outro.statusCode).toBe(404);
  });
});

describe('API — plano', () => {
  it('plano sem o recurso: 403 nas rotas da tela', async () => {
    await app.assinaturas.liberar({ workspace: WS_A, plano: 'acompanhamento', meses: 1 });
    expect((await eventos()).statusCode).toBe(200);
    await app.planos.atualizar('acompanhamento', {
      recursos: ['consulta', 'acompanhamento', 'vigilancia'],
    });
    const r = await eventos();
    expect(r.statusCode).toBe(403);
    expect(r.json().erro).toBe('RECURSO_NAO_INCLUIDO_NO_PLANO');
    const feed = await servidor.inject({
      method: 'POST',
      url: '/v1/calendario/feed',
      headers: A,
      payload: {},
    });
    expect(feed.statusCode).toBe(403);
  });

  it('assinatura vencida além da carência: 402', async () => {
    await app.assinaturas.liberar({ workspace: WS_A, plano: 'acompanhamento', meses: 1 });
    agora = new Date('2027-06-01T15:00:00.000Z');
    const r = await eventos();
    expect(r.statusCode).toBe(402);
    expect(r.json().erro).toBe('ASSINATURA_INATIVA');
  });

  it('workspace sem assinatura (chave de API) passa livre', async () => {
    expect((await eventos(B)).statusCode).toBe(200);
  });
});
