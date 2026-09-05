import { NumeroCNJ } from '../../domain/entities/NumeroCNJ.js';
import { detectarNovidades } from '../../domain/entities/Acompanhamento.js';
import type { Acompanhamento, Novidade } from '../../domain/entities/Acompanhamento.js';
import { DomainError, ProcessoNaoEncontradoError } from '../../domain/errors/index.js';
import type { Logger } from '../../domain/ports/Logger.js';
import type { ProcessoProvider } from '../../domain/ports/ProcessoProvider.js';
import type {
  AcompanhamentoResumido,
  FiltroAcompanhamentos,
  FiltroNovidades,
  RepositorioAcompanhamentos,
} from '../../domain/ports/RepositorioAcompanhamentos.js';

export interface ResultadoSincronizacao {
  readonly verificados: number;
  readonly comNovidade: number;
  readonly novidades: number;
  readonly falhas: number;
  readonly duracaoMs: number;
}

export interface OpcoesServicoAcompanhamento {
  readonly repositorio: RepositorioAcompanhamentos;
  /** A cadeia de fontes. O serviço não sabe quais são. */
  readonly provider: ProcessoProvider;
  readonly logger: Logger;
  /** Teto de processos por varredura. Padrão: 200. */
  readonly maximoPorVarredura?: number;
  /** Pausa entre consultas, para não martelar a fonte. Padrão: 1500ms. */
  readonly pausaEntreConsultasMs?: number;
}

/**
 * Acompanhamento de processos: adicionar, listar e manter atualizado.
 *
 * É onde o produto deixa de ser consulta avulsa. E é o motivo de existir banco:
 * "o que mudou desde ontem" só pode ser respondido por quem guardou o ontem.
 *
 * A sincronização roda em SEGUNDO PLANO por necessidade, não por elegância. Uma
 * consulta fria ao CNJ leva cerca de 20 segundos; com 100 processos, uma
 * varredura completa passa de meia hora. Ninguém espera isso numa tela — então
 * o usuário sempre lê do banco, e a fila alimenta o banco no seu ritmo.
 */
export class ServicoAcompanhamento {
  private readonly repo: RepositorioAcompanhamentos;
  private readonly provider: ProcessoProvider;
  private readonly log: Logger;
  private readonly maximo: number;
  private readonly pausaMs: number;
  private sincronizando = false;

  constructor(opcoes: OpcoesServicoAcompanhamento) {
    this.repo = opcoes.repositorio;
    this.provider = opcoes.provider;
    this.log = opcoes.logger.child({ servico: 'acompanhamento' });
    this.maximo = opcoes.maximoPorVarredura ?? 200;
    this.pausaMs = opcoes.pausaEntreConsultasMs ?? 1500;
  }

  /**
   * Passa a acompanhar um processo e já busca o primeiro retrato.
   *
   * Buscar na hora custa a espera da consulta fria, mas é o que faz o processo
   * aparecer preenchido na lista em vez de como uma linha vazia esperando a
   * próxima varredura.
   */
  async acompanhar(
    workspace: string,
    numeroInformado: string,
    apelido?: string,
  ): Promise<Acompanhamento> {
    const numero = NumeroCNJ.criar(numeroInformado);
    await this.repo.acompanhar(workspace, numero.digitos, apelido);

    try {
      const processo = await this.provider.buscarPorNumero(numero.digitos);
      // Primeira sincronização não gera novidade — ver `detectarNovidades`.
      await this.repo.registrarSincronizacao(workspace, numero.digitos, processo, []);
    } catch (erro) {
      // Falhar a busca NÃO desfaz o acompanhamento: o processo fica na lista
      // com o motivo, e a varredura tenta de novo. Desfazer obrigaria o usuário
      // a readicionar toda vez que o tribunal estivesse fora do ar.
      await this.repo.registrarFalha(workspace, numero.digitos, descrever(erro));
      this.log.warn('primeira busca do acompanhamento falhou', {
        numero: numero.formatado,
        erro: descrever(erro),
      });
    }

    const salvo = await this.repo.buscar(workspace, numero.digitos);
    if (!salvo) throw new Error('acompanhamento não encontrado após gravação');
    return salvo;
  }

