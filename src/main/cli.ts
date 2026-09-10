#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { NumeroCNJ } from '../domain/entities/NumeroCNJ.js';
import type { Processo } from '../domain/entities/Processo.js';
import { MniAdapter } from '../infrastructure/adapters/mni/MniAdapter.js';
import { HttpClient } from '../infrastructure/http/HttpClient.js';
import type { RespostaHttpBinaria } from '../infrastructure/http/HttpClient.js';
import { DomainError } from '../domain/errors/index.js';
import { carregarConfig } from '../infrastructure/config/env.js';
import { montarAplicacao } from './factories/makeProcessoSearchService.js';

/**
 * CLI de verificação da arquitetura.
 *
 * Não é o produto — é o menor adaptador de ENTRADA possível, o suficiente para
 * exercitar domínio, orquestrador e adapters de ponta a ponta sem servidor,
 * banco nem autenticação. Quando a API HTTP entrar, ela vira outro adaptador de
 * entrada sobre exatamente os mesmos casos de uso, e este arquivo continua
 * valendo como ferramenta de diagnóstico.
 *
 * Convenção de saída: dados em stdout, log em stderr. Isso mantém
 * `npm run cli -- processo <n> --json > saida.json` produzindo JSON puro.
 */

const USO = `
LexFlow — consulta de processos judiciais

  npm run cli -- processo <numero-cnj> [--json]
  npm run cli -- oab <numero> <uf> [--json]
  npm run cli -- pecas <numero-cnj> [--json] [--capturar <arquivo>]
  npm run cli -- saude

Exemplos:
  npm run cli -- processo 1234567-47.2023.8.26.0100
  npm run cli -- processo 12345674720238260100 --json
  npm run cli -- oab 234567 SP
  npm run cli -- pecas 5818922-04.2026.8.09.0011
  npm run cli -- saude

O comando "pecas" lê a credencial do ambiente, NÃO do banco:
  MNI_ID_CONSULTANTE     CPF do advogado (só dígitos)
  MNI_SENHA_CONSULTANTE  senha dele no sistema do tribunal

É de propósito: serve para validar o acesso antes de cadastrar ninguém, e não
exige a chave do cofre. Use --capturar <arquivo> para gravar a resposta
CRUA do tribunal — é dela que sai o fixture de teste que hoje falta.
`;

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      json: { type: 'boolean', default: false },
      capturar: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
  });

  const [comando, ...args] = positionals;

  if (values.help || !comando) {
    console.log(USO.trim());
    return comando ? 0 : 1;
  }

  const config = carregarConfig();
  const app = montarAplicacao(config);

  switch (comando) {
    case 'processo': {
      const numero = args[0];
      if (!numero) {
        console.error('Informe o número CNJ. Ex.: processo 1234567-47.2023.8.26.0100');
        return 1;
      }
      const processo = await app.buscarProcessoPorNumero.executar({
        numeroProcesso: numero,
      });
      if (values.json) {
        console.log(JSON.stringify(processo.toJSON(), null, 2));
      } else {
        console.log(formatarProcesso(processo));
      }
      return 0;
    }

    case 'oab': {
      const [numero, uf] = args;
      if (!numero || !uf) {
        console.error('Informe número e UF. Ex.: oab 234567 SP');
        return 1;
      }
      const processos = await app.buscarProcessosPorOab.executar({
        oab: numero,
        uf,
      });
      if (values.json) {
        console.log(JSON.stringify(processos.map((p) => p.toJSON()), null, 2));
      } else if (processos.length === 0) {
        console.log(`Nenhum processo encontrado para a OAB ${numero}/${uf.toUpperCase()}.`);
      } else {
        console.log(
          `${processos.length} processo(s) para a OAB ${numero}/${uf.toUpperCase()}:\n`,
        );
        console.log(processos.map(formatarResumo).join('\n'));
      }
      return 0;
    }

    case 'pecas': {
      const numero = args[0];
      if (!numero) {
        console.error('Informe o número do processo.');
        return 1;
      }

      const identificacao = process.env['MNI_ID_CONSULTANTE'] ?? '';
      const senha = process.env['MNI_SENHA_CONSULTANTE'] ?? '';
      if (!identificacao || !senha) {
        console.error(
          'Defina MNI_ID_CONSULTANTE e MNI_SENHA_CONSULTANTE no ambiente. ' +
            'Peças só existem para quem está habilitado nos autos.',
        );
        return 1;
      }

      const numeroCnj = NumeroCNJ.criar(numero);
      const sigla = numeroCnj.siglaTribunal ?? '';
      const provedor = new MniAdapter({
        ...(values.capturar
          ? { httpClient: new HttpCapturador(values.capturar, config.mni.timeoutMs) }
          : {}),
        endpoint: config.mni.endpoint,
        tribunais: config.mni.tribunais,
        timeoutMs: config.mni.timeoutMs,
        limitePorMinuto: config.mni.limitePorMinuto,
      });

      const pecas = await provedor.listarPecas(numeroCnj.digitos, {
        tribunal: sigla,
        identificacao,
        senha,
      });

      if (values.json) {
        console.log(JSON.stringify(pecas.map((p) => p.toJSON()), null, 2));
      } else if (pecas.length === 0) {
        console.log('Nenhuma peça devolvida pelo tribunal.');
      } else {
        const comTeor = pecas.filter((p) => p.conteudoDisponivel).length;
        console.log(`${pecas.length} peça(s); ${comTeor} com teor disponível\n`);
        for (const peca of pecas) {
          const teor = peca.conteudoDisponivel ? 'teor OK  ' : 'sem teor ';
          const data = formatarData(peca.dataHora);
          console.log(`${teor} ${peca.origem.padEnd(12)} ${data}  ${peca.rotulo}`);
        }
        if (comTeor === 0) {
          // O caso mais comum, e o que mais parece defeito sem esta linha.
          console.log(
            '\nNenhuma peça veio com teor. Em geral significa que esta ' +
              'credencial não está habilitada nos autos.',
          );
        }
      }
      return 0;
    }

    case 'saude': {
      const diagnostico = await app.orquestrador.diagnostico();
      for (const { provider, saudavel, motivo } of diagnostico) {
        console.log(`${saudavel ? 'OK  ' : 'FORA'}  ${provider}`);
        if (motivo) console.log(`        ${motivo}`);
      }
      return diagnostico.some((d) => d.saudavel) ? 0 : 2;
    }

    default:
      console.error(`Comando desconhecido: "${comando}"`);
      console.log(USO.trim());
      return 1;
  }
}

