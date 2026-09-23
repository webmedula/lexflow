import type { DatabaseSync } from 'node:sqlite';
import { Assinatura } from '../../../domain/entities/Assinatura.js';
import { ehCodigoDePlano } from '../../../domain/entities/Plano.js';
import { PlanoDesconhecidoError } from '../../../domain/errors/index.js';
import { CODIGOS_DE_PLANO } from '../../../domain/entities/Plano.js';
import type {
  EtapaDeAviso,
  RepositorioAssinaturas,
} from '../../../domain/ports/RepositorioAssinaturas.js';

interface LinhaAssinatura {
  workspace: string;
  plano: string;
  inicio_em: string;
  vence_em: string;
  eh_teste: number;
  dias_carencia: number;
  cancelada_em: string | null;
  observacao: string | null;
  ultimo_aviso: string | null;
}

function paraDominio(l: LinhaAssinatura): Assinatura {
  // O plano vem do banco como texto livre. Validar aqui, na borda, é o que
  // impede uma linha editada à mão de virar um objeto com um plano inexistente
  // circulando pelo domínio — onde o erro apareceria longe da causa.
  if (!ehCodigoDePlano(l.plano)) {
    throw new PlanoDesconhecidoError(l.plano, CODIGOS_DE_PLANO);
  }

  return new Assinatura({
    workspace: l.workspace,
    plano: l.plano,
    inicioEm: new Date(l.inicio_em),
    venceEm: new Date(l.vence_em),
    ehTeste: l.eh_teste === 1,
    diasDeCarencia: l.dias_carencia,
    ...(l.cancelada_em ? { canceladaEm: new Date(l.cancelada_em) } : {}),
    ...(l.observacao ? { observacao: l.observacao } : {}),
  });
}

const ETAPAS: readonly string[] = ['vencendo', 'carencia', 'bloqueada'];

export class RepositorioAssinaturasSqlite implements RepositorioAssinaturas {
  constructor(private readonly db: DatabaseSync) {}

  async porWorkspace(workspace: string): Promise<Assinatura | undefined> {
    const linha = this.db
      .prepare('SELECT * FROM assinaturas WHERE workspace = ?')
      .get(workspace) as unknown as LinhaAssinatura | undefined;
    return linha ? paraDominio(linha) : undefined;
  }

  async salvar(a: Assinatura): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO assinaturas
           (workspace, plano, inicio_em, vence_em, eh_teste, dias_carencia,
            cancelada_em, observacao, ultimo_aviso)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT (workspace) DO UPDATE SET
           plano         = excluded.plano,
           inicio_em     = excluded.inicio_em,
           vence_em      = excluded.vence_em,
           eh_teste      = excluded.eh_teste,
           dias_carencia = excluded.dias_carencia,
           cancelada_em  = excluded.cancelada_em,
           observacao    = excluded.observacao,
           -- Vigência nova, escrituração de aviso zerada. Sem isto, quem
           -- renovasse depois de receber o aviso de vencimento nunca mais
           -- seria avisado — o campo ficaria preso em 'vencendo' para sempre.
           ultimo_aviso  = NULL`,
      )
      .run(
        a.workspace,
        a.plano,
        a.inicioEm.toISOString(),
        a.venceEm.toISOString(),
        a.ehTeste ? 1 : 0,
        a.diasDeCarencia,
        a.canceladaEm ? a.canceladaEm.toISOString() : null,
        a.observacao ?? null,
      );
  }

  async ultimoAviso(workspace: string): Promise<EtapaDeAviso | undefined> {
    const linha = this.db
      .prepare('SELECT ultimo_aviso FROM assinaturas WHERE workspace = ?')
      .get(workspace) as unknown as { ultimo_aviso: string | null } | undefined;
    const valor = linha?.ultimo_aviso;
    return valor && ETAPAS.includes(valor) ? (valor as EtapaDeAviso) : undefined;
  }

  async registrarAviso(workspace: string, etapa: EtapaDeAviso): Promise<void> {
    this.db
      .prepare('UPDATE assinaturas SET ultimo_aviso = ? WHERE workspace = ?')
      .run(etapa, workspace);
  }

  async aVencerAte(limite: Date): Promise<readonly Assinatura[]> {
    // `cancelada_em IS NULL` no SQL, e não filtrando depois: quem cancelou já
    // sabe, e continuar cobrando por e-mail é o caminho mais curto para ser
    // marcado como spam — levando junto o aviso de prazo de todo mundo.
    const linhas = this.db
      .prepare(
        `SELECT * FROM assinaturas
          WHERE cancelada_em IS NULL AND vence_em <= ?
          ORDER BY vence_em ASC`,
      )
      .all(limite.toISOString()) as unknown as LinhaAssinatura[];
    return linhas.map(paraDominio);
  }

  async todas(): Promise<readonly Assinatura[]> {
    const linhas = this.db
      .prepare('SELECT * FROM assinaturas ORDER BY vence_em ASC')
      .all() as unknown as LinhaAssinatura[];
    return linhas.map(paraDominio);
  }
}
