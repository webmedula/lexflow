import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { ServicoAssinaturas } from '../../../application/services/ServicoAssinaturas.js';
import type { ServicoChavesApi } from '../../../application/services/ServicoChavesApi.js';
import { CODIGOS_DE_PLANO, ehCodigoDePlano } from '../../../domain/entities/Plano.js';
import { OperacaoNaoSuportadaError } from '../../../domain/errors/index.js';
import type { RepositorioAssinaturas } from '../../../domain/ports/RepositorioAssinaturas.js';
import type { RepositorioUsuarios } from '../../../domain/ports/RepositorioUsuarios.js';
import { VERSAO } from '../../../infrastructure/config/versao.js';
import { paginaAdmin } from '../ui/paginaAdmin.js';
import { autenticacaoAdmin } from '../plugins/autenticacaoAdmin.js';

export const ROTA_ADMIN = '/admin';
export const ROTA_ADMIN_ASSINATURAS = '/admin/api/assinaturas';
export const ROTA_ADMIN_ASSINATURA_POR_EMAIL = '/admin/api/assinaturas/:email';
export const ROTA_ADMIN_ASSINATURA_LIBERAR = '/admin/api/assinaturas/:email/liberar';
export const ROTA_ADMIN_ASSINATURA_CANCELAR = '/admin/api/assinaturas/:email/cancelar';
export const ROTA_ADMIN_ASSINATURAS_AVISAR = '/admin/api/assinaturas/avisar';
export const ROTA_ADMIN_CHAVES = '/admin/api/chaves';
export const ROTA_ADMIN_CHAVE_REVOGAR = '/admin/api/chaves/:identificador/revogar';

/** Toda rota administrativa, na ordem em que faz sentido ler — para `rotasPublicas`. */
export const ROTAS_ADMIN: readonly string[] = [
  ROTA_ADMIN,
  ROTA_ADMIN_ASSINATURAS,
  ROTA_ADMIN_ASSINATURA_POR_EMAIL,
  ROTA_ADMIN_ASSINATURA_LIBERAR,
  ROTA_ADMIN_ASSINATURA_CANCELAR,
  ROTA_ADMIN_ASSINATURAS_AVISAR,
  ROTA_ADMIN_CHAVES,
  ROTA_ADMIN_CHAVE_REVOGAR,
];

const corpoLiberar = z.object({
  plano: z.string().refine(ehCodigoDePlano, {
    message: `Plano precisa ser um de: ${CODIGOS_DE_PLANO.join(', ')}.`,
  }),
  meses: z.coerce.number().int().min(1).max(60),
  observacao: z.string().trim().min(1).max(200).optional(),
});

const corpoCancelar = z.object({
  observacao: z.string().trim().min(1).max(200).optional(),
});

const corpoEmitirChave = z.object({
  rotulo: z.string().trim().min(1).max(60),
});

export interface OpcoesRotasAdmin {
  /** `undefined` quando `PROCESSOVIVO_ADMIN_USUARIO`/`_SENHA` não estão configuradas. */
  readonly credenciais?: { readonly usuario: string; readonly senha: string };
  readonly assinaturas: ServicoAssinaturas;
  readonly repositorioAssinaturas: RepositorioAssinaturas;
  readonly usuarios: RepositorioUsuarios;
  readonly chavesApi: ServicoChavesApi;
}

/**
 * A área administrativa — só o operador, nunca um assinante.
 *
 * **Autenticação separada de propósito.** Estas rotas entram em
 * `rotasPublicas` no `autenticacao.ts` do assinante (a exemplo do console: são
 * "públicas" do PONTO DE VISTA daquele plugin, porque respondem a outra
 * credencial). Quem de fato as protege é `autenticacaoAdmin`, chamada aqui
 * embaixo sobre esta MESMA instância (`servidor`, a que `servidor.register()`
 * cria para este plugin em `servidor.ts`): o hook que ela adiciona vale só
 * para as rotas declaradas aqui, nunca para o resto do servidor — é o
 * encapsulamento do Fastify, e é o que mantém esta autenticação inteiramente
 * à parte da do assinante, como o `CLAUDE.md` pede.
 *
 * **Sem configurar, responde 501 em vez de 404** — mesma convenção de
 * `rotasDePecas`: dizer "não configurado" é mais honesto do que fingir que a
 * rota não existe, e ninguém sem a credencial chega a ver a diferença mesmo
 * assim, porque a rota também não teria passado pela autenticação.
 */
