import type { Acompanhamento, Novidade } from '../entities/Acompanhamento.js';
import type { Movimentacao } from '../entities/Movimentacao.js';
import type { Processo } from '../entities/Processo.js';

/** Filtros da lista de processos acompanhados. */
export interface FiltroAcompanhamentos {
  /** Busca livre em número, apelido, vara, classe e assunto. */
  readonly texto?: string;
  readonly tribunal?: string;
  readonly classe?: string;
  /** Só os que têm novidade não lida. */
  readonly somenteComNovidade?: boolean;
  /** Última movimentação nos últimos N dias. */
  readonly movimentadoNosUltimosDias?: number;
  readonly ordem?: 'MOVIMENTACAO_RECENTE' | 'ADICIONADO_RECENTE' | 'NUMERO';
}

export interface FiltroNovidades {
  readonly numero?: string;
  readonly tribunal?: string;
  readonly somenteNaoVistas?: boolean;
  readonly desde?: Date;
  readonly limite?: number;
}

/** Um acompanhamento com os números que a lista precisa mostrar. */
export interface AcompanhamentoResumido extends Acompanhamento {
  readonly novidadesNaoVistas: number;
  readonly ultimaMovimentacao?: Movimentacao;
}

/**
 * Porta de persistência do acompanhamento.
 *
 * Hoje implementada em SQLite num arquivo. Trocar por Postgres, quando houver
 * mais de uma instância, é escrever outra classe que cumpra esta interface —
 * nada acima daqui muda.
 */
export interface RepositorioAcompanhamentos {
  acompanhar(
    workspace: string,
    numero: string,
    apelido?: string,
  ): Promise<Acompanhamento>;

  deixarDeAcompanhar(workspace: string, numero: string): Promise<boolean>;

  buscar(workspace: string, numero: string): Promise<Acompanhamento | undefined>;

  listar(
    workspace: string,
    filtro?: FiltroAcompanhamentos,
  ): Promise<AcompanhamentoResumido[]>;

  /** Todos os acompanhamentos de TODOS os workspaces, para a varredura. */
  listarParaSincronizar(limite: number): Promise<Acompanhamento[]>;

  /** Grava o retrato novo e registra as movimentações inéditas. */
  registrarSincronizacao(
    workspace: string,
    numero: string,
    processo: Processo,
    novidades: readonly Movimentacao[],
  ): Promise<void>;

  registrarFalha(workspace: string, numero: string, erro: string): Promise<void>;

  listarNovidades(workspace: string, filtro?: FiltroNovidades): Promise<Novidade[]>;

  contarNaoVistas(workspace: string): Promise<number>;

  /** Marca como lidas. Sem `numero`, marca todas do workspace. */
  marcarComoVistas(workspace: string, numero?: string): Promise<number>;

  /** Valores distintos para alimentar os seletores de filtro. */
  facetas(workspace: string): Promise<{ tribunais: string[]; classes: string[] }>;
}
