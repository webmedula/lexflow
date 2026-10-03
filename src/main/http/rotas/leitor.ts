import { Readable } from 'node:stream';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ServicoAssinaturas } from '../../../application/services/ServicoAssinaturas.js';
import type {
  PdfDoLeitor,
  ServicoLeitor,
} from '../../../application/services/ServicoLeitor.js';
import type { EntradaIndice } from '../../../domain/entities/IndicePagina.js';
import { progressoDoJob } from '../../../domain/entities/JobLeitor.js';
import type { ExtratoDoJob, JobLeitor } from '../../../domain/entities/JobLeitor.js';
import {
  OperacaoNaoSuportadaError,
  WorkspaceNaoResolvidoError,
} from '../../../domain/errors/index.js';

function workspaceDe(requisicao: FastifyRequest): string {
  const ws = requisicao.workspace;
  if (!ws) throw new WorkspaceNaoResolvidoError();
  return ws;
}

/**
 * Teto de peças por pedido. Um processo real medido tem 279; o teto existe
 * para um corpo malicioso não enfileirar um job de cem mil ids.
 */
const MAX_PECAS_POR_PEDIDO = 5000;

const corpoCriar = z.object({
  pecas: z.array(z.string().min(1).max(100)).min(1).max(MAX_PECAS_POR_PEDIDO),
});

type Params = { numero: string; jobId: string };
type ParamsExtrato = Params & { extratoId: string };

/**
 * Rotas do leitor de peças: pedir a combinação, acompanhar, ler o PDF.
 *
 * Sem `try/catch`: job de outro workspace, PDF ainda não pronto, cota
 * estourada — tudo é erro de domínio, e o `errorHandler` traduz.
 */
