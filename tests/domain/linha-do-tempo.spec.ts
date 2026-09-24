import { describe, expect, it } from 'vitest';
import { Peca } from '../../src/domain/entities/Peca.js';
import type { Movimentacao } from '../../src/domain/entities/Movimentacao.js';
import {
  batizarPeloCodigo,
  montarLinhaDoTempo,
} from '../../src/domain/entities/linhaDoTempo.js';

function mov(props: {
  dia: string;
  titulo: string;
  id?: number;
  tpu?: number;
  conteudo?: string;
  fonte?: string;
}): Movimentacao {
  return {
    data: new Date(props.dia),
    titulo: props.titulo,
    ...(props.tpu !== undefined ? { codigoTpu: props.tpu } : {}),
    ...(props.conteudo !== undefined ? { conteudo: props.conteudo } : {}),
    ...(props.id !== undefined ? { idExterno: `mni:${props.id}` } : {}),
    ...(props.fonte !== undefined ? { fonte: props.fonte } : {}),
  };
}

function peca(props: {
  id: string;
  descricao?: string;
  movimento?: number;
  dataHora?: string;
}): Peca {
  return new Peca({
    id: props.id,
    tipo: '0',
    mimetype: 'application/pdf',
    ...(props.descricao !== undefined ? { descricao: props.descricao } : {}),
    ...(props.movimento !== undefined ? { movimento: props.movimento } : {}),
    ...(props.dataHora !== undefined ? { dataHora: new Date(props.dataHora) } : {}),
  });
}