/**
 * Grava a resposta CRUA do tribunal, antes de qualquer interpretação.
 *
 * Existe por uma dívida concreta: o caminho de SUCESSO do MNI ainda não tem
 * captura real neste repositório, porque exige a credencial de um advogado
 * habilitado nos autos. Os testes de sucesso hoje rodam contra um payload
 * montado a partir do WSDL — que é exatamente o "circuito fechado" que o
 * CLAUDE.md manda evitar.
 *
 * Com `--capturar`, a primeira consulta real fecha essa dívida:
 *
 *   npm run cli -- pecas <numero> --capturar tests/fixtures/mni-tjgo-processo-real.txt
 *
 * Grava byte a byte, multipart inteiro, sem tocar em nada. ATENÇÃO: o arquivo
 * contém dados do processo e pode conter dado pessoal — confira antes de
 * versionar, e nunca capture processo em segredo de justiça.
 */
class HttpCapturador extends HttpClient {
  constructor(
    private readonly destino: string,
    timeoutMs: number,
  ) {
    super({ timeoutMs, tentativas: 1 });
  }

  override async postXml(
    url: string,
    xml: string,
    headers?: Record<string, string>,
  ): Promise<RespostaHttpBinaria> {
    const resposta = await super.postXml(url, xml, headers ?? {});
    writeFileSync(this.destino, Buffer.from(resposta.bytes));
    // stderr: stdout é dado, e a captura é log.
    console.error(
      `[captura] ${resposta.bytes.length} bytes gravados em ${this.destino}\n` +
        `[captura] content-type: ${resposta.contentType}`,
    );
    return resposta;
  }
}

function formatarProcesso(p: Processo): string {
  const linhas: string[] = [
    `Processo ......... ${p.numero.formatado}`,
    `Tribunal ......... ${p.tribunal}${p.grau ? ` (${p.grau})` : ''}`,
    `Vara ............. ${p.vara ?? '—'}`,
    `Classe ........... ${p.classe ?? '—'}`,
    `Assunto .......... ${p.assunto ?? '—'}`,
    `Distribuição ..... ${formatarData(p.dataDistribuicao)}`,
    `Valor da causa ... ${p.valorCausa !== undefined ? formatarMoeda(p.valorCausa) : '—'}`,
    `Segredo de justiça ${p.segredoJustica ? 'sim' : 'não'}`,
    `Fonte ............ ${p.procedencia.provider}${p.procedencia.deCache ? ' (cache)' : ''}`,
  ];

  if (p.partes.length > 0) {
    linhas.push('', 'Partes:');
    for (const parte of p.partes) {
      const advogados =
        parte.advogados.length > 0
          ? parte.advogados
              .map((a) => `${a.nome}${a.oab ? ` (OAB ${a.oab}/${a.ufOab ?? '??'})` : ''}`)
              .join(', ')
          : 'sem advogado constituído';
      linhas.push(`  [${parte.polo}] ${parte.nome}`);
      linhas.push(`          adv.: ${advogados}`);
    }
  }

  if (p.movimentacoes.length > 0) {
    linhas.push('', `Movimentações (${p.movimentacoes.length}):`);
    for (const m of p.movimentacoes.slice(0, 10)) {
      linhas.push(`  ${formatarData(m.data)}  ${m.titulo}`);
      if (m.conteudo) {
        linhas.push(`      ${recortar(m.conteudo, 160)}`);
      }
    }
    if (p.movimentacoes.length > 10) {
      linhas.push(`  … mais ${p.movimentacoes.length - 10} movimentação(ões).`);
    }
  }

  return linhas.join('\n');
}

function formatarResumo(p: Processo): string {
  const ultima = p.ultimaMovimentacao;
  return [
    `  ${p.numero.formatado}  ${p.classe ?? '—'}`,
    `    ${p.vara ?? '—'}`,
    `    último andamento: ${ultima ? `${formatarData(ultima.data)} — ${ultima.titulo}` : '—'}`,
  ].join('\n');
}

function formatarData(data: Date | undefined): string {
  if (!data) return '—';
  return data.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function formatarMoeda(valor: number): string {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function recortar(texto: string, limite: number): string {
  return texto.length <= limite ? texto : `${texto.slice(0, limite - 1)}…`;
}

main()
  .then((codigo) => {
    process.exitCode = codigo;
  })
  .catch((erro: unknown) => {
    if (erro instanceof DomainError) {
      // Erro de domínio é situação prevista: mensagem legível, sem stack trace.
      console.error(`\n[${erro.codigo}] ${erro.message}`);
      process.exitCode = 2;
      return;
    }
    console.error('\nFalha inesperada:', erro);
    process.exitCode = 1;
  });
