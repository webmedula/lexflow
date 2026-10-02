#!/usr/bin/env node
/**
 * SONDA DE HTML — v1.0.0 (leitor de peças, 0.30.0)
 *
 * ~30% das peças de um processo do TJGO chegam como `text/html` (certidões,
 * alvarás, atos ordinatórios; ≈ 18 KB cada, sonda de lote de 01/10/2026). O
 * leitor precisa escolher entre DUAS estratégias, e a escolha depende da FORMA
 * desses HTMLs, que ninguém inspecionou ainda:
 *
 *   A. renderizar o texto dentro do PDF combinado (pdf-lib: parágrafos,
 *      quebras, tabelas simples);
 *   B. deixá-los fora do PDF e mostrá-los no painel, sanitizados.
 *
 * Esta sonda mede a forma de 2 ou 3 HTMLs reais — e SÓ a forma:
 *
 *  - tamanho, codificação declarada, se tem <body>;
 *  - histograma de TAGS (só o nome da tag, nunca o texto);
 *  - tabelas: quantas, maior número de linhas e de colunas, se há tabela
 *    dentro de tabela, colspan/rowspan;
 *  - imagens: quantas e de que TIPO de origem (data:, http, relativa) — nunca
 *    o endereço;
 *  - script, style, iframe, form, link, atributos on* e style="" — o que a
 *    sanitização terá de remover;
 *  - quantidade de caracteres de texto visível (número, não o texto).
 *
 * NADA de conteúdo sai daqui: nenhum trecho de texto, nenhum nome, nenhum
 * número de processo, nenhum atributo com valor. Nada é gravado em disco.
 *
 * Regras de segurança, as mesmas da sonda de lote:
 *  - banco aberto em `readOnly`; recusa-se a rodar com credencial recusada;
 *  - 2 requisições ao tribunal no total (1 listagem + 1 chamada agrupada com
 *    até 3 HTMLs), 3 s de pausa entre elas, SEM repetição;
 *  - aborta em 403, 429, 5xx, `sucesso: false` ou timeout;
 *  - a senha não vai para stdout, stderr, log nem arquivo.
 *
 * Uso (no contêiner da 0.30.0 o `dist/` já existe; fora dele, `npm run build`):
 *   node scripts/sonda-html.mjs <numero-cnj> [--workspace=<nome>] [--quantos=2|3]
 *   node scripts/sonda-html.mjs --seco <numero-cnj>     (só o plano; nada é enviado)
 *   node scripts/sonda-html.mjs --help
 */
import { setTimeout as dormir } from 'node:timers/promises';

const VERSAO = '1.0.0';
const INTERVALO_MS = 3000;

const entrada = process.argv.slice(2);

const AJUDA = `sonda-html v${VERSAO} — mede só a FORMA de 2 ou 3 peças HTML de um processo.

Uso:
  node scripts/sonda-html.mjs <numero-cnj> [--workspace=<nome>] [--quantos=2|3]
  node scripts/sonda-html.mjs --seco <numero-cnj>   mostra o plano; não abre o banco nem fala com o tribunal
  node scripts/sonda-html.mjs --help

Requisições ao tribunal: 2 (1 listagem + 1 lote com até 3 HTMLs), 3 s entre elas, sem repetição.
Aborta em 403, 429, 5xx, sucesso:false ou timeout. Recusa-se a rodar com credencial já recusada.
Imprime só estrutura (tags, tabelas, imagens por tipo de origem, contagens). Não grava nada em disco.
--workspace é obrigatório quando há mais de uma credencial do tribunal cadastrada.`;

if (entrada.includes('--help') || entrada.includes('-h')) {
  console.log(AJUDA);
  process.exit(0);
}
const seco = entrada.includes('--seco');
const workspaceArg = entrada.find((a) => a.startsWith('--workspace='))?.split('=')[1];
const quantos = Math.min(
  3,
  Math.max(2, Number(entrada.find((a) => a.startsWith('--quantos='))?.split('=')[1] ?? 3)),
);
const [numeroBruto] = entrada.filter((a) => !a.startsWith('--'));
if (!numeroBruto) {
  console.error(AJUDA);
  process.exit(1);
}

