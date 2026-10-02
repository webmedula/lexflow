import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ESTILOS_CALENDARIO,
  SCRIPT_CALENDARIO,
} from '../../src/main/http/ui/calendario.js';
import { paginaConsole } from '../../src/main/http/ui/pagina.js';
import { SCRIPT } from '../../src/main/http/ui/script.js';

/*
 * A tela do calendário (v0.32.0) — o que dá para provar sem navegador.
 *
 * O comportamento foi testado num Chromium de verdade com dados sintéticos
 * (o roteiro e o resultado estão no relatório da entrega); aqui ficam as
 * garantias de ESTRUTURA que precisam valer em toda PR: arquivo próprio, nada
 * de fora, CSS que só age na própria tela, os ganchos com o console e o link
 * `/?processo=`. O ESLint dentro da string roda em `console-script.spec.ts`.
 */

const html = paginaConsole('0.0.0-teste');

describe('calendário — tela', () => {
  it('entra no menu e na página, em arquivo próprio', () => {
    expect(html).toContain('id="nav-calendario"');
    expect(html).toContain('<span>Calendário</span>');
    expect(html).toContain(SCRIPT_CALENDARIO.trim().slice(0, 40));
    expect(html).toContain(ESTILOS_CALENDARIO.trim().slice(0, 40));
    // A tela não mora no script do console: ele só a chama.
    expect(SCRIPT).not.toContain('cal-grade');
    expect(SCRIPT).toContain('window.__pvCalendario.ver(');
  });

  it('script.ts não cresce (era 2.498 linhas antes do calendário)', () => {
    const linhas = readFileSync(
      resolve(__dirname, '../../src/main/http/ui/script.ts'),
      'utf8',
    ).split('\n').length;
    expect(linhas).toBeLessThanOrEqual(2499);
  });

  it('não carrega nada de fora', () => {
    expect(SCRIPT_CALENDARIO).not.toMatch(/https?:\/\//);
    expect(SCRIPT_CALENDARIO).not.toMatch(/<script|<link/i);
    expect(ESTILOS_CALENDARIO).not.toMatch(/https?:\/\/|@import|url\(/);
  });

  it('o CSS só age dentro da tela do calendário (e no destaque do andamento)', () => {
    const corpo = ESTILOS_CALENDARIO.replace(/\/\*[\s\S]*?\*\//g, '');
    const seletores = corpo
      .split('}')
      .map((r) => r.split('{')[0]?.trim() ?? '')
      .filter((s) => s.length > 0 && !s.startsWith('@media'))
      .flatMap((s) => s.split(','))
      .map((s) => s.replace(/^.*\{/, '').trim())
      .filter((s) => s.length > 0);
    expect(seletores.length).toBeGreaterThan(20);
    for (const s of seletores) expect(s, s).toMatch(/^(\.cal\b|\.ev\.cal-alvo$)/);
  });

  it('sugerido se distingue por RÓTULO escrito, não só por cor', () => {
    expect(SCRIPT_CALENDARIO).toContain('>Sugerido</span>');
    expect(SCRIPT_CALENDARIO).toContain("'<b>Sugerido</b> '");
    expect(SCRIPT_CALENDARIO).toContain("' sug.'");
  });

  it('não afirma prazo e diz de onde a data veio', () => {
    expect(SCRIPT_CALENDARIO).toContain('Lido do andamento de ');
    expect(SCRIPT_CALENDARIO).toContain('não um prazo calculado');
    expect(SCRIPT_CALENDARIO).not.toMatch(/prazo fatal|vence em|dias restantes/i);
  });

  it('a URL do feed aparece uma vez: some ao sair e voltar à tela', () => {
    const ver = SCRIPT_CALENDARIO.slice(SCRIPT_CALENDARIO.indexOf('function ver(alvo){'));
    expect(ver.slice(0, 300)).toContain("st.urlNova='';");
  });

  it('plano sem o recurso mostra a mensagem do servidor, não a tradução de 403 do tribunal', () => {
    expect(SCRIPT_CALENDARIO).toContain('e.status===402||e.status===403');
  });

  it('/?processo=<número>: lido, apagado da barra e atendido quando a sessão abre', () => {
    expect(SCRIPT_CALENDARIO).toContain("busca.get('processo')");
    expect(SCRIPT_CALENDARIO).toContain('history.replaceState');
    expect(SCRIPT_CALENDARIO).toContain('pedido.length===20');
    expect(SCRIPT_CALENDARIO).toContain('window.__pvAoIniciar=');
    expect(SCRIPT).toContain('if(window.__pvAoIniciar)window.__pvAoIniciar();');
  });

  it('cada andamento da linha do tempo leva a data, para o "ver o andamento" achá-lo', () => {
    expect(SCRIPT).toContain(`data-quando="'+esc(m.data)+'"`);
    expect(SCRIPT_CALENDARIO).toContain('.ev[data-quando="');
  });
});
