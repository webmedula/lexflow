import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, PDFName, PDFString, StandardFonts } from 'pdf-lib';
import { Peca } from '../../src/domain/entities/Peca.js';
import type { ConteudoPeca } from '../../src/domain/entities/Peca.js';
import type { Clock } from '../../src/domain/ports/Clock.js';
import type {
  AssinaturaDeMudanca,
  AtosDoProcesso,
  LoteDePecas,
  ProvedorDePecas,
} from '../../src/domain/ports/ProvedorDePecas.js';

/**
 * Número SINTÉTICO no TJGO (8.09), com dígito verificador válido.
 *
 * Sequencial 99999xx e origem 9999 de propósito: o repositório é público, e
 * os testes do leitor não usam número de processo real (ver CLAUDE.md §6).
 * Gerado com a mesma conta de `construirNumeroValido` (NumeroCNJ.spec).
 */
export const PROCESSO_TJGO = '9999901-96.2026.8.09.9999';
export const PROCESSO_TJGO_DIGITOS = '99999019620268099999';
/** Sintético no TJSP (8.26), para "o número de OUTRO processo". */
export const OUTRO_PROCESSO = '9999902-10.2026.8.26.9999';

export class ClockFalso implements Clock {
  ms = new Date('2026-10-01T12:00:00.000Z').getTime();
  agora(): Date {
    return new Date(this.ms);
  }
  monotonico(): number {
    return this.ms;
  }
  avancar(ms: number): void {
    this.ms += ms;
  }
}

/**
 * PDF de teste com `paginas` páginas, gerado por biblioteca (permitido pela
 * política de fixtures: nada de conteúdo real). O texto marca a peça, para o
 * teste poder conferir ORDEM lendo o arquivo montado.
 */
export async function pdfSintetico(paginas: number, marca: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < paginas; i++) {
    const pagina = doc.addPage([300, 300]);
    pagina.drawText(`${marca}-p${i + 1}`, { x: 20, y: 150, font: fonte, size: 12 });
    // A marca também vai no dicionário da página, que o qpdf preserva: é como
    // o teste lê a ordem do arquivo montado sem depender de extrair texto.
    pagina.node.set(PDFName.of('PVMarca'), PDFString.of(`${marca}-p${i + 1}`));
  }
  return doc.save();
}

/**
 * PDF de uma página com um fluxo incompressível de `tamanho` bytes — para os
 * testes de cota, em que o peso do arquivo tem de dominar o das páginas de
 * aviso e o da linearização.
 */
export async function pdfPesado(tamanho: number, marca: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([300, 300]);
  pagina.node.set(PDFName.of('PVMarca'), PDFString.of(`${marca}-p1`));
  const lastro = doc.context.register(doc.context.stream(randomBytes(tamanho), {}));
  pagina.node.set(PDFName.of('PVLastro'), lastro);
  return doc.save();
}

/** As marcas das páginas de um PDF montado, em ordem; `aviso` onde não há marca. */
export async function marcasDasPaginas(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) => {
    const v = p.node.get(PDFName.of('PVMarca'));
    return v instanceof PDFString ? v.decodeText() : 'aviso';
  });
}

/** PNG 1×1 válido. */
export const PNG_1X1 = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
);

export interface PecaFalsa {
  readonly id: string;
  readonly rotulo?: string;
  readonly mimetype?: string;
  readonly movimento?: number;
  readonly nivelSigilo?: number;
  /** Ausente: o tribunal lista e não entrega (sem teor). */
  readonly bytes?: Uint8Array;
}

/**
 * Fonte de peças em memória, com o contrato de lote.
 *
 * Registra cada chamada para o teste conferir o que foi pedido (só as
 * novas? a ausente sozinha?) e em que instante (pausa entre chamadas).
 */
export class ProvedorDeLoteFalso implements ProvedorDePecas {
  readonly nome = 'mni';
  readonly tribunais = ['TJGO'];
  readonly chamadas: Array<{ tipo: string; ids: readonly string[]; em: number }> = [];
  /** Ids omitidos da resposta de lote (por N vezes). */
  omitir = new Map<string, number>();
  /** Peso informado da resposta, por chamada de lote (padrão: soma dos arquivos). */
  pesoDaResposta: ((ids: readonly string[]) => number) | undefined;
  /** Erro a lançar na N-ésima chamada de lote (1 = primeira). */
  falharNoLote: { readonly n: number; readonly erro: Error } | undefined;
  hashDocumentos = 'hash-1';
  nivelSigiloDoProcesso = 0;
  /** Disjuntor de 403 simulado: o que `pausadoAte()` informa. */
  pausa: Date | undefined;
  /** Chamado no começo de cada lote (n = 1, 2…), para o teste olhar o meio do job. */
  aoLote: ((n: number, ids: readonly string[]) => Promise<void>) | undefined;

  constructor(
    public pecas: PecaFalsa[],
    private readonly clock?: Clock,
  ) {}

  async listarPecas(): Promise<Peca[]> {
    return [...(await this.listarAtos()).pecas];
  }

