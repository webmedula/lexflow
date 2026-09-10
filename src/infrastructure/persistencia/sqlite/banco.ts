import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * Banco embutido, via `node:sqlite`.
 *
 * Escolhido em vez de `better-sqlite3` por um motivo concreto: nenhuma
 * dependência nativa. A imagem é Alpine, e compilar módulo nativo lá exige
 * python, make e g++ no estágio de build — mais tempo, mais superfície, mais
 * coisa para quebrar num deploy que já deu trabalho. `node:sqlite` vem no
 * runtime (estável a partir do Node 24, que é o que a imagem usa).
 *
 * Escolhido em vez de Postgres por enquanto porque é UMA instância: um arquivo
 * num volume resolve, sem serviço extra para subir e monitorar. Quando houver
 * mais de uma instância, é escrever outro repositório para a mesma porta.
 */

const ESQUEMA = [
  `CREATE TABLE IF NOT EXISTS acompanhamentos (
     workspace       TEXT NOT NULL,
     numero          TEXT NOT NULL,
     apelido         TEXT,
     criado_em       TEXT NOT NULL,
     sincronizado_em TEXT,
     erro            TEXT,
     processo        TEXT,
     -- Colunas desnormalizadas a partir do JSON do processo. Existem para que
     -- a lista filtre e ordene em SQL: com json_extract em cada linha, filtrar
     -- por tribunal viraria varredura completa a cada abertura da tela.
     tribunal        TEXT,
     classe          TEXT,
     ultima_mov_data TEXT,
     PRIMARY KEY (workspace, numero)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_acomp_ws_mov
     ON acompanhamentos (workspace, ultima_mov_data DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_acomp_sincronizar
     ON acompanhamentos (sincronizado_em)`,

  `CREATE TABLE IF NOT EXISTS novidades (
     id           INTEGER PRIMARY KEY AUTOINCREMENT,
     workspace    TEXT NOT NULL,
     numero       TEXT NOT NULL,
     data         TEXT NOT NULL,
     titulo       TEXT NOT NULL,
     codigo_tpu   INTEGER,
     conteudo     TEXT,
     tribunal     TEXT,
     detectada_em TEXT NOT NULL,
     vista_em     TEXT
   )`,
  // Idempotência da sincronização: rodar a varredura duas vezes não pode
  // duplicar aviso. É o índice, e não o código, que garante isso.
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_nov_unica
     ON novidades (workspace, numero, data, titulo)`,
  `CREATE INDEX IF NOT EXISTS idx_nov_feed
     ON novidades (workspace, detectada_em DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_nov_nao_vistas
     ON novidades (workspace, vista_em)`,

  // Inscrições da OAB sob vigilância contínua. A chave é (workspace, oab, uf)
  // e não um id: cadastrar a mesma inscrição duas vezes tem que ser a mesma
  // vigilância, não duas varreduras concorrentes contra a mesma fonte.
  `CREATE TABLE IF NOT EXISTS vigilancias_oab (
     workspace            TEXT NOT NULL,
     oab                  TEXT NOT NULL,
     uf                   TEXT NOT NULL,
     apelido              TEXT,
     criada_em            TEXT NOT NULL,
     varrida_em           TEXT,
     erro                 TEXT,
     processos_encontrados INTEGER NOT NULL DEFAULT 0,
     ativa                INTEGER NOT NULL DEFAULT 1,
     PRIMARY KEY (workspace, oab, uf)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_vig_varrer
     ON vigilancias_oab (ativa, varrida_em)`,

  `CREATE TABLE IF NOT EXISTS notificacoes (
     workspace        TEXT PRIMARY KEY,
     email            TEXT,
     ativa            INTEGER NOT NULL DEFAULT 0,
     ultimo_envio_em  TEXT,
     ultimo_alerta_em TEXT
   )`,

  // Credencial do advogado no tribunal, para as consultas que exigem
  // habilitação nos autos (peças, via MNI). A senha vai CIFRADA na coluna —
  // ver `infrastructure/seguranca/cofre.ts`. É o dado mais sensível do banco:
  // a chave de API só abre o LexFlow, esta abre o processo no tribunal.
  //
  // Uma credencial por (workspace, tribunal): o advogado tem uma inscrição por
  // sistema, e permitir duas criaria a dúvida de qual usar numa consulta — que
  // se resolveria testando as duas e colecionando recusa até bloquear a conta.
  `CREATE TABLE IF NOT EXISTS credenciais_tribunal (
     workspace     TEXT NOT NULL,
     tribunal      TEXT NOT NULL,
     identificacao TEXT NOT NULL,
     senha_cifrada TEXT NOT NULL,
     criada_em     TEXT NOT NULL,
     usada_em      TEXT,
     recusada_em   TEXT,
     PRIMARY KEY (workspace, tribunal)
   )`,

  // Chave-valor para marcas do sistema inteiro. Hoje guarda só quando a última
  // varredura terminou bem — o que sustenta o aviso de "faz X horas que não
  // consigo verificar". Precisa estar em disco: é depois de um redeploy que dá
  // para ficar horas sem varrer sem ninguém perceber.
  `CREATE TABLE IF NOT EXISTS estado (
     chave TEXT PRIMARY KEY,
     valor TEXT NOT NULL
   )`,
];

export function abrirBanco(caminho: string): DatabaseSync {
  if (caminho !== ':memory:') {
    mkdirSync(dirname(caminho), { recursive: true });
  }

  const db = new DatabaseSync(caminho);

  // WAL: leitura não bloqueia escrita. Importante porque a varredura em
  // segundo plano escreve enquanto alguém navega pela interface.
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  // Espera em vez de devolver SQLITE_BUSY na hora, para o caso raro de a
  // sincronização e uma requisição tentarem escrever ao mesmo tempo.
  db.exec('PRAGMA busy_timeout = 5000');

  for (const ddl of ESQUEMA) db.exec(ddl);

  return db;
}
