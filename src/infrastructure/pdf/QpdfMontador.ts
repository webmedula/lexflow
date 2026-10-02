import { execFile, spawnSync } from 'node:child_process';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { PDFFont } from 'pdf-lib';
import { PdfInvalidoError } from '../../domain/errors/index.js';
import { converterHtmlEmBlocos } from './htmlDoTribunal.js';
import type { BlocoDeTexto, Trecho } from './htmlDoTribunal.js';
import type {
  ConversaoDeHtml,
  InspecaoDePdf,
  MontadorDePdf,
  PaginaDeAviso,
  ParteDoPdf,
  PdfMontado,
} from '../../domain/ports/MontadorDePdf.js';

export interface OpcoesQpdfMontador {
  /** Executável. Padrão: `qpdf` no PATH (Alpine: `apk add qpdf`). */
  readonly binario?: string;
  /** Teto de uma montagem. Padrão: 10 min. */
  readonly timeoutMs?: number;
}

interface Saida {
  readonly codigo: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** A4 em pontos — o tamanho das páginas que nós geramos (aviso, imagem). */
const A4: readonly [number, number] = [595.28, 841.89];
const MARGEM = 56;

/**
 * Montagem do PDF combinado com **qpdf**, e as páginas que nós mesmos geramos
 * com **pdf-lib**.
 *
 * Por que duas ferramentas, medido e não suposto (280 PDFs sintéticos, 160 MB,
 * 1.120 páginas, 01/10/2026):
 *
 *   qpdf --empty --pages ... --linearize   pico de 37 MB de RSS, ~14 s
 *   pdf-lib (copyPages + save)              +357 MB no processo Node
 *
 * O pdf-lib carrega tudo na memória do MESMO processo que atende as rotas; o
 * qpdf lê por partes, em outro processo, e de quebra lineariza (o PDF.js abre a
 * primeira página sem baixar o arquivo inteiro). O pdf-lib fica só com o que é
 * pequeno: páginas de aviso e imagem convertida.
 *
 * O qpdf é chamado com `execFile` e argumentos em VETOR, nunca por string de
 * shell: o caminho de cada arquivo é dado nosso, mas uma montagem é uma linha
 * de comando com centenas de argumentos, e uma única aspa num lugar errado
 * viraria execução de comando.
 */
export class QpdfMontador implements MontadorDePdf {
  private readonly binario: string;
  private readonly timeoutMs: number;

  constructor(opcoes: OpcoesQpdfMontador = {}) {
    this.binario = opcoes.binario ?? 'qpdf';
    this.timeoutMs = opcoes.timeoutMs ?? 600_000;
  }

  /**
   * O qpdf existe e responde? Síncrono porque o composition root é síncrono, e
   * é no arranque que se decide montar o leitor — uma vez, ~10 ms.
   */
  static disponivelSync(binario = 'qpdf'): boolean {
    const r = spawnSync(binario, ['--version'], { timeout: 5_000, windowsHide: true });
    return r.status === 0;
  }

  async inspecionarPdf(arquivo: string): Promise<InspecaoDePdf> {
    // Código 3 é "funcionou com avisos" — comum em PDF de digitalizadora, e o
    // número de páginas sai certo. Só o 2 (erro) reprova.
    const r = await this.executar(['--show-npages', arquivo]);
    const paginas = Number.parseInt(r.stdout.trim(), 10);
    if ((r.codigo === 0 || r.codigo === 3) && Number.isInteger(paginas) && paginas > 0) {
      return { valido: true, paginas };
    }
    return {
      valido: false,
      motivo: /password/i.test(r.stderr) ? 'pdf_protegido' : 'pdf_invalido',
    };
  }

  async converterImagem(
    arquivo: string,
    mimetype: string,
    destino: string,
  ): Promise<boolean> {
    try {
      const bytes = await readFile(arquivo);
      const doc = await PDFDocument.create();
      const tipo = mimetype.toLowerCase();
      const imagem = tipo.includes('png')
        ? await doc.embedPng(bytes)
        : tipo.includes('jpeg') || tipo.includes('jpg')
          ? await doc.embedJpg(bytes)
          : undefined;
      if (!imagem) return false;

      // Cabe na A4 sem distorcer e sem ampliar: ampliar foto de documento só
      // deixa o borrão maior.
      const [largura, altura] = A4;
      const escala = Math.min(
        1,
        (largura - 2 * MARGEM) / imagem.width,
        (altura - 2 * MARGEM) / imagem.height,
      );
      const w = imagem.width * escala;
      const h = imagem.height * escala;
      const pagina = doc.addPage([largura, altura]);
      pagina.drawImage(imagem, {
        x: (largura - w) / 2,
        y: (altura - h) / 2,
        width: w,
        height: h,
      });
      await writeFile(destino, await doc.save());
      return true;
    } catch {
      // Imagem corrompida não é erro do sistema: a peça vira página de aviso.
      return false;
    }
  }

