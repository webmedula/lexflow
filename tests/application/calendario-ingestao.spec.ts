import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ServicoAcompanhamento } from '../../src/application/services/ServicoAcompanhamento.js';
import { ServicoCalendario } from '../../src/application/services/ServicoCalendario.js';
import { comDeteccaoDoCalendario } from '../../src/application/services/ingestaoDoCalendario.js';
import type { Movimentacao } from '../../src/domain/entities/Movimentacao.js';
import type { RepositorioDeEventos } from '../../src/domain/ports/RepositorioDeEventos.js';
import type { Logger } from '../../src/domain/ports/Logger.js';
import { loggerSilencioso } from '../../src/infrastructure/logging/ConsoleLogger.js';
import { abrirBanco } from '../../src/infrastructure/persistencia/sqlite/banco.js';
import { RepositorioAcompanhamentosSqlite } from '../../src/infrastructure/persistencia/sqlite/RepositorioAcompanhamentosSqlite.js';
import { RepositorioDeEventosSqlite } from '../../src/infrastructure/persistencia/sqlite/RepositorioDeEventosSqlite.js';
import { tokensDeSessao } from '../../src/infrastructure/seguranca/sessao.js';
import { NUMERO_TJSP_A, ProviderFalso, umProcesso } from '../helpers/fabricas.js';

/* Textos e nomes sintéticos; relógio fixo. */
const AGORA = new Date('2026-10-02T15:00:00.000Z');
const DIGITOS = NUMERO_TJSP_A.replace(/\D/g, '');

const DESIGNACAO: Movimentacao = {
  data: new Date('2026-09-20T13:00:00.000Z'),
  titulo: 'Intimação',
  conteudo: 'Designo audiência de conciliação para 12/11/2026, às 14:30.',
  fonte: 'djen',
};
const CANCELAMENTO: Movimentacao = {
  data: new Date('2026-09-28T13:00:00.000Z'),
  titulo: 'Intimação',
  conteudo: 'Audiência de conciliação cancelada.',
};
const VELHA: Movimentacao = {
  // Fora da janela de 180 dias: não é relida.
  data: new Date('2026-03-01T13:00:00.000Z'),
  titulo: 'Intimação',
  conteudo: 'Designo audiência de instrução para 10/12/2026.',
};

class LoggerEspiao implements Logger {
  readonly avisos: Array<{ mensagem: string; contexto?: Record<string, unknown> }> = [];
  debug(): void {}
  info(): void {}
  warn(mensagem: string, contexto?: Record<string, unknown>): void {
    this.avisos.push({ mensagem, ...(contexto ? { contexto } : {}) });
  }
  error(): void {}
  child(): Logger {
    return this;
  }
}

