import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { abrirBanco } from '../../src/infrastructure/persistencia/sqlite/banco.js';

/*
 * Aconteceu em produção, no deploy da v0.18.0.
 *
 * A renomeação trocou o caminho padrão do banco no Dockerfile, de
 * `/dados/lexflow.db` para `/dados/processovivo.db`. Quem não declarava o
 * caminho no painel herdava o padrão da imagem: o SQLite criou um arquivo novo
 * e vazio, o serviço subiu saudável, o health check passou — e o assinante
 * entrou numa carteira em branco, com os dados dele intactos no arquivo ao
 * lado, invisíveis. Nada produziu erro.
 *
 * Entre subir vazio e não subir, não subir.
 */
describe('banco — não sobe vazio quando o banco antigo está ao lado', () => {
  let pasta: string;

  beforeEach(() => {
    pasta = mkdtempSync(join(tmpdir(), 'processovivo-banco-'));
  });
  afterEach(() => {
    rmSync(pasta, { recursive: true, force: true });
    delete process.env['PROCESSOVIVO_BANCO_NOVO'];
  });

  /** Cria um banco no nome antigo, com dado dentro. */
  function bancoAntigoComDados(): string {
    const antigo = join(pasta, 'lexflow.db');
    const db = abrirBanco(antigo);
    db.prepare(
      `INSERT INTO usuarios (id, email, nome, senha, workspace, criado_em)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('u1', 'ana@a.com.br', 'Ana', 'scrypt$x', 'ws1', new Date().toISOString());
    db.close();
    return antigo;
  }

  it('recusa abrir e diz exatamente o que fazer', () => {
    const antigo = bancoAntigoComDados();
    const novo = join(pasta, 'processovivo.db');

    expect(() => abrirBanco(novo)).toThrow(/banco antigo com dados/i);

    // A mensagem precisa carregar os dois caminhos e as saídas. Um erro que diz
    // "falhou" obriga quem está no meio de um deploy a ir procurar — e é nessa
    // hora que alguém aponta para o arquivo errado.
    try {
      abrirBanco(novo);
    } catch (erro) {
      const texto = (erro as Error).message;
      expect(texto).toContain(antigo);
      expect(texto).toContain(novo);
      expect(texto).toContain('PROCESSOVIVO_DB_PATH=' + antigo);
      expect(texto).toContain('PROCESSOVIVO_BANCO_NOVO=true');
    }
  });

  it('deixa passar quando quem opera declara que o banco novo é proposital', () => {
    bancoAntigoComDados();
    process.env['PROCESSOVIVO_BANCO_NOVO'] = 'true';

    const db = abrirBanco(join(pasta, 'processovivo.db'));
    const n = db.prepare('SELECT COUNT(*) AS n FROM usuarios').get() as unknown as {
      n: number;
    };
    expect(n.n).toBe(0);
    db.close();
  });

  it('continua recusando no SEGUNDO arranque, com o arquivo vazio já criado', () => {
    /*
     * O caso que de fato aconteceu, e o que torna a proteção útil.
     *
     * No primeiro deploy o SQLite cria o arquivo. A partir daí ele EXISTE, e
     * uma proteção que só olhasse a existência ficaria calada exatamente em
     * quem já tropeçou — que é quem mais precisa do aviso. Por isso a segunda
     * passagem pergunta ao banco se ele tem conteúdo, em vez de perguntar ao
     * sistema de arquivos se ele existe.
     */
    bancoAntigoComDados();
    const novo = join(pasta, 'processovivo.db');

    // Primeiro arranque, "de propósito": cria o arquivo vazio.
    process.env['PROCESSOVIVO_BANCO_NOVO'] = 'true';
    abrirBanco(novo).close();
    delete process.env['PROCESSOVIVO_BANCO_NOVO'];

    // Segundo arranque, sem a permissão: o arquivo existe, mas está vazio.
    expect(() => abrirBanco(novo)).toThrow(/banco antigo com dados/i);
  });

  it('não reclama quando o banco configurado tem dados', () => {
    // O caso normal de todo arranque depois do primeiro, num sistema saudável.
    bancoAntigoComDados();
    const novo = join(pasta, 'processovivo.db');

    process.env['PROCESSOVIVO_BANCO_NOVO'] = 'true';
    const db = abrirBanco(novo);
    db.prepare(
      `INSERT INTO usuarios (id, email, nome, senha, workspace, criado_em)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('u2', 'bia@b.com.br', 'Bia', 'scrypt$x', 'ws2', new Date().toISOString());
    db.close();
    delete process.env['PROCESSOVIVO_BANCO_NOVO'];

    expect(() => abrirBanco(novo).close()).not.toThrow();
  });

  it('ignora um banco antigo que também está vazio', () => {
    // Sem dado a resgatar, travar o arranque seria só estorvo.
    abrirBanco(join(pasta, 'lexflow.db')).close();

    expect(() => abrirBanco(join(pasta, 'processovivo.db')).close()).not.toThrow();
  });

  it('não reclama numa instalação nova, em pasta vazia', () => {
    expect(() => abrirBanco(join(pasta, 'processovivo.db')).close()).not.toThrow();
  });

  it('ignora um arquivo antigo de tamanho zero', () => {
    // Um `touch` deixado para trás não é banco, e travar o arranque por causa
    // dele seria transformar a proteção em estorvo.
    writeFileSync(join(pasta, 'lexflow.db'), '');

    expect(() => abrirBanco(join(pasta, 'processovivo.db')).close()).not.toThrow();
  });

  it('não atrapalha banco em memória', () => {
    expect(() => abrirBanco(':memory:').close()).not.toThrow();
  });
});
