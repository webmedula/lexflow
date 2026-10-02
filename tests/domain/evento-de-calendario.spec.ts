import { describe, expect, it } from 'vitest';
import {
  EventoDeCalendario,
  dataLocalEm,
  diasEntre,
  ehDataLocalValida,
  selecionarParaFeed,
  somarDias,
} from '../../src/domain/entities/EventoDeCalendario.js';
import type { SugestaoDeEvento } from '../../src/domain/entities/EventoDeCalendario.js';
import {
  EventoDeCalendarioInvalidoError,
  TransicaoDeEventoInvalidaError,
} from '../../src/domain/errors/index.js';

const AGORA = new Date('2026-10-02T15:00:00.000Z');
const DEPOIS = new Date('2026-10-03T15:00:00.000Z');
const NUMERO = '12345674720238260100';

function manual(
  sobrescrever: Partial<Parameters<typeof EventoDeCalendario.manual>[0]> = {},
): EventoDeCalendario {
  return EventoDeCalendario.manual({
    id: 'm1',
    workspace: 'ws-a',
    numeroProcesso: NUMERO,
    tribunal: 'TJSP',
    segredoJustica: false,
    tipo: 'reuniao',
    titulo: 'Reunião com o cliente',
    dataLocal: '2026-11-12',
    agora: AGORA,
    ...sobrescrever,
  });
}

const SUGESTAO: SugestaoDeEvento = {
  tipo: 'audiencia',
  titulo: 'Audiência de conciliação',
  dataLocal: '2026-11-12',
  horaLocal: '14:30',
  procedencia: {
    movimentacaoId: '2026-10-01T12:00:00.000Z|Intimação|',
    dataDoAndamento: new Date('2026-10-01T12:00:00.000Z'),
    trecho: 'Designo audiência de conciliação para 12/11/2026 às 14:30.',
  },
};

function sugerido(): EventoDeCalendario {
  return EventoDeCalendario.sugerido({
    id: 's1',
    workspace: 'ws-a',
    numeroProcesso: NUMERO,
    tribunal: 'TJSP',
    segredoJustica: false,
    sugestao: SUGESTAO,
    agora: AGORA,
  });
}

describe('EventoDeCalendario — nascimento', () => {
  it('manual nasce confirmado; detectado nasce sugerido, com procedência', () => {
    expect(manual().estado).toBe('confirmado');
    expect(manual().origem).toBe('manual');
    const s = sugerido();
    expect(s.estado).toBe('sugerido');
    expect(s.origem).toBe('detectado');
    expect(s.procedencia?.trecho).toContain('12/11/2026');
    expect(s.chaveDeDeteccao).toBe(
      `${NUMERO}|2026-10-01T12:00:00.000Z|Intimação||audiencia|2026-11-12|14:30`,
    );
  });

  it('é imutável', () => {
    const e = manual();
    expect(Object.isFrozen(e)).toBe(true);
  });

  it.each([
    ['data que não existe', { dataLocal: '2027-02-29' }],
    ['data em outro formato', { dataLocal: '12/11/2026' }],
    ['hora fora do relógio', { horaLocal: '24:00' }],
    ['título vazio', { titulo: '   ' }],
    ['título longo', { titulo: 'x'.repeat(141) }],
    ['observação longa', { observacao: 'x'.repeat(1001) }],
    ['duração sem hora', { duracaoMin: 30 }],
    ['duração zero', { horaLocal: '10:00', duracaoMin: 0 }],
    ['número de processo curto', { numeroProcesso: '123' }],
  ])('recusa %s', (_nome, mudanca) => {
    expect(() => manual(mudanca)).toThrow(EventoDeCalendarioInvalidoError);
  });

  it('aceita 29/02 em ano bissexto', () => {
    expect(manual({ dataLocal: '2028-02-29' }).dataLocal).toBe('2028-02-29');
  });
});

