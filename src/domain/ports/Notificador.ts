/**
 * Uma mensagem pronta para sair. Sem HTML obrigatório: o texto puro é o que
 * sempre funciona, e é o que vai no corpo quando o cliente de e-mail do
 * destinatário recusa HTML.
 */
export interface Mensagem {
  readonly para: string;
  readonly assunto: string;
  readonly texto: string;
  readonly html?: string;
}

/**
 * PORTA de saída para avisar o usuário.
 *
 * Existe como porta, e não como uma chamada direta ao nodemailer, porque o
 * canal vai mudar: hoje e-mail, amanhã WhatsApp pela Cloud API da Meta, e
 * provavelmente os dois ao mesmo tempo com regras diferentes (o e-mail carrega
 * o inteiro teor de 20 mil caracteres; o template do WhatsApp carrega uma linha
 * e um link). Quando isso acontecer, o serviço que monta o resumo não muda.
 *
 * `enviar` NUNCA lança: falha de notificação não pode derrubar a varredura que
 * a originou. Devolve `false` e registra o motivo — o dado já está salvo, o que
 * se perdeu foi o aviso.
 */
/**
 * O resultado de conferir o canal SEM enviar nada.
 *
 * `motivo` é escrito para quem está configurando o servidor, não para o
 * assinante: nomeia a causa provável e o que mexer.
 */
export interface DiagnosticoNotificador {
  readonly ok: boolean;
  readonly motivo?: string;
  /** Código bruto do servidor ou da biblioteca (EAUTH, ETIMEDOUT, 535…). */
  readonly codigo?: string;
}

export interface Notificador {
  readonly nome: string;
  readonly habilitado: boolean;
  enviar(mensagem: Mensagem): Promise<boolean>;

  /**
   * Confere conexão e autenticação sem mandar mensagem. Opcional: só faz
   * sentido em canal que tem mais de um jeito de falhar.
   *
   * Existe pelo mesmo motivo que `diagnosticar()` no `ProcessoProvider`:
   * devolver só `false` obriga quem opera a adivinhar entre senha errada,
   * porta bloqueada e servidor fora do ar — três problemas com consertos
   * completamente diferentes. E separar CONFERIR de ENVIAR importa porque a
   * maioria das falhas de SMTP acontece antes da mensagem existir.
   */
  diagnosticar?(): Promise<DiagnosticoNotificador>;
}

/**
 * Notificador que não envia nada, usado quando não há SMTP configurado.
 *
 * Existe para que o resto do sistema nunca precise perguntar "tem notificador?"
 * — o Null Object responde `habilitado: false` e o serviço decide uma vez, no
 * lugar certo, em vez de espalhar `if` por toda parte.
 */
export const notificadorDesligado: Notificador = {
  nome: 'desligado',
  habilitado: false,
  enviar: async () => false,
};
