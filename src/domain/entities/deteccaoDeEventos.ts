import { chaveDaMovimentacao } from './Acompanhamento.js';
import type { Movimentacao } from './Movimentacao.js';
import type { SugestaoDeEvento, TipoDeEvento } from './EventoDeCalendario.js';
import { LIMITE_TRECHO, dataExiste, somarDias } from './EventoDeCalendario.js';

/**
 * Lê, no texto de um andamento, datas de audiência, perícia, sessão de
 * julgamento e prazo com data final escrita.
 *
 * Função PURA: sem rede, sem relógio (o "hoje" entra por parâmetro), sem I/O.
 *
 * A regra que decide cada linha daqui: **falso negativo é aceitável, falso
 * positivo confiante não.** Uma sugestão errada no calendário de um advogado
 * é lida como compromisso; uma data que deixamos de ler continua no andamento,
 * que ele também recebe. Por isso:
 *
 *   - só data EXPLÍCITA (`dd/mm/aaaa` ou `dd/mm/aa`) — nada de "daqui a 15
 *     dias", nada de "no próximo dia útil";
 *   - só data COLADA a um gatilho, na mesma frase, sem outra data no meio;
 *   - frase com gatilhos de tipos diferentes (audiência E perícia) não gera;
 *   - duas datas presas ao mesmo gatilho não geram nenhuma das duas, e uma
 *     data futura solta numa frase com gatilho anula a frase;
 *   - andamento que fala em cancelar, retirar de pauta, redesignar ou adiar
 *     marca para revisão o que já existia; só a REDESIGNAÇÃO com data nova
 *     escrita logo depois de "para" gera sugestão (a data nova);
 *   - "prazo de N dias" sem data final escrita NÃO gera evento. Transformar
 *     isso em data seria calcular prazo, e o sistema não afirma prazo.
 */

export interface ContextoDaDeteccao {
  /** Hoje, em São Paulo (`AAAA-MM-DD`). Data anterior não vira evento. */
  readonly hoje: string;
  /**
   * Nomes a apagar do trecho guardado (partes e advogados do processo). O
   * trecho é mostrado na tela como procedência e não pode carregar nome.
   */
  readonly nomesProtegidos?: readonly string[];
}

export interface ResultadoDaDeteccao {
  readonly sugestoes: readonly SugestaoDeEvento[];
  /**
   * O andamento sugere que um evento já marcado mudou, e de quais tipos.
   * `tipos` vazio = o texto fala em cancelar algo que não sabemos o que é
   * ("penhora cancelada"): nenhum evento é marcado, mas também nenhuma
   * sugestão nasce deste andamento.
   */
  readonly mudanca?: { readonly tipos: readonly TipoDeEvento[] };
}

/** Data mais distante que aceitamos: além disso é ano digitado errado. */
const ANOS_DE_HORIZONTE = 3;

/** Distância máxima, em caracteres, entre gatilho e data. */
const DISTANCIA_ANTES = 120;
const DISTANCIA_DEPOIS = 60;

type Gatilho = 'audiencia' | 'pericia' | 'sessao';

const GATILHOS: ReadonlyArray<{ readonly tipo: Gatilho; readonly re: RegExp }> = [
  // "audiência de conciliação", "de instrução e julgamento", "una" — todas
  // começam por "audiência"; o qualificador vira título, não outro gatilho.
  { tipo: 'audiencia', re: /audi[êe]ncia/gi },
  { tipo: 'pericia', re: /per[íi]cia|pericial/gi },
  // "sessão de julgamento", "sessão virtual de julgamento", "sessão ordinária
  // de julgamento". Sessão de conciliação NÃO entra: é outro rito, e sem
  // amostra real não há como saber se o texto é pauta ou relato.
  { tipo: 'sessao', re: /sess[ãa]o\s+(?:[a-zà-ú]+\s+){0,2}?de\s+julgamento/gi },
];

/**
 * Sinais de que um evento já marcado mudou. "Adiada" e "desmarcada" entram
 * além dos três da especificação porque pedem a mesma conferência.
 */
const MUDANCA =
  /cancelad[ao]s?|retirad[ao]s?\s+d[ae]\s+pauta|redesigna(?:d[ao]s?|[çc][ãa]o)|redesigno|adiad[ao]s?|desmarcad[ao]s?/i;

const PAUTA = /retirad[ao]s?\s+d[ae]\s+pauta/i;

