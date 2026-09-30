#!/usr/bin/env node
/**
 * SONDA DE LOTE — v1.0.0
 *
 * O que custa baixar várias peças seguidas do tribunal, e em que formato elas
 * chegam? A especificação do leitor de peças só SUPÕE as respostas:
 *
 *  - quanto tempo leva cada peça (CLAUDE.md fala em "dezenas de segundos"),
 *  - quanto pesa cada resposta e cada arquivo,
 *  - se tudo é PDF ou há imagem e outros formatos,
 *  - se o PDF tem camada de texto (decide se a análise por IA precisa de OCR),
 *  - se alguma peça volta vazia,
 *  - se o tribunal manda cabeçalho de limite de requisições.
 *
 * Mede-se uma vez, no tribunal real, antes de escrever a fila de jobs em cima.
 *
 * Regras de segurança, iguais às das sondas anteriores (e mais duras):
 *  - o banco abre em `readOnly`: a sonda nunca marca como recusada uma
 *    credencial que funciona;
 *  - UMA tentativa por peça, sem repetição — tentativa malsucedida conta para o
 *    bloqueio da conta do advogado;
 *  - no máximo 5 peças e uma requisição a cada 3 segundos, no mínimo;
 *  - recusa-se a rodar se a credencial já está marcada como recusada;
 *  - ABORTA na primeira falha: HTTP 403, `sucesso: false`, timeout, 5xx ou
 *    resposta fora do contrato. Duas peças seguidas sem teor também param;
 *  - a senha não vai para stdout, stderr, log nem arquivo;
 *  - CONTEÚDO de peça não é gravado em lugar nenhum. O texto do PDF é medido em
 *    memória (só a contagem de caracteres sai) e o arquivo de "formas" guarda
 *    tamanhos, tipos e campos — nunca bytes, nomes de arquivo nem número de
 *    processo.
 *
 * OPCIONAL, `--agrupada`: depois das chamadas individuais, UMA chamada pedindo
 * todas as peças obtidas de uma vez (o envelope `consultarProcesso` aceita vários
 * `<documento>`). Responde à pergunta que decide o desenho do lote: o tribunal
 * entrega N arquivos numa resposta só, pagando o pedágio de ~250 KB de
 * movimentos UMA vez, ou é uma consulta por peça? Custa 1 requisição a mais
 * (no máximo 6 no total) e nenhuma peça nova.
 *
 * OPCIONAL, `--listar`: em vez de baixar, faz UMA consulta ao tribunal
 * (`listarPecas`) e mostra os ids, rótulos e formatos declarados das peças, com uma
 * sugestão de comando. Serve para quem não tem os ids à mão. Não baixa arquivo
 * nenhum. É 1 requisição (pode levar dezenas de segundos: o tribunal manda a linha
 * do tempo inteira junto).
 *
 * Uso:
 *   node scripts/sonda-lote.mjs --listar <numero-cnj> [--workspace=<nome>]
 *   node scripts/sonda-lote.mjs <numero-cnj> <idPeca> [<idPeca> ... até 5] [--workspace=<nome>] [--agrupada]
 *   node scripts/sonda-lote.mjs --seco <numero-cnj> <idPeca> ...   (só mostra o plano; não abre
 *                                                                    o banco nem fala com o tribunal)
 *
 * Requer `npm run build` antes (importa de `dist/`).
 */
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { setTimeout as dormir } from 'node:timers/promises';

const VERSAO_SONDA = '1.0.0';
const MAX_PECAS = 5;
const INTERVALO_MS = 3000;
const SEM_TEOR_SEGUIDAS_PARA_PARAR = 2;
const DESTINO = join(tmpdir(), 'sonda-lote-formas.json');

// --- argumentos --------------------------------------------------------------
const entrada = process.argv.slice(2);
const seco = entrada.includes('--seco');
const agrupada = entrada.includes('--agrupada');
const listar = entrada.includes('--listar');
const workspaceArg = entrada.find((a) => a.startsWith('--workspace='))?.split('=')[1];
const posicionais = entrada.filter((a) => !a.startsWith('--'));
const [numeroBruto, ...idsBrutos] = posicionais;