export function rotasDoLeitor(
  servico: ServicoLeitor | undefined,
  assinaturas?: ServicoAssinaturas,
): FastifyPluginAsync {
  return async (servidor) => {
    // O leitor consome o MNI com a credencial do assinante: é recurso do plano
    // de peças, como baixar uma peça avulsa.
    async function exigirPlano(req: FastifyRequest): Promise<void> {
      await assinaturas?.exigir(workspaceDe(req), 'pecas');
    }

    function exigirServico(): ServicoLeitor {
      if (!servico) {
        throw new OperacaoNaoSuportadaError(
          'leitor',
          'combinarPecas',
          'o leitor de peças não está configurado — exige o acesso a peças ' +
            '(PROCESSOVIVO_CREDENCIAL_CHAVE) e o qpdf instalado no servidor',
        );
      }
      return servico;
    }

    servidor.post<{ Params: { numero: string }; Body: unknown }>(
      '/v1/processos/:numero/leitor',
      async (req, resposta) => {
        await exigirPlano(req);
        const servico = exigirServico();
        const { pecas } = corpoCriar.parse(req.body ?? {});
        const job = await servico.criar(workspaceDe(req), req.params.numero, pecas);
        void resposta.code(202);
        return {
          ...visaoDoJob(job),
          // Ordem de grandeza, com a medição; a tela diz que é estimativa.
          estimativaSegundos: servico.estimarSegundos(job.pedidas.length),
        };
      },
    );

    /*
     * Faixa de tempo e limite de confirmação ANTES de montar — a tela mostra
     * enquanto o advogado marca as peças. Não consulta o tribunal.
     */
    servidor.get<{ Querystring: { pecas?: string } }>(
      '/v1/leitor/estimativa',
      async (req) => {
        const pecas = z.coerce
          .number()
          .int()
          .min(0)
          .max(MAX_PECAS_POR_PEDIDO)
          .parse(req.query.pecas ?? '0');
        return exigirServico().estimar(pecas);
      },
    );

    /*
     * O que a tela precisa para abrir o painel. `job`: o pedido mais recente
     * (pode estar andando, ou ter falhado). `pronto`: o PDF guardado mais
     * recente, para "Reabrir o PDF já pronto". `reaproveitaveis`: as peças que
     * já estão em algum PDF guardado — uma seleção nova não as pede ao
     * tribunal de novo, e a estimativa de tempo conta só as outras. Tudo
     * `null`/vazio quando nunca houve — não é erro.
     */
    servidor.get<{ Params: { numero: string } }>(
      '/v1/processos/:numero/leitor',
      async (req) => {
        const servico = exigirServico();
        const ws = workspaceDe(req);
        const job = await servico.ultimoDoProcesso(ws, req.params.numero);
        const guardados = await servico.guardadosDoProcesso(ws, req.params.numero);
        return {
          job: job ? visaoDoJob(job) : null,
          pronto: guardados.pronto ? visaoDoJob(guardados.pronto) : null,
          reaproveitaveis: guardados.reaproveitaveis,
        };
      },
    );

    servidor.get<{ Params: Params }>(
      '/v1/processos/:numero/leitor/:jobId',
      async (req) => {
        const job = await exigirServico().consultar(
          workspaceDe(req),
          req.params.numero,
          req.params.jobId,
        );
        return visaoDoJob(job);
      },
    );

    servidor.get<{ Params: Params }>(
      '/v1/processos/:numero/leitor/:jobId/indice',
      async (req) => {
        const { job, indice } = await exigirServico().indice(
          workspaceDe(req),
          req.params.numero,
          req.params.jobId,
        );
        return {
          jobId: job.id,
          estado: job.estado,
          paginas: job.arquivo?.paginas ?? 0,
          procedencia: procedencia(job),
          indice: indice.map(visaoDaEntrada),
        };
      },
    );

    servidor.post<{ Params: Params }>(
      '/v1/processos/:numero/leitor/:jobId/atualizar',
      async (req, resposta) => {
        await exigirPlano(req);
        const { job, semMudanca } = await exigirServico().atualizar(
          workspaceDe(req),
          req.params.numero,
          req.params.jobId,
        );
        if (!semMudanca) void resposta.code(202);
        return { semMudanca, ...visaoDoJob(job) };
      },
    );

    /*
     * O PDF, com suporte a Range.
     *
     * É o que deixa o PDF.js abrir um processo de milhares de páginas pedindo
     * só os trechos que vai desenhar: a primeira página aparece com os
     * primeiros KB (o arquivo é linearizado), e o resto vem sob demanda.
     *
     * Não exige plano: o arquivo já foi baixado e é da pessoa enquanto durar
     * a guarda. Trancar a leitura por assinatura vencida seria cobrar para ver
     * o que já se tem.
     */
    servidor.get<{ Params: Params }>(
      '/v1/processos/:numero/leitor/:jobId/pdf',
      async (req, resposta) => {
        const pdf = await exigirServico().abrirPdf(
          workspaceDe(req),
          req.params.numero,
          req.params.jobId,
        );
        return servirPdf(req, resposta, comoArquivo(pdf));
      },
    );

    /*
     * "Baixar só algumas" (v0.31.1): recorta do PDF guardado as páginas das
     * peças marcadas. NÃO consulta o tribunal, e por isso não exige plano —
     * como a leitura, é o que a pessoa já tem.
     */
    servidor.post<{ Params: Params; Body: unknown }>(
      '/v1/processos/:numero/leitor/:jobId/extratos',
      async (req, resposta) => {
        const { pecas } = corpoCriar.parse(req.body ?? {});
        const { extrato } = await exigirServico().extrair(
          workspaceDe(req),
          req.params.numero,
          req.params.jobId,
          pecas,
        );
        void resposta.code(201);
        return visaoDoExtrato(req.params.jobId, extrato);
      },
    );

    servidor.get<{ Params: ParamsExtrato }>(
      '/v1/processos/:numero/leitor/:jobId/extratos/:extratoId/pdf',
      async (req, resposta) => {
        const pdf = await exigirServico().abrirExtrato(
          workspaceDe(req),
          req.params.numero,
          req.params.jobId,
          req.params.extratoId,
        );
        return servirPdf(req, resposta, comoArquivo(pdf));
      },
    );
  };
}

/** O que `servirPdf` precisa saber de um arquivo — do leitor ou da Pasta digital. */
export interface ArquivoServivel {
  readonly tamanho: number;
  readonly nomeArquivo: string;
  /** Quando o arquivo foi obtido do tribunal. Nunca é "ao vivo". */
  readonly baixadoEm?: Date | undefined;
  ler(inicio: number, fim: number): AsyncIterable<Uint8Array>;
}

function comoArquivo(pdf: PdfDoLeitor): ArquivoServivel {
  return {
    tamanho: pdf.tamanho,
    nomeArquivo: pdf.nomeArquivo,
    baixadoEm: pdf.job.concluidoEm,
    ler: (inicio, fim) => pdf.ler(inicio, fim),
  };
}