/** `dd/mm/aaaa` ou `dd/mm/aa`, sem colar em outro número ou barra. */
const RE_DATA = /(?<![\d/])(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?![\d/])/g;

/** Hora logo DEPOIS da data: "às 14:30", "14h30", "14h", "9h30min", "14 horas". */
const RE_HORA_DEPOIS =
  /^[\s,]*(?:(?:[àa]s|pelas|a\s+partir\s+das|com\s+in[íi]cio\s+[àa]s)\s+)?(\d{1,2})(?:\s*:\s*(\d{2})|\s*h\s*(\d{2})?(?:\s*min)?|\s+horas?)(?![\d])/i;

/** Hora logo ANTES da data: "às 14h30 do dia 12/11/2026". */
const RE_HORA_ANTES =
  /(?:[àa]s|pelas)\s+(\d{1,2})(?:\s*:\s*(\d{2})|\s*h\s*(\d{2})?(?:\s*min)?|\s+horas?)\s*(?:,\s*)?(?:do\s+dia|no\s+dia|de|em|,)?\s*$/i;

/** "até 20/10/2026", "até o dia 20/10/2026", "até a data de 20/10/2026". */
const RE_ATE_ANTES = /\bat[ée]\s+(?:o\s+dia\s+|a\s+data\s+de\s+|o\s+próximo\s+dia\s+)?$/i;

interface DataNoTexto {
  readonly inicio: number;
  /** Fim da data E da hora que a acompanha. */
  readonly fim: number;
  readonly dataLocal: string;
  readonly horaLocal?: string;
}

interface OcorrenciaDeGatilho {
  readonly tipo: Gatilho;
  readonly inicio: number;
  readonly fim: number;
}

export function detectarEventosNoAndamento(
  andamento: Movimentacao,
  contexto: ContextoDaDeteccao,
): ResultadoDaDeteccao {
  const texto = textoDoAndamento(andamento);
  if (texto.length === 0) return { sugestoes: [] };

  const horizonte = somarDias(contexto.hoje, 365 * ANOS_DE_HORIZONTE);

  // Mudança vale para o andamento INTEIRO: marca para revisão o que já
  // existia. Cancelada, retirada de pauta, adiada: nenhuma sugestão nasce.
  // REDESIGNADA com data nova e explícita ("redesignada para o dia
  // 20/11/2026 às 14h") é a exceção (decisão do dono, v1.0.3): a data nova
  // vira sugestão, e a antiga continua marcada para o advogado conferir.
  if (MUDANCA.test(texto)) {
    const tipos = new Set<TipoDeEvento>();
    for (const g of GATILHOS) {
      g.re.lastIndex = 0;
      if (g.re.test(texto)) tipos.add(tipoDoGatilho(g.tipo));
    }
    // "Retirado de pauta" sem dizer de quê é pauta de audiência ou de sessão.
    if (tipos.size === 0 && PAUTA.test(texto)) {
      tipos.add('audiencia');
      tipos.add('outro');
    }
    return {
      sugestoes: sugestoesDeRedesignacao(andamento, texto, contexto, horizonte),
      mudanca: { tipos: [...tipos] },
    };
  }

  const movimentacaoId = chaveDaMovimentacao(andamento);
  const sugestoes: SugestaoDeEvento[] = [];
  const vistas = new Set<string>();

  for (const frase of frases(texto)) {
    const datas = datasNaFrase(frase.texto).filter(
      (d) => d.dataLocal >= contexto.hoje && d.dataLocal <= horizonte,
    );
    if (datas.length === 0) continue;

    const gatilhos = gatilhosNaFrase(frase.texto);
    const temPrazo = /\bprazo/i.test(frase.texto);

    // Pareia cada data com UM gatilho; o mesmo gatilho preso a duas datas é
    // dúvida, e na dúvida nenhuma das duas vira evento.
    const pares: Array<{
      data: DataNoTexto;
      tipo: TipoDeEvento;
      titulo: string;
      chave: string;
    }> = [];
    const tiposNaFrase = new Set(gatilhos.map((g) => g.tipo));

    for (const data of datas) {
      const antes = frase.texto.slice(0, data.inicio);
      if (temPrazo && RE_ATE_ANTES.test(antes)) {
        pares.push({
          data,
          tipo: 'prazo',
          titulo: 'Prazo (data escrita no andamento)',
          chave: `prazo@${data.inicio}`,
        });
        continue;
      }
      if (tiposNaFrase.size !== 1) continue;
      const g = gatilhoDaData(data, gatilhos, datas);
      if (!g) continue;
      pares.push({
        data,
        tipo: tipoDoGatilho(g.tipo),
        titulo: tituloDoGatilho(g, frase.texto),
        chave: `${g.tipo}@${g.inicio}`,
      });
    }

    const usos = new Map<string, number>();
    for (const p of pares) usos.set(p.chave, (usos.get(p.chave) ?? 0) + 1);

    // Data futura que ficou sem gatilho, numa frase que tem gatilho, é a
    // alternativa ("ou, não sendo possível, 13/11") ou outra coisa que não
    // entendemos. Na dúvida, a frase inteira não gera audiência nem perícia —
    // só o prazo, que tem o "até" colado na própria data.
    const orfas = datas.some((d) => !pares.some((p) => p.data === d));

    for (const p of pares) {
      if ((usos.get(p.chave) ?? 0) > 1) continue;
      if (orfas && p.tipo !== 'prazo') continue;
      const id = `${p.tipo}|${p.data.dataLocal}|${p.data.horaLocal ?? ''}`;
      if (vistas.has(id)) continue;
      vistas.add(id);
      sugestoes.push({
        tipo: p.tipo,
        titulo: p.titulo,
        dataLocal: p.data.dataLocal,
        ...(p.data.horaLocal !== undefined ? { horaLocal: p.data.horaLocal } : {}),
        procedencia: {
          movimentacaoId,
          dataDoAndamento: andamento.data,
          trecho: trechoSemNomes(frase.texto, p.data, contexto.nomesProtegidos ?? []),
        },
      });
    }
  }

  return { sugestoes };
}

