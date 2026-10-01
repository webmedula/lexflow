import type { RespostaHttpBinaria } from '../../src/infrastructure/http/HttpClient.js';

/**
 * Respostas MNI SINTÉTICAS, com a forma da resposta real e conteúdo inventado.
 *
 * **Exceção registrada à regra "não editar fixture de captura"** (CLAUDE.md §6).
 * O repositório é público, e uma resposta real de `consultarProcesso` com
 * documentos traz petição de processo real, com nome de parte e de advogado.
 * Isso não entra aqui. O que se reproduz é a ESTRUTURA verificada no TJGO:
 *
 * - Content-Type `multipart/related` com `start` apontando para a raiz (CXF);
 * - `<documento>` filho de `<processo>`, com `idDocumento`, `mimetype`,
 *   `descricao` (o rótulo do Projudi — não existe `tipoDocumentoLocal`),
 *   `movimento` e `<outroParametro nome="NomeArquivo">`;
 * - teor por `<xop:Include href="cid:...">`, em parte binária separada;
 * - `<movimento identificadorMovimento=... dataHora=...>` na mesma resposta —
 *   o pedágio de ≈ 180 KB por chamada, que aqui é simulado por `pedagioBytes`.
 *
 * Bytes de arquivo são sintéticos (PDF gerado por biblioteca, ou lixo do
 * tamanho pedido). Nomes de pessoa nunca aparecem.
 */
export interface DocumentoSintetico {
  readonly id: string;
  readonly mimetype?: string;
  readonly descricao?: string;
  readonly movimento?: number;
  readonly dataHora?: string;
  readonly nivelSigilo?: number;
  /** Ausente = o documento vem SEM `<conteudo>` (negativa de teor). */
  readonly bytes?: Uint8Array;
  readonly vinculados?: readonly DocumentoSintetico[];
}

export interface OpcoesRespostaSintetica {
  readonly documentos: readonly DocumentoSintetico[];
  /** Quantidade de `<movimento>`. Zero simula a negativa de acesso. Padrão 3. */
  readonly movimentos?: number;
  /** Bytes extras de movimento, para simular o pedágio da linha do tempo. */
  readonly pedagioBytes?: number;
  readonly nivelSigiloDoProcesso?: number;
  readonly incluirCabecalho?: boolean;
  readonly numero?: string;
}

const NS =
  'xmlns:ns2="http://www.cnj.jus.br/intercomunicacao-2.2.2" ' +
  'xmlns:ns5="http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/"';

function xmlDocumento(
  d: DocumentoSintetico,
  anexos: Array<{ id: string; d: DocumentoSintetico }>,
  tag = 'documento',
): string {
  const cid = `${encodeURIComponent(d.id)}@sintetico`;
  const conteudo = d.bytes
    ? `<ns2:conteudo><xop:Include xmlns:xop="http://www.w3.org/2004/08/xop/include" href="cid:${cid}"/></ns2:conteudo>`
    : '';
  if (d.bytes) anexos.push({ id: cid, d });
  const vinculados = (d.vinculados ?? [])
    .map((v) => xmlDocumento(v, anexos, 'documentoVinculado'))
    .join('');
  return (
    `<ns2:${tag} idDocumento="${d.id}" tipoDocumento="57" ` +
    `descricao="${d.descricao ?? 'Petição'}" ` +
    `mimetype="${d.mimetype ?? 'application/pdf'}" dataHora="${d.dataHora ?? '20260828145504'}" ` +
    `nivelSigilo="${d.nivelSigilo ?? 0}" movimento="${d.movimento ?? 1000}">` +
    `<ns2:outroParametro nome="NomeArquivo" valor="arquivo-${d.id}.bin"/>` +
    conteudo +
    vinculados +
    `</ns2:${tag}>`
  );
}

export function respostaMniSintetica(
  opcoes: OpcoesRespostaSintetica,
): RespostaHttpBinaria {
  const anexos: Array<{ id: string; d: DocumentoSintetico }> = [];
  const documentos = opcoes.documentos.map((d) => xmlDocumento(d, anexos)).join('');
  const qtdMov = opcoes.movimentos ?? 3;
  const enchimento = opcoes.pedagioBytes
    ? 'x'.repeat(Math.max(0, Math.floor(opcoes.pedagioBytes / Math.max(1, qtdMov))))
    : '';
  const movimentos = Array.from(
    { length: qtdMov },
    (_, i) =>
      `<ns2:movimento identificadorMovimento="${1000 + i}" dataHora="2026082${i % 10}101010">` +
      `<ns2:movimentoLocal codigoMovimento="1" descricao="Movimento ${i}"/>` +
      (enchimento ? `<ns2:complemento>${enchimento}</ns2:complemento>` : '') +
      `</ns2:movimento>`,
  ).join('');
  const cabecalho =
    opcoes.incluirCabecalho === false
      ? ''
      : `<ns2:dadosBasicos numero="${opcoes.numero ?? '00000000000000000000'}" nivelSigilo="${opcoes.nivelSigiloDoProcesso ?? 0}"/>`;
  const xml =
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>` +
    `<ns5:consultarProcessoResposta ${NS}>` +
    `<ns2:sucesso>true</ns2:sucesso><ns2:mensagem>Sucesso</ns2:mensagem>` +
    `<ns2:processo>${cabecalho}${movimentos}${documentos}</ns2:processo>` +
    `</ns5:consultarProcessoResposta></soap:Body></soap:Envelope>`;

  const boundary = 'uuid:00000000-sintetico';
  const blocos: Buffer[] = [
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/xop+xml; charset=UTF-8; type="text/xml"\r\n` +
        `Content-Transfer-Encoding: binary\r\nContent-ID: <root.message@cxf.apache.org>\r\n\r\n${xml}\r\n`,
      'utf8',
    ),
  ];
  for (const { id, d } of anexos) {
    blocos.push(
      Buffer.from(
        `--${boundary}\r\nContent-Type: ${d.mimetype ?? 'application/pdf'}\r\n` +
          `Content-Transfer-Encoding: binary\r\nContent-ID: <${id}>\r\n\r\n`,
        'ascii',
      ),
      Buffer.from(d.bytes ?? new Uint8Array()),
      Buffer.from('\r\n', 'ascii'),
    );
  }
  blocos.push(Buffer.from(`--${boundary}--\r\n`, 'ascii'));
  return {
    status: 200,
    ok: true,
    contentType:
      `multipart/related; type="application/xop+xml"; boundary="${boundary}"; ` +
      `start="<root.message@cxf.apache.org>"; start-info="text/xml"`,
    bytes: new Uint8Array(Buffer.concat(blocos)),
  };
}

/** Recusa do tribunal, HTTP 200 com `sucesso: false` (a forma da captura real). */
export function respostaMniRecusa(mensagem: string): RespostaHttpBinaria {
  const xml =
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>` +
    `<ns5:consultarProcessoResposta ${NS}>` +
    `<ns2:sucesso>false</ns2:sucesso><ns2:mensagem>${mensagem}</ns2:mensagem>` +
    `</ns5:consultarProcessoResposta></soap:Body></soap:Envelope>`;
  return {
    status: 200,
    ok: true,
    contentType: 'text/xml',
    bytes: new Uint8Array(Buffer.from(xml)),
  };
}

/** Os ids pedidos num envelope `consultarProcesso`. */
export function idsPedidos(envelope: string): string[] {
  return [...envelope.matchAll(/<tip:documento>([^<]*)<\/tip:documento>/g)].map(
    (m) => m[1] ?? '',
  );
}
