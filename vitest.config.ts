import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
    globals: false,
    // Vitest 3 / Vite 7: necessário porque `node:sqlite` é recente e versões
    // anteriores do Vite tentavam resolvê-lo como pacote em node_modules.
    server: { deps: { external: [/^node:sqlite$/] } },
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
