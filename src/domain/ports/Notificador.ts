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
export interface Notificador {
  readonly nome: string;
  readonly habilitado: boolean;
  enviar(mensagem: Mensagem): Promise<boolean>;
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
