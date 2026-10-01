import { NumeroCNJ } from '../../domain/entities/NumeroCNJ.js';
import type { Peca } from '../../domain/entities/Peca.js';
import { montarIndice } from '../../domain/entities/IndicePagina.js';
import type { EntradaIndice, ItemDoIndice } from '../../domain/entities/IndicePagina.js';
import {
  DESCRICAO_DO_MOTIVO,
  ESTADOS_COM_ARQUIVO,
  estimarSegundos,
  proximoTamanhoDeLote,
} from '../../domain/entities/JobLeitor.js';
import type {
  JobLeitor,
  MotivoNaoObtida,
  PecaDoJob,
  PoliticaDeLote,
} from '../../domain/entities/JobLeitor.js';
import {
  CredencialTribunalAusenteError,
  CredencialTribunalInvalidaError,
  DomainError,
  JobDoLeitorNaoEncontradoError,
  LeitorAindaNaoProntoError,
  LimiteDeArmazenamentoExcedidoError,
  MniBloqueadoError,
  OperacaoNaoSuportadaError,
  SegredoDeJusticaNaoGuardadoError,
} from '../../domain/errors/index.js';
import type { ArmazemDoLeitor } from '../../domain/ports/ArmazemDoLeitor.js';
import type { Clock } from '../../domain/ports/Clock.js';
import { clockDoSistema } from '../../domain/ports/Clock.js';
import type { FilaDeJobs } from '../../domain/ports/FilaDeJobs.js';
import type { Logger } from '../../domain/ports/Logger.js';
import type {
  MontadorDePdf,
  PaginaDeAviso,
  ParteDoPdf,
} from '../../domain/ports/MontadorDePdf.js';
import type {
  CredencialTribunal,
  LoteDePecas,
  ProvedorDePecas,
} from '../../domain/ports/ProvedorDePecas.js';
import type { RepositorioCredenciais } from '../../domain/ports/RepositorioCredenciais.js';
import type { BuscarProcessoPorNumero } from '../../domain/usecases/BuscarProcessoPorNumero.js';

export interface ConfiguracaoLeitor extends PoliticaDeLote {
  /**
   * Pausa mínima entre duas consultas do leitor ao tribunal. 3 s foi o ritmo
   * da sonda de lote, sem nenhum 403. Soma-se ao balde do adapter, nunca o
   * substitui: o balde é o teto do IP, a pausa é a educação do job.
   */
  readonly pausaEntreChamadasMs: number;
  /** Prazo de guarda do PDF combinado, a partir de quando fica pronto. */
  readonly ttlMs: number;
  readonly cotaPorPdfBytes: number;
  readonly cotaPorWorkspaceBytes: number;
  /** Uso total de disco acima disto vira aviso no log. */
  readonly avisoDiscoBytes: number;
  /** Pior latência medida por chamada (s), para a estimativa mostrada. */
  readonly segundosPorChamada: number;
}

export interface OpcoesServicoLeitor {
  readonly provedor: ProvedorDePecas;
  readonly credenciais: RepositorioCredenciais;
  readonly fila: FilaDeJobs;
  readonly armazem: ArmazemDoLeitor;
  readonly montador: MontadorDePdf;
  readonly logger: Logger;
  readonly config: ConfiguracaoLeitor;
  /**
   * Identificador NÃO reversível da credencial, para a procedência. Vem de
   * fora porque é derivado com a chave do servidor — sem ela, oito hex de um
   * hash de CPF seriam reversíveis por força bruta.
   */
  readonly identificarCredencial: (
    workspace: string,
    credencial: CredencialTribunal,
  ) => string;
  /** Fontes públicas, para recusar cedo processo em segredo de justiça. */
  readonly processos?: BuscarProcessoPorNumero;
  readonly clock?: Clock;
  readonly esperar?: (ms: number) => Promise<void>;
  readonly gerarId: () => string;
  /** Chamado depois de enfileirar: o composition root acorda o executor. */
  readonly aoEnfileirar?: () => void;
}

/** O PDF combinado pronto para ser lido por trechos. */
export interface PdfDoLeitor {
  readonly job: JobLeitor;
  readonly tamanho: number;
  readonly nomeArquivo: string;
  ler(inicio: number, fim: number): AsyncIterable<Uint8Array>;
}

/** Peça sendo levada à montagem: ou é um intervalo de arquivo, ou um aviso. */
type Destino =
  | { readonly tipo: 'arquivo'; readonly parte: ParteDoPdf }
  | { readonly tipo: 'aviso'; readonly aviso: PaginaDeAviso };

/**
 * O leitor de peças: marcar peças, baixar em lote do tribunal e entregar UM
 * PDF com índice de páginas.
 *
 * **Um único limitador.** Este serviço não tem balde de requisições. Todas as
 * consultas passam pelo `ProvedorDePecas`, cujo balde (o do `MniAdapter`) é o
 * mesmo da peça avulsa e da régua do processo. Um segundo balde aqui somaria
 * acima do teto relatado do tribunal (~50/min) — e o bloqueio é do IP, de
 * todos os assinantes. O que existe aqui é só a PAUSA entre chamadas do job.
 *
 * **Sem retry.** Cada chamada carrega a senha do advogado. Credencial
 * recusada, bloqueio, `sucesso: false`, timeout: o job para e entrega o que
 * tem como `parcial`. A única repetição é a peça AUSENTE numa resposta que deu
 * certo, pedida uma vez sozinha no fim — não é insistência contra recusa, é
 * conferir uma omissão.
 */
