import { ProcessoSearchService } from '../../src/application/services/ProcessoSearchService.js';
import { ServicoAcompanhamento } from '../../src/application/services/ServicoAcompanhamento.js';
import { ServicoNotificacao } from '../../src/application/services/ServicoNotificacao.js';
import { ServicoVigilanciaOab } from '../../src/application/services/ServicoVigilanciaOab.js';
import type { BuscaPorOabComPeriodo } from '../../src/application/services/ServicoVigilanciaOab.js';
import { BuscarProcessoPorNumero } from '../../src/domain/usecases/BuscarProcessoPorNumero.js';
import { BuscarProcessosPorOab } from '../../src/domain/usecases/BuscarProcessosPorOab.js';
import type { ProcessoProvider } from '../../src/domain/ports/ProcessoProvider.js';
import type { Notificador } from '../../src/domain/ports/Notificador.js';
import { Agendador } from '../../src/infrastructure/agenda/Agendador.js';
import { loggerSilencioso } from '../../src/infrastructure/logging/ConsoleLogger.js';
import { abrirBanco } from '../../src/infrastructure/persistencia/sqlite/banco.js';
import { RepositorioAcompanhamentosSqlite } from '../../src/infrastructure/persistencia/sqlite/RepositorioAcompanhamentosSqlite.js';
import { RepositorioNotificacaoSqlite } from '../../src/infrastructure/persistencia/sqlite/RepositorioNotificacaoSqlite.js';
import { RepositorioVigilanciasSqlite } from '../../src/infrastructure/persistencia/sqlite/RepositorioVigilanciasSqlite.js';
import type { Aplicacao } from '../../src/main/factories/makeProcessoSearchService.js';

/** Notificador que guarda o que "enviou", para o teste conferir o conteúdo. */
export class NotificadorEspiao implements Notificador {
  readonly nome = 'espiao';
  readonly habilitado = true;
  readonly enviadas: Array<{ para: string; assunto: string; texto: string }> = [];

  async enviar(m: { para: string; assunto: string; texto: string }): Promise<boolean> {
    this.enviadas.push(m);
    return true;
  }
}

export interface OpcoesAplicacaoDeTeste {
  /** Fonte da vigilância por OAB. Sem ela, `vigilancia` fica indefinida. */
  readonly buscaOab?: BuscaPorOabComPeriodo;
  readonly notificador?: Notificador;
  readonly agora?: () => Date;
}

/**
 * Monta uma `Aplicacao` completa para teste, com banco EM MEMÓRIA.
 *
 * Existe para que adicionar uma dependência nova ao composition root não
 * quebre meia dúzia de arquivos de teste que montavam o objeto na mão — foi
 * exatamente o que aconteceu quando o acompanhamento entrou.
 */
export function aplicacaoDeTeste(
  providers: readonly ProcessoProvider[],
  opcoes: OpcoesAplicacaoDeTeste = {},
): Aplicacao {
  const orquestrador = new ProcessoSearchService({ providers });
  const db = abrirBanco(':memory:');
  const repositorio = new RepositorioAcompanhamentosSqlite(db);

  const acompanhamento = new ServicoAcompanhamento({
    repositorio,
    provider: orquestrador,
    logger: loggerSilencioso,
    pausaEntreConsultasMs: 0,
  });

  const preferenciasNotificacao = new RepositorioNotificacaoSqlite(db);
  const notificacao = new ServicoNotificacao({
    preferencias: preferenciasNotificacao,
    acompanhamentos: repositorio,
    notificador: opcoes.notificador ?? new NotificadorEspiao(),
    logger: loggerSilencioso,
    ...(opcoes.agora ? { agora: opcoes.agora } : {}),
  });

  const vigilancia = opcoes.buscaOab
    ? new ServicoVigilanciaOab({
        vigilancias: new RepositorioVigilanciasSqlite(db),
        acompanhamentos: repositorio,
        busca: opcoes.buscaOab,
        logger: loggerSilencioso,
        pausaMs: 0,
        ...(opcoes.agora ? { agora: opcoes.agora } : {}),
      })
    : undefined;

  // Intervalo 0: nenhum agendador dispara sozinho durante os testes.
  const parado = (): Agendador =>
    new Agendador({ intervaloHoras: 0, logger: loggerSilencioso, tarefa: async () => {} });

  return {
    buscarProcessoPorNumero: new BuscarProcessoPorNumero(orquestrador),
    buscarProcessosPorOab: new BuscarProcessosPorOab(orquestrador),
    orquestrador,
    provider: orquestrador,
    acompanhamento,
    vigilancia,
    notificacao,
    preferenciasNotificacao,
    agendador: parado(),
    agendadorVigilancia: undefined,
    logger: loggerSilencioso,
    encerrar: () => db.close(),
  };
}
