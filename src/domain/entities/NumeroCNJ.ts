import { NumeroCNJInvalidoError } from '../errors/index.js';

/**
 * Value Object do número único de processo (Resolução CNJ nº 65/2008).
 *
 * Formato: NNNNNNN-DD.AAAA.J.TR.OOOO
 *   NNNNNNN  sequencial por unidade de origem/ano
 *   DD       dígito verificador (ISO 7064 MOD 97-10)
 *   AAAA     ano do ajuizamento
 *   J        segmento do Judiciário (8 = Justiça Estadual, 4 = Federal, 5 = Trabalho...)
 *   TR       tribunal dentro do segmento (26 = TJSP quando J = 8)
 *   OOOO     unidade de origem (vara/foro)
 *
 * Imutável e sempre válido: se existe uma instância, o número passou pelo DV.
 * É isso que permite ao resto do sistema nunca mais revalidar string de processo.
 */
export class NumeroCNJ {
  private constructor(
    /** 20 dígitos, sem máscara. */
    readonly digitos: string,
    readonly sequencial: string,
    readonly digitoVerificador: string,
    readonly ano: number,
    readonly segmento: string,
    readonly tribunal: string,
    readonly origem: string,
  ) {
    Object.freeze(this);
  }

  /**
   * Aceita com ou sem máscara e valida o dígito verificador.
   * @throws {NumeroCNJInvalidoError}
   */
  static criar(valor: string): NumeroCNJ {
    const bruto = (valor ?? '').trim();
    if (bruto === '') {
      throw new NumeroCNJInvalidoError(valor, 'valor vazio');
    }

    const digitos = bruto.replace(/\D/g, '');
    if (digitos.length !== 20) {
      throw new NumeroCNJInvalidoError(
        bruto,
        `esperado 20 dígitos, recebido ${digitos.length}`,
      );
    }

    const sequencial = digitos.slice(0, 7);
    const digitoVerificador = digitos.slice(7, 9);
    const ano = digitos.slice(9, 13);
    const segmento = digitos.slice(13, 14);
    const tribunal = digitos.slice(14, 16);
    const origem = digitos.slice(16, 20);

    const esperado = NumeroCNJ.calcularDigitoVerificador({
      sequencial,
      ano,
      segmento,
      tribunal,
      origem,
    });
    if (esperado !== digitoVerificador) {
      throw new NumeroCNJInvalidoError(
        bruto,
        `dígito verificador ${digitoVerificador} não confere (esperado ${esperado})`,
      );
    }

    const anoNumerico = Number(ano);
    if (anoNumerico < 1900) {
      throw new NumeroCNJInvalidoError(bruto, `ano implausível (${ano})`);
    }

    return new NumeroCNJ(
      digitos,
      sequencial,
      digitoVerificador,
      anoNumerico,
      segmento,
      tribunal,
      origem,
    );
  }

  /** Variante que não lança — útil em validação de formulário e em filtros. */
  static tentarCriar(valor: string): NumeroCNJ | null {
    try {
      return NumeroCNJ.criar(valor);
    } catch {
      return null;
    }
  }

  /**
   * ISO 7064 MOD 97-10: DV = 98 − ((NNNNNNN AAAA J TR OOOO) · 100 mod 97).
   * BigInt porque o número concatenado tem 20 dígitos e estoura o Number seguro.
   */
  private static calcularDigitoVerificador(partes: {
    sequencial: string;
    ano: string;
    segmento: string;
    tribunal: string;
    origem: string;
  }): string {
    const { sequencial, ano, segmento, tribunal, origem } = partes;
    const base = `${sequencial}${ano}${segmento}${tribunal}${origem}00`;
    const resto = BigInt(base) % 97n;
    return String(98n - resto).padStart(2, '0');
  }

  /** Sigla do tribunal deduzida de J.TR — ex.: "8.26" → "TJSP". */
  get siglaTribunal(): string | null {
    return SIGLAS_POR_SEGMENTO_TRIBUNAL.get(`${this.segmento}.${this.tribunal}`) ?? null;
  }

  /** NNNNNNN-DD.AAAA.J.TR.OOOO */
  get formatado(): string {
    return `${this.sequencial}-${this.digitoVerificador}.${this.ano}.${this.segmento}.${this.tribunal}.${this.origem}`;
  }

  equals(outro: NumeroCNJ): boolean {
    return this.digitos === outro.digitos;
  }

  toString(): string {
    return this.formatado;
  }

  toJSON(): string {
    return this.formatado;
  }
}

/**
 * Mapa J.TR → sigla: Justiça Estadual (J = 8), Federal (J = 4) e do Trabalho
 * (J = 5). Ampliar conforme os adapters crescerem.
 */
const SIGLAS_POR_SEGMENTO_TRIBUNAL = new Map<string, string>([
  // Justiça Estadual (J = 8)
  ['8.01', 'TJAC'],
  ['8.02', 'TJAL'],
  ['8.03', 'TJAP'],
  ['8.04', 'TJAM'],
  ['8.05', 'TJBA'],
  ['8.06', 'TJCE'],
  ['8.07', 'TJDFT'],
  ['8.08', 'TJES'],
  ['8.09', 'TJGO'],
  ['8.10', 'TJMA'],
  ['8.11', 'TJMT'],
  ['8.12', 'TJMS'],
  ['8.13', 'TJMG'],
  ['8.14', 'TJPA'],
  ['8.15', 'TJPB'],
  ['8.16', 'TJPR'],
  ['8.17', 'TJPE'],
  ['8.18', 'TJPI'],
  ['8.19', 'TJRJ'],
  ['8.20', 'TJRN'],
  ['8.21', 'TJRS'],
  ['8.22', 'TJRO'],
  ['8.23', 'TJRR'],
  ['8.24', 'TJSC'],
  ['8.25', 'TJSE'],
  ['8.26', 'TJSP'],
  ['8.27', 'TJTO'],
  // Justiça Federal (J = 4)
  ['4.01', 'TRF1'],
  ['4.02', 'TRF2'],
  ['4.03', 'TRF3'],
  ['4.04', 'TRF4'],
  ['4.05', 'TRF5'],
  ['4.06', 'TRF6'],
  // Justiça do Trabalho (J = 5). As 24 regiões, mais o TST em TR = 00 — no
  // padrão do CNJ, tribunal `00` é o tribunal superior do segmento.
  //
  // Verificado contra número real: 0011242-47.2021.5.18.0016 (TRT18, Goiás).
  // As demais regiões seguem o mesmo padrão J.TR, que é posicional e não
  // comporta exceção — a região do número É o número da região.
  ['5.01', 'TRT1'],
  ['5.02', 'TRT2'],
  ['5.03', 'TRT3'],
  ['5.04', 'TRT4'],
  ['5.05', 'TRT5'],
  ['5.06', 'TRT6'],
  ['5.07', 'TRT7'],
  ['5.08', 'TRT8'],
  ['5.09', 'TRT9'],
  ['5.10', 'TRT10'],
  ['5.11', 'TRT11'],
  ['5.12', 'TRT12'],
  ['5.13', 'TRT13'],
  ['5.14', 'TRT14'],
  ['5.15', 'TRT15'],
  ['5.16', 'TRT16'],
  ['5.17', 'TRT17'],
  ['5.18', 'TRT18'],
  ['5.19', 'TRT19'],
  ['5.20', 'TRT20'],
  ['5.21', 'TRT21'],
  ['5.22', 'TRT22'],
  ['5.23', 'TRT23'],
  ['5.24', 'TRT24'],
  ['5.00', 'TST'],
]);