  /**
   * Peça HTML do tribunal → páginas de texto (estratégia A, decisão do dono).
   *
   * O HTML é reduzido a blocos de texto em `htmlDoTribunal.ts` e desenhado
   * aqui; nenhuma marcação passa adiante. Negrito e sublinhado sobrevivem
   * porque são simples de desenhar; o resto da formatação não, e a primeira
   * linha da página diz isso — o advogado não pode tomar o texto convertido
   * pela peça como o tribunal a exibe.
   *
   * Nunca lança: HTML que não converte vira página de aviso no chamador.
   */
  async converterHtml(arquivo: string, destino: string): Promise<ConversaoDeHtml> {
    try {
      const html = converterHtmlEmBlocos(await readFile(arquivo));
      const doc = await PDFDocument.create();
      const desenho = new DesenhoDeTexto(doc, {
        regular: await doc.embedFont(StandardFonts.Helvetica),
        negrito: await doc.embedFont(StandardFonts.HelveticaBold),
        obliqua: await doc.embedFont(StandardFonts.HelveticaOblique),
      });

      desenho.nota(
        'Documento HTML do tribunal convertido em texto pelo Processo Vivo. ' +
          'A formatação original não foi preservada.',
      );
      for (const bloco of html.blocos) desenho.bloco(bloco);
      if (html.blocos.length === 0) desenho.nota('(o documento não tem texto)');
      if (html.imagens > 0) {
        desenho.nota(
          `Este documento tinha ${html.imagens} ${html.imagens === 1 ? 'imagem' : 'imagens'} ` +
            `que não ${html.imagens === 1 ? 'foi incluída' : 'foram incluídas'}; ` +
            'consulte a peça no tribunal.',
        );
      }

      await writeFile(destino, await doc.save());
      return {
        ok: true,
        imagens: html.imagens,
        tabelas: html.tabelas,
        caracteresSubstituidos: desenho.substituidos,
        elementosDescartados: html.descartados,
      };
    } catch {
      return {
        ok: false,
        imagens: 0,
        tabelas: 0,
        caracteresSubstituidos: 0,
        elementosDescartados: [],
      };
    }
  }

  async gerarAvisos(avisos: readonly PaginaDeAviso[], destino: string): Promise<void> {
    const doc = await PDFDocument.create();
    const fonte = await doc.embedFont(StandardFonts.Helvetica);
    const negrito = await doc.embedFont(StandardFonts.HelveticaBold);
    for (const aviso of avisos) {
      const pagina = doc.addPage([A4[0], A4[1]]);
      // Faixa âmbar à esquerda: no console, âmbar é "pede providência" — e uma
      // peça que não veio é exatamente isso.
      pagina.drawRectangle({
        x: 0,
        y: 0,
        width: 10,
        height: A4[1],
        color: rgb(0.96, 0.62, 0.04),
      });
      let y = A4[1] - MARGEM - 20;
      for (const linha of quebrar(aviso.titulo, negrito, 16, A4[0] - 2 * MARGEM)) {
        pagina.drawText(linha, { x: MARGEM, y, size: 16, font: negrito });
        y -= 22;
      }
      y -= 10;
      for (const paragrafo of aviso.linhas) {
        for (const linha of quebrar(paragrafo, fonte, 11, A4[0] - 2 * MARGEM)) {
          if (y < MARGEM) break;
          pagina.drawText(linha, { x: MARGEM, y, size: 11, font: fonte });
          y -= 15;
        }
        y -= 6;
      }
    }
    await writeFile(destino, await doc.save());
  }

  async montar(partes: readonly ParteDoPdf[], destino: string): Promise<PdfMontado> {
    if (partes.length === 0) throw new PdfInvalidoError('nenhuma parte para montar');

    // A contagem por parte sai do qpdf ANTES de juntar, e o total sai do
    // arquivo gerado DEPOIS. As duas têm de bater, ou o índice mentiria.
    const paginasPorParte: number[] = [];
    for (const parte of partes) {
      if (parte.paginas) {
        const [ini, fim] = parte.paginas;
        paginasPorParte.push(fim - ini + 1);
        continue;
      }
      const inspecao = await this.inspecionarPdf(parte.arquivo);
      if (!inspecao.valido) {
        throw new PdfInvalidoError(
          `uma das partes deixou de ser legível (${inspecao.motivo})`,
        );
      }
      paginasPorParte.push(inspecao.paginas);
    }

    const argumentos = ['--empty', '--pages'];
    for (const parte of partes) {
      argumentos.push(parte.arquivo);
      if (parte.paginas) argumentos.push(`${parte.paginas[0]}-${parte.paginas[1]}`);
    }
    // `--linearize`: "fast web view". O PDF.js consegue pintar a primeira
    // página com os primeiros KB, pedindo o resto por Range.
    argumentos.push('--', '--linearize', destino);

    const r = await this.executar(argumentos);
    if (r.codigo !== 0 && r.codigo !== 3) {
      throw new PdfInvalidoError(`o qpdf terminou com código ${r.codigo}`, {
        cause: new Error(r.stderr.slice(0, 500)),
      });
    }

    const final = await this.inspecionarPdf(destino);
    const esperado = paginasPorParte.reduce((a, b) => a + b, 0);
    if (!final.valido || final.paginas !== esperado) {
      throw new PdfInvalidoError(
        `o arquivo gerado tem ${final.valido ? final.paginas : 'um número ilegível de'} ` +
          `páginas, e a soma das peças dá ${esperado}`,
      );
    }
    const { size } = await stat(destino);
    return { paginasPorParte, paginas: final.paginas, bytes: size };
  }

