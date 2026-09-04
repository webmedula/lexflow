import { describe, expect, it } from 'vitest';
import { DataJudAdapter } from '../../src/infrastructure/adapters/datajud/DataJudAdapter.js';
import { HttpClient, HttpTimeoutError } from '../../src/infrastructure/http/HttpClient.js';
import type { RespostaHttp } from '../../src/infrastructure/http/HttpClient.js';

class HttpFalso extends HttpClient {
  readonly chamadas: Array<{ corpo: unknown; opcoes: unknown }> = [];

  constructor(private readonly responder: () => RespostaHttp) {
    super();
  }

  override async postJson(
    _url: string,
    corpo: unknown,
    _headers?: Record<string, string>,
    opcoes?: unknown,
  ): Promise<RespostaHttp> {
    this.chamadas.push({ corpo, opcoes });
    return this.responder();
  }
}

function adapterQueRecebe(responder: () => RespostaHttp): DataJudAdapter {
  return new DataJudAdapter({
    apiKey: 'chave-de-teste',
    httpClient: new HttpFalso(responder),
    rateLimiter: { adquirir: async () => {}, tentarAdquirir: () => true },
  });
}

const resposta = (status: number): RespostaHttp => ({
  status,
  ok: status >= 200 && status < 300,
  corpo: '',
});

describe('DataJudAdapter.diagnosticar', () => {
  it('2xx é saudável e não precisa de explicação', async () => {
    const d = await adapterQueRecebe(() => resposta(200)).diagnosticar();
    expect(d).toEqual({ saudavel: true });
  });

  it('401 aponta a chave e diz onde pegar a vigente', async () => {
    const d = await adapterQueRecebe(() => resposta(401)).diagnosticar();
    expect(d.saudavel).toBe(false);
    expect(d.motivo).toMatch(/chave pública rejeitada/);
    expect(d.motivo).toMatch(/DATAJUD_API_KEY/);
    expect(d.motivo).toMatch(/datajud-wiki\.cnj\.jus\.br/);
  });

  it('403 recebe o mesmo tratamento de 401', async () => {
    const d = await adapterQueRecebe(() => resposta(403)).diagnosticar();
    expect(d.saudavel).toBe(false);
    expect(d.motivo).toMatch(/chave pública rejeitada/);
  });

  it('429 aponta o parâmetro de rate limit a ajustar', async () => {
    const d = await adapterQueRecebe(() => resposta(429)).diagnosticar();
    expect(d.saudavel).toBe(false);
    expect(d.motivo).toMatch(/DATAJUD_RATE_LIMIT_PER_MINUTE/);
  });

  it('5xx é a API do CNJ fora do ar', async () => {
    const d = await adapterQueRecebe(() => resposta(503)).diagnosticar();
    expect(d.saudavel).toBe(false);
    expect(d.motivo).toMatch(/fora do ar/);
  });

  it('4xx que não é de autenticação NÃO reprova a fonte', async () => {
    // Este é o bug que a v0.3.0 tinha: 400 na consulta de verificação marcava a
    // fonte como morta e a tirava da cadeia — mesmo com a chave aceita e o
    // servidor respondendo. Só a query do health check foi recusada.
    const d = await adapterQueRecebe(() => resposta(400)).diagnosticar();
    expect(d.saudavel).toBe(true);
    expect(d.motivo).toMatch(/alcançável e autenticada/);
  });

  it('timeout é distinguido de falha de rede', async () => {
    const comTimeout = new DataJudAdapter({
      apiKey: 'k',
      httpClient: new HttpFalso(() => {
        throw new HttpTimeoutError('http://x', 8000);
      }),
      rateLimiter: { adquirir: async () => {}, tentarAdquirir: () => true },
    });
    const d = await comTimeout.diagnosticar();
    expect(d.saudavel).toBe(false);
    expect(d.motivo).toMatch(/timeout/);
  });

  it('healthCheck continua booleano e coerente com o diagnóstico', async () => {
    await expect(adapterQueRecebe(() => resposta(200)).healthCheck()).resolves.toBe(true);
    await expect(adapterQueRecebe(() => resposta(401)).healthCheck()).resolves.toBe(false);
    await expect(adapterQueRecebe(() => resposta(400)).healthCheck()).resolves.toBe(true);
  });

  it('usa uma consulta que casa com zero documentos, não match_all', async () => {
    // match_all sobre o índice do TJSP é a consulta mais cara possível e foi o
    // que causou timeout contra a API pública sob carga.
    const http = new HttpFalso(() => resposta(200));
    const adapter = new DataJudAdapter({
      apiKey: 'k',
      httpClient: http,
      rateLimiter: { adquirir: async () => {}, tentarAdquirir: () => true },
    });

    await adapter.diagnosticar();

    expect(http.chamadas[0]?.corpo).toEqual({
      size: 0,
      query: { match: { numeroProcesso: '00000000000000000000' } },
    });
    expect(JSON.stringify(http.chamadas[0]?.corpo)).not.toContain('match_all');
  });

  it('falha rápido: tentativa única e prazo curto', async () => {
    // Herdar 3 tentativas × 8s fazia o /ready demorar mais de 25s para dizer
    // que a fonte está fora.
    const http = new HttpFalso(() => resposta(200));
    const adapter = new DataJudAdapter({
      apiKey: 'k',
      httpClient: http,
      rateLimiter: { adquirir: async () => {}, tentarAdquirir: () => true },
    });

    await adapter.diagnosticar();

    expect(http.chamadas[0]?.opcoes).toEqual({ timeoutMs: 5000, tentativas: 1 });
  });

  it('nunca lança, mesmo com a rede quebrada', async () => {
    const quebrado = new DataJudAdapter({
      apiKey: 'k',
      httpClient: new HttpFalso(() => {
        throw new Error('ECONNREFUSED');
      }),
      rateLimiter: { adquirir: async () => {}, tentarAdquirir: () => true },
    });
    await expect(quebrado.healthCheck()).resolves.toBe(false);
  });
});