const { NumeroCNJ } = await import('../dist/domain/entities/NumeroCNJ.js').catch(() => {
  console.error('Não achei dist/. Rode `npm run build` antes.');
  process.exit(1);
});
const numero = NumeroCNJ.criar(numeroBruto);
const tribunal = (numero.siglaTribunal ?? '').toUpperCase();

console.log(`sonda-html v${VERSAO}`);
console.log(
  `plano: 1 listagem + 1 chamada agrupada com até ${quantos} peças HTML de um processo ${tribunal}; ` +
    `pausa de ${INTERVALO_MS / 1000}s; sem repetição. Requisições ao tribunal: 2.`,
);
if (seco) {
  console.log('\n--seco: nada foi aberto nem enviado. Fim.');
  process.exit(0);
}

const { DatabaseSync } = await import('node:sqlite');
const { Cofre } = await import('../dist/infrastructure/seguranca/cofre.js');
const { MniAdapter } = await import('../dist/infrastructure/adapters/mni/MniAdapter.js');
const { carregarConfig } = await import('../dist/infrastructure/config/env.js');

const config = carregarConfig(process.env);
const db = new DatabaseSync(config.banco.caminho, { readOnly: true });
const linhas = db.prepare('SELECT * FROM credenciais_tribunal WHERE tribunal = ?').all(tribunal);
const candidatas = workspaceArg ? linhas.filter((l) => l.workspace === workspaceArg) : linhas;
if (candidatas.length !== 1) {
  console.error(
    candidatas.length === 0
      ? `Nenhuma credencial de ${tribunal}${workspaceArg ? ` no workspace "${workspaceArg}"` : ''}.`
      : `Há ${candidatas.length} credenciais de ${tribunal}; escolha com --workspace=<nome>.`,
  );
  process.exit(1);
}
const linha = candidatas[0];
if (linha.recusada_em) {
  console.error(`Credencial marcada como RECUSADA em ${linha.recusada_em}. A sonda não roda.`);
  process.exit(1);
}
const credencial = {
  tribunal,
  identificacao: linha.identificacao,
  senha: Cofre.comChaveBase64(config.mni.chaveDoCofre).decifrar(linha.senha_cifrada),
};
const provedor = new MniAdapter({
  endpoint: config.mni.endpoint,
  tribunais: config.mni.tribunais,
  timeoutMs: config.mni.timeoutMs,
  limitePorMinuto: config.mni.limitePorMinuto,
});

function abortar(etapa, erro) {
  console.error(`[${etapa}] ABORTADO: ${erro?.constructor?.name ?? 'erro'} — ${erro?.message ?? erro}`);
  console.error('Nenhuma repetição foi feita.');
  process.exit(2);
}

// 1. Listagem — escolhe HTMLs espaçados na ordem dos autos.
let pecas;
try {
  pecas = await provedor.listarPecas(numero.digitos, credencial);
} catch (erro) {
  abortar('listar', erro);
}
const achatadas = [];
const achatar = (lista) => {
  for (const p of lista) {
    achatadas.push(p);
    achatar(p.vinculadas);
  }
};
achatar(pecas);
const htmls = achatadas.filter((p) => (p.mimetype ?? '').toLowerCase().includes('html') && !p.sigilosa);
console.log(`[listar] ${achatadas.length} peça(s), ${htmls.length} em HTML (não sigilosas).`);
if (htmls.length === 0) {
  console.log('Nenhum HTML neste processo. Fim.');
  process.exit(0);
}
const passo = Math.max(1, Math.floor(htmls.length / quantos));
const escolhidas = Array.from({ length: Math.min(quantos, htmls.length) }, (_, i) => htmls[i * passo]);

await dormir(INTERVALO_MS);

// 2. Uma chamada agrupada.
let lote;
try {
  lote = await provedor.obterConteudosEmLote(
    numero.digitos,
    escolhidas.map((p) => p.id),
    credencial,
  );
} catch (erro) {
  abortar('lote', erro);
}
console.log(
  `[lote] pedidas ${escolhidas.length} · vieram ${lote.conteudos.length} · sem teor ${lote.semTeor.length} · ` +
    `ausentes ${lote.ausentes.length} · resposta ${lote.bytesResposta.toLocaleString('pt-BR')} B\n`,
);

