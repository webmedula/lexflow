import type { EntradaIndice } from './IndicePagina.js';

/**
 * Situação de um pedido de combinação ("job" do leitor).
 *
 * `pausado_por_bloqueio` é estado próprio, e não um `falhou` com mensagem: o
 * job não acabou, ele espera o disjuntor do MNI fechar e continua sozinho de
 * onde parou. Mostrar isso como falha faria o advogado pedir de novo — e a
 * segunda tentativa entraria na mesma pausa.
 *
 * `expirado` existe para a tela dizer "este PDF foi apagado pelo prazo de
 * guarda" em vez de um 404 que parece defeito.
 */
export type EstadoJobLeitor =
  | 'na_fila'
  | 'baixando'
  | 'montando'
  | 'pronto'
  | 'parcial'
  | 'pausado_por_bloqueio'
  | 'falhou'
  | 'expirado';

/** Estados em que o job ainda vai andar sem ninguém pedir de novo. */
export const ESTADOS_ATIVOS: readonly EstadoJobLeitor[] = [
  'na_fila',
  'baixando',
  'montando',
  'pausado_por_bloqueio',
];

/** Estados em que há PDF para ler. */
export const ESTADOS_COM_ARQUIVO: readonly EstadoJobLeitor[] = ['pronto', 'parcial'];

/**
 * Onde a peça está no caminho até o PDF.
 *
 * `repetir` é a peça que faltou numa resposta de lote que teve sucesso: ela
 * volta no fim do job, UMA vez, sozinha. É estado gravado (e não variável
 * local) para que um redeploy no meio do job não a esqueça nem a peça duas
 * vezes.
 */
export type SituacaoDownload = 'pendente' | 'repetir' | 'obtida' | 'vazia' | 'nao_obtida';

/**
 * Por que uma peça não está no PDF. Vai para o índice e para a tela.
 *
 * Cada motivo pede uma ação diferente de quem lê, e por isso não colapsam num
 * "erro": `sem_teor` é falta de procuração; `bloqueio_do_tribunal` é esperar;
 * `credencial_recusada` é atualizar a senha; `cota_do_pdf` é dividir a seleção.
 */
export type MotivoNaoObtida =
  | 'sem_teor'
  | 'ausente_no_lote'
  | 'nao_listada'
  | 'sigilosa'
  | 'vazia'
  | 'credencial_recusada'
  | 'interrompido'
  | 'cota_do_pdf'
  | 'cota_do_workspace'
  | 'formato_nao_suportado'
  | 'pdf_invalido'
  | 'pdf_protegido'
  | 'imagem_invalida'
  | 'html_invalido'
  /** Só em jobs gravados antes da conversão de HTML existir (legado da 0.30.0). */
  | 'html_aguardando_estrategia';

export const DESCRICAO_DO_MOTIVO: Readonly<Record<MotivoNaoObtida, string>> = {
  sem_teor:
    'o tribunal listou a peça mas não entregou o arquivo — em geral, a credencial não tem procuração nestes autos',
  ausente_no_lote: 'o tribunal não devolveu a peça, nem pedida sozinha',
  nao_listada: 'a peça não aparece mais na listagem do processo no tribunal',
  sigilosa: 'peça sob sigilo não é guardada no PDF combinado — baixe-a individualmente',
  vazia: 'o tribunal entregou o arquivo vazio',
  credencial_recusada: 'o tribunal recusou a credencial; atualize usuário e senha',
  interrompido: 'a combinação foi interrompida por falha na consulta ao tribunal',
  cota_do_pdf: 'o PDF combinado passaria do tamanho máximo por arquivo',
  cota_do_workspace: 'o espaço de guarda temporária desta conta acabou',
  formato_nao_suportado: 'formato de arquivo que não dá para incorporar ao PDF',
  pdf_invalido: 'o arquivo do tribunal não é um PDF legível',
  pdf_protegido: 'o PDF do tribunal é protegido por senha',
  imagem_invalida: 'a imagem do tribunal não pôde ser convertida em página',
  html_invalido:
    'o documento HTML do tribunal não pôde ser convertido em texto — baixe-o individualmente pela linha do tempo',
  html_aguardando_estrategia:
    'documento do tribunal em HTML: ainda não incorporado ao PDF — baixe-o individualmente pela linha do tempo',
};

