import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { NumeroCNJ } from '../../src/domain/entities/NumeroCNJ.js';
import { Processo } from '../../src/domain/entities/Processo.js';
import type { Movimentacao } from '../../src/domain/entities/Movimentacao.js';
import { ServicoAcompanhamento } from '../../src/application/services/ServicoAcompanhamento.js';
import { abrirBanco } from '../../src/infrastructure/persistencia/sqlite/banco.js';
import { RepositorioAcompanhamentosSqlite } from '../../src/infrastructure/persistencia/sqlite/RepositorioAcompanhamentosSqlite.js';
import { loggerSilencioso } from '../../src/infrastructure/logging/ConsoleLogger.js';
import { rotasDeAcompanhamento } from '../../src/main/http/rotas/acompanhamentos.js';
import { ProviderFalso, NUMERO_TJSP_A, NUMERO_TJSP_B } from '../helpers/fabricas.js';

const AGORA = new Date('2026-10-02T12:00:00Z');
const WS = 'ws-a';
interface NovidadeJson {
  titulo: string;
  exigeAcao: boolean;
}
interface GrupoJson {
  numero: string;
  maisRecente: NovidadeJson;
  anteriores: NovidadeJson[];
  naoVistas: number;
}
interface RespostaNovidades {
  grupos: GrupoJson[];
  janelaDias: number | null;
  foraDaJanela: number;
  naoVistas: number;
}

const dia = (n: number): string =>
  new Date(AGORA.getTime() - n * 86_400_000).toISOString();

function mov(iso: string, titulo: string, conteudo?: string): Movimentacao {
  return { data: new Date(iso), titulo, ...(conteudo ? { conteudo } : {}) };
}

function processo(numero: string, movs: Movimentacao[]): Processo {
  return new Processo({
    numero: NumeroCNJ.criar(numero),
    tribunal: 'TJSP',
    classe: 'Procedimento Comum Cível',
    movimentacoes: movs,
    procedencia: { provider: 'teste', consultadoEm: AGORA, deCache: false },
  });
}

describe('GET /v1/novidades — uma linha por processo, com janela', () => {
  let db: DatabaseSync;
  let servidor: FastifyInstance;
  let repo: RepositorioAcompanhamentosSqlite;

  beforeEach(async () => {
    db = abrirBanco(':memory:');
    repo = new RepositorioAcompanhamentosSqlite(db);
    const servico = new ServicoAcompanhamento({
      repositorio: repo,
      provider: new ProviderFalso({ nome: 'falso' }),
      logger: loggerSilencioso,
    });
    servidor = Fastify();
    servidor.decorateRequest('workspace', undefined);
    servidor.addHook('onRequest', async (req) => {
      req.workspace = WS;
    });
    await servidor.register(
      rotasDeAcompanhamento(
        servico,
        { novidadesJanelaDias: 15, pendenciaJanelaDias: 10 },
        () => AGORA,
      ),
    );
  });
  afterEach(async () => {
    await servidor.close();
    db.close();
  });

  /** Grava a novidade e fixa a hora em que ela foi "percebida". */
  async function semear(
    numero: string,
    diasAtras: number,
    titulo: string,
  ): Promise<void> {
    const digitos = NumeroCNJ.criar(numero).digitos;
    await repo.acompanhar(WS, digitos);
    await repo.registrarSincronizacao(WS, digitos, processo(numero, []), [
      mov(dia(diasAtras), titulo),
    ]);
    db.prepare('UPDATE novidades SET detectada_em = ? WHERE titulo = ?').run(
      dia(diasAtras),
      titulo,
    );
  }

  async function ler(query = ''): Promise<RespostaNovidades> {
    const r = await servidor.inject({ method: 'GET', url: `/v1/novidades${query}` });
    expect(r.statusCode).toBe(200);
    return r.json() as RespostaNovidades;
  }

  it('devolve uma linha por processo e a janela padrão de 15 dias', async () => {
    await semear(NUMERO_TJSP_A, 1, 'Sentença');
    await semear(NUMERO_TJSP_A, 4, 'Despacho');
    await semear(NUMERO_TJSP_B, 2, 'Juntada');

    const r = await ler();
    expect(r.grupos).toHaveLength(2);
    expect(r.janelaDias).toBe(15);
    const a = r.grupos.find((g) => g.maisRecente.titulo === 'Sentença');
    expect(a?.anteriores.map((x) => x.titulo)).toEqual(['Despacho']);
    expect(a?.naoVistas).toBe(2);
  });

  it('diz quantas atualizações ficaram fora da janela, e "Todas" as traz de volta', async () => {
    await semear(NUMERO_TJSP_A, 1, 'Recente');
    await semear(NUMERO_TJSP_A, 20, 'Antiga');
    await semear(NUMERO_TJSP_B, 60, 'Muito antiga');

    const janela = await ler();
    expect(janela.foraDaJanela).toBe(2);
    expect(janela.grupos).toHaveLength(1);

    const todas = await ler('?janela=todas');
    expect(todas.janelaDias).toBeNull();
    expect(todas.foraDaJanela).toBe(0);
    expect(todas.grupos).toHaveLength(2);
  });

  it('a contagem de não vistas continua sendo de atualizações, não de linhas', async () => {
    await semear(NUMERO_TJSP_A, 1, 'Um');
    await semear(NUMERO_TJSP_A, 2, 'Dois');
    await semear(NUMERO_TJSP_A, 30, 'Fora da janela');

    const r = await ler();
    // Três atualizações não vistas num processo só (uma delas fora da janela):
    // o menu e o painel contam o que o assinante ainda não leu, não as linhas.
    expect(r.grupos).toHaveLength(1);
    expect(r.naoVistas).toBe(3);
  });

  it('marca a atualização anterior que pede providência, sem usá-la como filtro', async () => {
    const digitos = NumeroCNJ.criar(NUMERO_TJSP_A).digitos;
    await repo.acompanhar(WS, digitos);
    await repo.registrarSincronizacao(WS, digitos, processo(NUMERO_TJSP_A, []), [
      mov(
        dia(5),
        'Despacho',
        'Intime-se a parte autora para manifestar-se no prazo de 5 dias.',
      ),
      mov(dia(1), 'Juntada'),
    ]);
    db.prepare('UPDATE novidades SET detectada_em = data').run();

    const r = await ler();
    const g = r.grupos[0];
    expect(g?.maisRecente.titulo).toBe('Juntada');
    expect(g?.maisRecente.exigeAcao).toBe(false);
    expect(g?.anteriores[0]?.titulo).toBe('Despacho');
    expect(g?.anteriores[0]?.exigeAcao).toBe(true);
  });

  it('a janela de pendência chega à tela pelas facetas — um valor só', async () => {
    const r = await servidor.inject({ method: 'GET', url: '/v1/facetas' });
    expect(r.json().pendenciaJanelaDias).toBe(10);
  });
});