export class ServicoLeitor {
  private readonly provedor: ProvedorDePecas;
  private readonly credenciais: RepositorioCredenciais;
  private readonly fila: FilaDeJobs;
  private readonly armazem: ArmazemDoLeitor;
  private readonly montador: MontadorDePdf;
  private readonly logger: Logger;
  private readonly config: ConfiguracaoLeitor;
  private readonly identificarCredencial: OpcoesServicoLeitor['identificarCredencial'];
  private readonly processos: BuscarProcessoPorNumero | undefined;
  private readonly clock: Clock;
  private readonly esperar: (ms: number) => Promise<void>;
  private readonly gerarId: () => string;
  private readonly aoEnfileirar: (() => void) | undefined;

  private ultimaChamada: number | undefined;
  private rodando: Promise<number> | undefined;

  constructor(opcoes: OpcoesServicoLeitor) {
    this.provedor = opcoes.provedor;
    this.credenciais = opcoes.credenciais;
    this.fila = opcoes.fila;
    this.armazem = opcoes.armazem;
    this.montador = opcoes.montador;
    this.logger = opcoes.logger.child({ servico: 'leitor' });
    this.config = opcoes.config;
    this.identificarCredencial = opcoes.identificarCredencial;
    this.processos = opcoes.processos;
    this.clock = opcoes.clock ?? clockDoSistema;
    this.esperar =
      opcoes.esperar ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.gerarId = opcoes.gerarId;
    this.aoEnfileirar = opcoes.aoEnfileirar;
  }

  /** Ordem de grandeza do tempo, com os números medidos. Ver `estimarSegundos`. */
  estimarSegundos(pecas: number): number {
    return estimarSegundos(pecas, {
      tamanhoLote: this.config.inicial,
      segundosPorChamada: this.config.segundosPorChamada,
      pausaSegundos: this.config.pausaEntreChamadasMs / 1000,
    });
  }

  /**
   * Enfileira um pedido. NÃO consulta o tribunal: a listagem, a assinatura de
   * mudança e os lotes acontecem no executor, que respeita disjuntor e pausa.
   * Uma rota HTTP que esperasse o tribunal ficaria pendurada minutos.
   *
   * @throws {NumeroCNJInvalidoError | OperacaoNaoSuportadaError}
   * @throws {CredencialTribunalAusenteError | CredencialTribunalInvalidaError}
   * @throws {LimiteDeArmazenamentoExcedidoError | SegredoDeJusticaNaoGuardadoError}
   */
  async criar(
    workspace: string,
    numeroProcesso: string,
    idsPecas: readonly string[],
  ): Promise<JobLeitor> {
    const { numero, tribunal, credencial } = await this.preparar(
      workspace,
      numeroProcesso,
    );

    const uso = await this.armazem.usoDoWorkspace(workspace);
    if (uso >= this.config.cotaPorWorkspaceBytes) {
      throw new LimiteDeArmazenamentoExcedidoError(
        'workspace',
        this.config.cotaPorWorkspaceBytes,
      );
    }
    await this.recusarSegredoPelasFontesPublicas(numero);

    const agora = this.clock.agora();
    const job: JobLeitor = {
      id: this.gerarId(),
      workspace,
      numeroProcesso: numero,
      tribunal,
      credencial: this.identificarCredencial(workspace, credencial),
      estado: 'na_fila',
      pedidas: [...new Set(idsPecas)],
      pecas: [],
      tamanhoLote: this.config.inicial,
      loteTravado: false,
      chamadas: 0,
      bytesRecebidos: 0,
      criadoEm: agora,
      atualizadoEm: agora,
    };
    await this.fila.criar(job);
    this.logger.info('combinação enfileirada', {
      workspace,
      job: job.id,
      pecas: job.pedidas.length,
    });
    this.aoEnfileirar?.();
    return job;
  }

  /**
   * "Atualizar": baixa só o que não está no PDF anterior.
   *
   * Primeiro o atalho barato: `consultarAlteracao` devolve o hash dos
   * documentos. Igual ao da listagem anterior → nada mudou, nenhum lote sai.
   * Diferente → um job novo, que reaproveita as páginas do PDF anterior e pede
   * ao tribunal apenas as peças novas e as que tinham faltado.
   */
  async atualizar(
    workspace: string,
    numeroProcesso: string,
    jobId: string,
  ): Promise<{ readonly job: JobLeitor; readonly semMudanca: boolean }> {
    const anterior = await this.consultar(workspace, numeroProcesso, jobId);
    if (!ESTADOS_COM_ARQUIVO.includes(anterior.estado) || !anterior.arquivo) {
      throw new LeitorAindaNaoProntoError(anterior.estado);
    }
    const { numero, credencial } = await this.preparar(workspace, numeroProcesso);

    const assinar = this.provedor.assinaturaDeMudanca?.bind(this.provedor);
    if (assinar && anterior.hashDocumentos) {
      const assinatura = await this.chamada(() => assinar(numero, credencial));
      if (assinatura.documentos === anterior.hashDocumentos) {
        return { job: anterior, semMudanca: true };
      }
    }

    const agora = this.clock.agora();
    const job: JobLeitor = {
      id: this.gerarId(),
      workspace,
      numeroProcesso: numero,
      tribunal: anterior.tribunal,
      credencial: this.identificarCredencial(workspace, credencial),
      estado: 'na_fila',
      pedidas: anterior.pedidas,
      pecas: [],
      tamanhoLote: this.config.inicial,
      loteTravado: false,
      chamadas: 0,
      bytesRecebidos: 0,
      criadoEm: agora,
      atualizadoEm: agora,
      atualizaDe: anterior.id,
    };
    await this.fila.criar(job);
    this.aoEnfileirar?.();
    return { job, semMudanca: false };
  }

