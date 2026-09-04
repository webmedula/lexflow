/**
 * Console web do LexFlow — servido pela própria API, na raiz.
 *
 * Por que existe: durante todo o desenvolvimento o sistema só tinha API. Abrir
 * a URL no navegador devolvia `{"erro":"NAO_AUTENTICADO"}`, porque navegador não
 * manda header customizado. Do lado de quem usa, isso é indistinguível de "o
 * sistema não funciona" — e para um SaaS, não existe sistema até existir tela.
 *
 * Sendo servida na MESMA ORIGEM da API, a página resolve o problema do header de
 * uma vez: o `fetch` daqui manda `x-api-key` sozinho, sem CORS, sem PowerShell,
 * sem curl.
 *
 * Deliberadamente sem build, sem framework e sem recurso externo: é uma string
 * que o servidor devolve. Nada para compilar, nada para quebrar em deploy, e
 * funciona mesmo se o CDN do mundo cair.
 *
 * Escopo: é um CONSOLE DE OPERAÇÃO, para você testar e conferir o serviço — não
 * o produto final. O produto terá contas de usuário, e a chave de API nunca
 * chegará ao navegador do advogado.
 */
export function paginaConsole(versao: string): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>LexFlow — Console</title>
<style>
  :root {
    color-scheme: light dark;
    --fundo: #f6f7f9;
    --superficie: #ffffff;
    --borda: #dfe3e8;
    --texto: #1a1d21;
    --suave: #5c6670;
    --acento: #1f5f8b;
    --acento-fraco: #e8f1f7;
    --erro: #9b2c2c;
    --erro-fraco: #fdeaea;
    --ok: #1f7a4d;
    --raio: 10px;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --fundo: #14171a;
      --superficie: #1c2024;
      --borda: #2e343a;
      --texto: #e8eaed;
      --suave: #99a2ab;
      --acento: #6cb2e0;
      --acento-fraco: #1b2c38;
      --erro: #f08a8a;
      --erro-fraco: #33201f;
      --ok: #6cc79a;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px 16px 64px;
    font: 15px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: var(--fundo); color: var(--texto);
  }
  .env { max-width: 780px; margin: 0 auto; }
  header { margin-bottom: 20px; }
  h1 { font-size: 20px; margin: 0 0 2px; letter-spacing: -0.01em; }
  .sub { color: var(--suave); font-size: 13px; }
  .cartao {
    background: var(--superficie); border: 1px solid var(--borda);
    border-radius: var(--raio); padding: 16px; margin-bottom: 16px;
  }
  label { display: block; font-size: 12px; font-weight: 600; color: var(--suave);
          text-transform: uppercase; letter-spacing: .04em; margin-bottom: 5px; }
  input, select {
    width: 100%; padding: 9px 11px; font: inherit; color: var(--texto);
    background: var(--fundo); border: 1px solid var(--borda);
    border-radius: 7px; outline: none;
  }
  input:focus, select:focus { border-color: var(--acento); }
  .linha { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 12px; }
  .linha > div { flex: 1 1 190px; }
  button {
    font: inherit; font-weight: 600; padding: 10px 18px; border: 0;
    border-radius: 7px; background: var(--acento); color: #fff; cursor: pointer;
  }
  button:disabled { opacity: .55; cursor: progress; }
  .acoes { margin-top: 14px; display: flex; gap: 10px; align-items: center; }
  .dica { font-size: 12px; color: var(--suave); margin-top: 8px; }
  .aviso { background: var(--acento-fraco); border-left: 3px solid var(--acento);
           padding: 10px 12px; border-radius: 5px; font-size: 13px; margin-top: 12px; }
  .erro { background: var(--erro-fraco); border-left: 3px solid var(--erro);
          padding: 12px 14px; border-radius: 5px; }
  .erro strong { color: var(--erro); display: block; margin-bottom: 3px; }
  .cod { font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--suave); }
  dl { display: grid; grid-template-columns: 160px 1fr; gap: 6px 14px; margin: 0; }
  dt { color: var(--suave); font-size: 13px; }
  dd { margin: 0; }
  .selo { display: inline-block; font-size: 11px; font-weight: 600; padding: 2px 8px;
          border-radius: 20px; background: var(--acento-fraco); color: var(--acento); }
  .selo.alerta { background: var(--erro-fraco); color: var(--erro); }
  h2 { font-size: 14px; text-transform: uppercase; letter-spacing: .05em;
       color: var(--suave); margin: 22px 0 10px; }
  .mov { border-left: 2px solid var(--borda); padding: 0 0 14px 14px; position: relative; }
  .mov::before { content: ""; position: absolute; left: -5px; top: 5px; width: 8px;
                 height: 8px; border-radius: 50%; background: var(--acento); }
  .mov .data { font-size: 12px; color: var(--suave); }
  .mov .tit { font-weight: 600; }
  .mov .txt { font-size: 13px; color: var(--suave); margin-top: 3px; }
  .lista-proc { border: 1px solid var(--borda); border-radius: 8px; padding: 12px;
                margin-bottom: 10px; background: var(--fundo); }
  .lista-proc a { color: var(--acento); font-weight: 600; text-decoration: none;
                  cursor: pointer; }
  footer { text-align: center; color: var(--suave); font-size: 12px; margin-top: 28px; }
  .oculto { display: none !important; }
  .girando { display: inline-block; width: 13px; height: 13px; border: 2px solid #fff;
             border-top-color: transparent; border-radius: 50%;
             animation: gira .7s linear infinite; vertical-align: -2px; margin-right: 7px; }
  @keyframes gira { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<div class="env">

  <header>
    <h1>LexFlow</h1>
    <div class="sub">Consulta de processos judiciais &middot; v${versao}</div>
  </header>

  <div class="cartao">
    <label for="chave">Chave de API</label>
    <input id="chave" type="password" placeholder="cole aqui a chave gerada com npm run chave"
           autocomplete="off" spellcheck="false">
    <div class="dica">Fica guardada só neste navegador. Nunca é enviada a outro lugar além da sua API.</div>
  </div>

  <div class="cartao">
    <div class="linha">
      <div style="flex:0 0 168px">
        <label for="modo">Consultar por</label>
        <select id="modo">
          <option value="numero">Número do processo</option>
          <option value="oab">OAB do advogado</option>
        </select>
      </div>
      <div id="campoNumero">
        <label for="numero">Número CNJ</label>
        <input id="numero" placeholder="0311517-22.2015.8.09.0051" spellcheck="false">
      </div>
      <div id="campoOab" class="oculto" style="flex:0 0 130px">
        <label for="oab">Inscrição</label>
        <input id="oab" placeholder="234567" spellcheck="false">
      </div>
      <div id="campoUf" class="oculto" style="flex:0 0 90px">
        <label for="uf">UF</label>
        <input id="uf" placeholder="GO" maxlength="2" spellcheck="false">
      </div>
    </div>
    <div class="acoes">
      <button id="buscar">Consultar</button>
      <span id="cronometro" class="cod"></span>
    </div>
    <div id="paciencia" class="aviso oculto">
      A primeira consulta de um processo pode levar até um minuto — a base do CNJ é
      lenta quando o dado ainda não está no cache dela. Consultas seguintes são rápidas.
    </div>
  </div>

  <div id="saida"></div>

  <footer>LexFlow v${versao} &middot; <a href="/ready" style="color:inherit">estado das fontes</a></footer>
</div>

<script>
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var CHAVE_LOCAL = 'lexflow.chave';

  try {
    var salva = localStorage.getItem(CHAVE_LOCAL);
    if (salva) $('chave').value = salva;
  } catch (e) { /* navegador sem storage: segue sem lembrar */ }

  $('chave').addEventListener('change', function () {
    try { localStorage.setItem(CHAVE_LOCAL, $('chave').value.trim()); } catch (e) {}
  });

  $('modo').addEventListener('change', function () {
    var porOab = $('modo').value === 'oab';
    $('campoNumero').classList.toggle('oculto', porOab);
    $('campoOab').classList.toggle('oculto', !porOab);
    $('campoUf').classList.toggle('oculto', !porOab);
  });

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function data(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return isNaN(d) ? '—' : d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  }

  function erroHtml(titulo, detalhe, codigo) {
    return '<div class="cartao erro"><strong>' + esc(titulo) + '</strong>' +
           esc(detalhe) + (codigo ? '<div class="cod" style="margin-top:6px">' +
           esc(codigo) + '</div>' : '') + '</div>';
  }

  function processoHtml(p, fonte, deCache) {
    var h = '<div class="cartao">';
    h += '<div style="display:flex;justify-content:space-between;align-items:start;gap:10px;flex-wrap:wrap">';
    h += '<div><div style="font-size:17px;font-weight:700">' + esc(p.numero) + '</div>';
    h += '<div class="sub">' + esc(p.tribunal || '') + (p.grau ? ' · ' + esc(p.grau) : '') + '</div></div>';
    h += '<div>';
    if (fonte) h += '<span class="selo">' + esc(fonte) + (deCache === 'true' ? ' · cache' : '') + '</span> ';
    if (p.segredoJustica) h += '<span class="selo alerta">segredo de justiça</span>';
    h += '</div></div>';

    h += '<dl style="margin-top:14px">';
    h += '<dt>Vara</dt><dd>' + esc(p.vara || '—') + '</dd>';
    h += '<dt>Classe</dt><dd>' + esc(p.classe || '—') + '</dd>';
    h += '<dt>Assunto</dt><dd>' + esc(p.assunto || '—') + '</dd>';
    h += '<dt>Distribuição</dt><dd>' + data(p.dataDistribuicao) + '</dd>';
    if (p.valorCausa != null) {
      h += '<dt>Valor da causa</dt><dd>' +
           p.valorCausa.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) + '</dd>';
    }
    h += '</dl>';

    if (p.partes && p.partes.length) {
      h += '<h2>Partes</h2>';
      p.partes.forEach(function (parte) {
        h += '<div style="margin-bottom:10px"><span class="selo">' + esc(parte.polo) + '</span> ' +
             '<strong>' + esc(parte.nome) + '</strong>';
        if (parte.advogados && parte.advogados.length) {
          h += '<div class="sub">' + parte.advogados.map(function (a) {
            return esc(a.nome) + (a.oab ? ' (OAB ' + esc(a.oab) + '/' + esc(a.ufOab || '') + ')' : '');
          }).join(', ') + '</div>';
        }
        h += '</div>';
      });
    } else {
      h += '<div class="aviso">Esta fonte não informa partes nem advogados. ' +
           'A base pública do CNJ só publica metadados — partes, advogados e o ' +
           'inteiro teor dos despachos dependem do crawler do tribunal.</div>';
    }

    var m = p.movimentacoes || [];
    h += '<h2>Movimentações (' + m.length + ')</h2>';
    m.slice(0, 40).forEach(function (mov) {
      h += '<div class="mov"><div class="data">' + data(mov.data) + '</div>' +
           '<div class="tit">' + esc(mov.titulo) + '</div>';
      if (mov.conteudo) h += '<div class="txt">' + esc(mov.conteudo) + '</div>';
      h += '</div>';
    });
    if (m.length > 40) h += '<div class="sub">… mais ' + (m.length - 40) + ' movimentação(ões).</div>';

    h += '</div>';
    return h;
  }

  var cronometro = null;

  function iniciarEspera() {
    var t0 = Date.now();
    $('paciencia').classList.remove('oculto');
    cronometro = setInterval(function () {
      $('cronometro').textContent = Math.round((Date.now() - t0) / 1000) + 's';
    }, 250);
  }

  function pararEspera() {
    if (cronometro) clearInterval(cronometro);
    cronometro = null;
    $('cronometro').textContent = '';
    $('paciencia').classList.add('oculto');
  }

  function consultar() {
    var chave = $('chave').value.trim();
    var saida = $('saida');

    if (!chave) {
      saida.innerHTML = erroHtml('Falta a chave de API',
        'Cole a chave no campo acima. Ela é a mesma que está em LEXFLOW_API_KEYS no Easypanel.');
      return;
    }

    var url, porOab = $('modo').value === 'oab';
    if (porOab) {
      var oab = $('oab').value.trim(), uf = $('uf').value.trim().toUpperCase();
      if (!oab || !uf) {
        saida.innerHTML = erroHtml('Faltam dados', 'Informe a inscrição e a UF.');
        return;
      }
      url = '/v1/advogados/' + encodeURIComponent(uf) + '/' + encodeURIComponent(oab) + '/processos';
    } else {
      var numero = $('numero').value.trim();
      if (!numero) {
        saida.innerHTML = erroHtml('Falta o número', 'Informe o número CNJ do processo.');
        return;
      }
      url = '/v1/processos/' + encodeURIComponent(numero);
    }

    $('buscar').disabled = true;
    saida.innerHTML = '';
    iniciarEspera();

    fetch(url, { headers: { 'x-api-key': chave } })
      .then(function (r) {
        var fonte = r.headers.get('x-lexflow-fonte');
        var cache = r.headers.get('x-lexflow-cache');
        return r.json().then(function (corpo) {
          return { ok: r.ok, status: r.status, corpo: corpo, fonte: fonte, cache: cache };
        });
      })
      .then(function (res) {
        pararEspera();
        $('buscar').disabled = false;

        if (!res.ok) {
          var ajuda = {
            401: 'A chave não foi aceita. Confira se é exatamente a que está no Easypanel.',
            400: 'Verifique o número CNJ ou a OAB — o formato não confere.',
            404: 'As fontes responderam, e nenhuma tem esse processo.',
            429: 'Muitas consultas em pouco tempo. Aguarde um instante.',
            501: 'Nenhuma fonte configurada sabe fazer essa busca. Busca por OAB precisa de um crawler de tribunal — o DataJud não indexa advogados.',
            502: 'As fontes externas falharam. Normalmente é o CNJ fora do ar ou lento demais.',
            503: 'Fonte temporariamente indisponível. Tente de novo em instantes.'
          }[res.status] || 'Erro inesperado.';
          saida.innerHTML = erroHtml(
            (res.corpo && res.corpo.mensagem) || 'Não foi possível consultar',
            ajuda,
            'HTTP ' + res.status + (res.corpo && res.corpo.erro ? ' · ' + res.corpo.erro : '')
          );
          return;
        }

        if (porOab) {
          var lista = res.corpo.processos || [];
          if (!lista.length) {
            saida.innerHTML = '<div class="cartao">Nenhum processo encontrado para essa OAB.</div>';
            return;
          }
          var h = '<div class="cartao"><strong>' + lista.length + ' processo(s)</strong>';
          lista.forEach(function (p) {
            var ult = (p.movimentacoes && p.movimentacoes[0]) || null;
            h += '<div class="lista-proc" style="margin-top:10px">' +
                 '<a data-num="' + esc(p.numero) + '">' + esc(p.numero) + '</a>' +
                 '<div class="sub">' + esc(p.classe || '') + ' · ' + esc(p.vara || '') + '</div>' +
                 (ult ? '<div class="sub">último: ' + data(ult.data) + ' — ' + esc(ult.titulo) + '</div>' : '') +
                 '</div>';
          });
          h += '</div>';
          saida.innerHTML = h;
          Array.prototype.forEach.call(saida.querySelectorAll('a[data-num]'), function (a) {
            a.addEventListener('click', function () {
              $('modo').value = 'numero';
              $('modo').dispatchEvent(new Event('change'));
              $('numero').value = a.getAttribute('data-num');
              consultar();
            });
          });
          return;
        }

        saida.innerHTML = processoHtml(res.corpo, res.fonte, res.cache);
      })
      .catch(function (e) {
        pararEspera();
        $('buscar').disabled = false;
        saida.innerHTML = erroHtml('A consulta não completou',
          'A conexão caiu ou o servidor demorou demais. Tente novamente.', String(e && e.message || e));
      });
  }

  $('buscar').addEventListener('click', consultar);
  ['numero', 'oab', 'uf', 'chave'].forEach(function (id) {
    $(id).addEventListener('keydown', function (ev) { if (ev.key === 'Enter') consultar(); });
  });
})();
</script>
</body>
</html>`;
}
