import type { Movimentacao } from './Movimentacao.js';
import type { Processo } from './Processo.js';

/**
 * Um processo que alguém pediu para acompanhar.
 *
 * É o que transforma o LexFlow de "consulta avulsa" em produto de assinatura:
 * o advogado não quer perguntar pelo processo todo dia, quer ser avisado quando
 * algo acontece nele.
 */
export interface Acompanhamento {
  /** Espaço isolado do assinante. Ver `workspaceDaChave`. */
  readonly workspace: string;
  /** Número CNJ sem máscara — 20 dígitos. Chave junto com o workspace. */
  readonly numero: string;
  /** Nome que o usuário deu ("Ação do cliente Silva"), opcional. */
  readonly apelido?: string;
  readonly criadoEm: Date;
  /** Última sincronização BEM-SUCEDIDA. Ausente = nunca sincronizou. */
  readonly sincronizadoEm?: Date;
  /** Motivo da última falha de sincronização, se a última tentativa falhou. */
  readonly erro?: string;
  /** Último retrato conhecido do processo. Ausente antes da primeira busca. */
  readonly processo?: Processo;
}

/**
 * Uma movimentação que apareceu depois que começamos a acompanhar.
 *
 * Guardada como registro próprio, e não deduzida na hora de exibir, por dois
 * motivos: o feed precisa ser ordenável e filtrável sem reprocessar todos os
 * processos, e "quando NÓS vimos" é diferente de "quando o tribunal registrou"
 * — um movimento de 2023 pode entrar hoje, se o tribunal publicou com atraso.
 */
export interface Novidade {
  readonly id: number;
  readonly workspace: string;
  readonly numero: string;
  /** Data do andamento, como o tribunal informou. */
  readonly data: Date;
  readonly titulo: string;
  readonly codigoTpu?: number;
  readonly conteudo?: string;
  /** Quando o LexFlow percebeu. */
  readonly detectadaEm: Date;
  /** Quando o usuário leu. Ausente = ainda não vista. */
  readonly vistaEm?: Date;
}

/**
 * Identidade de uma movimentação para fins de comparação entre sincronizações.
 *
 * `idExterno` entra no fim, e não no lugar dos outros dois, por
 * retrocompatibilidade: fonte que não expõe identificador (o DataJud) produz
 * exatamente a mesma chave de antes, e nenhum acompanhamento já gravado passa a
 * ver o histórico inteiro como novidade no primeiro deploy desta versão.
 */
export function chaveDaMovimentacao(m: Movimentacao): string {
  return `${m.data.toISOString()}|${m.titulo}|${m.idExterno ?? ''}`;
}

/**
 * Compara o retrato guardado com o que a fonte devolveu agora.
 *
 * Deliberadamente conservador: só considera NOVO o que não existia antes. Se o
 * tribunal reescreve ou remove um andamento, isso não vira novidade — some do
 * retrato e pronto. Inventar "movimentação removida" a partir de uma ausência
 * geraria alarme falso toda vez que a fonte oscilasse.
 *
 * @param anterior retrato guardado; ausente na primeira sincronização
 * @returns movimentações que apareceram agora, da mais antiga para a mais nova
 */
export function detectarNovidades(
  anterior: Processo | undefined,
  atual: Processo,
): Movimentacao[] {
  // Primeira sincronização não gera novidade: o processo inteiro é "novo", e
  // despejar 361 avisos na cara de quem acabou de adicionar não ajuda ninguém.
  if (!anterior) return [];

  const conhecidas = new Set(anterior.movimentacoes.map(chaveDaMovimentacao));
  return atual.movimentacoes
    .filter((m) => !conhecidas.has(chaveDaMovimentacao(m)))
    .slice()
    .sort((a, b) => a.data.getTime() - b.data.getTime());
}
