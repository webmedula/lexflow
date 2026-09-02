import { timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { identificarChave } from '../chaves.js';

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Hash curto da chave usada — vai para log e rate limit.
     * A chave em si NUNCA sai do processo.
     */
    identidadeDaChave?: string;
  }
}

export interface OpcoesAutenticacao {
  readonly chaves: readonly string[];
  readonly desativada: boolean;
  /** Rotas que dispensam autenticação (health checks do Easypanel/Docker). */
  readonly rotasPublicas: readonly string[];
}

/**
 * Autenticação por chave de API no header `x-api-key`.
 *
 * Por que existe: a API Pública do DataJud é autenticada por uma Chave Pública
 * COMPARTILHADA do CNJ. Um endpoint aberto na internet transforma o seu VPS em
 * proxy gratuito para a cota de todo mundo — e quem leva o bloqueio do CNJ é a
 * chave, não o abusador.
 *
 * A comparação é `timingSafeEqual` em vez de `===`. Contra um atacante remoto a
 * diferença de tempo do `===` é difícil de explorar, mas o custo de fazer certo
 * aqui é uma linha, e a rota é o ponto de entrada do sistema inteiro.
 */
const autenticacaoPlugin: FastifyPluginAsync<OpcoesAutenticacao> = async (
  app,
  opcoes,
) => {
  const publicas = new Set(opcoes.rotasPublicas);

  app.addHook('onRequest', async (requisicao, resposta) => {
    if (publicas.has(requisicao.routeOptions.url ?? requisicao.url)) return;
    if (opcoes.desativada) return;

    const informada = extrairChave(requisicao);
    if (!informada) {
      return resposta.code(401).send({
        erro: 'NAO_AUTENTICADO',
        mensagem: 'Header x-api-key ausente.',
      });
    }

    const aceita = opcoes.chaves.find((chave) => comparaSegura(chave, informada));
    if (!aceita) {
      requisicao.log.warn(
        { ip: requisicao.ip, rota: requisicao.url },
        'chave de API rejeitada',
      );
      return resposta.code(401).send({
        erro: 'NAO_AUTENTICADO',
        mensagem: 'Chave de API inválida.',
      });
    }

    requisicao.identidadeDaChave = identificarChave(aceita);
  });
};

function extrairChave(requisicao: FastifyRequest): string | null {
  const header = requisicao.headers['x-api-key'];
  if (typeof header === 'string' && header.length > 0) return header;

  // Também aceita `Authorization: Bearer <chave>`, que é o que a maioria dos
  // clientes HTTP e do n8n manda por padrão.
  const autorizacao = requisicao.headers.authorization;
  if (typeof autorizacao === 'string' && autorizacao.startsWith('Bearer ')) {
    return autorizacao.slice('Bearer '.length);
  }
  return null;
}

function comparaSegura(esperada: string, informada: string): boolean {
  const a = Buffer.from(esperada);
  const b = Buffer.from(informada);
  // timingSafeEqual exige mesmo comprimento; comparar antes já vaza o tamanho,
  // que não é segredo útil.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export default fp(autenticacaoPlugin, { name: 'autenticacao' });
