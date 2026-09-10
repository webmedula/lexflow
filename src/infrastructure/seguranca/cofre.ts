import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Cifra simétrica para os segredos que o sistema precisa PODER LER de volta.
 *
 * É o oposto do que se faz com senha de login: lá o certo é hash irreversível
 * (`scrypt`), porque ninguém nunca precisa da senha original. Aqui precisa — a
 * senha do advogado no tribunal vai dentro do envelope SOAP a cada consulta. Não
 * dá para hashear o que se vai apresentar a terceiros.
 *
 * AES-256-GCM e não CBC: o GCM autentica além de cifrar, então adulterar o texto
 * cifrado no banco produz erro de decifração em vez de um "segredo" corrompido
 * que só falha lá no tribunal, parecendo senha errada do usuário.
 *
 * Formato gravado: `v1.<iv>.<tag>.<cifra>`, tudo base64url. O prefixo de versão
 * existe para o dia em que o algoritmo mudar: sem ele, migrar exigiria adivinhar
 * o formato de cada linha antiga.
 */

const VERSAO = 'v1';
const ALGORITMO = 'aes-256-gcm';
/** 96 bits é o IV recomendado para GCM — outro tamanho degrada a garantia. */
const TAMANHO_IV = 12;
const TAMANHO_CHAVE = 32;

export class ChaveDeCifraInvalidaError extends Error {
  constructor(motivo: string) {
    super(
      `LEXFLOW_CREDENCIAL_CHAVE inválida: ${motivo}. ` +
        'Gere uma com `npm run chave -- --cofre`.',
    );
    this.name = 'ChaveDeCifraInvalidaError';
  }
}

export class SegredoIlegivelError extends Error {
  constructor(motivo: string, options?: { cause?: unknown }) {
    super(`Não foi possível decifrar o segredo guardado: ${motivo}`, options);
    this.name = 'SegredoIlegivelError';
  }
}

/**
 * Guarda-segredos. Recebe a chave já decodificada para que a validação aconteça
 * UMA vez, no arranque, e não a cada consulta ao tribunal.
 */
export class Cofre {
  private readonly chave: Buffer;

  constructor(chave: Buffer) {
    if (chave.length !== TAMANHO_CHAVE) {
      throw new ChaveDeCifraInvalidaError(
        `a chave tem ${chave.length} bytes e o AES-256 exige ${TAMANHO_CHAVE}`,
      );
    }
    this.chave = chave;
  }

  /**
   * @param chaveBase64 32 bytes em base64 (ou base64url).
   * @throws {ChaveDeCifraInvalidaError}
   */
  static comChaveBase64(chaveBase64: string): Cofre {
    const limpa = chaveBase64.trim();
    if (!limpa) throw new ChaveDeCifraInvalidaError('variável vazia');

    let bytes: Buffer;
    try {
      bytes = Buffer.from(limpa, 'base64');
    } catch (erro) {
      throw new ChaveDeCifraInvalidaError(`não é base64 (${descrever(erro)})`);
    }
    return new Cofre(bytes);
  }

  static gerarChaveBase64(): string {
    return randomBytes(TAMANHO_CHAVE).toString('base64');
  }

  cifrar(texto: string): string {
    const iv = randomBytes(TAMANHO_IV);
    const cifra = createCipheriv(ALGORITMO, this.chave, iv);
    const dados = Buffer.concat([cifra.update(texto, 'utf8'), cifra.final()]);
    const tag = cifra.getAuthTag();

    return [
      VERSAO,
      iv.toString('base64url'),
      tag.toString('base64url'),
      dados.toString('base64url'),
    ].join('.');
  }

  /** @throws {SegredoIlegivelError} */
  decifrar(guardado: string): string {
    const partes = guardado.split('.');
    const [versao, ivB64, tagB64, dadosB64] = partes;

    if (partes.length !== 4 || versao !== VERSAO || !ivB64 || !tagB64 || !dadosB64) {
      throw new SegredoIlegivelError(
        'formato desconhecido — o registro não foi gravado por esta versão do cofre',
      );
    }

    try {
      const decifra = createDecipheriv(
        ALGORITMO,
        this.chave,
        Buffer.from(ivB64, 'base64url'),
      );
      decifra.setAuthTag(Buffer.from(tagB64, 'base64url'));
      return Buffer.concat([
        decifra.update(Buffer.from(dadosB64, 'base64url')),
        decifra.final(),
      ]).toString('utf8');
    } catch (erro) {
      // A causa quase sempre é a chave ter mudado entre o deploy que gravou e o
      // que está lendo — e a mensagem precisa dizer isso, porque a alternativa é
      // alguém concluir que o banco corrompeu e restaurar backup à toa.
      throw new SegredoIlegivelError(
        'a autenticação da cifra falhou; a chave em LEXFLOW_CREDENCIAL_CHAVE ' +
          'provavelmente não é a mesma que gravou este registro',
        { cause: erro },
      );
    }
  }
}

function descrever(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}
