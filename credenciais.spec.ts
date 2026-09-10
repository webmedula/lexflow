import { describe, expect, it } from 'vitest';
import { abrirBanco } from '../../src/infrastructure/persistencia/sqlite/banco.js';
import { RepositorioCredenciaisSqlite } from '../../src/infrastructure/persistencia/sqlite/RepositorioCredenciaisSqlite.js';
import {
  ChaveDeCifraInvalidaError,
  Cofre,
  SegredoIlegivelError,
} from '../../src/infrastructure/seguranca/cofre.js';

const SENHA = 'senha-do-projudi-2026';

function cofreNovo(): Cofre {
  return Cofre.comChaveBase64(Cofre.gerarChaveBase64());
}

describe('Cofre', () => {
  it('devolve o segredo original depois de cifrar', () => {
    const cofre = cofreNovo();
    expect(cofre.decifrar(cofre.cifrar(SENHA))).toBe(SENHA);
  });

  it('não deixa o segredo aparecer no texto cifrado', () => {
    const cifrado = cofreNovo().cifrar(SENHA);
    expect(cifrado).not.toContain(SENHA);
    expect(cifrado.startsWith('v1.')).toBe(true);
  });

  it('produz cifras diferentes para o mesmo segredo', () => {
    // IV aleatório por gravação: senhas iguais de assinantes diferentes não
    // podem produzir a mesma linha no banco, senão o banco vira um oráculo de
    // "estes dois usam a mesma senha".
    const cofre = cofreNovo();
    expect(cofre.cifrar(SENHA)).not.toBe(cofre.cifrar(SENHA));
  });

  it('recusa segredo adulterado em vez de devolver lixo', () => {
    const cofre = cofreNovo();
    const cifrado = cofre.cifrar(SENHA);
    const [v, iv, tag, dados] = cifrado.split('.');
    const mexido = [v, iv, tag, `${(dados ?? '').slice(0, -2)}AA`].join('.');

    expect(() => cofre.decifrar(mexido)).toThrow(SegredoIlegivelError);
  });

  it('recusa decifrar com outra chave', () => {
    const cifrado = cofreNovo().cifrar(SENHA);
    expect(() => cofreNovo().decifrar(cifrado)).toThrow(SegredoIlegivelError);
  });

  it('recusa chave de tamanho errado no arranque', () => {
    expect(() => Cofre.comChaveBase64(Buffer.from('curta').toString('base64'))).toThrow(
      ChaveDeCifraInvalidaError,
    );
  });
});

describe('RepositorioCredenciaisSqlite', () => {
  function montar(cofre = cofreNovo()): {
    repo: RepositorioCredenciaisSqlite;
    db: ReturnType<typeof abrirBanco>;
  } {
    const db = abrirBanco(':memory:');
    return { repo: new RepositorioCredenciaisSqlite(db, cofre), db };
  }

  it('devolve a credencial que foi guardada', async () => {
    const { repo, db } = montar();
    await repo.salvar('ws1', {
      tribunal: 'TJGO',
      identificacao: '123',
      senha: SENHA,
    });

    const obtida = await repo.obter('ws1', 'TJGO');
    expect(obtida?.senha).toBe(SENHA);
    db.close();
  });

  it('grava a senha cifrada, nunca em claro', async () => {
    const { repo, db } = montar();
    await repo.salvar('ws1', { tribunal: 'TJGO', identificacao: '123', senha: SENHA });

    const linha = db
      .prepare('SELECT senha_cifrada FROM credenciais_tribunal')
      .get() as unknown as { senha_cifrada: string };

    expect(linha.senha_cifrada).not.toContain(SENHA);
    db.close();
  });

  it('não expõe a senha na listagem', async () => {
    const { repo, db } = montar();
    await repo.salvar('ws1', { tribunal: 'TJGO', identificacao: '123', senha: SENHA });

    const lista = await repo.listar('ws1');
    expect(JSON.stringify(lista)).not.toContain(SENHA);
    db.close();
  });

  it('isola workspaces', async () => {
    const { repo, db } = montar();
    await repo.salvar('ws1', { tribunal: 'TJGO', identificacao: '123', senha: SENHA });

    expect(await repo.obter('ws2', 'TJGO')).toBeUndefined();
    db.close();
  });

  it('trata credencial ilegível como ausente, para pedir novo cadastro', async () => {
    // É o que acontece quando LEXFLOW_CREDENCIAL_CHAVE muda entre deploys.
    // Devolver "ausente" leva o usuário a recadastrar, que é a saída correta;
    // estourar deixaria a tela quebrada sem dizer o que fazer.
    const db = abrirBanco(':memory:');
    const gravador = new RepositorioCredenciaisSqlite(db, cofreNovo());
    await gravador.salvar('ws1', {
      tribunal: 'TJGO',
      identificacao: '123',
      senha: SENHA,
    });

    const leitor = new RepositorioCredenciaisSqlite(db, cofreNovo());
    expect(await leitor.obter('ws1', 'TJGO')).toBeUndefined();
    db.close();
  });

  it('limpa a marca de recusa quando a credencial é recadastrada', async () => {
    const { repo, db } = montar();
    await repo.salvar('ws1', { tribunal: 'TJGO', identificacao: '123', senha: SENHA });
    await repo.registrarRecusa('ws1', 'TJGO');
    expect((await repo.listar('ws1'))[0]?.recusadaEm).toBeInstanceOf(Date);

    await repo.salvar('ws1', { tribunal: 'TJGO', identificacao: '123', senha: 'nova' });
    expect((await repo.listar('ws1'))[0]?.recusadaEm).toBeUndefined();
    db.close();
  });

  it('trata a sigla do tribunal sem diferenciar maiúscula de minúscula', async () => {
    const { repo, db } = montar();
    await repo.salvar('ws1', { tribunal: 'tjgo', identificacao: '123', senha: SENHA });

    expect((await repo.obter('ws1', 'TJGO'))?.senha).toBe(SENHA);
    db.close();
  });

  it('informa quando não havia o que remover', async () => {
    const { repo, db } = montar();
    expect(await repo.remover('ws1', 'TJGO')).toBe(false);
    db.close();
  });
});
