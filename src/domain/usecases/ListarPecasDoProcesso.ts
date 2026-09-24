import { NumeroCNJ } from '../entities/NumeroCNJ.js';
import {
  CredencialTribunalAusenteError,
  OperacaoNaoSuportadaError,
} from '../errors/index.js';
import type { AtosDoProcesso, ProvedorDePecas } from '../ports/ProvedorDePecas.js';
import type { RepositorioCredenciais } from '../ports/RepositorioCredenciais.js';

export interface EntradaListarPecas {
  readonly numeroProcesso: string;
  /** Espaço do assinante. A credencial é dele, não do sistema. */
  readonly workspace: string;
}

/**
 * Caso de uso: listar as peças de um processo.
 *
 * É a consulta que o DJEN nunca vai responder. O diário publica ato judicial;
 * petição inicial, contestação, laudo e documento juntado pela parte não são
 * publicados — então um sistema alimentado só por diário mostra decisões e
 * julgados, e nada do que as partes escreveram.
 *
 * O tribunal sai do próprio número CNJ, e não de um parâmetro: o número já
 * carrega segmento e tribunal, e pedir de novo abriria espaço para o chamador
 * informar um tribunal que não é o do processo — pedindo peça com a credencial
 * errada, que é como se coleciona recusa até a conta do advogado ser bloqueada.
 */
export class ListarPecasDoProcesso {
  constructor(
    private readonly provedor: ProvedorDePecas,
    private readonly credenciais: RepositorioCredenciais,
  ) {}

  /**
   * @throws {NumeroCNJInvalidoError} número mal formado ou com DV inválido
   * @throws {OperacaoNaoSuportadaError} nenhuma fonte de peças atende esse tribunal
   * @throws {CredencialTribunalAusenteError} o workspace não cadastrou o acesso
   * @throws {CredencialTribunalInvalidaError | ProviderIndisponivelError}
   * @returns as peças E os movimentos que o tribunal entregou na mesma resposta
   */
  async executar(entrada: EntradaListarPecas): Promise<AtosDoProcesso> {
    const numero = NumeroCNJ.criar(entrada.numeroProcesso);
    const tribunal = this.exigirTribunalAtendido(numero);

    const credencial = await this.credenciais.obter(entrada.workspace, tribunal);
    if (!credencial) throw new CredencialTribunalAusenteError(tribunal);

    // `listarAtos` quando a fonte tem linha do tempo própria, e é ela que
    // permite entregar o documento na linha do evento. Fonte que não tem cai no
    // caminho antigo e a tela degrada para a lista no rodapé — nunca quebra.
    if (this.provedor.listarAtos) {
      return this.provedor.listarAtos(numero.digitos, credencial);
    }
    const pecas = await this.provedor.listarPecas(numero.digitos, credencial);
    return { pecas, movimentos: [] };
  }

  /**
   * Recusa cedo, e com o nome do tribunal na mensagem.
   *
   * Sem esta checagem, um processo do TJSP seria consultado contra o endpoint
   * do TJGO com a credencial do TJGO: o tribunal responderia "processo não
   * encontrado", e o advogado concluiria que o processo dele sumiu — quando o
   * que falta é uma fonte de peças para aquele tribunal.
   */
  private exigirTribunalAtendido(numero: NumeroCNJ): string {
    const sigla = numero.siglaTribunal;
    const atende =
      sigla !== null &&
      (this.provedor.tribunais.includes('*') || this.provedor.tribunais.includes(sigla));

    if (!atende) {
      throw new OperacaoNaoSuportadaError(
        this.provedor.nome,
        'listarPecas',
        `nenhuma fonte de peças atende ${sigla ?? 'este tribunal'} — atendidos: ${this.provedor.tribunais.join(', ')}`,
      );
    }
    return sigla;
  }
}
