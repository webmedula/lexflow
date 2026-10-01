import type { JobLeitor } from '../entities/JobLeitor.js';

/**
 * PORTA da fila de jobs do leitor.
 *
 * Mínima por decisão: uma tabela, sem broker. Duas propriedades são o
 * contrato, e qualquer implementação nova precisa mantê-las:
 *
 * 1. **Sobrevive a redeploy.** O job grava o estado de cada peça a cada lote;
 *    a retomada continua de onde parou sem baixar de novo o que já veio.
 * 2. **Toda leitura pelo assinante passa pelo workspace.** `obter` recebe o
 *    workspace e não acha job de outro — não existe "obter por id" sem dono.
 *    As únicas leituras sem workspace são as do próprio executor da fila
 *    (`proximoParaExecutar`, `expirados`), que nunca chegam a uma resposta HTTP.
 */
export interface FilaDeJobs {
  criar(job: JobLeitor): Promise<void>;

  /** Grava o job inteiro. O dono não muda; a chave é (workspace, id). */
  salvar(job: JobLeitor): Promise<void>;

  /** @returns `undefined` quando não existe OU é de outro workspace. */
  obter(workspace: string, jobId: string): Promise<JobLeitor | undefined>;

  /**
   * O job mais antigo que pode andar agora: na fila, interrompido no meio por
   * redeploy, ou pausado cuja retomada já chegou.
   */
  proximoParaExecutar(agora: Date): Promise<JobLeitor | undefined>;

  /** Jobs com arquivo cujo prazo de guarda passou. */
  expirados(agora: Date): Promise<JobLeitor[]>;

  /** Todos os jobs de um workspace — para a exclusão de conta. */
  doWorkspace(workspace: string): Promise<JobLeitor[]>;

  /** Remove as linhas de um workspace. @returns quantas. */
  apagarDoWorkspace(workspace: string): Promise<number>;
}
