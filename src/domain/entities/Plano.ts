/**
 * Os planos do Processo Vivo e o que cada um inclui.
 *
 * Um plano é uma LISTA DE RECURSOS, não um preço. O preço vive na tabela de
 * vendas e muda com promoção, reajuste e negociação; o que o código precisa
 * saber é apenas se aquele workspace pode usar peças hoje. Amarrar preço ao
 * domínio faria cada reajuste virar deploy.
 */

/**
 * Capacidade que uma rota pode exigir.
 *
 * A granularidade é deliberada: o recurso é o que o ASSINANTE percebe como
 * funcionalidade, não o endpoint. `pecas` cobre listar e baixar, porque vender
 * "listar peças" separado de "baixar peças" seria uma distinção que só faz
 * sentido para quem escreveu o código.
 */
export type RecursoDoPlano =
  'consulta' | 'acompanhamento' | 'vigilancia' | 'pecas' | 'analiseIa';

export type CodigoPlano = 'acompanhamento' | 'pecas' | 'ia';

export interface Plano {
  readonly codigo: CodigoPlano;
  readonly nome: string;
  /** Uma linha, para a tela e para o e-mail. */
  readonly resumo: string;
  readonly recursos: readonly RecursoDoPlano[];
  /**
   * Se pode ser CONTRATADO hoje.
   *
   * Existe para que um plano possa ser modelado antes da funcionalidade
   * existir, sem virar oferta. Vender assinatura de recurso que ainda não
   * funciona, para advogado, não volta como pedido de reembolso — volta como
   * reclamação formal.
   */
  readonly disponivelParaContratacao: boolean;
}

const BASE: readonly RecursoDoPlano[] = ['consulta', 'acompanhamento', 'vigilancia'];

export const PLANOS: Readonly<Record<CodigoPlano, Plano>> = Object.freeze({
  acompanhamento: Object.freeze({
    codigo: 'acompanhamento',
    nome: 'Acompanhamento',
    resumo:
      'Consulta por número, carteira acompanhada, vigilância pela OAB e aviso de movimentação.',
    recursos: Object.freeze([...BASE]),
    disponivelParaContratacao: true,
  }),
  pecas: Object.freeze({
    codigo: 'pecas',
    nome: 'Peças',
    resumo:
      'Tudo do Acompanhamento, mais as peças do processo — petição, contestação, laudo e documento juntado pela parte.',
    recursos: Object.freeze([...BASE, 'pecas'] as const),
    disponivelParaContratacao: true,
  }),
  ia: Object.freeze({
    codigo: 'ia',
    nome: 'IA',
    resumo: 'Tudo do Peças, mais análise do processo com sugestões.',
    recursos: Object.freeze([...BASE, 'pecas', 'analiseIa'] as const),
    // Fica FALSO até a análise existir de verdade. Trocar aqui é o único passo
    // para colocá-lo à venda — e é proposital que seja um passo consciente.
    disponivelParaContratacao: false,
  }),
});

/** Ordem de exibição, do menor para o maior. Também é a ordem de upgrade. */
export const CODIGOS_DE_PLANO: readonly CodigoPlano[] = Object.freeze([
  'acompanhamento',
  'pecas',
  'ia',
]);

export function ehCodigoDePlano(valor: string): valor is CodigoPlano {
  return (CODIGOS_DE_PLANO as readonly string[]).includes(valor);
}

/** Planos que podem ser contratados hoje. É o que a tela de preços deve listar. */
export function planosAVenda(): readonly Plano[] {
  return CODIGOS_DE_PLANO.map((c) => PLANOS[c]).filter(
    (p) => p.disponivelParaContratacao,
  );
}

export function planoInclui(codigo: CodigoPlano, recurso: RecursoDoPlano): boolean {
  return PLANOS[codigo].recursos.includes(recurso);
}

/**
 * O plano que o teste de 14 dias entrega.
 *
 * É o `pecas` de propósito: um teste que só dá acompanhamento mostra ao
 * advogado exatamente aquilo que o concorrente também faz, e ele decide não
 * assinar por uma razão que não é verdadeira. O que distingue o produto são as
 * peças — então é isso que o teste precisa mostrar.
 */
export const PLANO_DO_TESTE: CodigoPlano = 'pecas';
