import { describe, expect, it } from 'vitest';
import { NumeroCNJ } from '../../src/domain/entities/NumeroCNJ.js';
import { BuscarProcessoPorNumero } from '../../src/domain/usecases/BuscarProcessoPorNumero.js';
import { BuscarProcessosPorOab } from '../../src/domain/usecases/BuscarProcessosPorOab.js';
import {
  NumeroCNJInvalidoError,
  OabInvalidaError,
} from '../../src/domain/errors/index.js';
import {
  NUMERO_TJSP_A,
  NUMERO_TJSP_B,
  ProviderFalso,
  umProcesso,
} from '../helpers/fabricas.js';

describe('BuscarProcessoPorNumero', () => {
  it('valida antes de consultar e repassa o número normalizado ao provider', async () => {
    let recebido = '';
    const provider = new ProviderFalso({
      nome: 'p',
      porNumero: async (numero) => {
        recebido = numero;
        return umProcesso();
      },
    });

    await new BuscarProcessoPorNumero(provider).executar({
      numeroProcesso: NUMERO_TJSP_A,
    });

    expect(recebido).toBe('12345674720238260100');
  });

  it('barra número inválido sem gastar requisição na fonte', async () => {
    const provider = new ProviderFalso({ nome: 'p' });
    const caso = new BuscarProcessoPorNumero(provider);

    await expect(
      caso.executar({ numeroProcesso: '1234567-99.2023.8.26.0100' }),
    ).rejects.toBeInstanceOf(NumeroCNJInvalidoError);
    expect(provider.chamadas.porNumero).toBe(0);
  });
});

describe('BuscarProcessosPorOab', () => {
  const antigo = umProcesso({
    numero: NumeroCNJ.criar(NUMERO_TJSP_B),
    dataDistribuicao: new Date('2020-01-10T00:00:00.000Z'),
    movimentacoes: [
      { data: new Date('2021-05-01T00:00:00.000Z'), titulo: 'Sentença' },
    ],
  });
  const recente = umProcesso({
    dataDistribuicao: new Date('2023-03-14T00:00:00.000Z'),
    movimentacoes: [
      { data: new Date('2025-09-01T00:00:00.000Z'), titulo: 'Conclusos' },
    ],
  });

  it('normaliza a OAB antes de consultar', async () => {
    let recebido: [string, string] = ['', ''];
    const provider = new ProviderFalso({
      nome: 'p',
      porOab: async (oab, uf) => {
        recebido = [oab, uf];
        return [];
      },
    });

    await new BuscarProcessosPorOab(provider).executar({ oab: '0234.567', uf: 'sp' });
    expect(recebido).toEqual(['234567', 'SP']);
  });

  it('ordena pela movimentação mais recente por padrão', async () => {
    const provider = new ProviderFalso({
      nome: 'p',
      porOab: async () => [antigo, recente],
    });

    const processos = await new BuscarProcessosPorOab(provider).executar({
      oab: '234567',
      uf: 'SP',
    });

    expect(processos[0]?.numero.formatado).toBe(NUMERO_TJSP_A);
  });

  it('ordena por data de distribuição quando solicitado', async () => {
    const provider = new ProviderFalso({
      nome: 'p',
      porOab: async () => [antigo, recente],
    });

    const processos = await new BuscarProcessosPorOab(provider).executar({
      oab: '234567',
      uf: 'SP',
      ordenarPor: 'DISTRIBUICAO',
    });

    expect(processos[0]?.dataDistribuicao?.getUTCFullYear()).toBe(2023);
  });

  it('barra OAB inválida sem gastar requisição', async () => {
    const provider = new ProviderFalso({ nome: 'p' });

    await expect(
      new BuscarProcessosPorOab(provider).executar({ oab: '234567', uf: 'ZZ' }),
    ).rejects.toBeInstanceOf(OabInvalidaError);
    expect(provider.chamadas.porOab).toBe(0);
  });
});
