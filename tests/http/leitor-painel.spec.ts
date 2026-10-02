import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { carregarConfig } from '../../src/infrastructure/config/env.js';
import type { Aplicacao } from '../../src/main/factories/makeProcessoSearchService.js';
import { construirServidor } from '../../src/main/http/servidor.js';
import { ESTILOS_LEITOR } from '../../src/main/http/ui/estilosLeitor.js';
import { paginaConsole } from '../../src/main/http/ui/pagina.js';
import { SCRIPT } from '../../src/main/http/ui/script.js';
import { SCRIPT_LEITOR } from '../../src/main/http/ui/scriptLeitor.js';
import { aplicacaoDeTeste } from '../helpers/aplicacao.js';
import { ProviderFalso } from '../helpers/fabricas.js';
import {
  PROCESSO_TJGO,
  ProvedorDeLoteFalso,
  pastaTemporaria,
  pdfSintetico,
} from '../helpers/leitor.js';

const CHAVE_A = 'chave-da-advogada-a-1234567890';
const CHAVE_B = 'chave-do-advogado-b-1234567890';
const A = { 'x-api-key': CHAVE_A };
const B = { 'x-api-key': CHAVE_B };

let pasta: ReturnType<typeof pastaTemporaria>;
let servidor: FastifyInstance;
let app: Aplicacao;

beforeEach(async () => {
  pasta = pastaTemporaria();
  app = aplicacaoDeTeste([new ProviderFalso({ nome: 'falso' })], {
    provedorDePecas: new ProvedorDeLoteFalso([
      { id: 'a', bytes: await pdfSintetico(1, 'A') },
    ]),
    leitor: { pasta: pasta.caminho },
  });
  servidor = construirServidor(
    app,
    carregarConfig({
      PROCESSOVIVO_PROVIDER_CHAIN: 'mock-crawler-tjsp',
      LOG_LEVEL: 'silent',
      CACHE_ENABLED: 'false',
      PROCESSOVIVO_API_KEYS: `${CHAVE_A},${CHAVE_B}`,
    } as NodeJS.ProcessEnv),
  );
  for (const h of [A, B]) {
    await servidor.inject({
      method: 'PUT',
      url: '/v1/credenciais',
      headers: h,
      payload: { tribunal: 'TJGO', identificacao: '00000000000', senha: 'segredo' },
    });
  }
});
afterEach(async () => {
  await servidor.close();
  pasta.apagar();
});

describe('PDF.js servido pelo próprio servidor', () => {
  it('serve o motor e o worker sem pedir chave — o navegador não manda x-api-key em import()', async () => {
    for (const arquivo of ['pdf.min.mjs', 'pdf.worker.min.mjs']) {
      const r = await servidor.inject({ url: `/ui/pdfjs/${arquivo}` });
      expect(r.statusCode).toBe(200);
      expect(r.headers['content-type']).toContain('text/javascript');
      expect(r.headers['x-content-type-options']).toBe('nosniff');
    }
  });

  it('serve o build LEGACY, com o polyfill que navegador de escritório precisa', async () => {
    // O build padrão do pdfjs-dist 6 chama Map.prototype.getOrInsertComputed,
    // que o Chromium dos testes não tem: a página ficava em branco, sem erro.
    const r = await servidor.inject({ url: '/ui/pdfjs/pdf.min.mjs' });
    expect(r.body).toContain('getOrInsertComputed:function');
  });

  it('serve as fontes padrão do PDF e o decodificador de JBIG2', async () => {
    expect((await servidor.inject({ url: '/ui/pdfjs/FoxitSerif.pfb' })).statusCode).toBe(
      200,
    );
    expect(
      (await servidor.inject({ url: '/ui/pdfjs/jbig2.wasm' })).headers['content-type'],
    ).toBe('application/wasm');
  });

  it('lista fechada: nome desconhecido ou caminho com ".." é 404', async () => {
    for (const url of [
      '/ui/pdfjs/pdf.mjs',
      '/ui/pdfjs/..%2Fpackage.json',
      '/ui/pdfjs/LICENSE',
      '/ui/pdfjs/%2Fetc%2Fpasswd',
    ]) {
      expect((await servidor.inject({ url })).statusCode, url).toBe(404);
    }
  });
});

