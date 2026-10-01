/**
 * HTML do tribunal → blocos de TEXTO, no servidor.
 *
 * Estratégia A do leitor (decisão do dono, 01/10/2026): as peças `text/html`
 * (~30% de um processo do TJGO — certidões, atos ordinatórios, alvarás) viram
 * páginas de texto dentro do PDF combinado. O HTML nunca chega ao navegador:
 * daqui sai só texto com dois atributos (negrito, sublinhado), e quem desenha é
 * o pdf-lib. Não há marcação para escapar porque não sobra marcação.
 *
 * A forma medida pela sonda de HTML (3 peças reais, 1 processo, 01/10/2026)
 * definiu o escopo: fragmento sem `<body>`, charset não declarado, só `p`,
 * `span`, `strong`, `br`, `hr`, `u`; 1 ou 2 imagens `data:` por peça; nenhuma
 * tabela, script, iframe, form, link ou atributo `on*`; 11 a 24 KB.
 *
 * Por isso um tokenizador tolerante e não um parser de DOM: o que existe é uma
 * sequência de tags simples, e o que fugir disso é tratado sem inventar layout
 * — tabela vira "célula | célula" (e o índice diz que havia tabela), elemento
 * inesperado (script, iframe…) é descartado com o conteúdo, e qualquer atributo
 * é ignorado, inclusive `style`.
 */

export interface Trecho {
  readonly texto: string;
  readonly negrito: boolean;
  readonly sublinhado: boolean;
}

export type BlocoDeTexto =
  | { readonly tipo: 'paragrafo'; readonly trechos: readonly Trecho[] }
  | { readonly tipo: 'separador' }
  | { readonly tipo: 'linhaDeTabela'; readonly celulas: readonly string[] };

export interface HtmlConvertido {
  readonly blocos: readonly BlocoDeTexto[];
  /** `<img>` encontradas — contadas pela tag, sem decodificar o base64. */
  readonly imagens: number;
  readonly tabelas: number;
  /** Nomes dos elementos descartados com o conteúdo (script, iframe…), sem repetição. */
  readonly descartados: readonly string[];
  readonly codificacao: 'utf-8' | 'windows-1252';
}

/**
 * UTF-8 primeiro; com byte inválido, windows-1252.
 *
 * A sonda não achou charset declarado. Os sistemas do judiciário brasileiro
 * alternam entre UTF-8 e o Latin-1 do Windows, e ler um com o outro troca
 * "Certidão" por "CertidÃ£o" — sem erro nenhum. O decodificador `fatal` é o
 * que separa os dois: UTF-8 válido por acaso, num texto em 1252 com acento, é
 * praticamente impossível.
 */
export function decodificarHtml(bytes: Uint8Array): {
  readonly texto: string;
  readonly codificacao: 'utf-8' | 'windows-1252';
} {
  try {
    return {
      texto: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      codificacao: 'utf-8',
    };
  } catch {
    return { texto: decodificarWindows1252(bytes), codificacao: 'windows-1252' };
  }
}

/**
 * windows-1252 à mão, e não `TextDecoder('windows-1252')`: no Node esse rótulo
 * cai no ISO-8859-1, que lê 0x96 como um caractere de controle invisível em vez
 * do travessão "–" — exatamente a faixa (0x80–0x9F) onde o Windows guarda
 * aspas curvas, travessões e reticências que os editores de texto produzem.
 */
const FAIXA_1252: readonly string[] = [
  '€',
  '\u0081',
  '‚',
  'ƒ',
  '„',
  '…',
  '†',
  '‡',
  'ˆ',
  '‰',
  'Š',
  '‹',
  'Œ',
  '\u008d',
  'Ž',
  '\u008f',
  '\u0090',
  '‘',
  '’',
  '“',
  '”',
  '•',
  '–',
  '—',
  '˜',
  '™',
  'š',
  '›',
  'œ',
  '\u009d',
  'ž',
  'Ÿ',
];

function decodificarWindows1252(bytes: Uint8Array): string {
  let saida = '';
  for (const b of bytes) {
    saida +=
      b >= 0x80 && b <= 0x9f ? (FAIXA_1252[b - 0x80] ?? '') : String.fromCharCode(b);
  }
  return saida;
}

/** Elementos descartados JUNTO com o conteúdo. */
const DESCARTAR_COM_CONTEUDO = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'noscript',
  'template',
  'svg',
  'math',
  'form',
  'select',
  'textarea',
  'button',
  'head',
  'title',
]);

/** Dos descartados, os que NÃO eram esperados — esses vão para o índice. */
const ESPERADOS_SEM_AVISO = new Set(['style', 'head', 'title']);

const QUEBRA_DE_BLOCO = new Set([
  'p',
  'div',
  'li',
  'ul',
  'ol',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'section',
  'article',
  'header',
  'footer',
  'center',
  'pre',
  'address',
  'dl',
  'dt',
  'dd',
  'caption',
]);

