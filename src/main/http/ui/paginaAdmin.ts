import { ESTILOS } from './estilos.js';
import { SCRIPT_ADMIN } from './scriptAdmin.js';

/**
 * O pouco que só o painel precisa: caixa de marcar (o `input{width:100%}` de
 * `ESTILOS` esticaria a caixinha pela linha inteira) e área de texto.
 */
const ESTILOS_ADMIN = `
.marcas{display:flex;flex-wrap:wrap;gap:8px 18px}
.marcas label{display:flex;align-items:center;gap:8px;font-size:14px;cursor:pointer}
.marcas input[type=checkbox]{width:auto;margin:0}
textarea{width:100%;padding:9px 11px;font:inherit;color:var(--tinta);resize:vertical;
  background:var(--papel2);border:1px solid var(--linha);border-radius:8px;outline:0}
textarea:focus{border-color:var(--acento);background:var(--papel)}
`;

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
<style>${ESTILOS}${ESTILOS_ADMIN}</style>
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
      <button id="nav-planos">Planos</button>
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
