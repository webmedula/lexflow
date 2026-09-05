import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ServicoVigilanciaOab } from '../../../application/services/ServicoVigilanciaOab.js';
import type { VigilanciaOab } from '../../../domain/entities/VigilanciaOab.js';
import type { RepositorioNotificacao } from '../../../domain/ports/RepositorioNotificacao.js';
import { OperacaoNaoSuportadaError } from '../../../domain/errors/index.js';

function workspaceDe(requisicao: FastifyRequest): string {
  const ws = requisicao.workspace;
  if (!ws) throw new Error('rota de vigilância sem workspace resolvido');
  return ws;
}

const corpoVigiar = z.object({
  oab: z.string().min(1),
  uf: z.string().length(2),
  apelido: z.string().max(80).optional(),
});

// Validação de e-mail deliberadamente frouxa: a checagem que vale é o envio
// chegar, e regex de e-mail rigorosa recusa endereço válido com mais frequência
// do que pega endereço inválido.
const corpoNotificacao = z.object({
  email: z.string().email().max(200).optional(),
  ativa: z.boolean().optional(),
});

function vigilanciaJson(v: VigilanciaOab): Record<string, unknown> {
  return {
    oab: v.oab.numero,
    uf: v.oab.uf,
    identificacao: `${v.oab.numero}/${v.oab.uf}`,
    apelido: v.apelido ?? null,
    ativa: v.ativa,
    criadaEm: v.criadaEm.toISOString(),
    varridaEm: v.varridaEm?.toISOString() ?? null,
    processosEncontrados: v.processosEncontrados,
    erro: v.erro ?? null,
  };
}

/**
 * Rotas da vigilância por OAB e da preferência de aviso.
 *
 * Quando a cadeia configurada não tem fonte que busque por OAB, o serviço nem é
 * montado e tudo aqui responde **501**, com a instrução do que configurar. É
 * melhor do que existir e nunca encontrar nada: o usuário cadastraria a
 * inscrição, veria "0 processos" e concluiria que não tem processo — quando o
 * que falta é o DJEN na cadeia.
 */
export function rotasDeVigilancia(
  servico: ServicoVigilanciaOab | undefined,
  preferencias: RepositorioNotificacao,
): FastifyPluginAsync {
  return async (servidor) => {
    function exigirServico(): ServicoVigilanciaOab {
      if (!servico) {
        // Erro de domínio, e não um `statusCode` improvisado no objeto: é o
        // `mapearErro` que decide status, e `OperacaoNaoSuportadaError` já
        // significa exatamente isto — limitação permanente da configuração
        // atual, não indisponibilidade passageira.
        throw new OperacaoNaoSuportadaError(
          'vigilancia-oab',
          'vigiar',
          'nenhuma fonte da cadeia busca por OAB — inclua "djen" em LEXFLOW_PROVIDER_CHAIN',
        );
      }
      return servico;
    }

    servidor.post<{ Body: unknown }>('/v1/vigilancias', async (req, resposta) => {
      const { oab, uf, apelido } = corpoVigiar.parse(req.body ?? {});
      const v = await exigirServico().vigiar(workspaceDe(req), oab, uf, apelido);
      void resposta.code(201);
      return vigilanciaJson(v);
    });

    servidor.get('/v1/vigilancias', async (req) => {
      const lista = await exigirServico().listar(workspaceDe(req));
      return { total: lista.length, vigilancias: lista.map(vigilanciaJson) };
    });

    servidor.delete<{ Params: { uf: string; oab: string } }>(
      '/v1/vigilancias/:uf/:oab',
      async (req, resposta) => {
        const ok = await exigirServico().parar(
          workspaceDe(req),
          req.params.oab,
          req.params.uf,
        );
        if (!ok) {
          void resposta.code(404);
          return { erro: 'NAO_VIGIADA', mensagem: 'Esta inscrição não estava vigiada.' };
        }
        return { parada: true };
      },
    );

    /**
     * Varredura manual. 202 e não 200: uma varredura de várias inscrições leva
     * minutos, e segurar a conexão até o fim faria o proxy cortar antes.
     */
    servidor.post('/v1/vigilancias/varrer', async (_req, resposta) => {
      const s = exigirServico();
      if (s.emAndamento()) {
        void resposta.code(409);
        return { erro: 'VARREDURA_EM_ANDAMENTO', iniciada: false };
      }
      void s.varrer();
      void resposta.code(202);
      return { iniciada: true };
    });

    servidor.get('/v1/notificacao', async (req) => {
      const p = await preferencias.obter(workspaceDe(req));
      return {
        email: p.email ?? null,
        ativa: p.ativa,
        ultimoEnvioEm: p.ultimoEnvioEm?.toISOString() ?? null,
      };
    });

    servidor.put<{ Body: unknown }>('/v1/notificacao', async (req) => {
      const { email, ativa } = corpoNotificacao.parse(req.body ?? {});
      const p = await preferencias.salvar(
        workspaceDe(req),
        email,
        ativa ?? Boolean(email),
      );
      return { email: p.email ?? null, ativa: p.ativa };
    });
  };
}
