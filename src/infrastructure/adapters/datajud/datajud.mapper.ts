import { NumeroCNJ } from '../../../domain/entities/NumeroCNJ.js';
import type { Movimentacao } from '../../../domain/entities/Movimentacao.js';
import { Processo } from '../../../domain/entities/Processo.js';
import { RespostaInvalidaError } from '../../../domain/errors/index.js';
import type { MovimentoDataJud, ProcessoDataJud } from './datajud.types.js';

const NOME_PROVIDER = 'datajud';

/**
 * Anticorrupção: traduz o payload do CNJ para o modelo do domínio.
 *
 * Todo o vocabulário do DataJud (`orgaoJulgador`, `dataAjuizamento`,
 * `movimentos`, `complementosTabelados`) morre neste arquivo. É o único ponto
 * do sistema que precisa mudar quando o CNJ mexer no formato.
 */
export function mapearProcesso(
  origem: ProcessoDataJud,
  consultadoEm: Date,
): Processo {
  const numero = NumeroCNJ.tentarCriar(origem.numeroProcesso);
  if (!numero) {
    throw new RespostaInvalidaError(
      NOME_PROVIDER,
      `número de processo inválido no payload: "${origem.numeroProcesso}"`,
    );
  }

  const assuntos = (origem.assuntos ?? [])
    .map((a) => a.nome)
    .filter((nome): nome is string => typeof nome === 'string' && nome.length > 0);

  const dataDistribuicao = parseData(origem.dataAjuizamento);

  return new Processo({
    numero,
    tribunal: origem.tribunal ?? numero.siglaTribunal ?? 'DESCONHECIDO',
    ...(origem.orgaoJulgador?.nome ? { vara: origem.orgaoJulgador.nome } : {}),
    ...(origem.classe?.nome ? { classe: origem.classe.nome } : {}),
    ...(assuntos.length > 0 ? { assuntos } : {}),
    ...(dataDistribuicao ? { dataDistribuicao } : {}),
    ...(origem.grau ? { grau: origem.grau } : {}),
    segredoJustica: (origem.nivelSigilo ?? 0) > 0,
    // O DataJud é base de METADADOS: não indexa partes nem advogados.
    // Deixar vazio é o retrato fiel da fonte — e é o sinal que o orquestrador
    // usa para decidir se vale enriquecer com um crawler.
    partes: [],
    movimentacoes: (origem.movimentos ?? [])
      .map(mapearMovimento)
      .filter((m): m is Movimentacao => m !== null),
    procedencia: { provider: NOME_PROVIDER, consultadoEm, deCache: false },
  });
}

function mapearMovimento(origem: MovimentoDataJud): Movimentacao | null {
  const data = parseData(origem.dataHora);
  if (!data) return null;

  const titulo = origem.nome?.trim();
  if (!titulo) return null;

  const complementos = (origem.complementosTabelados ?? [])
    .map((c) => {
      const rotulo = c.nome ?? c.descricao;
      return rotulo ? rotulo.trim() : null;
    })
    .filter((c): c is string => c !== null && c.length > 0);

  return {
    data,
    titulo,
    // Sem `conteudo`: a API pública devolve o rótulo do movimento na TPU,
    // nunca o inteiro teor do despacho. Quem precisa da íntegra depende do
    // crawler do tribunal.
    ...(origem.codigo !== undefined ? { codigoTpu: origem.codigo } : {}),
    ...(complementos.length > 0 ? { complementos } : {}),
  };
}

function parseData(valor: string | undefined): Date | undefined {
  if (!valor) return undefined;
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? undefined : data;
}
