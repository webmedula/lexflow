import { describe, expect, it } from 'vitest';
import { ESTILOS } from '../../src/main/http/ui/estilos.js';
import { paginaConsole } from '../../src/main/http/ui/pagina.js';
import { paginaAdmin } from '../../src/main/http/ui/paginaAdmin.js';
import { SCRIPT } from '../../src/main/http/ui/script.js';

/** O corpo de uma função do script do console, até a próxima função de topo. */
function corpoDe(nome: string): string {
  const inicio = SCRIPT.indexOf(`function ${nome}(`);
  expect(inicio, `função ${nome} não encontrada`).toBeGreaterThanOrEqual(0);
  const fim = SCRIPT.indexOf('\nfunction ', inicio + 1);
  return SCRIPT.slice(inicio, fim === -1 ? undefined : fim);
}

describe('console — rotular cliente', () => {
  it('a carteira liga a rotulagem, que é onde os botões de rotular estão', () => {
    /*
     * Desde a v0.25.0 a rotulagem era ligada só na tela de Atualizações, que
     * não tem botão de rotular nenhum. Na carteira o botão aparecia e o clique
     * não fazia nada — relatado pelo dono do produto na v0.29.0.
     */
    expect(corpoDe('verProcessos')).toContain('ligarRotulagem(alvo)');
    expect(corpoDe('tabelaDaCarteira') + corpoDe('celulaDeCliente')).toContain('data-rotular');
  });
});

describe('console — escolha de tema', () => {
  it('o escuro vale pelo sistema OU pela escolha, e o claro escolhido vence o sistema', () => {
    expect(ESTILOS).toContain(':root:not([data-tema=claro])');
    expect(ESTILOS).toContain(':root[data-tema=escuro]');
  });

  it('o tema escolhido é aplicado no <head>, antes de a página ser pintada', () => {
    for (const html of [paginaConsole('0.0.0'), paginaAdmin('0.0.0')]) {
      const cabeca = html.slice(0, html.indexOf('</head>'));
      expect(cabeca).toContain("localStorage.getItem('processovivo.tema')");
      // Antes do CSS: aplicado depois, a tela piscaria do tema do sistema para o escolhido.
      expect(cabeca.indexOf('processovivo.tema')).toBeLessThan(cabeca.indexOf('<style>'));
    }
  });

  it('a lateral oferece a troca de tema', () => {
    expect(paginaConsole('0.0.0')).toContain('id="tema"');
    expect(SCRIPT).toContain("var TEMA='processovivo.tema'");
  });
});
