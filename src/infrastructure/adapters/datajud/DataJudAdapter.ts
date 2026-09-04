import { NumeroCNJ } from '../../../domain/entities/NumeroCNJ.js';
import type { Processo } from '../../../domain/entities/Processo.js';
import {
  OperacaoNaoSuportadaError,
  ProcessoNaoEncontradoError,
  ProviderIndisponivelError,
  RespostaInvalidaError,
} from '../../../domain/errors/index.js';
import type { Clock } from '../../../domain/ports/Clock.js';
import { clockDoSistema } from '../../../domain/ports/Clock.js';
import type { Logger } from '../../../domain/ports/Logger.js';
import { loggerSilencioso } from '../../logging/ConsoleLogger.js';
import type {
  CapacidadesProvider,
  DiagnosticoProvider,
  ProcessoProvider,
} from '../../../domain/ports/ProcessoProvider.js';
import { HttpClient, HttpTimeoutError } from '../../http/HttpClient.js';
import type { RateLimiter } from '../../ratelimit/TokenBucketRateLimiter.js';
import { TokenBucketRateLimiter } from '../../ratelimit/TokenBucketRateLimiter.js';
import { mapearProcesso } from './datajud.mapper.js';
import { respostaDataJudSchema } from './datajud.types.js';
import { TRIBUNAIS_SUPORTADOS, ehTribunalSuportado, urlDeBusca } from './tribunais.js';

export const NOME_DATAJUD = 'datajud';

/**
 * Consulta usada só para verificar a fonte. Ela casa com ZERO documentos de
 * propósito: um número CNJ de vinte zeros não existe em tribunal nenhum.
 *
 * A versão anterior usava `match_all` sobre o índice do TJSP — o maior tribunal
 * do país. Mesmo com `size: 0`, isso pede ao Elasticsearch que percorra e conte
 * o índice inteiro: a consulta mais cara possível, disparada a cada chamada de
 * `/ready`. Contra uma API pública compartilhada e sob carga, o resultado era
 * timeout — e o LexFlow concluía "fonte fora do ar" quando ela estava no ar,
 * só ocupada respondendo a uma pergunta que ninguém precisava fazer.
 *
 * Um health check tem uma pergunta só: "consigo falar com essa fonte e ela me
 * aceita?". Zero resultados respondem isso tão bem quanto um milhão.
 */
const CONSULTA_DE_VERIFICACAO = {
  size: 0,
  query: { match: { numeroProcesso: '00000000000000000000' } },
};

/** Health check responde rápido ou não responde. 5s é o teto. */
const TIMEOUT_VERIFICACAO_MS = 5000;

export interface OpcoesDataJudAdapter {
  /** Chave Pública divulgada pelo DPJ/CNJ (sem o prefixo "APIKey"). */
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  /** Requisições por minuto que o adapter se autoimpõe. Padrão: 60. */
  readonly limitePorMinuto?: number;
  readonly httpClient?: HttpClient;
  readonly rateLimiter?: RateLimiter;
  readonly logger?: Logger;
  readonly clock?: Clock;
}

/**
 * Adapter da API Pública do DataJud (CNJ) — fonte primária, gratuita e oficial
 * de METADADOS processuais.
 *
 * Endpoint: POST {base}/api_publica_{sigla}/_search   (interface Elasticsearch)
 * Auth:     header `Authorization: APIKey {chave pública}`
 *
 * Dois limites da fonte moldam este adapter, e ambos estão declarados em
 * `capacidades` em vez de descobertos por erro em produção:
 *
 * 1. Não há índice global — a URL embute o tribunal, que é deduzido do próprio
 *    número CNJ. Tribunal fora da lista suportada é recusado antes da rede.
 * 2. A base não indexa partes nem advogados, então busca por OAB é impossível
 *    aqui. Não é instabilidade: é ausência de dado. Por isso `buscarPorOab`
 *    lança `OperacaoNaoSuportadaError`, que faz o orquestrador PULAR esta fonte
 *    em vez de contabilizá-la como falha.
 */
