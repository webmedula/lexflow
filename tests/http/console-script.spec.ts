import { Linter } from 'eslint';
import globals from 'globals';
import { describe, expect, it } from 'vitest';
import { SCRIPT } from '../../src/main/http/ui/script.js';

/*
 * O console é JavaScript dentro de uma string.
 *
 * Isso é decisão de arquitetura, e boa: sem passo de build, sem bundler, sem
 * node_modules na imagem — a API serve a própria interface. O preço é que nem o
 * `tsc` nem o `eslint` enxergam uma linha dela. O arquivo é um `String.raw`, e
 * para as duas ferramentas é só texto.
 *
 * O preço foi cobrado em produção: um bloco copiado da tela de processos para a
 * de novidades referenciava um `f` que só existia lá. Resultado: `ReferenceError`
 * lançado DEPOIS de a tela ser pintada, o `catch` trocando o conteúdo inteiro
 * por uma caixa de erro, e a aba inicial do sistema inutilizada. 486 testes
 * verdes, `typecheck` limpo, `lint` limpo.
 *
 * Este teste tira a string do arquivo e manda o ESLint olhar o que ela tem
 * dentro. Não é cobertura de comportamento — para isso seria preciso um
 * navegador — mas pega a família inteira de erros que o bug acima representa:
 * variável não declarada, erro de digitação em nome, sintaxe quebrada.
 */
describe('console web — o JavaScript da interface', () => {
  const linter = new Linter();

  /** Roda o ESLint sobre a string, com os globais que um navegador oferece. */
  function analisar() {
    return linter.verify(SCRIPT, {
      languageOptions: {
        ecmaVersion: 2020,
        sourceType: 'script',
        globals: { ...globals.browser },
      },
      rules: {
        // A regra que pega o bug real: nome usado e nunca declarado.
        'no-undef': 'error',
        // Parentes próximos, e baratos de manter ligados.
        'no-dupe-keys': 'error',
        'no-dupe-args': 'error',
        'no-unreachable': 'error',
        'no-const-assign': 'error',
        'no-func-assign': 'error',
      },
    });
  }

  it('não usa nenhuma variável que não existe', () => {
    const problemas = analisar().filter((m) => m.ruleId === 'no-undef');

    // A mensagem do erro nomeia a variável e a linha — quem quebrar isto
    // precisa saber ONDE, não só QUE quebrou.
    expect(
      problemas.map((m) => `linha ${m.line}: ${m.message}`),
      'variável usada e nunca declarada no script do console',
    ).toEqual([]);
  });

  it('não tem erro de sintaxe', () => {
    // `verify` devolve um erro fatal em vez de lançar. Sem esta checagem, um
    // script quebrado passaria pelo teste acima com a lista vazia — porque
    // nada foi analisado.
    const fatais = analisar().filter((m) => m.fatal);

    expect(fatais.map((m) => `linha ${m.line}: ${m.message}`)).toEqual([]);
  });

  it('passa nas demais regras de erro provável', () => {
    const problemas = analisar().filter((m) => !m.fatal && m.ruleId !== 'no-undef');

    expect(problemas.map((m) => `linha ${m.line}: ${m.ruleId} — ${m.message}`)).toEqual(
      [],
    );
  });
});
