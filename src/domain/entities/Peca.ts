/**
 * Quem produziu a peça.
 *
 * Classificação de MELHOR ESFORÇO, e é importante saber disso antes de usar: o
 * MNI não tem campo "quem juntou". O que existe é o tipo do documento — o
 * código nacional (`tipoDocumento`) e o rótulo local do tribunal
 * (`tipoDocumentoLocal`) — e desses dá para inferir origem na maioria dos
 * casos, não em todos.
 *
 * Por isso `DESCONHECIDA` não é um caso de falha: é a resposta honesta quando o
 * rótulo não decide. E por isso este campo NUNCA filtra uma peça para fora da
 * lista — vale para agrupar e ordenar, como a triagem de movimentações. Sumir
 * com uma peça porque a heurística não reconheceu o rótulo é exatamente como se
 * perde prazo.
 */
export type OrigemPeca = 'PARTE' | 'JUIZO' | 'DESCONHECIDA';

export interface PecaProps {
  /** Identificador do documento NA FONTE. É o que se envia para baixar o teor. */
  readonly id: string;
  /** Código do tipo de documento na tabela nacional (atributo `tipoDocumento`). */
  readonly tipo: string;
  /** Rótulo do tribunal — ex.: "Petição Inicial", "Contestação". */
  readonly tipoLocal?: string;
  /** Descrição livre que o tribunal deu ao documento. */
  readonly descricao?: string;
  readonly dataHora?: Date;
  /** MIME do arquivo — ex.: "application/pdf". */
  readonly mimetype?: string;
  /**
   * Nível de sigilo do documento na origem. 0 é público.
   *
   * Guardado como veio: quem exibe decide o que fazer, e o domínio não tem como
   * saber quem está olhando.
   */
  readonly nivelSigilo?: number;
  /** Número do movimento a que o documento está vinculado, quando informado. */
  readonly movimento?: number;
  /** Hash do documento na origem, quando a fonte expõe. */
  readonly hash?: string;
  /** Nomes de quem assinou, quando a fonte expõe. */
  readonly signatarios?: readonly string[];
  /** Anexos deste documento. O MNI é recursivo: anexo pode ter anexo. */
  readonly vinculadas?: readonly Peca[];
  /**
   * A fonte devolveu o teor junto do metadado.
   *
   * Distingue "ainda não pedi o conteúdo" de "pedi e veio vazio" — e o segundo
   * caso é comum e tem causa conhecida: sem procuração nos autos, o MNI devolve
   * o metadado e omite o conteúdo. Um booleano aqui evita que a interface
   * mostre um botão de download que vai falhar.
   */
  readonly conteudoDisponivel?: boolean;
}

/**
 * Uma peça do processo: petição, contestação, laudo, despacho, sentença.
 *
 * É o que o DJEN nunca traz. O diário publica ato judicial; petição e documento
 * juntado pela parte não são publicados, por definição. Quem quer a peça
 * precisa da credencial de quem está habilitado nos autos — e é por isso que
 * esta entidade existe separada de `Movimentacao`: a movimentação diz que algo
 * aconteceu, a peça é o arquivo.
 *
 * O TEOR não mora aqui. `Peca` é metadado, e metadado circula barato: cabe em
 * lista, em JSON de resposta e em log. O arquivo vem em `ConteudoPeca`, pedido
 * um a um — do contrário um `toJSON()` distraído despejaria dezenas de
 * megabytes de PDF na resposta.
 */
export class Peca {
  readonly id: string;
  readonly tipo: string;
  readonly tipoLocal: string | undefined;
  readonly descricao: string | undefined;
  readonly dataHora: Date | undefined;
  readonly mimetype: string | undefined;
  readonly nivelSigilo: number | undefined;
  readonly movimento: number | undefined;
  readonly hash: string | undefined;
  readonly signatarios: readonly string[];
  readonly vinculadas: readonly Peca[];
  readonly conteudoDisponivel: boolean;

  constructor(props: PecaProps) {
    this.id = props.id;
    this.tipo = props.tipo;
    this.tipoLocal = props.tipoLocal;
    this.descricao = props.descricao;
    this.dataHora = props.dataHora;
    this.mimetype = props.mimetype;
    this.nivelSigilo = props.nivelSigilo;
    this.movimento = props.movimento;
    this.hash = props.hash;
    this.signatarios = props.signatarios ?? [];
    this.vinculadas = props.vinculadas ?? [];
    this.conteudoDisponivel = props.conteudoDisponivel ?? false;

    Object.freeze(this);
  }

  /** Rótulo mais específico disponível, para exibição. */
  get rotulo(): string {
    return this.tipoLocal ?? this.descricao ?? `documento ${this.tipo}`;
  }

  get origem(): OrigemPeca {
    return classificarOrigem(this.tipoLocal, this.descricao);
  }

  get sigilosa(): boolean {
    return (this.nivelSigilo ?? 0) > 0;
  }

  toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      tipo: this.tipo,
      tipoLocal: this.tipoLocal,
      rotulo: this.rotulo,
      descricao: this.descricao,
      origem: this.origem,
      dataHora: this.dataHora?.toISOString(),
      mimetype: this.mimetype,
      nivelSigilo: this.nivelSigilo,
      sigilosa: this.sigilosa,
      movimento: this.movimento,
      hash: this.hash,
      signatarios: this.signatarios,
      conteudoDisponivel: this.conteudoDisponivel,
      vinculadas: this.vinculadas.map((v) => v.toJSON()),
    };
  }
}

/** O arquivo em si, pedido peça a peça. */
export interface ConteudoPeca {
  readonly id: string;
  readonly mimetype: string;
  /** Nome sugerido para salvar em disco. */
  readonly nomeArquivo: string;
  readonly bytes: Uint8Array;
}

/**
 * Rótulos que denunciam peça produzida por parte, e não pelo juízo.
 *
 * Lista de prefixos e não de igualdade: os tribunais concatenam qualificação no
 * rótulo ("Petição - Manifestação da parte autora"), e casar exato perderia
 * quase tudo.
 *
 * Escritos SEM acento de propósito: `normalizar` tira os acentos dos dois lados
 * da comparação, então manter "petição" e "peticao" na lista seria a mesma
 * entrada duas vezes.
 */
const ROTULOS_DE_PARTE = [
  'petic',
  'contestac',
  'replica',
  'impugnac',
  'recurso',
  'apelac',
  'agravo',
  'embargos',
  'contrarraz',
  'contra-raz',
  'procurac',
  'documento',
  'laudo',
  'parecer',
  'manifestac',
  'alegac',
  'memorial',
  'juntada',
];

const ROTULOS_DE_JUIZO = [
  'despacho',
  'decis',
  'sentenc',
  'acordao',
  'certid',
  'mandado',
  'oficio',
  'intimac',
  'citac',
  'ata de',
  'termo de',
  'alvar',
  'edital',
  'voto',
];

function classificarOrigem(
  tipoLocal: string | undefined,
  descricao: string | undefined,
): OrigemPeca {
  const texto = normalizar(`${tipoLocal ?? ''} ${descricao ?? ''}`);
  if (!texto.trim()) return 'DESCONHECIDA';

  // Juízo primeiro: "Juntada de Certidão" tem as duas marcas, e o ato é do
  // cartório. Invertendo a ordem, metade das certidões viraria peça de parte.
  if (ROTULOS_DE_JUIZO.some((r) => texto.includes(normalizar(r)))) return 'JUIZO';
  if (ROTULOS_DE_PARTE.some((r) => texto.includes(normalizar(r)))) return 'PARTE';
  return 'DESCONHECIDA';
}

function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}
