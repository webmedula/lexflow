import { createHash } from 'node:crypto';
import { pareceValorDeExemplo } from '../../infrastructure/config/placeholder.js';

/**
 * Comprimento mínimo aceito para uma chave de API.
 *
 * 24 caracteres é o piso, não a recomendação — o script `npm run chave` gera 64
 * (32 bytes em hex, 256 bits). O piso existe para barrar `LEXFLOW_API_KEYS=123`
 * digitado às pressas em produção: chave fraca é PIOR do que nenhuma, porque
 * dá a sensação de proteção enquanto cai num ataque de dicionário em minutos.
 */
export const TAMANHO_MINIMO_CHAVE = 24;

export class ConfiguracaoDeChavesInvalidaError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ConfiguracaoDeChavesInvalidaError';
  }
}

/**
 * Valida a configuração de autenticação ANTES de o servidor abrir a porta.
 *
 * Falhar aqui é barulhento e aparece no log de deploy, onde alguém está
 * olhando. A alternativa — subir e só descobrir o problema quando um cliente
 * reclama — é silenciosa e cara.
 *
 * @throws {ConfiguracaoDeChavesInvalidaError}
 */
export function validarChavesDeApi(
  chaves: readonly string[],
  autenticacaoDesativada: boolean,
): void {
  if (autenticacaoDesativada) {
    if (chaves.length > 0) {
      throw new ConfiguracaoDeChavesInvalidaError(
        'LEXFLOW_AUTH_DISABLED=true com LEXFLOW_API_KEYS preenchida. ' +
          'Escolha um dos dois: ou o serviço exige chave, ou roda aberto na rede interna. ' +
          'Manter as duas configuradas esconde qual delas está realmente valendo.',
      );
    }
    return;
  }

  if (chaves.length === 0) {
    throw new ConfiguracaoDeChavesInvalidaError(
      'LEXFLOW_API_KEYS não definida. Gere uma chave com `npm run chave` e ' +
        'configure-a, ou declare LEXFLOW_AUTH_DISABLED=true se o serviço só ' +
        'será acessível pela rede interna (sem domínio público).',
    );
  }

  // Antes do tamanho: um placeholder longo o bastante passaria na checagem de
  // comprimento e viraria a "chave de produção" do serviço.
  const exemplos = chaves.filter((c) => pareceValorDeExemplo(c));
  if (exemplos.length > 0) {
    throw new ConfiguracaoDeChavesInvalidaError(
      `LEXFLOW_API_KEYS ainda contém o texto de exemplo (${exemplos.join(', ')}). ` +
        'Gere uma chave real com `npm run chave` e substitua.',
    );
  }

  const curtas = chaves.filter((c) => c.length < TAMANHO_MINIMO_CHAVE);
  if (curtas.length > 0) {
    throw new ConfiguracaoDeChavesInvalidaError(
      `${curtas.length} chave(s) em LEXFLOW_API_KEYS têm menos de ` +
        `${TAMANHO_MINIMO_CHAVE} caracteres. Gere chaves fortes com \`npm run chave\`. ` +
        '(As chaves não são exibidas nesta mensagem de propósito.)',
    );
  }

  const unicas = new Set(chaves);
  if (unicas.size !== chaves.length) {
    throw new ConfiguracaoDeChavesInvalidaError(
      'Há chaves repetidas em LEXFLOW_API_KEYS. Cada consumidor deve ter a ' +
        'sua, senão revogar uma derruba as outras.',
    );
  }
}

/**
 * Identificador público de uma chave: os 8 primeiros hex do SHA-256.
 *
 * Usar um PREFIXO da própria chave (a versão anterior fazia isso) tem dois
 * defeitos: vaza parte do segredo no log, e deixa de distinguir nada no momento
 * em que você adota um prefixo comum tipo `lf_prod_`. O hash resolve os dois —
 * é estável, não reversível, e o mesmo valor que `npm run chave` imprime na
 * geração, então dá para anotar "id 3f9a2c11 = n8n" e correlacionar depois.
 */
export function identificarChave(chave: string): string {
  return createHash('sha256').update(chave).digest('hex').slice(0, 8);
}

/**
 * Espaço isolado do assinante, derivado da chave de API.
 *
 * Enquanto não existem contas de usuário, a chave É o usuário: cada uma vê
 * apenas os processos que ela acompanha. Isso dá isolamento real desde já, sem
 * construir cadastro, login e recuperação de senha antes de o produto provar
 * valor — e migra limpo depois, porque a coluna `workspace` já existe no banco.
 *
 * 16 hex (64 bits) e não os 8 do identificador de log: colisão aqui misturaria
 * a carteira de dois assinantes, o que é bem pior do que confundir duas linhas
 * de log.
 */
export function workspaceDaChave(chave: string): string {
  return createHash('sha256').update(chave).digest('hex').slice(0, 16);
}
