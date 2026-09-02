import type { Processo } from '../../domain/entities/Processo.js';
import { NumeroCNJ } from '../../domain/entities/NumeroCNJ.js';
import {
  DomainError,
  OperacaoNaoSuportadaError,
  ProcessoNaoEncontradoError,
  TodasAsFontesFalharamError,
} from '../../domain/errors/index.js';
import type { Logger } from '../../domain/ports/Logger.js';
import { loggerSilencioso } from '../../infrastructure/logging/ConsoleLogger.js';
import type {
  CapacidadesProvider,
  ProcessoProvider,
} from '../../domain/ports/ProcessoProvider.js';

export type EstrategiaOab = 'PRIMEIRA_RESPOSTA' | 'AGREGAR';

export interface OpcoesProcessoSearchService {
  /**
   * Cadeia ordenada: o primeiro é o primário, os seguintes são fallback.
   * A ordem é decisão de negócio (custo, frescor, riqueza do dado), não técnica —
   * por isso vem de configuração e não está gravada em código.
   */
  readonly providers: readonly ProcessoProvider[];
  readonly logger?: Logger;
  /**
   * `AGREGAR` (padrão) une os resultados de todas as fontes que suportam OAB;
   * `PRIMEIRA_RESPOSTA` para na primeira que responder.
   * Agregar é o padrão porque a carteira de um advogado costuma atravessar
   * tribunais, e cada crawler cobre um — parar no primeiro devolveria carteira
   * pela metade sem avisar ninguém.
   */
  readonly estrategiaOab?: EstrategiaOab;
  /**
   * Faz `healthCheck` antes de consultar cada fonte. Custa uma ida a mais e só
   * compensa quando o provider primário é lento para falhar. Padrão: false.
   */
  readonly verificarSaude?: boolean;
}

interface Tentativa {
  readonly provider: string;
  readonly erro: string;
}

/**
 * Orquestrador da busca híbrida (Strategy + Chain of Responsibility + Composite).
 *
 * Implementa a PRÓPRIA porta `ProcessoProvider`. Isso é o que mantém o desenho
 * honesto: para os casos de uso, "a cadeia inteira de fontes" é indistinguível
 * de "uma fonte". Dá para aninhar orquestradores, embrulhar em cache ou trocar
 * por um único adapter sem tocar em nada acima.
 *
 * Como as falhas são classificadas — e por que isso importa:
 *
 *   OperacaoNaoSuportadaError  a fonte não faz isso e nunca vai fazer.
 *                              PULA sem contar como falha. É o caso do DataJud
 *                              com busca por OAB.
 *   ProcessoNaoEncontradoError a fonte respondeu e não tem o processo.
 *                              Segue para a próxima (outra base pode ter), mas
 *                              lembra que houve resposta legítima: se TODAS
 *                              disserem isso, o erro final é "não encontrado",
 *                              não "as fontes caíram".
 *   ProviderIndisponivelError  rede, timeout, captcha, tribunal fora do ar.
 *                              É o caso que o fallback existe para cobrir.
 *
 * Distinguir "não existe" de "não consegui ver" é a decisão central deste
 * arquivo. Colapsar as duas coisas em um erro genérico faria o produto dizer
 * ao advogado que o processo dele não existe sempre que o TJSP saísse do ar.
 */
export class ProcessoSearchService implements ProcessoProvider {
  readonly nome = 'orquestrador';

  private readonly providers: readonly ProcessoProvider[];
  private readonly logger: Logger;
  private readonly estrategiaOab: EstrategiaOab;
  private readonly verificarSaude: boolean;

  constructor(opcoes: OpcoesProcessoSearchService) {
    if (opcoes.providers.length === 0) {
      throw new Error('ProcessoSearchService exige ao menos um provider na cadeia.');
    }
    this.providers = opcoes.providers;
    this.logger = (opcoes.logger ?? loggerSilencioso).child({ provider: this.nome });
    this.estrategiaOab = opcoes.estrategiaOab ?? 'AGREGAR';
    this.verificarSaude = opcoes.verificarSaude ?? false;
  }

  /** União das capacidades da cadeia — o que o conjunto consegue fazer. */
  get capacidades(): CapacidadesProvider {
    const tribunais = new Set<string>();
    for (const p of this.providers) {
      for (const t of p.capacidades.tribunais) tribunais.add(t);
    }
    return {
      buscarPorNumero: this.providers.some((p) => p.capacidades.buscarPorNumero),
      buscarPorOab: this.providers.some((p) => p.capacidades.buscarPorOab),
      retornaPartes: this.providers.some((p) => p.capacidades.retornaPartes),
      retornaConteudoMovimentacoes: this.providers.some(
        (p) => p.capacidades.retornaConteudoMovimentacoes,
      ),
      tribunais: tribunais.has('*') ? ['*'] : [...tribunais],
    };
  }

