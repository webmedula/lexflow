import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { carregarConfig } from '../../src/infrastructure/config/env.js';
import type { Config } from '../../src/infrastructure/config/env.js';
import { construirServidor } from '../../src/main/http/servidor.js';
import { aplicacaoDeTeste } from '../helpers/aplicacao.js';
import type { OpcoesAplicacaoDeTeste } from '../helpers/aplicacao.js';
import { ProviderFalso } from '../helpers/fabricas.js';
import type { Aplicacao } from '../../src/main/factories/makeProcessoSearchService.js';

const CHAVE = 'chave-de-teste-1234567890';
const SENHA_CONTA = 'uma-senha-boa-o-bastante';
const ADMIN_USUARIO = 'joao';
const ADMIN_SENHA = 'uma-senha-administrativa-bem-forte';

function config(): Config {
  return carregarConfig({
    PROCESSOVIVO_PROVIDER_CHAIN: 'mock-crawler-tjsp',
    LOG_LEVEL: 'silent',
    PROCESSOVIVO_API_KEYS: CHAVE,
    CACHE_ENABLED: 'false',
    COOKIE_SECURE: 'false',
  } as NodeJS.ProcessEnv);
}

function montar(opcoes: OpcoesAplicacaoDeTeste = {}): {
  servidor: FastifyInstance;
  app: Aplicacao;
} {
  const app = aplicacaoDeTeste([new ProviderFalso({ nome: 'falso' })], opcoes);
  return { servidor: construirServidor(app, config()), app };
}

/** `Authorization: Basic ...` pronto para o `inject`. */
function basic(usuario: string, senha: string): string {
  return 'Basic ' + Buffer.from(`${usuario}:${senha}`).toString('base64');
}

describe('Área administrativa — desligada (sem credencial configurada)', () => {
  let servidor: FastifyInstance;

  beforeEach(() => {
    servidor = montar().servidor;
  });
  afterEach(async () => {
    await servidor.close();
  });

  it('responde 501 com instrução, em vez de 404 ou de pedir credencial', async () => {
    const r = await servidor.inject({ method: 'GET', url: '/admin' });
    expect(r.statusCode).toBe(501);
    expect(r.json().mensagem).toMatch(/PROCESSOVIVO_ADMIN_USUARIO/);
  });

  it('as rotas de API também respondem 501', async () => {
    const r = await servidor.inject({ method: 'GET', url: '/admin/api/assinaturas' });
    expect(r.statusCode).toBe(501);
  });
});

describe('Área administrativa — autenticação', () => {
  let servidor: FastifyInstance;

  beforeEach(() => {
    servidor = montar({ admin: { usuario: ADMIN_USUARIO, senha: ADMIN_SENHA } }).servidor;
  });
  afterEach(async () => {
    await servidor.close();
  });

  it('recusa sem nenhuma credencial', async () => {
    const r = await servidor.inject({ method: 'GET', url: '/admin' });
    expect(r.statusCode).toBe(401);
    expect(r.headers['www-authenticate']).toMatch(/Basic/);
  });

  it('recusa Basic Auth com senha errada', async () => {
    const r = await servidor.inject({
      method: 'GET',
      url: '/admin',
      headers: { authorization: basic(ADMIN_USUARIO, 'senha-errada-qualquer') },
    });
    expect(r.statusCode).toBe(401);
  });

  it('recusa uma chave de API de assinante — não é a credencial desta área', async () => {
    const r = await servidor.inject({
      method: 'GET',
      url: '/admin/api/assinaturas',
      headers: { 'x-api-key': CHAVE },
    });
    expect(r.statusCode).toBe(401);
  });

  it('aceita a credencial administrativa certa e serve a página HTML', async () => {
    const r = await servidor.inject({
      method: 'GET',
      url: '/admin',
      headers: { authorization: basic(ADMIN_USUARIO, ADMIN_SENHA) },
    });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('text/html');
  });
});