  async deixarDeAcompanhar(workspace: string, numeroInformado: string): Promise<boolean> {
    const numero = NumeroCNJ.criar(numeroInformado);
    return this.repo.deixarDeAcompanhar(workspace, numero.digitos);
  }

  async listar(
    workspace: string,
    filtro?: FiltroAcompanhamentos,
  ): Promise<AcompanhamentoResumido[]> {
    return this.repo.listar(workspace, filtro);
  }

  async detalhar(
    workspace: string,
    numeroInformado: string,
  ): Promise<Acompanhamento | undefined> {
    return this.repo.buscar(workspace, NumeroCNJ.criar(numeroInformado).digitos);
  }

  async novidades(workspace: string, filtro?: FiltroNovidades): Promise<Novidade[]> {
    return this.repo.listarNovidades(workspace, filtro);
  }

  async contarNaoVistas(workspace: string): Promise<number> {
    return this.repo.contarNaoVistas(workspace);
  }

  async marcarComoVistas(workspace: string, numeroInformado?: string): Promise<number> {
    const numero = numeroInformado
      ? NumeroCNJ.criar(numeroInformado).digitos
      : undefined;
    return this.repo.marcarComoVistas(workspace, numero);
  }

  async facetas(workspace: string): Promise<{ tribunais: string[]; classes: string[] }> {
    return this.repo.facetas(workspace);
  }

  /**
   * Varre os acompanhamentos, busca cada um e registra o que mudou.
   *
   * Sequencial e com pausa entre consultas, de propósito. Paralelizar contra a
   * API pública do CNJ — que usa uma chave compartilhada por todo o país —
   * queimaria a cota de todo mundo e renderia bloqueio.
   *
   * Reentrância bloqueada: se a varredura anterior ainda roda (e pode rodar por
   * meia hora), a nova é recusada em vez de duplicar consultas.
   */
  async sincronizar(): Promise<ResultadoSincronizacao> {
    if (this.sincronizando) {
      throw new SincronizacaoEmAndamentoError();
    }
    this.sincronizando = true;
    const inicio = Date.now();

    let verificados = 0;
    let comNovidade = 0;
    let novidades = 0;
    let falhas = 0;

    try {
      const fila = await this.repo.listarParaSincronizar(this.maximo);
      this.log.info('varredura iniciada', { total: fila.length });

      for (const item of fila) {
        try {
          const atual = await this.provider.buscarPorNumero(item.numero);
          const novas = detectarNovidades(item.processo, atual);

          await this.repo.registrarSincronizacao(
            item.workspace,
            item.numero,
            atual,
            novas,
          );

          verificados++;
          if (novas.length > 0) {
            comNovidade++;
            novidades += novas.length;
            this.log.info('novidade detectada', {
              numero: item.numero,
              quantas: novas.length,
            });
          }
        } catch (erro) {
          falhas++;
          // "Não encontrado" também é falha do ponto de vista da varredura, mas
          // não é ruído de sistema: o processo pode ter sido arquivado ou o
          // tribunal saído da cobertura. Registramos e seguimos.
          const nivel = erro instanceof ProcessoNaoEncontradoError ? 'debug' : 'warn';
          this.log[nivel]('falha ao sincronizar processo', {
            numero: item.numero,
            erro: descrever(erro),
          });
          await this.repo.registrarFalha(item.workspace, item.numero, descrever(erro));
        }

        if (this.pausaMs > 0) await dormir(this.pausaMs);
      }
    } finally {
      this.sincronizando = false;
    }

    const resultado = {
      verificados,
      comNovidade,
      novidades,
      falhas,
      duracaoMs: Date.now() - inicio,
    };
    this.log.info('varredura concluída', resultado);
    return resultado;
  }

  get emAndamento(): boolean {
    return this.sincronizando;
  }
}

export class SincronizacaoEmAndamentoError extends Error {
  readonly codigo = 'SINCRONIZACAO_EM_ANDAMENTO';
  constructor() {
    super('Já existe uma varredura em andamento. Aguarde a atual terminar.');
    this.name = 'SincronizacaoEmAndamentoError';
  }
}

function descrever(erro: unknown): string {
  if (erro instanceof DomainError) return `${erro.codigo}: ${erro.message}`;
  if (erro instanceof Error) return erro.message;
  return String(erro);
}

function dormir(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
