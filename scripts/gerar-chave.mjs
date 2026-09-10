#!/usr/bin/env node
/**
 * Gera chaves de API para o LexFlow.
 *
 *   npm run chave                    uma chave
 *   npm run chave -- 3               três chaves
 *   npm run chave -- 3 --env         já no formato da variável de ambiente
 *   npm run chave -- 1 --rotulo n8n  com rótulo, para você saber de quem é
 *   npm run chave -- --cofre         chave do cofre de credenciais (LEXFLOW_CREDENCIAL_CHAVE)
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

/**
 * A chave do cofre é OUTRA coisa que a chave de API, e por isso sai por um
 * caminho separado: são 32 bytes em base64 (o AES-256 exige exatamente isso),
 * contra 32 bytes em hex das chaves de API. Colar uma no lugar da outra derruba
 * o acesso a peças no arranque — com a mensagem certa, mas depois de um deploy
 * perdido.
 *
 * E ela nunca deve ser trocada com credenciais já gravadas: o que está no banco
 * foi cifrado com a chave antiga e vira ilegível, obrigando cada assinante a
 * cadastrar de novo a senha do tribunal.
 */
if (args.includes('--cofre')) {
  const { randomBytes: bytesDoCofre } = await import('node:crypto');
  const chave = bytesDoCofre(32).toString('base64');
  console.log('\nChave do cofre de credenciais (AES-256-GCM):\n');
  console.log(`LEXFLOW_CREDENCIAL_CHAVE=${chave}`);
  console.log(
    '\nGuarde no gerenciador de senhas. Trocar esta chave torna ilegíveis as',
  );
  console.log('credenciais de tribunal já cadastradas — todas precisariam ser');
  console.log('cadastradas outra vez.\n');
  process.exit(0);
}
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
