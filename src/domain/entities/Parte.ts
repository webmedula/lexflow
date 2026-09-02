/**
 * Polo processual. Mantido propositalmente pequeno: cada tribunal nomeia os
 * polos de um jeito ("Reqte", "Autor", "Exequente"), e a normalização para
 * estes três valores é responsabilidade do adapter, não do domínio.
 */
export type PoloProcessual = 'ATIVO' | 'PASSIVO' | 'OUTROS';

export type TipoPessoa = 'FISICA' | 'JURIDICA' | 'DESCONHECIDO';

export interface Advogado {
  readonly nome: string;
  /** Número da inscrição, somente dígitos. */
  readonly oab?: string;
  /** UF da inscrição, duas letras maiúsculas. */
  readonly ufOab?: string;
}

/**
 * Parte envolvida no processo.
 *
 * `documento` vem mascarado da maioria das fontes públicas (ex.: ***.456.789-**).
 * O domínio guarda como veio: mascarar de novo é problema da camada de saída,
 * e inventar dígitos que não existem é pior do que exibir a máscara da fonte.
 */
export interface Parte {
  readonly nome: string;
  readonly polo: PoloProcessual;
  readonly tipoPessoa: TipoPessoa;
  /** CPF/CNPJ como a fonte devolveu (frequentemente mascarado ou ausente). */
  readonly documento?: string;
  readonly advogados: readonly Advogado[];
}
