import { describe, expect, it } from 'vitest';
import { pareceValorDeExemplo } from '../../src/infrastructure/config/placeholder.js';

describe('pareceValorDeExemplo', () => {
  it('acusa o placeholder que causou o incidente real', () => {
    // Este valor exato saiu do bloco de configuração do DEPLOY.md e foi colado
    // como estava no Easypanel. Não sendo vazio, o adapter do DataJud subiu com
    // ele e só falhou com 401 na consulta.
    expect(pareceValorDeExemplo('COLE_AQUI_A_CHAVE_DO_CNJ_OU_DEIXE_VAZIO')).toBe(true);
    expect(pareceValorDeExemplo('COLE_AQUI_A_CHAVE_GERADA_NO_PASSO_1')).toBe(true);
  });

  it('acusa outras formas comuns de placeholder', () => {
    const exemplos = [
      'SUA_CHAVE',
      'SUA_CHAVE_AQUI',
      'CHANGEME',
      'CHANGE_ME',
      'YOUR_KEY_HERE',
      'PLACEHOLDER',
      'XXXXXXXX',
      'TODO',
      'SUBSTITUA_ESTE_VALOR',
      'PREENCHA_COM_A_CHAVE',
    ];
    for (const valor of exemplos) {
      expect(pareceValorDeExemplo(valor), valor).toBe(true);
    }
  });

  it('NÃO acusa chave hexadecimal real', () => {
    // O falso positivo é o erro caro aqui: recusaria uma credencial legítima.
    const chave = 'e3867a5af3566d8ebe274e18f70d8533915590d45ea0d5cb5a35fb633cebc134';
    expect(pareceValorDeExemplo(chave)).toBe(false);
  });

  it('NÃO acusa chave base64 real, mesmo com maiúsculas e separadores', () => {
    const chave = 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';
    expect(pareceValorDeExemplo(chave)).toBe(false);
  });

  it('NÃO acusa valor vazio — ausência é outra condição, tratada em outro lugar', () => {
    expect(pareceValorDeExemplo('')).toBe(false);
    expect(pareceValorDeExemplo('   ')).toBe(false);
  });

  it('NÃO acusa string maiúscula sem termo suspeito', () => {
    expect(pareceValorDeExemplo('ABCDEF0123456789')).toBe(false);
    expect(pareceValorDeExemplo('PROD_TJSP')).toBe(false);
  });

  it('NÃO acusa texto com minúsculas, mesmo contendo termo suspeito', () => {
    // Formato de credencial fala mais alto que o termo: uma chave que por acaso
    // contenha "cole" no meio não pode ser recusada.
    expect(pareceValorDeExemplo('a1coleb2aqui3d4e5f6a7b8c9d0e1f2a3b4c5d6e')).toBe(false);
  });
});
