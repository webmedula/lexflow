import { NumeroCNJ } from '../../domain/entities/NumeroCNJ.js';
import { herdarOrigemPorMovimento } from '../../domain/entities/Peca.js';
import type { ConteudoPeca, Peca } from '../../domain/entities/Peca.js';
import type { Movimentacao } from '../../domain/entities/Movimentacao.js';
import { CredencialTribunalInvalidaError } from '../../domain/errors/index.js';
import type { Logger } from '../../domain/ports/Logger.js';
import type {
  CredencialCadastrada,
  RepositorioCredenciais,
} from '../../domain/ports/RepositorioCredenciais.js';
import type { CredencialTribunal } from '../../domain/ports/ProvedorDePecas.js';
import type { BaixarPecaDoProcesso } from '../../domain/usecases/BaixarPecaDoProcesso.js';
import type { ListarPecasDoProcesso } from '../../domain/usecases/ListarPecasDoProcesso.js';
import type { BuscarProcessoPorNumero } from '../../domain/usecases/BuscarProcessoPorNumero.js';
import {
  batizarPeloCodigo,
  montarLinhaDoTempo,
} from '../../domain/entities/linhaDoTempo.js';
import type { LinhaDoTempo } from '../../domain/entities/linhaDoTempo.js';

export interface OpcoesServicoPecas {
  readonly listar: ListarPecasDoProcesso;
  readonly baixar: BaixarPecaDoProcesso;
  readonly credenciais: RepositorioCredenciais;
  readonly logger: Logger;
  /**
   * Opcional, e só para a régua temporal: é daqui que saem os andamentos das
   * fontes públicas que o tribunal não cobriu. Sem ele a régua é montada só com
   * o que o tribunal mandou — completa quanto ao tribunal, e sem as publicações
   * do DJEN que ele não numera.
   */
  readonly processos?: BuscarProcessoPorNumero;
}

/**
 * Orquestra o acesso às peças e mantém o ESTADO da credencial.
 *
 * Os casos de uso não fazem isso porque não é regra de negócio: saber que uma
 * credencial foi aceita ou recusada é informação operacional, que existe para
 * uma pessoa poder agir. E ela precisa existir por uma razão concreta — a
 * vigilância roda sozinha, de hora em hora, sem ninguém olhando. Quando a senha
 * do advogado no tribunal muda (e ela muda, por política de expiração), o que
 * acontece sem esta marcação é: a varredura passa a falhar em silêncio, o
 * advogado continua recebendo e-mail de "nada novo", e a primeira notícia do
 * problema é um prazo perdido.
 */
export class ServicoPecas {
  private readonly listar: ListarPecasDoProcesso;
  private readonly baixar: BaixarPecaDoProcesso;
  private readonly credenciais: RepositorioCredenciais;
  private readonly logger: Logger;
  private readonly processos: BuscarProcessoPorNumero | undefined;

  constructor(opcoes: OpcoesServicoPecas) {
    this.listar = opcoes.listar;
    this.baixar = opcoes.baixar;
    this.credenciais = opcoes.credenciais;
    this.logger = opcoes.logger.child({ servico: 'pecas' });
    this.processos = opcoes.processos;
  }

  /**
   * A régua temporal: um evento por ato, cada um já com os seus documentos.
   *
   * A consulta às fontes públicas roda em paralelo com a do tribunal e o
   * fracasso dela NÃO derruba a resposta: a régua do MNI sozinha já é mais
   * completa do que a tela anterior, e trocar isso por um erro porque o DataJud
   * oscilou seria piorar o que funciona por causa do que enfeita.
   */
  async linhaDoTempoDoProcesso(
    workspace: string,
    numeroProcesso: string,
  ): Promise<LinhaDoTempo> {
    const [atos, publicas] = await Promise.all([
      this.listarDoProcesso(workspace, numeroProcesso),
      this.movimentacoesPublicas(numeroProcesso),
    ]);

    return montarLinhaDoTempo({
      movimentacoes: publicas,
      movimentosDoTribunal: batizarPeloCodigo(atos.movimentos, publicas),
      pecas: atos.pecas,
    });
  }