function uso(mensagem) {
  if (mensagem) console.error(`${mensagem}\n`);
  console.error(
    'Uso: node scripts/sonda-lote.mjs <numero-cnj> <idPeca> [<idPeca> ... até ' +
      `${MAX_PECAS}] [--workspace=<nome>]\n` +
      '     node scripts/sonda-lote.mjs --seco <numero-cnj> <idPeca> ...',
  );
  process.exit(1);
}

if (!numeroBruto) uso('Faltou o número do processo.');
const ids = listar ? [] : [...new Set(idsBrutos)];
if (listar && idsBrutos.length > 0) {
  console.log('[aviso] --listar não baixa nada: os ids informados foram ignorados.');
}
if (!listar && ids.length === 0) uso('Faltou pelo menos um id de peça.');
if (ids.length !== idsBrutos.length) {
  console.log('[aviso] ids repetidos foram descartados: a sonda nunca baixa a mesma peça duas vezes.');
}
if (ids.length > MAX_PECAS) {
  uso(`São ${ids.length} peças e o limite da sonda é ${MAX_PECAS}. Reduza a lista.`);
}

const { NumeroCNJ } = await import('../dist/domain/entities/NumeroCNJ.js').catch(() => {
  console.error('Não achei dist/. Rode `npm run build` antes.');
  process.exit(1);
});
const numero = NumeroCNJ.criar(numeroBruto);
const tribunal = (numero.siglaTribunal ?? '').toUpperCase();

console.log(`sonda-lote v${VERSAO_SONDA}`);
if (listar) {
  console.log(`plano: --listar — UMA consulta ao tribunal (${tribunal}), sem baixar arquivo nenhum.`);
} else
console.log(
  `plano: ${ids.length} peça(s) de um processo ${tribunal}, ` +
    `uma requisição a cada ${INTERVALO_MS / 1000}s, sem repetição, ` +
    `no máximo ${MAX_PECAS} — duração mínima ≈ ${Math.max(0, ids.length - 1) * (INTERVALO_MS / 1000)}s ` +
    'mais o tempo do tribunal.',
);
if (!listar) {
  console.log(
    `requisições ao tribunal: ${ids.length}` +
      (agrupada ? ` + 1 chamada AGRUPADA com as mesmas peças (total ${ids.length + 1})` : ''),
  );
}
if (seco) {
  console.log('\n--seco: nada foi aberto nem enviado. Fim.');
  process.exit(0);
}

// --- credencial (mesmo caminho da sonda-movimentos) ---------------------------
const { DatabaseSync } = await import('node:sqlite');
const { Cofre } = await import('../dist/infrastructure/seguranca/cofre.js');
const { MniAdapter } = await import('../dist/infrastructure/adapters/mni/MniAdapter.js');
const { HttpClient } = await import('../dist/infrastructure/http/HttpClient.js');
const { carregarConfig } = await import('../dist/infrastructure/config/env.js');

const config = carregarConfig(process.env);
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
    `Há ${candidatas.length} credenciais de ${tribunal}. Escolha o workspace com --workspace=<nome>:\n` +
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
console.log(`workspace ${linha.workspace} · ${tribunal}\n`);

// --- captura do que o HttpClient não mostra ----------------------------------
// O HttpClient não expõe cabeçalhos. Em vez de mexer nele, a sonda embrulha o
// `fetch` global só para ler cabeçalhos que falem de limite de requisições.
let ultimosCabecalhos = {};
const fetchOriginal = globalThis.fetch;
globalThis.fetch = async (...args) => {
  const r = await fetchOriginal(...args);
  const achados = {};
  r.headers.forEach((valor, nome) => {
    if (/rate|limit|retry|remaining|reset/i.test(nome)) achados[nome] = valor;
  });
  ultimosCabecalhos = achados;
  return r;
};

