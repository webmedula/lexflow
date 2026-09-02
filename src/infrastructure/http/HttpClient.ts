/**
 * Cliente HTTP mínimo sobre o `fetch` nativo do Node (>= 18), com timeout e
 * retry com backoff exponencial + jitter.
 *
 * Sem axios/undici de propósito: a única coisa que faltava ao fetch nativo era
 * política de timeout e retry, e essa política é decisão do projeto — não de
 * uma dependência. O jitter evita que várias instâncias do serviço retentem em
 * uníssono contra um tribunal já sobrecarregado.
 */

export interface OpcoesHttpClient {
  readonly timeoutMs?: number;
  readonly tentativas?: number;
  readonly backoffInicialMs?: number;
  readonly headersPadrao?: Readonly<Record<string, string>>;
}

export interface RespostaHttp {
  readonly status: number;
  readonly ok: boolean;
  readonly corpo: string;
}

export class HttpTimeoutError extends Error {
  constructor(readonly url: string, readonly timeoutMs: number) {
    super(`Timeout de ${timeoutMs}ms ao chamar ${url}`);
    this.name = 'HttpTimeoutError';
  }
}

export class HttpRedeError extends Error {
  constructor(readonly url: string, causa: unknown) {
    super(`Falha de rede ao chamar ${url}: ${descrever(causa)}`, { cause: causa });
    this.name = 'HttpRedeError';
  }
}

export class HttpClient {
  private readonly timeoutMs: number;
  private readonly tentativas: number;
  private readonly backoffInicialMs: number;
  private readonly headersPadrao: Record<string, string>;

  constructor(opcoes: OpcoesHttpClient = {}) {
    this.timeoutMs = opcoes.timeoutMs ?? 10_000;
    this.tentativas = Math.max(1, opcoes.tentativas ?? 3);
    this.backoffInicialMs = opcoes.backoffInicialMs ?? 300;
    this.headersPadrao = { ...opcoes.headersPadrao };
  }

  async postJson(
    url: string,
    corpo: unknown,
    headers: Record<string, string> = {},
  ): Promise<RespostaHttp> {
    return this.executar(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...this.headersPadrao,
        ...headers,
      },
      body: JSON.stringify(corpo),
    });
  }

  async get(
    url: string,
    headers: Record<string, string> = {},
  ): Promise<RespostaHttp> {
    return this.executar(url, {
      method: 'GET',
      headers: { accept: 'application/json', ...this.headersPadrao, ...headers },
    });
  }

  private async executar(url: string, init: RequestInit): Promise<RespostaHttp> {
    let ultimoErro: unknown;

    for (let tentativa = 1; tentativa <= this.tentativas; tentativa++) {
      try {
        const resposta = await this.umaTentativa(url, init);

        // 5xx e 429 são transitórios: vale retentar. 4xx (exceto 429) é erro
        // nosso — retentar só queima cota.
        if (resposta.status >= 500 || resposta.status === 429) {
          ultimoErro = new Error(`HTTP ${resposta.status}`);
          if (tentativa < this.tentativas) {
            await this.esperar(tentativa);
            continue;
          }
        }
        return resposta;
      } catch (erro) {
        ultimoErro = erro;
        if (tentativa < this.tentativas) {
          await this.esperar(tentativa);
          continue;
        }
      }
    }

    if (ultimoErro instanceof HttpTimeoutError) throw ultimoErro;
    throw new HttpRedeError(url, ultimoErro);
  }

  private async umaTentativa(url: string, init: RequestInit): Promise<RespostaHttp> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const resposta = await fetch(url, { ...init, signal: controller.signal });
      return {
        status: resposta.status,
        ok: resposta.ok,
        corpo: await resposta.text(),
      };
    } catch (erro) {
      if (erro instanceof Error && erro.name === 'AbortError') {
        throw new HttpTimeoutError(url, this.timeoutMs);
      }
      throw erro;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Backoff exponencial com jitter completo. */
  private esperar(tentativa: number): Promise<void> {
    const teto = this.backoffInicialMs * 2 ** (tentativa - 1);
    const atraso = Math.random() * teto;
    return new Promise((resolve) => setTimeout(resolve, atraso));
  }
}

function descrever(erro: unknown): string {
  if (erro instanceof Error) return erro.message;
  return String(erro);
}
