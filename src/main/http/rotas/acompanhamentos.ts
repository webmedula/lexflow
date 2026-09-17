import { WorkspaceNaoResolvidoError } from '../../../domain/errors/index.js';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { SincronizacaoEmAndamentoError } from '../../../application/services/ServicoAcompanhamento.js';
import type { ServicoAcompanhamento } from '../../../application/services/ServicoAcompanhamento.js';
import type { Acompanhamento, Novidade } from '../../../domain/entities/Acompanhamento.js';
import type { AcompanhamentoResumido } from '../../../domain/ports/RepositorioAcompanhamentos.js';

/**
 * O workspace vem da chave de API, resolvido no plugin de autenticação. Estas
 * rotas nunca leem um workspace do corpo ou da query — se lessem, qualquer
 * cliente autenticado poderia pedir a carteira de outro.
 */
function workspaceDe(requisicao: FastifyRequest): string {
  const ws = requisicao.workspace;
  if (!ws) throw new WorkspaceNaoResolvidoError();
  return ws;
}

/**
 * `?ultimosDias=x` chegava como `Number('x')` = NaN, virava `new Date(NaN)` e
 * estourava `RangeError` — ou seja, 500 e alarme de produção por um parâmetro
 * de query digitado errado.
 */
function diasValidos(bruto: string | undefined): number | undefined {
  if (!bruto) return undefined;
  const n = Number(bruto);
  return Number.isInteger(n) && n > 0 && n <= 3650 ? n : undefined;
}

function resumoJson(a: AcompanhamentoResumido): Record<string, unknown> {
  const p = a.processo;
  return {
    numero: p ? p.numero.formatado : a.numero,
    apelido: a.apelido,
    tribunal: p?.tribunal,
    grau: p?.grau,
    classe: p?.classe,
    assunto: p?.assunto,
    vara: p?.vara,
    segredoJustica: p?.segredoJustica ?? false,
    totalMovimentacoes: p?.movimentacoes.length ?? 0,
    ultimaMovimentacao: a.ultimaMovimentacao
      ? { data: a.ultimaMovimentacao.data.toISOString(), titulo: a.ultimaMovimentacao.titulo }
      : null,
    novidadesNaoVistas: a.novidadesNaoVistas,
    criadoEm: a.criadoEm.toISOString(),
    sincronizadoEm: a.sincronizadoEm?.toISOString() ?? null,
    erro: a.erro ?? null,
  };
}

function detalheJson(a: Acompanhamento): Record<string, unknown> {
  return {
    numero: a.processo ? a.processo.numero.formatado : a.numero,
    apelido: a.apelido ?? null,
    criadoEm: a.criadoEm.toISOString(),
    sincronizadoEm: a.sincronizadoEm?.toISOString() ?? null,
    erro: a.erro ?? null,
    processo: a.processo ? a.processo.toJSON() : null,
  };
}

function novidadeJson(n: Novidade): Record<string, unknown> {
  return {
    id: n.id,
    numero: n.numero,
    data: n.data.toISOString(),
    titulo: n.titulo,
    codigoTpu: n.codigoTpu ?? null,
    conteudo: n.conteudo ?? null,
    detectadaEm: n.detectadaEm.toISOString(),
    vista: n.vistaEm !== undefined,
  };
}

interface QueryLista {
  texto?: string;
  tribunal?: string;
  classe?: string;
  comNovidade?: string;
  ultimosDias?: string;
  ordem?: 'MOVIMENTACAO_RECENTE' | 'ADICIONADO_RECENTE' | 'NUMERO';
}

interface QueryNovidades {
  numero?: string;
  tribunal?: string;
  naoVistas?: string;
  limite?: string;
}

const verdadeiro = (v: string | undefined): boolean => v === 'true' || v === '1';

