/**
 * Hierarquia de erros do domínio.
 *
 * Regra: a camada de domínio nunca lança `Error` cru nem erros de biblioteca.
 * Toda falha esperada tem um tipo, porque o orquestrador decide o que fazer
 * (tentar o próximo provider, desistir, propagar) a partir do TIPO do erro —
 * nunca a partir da mensagem.
 */
export abstract class DomainError extends Error {
  abstract readonly codigo: string;

  constructor(mensagem: string, options?: { cause?: unknown }) {
    super(mensagem, options as ErrorOptions);
    this.name = new.target.name;
    Error.captureStackTrace?.(this, new.target);
  }
}

/** O número informado não é um número CNJ válido (formato ou dígito verificador). */
export class NumeroCNJInvalidoError extends DomainError {
  readonly codigo = 'NUMERO_CNJ_INVALIDO';

  constructor(
    readonly valorInformado: string,
    motivo: string,
  ) {
    super(`Número CNJ inválido "${valorInformado}": ${motivo}`);
  }
}

/** A OAB informada não é válida (formato ou UF). */
export class OabInvalidaError extends DomainError {
  readonly codigo = 'OAB_INVALIDA';

  constructor(valorInformado: string, motivo: string) {
    super(`OAB inválida "${valorInformado}": ${motivo}`);
  }
}

/**
 * A fonte respondeu com sucesso, mas não conhece esse processo.
 * NÃO é falha do provider — é uma resposta legítima.
 */
export class ProcessoNaoEncontradoError extends DomainError {
  readonly codigo = 'PROCESSO_NAO_ENCONTRADO';

  constructor(
    readonly criterio: string,
    readonly provider?: string,
  ) {
    super(
      provider
        ? `Nenhum processo encontrado para ${criterio} em "${provider}".`
        : `Nenhum processo encontrado para ${criterio}.`,
    );
  }
}

/**
 * O provider existe mas não implementa esta operação.
 * Ex.: o DataJud não expõe partes nem advogados, então não sabe buscar por OAB.
 * O orquestrador PULA o provider silenciosamente em vez de tratar como falha.
 */
export class OperacaoNaoSuportadaError extends DomainError {
  readonly codigo = 'OPERACAO_NAO_SUPORTADA';

  constructor(
    readonly provider: string,
    readonly operacao: string,
    motivo?: string,
  ) {
    super(
      `O provider "${provider}" não suporta a operação "${operacao}"` +
        (motivo ? `: ${motivo}` : '.'),
    );
  }
}

/**
 * O provider falhou: rede, timeout, 5xx, HTML inesperado, captcha, tribunal fora do ar.
 * É o erro que dispara o fallback para o próximo provider da cadeia.
 */
export class ProviderIndisponivelError extends DomainError {
  readonly codigo = 'PROVIDER_INDISPONIVEL';

  constructor(
    readonly provider: string,
    motivo: string,
    options?: { cause?: unknown },
  ) {
    super(`Provider "${provider}" indisponível: ${motivo}`, options);
  }
}

/** O provider respondeu, mas o payload não pôde ser mapeado para o domínio. */
export class RespostaInvalidaError extends DomainError {
  readonly codigo = 'RESPOSTA_INVALIDA';

  constructor(
    readonly provider: string,
    motivo: string,
    options?: { cause?: unknown },
  ) {
    super(`Resposta inválida de "${provider}": ${motivo}`, options);
  }
}

/**
 * Toda a cadeia de providers foi percorrida sem sucesso.
 * Carrega o histórico das tentativas para diagnóstico e observabilidade.
 */
export class TodasAsFontesFalharamError extends DomainError {
  readonly codigo = 'TODAS_AS_FONTES_FALHARAM';

  constructor(
    readonly criterio: string,
    readonly tentativas: ReadonlyArray<{ provider: string; erro: string }>,
  ) {
    const resumo = tentativas.map((t) => `${t.provider}: ${t.erro}`).join(' | ');
    super(`Nenhuma fonte respondeu para ${criterio}. Tentativas → ${resumo}`);
  }
}

/**
 * O tribunal recusou a credencial do advogado.
 *
 * Separado de `ProviderIndisponivelError` porque a reação certa é oposta:
 * indisponibilidade pede nova tentativa e fallback; credencial recusada pede
 * que uma PESSOA vá corrigir o cadastro. Retentar aqui não só não resolve como
 * empurra a conta do advogado para o bloqueio por tentativas — e aí o problema
 * deixa de ser nosso e passa a ser o acesso dele ao processo.
 */
