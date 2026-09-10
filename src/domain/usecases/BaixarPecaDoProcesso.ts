import { NumeroCNJ } from '../entities/NumeroCNJ.js';
import type { ConteudoPeca } from '../entities/Peca.js';
import {
  CredencialTribunalAusenteError,
  OperacaoNaoSuportadaError,
} from '../errors/index.js';
import type { ProvedorDePecas } from '../ports/ProvedorDePecas.js';
import type { RepositorioCredenciais } from '../ports/RepositorioCredenciais.js';

export interface EntradaBaixarPeca {
  readonly numeroProcesso: string;
  readonly idPeca: string;
  readonly workspace: string;
}

/**
 * Caso de uso: baixar o arquivo de UMA peça.
 *
 * Separado da listagem porque o custo é outro: listar 200 documentos é um
 * envelope de alguns KB; baixá-los é centenas de megabytes atravessando o
 * tribunal, o VPS e o navegador. A escolha de qual peça vale a pena é do
 * advogado, e o sistema não a toma por ele.
 */
export class BaixarPecaDoProcesso {
  constructor(
    private readonly provedor: ProvedorDePecas,
    private readonly credenciais: RepositorioCredenciais,
  ) {}

  /**
   * @throws {NumeroCNJInvalidoError | OperacaoNaoSuportadaError}
   * @throws {CredencialTribunalAusenteError | CredencialTribunalInvalidaError}
   * @throws {TeorNaoAutorizadoError} respondeu, mas não liberou o arquivo
   * @throws {ProviderIndisponivelError}
   */
  async executar(entrada: EntradaBaixarPeca): Promise<ConteudoPeca> {
    const numero = NumeroCNJ.criar(entrada.numeroProcesso);
    const sigla = numero.siglaTribunal;
    const atende =
      sigla !== null &&
      (this.provedor.tribunais.includes('*') || this.provedor.tribunais.includes(sigla));

    if (!atende) {
      throw new OperacaoNaoSuportadaError(
        this.provedor.nome,
        'obterConteudo',
        `nenhuma fonte de peças atende ${sigla ?? 'este tribunal'}`,
      );
    }

    const credencial = await this.credenciais.obter(entrada.workspace, sigla);
    if (!credencial) throw new CredencialTribunalAusenteError(sigla);

    return this.provedor.obterConteudo(numero.digitos, entrada.idPeca, credencial);
  }
}