  /**
   * O job, se for DESTE workspace e DESTE processo.
   *
   * O número entra na conferência porque a URL o carrega: um id válido com o
   * número de outro processo responde "não encontrado", e não o job — senão a
   * tela de um processo poderia exibir o PDF de outro.
   */
  async consultar(
    workspace: string,
    numeroProcesso: string,
    jobId: string,
  ): Promise<JobLeitor> {
    const numero = NumeroCNJ.criar(numeroProcesso).digitos;
    const job = /^[a-f0-9]{16,64}$/.test(jobId)
      ? await this.fila.obter(workspace, jobId)
      : undefined;
    if (!job || job.numeroProcesso !== numero || job.workspace !== workspace) {
      throw new JobDoLeitorNaoEncontradoError(jobId);
    }
    return job;
  }

  async indice(
    workspace: string,
    numeroProcesso: string,
    jobId: string,
  ): Promise<{ readonly job: JobLeitor; readonly indice: readonly EntradaIndice[] }> {
    const job = await this.consultar(workspace, numeroProcesso, jobId);
    if (!ESTADOS_COM_ARQUIVO.includes(job.estado) || !job.indice) {
      throw new LeitorAindaNaoProntoError(job.estado);
    }
    return { job, indice: job.indice };
  }

  async abrirPdf(
    workspace: string,
    numeroProcesso: string,
    jobId: string,
  ): Promise<PdfDoLeitor> {
    const job = await this.consultar(workspace, numeroProcesso, jobId);
    const arquivo = job.arquivo;
    if (!ESTADOS_COM_ARQUIVO.includes(job.estado) || !arquivo) {
      throw new LeitorAindaNaoProntoError(job.estado);
    }
    // O dono foi conferido no banco; o armazém confere de novo pelo caminho.
    const tamanho = await this.armazem.tamanho(workspace, arquivo.localizador);
    if (tamanho === undefined) throw new JobDoLeitorNaoEncontradoError(jobId);
    return {
      job,
      tamanho,
      nomeArquivo: `processo-${job.numeroProcesso}-pecas.pdf`,
      ler: (inicio, fim) => this.armazem.ler(workspace, arquivo.localizador, inicio, fim),
    };
  }

  /**
   * Roda a fila até esvaziar. Chamadas concorrentes na mesma instância
   * recebem a mesma promessa.
   *
   * **Um job por vez em TODO o processo**, não só por credencial (decisão do
   * dono, 01/10/2026). O motivo é memória: cada lote segura a resposta inteira
   * do tribunal (pico ≈ 3 × resposta + 30 MB, ver
   * `docs/leitor-medicoes-v0.30.0.md`), e dois jobs de credenciais diferentes
   * em paralelo SOMARIAM os picos. Também não se perde vazão: o balde do MNI é
   * global, e dois jobs juntos dividiriam as mesmas fichas.
   *
   * A trava é do MÓDULO (`execucaoDoProcesso`), e não da instância: uma
   * segunda instância de `ServicoLeitor` — por engano no composition root, ou
   * num script — espera a primeira terminar em vez de correr ao lado dela.
   */
  processarFila(): Promise<number> {
    if (!this.rodando) {
      const minha = execucaoDoProcesso.then(() => this.drenar());
      execucaoDoProcesso = minha.catch(() => undefined);
      this.rodando = minha.finally(() => {
        this.rodando = undefined;
      });
    }
    return this.rodando;
  }

  /** Apaga o que passou do prazo de guarda e registra o uso de disco. */
  async limparExpirados(): Promise<{
    readonly apagados: number;
    readonly bytes: number;
  }> {
    const agora = this.clock.agora();
    let apagados = 0;
    let bytes = 0;
    for (const job of await this.fila.expirados(agora)) {
      bytes += await this.armazem.apagarJob(job.workspace, job.id);
      await this.fila.salvar(
        semArquivo({
          ...job,
          estado: 'expirado',
          mensagem: 'O PDF combinado foi apagado ao fim do prazo de guarda.',
          atualizadoEm: agora,
        }),
      );
      apagados += 1;
    }
    if (apagados > 0)
      this.logger.info('PDFs do leitor apagados pelo prazo', { apagados, bytes });
    await this.registrarUsoDeDisco();
    return { apagados, bytes };
  }

