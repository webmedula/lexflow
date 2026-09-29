import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ServicoAssinaturas } from '../../../application/services/ServicoAssinaturas.js';
import type { ServicoPlanos } from '../../../application/services/ServicoPlanos.js';
import { WorkspaceNaoResolvidoError } from '../../../domain/errors/index.js';

function workspaceDe(requisicao: FastifyRequest): string {
  const ws = requisicao.workspace;
  if (!ws) throw new WorkspaceNaoResolvidoError();
  return ws;
}

/**
 * O que o assinante pode ver sobre o próprio plano.
 *
 * **Não há rota para o ASSINANTE mudar de plano.** A liberação é manual,
 * depois do Pix, pelo CLI ou pela área administrativa (`rotasDeAdmin`) — que
 * tem autenticação própria, à parte desta. Uma rota de troca aqui exigiria um
 * papel de administrador dentro da conta do assinante, e inventar
 * "administrador" como um campo booleano na tabela de usuários é como se
 * constrói, sem perceber, uma escalada de privilégio numa API que já é pública
 * para cadastro.
 */
export function rotasDeAssinaturas(
  servico: ServicoAssinaturas,
  planos: ServicoPlanos,
): FastifyPluginAsync {
  return async (servidor) => {
    servidor.get('/v1/assinatura', async (req) => {
      const [resumo, aVenda] = await Promise.all([
        servico.resumo(workspaceDe(req)),
        planos.aVenda(),
      ]);

      // Sem assinatura NÃO é erro: é o caso das chaves de API, que nunca terão
      // uma. Devolver 404 faria a interface mostrar falha onde não há.
      return { assinatura: resumo ?? null, planos: aVenda };
    });
  };
}
