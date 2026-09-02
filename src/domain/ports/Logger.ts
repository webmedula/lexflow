export type NivelLog = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface Logger {
  debug(mensagem: string, contexto?: Record<string, unknown>): void;
  info(mensagem: string, contexto?: Record<string, unknown>): void;
  warn(mensagem: string, contexto?: Record<string, unknown>): void;
  error(mensagem: string, contexto?: Record<string, unknown>): void;
  /** Deriva um logger que carrega contexto fixo (ex.: `{ provider: 'datajud' }`). */
  child(contexto: Record<string, unknown>): Logger;
}
