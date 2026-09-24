import type { ConteudoPeca, Peca } from '../entities/Peca.js';
import type { Movimentacao } from '../entities/Movimentacao.js';

/**
 * A credencial do advogado num tribunal.
 *
 * Chamada de "credencial" e não de "usuário/senha" porque o que ela representa
 * é a HABILITAÇÃO: o tribunal só entrega peça a quem tem procuração nos autos, e
 * é essa identidade que a credencial carrega. Trocá-la troca a carteira inteira
 * de processos visíveis.
 */
export interface CredencialTribunal {
  /** Sigla do tribunal — ex.: "TJGO". */
  readonly tribunal: string;
  /** Identificação do consultante no sistema do tribunal (CPF, no MNI). */
  readonly identificacao: string;
  readonly senha: string;
}

/**
 * PORTA de saída para uma fonte que entrega PEÇAS do processo.
 *
 * Deliberadamente separada de `ProcessoProvider`, e não um método a mais nele.
 * Três razões, todas descobertas antes de escrever a primeira linha do adapter:
 *
 * 1. **Credencial.** `ProcessoProvider` é global e sem dono; uma fonte de peças
 *    responde de forma diferente para cada advogado. Enfiar isso na porta
 *    existente obrigaria todo adapter a carregar um parâmetro que só um usa.
 * 2. **Cache.** `CachedProcessoProvider` guarda por número de processo, sem
 *    workspace na chave. Se a fonte de peças entrasse na cadeia, a resposta
 *    gerada com a credencial de um assinante seria servida ao seguinte. Não é
 *    hipótese: é o comportamento atual do decorator.
 * 3. **Fallback.** A cadeia existe para trocar de fonte quando uma falha. Peça
 *    não tem fonte alternativa — ou o tribunal onde o processo corre entrega,
 *    ou não existe outro lugar de onde tirar.
 *
 * Contrato de erros — implementadores DEVEM lançar tipos do domínio:
 *   - `CredencialTribunalInvalidaError` o tribunal recusou usuário/senha
 *   - `TeorNaoAutorizadoError`          respondeu, mas não liberou o arquivo
 *   - `ProcessoNaoEncontradoError`      não há esse processo na fonte
 *   - `ProviderIndisponivelError`       rede, timeout, 5xx, bloqueio de IP
 *   - `RespostaInvalidaError`           respondeu fora do contrato
 */
export interface ProvedorDePecas {
  /** Identificador estável, usado em log e procedência. Ex.: "mni". */
  readonly nome: string;

  /** Siglas de tribunal atendidas. */
  readonly tribunais: readonly string[];

  /**
   * Metadado das peças, sem baixar arquivo.
   *
   * Separado de `obterConteudo` porque um processo com 200 documentos são
   * centenas de megabytes: listar precisa ser barato o bastante para abrir uma
   * tela, e baixar é uma decisão do usuário, peça a peça.
   */
  listarPecas(numeroProcesso: string, credencial: CredencialTribunal): Promise<Peca[]>;

  /**
   * As peças MAIS os movimentos que o tribunal entregou na mesma resposta.
   *
   * Opcional porque nem toda fonte de peças tem linha do tempo própria. Onde
   * existe, é o que permite entregar o documento na linha do evento em vez de
   * numa lista apartada no rodapé — a junção peça↔andamento só é afirmada
   * dentro de uma resposta do MNI, onde o `<documento>` aponta para o
   * `identificadorMovimento` do `<movimento>` que o juntou.
   *
   * NÃO é uma segunda consulta: `listarPecas` já paga o pedágio de pedir
   * `movimentos: true` (sem isso o tribunal não devolve documento nenhum) e
   * jogava os movimentos fora. Quem implementa os dois DEVE fazer
   * `listarPecas` delegar aqui, senão o tribunal é consultado duas vezes para
   * montar uma tela — e cada consulta custa dezenas de segundos.
   */
  listarAtos?(
    numeroProcesso: string,
    credencial: CredencialTribunal,
  ): Promise<AtosDoProcesso>;

  /** O arquivo de UMA peça. */
  obterConteudo(
    numeroProcesso: string,
    idPeca: string,
    credencial: CredencialTribunal,
  ): Promise<ConteudoPeca>;

  /**
   * Assinatura barata do estado do processo, para detectar mudança sem baixar
   * nada. `undefined` quando a fonte não oferece esse atalho.
   *
   * O MNI oferece: `consultarAlteracao` devolve hashes de cabeçalho,
   * movimentações e documentos. É a diferença entre a vigilância perguntar
   * "mudou?" e a vigilância baixar o processo inteiro de hora em hora.
   */
  assinaturaDeMudanca?(
    numeroProcesso: string,
    credencial: CredencialTribunal,
  ): Promise<AssinaturaDeMudanca>;
}

/** O que uma resposta do tribunal traz sobre o processo, numa consulta só. */
export interface AtosDoProcesso {
  readonly pecas: readonly Peca[];
  /**
   * A linha do tempo COMO O TRIBUNAL A NUMERA — é dela que as peças penduram.
   * Vazia quando a fonte responde sem movimentos.
   */
  readonly movimentos: readonly Movimentacao[];
}

export interface AssinaturaDeMudanca {
  readonly cabecalho?: string;
  readonly movimentacoes?: string;
  readonly documentos?: string;
}