describe('ingestão de andamentos no calendário', () => {
  let db: ReturnType<typeof abrirBanco>;
  let cru: RepositorioAcompanhamentosSqlite;
  let eventos: RepositorioDeEventosSqlite;
  let movimentacoes: Movimentacao[];
  let calendario: ServicoCalendario;
  let acompanhamento: ServicoAcompanhamento;

  function montar(
    repoEventos: RepositorioDeEventos,
    logger: Logger = loggerSilencioso,
  ): void {
    calendario = new ServicoCalendario({
      eventos: repoEventos,
      acompanhamentos: cru,
      tokens: tokensDeSessao,
      logger,
      gerarId: () => randomUUID(),
      agora: () => AGORA,
    });
    acompanhamento = new ServicoAcompanhamento({
      repositorio: comDeteccaoDoCalendario(cru, calendario, logger),
      provider: new ProviderFalso({
        nome: 'falso',
        porNumero: async () => umProcesso({ movimentacoes }),
      }),
      logger,
      pausaEntreConsultasMs: 0,
    });
  }

  beforeEach(() => {
    db = abrirBanco(':memory:');
    cru = new RepositorioAcompanhamentosSqlite(db);
    eventos = new RepositorioDeEventosSqlite(db);
    movimentacoes = [VELHA, DESIGNACAO];
    montar(eventos);
  });
  afterEach(() => db.close());

  const listar = async (ws = 'A') =>
    eventos.listar(ws, { de: '2026-01-01', ate: '2027-12-31' });

  it('a primeira sincronização (que não gera novidade) já sugere o evento', async () => {
    await acompanhamento.acompanhar('A', NUMERO_TJSP_A);
    const lista = await listar();
    expect(lista.map((e) => [e.tipo, e.dataLocal, e.horaLocal, e.estado])).toEqual([
      ['audiencia', '2026-11-12', '14:30', 'sugerido'],
    ]);
    expect(lista[0]?.procedencia?.dataDoAndamento).toEqual(DESIGNACAO.data);
  });

  it('reprocessar o mesmo andamento não duplica', async () => {
    await acompanhamento.acompanhar('A', NUMERO_TJSP_A);
    await acompanhamento.sincronizar();
    await acompanhamento.sincronizar();
    expect(await listar()).toHaveLength(1);
  });

  it('cancelamento posterior marca para revisão — uma vez só', async () => {
    await acompanhamento.acompanhar('A', NUMERO_TJSP_A);
    movimentacoes = [DESIGNACAO, CANCELAMENTO];
    await acompanhamento.sincronizar();
    const [marcado] = await listar();
    expect(marcado?.revisar).toBe(true);

    // O advogado confere e corrige; a próxima sincronização relê o MESMO
    // cancelamento e não reacende o aviso.
    if (marcado) await calendario.alterar('A', marcado.id, { horaLocal: '15:00' });
    await acompanhamento.sincronizar();
    expect((await listar())[0]?.revisar).toBe(false);
  });

  it('descartado não reaparece como sugerido', async () => {
    await acompanhamento.acompanhar('A', NUMERO_TJSP_A);
    const [e] = await listar();
    if (e) await calendario.descartar('A', e.id);
    await acompanhamento.sincronizar();
    expect((await listar()).map((x) => x.estado)).toEqual(['descartado']);
  });

  it('falha na detecção NÃO derruba o sync: o processo fica sincronizado e o log diz', async () => {
    const quebrado = new Proxy(eventos, {
      get(alvo, prop, receptor) {
        if (prop === 'inserirSeNovo') {
          return async () => {
            throw new Error('disco cheio (simulado)');
          };
        }
        return Reflect.get(alvo, prop, receptor) as unknown;
      },
    });
    const log = new LoggerEspiao();
    montar(quebrado, log);

    const criado = await acompanhamento.acompanhar('A', NUMERO_TJSP_A);
    expect(criado.erro).toBeUndefined();
    expect(criado.sincronizadoEm).toBeDefined();
    const r = await acompanhamento.sincronizar();
    expect(r).toMatchObject({ verificados: 1, falhas: 0 });
    expect(
      log.avisos.some((a) => a.mensagem.includes('detecção do calendário falhou')),
    ).toBe(true);
  });

  it('o sigilo do processo acompanha a sincronização', async () => {
    await acompanhamento.acompanhar('A', NUMERO_TJSP_A);
    acompanhamento = new ServicoAcompanhamento({
      repositorio: comDeteccaoDoCalendario(cru, calendario, loggerSilencioso),
      provider: new ProviderFalso({
        nome: 'falso',
        porNumero: async () => umProcesso({ movimentacoes, segredoJustica: true }),
      }),
      logger: loggerSilencioso,
      pausaEntreConsultasMs: 0,
    });
    await acompanhamento.sincronizar();
    expect((await listar())[0]?.segredoJustica).toBe(true);
  });

  describe('preenchimento retroativo', () => {
    beforeEach(async () => {
      // Pasta gravada ANTES do calendário existir: direto no repositório cru,
      // sem passar pela detecção.
      await cru.acompanhar('A', DIGITOS);
      await cru.registrarSincronizacao('A', DIGITOS, umProcesso({ movimentacoes }), []);
    });

    it('lê os andamentos já gravados, sem rede, e marca o workspace', async () => {
      const r = await calendario.preencherRetroativo();
      expect(r).toEqual({ workspaces: 1, sugeridos: 1 });
      // A data de VELHA está à frente, mas o andamento passou dos 180 dias.
      expect((await listar()).map((e) => e.dataLocal)).toEqual(['2026-11-12']);
    });

    it('é idempotente: a segunda volta não acha ninguém, e rodar de novo não duplica', async () => {
      await calendario.preencherRetroativo();
      expect(await calendario.preencherRetroativo()).toEqual({
        workspaces: 0,
        sugeridos: 0,
      });
      db.prepare('DELETE FROM calendario_retroativo').run();
      expect(await calendario.preencherRetroativo()).toEqual({
        workspaces: 1,
        sugeridos: 0,
      });
      expect(await listar()).toHaveLength(1);
    });

    it('não gera evento com data anterior a hoje', async () => {
      db.prepare('DELETE FROM calendario_retroativo').run();
      calendario = new ServicoCalendario({
        eventos,
        acompanhamentos: cru,
        tokens: tokensDeSessao,
        logger: loggerSilencioso,
        gerarId: () => randomUUID(),
        // "Hoje" depois da audiência.
        agora: () => new Date('2026-11-20T15:00:00.000Z'),
      });
      expect((await calendario.preencherRetroativo()).sugeridos).toBe(0);
    });
  });
});