export interface PecaDoJob {
  readonly pecaId: string;
  /** Posição nos AUTOS (ordem do MNI), não na ordem do clique. */
  readonly ordem: number;
  readonly rotulo: string;
  readonly movimento?: number;
  readonly data?: Date;
  readonly mimetype?: string;
  readonly situacao: SituacaoDownload;
  readonly motivo?: MotivoNaoObtida;
  /** Tamanho do arquivo obtido, para cota e registro de disco. */
  readonly bytes?: number;
  /** Localizador do arquivo baixado, no armazém. Nunca vai para a resposta. */
  readonly arquivo?: string;
  /**
   * Páginas que esta peça já ocupa no PDF do job anterior (atualização).
   * Presente = não se baixa de novo: a montagem copia o intervalo de lá.
   */
  readonly reaproveitada?: {
    readonly paginaInicial: number;
    readonly paginaFinal: number;
    readonly situacao: 'incorporada' | 'convertida' | 'html_convertida';
    /** O que a conversão original deixou de fora; segue com a peça reaproveitada. */
    readonly motivo?: string;
  };
}

/**
 * Um pedido de PDF combinado.
 *
 * Tudo aqui é dado gravado, e de propósito: o job precisa sobreviver a
 * redeploy no meio do download sem baixar de novo o que já veio — cada
 * consulta ao MNI carrega a senha do advogado e conta para o limite do IP.
 */
export interface JobLeitor {
  /** Aleatório e não adivinhável. Não é segredo, mas também não é sequencial. */
  readonly id: string;
  readonly workspace: string;
  /** Número CNJ sem máscara. */
  readonly numeroProcesso: string;
  readonly tribunal: string;
  /** Identificador NÃO reversível da credencial usada — procedência, não segredo. */
  readonly credencial: string;
  readonly estado: EstadoJobLeitor;
  /** Ids pedidos, na ordem em que chegaram. A ordem dos autos sai da listagem. */
  readonly pedidas: readonly string[];
  /** Vazio até a listagem do tribunal; a partir daí, na ordem dos autos. */
  readonly pecas: readonly PecaDoJob[];
  /** Todos os ids que a listagem trouxe — é por eles que "atualizar" acha o novo. */
  readonly idsListados?: readonly string[];
  /** `hashDocumentos` do `consultarAlteracao` na hora da listagem. */
  readonly hashDocumentos?: string;
  /** Tamanho de lote vigente; persiste para a retomada não recomeçar do inicial. */
  readonly tamanhoLote: number;
  /** Depois de qualquer redução o lote nunca volta a crescer neste job. */
  readonly loteTravado: boolean;
  readonly chamadas: number;
  readonly bytesRecebidos: number;
  readonly criadoEm: Date;
  readonly atualizadoEm: Date;
  readonly retomarEm?: Date;
  readonly concluidoEm?: Date;
  readonly expiraEm?: Date;
  /** Mensagem para a pessoa: por que parou, por que falhou. */
  readonly mensagem?: string;
  /** Job anterior cujo PDF esta atualização reaproveita. */
  readonly atualizaDe?: string;
  readonly arquivo?: ArquivoCombinado;
  readonly indice?: readonly EntradaIndice[];
}

export interface ArquivoCombinado {
  /** Localizador opaco, entendido só pelo armazém. Nunca vai para a resposta. */
  readonly localizador: string;
  readonly bytes: number;
  readonly paginas: number;
}

export interface ProgressoDoJob {
  readonly total: number;
  /** Peças com arquivo em mãos (inclui as vazias: o tribunal respondeu). */
  readonly baixadas: number;
  readonly pendentes: number;
  readonly recusadas: ReadonlyArray<{
    readonly pecaId: string;
    readonly rotulo: string;
    readonly motivo: MotivoNaoObtida;
    readonly descricao: string;
  }>;
}

