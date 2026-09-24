import { ESTILOS } from './estilos.js';
import { SCRIPT } from './script.js';

/**
 * Console web do Processo Vivo — servido pela própria API, na raiz.
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
<title>Processo Vivo</title>
<style>${ESTILOS}</style>
</head>
<body>

<div class="app">
  <!--
    A lateral é o elemento escondido quando não há sessão, e o conteúdo fica
    FORA dela de propósito: a tela de entrada usa o mesmo #conteudo. Se os dois
    estivessem no mesmo bloco, esconder a navegação esconderia o login junto.
    A grade some para uma coluna sozinha quando a lateral não está lá.
  -->
  <aside class="lateral oculto" id="lateral">
    <div class="marca">
      <div class="logo">Processo Vivo</div>
      <div class="sub">mesa de trabalho</div>
    </div>
    <nav class="nav">
      <button id="nav-novidades">Atualizações <span class="bolha oculto" id="bolha"></span></button>
      <button id="nav-processos">Meus processos <span class="cont" id="cont-processos"></span></button>
      <button id="nav-buscar">Buscar</button>
      <button id="nav-vigilancia">Vigilância</button>
      <button id="nav-credenciais">Meus acessos</button>
      <button id="nav-conta" class="oculto">Minha conta</button>
    </nav>
    <div class="lateral-pe">
      <button id="sair" title="Encerrar a sessão">Sair</button>
      <div class="versao">v${versao} &middot; <a href="/ready">estado das fontes</a></div>
    </div>
  </aside>

  <main class="env" id="conteudo"></main>
</div>

<script>${SCRIPT}</script>
</body>
</html>`;
}
