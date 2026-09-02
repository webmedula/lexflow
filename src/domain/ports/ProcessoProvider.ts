import type { Processo } from '../entities/Processo.js';

/**
 * O que uma fonte sabe fazer. Declarado, não descoberto por tentativa e erro.
 *
 * Sem isso o orquestrador só descobriria que o DataJud não busca por OAB
 * DEPOIS de gastar uma requisição e receber um erro — e teria que decidir, pela
 * mensagem, se aquilo foi indisponibilidade (tenta de novo, faz fallback) ou
 * limitação permanente (não adianta insistir). Capacidades transformam essa
 * adivinhação em uma checagem barata e local.
 */
export interface CapacidadesProvider {
  readonly buscarPorNumero: boolean;
  readonly buscarPorOab: boolean;
  /** A fonte devolve as partes e seus advogados. */
  readonly retornaPartes: boolean;
  /** A fonte devolve o inteiro teor dos despachos, não só o título. */
  readonly retornaConteudoMovimentacoes: boolean;
  /** Siglas de tribunal atendidas; `'*'` para "qualquer um". */
  readonly tribunais: readonly string[];
}

/**
 * PORTA de saída para qualquer fonte de dados processuais.
 *
 * É o contrato que torna a abordagem híbrida possível: uma API oficial
 * (DataJud), um crawler próprio de tribunal, um agregador pago ou um mock de
 * teste entram no sistema pela mesma porta e são intercambiáveis.
 *
 * Contrato de erros — os implementadores DEVEM lançar os tipos do domínio:
 *   - `ProcessoNaoEncontradoError`  a fonte respondeu, não há esse processo
 *   - `OperacaoNaoSuportadaError`   a fonte não faz essa busca (limitação permanente)
 *   - `ProviderIndisponivelError`   rede, timeout, 5xx, captcha, tribunal fora do ar
 *   - `RespostaInvalidaError`       respondeu, mas o payload não mapeia para o domínio
 * Lançar `Error` cru é bug: o orquestrador trata como indisponibilidade e o
 * diagnóstico se perde.
 */
export interface ProcessoProvider {
  /** Identificador estável, usado em log, cache e procedência. Ex.: "datajud". */
  readonly nome: string;

  readonly capacidades: CapacidadesProvider;

  /**
   * @param numeroProcesso Número CNJ com ou sem máscara. A validação de formato
   *        e dígito verificador já foi feita pelo caso de uso — o adapter pode
   *        confiar na string e apenas normalizá-la para o formato que a fonte espera.
   * @throws {ProcessoNaoEncontradoError | ProviderIndisponivelError | RespostaInvalidaError}
   */
  buscarPorNumero(numeroProcesso: string): Promise<Processo>;

  /**
   * @param oab Número da inscrição (somente dígitos).
   * @param uf  UF da inscrição, duas letras.
   * @returns Lista possivelmente vazia. Vazio significa "esse advogado não tem
   *          processos nesta fonte" — é resposta válida, não erro.
   * @throws {OperacaoNaoSuportadaError | ProviderIndisponivelError | RespostaInvalidaError}
   */
  buscarPorOab(oab: string, uf: string): Promise<Processo[]>;

  /**
   * Sinal barato de vida. Deve ser rápido e NUNCA lançar: uma fonte fora do ar
   * responde `false`, não explode. Usado pelo orquestrador para pular fontes
   * mortas e pelo endpoint de readiness.
   */
  healthCheck(): Promise<boolean>;
}