  /** Exclusão de conta: arquivos e jobs do workspace. */
  async apagarDoWorkspace(workspace: string): Promise<void> {
    const bytes = await this.armazem.apagarWorkspace(workspace);
    const jobs = await this.fila.apagarDoWorkspace(workspace);
    this.logger.info('leitor: dados do workspace apagados', { workspace, jobs, bytes });
  }

  // ---------------------------------------------------------------------------

  private async drenar(): Promise<number> {
    let executados = 0;
    for (;;) {
      const job = await this.fila.proximoParaExecutar(this.clock.agora());
      if (!job) return executados;
      await this.executar(job);
      executados += 1;
    }
  }

  private async preparar(
    workspace: string,
    numeroProcesso: string,
  ): Promise<{ numero: string; tribunal: string; credencial: CredencialTribunal }> {
    const cnj = NumeroCNJ.criar(numeroProcesso);
    const tribunal = cnj.siglaTribunal;
    const atende =
      tribunal !== null &&
      (this.provedor.tribunais.includes('*') ||
        this.provedor.tribunais.includes(tribunal));
    if (!atende || !this.provedor.obterConteudosEmLote) {
      throw new OperacaoNaoSuportadaError(
        this.provedor.nome,
        'obterConteudosEmLote',
        `nenhuma fonte de peças combina documentos de ${tribunal ?? 'este tribunal'}`,
      );
    }
    const credencial = await this.credenciais.obter(workspace, tribunal);
    if (!credencial) throw new CredencialTribunalAusenteError(tribunal);

    // Credencial já recusada não sai daqui para o tribunal. Um job em segundo
    // plano com senha velha seria uma recusa a mais contra a conta do
    // advogado, sem ninguém olhando — o caminho mais curto para o bloqueio.
    const cadastrada = (await this.credenciais.listar(workspace)).find(
      (c) => c.tribunal === tribunal,
    );
    if (cadastrada?.recusadaEm) {
      throw new CredencialTribunalInvalidaError(
        this.provedor.nome,
        'o tribunal recusou esta credencial na última consulta',
      );
    }
    return { numero: cnj.digitos, tribunal, credencial };
  }

  /** Melhor esforço: as fontes públicas podem não responder, e o MNI confere depois. */
  private async recusarSegredoPelasFontesPublicas(numero: string): Promise<void> {
    if (!this.processos) return;
    let segredo = false;
    try {
      segredo = (await this.processos.executar({ numeroProcesso: numero }))
        .segredoJustica;
    } catch {
      return;
    }
    if (segredo) throw new SegredoDeJusticaNaoGuardadoError(numero);
  }

  /** Toda consulta do leitor ao tribunal passa aqui: é onde mora a pausa. */
  private async chamada<T>(operacao: () => Promise<T>): Promise<T> {
    if (this.ultimaChamada !== undefined) {
      const falta =
        this.config.pausaEntreChamadasMs - (this.clock.monotonico() - this.ultimaChamada);
      if (falta > 0) await this.esperar(falta);
    }
    try {
      return await operacao();
    } finally {
      this.ultimaChamada = this.clock.monotonico();
    }
  }

  private async executar(inicial: JobLeitor): Promise<void> {
    let job = inicial;
    /** `recomecar` tira a retomada e a mensagem de uma pausa anterior. */
    const gravar = async (
      mudancas: Partial<JobLeitor>,
      recomecar = false,
    ): Promise<void> => {
      const base = recomecar ? semRetomada(job) : job;
      job = { ...base, ...mudancas, atualizadoEm: this.clock.agora() };
      await this.fila.salvar(job);
    };
    const log = this.logger.child({ job: job.id, workspace: job.workspace });

    try {
      const credencial = await this.credenciais.obter(job.workspace, job.tribunal);
      if (!credencial) {
        await gravar({
          estado: 'falhou',
          mensagem: new CredencialTribunalAusenteError(job.tribunal).message,
          concluidoEm: this.clock.agora(),
        });
        return;
      }
      await gravar({ estado: 'baixando' }, true);

      if (job.pecas.length === 0) {
        const listado = await this.listar(job, credencial);
        if (listado === 'segredo') {
          await gravar({
            estado: 'falhou',
            mensagem: new SegredoDeJusticaNaoGuardadoError(job.numeroProcesso).message,
            concluidoEm: this.clock.agora(),
          });
          return;
        }
        await gravar(listado);
        await this.credenciais.registrarUso(job.workspace, job.tribunal);
      }

      const interrupcao = await this.baixar(() => job, gravar, credencial);
      if (interrupcao) {
        log.warn('combinação interrompida; entregando o que veio', {
          motivo: interrupcao.motivo,
        });
        await gravar({
          pecas: job.pecas.map((p) =>
            p.situacao === 'pendente' || p.situacao === 'repetir'
              ? { ...p, situacao: 'nao_obtida' as const, motivo: interrupcao.motivo }
              : p,
          ),
          mensagem: interrupcao.mensagem,
        });
      }

      await this.montar(() => job, gravar, log);
    } catch (erro) {
      if (erro instanceof MniBloqueadoError) {
        // Não é falha do job: ele espera a pausa e continua de onde parou.
        await gravar({
          estado: 'pausado_por_bloqueio',
          retomarEm: erro.retomarEm,
          mensagem:
            'O tribunal bloqueou temporariamente as consultas deste servidor. ' +
            'A combinação continua sozinha depois da pausa.',
        });
        return;
      }
      if (erro instanceof CredencialTribunalInvalidaError) {
        await this.credenciais.registrarRecusa(job.workspace, job.tribunal);
      }
      // Falha antes de haver peça listada (ou na montagem): não há o que
      // entregar. Mensagem de erro de domínio é feita para a pessoa ler; a de
      // qualquer outro erro pode carregar caminho interno, e fica no log.
      log.error('combinação falhou', {
        erro: erro instanceof Error ? erro.message : String(erro),
      });
      await gravar({
        estado: 'falhou',
        mensagem:
          erro instanceof DomainError
            ? erro.message
            : 'Erro interno ao montar o PDF combinado.',
        concluidoEm: this.clock.agora(),
      });
      await this.armazem.apagarJob(job.workspace, job.id).catch(() => 0);
    }
  }

