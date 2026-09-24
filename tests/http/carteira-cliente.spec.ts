import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { carregarConfig } from '../../src/infrastructure/config/env.js';
import type { Config } from '../../src/infrastructure/config/env.js';
import { construirServidor } from '../../src/main/http/servidor.js';
import type { Aplicacao } from '../../src/main/factories/makeProcessoSearchService.js';
import { aplicacaoDeTeste } from '../helpers/aplicacao.js';
import { ProviderFalso } from '../helpers/fabricas.js';

const CHAVE = 'chave-de-teste-1234567890';
const PROCESSO = '5818922-04.2026.8.09.0011';
const cabecalhos = { 'x-api-key': CHAVE };

function config(): Config {
  return carregarConfig({
    PROCESSOVIVO_PROVIDER_CHAIN: 'mock-crawler-tjsp',
    LOG_LEVEL: 'silent',
    PROCESSOVIVO_API_KEYS: CHAVE,
    CACHE_ENABLED: 'false',
  } as NodeJS.ProcessEnv);
}

describe('carteira — o rótulo de cliente', () => {
  let app: Aplicacao;
  let servidor: FastifyInstance;

  beforeEach(async () => {
    app = aplicacaoDeTeste([new ProviderFalso({ nome: 'falso' })]);
    servidor = construirServidor(app, config());
    const r = await servidor.inject({
      method: 'POST',
      url: '/v1/acompanhamentos',
      headers: cabecalhos,
      payload: { numero: PROCESSO },
    });
    expect(r.statusCode).toBe(201);
  });
  afterEach(async () => {
    await servidor.close();
  });

  async function rotular(cliente: string): Promise<number> {
    const r = await servidor.inject({
      method: 'PUT',
      url: `/v1/acompanhamentos/${PROCESSO}/cliente`,
      headers: cabecalhos,
      payload: { cliente },
    });
    return r.statusCode;
  }

  async function carteira(query = ''): Promise<Array<Record<string, unknown>>> {
    const r = await servidor.inject({
      method: 'GET',
      url: `/v1/acompanhamentos${query}`,
      headers: cabecalhos,
    });
    return r.json().acompanhamentos as Array<Record<string, unknown>>;
  }

  it('a pasta nasce sem rótulo, e isso não é erro', () => {
    /*
     * Nenhuma fonte preenche o cliente, e não é limitação a resolver: o
     * tribunal entrega as partes sem dizer qual delas o consultante representa.
     * Vazio significa "ainda não rotulado", que é a verdade — deduzir pela OAB
     * poria o nome do adversário na coluna.
     */
    return carteira().then((lista) => {
      expect(lista[0]?.['cliente']).toBeNull();
    });
  });

  it('rotula, e o rótulo volta na listagem e no filtro', async () => {
    expect(await rotular('Grupo Lume')).toBe(200);

    const lista = await carteira();
    expect(lista[0]?.['cliente']).toBe('Grupo Lume');

    const filtrada = await carteira('?cliente=lume');
    expect(filtrada).toHaveLength(1);
  });

  it('campo vazio APAGA o rótulo', async () => {
    /*
     * O oposto de `acompanhar`, que usa COALESCE para não apagar nada ao
     * reacompanhar. Aqui o COALESCE seria o defeito: um nome digitado errado
     * ficaria para sempre, e a única saída seria deixar de acompanhar a pasta.
     */
    expect(await rotular('Gurpo Lmue')).toBe(200);
    expect(await rotular('')).toBe(200);
    expect((await carteira())[0]?.['cliente']).toBeNull();
  });

  it('o rótulo entra na busca livre', async () => {
    await rotular('Café Serrano ME');
    expect(await carteira('?texto=Serrano')).toHaveLength(1);
  });

  it('as facetas oferecem só os rótulos em uso', async () => {
    const vazias = await servidor.inject({
      method: 'GET',
      url: '/v1/facetas',
      headers: cabecalhos,
    });
    expect(vazias.json().clientes).toEqual([]);

    await rotular('Vila Nova');
    const cheias = await servidor.inject({
      method: 'GET',
      url: '/v1/facetas',
      headers: cabecalhos,
    });
    expect(cheias.json().clientes).toEqual(['Vila Nova']);
  });

  it('rotular processo que não é acompanhado devolve 404, não silêncio', async () => {
    // Sem isto, um dígito trocado gravaria nada e a tela mostraria sucesso.
    const r = await servidor.inject({
      method: 'PUT',
      url: '/v1/acompanhamentos/0311517-22.2015.8.09.0051/cliente',
      headers: cabecalhos,
      payload: { cliente: 'Alguém' },
    });
    expect(r.statusCode).toBe(404);
  });

  it('nome absurdamente longo é recusado com 400', async () => {
    expect(await rotular('x'.repeat(121))).toBe(400);
  });

  it('a listagem traz o estado derivado da pasta', async () => {
    /*
     * Derivado na resposta, nunca guardado em coluna — mesma razão do status de
     * assinatura: estado em coluna precisa de alguém que o atualize, e esse
     * alguém é sempre uma tarefa agendada que pode não ter rodado.
     */
    const lista = await carteira();
    const estado = lista[0]?.['estado'] as Record<string, unknown>;
    expect(estado).toBeDefined();
    expect(['PROVIDENCIA', 'NOVIDADE', 'ARQUIVADO', 'EM_CURSO']).toContain(
      estado['rotulo'],
    );
    // A rota de acompanhar já faz a primeira consulta, então a pasta nasce
    // verificada. O caso de "nunca sincronizado" é exercitado no domínio, em
    // `estado-da-pasta.spec.ts`, onde dá para construí-lo sem fingir falha aqui.
    expect(estado['naoVerificado']).toBe(false);
  });
});