export function rotasDeAdmin(opcoes: OpcoesRotasAdmin): FastifyPluginAsync {
  return async (servidor) => {
    if (!opcoes.credenciais) {
      const desligada = (): never => {
        throw new OperacaoNaoSuportadaError(
          'admin',
          'acessar',
          'a área administrativa não está configurada — defina ' +
            'PROCESSOVIVO_ADMIN_USUARIO e PROCESSOVIVO_ADMIN_SENHA',
        );
      };
      servidor.get(ROTA_ADMIN, desligada);
      servidor.get(ROTA_ADMIN_ASSINATURAS, desligada);
      servidor.get(ROTA_ADMIN_ASSINATURA_POR_EMAIL, desligada);
      servidor.post(ROTA_ADMIN_ASSINATURA_LIBERAR, desligada);
      servidor.post(ROTA_ADMIN_ASSINATURA_CANCELAR, desligada);
      servidor.post(ROTA_ADMIN_ASSINATURAS_AVISAR, desligada);
      servidor.get(ROTA_ADMIN_CHAVES, desligada);
      servidor.post(ROTA_ADMIN_CHAVES, desligada);
      servidor.post(ROTA_ADMIN_CHAVE_REVOGAR, desligada);
      return;
    }

    autenticacaoAdmin(servidor, opcoes.credenciais);

    /** E-mail cadastrado -> workspace. O operador conhece o e-mail, não o workspace. */
    async function workspaceDe(email: string): Promise<string | undefined> {
      const achado = await opcoes.usuarios.porEmail(email.trim().toLowerCase());
      return achado?.usuario.workspace;
    }

    function contaNaoEncontrada(): { erro: string; mensagem: string } {
      return {
        erro: 'CONTA_NAO_ENCONTRADA',
        mensagem: 'Nenhuma conta cadastrada com este e-mail.',
      };
    }

    servidor.get(ROTA_ADMIN, async (_req, resposta) => {
      resposta.header('content-type', 'text/html; charset=utf-8');
      resposta.header('cache-control', 'no-store');
      resposta.header('x-robots-tag', 'noindex');
      return paginaAdmin(VERSAO);
    });

    servidor.get(ROTA_ADMIN_ASSINATURAS, async () => {
      const todas = await opcoes.repositorioAssinaturas.todas();
      const agora = new Date();

      const assinaturas = await Promise.all(
        todas.map(async (a) => {
          const conta = await opcoes.usuarios.porWorkspace(a.workspace);
          return {
            workspace: a.workspace,
            email: conta?.email ?? null,
            plano: a.plano,
            nomeDoPlano: a.detalhesDoPlano.nome,
            status: a.statusEm(agora),
            venceEm: a.venceEm.toISOString(),
            ehTeste: a.ehTeste,
            observacao: a.observacao ?? null,
          };
        }),
      );

      return { total: assinaturas.length, assinaturas };
    });

    servidor.get<{ Params: { email: string } }>(
      ROTA_ADMIN_ASSINATURA_POR_EMAIL,
      async (req, resposta) => {
        const ws = await workspaceDe(req.params.email);
        if (!ws) {
          void resposta.code(404);
          return contaNaoEncontrada();
        }
        const resumo = await opcoes.assinaturas.resumo(ws);
        return { email: req.params.email, workspace: ws, assinatura: resumo ?? null };
      },
    );

    servidor.post<{ Params: { email: string }; Body: unknown }>(
      ROTA_ADMIN_ASSINATURA_LIBERAR,
      async (req, resposta) => {
        const dados = corpoLiberar.parse(req.body);
        const ws = await workspaceDe(req.params.email);
        if (!ws) {
          void resposta.code(404);
          return contaNaoEncontrada();
        }

        const a = await opcoes.assinaturas.liberar({
          workspace: ws,
          plano: dados.plano,
          meses: dados.meses,
          ...(dados.observacao !== undefined ? { observacao: dados.observacao } : {}),
        });

        void resposta.code(201);
        return {
          email: req.params.email,
          workspace: ws,
          plano: a.plano,
          nomeDoPlano: a.detalhesDoPlano.nome,
          venceEm: a.venceEm.toISOString(),
        };
      },
    );

    servidor.post<{ Params: { email: string }; Body: unknown }>(
      ROTA_ADMIN_ASSINATURA_CANCELAR,
      async (req, resposta) => {
        const dados = corpoCancelar.parse(req.body ?? {});
        const ws = await workspaceDe(req.params.email);
        if (!ws) {
          void resposta.code(404);
          return contaNaoEncontrada();
        }

        const cancelada = await opcoes.assinaturas.cancelar(ws, dados.observacao);
        if (!cancelada) {
          void resposta.code(404);
          return {
            erro: 'ASSINATURA_NAO_ENCONTRADA',
            mensagem: 'Esta conta não tinha assinatura para cancelar.',
          };
        }
        return { email: req.params.email, workspace: ws, status: cancelada.statusEm(new Date()) };
      },
    );

    /**
     * O mesmo que o agendador roda sozinho — aqui para o operador poder
     * disparar na hora, sem esperar o próximo ciclo. Espelha `assinatura
     * avisar` do CLI.
     */
    servidor.post(ROTA_ADMIN_ASSINATURAS_AVISAR, async () => {
      return opcoes.assinaturas.avisarVencimentos();
    });

    servidor.get(ROTA_ADMIN_CHAVES, async () => {
      const chaves = await opcoes.chavesApi.listar();
      return {
        total: chaves.length,
        chaves: chaves.map((c) => ({
          identificador: c.identificador,
          workspace: c.workspace,
          rotulo: c.rotulo,
          criadaEm: c.criadaEm.toISOString(),
          revogadaEm: c.revogadaEm?.toISOString() ?? null,
        })),
      };
    });

    servidor.post<{ Body: unknown }>(ROTA_ADMIN_CHAVES, async (req, resposta) => {
      const { rotulo } = corpoEmitirChave.parse(req.body);
      const emitida = await opcoes.chavesApi.emitir(rotulo);

      void resposta.code(201);
      // A ÚNICA resposta desta rota que carrega `chave` em texto puro. Nunca
      // volta a aparecer — nem no log de acesso, que registra rota e status,
      // não corpo de resposta.
      return {
        chave: emitida.chave,
        identificador: emitida.identificador,
        workspace: emitida.workspace,
        rotulo: emitida.rotulo,
        criadaEm: emitida.criadaEm.toISOString(),
      };
    });

    servidor.post<{ Params: { identificador: string } }>(
      ROTA_ADMIN_CHAVE_REVOGAR,
      async (req) => {
        await opcoes.chavesApi.revogar(req.params.identificador);
        return { revogada: true };
      },
    );
  };
}
