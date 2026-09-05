import type { Novidade } from '../../domain/entities/Acompanhamento.js';
import type { Logger } from '../../domain/ports/Logger.js';
import type { Mensagem, Notificador } from '../../domain/ports/Notificador.js';
import type { RepositorioAcompanhamentos } from '../../domain/ports/RepositorioAcompanhamentos.js';
import type { RepositorioNotificacao } from '../../domain/ports/RepositorioNotificacao.js';

const HORA_MS = 3_600_000;

export interface OpcoesServicoNotificacao {
  readonly preferencias: RepositorioNotificacao;
  readonly acompanhamentos: RepositorioAcompanhamentos;
  readonly notificador: Notificador;
  readonly logger: Logger;
  /** Endereço público do sistema, para os links do e-mail. */
  readonly urlBase?: string;
  /** Silêncio tolerado antes de avisar que a verificação parou. */
  readonly horasAteAlertar?: number;
  /** Intervalo mínimo entre dois alertas de silêncio para o mesmo workspace. */
  readonly horasEntreAlertas?: number;
  readonly agora?: () => Date;
}

/**
 * Transforma novidade detectada em aviso entregue.
 *
 * O princípio que organiza este arquivo: **notificação é uma promessa.** No dia
 * em que o advogado recebe o primeiro aviso, ele para de conferir manualmente e
 * passa a tratar silêncio como "não houve nada". Se a varredura morrer em
 * silêncio, o silêncio mente — e ele perde prazo confiando na gente.
 *
 * Por isso este serviço tem DUAS obrigações, e a segunda é tão importante
 * quanto a primeira:
 *
 *   1. avisar quando há novidade;
 *   2. avisar quando NÃO conseguimos verificar.
 *
 * Um sistema que só faz a primeira é pior do que não ter notificação nenhuma,
 * porque troca uma incerteza conhecida por uma falsa segurança.
 */
export class ServicoNotificacao {
  private readonly prefs: RepositorioNotificacao;
  private readonly acomp: RepositorioAcompanhamentos;
  private readonly notificador: Notificador;
  private readonly log: Logger;
  private readonly urlBase: string | undefined;
  private readonly horasAteAlertar: number;
  private readonly horasEntreAlertas: number;
  private readonly agora: () => Date;

  constructor(opcoes: OpcoesServicoNotificacao) {
    this.prefs = opcoes.preferencias;
    this.acomp = opcoes.acompanhamentos;
    this.notificador = opcoes.notificador;
    this.log = opcoes.logger.child({ servico: 'notificacao' });
    this.urlBase = opcoes.urlBase;
    this.horasAteAlertar = opcoes.horasAteAlertar ?? 26;
    this.horasEntreAlertas = opcoes.horasEntreAlertas ?? 12;
    this.agora = opcoes.agora ?? ((): Date => new Date());
  }

  /** Registra que uma varredura terminou bem. É o que arma a prova de vida. */
  async marcarVarreduraOk(): Promise<void> {
    await this.prefs.registrarVarreduraOk(this.agora());
  }

