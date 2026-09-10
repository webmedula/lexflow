import type { ConteudoPeca, Peca } from '../../../domain/entities/Peca.js';
import {
  CredencialTribunalInvalidaError,
  ProcessoNaoEncontradoError,
  ProviderIndisponivelError,
  RespostaInvalidaError,
  TeorNaoAutorizadoError,
} from '../../../domain/errors/index.js';
import type { Logger } from '../../../domain/ports/Logger.js';
import type {
  AssinaturaDeMudanca,
  CredencialTribunal,
  ProvedorDePecas,
} from '../../../domain/ports/ProvedorDePecas.js';
import { loggerSilencioso } from '../../logging/ConsoleLogger.js';
import { HttpClient, HttpTimeoutError } from '../../http/HttpClient.js';
import type { RateLimiter } from '../../ratelimit/TokenBucketRateLimiter.js';
import { TokenBucketRateLimiter } from '../../ratelimit/TokenBucketRateLimiter.js';
import {
  ACAO_CONSULTAR_ALTERACAO,
  ACAO_CONSULTAR_PROCESSO,
  envelopeConsultarAlteracao,
  envelopeConsultarProcesso,
} from './mni.envelope.js';
import {
  abrirEnvelope,
  extrairAssinatura,
  extrairConteudoDoDocumento,
  extrairPecas,
  NOME_MNI,
  XmlIlegivelError,
} from './mni.mapper.js';
import type { RespostaMni } from './mni.mapper.js';
import { lerRespostaSoap, MultipartInvalidoError } from './mtom.js';
import type { ParteMultipart } from './mtom.js';

export { NOME_MNI };

/**
 * Endpoint MNI do Projudi/TJGO.
 *
 * Não segue o padrão `/intercomunicacao` do PJe — no Projudi o serviço se chama
 * `IntercomunicacaoService`, e é por isso que procurar pelo caminho do PJe dá
 * 404 e leva à conclusão errada de que o tribunal não tem MNI. O link está na
 * página inicial do próprio Projudi.
 */
const ENDPOINT_PADRAO = 'https://projudi.tjgo.jus.br/IntercomunicacaoService';

/**
 * 90s. Não é folga: `incluirDocumentos` faz o tribunal montar e transmitir os
 * PDFs do processo na mesma resposta, e processo com dezenas de peças passa
 * bastante dos 20s que bastam ao DJEN.
 */
const TIMEOUT_PADRAO_MS = 90_000;

/**
 * UMA tentativa. Retry aqui é ativamente perigoso e essa é a diferença mais
 * importante em relação aos outros adapters: a requisição carrega usuário e
 * senha do advogado, e o Projudi conta tentativa malsucedida para bloquear
 * conta. Uma senha desatualizada com retry vira três recusas por consulta, e a
 * vigilância de hora em hora transforma isso em bloqueio no mesmo dia — deixando
 * o advogado sem acesso ao próprio processo por culpa nossa.
 */
const TENTATIVAS = 1;

/**
 * 30 por minuto, contra os 60 do DataJud. Relatos de MNI em produção falam em
 * teto na casa de 50/min antes de bloqueio de IP com 403 e espera de ~30
 * minutos — e num VPS o IP é compartilhado por todos os assinantes. Metade do
 * teto relatado é a margem que impede um pico de vigilância de derrubar o acesso
 * de todo mundo de uma vez.
 */
const LIMITE_PADRAO_POR_MINUTO = 30;

/**
 * Mensagens do TJGO que significam credencial recusada.
 *
 * `Usuário ou Senha inválida.` foi capturada ao vivo (fixture
 * `mni-tjgo-credencial-invalida-real.txt`). As demais entram por prudência, com
 * casamento por trecho normalizado: o tribunal muda pontuação e acentuação entre
 * versões, e comparar string exata faria a classificação silenciosamente parar
 * de funcionar — devolvendo "processo não encontrado" para senha errada.
 */
const MARCAS_DE_CREDENCIAL = [
  'usuario ou senha',
  'senha invalida',
  'usuario invalido',
  'nao autenticado',
  'nao autorizado',
  'acesso negado',
  'credencial',
];

const MARCAS_DE_NAO_ENCONTRADO = [
  'nao encontrado',
  'nao localizado',
  'inexistente',
  'nenhum processo',
];

export interface OpcoesMniAdapter {
  readonly endpoint?: string;
  readonly tribunais?: readonly string[];
  readonly timeoutMs?: number;
  readonly limitePorMinuto?: number;
  readonly httpClient?: HttpClient;
  readonly rateLimiter?: RateLimiter;
  readonly logger?: Logger;
}

