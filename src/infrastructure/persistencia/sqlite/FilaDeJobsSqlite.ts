import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { EntradaIndice } from '../../../domain/entities/IndicePagina.js';
import { DESCRICAO_DO_MOTIVO } from '../../../domain/entities/JobLeitor.js';
import type {
  JobLeitor,
  MotivoNaoObtida,
  PecaDoJob,
} from '../../../domain/entities/JobLeitor.js';
import type { FilaDeJobs } from '../../../domain/ports/FilaDeJobs.js';

/**
 * O JSON da coluna `dados` é dado NOSSO, mas passa por Zod mesmo assim: uma
 * linha gravada por uma versão anterior, ou editada à mão no banco, não pode
 * entrar no executor como `JobLeitor` sem conferência — o executor decide com
 * base nela o que baixar de novo do tribunal.
 */
const MOTIVOS = Object.keys(DESCRICAO_DO_MOTIVO) as [
  MotivoNaoObtida,
  ...MotivoNaoObtida[],
];

const pecaSchema = z.object({
  pecaId: z.string(),
  ordem: z.number().int(),
  rotulo: z.string(),
  movimento: z.number().int().optional(),
  data: z.string().optional(),
  mimetype: z.string().optional(),
  situacao: z.enum(['pendente', 'repetir', 'obtida', 'vazia', 'nao_obtida']),
  motivo: z.enum(MOTIVOS).optional(),
  bytes: z.number().int().nonnegative().optional(),
  arquivo: z.string().optional(),
  reaproveitada: z
    .object({
      paginaInicial: z.number().int().positive(),
      paginaFinal: z.number().int().positive(),
      situacao: z.enum(['incorporada', 'convertida', 'html_convertida']),
      motivo: z.string().optional(),
    })
    .optional(),
});

const indiceSchema = z.object({
  pecaId: z.string(),
  movimento: z.number().int().optional(),
  rotulo: z.string(),
  data: z.string().optional(),
  paginaInicial: z.number().int().positive(),
  paginaFinal: z.number().int().positive(),
  situacao: z.enum([
    'incorporada',
    'convertida',
    'html_convertida',
    'html_nao_incorporada',
    'nao_obtida',
  ]),
  motivo: z.string().optional(),
});

const dadosSchema = z.object({
  tribunal: z.string(),
  credencial: z.string(),
  pedidas: z.array(z.string()),
  pecas: z.array(pecaSchema),
  idsListados: z.array(z.string()).optional(),
  hashDocumentos: z.string().optional(),
  tamanhoLote: z.number().int().positive(),
  loteTravado: z.boolean(),
  chamadas: z.number().int().nonnegative(),
  bytesRecebidos: z.number().nonnegative(),
  concluidoEm: z.string().optional(),
  mensagem: z.string().optional(),
  atualizaDe: z.string().optional(),
  arquivo: z
    .object({
      localizador: z.string(),
      bytes: z.number().nonnegative(),
      paginas: z.number().int().positive(),
    })
    .optional(),
  indice: z.array(indiceSchema).optional(),
});

interface Linha {
  workspace: string;
  id: string;
  numero: string;
  estado: string;
  criado_em: string;
  atualizado_em: string;
  retomar_em: string | null;
  expira_em: string | null;
  dados: string;
}

const ESTADOS = [
  'na_fila',
  'baixando',
  'montando',
  'pronto',
  'parcial',
  'pausado_por_bloqueio',
  'falhou',
  'expirado',
] as const;

export class FilaDeJobsSqlite implements FilaDeJobs {
  constructor(private readonly db: DatabaseSync) {}