export function progressoDoJob(job: JobLeitor): ProgressoDoJob {
  if (job.pecas.length === 0) {
    return {
      total: job.pedidas.length,
      baixadas: 0,
      pendentes: job.pedidas.length,
      recusadas: [],
    };
  }
  let baixadas = 0;
  let pendentes = 0;
  const recusadas: Array<ProgressoDoJob['recusadas'][number]> = [];
  for (const p of job.pecas) {
    if (p.situacao === 'obtida' || p.situacao === 'vazia') baixadas += 1;
    else if (p.situacao === 'pendente' || p.situacao === 'repetir') pendentes += 1;
    if (p.situacao === 'nao_obtida') {
      const motivo = p.motivo ?? 'interrompido';
      recusadas.push({
        pecaId: p.pecaId,
        rotulo: p.rotulo,
        motivo,
        descricao: DESCRICAO_DO_MOTIVO[motivo],
      });
    }
  }
  return { total: job.pecas.length, baixadas, pendentes, recusadas };
}

export interface PoliticaDeLote {
  readonly inicial: number;
  readonly maximo: number;
  /** Resposta acima disto corta o lote seguinte pela metade. */
  readonly limiteRespostaBytes: number;
  /** Resposta abaixo disto deixa o lote seguinte crescer (se nunca travou). */
  readonly limiarCrescimentoBytes: number;
}

/**
 * O tamanho do próximo lote, a partir do peso da resposta anterior.
 *
 * Adaptação por BYTES e não por quantidade, porque a listagem do tribunal não
 * diz o tamanho de nada e os arquivos variam de 2 KB a 4 MB (medido): vinte
 * certidões cabem folgadas numa resposta, vinte laudos digitalizados não. Só a
 * resposta anterior informa.
 *
 * Três regras, todas assimétricas de propósito:
 * - passou do limite → metade (mínimo 1), e o lote TRAVA: não cresce mais neste
 *   job. Oscilar entre grande e pequeno é pagar o pico de memória de novo a
 *   cada subida.
 * - falha (peça ausente na resposta) também trava, sem reduzir.
 * - abaixo do limiar e nunca travado → dobra, até o máximo.
 */
export function proximoTamanhoDeLote(
  atual: number,
  travado: boolean,
  resposta: { readonly bytes: number; readonly houveAusencia: boolean },
  politica: PoliticaDeLote,
): { readonly tamanho: number; readonly travado: boolean } {
  if (resposta.bytes > politica.limiteRespostaBytes) {
    return { tamanho: Math.max(1, Math.floor(atual / 2)), travado: true };
  }
  if (resposta.houveAusencia) return { tamanho: atual, travado: true };
  if (!travado && resposta.bytes < politica.limiarCrescimentoBytes) {
    return { tamanho: Math.min(politica.maximo, atual * 2), travado: false };
  }
  return { tamanho: atual, travado };
}

/**
 * Ordem de grandeza do tempo de uma combinação, com os números MEDIDOS.
 *
 * Sonda de lote, 01/10/2026: 0,5 a 1,8 s por chamada ao tribunal, 1,2 s com
 * 10 peças e 1,8 s com 20. A estimativa usa o pior valor medido mais a pausa
 * entre chamadas, e soma a listagem e o `consultarAlteracao` do início. É uma
 * ordem de grandeza e a tela diz isso: a fila pode ter outro job na frente, e
 * respostas pesadas reduzem o lote.
 */
export function estimarSegundos(
  pecas: number,
  opcoes: {
    readonly tamanhoLote: number;
    readonly segundosPorChamada: number;
    readonly pausaSegundos: number;
  },
): number {
  if (pecas <= 0) return 0;
  const chamadasDeLote = Math.ceil(pecas / Math.max(1, opcoes.tamanhoLote));
  const chamadas = chamadasDeLote + 2;
  return Math.ceil(chamadas * (opcoes.segundosPorChamada + opcoes.pausaSegundos));
}
