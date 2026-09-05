import type { DatabaseSync } from 'node:sqlite';
import type {
  PreferenciaNotificacao,
  RepositorioNotificacao,
} from '../../../domain/ports/RepositorioNotificacao.js';

const CHAVE_VARREDURA_OK = 'ultima_varredura_ok';

interface LinhaNotificacao {
  workspace: string;
  email: string | null;
  ativa: number;
  ultimo_envio_em: string | null;
  ultimo_alerta_em: string | null;
}

function paraDominio(l: LinhaNotificacao): PreferenciaNotificacao {
  return {
    workspace: l.workspace,
    ativa: l.ativa === 1,
    ...(l.email ? { email: l.email } : {}),
    ...(l.ultimo_envio_em ? { ultimoEnvioEm: new Date(l.ultimo_envio_em) } : {}),
    ...(l.ultimo_alerta_em ? { ultimoAlertaEm: new Date(l.ultimo_alerta_em) } : {}),
  };
}

export class RepositorioNotificacaoSqlite implements RepositorioNotificacao {
  constructor(private readonly db: DatabaseSync) {}

  async obter(workspace: string): Promise<PreferenciaNotificacao> {
    const linha = this.db
      .prepare('SELECT * FROM notificacoes WHERE workspace = ?')
      .get(workspace) as unknown as LinhaNotificacao | undefined;
    // Ausência é resposta válida — significa "nunca configurou" — e não um
    // erro. Devolver o padrão desligado evita `undefined` em todo chamador.
    return linha ? paraDominio(linha) : { workspace, ativa: false };
  }

  async salvar(
    workspace: string,
    email: string | undefined,
    ativa: boolean,
  ): Promise<PreferenciaNotificacao> {
    const endereco = email?.trim() || null;
    this.db
      .prepare(
        `INSERT INTO notificacoes (workspace, email, ativa) VALUES (?, ?, ?)
         ON CONFLICT (workspace) DO UPDATE SET email = excluded.email, ativa = excluded.ativa`,
      )
      // Ligar o aviso sem endereço é uma configuração que nunca vai avisar
      // ninguém e ainda passa sensação de estar protegido. Sem endereço, fica
      // desligada.
      .run(workspace, endereco, endereco && ativa ? 1 : 0);
    return this.obter(workspace);
  }

  async listarAtivas(): Promise<PreferenciaNotificacao[]> {
    const linhas = this.db
      .prepare(
        `SELECT * FROM notificacoes WHERE ativa = 1 AND email IS NOT NULL AND email <> ''`,
      )
      .all() as unknown as LinhaNotificacao[];
    return linhas.map(paraDominio);
  }

  async registrarEnvio(workspace: string, quando: Date): Promise<void> {
    this.db
      .prepare('UPDATE notificacoes SET ultimo_envio_em = ? WHERE workspace = ?')
      .run(quando.toISOString(), workspace);
  }

  async registrarAlerta(workspace: string, quando: Date): Promise<void> {
    this.db
      .prepare('UPDATE notificacoes SET ultimo_alerta_em = ? WHERE workspace = ?')
      .run(quando.toISOString(), workspace);
  }

  async registrarVarreduraOk(quando: Date): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO estado (chave, valor) VALUES (?, ?)
         ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor`,
      )
      .run(CHAVE_VARREDURA_OK, quando.toISOString());
  }

  async ultimaVarreduraOk(): Promise<Date | undefined> {
    const linha = this.db
      .prepare('SELECT valor FROM estado WHERE chave = ?')
      .get(CHAVE_VARREDURA_OK) as unknown as { valor: string } | undefined;
    return linha ? new Date(linha.valor) : undefined;
  }
}
