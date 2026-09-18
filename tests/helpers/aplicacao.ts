import { ProcessoSearchService } from '../../src/application/services/ProcessoSearchService.js';
import { ServicoAcompanhamento } from '../../src/application/services/ServicoAcompanhamento.js';
import { ServicoNotificacao } from '../../src/application/services/ServicoNotificacao.js';
import { ServicoPecas } from '../../src/application/services/ServicoPecas.js';
import { ServicoVigilanciaOab } from '../../src/application/services/ServicoVigilanciaOab.js';
import type { BuscaPorOabComPeriodo } from '../../src/application/services/ServicoVigilanciaOab.js';
import { BuscarProcessoPorNumero } from '../../src/domain/usecases/BuscarProcessoPorNumero.js';
import { BuscarProcessosPorOab } from '../../src/domain/usecases/BuscarProcessosPorOab.js';
import type { ProcessoProvider } from '../../src/domain/ports/ProcessoProvider.js';
import type { ProvedorDePecas } from '../../src/domain/ports/ProvedorDePecas.js';
import { BaixarPecaDoProcesso } from '../../src/domain/usecases/BaixarPecaDoProcesso.js';
import { ListarPecasDoProcesso } from '../../src/domain/usecases/ListarPecasDoProcesso.js';
import { RepositorioCredenciaisSqlite } from '../../src/infrastructure/persistencia/sqlite/RepositorioCredenciaisSqlite.js';
import { Cofre } from '../../src/infrastructure/seguranca/cofre.js';
import type { Notificador } from '../../src/domain/ports/Notificador.js';
import { Agendador } from '../../src/infrastructure/agenda/Agendador.js';
import { loggerSilencioso } from '../../src/infrastructure/logging/ConsoleLogger.js';
import { abrirBanco } from '../../src/infrastructure/persistencia/sqlite/banco.js';
import { RepositorioAcompanhamentosSqlite } from '../../src/infrastructure/persistencia/sqlite/RepositorioAcompanhamentosSqlite.js';
import { RepositorioNotificacaoSqlite } from '../../src/infrastructure/persistencia/sqlite/RepositorioNotificacaoSqlite.js';
import { RepositorioVigilanciasSqlite } from '../../src/infrastructure/persistencia/sqlite/RepositorioVigilanciasSqlite.js';
import type { Aplicacao } from '../../src/main/factories/makeProcessoSearchService.js';
import { ServicoContas } from '../../src/application/services/ServicoContas.js';
import { RepositorioUsuariosSqlite } from '../../src/infrastructure/persistencia/sqlite/RepositorioUsuariosSqlite.js';
import { tokensDeSessao } from '../../src/infrastructure/seguranca/sessao.js';
import type { HashDeSenha } from '../../src/domain/ports/Criptografia.js';
import { SenhaFracaError } from '../../src/domain/errors/index.js';

/**
 * Hash de senha BARATO, só para teste.
 *
 * O scrypt de produção gasta ~100ms por verificação de propósito. Numa suíte
 * que cria dezenas de contas isso vira meio minuto de espera, e teste lento é
 * teste que alguém para de rodar. A porta `HashDeSenha` existe justamente para
 * esta troca — o que se verifica aqui é o COMPORTAMENTO das contas, e o scrypt
 * de verdade tem a suíte dele.
 */
export const hashDeTeste: HashDeSenha = {
  validar: (senha) => {
    if (senha.length < 10) throw new SenhaFracaError(10);
  },
  guardar: (senha) => {
    if (senha.length < 10) throw new SenhaFracaError(10);
    return `teste:${senha}`;
  },
  conferir: (senha, guardada) => guardada === `teste:${senha}`,
  hashDeComparacao: 'teste:__ninguem__',
};

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
  /** Troca o hash de senha — use para testar o scrypt de verdade. */
  readonly senhas?: HashDeSenha;
  /** Duração da sessão; passe um valor negativo para simular sessão vencida. */
  readonly duracaoSessaoMs?: number;
  /** Fonte de peças. Sem ela, `pecas` fica indefinida e as rotas dão 501. */
  readonly provedorDePecas?: ProvedorDePecas;
  /**
   * Liga a recuperação de senha.
   *
   * Ausente de propósito por padrão: a instalação sem SMTP é o estado normal,
   * e é ele que os testes de "a recuperação não existe aqui" precisam ver.
   */
  readonly recuperacao?: {
    readonly notificador: Notificador;
    readonly urlBase: string;
    /** Passe um valor negativo para simular link já vencido. */
    readonly duracaoMs?: number;
  };
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

  // Chave de cofre gerada por teste: nenhum segredo fixo entra no repositório,
  // e cada teste tem a sua, o que também prova que o cofre não depende de
  // estado global.
  const pecas = opcoes.provedorDePecas
    ? (() => {
        const credenciais = new RepositorioCredenciaisSqlite(
          db,
          Cofre.comChaveBase64(Cofre.gerarChaveBase64()),
        );
        const provedor = opcoes.provedorDePecas as ProvedorDePecas;
        return new ServicoPecas({
          listar: new ListarPecasDoProcesso(provedor, credenciais),
          baixar: new BaixarPecaDoProcesso(provedor, credenciais),
          credenciais,
          logger: loggerSilencioso,
        });
      })()
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
    pecas,
    contas: new ServicoContas({
      repositorio: new RepositorioUsuariosSqlite(db),
      senhas: opcoes.senhas ?? hashDeTeste,
      tokens: tokensDeSessao,
      duracaoSessaoMs: opcoes.duracaoSessaoMs ?? 60 * 60 * 1000,
      ...(opcoes.recuperacao
        ? {
            notificador: opcoes.recuperacao.notificador,
            urlBase: opcoes.recuperacao.urlBase,
            ...(opcoes.recuperacao.duracaoMs !== undefined
              ? { duracaoRecuperacaoMs: opcoes.recuperacao.duracaoMs }
              : {}),
          }
        : {}),
    }),
    preferenciasNotificacao,
    notificador: opcoes.notificador ?? new NotificadorEspiao(),
    agendador: parado(),
    agendadorVigilancia: undefined,
    agendadorBackup: undefined,
    logger: loggerSilencioso,
    encerrar: () => db.close(),
  };
}
