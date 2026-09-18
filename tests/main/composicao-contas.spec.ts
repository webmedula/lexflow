import { describe, expect, it } from 'vitest';
import { carregarConfig } from '../../src/infrastructure/config/env.js';
import { montarAplicacao } from '../../src/main/factories/makeProcessoSearchService.js';

function montar(extra: Record<string, string>) {
  return montarAplicacao(
    carregarConfig({
      PROCESSOVIVO_PROVIDER_CHAIN: 'mock-crawler-tjsp',
      PROCESSOVIVO_API_KEYS: 'chave-de-teste-1234567890',
      PROCESSOVIVO_DB_PATH: ':memory:',
      LOG_LEVEL: 'silent',
      SYNC_INTERVALO_HORAS: '0',
      VIGILANCIA_INTERVALO_HORAS: '0',
      BACKUP_INTERVALO_HORAS: '0',
      ...extra,
    } as NodeJS.ProcessEnv),
  );
}

describe('composition root — quando a recuperação de senha existe', () => {
  it('NÃO existe com endereço público mas sem SMTP', () => {
    /*
     * Achado de revisão. Sem SMTP, o notificador vira `LogNotificador`, que se
     * declara `habilitado` DE PROPÓSITO — para a vigilância isso é certo: o
     * caminho inteiro é exercitado e o resumo aparece no log.
     *
     * Para a recuperação de senha é desastroso. O "envio" que vai para o log é
     * um token que ninguém recebe: a pessoa vê "confira seu e-mail", o link
     * nasce gasto, e depois de cinco tentativas fica uma hora travada sem
     * entender por quê. Log não é entrega.
     */
    const app = montar({ PROCESSOVIVO_URL_BASE: 'https://processovivo.exemplo.com.br' });
    try {
      expect(app.contas.podeRecuperarSenha).toBe(false);
    } finally {
      app.encerrar();
    }
  });

  it('NÃO existe com SMTP mas sem endereço público', () => {
    // Link relativo em e-mail não leva a lugar nenhum.
    const app = montar({ SMTP_HOST: 'smtp.exemplo.com', SMTP_FROM: 'a@b.com.br' });
    try {
      expect(app.contas.podeRecuperarSenha).toBe(false);
    } finally {
      app.encerrar();
    }
  });

  it('existe com os dois', () => {
    const app = montar({
      SMTP_HOST: 'smtp.exemplo.com',
      SMTP_FROM: 'a@b.com.br',
      PROCESSOVIVO_URL_BASE: 'https://processovivo.exemplo.com.br',
    });
    try {
      expect(app.contas.podeRecuperarSenha).toBe(true);
    } finally {
      app.encerrar();
    }
  });
});
