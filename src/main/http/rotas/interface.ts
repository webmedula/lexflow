import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { FastifyPluginAsync } from 'fastify';
import { VERSAO } from '../../../infrastructure/config/versao.js';
import { paginaConsole } from '../ui/pagina.js';

export const ROTA_CONSOLE = '/';
export const ROTA_FONTES = '/ui/fontes/:arquivo';
/** Prefixo, para o rate limit deixar as fontes de fora como deixa o console. */
export const PREFIXO_FONTES = '/ui/fontes/';

/**
 * As fontes do console, servidas pelo PRÓPRIO servidor.
 *
 * Não vêm do Google Fonts, e isso é regra antiga deste projeto: um recurso
 * externo quebra o console de quem está atrás do firewall de um fórum, e há
 * teste que falha se a página carregar qualquer coisa de fora. Os arquivos
 * vêm dos pacotes `@fontsource` (licença OFL), que são dependência de
 * produção — por isso existem dentro da imagem sem mudar o Dockerfile.
 *
 * Só o subconjunto "latin": cobre o português inteiro (á, ç, ã, õ, ê estão
 * todos em U+00C0–U+00FF) e pesa 27 KB na fonte variável.
 *
 * Lista FECHADA de nomes: o parâmetro da URL nunca vira caminho de arquivo, e
 * portanto não existe `../` que leia outra coisa do disco.
 */
const FONTES: Readonly<Record<string, readonly [pacote: string, arquivo: string]>> = {
  'plus-jakarta-sans.woff2': [
    '@fontsource-variable/plus-jakarta-sans',
    'files/plus-jakarta-sans-latin-wght-normal.woff2',
  ],
  'jetbrains-mono-500.woff2': [
    '@fontsource/jetbrains-mono',
    'files/jetbrains-mono-latin-500-normal.woff2',
  ],
  'jetbrains-mono-600.woff2': [
    '@fontsource/jetbrains-mono',
    'files/jetbrains-mono-latin-600-normal.woff2',
  ],
};

/**
 * Lê as fontes no arranque. O `exports` desses pacotes não publica os
 * `.woff2` (só o CSS), então o caminho parte do CSS que ele publica — o
 * arquivo fica ao lado, em `files/`.
 */
function carregarFontes(): Map<string, Buffer> {
  const exigir = createRequire(import.meta.url);
  const carregadas = new Map<string, Buffer>();
  for (const [nome, [pacote, arquivo]] of Object.entries(FONTES)) {
    const raiz = dirname(exigir.resolve(pacote));
    carregadas.set(nome, readFileSync(join(raiz, arquivo)));
  }
  return carregadas;
}

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
    // No arranque, e não na primeira requisição: se um pacote de fonte
    // faltar na imagem, o deploy falha na hora em vez de o console aparecer
    // com a fonte do sistema sem ninguém perceber.
    const fontes = carregarFontes();

    servidor.get(ROTA_CONSOLE, async (_requisicao, resposta) => {
      resposta.header('content-type', 'text/html; charset=utf-8');
      // Console não deve ser indexado nem cacheado por proxy: muda a cada deploy.
      resposta.header('cache-control', 'no-store');
      resposta.header('x-robots-tag', 'noindex');
      return html;
    });

    servidor.get<{ Params: { arquivo: string } }>(ROTA_FONTES, async (req, resposta) => {
      const fonte = fontes.get(req.params.arquivo);
      if (!fonte) {
        void resposta.code(404);
        return { erro: 'NAO_ENCONTRADO', mensagem: 'Fonte desconhecida.' };
      }
      resposta.header('content-type', 'font/woff2');
      // Ao contrário do HTML, a fonte não muda entre deploys: 30 dias de
      // cache poupam 70 KB a cada abertura do console.
      resposta.header('cache-control', 'public, max-age=2592000');
      return fonte;
    });
  };
}
