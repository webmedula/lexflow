/**
 * Script do console. Arquivo separado do HTML apenas para revisão.
 *
 * JavaScript puro de propósito: a página é uma string que o servidor devolve,
 * sem build, sem framework e sem recurso externo. Nada para compilar e nada que
 * quebre em deploy.
 */
export const SCRIPT = String.raw`
(function(){
var $=function(i){return document.getElementById(i)};
var CH='lexflow.chave', VER='lexflow.verinternos';
var FILTRO_MOV='lexflow.filtroMov';
/** Textos completos dos andamentos exibidos, para o botão "ler o ato inteiro". */
var janelaTextos=[];

function recorte(t,n){
  var x=String(t).replace(/\s+/g,' ').trim();
  return x.length<=n?x:x.slice(0,n-1)+'…';
}
function chip(id,rotulo,atual){
  return '<button class="chip'+(atual===id?' on':'')+'" data-chip="'+id+'">'+rotulo+'</button>';
}
/** Data e hora — a hora importa quando se conta prazo. */
function dth(v){
  if(!v)return '—';
  try{return new Date(v).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',
    day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}
  catch(e){return '—'}
}
function redesenharDetalhe(){
  if(estado.detalhe)abrir(estado.detalhe); else executarBusca();
}

/* Códigos da Tabela Processual Unificada vistos numa resposta REAL do TJGO.
   A classificação é palpite de quem não advoga — por isso NADA é escondido de
   verdade: os internos ficam a um clique, com a contagem à vista. Sumir com
   movimentação em silêncio é como se perde prazo. */
var INTERNOS={12266:1,12265:1,581:1,60:1};
var MARCOS={26:1,219:1,848:1,12548:1,12455:1,12444:1,14739:1,123:1,1051:1};

var estado={aba:'novidades',chave:'',detalhe:null,facetas:{tribunais:[],classes:[]}};

/* ---------------- utilidades ---------------- */
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){
  return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function dt(iso){if(!iso)return'—';var d=new Date(iso);return isNaN(d)?'—':
  d.toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'})}
function anoDe(iso){var d=new Date(iso);return isNaN(d)?'—':
  d.toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo',year:'numeric'})}
function humano(iso){
  if(!iso)return'';
  var n=Math.floor((Date.now()-new Date(iso).getTime())/86400000);
  if(isNaN(n))return'';
  if(n<=0)return'hoje'; if(n===1)return'ontem';
  if(n<30)return'há '+n+' dias';
  if(n<365){var m=Math.round(n/30);return'há '+m+(m===1?' mês':' meses')}
  var a=Math.floor(n/365);return'há '+a+(a===1?' ano':' anos')}
function mascara(n){var d=String(n||'').replace(/\D/g,'');
  return d.length===20?d.slice(0,7)+'-'+d.slice(7,9)+'.'+d.slice(9,13)+'.'+
    d.slice(13,14)+'.'+d.slice(14,16)+'.'+d.slice(16,20):String(n||'')}

function api(caminho,opcoes){
  opcoes=opcoes||{};
  var h={'x-api-key':estado.chave};
  if(opcoes.body)h['content-type']='application/json';
  return fetch(caminho,{method:opcoes.method||'GET',headers:h,
    body:opcoes.body?JSON.stringify(opcoes.body):undefined})
    .then(function(r){return r.json().catch(function(){return{}})
      .then(function(b){
        if(!r.ok){var e=new Error(b.mensagem||('HTTP '+r.status));
          e.status=r.status;e.codigo=b.erro;e.detalhes=b.detalhes;throw e}
        return b})});
}

function explicar(e){
  var m={401:'A chave não foi aceita. Confira se é a mesma configurada no servidor.',
    400:'O formato do número CNJ ou da OAB não confere.',
    404:'Consultamos as fontes e nenhuma tem esse processo.',
    429:'Muitas consultas seguidas. Aguarde um instante.',
    501:'Nenhuma fonte configurada faz essa busca. Verifique LEXFLOW_PROVIDER_CHAIN — a busca por OAB vem do DJEN.',
    502:'As fontes externas falharam. Em geral é o CNJ lento ou fora do ar.',
    503:'Fonte temporariamente indisponível.'};
  return m[e.status]||e.message||'Erro inesperado.';
}
function erroBloco(e){
  return '<div class="cartao" style="border-color:var(--erro);background:var(--erro-bg)">'+
    '<div style="font-weight:700;color:var(--erro);margin-bottom:4px">'+
    esc(e.message||'Falhou')+'</div><div style="color:var(--tinta2)">'+
    esc(explicar(e))+'</div></div>';
}
function vazio(icone,titulo,texto,acao){
  return '<div class="cartao vazio"><div class="ic">'+icone+'</div><h3>'+esc(titulo)+
    '</h3><p>'+esc(texto)+'</p>'+(acao||'')+'</div>';
}

/* ---------------- chrome ---------------- */
function pintarNav(){
  ['novidades','processos','buscar','vigilancia'].forEach(function(a){
    var b=$('nav-'+a); if(b)b.classList.toggle('ativo',estado.aba===a&&!estado.detalhe)});
}
function atualizarBolha(){
  api('/v1/novidades?limite=1').then(function(r){
    var b=$('bolha');
    if(r.naoVistas>0){b.textContent=r.naoVistas>99?'99+':r.naoVistas;b.classList.remove('oculto')}
    else b.classList.add('oculto');
  }).catch(function(){});
}

function ir(aba){estado.aba=aba;estado.detalhe=null;pintarNav();render()}
window.__lexflow_ir=ir;

/* ---------------- aba: novidades ---------------- */
function verNovidades(){
  var alvo=$('conteudo');
  alvo.innerHTML='<div class="cartao"><span class="gira"></span>Carregando…</div>';
  var q=[];
  if($('f-nv-naovistas')&&$('f-nv-naovistas').classList.contains('on'))q.push('naoVistas=true');
  var trib=window.__f_nv_trib||''; if(trib)q.push('tribunal='+encodeURIComponent(trib));

  api('/v1/novidades'+(q.length?'?'+q.join('&'):'')).then(function(r){
    var h='<div class="titulo-secao"><div><h2>Atualizações</h2>'+
      '<div class="sub">'+r.total+' movimentação(ões) desde que você começou a acompanhar'+
      (r.naoVistas>0?' · '+r.naoVistas+' não lida(s)':'')+'</div></div><div>';
    if(r.naoVistas>0)h+='<button class="bt bt2" id="marcar">Marcar todas como lidas</button> ';
    h+='<button class="bt bt2" id="sincronizar">Verificar agora</button></div></div>';

    h+='<div class="filtros">'+
       '<div class="compacto"><button class="chip'+
       (window.__f_nv_nv?' on':'')+'" id="f-nv-naovistas">Só não lidas</button></div>'+
       '<div class="compacto"><select id="f-nv-trib" style="min-width:150px">'+
       '<option value="">Todos os tribunais</option>'+
       estado.facetas.tribunais.map(function(t){
         return '<option value="'+esc(t)+'"'+(trib===t?' selected':'')+'>'+esc(t)+'</option>'}).join('')+
       '</select></div></div>';

    if(!r.novidades.length){
      h+=vazio('🔔','Nada novo por aqui',
        r.total===0
          ? 'Assim que um processo acompanhado tiver movimentação nova, ela aparece aqui. A verificação automática roda sozinha; você também pode disparar na hora.'
          : 'Nenhuma atualização com os filtros atuais.');
    }else{
      h+='<div class="cartao">';
      r.novidades.forEach(function(n){
        h+='<div class="nov'+(n.vista?'':' nl')+'">'+
          '<div class="q">'+dt(n.data)+'<br><span style="font-size:11px">'+
          humano(n.detectadaEm)+'</span></div><div>'+
          '<div class="t">'+esc(n.titulo)+(n.vista?'':' <span class="selo nv">novo</span>')+'</div>'+
          (n.conteudo?'<div class="nota">'+esc(n.conteudo)+'</div>':'')+
          '<div class="p" data-abrir="'+esc(n.numero)+'">'+mascara(n.numero)+'</div>'+
          '</div></div>';
      });
      h+='</div>';
    }
    alvo.innerHTML=h;

    if($('marcar'))$('marcar').addEventListener('click',function(){
      api('/v1/novidades/marcar-vistas',{method:'POST',body:{}})
        .then(function(){atualizarBolha();verNovidades()})});
    $('sincronizar').addEventListener('click',dispararSync);
    $('f-nv-naovistas').addEventListener('click',function(){
      window.__f_nv_nv=!window.__f_nv_nv;
      this.classList.toggle('on');verNovidades()});
    $('f-nv-trib').addEventListener('change',function(){
      window.__f_nv_trib=this.value;verNovidades()});
    alvo.querySelectorAll('[data-abrir]').forEach(function(el){
      el.addEventListener('click',function(){abrir(el.getAttribute('data-abrir'))})});
  }).catch(function(e){alvo.innerHTML=erroBloco(e)});
}

function dispararSync(){
  var b=$('sincronizar'); if(!b)return;
  b.disabled=true;b.innerHTML='<span class="gira"></span>Verificando';
  api('/v1/sincronizar',{method:'POST',body:{}})
    .then(function(){
      b.innerHTML='Verificação iniciada';
      var aviso=document.createElement('div');
      aviso.className='aviso';aviso.style.marginTop='10px';
      aviso.innerHTML='Varredura em andamento. Cada processo leva alguns segundos '+
        '(a base do CNJ é lenta), então as novidades vão aparecendo aos poucos. '+
        'Pode fechar a página — ela continua rodando no servidor.';
      b.parentNode.parentNode.appendChild(aviso);
      var t=setInterval(function(){
        api('/v1/sincronizacao').then(function(s){
          if(!s.emAndamento){clearInterval(t);atualizarBolha();verNovidades()}})
          .catch(function(){clearInterval(t)});
      },4000);
    })
    .catch(function(e){b.disabled=false;b.textContent='Verificar agora';alert(explicar(e))});
}

/* ---------------- aba: meus processos ---------------- */
function verProcessos(){
  var alvo=$('conteudo');
  alvo.innerHTML='<div class="cartao"><span class="gira"></span>Carregando…</div>';
  var f=window.__f_pr||{};
  var q=[];
  if(f.texto)q.push('texto='+encodeURIComponent(f.texto));
  if(f.tribunal)q.push('tribunal='+encodeURIComponent(f.tribunal));
  if(f.classe)q.push('classe='+encodeURIComponent(f.classe));
  if(f.novidade)q.push('comNovidade=true');
  if(f.dias)q.push('ultimosDias='+f.dias);
  if(f.ordem)q.push('ordem='+f.ordem);

  api('/v1/acompanhamentos'+(q.length?'?'+q.join('&'):'')).then(function(r){
    var h='<div class="titulo-secao"><div><h2>Meus processos</h2>'+
      '<div class="sub">'+r.total+' acompanhado(s)</div></div>'+
      '<button class="bt" id="ir-buscar">Adicionar processo</button></div>';

    h+='<div class="filtros">'+
      '<div style="flex:2 1 220px"><input id="f-txt" placeholder="Buscar por número, apelido, vara…" value="'+esc(f.texto||'')+'"></div>'+
      '<div><select id="f-trib"><option value="">Tribunal</option>'+
        estado.facetas.tribunais.map(function(t){return '<option'+(f.tribunal===t?' selected':'')+'>'+esc(t)+'</option>'}).join('')+'</select></div>'+
      '<div><select id="f-cls"><option value="">Classe</option>'+
        estado.facetas.classes.map(function(c){return '<option'+(f.classe===c?' selected':'')+'>'+esc(c)+'</option>'}).join('')+'</select></div>'+
      '<div><select id="f-dias"><option value="">Qualquer período</option>'+
        [['7','Últimos 7 dias'],['30','Últimos 30 dias'],['90','Últimos 90 dias'],['365','Último ano']]
          .map(function(o){return '<option value="'+o[0]+'"'+(f.dias===o[0]?' selected':'')+'>'+o[1]+'</option>'}).join('')+'</select></div>'+
      '<div><select id="f-ord">'+
        [['MOVIMENTACAO_RECENTE','Movimentação recente'],['ADICIONADO_RECENTE','Adicionado recente'],['NUMERO','Número']]
          .map(function(o){return '<option value="'+o[0]+'"'+(f.ordem===o[0]?' selected':'')+'>'+o[1]+'</option>'}).join('')+'</select></div>'+
      '<div class="compacto"><button class="chip'+(f.novidade?' on':'')+'" id="f-nv">Com novidade</button></div>'+
      '</div>';

    if(!r.acompanhamentos.length){
      h+=vazio('📁',
        (q.length?'Nenhum processo com esses filtros':'Você ainda não acompanha nenhum processo'),
        (q.length?'Ajuste os filtros para ver mais.'
          :'Busque um processo pelo número e clique em acompanhar. A partir daí o LexFlow verifica sozinho e avisa quando houver movimentação nova.'),
        q.length?'':'<button class="bt" onclick="window.__lexflow_ir(\'buscar\')">Buscar processo</button>');
    }else{
      r.acompanhamentos.forEach(function(a){
        h+='<button class="item'+(a.novidadesNaoVistas>0?' novo':'')+'" data-abrir="'+esc(a.numero)+'">'+
          '<div class="lin1"><span class="n">'+esc(a.numero)+'</span>'+
          (a.apelido?'<span class="ap">'+esc(a.apelido)+'</span>':'')+
          (a.novidadesNaoVistas>0?'<span class="selo nv">'+a.novidadesNaoVistas+' nova(s)</span>':'')+
          (a.segredoJustica?'<span class="selo al">segredo</span>':'')+
          (a.erro?'<span class="selo al">erro</span>':'')+'</div>'+
          '<div class="lin2">'+esc(a.tribunal||'—')+' · '+esc(a.classe||'classe não informada')+'</div>'+
          '<div class="lin3">'+
            (a.ultimaMovimentacao
              ? esc(a.ultimaMovimentacao.titulo)+' · '+dt(a.ultimaMovimentacao.data)+' ('+humano(a.ultimaMovimentacao.data)+')'
              : (a.erro?'não foi possível consultar: '+esc(a.erro):'aguardando primeira consulta'))+
          '</div></button>';
      });
    }
    alvo.innerHTML=h;

    $('ir-buscar').addEventListener('click',function(){ir('buscar')});
    var setF=function(k,v){window.__f_pr=Object.assign({},window.__f_pr,
      k==='reset'?{}:(function(o){o[k]=v;return o})({}));verProcessos()};
    $('f-trib').addEventListener('change',function(){setF('tribunal',this.value)});
    $('f-cls').addEventListener('change',function(){setF('classe',this.value)});
    $('f-dias').addEventListener('change',function(){setF('dias',this.value)});
    $('f-ord').addEventListener('change',function(){setF('ordem',this.value)});
    $('f-nv').addEventListener('click',function(){setF('novidade',!f.novidade)});
    var t; $('f-txt').addEventListener('input',function(){
      var v=this.value;clearTimeout(t);t=setTimeout(function(){setF('texto',v)},350)});
    alvo.querySelectorAll('[data-abrir]').forEach(function(el){
      el.addEventListener('click',function(){abrir(el.getAttribute('data-abrir'))})});
  }).catch(function(e){alvo.innerHTML=erroBloco(e)});
}

/* ---------------- aba: buscar ---------------- */
function verBuscar(){
  $('conteudo').innerHTML=
    '<div class="titulo-secao"><div><h2>Buscar processo</h2>'+
    '<div class="sub">Consulte pelo número CNJ ou pela OAB do advogado</div></div></div>'+
    '<div class="cartao"><div class="grade">'+
      '<div style="flex:0 0 168px"><label class="rotulo" for="modo">Consultar por</label>'+
      '<select id="modo"><option value="numero">Número do processo</option>'+
      '<option value="oab">OAB do advogado</option></select></div>'+
      '<div id="c-num"><label class="rotulo" for="numero">Número CNJ</label>'+
      '<input id="numero" placeholder="0311517-22.2015.8.09.0051" spellcheck="false"></div>'+
      '<div id="c-oab" class="oculto" style="flex:0 0 130px"><label class="rotulo" for="oab">Inscrição</label>'+
      '<input id="oab" placeholder="234567"></div>'+
      '<div id="c-uf" class="oculto" style="flex:0 0 84px"><label class="rotulo" for="uf">UF</label>'+
      '<input id="uf" placeholder="GO" maxlength="2"></div>'+
    '</div><div style="margin-top:14px;display:flex;gap:12px;align-items:center">'+
      '<button class="bt" id="bt-buscar">Consultar</button>'+
      '<span id="cron" style="font-size:13px;color:var(--tinta3)"></span></div>'+
      '<div id="espera" class="aviso oculto" style="margin-top:12px">A primeira consulta '+
      'de um processo pode levar até um minuto — a base do CNJ responde devagar quando o '+
      'dado ainda não está no cache dela.<div class="barra-prog"></div></div>'+
    '</div><div id="res"></div>';

  $('modo').addEventListener('change',function(){
    var o=this.value==='oab';
    $('c-num').classList.toggle('oculto',o);
    $('c-oab').classList.toggle('oculto',!o);
    $('c-uf').classList.toggle('oculto',!o)});
  $('bt-buscar').addEventListener('click',executarBusca);
  ['numero','oab','uf'].forEach(function(i){
    $(i).addEventListener('keydown',function(e){if(e.key==='Enter')executarBusca()})});
}

var cron=null;
function espera(on){
  if(on){var t0=Date.now();$('espera').classList.remove('oculto');
    cron=setInterval(function(){$('cron').textContent=Math.round((Date.now()-t0)/1000)+'s'},250)}
  else{clearInterval(cron);$('cron').textContent='';$('espera').classList.add('oculto')}
}

function executarBusca(){
  var porOab=$('modo').value==='oab', url;
  if(porOab){
    var o=$('oab').value.trim(),u=$('uf').value.trim().toUpperCase();
    if(!o||!u)return;
    url='/v1/advogados/'+encodeURIComponent(u)+'/'+encodeURIComponent(o)+'/processos';
  }else{
    var n=$('numero').value.trim(); if(!n)return;
    url='/v1/processos/'+encodeURIComponent(n);
  }
  $('bt-buscar').disabled=true;$('bt-buscar').innerHTML='<span class="gira"></span>Consultando';
  $('res').innerHTML='';espera(true);

  api(url).then(function(b){
    espera(false);$('bt-buscar').disabled=false;$('bt-buscar').textContent='Consultar';
    if(porOab){
      var l=b.processos||[];
      if(!l.length){$('res').innerHTML=vazio('🔍','Nenhum processo','Essa OAB não retornou processos nas fontes configuradas.');return}
      var h='<div class="titulo-secao"><h2>'+l.length+' processo(s)</h2>'+
        '<button class="bt bt2" id="bt-lote">Acompanhar todos</button></div>'+
        '<div class="nota" style="margin:-4px 0 12px">Vieram das publicações do '+
        'diário oficial. Processo sem publicação recente não aparece aqui.</div>';
      l.forEach(function(p){
        var um=(p.movimentacoes&&p.movimentacoes[0])||null;
        h+='<button class="item" data-num="'+esc(p.numero)+'"><div class="lin1">'+
          '<span class="n">'+esc(p.numero)+'</span></div>'+
          '<div class="lin2">'+esc(p.tribunal||'')+' · '+esc(p.classe||'')+'</div>'+
          (um?'<div class="lin3">'+esc(um.titulo)+' · '+dt(um.data)+'</div>':'')+'</button>';
      });
      $('res').innerHTML=h;
      ligarAcompanharLote(l.map(function(p){return p.numero}));
      $('res').querySelectorAll('[data-num]').forEach(function(el){
        el.addEventListener('click',function(){
          $('modo').value='numero';$('modo').dispatchEvent(new Event('change'));
          $('numero').value=el.getAttribute('data-num');executarBusca()})});
      return;
    }
    $('res').innerHTML=processoHtml(b,null,{buscaAvulsa:true});
    ligarBotoesDetalhe(b.numero,false);
  }).catch(function(e){
    espera(false);$('bt-buscar').disabled=false;$('bt-buscar').textContent='Consultar';
    $('res').innerHTML=erroBloco(e);
  });
}

/**
 * Acompanhar em lote o resultado de uma busca por OAB.
 *
 * É o fluxo que fecha o produto: o advogado digita a própria inscrição uma vez
 * e sai com a carteira inteira sob vigilância, em vez de recadastrar processo
 * por processo.
 *
 * Sequencial de propósito. Disparar 80 POSTs de uma vez faria o servidor abrir
 * 80 consultas às fontes ao mesmo tempo, estourar o rate limit e derrubar a
 * própria varredura. Devagar e mostrando o progresso é melhor do que rápido e
 * pela metade.
 */
function ligarAcompanharLote(numeros){
  var bt=$('bt-lote'); if(!bt)return;
  bt.addEventListener('click',function(){
    bt.disabled=true;
    var ok=0,falhou=0,i=0;
    function passo(){
      if(i>=numeros.length){
        bt.innerHTML=ok+' acompanhado(s)'+(falhou?' · '+falhou+' falhou(ram)':'');
        carregarFacetas();return;
      }
      bt.innerHTML='<span class="gira"></span>'+(i+1)+'/'+numeros.length;
      api('/v1/acompanhamentos',{method:'POST',body:{numero:numeros[i]}})
        .then(function(){ok++}).catch(function(){falhou++})
        .then(function(){i++;passo()});
    }
    passo();
  });
}

/* ---------------- detalhe ---------------- */
function abrir(numero){
  estado.detalhe=numero;pintarNav();
  var alvo=$('conteudo');
  alvo.innerHTML='<div class="cartao"><span class="gira"></span>Carregando…</div>';

  api('/v1/acompanhamentos/'+encodeURIComponent(numero)).then(function(a){
    if(a.processo){
      alvo.innerHTML='<button class="bt bt3" id="voltar">&larr; voltar</button>'+
        processoHtml(a.processo,a,{acompanhado:true});
      ligarBotoesDetalhe(numero,true);
    }else{
      alvo.innerHTML='<button class="bt bt3" id="voltar">&larr; voltar</button>'+
        vazio('⏳','Ainda sem dados deste processo',
          a.erro?('A última tentativa falhou: '+a.erro):'A primeira consulta ainda não completou.',
          '<button class="bt bt2" id="parar">Deixar de acompanhar</button>');
      ligarBotoesDetalhe(numero,true);
    }
    $('voltar').addEventListener('click',function(){estado.detalhe=null;pintarNav();render()});
    api('/v1/novidades/marcar-vistas',{method:'POST',body:{numero:numero}})
      .then(atualizarBolha).catch(function(){});
  }).catch(function(e){
    // Não acompanhado ainda: cai para a consulta avulsa.
    if(e.status===404){
      api('/v1/processos/'+encodeURIComponent(numero)).then(function(p){
        alvo.innerHTML='<button class="bt bt3" id="voltar">&larr; voltar</button>'+
          processoHtml(p,null,{buscaAvulsa:true});
        ligarBotoesDetalhe(numero,false);
        $('voltar').addEventListener('click',function(){estado.detalhe=null;pintarNav();render()});
      }).catch(function(e2){alvo.innerHTML=erroBloco(e2)});
      return;
    }
    alvo.innerHTML=erroBloco(e);
  });
}
window.__lexflow_abrir=abrir;

function ligarBotoesDetalhe(numero,acompanhado){
  var b=$('acompanhar');
  if(b)b.addEventListener('click',function(){
    b.disabled=true;b.innerHTML='<span class="gira"></span>Adicionando';
    api('/v1/acompanhamentos',{method:'POST',body:{numero:numero}})
      .then(function(){carregarFacetas();abrir(numero)})
      .catch(function(e){b.disabled=false;b.textContent='Acompanhar';alert(explicar(e))})});
  var p=$('parar');
  if(p)p.addEventListener('click',function(){
    api('/v1/acompanhamentos/'+encodeURIComponent(numero),{method:'DELETE'})
      .then(function(){carregarFacetas();atualizarBolha();ir('processos')})
      .catch(function(e){alert(explicar(e))})});
  void acompanhado;
}

function agrupar(movs){
  var out=[],ult=null;
  movs.forEach(function(m){
    var k=dt(m.data)+'|'+m.titulo;
    if(ult&&ult.k===k){ult.n++;return}
    ult={k:k,mov:m,n:1};out.push(ult)});
  return out;
}

/**
 * A tela de um processo.
 *
 * A ordem dos blocos MUDOU na v0.10.0, e a mudança é a coisa mais importante
 * desta tela: antes ela respondia "o que é este processo?" — número, classe,
 * vara, distribuição — quando a pergunta que o advogado faz ao abrir é "o que
 * eu preciso fazer?". Agora vem primeiro o que exige providência, depois o
 * último ato COM O TRECHO DO TEOR, e só então a ficha cadastral, que é consulta
 * ocasional e não leitura diária.
 */
function processoHtml(p,acomp,op){
  op=op||{};
  var movs=p.movimentacoes||[];
  var relev=movs.filter(function(m){return !INTERNOS[m.codigoTpu]});
  var ultima=relev[0]||movs[0]||null;
  // O campo exigeAcao vem do servidor (domain/entities/triagem.ts). A tela não
  // reclassifica: duas heurísticas para a mesma coisa divergem no dia em que
  // alguém ajusta só uma.
  var acoes=movs.filter(function(m){return m.exigeAcao}).slice(0,5);

  var h='<div class="capa"><div class="num">'+esc(p.numero)+'</div>'+
    '<div class="sob">'+esc(p.classe||'Classe não informada')+
    (p.assunto?' · '+esc(p.assunto):'')+'</div><div class="selos">'+
    '<span class="selo">'+esc(p.tribunal||'—')+'</span>'+
    (p.grau?'<span class="selo">'+esc(p.grau)+'</span>':'')+
    (p.segredoJustica?'<span class="selo al">segredo de justiça</span>':'')+
    (op.acompanhado?'<span class="selo nv">acompanhando</span>':'')+
    '</div>';
  h+='<div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap">';
  if(op.acompanhado)h+='<button class="bt bt2" id="parar">Deixar de acompanhar</button>';
  else h+='<button class="bt" id="acompanhar">Acompanhar este processo</button>';
  h+='</div></div>';

  // 1. O que pede providência. Primeiro bloco da página.
  if(acoes.length){
    h+='<div class="cartao alerta"><h3 class="sec">Pede providência · '+acoes.length+'</h3>';
    acoes.forEach(function(m){
      h+='<div class="acao"><div class="dt">'+dt(m.data)+'</div><div>'+
        '<div class="tt">'+esc(m.titulo)+'</div>'+
        (m.conteudo?'<div class="cp">'+esc(recorte(m.conteudo,260))+'</div>':'')+
        '</div></div>';
    });
    h+='<div class="nota">Marcado por leitura automática do texto (prazo, '+
      '"intime-se", "manifeste-se"). <strong>Confira sempre no ato completo</strong> — '+
      'a contagem do prazo é sua.</div></div>';
  }

  // 2. O último ato, com trecho do teor. Antes esta faixa mostrava só o rótulo
  //    ("Ato ordinatório"), que é categoria e não informação.
  if(ultima){
    h+='<div class="agora"><div class="k">Última movimentação</div>'+
      '<div class="t">'+esc(ultima.titulo)+'</div>'+
      '<div class="d">'+dt(ultima.data)+' · '+humano(ultima.data)+
      (ultima.fonte?' · via '+esc(ultima.fonte):'')+'</div>'+
      (ultima.conteudo?'<div class="cp">'+esc(recorte(ultima.conteudo,320))+'</div>':'')+
      (ultima.teorIndisponivel?'<div class="nota">O diário não publica o texto deste '+
        'documento'+(ultima.url?' — <a href="'+esc(ultima.url)+'" target="_blank" '+
        'rel="noopener noreferrer">abrir no tribunal</a>':'')+'.</div>':'')+
      '</div>';
  }

  // 3. Partes: quem está do outro lado importa mais que a data de distribuição.
  h+='<div class="cartao"><h3 class="sec">Partes</h3>';
  if(p.partes&&p.partes.length){
    p.partes.forEach(function(pt){
      h+='<div class="parte"><span class="selo">'+esc(pt.polo)+'</span> <strong>'+esc(pt.nome)+'</strong>';
      if(pt.advogados&&pt.advogados.length)
        h+='<div class="nota">'+pt.advogados.map(function(a){
          return esc(a.nome)+(a.oab?' — OAB '+esc(a.oab)+'/'+esc(a.ufOab||''):'')}).join(' · ')+'</div>';
      h+='</div>'});
  }else{
    h+='<div style="color:var(--tinta2)">Nenhuma parte informada. O DataJud publica só '+
      'metadados, e o DJEN só conhece quem foi intimado em alguma publicação — um '+
      'processo sem publicação recente no diário aparece sem partes.</div>';
  }
  h+='</div>';

  // 4. Ficha cadastral.
  h+='<div class="fatos">'+
    '<div class="fato"><div class="k">Vara</div><div class="v">'+esc(p.vara||'—')+'</div></div>'+
    '<div class="fato"><div class="k">Distribuição</div><div class="v">'+dt(p.dataDistribuicao)+'</div></div>'+
    '<div class="fato"><div class="k">Andamentos</div><div class="v">'+movs.length+'</div></div>'+
    // Com a HORA: verificado às 03h e verificado às 14h são coisas diferentes
    // quando se conta prazo.
    (acomp&&acomp.sincronizadoEm?'<div class="fato"><div class="k">Verificado</div><div class="v">'+
      humano(acomp.sincronizadoEm)+'</div><div class="k">'+dth(acomp.sincronizadoEm)+'</div></div>':'')+
    (p.procedencia&&p.procedencia.provider?'<div class="fato"><div class="k">Fontes</div>'+
      '<div class="v">'+esc(p.procedencia.provider)+'</div></div>':'')+
    (p.valorCausa!=null?'<div class="fato"><div class="k">Valor da causa</div><div class="v">'+
      p.valorCausa.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})+'</div></div>':'')+
    '</div>';

  // 5. Linha do tempo, filtrável e expansível.
  var ver=false; try{ver=localStorage.getItem(VER)==='1'}catch(e){}
  var filtro='tudo'; try{filtro=localStorage.getItem(FILTRO_MOV)||'tudo'}catch(e){}

  var base=ver?movs:movs.filter(function(m){return !INTERNOS[m.codigoTpu]});
  var vis=base;
  if(filtro==='acao')vis=base.filter(function(m){return m.exigeAcao});
  else if(filtro==='teor')vis=base.filter(function(m){return m.conteudo});
  var escond=movs.length-base.length, grupos=agrupar(vis);

  h+='<div class="cartao"><div class="titulo-secao" style="margin-bottom:6px">'+
    '<h3 class="sec" style="margin:0">Andamentos · '+grupos.length+' de '+movs.length+'</h3>'+
    ((escond>0||ver)?'<button class="bt bt2" id="alternar">'+
      (ver?'Recolher internos':'Mostrar '+escond+' interno(s)')+'</button>':'')+'</div>';

  h+='<div class="chips">'+
    chip('tudo','Tudo',filtro)+
    chip('acao','Pede providência',filtro)+
    chip('teor','Com inteiro teor',filtro)+
    '</div>';

  if(escond>0&&!ver)h+='<div class="nota" style="margin:0 0 10px">Recolhidos: confirmações, '+
    'expedições e juntadas de documento — registros de cartório que não mudam o estado do '+
    'processo. Nada foi descartado.</div>';

  if(!grupos.length)h+='<div class="nota">Nenhum andamento neste filtro.</div>';

  var anoAtual=null;
  grupos.forEach(function(g,idx){
    var a=anoDe(g.mov.data);
    if(a!==anoAtual){anoAtual=a;h+='<div class="ano">'+a+'</div>'}
    var m=g.mov, longo=m.conteudo&&m.conteudo.length>320;
    h+='<div class="ev'+(MARCOS[m.codigoTpu]?' marco':'')+(m.exigeAcao?' pede':'')+'">'+
      '<div class="dt">'+dt(m.data)+'</div><div>'+
      '<div class="tt">'+esc(m.titulo)+(g.n>1?' <span class="xn">×'+g.n+'</span>':'')+
      (m.exigeAcao?' <span class="selo al">providência</span>':'')+'</div>'+
      (m.complementos&&m.complementos.length?'<div class="cp">'+esc(m.complementos.join(' · '))+'</div>':'')+
      (m.conteudo?'<div class="cp" id="tx'+idx+'">'+esc(longo?recorte(m.conteudo,320):m.conteudo)+'</div>'+
        (longo?'<button class="link" data-ler="'+idx+'">ler o ato inteiro</button>':''):'')+
      (m.teorIndisponivel?'<div class="nota">Documento não público no diário'+
        (m.url?' — <a href="'+esc(m.url)+'" target="_blank" rel="noopener noreferrer">abrir no tribunal</a>':'')+
        '</div>':'')+
      '</div></div>';
  });
  h+='</div>';

  // Guardado fora do HTML para o botão "ler o ato inteiro" não precisar
  // reescrever a página inteira nem embutir 20 mil caracteres num atributo.
  janelaTextos=grupos.map(function(g){return g.mov.conteudo||''});

  setTimeout(function(){
    var b=$('alternar');
    if(b)b.addEventListener('click',function(){
      try{localStorage.setItem(VER,ver?'0':'1')}catch(e){}
      redesenharDetalhe();
    });
    document.querySelectorAll('[data-chip]').forEach(function(el){
      el.addEventListener('click',function(){
        try{localStorage.setItem(FILTRO_MOV,el.getAttribute('data-chip'))}catch(e){}
        redesenharDetalhe();
      })});
    document.querySelectorAll('[data-ler]').forEach(function(el){
      el.addEventListener('click',function(){
        var i=Number(el.getAttribute('data-ler'));
        var alvo=$('tx'+i);
        if(alvo){alvo.textContent=janelaTextos[i]||'';el.remove()}
      })});
  },0);
  return h;
}

/* ---------------- chave / arranque ---------------- */
function telaChave(){
  $('conteudo').innerHTML=
    '<div class="titulo-secao"><div><h2>Conectar</h2>'+
    '<div class="sub">Informe a chave de API configurada no servidor</div></div></div>'+
    '<div class="cartao"><label class="rotulo" for="k">Chave de API</label>'+
    '<input id="k" type="password" placeholder="cole a chave aqui" autocomplete="off">'+
    '<div class="nota">Fica guardada apenas neste navegador. É a mesma que está em '+
    'LEXFLOW_API_KEYS na configuração do servidor.</div>'+
    '<div style="margin-top:14px"><button class="bt" id="entrar">Entrar</button></div></div>';
  var entrar=function(){
    var v=$('k').value.trim(); if(!v)return;
    estado.chave=v; try{localStorage.setItem(CH,v)}catch(e){}
    iniciar();
  };
  $('entrar').addEventListener('click',entrar);
  $('k').addEventListener('keydown',function(e){if(e.key==='Enter')entrar()});
}

function carregarFacetas(){
  return api('/v1/facetas').then(function(f){estado.facetas=f}).catch(function(){});
}

/* ---------------- aba: vigilância por OAB e avisos ---------------- */
/**
 * A tela que muda a natureza do produto.
 *
 * Até aqui o usuário precisava saber o número do processo para acompanhá-lo —
 * ou seja, precisava já saber que o processo existe. Cadastrando a inscrição,
 * ele passa a ser avisado de processo que nem sabia que tinha.
 */
function verVigilancia(){
  $('conteudo').innerHTML=
    '<div class="titulo-secao"><div><h2>Vigilância por OAB</h2>'+
    '<div class="sub">Cadastre sua inscrição uma vez. Toda publicação nova no '+
    'seu nome entra sozinha na carteira.</div></div></div>'+

    '<div class="cartao"><h3 class="sec">Inscrições vigiadas</h3>'+
    '<div class="campo">'+
      '<div><label for="v-oab">Número da OAB</label>'+
      '<input id="v-oab" class="ent" placeholder="47383" style="width:150px"></div>'+
      '<div><label for="v-uf">UF</label>'+
      '<input id="v-uf" class="ent" placeholder="GO" maxlength="2" style="width:70px"></div>'+
      '<div><label for="v-apelido">Apelido (opcional)</label>'+
      '<input id="v-apelido" class="ent" placeholder="Dr. João" style="width:180px"></div>'+
      '<button class="bt" id="v-add">Vigiar</button>'+
    '</div>'+
    '<div id="v-lista"><span class="gira"></span>Carregando…</div></div>'+

    '<div class="cartao"><h3 class="sec">Aviso por e-mail</h3>'+
    '<div class="nota">Um resumo por ciclo, não um e-mail por movimentação. E, '+
    'igualmente importante: se ficarmos sem conseguir verificar, você é avisado '+
    'disso também — silêncio não deve ser lido como "não houve nada".</div>'+
    '<div class="campo">'+
      '<div><label for="n-email">Endereço</label>'+
      '<input id="n-email" class="ent" type="email" placeholder="voce@escritorio.com.br" style="width:260px"></div>'+
      '<button class="bt" id="n-salvar">Salvar</button>'+
      '<button class="bt bt2" id="n-desligar">Desligar avisos</button>'+
    '</div><div id="n-estado" class="nota"></div></div>';

  $('v-add').addEventListener('click',adicionarVigilancia);
  $('n-salvar').addEventListener('click',function(){salvarNotificacao(true)});
  $('n-desligar').addEventListener('click',function(){salvarNotificacao(false)});
  carregarVigilancias();
  carregarNotificacao();
}

function carregarVigilancias(){
  api('/v1/vigilancias').then(function(r){
    var l=r.vigilancias||[];
    if(!l.length){
      $('v-lista').innerHTML='<div class="nota">Nenhuma inscrição vigiada ainda.</div>';
      return;
    }
    $('v-lista').innerHTML=l.map(function(v){
      return '<div class="vig"><div>'+
        '<div class="id">OAB '+esc(v.identificacao)+(v.apelido?' · '+esc(v.apelido):'')+'</div>'+
        '<div class="nota">'+
          (v.ativa?'':'desligada · ')+
          v.processosEncontrados+' processo(s) trazidos · '+
          (v.varridaEm?'verificada '+humano(v.varridaEm):'ainda não verificada')+
          (v.erro?' · <span style="color:var(--al)">'+esc(v.erro)+'</span>':'')+
        '</div></div>'+
        '<button class="bt bt3" data-parar="'+esc(v.uf)+'/'+esc(v.oab)+'">remover</button>'+
        '</div>';
    }).join('');
    document.querySelectorAll('[data-parar]').forEach(function(el){
      el.addEventListener('click',function(){
        var partes=el.getAttribute('data-parar').split('/');
        api('/v1/vigilancias/'+encodeURIComponent(partes[0])+'/'+encodeURIComponent(partes[1]),
          {method:'DELETE'}).then(carregarVigilancias).catch(function(e){alert(explicar(e))});
      })});
  }).catch(function(e){$('v-lista').innerHTML=erroBloco(e)});
}

function adicionarVigilancia(){
  var oab=$('v-oab').value.trim(), uf=$('v-uf').value.trim().toUpperCase();
  var apelido=$('v-apelido').value.trim();
  if(!oab||uf.length!==2)return;
  var b=$('v-add'); b.disabled=true; b.innerHTML='<span class="gira"></span>Vigiando';
  api('/v1/vigilancias',{method:'POST',body:{oab:oab,uf:uf,apelido:apelido||undefined}})
    .then(function(){
      $('v-oab').value='';$('v-apelido').value='';
      carregarVigilancias();
      // Primeira varredura na hora: cadastrar e não ver nada acontecer por uma
      // hora passa a impressão de que não funcionou.
      return api('/v1/vigilancias/varrer',{method:'POST',body:{}});
    })
    .then(function(){
      $('v-lista').insertAdjacentHTML('afterbegin',
        '<div class="nota">Primeira varredura em andamento — os processos dos últimos '+
        '30 dias vão aparecer em Meus processos.</div>');
    })
    .catch(function(e){alert(explicar(e))})
    .then(function(){b.disabled=false;b.textContent='Vigiar'});
}

function carregarNotificacao(){
  api('/v1/notificacao').then(function(n){
    $('n-email').value=n.email||'';
    $('n-estado').textContent=n.ativa
      ? 'Avisos ligados'+(n.ultimoEnvioEm?' · último envio '+humano(n.ultimoEnvioEm):'')
      : 'Avisos desligados';
  }).catch(function(){});
}

function salvarNotificacao(ativa){
  var email=$('n-email').value.trim();
  api('/v1/notificacao',{method:'PUT',body:{email:email||undefined,ativa:ativa}})
    .then(carregarNotificacao)
    .catch(function(e){alert(explicar(e))});
}

function render(){
  if(estado.detalhe)return;
  if(estado.aba==='novidades')return verNovidades();
  if(estado.aba==='processos')return verProcessos();
  if(estado.aba==='vigilancia')return verVigilancia();
  return verBuscar();
}

function iniciar(){
  $('barra').classList.remove('oculto');
  api('/v1/facetas').then(function(f){
    estado.facetas=f;
    atualizarBolha();
    pintarNav();
    render();
  }).catch(function(e){
    if(e.status===401){estado.chave='';try{localStorage.removeItem(CH)}catch(x){}
      $('barra').classList.add('oculto');telaChave();return}
    $('conteudo').innerHTML=erroBloco(e);
  });
}

['novidades','processos','buscar','vigilancia'].forEach(function(a){
  var b=$('nav-'+a); if(b)b.addEventListener('click',function(){ir(a)})});
$('sair').addEventListener('click',function(){
  estado.chave='';try{localStorage.removeItem(CH)}catch(e){}
  $('barra').classList.add('oculto');telaChave()});

try{estado.chave=localStorage.getItem(CH)||''}catch(e){}
if(estado.chave)iniciar(); else telaChave();
})();
`;
