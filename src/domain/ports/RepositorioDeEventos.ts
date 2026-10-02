import type {
  EstadoDoEvento,
  EventoDeCalendario,
} from '../entities/EventoDeCalendario.js';

/** Um feed ICS assinável. O token em claro não existe aqui — só o hash. */
export interface FeedDoCalendario {
  readonly id: string;
  readonly workspace: string;
  readonly tokenHash: string;
  readonly incluiSugeridos: boolean;
  readonly criadoEm: Date;
  readonly revogadoEm?: Date;
}

export interface FiltroDeEventos {
  /** `AAAA-MM-DD`, inclusive. */
  readonly de: string;
  /** `AAAA-MM-DD`, inclusive. */
  readonly ate: string;
  /** Ausente = todos os estados. */
  readonly estados?: readonly EstadoDoEvento[];
}

/**
 * Persistência do calendário.
 *
 * **Toda consulta de evento leva `workspace`** — é a coluna que separa a agenda
 * de um advogado da de outro, e nenhum método aqui alcança evento sem dizer de
 * quem ele é. As duas exceções são de propósito e estão nomeadas: `feedPorHash`
 * (o token É a identificação; é dele que sai o workspace) e
 * `workspacesSemRetroativo` (a tarefa agendada, que é de todos — como a
 * varredura global).
 */
export interface RepositorioDeEventos {
  /**
   * Grava uma sugestão, a menos que a mesma já exista — inclusive descartada.
   * É o índice único da chave de detecção que garante isso, não o código.
   *
   * @returns `true` quando gravou.
   */
  inserirSeNovo(evento: EventoDeCalendario): Promise<boolean>;

  /** Grava evento novo (manual) ou a versão alterada de um existente. */
  salvar(evento: EventoDeCalendario): Promise<void>;

  buscar(workspace: string, id: string): Promise<EventoDeCalendario | undefined>;

  listar(workspace: string, filtro: FiltroDeEventos): Promise<EventoDeCalendario[]>;

  /** Quantos eventos há no intervalo, em qualquer estado — o "total sem filtro". */
  contar(workspace: string, de: string, ate: string): Promise<number>;

  /** Os detectados de um processo, para marcar revisão. */
  detectadosDoProcesso(workspace: string, numero: string): Promise<EventoDeCalendario[]>;

  /** Atualiza a cópia do sigilo em todos os eventos do processo. */
  atualizarSegredo(workspace: string, numero: string, segredo: boolean): Promise<void>;

  /** O feed vigente do workspace (no máximo um). */
  feedAtivo(workspace: string): Promise<FeedDoCalendario | undefined>;

  /** Feed (vigente ou revogado) pelo hash do token. */
  feedPorHash(tokenHash: string): Promise<FeedDoCalendario | undefined>;

  /**
   * Revoga o feed vigente do workspace e grava o novo, numa transação: entre
   * as duas operações não pode existir instante com dois feeds válidos.
   */
  substituirFeed(feed: FeedDoCalendario): Promise<void>;

  /**
   * Muda só a opção "incluir sugeridos" do feed vigente — o token continua o
   * mesmo, e a URL que já está no calendário do advogado segue valendo.
   *
   * @returns o feed alterado, ou `undefined` quando não há feed vigente.
   */
  alterarFeed(
    workspace: string,
    incluiSugeridos: boolean,
  ): Promise<FeedDoCalendario | undefined>;

  /** @returns `true` quando havia feed vigente para revogar. */
  revogarFeed(workspace: string, agora: Date): Promise<boolean>;

  /** Workspaces com processos acompanhados que ainda não tiveram o retroativo. */
  workspacesSemRetroativo(limite: number): Promise<string[]>;

  marcarRetroativo(workspace: string, agora: Date): Promise<void>;
}