export class CredencialTribunalInvalidaError extends DomainError {
  readonly codigo = 'CREDENCIAL_TRIBUNAL_INVALIDA';

  constructor(
    readonly provider: string,
    readonly mensagemDaFonte: string,
  ) {
    super(
      `O tribunal recusou a credencial cadastrada em "${provider}": ${mensagemDaFonte}. ` +
        'Atualize usuário e senha no cadastro de credenciais.',
    );
  }
}

/** Não há credencial cadastrada para este workspace no tribunal pedido. */
export class CredencialTribunalAusenteError extends DomainError {
  readonly codigo = 'CREDENCIAL_TRIBUNAL_AUSENTE';

  constructor(readonly tribunal: string) {
    super(
      `Nenhuma credencial cadastrada para o tribunal ${tribunal}. ` +
        'As peças do processo só são acessíveis a quem está habilitado nos autos, ' +
        'então é preciso cadastrar o acesso do advogado.',
    );
  }
}

/**
 * A fonte respondeu, conhece o documento, e devolveu o metadado SEM o conteúdo.
 *
 * É o caso mais comum de todos no MNI e não é falha nossa: sem procuração nos
 * autos, o serviço entrega a ficha do documento e omite o arquivo. Merece tipo
 * próprio para que a interface diga "você não está habilitado neste processo"
 * em vez de "erro ao baixar", que manda o advogado procurar defeito onde não há.
 */
export class TeorNaoAutorizadoError extends DomainError {
  readonly codigo = 'TEOR_NAO_AUTORIZADO';

  constructor(
    readonly numeroProcesso: string,
    readonly idPeca: string,
  ) {
    super(
      `O tribunal não liberou o teor da peça ${idPeca} do processo ${numeroProcesso}. ` +
        'Isso costuma significar que a credencial usada não está habilitada nos autos.',
    );
  }
}

/** O texto informado não tem forma de e-mail. */
export class EmailInvalidoError extends DomainError {
  readonly codigo = 'EMAIL_INVALIDO';

  constructor(readonly informado: string) {
    // O e-mail NÃO entra na mensagem: ela vai para log, e endereço de pessoa
    // em log é dado pessoal espalhado onde ninguém vai lembrar de apagar.
    super('O e-mail informado não é válido.');
  }
}

/** Já existe conta com este e-mail. */
export class EmailJaCadastradoError extends DomainError {
  readonly codigo = 'EMAIL_JA_CADASTRADO';

  constructor() {
    super(
      'Já existe uma conta com este e-mail. Entre com a sua senha, ' +
        'ou use outro endereço.',
    );
  }
}

/**
 * E-mail desconhecido OU senha errada — deliberadamente indistinguíveis.
 *
 * Um erro para cada caso transformaria a tela de login num verificador de
 * quem é cliente: bastaria testar endereços e ler a diferença das respostas
 * para levantar a lista de assinantes. Por isso existe UM erro só, com UMA
 * mensagem, e o serviço gasta o mesmo tempo nos dois caminhos.
 */
export class CredenciaisInvalidasError extends DomainError {
  readonly codigo = 'CREDENCIAIS_INVALIDAS';

  constructor() {
    super('E-mail ou senha incorretos.');
  }
}

/** A sessão não existe, expirou ou foi encerrada. */
export class SessaoInvalidaError extends DomainError {
  readonly codigo = 'SESSAO_INVALIDA';

  constructor() {
    super('Sua sessão expirou. Entre novamente.');
  }
}

/** A senha escolhida é curta demais para proteger a conta. */
export class SenhaFracaError extends DomainError {
  readonly codigo = 'SENHA_FRACA';

  constructor(readonly minimo: number) {
    super(`A senha precisa ter pelo menos ${minimo} caracteres.`);
  }
}

/**
 * A requisição passou pela autenticação sem resolver um ambiente.
 *
 * Só acontece com `PROCESSOVIVO_AUTH_DISABLED=true`, que é o modo de rede interna:
 * não há chave nem sessão, então não há de quem sejam os dados. Antes disso
 * virava `throw new Error` cru — 500, alarme de produção, e o modo documentado
 * simplesmente quebrado.
 */
