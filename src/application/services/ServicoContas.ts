import type { Usuario } from '../../domain/entities/Usuario.js';
import { normalizarEmail } from '../../domain/entities/Usuario.js';
import {
  CredenciaisInvalidasError,
  SessaoInvalidaError,
} from '../../domain/errors/index.js';
import type { RepositorioUsuarios } from '../../domain/ports/RepositorioUsuarios.js';
import type { HashDeSenha, TokensDeSessao } from '../../domain/ports/Criptografia.js';
import { Oab } from '../../domain/entities/Oab.js';

export interface DadosDeCadastro {
  readonly email: string;
  readonly nome: string;
  readonly senha: string;
}

export interface SessaoAberta {
  readonly usuario: Usuario;
  /** O token em claro. Existe só até virar cookie — não se guarda, não se loga. */
  readonly token: string;
  readonly expiraEm: Date;
}

export interface OpcoesServicoContas {
  readonly repositorio: RepositorioUsuarios;
  readonly senhas: HashDeSenha;
  readonly tokens: TokensDeSessao;
  readonly duracaoSessaoMs: number;
}

/**
 * Contas, sessões e perfil.
 *
 * Cada conta nasce com um ambiente próprio, e é isso que permite vender o
 * LexFlow para advogados diferentes na mesma instalação: o `workspace` do
 * `Usuario` é a mesma coluna que já separava os dados por chave de API, então
 * nenhuma rota de dados precisou saber que contas passaram a existir.
 *
 * O cadastro é ABERTO por decisão de produto. Duas consequências que o código
 * precisa absorver, e absorve em outro lugar: o limite de requisições passa a
 * ser por conta (senão um cadastro abusivo gasta a cota compartilhada do CNJ
 * que todos os assinantes dividem), e o acesso ao tribunal continua sendo
 * credencial do próprio advogado, que ninguém consegue forjar.
 */
export class ServicoContas {
  private readonly repositorio: RepositorioUsuarios;
  private readonly senhas: HashDeSenha;
  private readonly tokens: TokensDeSessao;
  private readonly duracaoSessaoMs: number;

  constructor(opcoes: OpcoesServicoContas) {
    this.repositorio = opcoes.repositorio;
    this.senhas = opcoes.senhas;
    this.tokens = opcoes.tokens;
    this.duracaoSessaoMs = opcoes.duracaoSessaoMs;
  }

  /**
   * Cria a conta e já entra: cadastro que exige login logo em seguida é atrito
   * puro, e a pessoa acabou de provar que sabe a senha.
   *
   * @throws {EmailInvalidoError} {EmailJaCadastradoError} {SenhaFracaError}
   */
  async cadastrar(dados: DadosDeCadastro): Promise<SessaoAberta> {
    const email = normalizarEmail(dados.email);
    // `guardarSenha` ANTES de tocar no banco: se a senha é fraca, a pessoa
    // recebe o aviso sem que nada tenha sido gravado.
    const senhaGuardada = this.senhas.guardar(dados.senha);

    const usuario = await this.repositorio.criar({
      email,
      nome: dados.nome.trim() || email.split('@')[0] || 'Advogado',
      senhaGuardada,
    });

    return this.abrirSessao(usuario);
  }

  /**
   * @throws {CredenciaisInvalidasError} tanto para e-mail desconhecido quanto
   *         para senha errada — e gastando o mesmo tempo nos dois casos.
   */
  async entrar(emailBruto: string, senha: string): Promise<SessaoAberta> {
    // `normalizarEmail` lança em e-mail malformado, e isso denunciaria a
    // diferença entre "formato ruim" e "não existe". Aqui a forma errada é
    // apenas mais um jeito de não haver conta.
    let email: string;
    try {
      email = normalizarEmail(emailBruto);
    } catch {
      this.senhas.conferir(senha, this.senhas.hashDeComparacao);
      throw new CredenciaisInvalidasError();
    }

    const achado = await this.repositorio.porEmail(email);
    if (!achado) {
      // O scrypt roda mesmo sem conta. Sem esta linha, e-mail desconhecido
      // responde em 1ms e e-mail real em 100ms — e quem mede de fora levanta
      // a lista de assinantes testando endereços.
      this.senhas.conferir(senha, this.senhas.hashDeComparacao);
      throw new CredenciaisInvalidasError();
    }

    if (!this.senhas.conferir(senha, achado.senha)) {
      throw new CredenciaisInvalidasError();
    }

    await this.repositorio.registrarAcesso(achado.usuario.id);
    return this.abrirSessao(achado.usuario);
  }

  /** @throws {SessaoInvalidaError} */
  async resolverSessao(token: string): Promise<Usuario> {
    const usuario = await this.repositorio.usuarioDaSessao(this.tokens.hash(token));
    if (!usuario) throw new SessaoInvalidaError();
    return usuario;
  }

  async sair(token: string): Promise<void> {
    await this.repositorio.encerrarSessao(this.tokens.hash(token));
  }

  /**
   * Completa o perfil — é aqui que a OAB entra, depois do cadastro.
   *
   * A inscrição passa por `Oab.criar`, que normaliza e valida. Guardar "47.383"
   * e "47383" como coisas diferentes faria a vigilância procurar por um texto
   * que o DJEN nunca devolve, e o sintoma seria "cadastrei e não achou nada".
   */
  async atualizarPerfil(
    usuario: Usuario,
    perfil: {
      nome?: string | undefined;
      oab?: string | undefined;
      ufOab?: string | undefined;
    },
  ): Promise<Usuario> {
    const inscricao =
      perfil.oab && perfil.ufOab ? Oab.criar(perfil.oab, perfil.ufOab) : undefined;

    return this.repositorio.atualizarPerfil(usuario.id, {
      ...(perfil.nome ? { nome: perfil.nome.trim() } : {}),
      ...(inscricao ? { oab: inscricao.numero, ufOab: inscricao.uf } : {}),
    });
  }

  /**
   * Troca a senha e **derruba as outras sessões**.
   *
   * Quem troca a senha costuma estar fazendo isso porque desconfia que alguém
   * entrou. Manter as sessões antigas válidas deixaria o invasor dentro da
   * conta depois da troca — que é exatamente o que a pessoa acabou de tentar
   * impedir. A sessão atual é reaberta em seguida, para não expulsar o dono.
   *
   * @throws {CredenciaisInvalidasError} {SenhaFracaError}
   */
  async trocarSenha(
    usuario: Usuario,
    senhaAtual: string,
    senhaNova: string,
  ): Promise<SessaoAberta> {
    const achado = await this.repositorio.porEmail(usuario.email);
    if (!achado || !this.senhas.conferir(senhaAtual, achado.senha)) {
      throw new CredenciaisInvalidasError();
    }

    const guardada = this.senhas.guardar(senhaNova);
    await this.repositorio.trocarSenha(usuario.id, guardada);
    await this.repositorio.encerrarSessoesDe(usuario.id);
    return this.abrirSessao(usuario);
  }

  async limparSessoesExpiradas(): Promise<number> {
    return this.repositorio.limparSessoesExpiradas();
  }

  private async abrirSessao(usuario: Usuario): Promise<SessaoAberta> {
    const token = this.tokens.gerar();
    const expiraEm = new Date(Date.now() + this.duracaoSessaoMs);
    await this.repositorio.abrirSessao(this.tokens.hash(token), usuario.id, expiraEm);
    return { usuario, token, expiraEm };
  }
}
