/**
 * Um pedaço do PDF combinado: um arquivo PDF inteiro, ou um intervalo dele.
 *
 * `arquivo` é o caminho que `ArmazemDoLeitor.caminhoLocal` resolveu. O
 * montador não conhece o armazém: recebe caminhos prontos, já conferidos como
 * pertencentes à pasta do workspace.
 */
export interface ParteDoPdf {
  readonly arquivo: string;
  /** Primeira e última página (contando de 1). Ausente = o arquivo inteiro. */
  readonly paginas?: readonly [number, number];
}

export type InspecaoDePdf =
  | { readonly valido: true; readonly paginas: number }
  | { readonly valido: false; readonly motivo: 'pdf_invalido' | 'pdf_protegido' };

/** O que a conversão de uma peça HTML do tribunal deixou de fora. */
export interface ConversaoDeHtml {
  readonly ok: boolean;
  /** Imagens que existiam no HTML e não entraram no PDF. */
  readonly imagens: number;
  /** Tabelas achatadas em "célula | célula". */
  readonly tabelas: number;
  /** Caracteres sem equivalente na fonte padrão, trocados por "?". */
  readonly caracteresSubstituidos: number;
  /** Elementos inesperados descartados com o conteúdo (script, iframe…). */
  readonly elementosDescartados: readonly string[];
}

export interface PaginaDeAviso {
  readonly titulo: string;
  readonly linhas: readonly string[];
}

export interface PdfMontado {
  /** Páginas que cada parte ocupou, na ordem — contadas do arquivo gerado. */
  readonly paginasPorParte: readonly number[];
  readonly paginas: number;
  readonly bytes: number;
}

/**
 * PORTA da montagem do PDF combinado.
 *
 * Separada do armazém porque é outra decisão técnica com outro custo: juntar
 * 280 PDFs em memória com uma biblioteca JavaScript custa centenas de MB
 * (medido: +357 MB para 160 MB de entrada), e uma ferramenta externa que lê
 * por partes custa dezenas. Trocar uma pela outra é trocar este adapter.
 *
 * Contrato: `montar` CONFERE a contagem de páginas do arquivo gerado e lança
 * `PdfInvalidoError` se ela não bater com a soma das partes. O índice aponta
 * páginas para o advogado; índice desalinhado é pior que nenhum.
 */
export interface MontadorDePdf {
  /** Conta as páginas, ou diz por que o arquivo não serve. Nunca lança por arquivo ruim. */
  inspecionarPdf(arquivo: string): Promise<InspecaoDePdf>;

  /**
   * Converte uma imagem (JPEG ou PNG) num PDF de uma página, gravado em `destino`.
   * @returns `false` quando a imagem não abre — vira página de aviso, não erro.
   */
  converterImagem(arquivo: string, mimetype: string, destino: string): Promise<boolean>;

  /**
   * Converte uma peça HTML do tribunal em páginas de TEXTO, gravadas em
   * `destino`. O HTML nunca passa adiante: só o texto, desenhado.
   * Nunca lança por HTML ruim — devolve `ok: false`.
   */
  converterHtml(arquivo: string, destino: string): Promise<ConversaoDeHtml>;

  /** Um PDF com uma página por aviso, na ordem. */
  gerarAvisos(avisos: readonly PaginaDeAviso[], destino: string): Promise<void>;

  /** Junta as partes, na ordem, em `destino`. */
  montar(partes: readonly ParteDoPdf[], destino: string): Promise<PdfMontado>;
}
