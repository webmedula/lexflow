import type { DatabaseSync } from 'node:sqlite';
import type {
  ChaveApiCadastrada,
  NovaChaveApi,
  RepositorioChavesApi,
} from '../../../domain/ports/RepositorioChavesApi.js';

interface LinhaChaveApi {
  hash: string;
  rotulo: string;
  criada_em: string;
  revogada_em: string | null;
}

function paraCadastrada(l: LinhaChaveApi): ChaveApiCadastrada {
  return {
    identificador: l.hash.slice(0, 8),
    workspace: l.hash.slice(0, 16),
    rotulo: l.rotulo,
    criadaEm: new Date(l.criada_em),
    ...(l.revogada_em ? { revogadaEm: new Date(l.revogada_em) } : {}),
  };
}

export class RepositorioChavesApiSqlite implements RepositorioChavesApi {
  constructor(private readonly db: DatabaseSync) {}

  async criar(dados: NovaChaveApi): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO chaves_api (hash, rotulo, criada_em, revogada_em)
         VALUES (?, ?, ?, NULL)`,
      )
      .run(dados.hash, dados.rotulo, dados.criadaEm.toISOString());
  }

  async listar(): Promise<readonly ChaveApiCadastrada[]> {
    const linhas = this.db
      .prepare('SELECT * FROM chaves_api ORDER BY criada_em DESC')
      .all() as unknown as LinhaChaveApi[];
    return linhas.map(paraCadastrada);
  }

  async ativaPorHash(hash: string): Promise<boolean> {
    const linha = this.db
      .prepare('SELECT 1 FROM chaves_api WHERE hash = ? AND revogada_em IS NULL')
      .get(hash);
    return linha !== undefined;
  }

  async revogarPorIdentificador(identificador: string, agora: Date): Promise<boolean> {
    // `substr` e não `LIKE identificador || '%'`: o identificador é hex fixo em
    // 8 caracteres, então a fatia é exata — `LIKE` com curinga implícito
    // aceitaria um identificador incompleto e revogaria a chave errada.
    const r = this.db
      .prepare(
        `UPDATE chaves_api SET revogada_em = ?
          WHERE substr(hash, 1, 8) = ? AND revogada_em IS NULL`,
      )
      .run(agora.toISOString(), identificador);
    if (Number(r.changes) > 0) return true;

    // Idempotente: revogar de novo uma chave já revogada não é erro. Só é
    // "não encontrada" quando o identificador não corresponde a chave nenhuma.
    const existe = this.db
      .prepare('SELECT 1 FROM chaves_api WHERE substr(hash, 1, 8) = ?')
      .get(identificador);
    return existe !== undefined;
  }
}
