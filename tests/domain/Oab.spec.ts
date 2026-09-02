import { describe, expect, it } from 'vitest';
import { Oab } from '../../src/domain/entities/Oab.js';
import { OabInvalidaError } from '../../src/domain/errors/index.js';

describe('Oab', () => {
  it('normaliza UF minúscula e remove zeros à esquerda', () => {
    const oab = Oab.criar('0234567', 'sp');
    expect(oab.numero).toBe('234567');
    expect(oab.uf).toBe('SP');
    expect(oab.formatado).toBe('234567/SP');
  });

  it('aceita letra de subcategoria', () => {
    const oab = Oab.criar('123456N', 'RJ');
    expect(oab.letra).toBe('N');
    expect(oab.formatado).toBe('123456N/RJ');
  });

  it('aceita pontuação usada nas carteiras', () => {
    expect(Oab.criar('234.567', 'SP').numero).toBe('234567');
  });

  it('rejeita UF inexistente', () => {
    expect(() => Oab.criar('234567', 'XX')).toThrow(OabInvalidaError);
  });

  it('rejeita número não numérico ou longo demais', () => {
    expect(() => Oab.criar('abc', 'SP')).toThrow(OabInvalidaError);
    expect(() => Oab.criar('12345678', 'SP')).toThrow(OabInvalidaError);
  });

  it('tentarCriar devolve null em vez de lançar', () => {
    expect(Oab.tentarCriar('234567', 'XX')).toBeNull();
  });
});
