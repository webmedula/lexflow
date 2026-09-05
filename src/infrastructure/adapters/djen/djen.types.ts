import { z } from 'zod';

/**
 * Contrato da resposta do DJEN (Comunica API / CNJ).
 *
 * Modelado a partir da captura real em `tests/fixtures/djen-comunica-real.json`,
 * não da documentação. Regra do projeto: o schema descreve o que a fonte MANDA.
 *
 * Quase tudo é opcional ou anulável de propósito. A base agrega 90+ tribunais
 * com qualidades de preenchimento muito diferentes: exigir `nomeClasse` faria a
 * busca por OAB de um advogado inteira falhar por causa de uma vara que não
 * preencheu a classe naquele dia. O que é realmente indispensável para virar
 * `Processo` — número, tribunal, data e texto — é o que está obrigatório aqui.
 */

export const advogadoDjenSchema = z.object({
  id: z.number().optional(),
  nome: z.string(),
  numero_oab: z.string().nullish(),
  uf_oab: z.string().nullish(),
});

export const destinatarioAdvogadoDjenSchema = z.object({
  advogado: advogadoDjenSchema,
});

export const destinatarioDjenSchema = z.object({
  nome: z.string(),
  /** "A" = polo ativo, "P" = polo passivo. Outros valores aparecem; ver mapper. */
  polo: z.string().nullish(),
});

export const comunicacaoDjenSchema = z.object({
  id: z.number(),
  /** ISO, só data: "2026-09-04". Sem hora — ver `parseDataDisponibilizacao`. */
  data_disponibilizacao: z.string(),
  siglaTribunal: z.string(),
  tipoComunicacao: z.string().nullish(),
  nomeOrgao: z.string().nullish(),
  /** Inteiro teor com entidades HTML. Ver `limparTextoDoAto`. */
  texto: z.string().nullish(),
  /** 20 dígitos, SEM máscara. */
  numero_processo: z.string(),
  /** Mesmo número, com máscara: "5578470-05.2026.8.09.0085". */
  numeroprocessocommascara: z.string().nullish(),
  link: z.string().nullish(),
  tipoDocumento: z.string().nullish(),
  nomeClasse: z.string().nullish(),
  codigoClasse: z.string().nullish(),
  meiocompleto: z.string().nullish(),
  /** "P" = publicada. Cancelada vem com status diferente e motivo preenchido. */
  status: z.string().nullish(),
  ativo: z.boolean().nullish(),
  motivo_cancelamento: z.string().nullish(),
  destinatarios: z.array(destinatarioDjenSchema).nullish(),
  destinatarioadvogados: z.array(destinatarioAdvogadoDjenSchema).nullish(),
});

export const respostaDjenSchema = z.object({
  status: z.string(),
  message: z.string().optional(),
  /** Total de comunicações que casam com o filtro, não o tamanho da página. */
  count: z.number(),
  items: z.array(comunicacaoDjenSchema),
});

export type ComunicacaoDjen = z.infer<typeof comunicacaoDjenSchema>;
export type RespostaDjen = z.infer<typeof respostaDjenSchema>;
