import type { CodigoPlano, Plano } from '../entities/Plano.js';
import type { RegrasDeAssinatura } from '../entities/RegrasDeAssinatura.js';

/**
 * O catálogo de planos.
 *
 * Não há `remover`, e a ausência é deliberada: as assinaturas apontam para o
 * código do plano, e apagar um plano que alguém tem deixaria essa assinatura
 * apontando para o nada. Tirar um plano de oferta é `disponivelParaContratacao
 * = false`; quem já o tem continua com ele.
 */
export interface RepositorioPlanos {
  /** Todos, à venda ou não, em qualquer ordem — quem mostra é quem ordena. */
  listar(): Promise<readonly Plano[]>;
  porCodigo(codigo: CodigoPlano): Promise<Plano | undefined>;
  /** Cria ou substitui pelo código. Validar é trabalho de quem chama. */
  salvar(plano: Plano): Promise<void>;
}

/** As regras de teste e carência. Uma linha só, lida e gravada inteira. */
export interface RepositorioRegrasDeAssinatura {
  /** Nunca falha por ausência: sem nada gravado, devolve `REGRAS_PADRAO`. */
  ler(): Promise<RegrasDeAssinatura>;
  salvar(regras: RegrasDeAssinatura): Promise<void>;
}
