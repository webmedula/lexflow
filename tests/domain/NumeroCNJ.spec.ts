import { describe, expect, it } from 'vitest';
import { NumeroCNJ } from '../../src/domain/entities/NumeroCNJ.js';
import { NumeroCNJInvalidoError } from '../../src/domain/errors/index.js';

describe('NumeroCNJ', () => {
  it('aceita número real do CNJ com máscara', () => {
    // Exemplo publicado pelo CNJ na documentação da API Pública do DataJud.
    const numero = NumeroCNJ.criar('0000832-35.2018.4.01.3202');

    expect(numero.digitos).toBe('00008323520184013202');
    expect(numero.sequencial).toBe('0000832');
    expect(numero.digitoVerificador).toBe('35');
    expect(numero.ano).toBe(2018);
    expect(numero.segmento).toBe('4');
    expect(numero.tribunal).toBe('01');
    expect(numero.origem).toBe('3202');
    expect(numero.siglaTribunal).toBe('TRF1');
  });

  it('aceita o mesmo número sem máscara e produz instância equivalente', () => {
    const comMascara = NumeroCNJ.criar('1234567-47.2023.8.26.0100');
    const semMascara = NumeroCNJ.criar('12345674720238260100');

    expect(semMascara.equals(comMascara)).toBe(true);
    expect(semMascara.formatado).toBe('1234567-47.2023.8.26.0100');
  });

  it('deduz TJSP do segmento 8 e tribunal 26', () => {
    expect(NumeroCNJ.criar('1234567-47.2023.8.26.0100').siglaTribunal).toBe('TJSP');
  });

  it('rejeita dígito verificador trocado — o erro de digitação mais comum', () => {
    expect(() => NumeroCNJ.criar('1234567-48.2023.8.26.0100')).toThrow(
      NumeroCNJInvalidoError,
    );
  });

  it('rejeita quantidade de dígitos diferente de 20', () => {
    expect(() => NumeroCNJ.criar('123456747202382601')).toThrow(NumeroCNJInvalidoError);
    expect(() => NumeroCNJ.criar('')).toThrow(NumeroCNJInvalidoError);
  });

  it('tentarCriar devolve null em vez de lançar', () => {
    expect(NumeroCNJ.tentarCriar('numero-invalido')).toBeNull();
    expect(NumeroCNJ.tentarCriar('1234567-47.2023.8.26.0100')).not.toBeNull();
  });

  it('é imutável', () => {
    const numero = NumeroCNJ.criar('1234567-47.2023.8.26.0100');
    expect(Object.isFrozen(numero)).toBe(true);
  });

  it('serializa para JSON no formato com máscara', () => {
    const numero = NumeroCNJ.criar('12345674720238260100');
    expect(JSON.parse(JSON.stringify({ numero }))).toEqual({
      numero: '1234567-47.2023.8.26.0100',
    });
  });

  it('devolve null na sigla quando o segmento/tribunal não está mapeado', () => {
    // Segmento 9 não existe na Resolução 65 — o DV, porém, é válido.
    const digitos = construirNumeroValido('1234567', '2023', '9', '99', '0100');
    expect(NumeroCNJ.criar(digitos).siglaTribunal).toBeNull();
  });
});

/** Monta um número com DV correto — evita fixture com DV inválido no teste. */
function construirNumeroValido(
  sequencial: string,
  ano: string,
  segmento: string,
  tribunal: string,
  origem: string,
): string {
  const base = BigInt(`${sequencial}${ano}${segmento}${tribunal}${origem}00`);
  const dv = String(98n - (base % 97n)).padStart(2, '0');
  return `${sequencial}${dv}${ano}${segmento}${tribunal}${origem}`;
}
