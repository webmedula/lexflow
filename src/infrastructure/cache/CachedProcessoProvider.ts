import { NumeroCNJ } from '../../domain/entities/NumeroCNJ.js';
import type { Movimentacao } from '../../domain/entities/Movimentacao.js';
import type { Parte } from '../../domain/entities/Parte.js';
import { Processo } from '../../domain/entities/Processo.js';
import type { Cache } from '../../domain/ports/Cache.js';
import type {
  CapacidadesProvider,
  ProcessoProvider,
} from '../../domain/ports/ProcessoProvider.js';

/** Formato serializável guardado no cache (JSON não sabe reidratar `Date`). */
interface ProcessoSerializado {
  numero: string;
  tribunal: string;
  vara?: string;
  classe?: string;
  assunto?: string;
  assuntos: string[];
  dataDistribuicao?: string;
  grau?: string;
  valorCausa?: number;
  segredoJustica: boolean;
  partes: Parte[];
  movimentacoes: Array<Omit<Movimentacao, 'data'> & { data: string }>;
  procedencia: { provider: string; consultadoEm: string };
}

export interface OpcoesCachedProcessoProvider {
  readonly provider: ProcessoProvider;
  readonly cache: Cache;
  /** TTL da consulta por número. Padrão: 900s (15 min). */
  readonly ttlNumeroSegundos?: number;
  /**
   * TTL da busca por OAB. Bem menor por padrão (300s): a carteira do advogado é
   * a tela que ele fica atualizando, e servir carteira velha é o pior tipo de
   * erro deste produto — ele acha que não há novidade quando há.
   */
  readonly ttlOabSegundos?: number;
}

/**
 * Decorator de cache sobre QUALQUER `ProcessoProvider` — inclusive sobre o
 * orquestrador inteiro.
 *
 * Decorator e não um `if (cache)` dentro de cada adapter: assim a política de
 * cache existe em um lugar só, e ligar ou desligar cache é montar (ou não
 * montar) um objeto no composition root. Nenhum adapter sabe que cache existe.
 *
 * A entidade é reidratada em vez de devolvida direto do JSON, e a `procedencia`
 * volta com `deCache: true` — quem consome consegue distinguir dado fresco de
 * dado servido da memória, o que importa quando a resposta vira base de prazo.
 */
export class CachedProcessoProvider implements ProcessoProvider {
  readonly nome: string;
  readonly capacidades: CapacidadesProvider;

  private readonly provider: ProcessoProvider;
  private readonly cache: Cache;
  private readonly ttlNumero: number;
  private readonly ttlOab: number;

  constructor(opcoes: OpcoesCachedProcessoProvider) {
    this.provider = opcoes.provider;
    this.cache = opcoes.cache;
    this.nome = opcoes.provider.nome;
    this.capacidades = opcoes.provider.capacidades;
    this.ttlNumero = opcoes.ttlNumeroSegundos ?? 900;
    this.ttlOab = opcoes.ttlOabSegundos ?? 300;
  }

  async buscarPorNumero(numeroProcesso: string): Promise<Processo> {
    const numero = NumeroCNJ.criar(numeroProcesso);
    const chave = `processo:numero:${numero.digitos}`;

    const emCache = await this.cache.get<ProcessoSerializado>(chave);
    if (emCache) return reidratar(emCache, true);

    const processo = await this.provider.buscarPorNumero(numero.digitos);
    await this.cache.set(chave, serializar(processo), this.ttlNumero);
    return processo;
  }

  async buscarPorOab(oab: string, uf: string): Promise<Processo[]> {
    const chave = `processo:oab:${oab}:${uf.toUpperCase()}`;

    const emCache = await this.cache.get<ProcessoSerializado[]>(chave);
    if (emCache) return emCache.map((p) => reidratar(p, true));

    const processos = await this.provider.buscarPorOab(oab, uf);
    await this.cache.set(chave, processos.map(serializar), this.ttlOab);
    return processos;
  }

  /** Nunca cacheado: healthCheck em cache é healthCheck inútil. */
  async healthCheck(): Promise<boolean> {
    return this.provider.healthCheck();
  }

  /** Invalida a entrada de um processo — use após um webhook de atualização. */
  async invalidar(numeroProcesso: string): Promise<void> {
    const numero = NumeroCNJ.criar(numeroProcesso);
    await this.cache.delete(`processo:numero:${numero.digitos}`);
  }
}

function serializar(processo: Processo): ProcessoSerializado {
  return {
    numero: processo.numero.digitos,
    tribunal: processo.tribunal,
    ...(processo.vara !== undefined ? { vara: processo.vara } : {}),
    ...(processo.classe !== undefined ? { classe: processo.classe } : {}),
    ...(processo.assunto !== undefined ? { assunto: processo.assunto } : {}),
    assuntos: [...processo.assuntos],
    ...(processo.dataDistribuicao !== undefined
      ? { dataDistribuicao: processo.dataDistribuicao.toISOString() }
      : {}),
    ...(processo.grau !== undefined ? { grau: processo.grau } : {}),
    ...(processo.valorCausa !== undefined ? { valorCausa: processo.valorCausa } : {}),
    segredoJustica: processo.segredoJustica,
    partes: [...processo.partes],
    movimentacoes: processo.movimentacoes.map((m) => ({
      ...m,
      data: m.data.toISOString(),
    })),
    procedencia: {
      provider: processo.procedencia.provider,
      consultadoEm: processo.procedencia.consultadoEm.toISOString(),
    },
  };
}

function reidratar(bruto: ProcessoSerializado, deCache: boolean): Processo {
  return new Processo({
    numero: NumeroCNJ.criar(bruto.numero),
    tribunal: bruto.tribunal,
    ...(bruto.vara !== undefined ? { vara: bruto.vara } : {}),
    ...(bruto.classe !== undefined ? { classe: bruto.classe } : {}),
    ...(bruto.assunto !== undefined ? { assunto: bruto.assunto } : {}),
    assuntos: bruto.assuntos,
    ...(bruto.dataDistribuicao !== undefined
      ? { dataDistribuicao: new Date(bruto.dataDistribuicao) }
      : {}),
    ...(bruto.grau !== undefined ? { grau: bruto.grau } : {}),
    ...(bruto.valorCausa !== undefined ? { valorCausa: bruto.valorCausa } : {}),
    segredoJustica: bruto.segredoJustica,
    partes: bruto.partes,
    movimentacoes: bruto.movimentacoes.map((m) => ({
      ...m,
      data: new Date(m.data),
    })),
    procedencia: {
      provider: bruto.procedencia.provider,
      consultadoEm: new Date(bruto.procedencia.consultadoEm),
      deCache,
    },
  });
}
