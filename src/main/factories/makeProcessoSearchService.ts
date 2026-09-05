import { ProcessoSearchService } from '../../application/services/ProcessoSearchService.js';
import { ServicoAcompanhamento } from '../../application/services/ServicoAcompanhamento.js';
import { Agendador } from '../../infrastructure/agenda/Agendador.js';
import { abrirBanco } from '../../infrastructure/persistencia/sqlite/banco.js';
import { RepositorioAcompanhamentosSqlite } from '../../infrastructure/persistencia/sqlite/RepositorioAcompanhamentosSqlite.js';
import type { Logger } from '../../domain/ports/Logger.js';
import type { ProcessoProvider } from '../../domain/ports/ProcessoProvider.js';
import { BuscarProcessoPorNumero } from '../../domain/usecases/BuscarProcessoPorNumero.js';
import { BuscarProcessosPorOab } from '../../domain/usecases/BuscarProcessosPorOab.js';
import {
  DataJudAdapter,
  NOME_DATAJUD,
} from '../../infrastructure/adapters/datajud/DataJudAdapter.js';
import {
  MockCrawlerAdapter,
  NOME_MOCK_CRAWLER,
} from '../../infrastructure/adapters/crawler/MockCrawlerAdapter.js';
import { CachedProcessoProvider } from '../../infrastructure/cache/CachedProcessoProvider.js';
import { InMemoryCache } from '../../infrastructure/cache/InMemoryCache.js';
import type { Config } from '../../infrastructure/config/env.js';
import { pareceValorDeExemplo } from '../../infrastructure/config/placeholder.js';
import { ConsoleLogger } from '../../infrastructure/logging/ConsoleLogger.js';

export interface Aplicacao {
  readonly buscarProcessoPorNumero: BuscarProcessoPorNumero;
  readonly buscarProcessosPorOab: BuscarProcessosPorOab;
  readonly orquestrador: ProcessoSearchService;
  readonly provider: ProcessoProvider;
  readonly acompanhamento: ServicoAcompanhamento;
  readonly agendador: Agendador;
  readonly logger: Logger;
  /** Fecha o banco. Chamado no desligamento gracioso. */
  readonly encerrar: () => void;
}

/**
 * COMPOSITION ROOT — o único lugar do sistema que sabe quais implementações
 * concretas existem e as amarra.
 *
 * Todo `new` de infraestrutura acontece aqui. É o que permite ao domínio
 * depender só de interfaces: nenhuma outra camada importa `DataJudAdapter`, e
 * por isso trocar a fonte, reordenar a cadeia ou desligar o cache é editar
 * ESTE arquivo — não caçar dependências espalhadas.
 *
 * A montagem final fica assim:
 *
 *   CasosDeUso → CachedProcessoProvider → ProcessoSearchService → [ adapters ]
 *                └── decorator de cache   └── fallback/estratégia
 *
 * O cache embrulha o orquestrador, não cada adapter: o que interessa guardar é
 * a RESPOSTA ao usuário, venha ela de qual fonte vier — e assim um acerto de
 * cache não gasta nem a cota do DataJud nem uma ida ao tribunal.
 */