export class WorkspaceNaoResolvidoError extends DomainError {
  readonly codigo = 'WORKSPACE_NAO_RESOLVIDO';

  constructor() {
    super(
      'Não foi possível identificar de quem são os dados nesta requisição. ' +
        'Entre com sua conta ou informe a chave de API.',
    );
  }
}

/**
 * O plano do assinante não inclui o recurso pedido.
 *
 * Distinto de "assinatura vencida" de propósito, porque as duas ações são
 * diferentes: aqui o assinante está em dia e precisa TROCAR de plano; lá ele
 * precisa pagar o que já contratou. Uma mensagem só para os dois casos manda
 * metade das pessoas fazer a coisa errada.
 *
 * A mensagem nomeia o plano que resolve. Erro que diz "não disponível" sem
 * dizer o que fazer é o mesmo que porta sem maçaneta.
 */
export class RecursoNaoIncluidoNoPlanoError extends DomainError {
  readonly codigo = 'RECURSO_NAO_INCLUIDO_NO_PLANO';

  constructor(
    readonly recurso: string,
    readonly planoAtual: string,
    readonly planoQueInclui: string,
  ) {
    super(
      `Seu plano (${planoAtual}) não inclui ${recurso}. ` +
        `O plano ${planoQueInclui} inclui — fale com a gente para trocar.`,
    );
  }
}

/**
 * A assinatura venceu, passou da carência ou foi cancelada.
 *
 * Só bloqueia o que CONSOME fonte externa e o que promete vigilância. Ler a
 * carteira já guardada continua liberado, e isso não é generosidade: trancar
 * alguém para fora dos próprios dados por atraso de pagamento é o tipo de
 * coisa que vira reclamação pública e estorno, e não acelera pagamento nenhum.
 */
export class AssinaturaInativaError extends DomainError {
  readonly codigo = 'ASSINATURA_INATIVA';

  constructor(readonly status: string) {
    super(
      status === 'cancelada'
        ? 'Esta assinatura foi cancelada. Seus dados continuam aqui — reative para voltar a consultar e a vigiar.'
        : 'Sua assinatura venceu e o prazo de carência terminou. A vigilância está parada. ' +
            'Seus dados continuam aqui — regularize para voltar a consultar e a vigiar.',
    );
  }
}

/**
 * Código de plano que não existe.
 *
 * Só aparece por erro de digitação no comando de liberação ou por banco
 * editado à mão. Vale ser um erro nomeado mesmo assim: cair como 500 faria
 * parecer bug do sistema quando é letra trocada.
 */
export class PlanoDesconhecidoError extends DomainError {
  readonly codigo = 'PLANO_DESCONHECIDO';

  constructor(
    readonly informado: string,
    readonly conhecidos: readonly string[],
  ) {
    super(`Plano "${informado}" não existe. Planos: ${conhecidos.join(', ')}.`);
  }
}

/**
 * O tribunal respondeu, e não liberou o conteúdo do processo.
 *
 * **Distinto de "processo sem peças", e a diferença é a razão de esta classe
 * existir.** O MNI devolve `sucesso: true` com o cabeçalho completo — partes,
 * vara, valor da causa — e NENHUM movimento quando o consultante não está
 * habilitado nos autos. Sem aviso, sem código de erro, sem mensagem.
 *
 * Medido no TJGO em 09/2026: 3 KB, `nivelSigilo="0"`, zero `<movimento>`, zero
 * `<documento>`. O mesmo processo, para quem tem procuração, devolve 273 KB
 * com 278 documentos.
 *
 * Tratar isso como "nenhuma peça" diz ao advogado que o processo está vazio,
 * quando o que houve foi negativa de acesso. É a mesma confusão que o projeto
 * já proíbe entre "esse processo não existe" e "não consegui ver esse
 * processo" — aqui aplicada ao conteúdo em vez de ao processo.
 */
export class SemHabilitacaoNosAutosError extends DomainError {
  readonly codigo = 'SEM_HABILITACAO_NOS_AUTOS';

  constructor(readonly numeroProcesso: string) {
    super(
      'O tribunal devolveu apenas os dados públicos deste processo, sem a ' +
        'movimentação e sem os documentos. Isso acontece quando o acesso ' +
        'cadastrado não consta como representante nos autos. Confira se a ' +
        'credencial é do advogado que tem procuração neste processo.',
    );
  }
}
