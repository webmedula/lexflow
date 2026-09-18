import { describe, expect, it } from 'vitest';
import { EmailSmtpNotificador } from '../../src/infrastructure/notificacao/EmailSmtpNotificador.js';
import { loggerSilencioso } from '../../src/infrastructure/logging/ConsoleLogger.js';

/**
 * O diagnóstico do SMTP, exercitado pelo erro que o nodemailer de fato produz.
 *
 * Nenhum teste aqui toca a rede: o transporte é substituído por um dublê que
 * lança o erro que se quer traduzir, com o mesmo formato (code + message) que
 * a biblioteca usa.
 */
function comFalha(erro: unknown): EmailSmtpNotificador {
  const n = new EmailSmtpNotificador({
    host: 'smtp.exemplo.com',
    porta: 587,
    remetente: 'contato@exemplo.com.br',
    logger: loggerSilencioso,
  });
  // Substitui só o `verify`, mantendo o resto da classe real sob teste.
  (n as unknown as { transporte: { verify: () => Promise<void> } }).transporte = {
    verify: () => Promise.reject(erro),
  };
  return n;
}

function erroSmtp(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

describe('diagnóstico do SMTP', () => {
  it('distingue conexão RECUSADA de falha de TLS, apesar do mesmo código', async () => {
    /*
     * A regressão que motivou o teste. O nodemailer usa `ESOCKET` para os dois
     * casos, e a primeira versão da tradução via o código e culpava o TLS —
     * contra uma porta fechada, mandava mexer em SMTP_SECURE enquanto o
     * problema era a porta. Tradução que chuta é pior que o erro cru: o erro
     * cru pelo menos não desperdiça meia hora.
     */
    const recusada = await comFalha(
      erroSmtp('ESOCKET', 'connect ECONNREFUSED 127.0.0.1:2525'),
    ).diagnosticar();
    const tls = await comFalha(
      erroSmtp('ESOCKET', '140B: wrong version number'),
    ).diagnosticar();

    expect(recusada.motivo).toMatch(/RECUSADA/);
    expect(recusada.motivo).toMatch(/SMTP_PORT/);
    expect(tls.motivo).toMatch(/TLS/);
    expect(tls.motivo).toMatch(/SMTP_SECURE/);
  });

  it('separa certificado VENCIDO de porta TLS errada', async () => {
    /*
     * A segunda regressão desta função, e a mesma lição um nível mais fundo.
     *
     * A versão anterior já decidia pela mensagem em vez do código — mas casava
     * a palavra solta "certificate", e por isso mandou quem lia mexer em
     * SMTP_SECURE quando o servidor de e-mail estava com o certificado
     * vencido. Casar por palavra solta é chute com outro nome; o que distingue
     * os casos é a FRASE.
     */
    const vencido = await comFalha(
      erroSmtp('ESOCKET', 'certificate has expired'),
    ).diagnosticar();
    const portaErrada = await comFalha(
      erroSmtp('ESOCKET', '140B: wrong version number'),
    ).diagnosticar();

    expect(vencido.motivo).toMatch(/VENCIDO/);
    expect(vencido.motivo).not.toMatch(/SMTP_SECURE/);
    expect(portaErrada.motivo).toMatch(/SMTP_SECURE/);
  });

  it('reconhece certificado autoassinado e cadeia incompleta', async () => {
    const auto = await comFalha(
      erroSmtp('ESOCKET', 'self-signed certificate'),
    ).diagnosticar();
    const cadeia = await comFalha(
      erroSmtp('ESOCKET', 'unable to verify the first certificate'),
    ).diagnosticar();

    expect(auto.motivo).toMatch(/não é confiável/);
    expect(cadeia.motivo).toMatch(/não é confiável/);
    expect(auto.motivo).not.toMatch(/SMTP_SECURE/);
  });

  it('reconhece nome do certificado diferente do SMTP_HOST', async () => {
    const d = await comFalha(
      erroSmtp('ESOCKET', "Hostname/IP does not match certificate's altnames"),
    ).diagnosticar();

    expect(d.motivo).toMatch(/não corresponde ao SMTP_HOST/);
  });

  it('reconhece o EDNS que o nodemailer usa para nome que não resolve', async () => {
    // O código NÃO é ENOTFOUND, embora a mensagem traga esse texto dentro.
    const d = await comFalha(
      erroSmtp('EDNS', 'getaddrinfo ENOTFOUND smtp.invalido.exemplo'),
    ).diagnosticar();

    expect(d.ok).toBe(false);
    expect(d.codigo).toBe('EDNS');
    expect(d.motivo).toMatch(/não resolve/);
    expect(d.motivo).toMatch(/SMTP_HOST/);
  });

  it('aponta usuário e senha quando a autenticação é recusada', async () => {
    const d = await comFalha(
      erroSmtp('EAUTH', 'Invalid login: 535 Authentication failed'),
    ).diagnosticar();

    expect(d.motivo).toMatch(/usuário e senha/);
    expect(d.motivo).toMatch(/SMTP_USER/);
  });

  it('aponta o remetente quando o envelope é recusado', async () => {
    const d = await comFalha(
      erroSmtp('EENVELOPE', '550 sender address rejected'),
    ).diagnosticar();

    expect(d.motivo).toMatch(/remetente/);
    expect(d.motivo).toMatch(/SMTP_FROM/);
  });

  it('entrega o texto original quando não há evidência para palpite', async () => {
    // Sem palpite inventado: o texto cru é mais útil que uma causa errada.
    const d = await comFalha(erroSmtp('EQUALQUER', 'algo inesperado')).diagnosticar();

    expect(d.motivo).toBe('algo inesperado');
  });

  it('SEMPRE carrega o texto original junto da explicação', async () => {
    // Quem for depurar a fundo precisa da mensagem da biblioteca, não só da
    // nossa leitura dela.
    const d = await comFalha(
      erroSmtp('EAUTH', 'Invalid login: 535 Authentication failed'),
    ).diagnosticar();

    expect(d.motivo).toContain('Invalid login: 535 Authentication failed');
  });

  it('devolve ok quando o servidor aceita a conexão', async () => {
    const n = new EmailSmtpNotificador({
      host: 'smtp.exemplo.com',
      porta: 587,
      remetente: 'contato@exemplo.com.br',
      logger: loggerSilencioso,
    });
    (n as unknown as { transporte: { verify: () => Promise<void> } }).transporte = {
      verify: () => Promise.resolve(),
    };

    expect(await n.diagnosticar()).toEqual({ ok: true });
  });
});
