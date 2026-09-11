import { ESTILOS } from './estilos.js';
import { SCRIPT } from './script.js';

/**
 * Console web do LexFlow — servido pela própria API, na raiz.
 *
 * Sendo da MESMA ORIGEM da API, o `fetch` daqui manda `x-api-key` sozinho: sem
 * CORS, sem PowerShell, sem curl. Foi o que resolveu o problema de "abro a URL
 * e recebo NAO_AUTENTICADO" — navegador não manda header customizado, e do lado
 * de quem usa isso é indistinguível de "o sistema não funciona".
 *
 * Sem build, sem framework, sem recurso externo: três strings que o servidor
 * concatena. Nada para compilar e nada que quebre em deploy.
 *
 * ESCOPO: a chave de API identifica o assinante enquanto não existem contas de
 * usuário — cada chave é um espaço isolado, com seus próprios processos
 * acompanhados. Quando houver cadastro e login, a coluna `workspace` do banco
 * passa a apontar para o usuário e nada mais muda.
 */
export function paginaConsole(versao: string): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>LexFlow</title>
<style>${ESTILOS}</style>
</head>
<body>

<div class="barra oculto" id="barra">
  <div class="barra-int">
    <div class="logo">LexFlow</div>
    <nav class="nav">
      <button id="nav-novidades">Atualizações <span class="bolha oculto" id="bolha"></span></button>
      <button id="nav-processos">Meus processos</button>
      <button id="nav-buscar">Buscar</button>
      <button id="nav-vigilancia">Vigilância</button>
      <button id="nav-credenciais">Meus acessos</button>
      <button id="sair" title="Esquecer a chave neste navegador">Sair</button>
    </nav>
  </div>
</div>

<main class="env" id="conteudo"></main>

<footer style="text-align:center;color:var(--tinta3);font-size:12px;padding:0 0 30px">
  LexFlow v${versao} &middot; <a href="/ready">estado das fontes</a>
</footer>

<script>${SCRIPT}</script>
</body>
</html>`;
}
