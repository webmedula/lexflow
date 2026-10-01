/**
 * Script do LEITOR DE PEÇAS (v0.31.0): o painel à direita da linha do tempo.
 *
 * Arquivo próprio por decisão da especificação: `script.ts` já passa de 2.400
 * linhas, e o painel é um pedaço que se liga e desliga. Ele conversa com o
 * console por dois ganchos, e só por eles:
 *
 * - `window.__pv` (exposto por script.ts): `api`, `esc`, `explicar`, `dth`, `chave`.
 * - `window.__pvLeitor` (exposto aqui): `aposDesenhar(numero, regua)`, chamado
 *   quando a tela do processo pinta as peças; `trocouProcesso(numero)` e
 *   `fechar()`, chamados ao navegar.
 *
 * Com o painel fechado, a tela do processo é exatamente a de antes: a única
 * diferença é o botão "Ler peças ao lado" no cartão das peças. Caixas de
 * marcar, links de página e destaque só existem com o painel aberto.
 *
 * O PDF.js vem do PRÓPRIO servidor (`/ui/pdfjs/`), por `import()` — a página
 * continua sem nenhum `<script src>`, e nada sai para CDN. Ele lê o PDF por
 * trechos (`Range`), desenha só as páginas perto da tela e descarta as longe.
 *
 * O HTML do tribunal nunca passa por aqui: ele virou texto no servidor, dentro
 * do PDF. Este script não insere conteúdo de peça nenhum no DOM — só texto do
 * próprio sistema, sempre por `esc()`.
 *
 * Mesmo regime de `script.ts`: é JavaScript dentro de uma string, invisível ao
 * tsc e ao ESLint. `tests/http/console-script.spec.ts` roda o ESLint aqui
 * dentro também.
 */