let ultimaResposta;
class Capturador extends HttpClient {
  constructor(timeoutMs) {
    super({ timeoutMs, tentativas: 1 });
  }
  async postXml(url, xml, headers) {
    const r = await super.postXml(url, xml, headers ?? {});
    ultimaResposta = { status: r.status, contentType: r.contentType, bytes: r.bytes.length };
    return r;
  }
}

const http = new Capturador(config.mni.timeoutMs);
const provedor = new MniAdapter({
  httpClient: http,
  endpoint: config.mni.endpoint,
  tribunais: config.mni.tribunais,
  timeoutMs: config.mni.timeoutMs,
  limitePorMinuto: config.mni.limitePorMinuto,
});

// --- medições -----------------------------------------------------------------
function farejar(bytes) {
  const b = Buffer.from(bytes.subarray(0, 8));
  if (b.length === 0) return 'vazio';
  if (b.subarray(0, 4).toString('latin1') === '%PDF') return 'pdf';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b[0] === 0x89 && b.subarray(1, 4).toString('latin1') === 'PNG') return 'png';
  if (b.subarray(0, 3).toString('latin1') === 'GIF') return 'gif';
  if (b.subarray(0, 2).toString('latin1') === 'II' || b.subarray(0, 2).toString('latin1') === 'MM')
    return 'tiff';
  if (b[0] === 0x50 && b[1] === 0x4b) return 'zip-ou-office';
  return 'outro';
}

function analisarPdf(bytes) {
  const buf = Buffer.from(bytes);
  const bruto = buf.toString('latin1');
  // Estimativas por regex sobre o arquivo cru: PDF 1.5+ pode esconder objetos em
  // fluxos comprimidos, então estes números só podem SUBESTIMAR. Servem de indício.
  const saida = {
    paginasPorRegex: (bruto.match(/\/Type\s*\/Page(?![A-Za-z])/g) ?? []).length,
    fontesPorRegex: (bruto.match(/\/Type\s*\/Font(?![A-Za-z])/g) ?? []).length,
    imagensPorRegex: (bruto.match(/\/Subtype\s*\/Image(?![A-Za-z])/g) ?? []).length,
    criptografado: /\/Encrypt(?![A-Za-z])/.test(bruto),
    caracteresNaPagina1: null,
    ferramentaDeTexto: 'pdftotext',
  };
  // Medida de verdade: 1 página de amostra, pela entrada padrão (nada vai a disco).
  const r = spawnSync('pdftotext', ['-f', '1', '-l', '1', '-', '-'], {
    input: buf,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    timeout: 20000,
  });
  if (r.error || r.status !== 0) {
    saida.ferramentaDeTexto = 'ausente-ou-falhou';
  } else {
    saida.caracteresNaPagina1 = (r.stdout ?? '').replace(/\s+/g, '').length;
  }
  return saida;
}

function medir(ordem, conteudo, ms) {
  const sniff = farejar(conteudo.bytes);
  const extensao = extname(conteudo.nomeArquivo ?? '').toLowerCase() || null;
  const registro = {
    ordem,
    situacao: conteudo.bytes.length === 0 ? 'vazia' : 'obtida',
    mimetypeDeclarado: conteudo.mimetype,
    formatoReal: sniff,
    extensao,
    bytesDaResposta: ultimaResposta?.bytes ?? null,
    bytesDoArquivo: conteudo.bytes.length,
    ms,
    cabecalhosDeLimite: ultimosCabecalhos,
  };
  if (sniff === 'pdf') registro.pdf = analisarPdf(conteudo.bytes);
  if (sniff !== 'pdf' && conteudo.mimetype === 'application/pdf') registro.divergencia = true;
  return registro;
}

const fmtBytes = (n) => (n == null ? '—' : `${n.toLocaleString('pt-BR')} B`);
const fmtSeg = (ms) => `${(ms / 1000).toFixed(1).replace('.', ',')} s`;

