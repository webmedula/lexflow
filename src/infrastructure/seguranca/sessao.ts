import { createHash, randomBytes } from 'node:crypto';
import type { TokensDeSessao } from '../../domain/ports/Criptografia.js';

/**
 * Token de sessão: 32 bytes aleatórios; no banco, só o SHA-256 dele.
 *
 * O banco guardar o HASH e não o token é a diferença entre "vazou o banco" e
 * "vazou o banco E todas as sessões abertas". Quem ler a tabela não consegue se
 * passar por ninguém.
 *
 * SHA-256 puro aqui, e não scrypt: não é segredo escolhido por humano. São 256
 * bits de aleatoriedade criptográfica — não existe dicionário para atacar, e
 * hash caro só faria cada requisição autenticada custar 100ms.
 */

const TAMANHO_TOKEN = 32;

/** 30 dias. Advogado usa o sistema em picos; expirar em 24h obrigaria login
 *  toda semana sem ganho real de segurança, já que o cookie é HttpOnly. */
export const DURACAO_SESSAO_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Dois nomes, e a diferença é uma defesa de verdade.
 *
 * Em produção (HTTPS) o cookie se chama `__Host-lexflow_sessao`. O prefixo
 * `__Host-` é uma regra que o NAVEGADOR aplica: ele só aceita gravar um cookie
 * assim se vier com `Secure`, com `Path=/` e **sem `Domain`**. O efeito é que
 * um subdomínio não consegue gravá-lo.
 *
 * Sem o prefixo, quem controlasse qualquer subdomínio do domínio de produção —
 * um subdomínio esquecido, um XSS em outro serviço da mesma zona — poderia
 * mandar `lexflow_sessao=<token dele>; Domain=.seudominio.com; Path=/v1`. O
 * navegador envia o cookie de Path mais específico PRIMEIRO, nós leríamos o
 * dele, e o advogado passaria a trabalhar dentro do ambiente do atacante, que
 * depois lê tudo que ele acompanhou. É fixação de sessão, e ela sobrevive a
 * `HttpOnly` e a `SameSite`.
 *
 * Em desenvolvimento por HTTP o prefixo não pode ser usado (ele exige
 * `Secure`), então o nome simples fica valendo — e a leitura aceita os dois.
 */
export const NOME_COOKIE = 'lexflow_sessao';
export const NOME_COOKIE_SEGURO = '__Host-lexflow_sessao';

function nomeDoCookie(seguro: boolean): string {
  return seguro ? NOME_COOKIE_SEGURO : NOME_COOKIE;
}

export function gerarToken(): string {
  return randomBytes(TAMANHO_TOKEN).toString('base64url');
}

export function hashDoToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface OpcoesCookie {
  /** `false` em desenvolvimento por HTTP; sem isso o navegador descarta. */
  readonly seguro: boolean;
  readonly duracaoMs?: number;
}

/**
 * Monta o `Set-Cookie`.
 *
 * - `HttpOnly`: nenhum script da página lê o token. É o que faz um XSS não
 *   virar roubo de sessão — e a razão de o token não voltar no corpo da
 *   resposta também, porque aí o `fetch` do console poderia guardá-lo no
 *   `localStorage` e desfazer a proteção inteira.
 * - `SameSite=Lax`: some em requisição vinda de outro site, o que cobre CSRF
 *   nas rotas que mudam estado, sem quebrar o clique num link para o sistema.
 * - `Path=/`: a API e o console estão na mesma origem.
 */
export function cookieDeSessao(token: string, opcoes: OpcoesCookie): string {
  const duracao = Math.floor((opcoes.duracaoMs ?? DURACAO_SESSAO_MS) / 1000);
  return [
    `${nomeDoCookie(opcoes.seguro)}=${token}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${duracao}`,
    ...(opcoes.seguro ? ['Secure'] : []),
  ].join('; ');
}

export function cookieDeSaida(opcoes: OpcoesCookie): string {
  return [
    `${nomeDoCookie(opcoes.seguro)}=`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    'Max-Age=0',
    ...(opcoes.seguro ? ['Secure'] : []),
  ].join('; ');
}

/**
 * Lê o token do header `Cookie`.
 *
 * Feito à mão em vez de `@fastify/cookie` porque o que precisamos é ler UM
 * nome — e uma dependência a menos é uma superfície a menos numa parte que
 * decide quem é quem.
 */
export function tokenDoCabecalho(cabecalho: string | undefined): string | undefined {
  if (!cabecalho) return undefined;

  // O `__Host-` vem PRIMEIRO na busca, e não é detalhe: se os dois estiverem
  // presentes — o legítimo e um plantado por subdomínio — vence aquele que o
  // navegador garantiu que só a origem principal pôde gravar.
  for (const nome of [NOME_COOKIE_SEGURO, NOME_COOKIE]) {
    for (const par of cabecalho.split(';')) {
      const separador = par.indexOf('=');
      if (separador < 0) continue;
      if (par.slice(0, separador).trim() !== nome) continue;
      const valor = par.slice(separador + 1).trim();
      if (valor.length > 0) return valor;
    }
  }
  return undefined;
}

/** A porta `TokensDeSessao` implementada com random + SHA-256. */
export const tokensDeSessao: TokensDeSessao = {
  gerar: gerarToken,
  hash: hashDoToken,
};