describe('Área administrativa — assinaturas', () => {
  let servidor: FastifyInstance;

  beforeEach(() => {
    servidor = montar({
      admin: { usuario: ADMIN_USUARIO, senha: ADMIN_SENHA },
      comAssinaturas: true,
    }).servidor;
  });
  afterEach(async () => {
    await servidor.close();
  });

  const auth = { authorization: basic(ADMIN_USUARIO, ADMIN_SENHA) };

  async function cadastrar(email: string): Promise<void> {
    const r = await servidor.inject({
      method: 'POST',
      url: '/v1/contas',
      payload: { nome: 'Maria Silva', email, senha: SENHA_CONTA },
    });
    expect(r.statusCode).toBe(201);
  }

  it('lista as assinaturas, com o e-mail de cada conta', async () => {
    await cadastrar('maria@escritorio.com.br');

    const r = await servidor.inject({
      method: 'GET',
      url: '/admin/api/assinaturas',
      headers: auth,
    });

    expect(r.statusCode).toBe(200);
    const corpo = r.json();
    expect(corpo.total).toBe(1);
    expect(corpo.assinaturas[0].email).toBe('maria@escritorio.com.br');
    // Conta nova nasce em teste — ver `assinaturaDeTeste`.
    expect(corpo.assinaturas[0].ehTeste).toBe(true);
  });

  it('devolve 404 ao consultar um e-mail que não tem conta', async () => {
    const r = await servidor.inject({
      method: 'GET',
      url: '/admin/api/assinaturas/ninguem@nada.com.br',
      headers: auth,
    });
    expect(r.statusCode).toBe(404);
    expect(r.json().erro).toBe('CONTA_NAO_ENCONTRADA');
  });

  it('libera um plano por e-mail e o efeito aparece na consulta do assinante', async () => {
    await cadastrar('ana@escritorio.com.br');

    const liberar = await servidor.inject({
      method: 'POST',
      url: '/admin/api/assinaturas/ana@escritorio.com.br/liberar',
      headers: auth,
      payload: { plano: 'ia', meses: 12, observacao: 'Pix 22/09' },
    });
    expect(liberar.statusCode).toBe(201);
    expect(liberar.json().nomeDoPlano).toBe('IA');

    const consulta = await servidor.inject({
      method: 'GET',
      url: '/admin/api/assinaturas/ana@escritorio.com.br',
      headers: auth,
    });
    expect(consulta.json().assinatura.plano).toBe('ia');
    expect(consulta.json().assinatura.ehTeste).toBe(false);
  });

  it('recusa liberar um plano que não existe', async () => {
    await cadastrar('bia@escritorio.com.br');

    const r = await servidor.inject({
      method: 'POST',
      url: '/admin/api/assinaturas/bia@escritorio.com.br/liberar',
      headers: auth,
      payload: { plano: 'platina', meses: 12 },
    });
    expect(r.statusCode).toBe(400);
  });

  it('cancela uma assinatura', async () => {
    await cadastrar('carla@escritorio.com.br');

    const r = await servidor.inject({
      method: 'POST',
      url: '/admin/api/assinaturas/carla@escritorio.com.br/cancelar',
      headers: auth,
      payload: {},
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe('cancelada');
  });

  it('dispara os avisos de vencimento sob demanda', async () => {
    const r = await servidor.inject({
      method: 'POST',
      url: '/admin/api/assinaturas/avisar',
      headers: auth,
    });
    expect(r.statusCode).toBe(200);
    expect(typeof r.json().avisados).toBe('number');
  });
});

describe('Área administrativa — chaves de API', () => {
  let servidor: FastifyInstance;

  beforeEach(() => {
    servidor = montar({ admin: { usuario: ADMIN_USUARIO, senha: ADMIN_SENHA } }).servidor;
  });
  afterEach(async () => {
    await servidor.close();
  });

  const auth = { authorization: basic(ADMIN_USUARIO, ADMIN_SENHA) };

  it('começa vazia', async () => {
    const r = await servidor.inject({
      method: 'GET',
      url: '/admin/api/chaves',
      headers: auth,
    });
    expect(r.json()).toEqual({ total: 0, chaves: [] });
  });

  it('emite uma chave, mostra o valor uma vez, e não repete depois', async () => {
    const emitir = await servidor.inject({
      method: 'POST',
      url: '/admin/api/chaves',
      headers: auth,
      payload: { rotulo: 'n8n' },
    });
    expect(emitir.statusCode).toBe(201);
    const corpo = emitir.json();
    expect(typeof corpo.chave).toBe('string');
    expect(corpo.chave.length).toBeGreaterThanOrEqual(32);
    expect(corpo.rotulo).toBe('n8n');

    const listar = await servidor.inject({
      method: 'GET',
      url: '/admin/api/chaves',
      headers: auth,
    });
    const listada = listar.json().chaves[0];
    expect(listada.identificador).toBe(corpo.identificador);
    expect(listada).not.toHaveProperty('chave');
  });

  it('uma chave emitida aqui autentica de verdade numa rota protegida', async () => {
    const emitir = await servidor.inject({
      method: 'POST',
      url: '/admin/api/chaves',
      headers: auth,
      payload: { rotulo: 'integração' },
    });
    const { chave } = emitir.json();

    const chamada = await servidor.inject({
      method: 'GET',
      url: '/v1/assinatura',
      headers: { 'x-api-key': chave },
    });

    expect(chamada.statusCode).toBe(200);
  });

  it('revogar a chave derruba a autenticação dela imediatamente', async () => {
    const emitir = await servidor.inject({
      method: 'POST',
      url: '/admin/api/chaves',
      headers: auth,
      payload: { rotulo: 'temporária' },
    });
    const { chave, identificador } = emitir.json();

    const revogar = await servidor.inject({
      method: 'POST',
      url: `/admin/api/chaves/${identificador}/revogar`,
      headers: auth,
    });
    expect(revogar.statusCode).toBe(200);
    expect(revogar.json()).toEqual({ revogada: true });

    const chamada = await servidor.inject({
      method: 'GET',
      url: '/v1/assinatura',
      headers: { 'x-api-key': chave },
    });
    expect(chamada.statusCode).toBe(401);
  });

  it('revogar um identificador desconhecido devolve 404', async () => {
    const r = await servidor.inject({
      method: 'POST',
      url: '/admin/api/chaves/deadbeef/revogar',
      headers: auth,
    });
    expect(r.statusCode).toBe(404);
    expect(r.json().erro).toBe('CHAVE_API_NAO_ENCONTRADA');
  });

  it('recusa emitir chave sem rótulo', async () => {
    const r = await servidor.inject({
      method: 'POST',
      url: '/admin/api/chaves',
      headers: auth,
      payload: {},
    });
    expect(r.statusCode).toBe(400);
  });
});
