#!/usr/bin/env node
/**
 * MEDIÇÃO DA CONVERSÃO DE HTML — v1.0.0 (0.30.0)
 *
 * Quanto custa converter as peças HTML de um processo inteiro em páginas de
 * texto? O processo medido na sonda de lote tinha 84 HTMLs (30% de 279). A
 * sonda de HTML (01/10/2026) mediu a forma: fragmento sem <body>, só p, span,
 * strong, br, hr e u, 1 ou 2 imagens data: por peça, 11 a 24 KB, 650 a 1.850
 * caracteres de texto.
 *
 * Os HTMLs aqui são SINTÉTICOS com essa forma (texto inventado; o "peso" vem
 * das imagens data:, como nas peças reais). Nada fala com o tribunal.
 *
 * Mede o tempo total e o pico de memória do processo (maxRSS) convertendo os
 * N arquivos em sequência — como o leitor faz na montagem.
 *
 * Uso (depois de `npm run build`):
 *   node --expose-gc scripts/medir-conversao-html.mjs [quantidade=84]
 */
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const { QpdfMontador } = await import('../dist/infrastructure/pdf/QpdfMontador.js').catch(() => {
  console.error('Não achei dist/. Rode `npm run build` antes.');
  process.exit(1);
});

const quantidade = Number(process.argv[2] ?? 84);
const pasta = mkdtempSync(join(tmpdir(), 'medir-html-'));
const frase =
  'Certifico, para os devidos fins, que a parte foi intimada da decisão proferida nos autos, ' +
  'conforme o art.&nbsp;272 do C&oacute;digo de Processo Civil. ';

let bytesEntrada = 0;
for (let i = 0; i < quantidade; i++) {
  const caracteres = 650 + ((i * 97) % 1200);
  const texto = frase.repeat(Math.ceil(caracteres / frase.length)).slice(0, caracteres);
  const imagens = 1 + (i % 2);
  const alvo = 16_000 + ((i * 131) % 8_000); // média ~20 KB
  const porImagem = Math.max(0, Math.floor((alvo - caracteres - 300) / imagens));
  const img = `<img src="data:image/png;base64,${randomBytes(Math.floor(porImagem * 0.75)).toString('base64')}">`;
  const html =
    `<p style="text-align:center"><strong><u>CERTID&Atilde;O</u></strong></p>` +
    `<p><span>${texto}</span><br>Goi&acirc;nia, data do sistema.</p><hr>` +
    img.repeat(imagens);
  const arquivo = join(pasta, `${i}.html`);
  writeFileSync(arquivo, html);
  bytesEntrada += Buffer.byteLength(html);
}

const montador = new QpdfMontador();
globalThis.gc?.();
const rss0 = process.memoryUsage().rss;
const heap0 = process.memoryUsage().heapUsed;
const max0 = process.resourceUsage().maxRSS * 1024;
const t0 = performance.now();
let bytesSaida = 0;
let falhas = 0;
for (let i = 0; i < quantidade; i++) {
  const destino = join(pasta, `${i}.pdf`);
  const r = await montador.converterHtml(join(pasta, `${i}.html`), destino);
  if (!r.ok) falhas += 1;
  else bytesSaida += statSync(destino).size;
}
const ms = performance.now() - t0;
const max1 = process.resourceUsage().maxRSS * 1024;
// Depois de um GC forçado: o que ficou RETIDO. A diferença para o pico é lixo
// que o coletor ainda não tinha recolhido — memória que o Node devolve.
globalThis.gc?.();
const retido = process.memoryUsage().rss - rss0;
const heapRetido = process.memoryUsage().heapUsed - heap0;
rmSync(pasta, { recursive: true, force: true });

console.log(
  JSON.stringify({
    htmls: quantidade,
    entradaKB: Math.round(bytesEntrada / 1024),
    mediaKB: +(bytesEntrada / quantidade / 1024).toFixed(1),
    saidaKB: Math.round(bytesSaida / 1024),
    falhas,
    tempoTotalMs: Math.round(ms),
    msPorHtml: +(ms / quantidade).toFixed(1),
    picoAcimaDoRepousoMB: +((max1 - Math.max(max0, rss0)) / 1e6).toFixed(1),
    rssDepoisDoGcMB: +(retido / 1e6).toFixed(1),
    heapRetidoDepoisDoGcMB: +(heapRetido / 1e6).toFixed(1),
  }),
);
