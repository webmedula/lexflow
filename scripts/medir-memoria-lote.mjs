#!/usr/bin/env node
/**
 * MEDIÇÃO DE MEMÓRIA DO LOTE DO LEITOR — v1.0.0 (0.30.0)
 *
 * Quanto custa, em memória do processo Node, ler uma resposta de lote do MNI
 * de N MB? É a conta que justifica `LEITOR_LOTE_MAX_RESPOSTA_MB`.
 *
 * NÃO fala com o tribunal. A resposta é SINTÉTICA (multipart/related + XOP com
 * a forma da resposta real do TJGO, 385 movimentos e ~180 KB de pedágio, 20
 * documentos de bytes inventados). Nada de conteúdo real.
 *
 * Mede em DOIS processos: o primeiro gera a resposta e grava num arquivo
 * temporário; o segundo lê o arquivo (simula a resposta já chegada, um buffer
 * do tamanho dela) e só então mede o pico (`maxRSS`) da leitura pelo adapter.
 * Medir no mesmo processo que gera contaminaria o pico com a montagem do teste.
 *
 * Uso (depois de `npm run build`):
 *   node --expose-gc scripts/medir-memoria-lote.mjs 3 12 24 48
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [modo, mbArg, arquivo] = process.argv.slice(2);

if (modo === '--gerar') {
  const mb = Number(mbArg);
  const n = 20;
  const boundary = 'uuid:00000000-sintetico';
  const docs = Array.from({ length: n }, (_, i) => ({
    id: `d${i}`,
    bytes: Buffer.alloc(Math.floor((mb * 1e6) / n), 65 + (i % 20)),
  }));
  const mov = Array.from(
    { length: 385 },
    (_, i) =>
      `<ns2:movimento identificadorMovimento="${i}" dataHora="20260801101010">` +
      `<ns2:movimentoLocal codigoMovimento="1" descricao="Movimento ${i}"/>` +
      `<ns2:complemento>${'x'.repeat(460)}</ns2:complemento></ns2:movimento>`,
  ).join('');
  const docXml = docs
    .map(
      (d) =>
        `<ns2:documento idDocumento="${d.id}" tipoDocumento="57" descricao="Petição" mimetype="application/pdf" movimento="1">` +
        `<ns2:conteudo><xop:Include xmlns:xop="http://www.w3.org/2004/08/xop/include" href="cid:${d.id}@s"/></ns2:conteudo></ns2:documento>`,
    )
    .join('');
  const xml =
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>` +
    `<ns5:consultarProcessoResposta xmlns:ns2="http://www.cnj.jus.br/intercomunicacao-2.2.2" xmlns:ns5="http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/">` +
    `<ns2:sucesso>true</ns2:sucesso><ns2:mensagem>ok</ns2:mensagem><ns2:processo>${mov}${docXml}</ns2:processo>` +
    `</ns5:consultarProcessoResposta></soap:Body></soap:Envelope>`;
  const partes = [
    Buffer.from(`--${boundary}\r\nContent-Type: application/xop+xml\r\nContent-ID: <root>\r\n\r\n${xml}\r\n`),
  ];
  for (const d of docs) {
    partes.push(
      Buffer.from(`--${boundary}\r\nContent-Type: application/pdf\r\nContent-Transfer-Encoding: binary\r\nContent-ID: <${d.id}@s>\r\n\r\n`),
      d.bytes,
      Buffer.from('\r\n'),
    );
  }
  partes.push(Buffer.from(`--${boundary}--\r\n`));
  writeFileSync(arquivo, Buffer.concat(partes));
  process.exit(0);
}

if (modo === '--medir') {
  const { MniAdapter } = await import('../dist/infrastructure/adapters/mni/MniAdapter.js');
  const { HttpClient } = await import('../dist/infrastructure/http/HttpClient.js');
  let resp;
  class H extends HttpClient {
    async postXml() {
      const r = resp;
      resp = undefined;
      return r;
    }
  }
  const adapter = new MniAdapter({ httpClient: new H() });
  resp = {
    status: 200,
    ok: true,
    contentType: 'multipart/related; boundary="uuid:00000000-sintetico"; start="<root>"',
    bytes: new Uint8Array(readFileSync(arquivo)),
  };
  const tamanho = resp.bytes.length;
  globalThis.gc?.();
  const rss0 = process.memoryUsage().rss;
  const max0 = process.resourceUsage().maxRSS * 1024;
  const r = await adapter.obterConteudosEmLote(
    '0',
    Array.from({ length: 20 }, (_, i) => `d${i}`),
    { tribunal: 'TJGO', identificacao: 'x', senha: 'y' },
  );
  const max1 = process.resourceUsage().maxRSS * 1024;
  const acima = max1 - Math.max(max0, rss0);
  console.log(
    JSON.stringify({
      respostaMB: +(tamanho / 1e6).toFixed(1),
      obtidas: r.conteudos.length,
      picoAcimaDaRespostaMB: +(acima / 1e6).toFixed(1),
    }),
  );
  process.exit(0);
}

for (const mb of process.argv.slice(2)) {
  const temp = join(tmpdir(), `medir-lote-${process.pid}-${mb}.bin`);
  spawnSync(process.execPath, [process.argv[1], '--gerar', mb, temp], { stdio: 'inherit' });
  spawnSync(process.execPath, ['--expose-gc', process.argv[1], '--medir', mb, temp], {
    stdio: 'inherit',
  });
  rmSync(temp, { force: true });
}