  async buscarPorNumero(numeroProcesso: string): Promise<Processo> {
    const numero = NumeroCNJ.criar(numeroProcesso);
    const sigla = numero.siglaTribunal;
    const criterio = `número ${numero.formatado}`;

    const tentativas: Tentativa[] = [];
    let algumaFonteRespondeuSemAchar = false;

    for (const provider of this.providers) {
      if (!provider.capacidades.buscarPorNumero) continue;
      if (!this.atendeTribunal(provider, sigla)) {
        this.logger.debug('fonte ignorada: não cobre o tribunal', {
          fonte: provider.nome,
          tribunal: sigla,
        });
        continue;
      }
      if (this.verificarSaude && !(await this.estaSaudavel(provider))) {
        tentativas.push({ provider: provider.nome, erro: 'healthCheck negativo' });
        continue;
      }

      try {
        const processo = await provider.buscarPorNumero(numero.digitos);
        this.logger.info('processo localizado', {
          fonte: provider.nome,
          numero: numero.formatado,
          tentativasAnteriores: tentativas.length,
        });
        return processo;
      } catch (erro) {
        if (erro instanceof OperacaoNaoSuportadaError) {
          this.logger.debug('fonte não suporta a operação', { fonte: provider.nome });
          continue;
        }
        if (erro instanceof ProcessoNaoEncontradoError) {
          algumaFonteRespondeuSemAchar = true;
          tentativas.push({ provider: provider.nome, erro: 'não encontrado' });
          this.logger.debug('fonte respondeu sem resultado', {
            fonte: provider.nome,
          });
          continue;
        }
        tentativas.push({ provider: provider.nome, erro: descrever(erro) });
        this.logger.warn('fonte falhou, acionando fallback', {
          fonte: provider.nome,
          erro: descrever(erro),
        });
      }
    }

    if (algumaFonteRespondeuSemAchar) {
      throw new ProcessoNaoEncontradoError(criterio);
    }
    throw new TodasAsFontesFalharamError(criterio, tentativas);
  }

  async buscarPorOab(oab: string, uf: string): Promise<Processo[]> {
    const criterio = `OAB ${oab}/${uf.toUpperCase()}`;
    const tentativas: Tentativa[] = [];
    const agregado = new Map<string, Processo>();
    let algumaFonteRespondeu = false;

    for (const provider of this.providers) {
      if (!provider.capacidades.buscarPorOab) {
        this.logger.debug('fonte não busca por OAB', { fonte: provider.nome });
        continue;
      }
      if (this.verificarSaude && !(await this.estaSaudavel(provider))) {
        tentativas.push({ provider: provider.nome, erro: 'healthCheck negativo' });
        continue;
      }

      try {
        const processos = await provider.buscarPorOab(oab, uf);
        algumaFonteRespondeu = true;

        if (this.estrategiaOab === 'PRIMEIRA_RESPOSTA') {
          this.logger.info('carteira obtida', {
            fonte: provider.nome,
            total: processos.length,
          });
          return processos;
        }

        // Dedupe pelo número CNJ: a primeira fonte da cadeia vence, o que faz a
        // ordem dos providers valer também como ordem de PREFERÊNCIA de dado.
        for (const processo of processos) {
          const chave = processo.numero.digitos;
          if (!agregado.has(chave)) agregado.set(chave, processo);
        }
      } catch (erro) {
        if (erro instanceof OperacaoNaoSuportadaError) continue;
        tentativas.push({ provider: provider.nome, erro: descrever(erro) });
        this.logger.warn('fonte falhou na busca por OAB', {
          fonte: provider.nome,
          erro: descrever(erro),
        });
      }
    }

    // Resultado parcial vale mais do que erro: se ao menos uma fonte respondeu,
    // devolvemos o que há. A falha das demais fica no log, não na cara do usuário.
    if (algumaFonteRespondeu) {
      this.logger.info('carteira agregada', {
        total: agregado.size,
        fontesComFalha: tentativas.length,
      });
      return [...agregado.values()];
    }

    throw new TodasAsFontesFalharamError(criterio, tentativas);
  }

  /** Saudável se PELO MENOS UMA fonte da cadeia responder — é o ponto do fallback. */
  async healthCheck(): Promise<boolean> {
    const resultados = await Promise.all(
      this.providers.map((p) => this.estaSaudavel(p)),
    );
    return resultados.some(Boolean);
  }

  /** Diagnóstico por fonte, para o endpoint de readiness e para o CLI. */
  async diagnostico(): Promise<Array<{ provider: string; saudavel: boolean }>> {
    return Promise.all(
      this.providers.map(async (p) => ({
        provider: p.nome,
        saudavel: await this.estaSaudavel(p),
      })),
    );
  }

  private atendeTribunal(provider: ProcessoProvider, sigla: string | null): boolean {
    const { tribunais } = provider.capacidades;
    if (tribunais.includes('*')) return true;
    if (!sigla) return false;
    return tribunais.includes(sigla);
  }

  private async estaSaudavel(provider: ProcessoProvider): Promise<boolean> {
    try {
      return await provider.healthCheck();
    } catch {
      return false;
    }
  }
}

function descrever(erro: unknown): string {
  if (erro instanceof DomainError) return `${erro.codigo}: ${erro.message}`;
  if (erro instanceof Error) return erro.message;
  return String(erro);
}
