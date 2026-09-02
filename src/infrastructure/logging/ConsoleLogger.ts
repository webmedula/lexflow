import type { Logger, NivelLog } from '../../domain/ports/Logger.js';

const ORDEM: Record<NivelLog, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

/**
 * Logger estruturado (uma linha JSON por evento) sem dependência externa.
 *
 * Escreve em stderr para não poluir o stdout, que o CLI usa como saída de
 * dados — assim `npm run cli -- ... > processo.json` continua produzindo JSON
 * puro mesmo com log ligado.
 *
 * Trocar por Pino depois é implementar esta mesma porta `Logger`.
 */
export class ConsoleLogger implements Logger {
  constructor(
    private readonly nivel: NivelLog = 'info',
    private readonly contextoBase: Record<string, unknown> = {},
  ) {}

  debug(mensagem: string, contexto?: Record<string, unknown>): void {
    this.escrever('debug', mensagem, contexto);
  }

  info(mensagem: string, contexto?: Record<string, unknown>): void {
    this.escrever('info', mensagem, contexto);
  }

  warn(mensagem: string, contexto?: Record<string, unknown>): void {
    this.escrever('warn', mensagem, contexto);
  }

  error(mensagem: string, contexto?: Record<string, unknown>): void {
    this.escrever('error', mensagem, contexto);
  }

  child(contexto: Record<string, unknown>): Logger {
    return new ConsoleLogger(this.nivel, { ...this.contextoBase, ...contexto });
  }

  private escrever(
    nivel: Exclude<NivelLog, 'silent'>,
    mensagem: string,
    contexto?: Record<string, unknown>,
  ): void {
    if (ORDEM[nivel] < ORDEM[this.nivel]) return;

    const linha = JSON.stringify({
      ts: new Date().toISOString(),
      nivel,
      msg: mensagem,
      ...this.contextoBase,
      ...contexto,
    });
    console.error(linha);
  }
}

/** Logger que descarta tudo — padrão nos testes. */
export const loggerSilencioso: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => loggerSilencioso,
};