  async criar(job: JobLeitor): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO jobs_leitor
           (workspace, id, numero, estado, criado_em, atualizado_em, retomar_em, expira_em, dados)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(...this.colunas(job));
  }

  async salvar(job: JobLeitor): Promise<void> {
    const [workspace, id, numero, estado, criado, atualizado, retomar, expira, dados] =
      this.colunas(job);
    this.db
      .prepare(
        `UPDATE jobs_leitor
            SET numero = ?, estado = ?, criado_em = ?, atualizado_em = ?,
                retomar_em = ?, expira_em = ?, dados = ?
          WHERE workspace = ? AND id = ?`,
      )
      .run(numero, estado, criado, atualizado, retomar, expira, dados, workspace, id);
  }

  async obter(workspace: string, jobId: string): Promise<JobLeitor | undefined> {
    const linha = this.db
      .prepare('SELECT * FROM jobs_leitor WHERE workspace = ? AND id = ?')
      .get(workspace, jobId) as unknown as Linha | undefined;
    return linha ? ler(linha) : undefined;
  }

  async proximoParaExecutar(agora: Date): Promise<JobLeitor | undefined> {
    // `baixando` e `montando` entram junto com `na_fila`: no arranque, um job
    // nesses estados é um job que o redeploy interrompeu, e ele continua de
    // onde parou. Não há outro executor que pudesse estar com ele — uma
    // instância, um executor, um job por vez.
    const linha = this.db
      .prepare(
        `SELECT * FROM jobs_leitor
          WHERE estado IN ('na_fila', 'baixando', 'montando')
             OR (estado = 'pausado_por_bloqueio' AND (retomar_em IS NULL OR retomar_em <= ?))
          ORDER BY criado_em ASC
          LIMIT 1`,
      )
      .get(agora.toISOString()) as unknown as Linha | undefined;
    return linha ? ler(linha) : undefined;
  }

  async expirados(agora: Date): Promise<JobLeitor[]> {
    const linhas = this.db
      .prepare(
        `SELECT * FROM jobs_leitor
          WHERE estado <> 'expirado' AND expira_em IS NOT NULL AND expira_em <= ?`,
      )
      .all(agora.toISOString()) as unknown as Linha[];
    return linhas.map(ler);
  }

  async doWorkspace(workspace: string): Promise<JobLeitor[]> {
    const linhas = this.db
      .prepare('SELECT * FROM jobs_leitor WHERE workspace = ? ORDER BY criado_em DESC')
      .all(workspace) as unknown as Linha[];
    return linhas.map(ler);
  }

  async apagarDoWorkspace(workspace: string): Promise<number> {
    const r = this.db
      .prepare('DELETE FROM jobs_leitor WHERE workspace = ?')
      .run(workspace);
    return Number(r.changes);
  }

  private colunas(
    job: JobLeitor,
  ): [
    string,
    string,
    string,
    string,
    string,
    string,
    string | null,
    string | null,
    string,
  ] {
    const dados = {
      tribunal: job.tribunal,
      credencial: job.credencial,
      pedidas: job.pedidas,
      pecas: job.pecas.map((p) => ({ ...p, data: p.data?.toISOString() })),
      idsListados: job.idsListados,
      hashDocumentos: job.hashDocumentos,
      tamanhoLote: job.tamanhoLote,
      loteTravado: job.loteTravado,
      chamadas: job.chamadas,
      bytesRecebidos: job.bytesRecebidos,
      concluidoEm: job.concluidoEm?.toISOString(),
      mensagem: job.mensagem,
      atualizaDe: job.atualizaDe,
      arquivo: job.arquivo,
      indice: job.indice?.map((e) => ({ ...e, data: e.data?.toISOString() })),
    };
    return [
      job.workspace,
      job.id,
      job.numeroProcesso,
      job.estado,
      job.criadoEm.toISOString(),
      job.atualizadoEm.toISOString(),
      job.retomarEm?.toISOString() ?? null,
      job.expiraEm?.toISOString() ?? null,
      JSON.stringify(dados),
    ];
  }
}

function ler(linha: Linha): JobLeitor {
  const d = dadosSchema.parse(JSON.parse(linha.dados));
  const estado = z.enum(ESTADOS).parse(linha.estado);
  const pecas: PecaDoJob[] = d.pecas.map((p) => ({
    pecaId: p.pecaId,
    ordem: p.ordem,
    rotulo: p.rotulo,
    situacao: p.situacao,
    ...(p.movimento !== undefined ? { movimento: p.movimento } : {}),
    ...(p.data !== undefined ? { data: new Date(p.data) } : {}),
    ...(p.mimetype !== undefined ? { mimetype: p.mimetype } : {}),
    ...(p.motivo !== undefined ? { motivo: p.motivo } : {}),
    ...(p.bytes !== undefined ? { bytes: p.bytes } : {}),
    ...(p.arquivo !== undefined ? { arquivo: p.arquivo } : {}),
    ...(p.reaproveitada !== undefined
      ? {
          reaproveitada: {
            paginaInicial: p.reaproveitada.paginaInicial,
            paginaFinal: p.reaproveitada.paginaFinal,
            situacao: p.reaproveitada.situacao,
            ...(p.reaproveitada.motivo !== undefined
              ? { motivo: p.reaproveitada.motivo }
              : {}),
          },
        }
      : {}),
  }));
  const indice: EntradaIndice[] | undefined = d.indice?.map((e) => ({
    pecaId: e.pecaId,
    rotulo: e.rotulo,
    paginaInicial: e.paginaInicial,
    paginaFinal: e.paginaFinal,
    situacao: e.situacao,
    ...(e.movimento !== undefined ? { movimento: e.movimento } : {}),
    ...(e.data !== undefined ? { data: new Date(e.data) } : {}),
    ...(e.motivo !== undefined ? { motivo: e.motivo } : {}),
  }));
  return {
    id: linha.id,
    workspace: linha.workspace,
    numeroProcesso: linha.numero,
    estado,
    tribunal: d.tribunal,
    credencial: d.credencial,
    pedidas: d.pedidas,
    pecas,
    tamanhoLote: d.tamanhoLote,
    loteTravado: d.loteTravado,
    chamadas: d.chamadas,
    bytesRecebidos: d.bytesRecebidos,
    criadoEm: new Date(linha.criado_em),
    atualizadoEm: new Date(linha.atualizado_em),
    ...(linha.retomar_em ? { retomarEm: new Date(linha.retomar_em) } : {}),
    ...(linha.expira_em ? { expiraEm: new Date(linha.expira_em) } : {}),
    ...(d.idsListados !== undefined ? { idsListados: d.idsListados } : {}),
    ...(d.hashDocumentos !== undefined ? { hashDocumentos: d.hashDocumentos } : {}),
    ...(d.concluidoEm !== undefined ? { concluidoEm: new Date(d.concluidoEm) } : {}),
    ...(d.mensagem !== undefined ? { mensagem: d.mensagem } : {}),
    ...(d.atualizaDe !== undefined ? { atualizaDe: d.atualizaDe } : {}),
    ...(d.arquivo !== undefined ? { arquivo: d.arquivo } : {}),
    ...(indice !== undefined ? { indice } : {}),
  };
}