export function converterHtmlEmBlocos(bytes: Uint8Array): HtmlConvertido {
  const { texto: html, codificacao } = decodificarHtml(bytes);

  const blocos: BlocoDeTexto[] = [];
  const descartados = new Set<string>();
  let imagens = 0;
  let tabelas = 0;

  // Estado de formatação: contadores, porque <strong><strong>x</strong> y</strong>
  // existe em HTML gerado por editor, e um booleano desligaria o negrito cedo.
  let negrito = 0;
  let sublinhado = 0;

  let paragrafo: Trecho[] = [];
  let profundidadeTabela = 0;
  let linhaDeTabela: string[] | undefined;
  let celula: string[] | undefined;

  const fecharParagrafo = (): void => {
    const limpo = aparar(paragrafo);
    if (limpo.length > 0) blocos.push({ tipo: 'paragrafo', trechos: limpo });
    paragrafo = [];
  };
  const fecharCelula = (): void => {
    if (celula && linhaDeTabela) {
      linhaDeTabela.push(colapsar(celula.join('')).trim());
    }
    celula = undefined;
  };
  const fecharLinha = (): void => {
    fecharCelula();
    if (linhaDeTabela && linhaDeTabela.some((c) => c.length > 0)) {
      blocos.push({ tipo: 'linhaDeTabela', celulas: linhaDeTabela });
    }
    linhaDeTabela = undefined;
  };
  const acrescentar = (texto: string): void => {
    if (!texto) return;
    if (profundidadeTabela > 0) {
      // Texto solto dentro da tabela (fora de td) entra na célula corrente, ou
      // abre uma: perder texto é pior que errar a coluna.
      if (!linhaDeTabela) linhaDeTabela = [];
      if (!celula) celula = [];
      celula.push(texto);
      return;
    }
    paragrafo.push({ texto, negrito: negrito > 0, sublinhado: sublinhado > 0 });
  };

  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) {
      acrescentar(colapsar(decodificarEntidades(html.slice(i))));
      break;
    }
    if (lt > i) acrescentar(colapsar(decodificarEntidades(html.slice(i, lt))));

    // Comentário, CDATA, doctype, instrução: some inteiro.
    if (html.startsWith('<!--', lt)) {
      const fim = html.indexOf('-->', lt + 4);
      i = fim < 0 ? html.length : fim + 3;
      continue;
    }
    if (html.startsWith('<!', lt) || html.startsWith('<?', lt)) {
      const fim = html.indexOf('>', lt);
      i = fim < 0 ? html.length : fim + 1;
      continue;
    }

    // Sem espaço entre "<" e o nome: em HTML, "< b" é texto, não tag.
    const tag = /^<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)/.exec(html.slice(lt, lt + 64));
    if (!tag) {
      // "<" que não abre tag ("a < b" mal escapado): é texto.
      acrescentar('<');
      i = lt + 1;
      continue;
    }
    const fimDaTag = fimDeTag(html, lt);
    const fecha = tag[1] === '/';
    const nome = (tag[2] ?? '').toLowerCase();
    i = fimDaTag;

    if (!fecha && DESCARTAR_COM_CONTEUDO.has(nome)) {
      if (!ESPERADOS_SEM_AVISO.has(nome)) descartados.add(nome);
      const autoFechada = html.slice(lt, fimDaTag).trimEnd().endsWith('/>');
      if (!autoFechada) {
        const fechamento = new RegExp(`<\\s*/\\s*${nome}\\s*>`, 'i');
        const m = fechamento.exec(html.slice(fimDaTag));
        i = m ? fimDaTag + m.index + m[0].length : html.length;
      }
      continue;
    }

    switch (nome) {
      case 'br':
        if (profundidadeTabela > 0) acrescentar(' ');
        else fecharParagrafo();
        break;
      case 'hr':
        fecharParagrafo();
        blocos.push({ tipo: 'separador' });
        break;
      case 'img':
        imagens += 1;
        break;
      case 'strong':
      case 'b':
        negrito = Math.max(0, negrito + (fecha ? -1 : 1));
        break;
      case 'u':
        sublinhado = Math.max(0, sublinhado + (fecha ? -1 : 1));
        break;
      case 'table':
        if (!fecha) {
          fecharParagrafo();
          if (profundidadeTabela === 0) tabelas += 1;
          profundidadeTabela += 1;
        } else if (profundidadeTabela > 0) {
          profundidadeTabela -= 1;
          if (profundidadeTabela === 0) fecharLinha();
        }
        break;
      case 'tr':
        // Tabela aninhada não ganha linhas próprias: o texto dela vira parte
        // da célula de fora. Não se inventa layout.
        if (profundidadeTabela === 1) {
          if (!fecha) {
            fecharLinha();
            linhaDeTabela = [];
          } else {
            fecharLinha();
          }
        }
        break;
      case 'td':
      case 'th':
        if (profundidadeTabela === 1) {
          if (!fecha) {
            if (!linhaDeTabela) linhaDeTabela = [];
            fecharCelula();
            celula = [];
          } else {
            fecharCelula();
          }
        } else if (profundidadeTabela > 1 && !fecha) {
          acrescentar(' ');
        }
        break;
      default:
        if (QUEBRA_DE_BLOCO.has(nome) && profundidadeTabela === 0) fecharParagrafo();
      // span, em, i, font, a e o resto: só o texto de dentro importa.
    }
  }
  if (profundidadeTabela > 0) fecharLinha();
  fecharParagrafo();

  return { blocos, imagens, tabelas, descartados: [...descartados].sort(), codificacao };
}

