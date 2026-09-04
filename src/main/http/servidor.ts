import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../../infrastructure/config/env.js';
import { VERSAO } from '../../infrastructure/config/versao.js';
import type { Aplicacao } from '../factories/makeProcessoSearchService.js';
import { validarChavesDeApi } from './chaves.js';
import { mapearErro } from './erros.js';
import autenticacao from './plugins/autenticacao.js';
import { ROTA_HEALTH, ROTA_READY, rotasDeSaude } from './rotas/saude.js';
import { rotasDeProcesso } from './rotas/processos.js';

/**
 * Monta o servidor HTTP sem subir porta nenhuma.
 *
 * Separar a MONTAGEM da ESCUTA é o que permite testar a API inteira com
 * `servidor.inject()` — sem porta, sem race de bind, sem espera. `iniciar()`,
 * abaixo, é a única função que chama `listen`.
 */
export function construirServidor(app: Aplicacao, config: Config): FastifyInstance {
  // Antes de qualquer coisa: configuração de autenticação inválida derruba a
  // montagem, não vira um serviço aberto por acidente.
  validarChavesDeApi(config.http.chavesDeApi, config.http.autenticacaoDesativada);

  const servidor = Fastify({
    // O log sai pelo nosso `Logger` (uma linha JSON por evento) para que
    // aplicação e HTTP tenham o mesmo formato nos logs do Easypanel.
    logger: false,
    bodyLimit: config.http.bodyLimitBytes,
    // Atrás do Traefik do Easypanel, sem isso todo request parece vir do IP do
    // proxy — e o rate limit por IP vira rate limit global.
    trustProxy: config.http.confiarNoProxy,
  });

  const log = app.logger.child({ camada: 'http' });

  if (config.http.corsOrigins.length > 0) {
    void servidor.register(cors, { origin: [...config.http.corsOrigins] });
  }

  void servidor.register(rateLimit, {
    max: config.http.rateLimitMax,
    timeWindow: config.http.rateLimitJanelaMs,
    // Limite por CHAVE quando autenticado, por IP quando não. Sem isso, um
    // cliente atrás de NAT compartilharia a cota com estranhos.
    keyGenerator: (requisicao) => requisicao.identidadeDaChave ?? requisicao.ip,
    // Health checks não gastam cota: eles rodam a cada poucos segundos.
    allowList: (requisicao) =>
      requisicao.url === ROTA_HEALTH || requisicao.url === ROTA_READY,
  });

  void servidor.register(autenticacao, {
    chaves: config.http.chavesDeApi,
    desativada: config.http.autenticacaoDesativada,
    rotasPublicas: [ROTA_HEALTH, ROTA_READY],
  });

  void servidor.register(rotasDeSaude(app));
  void servidor.register(rotasDeProcesso(app));

  servidor.setNotFoundHandler((requisicao, resposta) => {
    void resposta.code(404).send({
      erro: 'ROTA_NAO_ENCONTRADA',
      mensagem: `Nenhuma rota para ${requisicao.method} ${requisicao.url}.`,
    });
  });

  servidor.setErrorHandler((erro: unknown, requisicao, resposta) => {
    // O rate limit do plugin chega como erro comum; preservamos o 429.
    if (temStatusCode(erro) && erro.statusCode === 429) {
      void resposta.code(429).send({
        erro: 'LIMITE_EXCEDIDO',
        mensagem: 'Muitas requisições. Tente novamente em instantes.',
      });
      return;
    }

    const { status, corpo } = mapearErro(erro);

    // 5xx é o único que merece log de erro — 4xx é o cliente errando, e tratar
    // isso como incidente enche o log de ruído até ninguém mais olhar.
    const contexto = {
      metodo: requisicao.method,
      rota: requisicao.url,
      status,
      erro: corpo.erro,
      chave: requisicao.identidadeDaChave,
    };
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    if (status >= 500) {
      log.error(mensagem, {
        ...contexto,
        stack: erro instanceof Error ? erro.stack : undefined,
      });
    } else {
      log.debug(mensagem, contexto);
    }

    void resposta.code(status).send(corpo);
  });

  servidor.addHook('onResponse', async (requisicao, resposta) => {
    if (requisicao.url === ROTA_HEALTH) return;
    log.info('requisição atendida', {
      metodo: requisicao.method,
      rota: requisicao.url,
      status: resposta.statusCode,
      duracaoMs: Math.round(resposta.elapsedTime),
      chave: requisicao.identidadeDaChave,
    });
  });

  return servidor;
}

function temStatusCode(erro: unknown): erro is { statusCode: number } {
  return (
    typeof erro === 'object' &&
    erro !== null &&
    typeof (erro as { statusCode?: unknown }).statusCode === 'number'
  );
}

/**
 * Sobe o servidor e trata SIGTERM.
 *
 * O SIGTERM importa mais do que parece: em todo redeploy o Easypanel manda
 * SIGTERM e espera. Sem tratar, o Node morre na hora e derruba as requisições
 * em voo — e o usuário vê erro a cada deploy. Com `close()`, as respostas em
 * andamento terminam antes de o processo sair.
 */
export async function iniciar(app: Aplicacao, config: Config): Promise<FastifyInstance> {
  const servidor = construirServidor(app, config);

  await servidor.listen({ host: config.http.host, port: config.http.porta });

  app.logger.info('LexFlow no ar', {
    versao: VERSAO,
    host: config.http.host,
    porta: config.http.porta,
    fontes: config.cadeiaDeProviders,
    autenticacao: config.http.autenticacaoDesativada ? 'DESATIVADA' : 'chave de API',
  });

  let encerrando = false;
  const encerrar = (sinal: string): void => {
    if (encerrando) return;
    encerrando = true;
    app.logger.info('encerrando com elegância', { sinal });
    servidor
      .close()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  };

  process.on('SIGTERM', () => encerrar('SIGTERM'));
  process.on('SIGINT', () => encerrar('SIGINT'));

  return servidor;
}
