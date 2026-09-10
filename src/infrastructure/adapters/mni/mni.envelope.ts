import type { CredencialTribunal } from '../../../domain/ports/ProvedorDePecas.js';

/**
 * Montagem dos envelopes SOAP do MNI 2.2.2.
 *
 * String e não uma biblioteca de SOAP: o contrato aqui são quatro operações com
 * corpo raso, e toda biblioteca do ramo quer baixar e interpretar o WSDL em
 * tempo de execução — o que transforma indisponibilidade do tribunal em falha na
 * INICIALIZAÇÃO do nosso serviço, e ainda gasta uma ida à rede por processo.
 *
 * Os dois namespaces não são decoração e não podem ser unificados: o elemento
 * raiz da operação vive em `servico-intercomunicacao-2.2.2/` (com barra no fim,
 * exatamente como está no WSDL) e os campos filhos vivem em
 * `tipos-servico-intercomunicacao-2.2.2` (sem barra). Trocar um pelo outro faz o
 * CXF responder que o elemento é inesperado.
 */

const NS_SERVICO = 'http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/';
const NS_TIPOS = 'http://www.cnj.jus.br/tipos-servico-intercomunicacao-2.2.2';

export const ACAO_CONSULTAR_PROCESSO = `${NS_SERVICO}consultarProcesso`;
export const ACAO_CONSULTAR_ALTERACAO = `${NS_SERVICO}consultarAlteracao`;

export interface OpcoesConsultarProcesso {
  readonly numeroProcesso: string;
  readonly credencial: CredencialTribunal;
  /** Traz a linha do tempo junto. */
  readonly movimentos?: boolean;
  readonly incluirCabecalho?: boolean;
  /**
   * Traz os documentos. Sem `documentos`, é o processo INTEIRO — dezenas de
   * megabytes. Com `documentos`, só os ids pedidos.
   */
  readonly incluirDocumentos?: boolean;
  /** Ids de documento a trazer. Vazio significa "todos". */
  readonly documentos?: readonly string[];
}

export function envelopeConsultarProcesso(opcoes: OpcoesConsultarProcesso): string {
  const {
    numeroProcesso,
    credencial,
    movimentos = false,
    incluirCabecalho = true,
    incluirDocumentos = false,
    documentos = [],
  } = opcoes;

  // A ORDEM DOS ELEMENTOS É OBRIGATÓRIA. O tipo é `xs:sequence`, não `xs:all`:
  // mandar `numeroProcesso` antes de `senhaConsultante` é rejeitado, mesmo com
  // todos os campos presentes. É o erro que mais parece "credencial inválida"
  // sem ser.
  const campos = [
    elemento('idConsultante', credencial.identificacao),
    elemento('senhaConsultante', credencial.senha),
    elemento('numeroProcesso', numeroProcesso),
    elemento('movimentos', String(movimentos)),
    elemento('incluirCabecalho', String(incluirCabecalho)),
    elemento('incluirDocumentos', String(incluirDocumentos)),
    ...documentos.map((id) => elemento('documento', id)),
  ];

  return envelope('consultarProcesso', campos);
}

export function envelopeConsultarAlteracao(
  numeroProcesso: string,
  credencial: CredencialTribunal,
): string {
  return envelope('consultarAlteracao', [
    elemento('idConsultante', credencial.identificacao),
    elemento('senhaConsultante', credencial.senha),
    elemento('numeroProcesso', numeroProcesso),
  ]);
}

function envelope(operacao: string, campos: readonly string[]): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"` +
    ` xmlns:srv="${NS_SERVICO}" xmlns:tip="${NS_TIPOS}">` +
    `<soapenv:Body><srv:${operacao}>` +
    campos.join('') +
    `</srv:${operacao}></soapenv:Body></soapenv:Envelope>`
  );
}

function elemento(nome: string, valor: string): string {
  return `<tip:${nome}>${escapar(valor)}</tip:${nome}>`;
}

/**
 * Escapa o que vai dentro de elemento XML.
 *
 * Não é preciosismo: senha de tribunal frequentemente tem `&` e `<`, e uma
 * senha com `&` montada sem escape produz XML inválido. O sintoma é o serviço
 * responder erro de parsing, o que leva quem está depurando a jurar que a senha
 * está errada — e a trocar a senha certa do cliente por outra.
 */
function escapar(valor: string): string {
  return valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
