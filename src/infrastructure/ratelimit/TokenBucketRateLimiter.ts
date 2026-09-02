import type { Clock } from '../../domain/ports/Clock.js';
import { clockDoSistema } from '../../domain/ports/Clock.js';

export interface RateLimiter {
  /** Bloqueia até haver permissão para executar mais uma requisição. */
  adquirir(): Promise<void>;
  /** Consome um token se houver; nunca espera. */
  tentarAdquirir(): boolean;
}

export interface OpcoesTokenBucket {
  /** Requisições permitidas por janela. */
  readonly capacidade: number;
  /** Duração da janela em milissegundos. Padrão: 60s. */
  readonly janelaMs?: number;
  readonly clock?: Clock;
}

/**
 * Token bucket para autolimitar as chamadas às fontes externas.
 *
 * A API Pública do DataJud é gratuita e compartilhada por uma chave pública:
 * estourar a cota não derruba só a nossa consulta, derruba a de todo mundo que
 * usa a mesma chave — e o CNJ pode bloquear. Limitar do nosso lado é mais
 * barato do que descobrir o limite pelo 429.
 *
 * Reposição contínua (e não em blocos no virar da janela) porque em blocos o
 * serviço dispara uma rajada a cada minuto — exatamente o padrão que os
 * tribunais tratam como abuso.
 */
export class TokenBucketRateLimiter implements RateLimiter {
  private readonly capacidade: number;
  private readonly janelaMs: number;
  private readonly clock: Clock;
  private tokens: number;
  private ultimaReposicao: number;

  constructor(opcoes: OpcoesTokenBucket) {
    if (opcoes.capacidade <= 0) {
      throw new Error('capacidade do rate limiter deve ser maior que zero');
    }
    this.capacidade = opcoes.capacidade;
    this.janelaMs = opcoes.janelaMs ?? 60_000;
    this.clock = opcoes.clock ?? clockDoSistema;
    this.tokens = opcoes.capacidade;
    this.ultimaReposicao = this.clock.monotonico();
  }

  tentarAdquirir(): boolean {
    this.repor();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  async adquirir(): Promise<void> {
    // Laço em vez de um único sleep calculado: com várias corrotinas
    // concorrentes, o token liberado pode ser tomado por outra antes desta
    // acordar. Reavaliar é o que mantém o limite correto sob concorrência.
    for (;;) {
      if (this.tentarAdquirir()) return;
      await new Promise((resolve) => setTimeout(resolve, this.msAteProximoToken()));
    }
  }

  /** Tokens disponíveis agora — para métricas e teste. */
  get disponiveis(): number {
    this.repor();
    return Math.floor(this.tokens);
  }

  private repor(): void {
    const agora = this.clock.monotonico();
    const decorrido = agora - this.ultimaReposicao;
    if (decorrido <= 0) return;

    const taxaPorMs = this.capacidade / this.janelaMs;
    this.tokens = Math.min(this.capacidade, this.tokens + decorrido * taxaPorMs);
    this.ultimaReposicao = agora;
  }

  private msAteProximoToken(): number {
    const faltando = 1 - this.tokens;
    const taxaPorMs = this.capacidade / this.janelaMs;
    return Math.max(5, Math.ceil(faltando / taxaPorMs));
  }
}
