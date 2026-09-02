/**
 * Um andamento do processo.
 *
 * `titulo` é sempre preenchido (é o que a lista de andamentos exibe).
 * `conteudo` é o inteiro teor do despacho/decisão quando a fonte o expõe — o
 * DataJud não expõe, o crawler do e-SAJ expõe. Por isso é opcional: o modelo
 * unificado assume que fontes diferentes enriquecem o mesmo processo em graus
 * diferentes, e quem consome deve tratar a ausência, nunca presumir string vazia.
 */
export interface Movimentacao {
  /** Data/hora do andamento. */
  readonly data: Date;
  /** Descrição curta — ex.: "Juntada de Petição de Contestação". */
  readonly titulo: string;
  /** Inteiro teor do despacho/decisão, quando disponível. */
  readonly conteudo?: string;
  /** Código do movimento na Tabela Processual Unificada (TPU) do CNJ, quando houver. */
  readonly codigoTpu?: number;
  /** Complementos do movimento na TPU — ex.: ["tipo_de_documento: petição"]. */
  readonly complementos?: readonly string[];
}

/** Ordena do andamento mais recente para o mais antigo. */
export function ordenarPorDataDesc(
  movimentacoes: readonly Movimentacao[],
): Movimentacao[] {
  return [...movimentacoes].sort((a, b) => b.data.getTime() - a.data.getTime());
}