// --- modo --listar: uma consulta, nenhum arquivo ------------------------------------
if (listar) {
  console.log('[listar] UMA consulta ao tribunal; pode levar dezenas de segundos...');
  const t0 = performance.now();
  try {
    const pecas = await provedor.listarPecas(numero.digitos, credencial);
    const ms = Math.round(performance.now() - t0);
    console.log(
      `[listar] ${pecas.length} peça(s) · ${fmtSeg(ms)} · resposta ${fmtBytes(ultimaResposta?.bytes ?? null)}`,
    );

    const porRotulo = {};
    const porFormato = {};
    for (const p of pecas) {
      porRotulo[p.rotulo] = (porRotulo[p.rotulo] ?? 0) + 1;
      const f = p.mimetype ?? 'não informado';
      porFormato[f] = (porFormato[f] ?? 0) + 1;
    }
    console.log(
      'por rótulo: ' + Object.entries(porRotulo).map(([k, v]) => `${k}=${v}`).join(' · '),
    );
    console.log(
      'por formato declarado: ' + Object.entries(porFormato).map(([k, v]) => `${k}=${v}`).join(' · '),
    );

    console.log('\nprimeiras 40 (ordem, id, rótulo, formato, data, sigilo):');
    for (const [i, p] of pecas.slice(0, 40).entries()) {
      const data = p.dataHora ? p.dataHora.toISOString().slice(0, 10) : '—';
      console.log(
        `  ${String(i + 1).padStart(2)}  ${p.id}  ${p.rotulo}  ${p.mimetype ?? '—'}  ${data}  ${p.sigilosa ? 'SIGILOSA' : ''}`,
      );
    }

    // Sugestão: 3 peças de rótulos diferentes, não sigilosas, de preferência PDF.
    const vistos = new Set();
    const sugeridas = [];
    for (const p of pecas) {
      if (p.sigilosa) continue;
      if (p.mimetype && !/pdf/i.test(p.mimetype)) continue;
      if (vistos.has(p.rotulo)) continue;
      vistos.add(p.rotulo);
      sugeridas.push(p.id);
      if (sugeridas.length === 3) break;
    }
    if (sugeridas.length > 0) {
      console.log('\ncomando sugerido (peças de rótulos diferentes, não sigilosas):');
      console.log(`  node scripts/sonda-lote.mjs ${numeroBruto} ${sugeridas.join(' ')} --agrupada`);
    }
    console.log(
      '\nO tamanho de cada peça NÃO aparece na listagem: só a tentativa de baixar mostra.',
    );
    process.exit(0);
  } catch (erro) {
    const ms = Math.round(performance.now() - t0);
    const tipo = erro?.constructor?.name ?? 'Error';
    console.log(`[listar] ABORTOU · ${tipo} · ${fmtSeg(ms)}`);
    console.log(`   motivo: ${String(erro?.message ?? erro)}`);
    if (/403/.test(String(erro?.message ?? ''))) {
      console.log(
        '   HTTP 403 costuma ser bloqueio temporário do IP do servidor (~30 min).\n' +
          '   NÃO repita agora e NÃO troque a senha.',
      );
    }
    process.exit(2);
  }
}

// --- o lote, sequencial ---------------------------------------------------------
const resultados = [];
const idPorOrdem = new Map(); // só em memória: ids de peça não vão para o disco
const bytesPorOrdem = new Map(); // idem: para comparar com a chamada agrupada
let abortou = null;
let semTeorSeguidas = 0;
let ultimoInicio = 0;

