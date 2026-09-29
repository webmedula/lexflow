import { ESTILOS } from './estilos.js';
import { SCRIPT_ADMIN } from './scriptAdmin.js';

/**
 * Área administrativa — mesma casca visual do console do assinante
 * (`ui/pagina.ts`), reaproveitando `ESTILOS` para as duas telas não
 * divergirem visualmente à toa.
 *
 * Protegida por HTTP Basic Auth (`plugins/autenticacaoAdmin.ts`), nunca por
 * chave de API nem sessão de assinante — ver o porquê em `adminAuth.ts`. Por
 * isso o `fetch` daqui não manda `x-api-key`: o navegador já guarda a
 * credencial Basic depois do primeiro pedido, para a mesma origem.
 */
export function paginaAdmin(versao: string): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Processo Vivo — administração</title>
<style>${ESTILOS}</style>
</head>
<body>

<div class="app">
  <aside class="lateral" id="lateral">
    <div class="marca">
      <div class="logo">Processo Vivo</div>
      <div class="sub">administração</div>
    </div>
    <nav class="nav">
      <button id="nav-assinaturas" class="ativo">Assinaturas</button>
      <button id="nav-chaves">Chaves de API</button>
    </nav>
    <div class="lateral-pe">
      <div class="versao">v${versao}</div>
    </div>
  </aside>

  <main class="env" id="conteudo"></main>
</div>

<script>${SCRIPT_ADMIN}</script>
</body>
</html>`;
}
