import { describe, expect, it } from 'vitest';
import { estadoDaPasta } from '../../src/domain/entities/estadoDaPasta.js';
import type { Movimentacao } from '../../src/domain/entities/Movimentacao.js';

const AGORA = new Date('2026-09-24T12:00:00');

function mov(diasAtras: number, titulo: string, conteudo?: string): Movimentacao {
  return {
    data: new Date(AGORA.getTime() - diasAtras * 86_400_000),
    titulo,
    ...(conteudo !== undefined ? { conteudo } : {}),
  };
}

describe('estado da pasta', () => {
  it('determinação recente marca providência, com o motivo à vista', () => {
    const e = estadoDaPasta(
      {
        sincronizadoEm: AGORA,
        movimentacoes: [mov(3, 'Despacho', 'Intime-se a parte autora.')],
      },
      AGORA,
    );
    expect(e.rotulo).toBe('PROVIDENCIA');
    // O motivo vai para o title do selo. Heurística sem explicação não se
    // audita — e é o advogado quem responde pelo prazo, não a tela.
    expect(e.motivo).toContain('Despacho');
  });

  it('a mesma determinação velha NÃO marca providência', () => {
    /*
     * Sem janela, um "intime-se" de 2019 deixaria a pasta em vermelho para
     * sempre. Numa carteira antiga isso significa toda linha marcada, e um selo
     * que aparece em tudo deixa de dizer qualquer coisa — o advogado passa a
     * ignorá-lo justamente quando ele estiver certo.
     */
    const e = estadoDaPasta(
      {
        sincronizadoEm: AGORA,
        movimentacoes: [mov(400, 'Despacho', 'Intime-se a parte autora.')],
      },
      AGORA,
    );
    expect(e.rotulo).toBe('EM_CURSO');
  });

  it('providência vence novidade', () => {
    // As duas coexistem o tempo todo; o selo é um só. Prazo aberto é o que muda
    // o dia da pessoa — "tem coisa nova" ela descobre abrindo.
    const e = estadoDaPasta(
      {
        sincronizadoEm: AGORA,
        novidadesNaoVistas: 3,
        movimentacoes: [mov(1, 'Decisão', 'Manifeste-se em 15 dias.')],
      },
      AGORA,
    );
    expect(e.rotulo).toBe('PROVIDENCIA');
  });

  it('o arquivamento se decide pelo ato MAIS RECENTE, nunca pelo histórico', () => {
    /*
     * Processo arquivado e depois desarquivado tem os dois atos nos autos.
     * Olhar "existe arquivamento no histórico" marcaria como encerrada uma
     * pasta que voltou a correr — e o advogado deixaria de olhar justamente a
     * que voltou.
     */
    const e = estadoDaPasta(
      {
        sincronizadoEm: AGORA,
        movimentacoes: [
          mov(100, 'Arquivamento definitivo'),
          mov(2, 'Desarquivamento dos autos'),
        ],
      },
      AGORA,
    );
    expect(e.rotulo).toBe('EM_CURSO');
  });

  it('arquivado de verdade fica arquivado', () => {
    const e = estadoDaPasta(
      { sincronizadoEm: AGORA, movimentacoes: [mov(10, 'Arquivamento definitivo')] },
      AGORA,
    );
    expect(e.rotulo).toBe('ARQUIVADO');
  });

  it('a falha de verificação NÃO ocupa o lugar do selo', () => {
    /*
     * A regra mais importante do arquivo. Uma pasta com prazo aberto que está
     * há três dias sem verificação precisa dizer as duas coisas: o que fazer
     * hoje e por que não confiar no silêncio. Um selo só teria de escolher, e
     * não existe escolha boa.
     */
    const e = estadoDaPasta(
      {
        erro: 'tribunal fora do ar',
        sincronizadoEm: AGORA,
        movimentacoes: [mov(1, 'Despacho', 'Intime-se.')],
      },
      AGORA,
    );
    expect(e.rotulo).toBe('PROVIDENCIA');
    expect(e.naoVerificado).toBe(true);
  });

  it('nunca sincronizado também é não verificado', () => {
    // Pasta recém-adicionada, antes da primeira consulta. Dizer "em curso" sem
    // ressalva afirmaria um estado que ninguém conferiu.
    const e = estadoDaPasta({ movimentacoes: [] }, AGORA);
    expect(e.naoVerificado).toBe(true);
    expect(e.rotulo).toBe('EM_CURSO');
  });

  it('novidade não lida, sem prazo, marca novidade', () => {
    const e = estadoDaPasta(
      {
        sincronizadoEm: AGORA,
        novidadesNaoVistas: 2,
        movimentacoes: [mov(1, 'Juntada de petição')],
      },
      AGORA,
    );
    expect(e.rotulo).toBe('NOVIDADE');
  });

  it('respeita o exigeAcao que a fonte já trouxe, sem reclassificar', () => {
    // Duas heurísticas para a mesma coisa divergem no dia em que alguém ajusta
    // só uma. Quando a movimentação já vem triada, o valor dela vale.
    const e = estadoDaPasta(
      {
        sincronizadoEm: AGORA,
        movimentacoes: [{ ...mov(2, 'Ato sem verbo reconhecível'), exigeAcao: true }],
      },
      AGORA,
    );
    expect(e.rotulo).toBe('PROVIDENCIA');
  });
});
