import { describe, expect, it } from 'vitest';
import { MockCrawlerAdapter } from '../../src/infrastructure/adapters/crawler/MockCrawlerAdapter.js';
import {
  OperacaoNaoSuportadaError,
  ProcessoNaoEncontradoError,
  ProviderIndisponivelError,
} from '../../src/domain/errors/index.js';
import { NUMERO_TJSP_A, NUMERO_TRF1 } from '../helpers/fabricas.js';

const semLatencia = { latenciaMs: 0 };

describe('MockCrawlerAdapter', () => {
  it('devolve o processo completo, com partes e inteiro teor do despacho', async () => {
    const crawler = new MockCrawlerAdapter(semLatencia);
    const processo = await crawler.buscarPorNumero(NUMERO_TJSP_A);

    expect(processo.tribunal).toBe('TJSP');
    expect(processo.partes.length).toBeGreaterThan(0);
    expect(processo.poloAtivo[0]?.nome).toContain('Construtora Aurora');
    expect(processo.poloPassivo[0]?.advogados[0]?.oab).toBe('311204');
    expect(processo.ultimaMovimentacao?.conteudo).toContain('especifiquem as partes');
    expect(processo.temDetalhamento).toBe(true);
  });

  it('aceita o número com ou sem máscara', async () => {
    const crawler = new MockCrawlerAdapter(semLatencia);
    const a = await crawler.buscarPorNumero(NUMERO_TJSP_A);
    const b = await crawler.buscarPorNumero('12345674720238260100');

    expect(a.numero.equals(b.numero)).toBe(true);
  });

  it('lança ProcessoNaoEncontradoError para número do TJSP fora da massa', async () => {
    const crawler = new MockCrawlerAdapter(semLatencia);
    await expect(
      crawler.buscarPorNumero('0000001-84.2020.8.26.0001'),
    ).rejects.toBeInstanceOf(ProcessoNaoEncontradoError);
  });

  it('recusa tribunal que não seja o TJSP — é o escopo declarado', async () => {
    const crawler = new MockCrawlerAdapter(semLatencia);
    await expect(crawler.buscarPorNumero(NUMERO_TRF1)).rejects.toBeInstanceOf(
      OperacaoNaoSuportadaError,
    );
  });

  it('busca por OAB e devolve a carteira do advogado', async () => {
    const crawler = new MockCrawlerAdapter(semLatencia);
    const processos = await crawler.buscarPorOab('234567', 'SP');

    expect(processos).toHaveLength(2);
    expect(processos.map((p) => p.numero.formatado)).toContain(NUMERO_TJSP_A);
  });

  it('normaliza zeros à esquerda e UF minúscula na busca por OAB', async () => {
    const crawler = new MockCrawlerAdapter(semLatencia);
    await expect(crawler.buscarPorOab('0234567', 'sp')).resolves.toHaveLength(2);
  });

  it('OAB sem processos devolve lista vazia, não erro', async () => {
    const crawler = new MockCrawlerAdapter(semLatencia);
    await expect(crawler.buscarPorOab('999999', 'SP')).resolves.toEqual([]);
  });

  it('falha de forma determinística quando a aleatoriedade é injetada', async () => {
    const crawler = new MockCrawlerAdapter({
      ...semLatencia,
      taxaDeFalha: 0.5,
      aleatorio: () => 0.1, // abaixo da taxa → falha
    });

    await expect(crawler.buscarPorNumero(NUMERO_TJSP_A)).rejects.toBeInstanceOf(
      ProviderIndisponivelError,
    );
  });

  it('não falha quando o sorteio fica acima da taxa configurada', async () => {
    const crawler = new MockCrawlerAdapter({
      ...semLatencia,
      taxaDeFalha: 0.5,
      aleatorio: () => 0.9,
    });

    await expect(crawler.buscarPorNumero(NUMERO_TJSP_A)).resolves.toBeDefined();
  });

  it('healthCheck reflete o estado configurado', async () => {
    await expect(new MockCrawlerAdapter(semLatencia).healthCheck()).resolves.toBe(true);
    await expect(
      new MockCrawlerAdapter({ ...semLatencia, saudavel: false }).healthCheck(),
    ).resolves.toBe(false);
  });

  it('todos os números da massa têm dígito verificador válido', async () => {
    const crawler = new MockCrawlerAdapter(semLatencia);
    // Se algum DV estivesse errado, NumeroCNJ.criar lançaria aqui.
    for (const oab of ['234567', '198432', '311204', '150900']) {
      await expect(crawler.buscarPorOab(oab, 'SP')).resolves.toBeDefined();
    }
  });

  it('declara as capacidades que o DataJud não tem', () => {
    const crawler = new MockCrawlerAdapter(semLatencia);
    expect(crawler.capacidades.buscarPorOab).toBe(true);
    expect(crawler.capacidades.retornaPartes).toBe(true);
    expect(crawler.capacidades.retornaConteudoMovimentacoes).toBe(true);
    expect(crawler.capacidades.tribunais).toEqual(['TJSP']);
  });
});