export function rotasDeAcompanhamento(
  servico: ServicoAcompanhamento,
): FastifyPluginAsync {
  return async (servidor) => {
    servidor.get<{ Querystring: QueryLista }>(
      '/v1/acompanhamentos',
      async (req) => {
        const q = req.query;
        const lista = await servico.listar(workspaceDe(req), {
          ...(q.texto ? { texto: q.texto } : {}),
          ...(q.tribunal ? { tribunal: q.tribunal } : {}),
          ...(q.classe ? { classe: q.classe } : {}),
          ...(verdadeiro(q.comNovidade) ? { somenteComNovidade: true } : {}),
            ...(diasValidos(q.ultimosDias) !== undefined
            ? { movimentadoNosUltimosDias: diasValidos(q.ultimosDias) as number }
            : {}),
          ...(q.ordem ? { ordem: q.ordem } : {}),
        });
        return {
          total: lista.length,
          // O total SEM filtro vai junto, sempre. É o que permite a tela dizer
          // "mostrando 1 de 3" em vez de mostrar 1 e calar sobre os outros 2 —
          // que foi como um filtro esquecido convenceu o dono do produto de que
          // o sistema tinha perdido processos.
          totalSemFiltro: await servico.contarAcompanhamentos(workspaceDe(req)),
          acompanhamentos: lista.map(resumoJson),
        };
      },
    );

    servidor.post<{ Body: { numero?: string; apelido?: string } }>(
      '/v1/acompanhamentos',
      async (req, resposta) => {
        const numero = req.body?.numero?.trim();
        if (!numero) {
          void resposta.code(400);
          return { erro: 'NUMERO_OBRIGATORIO', mensagem: 'Informe o número do processo.' };
        }
        const criado = await servico.acompanhar(
          workspaceDe(req),
          numero,
          req.body?.apelido?.trim() || undefined,
        );
        void resposta.code(201);
        return detalheJson(criado);
      },
    );

    servidor.get<{ Params: { numero: string } }>(
      '/v1/acompanhamentos/:numero',
      async (req, resposta) => {
        const a = await servico.detalhar(workspaceDe(req), req.params.numero);
        if (!a) {
          void resposta.code(404);
          return {
            erro: 'NAO_ACOMPANHADO',
            mensagem: 'Este processo não está sendo acompanhado.',
          };
        }
        return detalheJson(a);
      },
    );

    servidor.delete<{ Params: { numero: string } }>(
      '/v1/acompanhamentos/:numero',
      async (req, resposta) => {
        const removido = await servico.deixarDeAcompanhar(
          workspaceDe(req),
          req.params.numero,
        );
        if (!removido) {
          void resposta.code(404);
          return { erro: 'NAO_ACOMPANHADO', mensagem: 'Não estava sendo acompanhado.' };
        }
        return { removido: true };
      },
    );

    servidor.get<{ Querystring: QueryNovidades }>('/v1/novidades', async (req) => {
      const q = req.query;
      const ws = workspaceDe(req);
      const lista = await servico.novidades(ws, {
        ...(q.numero ? { numero: q.numero.replace(/\D/g, '') } : {}),
        ...(q.tribunal ? { tribunal: q.tribunal } : {}),
        ...(verdadeiro(q.naoVistas) ? { somenteNaoVistas: true } : {}),
        ...(q.limite ? { limite: Number(q.limite) } : {}),
      });
      return {
        total: lista.length,
        naoVistas: await servico.contarNaoVistas(ws),
        // Quantos processos o assinante acompanha.
        //
        // Vai JUNTO das novidades porque a tela inicial mostra movimentação
        // NOVA, e um processo recém-adicionado não gera nenhuma — a primeira
        // sincronização é o retrato inicial, não novidade. Sem este número, a
        // tela que a pessoa vê primeiro parece dizer que ela não tem nada,
        // logo depois de ela ter cadastrado três processos. Foi exatamente o
        // que aconteceu num teste real: o dado estava salvo, e a interface
        // convenceu o dono de que tinha sumido.
        acompanhados: await servico.contarAcompanhamentos(ws),
        novidades: lista.map(novidadeJson),
      };
    });

    servidor.post<{ Body: { numero?: string } }>(
      '/v1/novidades/marcar-vistas',
      async (req) => {
        const marcadas = await servico.marcarComoVistas(
          workspaceDe(req),
          req.body?.numero,
        );
        return { marcadas };
      },
    );

    servidor.get('/v1/facetas', async (req) => servico.facetas(workspaceDe(req)));

    /**
     * Dispara a varredura na hora. Responde 202 e NÃO espera terminar: a
     * varredura pode levar meia hora, e segurar a conexão aberta por isso
     * levaria o proxy a cortar antes do fim.
     */
    servidor.post('/v1/sincronizar', async (req, resposta) => {
      if (servico.emAndamento) {
        void resposta.code(409);
        return {
          erro: new SincronizacaoEmAndamentoError().codigo,
          mensagem: new SincronizacaoEmAndamentoError().message,
        };
      }
      // ESCOPADA ao chamador. A versão global existe e é a agendada — deixar
      // a rota HTTP disparar aquela permitia a qualquer conta mandar o
      // servidor consultar o tribunal sobre a carteira de TODOS os
      // assinantes, gravando nos dados deles e gastando a cota do CNJ em
      // nome deles.
      void servico.sincronizar({ workspace: workspaceDe(req) }).catch(() => {
        /* já registrado no log pelo serviço */
      });
      void resposta.code(202);
      return {
        iniciada: true,
        mensagem:
          'Varredura iniciada em segundo plano. Cada processo leva alguns segundos; ' +
          'as novidades aparecem no feed conforme forem detectadas.',
      };
    });

    servidor.get('/v1/sincronizacao', async () => ({
      emAndamento: servico.emAndamento,
    }));
  };
}
