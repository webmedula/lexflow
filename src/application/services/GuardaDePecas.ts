import { createHash } from 'node:crypto';
import type { MotivoNaoObtida } from '../../domain/entities/JobLeitor.js';
import type { ConversaoDaPeca, PecaEmCache } from '../../domain/entities/PastaDigital.js';
import type { ArmazemDoLeitor } from '../../domain/ports/ArmazemDoLeitor.js';
import type { Clock } from '../../domain/ports/Clock.js';
import { clockDoSistema } from '../../domain/ports/Clock.js';
import type { Logger } from '../../domain/ports/Logger.js';
import type { MontadorDePdf } from '../../domain/ports/MontadorDePdf.js';
import type { RepositorioDaPasta } from '../../domain/ports/RepositorioDaPasta.js';
import { observacoesDaConversao } from './observacoesDaConversao.js';

export interface OpcoesGuardaDePecas {
  readonly repositorio: RepositorioDaPasta;
  readonly armazem: ArmazemDoLeitor;
  readonly montador: MontadorDePdf;
  readonly logger: Logger;
  /** Prazo de guarda de cada peça, a partir de quando foi obtida. */
  readonly ttlMs: number;
  readonly clock?: Clock;
}

export type ResultadoDaGuarda =
  | { readonly ok: true; readonly entrada: PecaEmCache }
  | { readonly ok: false; readonly motivo: MotivoNaoObtida };

/** Sobra de um processo que caiu entre gravar o bruto e converter: sai depois disto. */
const IDADE_DO_TEMPORARIO_MS = 60 * 60_000;

/**
 * A guarda por peça da Pasta digital (v0.33.0, decisão do dono de 02/10/2026).
 *
 * Complementa a regra do PDF combinado (v0.30.0) com a mesma disciplina: **por
 * workspace** (o caminho em disco sai do hash do workspace e toda leitura
 * confere o dono no banco), **por prazo** (o do leitor, 24 h), **nome
 * aleatório**, **na mesma raiz do leitor** — fora do diretório servido e fora
 * do backup, e somando na MESMA cota por workspace, porque a pasta do
 * workspace é uma só.
 *
 * O arquivo guardado é sempre um PDF legível. Imagem e HTML do tribunal são
 * convertidos NA ENTRADA (o HTML vira texto, como na v0.30.0) e o original é
 * apagado na hora: HTML do tribunal não fica em disco nem chega à interface.
 * A conversão fica registrada (`conversao`, `observacao`) para a tela e o
 * índice dizerem que a peça é conversão — "convertida" sem contar o que ficou
 * de fora afirmaria mais do que entregamos.
 *
 * Esta classe NÃO fala com o tribunal. Quem decide buscar é o leitor ou a
 * `ServicoPasta`, e ambos passam pelo mesmo limitador.
 */
export class GuardaDePecas {
  private readonly repositorio: RepositorioDaPasta;
  private readonly armazem: ArmazemDoLeitor;
  private readonly montador: MontadorDePdf;
  private readonly logger: Logger;
  private readonly ttlMs: number;
  private readonly clock: Clock;

  constructor(opcoes: OpcoesGuardaDePecas) {
    this.repositorio = opcoes.repositorio;
    this.armazem = opcoes.armazem;
    this.montador = opcoes.montador;
    this.logger = opcoes.logger.child({ servico: 'guarda-de-pecas' });
    this.ttlMs = opcoes.ttlMs;
    this.clock = opcoes.clock ?? clockDoSistema;
  }

  /**
   * A pasta (no armazém) que abriga as peças de UM processo. Derivada do número
   * e com a forma que o armazém aceita para pasta de job (hexadecimal).
   */
  static pastaDoProcesso(numeroProcesso: string): string {
    return createHash('sha256')
      .update(`pasta:${numeroProcesso}`)
      .digest('hex')
      .slice(0, 32);
  }

