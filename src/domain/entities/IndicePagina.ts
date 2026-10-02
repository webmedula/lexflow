/**
 * Como cada peça entrou no PDF combinado.
 *
 * - `incorporada`: PDF do tribunal, como veio.
 * - `convertida`: imagem que virou página.
 * - `html_convertida`: ato do tribunal em HTML que virou páginas de TEXTO
 *   (estratégia A, decisão do dono, 01/10/2026). O `motivo` diz o que ficou
 *   de fora: imagens, tabela achatada, caractere trocado por "?".
 * - `html_nao_incorporada`: HTML que não pôde ser convertido. Há uma página de
 *   aviso no lugar dele dizendo que ele existe e onde ler — o HTML nunca some
 *   em silêncio.
 * - `nao_obtida`: o tribunal não entregou, o arquivo não abriu, ou a guarda
 *   não é permitida. Também tem página de aviso, com o motivo.
 */
export type SituacaoNoIndice =
  | 'incorporada'
  | 'convertida'
  | 'html_convertida'
  | 'html_nao_incorporada'
  | 'nao_obtida';

/** Uma linha do índice: onde a peça começa e termina no PDF combinado. */
export interface EntradaIndice {
  readonly pecaId: string;
  readonly movimento?: number;
  readonly rotulo: string;
  readonly data?: Date;
  /** Primeira página da peça, contando de 1. */
  readonly paginaInicial: number;
  readonly paginaFinal: number;
  readonly situacao: SituacaoNoIndice;
  readonly motivo?: string;
}

export interface ItemDoIndice {
  readonly pecaId: string;
  readonly movimento?: number;
  readonly rotulo: string;
  readonly data?: Date;
  readonly situacao: SituacaoNoIndice;
  readonly motivo?: string;
  /** Páginas que esta peça ocupa NO ARQUIVO GERADO — contadas, não estimadas. */
  readonly paginas: number;
}

/**
 * Soma as páginas na ordem dos autos e devolve onde cada peça começa.
 *
 * Toda peça ocupa pelo menos uma página, inclusive a que não foi obtida: ela
 * ganha uma página de aviso. É isso que impede uma peça recusada de sumir do
 * índice — e é o que deixa a etapa de análise dizer "a página 47 é o aviso de
 * que a contestação não veio", em vez de pular para a peça seguinte calada.
 *
 * Contagem zero ou fracionária é recusada aqui em vez de virar índice torto:
 * a contagem sai do arquivo gerado, e um zero significa que a conferência não
 * aconteceu.
 */
export function montarIndice(itens: readonly ItemDoIndice[]): EntradaIndice[] {
  const saida: EntradaIndice[] = [];
  let proxima = 1;
  for (const item of itens) {
    if (!Number.isInteger(item.paginas) || item.paginas < 1) {
      throw new RangeError(
        `a peça ${item.pecaId} chegou ao índice com ${item.paginas} página(s)`,
      );
    }
    saida.push({
      pecaId: item.pecaId,
      rotulo: item.rotulo,
      situacao: item.situacao,
      paginaInicial: proxima,
      paginaFinal: proxima + item.paginas - 1,
      ...(item.movimento !== undefined ? { movimento: item.movimento } : {}),
      ...(item.data !== undefined ? { data: item.data } : {}),
      ...(item.motivo !== undefined ? { motivo: item.motivo } : {}),
    });
    proxima += item.paginas;
  }
  return saida;
}

/** Total de páginas que o índice descreve. */
export function paginasDoIndice(indice: readonly EntradaIndice[]): number {
  return indice.at(-1)?.paginaFinal ?? 0;
}
