import { createHash, randomBytes } from 'node:crypto';
import type { ChavesDeApi } from '../../domain/ports/Criptografia.js';

/** 256 bits — o mesmo tamanho que `npm run chave` gera para o `.env`. */
const TAMANHO_EM_BYTES = 32;

/**
 * Implementação real de `ChavesDeApi`: `randomBytes` do CSPRNG do sistema para
 * gerar, SHA-256 para o hash que vai ao banco.
 *
 * É a MESMA função de hash que `identificarChave`/`workspaceDaChave`, em
 * `main/http/chaves.ts`, aplicam às chaves estáticas do `.env` — só que aqui
 * ela mora em `infrastructure/` porque é isto que `ServicoChavesApi`
 * (em `application/`) recebe injetado, em vez de importar `main/` direto e
 * inverter a direção de dependência do projeto.
 */
export const chavesDeApi: ChavesDeApi = {
  gerar: () => randomBytes(TAMANHO_EM_BYTES).toString('hex'),
  hash: (chave) => createHash('sha256').update(chave).digest('hex'),
};
