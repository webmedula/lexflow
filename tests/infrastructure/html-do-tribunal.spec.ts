import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  converterHtmlEmBlocos,
  decodificarEntidades,
} from '../../src/infrastructure/pdf/htmlDoTribunal.js';
import type { BlocoDeTexto } from '../../src/infrastructure/pdf/htmlDoTribunal.js';
import { QpdfMontador } from '../../src/infrastructure/pdf/QpdfMontador.js';
import { pastaTemporaria, textoDoPdf } from '../helpers/leitor.js';

function blocos(html: string, codificacao: BufferEncoding = 'utf8'): BlocoDeTexto[] {
  return [
    ...converterHtmlEmBlocos(new Uint8Array(Buffer.from(html, codificacao))).blocos,
  ];
}

function texto(b: BlocoDeTexto): string {
  if (b.tipo === 'separador') return '---';
  if (b.tipo === 'linhaDeTabela') return b.celulas.join(' | ');
  return b.trechos.map((t) => t.texto).join('');
}

describe('HTML do tribunal → blocos de texto', () => {
  it('p e br quebram linha; hr vira separador; espaço em branco colapsa', () => {
    const r = blocos('<p>um\n   dois</p><p>três<br/>quatro</p><hr><span>cinco</span>');
    expect(r.map(texto)).toEqual(['um dois', 'três', 'quatro', '---', 'cinco']);
  });

  it('strong e u viram negrito e sublinhado, aninhados ou não', () => {
    const [p] = blocos('<p>a <strong>b <strong>c</strong> d</strong> <u>e</u> f</p>');
    expect(p?.tipo).toBe('paragrafo');
    if (p?.tipo !== 'paragrafo') return;
    const negrito = p.trechos.filter((t) => t.negrito).map((t) => t.texto.trim());
    expect(negrito).toEqual(['b', 'c', 'd']);
    expect(p.trechos.find((t) => t.sublinhado)?.texto).toBe('e');
  });

  it('decodifica entidades nomeadas, numéricas e as de windows-1252 disfarçadas', () => {
    expect(
      decodificarEntidades(
        'a&nbsp;b &aacute;&Ccedil;&otilde; &#233;&#xE7; &#150; &ordm;',
      ),
    ).toBe('a b áÇõ éç – º');
    // Desconhecida fica como veio; nomeada sem ";" só as clássicas.
    expect(decodificarEntidades('&inventada; &parte &amp')).toBe('&inventada; &parte &');
  });

  it('&nbsp; não deixa caractere estranho: vira espaço comum na página', () => {
    expect(blocos('<p>art.&nbsp;5º</p>').map(texto)).toEqual(['art. 5º']);
  });

  it('ignora qualquer atributo, inclusive style e on*', () => {
    const r = blocos('<p style="color:red" onclick="roubar()" class="x">texto</p>');
    expect(r.map(texto)).toEqual(['texto']);
  });

  it('conta imagens pela tag, sem decodificar o base64, e não deixa o base64 no texto', () => {
    const base64 = 'A'.repeat(20_000);
    const r = converterHtmlEmBlocos(
      new Uint8Array(
        Buffer.from(
          `<p>antes</p><img src="data:image/png;base64,${base64}"><img src='x.png' alt="a>b">`,
        ),
      ),
    );
    expect(r.imagens).toBe(2);
    expect(r.blocos.map(texto)).toEqual(['antes']);
  });

  it('tabela vira "célula | célula" por linha, sem inventar layout, e é contada', () => {
    const r = converterHtmlEmBlocos(
      new Uint8Array(
        Buffer.from(
          '<table><tr><th>Nome</th><th>Valor</th></tr><tr><td>a</td><td>' +
            '<table><tr><td>dentro</td><td>da outra</td></tr></table></td></tr></table><p>fim</p>',
        ),
      ),
    );
    expect(r.tabelas).toBe(1);
    expect(r.blocos.map(texto)).toEqual(['Nome | Valor', 'a | dentro da outra', 'fim']);
  });

  it('script, iframe e afins são descartados com o conteúdo, e anotados', () => {
    const r = converterHtmlEmBlocos(
      new Uint8Array(
        Buffer.from(
          '<p>a</p><script>alert("x")</script><iframe src="y">z</iframe>' +
            '<style>p{}</style><!-- comentário --><p>b</p>',
        ),
      ),
    );
    expect(r.blocos.map(texto)).toEqual(['a', 'b']);
    // style é esperado (folha de estilo) e não vira aviso; script e iframe sim.
    expect(r.descartados).toEqual(['iframe', 'script']);
  });

  it('UTF-8 válido é lido como UTF-8; byte inválido cai para windows-1252', () => {
    expect(
      converterHtmlEmBlocos(new Uint8Array(Buffer.from('<p>ação</p>', 'utf8'))),
    ).toMatchObject({ codificacao: 'utf-8' });
    const w = converterHtmlEmBlocos(
      new Uint8Array([
        ...Buffer.from('<p>a'),
        0xe7,
        0xe3,
        ...Buffer.from('o ', 'latin1'),
        0x96,
        0x20,
        0x31,
        ...Buffer.from('</p>'),
      ]),
    );
    expect(w.codificacao).toBe('windows-1252');
    expect(w.blocos.map(texto)).toEqual(['ação – 1']);
  });

  it('"<" que não abre tag é texto', () => {
    expect(blocos('<p>se a < b então</p>').map(texto)).toEqual(['se a < b então']);
  });
});

describe('QpdfMontador.converterHtml', () => {
  let pasta: ReturnType<typeof pastaTemporaria>;
  beforeEach(() => {
    pasta = pastaTemporaria();
  });
  afterEach(() => {
    pasta.apagar();
  });

  it('texto longo quebra a linha e a página, sem sair da margem', async () => {
    const paragrafo = `<p>${'palavra '.repeat(400)}${'x'.repeat(300)}</p>`;
    const origem = join(pasta.caminho, 'longo.html');
    writeFileSync(origem, paragrafo.repeat(3));
    const destino = join(pasta.caminho, 'longo.pdf');
    const r = await new QpdfMontador().converterHtml(origem, destino);
    expect(r.ok).toBe(true);
    const inspecao = await new QpdfMontador().inspecionarPdf(destino);
    expect(inspecao.valido && inspecao.paginas).toBeGreaterThan(1);
    expect(textoDoPdf(readFileSync(destino))).toContain('palavra palavra');
  });

  it('fragmento sem texto nenhum ainda vira uma página que diz isso', async () => {
    const origem = join(pasta.caminho, 'vazio.html');
    writeFileSync(origem, '<img src="data:image/png;base64,AAAA">');
    const destino = join(pasta.caminho, 'vazio.pdf');
    const r = await new QpdfMontador().converterHtml(origem, destino);
    expect(r).toMatchObject({ ok: true, imagens: 1 });
    const t = textoDoPdf(readFileSync(destino));
    expect(t).toContain('(o documento não tem texto)');
    expect(t).toContain('tinha 1 imagem');
  });

  it('arquivo que não existe devolve ok: false em vez de lançar', async () => {
    const r = await new QpdfMontador().converterHtml(
      join(pasta.caminho, 'nao-existe.html'),
      join(pasta.caminho, 'x.pdf'),
    );
    expect(r.ok).toBe(false);
  });
});
