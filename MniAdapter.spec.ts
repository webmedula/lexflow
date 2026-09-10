import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CredencialTribunalInvalidaError,
  ProviderIndisponivelError,
  TeorNaoAutorizadoError,
} from '../../src/domain/errors/index.js';
import type { CredencialTribunal } from '../../src/domain/ports/ProvedorDePecas.js';
import { MniAdapter } from '../../src/infrastructure/adapters/mni/MniAdapter.js';
import { HttpClient } from '../../src/infrastructure/http/HttpClient.js';
import type { RespostaHttpBinaria } from '../../src/infrastructure/http/HttpClient.js';

const CREDENCIAL: CredencialTribunal = {
  tribunal: 'TJGO',
  identificacao: '00000000000',
  senha: 'senha-de-teste',
};

const PROCESSO = '58189220420268090011';

const CONTENT_TYPE_REAL =
  'multipart/related; type="application/xop+xml"; ' +
  'boundary="uuid:5551fcba-b61b-4556-b676-8f6a8785c53f"; ' +
  'start="<root.message@cxf.apache.org>"; start-info="text/xml"';

function capturaDeCredencialInvalida(): Uint8Array {
  return new Uint8Array(
    readFileSync(join(__dirname, '../fixtures/mni-tjgo-credencial-invalida-real.txt')),
  );
}

/**
 * Dublê do cliente HTTP. Guarda os envelopes enviados porque parte do que
 * precisa ser verificado está na REQUISIÇÃO — a ordem dos elementos e o fato de
 * não haver retry.
 */
class HttpFalso extends HttpClient {
  readonly enviados: string[] = [];

  constructor(private readonly responder: () => RespostaHttpBinaria) {
    super();
  }

  override async postXml(
    _url: string,
    xml: string,
    _headers?: Record<string, string>,
  ): Promise<RespostaHttpBinaria> {
    this.enviados.push(xml);
    return this.responder();
  }
}

function respostaMultipart(
  xml: string,
  anexos: ReadonlyArray<{ id: string; bytes: Buffer }> = [],
): RespostaHttpBinaria {
  const boundary = 'limite';
  const blocos: Buffer[] = [
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/xop+xml\r\n` +
        `Content-ID: <raiz@lexflow>\r\n\r\n${xml}\r\n`,
      'utf8',
    ),
  ];

  for (const anexo of anexos) {
    blocos.push(
      Buffer.from(
        `--${boundary}\r\nContent-Type: application/pdf\r\n` +
          `Content-Transfer-Encoding: binary\r\nContent-ID: <${anexo.id}>\r\n\r\n`,
        'ascii',
      ),
      anexo.bytes,
      Buffer.from('\r\n', 'ascii'),
    );
  }
  blocos.push(Buffer.from(`--${boundary}--\r\n`, 'ascii'));

  return {
    status: 200,
    ok: true,
    contentType: `multipart/related; boundary="${boundary}"; start="<raiz@lexflow>"`,
    bytes: new Uint8Array(Buffer.concat(blocos)),
  };
}

/**
 * ATENÇÃO — payload de sucesso MONTADO A PARTIR DO WSDL, não capturado.
 *
 * O WSDL é real (baixado de projudi.tjgo.jus.br/IntercomunicacaoService?WSDL) e
 * a estrutura abaixo segue `tipoProcessoJudicial` e `tipoDocumento` como estão
 * declarados lá. Mas o CAMINHO FELIZ do MNI exige a credencial de um advogado
 * habilitado nos autos, e nenhuma existia quando isto foi escrito.
 *
 * Ou seja: aqui o teste ainda é palpite verificado contra o contrato, e não
 * contra a realidade — exatamente a situação que o `datajud-payload-real`
 * documenta como perigosa. **Na primeira consulta bem-sucedida com credencial
 * real, salve a resposta em `tests/fixtures/` e troque este bloco por ela.** Só
 * então os testes de sucesso valem alguma coisa.
 */
function xmlComDocumentos(opcoes: {
  readonly comConteudo: boolean;
  readonly quantidade: number;
}): string {
  const documentos = Array.from({ length: opcoes.quantidade }, (_, i) => {
    const id = `doc-${i + 1}`;
    const conteudo = opcoes.comConteudo
      ? `<ns2:conteudo><xop:Include xmlns:xop="http://www.w3.org/2004/08/xop/include" href="cid:${id}@lexflow"/></ns2:conteudo>`
      : '';
    return (
      `<ns2:documento idDocumento="${id}" tipoDocumento="57" ` +
      `tipoDocumentoLocal="Petição Inicial" descricao="Petição inicial e documentos" ` +
      `mimetype="application/pdf" dataHora="20260828145504" nivelSigilo="0" movimento="1">` +
      conteudo +
      `</ns2:documento>`
    );
  }).join('');

  return (
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>` +
    `<ns5:consultarProcessoResposta xmlns:ns2="http://www.cnj.jus.br/intercomunicacao-2.2.2" xmlns:ns5="http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/">` +
    `<ns2:sucesso>true</ns2:sucesso><ns2:mensagem>Sucesso</ns2:mensagem>` +
    `<ns2:processo><ns2:dadosBasicos numero="${PROCESSO}"/>${documentos}</ns2:processo>` +
    `</ns5:consultarProcessoResposta></soap:Body></soap:Envelope>`
  );
}

