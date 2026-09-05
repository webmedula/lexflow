import type { Movimentacao } from './Movimentacao.js';

/**
 * Separa o que o advogado precisa responder do que é registro de cartório.
 *
 * É a diferença entre uma lista e um assistente. O processo de teste tem 361
 * andamentos: 231 são confirmação, expedição e juntada, e dos 62 atos publicados
 * no diário, 43 são "arquivos digitais indisponíveis". Sobra pouca coisa que de
 * fato pede providência — e é essa pouca coisa que decide prazo.
 *
 * AVISO QUE VALE PARA O ARQUIVO INTEIRO: isto é uma triagem, não um parecer.
 * Nunca use `exigeAcao === false` para ESCONDER andamento; use para ordenar e
 * destacar. Sumir com um ato porque a heurística não reconheceu o verbo é
 * exatamente como se perde prazo, e nenhuma expressão regular merece esse
 * poder. A interface mostra tudo; a triagem só diz o que olhar primeiro.
 */

/**
 * Verbos no imperativo que o juízo usa para mandar alguém fazer alguma coisa.
 *
 * Vêm em duas formas no mesmo despacho ("INTIME-SE" e "Intimem-se as partes"),
 * às vezes com pronome no plural, às vezes com hífen comendo. O casamento é
 * frouxo de propósito: falso positivo custa um destaque a mais; falso negativo
 * custa um prazo.
 */
const DETERMINACOES = [
  /\bintime[- ]?(se|m[- ]?se)?\b/i,
  /\bcite[- ]?(se|m[- ]?se)?\b/i,
  /\bnotifique[- ]?(se|m[- ]?se)?\b/i,
  /\bmanifeste[- ]?(se|m[- ]?se)?\b/i,
  /\bapresente[- ]?(se|m)?\b/i,
  /\bcomprove[- ]?(se|m)?\b/i,
  /\bespecifique[- ]?(m)?\b/i,
  /\bemende[- ]?(se|m)?\b/i,
  /\brecolha[- ]?(se|m)?\b/i,
  /\bimpugne[- ]?(se|m)?\b/i,
  /\bcumpra[- ]?se\b/i,
  /\bpague\b/i,
];

/** "prazo de 15 dias", "no prazo de cinco (05) dias", "prazo: 10 dias úteis". */
const PRAZO_EXPLICITO =
  /\bprazo\b[^.;]{0,60}?\b(\d{1,3}|um|dois|tr[êe]s|quatro|cinco|dez|quinze|trinta)\b\s*(\(\s*\d{1,3}\s*\))?\s*dias?\b/i;

/**
 * Tipos de documento do DJEN e rótulos da TPU que praticamente sempre pedem
 * leitura, mesmo quando o texto não traz verbo nenhum.
 */
const TIPOS_RELEVANTES = [
  /\bsenten[çc]a\b/i,
  /\bdecis[ãa]o\b/i,
  /\bac[óo]rd[ãa]o\b/i,
  /\bdespacho\b/i,
  /\bnotifica[çc][ãa]o\b/i,
  /\bintima[çc][ãa]o\b/i,
  /\bcita[çc][ãa]o\b/i,
];

/**
 * Atos que são movimento de cartório: o processo andou, mas ninguém precisa
 * fazer nada. Verificados PRIMEIRO — "Juntada de petição" contém "petição" e
 * cairia em heurística ingênua.
 */
const TIPOS_DE_CARTORIO = [
  /\bjuntada\b/i,
  /\bexpedi[çc][ãa]o\b/i,
  /\bconclus[ãa]o\b/i,
  /\bconclusos?\b/i,
  /\bremessa\b/i,
  /\brecebimento\b/i,
  /\bdistribui[çc][ãa]o\b/i,
  /\bconfirma[çc][ãa]o\b/i,
  /\barquivamento\b/i,
  /\bdesarquivamento\b/i,
];

export interface Triagem {
  /** Abre prazo ou pede providência — é o que o advogado precisa olhar. */
  readonly exigeAcao: boolean;
  /** Por que foi marcado assim. Aparece na tela: heurística sem explicação não se audita. */
  readonly motivo?: string;
}

/**
 * @param movimentacao o andamento já mapeado para o domínio
 */
export function triar(movimentacao: Movimentacao): Triagem {
  const titulo = movimentacao.titulo;
  const texto = movimentacao.conteudo ?? '';

  // Um teor que a fonte não entregou não pode ser triado pelo texto: o "não" da
  // heurística seria sobre uma string vazia, não sobre o ato. Vai pelo tipo.
  const temTexto = !movimentacao.teorIndisponivel && texto.length > 0;

  const prazo = temTexto && PRAZO_EXPLICITO.test(texto);
  if (prazo) {
    return { exigeAcao: true, motivo: 'o ato menciona prazo em dias' };
  }

  const determinacao =
    temTexto && DETERMINACOES.some((r) => r.test(texto));
  if (determinacao) {
    return { exigeAcao: true, motivo: 'o ato contém determinação ao advogado' };
  }

  if (TIPOS_DE_CARTORIO.some((r) => r.test(titulo))) {
    return { exigeAcao: false, motivo: 'movimento de cartório' };
  }

  if (TIPOS_RELEVANTES.some((r) => r.test(titulo))) {
    return { exigeAcao: true, motivo: `é ${titulo.toLowerCase()}` };
  }

  return { exigeAcao: false };
}

/** Aplica a triagem numa lista, preservando tudo o mais. */
export function triarTodas(
  movimentacoes: readonly Movimentacao[],
): Movimentacao[] {
  return movimentacoes.map((m) => {
    const { exigeAcao } = triar(m);
    return exigeAcao ? { ...m, exigeAcao: true } : m;
  });
}

/**
 * Os andamentos que pedem providência, do mais recente para o mais antigo.
 * É o que alimenta o topo da tela e o corpo do e-mail.
 */
export function pendencias(
  movimentacoes: readonly Movimentacao[],
): Movimentacao[] {
  return movimentacoes
    .filter((m) => triar(m).exigeAcao)
    .slice()
    .sort((a, b) => b.data.getTime() - a.data.getTime());
}
