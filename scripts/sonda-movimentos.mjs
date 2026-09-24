#!/usr/bin/env node
/**
 * SONDA — o `movimento` do documento aponta para um <movimento> que a mesma
 * resposta já entregou?
 *
 * É a pergunta que decide se dá para casar peça com andamento SEM correlacionar
 * fontes diferentes. A v0.23.0 provou que o atributo `movimento` é confiável
 * para agrupar peças ENTRE SI; não provou que o número corresponde a um
 * movimento que recebemos. A especificação do MNI 2.2.2 diz que sim. Isto
 * verifica no tribunal real, uma vez, antes de escrever código em cima.
 *
 * Regras de segurança, iguais às das sondas anteriores:
 *  - o banco abre em `readOnly`: uma sonda nunca pode marcar como recusada uma
 *    credencial que funciona;
 *  - UMA tentativa, sem repetição — tentativa falha conta para o bloqueio da
 *    conta do advogado no tribunal;
 *  - recusa-se a rodar se a credencial já está marcada como recusada;
 *  - a senha não vai para stdout, stderr, log nem arquivo.
 *
 * Uso:
 *   node scripts/sonda-movimentos.mjs <numero-cnj> [workspace]
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';
import { Cofre } from '../dist/infrastructure/seguranca/cofre.js';
import { MniAdapter } from '../dist/infrastructure/adapters/mni/MniAdapter.js';
import { HttpClient } from '../dist/infrastructure/http/HttpClient.js';
import { carregarConfig } from '../dist/infrastructure/config/env.js';
import { NumeroCNJ } from '../dist/domain/entities/NumeroCNJ.js';

const DESTINO = '/tmp/sonda-movimentos.xml';

const [numeroBruto, workspaceArg] = process.argv.slice(2);
if (!numeroBruto) {
  console.error('Uso: node scripts/sonda-movimentos.mjs <numero-cnj> [workspace]');
  process.exit(1);
}

const config = carregarConfig(process.env);
const numero = NumeroCNJ.criar(numeroBruto);
const tribunal = (numero.siglaTribunal ?? '').toUpperCase();

// --- credencial -------------------------------------------------------------
const db = new DatabaseSync(config.banco.caminho, { readOnly: true });
const linhas = db
  .prepare('SELECT * FROM credenciais_tribunal WHERE tribunal = ?')
  .all(tribunal);

if (linhas.length === 0) {
  console.error(`Nenhuma credencial cadastrada para ${tribunal}.`);
  process.exit(1);
}

const candidatas = workspaceArg
  ? linhas.filter((l) => l.workspace === workspaceArg)
  : linhas;

if (candidatas.length === 0) {
  console.error(`Nenhuma credencial de ${tribunal} no workspace "${workspaceArg}".`);
  process.exit(1);
}
if (candidatas.length > 1) {
  console.error(
    `Há ${candidatas.length} credenciais de ${tribunal}. Escolha o workspace:\n` +
      candidatas.map((l) => `  ${l.workspace}  (${l.identificacao})`).join('\n'),
  );
  process.exit(1);
}

const linha = candidatas[0];
if (linha.recusada_em) {
  console.error(
    `A credencial está marcada como RECUSADA em ${linha.recusada_em}.\n` +
      'A sonda não roda: mais uma tentativa pode bloquear a conta no tribunal.',
  );
  process.exit(1);
}

const cofre = Cofre.comChaveBase64(config.mni.chaveDoCofre);
const credencial = {
  tribunal,
  identificacao: linha.identificacao,
  senha: cofre.decifrar(linha.senha_cifrada),
};
console.log(`workspace ${linha.workspace} · ${tribunal} · consulta única\n`);

// --- uma chamada, capturada -------------------------------------------------
class Capturador extends HttpClient {
  constructor(timeoutMs) {
    super({ timeoutMs, tentativas: 1 });
  }
  async postXml(url, xml, headers) {
    const r = await super.postXml(url, xml, headers ?? {});
    writeFileSync(DESTINO, Buffer.from(r.bytes));
    console.log(`[captura] ${r.bytes.length} bytes → ${DESTINO}`);
    return r;
  }
}

const provedor = new MniAdapter({
  httpClient: new Capturador(config.mni.timeoutMs),
  endpoint: config.mni.endpoint,
  tribunais: config.mni.tribunais,
  timeoutMs: config.mni.timeoutMs,
  limitePorMinuto: config.mni.limitePorMinuto,
});

const pecas = await provedor.listarPecas(numero.digitos, credencial);
console.log(`[mapeado] ${pecas.length} peças\n`);

// --- o que o mapper joga fora ----------------------------------------------
// De propósito por regex sobre o XML cru: o ponto da sonda é ver o que o
// mapeamento NÃO aproveita hoje. Usar o mapper aqui esconderia justamente isso.
const xml = readFileSync(DESTINO, 'utf8');

const movimentos = [...xml.matchAll(/<[^>]*:movimento\s[^>]*>/g)].map((m) => m[0]);
const ids = new Set(
  movimentos
    .map((m) => /identificadorMovimento="([^"]+)"/.exec(m)?.[1])
    .filter(Boolean),
);
const apontados = [...xml.matchAll(/\smovimento="([^"]+)"/g)].map((m) => m[1]);
const casaram = apontados.filter((a) => ids.has(a));
const distintos = new Set(apontados);

console.log(`<movimento> recebidos ............. ${movimentos.length}`);
console.log(`  com identificadorMovimento ...... ${ids.size}`);
console.log(`documentos com movimento="N" ...... ${apontados.length}`);
console.log(`  N distintos ..................... ${distintos.size}`);
console.log(`  N que EXISTEM entre os recebidos . ${casaram.length}`);

const orfaos = [...distintos].filter((a) => !ids.has(a));
if (orfaos.length > 0) {
  console.log(`  N órfãos (amostra) .............. ${orfaos.slice(0, 5).join(', ')}`);
}

console.log('\n--- forma crua de 3 <movimento> (é o que vamos passar a ler) ---');
for (const m of movimentos.slice(0, 3)) console.log(m);

const comId = movimentos.find((m) => {
  const id = /identificadorMovimento="([^"]+)"/.exec(m)?.[1];
  return id && distintos.has(id);
});
if (comId) {
  const id = /identificadorMovimento="([^"]+)"/.exec(comId)[1];
  console.log(`\n--- bloco inteiro do movimento ${id}, com o que vier dentro ---`);
  const i = xml.indexOf(comId);
  console.log(xml.slice(i, i + 900));
}
