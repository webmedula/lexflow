import type { ConversaoDeHtml } from '../../domain/ports/MontadorDePdf.js';

/**
 * O que a conversão do HTML deixou de fora, em uma frase para o índice.
 * `undefined` quando nada ficou de fora.
 */
export function observacoesDaConversao(c: ConversaoDeHtml): string | undefined {
  const partes: string[] = [];
  if (c.imagens > 0) {
    partes.push(
      `${c.imagens} ${c.imagens === 1 ? 'imagem não incluída' : 'imagens não incluídas'}`,
    );
  }
  if (c.tabelas > 0) {
    partes.push(
      `havia ${c.tabelas === 1 ? 'tabela' : `${c.tabelas} tabelas`}: linhas convertidas em "célula | célula"`,
    );
  }
  if (c.caracteresSubstituidos > 0) {
    partes.push(
      `${c.caracteresSubstituidos} ${c.caracteresSubstituidos === 1 ? 'caractere sem equivalente na fonte trocado' : 'caracteres sem equivalente na fonte trocados'} por "?"`,
    );
  }
  if (c.elementosDescartados.length > 0) {
    partes.push(`elementos descartados: ${c.elementosDescartados.join(', ')}`);
  }
  return partes.length > 0 ? partes.join('; ') : undefined;
}
