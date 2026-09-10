import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ServicoPecas } from '../../../application/services/ServicoPecas.js';
import { OperacaoNaoSuportadaError } from '../../../domain/errors/index.js';

function workspaceDe(requisicao: FastifyRequest): string {
  const ws = requisicao.workspace;
  if (!ws) throw new Error('rota de peças sem workspace resolvido');
  return ws;
}

const corpoCredencial = z.object({
  tribunal: z.string().min(2).max(10),
  /** CPF do consultante, no MNI. Guardado como veio; não é validado como CPF. */
  identificacao: z.string().min(3).max(60),
  senha: z.string().min(1).max(200),
});

/**
 * Rotas das peças e das credenciais de tribunal.
 *
 * Sem serviço montado, tudo aqui responde **501 com instrução** em vez de 404 ou
 * lista vazia. A diferença importa: lista vazia diria ao advogado que o processo
 * dele não tem peças, quando o que falta é configuração do servidor.
 */
export function rotasDePecas(servico: ServicoPecas | undefined): FastifyPluginAsync {
  return async (servidor) => {
    function exigirServico(): ServicoPecas {
      if (!servico) {
        throw new OperacaoNaoSuportadaError(
          'pecas',
          'listarPecas',
          'o acesso a peças não está configurado — defina LEXFLOW_CREDENCIAL_CHAVE ' +
            'e MNI_ENDPOINT no ambiente',
        );
      }
      return servico;
    }

    servidor.get<{ Params: { numero: string } }>(
      '/v1/processos/:numero/pecas',
      async (req) => {
        const pecas = await exigirServico().listarDoProcesso(
          workspaceDe(req),
          req.params.numero,
        );

        return {
          total: pecas.length,
          // Contagem à parte porque é a pergunta que a tela faz primeiro:
          // "quantas dessas eu consigo abrir?". Sem procuração nos autos, o
          // tribunal manda a ficha e retém o arquivo — e a interface precisa
          // dizer isso antes de o advogado clicar e receber erro.
          comTeorDisponivel: pecas.filter((p) => p.conteudoDisponivel).length,
          pecas: pecas.map((p) => p.toJSON()),
        };
      },
    );

    servidor.get<{ Params: { numero: string; id: string } }>(
      '/v1/processos/:numero/pecas/:id',
      async (req, resposta) => {
        const conteudo = await exigirServico().baixarPeca(
          workspaceDe(req),
          req.params.numero,
          req.params.id,
        );

        void resposta.header('content-type', conteudo.mimetype);
        // `attachment` e não `inline`: são autos de processo, e abrir PDF de
        // terceiro dentro da nossa origem no navegador é superfície que não
        // precisamos ter.
        void resposta.header(
          'content-disposition',
          `attachment; filename="${conteudo.nomeArquivo}"`,
        );
        return resposta.send(Buffer.from(conteudo.bytes));
      },
    );

    servidor.get('/v1/credenciais', async (req) => {
      const lista = await exigirServico().listarCredenciais(workspaceDe(req));
      return {
        total: lista.length,
        credenciais: lista.map((c) => ({
          tribunal: c.tribunal,
          identificacao: c.identificacao,
          criadaEm: c.criadaEm.toISOString(),
          usadaEm: c.usadaEm?.toISOString() ?? null,
          recusadaEm: c.recusadaEm?.toISOString() ?? null,
        })),
      };
    });

    servidor.put<{ Body: unknown }>('/v1/credenciais', async (req, resposta) => {
      const dados = corpoCredencial.parse(req.body ?? {});
      const cadastrada = await exigirServico().cadastrarCredencial(workspaceDe(req), {
        tribunal: dados.tribunal.toUpperCase(),
        identificacao: dados.identificacao,
        senha: dados.senha,
      });

      void resposta.code(201);
      // A senha não volta. Nem mascarada: devolver `***` convida a interface a
      // exibir um campo "preenchido" que não pode ser reenviado, e o próximo
      // salvamento gravaria os asteriscos como senha.
      return {
        tribunal: cadastrada.tribunal,
        identificacao: cadastrada.identificacao,
        criadaEm: cadastrada.criadaEm.toISOString(),
      };
    });

    servidor.delete<{ Params: { tribunal: string } }>(
      '/v1/credenciais/:tribunal',
      async (req, resposta) => {
        const removida = await exigirServico().removerCredencial(
          workspaceDe(req),
          req.params.tribunal,
        );
        if (!removida) {
          void resposta.code(404);
          return {
            erro: 'CREDENCIAL_NAO_CADASTRADA',
            mensagem: 'Não havia credencial cadastrada para este tribunal.',
          };
        }
        return { removida: true };
      },
    );
  };
}