  private executar(argumentos: readonly string[]): Promise<Saida> {
    return new Promise((resolve, reject) => {
      execFile(
        this.binario,
        argumentos,
        { timeout: this.timeoutMs, maxBuffer: 1_048_576, windowsHide: true },
        (erro, stdout, stderr) => {
          if (erro && typeof erro.code !== 'number') {
            // Sem código numérico: o binário nem rodou (ENOENT) ou estourou o
            // tempo. Não é "PDF inválido" — é a ferramenta que falta.
            reject(erro);
            return;
          }
          resolve({
            codigo: erro && typeof erro.code === 'number' ? erro.code : 0,
            stdout: String(stdout),
            stderr: String(stderr),
          });
        },
      );
    });
  }
}

/**
 * Quebra o texto em linhas que caibam na largura, e troca o que a fonte padrão
 * não sabe desenhar.
 *
 * Helvetica do PDF fala WinAnsi: acento português cabe, mas "≈", emoji ou
 * aspas de outros alfabetos fazem o pdf-lib lançar no meio da montagem — e um
 * rótulo esquisito vindo do tribunal derrubaria o PDF do processo inteiro.
 */
function quebrar(
  texto: string,
  fonte: PDFFont,
  tamanho: number,
  largura: number,
): string[] {
  const seguro = paraWinAnsi(texto);
  const linhas: string[] = [];
  let atual = '';
  for (const palavra of seguro.split(/\s+/).filter(Boolean)) {
    const tentativa = atual ? `${atual} ${palavra}` : palavra;
    if (fonte.widthOfTextAtSize(tentativa, tamanho) <= largura || !atual) {
      atual = tentativa;
    } else {
      linhas.push(atual);
      atual = palavra;
    }
  }
  if (atual) linhas.push(atual);
  return linhas.length > 0 ? linhas : [''];
}

interface Fontes {
  readonly regular: PDFFont;
  readonly negrito: PDFFont;
  readonly obliqua: PDFFont;
}

/** Uma palavra (ou espaço) já com a fonte decidida. */
interface Peca {
  readonly texto: string;
  readonly fonte: PDFFont;
  readonly sublinhado: boolean;
  readonly largura: number;
}

const CORPO = 11;
const ENTRELINHA = 15;

/**
 * Paginação do texto convertido: quebra por largura, com troca de página.
 *
 * Mede cada palavra na fonte em que ela será desenhada — negrito é mais largo,
 * e medir tudo em regular faria a linha em negrito estourar a margem.
 */
class DesenhoDeTexto {
  substituidos = 0;
  private pagina;
  private y: number;
  private readonly largura = A4[0] - 2 * MARGEM;

  constructor(
    private readonly doc: PDFDocument,
    private readonly fontes: Fontes,
  ) {
    this.pagina = doc.addPage([A4[0], A4[1]]);
    this.y = A4[1] - MARGEM;
  }

  bloco(bloco: BlocoDeTexto): void {
    if (bloco.tipo === 'separador') {
      this.descer(10);
      this.pagina.drawLine({
        start: { x: MARGEM, y: this.y + 4 },
        end: { x: A4[0] - MARGEM, y: this.y + 4 },
        thickness: 0.6,
        color: rgb(0.55, 0.55, 0.55),
      });
      this.y -= 4;
      return;
    }
    const trechos: readonly Trecho[] =
      bloco.tipo === 'paragrafo'
        ? bloco.trechos
        : [{ texto: bloco.celulas.join(' | '), negrito: false, sublinhado: false }];
    this.paragrafo(trechos);
    this.y -= 4;
  }

  /** Linha em itálico cinza, menor: fala do sistema, não do tribunal. */
  nota(texto: string): void {
    const pecas = this.pecas(
      [{ texto, negrito: false, sublinhado: false }],
      this.fontes.obliqua,
      9,
    );
    for (const linha of this.quebrar(pecas, 9)) {
      this.descer(12);
      this.desenharLinha(linha, 9, rgb(0.4, 0.4, 0.4));
    }
    this.y -= 6;
  }

