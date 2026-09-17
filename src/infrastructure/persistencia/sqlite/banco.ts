import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { paraBusca } from '../normalizacaoBusca.js';

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
     -- Nomes das partes, em MAIÚSCULAS, separados por " | ".
     --
     -- Desnormalizado pelo mesmo motivo de tribunal e classe: o filtro "quais
     -- processos são do meu cliente X" é o que o advogado mais faz numa
     -- carteira grande, e resolvê-lo com json_each sobre o processo inteiro
     -- significaria desserializar ~100 KB por linha a cada tecla digitada.
     -- Numa carteira de 2.000 processos isso é 200 MB de JSON por busca.
     partes_texto    TEXT,
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

  // A conta do assinante.
  //
  // `workspace` é gerado no cadastro e NUNCA muda: é a coluna que já separava
  // os dados por chave de API, e agora separa por conta. UNIQUE porque dois
  // assinantes com o mesmo workspace veriam os processos um do outro — é a
  // única falha aqui que não daria erro nenhum, só mostraria a carteira errada.
  //
  // `email` é UNIQUE e guardado já em minúsculas (ver `normalizarEmail`). Sem
  // normalizar antes, o UNIQUE do SQLite deixa passar `A@x.com` e `a@x.com`.
  //
  // `senha` guarda o hash scrypt COM os parâmetros — nunca a senha.
  `CREATE TABLE IF NOT EXISTS usuarios (
     id               TEXT PRIMARY KEY,
     email            TEXT NOT NULL UNIQUE,
     nome             TEXT NOT NULL,
     senha            TEXT NOT NULL,
     workspace        TEXT NOT NULL UNIQUE,
     oab              TEXT,
     uf_oab           TEXT,
     criado_em        TEXT NOT NULL,
     ultimo_acesso_em TEXT
   )`,

  // Sessões em DISCO, não em memória: o cache evapora no redeploy, e o LexFlow
  // é redeployado com frequência. Sessão em cache desconectaria todo mundo a
  // cada subida.
  //
  // A chave primária é o HASH do token. O token em si não existe no banco —
  // vazamento da tabela não vira sessão aberta na conta de ninguém.
  //
  // ON DELETE CASCADE: apagar a conta apaga as sessões junto. Sem isso ficaria
  // sessão órfã válida apontando para um usuário que não existe mais.
  `CREATE TABLE IF NOT EXISTS sessoes (
     hash_token  TEXT PRIMARY KEY,
     usuario_id  TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
     criada_em   TEXT NOT NULL,
     expira_em   TEXT NOT NULL
   )`,

  `CREATE INDEX IF NOT EXISTS idx_sessoes_usuario ON sessoes(usuario_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sessoes_expira ON sessoes(expira_em)`,
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
  migrarColunas(db);
  preencherPartesTexto(db);

  return db;
}

/**
 * Colunas acrescentadas depois que a tabela já existia em produção.
 *
 * `CREATE TABLE IF NOT EXISTS` não resolve isto: num banco que já tem a tabela,
 * ele não faz nada, e a coluna nova nunca aparece. E `ALTER TABLE ADD COLUMN`
 * estoura se a coluna já está lá — então a checagem no `PRAGMA table_info`
 * precede a alteração. Sem os dois passos, ou o deploy quebra ou a coluna
 * simplesmente não existe, e o sintoma aparece como "o filtro não acha nada".
 */
const COLUNAS_ACRESCENTADAS: ReadonlyArray<{
  readonly tabela: string;
  readonly coluna: string;
  readonly tipo: string;
}> = [{ tabela: 'acompanhamentos', coluna: 'partes_texto', tipo: 'TEXT' }];

function migrarColunas(db: DatabaseSync): void {
  for (const { tabela, coluna, tipo } of COLUNAS_ACRESCENTADAS) {
    const colunas = db.prepare(`PRAGMA table_info(${tabela})`).all() as Array<{
      name: string;
    }>;
    if (colunas.some((c) => c.name === coluna)) continue;
    db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${tipo}`);
  }
}

/**
 * Retrocarga das partes nos processos já guardados.
 *
 * Por que retrocarregar em vez de esperar a próxima varredura: sem isso o
 * filtro por parte encontraria apenas os processos sincronizados DEPOIS da
 * atualização, e ficaria calado sobre os outros. Mostrar subconjunto em
 * silêncio é justamente o que este projeto já pagou caro para aprender.
 *
 * **Por que em JavaScript e não em SQL puro**, que era a primeira versão: o
 * `upper()` do SQLite é ASCII-only. `upper('José')` devolve `JOSé`. A
 * retrocarga em SQL gravaria uma forma e as sincronizações seguintes outra, e o
 * filtro acharia uns nomes e não outros — sem erro nenhum. A normalização mora
 * em `paraBusca`, e é a MESMA usada na gravação e na consulta.
 *
 * Só toca linhas sem o campo, então na segunda subida não faz trabalho nenhum.
 * Numa carteira grande isso é uma passada única, no arranque, e não por
 * requisição.
 */
function preencherPartesTexto(db: DatabaseSync): void {
  const pendentes = db
    .prepare(
      `SELECT workspace, numero, processo FROM acompanhamentos
        WHERE partes_texto IS NULL AND processo IS NOT NULL`,
    )
    .all() as Array<{ workspace: string; numero: string; processo: string }>;
  if (pendentes.length === 0) return;

  const gravar = db.prepare(
    'UPDATE acompanhamentos SET partes_texto = ? WHERE workspace = ? AND numero = ?',
  );

  for (const linha of pendentes) {
    let nomes: string[] = [];
    try {
      const bruto = JSON.parse(linha.processo) as { partes?: Array<{ nome?: string }> };
      nomes = (bruto.partes ?? [])
        .map((p) => (p.nome ?? '').trim())
        .filter((n) => n.length > 0);
    } catch {
      // Linha com JSON corrompido não derruba o arranque do servidor inteiro.
      // Ela fica sem o campo e volta a ser candidata na próxima subida — e a
      // próxima sincronização do processo resolve de vez.
      continue;
    }
    // Grava string vazia, e não NULL, para um processo que realmente não tem
    // parte: NULL o traria de volta nesta consulta a cada arranque, para
    // sempre.
    gravar.run(nomes.length > 0 ? paraBusca(nomes.join(' | ')) : '', linha.workspace, linha.numero);
  }
}