  /** A listagem do tribunal define a ordem dos autos e o que existe. */
  private async listar(
    job: JobLeitor,
    credencial: CredencialTribunal,
  ): Promise<Partial<JobLeitor> | 'segredo'> {
    const provedor = this.provedor;
    const atos = await this.chamada(() =>
      provedor.listarAtos
        ? provedor.listarAtos(job.numeroProcesso, credencial)
        : provedor.listarPecas(job.numeroProcesso, credencial).then((pecas) => ({
            pecas,
            movimentos: [],
          })),
    );
    if ((atos.nivelSigiloDoProcesso ?? 0) > 0) return 'segredo';

    const todas = achatar(atos.pecas);
    const idsListados = todas.map((p) => p.id);

    // Atualização: o que o PDF anterior já tem não se baixa de novo, e as
    // peças que surgiram desde a listagem anterior entram na seleção.
    const anterior = job.atualizaDe
      ? await this.fila.obter(job.workspace, job.atualizaDe)
      : undefined;
    const arquivoAnterior =
      anterior?.arquivo &&
      (await this.armazem.tamanho(job.workspace, anterior.arquivo.localizador)) !==
        undefined
        ? anterior.arquivo
        : undefined;
    const jaListados = new Set(anterior?.idsListados ?? []);
    const novas = anterior ? idsListados.filter((id) => !jaListados.has(id)) : [];
    const pedidas = [...new Set([...job.pedidas, ...novas])];
    const noIndiceAnterior = new Map(
      (arquivoAnterior ? (anterior?.indice ?? []) : []).map((e) => [e.pecaId, e]),
    );

    const querida = new Set(pedidas);
    const pecas: PecaDoJob[] = [];
    for (const p of todas) {
      if (!querida.has(p.id)) continue;
      const base = pecaDoJob(p, pecas.length);
      const reaproveitavel = noIndiceAnterior.get(p.id);
      if (p.sigilosa) {
        pecas.push({ ...base, situacao: 'nao_obtida', motivo: 'sigilosa' });
      } else if (
        reaproveitavel &&
        (reaproveitavel.situacao === 'incorporada' ||
          reaproveitavel.situacao === 'convertida')
      ) {
        pecas.push({
          ...base,
          situacao: 'obtida',
          reaproveitada: {
            paginaInicial: reaproveitavel.paginaInicial,
            paginaFinal: reaproveitavel.paginaFinal,
            situacao: reaproveitavel.situacao,
          },
        });
      } else {
        pecas.push(base);
      }
      querida.delete(p.id);
    }
    // Pedida e não listada: o tribunal não a mostra mais. Fica no índice, no
    // fim, com o motivo — nunca some.
    for (const id of pedidas) {
      if (!querida.has(id)) continue;
      pecas.push({
        pecaId: id,
        ordem: pecas.length,
        rotulo: `peça ${id}`,
        situacao: 'nao_obtida',
        motivo: 'nao_listada',
      });
    }

    let hashDocumentos: string | undefined;
    const assinar = provedor.assinaturaDeMudanca?.bind(provedor);
    if (assinar) {
      try {
        hashDocumentos = (
          await this.chamada(() => assinar(job.numeroProcesso, credencial))
        ).documentos;
      } catch (erro) {
        // Sem o hash, "atualizar" só perde o atalho e lista de novo. Bloqueio
        // e recusa, porém, valem para o job inteiro.
        if (
          erro instanceof MniBloqueadoError ||
          erro instanceof CredencialTribunalInvalidaError
        ) {
          throw erro;
        }
      }
    }

    return {
      pecas,
      pedidas,
      idsListados,
      ...(hashDocumentos ? { hashDocumentos } : {}),
    };
  }

