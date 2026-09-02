import { carregarConfig } from '../../infrastructure/config/env.js';
import { montarAplicacao } from '../factories/makeProcessoSearchService.js';
import { iniciar } from './servidor.js';

/**
 * Ponto de entrada do serviço HTTP — é o comando que o contêiner executa.
 *
 * A validação de configuração acontece ANTES do `listen`. Um serviço que sobe
 * com configuração inválida e só falha na primeira requisição do cliente passa
 * no health check e engana o painel de deploy; falhar aqui deixa o erro visível
 * no log de deploy, que é onde alguém está olhando.
 */
const config = carregarConfig();

// Guarda de segurança: sem chave de API e sem desativação explícita, o serviço
// se recusa a subir. A alternativa — abrir sozinho na internet — transformaria
// o VPS em proxy gratuito para a cota compartilhada do DataJud.
if (config.http.chavesDeApi.length === 0 && !config.http.autenticacaoDesativada) {
  console.error(
    'Configuração recusada: defina LEXFLOW_API_KEYS com ao menos uma chave, ' +
      'ou LEXFLOW_AUTH_DISABLED=true se o serviço só será acessível pela rede interna.',
  );
  process.exit(1);
}

const app = montarAplicacao(config);

iniciar(app, config).catch((erro: unknown) => {
  console.error('Falha ao iniciar o LexFlow:', erro);
  process.exit(1);
});
