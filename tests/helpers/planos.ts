import { PLANOS_INICIAIS } from '../../src/domain/entities/Plano.js';
import type { Plano } from '../../src/domain/entities/Plano.js';
import { REGRAS_PADRAO } from '../../src/domain/entities/RegrasDeAssinatura.js';
import type { RegrasDeAssinatura } from '../../src/domain/entities/RegrasDeAssinatura.js';
import type {
  RepositorioPlanos,
  RepositorioRegrasDeAssinatura,
} from '../../src/domain/ports/RepositorioPlanos.js';

/**
 * Catálogo em memória, começando pela mesma semente que o banco recebe na
 * primeira subida. Para testes de serviço que não precisam de SQLite — e que,
 * sem isto, teriam de reinventar os três planos em cada arquivo.
 */
export class PlanosEmMemoria implements RepositorioPlanos {
  readonly planos = new Map<string, Plano>(PLANOS_INICIAIS.map((p) => [p.codigo, p]));

  async listar(): Promise<readonly Plano[]> {
    return [...this.planos.values()];
  }
  async porCodigo(codigo: string): Promise<Plano | undefined> {
    return this.planos.get(codigo);
  }
  async salvar(plano: Plano): Promise<void> {
    this.planos.set(plano.codigo, plano);
  }
}

export class RegrasEmMemoria implements RepositorioRegrasDeAssinatura {
  constructor(public regras: RegrasDeAssinatura = REGRAS_PADRAO) {}

  async ler(): Promise<RegrasDeAssinatura> {
    return this.regras;
  }
  async salvar(regras: RegrasDeAssinatura): Promise<void> {
    this.regras = regras;
  }
}

/** Um dos planos da semente, pelo código — falha alto se a semente mudar. */
export function planoInicial(codigo: string): Plano {
  const p = PLANOS_INICIAIS.find((x) => x.codigo === codigo);
  if (!p) throw new Error(`a semente não tem o plano "${codigo}"`);
  return p;
}
