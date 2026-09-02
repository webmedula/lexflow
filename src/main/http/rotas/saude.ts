import type { FastifyPluginAsync } from 'fastify';
import type { Aplicacao } from '../../factories/makeProcessoSearchService.js';

export const ROTA_HEALTH = '/health';
export const ROTA_READY = '/ready';

/**
 * Liveness e readiness — separados, e a diferença não é burocracia.
 *
 * /health  o PROCESSO está vivo? Responde 200 sem tocar em nada externo.
 *          É o que o HEALTHCHECK do Docker e o Easypanel usam para decidir se
 *          reiniciam o contêiner.
 * /ready   o serviço consegue ATENDER? Consulta as fontes.
 *
 * Se /health consultasse os tribunais, uma instabilidade do TJSP faria o
 * orquestrador matar e recriar um contêiner perfeitamente saudável — trocando
 * uma degradação parcial por indisponibilidade total. Health check que depende
 * de terceiro é armadilha clássica, e é por isso que aqui são duas rotas.
 *
 * Ambas ficam fora da autenticação: quem faz a checagem é o contêiner, não um
 * cliente com chave.
 */
export function rotasDeSaude(app: Aplicacao): FastifyPluginAsync {
  return async (servidor) => {
    servidor.get(ROTA_HEALTH, async () => ({
      status: 'ok',
      uptimeSegundos: Math.round(process.uptime()),
    }));

    servidor.get(ROTA_READY, async (_requisicao, resposta) => {
      const fontes = await app.orquestrador.diagnostico();
      const pronto = fontes.some((f) => f.saudavel);

      // 503 quando nenhuma fonte responde: o serviço está de pé, mas não tem
      // como atender. É a resposta honesta, e é o que um load balancer precisa
      // para tirar a instância da rotação sem reiniciá-la.
      resposta.code(pronto ? 200 : 503);
      return { status: pronto ? 'pronto' : 'sem fontes disponíveis', fontes };
    });
  };
}