  private async movimentacoesPublicas(
    numeroProcesso: string,
  ): Promise<readonly Movimentacao[]> {
    if (!this.processos) return [];
    try {
      const processo = await this.processos.executar({ numeroProcesso });
      return processo.movimentacoes;
    } catch (erro) {
      this.logger.debug('régua montada sem as fontes públicas', {
        numeroProcesso,
        motivo: erro instanceof Error ? erro.message : 'desconhecido',
      });
      return [];
    }
  }

  /**
   * As peças do processo e os movimentos que vieram na mesma resposta.
   *
   * Os dois juntos porque é assim que o tribunal responde — e porque separá-los
   * em duas chamadas custaria uma segunda consulta de dezenas de segundos para
   * montar uma única tela. Os movimentos são o que permite entregar cada
   * documento na linha do evento que o juntou, em vez de numa lista no rodapé.
   */
  async listarDoProcesso(
    workspace: string,
    numeroProcesso: string,
  ): Promise<{ pecas: Peca[]; movimentos: readonly Movimentacao[] }> {
    const atos = await this.registrando(workspace, numeroProcesso, () =>
      this.listar.executar({ workspace, numeroProcesso }),
    );
    // A dedução por movimento é sobre o CONJUNTO, não sobre uma peça — por isso
    // acontece aqui e não no mapper, que monta uma de cada vez.
    return {
      pecas: herdarOrigemPorMovimento(atos.pecas),
      movimentos: atos.movimentos,
    };
  }

  async baixarPeca(
    workspace: string,
    numeroProcesso: string,
    idPeca: string,
  ): Promise<ConteudoPeca> {
    return this.registrando(workspace, numeroProcesso, () =>
      this.baixar.executar({ workspace, numeroProcesso, idPeca }),
    );
  }

  async listarCredenciais(workspace: string): Promise<CredencialCadastrada[]> {
    return this.credenciais.listar(workspace);
  }

  async cadastrarCredencial(
    workspace: string,
    credencial: CredencialTribunal,
  ): Promise<CredencialCadastrada> {
    const cadastrada = await this.credenciais.salvar(workspace, credencial);
    // Identificação (o CPF do consultante) NÃO entra no log: é dado pessoal e
    // não ajuda a diagnosticar nada que o tribunal e o workspace já não digam.
    this.logger.info('credencial de tribunal cadastrada', {
      workspace,
      tribunal: cadastrada.tribunal,
    });
    return cadastrada;
  }

  async removerCredencial(workspace: string, tribunal: string): Promise<boolean> {
    return this.credenciais.remover(workspace, tribunal);
  }

  /**
   * Roda a operação e anota o veredito do tribunal sobre a credencial.
   *
   * O `catch` re-lança sempre: marcar a recusa não é tratar o erro. Engolir aqui
   * faria a rota devolver lista vazia de peças com HTTP 200 — o pior desfecho
   * possível, porque "não há peças" e "sua senha está errada" viram a mesma tela.
   */
  private async registrando<T>(
    workspace: string,
    numeroProcesso: string,
    operacao: () => Promise<T>,
  ): Promise<T> {
    const tribunal = NumeroCNJ.tentarCriar(numeroProcesso)?.siglaTribunal;

    try {
      const resultado = await operacao();
      if (tribunal) await this.credenciais.registrarUso(workspace, tribunal);
      return resultado;
    } catch (erro) {
      if (erro instanceof CredencialTribunalInvalidaError && tribunal) {
        await this.credenciais.registrarRecusa(workspace, tribunal);
        this.logger.warn('credencial recusada pelo tribunal', {
          workspace,
          tribunal,
          acao: 'o assinante precisa atualizar usuário e senha',
        });
      }
      throw erro;
    }
  }
}
