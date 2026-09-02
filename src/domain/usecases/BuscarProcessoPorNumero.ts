import { NumeroCNJ } from '../entities/NumeroCNJ.js';
import type { Processo } from '../entities/Processo.js';
import type { ProcessoProvider } from '../ports/ProcessoProvider.js';

export interface EntradaBuscarProcessoPorNumero {
  readonly numeroProcesso: string;
}

/**
 * Caso de uso: consultar um processo pelo número CNJ.
 *
 * Guarda a fronteira de validação do sistema. A partir daqui, todo número que
 * circula já passou pelo dígito verificador — o que evita gastar requisição (e
 * cota de rate limit) com dígito trocado, o erro de digitação mais comum.
 *
 * Depende da PORTA `ProcessoProvider`, não do orquestrador concreto: em produção
 * recebe o `ProcessoSearchService`, no teste recebe um stub. Nenhuma linha muda.
 */
export class BuscarProcessoPorNumero {
  constructor(private readonly provider: ProcessoProvider) {}

  /**
   * @throws {NumeroCNJInvalidoError} número mal formado ou com DV inválido
   * @throws {ProcessoNaoEncontradoError | TodasAsFontesFalharamError}
   */
  async executar(entrada: EntradaBuscarProcessoPorNumero): Promise<Processo> {
    const numero = NumeroCNJ.criar(entrada.numeroProcesso);
    return this.provider.buscarPorNumero(numero.digitos);
  }
}
