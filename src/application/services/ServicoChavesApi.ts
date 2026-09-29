import type { ChavesDeApi } from '../../domain/ports/Criptografia.js';
import type {
  ChaveApiCadastrada,
  RepositorioChavesApi,
} from '../../domain/ports/RepositorioChavesApi.js';
import { ChaveApiNaoEncontradaError } from '../../domain/errors/index.js';

/**
 * Uma chave recém-emitida — a ÚNICA vez em que `chave` existe fora da memória
 * de quem a copiou. Depois deste retorno, nem este serviço nem o banco sabem
 * mais qual é o valor: só o hash.
 */
export interface ChaveApiEmitida extends ChaveApiCadastrada {
  readonly chave: string;
}

export interface OpcoesServicoChavesApi {
  readonly repositorio: RepositorioChavesApi;
  readonly chaves: ChavesDeApi;
  readonly agora?: () => Date;
}

/**
 * Emissão e gestão das chaves de API pela área administrativa.
 *
 * **Por que o workspace de uma chave emitida aqui é isolado, igual ao de uma
 * chave do `.env`, e não o de uma conta já existente:** hoje não existe
 * mapeamento de chave para workspace no banco — o workspace É a chave,
 * derivada por hash. Uma chave nova sempre abre um ambiente novo e vazio; não
 * há como emitir uma chave que aponte para a carteira de um assinante que já
 * tem login e senha. Fazer isso exigiria guardar workspace por linha em vez de
 * derivá-lo, e essa mudança foi deliberadamente adiada — ver a conversa que
 * originou esta entrega. Para as integrações do próprio operador (n8n,
 * scripts), que é o caso de uso desta tela, carteira isolada é o suficiente.
 */
export class ServicoChavesApi {
  private readonly repositorio: RepositorioChavesApi;
  private readonly chaves: ChavesDeApi;
  private readonly agora: () => Date;

  constructor(opcoes: OpcoesServicoChavesApi) {
    this.repositorio = opcoes.repositorio;
    this.chaves = opcoes.chaves;
    this.agora = opcoes.agora ?? ((): Date => new Date());
  }

  /**
   * Gera, guarda o HASH e devolve a chave em texto puro — só desta vez.
   *
   * `identificador` e `workspace` saem do MESMO hash que vai para o banco (ver
   * `ChaveApiCadastrada`), e não de uma nova chamada a `this.chaves.hash`: são
   * a mesma fatia, calculada uma vez, para nunca divergir do que
   * `RepositorioChavesApi.listar()` devolve depois.
   */
  async emitir(rotulo: string): Promise<ChaveApiEmitida> {
    const chave = this.chaves.gerar();
    const hash = this.chaves.hash(chave);
    const criadaEm = this.agora();

    await this.repositorio.criar({ hash, rotulo, criadaEm });

    return {
      chave,
      identificador: hash.slice(0, 8),
      workspace: hash.slice(0, 16),
      rotulo,
      criadaEm,
    };
  }

  async listar(): Promise<readonly ChaveApiCadastrada[]> {
    return this.repositorio.listar();
  }

  /** @throws {ChaveApiNaoEncontradaError} quando o identificador não existe. */
  async revogar(identificador: string): Promise<void> {
    const encontrada = await this.repositorio.revogarPorIdentificador(
      identificador,
      this.agora(),
    );
    if (!encontrada) throw new ChaveApiNaoEncontradaError(identificador);
  }
}
