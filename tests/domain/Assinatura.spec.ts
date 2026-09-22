import { describe, expect, it } from 'vitest';
import {
  Assinatura,
  DIAS_DE_CARENCIA_PADRAO,
  assinaturaDeTeste,
} from '../../src/domain/entities/Assinatura.js';
import {
  CODIGOS_DE_PLANO,
  PLANOS,
  PLANO_DO_TESTE,
  ehCodigoDePlano,
  planoInclui,
  planosAVenda,
} from '../../src/domain/entities/Plano.js';

const T0 = new Date('2026-09-22T12:00:00.000Z');
const dias = (n: number): Date => new Date(T0.getTime() + n * 86_400_000);

function paga(venceEmDias: number, carencia = DIAS_DE_CARENCIA_PADRAO): Assinatura {
  return new Assinatura({
    workspace: 'ws1',
    plano: 'pecas',
    inicioEm: T0,
    venceEm: dias(venceEmDias),
    ehTeste: false,
    diasDeCarencia: carencia,
  });
}

describe('Plano', () => {
  it('cada plano inclui os recursos do anterior', () => {
    // A escada precisa ser cumulativa: um assinante que sobe de plano não pode
    // PERDER nada no caminho. É o tipo de erro que só aparece no dia da troca.
    for (const recurso of PLANOS.acompanhamento.recursos) {
      expect(PLANOS.pecas.recursos).toContain(recurso);
    }
    for (const recurso of PLANOS.pecas.recursos) {
      expect(PLANOS.ia.recursos).toContain(recurso);
    }
  });

  it('só o plano de peças para cima inclui peças', () => {
    expect(planoInclui('acompanhamento', 'pecas')).toBe(false);
    expect(planoInclui('pecas', 'pecas')).toBe(true);
    expect(planoInclui('ia', 'pecas')).toBe(true);
  });

  it('o plano de IA NÃO está à venda enquanto a análise não existe', () => {
    /*
     * O teste que protege a promessa. O plano está modelado porque o produto
     * vai tê-lo, mas vendê-lo antes da funcionalidade existir é cobrar por algo
     * que não entrega — e com advogado isso não volta como pedido de reembolso,
     * volta como reclamação formal. Quando a análise ficar pronta, este teste
     * falha e é a hora de mudá-lo conscientemente.
     */
    expect(PLANOS.ia.disponivelParaContratacao).toBe(false);
    expect(planosAVenda().map((p) => p.codigo)).toEqual(['acompanhamento', 'pecas']);
  });

  it('o teste inicial entrega o plano que mostra o diferencial', () => {
    expect(planoInclui(PLANO_DO_TESTE, 'pecas')).toBe(true);
  });

  it('reconhece só os códigos que existem', () => {
    expect(CODIGOS_DE_PLANO.every(ehCodigoDePlano)).toBe(true);
    expect(ehCodigoDePlano('premium')).toBe(false);
    expect(ehCodigoDePlano('')).toBe(false);
  });
});

