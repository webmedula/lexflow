/**
 * A API Pública do DataJud não tem um índice único: cada tribunal é um alias
 * próprio (`api_publica_tjsp`, `api_publica_trf3`, ...). Ou seja, é preciso
 * saber a sigla do tribunal ANTES de montar a URL — e ela sai do próprio número
 * CNJ, pelos campos J.TR.
 *
 * Essa restrição é a razão de o adapter recusar números cujo segmento/tribunal
 * ele não reconhece, em vez de chutar um índice e receber 404.
 */

/** Siglas cobertas pelo MVP: Justiça Estadual + TRFs. */
export const TRIBUNAIS_SUPORTADOS: readonly string[] = [
  'TJAC', 'TJAL', 'TJAP', 'TJAM', 'TJBA', 'TJCE', 'TJDFT', 'TJES', 'TJGO',
  'TJMA', 'TJMT', 'TJMS', 'TJMG', 'TJPA', 'TJPB', 'TJPR', 'TJPE', 'TJPI',
  'TJRJ', 'TJRN', 'TJRS', 'TJRO', 'TJRR', 'TJSC', 'TJSE', 'TJSP', 'TJTO',
  'TRF1', 'TRF2', 'TRF3', 'TRF4', 'TRF5', 'TRF6',
];

const SUPORTADOS = new Set(TRIBUNAIS_SUPORTADOS);

export function ehTribunalSuportado(sigla: string): boolean {
  return SUPORTADOS.has(sigla.toUpperCase());
}

/** "TJSP" → "api_publica_tjsp" */
export function aliasDoTribunal(sigla: string): string {
  return `api_publica_${sigla.toLowerCase()}`;
}

/** "TJSP" → ".../api_publica_tjsp/_search" */
export function urlDeBusca(baseUrl: string, sigla: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/${aliasDoTribunal(sigla)}/_search`;
}