/**
 * Adapter do MNI 2.2.2 — Modelo Nacional de Interoperabilidade.
 *
 * É a fonte que entrega o que nenhuma outra entrega: **as peças**. O DJEN
 * publica ato judicial e o DataJud indexa metadado; petição, contestação, laudo
 * e documento juntado pela parte só existem dentro do sistema do tribunal, e o
 * MNI é a porta oficial para eles.
 *
 * Autenticação por `idConsultante` + `senhaConsultante` dentro do envelope — a
 * mesma dupla que o advogado usa no Projudi. Não passa pela tela de login, então
 * não há CAPTCHA nem segundo fator por e-mail no caminho; e não exige
 * certificado digital neste tribunal.
 *
 * **A trava que nenhum código contorna:** o MNI devolve as peças conforme o
 * perfil de acesso do consultante. Sem procuração nos autos, o metadado vem e o
 * conteúdo não. Isso é controle de acesso do processo eletrônico funcionando,
 * não defeito — e é a razão de `TeorNaoAutorizadoError` existir com nome
 * próprio, para a interface dizer "você não está habilitado neste processo" em
 * vez de "erro ao baixar".
 *
 * Implementa `ProvedorDePecas` e NÃO `ProcessoProvider`: entrar na cadeia faria
 * o `CachedProcessoProvider` — que indexa por número de processo, sem workspace
 * na chave — servir a um assinante a resposta obtida com a credencial de outro.
 * Ver o comentário da porta.
 */
export class MniAdapter implements ProvedorDePecas {
  readonly nome = NOME_MNI;
  readonly tribunais: readonly string[];

  private readonly endpoint: string;
  private readonly http: HttpClient;
  private readonly rateLimiter: RateLimiter;
  private readonly logger: Logger;

  constructor(opcoes: OpcoesMniAdapter = {}) {
    this.endpoint = opcoes.endpoint ?? ENDPOINT_PADRAO;
    this.tribunais = opcoes.tribunais ?? ['TJGO'];
    this.logger = (opcoes.logger ?? loggerSilencioso).child({ provider: this.nome });
    this.http =
      opcoes.httpClient ??
      new HttpClient({
        timeoutMs: opcoes.timeoutMs ?? TIMEOUT_PADRAO_MS,
        tentativas: TENTATIVAS,
      });
    this.rateLimiter =
      opcoes.rateLimiter ??
      new TokenBucketRateLimiter({
        capacidade: opcoes.limitePorMinuto ?? LIMITE_PADRAO_POR_MINUTO,
        janelaMs: 60_000,
      });
  }

  async listarPecas(
    numeroProcesso: string,
    credencial: CredencialTribunal,
  ): Promise<Peca[]> {
    // `incluirDocumentos: true` com `documentos` vazio parece contraditório e
    // não é: é assim que se pede a FICHA de todos os documentos. Sem essa
    // marca o tribunal devolve o processo sem a lista de peças, e a tela
    // apareceria vazia num processo cheio.
    const { resposta, anexos } = await this.chamar(
      envelopeConsultarProcesso({
        numeroProcesso,
        credencial,
        incluirCabecalho: true,
        incluirDocumentos: true,
      }),
      ACAO_CONSULTAR_PROCESSO,
      numeroProcesso,
    );

    const pecas = extrairPecas(resposta.conteudo, anexos);
    this.logger.debug('peças listadas', {
      numeroProcesso,
      pecas: pecas.length,
      comTeor: pecas.filter((p) => p.conteudoDisponivel).length,
    });
    return pecas;
  }

  async obterConteudo(
    numeroProcesso: string,
    idPeca: string,
    credencial: CredencialTribunal,
  ): Promise<ConteudoPeca> {
    // Um id por vez, e não o processo inteiro: é a diferença entre alguns
    // megabytes e algumas centenas, num tribunal que cobra isso em bloqueio
    // de IP.
    const { resposta, anexos } = await this.chamar(
      envelopeConsultarProcesso({
        numeroProcesso,
        credencial,
        incluirCabecalho: false,
        incluirDocumentos: true,
        documentos: [idPeca],
      }),
      ACAO_CONSULTAR_PROCESSO,
      numeroProcesso,
    );

    const achado = extrairConteudoDoDocumento(resposta.conteudo, idPeca, anexos);
    if (!achado) throw new TeorNaoAutorizadoError(numeroProcesso, idPeca);

    return {
      id: idPeca,
      mimetype: achado.mimetype,
      nomeArquivo: nomeDeArquivo(numeroProcesso, idPeca, achado.mimetype),
      bytes: achado.bytes,
    };
  }