describe('MniAdapter — recusa do tribunal (captura real)', () => {
  it('trata credencial inválida como erro, apesar do HTTP 200', async () => {
    const http = new HttpFalso(() => ({
      status: 200,
      ok: true,
      contentType: CONTENT_TYPE_REAL,
      bytes: capturaDeCredencialInvalida(),
    }));
    const adapter = new MniAdapter({ httpClient: http });

    await expect(adapter.listarPecas(PROCESSO, CREDENCIAL)).rejects.toBeInstanceOf(
      CredencialTribunalInvalidaError,
    );
  });

  it('não repete a requisição quando a credencial é recusada', async () => {
    // Retry aqui coleciona tentativa malsucedida na conta do advogado e leva ao
    // bloqueio dele no tribunal. Uma requisição, uma recusa.
    const http = new HttpFalso(() => ({
      status: 200,
      ok: true,
      contentType: CONTENT_TYPE_REAL,
      bytes: capturaDeCredencialInvalida(),
    }));
    const adapter = new MniAdapter({ httpClient: http });

    await expect(adapter.listarPecas(PROCESSO, CREDENCIAL)).rejects.toThrow();
    expect(http.enviados).toHaveLength(1);
  });

  it('não repete a senha na mensagem do erro', async () => {
    const http = new HttpFalso(() => ({
      status: 200,
      ok: true,
      contentType: CONTENT_TYPE_REAL,
      bytes: capturaDeCredencialInvalida(),
    }));
    const adapter = new MniAdapter({ httpClient: http });

    const erro = await adapter.listarPecas(PROCESSO, CREDENCIAL).catch((e: Error) => e);
    expect(erro).toBeInstanceOf(Error);
    expect((erro as Error).message).not.toContain(CREDENCIAL.senha);
  });

  it('explica o 403 como bloqueio de IP, e não como culpa da credencial', async () => {
    const http = new HttpFalso(() => ({
      status: 403,
      ok: false,
      contentType: 'text/html',
      bytes: new Uint8Array(),
    }));
    const adapter = new MniAdapter({ httpClient: http });

    const erro = await adapter.listarPecas(PROCESSO, CREDENCIAL).catch((e: Error) => e);
    expect(erro).toBeInstanceOf(ProviderIndisponivelError);
    expect((erro as Error).message).toContain('IP do servidor');
  });

  it('trata recusa desconhecida como indisponibilidade, nunca como inexistente', async () => {
    const xml =
      `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>` +
      `<ns5:consultarProcessoResposta xmlns:ns5="http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/">` +
      `<sucesso>false</sucesso><mensagem>Instabilidade no barramento</mensagem>` +
      `</ns5:consultarProcessoResposta></soap:Body></soap:Envelope>`;
    const http = new HttpFalso(() => respostaMultipart(xml));
    const adapter = new MniAdapter({ httpClient: http });

    // Dizer "processo não encontrado" aqui faria o advogado concluir que o
    // processo dele sumiu por causa de uma mensagem nova do tribunal.
    await expect(adapter.listarPecas(PROCESSO, CREDENCIAL)).rejects.toBeInstanceOf(
      ProviderIndisponivelError,
    );
  });
});

