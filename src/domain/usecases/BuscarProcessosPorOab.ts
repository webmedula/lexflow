import { Oab } from '../entities/Oab.js';
import type { Processo } from '../entities/Processo.js';
import type { ProcessoProvider } from '../ports/ProcessoProvider.js';

export interface EntradaBuscarProcessosPorOab {
  readonly oab: string;
  readonly uf: string;
  /** Ordenação do resultado. Padrão: andamento mais recente primeiro. */
  readonly ordenarPor?: 'ULTIMA_MOVIMENTACAO' | 'DISTRIBUICAO';
}

/**
 * Caso de uso: listar a carteira de processos de um advogado.
 *
 * É a consulta que o produto vende, e a que mais depende dos crawlers próprios:
 * a API pública do DataJud não indexa partes nem advogados, então essa busca
 * simplesmente não existe lá. O orquestrador resolve isso pulando as fontes que
 * declaram não suportar a operação.
 */
export class BuscarProcessosPorOab {
  constructor(private readonly provider: ProcessoProvider) {}

  /**
   * @throws {OabInvalidaError} inscrição ou UF fora do formato
   * @throws {TodasAsFontesFalharamError} nenhuma fonte da cadeia respondeu
   */
  async executar(entrada: EntradaBuscarProcessosPorOab): Promise<Processo[]> {
    const oab = Oab.criar(entrada.oab, entrada.uf);
    const processos = await this.provider.buscarPorOab(oab.numero, oab.uf);
    return this.ordenar(processos, entrada.ordenarPor ?? 'ULTIMA_MOVIMENTACAO');
  }

  private ordenar(
    processos: Processo[],
    criterio: NonNullable<EntradaBuscarProcessosPorOab['ordenarPor']>,
  ): Processo[] {
    const chave = (p: Processo): number =>
      criterio === 'DISTRIBUICAO'
        ? (p.dataDistribuicao?.getTime() ?? 0)
        : (p.ultimaMovimentacao?.data.getTime() ?? p.dataDistribuicao?.getTime() ?? 0);

    return [...processos].sort((a, b) => chave(b) - chave(a));
  }
}
