import type { MotivoNaoObtida } from './JobLeitor.js';

/**
 * A Pasta digital (v0.33.0): a lista de TODAS as peças do processo e o estado
 * de cada uma, para o advogado abrir uma por vez em vez de montar o PDF inteiro.
 *
 * Estas são as formas de dado. Nada aqui guarda conteúdo de peça: o arquivo
 * mora no armazém, e o que circula (lista, resposta HTTP, log) é metadado.
 */

/** Uma peça como o tribunal a listou. Fica gravada: é a base dos pedidos. */
export interface PecaListada {
  readonly pecaId: string;
  /** Posição nos AUTOS (ordem do MNI achatada), não a do clique. */
  readonly ordem: number;
  readonly rotulo: string;
  readonly data?: Date;
  readonly movimento?: number;
  readonly mimetype?: string;
  /**
   * Sob sigilo na origem (`nivelSigilo > 0`). Quem decide é o TRIBUNAL, nunca
   * o navegador — por isso o pedido de uma peça confere o id contra esta
   * listagem e não contra o que o cliente disse sobre ela.
   */
  readonly sigilosa: boolean;
}

/**
 * O retrato da listagem do tribunal, gravado quando a tela carrega as peças do
 * processo. Abrir a Pasta lê DAQUI e não consulta o tribunal de novo: cada
 * consulta ao MNI são dezenas de segundos e uma oportunidade de recusa contra
 * a conta do advogado.
 */
export interface ListagemDaPasta {
  readonly numeroProcesso: string;
  readonly tribunal: string;
  readonly listadaEm: Date;
  /** O PROCESSO inteiro está sob segredo de justiça: nada dele é guardado. */
  readonly processoSigiloso: boolean;
  readonly pecas: readonly PecaListada[];
}

/** Como o arquivo guardado foi produzido a partir do que o tribunal entregou. */
export type ConversaoDaPeca = 'nenhuma' | 'imagem' | 'html';

/**
 * Uma peça na guarda por peça. O arquivo é SEMPRE um PDF legível: imagem e
 * HTML do tribunal são convertidos na entrada, e o HTML original não fica.
 */
export interface PecaEmCache {
  readonly workspace: string;
  readonly numeroProcesso: string;
  readonly pecaId: string;
  /** Localizador opaco, entendido só pelo armazém. Nunca vai para a resposta. */
  readonly localizador: string;
  /** O que o tribunal entregou (antes da conversão). */
  readonly mimetypeOriginal: string;
  readonly conversao: ConversaoDaPeca;
  /** O que a conversão deixou de fora; a tela diz que é conversão. */
  readonly observacao?: string;
  readonly bytes: number;
  readonly paginas: number;
  readonly obtidaEm: Date;
  readonly expiraEm: Date;
}

/** Os estados que a lista mostra (especificação, seção 6). */
export type EstadoDaPecaNaPasta =
  'nao_baixada' | 'na_fila' | 'baixando' | 'disponivel' | 'nao_obtida' | 'sigilo';

/** Por que uma peça não pôde ser obtida — os mesmos motivos do leitor. */
export type MotivoDaPasta = MotivoNaoObtida;
