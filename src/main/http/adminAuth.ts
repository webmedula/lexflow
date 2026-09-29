import { pareceValorDeExemplo } from '../../infrastructure/config/placeholder.js';

/**
 * Comprimento mínimo aceito para a senha administrativa.
 *
 * Maior que `TAMANHO_MINIMO_CHAVE` (24) de propósito: uma chave de API vazada
 * expõe o workspace isolado dela; esta senha abre liberar assinatura de
 * QUALQUER assinante e emitir chave de API nova. É a porta mais sensível deste
 * sistema, e o mínimo reflete isso.
 */
export const TAMANHO_MINIMO_SENHA_ADMIN = 16;

export class ConfiguracaoDeAdminInvalidaError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ConfiguracaoDeAdminInvalidaError';
  }
}

/**
 * Se a área administrativa está ligada.
 *
 * As duas variáveis vazias — o padrão — significa desligada: o sistema sobe
 * igual a antes desta entrega, sem exigir nada de novo. `validarConfiguracaoAdmin`
 * é quem impede o estado intermediário (só uma definida).
 */
export function adminHabilitado(usuario: string, senha: string): boolean {
  return usuario.length > 0 && senha.length > 0;
}

/**
 * Valida a configuração da área administrativa ANTES de o servidor abrir a
 * porta — mesma disciplina de `validarChavesDeApi`, e pelo mesmo motivo:
 * falhar aqui é barulhento e aparece no log de deploy; a alternativa é uma
 * área administrativa aberta, ou fechada por um jeito que ninguém percebeu.
 *
 * @throws {ConfiguracaoDeAdminInvalidaError}
 */
export function validarConfiguracaoAdmin(usuario: string, senha: string): void {
  if (!adminHabilitado(usuario, senha)) {
    if (usuario.length > 0 || senha.length > 0) {
      throw new ConfiguracaoDeAdminInvalidaError(
        'PROCESSOVIVO_ADMIN_USUARIO e PROCESSOVIVO_ADMIN_SENHA precisam ser ' +
          'definidas as duas juntas, ou nenhuma das duas. Configurar só uma ' +
          'deixa a área administrativa num estado que não é nem ligado nem ' +
          'desligado.',
      );
    }
    return;
  }

  if (pareceValorDeExemplo(usuario) || pareceValorDeExemplo(senha)) {
    throw new ConfiguracaoDeAdminInvalidaError(
      'PROCESSOVIVO_ADMIN_USUARIO ou PROCESSOVIVO_ADMIN_SENHA ainda contém o ' +
        'texto de exemplo. Escolha um usuário e uma senha de verdade.',
    );
  }

  if (senha.length < TAMANHO_MINIMO_SENHA_ADMIN) {
    throw new ConfiguracaoDeAdminInvalidaError(
      `PROCESSOVIVO_ADMIN_SENHA tem menos de ${TAMANHO_MINIMO_SENHA_ADMIN} ` +
        'caracteres. Esta senha libera assinatura e emite chave de API de ' +
        'qualquer workspace — não pode ser fraca. (A senha não é exibida ' +
        'nesta mensagem de propósito.)',
    );
  }
}
