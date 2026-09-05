import { ZodError } from 'zod';
import {
  DomainError,
  NumeroCNJInvalidoError,
  OabInvalidaError,
  OperacaoNaoSuportadaError,
  ProcessoNaoEncontradoError,
  ProviderIndisponivelError,
  RespostaInvalidaError,
  TodasAsFontesFalharamError,
} from '../../domain/errors/index.js';

export interface RespostaDeErro {
  readonly status: number;
  readonly corpo: {
    readonly erro: string;
    readonly mensagem: string;
    readonly detalhes?: unknown;
  };
}

/**
 * Tradução de erro de domínio para status HTTP.
 *
 * Fica em UM lugar de propósito. Espalhar `try/catch` com `reply.code(404)`
 * pelas rotas é como o mesmo erro acaba virando 404 numa rota e 500 na outra.
 *
 * A escolha dos códigos carrega significado operacional — é o que o painel do
 * Easypanel e qualquer monitoramento vão usar para decidir se há incidente:
 *
 *   400  culpa do cliente (número CNJ ou OAB malformados)
 *   404  consultamos e o processo não existe
 *   501  nenhuma fonte da cadeia sabe fazer essa busca
 *   502  as fontes externas falharam ou responderam lixo — problema RIO ACIMA
 *   503  fonte temporariamente indisponível; vale tentar de novo
 *   500  bug nosso — e só isso deve acordar alguém de madrugada
 *
 * Devolver 500 para tribunal fora do ar polui o alarme com ruído que não é
 * nosso e esconde o 500 que realmente importa.
 */
export function mapearErro(erro: unknown): RespostaDeErro {
  // Corpo de requisição fora do contrato é culpa do cliente, não falha nossa.
  // Sem este ramo, um campo faltando na requisição virava 500 — que acende
  // alarme de produção e esconde a informação de que basta corrigir o payload.
  // O detalhe do Zod vai junto: é o que diz QUAL campo está errado.
  if (erro instanceof ZodError) {
    return {
      status: 400,
      corpo: {
        erro: 'REQUISICAO_INVALIDA',
        mensagem: erro.issues
          .slice(0, 3)
          .map((i) => `${i.path.join('.') || 'corpo'}: ${i.message}`)
          .join('; '),
      },
    };
  }

  if (erro instanceof NumeroCNJInvalidoError || erro instanceof OabInvalidaError) {
    return { status: 400, corpo: { erro: erro.codigo, mensagem: erro.message } };
  }

  if (erro instanceof ProcessoNaoEncontradoError) {
    return { status: 404, corpo: { erro: erro.codigo, mensagem: erro.message } };
  }

  if (erro instanceof OperacaoNaoSuportadaError) {
    return { status: 501, corpo: { erro: erro.codigo, mensagem: erro.message } };
  }

  if (erro instanceof TodasAsFontesFalharamError) {
    return {
      status: 502,
      corpo: {
        erro: erro.codigo,
        mensagem: 'Nenhuma fonte de dados respondeu. Tente novamente em instantes.',
        detalhes: erro.tentativas,
      },
    };
  }

  if (erro instanceof ProviderIndisponivelError) {
    return {
      status: 503,
      corpo: { erro: erro.codigo, mensagem: 'Fonte de dados indisponível no momento.' },
    };
  }

  if (erro instanceof RespostaInvalidaError) {
    return {
      status: 502,
      corpo: {
        erro: erro.codigo,
        mensagem: 'A fonte de dados respondeu em formato inesperado.',
      },
    };
  }

  if (erro instanceof DomainError) {
    return { status: 400, corpo: { erro: erro.codigo, mensagem: erro.message } };
  }

  // Falha não prevista: a mensagem original NÃO vai para o cliente — ela pode
  // conter URL interna, trecho de payload ou a chave do DataJud. Vai para o log.
  return {
    status: 500,
    corpo: { erro: 'ERRO_INTERNO', mensagem: 'Erro interno do servidor.' },
  };
}
