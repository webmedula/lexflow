import { XMLParser } from 'fast-xml-parser';
import { Peca } from '../../../domain/entities/Peca.js';
import type { PecaProps } from '../../../domain/entities/Peca.js';
import type { AssinaturaDeMudanca } from '../../../domain/ports/ProvedorDePecas.js';
import { resolverReferencia } from './mtom.js';
import type { ParteMultipart } from './mtom.js';

export const NOME_MNI = 'mni';

/**
 * `removeNSPrefix` é o ajuste que sustenta este mapper.
 *
 * A resposta real do TJGO nomeia os elementos com prefixos gerados na hora —
 * `ns2:sucesso`, `ns5:consultarProcessoResposta` — e os números MUDAM conforme
 * a operação e a versão do CXF. Casar por `ns2:` funcionaria hoje e quebraria
 * na primeira atualização do tribunal, com o sintoma "o serviço parou de
 * encontrar peças" e nenhuma mudança do nosso lado para explicar.
 */
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
});

export interface RespostaMni {
  readonly sucesso: boolean;
  readonly mensagem: string;
  /** O corpo da operação, já sem envelope. */
  readonly conteudo: Registro;
}

type Registro = Record<string, unknown>;

export class XmlIlegivelError extends Error {
  constructor(motivo: string, options?: { cause?: unknown }) {
    super(`Envelope SOAP ilegível: ${motivo}`, options);
    this.name = 'XmlIlegivelError';
  }
}

/**
 * Abre o envelope e devolve o resultado da operação.
 *
 * O MNI responde **HTTP 200 mesmo quando recusa** — a captura real de credencial
 * inválida tem status 200 e `<sucesso>false</sucesso>`. Por isso o sucesso da
 * operação sai daqui, do corpo, e nunca do código HTTP: um adapter que confiasse
 * em `resposta.ok` trataria "Usuário ou Senha inválida." como consulta bem
 * sucedida e devolveria uma lista vazia de peças, que é indistinguível de
 * "processo sem documentos".
 */
export function abrirEnvelope(xml: string): RespostaMni {
  let arvore: unknown;
  try {
    arvore = parser.parse(xml);
  } catch (erro) {
    throw new XmlIlegivelError('o corpo não é XML válido', { cause: erro });
  }

  const envelope = registro(arvore)?.['Envelope'];
  const corpo = registro(envelope)?.['Body'];
  const corpoReg = registro(corpo);
  if (!corpoReg) throw new XmlIlegivelError('não há soap:Body na resposta');

  const falha = registro(corpoReg['Fault']);
  if (falha) {
    throw new XmlIlegivelError(
      `o serviço devolveu soap:Fault — ${texto(falha['faultstring']) ?? 'sem descrição'}`,
    );
  }

  // A resposta da operação é o único filho do Body, e o nome dele varia por
  // operação. Pegar "o que houver" evita repetir o nome em cada chamador.
  const primeiro = Object.values(corpoReg).find((v) => registro(v) !== undefined);
  const resultado = registro(primeiro);
  if (!resultado) throw new XmlIlegivelError('soap:Body veio sem corpo de operação');

  return {
    sucesso: texto(resultado['sucesso']) === 'true',
    mensagem: texto(resultado['mensagem']) ?? '',
    conteudo: resultado,
  };
}

/** Hashes de `consultarAlteracao` — a checagem barata de "mudou alguma coisa?". */
export function extrairAssinatura(conteudo: Registro): AssinaturaDeMudanca {
  const cabecalho = texto(conteudo['hashCabecalho']);
  const movimentacoes = texto(conteudo['hashMovimentacoes']);
  const documentos = texto(conteudo['hashDocumentos']);
  return {
    ...(cabecalho ? { cabecalho } : {}),
    ...(movimentacoes ? { movimentacoes } : {}),
    ...(documentos ? { documentos } : {}),
  };
}

/**
 * Extrai as peças de um `consultarProcessoResposta`.
 *
 * `anexos` vem do multipart: é com ele que se descobre se o `conteudo` de um
 * documento realmente veio, já que no MTOM ele é uma referência e não o dado.
 */
export function extrairPecas(
  conteudo: Registro,
  anexos: ReadonlyMap<string, ParteMultipart>,
): Peca[] {
  const processo = registro(conteudo['processo']);
  if (!processo) return [];
  return lista(processo['documento']).map((d) => montarPeca(d, anexos));
}

/** Bytes de um documento específico, quando ele veio na resposta. */
export function extrairConteudoDoDocumento(
  conteudo: Registro,
  idPeca: string,
  anexos: ReadonlyMap<string, ParteMultipart>,
): { readonly bytes: Uint8Array; readonly mimetype: string } | undefined {
  const processo = registro(conteudo['processo']);
  if (!processo) return undefined;

  for (const bruto of achatarDocumentos(lista(processo['documento']))) {
    if (atributo(bruto, 'idDocumento') !== idPeca) continue;
    const bytes = bytesDoConteudo(bruto, anexos);
    if (!bytes) return undefined;
    return {
      bytes,
      mimetype: atributo(bruto, 'mimetype') ?? 'application/octet-stream',
    };
  }
  return undefined;
}

