// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // scripts/ são utilitários .mjs de linha de comando: escrevem no console por
  // definição e não passam pelo pipeline de tipos do projeto.
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'scripts/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      // Prefixo "_" marca parâmetro exigido pelo contrato mas não usado pela
      // implementação — é o caso de `buscarPorOab` no DataJudAdapter.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/explicit-function-return-type': [
        'warn',
        { allowExpressions: true },
      ],
      'no-console': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // CLI, entrypoint HTTP e logger são as únicas fronteiras autorizadas a
    // escrever direto no stdout/stderr. O entrypoint precisa porque erros de
    // arranque acontecem antes de existir um logger montado.
    files: [
      'src/main/cli.ts',
      'src/main/http/index.ts',
      'src/infrastructure/logging/**/*.ts',
    ],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['tests/**/*.ts'],
    rules: { '@typescript-eslint/explicit-function-return-type': 'off' },
  },
);
