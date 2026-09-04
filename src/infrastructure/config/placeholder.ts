/**
 * Detecta valor de exemplo que ninguém substituiu.
 *
 * Nasceu de um caso real: o bloco de configuração da documentação trazia
 * `DATAJUD_API_KEY=COLE_AQUI_A_CHAVE_DO_CNJ_OU_DEIXE_VAZIO`. Colado como estava,
 * o valor não é vazio — então o adapter do DataJud era construído normalmente,
 * entrava na cadeia e só falhava com 401 na primeira consulta. O sintoma
 * (`saudavel: false` no /ready) apontava para "chave errada", e não para "essa
 * variável nunca foi preenchida".
 *
 * Um placeholder é PIOR do que um valor vazio: vazio é uma condição que o código
 * trata explicitamente; placeholder passa por toda validação de presença e só
 * quebra lá na frente, longe da causa.
 *
 * A heurística é deliberadamente conservadora — falso positivo aqui significa
 * recusar uma credencial legítima, o que é pior do que deixar passar um
 * placeholder exótico. Só acusa quando as DUAS condições valem:
 *
 *   1. o valor é só MAIÚSCULAS, dígitos, `_` e `-`  — formato de placeholder,
 *      não de credencial (chave em hex é minúscula; base64 mistura caixa);
 *   2. contém um dos termos abaixo, que nenhuma credencial real teria.
 */
const TERMOS_DE_PLACEHOLDER = [
  'COLE',
  'COLAR',
  'AQUI',
  'SUACHAVE',
  'SUA_CHAVE',
  'SEUDOMINIO',
  'SEU_DOMINIO',
  'PREENCHA',
  'SUBSTITUA',
  'TROQUE',
  'INSIRA',
  'PLACEHOLDER',
  'CHANGEME',
  'CHANGE_ME',
  'YOURKEY',
  'YOUR_KEY',
  'PASTE',
  'EXEMPLO',
  'EXAMPLE',
  'TODO',
  'XXXX',
];

/** Só maiúsculas, dígitos, `_` e `-`: cara de rótulo, não de segredo. */
const FORMATO_DE_ROTULO = /^[A-Z0-9_-]+$/;

export function pareceValorDeExemplo(valor: string): boolean {
  const limpo = valor.trim();
  if (limpo === '') return false;
  if (!FORMATO_DE_ROTULO.test(limpo)) return false;

  const semSeparadores = limpo.replace(/[_-]/g, '');
  return TERMOS_DE_PLACEHOLDER.some(
    (termo) => limpo.includes(termo) || semSeparadores.includes(termo.replace(/_/g, '')),
  );
}
