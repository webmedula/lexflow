import { readFileSync } from 'node:fs';

/**
 * Versão do serviço, lida do package.json em tempo de execução.
 *
 * Ler do package.json em vez de manter uma constante duplicada evita o clássico
 * "a versão do log não bate com a do repositório" — que é justamente o momento
 * em que você mais precisa confiar nela: olhando o log de um contêiner e
 * tentando descobrir se o deploy realmente pegou.
 *
 * O caminho relativo funciona tanto rodando de `src/` (tsx) quanto de `dist/`
 * (produção): as duas árvores têm a mesma profundidade até a raiz do projeto.
 */
function lerVersao(): string {
  try {
    const caminho = new URL('../../../package.json', import.meta.url);
    const conteudo = readFileSync(caminho, 'utf8');
    const pacote: unknown = JSON.parse(conteudo);
    if (
      typeof pacote === 'object' &&
      pacote !== null &&
      typeof (pacote as { version?: unknown }).version === 'string'
    ) {
      return (pacote as { version: string }).version;
    }
    return 'desconhecida';
  } catch {
    // Não vale derrubar o serviço por não saber a própria versão.
    return 'desconhecida';
  }
}

export const VERSAO = lerVersao();
