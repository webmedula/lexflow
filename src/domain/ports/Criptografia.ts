/**
 * As duas primitivas de segredo que o serviço de contas usa.
 *
 * Existem como PORTA, e não como import direto de `infrastructure/`, pela regra
 * de dependência: `application/` aponta para dentro. Não é purismo — é o que
 * permite trocar scrypt por argon2 no dia em que a imagem deixar de ser Alpine,
 * mexendo só no composition root, e é o que deixa o teste de `ServicoContas`
 * rodar com um dublê barato em vez de gastar 100ms de scrypt por caso.
 */

export interface HashDeSenha {
  /**
   * Confere se a senha SERVE, sem calcular hash nenhum.
   *
   * Separada de `guardar` por um motivo de custo, não de organização: `guardar`
   * gasta ~50ms de CPU e 16 MB de memória, e bloqueia o event loop enquanto
   * roda. Numa rota pública que recebe um token — redefinir senha —, fazer esse
   * gasto ANTES de olhar o token entrega ao atacante 50ms de CPU por
   * requisição, de graça. Com esta, o caminho fica: confere o formato de graça,
   * confere o token, e só então paga o scrypt.
   *
   * @throws {SenhaFracaError}
   */
  validar(senha: string): void;

  /**
   * Transforma a senha no texto que vai ao banco, com os parâmetros embutidos.
   * @throws {SenhaFracaError} quando a senha é curta demais para proteger algo.
   */
  guardar(senha: string): string;

  /** Nunca lança: hash corrompido no banco devolve `false`, não erro 500. */
  conferir(senha: string, guardada: string): boolean;

  /**
   * Um hash válido que não é de ninguém.
   *
   * Serve para gastar o MESMO tempo quando o e-mail não existe. Sem isso, a
   * diferença entre 1ms e 100ms na resposta do login revela quem é assinante.
   */
  readonly hashDeComparacao: string;
}

export interface TokensDeSessao {
  /** Token novo, imprevisível. Vai para o cookie e não é guardado em lugar nenhum. */
  gerar(): string;
  /** O que o banco guarda no lugar do token. */
  hash(token: string): string;
}

/**
 * A mesma ideia de `TokensDeSessao`, para as chaves de API emitidas pelo
 * operador na área administrativa.
 *
 * Existe como porta pela mesma regra de dependência: `application/` (onde mora
 * `ServicoChavesApi`) não importa `infrastructure/` diretamente. A
 * implementação real fica em `infrastructure/seguranca/chavesDeApi.ts`.
 *
 * O hash é a MESMA função que `main/http/chaves.ts` usa para as chaves
 * estáticas do `.env` — `identificarChave` e `workspaceDaChave` são fatias
 * deste mesmo hash (8 e 16 caracteres). Isso não é coincidência: é o que
 * permite a uma chave emitida aqui autenticar exatamente como uma chave do
 * `PROCESSOVIVO_API_KEYS`, sem o plugin de autenticação precisar saber de qual
 * das duas fontes ela veio.
 */
export interface ChavesDeApi {
  /** Chave nova, imprevisível (256 bits, hex). Existe em texto puro só aqui. */
  gerar(): string;
  /** O que o banco guarda no lugar da chave — nunca a chave em si. */
  hash(chave: string): string;
}