  /**
   * A peça guardada, se ainda vale: dentro do prazo E presente no disco. Linha
   * cujo arquivo sumiu (limpeza manual, volume trocado) é apagada aqui — o
   * banco não pode afirmar que a peça está disponível quando não está.
   */
  async obter(
    workspace: string,
    numeroProcesso: string,
    pecaId: string,
  ): Promise<PecaEmCache | undefined> {
    const entrada = await this.repositorio.obterPeca(workspace, numeroProcesso, pecaId);
    return entrada ? this.conferir(entrada) : undefined;
  }

  /** As peças guardadas e válidas do processo, por id. */
  async doProcesso(
    workspace: string,
    numeroProcesso: string,
  ): Promise<Map<string, PecaEmCache>> {
    const saida = new Map<string, PecaEmCache>();
    for (const e of await this.repositorio.doProcesso(workspace, numeroProcesso)) {
      const valida = await this.conferir(e);
      if (valida) saida.set(valida.pecaId, valida);
    }
    return saida;
  }

  /** Todas as peças guardadas do workspace (para a regra de substituição). */
  doWorkspace(workspace: string): Promise<PecaEmCache[]> {
    return this.repositorio.doWorkspace(workspace);
  }

  /**
   * Guarda o que o tribunal entregou, já como PDF.
   *
   * Nunca lança por arquivo ruim: devolve o motivo. A peça vazia é tratada por
   * quem chama (tem situação própria), e aqui seria um PDF de zero byte.
   */
  async guardar(
    workspace: string,
    numeroProcesso: string,
    pecaId: string,
    conteudo: { readonly mimetype: string; readonly bytes: Uint8Array },
  ): Promise<ResultadoDaGuarda> {
    const pasta = GuardaDePecas.pastaDoProcesso(numeroProcesso);
    const tipo = conteudo.mimetype.toLowerCase();
    let conversao: ConversaoDaPeca = 'nenhuma';
    let observacao: string | undefined;
    let localizador: string;

    if (tipo.includes('pdf')) {
      localizador = await this.armazem.gravarArquivo(
        workspace,
        pasta,
        conteudo.bytes,
        'pdf',
      );
    } else if (tipo.includes('png') || tipo.includes('jpeg') || tipo.includes('jpg')) {
      const convertido = await this.converter(workspace, pasta, conteudo.bytes, (b, d) =>
        this.montador.converterImagem(b, tipo, d).then((ok) => ({ ok })),
      );
      if (!convertido.ok) return { ok: false, motivo: 'imagem_invalida' };
      localizador = convertido.localizador;
      conversao = 'imagem';
    } else if (tipo.includes('html')) {
      let nota: string | undefined;
      const convertido = await this.converter(workspace, pasta, conteudo.bytes, (b, d) =>
        this.montador.converterHtml(b, d).then((c) => {
          nota = observacoesDaConversao(c);
          return { ok: c.ok };
        }),
      );
      if (!convertido.ok) return { ok: false, motivo: 'html_invalido' };
      localizador = convertido.localizador;
      conversao = 'html';
      observacao = nota;
    } else {
      return { ok: false, motivo: 'formato_nao_suportado' };
    }

    const caminho = await this.armazem.caminhoLocal(workspace, localizador);
    const inspecao = await this.montador.inspecionarPdf(caminho);
    if (!inspecao.valido) {
      await this.armazem.apagarArquivo(workspace, localizador);
      return { ok: false, motivo: inspecao.motivo };
    }

    const tamanho = (await this.armazem.tamanho(workspace, localizador)) ?? 0;
    const agora = this.clock.agora();
    const anterior = await this.repositorio.obterPeca(workspace, numeroProcesso, pecaId);
    const entrada: PecaEmCache = {
      workspace,
      numeroProcesso,
      pecaId,
      localizador,
      mimetypeOriginal: conteudo.mimetype,
      conversao,
      ...(observacao !== undefined ? { observacao } : {}),
      bytes: tamanho,
      paginas: inspecao.paginas,
      obtidaEm: agora,
      expiraEm: new Date(agora.getTime() + this.ttlMs),
    };
    await this.repositorio.guardarPeca(entrada);
    // Substituição da mesma peça: o arquivo antigo não fica órfão ocupando cota.
    if (anterior && anterior.localizador !== localizador) {
      await this.armazem.apagarArquivo(workspace, anterior.localizador);
    }
    return { ok: true, entrada };
  }