  /**
   * Os lotes. Devolve a interrupção, quando houve; `MniBloqueadoError` sobe
   * para o chamador pausar o job.
   */
  private async baixar(
    atual: () => JobLeitor,
    gravar: (m: Partial<JobLeitor>) => Promise<void>,
    credencial: CredencialTribunal,
  ): Promise<{ motivo: MotivoNaoObtida; mensagem: string } | undefined> {
    const provedor = this.provedor;
    const lote = provedor.obterConteudosEmLote?.bind(provedor);
    if (!lote) throw new OperacaoNaoSuportadaError(provedor.nome, 'obterConteudosEmLote');

    const job0 = atual();
    const usoInicial = await this.armazem.usoDoWorkspace(job0.workspace);
    let novosBytes = 0;

    type Resultado =
      | { readonly ok: true; readonly r: LoteDePecas }
      | {
          readonly ok: false;
          readonly motivo: MotivoNaoObtida;
          readonly mensagem: string;
        };
    const pedir = async (ids: readonly string[]): Promise<Resultado> => {
      try {
        return {
          ok: true as const,
          r: await this.chamada(() => lote(job0.numeroProcesso, ids, credencial)),
        };
      } catch (erro) {
        if (erro instanceof MniBloqueadoError) throw erro;
        if (erro instanceof CredencialTribunalInvalidaError) {
          await this.credenciais.registrarRecusa(job0.workspace, job0.tribunal);
          return {
            ok: false as const,
            motivo: 'credencial_recusada' as const,
            mensagem: erro.message,
          };
        }
        return {
          ok: false as const,
          motivo: 'interrompido' as const,
          mensagem:
            erro instanceof DomainError
              ? erro.message
              : 'Falha inesperada ao consultar o tribunal.',
        };
      }
    };

    const registrar = async (
      ids: readonly string[],
      r: LoteDePecas,
      fase: 'lote' | 'isolada',
    ): Promise<readonly string[]> => {
      const job = atual();
      const porId = new Map(job.pecas.map((p) => [p.pecaId, p]));
      const semTeor = new Set(r.semTeor);
      const atualizadas = new Map<string, PecaDoJob>();
      for (const c of r.conteudos) {
        const p = porId.get(c.id);
        if (!p) continue;
        if (c.bytes.length === 0) {
          atualizadas.set(p.pecaId, {
            ...p,
            situacao: 'vazia',
            mimetype: c.mimetype,
            bytes: 0,
          });
          continue;
        }
        const arquivo = await this.armazem.gravarPeca(
          job.workspace,
          job.id,
          p.ordem,
          c.bytes,
        );
        novosBytes += c.bytes.length;
        atualizadas.set(p.pecaId, {
          ...semMotivo(p),
          situacao: 'obtida',
          mimetype: c.mimetype,
          bytes: c.bytes.length,
          arquivo,
        });
      }
      for (const id of ids) {
        const p = porId.get(id);
        if (!p || atualizadas.has(id)) continue;
        // Nem arquivo nem "sem teor": o tribunal omitiu a peça. No lote ela
        // ganha a segunda chance sozinha; sozinha, não ganha terceira.
        if (semTeor.has(id)) {
          atualizadas.set(id, { ...p, situacao: 'nao_obtida', motivo: 'sem_teor' });
        } else {
          atualizadas.set(
            id,
            fase === 'lote'
              ? { ...p, situacao: 'repetir' }
              : { ...p, situacao: 'nao_obtida', motivo: 'ausente_no_lote' },
          );
        }
      }
      const proximo = proximoTamanhoDeLote(
        job.tamanhoLote,
        job.loteTravado,
        { bytes: r.bytesResposta, houveAusencia: r.ausentes.length > 0 },
        this.config,
      );
      await gravar({
        pecas: job.pecas.map((p) => atualizadas.get(p.pecaId) ?? p),
        chamadas: job.chamadas + 1,
        bytesRecebidos: job.bytesRecebidos + r.bytesResposta,
        ...(fase === 'lote'
          ? { tamanhoLote: proximo.tamanho, loteTravado: proximo.travado }
          : {}),
      });
      return r.conteudos.map((c) => c.id);
    };

    // O lote que estoura a cota é descartado inteiro — as peças anteriores
    // cabiam, e manter as deste levaria o PDF acima do limite na montagem.
    const descartar = async (
      ids: readonly string[],
      motivo: MotivoNaoObtida,
    ): Promise<void> => {
      const alvo = new Set(ids);
      await gravar({
        pecas: atual().pecas.map((p) =>
          alvo.has(p.pecaId) && p.situacao === 'obtida'
            ? { ...semArquivoDaPeca(p), situacao: 'nao_obtida' as const, motivo }
            : p,
        ),
      });
    };

    const estourouCota = ():
      { motivo: MotivoNaoObtida; mensagem: string } | undefined => {
      const doJob = atual().pecas.reduce((s, p) => s + (p.bytes ?? 0), 0);
      if (doJob > this.config.cotaPorPdfBytes) {
        return {
          motivo: 'cota_do_pdf',
          mensagem: new LimiteDeArmazenamentoExcedidoError(
            'pdf',
            this.config.cotaPorPdfBytes,
          ).message,
        };
      }
      if (usoInicial + novosBytes > this.config.cotaPorWorkspaceBytes) {
        return {
          motivo: 'cota_do_workspace',
          mensagem: new LimiteDeArmazenamentoExcedidoError(
            'workspace',
            this.config.cotaPorWorkspaceBytes,
          ).message,
        };
      }
      return undefined;
    };

    // Fase 1: lotes, na ordem dos autos.
    for (;;) {
      const job = atual();
      const ids = job.pecas
        .filter((p) => p.situacao === 'pendente')
        .slice(0, job.tamanhoLote)
        .map((p) => p.pecaId);
      if (ids.length === 0) break;
      const resultado = await pedir(ids);
      if (!resultado.ok) return resultado;
      const obtidas = await registrar(ids, resultado.r, 'lote');
      const cota = estourouCota();
      if (cota) {
        await descartar(obtidas, cota.motivo);
        return cota;
      }
    }

    // Fase 2: cada ausente, uma vez, sozinha.
    for (;;) {
      const p = atual().pecas.find((x) => x.situacao === 'repetir');
      if (!p) break;
      const resultado = await pedir([p.pecaId]);
      if (!resultado.ok) return resultado;
      const obtidas = await registrar([p.pecaId], resultado.r, 'isolada');
      const cota = estourouCota();
      if (cota) {
        await descartar(obtidas, cota.motivo);
        return cota;
      }
    }
    return undefined;
  }

