import { describe, expect, it } from 'vitest';
import type { Movimentacao } from '../../src/domain/entities/Movimentacao.js';
import { pendencias, triar, triarTodas } from '../../src/domain/entities/triagem.js';
import {
  comoDataDjen,
  desdeQuandoVarrer,
  DIAS_DA_PRIMEIRA_VARREDURA,
  DIAS_DE_SOBREPOSICAO,
} from '../../src/domain/entities/VigilanciaOab.js';
import { Oab } from '../../src/domain/entities/Oab.js';

function mov(campos: Partial<Movimentacao> & { titulo: string }): Movimentacao {
  return { data: new Date('2026-09-01T12:00:00Z'), ...campos };
}

describe('triagem — o que exige ação', () => {
  it('reconhece prazo em dias no corpo do ato', () => {
    const m = mov({
      titulo: 'Despacho',
      conteudo: 'Manifeste-se a parte autora no prazo de 15 dias.',
    });
    expect(triar(m).exigeAcao).toBe(true);
  });

  it('reconhece prazo escrito por extenso com o número entre parênteses', () => {
    // Formato comum nos atos ordinatórios: "no prazo de 05 (cinco) dias".
    const m = mov({
      titulo: 'Ato ordinatório',
      conteudo: 'INTIMEM-SE as partes para, no prazo de 05 (cinco) dias, especificarem as provas.',
    });
    expect(triar(m).exigeAcao).toBe(true);
  });

  it('reconhece determinação mesmo sem prazo explícito', () => {
    expect(triar(mov({ titulo: 'Outros', conteudo: 'CITE-SE o réu.' })).exigeAcao).toBe(true);
    expect(triar(mov({ titulo: 'Outros', conteudo: 'Cumpra-se.' })).exigeAcao).toBe(true);
  });

  it('não confunde juntada de petição com pedido de providência', () => {
    // "Juntada de Petição de Contestação" contém "petição" e cairia numa
    // heurística ingênua; é registro de cartório.
    expect(triar(mov({ titulo: 'Juntada de Petição de Contestação' })).exigeAcao).toBe(
      false,
    );
    expect(triar(mov({ titulo: 'Expedição de Certidão' })).exigeAcao).toBe(false);
    expect(triar(mov({ titulo: 'Conclusos para decisão' })).exigeAcao).toBe(false);
  });

  it('decisão e sentença contam mesmo sem o texto', () => {
    // O DataJud só dá o rótulo da TPU. Exigir verbo no corpo faria toda
    // sentença vinda de lá passar batida.
    expect(triar(mov({ titulo: 'Sentença' })).exigeAcao).toBe(true);
    expect(triar(mov({ titulo: 'Decisão' })).exigeAcao).toBe(true);
    expect(triar(mov({ titulo: 'Acórdão' })).exigeAcao).toBe(true);
  });

  it('teor indisponível é triado pelo TIPO, não pelo texto vazio', () => {
    // O sentinela do DJEN ("arquivos digitais indisponíveis") não pode fazer
    // uma decisão parecer irrelevante só porque o texto não veio.
    const m = mov({ titulo: 'Decisão', teorIndisponivel: true });
    expect(triar(m).exigeAcao).toBe(true);
  });

  it('sempre explica por que marcou', () => {
    // Heurística sem justificativa não se audita — e esta vai para a tela.
    expect(triar(mov({ titulo: 'Sentença' })).motivo).toBeTruthy();
    expect(triar(mov({ titulo: 'Juntada' })).motivo).toBeTruthy();
  });

  it('triarTodas não descarta nada', () => {
    // A regra do arquivo: triagem ordena e destaca, nunca esconde. Sumir com
    // andamento porque a expressão regular não reconheceu o verbo é como se
    // perde prazo.
    const lista = [
      mov({ titulo: 'Sentença' }),
      mov({ titulo: 'Juntada' }),
      mov({ titulo: 'Coisa que ninguém previu' }),
    ];
    expect(triarTodas(lista)).toHaveLength(3);
  });

  it('pendências vêm da mais recente para a mais antiga', () => {
    const lista = [
      mov({ titulo: 'Decisão', data: new Date('2026-01-01T00:00:00Z') }),
      mov({ titulo: 'Sentença', data: new Date('2026-06-01T00:00:00Z') }),
      mov({ titulo: 'Juntada', data: new Date('2026-08-01T00:00:00Z') }),
    ];
    const p = pendencias(lista);
    expect(p.map((m) => m.titulo)).toEqual(['Sentença', 'Decisão']);
  });
});

describe('janela da varredura por OAB', () => {
  const AGORA = new Date('2026-09-05T10:00:00Z');
  const base = {
    workspace: 'w',
    oab: Oab.criar('47383', 'GO'),
    criadaEm: AGORA,
    processosEncontrados: 0,
    ativa: true,
  };

  it('a primeira varredura olha 30 dias para trás, não o histórico inteiro', () => {
    // Um advogado com 1.871 publicações veria a carteira inteira entrar como
    // novidade no primeiro minuto, e o aviso de verdade sumiria no meio.
    const desde = desdeQuandoVarrer(base, AGORA);
    const dias = Math.round((AGORA.getTime() - desde.getTime()) / 86_400_000);
    expect(dias).toBe(DIAS_DA_PRIMEIRA_VARREDURA);
  });

  it('as seguintes retomam com sobreposição, não do exato ponto de parada', () => {
    // O DJEN indexa com atraso: comunicação de ontem pode aparecer hoje. Varrer
    // exatamente a partir da última execução perderia essas — e perder
    // publicação é perder prazo.
    const varridaEm = new Date('2026-09-05T09:00:00Z');
    const desde = desdeQuandoVarrer({ ...base, varridaEm }, AGORA);
    const dias = Math.round((varridaEm.getTime() - desde.getTime()) / 86_400_000);
    expect(dias).toBe(DIAS_DE_SOBREPOSICAO);
  });

  it('vigilância parada há meses não pede um ano de publicações de uma vez', () => {
    const varridaEm = new Date('2025-01-01T00:00:00Z');
    const desde = desdeQuandoVarrer({ ...base, varridaEm }, AGORA);
    const dias = Math.round((AGORA.getTime() - desde.getTime()) / 86_400_000);
    expect(dias).toBe(DIAS_DA_PRIMEIRA_VARREDURA);
  });

  it('formata a data como o DJEN espera', () => {
    expect(comoDataDjen(new Date('2026-09-05T23:30:00Z'))).toBe('2026-09-05');
  });
});
