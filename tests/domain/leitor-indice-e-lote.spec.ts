import { describe, expect, it } from 'vitest';
import { montarIndice, paginasDoIndice } from '../../src/domain/entities/IndicePagina.js';
import {
  estimarSegundos,
  progressoDoJob,
  proximoTamanhoDeLote,
} from '../../src/domain/entities/JobLeitor.js';
import type { JobLeitor } from '../../src/domain/entities/JobLeitor.js';

const POLITICA = {
  inicial: 10,
  maximo: 20,
  limiteRespostaBytes: 12_000_000,
  limiarCrescimentoBytes: 3_000_000,
};

describe('índice de páginas', () => {
  it('soma as páginas na ordem e diz onde cada peça começa e termina', () => {
    const indice = montarIndice([
      { pecaId: 'a', rotulo: 'Petição', situacao: 'incorporada', paginas: 3 },
      {
        pecaId: 'b',
        rotulo: 'Outros',
        situacao: 'nao_obtida',
        motivo: 'sem teor',
        paginas: 1,
      },
      {
        pecaId: 'c',
        rotulo: 'Decisão',
        situacao: 'incorporada',
        paginas: 2,
        movimento: 7,
      },
    ]);
    expect(indice.map((e) => [e.pecaId, e.paginaInicial, e.paginaFinal])).toEqual([
      ['a', 1, 3],
      ['b', 4, 4],
      ['c', 5, 6],
    ]);
    expect(indice[2]?.movimento).toBe(7);
    expect(paginasDoIndice(indice)).toBe(6);
  });

  it('recusa peça com zero página: contagem zero é conferência que não aconteceu', () => {
    expect(() =>
      montarIndice([{ pecaId: 'a', rotulo: 'x', situacao: 'incorporada', paginas: 0 }]),
    ).toThrow(RangeError);
  });
});

describe('lote adaptativo por bytes', () => {
  it('passou do limite: metade, e trava', () => {
    expect(
      proximoTamanhoDeLote(
        10,
        false,
        { bytes: 13_000_000, houveAusencia: false },
        POLITICA,
      ),
    ).toEqual({ tamanho: 5, travado: true });
    expect(
      proximoTamanhoDeLote(
        1,
        true,
        { bytes: 50_000_000, houveAusencia: false },
        POLITICA,
      ),
    ).toEqual({ tamanho: 1, travado: true });
  });

  it('resposta leve dobra até o máximo, se nunca travou', () => {
    expect(
      proximoTamanhoDeLote(10, false, { bytes: 500_000, houveAusencia: false }, POLITICA),
    ).toEqual({ tamanho: 20, travado: false });
    expect(
      proximoTamanhoDeLote(20, false, { bytes: 500_000, houveAusencia: false }, POLITICA),
    ).toEqual({ tamanho: 20, travado: false });
  });

  it('nunca cresce depois de falha ou de redução', () => {
    expect(
      proximoTamanhoDeLote(10, false, { bytes: 500_000, houveAusencia: true }, POLITICA),
    ).toEqual({ tamanho: 10, travado: true });
    expect(
      proximoTamanhoDeLote(5, true, { bytes: 500_000, houveAusencia: false }, POLITICA),
    ).toEqual({ tamanho: 5, travado: true });
  });

  it('resposta média mantém o tamanho', () => {
    expect(
      proximoTamanhoDeLote(
        10,
        false,
        { bytes: 6_000_000, houveAusencia: false },
        POLITICA,
      ),
    ).toEqual({ tamanho: 10, travado: false });
  });
});

describe('estimativa de tempo (medida, não suposta)', () => {
  it('278 peças em lotes de 10, a 1,8 s + 3 s por chamada: ~2,5 min', () => {
    // 28 lotes + listagem + consultarAlteracao = 30 chamadas × 4,8 s.
    expect(
      estimarSegundos(278, {
        tamanhoLote: 10,
        segundosPorChamada: 1.8,
        pausaSegundos: 3,
      }),
    ).toBe(144);
    expect(
      estimarSegundos(0, { tamanhoLote: 10, segundosPorChamada: 1.8, pausaSegundos: 3 }),
    ).toBe(0);
  });
});

describe('progresso', () => {
  it('conta baixadas, pendentes e lista as recusadas com o motivo legível', () => {
    const job = {
      pedidas: ['a', 'b', 'c'],
      pecas: [
        { pecaId: 'a', ordem: 0, rotulo: 'A', situacao: 'obtida' },
        {
          pecaId: 'b',
          ordem: 1,
          rotulo: 'B',
          situacao: 'nao_obtida',
          motivo: 'sem_teor',
        },
        { pecaId: 'c', ordem: 2, rotulo: 'C', situacao: 'pendente' },
      ],
    } as unknown as JobLeitor;
    const p = progressoDoJob(job);
    expect(p).toMatchObject({ total: 3, baixadas: 1, pendentes: 1 });
    expect(p.recusadas[0]).toMatchObject({ pecaId: 'b', motivo: 'sem_teor' });
    expect(p.recusadas[0]?.descricao).toContain('procuração');
  });
});