describe('EventoDeCalendario — transições', () => {
  it('sugerido → confirmado sobe a sequência; confirmar de novo não muda nada', () => {
    const c = sugerido().confirmar(DEPOIS);
    expect(c.estado).toBe('confirmado');
    expect(c.confirmadoEm).toEqual(DEPOIS);
    expect(c.sequencia).toBe(1);
    expect(c.confirmar(DEPOIS)).toBe(c);
  });

  it('confirmado → descartado sobe a sequência; descartar de novo não muda nada', () => {
    const d = manual().descartar(DEPOIS);
    expect(d.estado).toBe('descartado');
    expect(d.descartadoEm).toEqual(DEPOIS);
    expect(d.sequencia).toBe(1);
    expect(d.descartar(DEPOIS)).toBe(d);
  });

  it('descartado é final: não confirma nem edita', () => {
    const d = sugerido().descartar(DEPOIS);
    expect(() => d.confirmar(DEPOIS)).toThrow(TransicaoDeEventoInvalidaError);
    expect(() => d.editar({ titulo: 'outro' }, DEPOIS)).toThrow(
      TransicaoDeEventoInvalidaError,
    );
  });

  it('editar um detectado mantém origem, procedência e a chave de detecção ORIGINAL', () => {
    const s = sugerido().confirmar(DEPOIS);
    const e = s.editar({ dataLocal: '2026-11-13', horaLocal: null }, DEPOIS);
    expect(e.origem).toBe('detectado');
    expect(e.procedencia).toEqual(s.procedencia);
    expect(e.chaveDeDeteccao).toBe(s.chaveDeDeteccao);
    expect(e.dataLocal).toBe('2026-11-13');
    expect(e.horaLocal).toBeUndefined();
    expect(e.sequencia).toBe(2);
  });

  it('null apaga observação, hora e duração', () => {
    const e = manual({
      horaLocal: '10:00',
      duracaoMin: 30,
      observacao: 'levar procuração',
    });
    const sem = e.editar({ observacao: null, duracaoMin: null }, DEPOIS);
    expect(sem.observacao).toBeUndefined();
    expect(sem.duracaoMin).toBeUndefined();
    expect(sem.horaLocal).toBe('10:00');
  });

  it('a marca de revisão acende uma vez por andamento de mudança, e editar a apaga', () => {
    const s = sugerido();
    const cancelamento = new Date('2026-10-05T12:00:00.000Z');
    const marcado = s.marcarParaRevisao(cancelamento, DEPOIS);
    expect(marcado.revisar).toBe(true);
    expect(marcado.sequencia).toBe(s.sequencia);

    const editado = marcado.editar({ horaLocal: '15:00' }, DEPOIS);
    expect(editado.revisar).toBe(false);
    // O MESMO cancelamento, relido na próxima sincronização, não reacende.
    expect(editado.marcarParaRevisao(cancelamento, DEPOIS)).toBe(editado);
    // Um cancelamento MAIS NOVO reacende.
    expect(
      editado.marcarParaRevisao(new Date('2026-10-06T12:00:00.000Z'), DEPOIS).revisar,
    ).toBe(true);
  });
});

describe('datas de calendário — nunca passam por UTC', () => {
  it('o dia de São Paulo, não o de Greenwich', () => {
    // 01h UTC do dia 13 ainda é 22h do dia 12 em São Paulo.
    expect(dataLocalEm(new Date('2026-11-13T01:00:00.000Z'))).toBe('2026-11-12');
    expect(dataLocalEm(new Date('2026-11-13T03:00:00.000Z'))).toBe('2026-11-13');
  });

  it('soma dias atravessando mês e ano', () => {
    expect(somarDias('2026-12-31', 1)).toBe('2027-01-01');
    expect(somarDias('2026-03-01', -1)).toBe('2026-02-28');
    expect(diasEntre('2026-01-01', '2027-02-05')).toBe(400);
  });

  it('valida data de calendário', () => {
    expect(ehDataLocalValida('2026-02-29')).toBe(false);
    expect(ehDataLocalValida('2026-04-31')).toBe(false);
    expect(ehDataLocalValida('2026-12-31')).toBe(true);
  });
});

describe('selecionarParaFeed', () => {
  const base = manual();
  const em = (dataLocal: string, id: string): EventoDeCalendario =>
    new EventoDeCalendario({ ...base.props(), id, dataLocal });

  it('janela de 30 dias atrás a 365 à frente', () => {
    const ids = selecionarParaFeed(
      [
        em('2026-09-01', 'antes'),
        em('2026-09-02', 'borda-inicio'),
        em('2027-10-02', 'borda-fim'),
        em('2027-10-03', 'depois'),
      ],
      { agora: AGORA, incluiSugeridos: false },
    ).map((e) => e.id);
    expect(ids).toEqual(['borda-inicio', 'borda-fim']);
  });

  it('sugerido só com a opção; descartado só por 30 dias e só se já foi publicado', () => {
    const s = sugerido();
    const descartadoConfirmado = manual({ id: 'dc' }).descartar(
      new Date('2026-09-20T00:00:00Z'),
    );
    const descartadoVelho = manual({ id: 'dv' }).descartar(
      new Date('2026-08-01T00:00:00Z'),
    );
    const sugestaoRecusada = sugerido().descartar(new Date('2026-09-20T00:00:00Z'));

    const sem = selecionarParaFeed(
      [s, descartadoConfirmado, descartadoVelho, sugestaoRecusada],
      {
        agora: AGORA,
        incluiSugeridos: false,
      },
    ).map((e) => e.id);
    expect(sem).toEqual(['dc']);

    const com = selecionarParaFeed([s, descartadoConfirmado, descartadoVelho], {
      agora: AGORA,
      incluiSugeridos: true,
    }).map((e) => e.id);
    expect(com.sort()).toEqual(['dc', 's1']);
  });
});
