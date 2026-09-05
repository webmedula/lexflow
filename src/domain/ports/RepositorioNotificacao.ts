/** Para onde avisar um workspace, e o que ele já recebeu. */
export interface PreferenciaNotificacao {
  readonly workspace: string;
  readonly email?: string;
  readonly ativa: boolean;
  /** Último resumo efetivamente enviado. */
  readonly ultimoEnvioEm?: Date;
  /** Último alerta de "não consegui verificar", para não repetir de hora em hora. */
  readonly ultimoAlertaEm?: Date;
}

export interface RepositorioNotificacao {
  obter(workspace: string): Promise<PreferenciaNotificacao>;
  salvar(
    workspace: string,
    email: string | undefined,
    ativa: boolean,
  ): Promise<PreferenciaNotificacao>;
  /** Todos os workspaces com aviso ligado e endereço preenchido. */
  listarAtivas(): Promise<PreferenciaNotificacao[]>;
  registrarEnvio(workspace: string, quando: Date): Promise<void>;
  registrarAlerta(workspace: string, quando: Date): Promise<void>;

  /**
   * Marca de vida do sistema: quando a última varredura terminou COM SUCESSO.
   *
   * Guardado aqui, e não em memória, porque o valor precisa sobreviver ao
   * redeploy — é justamente depois de um redeploy que dá para ficar horas sem
   * varrer sem ninguém notar.
   */
  registrarVarreduraOk(quando: Date): Promise<void>;
  ultimaVarreduraOk(): Promise<Date | undefined>;
}