/** O PDF, com suporte a `Range` — o combinado e o recorte saem iguais. */
export async function servirPdf(
  req: FastifyRequest,
  resposta: FastifyReply,
  pdf: ArquivoServivel,
): Promise<FastifyReply> {
  void resposta.header('accept-ranges', 'bytes');
  void resposta.header('content-type', 'application/pdf');
  // Autos de processo: nenhum cache compartilhado guarda isto.
  void resposta.header('cache-control', 'private, no-store');
  void resposta.header('x-content-type-options', 'nosniff');
  void resposta.header(
    'content-disposition',
    `attachment; filename="${pdf.nomeArquivo}"`,
  );
  // A procedência viaja junto do arquivo, para quem o abrir por fora da
  // tela saber de quando ele é. Nunca é "ao vivo".
  if (pdf.baixadoEm) {
    void resposta.header('x-processovivo-baixado-em', pdf.baixadoEm.toISOString());
  }
  void resposta.header('x-processovivo-ao-vivo', 'false');

  const faixa = interpretarRange(req.headers.range, pdf.tamanho);
  if (faixa === 'insatisfazivel') {
    void resposta.code(416);
    void resposta.header('content-range', `bytes */${pdf.tamanho}`);
    return resposta.send();
  }
  if (faixa) {
    void resposta.code(206);
    void resposta.header(
      'content-range',
      `bytes ${faixa.inicio}-${faixa.fim}/${pdf.tamanho}`,
    );
    void resposta.header('content-length', String(faixa.fim - faixa.inicio + 1));
    return resposta.send(Readable.from(pdf.ler(faixa.inicio, faixa.fim)));
  }
  void resposta.header('content-length', String(pdf.tamanho));
  if (pdf.tamanho === 0) return resposta.send(Buffer.alloc(0));
  return resposta.send(Readable.from(pdf.ler(0, pdf.tamanho - 1)));
}

/**
 * `Range: bytes=a-b`, `bytes=a-` e `bytes=-n` (os últimos n). Uma faixa só.
 *
 * Pedido com várias faixas recebe o arquivo inteiro (200), que a RFC 9110
 * permite: multipart/byteranges é complexidade que o PDF.js não usa.
 * Cabeçalho ilegível também — ignorar Range malformado é o comportamento
 * prescrito, e é mais útil do que um erro.
 */
export function interpretarRange(
  cabecalho: string | undefined,
  tamanho: number,
): { inicio: number; fim: number } | 'insatisfazivel' | undefined {
  if (!cabecalho) return undefined;
  const m = /^bytes=(\d*)-(\d*)$/.exec(cabecalho.trim());
  if (!m) return undefined;
  const [, a = '', b = ''] = m;
  if (a === '' && b === '') return undefined;

  if (a === '') {
    const n = Number(b);
    if (n === 0) return 'insatisfazivel';
    return { inicio: Math.max(0, tamanho - n), fim: tamanho - 1 };
  }
  const inicio = Number(a);
  if (inicio >= tamanho) return 'insatisfazivel';
  const fim = b === '' ? tamanho - 1 : Math.min(Number(b), tamanho - 1);
  if (fim < inicio) return undefined;
  return { inicio, fim };
}

function procedencia(job: JobLeitor): Record<string, unknown> {
  return {
    fonte: 'mni',
    tribunal: job.tribunal,
    credencial: job.credencial,
    baixadoEm: job.concluidoEm?.toISOString() ?? null,
    expiraEm: job.expiraEm?.toISOString() ?? null,
    // Explícito para nenhuma tela confundir arquivo guardado com consulta.
    aoVivo: false,
  };
}

/** O recorte, sem localizador. O endereço do arquivo vai pronto. */
function visaoDoExtrato(jobId: string, x: ExtratoDoJob): Record<string, unknown> {
  return {
    extratoId: x.id,
    jobId,
    paginas: x.paginas,
    bytes: x.bytes,
    criadoEm: x.criadoEm.toISOString(),
    indice: x.indice.map(visaoDaEntrada),
  };
}

function visaoDaEntrada(e: EntradaIndice): Record<string, unknown> {
  return {
    pecaId: e.pecaId,
    movimento: e.movimento ?? null,
    rotulo: e.rotulo,
    data: e.data?.toISOString() ?? null,
    paginaInicial: e.paginaInicial,
    paginaFinal: e.paginaFinal,
    situacao: e.situacao,
    ...(e.motivo ? { motivo: e.motivo } : {}),
  };
}

/**
 * O que a pessoa vê de um job. Localizador de arquivo, caminho em disco e
 * bytes de peça nunca saem daqui — há teste que fixa as chaves.
 */
export function visaoDoJob(job: JobLeitor): Record<string, unknown> {
  const progresso = progressoDoJob(job);
  return {
    jobId: job.id,
    numero: job.numeroProcesso,
    estado: job.estado,
    baixadas: progresso.baixadas,
    total: progresso.total,
    pendentes: progresso.pendentes,
    recusadas: progresso.recusadas,
    mensagem: job.mensagem ?? null,
    retomarEm: job.retomarEm?.toISOString() ?? null,
    criadoEm: job.criadoEm.toISOString(),
    atualizadoEm: job.atualizadoEm.toISOString(),
    paginas: job.arquivo?.paginas ?? null,
    bytes: job.arquivo?.bytes ?? null,
    atualizaDe: job.atualizaDe ?? null,
    finalidade: job.finalidade ?? null,
    procedencia: procedencia(job),
  };
}
