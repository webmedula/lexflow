import { describe, expect, it } from 'vitest';
import { ServicoAssinaturas } from '../../src/application/services/ServicoAssinaturas.js';
import { Assinatura, assinaturaDeTeste } from '../../src/domain/entities/Assinatura.js';
import type { CodigoPlano } from '../../src/domain/entities/Plano.js';
import {
  AssinaturaInativaError,
  RecursoNaoIncluidoNoPlanoError,
} from '../../src/domain/errors/index.js';
import type { Notificador } from '../../src/domain/ports/Notificador.js';
import type {
  EtapaDeAviso,
  RepositorioAssinaturas,
} from '../../src/domain/ports/RepositorioAssinaturas.js';
import type { RepositorioUsuarios } from '../../src/domain/ports/RepositorioUsuarios.js';
import type { Usuario } from '../../src/domain/entities/Usuario.js';
import { loggerSilencioso } from '../../src/infrastructure/logging/ConsoleLogger.js';

const T0 = new Date('2026-09-22T12:00:00.000Z');
const dias = (n: number): Date => new Date(T0.getTime() + n * 86_400_000);

class RepoFalso implements RepositorioAssinaturas {
  readonly guardadas = new Map<string, Assinatura>();
  readonly avisos = new Map<string, EtapaDeAviso>();

  async porWorkspace(w: string): Promise<Assinatura | undefined> {
    return this.guardadas.get(w);
  }
  async salvar(a: Assinatura): Promise<void> {
    this.guardadas.set(a.workspace, a);
    this.avisos.delete(a.workspace);
  }
  async ultimoAviso(w: string): Promise<EtapaDeAviso | undefined> {
    return this.avisos.get(w);
  }
  async registrarAviso(w: string, e: EtapaDeAviso): Promise<void> {
    this.avisos.set(w, e);
  }
  async aVencerAte(limite: Date): Promise<readonly Assinatura[]> {
    return [...this.guardadas.values()].filter(
      (a) => !a.canceladaEm && a.venceEm.getTime() <= limite.getTime(),
    );
  }
  async todas(): Promise<readonly Assinatura[]> {
    return [...this.guardadas.values()];
  }
}

/** Só o método que o serviço usa; o resto do porta não entra em jogo aqui. */
function usuariosCom(porWorkspace: Record<string, string>): RepositorioUsuarios {
  const parcial = {
    async porWorkspace(w: string): Promise<Usuario | undefined> {
      const email = porWorkspace[w];
      return email
        ? ({ id: w, email, nome: 'Ana', workspace: w, criadoEm: T0 } as Usuario)
        : undefined;
    },
  };
  return parcial as unknown as RepositorioUsuarios;
}

class Espiao implements Notificador {
  readonly nome = 'espiao';
  habilitado = true;
  aceitar = true;
  readonly enviadas: Array<{ para: string; assunto: string; texto: string }> = [];

  async enviar(m: { para: string; assunto: string; texto: string }): Promise<boolean> {
    if (!this.aceitar) return false;
    this.enviadas.push(m);
    return true;
  }
}

function montar(opcoes: { agora?: Date; notificador?: Notificador } = {}): {
  servico: ServicoAssinaturas;
  repo: RepoFalso;
} {
  const repo = new RepoFalso();
  const servico = new ServicoAssinaturas({
    repositorio: repo,
    usuarios: usuariosCom({ ws1: 'ana@a.com.br' }),
    logger: loggerSilencioso,
    ...(opcoes.notificador ? { notificador: opcoes.notificador } : {}),
    agora: () => opcoes.agora ?? T0,
  });
  return { servico, repo };
}

function paga(plano: CodigoPlano, venceEmDias: number, workspace = 'ws1'): Assinatura {
  return new Assinatura({
    workspace,
    plano,
    inicioEm: T0,
    venceEm: dias(venceEmDias),
    ehTeste: false,
    diasDeCarencia: 7,
  });
}

