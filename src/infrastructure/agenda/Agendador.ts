import type { Logger } from '../../domain/ports/Logger.js';

export interface OpcoesAgendador {
  readonly intervaloHoras: number;
  /** Espera antes da primeira execução. Padrão: 2 min. */
  readonly atrasoInicialMs?: number;
  readonly logger: Logger;
  readonly tarefa: () => Promise<unknown>;
}

/**
 * Agendador simples, em processo.
 *
 * `setInterval` e não cron externo porque há UMA instância: subir um worker
 * separado para disparar uma função a cada N horas seria mais infraestrutura
 * para manter do que o problema pede. Quando houver várias instâncias, isso
 * precisa virar um agendador com trava distribuída — senão todas varrem juntas.
 *
 * Duas decisões que evitam dor:
 *
 * - **Atraso inicial.** Não varrer no instante do arranque. Em redeploy, o
 *   contêiner novo sobe enquanto o antigo ainda drena; começar a martelar o CNJ
 *   nesse momento é o pior instante possível.
 * - **`unref()`** no timer, para o processo não ficar vivo só por causa dele
 *   durante o desligamento gracioso.
 */
export class Agendador {
  private timer: NodeJS.Timeout | undefined;
  private inicial: NodeJS.Timeout | undefined;
  private readonly log: Logger;

  constructor(private readonly opcoes: OpcoesAgendador) {
    this.log = opcoes.logger.child({ componente: 'agendador' });
  }

  iniciar(): void {
    const intervaloMs = this.opcoes.intervaloHoras * 3_600_000;
    if (intervaloMs <= 0) {
      this.log.info('agendamento desligado por configuração');
      return;
    }

    const atraso = this.opcoes.atrasoInicialMs ?? 120_000;

    this.inicial = setTimeout(() => {
      void this.executar();
      this.timer = setInterval(() => void this.executar(), intervaloMs);
      this.timer.unref();
    }, atraso);
    this.inicial.unref();

    this.log.info('agendamento ativo', {
      intervaloHoras: this.opcoes.intervaloHoras,
      primeiraEmSegundos: Math.round(atraso / 1000),
    });
  }

  parar(): void {
    if (this.inicial) clearTimeout(this.inicial);
    if (this.timer) clearInterval(this.timer);
    this.inicial = undefined;
    this.timer = undefined;
  }

  private async executar(): Promise<void> {
    try {
      await this.opcoes.tarefa();
    } catch (erro) {
      // Uma varredura que falha não pode derrubar o agendamento — senão a
      // primeira instabilidade do tribunal para as atualizações para sempre.
      this.log.error('tarefa agendada falhou', {
        erro: erro instanceof Error ? erro.message : String(erro),
      });
    }
  }
}