describe('MniAdapter — envelope enviado', () => {
  it('manda os campos na ordem que o xs:sequence exige', async () => {
    const http = new HttpFalso(() =>
      respostaMultipart(xmlComDocumentos({ comConteudo: false, quantidade: 1 })),
    );
    await new MniAdapter({ httpClient: http }).listarPecas(PROCESSO, CREDENCIAL);

    const enviado = http.enviados[0] ?? '';
    expect(enviado.indexOf('idConsultante')).toBeLessThan(
      enviado.indexOf('senhaConsultante'),
    );
    expect(enviado.indexOf('senhaConsultante')).toBeLessThan(
      enviado.indexOf('numeroProcesso'),
    );
  });

  it('escapa caractere especial da senha em vez de gerar XML inválido', async () => {
    const http = new HttpFalso(() =>
      respostaMultipart(xmlComDocumentos({ comConteudo: false, quantidade: 1 })),
    );
    await new MniAdapter({ httpClient: http }).listarPecas(PROCESSO, {
      ...CREDENCIAL,
      senha: 'a&b<c',
    });

    expect(http.enviados[0]).toContain('a&amp;b&lt;c');
  });

  it('pede só o documento escolhido ao baixar uma peça', async () => {
    const http = new HttpFalso(() =>
      respostaMultipart(xmlComDocumentos({ comConteudo: true, quantidade: 2 }), [
        { id: 'doc-1@lexflow', bytes: Buffer.from('%PDF-um') },
        { id: 'doc-2@lexflow', bytes: Buffer.from('%PDF-dois') },
      ]),
    );
    await new MniAdapter({ httpClient: http }).obterConteudo(
      PROCESSO,
      'doc-2',
      CREDENCIAL,
    );

    // Sem esse recorte, baixar uma peça arrastaria o processo inteiro pela rede.
    expect(http.enviados[0]).toContain('<tip:documento>doc-2</tip:documento>');
  });
});

describe('MniAdapter — peças', () => {
  it('lista uma peça quando o XML traz um único documento', async () => {
    // XML não distingue "um elemento" de "lista de um": o caso de UMA peça é o
    // que quebra em parser mal configurado, e funciona com duas.
    const http = new HttpFalso(() =>
      respostaMultipart(xmlComDocumentos({ comConteudo: false, quantidade: 1 })),
    );
    const pecas = await new MniAdapter({ httpClient: http }).listarPecas(
      PROCESSO,
      CREDENCIAL,
    );

    expect(pecas).toHaveLength(1);
    expect(pecas[0]?.rotulo).toBe('Petição Inicial');
    expect(pecas[0]?.origem).toBe('PARTE');
  });

  it('interpreta dataHora no formato compacto do MNI', async () => {
    const http = new HttpFalso(() =>
      respostaMultipart(xmlComDocumentos({ comConteudo: false, quantidade: 1 })),
    );
    const [peca] = await new MniAdapter({ httpClient: http }).listarPecas(
      PROCESSO,
      CREDENCIAL,
    );

    // `new Date('20260828145504')` seria Invalid Date, sem lançar — a peça
    // apareceria sem data em vez de dar erro.
    expect(peca?.dataHora?.getFullYear()).toBe(2026);
    expect(peca?.dataHora?.getMonth()).toBe(7);
    expect(peca?.dataHora?.getDate()).toBe(28);
  });

  it('marca a peça como sem teor quando o tribunal retém o arquivo', async () => {
    const http = new HttpFalso(() =>
      respostaMultipart(xmlComDocumentos({ comConteudo: false, quantidade: 1 })),
    );
    const [peca] = await new MniAdapter({ httpClient: http }).listarPecas(
      PROCESSO,
      CREDENCIAL,
    );

    expect(peca?.conteudoDisponivel).toBe(false);
  });

  it('resolve o xop:Include e devolve os bytes do anexo', async () => {
    const pdf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0xff, 0x00]);
    const http = new HttpFalso(() =>
      respostaMultipart(xmlComDocumentos({ comConteudo: true, quantidade: 1 }), [
        { id: 'doc-1@lexflow', bytes: pdf },
      ]),
    );

    const conteudo = await new MniAdapter({ httpClient: http }).obterConteudo(
      PROCESSO,
      'doc-1',
      CREDENCIAL,
    );

    expect(Buffer.from(conteudo.bytes).equals(pdf)).toBe(true);
    expect(conteudo.mimetype).toBe('application/pdf');
    expect(conteudo.nomeArquivo).toBe(`${PROCESSO}-peca-doc-1.pdf`);
  });

  it('distingue "não liberado" de "arquivo vazio" ao baixar', async () => {
    const http = new HttpFalso(() =>
      respostaMultipart(xmlComDocumentos({ comConteudo: false, quantidade: 1 })),
    );

    await expect(
      new MniAdapter({ httpClient: http }).obterConteudo(PROCESSO, 'doc-1', CREDENCIAL),
    ).rejects.toBeInstanceOf(TeorNaoAutorizadoError);
  });
});