for (const [i, id] of ids.entries()) {
  idPorOrdem.set(i + 1, id);
  if (i > 0) {
    const falta = ultimoInicio + INTERVALO_MS - Date.now();
    if (falta > 0) await dormir(falta);
  }
  ultimoInicio = Date.now();
  ultimaResposta = undefined;
  ultimosCabecalhos = {};
  const t0 = performance.now();

  try {
    const conteudo = await provedor.obterConteudo(numero.digitos, id, credencial);
    const ms = Math.round(performance.now() - t0);
    const r = medir(i + 1, conteudo, ms);
    resultados.push(r);
    bytesPorOrdem.set(i + 1, conteudo.bytes);
    semTeorSeguidas = 0;

    const pdf = r.pdf
      ? ` · texto(p1)=${r.pdf.caracteresNaPagina1 ?? 'n/medido'} fontes≈${r.pdf.fontesPorRegex} imagens≈${r.pdf.imagensPorRegex}`
      : '';
    console.log(
      `#${r.ordem} ${r.situacao} · ${r.formatoReal} (${r.mimetypeDeclarado}) · ` +
        `resposta ${fmtBytes(r.bytesDaResposta)} · arquivo ${fmtBytes(r.bytesDoArquivo)} · ` +
        `${fmtSeg(ms)}${pdf}${r.divergencia ? ' · ATENÇÃO: declarado PDF, conteúdo não é' : ''}`,
    );
  } catch (erro) {
    const ms = Math.round(performance.now() - t0);
    const tipo = erro?.constructor?.name ?? 'Error';

    if (tipo === 'TeorNaoAutorizadoError') {
      // O tribunal respondeu com sucesso e não liberou o arquivo: é a resposta
      // legítima de "sem procuração nesta peça", não uma falha da conta.
      semTeorSeguidas += 1;
      resultados.push({
        ordem: i + 1,
        situacao: 'sem_teor',
        bytesDaResposta: ultimaResposta?.bytes ?? null,
        ms,
        cabecalhosDeLimite: ultimosCabecalhos,
      });
      console.log(`#${i + 1} sem_teor (TeorNaoAutorizadoError) · resposta ${fmtBytes(ultimaResposta?.bytes ?? null)} · ${fmtSeg(ms)}`);
      if (semTeorSeguidas >= SEM_TEOR_SEGUIDAS_PARA_PARAR) {
        abortou = {
          ordem: i + 1,
          tipo: 'SemTeorSeguidas',
          motivo:
            `${SEM_TEOR_SEGUIDAS_PARA_PARAR} peças seguidas sem teor: provavelmente o advogado não ` +
            'está habilitado neste processo. Parei para não gastar requisições à toa.',
        };
        break;
      }
      continue;
    }

    // Qualquer outra coisa — 403, `sucesso: false`, credencial recusada, timeout,
    // 5xx, resposta fora do contrato — PARA a sonda. Não se tenta de novo.
    abortou = { ordem: i + 1, tipo, motivo: String(erro?.message ?? erro), ms };
    console.log(`#${i + 1} ABORTOU · ${tipo} · ${fmtSeg(ms)}`);
    console.log(`   motivo: ${abortou.motivo}`);
    if (/403/.test(abortou.motivo)) {
      console.log(
        '   HTTP 403 costuma ser bloqueio temporário do IP do servidor (espera de ~30 min).\n' +
          '   NÃO rode a sonda de novo agora e NÃO troque a senha: anote o horário e espere.',
      );
    }
    break;
  }
}