  private paragrafo(trechos: readonly Trecho[]): void {
    for (const linha of this.quebrar(this.pecas(trechos), CORPO)) {
      this.descer(ENTRELINHA);
      this.desenharLinha(linha, CORPO, rgb(0, 0, 0));
    }
  }

  private pecas(trechos: readonly Trecho[], fixa?: PDFFont, tamanho = CORPO): Peca[] {
    const saida: Peca[] = [];
    for (const t of trechos) {
      const fonte = fixa ?? (t.negrito ? this.fontes.negrito : this.fontes.regular);
      const { texto, substituidos } = paraWinAnsiContando(t.texto);
      this.substituidos += substituidos;
      for (const parte of texto.split(/( +)/)) {
        if (!parte) continue;
        saida.push({
          texto: parte,
          fonte,
          sublinhado: t.sublinhado,
          largura: fonte.widthOfTextAtSize(parte, tamanho),
        });
      }
    }
    return saida;
  }

  private quebrar(pecas: readonly Peca[], tamanho: number): Peca[][] {
    const linhas: Peca[][] = [];
    let atual: Peca[] = [];
    let ocupado = 0;
    const fechar = (): void => {
      while (atual.length > 0 && atual[atual.length - 1]?.texto.trim() === '')
        atual.pop();
      if (atual.length > 0) linhas.push(atual);
      atual = [];
      ocupado = 0;
    };
    for (const p of pecas) {
      const espaco = p.texto.trim() === '';
      if (espaco && atual.length === 0) continue;
      if (ocupado + p.largura <= this.largura) {
        atual.push(p);
        ocupado += p.largura;
        continue;
      }
      if (espaco) {
        fechar();
        continue;
      }
      if (atual.length > 0) fechar();
      // Palavra maior que a linha (URL, sequência sem espaço): corta por
      // caractere em vez de deixá-la sair da página.
      let resto = p.texto;
      while (p.fonte.widthOfTextAtSize(resto, tamanho) > this.largura) {
        let n = resto.length - 1;
        while (
          n > 1 &&
          p.fonte.widthOfTextAtSize(resto.slice(0, n), tamanho) > this.largura
        )
          n--;
        linhas.push([{ ...p, texto: resto.slice(0, n), largura: this.largura }]);
        resto = resto.slice(n);
      }
      const largura = p.fonte.widthOfTextAtSize(resto, tamanho);
      atual = [{ ...p, texto: resto, largura }];
      ocupado = largura;
    }
    fechar();
    return linhas;
  }

  private desenharLinha(
    linha: readonly Peca[],
    tamanho: number,
    cor: ReturnType<typeof rgb>,
  ): void {
    let x = MARGEM;
    for (const p of linha) {
      this.pagina.drawText(p.texto, {
        x,
        y: this.y,
        size: tamanho,
        font: p.fonte,
        color: cor,
      });
      if (p.sublinhado && p.texto.trim() !== '') {
        this.pagina.drawLine({
          start: { x, y: this.y - 1.5 },
          end: { x: x + p.largura, y: this.y - 1.5 },
          thickness: 0.6,
          color: cor,
        });
      }
      x += p.largura;
    }
  }

  private descer(altura: number): void {
    if (this.y - altura < MARGEM) {
      this.pagina = this.doc.addPage([A4[0], A4[1]]);
      this.y = A4[1] - MARGEM;
    }
    this.y -= altura;
  }
}

const WINANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');

export function paraWinAnsi(texto: string): string {
  return paraWinAnsiContando(texto).texto;
}

/**
 * Como `paraWinAnsi`, contando quantos caracteres viraram "?". A contagem vai
 * para o índice: a página diz "?" e o índice diz por quê, em vez de a montagem
 * inteira cair por um símbolo que a fonte padrão não tem.
 */
export function paraWinAnsiContando(texto: string): {
  readonly texto: string;
  readonly substituidos: number;
} {
  let substituidos = 0;
  let saida = '';
  for (const c of texto.normalize('NFC')) {
    const cp = c.codePointAt(0) ?? 0;
    if (
      (cp >= 0x20 && cp <= 0x7e) ||
      (cp >= 0xa0 && cp <= 0xff) ||
      WINANSI_EXTRA.has(c)
    ) {
      saida += c;
    } else if (c === '\t' || c === '\n' || c === '\r') {
      saida += ' ';
    } else if (c === '\u200b' || c === '\ufeff') {
      // Largura zero: some sem deixar "?" no meio da palavra.
    } else {
      saida += '?';
      substituidos += 1;
    }
  }
  return { texto: saida, substituidos };
}
