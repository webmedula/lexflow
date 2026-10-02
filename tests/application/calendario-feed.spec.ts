import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ServicoCalendario,
  iguaisEmTempoConstante,
} from '../../src/application/services/ServicoCalendario.js';
import { FeedDoCalendarioNaoEncontradoError } from '../../src/domain/errors/index.js';
import { loggerSilencioso } from '../../src/infrastructure/logging/ConsoleLogger.js';
import { abrirBanco } from '../../src/infrastructure/persistencia/sqlite/banco.js';
import { RepositorioAcompanhamentosSqlite } from '../../src/infrastructure/persistencia/sqlite/RepositorioAcompanhamentosSqlite.js';
import { RepositorioDeEventosSqlite } from '../../src/infrastructure/persistencia/sqlite/RepositorioDeEventosSqlite.js';
import {
  hashDoToken,
  tokensDeSessao,
} from '../../src/infrastructure/seguranca/sessao.js';

const AGORA = new Date('2026-10-02T15:00:00.000Z');

describe('feed do calendário — o token', () => {
  let db: ReturnType<typeof abrirBanco>;
  let servico: ServicoCalendario;
  beforeEach(() => {
    db = abrirBanco(':memory:');
    servico = new ServicoCalendario({
      eventos: new RepositorioDeEventosSqlite(db),
      acompanhamentos: new RepositorioAcompanhamentosSqlite(db),
      tokens: tokensDeSessao,
      logger: loggerSilencioso,
      gerarId: () => randomUUID(),
      agora: () => AGORA,
    });
  });
  afterEach(() => db.close());

  it('32 bytes aleatórios; no banco, só o SHA-256 — o token em claro não está em lugar nenhum', async () => {
    const { token } = await servico.criarFeed('A', false);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);

    const linhas = db.prepare('SELECT * FROM calendario_feeds').all();
    const despejo = JSON.stringify(linhas);
    expect(despejo).not.toContain(token);
    expect(despejo).toContain(hashDoToken(token));

    // E em nenhuma outra tabela.
    const tabelas = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    for (const { name } of tabelas) {
      expect(JSON.stringify(db.prepare(`SELECT * FROM ${name}`).all())).not.toContain(
        token,
      );
    }
  });

  it('o token de A só abre a agenda de A', async () => {
    const a = await servico.criarFeed('A', false);
    const b = await servico.criarFeed('B', false);
    expect(a.token).not.toBe(b.token);
    await expect(servico.eventosDoFeed(a.token)).resolves.toBeDefined();
    await expect(servico.eventosDoFeed(`${a.token}x`)).rejects.toThrow(
      FeedDoCalendarioNaoEncontradoError,
    );
  });

  it('comparação em tempo constante: compara tudo, sem sair no primeiro byte diferente', () => {
    expect(iguaisEmTempoConstante('abc', 'abc')).toBe(true);
    expect(iguaisEmTempoConstante('abc', 'abd')).toBe(false);
    expect(iguaisEmTempoConstante('abc', 'xbc')).toBe(false);
    expect(iguaisEmTempoConstante('abc', 'abcd')).toBe(false);
  });
});
