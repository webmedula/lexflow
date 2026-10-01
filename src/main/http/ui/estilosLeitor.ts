/**
 * CSS do leitor de peças (v0.31.0). Arquivo próprio, como o script do painel:
 * a tela do processo continua exatamente como era enquanto o painel está
 * fechado, e tudo daqui só age sob `body.com-leitor` ou dentro de `#leitor`.
 *
 * Usa os tokens de cor do console (estilos.ts), com o mesmo significado:
 * verde = pronto, azul = baixando, âmbar = pede providência (parcial, pausa),
 * vermelho = falhou.
 */
export const ESTILOS_LEITOR = `
/* ---------- leitor: o painel à direita ---------- */
:root{--leitor-w:46vw}
body.com-leitor .app{padding-right:var(--leitor-w)}
body.com-leitor .env{max-width:none}
#leitor{position:fixed;top:0;right:0;bottom:0;width:var(--leitor-w);z-index:40;
  background:var(--papel);border-left:1px solid var(--linha);display:flex;
  flex-direction:column;box-shadow:-6px 0 18px rgba(11,25,44,.08)}
/* Só a área das páginas encolhe e rola; o resto tem a altura do conteúdo. */
#leitor>.topo,#leitor>.estado,#leitor>.ferramentas,#leitor>.onde{flex-shrink:0}
#leitor .divisor{position:absolute;left:-5px;top:0;bottom:0;width:10px;cursor:col-resize;
  z-index:2;touch-action:none}
#leitor .divisor::after{content:"";position:absolute;left:4px;top:50%;width:2px;height:44px;
  margin-top:-22px;border-radius:2px;background:var(--linha)}
#leitor .divisor:hover::after,#leitor .divisor.arrastando::after{background:var(--acento)}
#leitor .topo{display:flex;align-items:center;gap:8px;padding:10px 12px;
  border-bottom:1px solid var(--linha);flex-wrap:wrap}
#leitor .topo h3{margin:0;font-size:15px;font-weight:800;flex-grow:1}
#leitor .topo .voltar{display:none}
#leitor .estado{padding:12px 14px;border-bottom:1px solid var(--linha2);font-size:13.5px;
  color:var(--tinta2);max-height:38vh;overflow:auto}
#leitor .estado:empty{display:none}
#leitor .estado strong{color:var(--tinta)}
#leitor .barra-prog{height:6px;border-radius:3px;background:var(--neutro-bg);
  overflow:hidden;margin:8px 0 4px}
#leitor .barra-prog i{display:block;height:100%;background:var(--novo);width:0;
  transition:width .3s}
#leitor .faltou{margin:8px 0 0;padding:0;list-style:none}
#leitor .faltou li{padding:4px 0;border-top:1px solid var(--linha2);font-size:12.5px}
#leitor .faltou li b{color:var(--tinta)}
#leitor .ferramentas{display:flex;align-items:center;gap:6px;padding:8px 12px;
  border-bottom:1px solid var(--linha);flex-wrap:wrap;font-size:13px}
#leitor .ferramentas input,#leitor .ferramentas select{min-height:34px;width:auto;
  flex:1 1 150px;padding:5px 10px;font-size:13px}
#leitor .ferramentas button{min-height:34px;padding:0 10px;font-size:13px}
#leitor .ferramentas .pg{color:var(--tinta3);font-variant-numeric:tabular-nums;
  white-space:nowrap}
#leitor .onde{padding:6px 12px;font-size:12.5px;color:var(--tinta2);
  border-bottom:1px solid var(--linha2);white-space:nowrap;overflow:hidden;
  text-overflow:ellipsis}
#leitor .onde:empty{display:none}
#leitor .paginas{flex-grow:1;overflow:auto;background:var(--fundo);padding:12px 0}
#leitor .pagina{margin:0 auto 12px;background:#fff;box-shadow:var(--sombra);
  position:relative}
#leitor .pagina canvas{display:block;width:100%;height:100%}
#leitor .pagina .num{position:absolute;right:6px;bottom:4px;font-size:11px;
  color:#64748b;background:rgba(255,255,255,.85);padding:0 4px;border-radius:3px}
#leitor .pagina.achada{outline:3px solid var(--atencao-ponto)}
#leitor .vazio-leitor{padding:24px 16px;color:var(--tinta3);font-size:13.5px}

/* ---------- leitor: a seleção na linha do tempo ---------- */
#leitor .chip.on{border-color:var(--acento);color:var(--acento);background:var(--acento-bg)}
.sel-peca{margin:0 2px 0 0;vertical-align:middle;width:16px;height:16px;cursor:pointer}
label.sel{display:inline-flex;align-items:center;gap:2px}
button.ir-pagina{background:transparent;border:0;color:var(--acento);font:inherit;
  font-size:12px;font-weight:700;cursor:pointer;padding:0 4px}
.doc.no-leitor,.ev.no-leitor{outline:2px solid var(--acento);outline-offset:2px}

#leitor-reabrir{display:none}

/* No celular o painel é a tela inteira, com "voltar" para a linha do tempo. */
@media (max-width:900px){
  body.com-leitor .app{padding-right:0}
  #leitor{width:100%;left:0;border-left:0}
  #leitor .divisor{display:none}
  #leitor .topo .voltar{display:inline-flex}
  /* Na tela pequena o estado não pode empurrar o PDF para fora da vista. */
  #leitor .estado{max-height:24vh}
  body.leitor-escondido #leitor{display:none}
  body.com-leitor.leitor-escondido #leitor-reabrir{display:inline-flex;position:fixed;
    right:16px;bottom:16px;z-index:41;box-shadow:var(--sombra)}
}
`;
