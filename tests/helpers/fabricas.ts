import { NumeroCNJ } from '../../src/domain/entities/NumeroCNJ.js';
import { Processo } from '../../src/domain/entities/Processo.js';
import type { ProcessoProps } from '../../src/domain/entities/Processo.js';
import type {
  CapacidadesProvider,
  ProcessoProvider,
} from '../../src/domain/ports/ProcessoProvider.js';

export const NUMERO_TJSP_A = '1234567-47.2023.8.26.0100';
export const NUMERO_TJSP_B = '0007652-12.2022.8.26.0224';
export const NUMERO_TRF1 = '0000832-35.2018.4.01.3202';

export function umProcesso(
  sobrescrever: Partial<ProcessoProps> & { numero?: NumeroCNJ } = {},
): Processo {
  return new Processo({
    numero: NumeroCNJ.criar(NUMERO_TJSP_A),
    tribunal: 'TJSP',
    vara: '12ª Vara Cível',
    classe: 'Procedimento Comum Cível',
    assuntos: ['Indenização por Dano Moral'],
    dataDistribuicao: new Date('2023-03-14T09:12:00.000Z'),
    movimentacoes: [
      { data: new Date('2024-11-08T14:03:00.000Z'), titulo: 'Conclusos para decisão' },
    ],
    procedencia: {
      provider: 'fake',
      consultadoEm: new Date('2026-01-01T00:00:00.000Z'),
      deCache: false,
    },
    ...sobrescrever,
  });
}

const CAPACIDADES_PADRAO: CapacidadesProvider = {
  buscarPorNumero: true,
  buscarPorOab: true,
  retornaPartes: true,
  retornaConteudoMovimentacoes: true,
  retornaLinhaDoTempoCompleta: true,
  tribunais: ['*'],
};

export interface OpcoesProviderFalso {
  nome: string;
  capacidades?: Partial<CapacidadesProvider>;
  porNumero?: (numero: string) => Promise<Processo>;
  porOab?: (oab: string, uf: string) => Promise<Processo[]>;
  saudavel?: boolean;
}

/** Dublê configurável que registra quantas vezes cada método foi chamado. */
export class ProviderFalso implements ProcessoProvider {
  readonly nome: string;
  readonly capacidades: CapacidadesProvider;
  readonly chamadas = { porNumero: 0, porOab: 0, health: 0 };

  private readonly opcoes: OpcoesProviderFalso;

  constructor(opcoes: OpcoesProviderFalso) {
    this.nome = opcoes.nome;
    this.capacidades = { ...CAPACIDADES_PADRAO, ...opcoes.capacidades };
    this.opcoes = opcoes;
  }

  async buscarPorNumero(numeroProcesso: string): Promise<Processo> {
    this.chamadas.porNumero++;
    if (!this.opcoes.porNumero) {
      return umProcesso({
        procedencia: {
          provider: this.nome,
          consultadoEm: new Date('2026-01-01T00:00:00.000Z'),
          deCache: false,
        },
      });
    }
    return this.opcoes.porNumero(numeroProcesso);
  }

  async buscarPorOab(oab: string, uf: string): Promise<Processo[]> {
    this.chamadas.porOab++;
    if (!this.opcoes.porOab) return [];
    return this.opcoes.porOab(oab, uf);
  }

  async healthCheck(): Promise<boolean> {
    this.chamadas.health++;
    return this.opcoes.saudavel ?? true;
  }
}
