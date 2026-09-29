/**
 * Uma chave de API emitida pela área administrativa, como aparece para quem
 * gerencia — nunca com o valor da chave nem com o hash guardado no banco.
 *
 * `identificador` e `workspace` são fatias do mesmo hash (8 e 16 caracteres) —
 * a mesma convenção de `identificarChave`/`workspaceDaChave`, em
 * `main/http/chaves.ts`, aplicada às chaves estáticas do `.env`. Não são
 * recalculadas a partir da chave (que não existe mais aqui) — saem do hash já
 * guardado.
 */
export interface ChaveApiCadastrada {
  readonly identificador: string;
  readonly workspace: string;
  readonly rotulo: string;
  readonly criadaEm: Date;
  readonly revogadaEm?: Date;
}

export interface NovaChaveApi {
  readonly hash: string;
  readonly rotulo: string;
  readonly criadaEm: Date;
}

/**
 * Persistência das chaves de API emitidas pelo operador na área
 * administrativa — pool separado das chaves estáticas de
 * `PROCESSOVIVO_API_KEYS`, para poder crescer sem redeploy.
 *
 * **O que entra e sai daqui é sempre o HASH, nunca a chave.** Mesma regra da
 * sessão em `RepositorioUsuarios`: vazamento desta tabela não pode virar
 * autenticação válida em lugar nenhum. A chave em texto puro existe uma única
 * vez, no retorno de `ServicoChavesApi.emitir`, e depois não existe mais —
 * nem aqui, nem em log.
 */
export interface RepositorioChavesApi {
  criar(dados: NovaChaveApi): Promise<void>;

  /** Todas, mais recente primeiro — para a listagem administrativa. */
  listar(): Promise<readonly ChaveApiCadastrada[]>;

  /**
   * Se `hash` corresponde a uma chave emitida e NÃO revogada.
   *
   * É o caminho quente: o plugin de autenticação chama isto a cada requisição
   * que não bateu com nenhuma chave estática do `.env`. Uma linha, indexada
   * pela chave primária — o mesmo custo de `usuarioDaSessao`.
   */
  ativaPorHash(hash: string): Promise<boolean>;

  /**
   * Revoga pela chave PÚBLICA (o identificador de 8 hex), nunca pelo hash
   * inteiro — quem administra só tem o identificador, o hash é interno.
   *
   * @returns `false` quando não existe chave com este identificador. Revogar
   * uma chave já revogada não é erro: devolve `true` de novo, idempotente.
   */
  revogarPorIdentificador(identificador: string, agora: Date): Promise<boolean>;
}
