import { ProcessoSearchService } from '../../src/application/services/ProcessoSearchService.js';
import { ServicoAcompanhamento } from '../../src/application/services/ServicoAcompanhamento.js';
import { BuscarProcessoPorNumero } from '../../src/domain/usecases/BuscarProcessoPorNumero.js';
import { BuscarProcessosPorOab } from '../../src/domain/usecases/BuscarProcessosPorOab.js';
import type { ProcessoProvider } from '../../src/domain/ports/ProcessoProvider.js';
import { Agendador } from '../../src/infrastructure/agenda/Agendador.js';
import { loggerSilencioso } from '../../src/infrastructure/logging/ConsoleLogger.js';
import { abrirBanco } from '../../src/infrastructure/persistencia/sqlite/banco.js';
import { RepositorioAcompanhamentosSqlite } from '../../src/infrastructure/persistencia/sqlite/RepositorioAcompanhamentosSqlite.js';
import type { Aplicacao } from '../../src/main/factories/makeProcessoSearchService.js';

/**
 * Monta uma `Aplicacao` completa para teste, com banco EM MEMÓRIA.
 *
 * Existe para que adicionar uma dependência nova ao composition root não
 * quebre meia dúzia de arquivos de teste que montavam o objeto na mão — foi
 * exatamente o que aconteceu quando o acompanhamento entrou.
 */
export function aplicacaoDeTeste(providers: readonly ProcessoProvider[]): Aplicacao {
  const orquestrador = new ProcessoSearchService({ providers });
  const db = abrirBanco(':memory:');
  const acompanhamento = new ServicoAcompanhamento({
    repositorio: new RepositorioAcompanhamentosSqlite(db),
    provider: orquestrador,
    logger: loggerSilencioso,
    pausaEntreConsultasMs: 0,
  });

  return {
    buscarProcessoPorNumero: new BuscarProcessoPorNumero(orquestrador),
    buscarProcessosPorOab: new BuscarProcessosPorOab(orquestrador),
    orquestrador,
    provider: orquestrador,
    acompanhamento,
    // Intervalo 0: o agendador não dispara sozinho durante os testes.
    agendador: new Agendador({
      intervaloHoras: 0,
      logger: loggerSilencioso,
      tarefa: async () => {},
    }),
    logger: loggerSilencioso,
    encerrar: () => db.close(),
  };
}
