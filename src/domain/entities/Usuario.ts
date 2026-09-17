import { EmailInvalidoError } from '../errors/index.js';

/**
 * O advogado assinante.
 *
 * Cada conta é um **ambiente isolado**: o `workspace` nasce com ela e nunca
 * muda, e é ele que separa os processos, as vigilâncias e as credenciais de
 * tribunal de um assinante dos de outro. É a mesma coluna que a chave de API já
 * preenchia — por isso nenhuma rota de dados precisou saber que contas passaram
 * a existir.
 *
 * O `workspace` é gerado, e NÃO derivado do e-mail. Derivar faria duas coisas
 * ruins: quem tivesse o e-mail conseguiria calcular o identificador do
 * ambiente alheio, e trocar de e-mail mudaria o ambiente da pessoa — perdendo
 * a carteira inteira num lugar onde ninguém espera perder nada.
 *
 * A SENHA não mora aqui. `Usuario` circula em resposta de API e em log; hash de
 * senha não pode circular em nenhum dos dois. Ele vive só no repositório, e sai
 * de lá apenas para a verificação.
 */
export interface UsuarioProps {
  readonly id: string;
  readonly email: string;
  readonly nome: string;
  readonly workspace: string;
  readonly criadoEm: Date;
  /** Inscrição na OAB, quando a pessoa já informou. Destrava a vigilância. */
  readonly oab?: string;
  readonly ufOab?: string;
  readonly ultimoAcessoEm?: Date;
}

export class Usuario {
  readonly id: string;
  readonly email: string;
  readonly nome: string;
  readonly workspace: string;
  readonly criadoEm: Date;
  readonly oab: string | undefined;
  readonly ufOab: string | undefined;
  readonly ultimoAcessoEm: Date | undefined;

  constructor(props: UsuarioProps) {
    this.id = props.id;
    this.email = props.email;
    this.nome = props.nome;
    this.workspace = props.workspace;
    this.criadoEm = props.criadoEm;
    this.oab = props.oab;
    this.ufOab = props.ufOab;
    this.ultimoAcessoEm = props.ultimoAcessoEm;

    Object.freeze(this);
  }

  /** A pessoa já informou a inscrição — a vigilância por OAB pode ser ligada. */
  get temOab(): boolean {
    return Boolean(this.oab && this.ufOab);
  }

  get primeiroNome(): string {
    return this.nome.trim().split(/\s+/)[0] ?? this.nome;
  }

  toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      email: this.email,
      nome: this.nome,
      oab: this.oab ?? null,
      ufOab: this.ufOab ?? null,
      criadoEm: this.criadoEm.toISOString(),
      ultimoAcessoEm: this.ultimoAcessoEm?.toISOString() ?? null,
      // `workspace` NÃO sai: é o identificador do ambiente, e expor isso na
      // resposta convida a tentar usá-lo como parâmetro em outra rota.
    };
  }
}

/**
 * Normaliza o e-mail para a forma que vai ao banco.
 *
 * Minúsculas e sem espaço nas bordas, sempre — nas duas pontas, cadastro e
 * login. Sem isso, `Joao@x.com` e `joao@x.com` viram duas contas, e a segunda
 * pessoa a se cadastrar acha que perdeu os dados.
 *
 * O que NÃO fazemos: remover pontos do Gmail nem cortar `+etiqueta`. São
 * convenções de um provedor específico; aplicá-las a todo mundo recusaria
 * cadastro legítimo em servidor corporativo onde `a.b@` e `ab@` são pessoas
 * diferentes.
 *
 * @throws {EmailInvalidoError}
 */
export function normalizarEmail(bruto: string): string {
  const email = bruto.trim().toLowerCase();

  // Validação deliberadamente frouxa: a única prova de que um e-mail existe é
  // mandar mensagem para ele. Expressão regular severa aqui só serve para
  // recusar endereço válido e esquisito — e endereço esquisito é comum em
  // escritório de advocacia com domínio próprio.
  const partes = email.split('@');
  if (partes.length !== 2 || !partes[0] || !partes[1]?.includes('.')) {
    throw new EmailInvalidoError(bruto);
  }
  if (email.includes(' ')) throw new EmailInvalidoError(bruto);

  return email;
}
