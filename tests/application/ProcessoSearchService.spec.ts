import { describe, expect, it } from 'vitest';
import { NumeroCNJ } from '../../src/domain/entities/NumeroCNJ.js';
import { ProcessoSearchService } from '../../src/application/services/ProcessoSearchService.js';
import {
  OperacaoNaoSuportadaError,
  ProcessoNaoEncontradoError,
  ProviderIndisponivelError,
  TodasAsFontesFalharamError,
} from '../../src/domain/errors/index.js';
import {
  NUMERO_TJSP_A,
  NUMERO_TJSP_B,
  ProviderFalso,
  umProcesso,
} from '../helpers/fabricas.js';

describe('ProcessoSearchService — busca por número', () => {
  it('usa a primeira fonte da cadeia e não consulta as demais quando ela responde', async () => {
    const primario = new ProviderFalso({ nome: 'primario' });
    const secundario = new ProviderFalso({ nome: 'secundario' });

    const servico = new ProcessoSearchService({
      providers: [primario, secundario],
    });
    const processo = await servico.buscarPorNumero(NUMERO_TJSP_A);

    expect(processo.procedencia.provider).toBe('primario');
    expect(primario.chamadas.porNumero).toBe(1);
    expect(secundario.chamadas.porNumero).toBe(0);
  });

  it('cai para a fonte seguinte quando a primária está indisponível', async () => {
    const primario = new ProviderFalso({
      nome: 'crawler',
      porNumero: async () => {
        throw new ProviderIndisponivelError('crawler', 'e-SAJ fora do ar');
      },
    });
    const secundario = new ProviderFalso({ nome: 'datajud' });

    const servico = new ProcessoSearchService({ providers: [primario, secundario] });
    const processo = await servico.buscarPorNumero(NUMERO_TJSP_A);

    expect(processo.procedencia.provider).toBe('datajud');
    expect(primario.chamadas.porNumero).toBe(1);
    expect(secundario.chamadas.porNumero).toBe(1);
  });

  it('percorre a cadeia inteira antes de desistir', async () => {
    const falha = (nome: string): ProviderFalso =>
      new ProviderFalso({
        nome,
        porNumero: async () => {
          throw new ProviderIndisponivelError(nome, 'timeout');
        },
      });

    const servico = new ProcessoSearchService({
      providers: [falha('a'), falha('b'), falha('c')],
    });

    await expect(servico.buscarPorNumero(NUMERO_TJSP_A)).rejects.toThrow(
      TodasAsFontesFalharamError,
    );
  });

  it('registra cada tentativa no erro final, para diagnóstico', async () => {
    const servico = new ProcessoSearchService({
      providers: [
        new ProviderFalso({
          nome: 'crawler',
          porNumero: async () => {
            throw new ProviderIndisponivelError('crawler', 'captcha');
          },
        }),
        new ProviderFalso({
          nome: 'datajud',
          porNumero: async () => {
            throw new ProviderIndisponivelError('datajud', 'HTTP 503');
          },
        }),
      ],
    });

    const erro = await servico.buscarPorNumero(NUMERO_TJSP_A).catch((e) => e);

    expect(erro).toBeInstanceOf(TodasAsFontesFalharamError);
    expect((erro as TodasAsFontesFalharamError).tentativas).toHaveLength(2);
    expect((erro as TodasAsFontesFalharamError).tentativas[0]?.provider).toBe('crawler');
    expect(erro.message).toContain('captcha');
    expect(erro.message).toContain('HTTP 503');
  });

  it('distingue "não encontrado" de "fontes fora do ar"', async () => {
    // Todas as fontes RESPONDERAM; nenhuma tem o processo.
    // O usuário precisa ver "não existe", não "o sistema falhou".
    const servico = new ProcessoSearchService({
      providers: [
        new ProviderFalso({
          nome: 'crawler',
          porNumero: async () => {
            throw new ProcessoNaoEncontradoError('numero', 'crawler');
          },
        }),
        new ProviderFalso({
          nome: 'datajud',
          porNumero: async () => {
            throw new ProcessoNaoEncontradoError('numero', 'datajud');
          },
        }),
      ],
    });

    await expect(servico.buscarPorNumero(NUMERO_TJSP_A)).rejects.toBeInstanceOf(
      ProcessoNaoEncontradoError,
    );
  });

  it('ainda tenta a próxima fonte quando a primeira responde "não encontrado"', async () => {
    const primario = new ProviderFalso({
      nome: 'crawler',
      porNumero: async () => {
        throw new ProcessoNaoEncontradoError('numero', 'crawler');
      },
    });
    const secundario = new ProviderFalso({ nome: 'datajud' });

    const servico = new ProcessoSearchService({ providers: [primario, secundario] });
    const processo = await servico.buscarPorNumero(NUMERO_TJSP_A);

    expect(processo.procedencia.provider).toBe('datajud');
  });

  it('pula fontes que não cobrem o tribunal do número, sem gastar requisição', async () => {
    const soTjsp = new ProviderFalso({
      nome: 'crawler-tjsp',
      capacidades: { tribunais: ['TJSP'] },
    });
    const nacional = new ProviderFalso({
      nome: 'datajud',
      capacidades: { tribunais: ['*'] },
    });

    const servico = new ProcessoSearchService({ providers: [soTjsp, nacional] });
    const processo = await servico.buscarPorNumero('0000832-35.2018.4.01.3202');

    expect(soTjsp.chamadas.porNumero).toBe(0);
    expect(processo.procedencia.provider).toBe('datajud');
  });

  it('pula fontes com healthCheck negativo quando a verificação está ligada', async () => {
    const doente = new ProviderFalso({ nome: 'doente', saudavel: false });
    const sadio = new ProviderFalso({ nome: 'sadio' });

    const servico = new ProcessoSearchService({
      providers: [doente, sadio],
      verificarSaude: true,
    });
    const processo = await servico.buscarPorNumero(NUMERO_TJSP_A);

    expect(doente.chamadas.porNumero).toBe(0);
    expect(processo.procedencia.provider).toBe('sadio');
  });

  it('rejeita número CNJ inválido antes de tocar em qualquer fonte', async () => {
    const provider = new ProviderFalso({ nome: 'qualquer' });
    const servico = new ProcessoSearchService({ providers: [provider] });

    await expect(servico.buscarPorNumero('1234567-48.2023.8.26.0100')).rejects.toThrow(
      /Número CNJ inválido/,
    );
    expect(provider.chamadas.porNumero).toBe(0);
  });
});