export class DataJudAdapter implements ProcessoProvider {
  readonly nome = NOME_DATAJUD;

  readonly capacidades: CapacidadesProvider = {
    buscarPorNumero: true,
    buscarPorOab: false,
    retornaPartes: false,
    retornaConteudoMovimentacoes: false,
    tribunais: TRIBUNAIS_SUPORTADOS,
  };

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly http: HttpClient;
  private readonly rateLimiter: RateLimiter;
  private readonly logger: Logger;
  private readonly clock: Clock;

  constructor(opcoes: OpcoesDataJudAdapter) {
    if (!opcoes.apiKey?.trim()) {
      throw new Error(
        'DataJudAdapter exige uma chave pública. Defina DATAJUD_API_KEY ' +
          '(obtenha em https://datajud-wiki.cnj.jus.br/api-publica/acesso/).',
      );
    }
    this.apiKey = opcoes.apiKey.trim();
    this.baseUrl = opcoes.baseUrl ?? 'https://api-publica.datajud.cnj.jus.br';
    this.clock = opcoes.clock ?? clockDoSistema;
    this.logger = (opcoes.logger ?? loggerSilencioso).child({ provider: this.nome });
    this.http =
      opcoes.httpClient ??
      new HttpClient({ timeoutMs: opcoes.timeoutMs ?? 8000, tentativas: 3 });
    this.rateLimiter =
      opcoes.rateLimiter ??
      new TokenBucketRateLimiter({
        capacidade: opcoes.limitePorMinuto ?? 60,
        janelaMs: 60_000,
        ...(opcoes.clock ? { clock: opcoes.clock } : {}),
      });
  }

  async buscarPorNumero(numeroProcesso: string): Promise<Processo> {
    const numero = NumeroCNJ.criar(numeroProcesso);
    const sigla = numero.siglaTribunal;

    if (!sigla || !ehTribunalSuportado(sigla)) {
      throw new OperacaoNaoSuportadaError(
        this.nome,
        'buscarPorNumero',
        `tribunal não mapeado para o segmento ${numero.segmento}.${numero.tribunal}`,
      );
    }

    const url = urlDeBusca(this.baseUrl, sigla);
    // O índice guarda o número sem máscara; buscar com máscara não retorna nada.
    const corpo = {
      size: 1,
      query: { match: { numeroProcesso: numero.digitos } },
    };

    await this.rateLimiter.adquirir();
    const inicio = this.clock.monotonico();

    let resposta;
    try {
      resposta = await this.http.postJson(url, corpo, {
        Authorization: `APIKey ${this.apiKey}`,
      });
    } catch (erro) {
      const motivo =
        erro instanceof HttpTimeoutError ? 'timeout' : 'falha de rede';
      throw new ProviderIndisponivelError(this.nome, motivo, { cause: erro });
    }

    this.logger.debug('consulta ao DataJud concluída', {
      tribunal: sigla,
      status: resposta.status,
      duracaoMs: Math.round(this.clock.monotonico() - inicio),
    });

    if (resposta.status === 401 || resposta.status === 403) {
      throw new ProviderIndisponivelError(
        this.nome,
        `chave pública rejeitada (HTTP ${resposta.status})`,
      );
    }
    if (resposta.status === 429) {
      throw new ProviderIndisponivelError(this.nome, 'limite de requisições excedido');
    }
    if (!resposta.ok) {
      throw new ProviderIndisponivelError(this.nome, `HTTP ${resposta.status}`);
    }

    const payload = this.interpretar(resposta.corpo);
    const primeiro = payload.hits.hits[0];

    if (!primeiro) {
      throw new ProcessoNaoEncontradoError(
        `número ${numero.formatado}`,
        this.nome,
      );
    }

    return mapearProcesso(primeiro._source, this.clock.agora());
  }