/**
 * Onde a tag termina, respeitando aspas: `<img src="data:...>..." >`. Sem
 * isto, um `>` dentro de um atributo cortaria a tag no meio e o resto do
 * atributo viraria texto na página.
 */
function fimDeTag(html: string, inicio: number): number {
  let aspas: string | undefined;
  for (let j = inicio + 1; j < html.length; j++) {
    const c = html[j];
    if (aspas) {
      if (c === aspas) aspas = undefined;
    } else if (c === '"' || c === "'") {
      aspas = c;
    } else if (c === '>') {
      return j + 1;
    }
  }
  return html.length;
}

/** Espaço em branco do HTML: qualquer sequência vira um espaço. */
function colapsar(texto: string): string {
  return texto.replace(/[\t\n\r\f ]+/g, ' ');
}

/** Tira espaço no começo e no fim do parágrafo, e trechos que ficaram vazios. */
function aparar(trechos: readonly Trecho[]): Trecho[] {
  const copia = trechos.map((t) => ({ ...t, texto: t.texto.replace(/\u00a0/g, ' ') }));
  // Junta espaços duplicados na fronteira entre trechos.
  for (let k = 1; k < copia.length; k++) {
    const anterior = copia[k - 1];
    const atual = copia[k];
    if (
      anterior &&
      atual &&
      anterior.texto.endsWith(' ') &&
      atual.texto.startsWith(' ')
    ) {
      copia[k] = { ...atual, texto: atual.texto.replace(/^ +/, '') };
    }
  }
  const primeiro = copia[0];
  if (primeiro) copia[0] = { ...primeiro, texto: primeiro.texto.replace(/^ +/, '') };
  const ultimo = copia[copia.length - 1];
  if (ultimo)
    copia[copia.length - 1] = { ...ultimo, texto: ultimo.texto.replace(/ +$/, '') };
  return copia.filter((t) => t.texto.length > 0);
}

/**
 * Entidades HTML: numéricas (decimal e hex) e as nomeadas que o português e o
 * HTML gerado por editor usam. Entidade desconhecida fica como veio — melhor
 * "&foo;" na página do que um caractere inventado.
 */
export function decodificarEntidades(texto: string): string {
  return texto.replace(
    /&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);?/gi,
    (bruto, corpo: string) => {
      if (corpo.startsWith('#')) {
        const cp =
          corpo[1] === 'x' || corpo[1] === 'X'
            ? Number.parseInt(corpo.slice(2), 16)
            : Number.parseInt(corpo.slice(1), 10);
        if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff) return bruto;
        // 128–159 em entidade numérica é windows-1252 disfarçado (&#150; = –),
        // como os navegadores tratam.
        if (cp >= 0x80 && cp <= 0x9f) return FAIXA_1252[cp - 0x80] ?? '';
        return String.fromCodePoint(cp);
      }
      const valor = ENTIDADES[corpo] ?? ENTIDADES[corpo.toLowerCase()];
      // Sem ponto e vírgula, só as clássicas (como faz o navegador): "&copy2026"
      // vira ©2026, mas "&parte" num texto não vira "¶te".
      if (valor === undefined) return bruto;
      if (!bruto.endsWith(';') && !CLASSICAS_SEM_PONTO_E_VIRGULA.has(corpo)) return bruto;
      return valor;
    },
  );
}

const CLASSICAS_SEM_PONTO_E_VIRGULA = new Set([
  'amp',
  'lt',
  'gt',
  'quot',
  'nbsp',
  'copy',
  'reg',
]);

/** As 96 entidades Latin-1 do HTML 4, na ordem dos códigos 160–255. */
const LATIN1 =
  'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr ' +
  'deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest ' +
  'Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ' +
  'ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig ' +
  'agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml ' +
  'eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml';

const ENTIDADES: Readonly<Record<string, string>> = {
  ...Object.fromEntries(
    LATIN1.split(' ').map((nome, k) => [nome, String.fromCharCode(160 + k)]),
  ),
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  sbquo: '‚',
  ldquo: '“',
  rdquo: '”',
  bdquo: '„',
  hellip: '…',
  bull: '•',
  middot: '·',
  trade: '™',
  euro: '€',
  dagger: '†',
  Dagger: '‡',
  permil: '‰',
  OElig: 'Œ',
  oelig: 'œ',
  Scaron: 'Š',
  scaron: 'š',
  Yuml: 'Ÿ',
  circ: 'ˆ',
  tilde: '˜',
  ensp: ' ',
  emsp: ' ',
  thinsp: ' ',
  zwnj: '',
  zwj: '',
  lrm: '',
  rlm: '',
};