describe('Assinatura', () => {
  it('a linha do tempo de uma assinatura paga', () => {
    const a = paga(30);

    expect(a.statusEm(T0)).toBe('ativa');
    expect(a.statusEm(dias(29))).toBe('ativa');
    // Vence no dia 30, e a carência de 7 dias segura até o 37.
    expect(a.statusEm(dias(31))).toBe('carencia');
    expect(a.statusEm(dias(36))).toBe('carencia');
    expect(a.statusEm(dias(38))).toBe('vencida');
  });

  it('durante a carência o acesso continua aberto', () => {
    // O ponto inteiro da carência. Se `permite` fechasse aqui, a vigilância
    // pararia no minuto do vencimento — que costuma ser cartão recusado, não
    // decisão de cancelar — e o advogado deixaria de receber aviso de prazo
    // sem saber que deixou.
    const a = paga(10);
    expect(a.permite('vigilancia', dias(12))).toBe(true);
    expect(a.permite('pecas', dias(12))).toBe(true);
    expect(a.permite('vigilancia', dias(20))).toBe(false);
  });

  it('o cancelamento vence qualquer data de vigência', () => {
    const a = paga(90).cancelada(dias(5));
    expect(a.statusEm(dias(4))).toBe('ativa');
    expect(a.statusEm(dias(6))).toBe('cancelada');
    expect(a.permite('consulta', dias(6))).toBe(false);
  });

  it('plano vigente não libera recurso que o plano não tem', () => {
    // As duas perguntas são independentes, e `permite` é a conjunção delas.
    // Quem chama não deve refazer essa conta — foi por isso que ela veio parar
    // na entidade.
    const a = new Assinatura({
      workspace: 'ws1',
      plano: 'acompanhamento',
      inicioEm: T0,
      venceEm: dias(30),
      ehTeste: false,
      diasDeCarencia: 7,
    });
    expect(a.permite('acompanhamento', T0)).toBe(true);
    expect(a.permite('pecas', T0)).toBe(false);
  });

  it('dias para vencer arredonda para cima', () => {
    // Faltando 30 horas, a tela diz "2 dias". Arredondar para baixo anunciaria
    // um prazo MENOR que o real — num produto sobre prazo, é o erro na direção
    // errada.
    const a = paga(2);
    const trintaHorasAntes = new Date(a.venceEm.getTime() - 30 * 3_600_000);
    expect(a.diasParaVencer(trintaHorasAntes)).toBe(2);
    expect(a.diasParaVencer(dias(5))).toBeLessThan(0);
  });

  it('renovar em dia soma ao vencimento, não à data de hoje', () => {
    // Quem renova antes de vencer não pode PERDER os dias que já pagou. Esse
    // detalhe é invisível até o assinante conferir a data e reclamar — com
    // razão.
    const a = paga(20);
    const r = a.renovada({ meses: 1, agora: dias(10) });

    const esperado = new Date(a.venceEm.getTime());
    esperado.setMonth(esperado.getMonth() + 1);
    expect(r.venceEm.toISOString()).toBe(esperado.toISOString());
  });

  it('renovar depois de vencido conta a partir de hoje', () => {
    // O outro lado da mesma moeda: não se cobra por período em que o serviço
    // esteve fechado.
    const a = paga(5);
    const r = a.renovada({ meses: 1, agora: dias(40) });

    const esperado = dias(40);
    esperado.setMonth(esperado.getMonth() + 1);
    expect(r.venceEm.toISOString()).toBe(esperado.toISOString());
  });

  it('renovar encerra o teste', () => {
    const t = assinaturaDeTeste({ workspace: 'ws1', plano: 'pecas', agora: T0 });
    expect(t.statusEm(dias(3))).toBe('teste');

    const r = t.renovada({ meses: 1, agora: dias(3) });
    expect(r.ehTeste).toBe(false);
    expect(r.statusEm(dias(3))).toBe('ativa');
  });

  it('renovar pode trocar de plano', () => {
    const a = paga(10);
    expect(a.renovada({ meses: 3, agora: T0, plano: 'acompanhamento' }).plano).toBe(
      'acompanhamento',
    );
    // Sem informar o plano, mantém o atual.
    expect(a.renovada({ meses: 3, agora: T0 }).plano).toBe('pecas');
  });

  it('o teste dura 14 dias e NÃO tem carência', () => {
    // Quem não pagou nada não fica devendo nada — e esticar o teste em
    // silêncio só adia a decisão de assinar, sem informar ninguém.
    const t = assinaturaDeTeste({ workspace: 'ws1', plano: 'pecas', agora: T0 });

    expect(t.diasParaVencer(T0)).toBe(14);
    expect(t.statusEm(dias(13))).toBe('teste');
    expect(t.statusEm(dias(15))).toBe('vencida');
    expect(t.permite('pecas', dias(15))).toBe(false);
  });

  it('a entidade é imutável', () => {
    const a = paga(30);
    expect(Object.isFrozen(a)).toBe(true);
    // Renovar produz outra assinatura; a original não se altera.
    const antes = a.venceEm.toISOString();
    a.renovada({ meses: 6, agora: T0 });
    expect(a.venceEm.toISOString()).toBe(antes);
  });
});
