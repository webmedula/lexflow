import type { DatabaseSync } from 'node:sqlite';
import type {
  PecaBaixada,
  RepositorioPecasBaixadas,
} from '../../../domain/ports/RepositorioPecasBaixadas.js';

interface Linha {
  numero: string;
  peca_id: string;
  rotulo: string | null;
  mimetype: string | null;
  bytes: number;
  baixada_em: string;
}

/** Teto da listagem. Sem ele, um workspace antigo devolveria o histórico inteiro. */
const LIMITE_PADRAO = 20;
const LIMITE_MAXIMO = 200;

export class RepositorioPecasBaixadasSqlite implements RepositorioPecasBaixadas {
  constructor(private readonly db: DatabaseSync) {}

  async registrar(peca: PecaBaixada): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO pecas_baixadas
           (workspace, numero, peca_id, rotulo, mimetype, bytes, baixada_em)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        peca.workspace,
        peca.numeroProcesso,
        peca.idPeca,
        peca.rotulo || null,
        peca.mimetype ?? null,
        peca.bytes,
        peca.baixadaEm.toISOString(),
      );
  }

  async listar(
    workspace: string,
    opcoes: { readonly numeroProcesso?: string; readonly limite?: number } = {},
  ): Promise<PecaBaixada[]> {
    const limite = Math.min(Math.max(opcoes.limite ?? LIMITE_PADRAO, 1), LIMITE_MAXIMO);
    const cond = ['workspace = ?'];
    const args: Array<string | number> = [workspace];
    if (opcoes.numeroProcesso) {
      cond.push('numero = ?');
      args.push(opcoes.numeroProcesso);
    }
    args.push(limite);

    const linhas = this.db
      .prepare(
        `SELECT numero, peca_id, rotulo, mimetype, bytes, baixada_em
           FROM pecas_baixadas
          WHERE ${cond.join(' AND ')}
          ORDER BY baixada_em DESC
          LIMIT ?`,
      )
      .all(...args) as unknown as Linha[];

    return linhas.map((l) => ({
      workspace,
      numeroProcesso: l.numero,
      idPeca: l.peca_id,
      rotulo: l.rotulo ?? 'documento',
      ...(l.mimetype ? { mimetype: l.mimetype } : {}),
      bytes: Number(l.bytes),
      baixadaEm: new Date(l.baixada_em),
    }));
  }

  async contarDesde(workspace: string, desde: Date): Promise<number> {
    const r = this.db
      .prepare(
        'SELECT COUNT(*) AS n FROM pecas_baixadas WHERE workspace = ? AND baixada_em >= ?',
      )
      .get(workspace, desde.toISOString()) as unknown as { n: number } | undefined;
    return Number(r?.n ?? 0);
  }

  async idsDoProcesso(workspace: string, numeroProcesso: string): Promise<string[]> {
    const linhas = this.db
      .prepare(
        `SELECT DISTINCT peca_id AS v FROM pecas_baixadas
          WHERE workspace = ? AND numero = ?`,
      )
      .all(workspace, numeroProcesso) as unknown as Array<{ v: string }>;
    return linhas.map((l) => String(l.v));
  }
}