// --- chamada agrupada (opcional) --------------------------------------------------
let resultadoAgrupado = null;
const obtidasParaAgrupar = resultados.filter((r) => r.situacao === 'obtida');
if (agrupada) {
  if (abortou) {
    console.log('\n[agrupada] não executada: a sonda já abortou.');
  } else if (obtidasParaAgrupar.length < 2) {
    console.log('\n[agrupada] não executada: menos de 2 peças obtidas para agrupar.');
  } else {
    const idsAgrupados = obtidasParaAgrupar.map((r) => idPorOrdem.get(r.ordem));
    const falta = ultimoInicio + INTERVALO_MS - Date.now();
    if (falta > 0) await dormir(falta);
    console.log(`\n[agrupada] UMA chamada pedindo ${idsAgrupados.length} peças juntas...`);

    const { envelopeConsultarProcesso, ACAO_CONSULTAR_PROCESSO } = await import(
      '../dist/infrastructure/adapters/mni/mni.envelope.js'
    );
    const { lerRespostaSoap } = await import('../dist/infrastructure/adapters/mni/mtom.js');
    const { abrirEnvelope, extrairConteudoDoDocumento } = await import(
      '../dist/infrastructure/adapters/mni/mni.mapper.js'
    );

    ultimaResposta = undefined;
    ultimosCabecalhos = {};
    const t0 = performance.now();
    try {
      const xml = envelopeConsultarProcesso({
        numeroProcesso: numero.digitos,
        credencial,
        movimentos: true, // sem isto o tribunal não devolve documento nenhum
        incluirCabecalho: false,
        incluirDocumentos: true,
        documentos: idsAgrupados,
      });
      const bruta = await http.postXml(config.mni.endpoint, xml, {
        SOAPAction: ACAO_CONSULTAR_PROCESSO,
      });
      const ms = Math.round(performance.now() - t0);

      if (bruta.status === 403) {
        abortou = { ordem: 'agrupada', tipo: 'HTTP403', motivo: 'acesso bloqueado pelo tribunal (HTTP 403)', ms };
        console.log('[agrupada] ABORTOU · HTTP 403 — espere ~30 min e NÃO repita agora.');
      } else if (bruta.status === 429 || bruta.status >= 500) {
        abortou = { ordem: 'agrupada', tipo: `HTTP${bruta.status}`, motivo: `HTTP ${bruta.status}`, ms };
        console.log(`[agrupada] ABORTOU · HTTP ${bruta.status}`);
      } else {
        const lida = lerRespostaSoap(bruta.contentType, bruta.bytes);
        const resposta = abrirEnvelope(lida.xml);
        if (!resposta.sucesso) {
          abortou = { ordem: 'agrupada', tipo: 'SucessoFalse', motivo: String(resposta.mensagem ?? 'sem mensagem'), ms };
          console.log(`[agrupada] ABORTOU · sucesso:false · ${abortou.motivo}`);
        } else {
          let entregues = 0;
          let iguaisAoIndividual = 0;
          for (const id of idsAgrupados) {
            const achado = extrairConteudoDoDocumento(resposta.conteudo, id, lida.anexos);
            if (!achado) continue;
            entregues += 1;
            const ordem = [...idPorOrdem.entries()].find(([, v]) => v === id)?.[0];
            const individual = bytesPorOrdem.get(ordem);
            if (individual && Buffer.compare(Buffer.from(individual), Buffer.from(achado.bytes)) === 0) {
              iguaisAoIndividual += 1;
            }
          }
          const somaMsIndividuais = obtidasParaAgrupar.reduce((s, r) => s + r.ms, 0);
          const somaBytesIndividuais = obtidasParaAgrupar.reduce((s, r) => s + (r.bytesDaResposta ?? 0), 0);
          resultadoAgrupado = {
            pedidas: idsAgrupados.length,
            entregues,
            iguaisAoIndividual,
            ms,
            bytesDaResposta: bruta.bytes.length,
            somaMsIndividuais,
            somaBytesIndividuais,
            cabecalhosDeLimite: ultimosCabecalhos,
          };
          console.log(
            `[agrupada] pedidas ${idsAgrupados.length} · entregues ${entregues} · idênticas às individuais ${iguaisAoIndividual} · ` +
              `${fmtSeg(ms)} · resposta ${fmtBytes(bruta.bytes.length)}`,
          );
          console.log(
            `           comparação: individuais somaram ${fmtSeg(somaMsIndividuais)} e ${fmtBytes(somaBytesIndividuais)} de resposta`,
          );
        }
      }
    } catch (erro) {
      const ms = Math.round(performance.now() - t0);
      abortou = {
        ordem: 'agrupada',
        tipo: erro?.constructor?.name ?? 'Error',
        motivo: String(erro?.message ?? erro),
        ms,
      };
      console.log(`[agrupada] ABORTOU · ${abortou.tipo} · ${abortou.motivo}`);
    }
  }
}

