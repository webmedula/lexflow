import { z } from 'zod';
import type { NivelLog } from '../../domain/ports/Logger.js';

/**
 * Configuração validada no arranque.
 *
 * Falhar cedo e alto: variável ausente ou fora do formato derruba o processo na
 * inicialização, com o nome da variável na mensagem. O modo caro de descobrir
 * que `DATAJUD_API_KEY` estava vazia é o 401 na consulta de um cliente.
 */

const booleano = z
  .string()
  .transform((v) => ['1', 'true', 'yes', 'sim'].includes(v.toLowerCase()));

function inteiroPositivo(padrao: number): z.ZodDefault<z.ZodNumber> {
  return z.coerce.number().int().positive().default(padrao);
}

const schema = z.object({
  LEXFLOW_PROVIDER_CHAIN: z.string().default('mock-crawler-tjsp,datajud'),

  DATAJUD_API_KEY: z.string().default(''),
  DATAJUD_BASE_URL: z
    .string()
    .url()
    .default('https://api-publica.datajud.cnj.jus.br'),
  // 60s: consulta fria no CNJ chega a 20s (medido). Ver DataJudAdapter.
  DATAJUD_TIMEOUT_MS: inteiroPositivo(60_000),
  DATAJUD_RATE_LIMIT_PER_MINUTE: inteiroPositivo(60),

  MOCK_CRAWLER_LATENCY_MS: z.coerce.number().int().min(0).default(120),
  MOCK_CRAWLER_FAILURE_RATE: z.coerce.number().min(0).max(1).default(0),

  CACHE_TTL_SECONDS: inteiroPositivo(900),
  CACHE_MAX_ENTRIES: inteiroPositivo(1000),
  CACHE_ENABLED: booleano.default('true'),

  LOG_LEVEL: z
    .enum(['debug', 'info', 'warn', 'error', 'silent'])
    .default('info'),

  // --- HTTP ---------------------------------------------------------------
  // 0.0.0.0 e não 127.0.0.1: dentro de um contêiner, escutar só em loopback
  // torna o serviço invisível para o proxy do Easypanel. É o erro nº 1 de quem
  // sobe app em contêiner pela primeira vez.
  HTTP_HOST: z.string().default('0.0.0.0'),
  HTTP_PORT: inteiroPositivo(3000),
  HTTP_BODY_LIMIT_BYTES: inteiroPositivo(65_536),
  /** Chaves aceitas no header x-api-key, separadas por vírgula. */
  LEXFLOW_API_KEYS: z.string().default(''),
  /** Escape explícito para rodar sem autenticação (só em rede interna). */
  LEXFLOW_AUTH_DISABLED: booleano.default('false'),
  RATE_LIMIT_MAX: inteiroPositivo(60),
  RATE_LIMIT_WINDOW_MS: inteiroPositivo(60_000),
  /** Confia em X-Forwarded-For. Ligado por padrão: atrás do Traefik do Easypanel. */
  HTTP_TRUST_PROXY: booleano.default('true'),
  /** Origens liberadas para CORS, separadas por vírgula. Vazio = CORS desligado. */
  CORS_ORIGINS: z.string().default(''),
});

export interface Config {
  readonly cadeiaDeProviders: readonly string[];
  readonly dataJud: {
    readonly apiKey: string;
    readonly baseUrl: string;
    readonly timeoutMs: number;
    readonly limitePorMinuto: number;
  };
  readonly mockCrawler: {
    readonly latenciaMs: number;
    readonly taxaDeFalha: number;
  };
  readonly cache: {
    readonly habilitado: boolean;
    readonly ttlSegundos: number;
    readonly maxEntradas: number;
  };
  readonly nivelLog: NivelLog;
  readonly http: {
    readonly host: string;
    readonly porta: number;
    readonly bodyLimitBytes: number;
    readonly chavesDeApi: readonly string[];
    readonly autenticacaoDesativada: boolean;
    readonly rateLimitMax: number;
    readonly rateLimitJanelaMs: number;
    readonly confiarNoProxy: boolean;
    readonly corsOrigins: readonly string[];
  };
}

export function carregarConfig(fonte: NodeJS.ProcessEnv = process.env): Config {
  const resultado = schema.safeParse(fonte);
  if (!resultado.success) {
    const detalhes = resultado.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Configuração inválida:\n${detalhes}`);
  }

  const env = resultado.data;
  return {
    cadeiaDeProviders: env.LEXFLOW_PROVIDER_CHAIN.split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    dataJud: {
      apiKey: env.DATAJUD_API_KEY,
      baseUrl: env.DATAJUD_BASE_URL,
      timeoutMs: env.DATAJUD_TIMEOUT_MS,
      limitePorMinuto: env.DATAJUD_RATE_LIMIT_PER_MINUTE,
    },
    mockCrawler: {
      latenciaMs: env.MOCK_CRAWLER_LATENCY_MS,
      taxaDeFalha: env.MOCK_CRAWLER_FAILURE_RATE,
    },
    cache: {
      habilitado: env.CACHE_ENABLED,
      ttlSegundos: env.CACHE_TTL_SECONDS,
      maxEntradas: env.CACHE_MAX_ENTRIES,
    },
    nivelLog: env.LOG_LEVEL,
    http: {
      host: env.HTTP_HOST,
      porta: env.HTTP_PORT,
      bodyLimitBytes: env.HTTP_BODY_LIMIT_BYTES,
      chavesDeApi: listaSeparadaPorVirgula(env.LEXFLOW_API_KEYS),
      autenticacaoDesativada: env.LEXFLOW_AUTH_DISABLED,
      rateLimitMax: env.RATE_LIMIT_MAX,
      rateLimitJanelaMs: env.RATE_LIMIT_WINDOW_MS,
      confiarNoProxy: env.HTTP_TRUST_PROXY,
      corsOrigins: listaSeparadaPorVirgula(env.CORS_ORIGINS),
    },
  };
}

function listaSeparadaPorVirgula(valor: string): string[] {
  return valor
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
