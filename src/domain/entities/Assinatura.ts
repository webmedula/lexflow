import { PLANOS, planoInclui } from './Plano.js';
import type { CodigoPlano, Plano, RecursoDoPlano } from './Plano.js';

/**
 * Estado de uma assinatura num instante.
 *
 * `teste` e `ativa` são o mesmo estado do ponto de vista do acesso — a
 * diferença existe porque a TELA precisa dizer coisas diferentes. Colapsar os
 * dois faria o assinante em teste não saber que está em teste, e descobrir no
 * dia em que parar de funcionar.
 */
export type StatusAssinatura = 'teste' | 'ativa' | 'carencia' | 'vencida' | 'cancelada';

export interface DadosAssinatura {
  readonly workspace: string;
  readonly plano: CodigoPlano;
  readonly inicioEm: Date;
  readonly venceEm: Date;
  /** Verdadeiro enquanto for o teste inicial de 14 dias. */
  readonly ehTeste: boolean;
  /** Dias após o vencimento em que tudo continua funcionando. */
  readonly diasDeCarencia: number;
  readonly canceladaEm?: Date;
  /** Anotação do operador: "Pix 22/09", "cortesia", "migrou do plano X". */
  readonly observacao?: string;
}

/** Padrão de carência. Ver o comentário em `statusEm`. */
export const DIAS_DE_CARENCIA_PADRAO = 7;

/** Duração do teste de conta nova. */
export const DIAS_DE_TESTE = 14;

/**
 * A assinatura de um workspace.
 *
 * Imutável, como toda entidade daqui: renovar produz outra assinatura, não
 * altera esta. O status NÃO é guardado — é derivado das datas a cada consulta.
 *
 * **Por que derivar em vez de guardar:** status gravado precisa de alguém que
 * o atualize, e esse alguém é sempre uma tarefa agendada que pode não ter
 * rodado. Uma assinatura que venceu às 3h da manhã e ficou marcada como
 * `ativa` até a tarefa das 6h é uma hora em que o sistema mente. Data não
 * mente: `venceEm` comparado com `agora` dá a resposta certa em todo instante,
 * inclusive depois de um contêiner ficar dois dias fora do ar.
 */
export class Assinatura {
  readonly workspace: string;
  readonly plano: CodigoPlano;
  readonly inicioEm: Date;
  readonly venceEm: Date;
  readonly ehTeste: boolean;
  readonly diasDeCarencia: number;
  readonly canceladaEm: Date | undefined;
  readonly observacao: string | undefined;

  constructor(dados: DadosAssinatura) {
    this.workspace = dados.workspace;
    this.plano = dados.plano;
    this.inicioEm = dados.inicioEm;
    this.venceEm = dados.venceEm;
    this.ehTeste = dados.ehTeste;
    this.diasDeCarencia = dados.diasDeCarencia;
    this.canceladaEm = dados.canceladaEm;
    this.observacao = dados.observacao;
    Object.freeze(this);
  }

  get detalhesDoPlano(): Plano {
    return PLANOS[this.plano];
  }

  /** Instante em que a carência acaba e o acesso fecha. */
  get fimDaCarencia(): Date {
    return new Date(this.venceEm.getTime() + this.diasDeCarencia * 86_400_000);
  }

  /**
   * O status naquele instante.
   *
   * A carência existe por uma razão que não é gentileza comercial: o produto
   * promete vigiar prazo. Cortar a vigilância no minuto do vencimento — que
   * costuma ser falha de cartão, não decisão de cancelar — faz o advogado
   * deixar de receber o aviso sem saber que deixou. A carência dá tempo de o
   * aviso chegar e ser lido, e é o que separa "você não pagou" de "você perdeu
   * um prazo porque nós paramos de avisar e não te contamos".
   */
  statusEm(agora: Date): StatusAssinatura {
    if (this.canceladaEm && agora.getTime() >= this.canceladaEm.getTime())
      return 'cancelada';
    if (agora.getTime() <= this.venceEm.getTime())
      return this.ehTeste ? 'teste' : 'ativa';
    if (agora.getTime() <= this.fimDaCarencia.getTime()) return 'carencia';
    return 'vencida';
  }

  /** Se o acesso está aberto: vale em teste, ativa e durante a carência. */
  estaVigenteEm(agora: Date): boolean {
    const s = this.statusEm(agora);
    return s === 'teste' || s === 'ativa' || s === 'carencia';
  }

  /**
   * Se este workspace pode usar o recurso agora.
   *
   * Duas perguntas em uma, e as duas precisam ser verdadeiras: a assinatura
   * está vigente E o plano inclui o recurso. Quem chama não deve reimplementar
   * essa conjunção — foi para isso que ela veio parar aqui.
   */
  permite(recurso: RecursoDoPlano, agora: Date): boolean {
    return this.estaVigenteEm(agora) && planoInclui(this.plano, recurso);
  }

  /**
   * Dias inteiros até vencer. Negativo depois de vencido.
   *
   * Arredonda para CIMA: faltando 30 horas, o assinante lê "2 dias", não "1".
   * Arredondar para baixo faria a tela anunciar um prazo menor que o real, e
   * num produto sobre prazo isso é o erro na direção errada.
   */
  diasParaVencer(agora: Date): number {
    return Math.ceil((this.venceEm.getTime() - agora.getTime()) / 86_400_000);
  }

  /** Renova a partir do fim da vigência atual, ou de agora se já venceu. */
  renovada(opcoes: {
    readonly plano?: CodigoPlano;
    readonly meses: number;
    readonly agora: Date;
    readonly observacao?: string;
  }): Assinatura {
    // Renovar a partir do vencimento (e não de hoje) é o que impede o
    // assinante em dia de PERDER dias por renovar cedo. Se já venceu, começa
    // agora: não se cobra por período em que o serviço esteve fechado.
    const base =
      this.venceEm.getTime() > opcoes.agora.getTime() ? this.venceEm : opcoes.agora;
    const fim = new Date(base.getTime());
    fim.setMonth(fim.getMonth() + opcoes.meses);

    return new Assinatura({
      workspace: this.workspace,
      plano: opcoes.plano ?? this.plano,
      inicioEm: this.inicioEm,
      venceEm: fim,
      // Renovar encerra o teste: a partir daqui é assinatura paga.
      ehTeste: false,
      diasDeCarencia: this.diasDeCarencia,
      ...(opcoes.observacao !== undefined ? { observacao: opcoes.observacao } : {}),
    });
  }

  cancelada(agora: Date, observacao?: string): Assinatura {
    return new Assinatura({
      workspace: this.workspace,
      plano: this.plano,
      inicioEm: this.inicioEm,
      venceEm: this.venceEm,
      ehTeste: this.ehTeste,
      diasDeCarencia: this.diasDeCarencia,
      canceladaEm: agora,
      ...(observacao !== undefined ? { observacao } : {}),
    });
  }
}

/** A assinatura de teste que toda conta nova recebe no cadastro. */
export function assinaturaDeTeste(opcoes: {
  readonly workspace: string;
  readonly plano: CodigoPlano;
  readonly agora: Date;
  readonly dias?: number;
}): Assinatura {
  const dias = opcoes.dias ?? DIAS_DE_TESTE;
  return new Assinatura({
    workspace: opcoes.workspace,
    plano: opcoes.plano,
    inicioEm: opcoes.agora,
    venceEm: new Date(opcoes.agora.getTime() + dias * 86_400_000),
    ehTeste: true,
    // Teste não tem carência: quem não pagou nada não fica devendo nada, e
    // esticar o teste em silêncio só adia a decisão de assinar.
    diasDeCarencia: 0,
  });
}
