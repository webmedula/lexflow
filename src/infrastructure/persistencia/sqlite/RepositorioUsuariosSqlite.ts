import { randomBytes, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { Usuario } from '../../../domain/entities/Usuario.js';
import { EmailJaCadastradoError } from '../../../domain/errors/index.js';
import type {
  NovoUsuario,
  PerfilEditavel,
  RepositorioUsuarios,
  SenhaGuardada,
} from '../../../domain/ports/RepositorioUsuarios.js';

interface LinhaUsuario {
  id: string;
  email: string;
  nome: string;
  senha: string;
  workspace: string;
  oab: string | null;
  uf_oab: string | null;
  criado_em: string;
  ultimo_acesso_em: string | null;
}

function paraUsuario(l: LinhaUsuario): Usuario {
  return new Usuario({
    id: l.id,
    email: l.email,
    nome: l.nome,
    workspace: l.workspace,
    criadoEm: new Date(l.criado_em),
    ...(l.oab ? { oab: l.oab } : {}),
    ...(l.uf_oab ? { ufOab: l.uf_oab } : {}),
    ...(l.ultimo_acesso_em ? { ultimoAcessoEm: new Date(l.ultimo_acesso_em) } : {}),
  });
}

/**
 * Identificador do ambiente do assinante: 16 bytes aleatórios em hex.
 *
 * Aleatório, e não derivado do e-mail nem do id. Derivar do e-mail deixaria
 * qualquer um calcular o workspace alheio a partir de um endereço conhecido, e
 * amarraria o ambiente a um campo que a pessoa pode querer trocar.
 *
 * O mesmo formato de 32 hex que `workspaceDaChave` produz? Não: aquele tem 16.
 * Aqui é o dobro, porque estes são criados por qualquer um que se cadastre, e o
 * espaço precisa ser grande o suficiente para colisão ser impensável — colisão
 * aqui mistura a carteira de dois advogados, sem erro nenhum aparecer.
 */
function novoWorkspace(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Contas e sessões em SQLite.
 *
 * Duas coisas que este repositório nunca faz:
 *
 * 1. **Não escreve senha nem token em log.** Nem em `debug`. É o vazamento que
 *    passa em auditoria porque parece inofensivo na linha em que é escrito.
 * 2. **Não devolve `Usuario` com hash de senha dentro.** A senha sai por um
 *    campo separado, só em `porEmail`, que é o único caminho que precisa dela.
 *    Assim nenhum `JSON.stringify(usuario)` distraído despeja hash em resposta.
 */
export class RepositorioUsuariosSqlite implements RepositorioUsuarios {
  constructor(private readonly db: DatabaseSync) {}

  async criar(novo: NovoUsuario): Promise<Usuario> {
    const id = randomUUID();
    const agora = new Date().toISOString();
    const workspace = novoWorkspace();

    try {
      this.db
        .prepare(
          `INSERT INTO usuarios (id, email, nome, senha, workspace, criado_em)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(id, novo.email, novo.nome, novo.senhaGuardada, workspace, agora);
    } catch (erro) {
      // O UNIQUE do e-mail é a trava de verdade contra cadastro duplicado.
      // Checar antes com um SELECT não basta: entre o SELECT e o INSERT cabe
      // outra requisição, e duas pessoas clicando junto criariam duas contas.
      if (violouUnicidade(erro)) throw new EmailJaCadastradoError();
      throw erro;
    }

    const criado = await this.porId(id);
    if (!criado) throw new Error('conta recém-criada não foi encontrada');
    return criado;
  }

  async porEmail(
    email: string,
  ): Promise<{ usuario: Usuario; senha: SenhaGuardada } | undefined> {
    const linha = this.db
      .prepare('SELECT * FROM usuarios WHERE email = ?')
      .get(email) as unknown as LinhaUsuario | undefined;
    if (!linha) return undefined;
    return { usuario: paraUsuario(linha), senha: linha.senha };
  }

  async porId(id: string): Promise<Usuario | undefined> {
    const linha = this.db
      .prepare('SELECT * FROM usuarios WHERE id = ?')
      .get(id) as unknown as LinhaUsuario | undefined;
    return linha ? paraUsuario(linha) : undefined;
  }

  async atualizarPerfil(id: string, perfil: PerfilEditavel): Promise<Usuario> {
    // COALESCE: campo ausente mantém o que está lá. Sem isso, um PATCH que
    // manda só a OAB apagaria o nome da pessoa.
    this.db
      .prepare(
        `UPDATE usuarios
            SET nome   = COALESCE(?, nome),
                oab    = COALESCE(?, oab),
                uf_oab = COALESCE(?, uf_oab)
          WHERE id = ?`,
      )
      .run(perfil.nome ?? null, perfil.oab ?? null, perfil.ufOab ?? null, id);

    const atualizado = await this.porId(id);
    if (!atualizado) throw new Error(`conta ${id} não encontrada`);
    return atualizado;
  }

  async trocarSenha(id: string, senhaGuardada: SenhaGuardada): Promise<void> {
    this.db.prepare('UPDATE usuarios SET senha = ? WHERE id = ?').run(senhaGuardada, id);
    // Qualquer link de recuperação pendente morre junto. Quem acabou de trocar
    // a senha não quer um e-mail antigo servindo de porta dos fundos — e é
    // justamente quem desconfia de invasão que troca a senha.
    this.db
      .prepare(
        'UPDATE recuperacoes_senha SET usada_em = ? WHERE usuario_id = ? AND usada_em IS NULL',
      )
      .run(new Date().toISOString(), id);
  }

  async registrarAcesso(id: string): Promise<void> {
    this.db
      .prepare('UPDATE usuarios SET ultimo_acesso_em = ? WHERE id = ?')
      .run(new Date().toISOString(), id);
  }

  async abrirSessao(
    hashDoToken: string,
    usuarioId: string,
    expiraEm: Date,
  ): Promise<void> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO sessoes (hash_token, usuario_id, criada_em, expira_em)
         VALUES (?, ?, ?, ?)`,
      )
      .run(hashDoToken, usuarioId, new Date().toISOString(), expiraEm.toISOString());
  }

  async usuarioDaSessao(hashDoToken: string): Promise<Usuario | undefined> {
    // A expiração é conferida no SQL, junto da busca. Trazer a linha e comparar
    // em JavaScript funcionaria igual até alguém esquecer a comparação num
    // caminho novo — e aí sessão vencida volta a valer sem nada denunciar.
    const linha = this.db
      .prepare(
        `SELECT u.* FROM sessoes s
           JOIN usuarios u ON u.id = s.usuario_id
          WHERE s.hash_token = ? AND s.expira_em > ?`,
      )
      .get(hashDoToken, new Date().toISOString()) as unknown as LinhaUsuario | undefined;
    return linha ? paraUsuario(linha) : undefined;
  }

  async encerrarSessao(hashDoToken: string): Promise<void> {
    this.db.prepare('DELETE FROM sessoes WHERE hash_token = ?').run(hashDoToken);
  }

  async encerrarSessoesDe(usuarioId: string): Promise<void> {
    this.db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(usuarioId);
  }

  async abrirRecuperacao(
    hashDoToken: string,
    usuarioId: string,
    expiraEm: Date,
  ): Promise<void> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO recuperacoes_senha
           (hash_token, usuario_id, criada_em, expira_em)
         VALUES (?, ?, ?, ?)`,
      )
      .run(hashDoToken, usuarioId, new Date().toISOString(), expiraEm.toISOString());
  }

  /**
   * Confere e marca como usado NUMA TRANSAÇÃO SÓ.
   *
   * O `UPDATE ... WHERE usada_em IS NULL` seguido de `changes` é o que dá a
   * garantia de uso único: duas requisições com o mesmo link disputam a mesma
   * linha, e apenas uma vê `changes = 1`. Conferir e marcar em passos separados
   * deixaria a segunda passar enquanto a primeira ainda não gravou.
   */
  async consumirRecuperacao(hashDoToken: string): Promise<Usuario | undefined> {
    const agora = new Date().toISOString();
    const r = this.db
      .prepare(
        `UPDATE recuperacoes_senha SET usada_em = ?
          WHERE hash_token = ? AND usada_em IS NULL AND expira_em > ?`,
      )
      .run(agora, hashDoToken, agora);
    if (Number(r.changes) !== 1) return undefined;

    const linha = this.db
      .prepare(
        `SELECT u.* FROM recuperacoes_senha r
           JOIN usuarios u ON u.id = r.usuario_id
          WHERE r.hash_token = ?`,
      )
      .get(hashDoToken) as unknown as LinhaUsuario | undefined;
    return linha ? paraUsuario(linha) : undefined;
  }

  async contarRecuperacoesRecentes(usuarioId: string, desde: Date): Promise<number> {
    const r = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM recuperacoes_senha
          WHERE usuario_id = ? AND criada_em >= ?`,
      )
      .get(usuarioId, desde.toISOString()) as unknown as { n: number };
    return Number(r.n);
  }

  async limparSessoesExpiradas(): Promise<number> {
    const r = this.db
      .prepare('DELETE FROM sessoes WHERE expira_em <= ?')
      .run(new Date().toISOString());
    return Number(r.changes);
  }
}

function violouUnicidade(erro: unknown): boolean {
  return erro instanceof Error && /UNIQUE constraint failed/i.test(erro.message);
}