// --- resumo ------------------------------------------------------------------------
const obtidas = resultados.filter((r) => r.situacao === 'obtida');
console.log('\n--- resumo ---');
console.log(`pedidas ${ids.length} · obtidas ${obtidas.length} · vazias ${resultados.filter((r) => r.situacao === 'vazia').length} · sem teor ${resultados.filter((r) => r.situacao === 'sem_teor').length}${abortou ? ` · ABORTOU na #${abortou.ordem}` : ''}`);

if (obtidas.length > 0) {
  const tempos = obtidas.map((r) => r.ms).sort((a, b) => a - b);
  const media = tempos.reduce((s, x) => s + x, 0) / tempos.length;
  const mediana = tempos[Math.floor(tempos.length / 2)];
  const pesoResp = obtidas.reduce((s, r) => s + (r.bytesDaResposta ?? 0), 0) / obtidas.length;
  const pesoArq = obtidas.reduce((s, r) => s + r.bytesDoArquivo, 0) / obtidas.length;
  console.log(`tempo por peça: média ${fmtSeg(media)} · mediana ${fmtSeg(mediana)} · máx ${fmtSeg(tempos[tempos.length - 1])}`);
  console.log(`peso médio: resposta ${fmtBytes(Math.round(pesoResp))} · arquivo ${fmtBytes(Math.round(pesoArq))}`);

  console.log('extrapolação SEQUENCIAL (tempo do tribunal + pausa de 3 s), só como ordem de grandeza:');
  for (const n of [10, 50, 100, 278]) {
    const total = (media + INTERVALO_MS) * n;
    console.log(`  ${String(n).padStart(3)} peças ≈ ${(total / 60000).toFixed(1).replace('.', ',')} min`);
  }

  const formatos = {};
  for (const r of obtidas) formatos[r.formatoReal] = (formatos[r.formatoReal] ?? 0) + 1;
  console.log(`formatos reais: ${Object.entries(formatos).map(([k, v]) => `${k}=${v}`).join(', ')}`);

  const pdfs = obtidas.filter((r) => r.pdf);
  if (pdfs.length > 0) {
    const medidos = pdfs.filter((r) => r.pdf.caracteresNaPagina1 != null);
    if (medidos.length === 0) {
      console.log('camada de texto: NÃO MEDIDA (pdftotext ausente ou falhou nesta máquina); ver fontes/imagens acima como indício.');
    } else {
      const comTexto = medidos.filter((r) => r.pdf.caracteresNaPagina1 >= 50).length;
      console.log(`camada de texto (pág. 1 de cada PDF): ${comTexto} de ${medidos.length} com texto (≥50 caracteres)`);
    }
    if (pdfs.some((r) => r.pdf.criptografado)) console.log('ATENÇÃO: há PDF criptografado.');
  }
}

const cab = resultados.flatMap((r) => Object.entries(r.cabecalhosDeLimite ?? {}));
console.log(
  cab.length > 0
    ? `cabeçalhos de limite vistos: ${JSON.stringify(Object.fromEntries(cab))}`
    : 'cabeçalhos de limite de requisições: nenhum visto',
);

// --- só formas em disco -----------------------------------------------------------
writeFileSync(
  DESTINO,
  JSON.stringify(
    {
      sondaLote: VERSAO_SONDA,
      geradoEm: new Date().toISOString(),
      tribunal,
      intervaloMs: INTERVALO_MS,
      pecas: resultados,
      agrupada: resultadoAgrupado,
      abortou,
    },
    null,
    2,
  ),
);
console.log(`\n[formas] tamanhos, tipos e campos → ${DESTINO} (sem conteúdo, sem nomes, sem número de processo)`);
process.exit(abortou ? 2 : 0);
