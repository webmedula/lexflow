import { describe, expect, it } from 'vitest';
import { detectarEventosNoAndamento } from '../../src/domain/entities/deteccaoDeEventos.js';
import type { Movimentacao } from '../../src/domain/entities/Movimentacao.js';

/*
 * Tabela de detecção do calendário.
 *
 * TODOS os textos são SINTÉTICOS, escritos para este teste: o repositório é
 * público, e nenhum trecho, nome ou número de processo real entra aqui. As
 * frases imitam a forma dos despachos e intimações (verbo, gatilho, data, hora),
 * não o conteúdo de nenhum.
 *
 * "Hoje" é fixo (02/10/2026): nenhum teste depende do relógio.
 */

const HOJE = '2026-10-02';

function andamento(conteudo: string, titulo = 'Intimação'): Movimentacao {
  return { data: new Date('2026-10-01T12:00:00.000Z'), titulo, conteudo };
}

function detectar(
  conteudo: string,
  titulo?: string,
): Array<[string, string, string | null]> {
  return detectarEventosNoAndamento(andamento(conteudo, titulo), {
    hoje: HOJE,
  }).sugestoes.map((s) => [s.tipo, s.dataLocal, s.horaLocal ?? null]);
}

describe('detecção — gera evento quando a data está colada ao gatilho', () => {
  it.each<[string, string, Array<[string, string, string | null]>]>([
    [
      'dd/mm/aaaa com "às HH:MM"',
      'Designo audiência de conciliação para o dia 12/11/2026, às 14:30, por videoconferência.',
      [['audiencia', '2026-11-12', '14:30']],
    ],
    [
      'dd/mm/aa com "HHhMMmin"',
      'Audiência de instrução e julgamento designada para 03/12/26 às 9h30min.',
      [['audiencia', '2026-12-03', '09:30']],
    ],
    [
      '"HHhMM"',
      'Audiência una designada para 12/11/2026 14h15.',
      [['audiencia', '2026-11-12', '14:15']],
    ],
    [
      '"HH horas"',
      'Audiência designada para 12/11/2026 às 14 horas.',
      [['audiencia', '2026-11-12', '14:00']],
    ],
    [
      'sem hora = dia inteiro',
      'Audiência de conciliação designada para 12/11/2026.',
      [['audiencia', '2026-11-12', null]],
    ],
    [
      'hora antes da data',
      'Designo audiência para as 10:00 do dia 12/11/2026.',
      [['audiencia', '2026-11-12', '10:00']],
    ],
    [
      'perícia com o gatilho depois da data',
      'Fica designado o dia 15/01/2027, às 8h, para a realização da perícia.',
      [['pericia', '2027-01-15', '08:00']],
    ],
    [
      '"pericial"',
      'Designada a data de 20/11/2026 para o início dos trabalhos periciais.',
      [['pericia', '2026-11-20', null]],
    ],
    [
      'sessão de julgamento vira "outro"',
      'Processo incluído na sessão virtual de julgamento de 20/11/2026.',
      [['outro', '2026-11-20', null]],
    ],
    [
      'prazo SÓ com data final escrita ("até")',
      'Concedo o prazo até 20/10/2026 para juntada dos documentos.',
      [['prazo', '2026-10-20', null]],
    ],
    [
      'prazo "até o dia"',
      'Prorrogo o prazo até o dia 30/10/2026.',
      [['prazo', '2026-10-30', null]],
    ],
    [
      'data igual a hoje ainda vale',
      'Audiência designada para 02/10/2026 às 16:00.',
      [['audiencia', '2026-10-02', '16:00']],
    ],
    [
      'duas audiências, cada uma com seu gatilho',
      'Audiência de conciliação em 12/11/2026 e audiência de instrução em 10/12/2026.',
      [
        ['audiencia', '2026-11-12', null],
        ['audiencia', '2026-12-10', null],
      ],
    ],
    [
      'data passada no meio não atrapalha a futura',
      'Audiência designada em 01/10/2026 para 12/11/2026 às 9:00.',
      [['audiencia', '2026-11-12', '09:00']],
    ],
    [
      'caixa alta e sem acento',
      'AUDIENCIA DE CONCILIACAO DESIGNADA PARA 12/11/2026 AS 14:30.',
      [['audiencia', '2026-11-12', '14:30']],
    ],
  ])('%s', (_nome, texto, esperado) => {
    expect(detectar(texto)).toEqual(esperado);
  });

  it('o título vira o rótulo da audiência, sem inventar o que não está escrito', () => {
    const titulos = (t: string): string[] =>
      detectarEventosNoAndamento(andamento(t), { hoje: HOJE }).sugestoes.map(
        (s) => s.titulo,
      );
    expect(titulos('Designo audiência de conciliação para 12/11/2026.')).toEqual([
      'Audiência de conciliação',
    ]);
    expect(titulos('Designo audiência una para 12/11/2026.')).toEqual(['Audiência una']);
    expect(titulos('Audiência designada para 12/11/2026.')).toEqual(['Audiência']);
    expect(titulos('Concedo prazo até 20/10/2026.')).toEqual([
      'Prazo (data escrita no andamento)',
    ]);
  });
});

