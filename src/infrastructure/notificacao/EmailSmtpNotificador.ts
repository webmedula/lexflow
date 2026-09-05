import { createTransport } from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { Logger } from '../../domain/ports/Logger.js';
import type { Mensagem, Notificador } from '../../domain/ports/Notificador.js';

export interface OpcoesEmailSmtp {
  readonly host: string;
  readonly porta: number;
  readonly usuario?: string;
  readonly senha?: string;
  /** TLS direto (porta 465). Em 587 o padrão é STARTTLS, que o nodemailer negocia. */
  readonly seguro?: boolean;
  /** Remetente. Precisa ser um endereço que o servidor SMTP autorize. */
  readonly remetente: string;
  readonly logger: Logger;
}

/**
 * Notificação por e-mail, via SMTP.
 *
 * SMTP e não a API de um provedor (Resend, SendGrid, SES) por dois motivos:
 * funciona com qualquer serviço — inclusive o SMTP que ele já tem no domínio,
 * sem cadastro novo — e não amarra o produto a um fornecedor que amanhã muda
 * preço ou fecha a conta por volume.
 *
 * E-mail é o PRIMEIRO canal, antes do WhatsApp, por três razões concretas:
 * não depende de template aprovado pela Meta, cabe o inteiro teor de uma
 * decisão de 20 mil caracteres, e advogado já lê intimação no e-mail — o hábito
 * existe.
 */
export class EmailSmtpNotificador implements Notificador {
  readonly nome = 'email-smtp';
  readonly habilitado = true;

  private readonly transporte: Transporter;
  private readonly remetente: string;
  private readonly log: Logger;

  constructor(opcoes: OpcoesEmailSmtp) {
    this.remetente = opcoes.remetente;
    this.log = opcoes.logger.child({ notificador: this.nome });
    this.transporte = createTransport({
      host: opcoes.host,
      port: opcoes.porta,
      secure: opcoes.seguro ?? opcoes.porta === 465,
      ...(opcoes.usuario
        ? { auth: { user: opcoes.usuario, pass: opcoes.senha ?? '' } }
        : {}),
    });
  }

  /**
   * Nunca lança — contrato da porta. Uma varredura que descobriu seis novidades
   * e as gravou não pode ser desfeita porque o servidor de e-mail recusou a
   * conexão: o dado está salvo, o que se perdeu foi o aviso, e é isso que o
   * log precisa dizer.
   */
  async enviar(mensagem: Mensagem): Promise<boolean> {
    try {
      await this.transporte.sendMail({
        from: this.remetente,
        to: mensagem.para,
        subject: mensagem.assunto,
        text: mensagem.texto,
        ...(mensagem.html ? { html: mensagem.html } : {}),
      });
      return true;
    } catch (erro) {
      // O endereço de destino NÃO vai para o log: é dado pessoal do assinante e
      // log costuma ir para serviço de terceiro. O assunto basta para achar
      // qual envio falhou.
      this.log.warn('falha ao enviar e-mail', {
        assunto: mensagem.assunto,
        erro: erro instanceof Error ? erro.message : String(erro),
      });
      return false;
    }
  }

  /** Fecha o pool de conexões no desligamento gracioso. */
  encerrar(): void {
    this.transporte.close();
  }
}

/**
 * Notificador que escreve no log em vez de enviar.
 *
 * Para desenvolvimento e para o caso de SMTP não configurado em produção: o
 * sistema continua exercitando todo o caminho — detecta, monta o resumo, "envia"
 * — e o operador vê no log exatamente o que teria saído. Melhor do que desligar
 * a funcionalidade e descobrir que ela nunca funcionou no dia em que ligar.
 */
export class LogNotificador implements Notificador {
  readonly nome = 'log';
  readonly habilitado = true;

  constructor(private readonly log: Logger) {}

  async enviar(mensagem: Mensagem): Promise<boolean> {
    this.log.info('notificação (SMTP não configurado — nada foi enviado)', {
      assunto: mensagem.assunto,
      linhas: mensagem.texto.split('\n').length,
    });
    return true;
  }
}