/** "redesignada", "redesigno", "redesignação". */
const REDESIGNACAO = /redesigna(?:d[ao]s?|[çc][ãa]o)|redesigno/i;

/** A data nova vem logo depois de "para", "para o dia", "para a data de". */
const RE_PARA_ANTES = /\bpara\s+(?:o\s+dia\s+|a\s+data\s+de\s+|o\s+próximo\s+dia\s+)?$/i;

/**
 * A data nova de uma redesignação.
 *
 * Só na frase que diz "redesign…", só com UM tipo de gatilho nela, e só com
 * UMA data futura escrita logo depois de "para" — "redesignada de 10/11/2026
 * para 20/11/2026" usa a segunda. Duas datas depois de "para", ou nenhuma: não
 * é claro, não gera.
 */
function sugestoesDeRedesignacao(
  andamento: Movimentacao,
  texto: string,
  contexto: ContextoDaDeteccao,
  horizonte: string,
): SugestaoDeEvento[] {
  if (!REDESIGNACAO.test(texto)) return [];
  const movimentacaoId = chaveDaMovimentacao(andamento);
  const sugestoes: SugestaoDeEvento[] = [];
  const vistas = new Set<string>();

  for (const frase of frases(texto)) {
    if (!REDESIGNACAO.test(frase.texto)) continue;
    const gatilhos = gatilhosNaFrase(frase.texto);
    const tipos = new Set(gatilhos.map((g) => g.tipo));
    if (tipos.size !== 1) continue;
    const candidatas = datasNaFrase(frase.texto).filter((d) =>
      RE_PARA_ANTES.test(frase.texto.slice(0, d.inicio)),
    );
    if (candidatas.length !== 1) continue;
    const data = candidatas[0];
    const gatilho = gatilhos[0];
    if (!data || !gatilho) continue;
    if (data.dataLocal < contexto.hoje || data.dataLocal > horizonte) continue;

    const tipo = tipoDoGatilho(gatilho.tipo);
    const id = `${tipo}|${data.dataLocal}|${data.horaLocal ?? ''}`;
    if (vistas.has(id)) continue;
    vistas.add(id);
    sugestoes.push({
      tipo,
      titulo: tituloDoGatilho(gatilho, frase.texto),
      dataLocal: data.dataLocal,
      ...(data.horaLocal !== undefined ? { horaLocal: data.horaLocal } : {}),
      procedencia: {
        movimentacaoId,
        dataDoAndamento: andamento.data,
        trecho: trechoSemNomes(frase.texto, data, contexto.nomesProtegidos ?? []),
      },
    });
  }
  return sugestoes;
}

