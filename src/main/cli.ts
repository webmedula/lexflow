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
import { gerarBackup } from '../infrastructure/persistencia/backup.js';
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
Processo Vivo — consulta de processos judiciais

  npm run cli -- processo <numero-cnj> [--json]
  npm run cli -- oab <numero> <uf> [--json]
  npm run cli -- pecas <numero-cnj> [--json] [--capturar <arquivo>]
  npm run cli -- saude
  npm run cli -- backup [--manter 7]
  npm run cli -- email <destinatario>

Exemplos:
  npm run cli -- processo 1234567-47.2023.8.26.0100
  npm run cli -- processo 12345674720238260100 --json
  npm run cli -- oab 234567 SP
  npm run cli -- pecas 5818922-04.2026.8.09.0011
  npm run cli -- saude
  npm run cli -- backup
  npm run cli -- email eu@meudominio.com.br

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
      manter: { type: 'string' },
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
        const daParte = pecas.filter((p) => p.origem === 'PARTE').length;
        console.log(`${pecas.length} peça(s); ${daParte} juntada(s) pelas partes\n`);
        for (const peca of pecas) {
          const data = formatarData(peca.dataHora);
          const tipo = (peca.mimetype ?? '—').replace('application/', '');
          console.log(
            `${peca.origem.padEnd(12)} ${data}  ${tipo.padEnd(6)}  ${peca.rotulo}`,
          );
        }
        // NÃO se conta aqui "quantas têm teor": a listagem do MNI nunca traz o
        // arquivo, então a contagem daria zero sempre e faria parecer que a
        // credencial não vale nada. Para pegar o teor: `pecas <n> --capturar`,
        // ou a rota de download.
      }
      return 0;
    }

    case 'backup': {
      // Uma cópia CONSISTENTE com o serviço em pé — ver `backup.ts` para por
      // que copiar o arquivo à mão não serve em modo WAL.
      const manter = values.manter ? Number(values.manter) : undefined;
      const r = gerarBackup({
        caminhoBanco: config.banco.caminho,
        ...(manter !== undefined && Number.isFinite(manter) ? { manter } : {}),
      });

      console.log(`Backup: ${r.caminho}`);
      console.log(`Tamanho: ${(r.bytes / 1024 / 1024).toFixed(2)} MB`);
      console.log(`Integridade: conferida (o arquivo foi aberto e lido)`);
      if (r.apagados.length > 0) {
        console.log(`Cópias antigas removidas: ${r.apagados.length}`);
      }
      // O aviso vai SEMPRE, e em stderr para não sujar a saída de dados.
      console.error(
        '\nAtenção: esta cópia está no mesmo volume do banco. Isso protege ' +
          'contra corrupção e engano, NÃO contra perder o volume. Leve uma cópia ' +
          'para fora do servidor — ver o runbook de deploy.',
      );
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

    /**
     * Manda uma mensagem de teste e diz, em português, o que está faltando.
     *
     * Existe porque até aqui a única forma de saber se o SMTP estava certo era
     * pedir uma recuperação de senha de verdade — que gasta um link, mexe numa
     * conta e, por decisão de segurança, responde a MESMA coisa tendo enviado
     * ou não. Ou seja: a funcionalidade desenhada para não contar nada a um
     * curioso também não contava nada a quem está configurando o servidor.
     *
     * Aqui é o contrário: barulhento e específico de propósito.
     */
    case 'email': {
      const destino = args[0];
      if (!destino) {
        console.error('Informe o destinatário. Ex.: email eu@meudominio.com.br');
        return 1;
      }

      const urlBase = config.http.urlBase;
      console.log(`remetente ..... ${config.notificacao.remetente || '(vazio)'}`);
      console.log(
        `servidor ...... ${config.notificacao.smtpHost || '(vazio)'}:` +
          `${config.notificacao.smtpPorta}` +
          ` (${config.notificacao.smtpSeguro ? 'TLS direto' : 'STARTTLS'})`,
      );
      console.log(`endereço base . ${urlBase || '(vazio)'}`);
      console.log(`canal ......... ${app.notificador.nome}\n`);

      // A condição é a MESMA do composition root — host e remetente definidos —,
      // e não o nome do canal. Comparar com uma string mágica já quebrou uma vez
      // aqui: o notificador se chama `email-smtp`, não `smtp`, e o comando
      // recusava uma configuração perfeitamente válida.
      const entrega =
        Boolean(config.notificacao.smtpHost) && Boolean(config.notificacao.remetente);
      if (!entrega || !app.notificador.habilitado) {
        console.error(
          'SMTP não configurado: nada sai deste servidor.\n' +
            'Defina SMTP_HOST e SMTP_FROM. Sem os dois, o sistema escreve no log\n' +
            'o que teria enviado — útil para desenvolver, inútil para o assinante.',
        );
        return 2;
      }

      // CONFERIR antes de ENVIAR. A maioria das falhas de SMTP acontece antes
      // de a mensagem existir — porta bloqueada, senha errada, TLS na porta
      // errada —, e misturar as duas etapas produz "não funcionou" sem causa.
      if (app.notificador.diagnosticar) {
        const d = await app.notificador.diagnosticar();
        if (!d.ok) {
          console.error(`Conexão com o servidor de e-mail FALHOU${d.codigo ? ` (${d.codigo})` : ''}:\n`);
          console.error(`  ${d.motivo ?? 'motivo não informado pelo servidor'}\n`);
          console.error('Nenhuma mensagem foi enviada.');
          return 2;
        }
        console.log('conexão ...... OK (servidor aceitou usuário e senha)\n');
      }

      const ok = await app.notificador.enviar({
        para: destino,
        assunto: 'Processo Vivo — teste de configuração',
        texto:
          'Esta é uma mensagem de teste do Processo Vivo.\n\n' +
          'Se ela chegou, o envio está funcionando: a recuperação de senha e os\n' +
          'avisos de movimentação vão sair por este mesmo caminho.\n\n' +
          'Confira também se ela NÃO caiu no spam. Aviso de prazo que cai em spam\n' +
          'é pior do que aviso que não sai: o advogado não recebe e não desconfia.\n',
      });

      if (!ok) {
        // Chegar aqui é raro e específico: a conexão e a autenticação passaram,
        // e mesmo assim a mensagem foi recusada. Quase sempre é o remetente ou
        // o destinatário, não a configuração de conexão.
        console.error(
          'Conectou e autenticou, mas o servidor RECUSOU a mensagem.\n' +
            'Em geral é o remetente: SMTP_FROM precisa ser um endereço que este\n' +
            'servidor tenha autorização para enviar. O motivo exato está no log,\n' +
            'em "falha ao enviar e-mail".',
        );
        return 2;
      }

      console.log(`Enviado para ${destino}. Confira a caixa de entrada E o spam.`);
      if (!urlBase) {
        console.log(
          '\nATENÇÃO: PROCESSOVIVO_URL_BASE está vazia, então a recuperação de\n' +
            'senha continua desligada mesmo com o SMTP funcionando — um link\n' +
            'relativo num e-mail não leva a lugar nenhum.',
        );
        return 2;
      }
      console.log('\nRecuperação de senha: LIGADA.');
      return 0;
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