// --- análise de FORMA ----------------------------------------------------------
// Só nomes de tag HTML conhecidos saem no histograma; o resto vira "outras".
// Sem esta lista, um texto como "<Fulano" num HTML malformado sairia na tela
// como se fosse nome de tag — e o propósito da sonda é não imprimir texto.
const TAGS_CONHECIDAS = new Set(
  ('html head body title meta link style script noscript base div span p br hr ' +
    'h1 h2 h3 h4 h5 h6 b strong i em u s small sub sup font center pre code blockquote ' +
    'ul ol li dl dt dd table thead tbody tfoot tr td th caption col colgroup img figure ' +
    'a form input select option textarea button label iframe object embed svg canvas ' +
    'section article header footer nav main aside o:p').split(' '),
);

function forma(bytes) {
  const html = Buffer.from(bytes).toString('latin1');
  const tags = {};
  for (const m of html.matchAll(/<\s*([a-zA-Z][a-zA-Z0-9:-]*)\b/g)) {
    const bruto = m[1].toLowerCase();
    const t = TAGS_CONHECIDAS.has(bruto) ? bruto : 'outras';
    tags[t] = (tags[t] ?? 0) + 1;
  }
  // Tabelas: linhas e colunas máximas por tabela, sem olhar o texto das células.
  const tabelas = [];
  let profundidade = 0;
  let aninhada = false;
  for (const m of html.matchAll(/<\s*(\/?)\s*(table|tr|td|th)\b/gi)) {
    const fecha = m[1] === '/';
    const t = m[2].toLowerCase();
    if (t === 'table') {
      if (!fecha) {
        profundidade += 1;
        if (profundidade > 1) aninhada = true;
        tabelas.push({ linhas: 0, maxColunas: 0, colunasDaLinha: 0 });
      } else profundidade = Math.max(0, profundidade - 1);
    } else if (!fecha && tabelas.length > 0) {
      const atual = tabelas[tabelas.length - 1];
      if (t === 'tr') {
        atual.linhas += 1;
        atual.colunasDaLinha = 0;
      } else {
        atual.colunasDaLinha += 1;
        atual.maxColunas = Math.max(atual.maxColunas, atual.colunasDaLinha);
      }
    }
  }
  const imgs = [...html.matchAll(/<\s*img\b[^>]*\bsrc\s*=\s*["']?([a-z]+:)?/gi)].map((m) =>
    m[1] ? (m[1].toLowerCase() === 'data:' ? 'data' : 'externa') : 'relativa',
  );
  const texto = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, 'x')
    .replace(/\s+/g, '');
  return {
    bytes: bytes.length,
    charsetDeclarado: /charset\s*=\s*["']?([a-z0-9-]+)/i.exec(html)?.[1]?.toLowerCase() ?? null,
    temBody: /<body\b/i.test(html),
    caracteresDeTexto: texto.length,
    tags: Object.fromEntries(Object.entries(tags).sort((a, b) => b[1] - a[1])),
    tabelas: tabelas.map(({ linhas, maxColunas }) => ({ linhas, maxColunas })),
    tabelaAninhada: aninhada,
    colspanOuRowspan: /\b(colspan|rowspan)\s*=/i.test(html),
    imagens: {
      total: imgs.length,
      data: imgs.filter((x) => x === 'data').length,
      externa: imgs.filter((x) => x === 'externa').length,
      relativa: imgs.filter((x) => x === 'relativa').length,
    },
    aRemoverNaSanitizacao: {
      script: tags.script ?? 0,
      style: tags.style ?? 0,
      iframe: tags.iframe ?? 0,
      form: tags.form ?? 0,
      link: tags.link ?? 0,
      atributosOn: (html.match(/\son[a-z]+\s*=/gi) ?? []).length,
      atributosStyle: (html.match(/\sstyle\s*=/gi) ?? []).length,
    },
  };
}

for (const [i, c] of lote.conteudos.entries()) {
  console.log(`--- HTML ${i + 1} (${c.mimetype}) ---`);
  console.log(JSON.stringify(forma(c.bytes), null, 2));
}
console.log('\nNenhum conteúdo foi impresso ou gravado. Fim.');