function montarPeca(
  bruto: unknown,
  anexos: ReadonlyMap<string, ParteMultipart>,
): Peca {
  const reg = registro(bruto) ?? {};
  const vinculadas = lista(reg['documentoVinculado']).map((v) => montarPeca(v, anexos));

  const props: PecaProps = {
    id: atributo(bruto, 'idDocumento') ?? '',
    tipo: atributo(bruto, 'tipoDocumento') ?? '',
    conteudoDisponivel: bytesDoConteudo(bruto, anexos) !== undefined,
    ...(vinculadas.length > 0 ? { vinculadas } : {}),
    ...opcional('tipoLocal', atributo(bruto, 'tipoDocumentoLocal')),
    ...opcional('descricao', atributo(bruto, 'descricao')),
    ...opcional('mimetype', atributo(bruto, 'mimetype')),
    ...opcional('hash', atributo(bruto, 'hash')),
  };

  const dataHora = interpretarDataHora(atributo(bruto, 'dataHora'));
  const nivelSigilo = inteiro(atributo(bruto, 'nivelSigilo'));
  const movimento = inteiro(atributo(bruto, 'movimento'));
  const signatarios = lista(reg['assinatura'])
    .map((a) => atributo(a, 'nomeSignatario') ?? nomeDoSignatario(a))
    .filter((n): n is string => Boolean(n));

  return new Peca({
    ...props,
    ...(dataHora ? { dataHora } : {}),
    ...(nivelSigilo !== undefined ? { nivelSigilo } : {}),
    ...(movimento !== undefined ? { movimento } : {}),
    ...(signatarios.length > 0 ? { signatarios } : {}),
  });
}

/**
 * O `conteudo` de um documento chega de duas formas, e as duas precisam
 * funcionar: base64 inline (SOAP comum) ou `xop:Include href="cid:..."`
 * (MTOM, que é o que o TJGO usa quando há anexo).
 *
 * @returns `undefined` quando o documento veio SEM teor — o caso de quem não
 *          tem procuração nos autos. É a informação que separa "não liberado"
 *          de "arquivo vazio", e por isso não vira `new Uint8Array()`.
 */
function bytesDoConteudo(
  bruto: unknown,
  anexos: ReadonlyMap<string, ParteMultipart>,
): Uint8Array | undefined {
  const reg = registro(bruto);
  const conteudo = reg?.['conteudo'];
  if (conteudo === undefined || conteudo === null) return undefined;

  const inclusao = registro(registro(conteudo)?.['Include']);
  if (inclusao) {
    const href = texto(inclusao['@_href']);
    return href ? resolverReferencia(href, anexos) : undefined;
  }

  const base64 = texto(conteudo);
  if (!base64) return undefined;
  const bytes = Buffer.from(base64, 'base64');
  return bytes.length > 0 ? new Uint8Array(bytes) : undefined;
}

function achatarDocumentos(documentos: readonly unknown[]): unknown[] {
  const saida: unknown[] = [];
  for (const d of documentos) {
    saida.push(d);
    const reg = registro(d);
    if (reg) saida.push(...achatarDocumentos(lista(reg['documentoVinculado'])));
  }
  return saida;
}

function nomeDoSignatario(assinatura: unknown): string | undefined {
  const reg = registro(assinatura);
  const signatario = registro(reg?.['signatario']);
  return atributo(signatario, 'nome') ?? texto(signatario?.['nome']);
}

/**
 * `tipoDataHora` do MNI é `yyyyMMddHHmmss` — não é ISO.
 *
 * O mesmo formato do `dataAjuizamento` do DataJud, e pela mesma razão está
 * comentado aqui: `new Date('20260828145504')` devolve Invalid Date sem lançar,
 * e a peça apareceria sem data em vez de dar erro.
 */
export function interpretarDataHora(valor: string | undefined): Date | undefined {
  if (!valor) return undefined;

  const compacto = /^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?$/.exec(valor.trim());
  if (compacto) {
    const [, ano, mes, dia, hora, minuto, segundo] = compacto;
    const data = new Date(
      Number(ano),
      Number(mes) - 1,
      Number(dia),
      Number(hora ?? '0'),
      Number(minuto ?? '0'),
      Number(segundo ?? '0'),
    );
    return Number.isNaN(data.getTime()) ? undefined : data;
  }

  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? undefined : data;
}

function opcional<C extends string>(
  campo: C,
  valor: string | undefined,
): Partial<Record<C, string>> {
  return valor ? ({ [campo]: valor } as Partial<Record<C, string>>) : {};
}

function registro(valor: unknown): Registro | undefined {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
    ? (valor as Registro)
    : undefined;
}

/**
 * XML não distingue "um elemento" de "lista com um elemento", e o parser
 * devolve objeto num caso e array no outro. Todo acesso a filho repetível passa
 * por aqui — sem isso, um processo com UMA peça devolve zero peças, e com duas
 * funciona, que é o tipo de bug que passa em teste feito com o payload maior.
 */
function lista(valor: unknown): unknown[] {
  if (valor === undefined || valor === null) return [];
  return Array.isArray(valor) ? valor : [valor];
}

function atributo(valor: unknown, nome: string): string | undefined {
  return texto(registro(valor)?.[`@_${nome}`]);
}

function texto(valor: unknown): string | undefined {
  if (typeof valor === 'string') return valor.trim() || undefined;
  if (typeof valor === 'number' || typeof valor === 'boolean') return String(valor);
  // `<sucesso>false</sucesso>` com atributos vira `{ '#text': 'false' }`.
  const reg = registro(valor);
  const interno = reg?.['#text'];
  return typeof interno === 'string' ? interno.trim() || undefined : undefined;
}

function inteiro(valor: string | undefined): number | undefined {
  if (valor === undefined) return undefined;
  const n = Number.parseInt(valor, 10);
  return Number.isNaN(n) ? undefined : n;
}
