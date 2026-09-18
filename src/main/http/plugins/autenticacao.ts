import { timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { ServicoContas } from '../../../application/services/ServicoContas.js';
import type { Usuario } from '../../../domain/entities/Usuario.js';
import { tokenDoCabecalho } from '../../../infrastructure/seguranca/sessao.js';
import { identificarChave, workspaceDaChave } from '../chaves.js';

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Hash curto da chave usada — vai para log e rate limit.
     * A chave em si NUNCA sai do processo.
     */
    identidadeDaChave?: string;
    /** Espaço isolado do assinante. É o que separa a carteira de cada advogado. */
    workspace?: string;
    /** A pessoa, quando entrou por sessão. Ausente quando entrou por chave. */
    usuario?: Usuario;
    /** Token da sessão em curso — só para conseguir encerrá-la no logout. */
    tokenDeSessao?: string;
  }
}

/**
 * Ambiente usado quando a autenticação está desligada.
 *
 * Nome legível e fixo: aparece em log e em consulta ao banco, e um valor como
 * `local` diz na hora o que aconteceu — enquanto um hash aleatório faria
 * alguém procurar de quem é aquela carteira.
 */
export const WORKSPACE_SEM_AUTENTICACAO = 'local';

export interface OpcoesAutenticacao {
  readonly chaves: readonly string[];
  readonly desativada: boolean;
  /** Rotas que dispensam autenticação (health checks, console, entrar/cadastrar). */
  readonly rotasPublicas: readonly string[];
  /** Ausente quando o servidor subiu sem banco: só resta a chave de API. */
  readonly contas?: ServicoContas;
}

/**
 * Duas autenticações, um só `workspace`.
 *
 * Uma PESSOA entra por e-mail e senha, e carrega um cookie de sessão. Uma
 * INTEGRAÇÃO (n8n, script) entra por chave de API. As duas resolvem para o
 * mesmo `requisicao.workspace`, e **nenhuma rota de dados sabe qual delas
 * trouxe a requisição** — é isso que impede a autenticação de vazar para
 * dentro do domínio, e o que permitiu contas entrarem sem mexer em nenhuma
 * rota de processo, acompanhamento, vigilância ou peça.
 *
 * **A sessão tem precedência sobre a chave.** Com as duas presentes vence a
 * pessoa. O contrário seria pior de um jeito difícil de depurar: quem tivesse
 * usado a chave uma vez veria a carteira dela por baixo da própria conta,
 * conforme a aba do navegador.
 *
 * Por que a chave continua existindo agora que há contas: ela é o caminho das
 * integrações, que não têm navegador para guardar cookie. Cada uma continua
 * sendo seu próprio ambiente.
 */
const autenticacaoPlugin: FastifyPluginAsync<OpcoesAutenticacao> = async (
  app,
  opcoes,
) => {
  const publicas = new Set(opcoes.rotasPublicas);

  app.addHook('onRequest', async (requisicao, resposta) => {
    const rota = requisicao.routeOptions.url ?? requisicao.url;

    // A sessão é resolvida SEMPRE, inclusive em rota pública: `/v1/eu` e o
    // logout precisam saber quem é, e o console precisa descobrir se já há
    // sessão antes de decidir entre mostrar a tela de entrada e a carteira.
    const token = tokenDoCabecalho(requisicao.headers.cookie);
    if (token && opcoes.contas) {
      requisicao.tokenDeSessao = token;
      try {
        const usuario = await opcoes.contas.resolverSessao(token);
        requisicao.usuario = usuario;
        requisicao.workspace = usuario.workspace;
        // O rate limit por conta é o que sustenta o cadastro ABERTO: sem ele,
        // um cadastro abusivo gastaria a cota compartilhada do CNJ, que é
        // nacional, e o bloqueio cairia em cima de todos os assinantes.
        requisicao.identidadeDaChave = `u:${usuario.id}`;
      } catch {
        // Sessão expirada não é erro aqui: cai para chave de API, e se não
        // houver, a rota protegida responde 401 logo abaixo. Derrubar a
        // requisição neste ponto quebraria até a tela de login.
      }
    }

    if (publicas.has(rota)) return;
    if (requisicao.workspace) return;

    // Modo de rede interna (`PROCESSOVIVO_AUTH_DISABLED=true`): não há chave nem
    // sessão, mas as rotas de dados PRECISAM de um ambiente para filtrar. Sem
    // esta linha elas não tinham de quem eram os dados e respondiam erro — ou
    // seja, o modo documentado simplesmente não funcionava.
    //
    // Um ambiente fixo, e não um por requisição: sem autenticação não há como
    // distinguir quem chama, e inventar ambientes faria cada requisição ver
    // uma carteira vazia diferente.
    if (opcoes.desativada) {
      requisicao.workspace = WORKSPACE_SEM_AUTENTICACAO;
      return;
    }

    const informada = extrairChave(requisicao);
    if (!informada) {
      return resposta.code(401).send({
        erro: 'NAO_AUTENTICADO',
        mensagem: 'Entre com sua conta, ou informe a chave de API no header x-api-key.',
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
    requisicao.workspace = workspaceDaChave(aceita);
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