export function montarAplicacao(config: Config): Aplicacao {
  const logger = new ConsoleLogger(config.nivelLog);

  const providers = construirProviders(config, logger);
  if (providers.length === 0) {
    throw new Error(
      `Nenhum provider utilizável em LEXFLOW_PROVIDER_CHAIN="${config.cadeiaDeProviders.join(',')}". ` +
        `Valores aceitos: ${NOME_MOCK_CRAWLER}, ${NOME_DATAJUD}.`,
    );
  }

  const orquestrador = new ProcessoSearchService({
    providers,
    logger,
    estrategiaOab: 'AGREGAR',
  });

  const provider: ProcessoProvider = config.cache.habilitado
    ? new CachedProcessoProvider({
        provider: orquestrador,
        cache: new InMemoryCache({
          ttlPadraoSegundos: config.cache.ttlSegundos,
          maxEntradas: config.cache.maxEntradas,
        }),
        ttlNumeroSegundos: config.cache.ttlSegundos,
        ttlOabSegundos: Math.min(300, config.cache.ttlSegundos),
      })
    : orquestrador;

  // O banco entra aqui, no único lugar que conhece implementações concretas.
  const db = abrirBanco(config.banco.caminho);
  const repositorio = new RepositorioAcompanhamentosSqlite(db);

  // A sincronização usa o `provider` COM cache: se dois workspaces acompanham
  // o mesmo processo, a segunda consulta da varredura sai da memória em vez de
  // gastar outra ida de 20 segundos ao CNJ.
  const acompanhamento = new ServicoAcompanhamento({
    repositorio,
    provider,
    logger,
    maximoPorVarredura: config.sincronizacao.maximoPorVarredura,
    pausaEntreConsultasMs: config.sincronizacao.pausaMs,
  });

  const agendador = new Agendador({
    intervaloHoras: config.sincronizacao.intervaloHoras,
    logger,
    tarefa: () => acompanhamento.sincronizar(),
  });

  return {
    buscarProcessoPorNumero: new BuscarProcessoPorNumero(provider),
    buscarProcessosPorOab: new BuscarProcessosPorOab(provider),
    orquestrador,
    provider,
    acompanhamento,
    agendador,
    logger,
    encerrar: () => {
      agendador.parar();
      db.close();
    },
  };
}

/**
 * A ordem da cadeia é a ordem declarada em `LEXFLOW_PROVIDER_CHAIN` — mudar a
 * fonte primária em produção é mudar uma variável de ambiente, sem redeploy de
 * código.
 *
 * Um provider mal configurado (ex.: DataJud sem chave) é OMITIDO com aviso, em
 * vez de derrubar o processo: perder o fallback é ruim, mas ficar sem serviço
 * porque a fonte secundária não tem credencial é pior.
 */
function construirProviders(config: Config, logger: Logger): ProcessoProvider[] {
  const providers: ProcessoProvider[] = [];

  for (const nome of config.cadeiaDeProviders) {
    switch (nome) {
      case NOME_MOCK_CRAWLER:
        providers.push(
          new MockCrawlerAdapter({
            latenciaMs: config.mockCrawler.latenciaMs,
            taxaDeFalha: config.mockCrawler.taxaDeFalha,
          }),
        );
        break;

      case NOME_DATAJUD:
        // Placeholder é tratado como AUSENTE, não como chave ruim. Do contrário
        // o adapter entra na cadeia com uma credencial de mentira e o problema
        // só aparece como 401 lá na consulta — longe da causa real, que é uma
        // variável nunca preenchida.
        if (pareceValorDeExemplo(config.dataJud.apiKey)) {
          logger.warn(
            'DataJud fora da cadeia: DATAJUD_API_KEY ainda contém o texto de exemplo',
            {
              valor: config.dataJud.apiKey,
              acao: 'Apague o conteúdo da variável, ou cole a chave real.',
              ajuda: 'https://datajud-wiki.cnj.jus.br/api-publica/acesso/',
            },
          );
          break;
        }
        if (!config.dataJud.apiKey) {
          logger.warn('DataJud fora da cadeia: DATAJUD_API_KEY não definida', {
            ajuda: 'https://datajud-wiki.cnj.jus.br/api-publica/acesso/',
          });
          break;
        }
        providers.push(
          new DataJudAdapter({
            apiKey: config.dataJud.apiKey,
            baseUrl: config.dataJud.baseUrl,
            timeoutMs: config.dataJud.timeoutMs,
            limitePorMinuto: config.dataJud.limitePorMinuto,
            logger,
          }),
        );
        break;

      default:
        logger.warn('provider desconhecido ignorado', { nome });
    }
  }

  return providers;
}
