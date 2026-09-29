import { describe, expect, it } from 'vitest';
import { ServicoChavesApi } from '../../src/application/services/ServicoChavesApi.js';
import { ChaveApiNaoEncontradaError } from '../../src/domain/errors/index.js';
import type { ChavesDeApi } from '../../src/domain/ports/Criptografia.js';
import type {
  ChaveApiCadastrada,
  NovaChaveApi,
  RepositorioChavesApi,
} from '../../src/domain/ports/RepositorioChavesApi.js';

const AGORA = new Date('2026-09-22T12:00:00.000Z');

class RepoFalso implements RepositorioChavesApi {
  readonly linhas: NovaChaveApi[] = [];
  readonly revogadas = new Set<string>();

  async criar(dados: NovaChaveApi): Promise<void> {
    this.linhas.push(dados);
  }

  async listar(): Promise<readonly ChaveApiCadastrada[]> {
    return this.linhas
      .slice()
      .reverse()
      .map((l) => ({
        identificador: l.hash.slice(0, 8),
        workspace: l.hash.slice(0, 16),
        rotulo: l.rotulo,
        criadaEm: l.criadaEm,
        ...(this.revogadas.has(l.hash) ? { revogadaEm: AGORA } : {}),
      }));
  }

  async ativaPorHash(hash: string): Promise<boolean> {
    return this.linhas.some((l) => l.hash === hash) && !this.revogadas.has(hash);
  }

  async revogarPorIdentificador(identificador: string): Promise<boolean> {
    const linha = this.linhas.find((l) => l.hash.slice(0, 8) === identificador);
    if (!linha) return false;
    this.revogadas.add(linha.hash);
    return true;
  }
}

/**
 * Determinística: cada chamada de `gerar` devolve a próxima da lista, em
 * ordem. O "hash" inverte e embaralha a chave (nunca a contém como
 * substring) — o bastante para um teste de verdade em "o texto puro não vaza
 * para o que fica guardado", sem precisar de SHA-256 real aqui.
 */
function chavesFalsas(...sequencia: readonly string[]): ChavesDeApi {
  let indice = 0;
  return {
    gerar: () => {
      const chave = sequencia[indice];
      indice++;
      if (chave === undefined) throw new Error('sequência de chaves falsas esgotada');
      return chave;
    },
    hash: (chave) => embaralhar(chave).padEnd(32, '0'),
  };
}

/** `abc` -> `zyx` — some por trás de um shift de caractere, não de substring. */
function embaralhar(texto: string): string {
  return texto
    .split('')
    .map((c) => String.fromCharCode(c.charCodeAt(0) + 1))
    .join('');
}

describe('ServicoChavesApi', () => {
  it('emite uma chave, guarda só o hash, e devolve a chave em texto puro uma vez', async () => {
    const repo = new RepoFalso();
    const servico = new ServicoChavesApi({
      repositorio: repo,
      chaves: chavesFalsas('chave-um'),
      agora: () => AGORA,
    });

    const emitida = await servico.emitir('n8n');

    expect(emitida.chave).toBe('chave-um');
    expect(emitida.rotulo).toBe('n8n');
    expect(emitida.criadaEm).toBe(AGORA);
    // O identificador e o workspace são fatias do HASH, nunca da chave.
    const hashEsperado = embaralhar('chave-um').padEnd(32, '0');
    expect(emitida.identificador).toBe(hashEsperado.slice(0, 8));
    expect(emitida.workspace).toBe(hashEsperado.slice(0, 16));

    // A chave em texto puro nunca chega ao repositório.
    expect(repo.linhas).toHaveLength(1);
    expect(repo.linhas[0]?.hash).not.toContain('chave-um');
  });

  it('identificador e workspace saem do MESMO hash guardado, sem recalcular', async () => {
    const repo = new RepoFalso();
    const servico = new ServicoChavesApi({
      repositorio: repo,
      chaves: chavesFalsas('minha-chave'),
      agora: () => AGORA,
    });

    const emitida = await servico.emitir('script');
    const [listada] = await servico.listar();

    expect(listada?.identificador).toBe(emitida.identificador);
    expect(listada?.workspace).toBe(emitida.workspace);
  });

  it('listar nunca devolve a chave em texto puro nem o hash', async () => {
    const repo = new RepoFalso();
    const servico = new ServicoChavesApi({
      repositorio: repo,
      chaves: chavesFalsas('segredo-total'),
      agora: () => AGORA,
    });
    await servico.emitir('integração');

    const [listada] = await servico.listar();

    expect(listada).not.toHaveProperty('chave');
    expect(listada).not.toHaveProperty('hash');
  });

  it('revoga pelo identificador público', async () => {
    const repo = new RepoFalso();
    const servico = new ServicoChavesApi({
      repositorio: repo,
      chaves: chavesFalsas('chave-a-revogar'),
      agora: () => AGORA,
    });
    const emitida = await servico.emitir('temporária');

    await servico.revogar(emitida.identificador);

    const [listada] = await servico.listar();
    expect(listada?.revogadaEm).toEqual(AGORA);
  });

  it('recusa revogar um identificador que não existe', async () => {
    const servico = new ServicoChavesApi({
      repositorio: new RepoFalso(),
      chaves: chavesFalsas(),
    });

    await expect(servico.revogar('00000000')).rejects.toThrow(ChaveApiNaoEncontradaError);
  });

  it('emite chaves distintas em chamadas sucessivas', async () => {
    const repo = new RepoFalso();
    const servico = new ServicoChavesApi({
      repositorio: repo,
      chaves: chavesFalsas('primeira-chave', 'segunda-chave'),
      agora: () => AGORA,
    });

    const a = await servico.emitir('um');
    const b = await servico.emitir('dois');

    expect(a.identificador).not.toBe(b.identificador);
    expect(a.workspace).not.toBe(b.workspace);
  });
});