  private async montar(
    atual: () => JobLeitor,
    gravar: (m: Partial<JobLeitor>) => Promise<void>,
    log: Logger,
  ): Promise<void> {
    await gravar({ estado: 'montando' });
    const job = atual();
    const ws = job.workspace;

    const anterior = job.atualizaDe
      ? await this.fila.obter(ws, job.atualizaDe)
      : undefined;
    const caminhoAnterior = anterior?.arquivo
      ? await this.armazem.caminhoLocal(ws, anterior.arquivo.localizador)
      : undefined;

    const destinos: Destino[] = [];
    const itens: Array<Omit<ItemDoIndice, 'paginas'>> = [];
    const aviso = (p: PecaDoJob, motivo: MotivoNaoObtida): PaginaDeAviso => ({
      titulo: `Peça não incorporada: ${p.rotulo}`,
      linhas: [
        `Identificador no tribunal: ${p.pecaId}${p.movimento !== undefined ? ` · movimento ${p.movimento}` : ''}.`,
        `Motivo: ${DESCRICAO_DO_MOTIVO[motivo]}.`,
        'Esta página ocupa o lugar da peça para que nada desapareça do índice.',
      ],
    });
    const naoIncorporada = (p: PecaDoJob, motivo: MotivoNaoObtida): void => {
      const html = motivo === 'html_aguardando_estrategia';
      destinos.push({ tipo: 'aviso', aviso: aviso(p, motivo) });
      itens.push(
        itemDe(
          p,
          html ? 'html_nao_incorporada' : 'nao_obtida',
          DESCRICAO_DO_MOTIVO[motivo],
        ),
      );
    };

    for (const p of [...job.pecas].sort((a, b) => a.ordem - b.ordem)) {
      if (p.reaproveitada && caminhoAnterior) {
        destinos.push({
          tipo: 'arquivo',
          parte: {
            arquivo: caminhoAnterior,
            paginas: [p.reaproveitada.paginaInicial, p.reaproveitada.paginaFinal],
          },
        });
        itens.push(itemDe(p, p.reaproveitada.situacao));
        continue;
      }
      if (p.situacao === 'vazia') {
        naoIncorporada(p, 'vazia');
        continue;
      }
      if (p.situacao !== 'obtida' || !p.arquivo) {
        naoIncorporada(p, p.motivo ?? 'interrompido');
        continue;
      }
      const caminho = await this.armazem.caminhoLocal(ws, p.arquivo);
      const tipo = (p.mimetype ?? '').toLowerCase();
      if (tipo.includes('pdf')) {
        const inspecao = await this.montador.inspecionarPdf(caminho);
        if (inspecao.valido) {
          destinos.push({ tipo: 'arquivo', parte: { arquivo: caminho } });
          itens.push(itemDe(p, 'incorporada'));
        } else {
          naoIncorporada(p, inspecao.motivo);
        }
      } else if (tipo.includes('png') || tipo.includes('jpeg') || tipo.includes('jpg')) {
        const destino = await this.armazem.caminhoLocal(
          ws,
          this.armazem.novoArquivo(ws, job.id, 'pdf'),
        );
        if (await this.montador.converterImagem(caminho, tipo, destino)) {
          destinos.push({ tipo: 'arquivo', parte: { arquivo: destino } });
          itens.push(itemDe(p, 'convertida'));
        } else {
          naoIncorporada(p, 'imagem_invalida');
        }
      } else if (tipo.includes('html')) {
        // Estratégia para HTML aguardando decisão do dono (A: renderizar no
        // PDF; B: mostrar fora dele, sanitizado). Até lá o ato aparece no
        // índice e no PDF como aviso — nunca some, e o HTML do tribunal não
        // chega a lugar nenhum da interface.
        naoIncorporada(p, 'html_aguardando_estrategia');
      } else {
        naoIncorporada(p, 'formato_nao_suportado');
      }
    }

    // Uma página de aviso por peça não incorporada, num arquivo só.
    const avisos = destinos.flatMap((d) => (d.tipo === 'aviso' ? [d.aviso] : []));
    let caminhoAvisos: string | undefined;
    if (avisos.length > 0) {
      caminhoAvisos = await this.armazem.caminhoLocal(
        ws,
        this.armazem.novoArquivo(ws, job.id, 'pdf'),
      );
      await this.montador.gerarAvisos(avisos, caminhoAvisos);
    }
    let k = 0;
    const partes: ParteDoPdf[] = destinos.map((d) => {
      if (d.tipo === 'arquivo') return d.parte;
      k += 1;
      return { arquivo: caminhoAvisos ?? '', paginas: [k, k] };
    });

    const localizador = this.armazem.novoArquivo(ws, job.id, 'pdf');
    const destino = await this.armazem.caminhoLocal(ws, localizador);
    const montado = await this.montador.montar(partes, destino);
    const indice = montarIndice(
      itens.map((item, i) => ({ ...item, paginas: montado.paginasPorParte[i] ?? 0 })),
    );

    if (montado.bytes > this.config.cotaPorPdfBytes) {
      throw new LimiteDeArmazenamentoExcedidoError('pdf', this.config.cotaPorPdfBytes);
    }

    await this.armazem.limparTrabalho(ws, job.id, [localizador]);
    const agora = this.clock.agora();
    const completo = indice.every(
      (e) => e.situacao === 'incorporada' || e.situacao === 'convertida',
    );
    await gravar({
      estado: completo ? 'pronto' : 'parcial',
      arquivo: { localizador, bytes: montado.bytes, paginas: montado.paginas },
      indice,
      concluidoEm: agora,
      expiraEm: new Date(agora.getTime() + this.config.ttlMs),
    });
    log.info('PDF combinado pronto', {
      estado: completo ? 'pronto' : 'parcial',
      pecas: indice.length,
      paginas: montado.paginas,
      bytes: montado.bytes,
      chamadas: atual().chamadas,
    });

    // O PDF anterior foi substituído: sai do disco agora, não no fim do prazo.
    if (anterior) {
      await this.armazem.apagarJob(ws, anterior.id);
      await this.fila.salvar(
        semArquivo({
          ...anterior,
          estado: 'expirado',
          mensagem: 'Substituído por uma versão atualizada.',
          atualizadoEm: agora,
        }),
      );
    }
    await this.registrarUsoDeDisco();
  }

