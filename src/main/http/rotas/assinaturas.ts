import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ServicoAssinaturas } from '../../../application/services/ServicoAssinaturas.js';
import { planosAVenda } from '../../../domain/entities/Plano.js';
import { WorkspaceNaoResolvidoError } from '../../../domain/errors/index.js';

function workspaceDe(requisicao: FastifyRequest): string {
  const ws = requisicao.workspace;
  if (!ws) throw new WorkspaceNaoResolvidoError();
  return ws;
}

/**
 * O que o assinante pode ver sobre o próprio plano.
 *
 * **Não há rota para MUDAR de plano, e isso é deliberado nesta versão.** A
 * liberação é manual, pelo comando de CLI, depois do Pix. Uma rota de troca
 * exigiria um papel de administrador que o sistema não tem — e inventar
 * "administrador" como um campo booleano na tabela de usuários é como se
 * constrói, sem perceber, uma escalada de privilégio numa API que já é pública
 * para cadastro.
 */
export function rotasDeAssinaturas(servico: ServicoAssinaturas): FastifyPluginAsync {
  return async (servidor) => {
    servidor.get('/v1/assinatura', async (req) => {
      const resumo = await servico.resumo(workspaceDe(req));

      // Sem assinatura NÃO é erro: é o caso das chaves de API, que nunca terão
      // uma. Devolver 404 faria a interface mostrar falha onde não há.
      if (!resumo) return { assinatura: null, planos: planosAVenda() };

      return { assinatura: resumo, planos: planosAVenda() };
    });
  };
}
