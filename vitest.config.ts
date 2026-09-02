import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
    globals: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/main/cli.ts', 'src/**/*.types.ts'],
      thresholds: {
        // O núcleo (domain + application) é o que precisa de cobertura alta.
        // Infra de I/O é coberta por testes de contrato, não por cobertura de linha.
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70,
      },
    },
  },
});
