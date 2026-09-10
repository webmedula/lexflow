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
