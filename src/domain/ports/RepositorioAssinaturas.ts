import type { Assinatura } from '../entities/Assinatura.js';

/**
 * Persistência das assinaturas, uma por workspace.
 *
 * Uma por workspace, e não por usuário: o workspace já é a unidade de
 * isolamento de tudo — carteira, credenciais, vigilâncias. Assinatura por
 * usuário criaria um segundo eixo, e no dia em que o escritório tiver dois
 * advogados no mesmo ambiente ninguém saberia qual assinatura vale.
 *
 * O `status` NÃO é coluna. Ele é derivado das datas na entidade — ver o
 * comentário em `Assinatura.statusEm`. Guardar status aqui exigiria uma tarefa
 * que o mantivesse atualizado, e é justamente a tarefa que pode não ter
 * rodado.
 */
/**
 * Etapa do ciclo em que um aviso já foi enviado.
 *
 * Fica FORA da entidade de propósito: é escrituração de quem já foi avisado,
 * não uma propriedade da assinatura. Misturar as duas coisas faria `Assinatura`
 * mudar de identidade por causa de um e-mail.
 */
export type EtapaDeAviso = 'vencendo' | 'carencia' | 'bloqueada';

export interface RepositorioAssinaturas {
  porWorkspace(workspace: string): Promise<Assinatura | undefined>;

  /**
   * Cria ou substitui a assinatura daquele workspace.
   *
   * **Zera a etapa de aviso.** Renovar abre uma vigência nova, e a vigência
   * nova precisa poder avisar de novo quando chegar a vez dela.
   */
  salvar(assinatura: Assinatura): Promise<void>;

  /** Qual aviso já saiu nesta vigência, se algum. */
  ultimoAviso(workspace: string): Promise<EtapaDeAviso | undefined>;

  registrarAviso(workspace: string, etapa: EtapaDeAviso): Promise<void>;

  /**
   * Assinaturas cujo vencimento cai até `limite`, para os avisos.
   *
   * Traz as canceladas de fora: quem cancelou já sabe, e insistir por e-mail
   * depois do cancelamento é o comportamento que faz a pessoa marcar o
   * remetente como spam — levando junto o aviso de prazo dos outros.
   */
  aVencerAte(limite: Date): Promise<readonly Assinatura[]>;

  /** Todas, para o comando de diagnóstico. Não use em caminho de requisição. */
  todas(): Promise<readonly Assinatura[]>;
}
