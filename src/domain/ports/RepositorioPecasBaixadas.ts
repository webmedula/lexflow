/**
 * Uma peça que o assinante puxou do tribunal.
 *
 * Guarda METADADO, nunca o arquivo. O PDF vai direto do tribunal para a máquina
 * do advogado e não fica no nosso disco: são autos de processo, muitos em
 * segredo de justiça, e custodiá-los criaria uma obrigação de guarda que o
 * produto não precisa assumir para funcionar.
 */
export interface PecaBaixada {
  readonly workspace: string;
  /** Número CNJ sem máscara. */
  readonly numeroProcesso: string;
  /** Id da peça no tribunal — é por ele que a régua sabe o que já foi puxado. */
  readonly idPeca: string;
  readonly rotulo: string;
  readonly mimetype?: string;
  readonly bytes: number;
  readonly baixadaEm: Date;
}

/**
 * PORTA do histórico de downloads.
 *
 * Existe por três motivos, e o primeiro não é a tela:
 *
 * 1. **Evitar consulta repetida ao tribunal.** Baixar uma peça custa dezenas de
 *    segundos e uma requisição que carrega a senha do advogado. Quem não lembra
 *    se já puxou a contestação clica de novo — e paga tudo de novo. Saber o que
 *    já saiu daqui é o que permite marcar "já baixado" na régua temporal.
 * 2. **Responder "o que eu já tenho deste processo".** Numa pasta com 278
 *    peças, essa pergunta não se responde de memória.
 * 3. O contador do painel.
 */
export interface RepositorioPecasBaixadas {
  registrar(peca: PecaBaixada): Promise<void>;

  /**
   * As baixas mais recentes, da mais nova para a mais antiga.
   *
   * Repetição NÃO é deduplicada aqui: baixar a mesma peça duas vezes são dois
   * registros, porque "puxei de novo na semana passada" é informação. Quem
   * quiser a lista sem repetição usa `idsDoProcesso`.
   */
  listar(
    workspace: string,
    opcoes?: { readonly numeroProcesso?: string; readonly limite?: number },
  ): Promise<PecaBaixada[]>;

  /** Quantas baixas desde um instante — é o card "peças baixadas hoje". */
  contarDesde(workspace: string, desde: Date): Promise<number>;

  /** Ids distintos já baixados de um processo, para a marca na régua. */
  idsDoProcesso(workspace: string, numeroProcesso: string): Promise<string[]>;
}