describe('detecção — na dúvida, NÃO gera', () => {
  it.each<[string, string]>([
    [
      '"prazo de N dias" sem data NÃO gera (seria calcular prazo)',
      'Intime-se para manifestação no prazo de 15 (quinze) dias.',
    ],
    [
      'prazo "a contar de" uma data não é data final',
      'Prazo de 10 dias a contar de 05/11/2026 para contrarrazões.',
    ],
    ['data passada', 'Audiência de conciliação designada para 01/09/2026.'],
    ['data que não existe', 'Audiência designada para 31/02/2027.'],
    ['ano longe demais (digitação)', 'Audiência designada para 12/11/2062.'],
    ['data sem gatilho', 'Despacho proferido. Cumpra-se a determinação de 12/11/2026.'],
    [
      'gatilho e data em frases diferentes',
      'Designo audiência. As partes serão intimadas até 12/11/2026 por mandado.',
    ],
    [
      'dois tipos de gatilho na mesma frase',
      'Designadas audiência e perícia para 12/11/2026.',
    ],
    [
      'data alternativa presa ao mesmo gatilho',
      'Audiência designada para 12/11/2026 ou, não sendo possível, 13/11/2026.',
    ],
    ['duas datas para o mesmo gatilho', 'Audiência designada: 12/11/2026, 13/11/2026.'],
    ['gatilho longe demais da data', `Audiência ${'x'.repeat(130)} 12/11/2026.`],
    ['andamento sem texto', ''],
  ])('%s', (_nome, texto) => {
    expect(detectar(texto)).toEqual([]);
  });

  it('teor marcado como indisponível não é lido', () => {
    const r = detectarEventosNoAndamento(
      {
        data: new Date('2026-10-01T12:00:00.000Z'),
        titulo: 'Intimação',
        conteudo: 'Audiência designada para 12/11/2026.',
        teorIndisponivel: true,
      },
      { hoje: HOJE },
    );
    expect(r.sugestoes).toEqual([]);
  });
});

describe('detecção — mudança marca revisão e não cria sugestão', () => {
  it.each<[string, string, string[]]>([
    ['cancelada', 'Audiência de conciliação cancelada.', ['audiencia']],
    [
      'redesignada com data nova',
      'Audiência redesignada para 12/11/2026 às 14:30.',
      ['audiencia'],
    ],
    ['retirado de pauta, sem dizer de quê', 'Retirado de pauta.', ['audiencia', 'outro']],
    ['perícia adiada', 'Perícia adiada a pedido do perito.', ['pericia']],
    ['cancelamento sem tipo reconhecível', 'Penhora cancelada.', []],
  ])('%s', (_nome, texto, tipos) => {
    const r = detectarEventosNoAndamento(andamento(texto), { hoje: HOJE });
    expect(r.sugestoes).toEqual([]);
    expect([...(r.mudanca?.tipos ?? [])].sort()).toEqual([...tipos].sort());
  });
});

describe('detecção — procedência e privacidade', () => {
  it('a procedência aponta o andamento e traz um trecho de até 200 caracteres', () => {
    const texto = `${'Considerando o que consta dos autos e o pedido formulado. '.repeat(2)}Designo audiência de conciliação para 12/11/2026 às 14:30, ${'devendo as partes comparecer munidas de documento. '.repeat(4)}`;
    const [s] = detectarEventosNoAndamento(andamento(texto), { hoje: HOJE }).sugestoes;
    expect(s?.procedencia.dataDoAndamento.toISOString()).toBe('2026-10-01T12:00:00.000Z');
    expect(s?.procedencia.movimentacaoId).toContain('Intimação');
    expect(s?.procedencia.trecho.length).toBeLessThanOrEqual(200);
    expect(s?.procedencia.trecho).toContain('12/11/2026');
  });

  it('o trecho não carrega nome de parte nem de advogado, com ou sem acento', () => {
    const texto =
      'Designo audiência de conciliação entre FULANA DE TAL SINTÉTICA e Empresa Ficticia Ltda, ' +
      'patrono Dr. Beltrano Exemplar, para 12/11/2026 às 14:30.';
    const [s] = detectarEventosNoAndamento(andamento(texto), {
      hoje: HOJE,
      nomesProtegidos: [
        'Fulana de Tal Sintetica',
        'EMPRESA FICTÍCIA LTDA',
        'Beltrano Exemplar',
      ],
    }).sugestoes;
    expect(s?.procedencia.trecho).not.toMatch(/fulana|ficticia|fictícia|beltrano/i);
    expect(s?.procedencia.trecho).toContain('[parte]');
  });

  it('o trecho não carrega CPF', () => {
    const [s] = detectarEventosNoAndamento(
      andamento(
        'Audiência designada para 12/11/2026, intimando-se o CPF 123.456.789-09.',
      ),
      { hoje: HOJE },
    ).sugestoes;
    expect(s?.procedencia.trecho).not.toContain('123.456.789-09');
  });
});

describe('detecção — idempotência', () => {
  it('o mesmo andamento produz sempre as mesmas sugestões', () => {
    const a = andamento('Designo audiência de conciliação para 12/11/2026, às 14:30.');
    const r1 = detectarEventosNoAndamento(a, { hoje: HOJE });
    const r2 = detectarEventosNoAndamento(a, { hoje: HOJE });
    expect(r2).toEqual(r1);
  });

  it('a mesma data repetida no texto vira UMA sugestão', () => {
    expect(
      detectar(
        'Audiência designada para 12/11/2026 às 14:30. Audiência designada para 12/11/2026 às 14:30.',
      ),
    ).toEqual([['audiencia', '2026-11-12', '14:30']]);
  });
});
