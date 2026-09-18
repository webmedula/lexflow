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