describe('API — apoio ao painel', () => {
  it('estima em faixa e diz quando pedir confirmação (acima de 150 peças)', async () => {
    const muitas = (
      await servidor.inject({ url: '/v1/leitor/estimativa?pecas=278', headers: A })
    ).json();
    expect(muitas).toMatchObject({
      pecas: 278,
      confirmarAcimaDe: 150,
      exigeConfirmacao: true,
    });
    expect(muitas.minimoSegundos).toBeLessThan(muitas.maximoSegundos);
    const poucas = (
      await servidor.inject({ url: '/v1/leitor/estimativa?pecas=10', headers: A })
    ).json();
    expect(poucas.exigeConfirmacao).toBe(false);
    expect(
      (await servidor.inject({ url: '/v1/leitor/estimativa?pecas=-1', headers: A }))
        .statusCode,
    ).toBe(400);
  });

  it('reabre o último PDF do processo — e só o do próprio workspace', async () => {
    const url = `/v1/processos/${PROCESSO_TJGO}/leitor`;
    const vazio = { job: null, pronto: null, reaproveitaveis: [] };
    expect((await servidor.inject({ url, headers: A })).json()).toEqual(vazio);

    const criado = await servidor.inject({
      method: 'POST',
      url,
      headers: A,
      payload: { pecas: ['a'] },
    });
    await app.leitor?.processarFila();

    const ultimo = (await servidor.inject({ url, headers: A })).json();
    expect(ultimo.job).toMatchObject({ jobId: criado.json().jobId, estado: 'pronto' });
    // "Reabrir o PDF já pronto" e as peças que uma seleção nova não pede de novo.
    expect(ultimo.pronto).toMatchObject({ jobId: criado.json().jobId });
    expect(ultimo.reaproveitaveis).toEqual(['a']);
    expect((await servidor.inject({ url, headers: B })).json()).toEqual(vazio);
  });
});

