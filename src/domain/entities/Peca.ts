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
   * A fonte devolveu o teor JUNTO do metadado, nesta mesma resposta.
   *
   * **Não é "posso baixar".** No MNI é sempre `false` na listagem, medido no
   * TJGO: a ficha das 278 peças vem sem um único `<conteudo>`, e o arquivo só
   * aparece quando se pede o documento pelo id. Quem tratar `false` como "o
   * tribunal não liberou" esconde o botão de download de um processo inteiro
   * ao qual o advogado tem acesso pleno.
   *
   * Se existe direito de ver a peça, só a tentativa responde — e a resposta é
   * `TeorNaoAutorizadoError`, no download, não aqui.
   */
  readonly conteudoDisponivel?: boolean;
  /**
   * Origem deduzida do MOVIMENTO, quando o rótulo não decide.
   *
   * Preenchida por `herdarOrigemPorMovimento`, nunca pelo adapter. Fica
   * separada de propósito: o que veio do tribunal e o que o sistema deduziu
   * não podem virar o mesmo campo, senão ninguém distingue depois.
   */
  readonly origemDoMovimento?: OrigemPeca;
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
  readonly origemDoMovimento: OrigemPeca | undefined;

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
    this.origemDoMovimento = props.origemDoMovimento;

    Object.freeze(this);
  }

  /** Rótulo mais específico disponível, para exibição. */
  get rotulo(): string {
    return this.tipoLocal ?? this.descricao ?? `documento ${this.tipo}`;
  }

  get origem(): OrigemPeca {
    const peloTexto = classificarOrigem(this.tipoLocal, this.descricao);
    // O rótulo do tribunal vence sempre. A herança do movimento só preenche o
    // vazio — ela é dedução, e dedução não sobrepõe o que a fonte afirmou.
    if (peloTexto !== 'DESCONHECIDA') return peloTexto;
    return this.origemDoMovimento ?? 'DESCONHECIDA';
  }

  /** Verdadeiro quando a origem veio de dedução, não do rótulo da fonte. */
  get origemDeduzida(): boolean {
    return (
      classificarOrigem(this.tipoLocal, this.descricao) === 'DESCONHECIDA' &&
      this.origemDoMovimento !== undefined
    );
  }

  /** Cópia com a origem deduzida preenchida. A entidade é imutável. */
  comOrigemDoMovimento(origem: OrigemPeca): Peca {
    return new Peca({
      id: this.id,
      tipo: this.tipo,
      origemDoMovimento: origem,
      conteudoDisponivel: this.conteudoDisponivel,
      signatarios: this.signatarios,
      vinculadas: this.vinculadas,
      ...(this.tipoLocal !== undefined ? { tipoLocal: this.tipoLocal } : {}),
      ...(this.descricao !== undefined ? { descricao: this.descricao } : {}),
      ...(this.dataHora !== undefined ? { dataHora: this.dataHora } : {}),
      ...(this.mimetype !== undefined ? { mimetype: this.mimetype } : {}),
      ...(this.nivelSigilo !== undefined ? { nivelSigilo: this.nivelSigilo } : {}),
      ...(this.movimento !== undefined ? { movimento: this.movimento } : {}),
      ...(this.hash !== undefined ? { hash: this.hash } : {}),
    });
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
      origemDeduzida: this.origemDeduzida,
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

/**
 * Os dois últimos entraram pelo censo de um processo real do TJGO — 278 peças,
 * rótulos e contagens: Outros 111, Petição 58, Certidão 31, Decisão 22,
 * **Ato Ordinatório 17**, Documento Diverso 12, Ofício 8, Alvará 7, Despacho 7,
 * Procuração 2, Sentença 1, Relatório e Voto 1, **Ementa 1**.
 *
 * Sem eles, 18 atos de cartório e de acórdão caíam em `DESCONHECIDA`. O censo
 * também explica por que `DESCONHECIDA` não é caso de falha: 111 peças vêm
 * rotuladas literalmente como "Outros" pelo tribunal, e nenhuma heurística
 * decide isso — só abrir o arquivo.
 */
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
  'ato ordinat',
  'ementa',
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

/**
 * Deduz a origem das peças sem rótulo útil, pelo MOVIMENTO que as juntou.
 *
 * **Por que isto existe.** Num processo real do TJGO, 111 das 278 peças
 * chegaram com `descricao="Outros"` — 40% da lista caindo em "origem não
 * identificada", todas PDF, todas na mesma data de uma petição. São os anexos
 * das petições, e o tribunal simplesmente não rotula anexo.
 *
 * **Por que isto NÃO é mais um chute de texto.** O atributo `movimento` diz a
 * qual ato o documento pertence: anexo e petição compartilham o mesmo número
 * porque foram juntados no mesmo ato. Não se está adivinhando pelo nome — se
 * está lendo uma relação que a fonte afirma.
 *
 * As três regras que mantêm isso honesto:
 *
 * 1. **Só preenche vazio.** Peça cujo rótulo já decide não é tocada.
 * 2. **Movimento com origens conflitantes não deduz nada.** Se no mesmo ato há
 *    peça de parte e peça de juízo, qualquer escolha seria invenção.
 * 3. **Sem `movimento`, sem dedução.** Peça solta continua DESCONHECIDA, que é
 *    a resposta honesta.
 *
 * E a dedução fica marcada em `origemDeduzida`, para que a tela possa dizer
 * que aquilo foi inferido — o que a fonte afirmou e o que o sistema concluiu
 * nunca podem virar a mesma coisa.
 */
export function herdarOrigemPorMovimento(pecas: readonly Peca[]): Peca[] {
  const origensPorMovimento = new Map<number, Set<OrigemPeca>>();

  for (const p of pecas) {
    if (p.movimento === undefined) continue;
    const origem = p.origem;
    if (origem === 'DESCONHECIDA') continue;
    const atual = origensPorMovimento.get(p.movimento) ?? new Set<OrigemPeca>();
    atual.add(origem);
    origensPorMovimento.set(p.movimento, atual);
  }

  return pecas.map((p) => {
    if (p.movimento === undefined) return p;
    if (p.origem !== 'DESCONHECIDA') return p;
    const conhecidas = origensPorMovimento.get(p.movimento);
    if (!conhecidas || conhecidas.size !== 1) return p;
    const [unica] = [...conhecidas];
    return unica ? p.comOrigemDoMovimento(unica) : p;
  });
}