describe('ProcessoSearchService — busca por OAB', () => {
  it('pula silenciosamente a fonte que declara não suportar OAB', async () => {
    const semOab = new ProviderFalso({
      nome: 'datajud',
      capacidades: { buscarPorOab: false },
    });
    const comOab = new ProviderFalso({
      nome: 'crawler',
      porOab: async () => [umProcesso()],
    });

    const servico = new ProcessoSearchService({ providers: [semOab, comOab] });
    const processos = await servico.buscarPorOab('234567', 'SP');

    expect(semOab.chamadas.porOab).toBe(0);
    expect(processos).toHaveLength(1);
  });

  it('agrega resultados de várias fontes e deduplica pelo número CNJ', async () => {
    const compartilhado = umProcesso();
    const exclusivo = umProcesso({ numero: NumeroCNJ.criar(NUMERO_TJSP_B) });

    const servico = new ProcessoSearchService({
      providers: [
        new ProviderFalso({ nome: 'a', porOab: async () => [compartilhado] }),
        new ProviderFalso({
          nome: 'b',
          porOab: async () => [compartilhado, exclusivo],
        }),
      ],
      estrategiaOab: 'AGREGAR',
    });

    const processos = await servico.buscarPorOab('234567', 'SP');
    expect(processos).toHaveLength(2);
    expect(processos.map((p) => p.numero.digitos)).toEqual([
      compartilhado.numero.digitos,
      exclusivo.numero.digitos,
    ]);
  });

  it('para na primeira resposta quando a estratégia é PRIMEIRA_RESPOSTA', async () => {
    const primeiro = new ProviderFalso({
      nome: 'a',
      porOab: async () => [umProcesso()],
    });
    const segundo = new ProviderFalso({ nome: 'b', porOab: async () => [] });

    const servico = new ProcessoSearchService({
      providers: [primeiro, segundo],
      estrategiaOab: 'PRIMEIRA_RESPOSTA',
    });

    await servico.buscarPorOab('234567', 'SP');
    expect(segundo.chamadas.porOab).toBe(0);
  });

  it('devolve resultado parcial quando uma das fontes falha', async () => {
    const servico = new ProcessoSearchService({
      providers: [
        new ProviderFalso({
          nome: 'quebrado',
          porOab: async () => {
            throw new ProviderIndisponivelError('quebrado', 'HTTP 500');
          },
        }),
        new ProviderFalso({ nome: 'ok', porOab: async () => [umProcesso()] }),
      ],
    });

    const processos = await servico.buscarPorOab('234567', 'SP');
    expect(processos).toHaveLength(1);
  });

  it('lista vazia é resposta válida, não erro', async () => {
    const servico = new ProcessoSearchService({
      providers: [new ProviderFalso({ nome: 'a', porOab: async () => [] })],
    });
    await expect(servico.buscarPorOab('999999', 'SP')).resolves.toEqual([]);
  });

  it('falha quando nenhuma fonte da cadeia conseguiu responder', async () => {
    const servico = new ProcessoSearchService({
      providers: [
        new ProviderFalso({
          nome: 'a',
          porOab: async () => {
            throw new ProviderIndisponivelError('a', 'timeout');
          },
        }),
      ],
    });

    await expect(servico.buscarPorOab('234567', 'SP')).rejects.toBeInstanceOf(
      TodasAsFontesFalharamError,
    );
  });

  it('OperacaoNaoSuportadaError lançada em runtime não conta como falha', async () => {
    const servico = new ProcessoSearchService({
      providers: [
        new ProviderFalso({
          nome: 'datajud',
          porOab: async () => {
            throw new OperacaoNaoSuportadaError('datajud', 'buscarPorOab');
          },
        }),
        new ProviderFalso({ nome: 'crawler', porOab: async () => [umProcesso()] }),
      ],
    });

    await expect(servico.buscarPorOab('234567', 'SP')).resolves.toHaveLength(1);
  });
});

