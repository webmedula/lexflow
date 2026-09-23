import { describe, expect, it } from 'vitest';
import { Peca, herdarOrigemPorMovimento } from '../../src/domain/entities/Peca.js';

function peca(props: {
  id: string;
  descricao?: string;
  movimento?: number;
}): Peca {
  return new Peca({
    id: props.id,
    tipo: '0',
    mimetype: 'application/pdf',
    ...(props.descricao !== undefined ? { descricao: props.descricao } : {}),
    ...(props.movimento !== undefined ? { movimento: props.movimento } : {}),
  });
}

describe('herança de origem pelo movimento', () => {
  it('o anexo sem rótulo herda a origem da petição do mesmo ato', () => {
    /*
     * O caso real que motivou tudo isto: num processo do TJGO, 111 das 278
     * peças chegaram com descricao="Outros" — 40% da lista em "origem não
     * identificada", todas PDF, todas na data de uma petição. São os anexos,
     * e o tribunal não rotula anexo.
     *
     * A dedução não é pelo nome: é pelo `movimento`, que a fonte afirma. Anexo
     * e petição compartilham o número porque foram juntados no mesmo ato.
     */
    const r = herdarOrigemPorMovimento([
      peca({ id: 'p1', descricao: 'Petição', movimento: 100 }),
      peca({ id: 'a1', descricao: 'Outros', movimento: 100 }),
      peca({ id: 'a2', descricao: 'Outros', movimento: 100 }),
    ]);

    expect(r.map((p) => p.origem)).toEqual(['PARTE', 'PARTE', 'PARTE']);
    // E fica marcado que os dois últimos foram DEDUZIDOS. O que a fonte
    // afirmou e o que o sistema concluiu não podem virar a mesma coisa.
    expect(r.map((p) => p.origemDeduzida)).toEqual([false, true, true]);
  });

  it('o rótulo do tribunal vence a dedução, sempre', () => {
    const r = herdarOrigemPorMovimento([
      peca({ id: 'p1', descricao: 'Petição', movimento: 100 }),
      peca({ id: 'c1', descricao: 'Certidão', movimento: 100 }),
    ]);
    // Movimento com as duas origens: a certidão continua do juízo.
    expect(r[1]?.origem).toBe('JUIZO');
    expect(r[1]?.origemDeduzida).toBe(false);
  });

  it('movimento com origens conflitantes NÃO deduz nada', () => {
    /*
     * A regra que impede a invenção. Se no mesmo ato há peça de parte e peça
     * de juízo, qualquer escolha para o documento sem rótulo seria chute — e
     * chute aqui vira "a outra parte juntou isto", que é o pior erro possível
     * nesta tela.
     */
    const r = herdarOrigemPorMovimento([
      peca({ id: 'p1', descricao: 'Petição', movimento: 100 }),
      peca({ id: 'c1', descricao: 'Certidão', movimento: 100 }),
      peca({ id: 'x1', descricao: 'Outros', movimento: 100 }),
    ]);
    expect(r[2]?.origem).toBe('DESCONHECIDA');
    expect(r[2]?.origemDeduzida).toBe(false);
  });

  it('peça sem movimento continua desconhecida', () => {
    // Sem a relação afirmada pela fonte, não há de onde deduzir. A resposta
    // honesta é não saber.
    const r = herdarOrigemPorMovimento([
      peca({ id: 'p1', descricao: 'Petição', movimento: 100 }),
      peca({ id: 'x1', descricao: 'Outros' }),
    ]);
    expect(r[1]?.origem).toBe('DESCONHECIDA');
  });

  it('movimento só com peças sem rótulo não inventa origem', () => {
    const r = herdarOrigemPorMovimento([
      peca({ id: 'x1', descricao: 'Outros', movimento: 7 }),
      peca({ id: 'x2', descricao: 'Outros', movimento: 7 }),
    ]);
    expect(r.every((p) => p.origem === 'DESCONHECIDA')).toBe(true);
  });

  it('a dedução não altera a peça original — a entidade é imutável', () => {
    const original = peca({ id: 'a1', descricao: 'Outros', movimento: 100 });
    herdarOrigemPorMovimento([
      peca({ id: 'p1', descricao: 'Petição', movimento: 100 }),
      original,
    ]);
    expect(original.origem).toBe('DESCONHECIDA');
  });

  it('a cópia deduzida preserva os campos que importam para baixar', () => {
    // Perder id ou mimetype aqui quebraria o download e o rótulo do botão, e
    // o sintoma apareceria longe da causa.
    const r = herdarOrigemPorMovimento([
      peca({ id: 'p1', descricao: 'Petição', movimento: 100 }),
      peca({ id: 'a1', descricao: 'Outros', movimento: 100 }),
    ]);
    expect(r[1]?.id).toBe('a1');
    expect(r[1]?.mimetype).toBe('application/pdf');
    expect(r[1]?.movimento).toBe(100);
    expect(r[1]?.rotulo).toBe('Outros');
  });
});
