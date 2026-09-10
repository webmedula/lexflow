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
  /**
   * Ordem das fontes. O DataJud vem primeiro porque só ele tem a linha do tempo
   * COMPLETA e a data de distribuição; o DJEN entra logo atrás e completa com
   * partes, advogados e inteiro teor. O mock não está no padrão: em produção ele
   * inventaria processo.
   *
   * Sem DATAJUD_API_KEY a cadeia degrada sozinha para só o DJEN — que não exige
   * chave nenhuma. É de propósito: o sistema sobe e funciona sem configuração.
   */
  LEXFLOW_PROVIDER_CHAIN: z.string().default('datajud,djen'),

  DATAJUD_API_KEY: z.string().default(''),
  DATAJUD_BASE_URL: z
    .string()
    .url()
    .default('https://api-publica.datajud.cnj.jus.br'),
  // 60s: consulta fria no CNJ chega a 20s (medido). Ver DataJudAdapter.
  DATAJUD_TIMEOUT_MS: inteiroPositivo(60_000),
  DATAJUD_RATE_LIMIT_PER_MINUTE: inteiroPositivo(60),

  DJEN_BASE_URL: z.string().url().default('https://comunicaapi.pje.jus.br'),
  // 20s: latência medida foi de 185ms a 993ms. Ver DjenAdapter.
  DJEN_TIMEOUT_MS: inteiroPositivo(20_000),
  DJEN_RATE_LIMIT_PER_MINUTE: inteiroPositivo(60),
  // Teto de publicações lidas numa busca por OAB. 500 cobre meses de atividade.
  DJEN_MAX_COMUNICACOES_POR_OAB: inteiroPositivo(500),

  // Vigilância por OAB: varre de HORA em hora, contra as 12h da varredura de
  // processos. Pode, porque só toca o DJEN — 200ms por consulta e sem chave.
  // É onde estão as publicações que abrem prazo, então velocidade aqui é prazo.
  VIGILANCIA_INTERVALO_HORAS: z.coerce.number().min(0).default(1),
  VIGILANCIA_MAXIMO_POR_VARREDURA: inteiroPositivo(50),
  VIGILANCIA_PAUSA_MS: z.coerce.number().int().min(0).default(1000),

  // Notificação. Sem SMTP_HOST o sistema usa o notificador de log: exercita o
  // caminho inteiro e mostra no log o que teria saído.
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: inteiroPositivo(587),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  SMTP_SECURE: z.enum(['true', 'false']).default('false'),
  SMTP_FROM: z.string().default(''),
  /** Endereço público, usado nos links do e-mail. */
  LEXFLOW_URL_BASE: z.string().default(''),
  // Silêncio tolerado antes de avisar que a verificação parou. 26h e não 24h
  // para não disparar por causa de uma varredura que atrasou alguns minutos.
  NOTIFICACAO_HORAS_ATE_ALERTAR: inteiroPositivo(26),

  MOCK_CRAWLER_LATENCY_MS: z.coerce.number().int().min(0).default(120),
  MOCK_CRAWLER_FAILURE_RATE: z.coerce.number().min(0).max(1).default(0),

  CACHE_TTL_SECONDS: inteiroPositivo(900),
  CACHE_MAX_ENTRIES: inteiroPositivo(1000),
  CACHE_ENABLED: booleano.default('true'),

  LOG_LEVEL: z
    .enum(['debug', 'info', 'warn', 'error', 'silent'])
    .default('info'),

  // --- Peças do processo (MNI) ----------------------------------------------
  // O MNI é o único caminho para as PEÇAS (petição, contestação, laudo) — o
  // DJEN publica ato judicial e o DataJud não tem documento nenhum.
  //
  // Endpoint do Projudi/TJGO. NÃO é o caminho `/intercomunicacao` do PJe: nesse
  // o Projudi responde 404, o que já levou à conclusão errada de que o TJGO não
  // tinha MNI.
  MNI_ENDPOINT: z
    .string()
    .url()
    .default('https://projudi.tjgo.jus.br/IntercomunicacaoService'),
  /** Siglas atendidas por esse endpoint, separadas por vírgula. */
  MNI_TRIBUNAIS: z.string().default('TJGO'),
  // 90s: com `incluirDocumentos` o tribunal monta e transmite os PDFs na mesma
  // resposta. Não se compara com os 20s que bastam ao DJEN.
  MNI_TIMEOUT_MS: inteiroPositivo(90_000),
  // Metade do teto relatado (~50/min) antes de bloqueio de IP com 403. Num VPS
  // o IP é compartilhado por todos os assinantes: estourar derruba todo mundo.
  MNI_RATE_LIMIT_PER_MINUTE: inteiroPositivo(30),
  /**
   * Chave do cofre que cifra a senha do advogado no tribunal (32 bytes em
   * base64). SEM ELA o acesso a peças não é montado — e é de propósito: guardar
   * senha de tribunal em claro transformaria um vazamento de banco em acesso
   * aos processos de terceiros. Gere com `npm run chave -- --cofre`.
   */
  LEXFLOW_CREDENCIAL_CHAVE: z.string().default(''),

  // --- Banco e sincronização ------------------------------------------------
  // Caminho do arquivo SQLite. No contêiner tem que apontar para um VOLUME,
  // senão os acompanhamentos somem a cada redeploy.
  LEXFLOW_DB_PATH: z.string().default('./dados/lexflow.db'),
  // Intervalo da varredura automática, em horas. 0 desliga.
  SYNC_INTERVALO_HORAS: z.coerce.number().min(0).default(12),
  SYNC_MAXIMO_POR_VARREDURA: inteiroPositivo(200),
  // Pausa entre consultas. A chave do CNJ é compartilhada por todo o país.
  SYNC_PAUSA_MS: z.coerce.number().int().min(0).default(1500),

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
  readonly djen: {
    readonly baseUrl: string;
    readonly timeoutMs: number;
    readonly limitePorMinuto: number;
    readonly maxComunicacoesPorOab: number;
  };
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
  readonly mni: {
    readonly endpoint: string;
    readonly tribunais: readonly string[];
    readonly timeoutMs: number;
    readonly limitePorMinuto: number;
    readonly chaveDoCofre: string;
  };
  readonly nivelLog: NivelLog;
  readonly banco: { readonly caminho: string };
  readonly sincronizacao: {
    readonly intervaloHoras: number;
    readonly maximoPorVarredura: number;
    readonly pausaMs: number;
  };
  readonly vigilancia: {
    readonly intervaloHoras: number;
    readonly maximoPorVarredura: number;
    readonly pausaMs: number;
  };
  readonly notificacao: {
    readonly smtpHost: string;
    readonly smtpPorta: number;
    readonly smtpUsuario: string;
    readonly smtpSenha: string;
    readonly smtpSeguro: boolean;
    readonly remetente: string;
    readonly urlBase: string;
    readonly horasAteAlertar: number;
  };
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
    djen: {
      baseUrl: env.DJEN_BASE_URL,
      timeoutMs: env.DJEN_TIMEOUT_MS,
      limitePorMinuto: env.DJEN_RATE_LIMIT_PER_MINUTE,
      maxComunicacoesPorOab: env.DJEN_MAX_COMUNICACOES_POR_OAB,
    },
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
    mni: {
      endpoint: env.MNI_ENDPOINT,
      tribunais: env.MNI_TRIBUNAIS.split(',')
        .map((s) => s.trim().toUpperCase())
        .filter((s) => s.length > 0),
      timeoutMs: env.MNI_TIMEOUT_MS,
      limitePorMinuto: env.MNI_RATE_LIMIT_PER_MINUTE,
      chaveDoCofre: env.LEXFLOW_CREDENCIAL_CHAVE.trim(),
    },
    nivelLog: env.LOG_LEVEL,
    banco: { caminho: env.LEXFLOW_DB_PATH },
    sincronizacao: {
      intervaloHoras: env.SYNC_INTERVALO_HORAS,
      maximoPorVarredura: env.SYNC_MAXIMO_POR_VARREDURA,
      pausaMs: env.SYNC_PAUSA_MS,
    },
    vigilancia: {
      intervaloHoras: env.VIGILANCIA_INTERVALO_HORAS,
      maximoPorVarredura: env.VIGILANCIA_MAXIMO_POR_VARREDURA,
      pausaMs: env.VIGILANCIA_PAUSA_MS,
    },
    notificacao: {
      smtpHost: env.SMTP_HOST.trim(),
      smtpPorta: env.SMTP_PORT,
      smtpUsuario: env.SMTP_USER.trim(),
      smtpSenha: env.SMTP_PASS,
      smtpSeguro: env.SMTP_SECURE === 'true',
      // Sem SMTP_FROM explícito, o usuário SMTP costuma ser o próprio endereço.
      remetente: env.SMTP_FROM.trim() || env.SMTP_USER.trim(),
      urlBase: env.LEXFLOW_URL_BASE.trim().replace(/\/+$/, ''),
      horasAteAlertar: env.NOTIFICACAO_HORAS_ATE_ALERTAR,
    },
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