describe('console — o painel do leitor', () => {
  it('vive em arquivo próprio: o script do console não carrega PDF.js', () => {
    expect(SCRIPT).not.toContain('getDocument');
    expect(SCRIPT).not.toContain('/ui/pdfjs/');
    expect(SCRIPT_LEITOR).toContain('getDocument');
  });

  it('entra na página sem <script src> e sem nada de fora', () => {
    const html = paginaConsole('0.0.0');
    expect(html).toContain(SCRIPT_LEITOR.trim().slice(0, 40));
    expect(html).toContain(ESTILOS_LEITOR.trim().slice(0, 40));
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(SCRIPT_LEITOR).not.toMatch(/https?:\/\//);
  });

  it('sem abrir o painel, a tela do processo é a de antes', () => {
    /*
     * O console só ganhou um botão ("Ler peças ao lado") e dois ganchos. O
     * gancho chamado a cada redesenho não mexe na régua enquanto o painel não
     * existe: caixas de marcar e links "p. N" nascem só depois de abrir.
     */
    const inicio = SCRIPT_LEITOR.indexOf('aposDesenhar:function');
    const corpo = SCRIPT_LEITOR.slice(
      inicio,
      SCRIPT_LEITOR.indexOf('trocouProcesso:', inicio),
    );
    expect(corpo.indexOf("if(!$('leitor'))return;")).toBeGreaterThan(0);
    expect(corpo.indexOf("if(!$('leitor'))return;")).toBeLessThan(
      corpo.indexOf('injetarCaixas()'),
    );
    // O CSS do leitor só age sob o painel aberto ou dentro dele.
    for (const regra of ESTILOS_LEITOR.split('}')) {
      const seletor = regra.split('{')[0]?.trim() ?? '';
      if (
        !seletor ||
        seletor.startsWith('/*') ||
        seletor.startsWith('@') ||
        seletor.startsWith(':root')
      )
        continue;
      expect(
        /#leitor|com-leitor|leitor-|\.sel|ir-pagina|no-leitor|^\s*$/.test(seletor),
        `regra que vaza para a tela sem painel: ${seletor}`,
      ).toBe(true);
    }
  });

  it('diz o estado com honestidade: progresso, pausa com horário, parcial, nunca "ao vivo"', () => {
    expect(SCRIPT_LEITOR).toContain('Baixando do tribunal:');
    expect(SCRIPT_LEITOR).toContain('Sem progresso desde');
    expect(SCRIPT_LEITOR).toContain('por volta das');
    expect(SCRIPT_LEITOR).toContain('não é consulta ao vivo');
    expect(SCRIPT_LEITOR).toContain('j.recusadas.forEach');
    // Três falhas seguidas na consulta de progresso: para e diz, com botão.
    expect(SCRIPT_LEITOR).toContain('st.erroPoll>=3');
  });

  it('abre com "Nova seleção" e "Reabrir o PDF já pronto"; a seleção nova começa VAZIA', () => {
    expect(SCRIPT_LEITOR).toContain('Reabrir o PDF já pronto');
    const inicio = SCRIPT_LEITOR.indexOf('function entrarNaSelecao(){');
    const corpo = SCRIPT_LEITOR.slice(
      inicio,
      SCRIPT_LEITOR.indexOf('function sairDaSelecao', inicio),
    );
    expect(corpo).toContain('st.selecao={}');
    // "Limpar seleção" sempre à mão; a anterior só volta se a pessoa pedir.
    expect(SCRIPT_LEITOR).toContain('Limpar seleção');
    expect(SCRIPT_LEITOR).toContain('Repetir a seleção anterior');
    // A estimativa conta só o que vai ao tribunal.
    expect(SCRIPT_LEITOR).toContain('pedirEstimativa(novas)');
  });

  it('"Baixar selecionadas (N)" recorta sem tribunal e diz quando o PDF já expirou', () => {
    expect(SCRIPT_LEITOR).toContain("'Baixar selecionadas ('+n+')'");
    expect(SCRIPT_LEITOR).toContain('-pecas-selecionadas.pdf');
    expect(SCRIPT_LEITOR).toContain('e.status===410');
    expect(SCRIPT_LEITOR).toContain('Nada foi pedido ao tribunal');
  });

  it('o painel nunca passa da largura da janela', () => {
    // A largura salva pelo divisor numa janela grande é cortada na pequena.
    expect(ESTILOS_LEITOR).toContain('width:min(var(--leitor-w),100vw)');
    expect(ESTILOS_LEITOR).toContain('padding-right:min(var(--leitor-w),100vw)');
    expect(ESTILOS_LEITOR).toContain('overflow-x:hidden');
    // O select "Ir para a peça" media a opção mais longa e empurrava a borda.
    expect(ESTILOS_LEITOR).toMatch(/#leitor \.ferramentas select\{[^}]*min-width:0/);
    expect(SCRIPT_LEITOR).toContain("window.addEventListener('resize',st.redimensionar)");
    expect(SCRIPT_LEITOR).toContain(
      "window.removeEventListener('resize',st.redimensionar)",
    );
  });

  it('lê o PDF por trechos e desenha só o que está perto da tela', () => {
    expect(SCRIPT_LEITOR).toContain('disableAutoFetch:true');
    expect(SCRIPT_LEITOR).toContain('disableStream:true');
    expect(SCRIPT_LEITOR).toContain('IntersectionObserver');
    expect(SCRIPT_LEITOR).toContain('MAX_DESENHADAS');
  });
});
