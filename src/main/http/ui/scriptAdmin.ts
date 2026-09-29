/**
 * Script da área administrativa. Arquivo separado do HTML só para revisão —
 * mesma convenção do console do assinante, em `ui/script.ts`.
 *
 * JavaScript puro, sem build: o servidor devolve isto dentro de uma tag
 * <script>. A credencial é HTTP Basic Auth, que o NAVEGADOR guarda por conta
 * própria depois do primeiro pedido — nenhuma linha aqui manda usuário ou
 * senha; o `fetch` de mesma origem já sai autenticado.
 *
 * `tests/http/admin-script.spec.ts` roda o ESLint dentro desta string, pela
 * mesma razão documentada em `tests/http/console-script.spec.ts`: nem `tsc`
 * nem `eslint` enxergam JavaScript escondido dentro de um `String.raw`.
 */
export const SCRIPT_ADMIN = String.raw`
(function(){
var $=function(i){return document.getElementById(i)};

var estado={aba:'assinaturas',assinaturas:null,chaves:null,chaveEmitida:null};

/* ---------------- utilidades (mesmas convenções de ui/script.ts) ---------------- */
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){
  return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function dt(iso){if(!iso)return'—';var d=new Date(iso);return isNaN(d)?'—':
  d.toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'})}
function dth(iso){if(!iso)return'—';var d=new Date(iso);return isNaN(d)?'—':
  d.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',
    month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}

function api(caminho,opcoes){
  opcoes=opcoes||{};
  var h={};
  if(opcoes.body)h['content-type']='application/json';
  return fetch(caminho,{method:opcoes.method||'GET',headers:h,
    body:opcoes.body?JSON.stringify(opcoes.body):undefined})
    .then(function(r){return r.json().catch(function(){return{}})
      .then(function(b){
        if(!r.ok){var e=new Error(b.mensagem||('HTTP '+r.status));
          e.status=r.status;e.codigo=b.erro;throw e}
        return b})});
}

function erroBloco(e){
  var msg=(e&&e.message)?e.message:'erro inesperado';
  return '<div class="cartao" style="border-color:var(--erro);background:var(--erro-bg)">'+
    '<div style="font-weight:700;color:var(--erro)">'+esc(msg)+'</div></div>';
}

/* ---------------- navegação ---------------- */
function irPara(aba){
  estado.aba=aba;
  $('nav-assinaturas').className=aba==='assinaturas'?'ativo':'';
  $('nav-chaves').className=aba==='chaves'?'ativo':'';
  render();
}

function render(){
  var c=$('conteudo');
  c.innerHTML='<div class="vazio"><span class="gira"></span>carregando…</div>';
  if(estado.aba==='chaves'){renderChaves()}else{renderAssinaturas()}
}

/* ---------------- assinaturas ---------------- */
function renderAssinaturas(){
  api('/admin/api/assinaturas').then(function(r){
    estado.assinaturas=r.assinaturas||[];
    desenharAssinaturas();
  }).catch(function(e){$('conteudo').innerHTML=erroBloco(e)});
}

function linhaAssinatura(a){
  return '<tr>'+
    '<td>'+esc(a.email||'(sem conta — chave de API)')+'</td>'+
    '<td>'+esc(a.nomeDoPlano)+(a.ehTeste?' <span class="selo">teste</span>':'')+'</td>'+
    '<td>'+esc(a.status)+'</td>'+
    '<td>'+dt(a.venceEm)+'</td>'+
    '<td class="t-sub">'+esc(a.observacao||'—')+'</td>'+
    '</tr>';
}

function desenharAssinaturas(){
  var linhas=estado.assinaturas.map(linhaAssinatura).join('');
  var tabela=estado.assinaturas.length===0
    ? '<div class="vazio"><p>Nenhuma assinatura cadastrada ainda.</p></div>'
    : '<div class="cartao sem-borda"><div class="tab-rolo"><table class="tab">'+
      '<thead><tr><th>Conta</th><th>Plano</th><th>Status</th><th>Vence em</th>'+
      '<th>Observação</th></tr></thead><tbody>'+linhas+'</tbody></table></div></div>';

  var h='';
  h+='<div class="titulo-secao"><div><h2>Assinaturas</h2>'+
    '<div class="sub">'+estado.assinaturas.length+' assinatura(s) cadastrada(s)</div>'+
    '</div><button class="bt2" id="bt-avisar">Enviar avisos de vencimento agora</button></div>';
  h+='<div id="resultado-avisar"></div>';

  h+='<div class="cartao"><h3 class="sec">Gerenciar por e-mail</h3>';
  h+='<div class="grade">';
  h+='<div><label class="rotulo">E-mail da conta</label><input id="in-email" placeholder="ana@escritorio.com.br"></div>';
  h+='</div>';
  h+='<div class="grade" style="margin-top:10px">';
  h+='<div><label class="rotulo">Plano</label><select id="in-plano">'+
    '<option value="acompanhamento">Acompanhamento</option>'+
    '<option value="pecas" selected>Peças</option>'+
    '<option value="ia">IA</option></select></div>';
  h+='<div><label class="rotulo">Meses</label><input id="in-meses" type="number" min="1" max="60" value="12"></div>';
  h+='<div><label class="rotulo">Observação (opcional)</label><input id="in-obs" placeholder="Pix 22/09"></div>';
  h+='</div>';
  h+='<div class="grade" style="margin-top:12px">'+
    '<button class="bt" id="bt-liberar">Liberar / renovar</button>'+
    '<button class="bt2" id="bt-cancelar">Cancelar assinatura</button>'+
    '</div>';
  h+='<div id="resultado-gerenciar" style="margin-top:12px"></div>';
  h+='</div>';

  h+=tabela;
  $('conteudo').innerHTML=h;

  $('bt-avisar').addEventListener('click',function(){
    var bt=$('bt-avisar');bt.disabled=true;
    api('/admin/api/assinaturas/avisar',{method:'POST'}).then(function(r){
      $('resultado-avisar').innerHTML='<div class="aviso" style="margin-top:10px">'+
        esc(r.avisados)+' aviso(s) enviado(s).</div>';
      bt.disabled=false;
    }).catch(function(e){
      $('resultado-avisar').innerHTML=erroBloco(e);
      bt.disabled=false;
    });
  });

  $('bt-liberar').addEventListener('click',function(){
    var email=$('in-email').value.trim();
    if(!email){$('resultado-gerenciar').innerHTML=erroBloco({message:'Informe o e-mail da conta.'});return}
    var corpo={plano:$('in-plano').value,meses:Number($('in-meses').value)||12};
    var obs=$('in-obs').value.trim();
    if(obs)corpo.observacao=obs;
    api('/admin/api/assinaturas/'+encodeURIComponent(email)+'/liberar',
      {method:'POST',body:corpo}).then(function(r){
        $('resultado-gerenciar').innerHTML='<div class="aviso">'+esc(email)+': plano '+
          esc(r.nomeDoPlano)+', vence em '+dt(r.venceEm)+'.</div>';
        renderAssinaturas();
      }).catch(function(e){$('resultado-gerenciar').innerHTML=erroBloco(e)});
  });

  $('bt-cancelar').addEventListener('click',function(){
    var email=$('in-email').value.trim();
    if(!email){$('resultado-gerenciar').innerHTML=erroBloco({message:'Informe o e-mail da conta.'});return}
    if(!window.confirm('Cancelar a assinatura de '+email+'?'))return;
    var obs=$('in-obs').value.trim();
    api('/admin/api/assinaturas/'+encodeURIComponent(email)+'/cancelar',
      {method:'POST',body:obs?{observacao:obs}:{}}).then(function(){
        $('resultado-gerenciar').innerHTML='<div class="aviso">'+esc(email)+': assinatura cancelada.</div>';
        renderAssinaturas();
      }).catch(function(e){$('resultado-gerenciar').innerHTML=erroBloco(e)});
  });
}

/* ---------------- chaves de API ---------------- */
function renderChaves(){
  api('/admin/api/chaves').then(function(r){
    estado.chaves=r.chaves||[];
    desenharChaves();
  }).catch(function(e){$('conteudo').innerHTML=erroBloco(e)});
}

function linhaChave(c){
  var status=c.revogadaEm?'<span class="selo al">revogada</span>':'<span class="selo">ativa</span>';
  var acao=c.revogadaEm?'':'<button class="bt3" data-revogar="'+esc(c.identificador)+'">revogar</button>';
  return '<tr>'+
    '<td>'+esc(c.rotulo)+'</td>'+
    '<td class="t-sub">'+esc(c.identificador)+'</td>'+
    '<td>'+status+'</td>'+
    '<td>'+dth(c.criadaEm)+'</td>'+
    '<td>'+acao+'</td>'+
    '</tr>';
}

function desenharChaves(){
  var linhas=estado.chaves.map(linhaChave).join('');
  var tabela=estado.chaves.length===0
    ? '<div class="vazio"><p>Nenhuma chave emitida ainda.</p></div>'
    : '<div class="cartao sem-borda"><div class="tab-rolo"><table class="tab">'+
      '<thead><tr><th>Rótulo</th><th>Identificador</th><th>Status</th>'+
      '<th>Criada em</th><th></th></tr></thead><tbody>'+linhas+'</tbody></table></div></div>';

  var h='';
  h+='<div class="titulo-secao"><div><h2>Chaves de API</h2>'+
    '<div class="sub">Cada chave abre um ambiente isolado próprio — o mesmo '+
    'modelo das chaves do arquivo de configuração.</div></div></div>';

  if(estado.chaveEmitida){
    var ch=estado.chaveEmitida;
    h+='<div class="cartao alerta"><h3 class="sec">Chave emitida — copie agora</h3>'+
      '<p class="nota">Esta é a ÚNICA vez que o valor aparece. Ela não fica salva em '+
      'lugar nenhum além deste momento — se perder, revogue e gere outra.</p>'+
      '<div class="t-in" style="font-family:ui-monospace,monospace;user-select:all;padding:10px;margin:8px 0">'+
      esc(ch.chave)+'</div>'+
      '<button class="bt2" id="bt-copiar">Copiar</button>'+
      '<button class="bt3" id="bt-fechar-chave">Já copiei, fechar</button></div>';
  }

  h+='<div class="cartao"><h3 class="sec">Emitir chave nova</h3>';
  h+='<div class="grade">'+
    '<div><label class="rotulo">Rótulo</label><input id="in-rotulo" placeholder="n8n, script de cobrança…"></div>'+
    '<div class="compacto" style="align-self:flex-end"><button class="bt" id="bt-emitir">Gerar chave</button></div>'+
    '</div>';
  h+='<div id="resultado-emitir" style="margin-top:10px"></div>';
  h+='</div>';

  h+=tabela;
  $('conteudo').innerHTML=h;

  if(estado.chaveEmitida){
    $('bt-copiar').addEventListener('click',function(){
      if(navigator.clipboard){navigator.clipboard.writeText(estado.chaveEmitida.chave).catch(function(){})}
    });
    $('bt-fechar-chave').addEventListener('click',function(){
      estado.chaveEmitida=null;
      desenharChaves();
    });
  }

  $('bt-emitir').addEventListener('click',function(){
    var rotulo=$('in-rotulo').value.trim();
    if(!rotulo){$('resultado-emitir').innerHTML=erroBloco({message:'Informe um rótulo para a chave.'});return}
    var bt=$('bt-emitir');bt.disabled=true;
    api('/admin/api/chaves',{method:'POST',body:{rotulo:rotulo}}).then(function(r){
      estado.chaveEmitida=r;
      bt.disabled=false;
      renderChaves();
    }).catch(function(e){
      $('resultado-emitir').innerHTML=erroBloco(e);
      bt.disabled=false;
    });
  });

  var botoesRevogar=document.querySelectorAll('[data-revogar]');
  for(var i=0;i<botoesRevogar.length;i++){
    (function(bt){
      bt.addEventListener('click',function(){
        var id=bt.getAttribute('data-revogar');
        if(!window.confirm('Revogar a chave "'+id+'"? Quem a usa perde acesso imediatamente.'))return;
        api('/admin/api/chaves/'+encodeURIComponent(id)+'/revogar',{method:'POST'})
          .then(function(){renderChaves()})
          .catch(function(e){$('resultado-emitir').innerHTML=erroBloco(e)});
      });
    })(botoesRevogar[i]);
  }
}

/* ---------------- arranque ---------------- */
$('nav-assinaturas').addEventListener('click',function(){irPara('assinaturas')});
$('nav-chaves').addEventListener('click',function(){irPara('chaves')});
render();
})();
`;
