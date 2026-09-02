/**
 * Porta de cache. Assinatura deliberadamente mínima para que a troca de
 * memória por Redis seja um arquivo novo em `infrastructure/cache`, sem tocar
 * em nada acima.
 */
export interface Cache {
  get<T>(chave: string): Promise<T | undefined>;
  set<T>(chave: string, valor: T, ttlSegundos?: number): Promise<void>;
  delete(chave: string): Promise<void>;
  clear(): Promise<void>;
}