describe('ServicoAssinaturas.exigir', () => {
  it('workspace SEM assinatura passa, e isso é proposital', async () => {
    /*
     * Workspace de chave de API não tem conta e nunca terá assinatura — são os
     * fluxos de integração do próprio operador. Tratar ausência como bloqueio
     * derrubaria o n8n no dia do deploy, sem ninguém ter comprado nada.
     */
    const { servico } = montar();
    await expect(servico.exigir('integracao-n8n', 'pecas')).resolves.toBeUndefined();
  });

  it('plano sem o recurso é recusado, e a mensagem diz qual plano resolve', async () => {
    const { servico, repo } = montar();
    await repo.salvar(paga('acompanhamento', 30));

    const erro = await servico.exigir('ws1', 'pecas').catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(RecursoNaoIncluidoNoPlanoError);
    // Erro que diz "não disponível" sem dizer o que fazer é porta sem maçaneta.
    expect((erro as Error).message).toContain('Peças');
    expect((erro as Error).message).toContain('Acompanhamento');
  });

  it('assinatura vencida e fora da carência é recusada com OUTRO erro', async () => {
    // As duas ações são opostas: aqui é pagar o que já foi contratado, lá é
    // trocar de plano. Um erro só mandaria metade das pessoas ao lugar errado.
    const { servico, repo } = montar({ agora: dias(40) });
    await repo.salvar(paga('pecas', 10));

    await expect(servico.exigir('ws1', 'pecas')).rejects.toThrow(AssinaturaInativaError);
  });

  it('durante a carência tudo continua liberado', async () => {
    const { servico, repo } = montar({ agora: dias(12) });
    await repo.salvar(paga('pecas', 10));

    await expect(servico.exigir('ws1', 'pecas')).resolves.toBeUndefined();
    await expect(servico.exigir('ws1', 'vigilancia')).resolves.toBeUndefined();
  });

  it('o teste de conta nova libera as peças', async () => {
    const { servico } = montar();
    await servico.criarTeste('ws1');
    await expect(servico.exigir('ws1', 'pecas')).resolves.toBeUndefined();
  });
});

describe('ServicoAssinaturas.liberar', () => {
  it('cria quando não existe e marca como paga', async () => {
    const { servico } = montar();
    const a = await servico.liberar({ workspace: 'ws1', plano: 'pecas', meses: 3 });

    expect(a.ehTeste).toBe(false);
    expect(a.statusEm(dias(80))).toBe('ativa');
    expect(a.diasDeCarencia).toBeGreaterThan(0);
  });

  it('converte o teste em assinatura paga sem perder o ambiente', async () => {
    const { servico, repo } = montar();
    await repo.salvar(assinaturaDeTeste({ workspace: 'ws1', plano: 'pecas', agora: T0 }));

    const a = await servico.liberar({
      workspace: 'ws1',
      plano: 'pecas',
      meses: 1,
      observacao: 'Pix 22/09',
    });
    expect(a.ehTeste).toBe(false);
    expect(a.observacao).toBe('Pix 22/09');
    expect(a.workspace).toBe('ws1');
  });

  it('cancelar não apaga a assinatura, só a encerra', async () => {
    // O histórico importa: quem cancelou pode voltar, e a data de início
    // original é o que diz há quanto tempo aquele advogado é cliente.
    const { servico, repo } = montar();
    await repo.salvar(paga('pecas', 30));

    const c = await servico.cancelar('ws1', 'pediu por e-mail');
    expect(c?.canceladaEm).toBeDefined();
    expect(c?.inicioEm.toISOString()).toBe(T0.toISOString());
    expect(await repo.porWorkspace('ws1')).toBeDefined();
  });
});

