import type { FastifyPluginAsync } from 'fastify';
import type { Aplicacao } from '../../factories/makeProcessoSearchService.js';

interface ParamsNumero {
  readonly numero: string;
}

interface ParamsOab {
  readonly uf: string;
  readonly oab: string;
}

interface QueryOab {
  readonly ordenarPor?: 'ULTIMA_MOVIMENTACAO' | 'DISTRIBUICAO';
}

/**
 * Adaptador de ENTRADA HTTP.
 *
 * Repare no que estas rotas NÃO fazem: não validam número CNJ, não escolhem
 * fonte, não tratam fallback, não sabem que DataJud existe. Elas traduzem
 * HTTP → caso de uso → JSON. Toda a regra está no domínio, que é o motivo de o
 * CLI e a API poderem coexistir sem duplicar uma linha de lógica.
 *
 * O tratamento de erro também não está aqui: o `errorHandler` do servidor
 * centraliza a tradução para status HTTP.
 */
export function rotasDeProcesso(app: Aplicacao): FastifyPluginAsync {
  return async (servidor) => {
    servidor.get<{ Params: ParamsNumero }>(
      '/v1/processos/:numero',
      async (requisicao, resposta) => {
        const processo = await app.buscarProcessoPorNumero.executar({
          numeroProcesso: requisicao.params.numero,
        });

        // Cabeçalho de procedência: quem consome consegue saber se o dado veio
        // ao vivo do tribunal ou do cache — informação que importa quando a
        // resposta vira base de contagem de prazo.
        resposta.header('x-lexflow-fonte', processo.procedencia.provider);
        resposta.header('x-lexflow-cache', String(processo.procedencia.deCache));

        return processo.toJSON();
      },
    );

    servidor.get<{ Params: ParamsOab; Querystring: QueryOab }>(
      '/v1/advogados/:uf/:oab/processos',
      async (requisicao) => {
        const processos = await app.buscarProcessosPorOab.executar({
          oab: requisicao.params.oab,
          uf: requisicao.params.uf,
          ...(requisicao.query.ordenarPor
            ? { ordenarPor: requisicao.query.ordenarPor }
            : {}),
        });

        return {
          total: processos.length,
          processos: processos.map((p) => p.toJSON()),
        };
      },
    );
  };
}