  async listarAtos(): Promise<AtosDoProcesso> {
    this.chamadas.push({ tipo: 'listar', ids: [], em: this.clock?.monotonico() ?? 0 });
    return {
      pecas: this.pecas.map(
        (p) =>
          new Peca({
            id: p.id,
            tipo: '57',
            descricao: p.rotulo ?? `Peça ${p.id}`,
            mimetype: p.mimetype ?? 'application/pdf',
            ...(p.movimento !== undefined ? { movimento: p.movimento } : {}),
            ...(p.nivelSigilo !== undefined ? { nivelSigilo: p.nivelSigilo } : {}),
          }),
      ),
      movimentos: [],
      nivelSigiloDoProcesso: this.nivelSigiloDoProcesso,
    };
  }

  async obterConteudo(): Promise<ConteudoPeca> {
    throw new Error('o leitor não deve baixar peça a peça');
  }

  async obterConteudosEmLote(
    _numero: string,
    ids: readonly string[],
  ): Promise<LoteDePecas> {
    this.chamadas.push({
      tipo: 'lote',
      ids: [...ids],
      em: this.clock?.monotonico() ?? 0,
    });
    const n = this.chamadas.filter((c) => c.tipo === 'lote').length;
    await this.aoLote?.(n, ids);
    if (this.falharNoLote && this.falharNoLote.n === n) throw this.falharNoLote.erro;

    const conteudos: ConteudoPeca[] = [];
    const semTeor: string[] = [];
    const ausentes: string[] = [];
    for (const id of ids) {
      const restante = this.omitir.get(id) ?? 0;
      const p = this.pecas.find((x) => x.id === id);
      if (!p || restante > 0) {
        if (restante > 0) this.omitir.set(id, restante - 1);
        ausentes.push(id);
        continue;
      }
      if (!p.bytes) {
        semTeor.push(id);
        continue;
      }
      conteudos.push({
        id,
        mimetype: p.mimetype ?? 'application/pdf',
        nomeArquivo: `${id}.bin`,
        bytes: p.bytes,
      });
    }
    const soma = conteudos.reduce((s, c) => s + c.bytes.length, 0) + 180_000;
    return {
      conteudos,
      semTeor,
      ausentes,
      bytesResposta: this.pesoDaResposta ? this.pesoDaResposta(ids) : soma,
    };
  }

  pausadoAte(): Date | undefined {
    return this.pausa;
  }

  async assinaturaDeMudanca(): Promise<AssinaturaDeMudanca> {
    this.chamadas.push({ tipo: 'alteracao', ids: [], em: this.clock?.monotonico() ?? 0 });
    return { documentos: this.hashDocumentos };
  }

  lotes(): Array<readonly string[]> {
    return this.chamadas.filter((c) => c.tipo === 'lote').map((c) => c.ids);
  }
}

/** Pasta temporária do teste, com faxina. */
export function pastaTemporaria(): { readonly caminho: string; apagar(): void } {
  const caminho = mkdtempSync(join(tmpdir(), 'pv-leitor-teste-'));
  return { caminho, apagar: () => rmSync(caminho, { recursive: true, force: true }) };
}

/** Texto de um PDF, pelo `pdftotext` do poppler (instalado na imagem e no CI). */
export function textoDoPdf(bytes: Uint8Array): string {
  return execFileSync('pdftotext', ['-enc', 'UTF-8', '-', '-'], {
    input: Buffer.from(bytes),
    maxBuffer: 16 * 1024 * 1024,
  }).toString('utf8');
}

/** Marcadores que NUNCA podem sair do servidor: estão em script e em atributo. */
export const MARCADOR_SCRIPT = 'MARCADOR-DENTRO-DO-SCRIPT';
export const MARCADOR_ATRIBUTO = 'MARCADOR-DENTRO-DO-ATRIBUTO';

/**
 * HTML SINTÉTICO com a forma medida pela sonda (fragmento sem <body>, sem
 * charset, p/span/strong/br/hr/u e imagem data:) e mais o que a conversão tem
 * de aguentar: entidades nomeadas e numéricas, tabela, script, atributo style,
 * e um caractere que a fonte padrão não desenha (≈). Nenhum nome real.
 */
export const HTML_SINTETICO =
  '<p style="text-align:center; font-family: ' +
  MARCADOR_ATRIBUTO +
  '"><strong>CERTID&Atilde;O</strong></p>' +
  '<p><span>Certifico que a parte autora foi intimada da decis&atilde;o, ' +
  'conforme o art.&nbsp;5&ordm; &mdash; ato n&#186; 12 &amp; seguintes.</span><br>' +
  'Segunda linha com <u>sublinhado</u> e a&ccedil;&atilde;o &#233; v&aacute;lida.</p>' +
  '<hr>' +
  '<script>window.x = "' +
  MARCADOR_SCRIPT +
  '";</script>' +
  '<table><tr><td>Prazo</td><td>15 dias</td></tr><tr><td>Valor</td><td>R$ 1.000,00</td></tr></table>' +
  '<p>Diferença ≈ zero.</p>' +
  '<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==">' +
  '<p>Goiânia, data do sistema.</p>';
