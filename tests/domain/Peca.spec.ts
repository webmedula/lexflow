import { describe, expect, it } from 'vitest';
import { Peca } from '../../src/domain/entities/Peca.js';

function peca(campos: Partial<{ tipoLocal: string; descricao: string }> = {}): Peca {
  return new Peca({ id: 'x', tipo: '57', ...campos });
}

describe('Peca — origem', () => {
  it('reconhece peça produzida pela parte', () => {
    expect(peca({ tipoLocal: 'Petição Inicial' }).origem).toBe('PARTE');
    expect(peca({ tipoLocal: 'Contestação' }).origem).toBe('PARTE');
    expect(peca({ tipoLocal: 'Laudo pericial' }).origem).toBe('PARTE');
  });

  it('reconhece ato do juízo', () => {
    expect(peca({ tipoLocal: 'Despacho' }).origem).toBe('JUIZO');
    expect(peca({ tipoLocal: 'Sentença' }).origem).toBe('JUIZO');
    expect(peca({ tipoLocal: 'Decisão interlocutória' }).origem).toBe('JUIZO');
  });

  it('ignora acentuação e caixa', () => {
    expect(peca({ tipoLocal: 'PETICAO INICIAL' }).origem).toBe('PARTE');
    expect(peca({ tipoLocal: 'sentenca' }).origem).toBe('JUIZO');
  });

  it('dá precedência ao juízo quando os dois rótulos aparecem', () => {
    // "Juntada de Certidão" tem marca das duas listas, e o ato é do cartório.
    expect(peca({ tipoLocal: 'Juntada de Certidão' }).origem).toBe('JUIZO');
  });

  it('admite não saber, em vez de chutar', () => {
    expect(peca({ tipoLocal: 'Anexo 3' }).origem).toBe('DESCONHECIDA');
    expect(peca().origem).toBe('DESCONHECIDA');
  });
});

describe('Peca — exibição e teor', () => {
  it('usa o rótulo do tribunal quando existe', () => {
    expect(peca({ tipoLocal: 'Petição Inicial' }).rotulo).toBe('Petição Inicial');
  });

  it('cai para a descrição e depois para o tipo', () => {
    expect(peca({ descricao: 'Documento avulso' }).rotulo).toBe('Documento avulso');
    expect(peca().rotulo).toBe('documento 57');
  });

  it('nasce sem teor disponível até a fonte dizer o contrário', () => {
    // O padrão seguro é "não tenho o arquivo": a interface só oferece download
    // quando a fonte confirmou que entregou o conteúdo.
    expect(peca().conteudoDisponivel).toBe(false);
  });

  it('não deixa o teor entrar no JSON', () => {
    // `Peca` é metadado. O arquivo sai por rota própria, uma peça por vez —
    // senão uma listagem de processo despejaria dezenas de MB na resposta.
    expect(Object.keys(peca().toJSON())).not.toContain('bytes');
    expect(Object.keys(peca().toJSON())).not.toContain('conteudo');
  });

  it('marca sigilo a partir do nível informado pela fonte', () => {
    expect(new Peca({ id: 'x', tipo: '1', nivelSigilo: 0 }).sigilosa).toBe(false);
    expect(new Peca({ id: 'x', tipo: '1', nivelSigilo: 1 }).sigilosa).toBe(true);
  });

  it('é imutável', () => {
    const p = peca();
    expect(() => {
      (p as unknown as { id: string }).id = 'outro';
    }).toThrow();
  });

  it('serializa os anexos recursivamente', () => {
    const p = new Peca({
      id: 'pai',
      tipo: '57',
      vinculadas: [new Peca({ id: 'filho', tipo: '58' })],
    });
    const json = p.toJSON() as { vinculadas: Array<{ id: string }> };

    expect(json.vinculadas[0]?.id).toBe('filho');
  });
});