  /**
   * Percorre os workspaces com aviso ligado e manda o que houver.
   *
   * Roda DEPOIS da varredura, não durante: uma sincronização que descobre seis
   * novidades em quatro processos deve render um e-mail, não seis.
   */
  async despachar(): Promise<{ enviados: number; alertas: number }> {
    if (!this.notificador.habilitado) return { enviados: 0, alertas: 0 };

    const agora = this.agora();
    const ativas = await this.prefs.listarAtivas();
    const ultimaOk = await this.prefs.ultimaVarreduraOk();
    const cego =
      ultimaOk !== undefined &&
      agora.getTime() - ultimaOk.getTime() > this.horasAteAlertar * HORA_MS;

    let enviados = 0;
    let alertas = 0;

    for (const pref of ativas) {
      const email = pref.email;
      if (!email) continue;

      if (cego && ultimaOk && this.podeAlertar(pref.ultimoAlertaEm, agora)) {
        if (await this.notificador.enviar(this.montarAlerta(email, ultimaOk, agora))) {
          await this.prefs.registrarAlerta(pref.workspace, agora);
          alertas++;
        }
        // O alerta não impede o resumo: se houver novidade antiga não lida, ela
        // continua valendo. São informações diferentes.
      }

      const novidades = await this.acomp.listarNovidades(pref.workspace, {
        somenteNaoVistas: true,
        limite: 100,
        // +1ms porque o filtro do repositório é `detectada_em >= desde`, e
        // inclusivo aqui significa reenviar a cada ciclo a novidade que foi
        // detectada no mesmo instante do último envio. O usuário recebe o mesmo
        // aviso repetido e para de confiar no aviso.
        ...(pref.ultimoEnvioEm
          ? { desde: new Date(pref.ultimoEnvioEm.getTime() + 1) }
          : {}),
      });
      if (novidades.length === 0) continue;

      if (await this.notificador.enviar(this.montarResumo(email, novidades, agora))) {
        await this.prefs.registrarEnvio(pref.workspace, agora);
        enviados++;
        this.log.info('resumo enviado', {
          workspace: pref.workspace,
          novidades: novidades.length,
        });
      }
    }

    return { enviados, alertas };
  }

  private podeAlertar(ultimo: Date | undefined, agora: Date): boolean {
    if (!ultimo) return true;
    return agora.getTime() - ultimo.getTime() > this.horasEntreAlertas * HORA_MS;
  }

  private montarResumo(
    para: string,
    novidades: readonly Novidade[],
    agora: Date,
  ): Mensagem {
    const porProcesso = new Map<string, Novidade[]>();
    for (const n of novidades) {
      const lista = porProcesso.get(n.numero);
      if (lista) lista.push(n);
      else porProcesso.set(n.numero, [n]);
    }

    const total = novidades.length;
    const processos = porProcesso.size;
    const assunto =
      processos === 1
        ? `LexFlow: ${total} atualização(ões) em ${[...porProcesso.keys()][0]}`
        : `LexFlow: ${total} atualização(ões) em ${processos} processos`;

    const linhas: string[] = [
      `${total} atualização(ões) em ${processos} processo(s).`,
      '',
    ];

    for (const [numero, itens] of porProcesso) {
      linhas.push(`── ${numero}`);
      for (const n of itens) {
        linhas.push(`   ${formatarData(n.data)}  ${n.titulo}`);
        // O trecho do teor é o que dispensa abrir o sistema para saber se é
        // urgente. Cortado porque uma decisão tem 20 mil caracteres e o e-mail
        // é o resumo, não o processo.
        if (n.conteudo) linhas.push(`   ${recortar(n.conteudo, 240)}`);
      }
      linhas.push('');
    }

    if (this.urlBase) linhas.push(`Abrir: ${this.urlBase}`);
    linhas.push('');
    linhas.push(
      'Este resumo cobre o que o LexFlow detectou nas fontes públicas até ' +
        `${formatarDataHora(agora)}. A conferência do prazo continua sendo sua.`,
    );

    return { para, assunto, texto: linhas.join('\n') };
  }

  private montarAlerta(para: string, ultimaOk: Date, agora: Date): Mensagem {
    const horas = Math.floor((agora.getTime() - ultimaOk.getTime()) / HORA_MS);
    return {
      para,
      assunto: `LexFlow: ATENÇÃO — sem verificar seus processos há ${horas}h`,
      texto: [
        `O LexFlow não conclui uma verificação desde ${formatarDataHora(ultimaOk)}`,
        `— ou seja, há cerca de ${horas} horas.`,
        '',
        'Isto NÃO significa que não houve movimentação. Significa que não',
        'conseguimos olhar. Enquanto isso durar, confira seus processos',
        'diretamente no sistema do tribunal.',
        '',
        this.urlBase ? `Estado do sistema: ${this.urlBase}/ready` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    };
  }
}

function recortar(texto: string, limite: number): string {
  const limpo = texto.replace(/\s+/g, ' ').trim();
  return limpo.length <= limite ? limpo : `${limpo.slice(0, limite - 1)}…`;
}

function formatarData(d: Date): string {
  return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function formatarDataHora(d: Date): string {
  return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}
