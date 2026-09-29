import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { abrirBanco } from '../../src/infrastructure/persistencia/sqlite/banco.js';
import { RepositorioChavesApiSqlite } from '../../src/infrastructure/persistencia/sqlite/RepositorioChavesApiSqlite.js';

const T0 = new Date('2026-09-22T12:00:00.000Z');

// 64 hex — o mesmo comprimento de um SHA-256 de verdade, embora o CONTEÚDO
// aqui seja só texto de teste. O que o repositório faz com isto é fatiar, e a
// fatia funciona igual independente de o valor ser um hash real.
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

describe('RepositorioChavesApiSqlite', () => {
  let db: DatabaseSync;
  let repo: RepositorioChavesApiSqlite;

  beforeEach(() => {
    db = abrirBanco(':memory:');
    repo = new RepositorioChavesApiSqlite(db);
  });

  afterEach(() => db.close());

  it('lista uma chave recém-criada com identificador e workspace derivados do hash', async () => {
    await repo.criar({ hash: HASH_A, rotulo: 'n8n', criadaEm: T0 });

    const [chave] = await repo.listar();

    expect(chave?.rotulo).toBe('n8n');
    expect(chave?.identificador).toBe(HASH_A.slice(0, 8));
    expect(chave?.workspace).toBe(HASH_A.slice(0, 16));
    expect(chave?.criadaEm).toEqual(T0);
    expect(chave?.revogadaEm).toBeUndefined();
  });

  it('nunca expõe o hash — só as fatias', async () => {
    await repo.criar({ hash: HASH_A, rotulo: 'n8n', criadaEm: T0 });
    const [chave] = await repo.listar();
    expect(chave).not.toHaveProperty('hash');
  });

  it('lista mais recente primeiro', async () => {
    await repo.criar({ hash: HASH_A, rotulo: 'primeira', criadaEm: T0 });
    await repo.criar({
      hash: HASH_B,
      rotulo: 'segunda',
      criadaEm: new Date(T0.getTime() + 1000),
    });

    const lista = await repo.listar();

    expect(lista.map((c) => c.rotulo)).toEqual(['segunda', 'primeira']);
  });

  it('ativaPorHash é verdadeiro para uma chave criada e não revogada', async () => {
    await repo.criar({ hash: HASH_A, rotulo: 'n8n', criadaEm: T0 });
    expect(await repo.ativaPorHash(HASH_A)).toBe(true);
  });

  it('ativaPorHash é falso para um hash que não existe', async () => {
    expect(await repo.ativaPorHash(HASH_A)).toBe(false);
  });

  it('ativaPorHash é falso depois de revogada', async () => {
    await repo.criar({ hash: HASH_A, rotulo: 'n8n', criadaEm: T0 });
    await repo.revogarPorIdentificador(HASH_A.slice(0, 8), T0);

    expect(await repo.ativaPorHash(HASH_A)).toBe(false);
  });

  it('revogarPorIdentificador marca revogadaEm e devolve true', async () => {
    await repo.criar({ hash: HASH_A, rotulo: 'n8n', criadaEm: T0 });

    const agora = new Date(T0.getTime() + 60_000);
    const resultado = await repo.revogarPorIdentificador(HASH_A.slice(0, 8), agora);

    expect(resultado).toBe(true);
    const [chave] = await repo.listar();
    expect(chave?.revogadaEm).toEqual(agora);
  });

  it('revogarPorIdentificador devolve false para um identificador desconhecido', async () => {
    const resultado = await repo.revogarPorIdentificador('deadbeef', T0);
    expect(resultado).toBe(false);
  });

  it('revogar de novo uma chave já revogada é idempotente (continua true)', async () => {
    await repo.criar({ hash: HASH_A, rotulo: 'n8n', criadaEm: T0 });
    await repo.revogarPorIdentificador(HASH_A.slice(0, 8), T0);

    const segunda = await repo.revogarPorIdentificador(HASH_A.slice(0, 8), T0);

    expect(segunda).toBe(true);
  });

  it('duas chaves com identificador de 8 hex diferente não se confundem na revogação', async () => {
    await repo.criar({ hash: HASH_A, rotulo: 'primeira', criadaEm: T0 });
    await repo.criar({ hash: HASH_B, rotulo: 'segunda', criadaEm: T0 });

    await repo.revogarPorIdentificador(HASH_A.slice(0, 8), T0);

    const lista = await repo.listar();
    const primeira = lista.find((c) => c.rotulo === 'primeira');
    const segunda = lista.find((c) => c.rotulo === 'segunda');
    expect(primeira?.revogadaEm).toBeDefined();
    expect(segunda?.revogadaEm).toBeUndefined();
  });
});