  /** Apaga o arquivo e a linha de uma peça. @returns bytes liberados. */
  async remover(entrada: PecaEmCache): Promise<number> {
    const bytes = await this.armazem.apagarArquivo(
      entrada.workspace,
      entrada.localizador,
    );
    await this.repositorio.apagarPeca(
      entrada.workspace,
      entrada.numeroProcesso,
      entrada.pecaId,
    );
    return bytes;
  }

  /**
   * A limpeza pelo prazo (a cada hora, pelo `Agendador`). `emUso` são os
   * localizadores de que uma combinação em andamento ainda vai copiar páginas:
   * apagar agora transformaria peças já baixadas em páginas de aviso; ficam
   * para a próxima limpeza.
   */
  async limparVencidas(
    emUso: (workspace: string) => Promise<ReadonlySet<string>>,
  ): Promise<{ readonly apagadas: number; readonly bytes: number }> {
    let apagadas = 0;
    let bytes = 0;
    const usoPorWorkspace = new Map<string, ReadonlySet<string>>();
    for (const e of await this.repositorio.vencidas(this.clock.agora())) {
      let uso = usoPorWorkspace.get(e.workspace);
      if (!uso) {
        uso = await emUso(e.workspace);
        usoPorWorkspace.set(e.workspace, uso);
      }
      if (uso.has(e.localizador)) continue;
      bytes += await this.remover(e);
      apagadas += 1;
    }
    const temporarios = await this.armazem.removerTemporarios(IDADE_DO_TEMPORARIO_MS);
    if (apagadas > 0 || temporarios > 0) {
      this.logger.info('pasta digital: peças apagadas pelo prazo', {
        apagadas,
        bytes,
        temporarios,
      });
    }
    return { apagadas, bytes };
  }

  /** Exclusão de conta: as linhas. Os arquivos saem com a pasta do workspace. */
  apagarDoWorkspace(workspace: string): Promise<number> {
    return this.repositorio.apagarDoWorkspace(workspace);
  }

  private async conferir(entrada: PecaEmCache): Promise<PecaEmCache | undefined> {
    if (entrada.expiraEm.getTime() <= this.clock.agora().getTime()) return undefined;
    const tamanho = await this.armazem.tamanho(entrada.workspace, entrada.localizador);
    if (tamanho === undefined) {
      await this.repositorio.apagarPeca(
        entrada.workspace,
        entrada.numeroProcesso,
        entrada.pecaId,
      );
      return undefined;
    }
    return entrada;
  }

  /**
   * Grava o bruto em arquivo temporário, converte para um PDF novo e apaga o
   * bruto — com sucesso ou sem. O `.tmp` é o marcador que a varredura de
   * sobras reconhece.
   */
  private async converter(
    workspace: string,
    pasta: string,
    bytes: Uint8Array,
    converter: (bruto: string, destino: string) => Promise<{ ok: boolean }>,
  ): Promise<{ ok: true; localizador: string } | { ok: false }> {
    const bruto = await this.armazem.gravarArquivo(workspace, pasta, bytes, 'tmp');
    const destinoLocalizador = this.armazem.novoArquivo(workspace, pasta, 'pdf');
    try {
      const caminhoBruto = await this.armazem.caminhoLocal(workspace, bruto);
      const destino = await this.armazem.caminhoLocal(workspace, destinoLocalizador);
      const r = await converter(caminhoBruto, destino);
      if (!r.ok) {
        await this.armazem.apagarArquivo(workspace, destinoLocalizador);
        return { ok: false };
      }
      return { ok: true, localizador: destinoLocalizador };
    } finally {
      await this.armazem.apagarArquivo(workspace, bruto);
    }
  }
}