  /**
   * Sempre lança: a base pública do DataJud não expõe partes nem advogados.
   * Documentado como capacidade para que ninguém tente "consertar" com retry.
   */
  async buscarPorOab(_oab: string, _uf: string): Promise<Processo[]> {
    throw new OperacaoNaoSuportadaError(
      this.nome,
      'buscarPorOab',
      'a API Pública do DataJud indexa apenas metadados processuais, sem partes ou advogados',
    );
  }

  async healthCheck(): Promise<boolean> {
    return (await this.diagnosticar()).saudavel;
  }

  /**
   * Verifica se a fonte está utilizável e diz POR QUE quando não está.
   *
   * A classificação abaixo corrige um erro sutil da versão anterior, que
   * reprovava a fonte em qualquer resposta que não fosse 2xx:
   *
   *   4xx que NÃO é de autenticação significa que a requisição chegou, a chave
   *   foi aceita e o servidor entendeu o suficiente para reclamar da consulta
   *   de verificação. Do ponto de vista de "esta fonte consegue me atender?",
   *   isso é SAUDÁVEL — o que não serve é a query do health check, não a fonte.
   *
   * Tratar isso como "fonte morta" tirava o DataJud da cadeia inteira por causa
   * de uma consulta de teste recusada, exatamente quando ele estava disponível.
   */
  async diagnosticar(): Promise<DiagnosticoProvider> {
    const url = urlDeBusca(this.baseUrl, 'TJSP');

    let resposta;
    try {
      resposta = await this.http.postJson(
        url,
        CONSULTA_DE_VERIFICACAO,
        { Authorization: `APIKey ${this.apiKey}` },
        // Tentativa ÚNICA e prazo curto. Herdar a política das consultas de
        // usuário (3 tentativas × 8s + backoff) fazia o /ready levar mais de 25
        // segundos só para dizer que a fonte está fora — tempo suficiente para
        // o orquestrador de contêiner concluir que o SERVIÇO é que morreu.
        { timeoutMs: TIMEOUT_VERIFICACAO_MS, tentativas: 1 },
      );
    } catch (erro) {
      return {
        saudavel: false,
        motivo:
          erro instanceof HttpTimeoutError
            ? 'timeout ao contatar a API do CNJ'
            : 'falha de rede ao contatar a API do CNJ',
      };
    }

    if (resposta.ok) return { saudavel: true };

    if (resposta.status === 401 || resposta.status === 403) {
      return {
        saudavel: false,
        motivo:
          `chave pública rejeitada (HTTP ${resposta.status}). Confira DATAJUD_API_KEY — ` +
          'a chave vigente fica em https://datajud-wiki.cnj.jus.br/api-publica/acesso/',
      };
    }

    if (resposta.status === 429) {
      return {
        saudavel: false,
        motivo:
          'limite de requisições excedido (HTTP 429). Reduza DATAJUD_RATE_LIMIT_PER_MINUTE.',
      };
    }

    if (resposta.status >= 500) {
      return {
        saudavel: false,
        motivo: `API do CNJ fora do ar (HTTP ${resposta.status})`,
      };
    }

    return {
      saudavel: true,
      motivo:
        `alcançável e autenticada, mas a consulta de verificação foi recusada ` +
        `(HTTP ${resposta.status}). As buscas por número devem funcionar normalmente.`,
    };
  }

  private interpretar(corpo: string): ReturnType<typeof respostaDataJudSchema.parse> {
    let json: unknown;
    try {
      json = JSON.parse(corpo);
    } catch (erro) {
      throw new RespostaInvalidaError(this.nome, 'corpo não é JSON válido', {
        cause: erro,
      });
    }

    const resultado = respostaDataJudSchema.safeParse(json);
    if (!resultado.success) {
      throw new RespostaInvalidaError(
        this.nome,
        `payload fora do contrato esperado: ${resultado.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join('.')} ${i.message}`)
          .join('; ')}`,
        { cause: resultado.error },
      );
    }
    return resultado.data;
  }
}
