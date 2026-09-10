import { NumeroCNJ } from '../../domain/entities/NumeroCNJ.js';
import type { ConteudoPeca, Peca } from '../../domain/entities/Peca.js';
import { CredencialTribunalInvalidaError } from '../../domain/errors/index.js';
import type { Logger } from '../../domain/ports/Logger.js';
import type {
  CredencialCadastrada,
  RepositorioCredenciais,
} from '../../domain/ports/RepositorioCredenciais.js';
import type { CredencialTribunal } from '../../domain/ports/ProvedorDePecas.js';
import type { BaixarPecaDoProcesso } from '../../domain/usecases/BaixarPecaDoProcesso.js';
import type { ListarPecasDoProcesso } from '../../domain/usecases/ListarPecasDoProcesso.js';

export interface OpcoesServicoPecas {
  readonly listar: ListarPecasDoProcesso;
  readonly baixar: BaixarPecaDoProcesso;
  readonly credenciais: RepositorioCredenciais;
  readonly logger: Logger;
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

  constructor(opcoes: OpcoesServicoPecas) {
    this.listar = opcoes.listar;
    this.baixar = opcoes.baixar;
    this.credenciais = opcoes.credenciais;
    this.logger = opcoes.logger.child({ servico: 'pecas' });
  }

  async listarDoProcesso(workspace: string, numeroProcesso: string): Promise<Peca[]> {
    return this.registrando(workspace, numeroProcesso, () =>
      this.listar.executar({ workspace, numeroProcesso }),
    );
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