describe('régua temporal — o documento na linha do evento', () => {
  it('a peça vai para o evento que a juntou, pela chave do tribunal', () => {
    /*
     * O ajuste que um advogado em exercício pediu como o mais urgente: ler
     * "14/09 · Petição da parte", memorizar a data e rolar até o rodapé para
     * caçar o arquivo no meio de 278 peças não acontece na correria de um
     * escritório.
     *
     * A junção NÃO é por data nem por semelhança de nome — é pelo número que o
     * `<documento>` carrega apontando para o `<movimento>` que o juntou, dentro
     * da MESMA resposta do MNI. Casar por data penduraria a contestação embaixo
     * do despacho errado, que é o erro mais caro possível nesta tela.
     */
    const linha = montarLinhaDoTempo({
      movimentacoes: [],
      movimentosDoTribunal: [
        mov({ dia: '2026-09-14T10:00:00', titulo: 'Juntada de Petição', id: 100 }),
        mov({ dia: '2026-09-01T10:00:00', titulo: 'Conclusão para decisão', id: 90 }),
      ],
      pecas: [
        peca({ id: 'p1', descricao: 'Petição', movimento: 100 }),
        peca({ id: 'a1', descricao: 'Outros', movimento: 100 }),
      ],
    });

    expect(linha.eventos[0]?.pecas?.map((p) => p.id)).toEqual(['p1', 'a1']);
    expect(linha.eventos[1]?.pecas).toBeUndefined();
    expect(linha.pecasSoltas).toHaveLength(0);
    expect(linha.resumo.espinha).toBe('tribunal');
    expect(linha.resumo.pecasAcopladas).toBe(2);
  });

  it('chave que não bate em NADA degrada para a tela anterior', () => {
    /*
     * A garantia que permite entregar isto antes de a sonda confirmar o
     * comportamento no tribunal. A correspondência está na especificação do MNI
     * 2.2.2 e foi vista num Projudi; o próximo tribunal pode numerar de outro
     * jeito. Nesse dia o sistema tem de ficar PIOR, nunca quebrado: linha do
     * tempo das fontes públicas e todas as peças na lista, exatamente como
     * antes.
     */
    const linha = montarLinhaDoTempo({
      movimentacoes: [mov({ dia: '2026-09-14T10:00:00', titulo: 'Decisão', tpu: 219 })],
      movimentosDoTribunal: [
        mov({ dia: '2026-09-14T10:00:00', titulo: 'Juntada', id: 100 }),
      ],
      pecas: [peca({ id: 'p1', descricao: 'Petição', movimento: 777 })],
    });

    expect(linha.resumo.espinha).toBe('fontes-publicas');
    expect(linha.eventos).toHaveLength(1);
    expect(linha.eventos[0]?.titulo).toBe('Decisão');
    expect(linha.pecasSoltas.map((p) => p.id)).toEqual(['p1']);
  });

  it('a contagem de atos NUNCA diminui ao trocar de espinha', () => {
    /*
     * A regra herdada de `fusaoProcessos.ts`, e a razão é a mesma: duas linhas
     * descrevendo o mesmo ato é incômodo visual; uma linha ausente é prazo
     * perdido. Aqui o DataJud tem TRÊS juntadas no dia e o tribunal mandou
     * duas — a terceira fica.
     */
    const dia = '2026-09-14T10:00:00';
    const linha = montarLinhaDoTempo({
      movimentacoes: [
        mov({ dia, titulo: 'Juntada de petição', tpu: 581 }),
        mov({ dia, titulo: 'Juntada de petição', tpu: 581 }),
        mov({ dia, titulo: 'Juntada de petição', tpu: 581 }),
      ],
      movimentosDoTribunal: [
        mov({ dia, titulo: 'Juntada de petição', tpu: 581, id: 1 }),
        mov({ dia, titulo: 'Juntada de petição', tpu: 581, id: 2 }),
      ],
      pecas: [peca({ id: 'p1', movimento: 1, descricao: 'Petição' })],
    });

    // 2 do tribunal + 1 do DataJud que sobrou = 3. Nenhum ato sumiu.
    expect(linha.eventos).toHaveLength(3);
  });

  it('a publicação do DJEN que o tribunal não numera continua na régua', () => {
    // O DJEN traz o INTEIRO TEOR do que foi publicado, e o MNI não o repete.
    // Descartar a linha do DJEN porque o MNI é "mais confiável" perderia
    // justamente o texto do despacho.
    const linha = montarLinhaDoTempo({
      movimentacoes: [
        mov({
          dia: '2026-03-03T00:00:00',
          titulo: 'Decisão',
          conteudo: 'Intime-se a parte autora.',
          fonte: 'djen',
        }),
      ],
      movimentosDoTribunal: [
        mov({ dia: '2026-09-14T10:00:00', titulo: 'Juntada', id: 100 }),
      ],
      pecas: [peca({ id: 'p1', movimento: 100, descricao: 'Petição' })],
    });

    const djen = linha.eventos.find((e) => e.fonte === 'djen');
    expect(djen?.conteudo).toBe('Intime-se a parte autora.');
    expect(djen?.exigeAcao).toBe(true);
  });

  it('o evento que entrega documento NUNCA é marcado como ruído', () => {
    /*
     * "Juntada de Petição de Contestação" casa com a lista de cartório pelo
     * verbo "juntada" — e é literalmente a peça da outra parte chegando aos
     * autos, uma das três coisas que o advogado disse procurar. Um filtro
     * ingênuo a esconderia junto com as confirmações de cartório.
     */
    const linha = montarLinhaDoTempo({
      movimentacoes: [],
      movimentosDoTribunal: [
        mov({ dia: '2026-09-14T10:00:00', titulo: 'Juntada de Contestação', id: 1 }),
        mov({ dia: '2026-09-13T10:00:00', titulo: 'Expedição de certidão', id: 2 }),
      ],
      pecas: [peca({ id: 'p1', movimento: 1, descricao: 'Contestação' })],
    });

    expect(linha.eventos[0]?.ehRuido).toBeUndefined();
    expect(linha.eventos[1]?.ehRuido).toBe(true);
    expect(linha.resumo.ruido).toBe(1);
  });

  it('a peça órfã COM data vira evento próprio, no lugar cronológico', () => {
    // Melhor do que mandá-la ao rodapé: aparece onde o advogado vai procurar. O
    // que ela não faz é fingir saber de que ato faz parte.
    const linha = montarLinhaDoTempo({
      movimentacoes: [],
      movimentosDoTribunal: [
        mov({ dia: '2026-09-01T10:00:00', titulo: 'Juntada', id: 1 }),
      ],
      pecas: [
        peca({ id: 'p1', movimento: 1, descricao: 'Petição' }),
        peca({ id: 'x1', descricao: 'Laudo', dataHora: '2026-09-20T10:00:00' }),
        peca({ id: 'x2', descricao: 'Sem data' }),
      ],
    });

    expect(linha.eventos[0]?.titulo).toBe('Laudo');
    expect(linha.eventos[0]?.pecas?.[0]?.id).toBe('x1');
    // A sem data não tem onde ser posta na régua: vai para a lista, não some.
    expect(linha.pecasSoltas.map((p) => p.id)).toEqual(['x2']);
  });

  it('decisão é destacada, e juntada de decisão não é', () => {
    // O destaque é do pronunciamento. "Juntada de cópia da decisão" é cartório
    // levando a decisão aos autos — marcar as duas igual esvazia o destaque.
    const linha = montarLinhaDoTempo({
      movimentacoes: [],
      movimentosDoTribunal: [
        mov({ dia: '2026-03-03T10:00:00', titulo: 'Decisão', id: 1 }),
        mov({ dia: '2026-03-04T10:00:00', titulo: 'Juntada de cópia da decisão', id: 2 }),
      ],
      pecas: [peca({ id: 'p1', movimento: 1, descricao: 'Decisão' })],
    });

    expect(linha.eventos.find((e) => e.titulo === 'Decisão')?.ehDecisao).toBe(true);
    expect(
      linha.eventos.find((e) => e.titulo.startsWith('Juntada'))?.ehDecisao,
    ).toBeUndefined();
  });

  it('a régua sai ordenada do mais recente para o mais antigo', () => {
    const linha = montarLinhaDoTempo({
      movimentacoes: [mov({ dia: '2026-05-05T10:00:00', titulo: 'Do meio' })],
      movimentosDoTribunal: [
        mov({ dia: '2026-01-01T10:00:00', titulo: 'Mais antigo', id: 1 }),
        mov({ dia: '2026-09-09T10:00:00', titulo: 'Mais novo', id: 2 }),
      ],
      pecas: [peca({ id: 'p1', movimento: 2, descricao: 'Petição' })],
    });

    expect(linha.eventos.map((e) => e.titulo)).toEqual([
      'Mais novo',
      'Do meio',
      'Mais antigo',
    ]);
  });

  it('sem peça nenhuma não há espinha do tribunal, mesmo com movimentos', () => {
    // Movimento sem documento não justifica trocar a linha do tempo da tela: o
    // que a troca entrega é o download na linha, e não haveria nenhum.
    const linha = montarLinhaDoTempo({
      movimentacoes: [mov({ dia: '2026-09-14T10:00:00', titulo: 'Decisão' })],
      movimentosDoTribunal: [
        mov({ dia: '2026-09-14T10:00:00', titulo: 'Decisão', id: 1 }),
      ],
      pecas: [],
    });

    expect(linha.resumo.espinha).toBe('fontes-publicas');
    expect(linha.eventos).toHaveLength(1);
  });
});

describe('nome do movimento emprestado da TPU', () => {
  it('o código vira o nome que o DataJud dá ao mesmo número', () => {
    /*
     * O MNI manda `codigoNacional` e nem sempre a descrição; o DataJud manda o
     * nome. É a mesma tabela do CNJ, então emprestar não é dedução — é ler a
     * tabela numa fonte que a tem. Sem isto a régua exibiria "Movimento 12265".
     */
    const batizados = batizarPeloCodigo(
      [mov({ dia: '2026-09-14T10:00:00', titulo: 'Movimento 219', tpu: 219, id: 1 })],
      [mov({ dia: '2026-01-01T10:00:00', titulo: 'Decisão', tpu: 219 })],
    );
    expect(batizados[0]?.titulo).toBe('Decisão');
  });

  it('o que o tribunal escreveu NÃO é trocado', () => {
    const batizados = batizarPeloCodigo(
      [mov({ dia: '2026-09-14T10:00:00', titulo: 'Despacho do juiz', tpu: 219, id: 1 })],
      [mov({ dia: '2026-01-01T10:00:00', titulo: 'Decisão', tpu: 219 })],
    );
    expect(batizados[0]?.titulo).toBe('Despacho do juiz');
  });
});
