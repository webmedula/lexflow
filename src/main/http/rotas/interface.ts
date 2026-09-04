import type { FastifyPluginAsync } from 'fastify';
import { VERSAO } from '../../../infrastructure/config/versao.js';
import { paginaConsole } from '../ui/pagina.js';

export const ROTA_CONSOLE = '/';

/**
 * Serve o console web na raiz.
 *
 * A página é PÚBLICA (não pede chave) porque ela não carrega dado nenhum: é
 * HTML estático. Os dados continuam atrás da autenticação — o que a página faz
 * é mandar o header `x-api-key` no `fetch`, que é justamente o que um navegador
 * não consegue fazer digitando a URL.
 *
 * Servir da mesma origem da API elimina o CORS de vez: nada de configurar
 * origem liberada para o console funcionar.
 */
export function rotasDeInterface(): FastifyPluginAsync {
  return async (servidor) => {
    const html = paginaConsole(VERSAO);

    servidor.get(ROTA_CONSOLE, async (_requisicao, resposta) => {
      resposta.header('content-type', 'text/html; charset=utf-8');
      // Console não deve ser indexado nem cacheado por proxy: muda a cada deploy.
      resposta.header('cache-control', 'no-store');
      resposta.header('x-robots-tag', 'noindex');
      return html;
    });
  };
}
