import type { Cache } from '../../domain/ports/Cache.js';
import type { Clock } from '../../domain/ports/Clock.js';
import { clockDoSistema } from '../../domain/ports/Clock.js';

interface Entrada<T> {
  readonly valor: T;
  readonly expiraEm: number;
}

export interface OpcoesInMemoryCache {
  readonly ttlPadraoSegundos?: number;
  readonly maxEntradas?: number;
  readonly clock?: Clock;
}

/**
 * Cache em memória com TTL e despejo LRU.
 *
 * Serve ao processo único do MVP. Quando houver mais de uma instância, troque
 * por um `RedisCache` implementando a mesma porta `Cache` — o resto do sistema
 * não fica sabendo.
 *
 * Map do JS preserva a ordem de inserção, e é isso que dá o LRU de graça:
 * reinserir no `get` move a chave para o fim, então a primeira chave do Map é
 * sempre a menos usada recentemente.
 */
export class InMemoryCache implements Cache {
  private readonly entradas = new Map<string, Entrada<unknown>>();
  private readonly ttlPadraoMs: number;
  private readonly maxEntradas: number;
  private readonly clock: Clock;

  private acertos = 0;
  private erros = 0;

  constructor(opcoes: OpcoesInMemoryCache = {}) {
    this.ttlPadraoMs = (opcoes.ttlPadraoSegundos ?? 900) * 1000;
    this.maxEntradas = opcoes.maxEntradas ?? 1000;
    this.clock = opcoes.clock ?? clockDoSistema;
  }

  async get<T>(chave: string): Promise<T | undefined> {
    const entrada = this.entradas.get(chave);
    if (!entrada) {
      this.erros++;
      return undefined;
    }

    if (entrada.expiraEm <= this.clock.agora().getTime()) {
      this.entradas.delete(chave);
      this.erros++;
      return undefined;
    }

    this.entradas.delete(chave);
    this.entradas.set(chave, entrada);
    this.acertos++;
    return entrada.valor as T;
  }

  async set<T>(chave: string, valor: T, ttlSegundos?: number): Promise<void> {
    const ttlMs = ttlSegundos !== undefined ? ttlSegundos * 1000 : this.ttlPadraoMs;

    if (!this.entradas.has(chave) && this.entradas.size >= this.maxEntradas) {
      const maisAntiga = this.entradas.keys().next().value;
      if (maisAntiga !== undefined) this.entradas.delete(maisAntiga);
    }

    this.entradas.delete(chave);
    this.entradas.set(chave, {
      valor,
      expiraEm: this.clock.agora().getTime() + ttlMs,
    });
  }

  async delete(chave: string): Promise<void> {
    this.entradas.delete(chave);
  }

  async clear(): Promise<void> {
    this.entradas.clear();
    this.acertos = 0;
    this.erros = 0;
  }

  get estatisticas(): { acertos: number; erros: number; tamanho: number } {
    return { acertos: this.acertos, erros: this.erros, tamanho: this.entradas.size };
  }
}
