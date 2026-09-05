/** CSS do console. Arquivo separado só para o HTML e o script ficarem legíveis. */
export const ESTILOS = `
:root{
  color-scheme:light dark;
  --fundo:#f4f5f7; --papel:#fff; --papel2:#fafbfc; --barra:#fff;
  --linha:#e3e6ea; --linha2:#eef0f3;
  --tinta:#16191d; --tinta2:#4a545e; --tinta3:#818b95;
  --acento:#1c5d8c; --acento-bg:#e9f2f8;
  --novo:#0f7a4a; --novo-bg:#e4f5ec;
  --marco:#8a5a00; --marco-bg:#fdf3e0;
  --erro:#a02c2c; --erro-bg:#fdecec;
  --r:12px;
}
@media (prefers-color-scheme:dark){
  :root{
    --fundo:#101317; --papel:#171b20; --papel2:#1c2127; --barra:#141a1f;
    --linha:#2a3038; --linha2:#22272d;
    --tinta:#e9ecef; --tinta2:#a9b3bd; --tinta3:#7b858f;
    --acento:#74b6e2; --acento-bg:#162936;
    --novo:#65c79b; --novo-bg:#14291f;
    --marco:#e0ac5a; --marco-bg:#2e2415;
    --erro:#ef9090; --erro-bg:#331f1f;
  }
}
*{box-sizing:border-box}
body{margin:0;background:var(--fundo);color:var(--tinta);
  font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  -webkit-font-smoothing:antialiased}
a{color:var(--acento);text-decoration:none}
.oculto{display:none!important}

/* ---------- barra superior ---------- */
.barra{position:sticky;top:0;z-index:20;background:var(--barra);
  border-bottom:1px solid var(--linha)}
.barra-int{max-width:900px;margin:0 auto;padding:0 16px;display:flex;
  align-items:center;gap:20px;min-height:56px;flex-wrap:wrap}
.logo{font-weight:800;letter-spacing:-.03em;font-size:18px}
.nav{display:flex;gap:2px;margin-left:auto;flex-wrap:wrap}
.nav button{background:transparent;border:0;color:var(--tinta2);font:inherit;
  font-weight:600;font-size:14px;padding:8px 13px;border-radius:8px;cursor:pointer;
  display:flex;align-items:center;gap:7px}
.nav button:hover{background:var(--papel2);color:var(--tinta)}
.nav button.ativo{background:var(--acento-bg);color:var(--acento)}
.bolha{background:var(--novo);color:#fff;font-size:11px;font-weight:800;
  min-width:19px;height:19px;border-radius:10px;display:inline-flex;
  align-items:center;justify-content:center;padding:0 5px}
@media (prefers-color-scheme:dark){.bolha{color:#08130d}}

.env{max-width:900px;margin:0 auto;padding:22px 16px 80px}

/* ---------- blocos ---------- */
.cartao{background:var(--papel);border:1px solid var(--linha);
  border-radius:var(--r);padding:18px;margin-bottom:14px}
.titulo-secao{display:flex;align-items:center;justify-content:space-between;
  gap:12px;flex-wrap:wrap;margin-bottom:14px}
.titulo-secao h2{font-size:19px;margin:0;letter-spacing:-.02em}
.titulo-secao .sub{color:var(--tinta3);font-size:13px;margin-top:2px}

.rotulo{display:block;font-size:11px;font-weight:700;color:var(--tinta3);
  text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px}
input,select{width:100%;padding:9px 11px;font:inherit;color:var(--tinta);
  background:var(--papel2);border:1px solid var(--linha);border-radius:8px;outline:0}
input:focus,select:focus{border-color:var(--acento);background:var(--papel)}
.grade{display:flex;gap:10px;flex-wrap:wrap}
.grade>div{flex:1 1 180px}
button.bt{font:inherit;font-weight:600;padding:9px 18px;border:0;border-radius:8px;
  background:var(--acento);color:#fff;cursor:pointer}
button.bt:disabled{opacity:.5;cursor:progress}
button.bt2{background:transparent;color:var(--acento);
  border:1px solid var(--linha);padding:7px 14px;font-size:13px}
button.bt3{background:transparent;color:var(--tinta3);border:0;padding:5px 8px;
  font-size:13px;font-weight:600;cursor:pointer}
button.bt3:hover{color:var(--erro)}
.nota{font-size:12px;color:var(--tinta3);margin-top:7px}
.aviso{background:var(--acento-bg);border-radius:8px;padding:11px 13px;
  font-size:13px;color:var(--tinta2)}

/* ---------- filtros ---------- */
.filtros{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;
  padding:12px;background:var(--papel);border:1px solid var(--linha);
  border-radius:var(--r);margin-bottom:14px}
.filtros>div{flex:1 1 140px;min-width:120px}
.filtros .compacto{flex:0 0 auto}
.chip{font-size:12px;font-weight:600;padding:6px 12px;border-radius:20px;
  border:1px solid var(--linha);background:var(--papel2);color:var(--tinta2);
  cursor:pointer}
.chip.on{background:var(--acento-bg);border-color:var(--acento);color:var(--acento)}

/* ---------- lista de processos ---------- */
.item{display:block;width:100%;text-align:left;background:var(--papel);
  border:1px solid var(--linha);border-radius:var(--r);padding:14px 16px;
  margin-bottom:10px;cursor:pointer;font:inherit;color:inherit}
.item:hover{border-color:var(--acento)}
.item.novo{border-left:3px solid var(--novo)}
.item .lin1{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
.item .n{font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.item .ap{color:var(--tinta2);font-size:14px}
.item .lin2{color:var(--tinta2);font-size:13px;margin-top:3px}
.item .lin3{color:var(--tinta3);font-size:12px;margin-top:5px}

.selo{font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px;
  background:var(--acento-bg);color:var(--acento)}
.selo.nv{background:var(--novo-bg);color:var(--novo)}
.selo.al{background:var(--erro-bg);color:var(--erro)}
.selo.mc{background:var(--marco-bg);color:var(--marco)}

/* ---------- feed ---------- */
.nov{display:grid;grid-template-columns:96px 1fr;gap:12px;padding:12px 0;
  border-top:1px solid var(--linha2)}
.nov:first-of-type{border-top:0}
.nov .q{font-size:12px;color:var(--tinta3);padding-top:2px}
.nov .t{font-weight:600}
.nov .p{font-size:12px;color:var(--tinta3);margin-top:3px;cursor:pointer}
.nov .p:hover{color:var(--acento)}
.nov.nl{background:linear-gradient(90deg,var(--novo-bg),transparent 60%);
  margin:0 -8px;padding:12px 8px;border-radius:6px}

/* ---------- detalhe ---------- */
.capa{background:var(--papel);border:1px solid var(--linha);
  border-radius:var(--r) var(--r) 0 0;border-bottom:0;padding:20px 18px 18px}
.capa .num{font-size:24px;font-weight:700;letter-spacing:-.03em;
  font-variant-numeric:tabular-nums}
.capa .sob{margin-top:4px;color:var(--tinta2);font-size:14px}
.selos{display:flex;gap:6px;flex-wrap:wrap;margin-top:12px}
.agora{background:var(--papel2);border:1px solid var(--linha);border-top:0;
  border-radius:0 0 var(--r) var(--r);padding:14px 18px;margin-bottom:14px}
.agora .k{font-size:11px;font-weight:700;color:var(--tinta3);
  text-transform:uppercase;letter-spacing:.07em}
.agora .t{font-size:17px;font-weight:600;margin-top:4px}
.agora .d{font-size:13px;color:var(--tinta2);margin-top:2px}
.fatos{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));
  gap:1px;background:var(--linha2);border:1px solid var(--linha);
  border-radius:var(--r);overflow:hidden;margin-bottom:14px}
.fato{background:var(--papel);padding:13px 16px}
.fato .k{font-size:11px;font-weight:700;color:var(--tinta3);
  text-transform:uppercase;letter-spacing:.07em}
.fato .v{margin-top:3px;font-size:14px;line-height:1.4}
h3.sec{font-size:12px;font-weight:700;text-transform:uppercase;
  letter-spacing:.08em;color:var(--tinta3);margin:0 0 10px}
.ano{position:sticky;top:57px;background:var(--papel);padding:8px 0 6px;
  font-size:12px;font-weight:700;color:var(--tinta3);z-index:2}
.ev{display:grid;grid-template-columns:78px 1fr;gap:12px;padding:8px 0;
  border-top:1px solid var(--linha2)}
.ev .dt{font-size:12px;color:var(--tinta3);font-variant-numeric:tabular-nums;
  padding-top:2px;white-space:nowrap}
.ev .tt{font-weight:500;line-height:1.4}
.ev.marco .tt{font-weight:700}
.ev.marco .dt{color:var(--marco);font-weight:700}
.ev .cp{font-size:13px;color:var(--tinta2);margin-top:3px}
.ev .xn{font-size:11px;color:var(--tinta3);font-weight:600}
.parte{padding:11px 0;border-top:1px solid var(--linha2)}
.parte:first-of-type{border-top:0}

/* ---------- estados ---------- */
.vazio{text-align:center;padding:44px 20px;color:var(--tinta2)}
.vazio .ic{font-size:30px;margin-bottom:10px;opacity:.5}
.vazio h3{margin:0 0 6px;font-size:16px;color:var(--tinta)}
.vazio p{margin:0 auto 16px;max-width:420px;font-size:14px}
.gira{display:inline-block;width:13px;height:13px;border:2px solid currentColor;
  border-top-color:transparent;border-radius:50%;animation:g .7s linear infinite;
  vertical-align:-2px;margin-right:8px}
@keyframes g{to{transform:rotate(360deg)}}
.barra-prog{height:2px;background:var(--acento);border-radius:2px;
  animation:pulsa 1.4s ease-in-out infinite;margin-top:10px}
@keyframes pulsa{0%,100%{opacity:.25}50%{opacity:1}}

/* ---------- providência, filtros e leitura do ato ---------- */
/* O cartão de providência é o primeiro da página e precisa se distinguir sem
   gritar: borda de acento à esquerda, não fundo vermelho. Alarme permanente
   deixa de ser alarme. */
.cartao.alerta{border-left:3px solid var(--acento)}
.acao{display:grid;grid-template-columns:88px 1fr;gap:10px;padding:9px 0;
  border-bottom:1px solid var(--linha)}
.acao:last-of-type{border-bottom:0}
.ev.pede .tt{font-weight:600}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 12px}
.chip{background:transparent;border:1px solid var(--linha);color:var(--tinta2);
  border-radius:999px;padding:5px 12px;font-size:12.5px;cursor:pointer;
  font-family:inherit}
.chip:hover{color:var(--tinta);border-color:var(--tinta2)}
.chip.on{background:var(--acento);border-color:var(--acento);color:#fff}
.link{background:none;border:0;color:var(--acento);cursor:pointer;padding:4px 0;
  font-size:12.5px;font-family:inherit;text-decoration:underline}
.cp a{color:var(--acento)}
/* O inteiro teor expandido é texto de decisão: precisa respirar e preservar as
   quebras de linha do ato, senão vira um bloco ilegível de 20 mil caracteres. */
.cp{white-space:pre-wrap}
.vig{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;
  padding:11px 0;border-bottom:1px solid var(--linha)}
.vig:last-of-type{border-bottom:0}
.vig .id{font-weight:600}
.campo{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin:10px 0}
.campo label{display:block;font-size:12px;color:var(--tinta2);margin-bottom:4px}

@media (max-width:560px){
  .acao{grid-template-columns:1fr;gap:2px}
  .vig{grid-template-columns:1fr;align-items:start}
  .ev{grid-template-columns:1fr;gap:2px}
  .nov{grid-template-columns:1fr;gap:3px}
  .capa .num{font-size:20px}
  .nav button{padding:8px 10px;font-size:13px}
}
`;
