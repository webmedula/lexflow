import type { Movimentacao } from './Movimentacao.js';
import { triar } from './triagem.js';

/**
 * Em que pé está uma pasta, em uma palavra.
 *
 * Existe para a carteira em tabela: com 142 linhas, "última movimentação" é
 * texto corrido que o olho não varre. Uma coluna de estado responde de longe.
 *
 * O QUE NÃO ESTÁ AQUI, e a ausência é decisão: *Audiência* e *Trânsito em
 * julgado*. As duas apareciam na referência que originou esta tela e as duas
 * exigiriam ler código da TPU que nunca vi numa resposta real deste projeto.
 * Um selo "Audiência" que erra na tela de um advogado é pior do que coluna
 * nenhuma — ele não vai conferir o que o sistema afirmou com tanta convicção.
 * Entram quando houver captura real que sustente a classificação.
 */
export type RotuloDaPasta = 'PROVIDENCIA' | 'NOVIDADE' | 'ARQUIVADO' | 'EM_CURSO';

export interface EstadoDaPasta {
  readonly rotulo: RotuloDaPasta;
  /**
   * A última tentativa de verificar este processo falhou, ou nunca houve uma.
   *
   * É um marcador SEPARADO do rótulo, e não um quinto valor dele, porque as
   * duas informações coexistem: uma pasta pode ter prazo aberto E estar sem
   * verificação há três dias. Colapsar as duas num só selo esconderia sempre
   * uma delas, e não há escolha boa sobre qual esconder — a providência é o
   * que fazer hoje, a falha é o motivo para não confiar no silêncio.
   *
   * Ver a regra do `ServicoNotificacao`: a partir do primeiro aviso enviado, o
   * advogado para de conferir à mão e lê silêncio como "não houve nada".
   */
  readonly naoVerificado: boolean;
  /** Por que o rótulo é este. Vai para o title do selo: heurística sem explicação não se audita. */
  readonly motivo?: string;
}

/**
 * Janela, em dias, em que uma determinação ainda conta como pendente.
 *
 * É a configuração ÚNICA (`PENDENCIA_JANELA_DIAS`, 10 por padrão desde a
 * v0.32.1; era 30): o selo da carteira, o card do painel e o bloco "Pede
 * providência" da tela do processo leem o MESMO valor, que o servidor entrega
 * à tela. Duas janelas dariam uma carteira que diz "providência" e uma tela do
 * processo que não mostra o ato.
 *
 * Sem janela, um "intime-se" de 2019 deixaria a pasta marcada como pendente
 * para sempre, e o selo perderia o sentido — toda pasta antiga ficaria
 * vermelha. Com 30 dias a carteira inteira de um escritório ativo vivia
 * marcada; 10 foi o que os advogados pediram.
 *
 * Não é cálculo de prazo, e não se apresenta como tal: é o recorte do que vale
 * a pena olhar primeiro. O ato fora da janela continua marcado na linha do
 * tempo — só deixa de ocupar o topo.
 */
export const PENDENCIA_JANELA_DIAS_PADRAO = 10;

/** Instante a partir do qual um ato ainda está na janela de pendência. */
export function inicioDaJanelaDePendencia(
  agora: Date,
  janelaDias: number = PENDENCIA_JANELA_DIAS_PADRAO,
): Date {
  return new Date(agora.getTime() - janelaDias * 86_400_000);
}

/** Título de ato que encerra a pasta. `desarquivamento` NÃO entra — ele reabre. */
const ENCERRAMENTO = /\b(arquivamento|arquivado|arquivados|baixa\s+definitiva)\b/i;
const REABERTURA = /\bdesarquiv/i;

export interface EntradaDoEstado {
  readonly erro?: string;
  readonly sincronizadoEm?: Date;
  readonly novidadesNaoVistas?: number;
  readonly movimentacoes?: readonly Movimentacao[];
}

export function estadoDaPasta(
  entrada: EntradaDoEstado,
  agora: Date = new Date(),
  janelaDias: number = PENDENCIA_JANELA_DIAS_PADRAO,
): EstadoDaPasta {
  const naoVerificado =
    entrada.erro !== undefined || entrada.sincronizadoEm === undefined;
  const movs = entrada.movimentacoes ?? [];

  const limite = inicioDaJanelaDePendencia(agora, janelaDias).getTime();
  const recentes = movs.filter((m) => m.data.getTime() >= limite);
  const pendente = recentes.find((m) => m.exigeAcao ?? triar(m).exigeAcao);
  if (pendente) {
    return {
      rotulo: 'PROVIDENCIA',
      naoVerificado,
      motivo: `"${pendente.titulo}" nos últimos ${janelaDias} dias`,
    };
  }

  if ((entrada.novidadesNaoVistas ?? 0) > 0) {
    return { rotulo: 'NOVIDADE', naoVerificado, motivo: 'há movimentação não lida' };
  }

  /*
   * O encerramento se decide pelo ato MAIS RECENTE, nunca por "existe um
   * arquivamento no histórico". Processo arquivado e depois desarquivado tem os
   * dois atos; olhar o histórico inteiro marcaria como encerrada uma pasta que
   * voltou a correr — e o advogado deixaria de olhar justamente a que voltou.
   */
  const ultima = maisRecente(movs);
  if (ultima && ENCERRAMENTO.test(ultima.titulo) && !REABERTURA.test(ultima.titulo)) {
    return { rotulo: 'ARQUIVADO', naoVerificado, motivo: ultima.titulo };
  }

  return { rotulo: 'EM_CURSO', naoVerificado };
}

function maisRecente(movs: readonly Movimentacao[]): Movimentacao | undefined {
  let melhor: Movimentacao | undefined;
  for (const m of movs) {
    if (!melhor || m.data.getTime() > melhor.data.getTime()) melhor = m;
  }
  return melhor;
}