describe('ProcessoSearchService — composição', () => {
  it('expõe a união das capacidades da cadeia', () => {
    const servico = new ProcessoSearchService({
      providers: [
        new ProviderFalso({
          nome: 'datajud',
          capacidades: { buscarPorOab: false, retornaPartes: false, tribunais: ['TJSP', 'TJRJ'] },
        }),
        new ProviderFalso({
          nome: 'crawler',
          capacidades: { buscarPorOab: true, retornaPartes: true, tribunais: ['TJSP'] },
        }),
      ],
    });

    expect(servico.capacidades.buscarPorOab).toBe(true);
    expect(servico.capacidades.retornaPartes).toBe(true);
    expect([...servico.capacidades.tribunais].sort()).toEqual(['TJRJ', 'TJSP']);
  });

  it('está saudável se ao menos uma fonte responder — é o sentido do fallback', async () => {
    const servico = new ProcessoSearchService({
      providers: [
        new ProviderFalso({ nome: 'a', saudavel: false }),
        new ProviderFalso({ nome: 'b', saudavel: true }),
      ],
    });

    await expect(servico.healthCheck()).resolves.toBe(true);
    await expect(servico.diagnostico()).resolves.toEqual([
      { provider: 'a', saudavel: false },
      { provider: 'b', saudavel: true },
    ]);
  });

  it('recusa cadeia vazia na construção', () => {
    expect(() => new ProcessoSearchService({ providers: [] })).toThrow(
      /ao menos um provider/,
    );
  });
});