export const SCRIPT_LEITOR = String.raw`
(function(){
var LARGURA='processovivo.leitor.largura';
var PDFJS='/ui/pdfjs/';
/* Quantas páginas desenhadas ficam na memória. Processo de milhares de
   páginas não pode virar milhares de canvas: as longe da tela são apagadas e
   redesenhadas se a pessoa voltar a elas. */
var MAX_DESENHADAS=24;
/* Sem progresso por este tempo, a tela DIZ isso — em vez de girar para
   sempre. O servidor continua tentando; quem lê precisa saber que parou. */
var PARADO_MS=3*60*1000;

var st=novoEstado('');
function novoEstado(numero){
  return {numero:numero,pecas:[],selecao:{},marcando:false,job:null,indice:null,
    timer:null,estimativaTimer:null,pdf:null,lib:null,zoom:'largura',escala:1,
    larguraBase:0,alturaBase:0,desenhadas:[],observador:null,pagina:1,
    busca:{id:0,termo:'',paginas:[],i:-1},textos:{},destaque:null,erroPoll:0,
    ultimaEstimativa:null};
}

function pv(){return window.__pv}
function $(i){return document.getElementById(i)}
function esc(s){return pv().esc(s)}
function hora(iso){
  if(!iso)return '—';
  try{return new Date(iso).toLocaleTimeString('pt-BR',{timeZone:'America/Sao_Paulo',
    hour:'2-digit',minute:'2-digit'})}catch(e){return '—'}
}
function minutos(seg){
  if(seg<60)return 'menos de 1 min';
  var m=Math.round(seg/60);
  return m<=1?'~1 min':'~'+m+' min';
}
function soDigitos(n){return String(n||'').replace(/\D/g,'')}
function base(){return '/v1/processos/'+encodeURIComponent(st.numero)+'/leitor'}

/* ---------- as peças que a régua conhece ---------- */
/* Todas, inclusive as escondidas pelos filtros da linha do tempo e as que
   ficaram fora dela: "selecionar todas" diz o número, e o número é o do
   processo, não o da tela. */
function pecasDaRegua(dados){
  var out=[], vistos={};
  function por(p){
    if(!p||!p.id||vistos[p.id])return;
    vistos[p.id]=1;
    out.push({id:p.id,rotulo:p.rotulo||('peça '+p.id),sigilosa:!!p.sigilosa,
      mimetype:p.mimetype||''});
    (p.vinculadas||[]).forEach(por);
  }
  ((dados&&dados.eventos)||[]).forEach(function(ev){(ev.pecas||[]).forEach(por)});
  ((dados&&dados.pecasSoltas)||[]).forEach(por);
  return out;
}

/* ---------- o painel ---------- */
function montarPainel(){
  if($('leitor'))return;
  var w=null; try{w=localStorage.getItem(LARGURA)}catch(e){}
  if(w)document.documentElement.style.setProperty('--leitor-w',w);
  var el=document.createElement('aside');
  el.id='leitor';
  el.setAttribute('aria-label','Leitor de peças');
  el.innerHTML='<div class="divisor" id="leitor-divisor" title="Arraste para ajustar a largura"></div>'+
    '<div class="topo">'+
      '<button class="bt bt2 voltar" id="leitor-voltar">&larr; linha do tempo</button>'+
      '<h3>Leitor de peças</h3>'+
      '<button class="bt bt2" id="leitor-marcar">Marcar peças</button>'+
      '<button class="bt bt3" id="leitor-fechar" title="Fechar o leitor">Fechar</button>'+
    '</div>'+
    '<div class="estado" id="leitor-estado"></div>'+
    '<div class="ferramentas oculto" id="leitor-ferramentas">'+
      '<button class="bt bt2" id="leitor-menos" title="Diminuir">−</button>'+
      '<button class="bt bt2" id="leitor-largura" title="Ajustar à largura">largura</button>'+
      '<button class="bt bt2" id="leitor-mais" title="Aumentar">+</button>'+
      '<span class="pg" id="leitor-pg"></span>'+
      '<select id="leitor-ir" aria-label="Ir para a peça"></select>'+
      '<input id="leitor-busca" placeholder="Buscar no texto" aria-label="Buscar no texto">'+
      '<button class="bt bt2" id="leitor-buscar">Buscar</button>'+
      '<button class="bt bt2 oculto" id="leitor-ant" title="Ocorrência anterior">&uarr;</button>'+
      '<button class="bt bt2 oculto" id="leitor-prox" title="Próxima ocorrência">&darr;</button>'+
      '<button class="bt bt2" id="leitor-baixar">Baixar PDF</button>'+
    '</div>'+
    '<div class="onde" id="leitor-onde"></div>'+
    '<div class="paginas" id="leitor-paginas"></div>';
  document.body.appendChild(el);
  var reabrir=document.createElement('button');
  reabrir.id='leitor-reabrir';reabrir.className='bt';reabrir.textContent='Leitor';
  document.body.appendChild(reabrir);
  document.body.classList.add('com-leitor');

  $('leitor-fechar').addEventListener('click',fechar);
  $('leitor-voltar').addEventListener('click',function(){document.body.classList.add('leitor-escondido')});
  reabrir.addEventListener('click',function(){document.body.classList.remove('leitor-escondido')});
  $('leitor-marcar').addEventListener('click',function(){
    if(st.marcando)sairDaSelecao(); else entrarNaSelecao();
  });
  $('leitor-menos').addEventListener('click',function(){mudarZoom(-1)});
  $('leitor-mais').addEventListener('click',function(){mudarZoom(1)});
  $('leitor-largura').addEventListener('click',function(){st.zoom='largura';relayout()});
  $('leitor-ir').addEventListener('change',function(){
    var v=Number($('leitor-ir').value); if(v)irParaPagina(v);
  });
  $('leitor-buscar').addEventListener('click',buscar);
  $('leitor-busca').addEventListener('keydown',function(e){if(e.key==='Enter')buscar()});
  $('leitor-prox').addEventListener('click',function(){pularOcorrencia(1)});
  $('leitor-ant').addEventListener('click',function(){pularOcorrencia(-1)});
  $('leitor-baixar').addEventListener('click',baixar);
  $('leitor-paginas').addEventListener('scroll',aoRolar);
  ligarDivisor();
}

function ligarDivisor(){
  var d=$('leitor-divisor'); if(!d)return;
  d.addEventListener('pointerdown',function(e){
    e.preventDefault();d.setPointerCapture(e.pointerId);d.classList.add('arrastando');
    function mover(ev){
      var w=Math.max(320,Math.min(window.innerWidth-360,window.innerWidth-ev.clientX));
      document.documentElement.style.setProperty('--leitor-w',w+'px');
    }
    function soltar(){
      d.classList.remove('arrastando');
      d.removeEventListener('pointermove',mover);
      d.removeEventListener('pointerup',soltar);
      try{localStorage.setItem(LARGURA,
        getComputedStyle(document.documentElement).getPropertyValue('--leitor-w').trim())}catch(x){}
      if(st.zoom==='largura')relayout();
    }
    d.addEventListener('pointermove',mover);
    d.addEventListener('pointerup',soltar);
  });
}

function estado(html){var e=$('leitor-estado'); if(e)e.innerHTML=html}

function abrirPainel(){
  montarPainel();
  document.body.classList.remove('leitor-escondido');
  estado('<span class="gira"></span>Procurando um PDF já montado deste processo…');
  pv().api(base()).then(function(r){
    var j=r.job;
    if(j&&j.estado!=='expirado'&&j.estado!=='falhou')mostrarJob(j);
    else{
      if(j)mostrarJob(j);
      entrarNaSelecao();
    }
  }).catch(function(e){estado(erroTexto(e));entrarNaSelecao()});
}

function erroTexto(e){
  return '<div style="color:var(--erro)"><strong>'+esc(e.message||'Falhou')+'</strong> — '+
    esc(pv().explicar(e))+'</div>';
}

function fechar(){
  pararPoll();
  if(st.estimativaTimer)clearTimeout(st.estimativaTimer);
  if(st.observador)st.observador.disconnect();
  if(st.pdf){try{st.pdf.destroy()}catch(e){}}
  var el=$('leitor'); if(el)el.remove();
  var r=$('leitor-reabrir'); if(r)r.remove();
  document.body.classList.remove('com-leitor','leitor-escondido');
  limparLinhaDoTempo();
  st=novoEstado(st.numero);
}

function limparLinhaDoTempo(){
  document.querySelectorAll('label.sel').forEach(function(l){l.remove()});
  document.querySelectorAll('.ir-pagina').forEach(function(b){b.remove()});
  document.querySelectorAll('.no-leitor').forEach(function(x){x.classList.remove('no-leitor')});
}

/* ---------- marcar peças ---------- */
function entrarNaSelecao(){
  st.marcando=true;
  var b=$('leitor-marcar'); if(b)b.textContent='Cancelar marcação';
  injetarCaixas();
  desenharSelecao();
}
function sairDaSelecao(){
  st.marcando=false;
  var b=$('leitor-marcar'); if(b)b.textContent='Marcar peças';
  document.querySelectorAll('label.sel').forEach(function(l){l.remove()});
  if(st.job)mostrarJob(st.job); else estado('');
}

function injetarCaixas(){
  if(!st.marcando)return;
  var sig={}; st.pecas.forEach(function(p){if(p.sigilosa)sig[p.id]=1});
  document.querySelectorAll('#conteudo [data-peca]').forEach(function(el){
    var prev=el.previousElementSibling;
    if(prev&&prev.classList.contains('sel'))return;
    var id=el.getAttribute('data-peca');
    var lb=document.createElement('label');
    lb.className='sel';
    var cx=document.createElement('input');
    cx.type='checkbox';cx.className='sel-peca';cx.setAttribute('data-sel',id);
    cx.checked=!!st.selecao[id];
    if(sig[id]){cx.disabled=true;lb.title='peça sob sigilo não entra no PDF combinado'}
    else lb.title='incluir no PDF';
    cx.addEventListener('change',function(){
      if(cx.checked)st.selecao[id]=1; else delete st.selecao[id];
      sincronizarCaixas();desenharSelecao();
    });
    lb.appendChild(cx);
    el.parentNode.insertBefore(lb,el);
  });
}
/* A mesma peça pode aparecer duas vezes na tela (régua e lista do rodapé). */
function sincronizarCaixas(){
  document.querySelectorAll('.sel-peca').forEach(function(cx){
    cx.checked=!!st.selecao[cx.getAttribute('data-sel')];
  });
}

function marcadas(){
  return st.pecas.filter(function(p){return st.selecao[p.id]}).map(function(p){return p.id});
}

function grupos(){
  var g={};
  st.pecas.forEach(function(p){
    if(p.sigilosa)return;
    var k=String(p.rotulo).split(/\s+-\s+/)[0].trim()||'Outros';
    (g[k]=g[k]||[]).push(p.id);
  });
  return Object.keys(g).map(function(k){return{rotulo:k,ids:g[k]}})
    .sort(function(a,b){return b.ids.length-a.ids.length}).slice(0,10);
}

function desenharSelecao(){
  var disponiveis=st.pecas.filter(function(p){return !p.sigilosa});
  var sigilosas=st.pecas.length-disponiveis.length;
  var n=marcadas().length;
  var h='<div><strong id="leitor-contagem">'+n+' '+(n===1?'peça marcada':'peças marcadas')+
    '</strong> de '+st.pecas.length+'</div>';
  h+='<div class="nota" id="leitor-estimativa">'+(n?'calculando o tempo…':
    'Marque as peças na linha do tempo, ou use os atalhos abaixo.')+'</div>';
  h+='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">'+
    '<button class="bt bt2" id="leitor-todas">Selecionar todas ('+disponiveis.length+')</button>'+
    '<button class="bt bt2" id="leitor-limpar">Limpar</button></div>';
  if(sigilosas)h+='<div class="nota">'+sigilosas+' peça(s) sob sigilo ficam de fora: '+
    'não são guardadas no PDF combinado. Baixe-as individualmente.</div>';
  var gs=grupos();
  if(gs.length){
    h+='<div class="chips" style="margin:8px 0 0">';
    gs.forEach(function(g,i){
      var todas=g.ids.every(function(id){return st.selecao[id]});
      h+='<button class="chip'+(todas?' on':'')+'" data-grupo="'+i+'">'+
        esc(g.rotulo)+' ('+g.ids.length+')</button>';
    });
    h+='</div>';
  }
  h+='<div style="margin-top:10px"><button class="bt" id="leitor-montar"'+(n?'':' disabled')+
    '>Montar PDF com '+n+' '+(n===1?'peça':'peças')+'</button></div>';
  estado(h);

  $('leitor-todas').addEventListener('click',function(){
    disponiveis.forEach(function(p){st.selecao[p.id]=1});
    sincronizarCaixas();desenharSelecao();
  });
  $('leitor-limpar').addEventListener('click',function(){
    st.selecao={};sincronizarCaixas();desenharSelecao();
  });
  document.querySelectorAll('[data-grupo]').forEach(function(el){
    el.addEventListener('click',function(){
      var g=gs[Number(el.getAttribute('data-grupo'))]; if(!g)return;
      var todas=g.ids.every(function(id){return st.selecao[id]});
      g.ids.forEach(function(id){if(todas)delete st.selecao[id]; else st.selecao[id]=1});
      sincronizarCaixas();desenharSelecao();
    });
  });
  $('leitor-montar').addEventListener('click',montar);
  pedirEstimativa(n);
}

/* A faixa vem do servidor, calculada com os números medidos — a mesma conta
   que ele usa. A tela diz que é ordem de grandeza. */
function pedirEstimativa(n){
  if(st.estimativaTimer)clearTimeout(st.estimativaTimer);
  if(!n)return;
  st.estimativaTimer=setTimeout(function(){
    pv().api('/v1/leitor/estimativa?pecas='+n).then(function(r){
      var el=$('leitor-estimativa'); if(!el||marcadas().length!==n)return;
      var a=minutos(r.minimoSegundos), z=minutos(r.maximoSegundos);
      el.textContent='Tempo estimado: '+(a===z?a:'entre '+a+' e '+z)+
        ' (ordem de grandeza: depende da fila e do tamanho das peças, que o '+
        'tribunal só informa ao entregar).';
      st.ultimaEstimativa=r;
    }).catch(function(){
      var el=$('leitor-estimativa'); if(el)el.textContent='Não foi possível estimar o tempo agora.';
    });
  },250);
}

function montar(){
  var ids=marcadas(); if(!ids.length)return;
  var e=st.ultimaEstimativa;
  if(e&&e.pecas===ids.length&&e.exigeConfirmacao){
    var ok=window.confirm('São '+ids.length+' peças. Montar o PDF deve levar entre '+
      minutos(e.minimoSegundos)+' e '+minutos(e.maximoSegundos)+
      ', consultando o tribunal com o seu acesso. Continuar?');
    if(!ok)return;
  }
  var b=$('leitor-montar'); if(b){b.disabled=true;b.innerHTML='<span class="gira"></span>Pedindo'}
  pv().api(base(),{method:'POST',body:{pecas:ids}}).then(function(job){
    st.marcando=false;
    var bm=$('leitor-marcar'); if(bm)bm.textContent='Marcar peças';
    document.querySelectorAll('label.sel').forEach(function(l){l.remove()});
    mostrarJob(job);
  }).catch(function(err){
    if(b){b.disabled=false;b.textContent='Montar PDF com '+ids.length+' peças'}
    var el=$('leitor-estimativa'); if(el)el.innerHTML=erroTexto(err);
  });
}

/* ---------- o pedido em andamento: estados honestos ---------- */
function pararPoll(){if(st.timer){clearTimeout(st.timer);st.timer=null}}
function agendarPoll(ms){
  pararPoll();
  st.timer=setTimeout(function(){
    if(!st.job)return;
    pv().api(base()+'/'+encodeURIComponent(st.job.jobId)).then(function(j){
      st.erroPoll=0;mostrarJob(j);
    }).catch(function(e){
      st.erroPoll++;
      /* Três falhas seguidas e a tela PARA de tentar e diz por quê, com botão.
         Girar para sempre seria mentir que algo está acontecendo. */
      if(st.erroPoll>=3){
        estado(erroTexto(e)+'<div style="margin-top:8px"><button class="bt bt2" '+
          'id="leitor-retentar">Consultar de novo</button></div>');
        var r=$('leitor-retentar');
        if(r)r.addEventListener('click',function(){st.erroPoll=0;agendarPoll(0)});
        return;
      }
      agendarPoll(4000);
    });
  },ms);
}

function procedencia(j){
  var p=j.procedencia||{};
  return 'Montado em '+esc(pv().dth(p.baixadoEm))+' com o que o tribunal entregou '+
    'naquele momento, pelo seu acesso'+(p.credencial?' ('+esc(p.credencial)+')':'')+
    ' — <strong>não é consulta ao vivo</strong>.'+
    (p.expiraEm?' Guardado até '+esc(pv().dth(p.expiraEm))+'.':'');
}

function mostrarJob(j){
  var mudou=!st.job||st.job.jobId!==j.jobId;
  st.job=j;
  if(st.marcando)return;
  var h='';
  var ativo=j.estado==='na_fila'||j.estado==='baixando'||j.estado==='montando';
  if(ativo){
    var pct=j.total?Math.round(100*(j.baixadas+j.recusadas.length)/j.total):0;
    if(j.estado==='na_fila')h+='<strong>Na fila.</strong> Começa assim que o pedido anterior '+
      'terminar — um de cada vez, para não sobrecarregar o tribunal.';
    else if(j.estado==='baixando')h+='<strong>Baixando do tribunal:</strong> '+j.baixadas+
      ' de '+j.total+' peças'+(j.recusadas.length?' · '+j.recusadas.length+' não vieram':'')+'.';
    else h+='<strong>Montando o PDF</strong> com '+j.total+' peças…';
    h+='<div class="barra-prog"><i style="width:'+(j.estado==='montando'?100:pct)+'%"></i></div>';
    var parado=Date.now()-Date.parse(j.atualizadoEm)>PARADO_MS;
    h+='<div class="nota">'+(parado
      ? 'Sem progresso desde '+esc(hora(j.atualizadoEm))+'. O servidor continua tentando; '+
        'se ficar assim, avise o suporte.'
      : 'Atualizado às '+esc(hora(j.atualizadoEm))+'.')+'</div>';
    estado(h);
    agendarPoll(2000);
    return;
  }
  if(j.estado==='pausado_por_bloqueio'){
    estado('<strong style="color:var(--atencao)">Pausado pelo tribunal.</strong> O tribunal '+
      'bloqueou temporariamente as consultas deste servidor. A montagem continua sozinha '+
      'por volta das <strong>'+esc(hora(j.retomarEm))+'</strong>, de onde parou — não '+
      'precisa pedir de novo. '+j.baixadas+' de '+j.total+' peças já vieram.');
    agendarPoll(30000);
    return;
  }
  pararPoll();
  if(j.estado==='falhou'){
    estado('<strong style="color:var(--erro)">Não foi possível montar o PDF.</strong> '+
      esc(j.mensagem||'')+'<div class="nota">Use "Marcar peças" para pedir de novo.</div>');
    return;
  }
  if(j.estado==='expirado'){
    estado('<strong>O PDF anterior foi apagado</strong> ao fim do prazo de guarda. '+
      'Use "Marcar peças" para montar de novo.');
    return;
  }
  // pronto ou parcial
  h+=j.estado==='pronto'
    ? '<strong style="color:var(--verde-tinta)">Pronto</strong> · '+j.total+' peças, '+j.paginas+' páginas. '
    : '<strong style="color:var(--atencao)">Parcial</strong> · '+j.baixadas+' de '+j.total+
      ' peças vieram; as que faltaram têm uma página de aviso no lugar. ';
  h+='<div class="nota">'+procedencia(j)+'</div>';
  if(j.recusadas&&j.recusadas.length){
    h+='<ul class="faltou">';
    j.recusadas.forEach(function(r){
      h+='<li><b>'+esc(r.rotulo)+'</b> — '+esc(r.descricao)+'</li>';
    });
    h+='</ul>';
  }
  h+='<div style="margin-top:8px"><button class="bt bt2" id="leitor-atualizar">'+
    'Atualizar com peças novas</button></div>';
  estado(h);
  var at=$('leitor-atualizar');
  if(at)at.addEventListener('click',function(){
    at.disabled=true;at.innerHTML='<span class="gira"></span>Conferindo o tribunal';
    pv().api(base()+'/'+encodeURIComponent(j.jobId)+'/atualizar',{method:'POST'})
      .then(function(r){
        if(r.semMudanca){at.disabled=false;at.textContent='Nada novo no tribunal';return}
        st.indice=null;mostrarJob(r);
      }).catch(function(e){at.disabled=false;at.textContent='Atualizar com peças novas';
        estado(erroTexto(e))});
  });
  if(mudou||!st.pdf)carregarDocumento(j);
}

/* ---------- o PDF ---------- */
function carregarDocumento(j){
  var area=$('leitor-paginas'); if(!area)return;
  if(st.observador)st.observador.disconnect();
  if(st.pdf){try{st.pdf.destroy()}catch(e){}st.pdf=null}
  st.desenhadas=[];st.textos={};st.busca={id:st.busca.id+1,termo:'',paginas:[],i:-1};
  area.innerHTML='<div class="vazio-leitor"><span class="gira"></span>Abrindo o PDF…</div>';
  var url=base()+'/'+encodeURIComponent(j.jobId)+'/pdf';
  var chave=pv().chave();
  Promise.all([
    pv().api(base()+'/'+encodeURIComponent(j.jobId)+'/indice'),
    import(PDFJS+'pdf.min.mjs')
  ]).then(function(r){
    st.indice=r[0].indice||[];
    st.lib=r[1];
    st.lib.GlobalWorkerOptions.workerSrc=PDFJS+'pdf.worker.min.mjs';
    return st.lib.getDocument({url:url,
      httpHeaders:chave?{'x-api-key':chave}:{},withCredentials:true,
      /* Por trechos: só o que a tela precisa. disableAutoFetch impede o PDF.js
         de baixar o resto em segundo plano; disableStream força Range. */
      disableAutoFetch:true,disableStream:true,rangeChunkSize:262144,
      standardFontDataUrl:PDFJS,wasmUrl:PDFJS,iccUrl:PDFJS,cMapUrl:PDFJS,cMapPacked:true,
      isEvalSupported:false,enableXfa:false}).promise;
  }).then(function(pdf){
    st.pdf=pdf;
    return pdf.getPage(1).then(function(p1){
      var v=p1.getViewport({scale:1});
      st.larguraBase=v.width;st.alturaBase=v.height;
      $('leitor-ferramentas').classList.remove('oculto');
      preencherIrPara();
      relayout();
      ligarLinhaDoTempo();
    });
  }).catch(function(e){
    area.innerHTML='<div class="vazio-leitor" style="color:var(--erro)">Não foi possível abrir '+
      'o PDF: '+esc(e&&e.message?e.message:'erro')+'. <button class="bt bt2" '+
      'id="leitor-reabrir-pdf">Tentar de novo</button></div>';
    var b=$('leitor-reabrir-pdf');
    if(b)b.addEventListener('click',function(){carregarDocumento(j)});
  });
}

function preencherIrPara(){
  var s=$('leitor-ir'); if(!s)return;
  var h='<option value="">Ir para a peça…</option>';
  (st.indice||[]).forEach(function(e,i){
    h+='<option value="'+e.paginaInicial+'">'+(i+1)+'. '+esc(e.rotulo)+' — p. '+
      e.paginaInicial+(e.situacao==='nao_obtida'?' (não obtida)':'')+'</option>';
  });
  s.innerHTML=h;
}

function escalaAtual(){
  var area=$('leitor-paginas');
  if(st.zoom==='largura'){
    var w=(area?area.clientWidth:600)-24;
    return Math.max(0.3,w/(st.larguraBase||600));
  }
  return st.escala;
}
function mudarZoom(d){
  var atual=escalaAtual();
  st.escala=Math.max(0.3,Math.min(4,Math.round((atual+d*0.2)*10)/10));
  st.zoom='fixo';relayout();
}

/* Um quadro por página, do tamanho certo, sem desenhar nada. Quem desenha é o
   observador, quando o quadro chega perto da tela. */
function relayout(){
  var area=$('leitor-paginas'); if(!area||!st.pdf)return;
  var pagina=st.pagina;
  var s=escalaAtual();
  if(st.observador)st.observador.disconnect();
  st.desenhadas=[];
  var h='';
  for(var i=1;i<=st.pdf.numPages;i++){
    h+='<div class="pagina" data-p="'+i+'" style="width:'+Math.round(st.larguraBase*s)+
      'px;height:'+Math.round(st.alturaBase*s)+'px"><span class="num">'+i+'</span></div>';
  }
  area.innerHTML=h;
  st.observador=new IntersectionObserver(function(entradas){
    entradas.forEach(function(en){
      if(en.isIntersecting)desenhar(Number(en.target.getAttribute('data-p')));
    });
  },{root:area,rootMargin:'800px 0px'});
  area.querySelectorAll('.pagina').forEach(function(d){st.observador.observe(d)});
  marcarAchadas();
  irParaPagina(pagina,true);
}

function quadro(n){var a=$('leitor-paginas');return a?a.querySelector('[data-p="'+n+'"]'):null}

/* "largura" vale POR PÁGINA: o PDF combinado mistura A4 do tribunal, páginas
   de outro tamanho e as que o sistema gerou. Uma escala só, tirada da página
   1, faria as maiores estourarem a lateral. */
function escalaDa(pg){
  if(st.zoom!=='largura')return st.escala;
  var area=$('leitor-paginas');
  return Math.max(0.3,((area?area.clientWidth:600)-24)/pg.getViewport({scale:1}).width);
}

function desenhar(n){
  if(!st.pdf||st.desenhadas.indexOf(n)>=0)return;
  st.desenhadas.push(n);
  st.pdf.getPage(n).then(function(pg){
    var d=quadro(n), area=$('leitor-paginas'); if(!d||!area)return;
    var v=pg.getViewport({scale:escalaDa(pg)});
    /* A página desenhada pode ter altura diferente da prevista. Se ela está
       ACIMA do que a pessoa lê, a diferença empurraria a leitura — então a
       rolagem compensa, e a página que estava na tela continua lá. */
    var antes=d.offsetHeight, acima=d.offsetTop<area.scrollTop;
    var dpr=window.devicePixelRatio||1;
    var c=document.createElement('canvas');
    c.width=Math.floor(v.width*dpr);c.height=Math.floor(v.height*dpr);
    d.style.width=Math.round(v.width)+'px';d.style.height=Math.round(v.height)+'px';
    if(acima)area.scrollTop+=d.offsetHeight-antes;
    var ctx=c.getContext('2d');
    var antigo=d.querySelector('canvas'); if(antigo)antigo.remove();
    d.insertBefore(c,d.firstChild);
    return pg.render({canvasContext:ctx,viewport:v,
      transform:dpr!==1?[dpr,0,0,dpr,0,0]:null}).promise;
  }).catch(function(){
    var i=st.desenhadas.indexOf(n); if(i>=0)st.desenhadas.splice(i,1);
  });
  // As mais longe da página atual saem da memória.
  while(st.desenhadas.length>MAX_DESENHADAS){
    var longe=st.desenhadas.slice().sort(function(a,b){
      return Math.abs(b-st.pagina)-Math.abs(a-st.pagina)})[0];
    st.desenhadas.splice(st.desenhadas.indexOf(longe),1);
    var q=quadro(longe); var cv=q&&q.querySelector('canvas'); if(cv)cv.remove();
  }
}

function irParaPagina(n,silencioso){
  var area=$('leitor-paginas'), d=quadro(n); if(!area||!d)return;
  area.scrollTop=d.offsetTop-8;
  st.pagina=n;
  if(!silencioso)document.body.classList.remove('leitor-escondido');
  atualizarOnde();
}

var rolando=null;
function aoRolar(){
  if(rolando)return;
  rolando=setTimeout(function(){
    rolando=null;
    var area=$('leitor-paginas'); if(!area||!st.pdf)return;
    var topo=area.scrollTop+area.clientHeight/3;
    var achado=1;
    area.querySelectorAll('.pagina').forEach(function(d){
      if(d.offsetTop<=topo)achado=Number(d.getAttribute('data-p'));
    });
    if(achado!==st.pagina){st.pagina=achado;atualizarOnde()}
  },120);
}

function entradaDaPagina(n){
  var l=st.indice||[];
  for(var i=0;i<l.length;i++){if(n>=l[i].paginaInicial&&n<=l[i].paginaFinal)return{e:l[i],i:i}}
  return null;
}

/* Rolar o PDF destaca a peça na linha do tempo: a régua é o índice. */
function atualizarOnde(){
  var pg=$('leitor-pg'); if(pg&&st.pdf)pg.textContent='p. '+st.pagina+' de '+st.pdf.numPages;
  var x=entradaDaPagina(st.pagina), onde=$('leitor-onde');
  if(onde)onde.innerHTML=x?('<strong>'+esc(x.e.rotulo)+'</strong> · peça '+(x.i+1)+' de '+
    st.indice.length+' · p. '+x.e.paginaInicial+'–'+x.e.paginaFinal+
    (x.e.motivo?' · '+esc(x.e.motivo):'')):'';
  var id=x?x.e.pecaId:null;
  if(id===st.destaque)return;
  document.querySelectorAll('.no-leitor').forEach(function(el){el.classList.remove('no-leitor')});
  st.destaque=id;
  if(!id)return;
  document.querySelectorAll('#conteudo [data-peca]').forEach(function(el){
    if(el.getAttribute('data-peca')===id)el.classList.add('no-leitor');
  });
}

/* Na linha do tempo, ao lado de cada peça que está no PDF, o atalho "p. N". */
function ligarLinhaDoTempo(){
  if(!st.indice)return;
  var porId={};
  st.indice.forEach(function(e){porId[e.pecaId]=e});
  document.querySelectorAll('#conteudo [data-peca]').forEach(function(el){
    var id=el.getAttribute('data-peca'), e=porId[id];
    if(!e)return;
    var prox=el.nextElementSibling;
    if(prox&&prox.classList.contains('ir-pagina'))return;
    var b=document.createElement('button');
    b.className='ir-pagina';b.title='abrir no leitor';
    b.textContent='p. '+e.paginaInicial;
    b.addEventListener('click',function(){irParaPagina(e.paginaInicial)});
    el.parentNode.insertBefore(b,el.nextSibling);
  });
  st.destaque=null;atualizarOnde();
}

/* ---------- busca no texto ---------- */
function normal(t){
  return String(t||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
}
function textoDaPagina(n){
  if(st.textos[n]!==undefined)return Promise.resolve(st.textos[n]);
  return st.pdf.getPage(n).then(function(pg){return pg.getTextContent()}).then(function(tc){
    var t=normal(tc.items.map(function(i){return i.str||''}).join(' '));
    st.textos[n]=t;return t;
  });
}
function buscar(){
  var termo=normal($('leitor-busca').value).trim();
  var id=++st.busca.id;
  st.busca={id:id,termo:termo,paginas:[],i:-1};
  marcarAchadas();
  var onde=$('leitor-onde');
  if(!termo||!st.pdf)return;
  var total=st.pdf.numPages, n=1;
  function passo(){
    if(st.busca.id!==id)return;   // outra busca começou: esta para
    if(n>total){
      var k=st.busca.paginas.length;
      if(onde)onde.textContent=k?(k+' página(s) com "'+$('leitor-busca').value+'"')
        :'Nenhuma ocorrência. Páginas digitalizadas sem camada de texto não podem ser pesquisadas.';
      $('leitor-prox').classList.toggle('oculto',!k);
      $('leitor-ant').classList.toggle('oculto',!k);
      if(k)pularOcorrencia(1);
      return;
    }
    if(onde)onde.textContent='Procurando… p. '+n+' de '+total;
    textoDaPagina(n).then(function(t){
      if(t.indexOf(termo)>=0){st.busca.paginas.push(n);marcarAchadas()}
      n++;passo();
    }).catch(function(){n++;passo()});
  }
  passo();
}
function marcarAchadas(){
  var a=$('leitor-paginas'); if(!a)return;
  a.querySelectorAll('.pagina.achada').forEach(function(d){d.classList.remove('achada')});
  st.busca.paginas.forEach(function(n){var d=quadro(n); if(d)d.classList.add('achada')});
}
function pularOcorrencia(d){
  var l=st.busca.paginas; if(!l.length)return;
  st.busca.i=(st.busca.i+d+l.length)%l.length;
  irParaPagina(l[st.busca.i]);
  var onde=$('leitor-onde');
  if(onde)onde.textContent='Ocorrência '+(st.busca.i+1)+' de '+l.length+' páginas · p. '+l[st.busca.i];
}

/* ---------- baixar ---------- */
function baixar(){
  if(!st.job)return;
  var b=$('leitor-baixar'); b.disabled=true;b.textContent='baixando…';
  var chave=pv().chave();
  fetch(base()+'/'+encodeURIComponent(st.job.jobId)+'/pdf',
    {headers:chave?{'x-api-key':chave}:{}})
    .then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.blob()})
    .then(function(blob){
      var u=URL.createObjectURL(blob), a=document.createElement('a');
      a.href=u;a.download='processo-'+soDigitos(st.numero)+'-pecas.pdf';
      document.body.appendChild(a);a.click();document.body.removeChild(a);
      URL.revokeObjectURL(u);b.disabled=false;b.textContent='Baixar PDF';
    }).catch(function(){b.disabled=false;b.textContent='falhou — tentar de novo'});
}

/* ---------- os ganchos ---------- */
window.__pvLeitor={
  /* Chamado pelo console depois de pintar as peças do processo. */
  aposDesenhar:function(numero,dados){
    if(soDigitos(numero)!==soDigitos(st.numero)){fechar();st=novoEstado(numero)}
    st.pecas=pecasDaRegua(dados);
    var b=document.getElementById('leitor-abrir');
    if(b&&!b.getAttribute('data-ligado')){
      b.setAttribute('data-ligado','1');
      b.addEventListener('click',abrirPainel);
    }
    if(!$('leitor'))return;
    // O redesenho do console apagou o que este script tinha posto na régua.
    injetarCaixas();
    ligarLinhaDoTempo();
  },
  trocouProcesso:function(numero){
    if(soDigitos(numero)!==soDigitos(st.numero))fechar();
  },
  fechar:fechar
};
})();
`;