function textoDoAndamento(a: Movimentacao): string {
  const partes = [a.titulo, a.teorIndisponivel ? '' : (a.conteudo ?? '')]
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  // O título entra como frase própria: "Audiência designada" no título e a
  // data no teor são, na prática, o mesmo ato — mas ficam em frases
  // diferentes de propósito, e por isso não se juntam (falso negativo aceito).
  return partes.join('.\n').replace(/[ \t\u00a0]+/g, ' ');
}

/**
 * Ponto seguido de maiúscula, menos depois das abreviações que mais aparecem
 * em despacho ("Dr. Fulano", "art. 334", "fls. 12", "MM. Juiz").
 */
const FIM_DE_FRASE =
  /(?<!\b(?:Dr|Dra|Drs|Sr|Sra|Srs|Exmo|Exma|MM|Des|Min|Prof|Profa|art|arts|fls?|inc|n|nº|Av|p|pp)\.)(?<=[.!?])\s+(?=[A-ZÀ-Ú0-9"“(])|[;\n]+/i;

/**
 * Corta o texto em frases. Abreviação ("Dr.", "art.") às vezes corta onde não
 * devia; o efeito é separar gatilho e data e PERDER um evento, nunca inventar.
 */
function frases(texto: string): Array<{ texto: string }> {
  return texto
    .split(FIM_DE_FRASE)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .map((t) => ({ texto: t }));
}

function datasNaFrase(frase: string): DataNoTexto[] {
  const achadas: DataNoTexto[] = [];
  RE_DATA.lastIndex = 0;
  for (let m = RE_DATA.exec(frase); m; m = RE_DATA.exec(frase)) {
    const dia = Number(m[1]);
    const mes = Number(m[2]);
    const anoTexto = m[3] ?? '';
    const ano = anoTexto.length === 2 ? 2000 + Number(anoTexto) : Number(anoTexto);
    if (!dataExiste(ano, mes, dia)) continue;

    const inicio = m.index;
    let fim = m.index + m[0].length;
    let hora = horaDe(RE_HORA_DEPOIS.exec(frase.slice(fim, fim + 40)));
    if (hora) {
      fim += hora.tamanho;
    } else {
      hora = horaDe(RE_HORA_ANTES.exec(frase.slice(Math.max(0, inicio - 40), inicio)));
    }
    achadas.push({
      inicio,
      fim,
      dataLocal: `${ano}-${dois(mes)}-${dois(dia)}`,
      ...(hora ? { horaLocal: hora.valor } : {}),
    });
  }
  return achadas;
}

function horaDe(
  m: RegExpExecArray | null,
): { readonly valor: string; readonly tamanho: number } | undefined {
  if (!m) return undefined;
  const h = Number(m[1]);
  const min = Number(m[2] ?? m[3] ?? '0');
  if (!(h >= 0 && h <= 23 && min >= 0 && min <= 59)) return undefined;
  return { valor: `${dois(h)}:${dois(min)}`, tamanho: m[0].length };
}

function gatilhosNaFrase(frase: string): OcorrenciaDeGatilho[] {
  const achados: OcorrenciaDeGatilho[] = [];
  for (const g of GATILHOS) {
    g.re.lastIndex = 0;
    for (let m = g.re.exec(frase); m; m = g.re.exec(frase)) {
      achados.push({ tipo: g.tipo, inicio: m.index, fim: m.index + m[0].length });
    }
  }
  return achados.sort((a, b) => a.inicio - b.inicio);
}

/**
 * O gatilho a que a data está presa: o mais próximo ANTES dela (sem outra
 * data no meio, até `DISTANCIA_ANTES`), ou, se não houver, o mais próximo
 * DEPOIS ("dia 12/11/2026, às 9h, para a perícia"), até `DISTANCIA_DEPOIS`.
 */
function gatilhoDaData(
  data: DataNoTexto,
  gatilhos: readonly OcorrenciaDeGatilho[],
  datas: readonly DataNoTexto[],
): OcorrenciaDeGatilho | undefined {
  const entre = (a: number, b: number): boolean =>
    datas.some((d) => d !== data && d.inicio >= a && d.inicio < b);

  const antes = gatilhos
    .filter((g) => g.fim <= data.inicio && data.inicio - g.fim <= DISTANCIA_ANTES)
    .filter((g) => !entre(g.fim, data.inicio));
  const ultimo = antes[antes.length - 1];
  if (ultimo) return ultimo;

  return gatilhos
    .filter((g) => g.inicio >= data.fim && g.inicio - data.fim <= DISTANCIA_DEPOIS)
    .find((g) => !entre(data.fim, g.inicio));
}

function tipoDoGatilho(g: Gatilho): TipoDeEvento {
  // Sessão de julgamento não é audiência: é sessão do colegiado. Vira `outro`
  // com o título dizendo o que é, em vez de forçar um rótulo errado no feed.
  return g === 'sessao' ? 'outro' : g;
}

const QUALIFICADOR_DE_AUDIENCIA =
  /^\s+(?:de\s+|do\s+)?(concilia[çc][ãa]o|media[çc][ãa]o|instru[çc][ãa]o(?:\s+e\s+julgamento)?|julgamento|justifica[çc][ãa]o|una|inicial|de\s+cust[óo]dia)/i;

function tituloDoGatilho(g: OcorrenciaDeGatilho, frase: string): string {
  if (g.tipo === 'pericia') return 'Perícia';
  if (g.tipo === 'sessao') return 'Sessão de julgamento';
  const q = QUALIFICADOR_DE_AUDIENCIA.exec(frase.slice(g.fim, g.fim + 40));
  if (!q?.[1]) return 'Audiência';
  const qualificador = q[1].toLowerCase().replace(/\s+/g, ' ');
  return qualificador === 'una' || qualificador === 'inicial'
    ? `Audiência ${qualificador}`
    : `Audiência de ${qualificador.replace(/^de /, '')}`;
}

/**
 * O trecho guardado como procedência: a frase em volta da data, até 200
 * caracteres, sem nome de parte nem de advogado, sem CPF/CNPJ.
 *
 * Os nomes saem ANTES do corte: cortar primeiro deixaria meio nome na borda,
 * e meio nome continua sendo nome.
 */
function trechoSemNomes(
  frase: string,
  data: DataNoTexto,
  nomes: readonly string[],
): string {
  const limpo = apagarNomes(frase, nomes).replace(
    /\d{2,3}\.?\d{3}\.?\d{3}[-/]?\d{2,4}(?:-?\d{2})?/g,
    '[documento]',
  );
  // A posição da data pode ter andado com as substituições; procura de novo.
  const ancora = Math.max(0, limpo.indexOf(frase.slice(data.inicio, data.fim)));
  if (limpo.length <= LIMITE_TRECHO) return limpo;

  const metade = Math.floor((LIMITE_TRECHO - 2) / 2);
  let inicio = Math.max(0, ancora - metade);
  const fim = Math.min(limpo.length, inicio + LIMITE_TRECHO - 2);
  inicio = Math.max(0, fim - (LIMITE_TRECHO - 2));
  return `${inicio > 0 ? '…' : ''}${limpo.slice(inicio, fim).trim()}${fim < limpo.length ? '…' : ''}`;
}

/**
 * Apaga nomes sem depender de acento nem de caixa: o tribunal escreve "JOSÉ" no
 * cabeçalho e "Jose" no despacho. A dobra é caractere a caractere, para que as
 * posições no texto dobrado valham no original.
 */
const MARCA = '[parte]';

function apagarNomes(texto: string, nomes: readonly string[]): string {
  const alvos = [
    ...new Set(nomes.map((n) => dobrar(n.trim())).filter((n) => n.length >= 4)),
  ]
    // Os longos primeiro: "MARIA DA SILVA SOUZA" antes de "MARIA DA SILVA".
    .sort((a, b) => b.length - a.length);
  if (alvos.length === 0) return texto;

  let resultado = texto;
  for (const alvo of alvos) {
    let dobrado = dobrar(resultado);
    for (
      let i = dobrado.indexOf(alvo);
      i !== -1;
      i = dobrado.indexOf(alvo, i + MARCA.length)
    ) {
      resultado = `${resultado.slice(0, i)}${MARCA}${resultado.slice(i + alvo.length)}`;
      dobrado = dobrar(resultado);
    }
  }
  return resultado;
}

function dobrar(texto: string): string {
  let saida = '';
  // Unidade a unidade de UTF-16, e não por ponto de código: o índice achado no
  // texto dobrado precisa valer no original, inclusive depois de um emoji.
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charAt(i);
    const base = c.normalize('NFD').replace(/\p{M}/gu, '');
    const candidato = (base.length === 1 ? base : c).toUpperCase();
    saida += candidato.length === 1 ? candidato : c;
  }
  return saida;
}

function dois(n: number): string {
  return String(n).padStart(2, '0');
}
