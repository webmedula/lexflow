#!/usr/bin/env node
/**
 * Gera chaves de API para o LexFlow.
 *
 *   npm run chave                    uma chave
 *   npm run chave -- 3               três chaves
 *   npm run chave -- 3 --env         já no formato da variável de ambiente
 *   npm run chave -- 1 --rotulo n8n  com rótulo, para você saber de quem é
 *
 * Existe por dois motivos práticos:
 *
 * 1. `openssl rand -hex 32` não existe no Windows sem Git Bash ou WSL. Este
 *    script roda em qualquer lugar que o projeto rode, porque usa o Node que
 *    você já tem.
 * 2. Ele imprime, junto da chave, o IDENTIFICADOR que vai aparecer nos logs
 *    (hash curto). É o que permite olhar uma linha de log meses depois e saber
 *    de qual integração veio a requisição — sem a chave nunca ter sido anotada
 *    em lugar nenhum além do seu gerenciador de senhas.
 *
 * A aleatoriedade vem de `randomBytes`, que é o CSPRNG do sistema. Nunca use
 * Math.random para isso: ele é previsível a partir de algumas saídas.
 */
import { createHash, randomBytes } from 'node:crypto';

const BYTES = 32; // 256 bits → 64 caracteres em hex

const args = process.argv.slice(2);
const formatoEnv = args.includes('--env');
const indiceRotulo = args.indexOf('--rotulo');
const rotulo = indiceRotulo >= 0 ? args[indiceRotulo + 1] : undefined;

const quantidade = Number(args.find((a) => /^\d+$/.test(a)) ?? '1');
if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > 20) {
  console.error('Quantidade inválida. Use um número de 1 a 20.');
  process.exit(1);
}

const chaves = Array.from({ length: quantidade }, () =>
  randomBytes(BYTES).toString('hex'),
);

const identificar = (chave) =>
  createHash('sha256').update(chave).digest('hex').slice(0, 8);

if (formatoEnv) {
  console.log(`LEXFLOW_API_KEYS=${chaves.join(',')}`);
  console.error('');
  console.error('Identificadores (aparecem no log, guarde ao lado do nome de cada consumidor):');
  for (const chave of chaves) console.error(`  ${identificar(chave)}`);
  process.exit(0);
}

console.log('');
for (const [indice, chave] of chaves.entries()) {
  const nome = rotulo ?? `chave ${indice + 1}`;
  console.log(`  ${nome}`);
  console.log(`    valor .......... ${chave}`);
  console.log(`    identificador .. ${identificar(chave)}`);
  console.log('');
}

console.log('Como usar:');
console.log('  .env local ....... LEXFLOW_API_KEYS=' + chaves.join(','));
console.log('  Easypanel ........ aba Environment, mesma linha acima');
console.log('');
console.log('A chave NÃO fica salva em lugar nenhum — copie agora para o seu');
console.log('gerenciador de senhas. Se perder, gere outra e substitua.');
console.log('');
