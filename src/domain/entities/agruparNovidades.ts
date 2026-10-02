import type { Novidade } from './Acompanhamento.js';

/**
 * Uma linha da tela de Atualizações: um processo, com a atualização mais
 * recente em destaque e as anteriores atrás de "+N anteriores".
 */
export interface GrupoDeNovidades {
  readonly numero: string;
  readonly maisRecente: Novidade;
  /** Da mais recente para a mais antiga. Nada é descartado: a tela expande na linha. */
  readonly anteriores: readonly Novidade[];
  /** Quantas ATUALIZAÇÕES do grupo ainda não foram vistas (não linhas). */
  readonly naoVistas: number;
}

export interface NovidadesAgrupadas {
  readonly grupos: readonly GrupoDeNovidades[];
  /** Atualizações dentro da janela (soma dos grupos). */
  readonly dentroDaJanela: number;
  /** Atualizações mais antigas que a janela. A tela diz quantas ficaram de fora. */
  readonly foraDaJanela: number;
}

/**
 * Agrupa por processo e aplica a janela de tempo.
 *
 * A janela decide pela hora em que o sistema PERCEBEU a atualização
 * (`detectadaEm`), a mesma que a tela exibe — não pela data do ato: a primeira
 * varredura de um processo antigo detecta atos de meses atrás, e esconder isso
 * pela data do ato calaria justamente a novidade que o advogado ainda não viu.
 *
 * `exigeAcao` NÃO entra aqui, de propósito (triagem ordena, nunca esconde): o
 * único critério que tira uma atualização da tela é o tempo, e a tela conta
 * quantas tiraram.
 *
 * `janelaDias === undefined` é "Todas".
 */
export function agruparNovidades(
  novidades: readonly Novidade[],
  agora: Date,
  janelaDias?: number,
): NovidadesAgrupadas {
  const limite =
    janelaDias === undefined ? undefined : agora.getTime() - janelaDias * 86_400_000;

  const porProcesso = new Map<string, Novidade[]>();
  let foraDaJanela = 0;
  let dentroDaJanela = 0;

  for (const n of novidades) {
    if (limite !== undefined && n.detectadaEm.getTime() < limite) {
      foraDaJanela += 1;
      continue;
    }
    dentroDaJanela += 1;
    const lista = porProcesso.get(n.numero);
    if (lista) lista.push(n);
    else porProcesso.set(n.numero, [n]);
  }

  const grupos: GrupoDeNovidades[] = [];
  for (const [numero, lista] of porProcesso) {
    // Não confia na ordem de entrada: o repositório ordena, mas o agrupamento
    // é uma regra de domínio e não pode depender de quem chamou.
    const ordenada = [...lista].sort(maisRecentePrimeiro);
    const [maisRecente, ...anteriores] = ordenada;
    if (!maisRecente) continue;
    grupos.push({
      numero,
      maisRecente,
      anteriores,
      naoVistas: ordenada.filter((n) => n.vistaEm === undefined).length,
    });
  }
  grupos.sort((a, b) => maisRecentePrimeiro(a.maisRecente, b.maisRecente));

  return { grupos, dentroDaJanela, foraDaJanela };
}

function maisRecentePrimeiro(a: Novidade, b: Novidade): number {
  return (
    b.detectadaEm.getTime() - a.detectadaEm.getTime() ||
    b.data.getTime() - a.data.getTime()
  );
}