  async assinaturaDeMudanca(
    numeroProcesso: string,
    credencial: CredencialTribunal,
  ): Promise<AssinaturaDeMudanca> {
    const { resposta } = await this.chamar(
      envelopeConsultarAlteracao(numeroProcesso, credencial),
      ACAO_CONSULTAR_ALTERACAO,
      numeroProcesso,
    );
    return extrairAssinatura(resposta.conteudo);
  }

  private async chamar(
    xml: string,
    acao: string,
    numeroProcesso: string,
  ): Promise<{
    readonly resposta: RespostaMni;
    readonly anexos: ReadonlyMap<string, ParteMultipart>;
  }> {
    await this.rateLimiter.adquirir();

    let bruta;
    try {
      bruta = await this.http.postXml(this.endpoint, xml, { SOAPAction: acao });
    } catch (erro) {
      throw new ProviderIndisponivelError(
        this.nome,
        erro instanceof HttpTimeoutError ? 'timeout' : 'falha de rede',
        { cause: erro },
      );
    }

    // 403 tem tratamento próprio porque tem CAUSA própria e conhecida: MNI
    // bloqueia IP de datacenter. Num VPS isso atinge todos os assinantes ao
    // mesmo tempo, e a mensagem precisa dizer o que fazer — esperar, não trocar
    // a senha do cliente.
    if (bruta.status === 403) {
      throw new ProviderIndisponivelError(
        this.nome,
        'acesso bloqueado pelo tribunal (HTTP 403) — costuma ser bloqueio ' +
          'temporário do IP do servidor; aguarde antes de repetir',
      );
    }
    if (bruta.status === 429 || bruta.status >= 500) {
      throw new ProviderIndisponivelError(this.nome, `HTTP ${bruta.status}`);
    }

    let resposta: RespostaMni;
    let anexos: ReadonlyMap<string, ParteMultipart>;
    try {
      const lida = lerRespostaSoap(bruta.contentType, bruta.bytes);
      anexos = lida.anexos;
      resposta = abrirEnvelope(lida.xml);
    } catch (erro) {
      if (erro instanceof MultipartInvalidoError || erro instanceof XmlIlegivelError) {
        throw new RespostaInvalidaError(this.nome, erro.message, { cause: erro });
      }
      throw erro;
    }

    if (!resposta.sucesso) this.classificarRecusa(resposta.mensagem, numeroProcesso);

    return { resposta, anexos };
  }

  /**
   * Traduz `sucesso: false` + mensagem em erro de domínio.
   *
   * O MNI responde **HTTP 200 em toda recusa** — verificado na captura real. A
   * única informação sobre o que deu errado é uma frase em português livre, e é
   * dela que sai a decisão entre "avise a pessoa para corrigir a senha" e "tente
   * outra fonte". Errar essa classificação para o lado do fallback é o pior caso:
   * o sistema insistiria com uma credencial recusada até a conta do advogado ser
   * bloqueada pelo tribunal.
   */
  private classificarRecusa(mensagem: string, numeroProcesso: string): never {
    const normalizada = normalizar(mensagem);

    if (MARCAS_DE_CREDENCIAL.some((m) => normalizada.includes(m))) {
      // A mensagem do tribunal vai junto porque é o que a pessoa precisa ler.
      // A credencial NÃO vai — nem aqui, nem no log.
      throw new CredencialTribunalInvalidaError(this.nome, mensagem);
    }

    if (MARCAS_DE_NAO_ENCONTRADO.some((m) => normalizada.includes(m))) {
      throw new ProcessoNaoEncontradoError(`número ${numeroProcesso}`, this.nome);
    }

    // Recusa que não sabemos ler vira indisponibilidade, e não "não encontrado":
    // dizer ao advogado que o processo dele não existe por causa de uma mensagem
    // nova do tribunal é o erro que este projeto se recusa a cometer.
    this.logger.warn('recusa do MNI sem classificação conhecida', {
      numeroProcesso,
      mensagem,
    });
    throw new ProviderIndisponivelError(
      this.nome,
      `o tribunal recusou a consulta: ${mensagem || 'sem mensagem'}`,
    );
  }
}

function nomeDeArquivo(
  numeroProcesso: string,
  idPeca: string,
  mimetype: string,
): string {
  return `${numeroProcesso}-peca-${idPeca}.${extensaoDe(mimetype)}`;
}

function extensaoDe(mimetype: string): string {
  const tipo = mimetype.toLowerCase();
  if (tipo.includes('pdf')) return 'pdf';
  if (tipo.includes('html')) return 'html';
  if (tipo.includes('jpeg') || tipo.includes('jpg')) return 'jpg';
  if (tipo.includes('png')) return 'png';
  if (tipo.includes('xml')) return 'xml';
  if (tipo.includes('plain')) return 'txt';
  return 'bin';
}

function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}
