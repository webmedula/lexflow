/**
 * Porta de tempo. Existe para que TTL de cache e janela de rate limit sejam
 * testáveis sem `setTimeout` nem `vi.useFakeTimers()` espalhados pela suíte.
 */
export interface Clock {
  agora(): Date;
  /** Milissegundos monotônicos — para medir duração, não para carimbar data. */
  monotonico(): number;
}

export const clockDoSistema: Clock = {
  agora: () => new Date(),
  monotonico: () => performance.now(),
};