  private async registrarUsoDeDisco(): Promise<void> {
    try {
      const uso = await this.armazem.usoTotal();
      const contexto = {
        mb: Math.round(uso.bytes / 1_048_576),
        workspaces: uso.workspaces,
      };
      if (uso.bytes > this.config.avisoDiscoBytes) {
        this.logger.warn('leitor: uso de disco acima do limiar de aviso', {
          ...contexto,
          limiarMb: Math.round(this.config.avisoDiscoBytes / 1_048_576),
        });
      } else {
        this.logger.info('leitor: uso de disco', contexto);
      }
    } catch (erro) {
      this.logger.warn('leitor: não foi possível medir o uso de disco', {
        erro: erro instanceof Error ? erro.message : String(erro),
      });
    }
  }
}

/** Ver `processarFila`: no processo inteiro, um job do leitor de cada vez. */
let execucaoDoProcesso: Promise<unknown> = Promise.resolve();

/** Ordem dos autos: cada documento seguido dos anexos dele, recursivamente. */
function achatar(pecas: readonly Peca[]): Peca[] {
  const saida: Peca[] = [];
  for (const p of pecas) {
    saida.push(p);
    saida.push(...achatar(p.vinculadas));
  }
  return saida;
}

function pecaDoJob(p: Peca, ordem: number): PecaDoJob {
  return {
    pecaId: p.id,
    ordem,
    rotulo: p.rotulo,
    situacao: 'pendente',
    ...(p.movimento !== undefined ? { movimento: p.movimento } : {}),
    ...(p.dataHora !== undefined ? { data: p.dataHora } : {}),
    ...(p.mimetype !== undefined ? { mimetype: p.mimetype } : {}),
  };
}

function itemDe(
  p: PecaDoJob,
  situacao: ItemDoIndice['situacao'],
  motivo?: string,
): Omit<ItemDoIndice, 'paginas'> {
  return {
    pecaId: p.pecaId,
    rotulo: p.rotulo,
    situacao,
    ...(p.movimento !== undefined ? { movimento: p.movimento } : {}),
    ...(p.data !== undefined ? { data: p.data } : {}),
    ...(motivo !== undefined ? { motivo } : {}),
  };
}

function semMotivo(p: PecaDoJob): PecaDoJob {
  const { motivo: _motivo, ...resto } = p;
  return resto;
}

function semArquivoDaPeca(p: PecaDoJob): PecaDoJob {
  const { arquivo: _arquivo, bytes: _bytes, ...resto } = p;
  return resto;
}

function semRetomada(job: JobLeitor): JobLeitor {
  const { retomarEm: _retomarEm, mensagem: _mensagem, ...resto } = job;
  return resto;
}

function semArquivo(job: JobLeitor): JobLeitor {
  const { arquivo: _arquivo, expiraEm: _expiraEm, ...resto } = job;
  return resto;
}