describe('ServicoAssinaturas.avisarVencimentos', () => {
  it('avisa antes de vencer, uma vez só', async () => {
    const espiao = new Espiao();
    const { servico, repo } = montar({ agora: dias(28), notificador: espiao });
    await repo.salvar(paga('pecas', 30));

    expect((await servico.avisarVencimentos()).avisados).toBe(1);
    // Segunda passagem da varredura no mesmo estado: nada sai. Repetir o mesmo
    // e-mail ensina o assinante a ignorar o remetente — que é o MESMO que
    // manda aviso de prazo.
    expect((await servico.avisarVencimentos()).avisados).toBe(0);
    expect(espiao.enviadas).toHaveLength(1);
    expect(espiao.enviadas[0]?.para).toBe('ana@a.com.br');
  });

  it('cada etapa avisa de novo, porque cada etapa é uma notícia diferente', async () => {
    const espiao = new Espiao();
    const repo = new RepoFalso();
    let agora = dias(28);
    const servico = new ServicoAssinaturas({
      repositorio: repo,
      usuarios: usuariosCom({ ws1: 'ana@a.com.br' }),
      logger: loggerSilencioso,
      notificador: espiao,
      agora: () => agora,
    });
    await repo.salvar(paga('pecas', 30));

    await servico.avisarVencimentos(); // vencendo
    agora = dias(33);
    await servico.avisarVencimentos(); // carência
    agora = dias(40);
    await servico.avisarVencimentos(); // bloqueada

    expect(espiao.enviadas).toHaveLength(3);
    expect(espiao.enviadas[1]?.assunto).toContain('venceu');
    expect(espiao.enviadas[2]?.assunto).toContain('PARADA');
  });

  it('o aviso de bloqueio diz que silêncio deixou de significar "nada houve"', async () => {
    /*
     * A frase que justifica o recurso inteiro. O advogado que recebe aviso de
     * movimentação para de conferir à mão e passa a ler silêncio como
     * tranquilidade. Se a vigilância parar e ninguém disser, o silêncio
     * continua parecendo tranquilidade — e é assim que se perde prazo por
     * culpa nossa.
     */
    const espiao = new Espiao();
    const { servico, repo } = montar({ agora: dias(40), notificador: espiao });
    await repo.salvar(paga('pecas', 10));

    await servico.avisarVencimentos();
    const texto = espiao.enviadas[0]?.texto ?? '';
    expect(texto).toContain('NÃO receber e-mail');
    expect(texto).toContain('tribunal');
    // E precisa deixar claro que os dados não sumiram, senão o e-mail lê como
    // ameaça e a pessoa some.
    expect(texto).toContain('continuam guardados');
  });

  it('falha no envio NÃO marca a etapa como avisada', async () => {
    // Marcar antes de confirmar transformaria uma queda de SMTP em "já
    // avisamos" — e o assinante nunca mais receberia este aviso, porque a
    // etapa não volta atrás.
    const espiao = new Espiao();
    espiao.aceitar = false;
    const { servico, repo } = montar({ agora: dias(28), notificador: espiao });
    await repo.salvar(paga('pecas', 30));

    expect((await servico.avisarVencimentos()).avisados).toBe(0);
    expect(await repo.ultimoAviso('ws1')).toBeUndefined();

    espiao.aceitar = true;
    expect((await servico.avisarVencimentos()).avisados).toBe(1);
  });

  it('renovar depois do aviso permite avisar de novo no ciclo seguinte', async () => {
    const espiao = new Espiao();
    const { servico, repo } = montar({ agora: dias(28), notificador: espiao });
    await repo.salvar(paga('pecas', 30));
    await servico.avisarVencimentos();

    await servico.liberar({ workspace: 'ws1', plano: 'pecas', meses: 1 });
    expect(await repo.ultimoAviso('ws1')).toBeUndefined();
  });

  it('não avisa quem cancelou', async () => {
    const espiao = new Espiao();
    const { servico, repo } = montar({ agora: dias(28), notificador: espiao });
    await repo.salvar(paga('pecas', 30).cancelada(dias(5)));

    expect((await servico.avisarVencimentos()).avisados).toBe(0);
  });

  it('sem canal de aviso não quebra, mas também não finge que avisou', async () => {
    const { servico, repo } = montar({ agora: dias(28) });
    await repo.salvar(paga('pecas', 30));

    expect((await servico.avisarVencimentos()).avisados).toBe(0);
    expect(await repo.ultimoAviso('ws1')).toBeUndefined();
  });

  it('workspace sem conta (chave de API) é pulado sem erro', async () => {
    const espiao = new Espiao();
    const { servico, repo } = montar({ agora: dias(28), notificador: espiao });
    await repo.salvar(paga('pecas', 30, 'integracao'));

    expect((await servico.avisarVencimentos()).avisados).toBe(0);
    expect(espiao.enviadas).toHaveLength(0);
  });
});

describe('ServicoAssinaturas.resumo', () => {
  it('traz a frase pronta para a tela quando o teste está acabando', async () => {
    const { servico, repo } = montar({ agora: dias(12) });
    await repo.salvar(assinaturaDeTeste({ workspace: 'ws1', plano: 'pecas', agora: T0 }));

    const r = await servico.resumo('ws1');
    expect(r?.status).toBe('teste');
    expect(r?.aviso).toContain('teste termina');
  });

  it('não inventa aviso quando falta muito', async () => {
    const { servico, repo } = montar();
    await repo.salvar(paga('pecas', 90));

    const r = await servico.resumo('ws1');
    expect(r?.aviso).toBeUndefined();
    expect(r?.nomeDoPlano).toBe('Peças');
  });
});
