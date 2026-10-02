import { describe, expect, it } from 'vitest';
import type { Novidade } from '../../src/domain/entities/Acompanhamento.js';
import { agruparNovidades } from '../../src/domain/entities/agruparNovidades.js';

const AGORA = new Date('2026-10-02T12:00:00Z');
const A = '00000011520268090011';
const B = '00000022020268090011';

let seq = 0;
function nov(
  numero: string,
  diasAtras: number,
  titulo: string,
  extra: Partial<Novidade> = {},
): Novidade {
  seq += 1;
  const detectadaEm = new Date(AGORA.getTime() - diasAtras * 86_400_000);
  return {
    id: seq,
    workspace: 'ws',
    numero,
    data: detectadaEm,
    titulo,
    detectadaEm,
    ...extra,
  };
}

describe('agrupamento das atualizações', () => {
  it('junta por processo, com a mais recente em destaque e as anteriores atrás', () => {
    const g = agruparNovidades(
      [
        nov(A, 5, 'Juntada'),
        nov(A, 1, 'Sentença'),
        nov(B, 2, 'Despacho'),
        nov(A, 3, 'Ato'),
      ],
      AGORA,
    );

    expect(g.grupos.map((x) => x.numero)).toEqual([A, B]);
    const a = g.grupos[0];
    expect(a?.maisRecente.titulo).toBe('Sentença');
    // "+N anteriores": as duas que sobraram, da mais recente para a mais antiga.
    expect(a?.anteriores.map((x) => x.titulo)).toEqual(['Ato', 'Juntada']);
    expect(g.grupos[1]?.anteriores).toEqual([]);
    expect(g.dentroDaJanela).toBe(4);
  });

  it('ordena as linhas pela atualização mais recente de cada processo', () => {
    const g = agruparNovidades([nov(A, 9, 'Velha'), nov(B, 2, 'Nova')], AGORA);
    expect(g.grupos.map((x) => x.numero)).toEqual([B, A]);
  });

  it('não confia na ordem de entrada', () => {
    const g = agruparNovidades([nov(A, 9, 'Velha'), nov(A, 1, 'Nova')], AGORA);
    expect(g.grupos[0]?.maisRecente.titulo).toBe('Nova');
  });

  it('a janela deixa de fora o que é mais antigo e DIZ quantas ficaram de fora', () => {
    const g = agruparNovidades(
      [
        nov(A, 2, 'Dentro'),
        nov(A, 15, 'Na borda'),
        nov(A, 16, 'Fora'),
        nov(B, 40, 'Fora também'),
      ],
      AGORA,
      15,
    );

    expect(g.dentroDaJanela).toBe(2);
    expect(g.foraDaJanela).toBe(2);
    // B só tinha atualização fora da janela: a linha some, a contagem não.
    expect(g.grupos.map((x) => x.numero)).toEqual([A]);
  });

  it('"Todas" não descarta nada', () => {
    const g = agruparNovidades(
      [nov(A, 2, 'a'), nov(A, 400, 'b'), nov(B, 90, 'c')],
      AGORA,
    );
    expect(g.foraDaJanela).toBe(0);
    expect(g.dentroDaJanela).toBe(3);
    expect(g.grupos.flatMap((x) => [x.maisRecente, ...x.anteriores])).toHaveLength(3);
  });

  it('conta ATUALIZAÇÕES não vistas por processo, não linhas', () => {
    const vista = { vistaEm: AGORA };
    const g = agruparNovidades(
      [nov(A, 1, 'a'), nov(A, 2, 'b', vista), nov(A, 3, 'c'), nov(B, 1, 'd', vista)],
      AGORA,
    );
    expect(g.grupos.find((x) => x.numero === A)?.naoVistas).toBe(2);
    expect(g.grupos.find((x) => x.numero === B)?.naoVistas).toBe(0);
  });

  it('a janela decide pela hora em que o sistema percebeu, não pela data do ato', () => {
    // Primeira varredura de um processo antigo: o ato é de meses atrás, mas a
    // novidade é de hoje — e é justamente a que o advogado ainda não viu.
    const n = nov(A, 0, 'Ato antigo recém-detectado', {
      data: new Date('2026-03-01T00:00:00Z'),
    });
    expect(agruparNovidades([n], AGORA, 15).grupos).toHaveLength(1);
  });

  it('não usa exigeAcao como critério: o ato de cartório fica na tela', () => {
    // Triagem ordena, nunca esconde. Nenhuma atualização some por parecer ruído.
    const g = agruparNovidades(
      [nov(A, 1, 'Juntada de Petição'), nov(A, 2, 'Expedição de Intimação')],
      AGORA,
      15,
    );
    expect(g.dentroDaJanela).toBe(2);
    expect(g.foraDaJanela).toBe(0);
  });
});
