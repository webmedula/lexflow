# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).
Versionamento semântico: enquanto estiver em `0.x`, mudanças incompatíveis
entram como *minor*.

**Como descobrir qual versão você tem:** `node -p "require('./package.json').version"`
na raiz do projeto, ou o campo `versao` na resposta de `GET /health`.

---

## [0.8.0] — 2026-09-05

**O LexFlow deixa de ser consulta avulsa e vira produto de acompanhamento.**

### ⚠️ Ação necessária no deploy

Monte um **volume em `/dados`** no Easypanel (aba Mounts). Sem ele, o banco vive
dentro do contêiner e é apagado a cada redeploy — a carteira do usuário some.
Ver [DEPLOY.md](./DEPLOY.md).

A imagem passou para **Node 24**, exigido pelo `node:sqlite`.

### Adicionado

- **Acompanhamento de processos.** O usuário marca um processo e o LexFlow passa
  a verificá-lo sozinho. A primeira consulta acontece na hora de adicionar, para
  o processo já aparecer preenchido na lista.
- **Feed de atualizações.** Só o que apareceu DEPOIS de você começar a
  acompanhar, em ordem cronológica, com marcação de lido. Para um advogado, é
  provavelmente a tela mais útil: não "meus 40 processos", e sim "o que mudou".
- **Varredura automática em segundo plano**, a cada 12h por padrão, com disparo
  manual pela tela. Sequencial e com pausa entre consultas — paralelizar contra
  a chave compartilhada do CNJ queimaria a cota de todo o país.
- **Navegação de verdade**: Atualizações, Meus processos e Buscar, com detalhe do
  processo e volta.
- **Filtros** na lista (texto, tribunal, classe, período, só com novidade,
  ordenação) e no feed (não lidas, tribunal), alimentados por facetas reais do
  banco.
- **Espaços isolados por chave de API.** Enquanto não há contas de usuário, cada
  chave é um assinante com sua própria carteira. A coluna `workspace` já existe
  no banco, então migrar para login não mexe no modelo.
- Persistência em **SQLite** via `node:sqlite` — sem dependência nativa, sem
  toolchain de compilação no Alpine, sem serviço extra para subir.
- 34 testes novos (total: 218), incluindo isolamento entre workspaces, detecção
  de novidade entre duas varreduras e idempotência da sincronização.

### Decisões que vale registrar

**Por que banco agora, depois de eu ter recusado.** Recusei quando o motivo era
"guardar processos" — não havia o que guardar além de ficção. Duas medidas
mudaram isso: a consulta fria ao CNJ leva ~20s (medido: `took: 20514`), então o
usuário não pode esperar pela fonte; e "o que mudou desde ontem" é irrespondível
sem ter o ontem. O banco deixou de ser preferência de arquitetura e virou
requisito medido.

**Primeira sincronização não gera novidade.** O histórico inteiro seria "novo";
despejar 361 avisos em quem acabou de adicionar o processo não ajuda ninguém.

**Movimentação que some da fonte não vira alarme.** Tribunal reescreve e remove
andamento; tratar ausência como evento geraria alarme falso a cada oscilação, e
alarme falso corrói a confiança no aviso que importa.

**Falha ao adicionar não desfaz o acompanhamento.** O processo fica na lista com
o motivo, e a varredura tenta de novo — senão o usuário teria que readicionar
toda vez que o tribunal saísse do ar.

---

## [0.7.0] — 2026-09-05

Foco: a tela mostrar o que importa, e a data certa.

### Corrigido

- **A data de distribuição aparecia um dia antes.** O formato compacto do CNJ
  (`"20150826000000"`) não declara fuso, e eu o interpretava como UTC — que,
  exibido em horário de Brasília, volta para 25/08. Aparecia na tela como
  "Distribuição 25/08/2015" para um processo distribuído em 26/08. Agora é
  interpretado como UTC−03:00, que é como o CNJ carimba. Teste novo verifica a
  data **exibida**, não só a existência dela: o teste anterior passava com a data
  errada.

### Adicionado

- **Cabeçalho com o estado do processo**: número em destaque, classe e assunto,
  selos de tribunal/grau/fonte, e um bloco "última movimentação" com o tempo
  decorrido em linguagem natural ("há 2 meses").
- **Linha do tempo organizada**, no lugar da lista plana de 361 itens:
  - agrupada por ano, com o ano fixo no topo enquanto se rola;
  - repetições idênticas no mesmo dia colapsadas em um item com `×N` — o CNJ
    registra "Confirmada" duas e três vezes seguidas;
  - **andamentos internos recolhidos por padrão** (confirmações, expedições,
    juntadas de documento). Numa resposta real de 361 andamentos, isso reduz a
    124 o que aparece de primeira — 66% do volume é registro de cartório que não
    muda o estado do processo;
  - **marcos em destaque** (distribuição, sentença, trânsito em julgado, alvará,
    decurso de prazo).
- Metadados em grade, com contagem total de andamentos.

### Importante sobre o que fica recolhido

Nada é descartado. A contagem do que foi recolhido fica sempre visível, um
clique reverte, e a escolha é lembrada no navegador. Sumir com movimentação em
silêncio é como se perde prazo — o mesmo princípio que fez a data em formato
desconhecido passar a falhar alto na v0.5.0.

A classificação entre "interno" e "marco" usa códigos da Tabela Processual
Unificada observados numa resposta real do TJGO, mas quem decide o que importa é
quem advoga. Se estiver errada, é a tabela que muda — o dado continua todo lá.

---

## [0.6.0] — 2026-09-04

**O sistema passou a ter tela.**

### Adicionado

- **Console web em `/`**, servido pela própria API. Abrir o domínio no navegador
  agora abre o sistema: campo para a chave, consulta por número CNJ ou por OAB,
  e o processo renderizado com partes e movimentações.

  Motivo: até aqui o LexFlow era só API. Digitar a URL no navegador devolvia
  `{"erro":"NAO_AUTENTICADO"}`, porque navegador não manda header customizado —
  e do lado de quem usa, isso é indistinguível de "não funciona". Servindo da
  mesma origem, a página manda o `x-api-key` sozinha: sem CORS, sem PowerShell,
  sem curl.

- A tela mostra **cronômetro e aviso durante a espera**, porque a consulta fria
  ao CNJ leva até um minuto — sem isso, a página pareceria travada.
- Cada código de erro vira explicação em português, incluindo o 501 de busca por
  OAB (que o DataJud não faz) e o 502 de fonte externa lenta ou fora.
- A ausência de partes é dita na tela em vez de aparecer como espaço vazio: a
  base do CNJ não publica partes nem advogados.
- 8 testes novos (total: 180), incluindo que a raiz abre sem chave, que as rotas
  de dados **continuam** protegidas, e que a página não carrega nada de fora.

### Notas

O console é uma ferramenta de operação para conferir o serviço, não o produto
final: a chave de API fica no navegador de quem opera. O produto terá contas de
usuário, e a chave nunca chegará ao navegador do advogado.

Sem framework, sem build, sem recurso externo — a página é uma string que o
servidor devolve. Nada para compilar e nada que quebre em deploy.

---

## [0.5.0] — 2026-09-04

**Primeira versão validada contra uma resposta real da API do CNJ.** Até aqui,
todo o adapter do DataJud tinha sido escrito e testado contra um fixture que eu
inventei a partir da documentação. A primeira captura real derrubou duas
suposições no primeiro minuto.

### Corrigido

- **`dataAjuizamento` não é ISO.** Vem como `"20150826000000"`
  (`yyyyMMddHHmmss`), enquanto `movimentos[].dataHora` no MESMO documento vem em
  ISO 8601. O mapper fazia `new Date()` nos dois: o compacto virava
  `Invalid Date`, que virava `undefined`, e o processo era entregue "com
  sucesso" **sem data de distribuição**. Nenhum dos 161 testes pegou, porque
  todos validavam a minha suposição contra ela mesma.
- **Timeout curto demais fazia toda consulta fria falhar.** O Elasticsearch
  público do CNJ reportou `took: 20514` — 20,5 segundos — numa busca por número
  em índice frio. O teto era 8s. O erro saía como "timeout ao contatar a API do
  CNJ", que parece problema de rede e mandou a investigação para o lado errado.
  Consultas: 60s e 2 tentativas. Health check: 15s (era 5s) e 1 tentativa.

### Alterado

- **Data em formato desconhecido agora falha alto** (`RespostaInvalidaError`,
  nomeando campo e valor) em vez de virar `undefined`. Num produto onde a data
  decide prazo, entregar campo vazio é pior que recusar a resposta — o
  orquestrador ainda pode tentar outra fonte, mas ninguém reage a um campo que
  sumiu em silêncio. Campo AUSENTE continua sendo ausência, não erro.
- `tests/fixtures/datajud-tjgo-real.json` substitui o fixture inventado.
  Captura real do TJGO, valores intocados, lista de movimentos reduzida
  mantendo um exemplar de cada forma. Daqui em diante, o comportamento do CNJ se
  testa contra o que ele devolve.

### Confirmado pelo dado real

- Zero partes, zero advogados, zero inteiro teor. A busca por OAB não sai do
  DataJud — é o que sustenta a existência do crawler próprio no desenho.
- O processo do TJGO usado na captura roda em **eproc**
  (`"sistema": {"nome": "Eproc"}`), não Projudi.

### Em aberto

60 segundos é tempo demais para um usuário esperando numa tela. Este release
torna a consulta possível, não confortável. A saída é buscar em segundo plano e
servir do armazenamento, com o usuário fora do caminho crítico da fonte — e é
essa lentidão medida, não uma preferência de arquitetura, que passa a justificar
um banco.

---

## [0.4.2] — 2026-09-03

Foco: o health check do DataJud dava timeout contra a API real.

### Corrigido

- **A consulta de verificação era `match_all` no índice do TJSP** — o maior
  tribunal do país. Mesmo com `size: 0`, isso faz o Elasticsearch percorrer e
  contar o índice inteiro: a query mais cara possível, disparada a cada
  `/ready`. Contra a API pública compartilhada e sob carga, dava timeout, e o
  LexFlow concluía "fonte fora do ar" com a fonte no ar. Agora a consulta casa
  com zero documentos (um número CNJ de vinte zeros), que responde a mesma
  pergunta — "consigo falar com a fonte e ela me aceita?" — de graça.
- **O health check herdava a política de retry das consultas de usuário**
  (3 tentativas × 8s + backoff): o `/ready` podia levar mais de 25 segundos só
  para dizer que a fonte estava fora — tempo suficiente para um orquestrador de
  contêiner concluir que o serviço inteiro morreu. Agora é tentativa única com
  teto de 5s.

### Adicionado

- `OpcoesRequisicao` no `HttpClient`: `timeoutMs` e `tentativas` por chamada,
  sobrepondo o padrão do cliente. Nem toda requisição merece a mesma política —
  consulta de usuário compensa esperar e insistir, health check não.
- 7 testes novos, incluindo a política de retry do `HttpClient` contra `fetch`
  dublado (total: 161).

---

## [0.4.1] — 2026-09-03

Foco: impedir que texto de exemplo vire credencial.

### Corrigido

- **O bloco de configuração do `DEPLOY.md` trazia placeholders não vazios**
  (`DATAJUD_API_KEY=COLE_AQUI_A_CHAVE_DO_CNJ_OU_DEIXE_VAZIO`). Colado como
  estava, o valor passava em toda checagem de presença: o adapter do DataJud
  subia com uma credencial de mentira, entrava na cadeia e só falhava com 401 —
  aparecendo no `/ready` como problema de disponibilidade, não de configuração.
  Os blocos agora vêm com os valores realmente vazios e a instrução em
  comentário.

### Adicionado

- `pareceValorDeExemplo()` — detecta placeholder não substituído. A heurística é
  conservadora de propósito (só maiúsculas/dígitos/`_`/`-` **e** termo suspeito),
  porque falso positivo aqui recusaria credencial legítima.
  - `DATAJUD_API_KEY` com placeholder → fonte tratada como **ausente**, com aviso
    dizendo o que fazer, em vez de virar credencial quebrada.
  - `LEXFLOW_API_KEYS` com placeholder → serviço **recusa subir**. Um placeholder
    de 35 caracteres passaria no mínimo de 24 e viraria a chave de produção.
- 9 testes novos, incluindo o valor exato do incidente (total: 154).

---

## [0.4.0] — 2026-09-02

Foco: tornar `/ready` capaz de explicar o que está errado.

### Corrigido

- **`healthCheck` do DataJud reprovava fonte que estava disponível.** Qualquer
  resposta fora do 2xx marcava a fonte como morta — inclusive um 4xx que não é
  de autenticação, que na verdade significa "cheguei, a chave foi aceita, só a
  consulta de verificação foi recusada". Na prática isso tirava o DataJud da
  cadeia de fallback com ele funcionando. Agora 4xx não-autenticação conta como
  saudável, com uma ressalva no motivo.

### Adicionado

- `diagnosticar()` na porta `ProcessoProvider` — opcional, para não forçar
  migração de adapter existente; quem não implementa cai no `healthCheck`.
- `GET /ready` e `npm run cli -- saude` agora trazem o **motivo** por fonte:
  chave rejeitada (com o link da chave vigente), limite excedido (com o
  parâmetro a ajustar), API do CNJ fora do ar, timeout ou falha de rede.
  Antes, `saudavel: false` era um beco sem saída.
- 9 testes novos cobrindo cada classificação (total: 145).

---

## [0.3.0] — 2026-09-02

Foco: geração e proteção das chaves de API.

### Adicionado

- `npm run chave` — gera chaves de API sem depender de `openssl` (que não existe
  no Windows fora do Git Bash/WSL). Imprime o valor **e** o identificador que
  aparece nos logs, para você anotar qual chave é de qual consumidor.
- Validação de autenticação no arranque (`src/main/http/chaves.ts`): recusa subir
  sem chave, com chave de menos de 24 caracteres, com chaves repetidas, ou com
  `LEXFLOW_AUTH_DISABLED=true` junto de chaves preenchidas.
- Seção completa no `DEPLOY.md` sobre gerar, guardar e rotacionar chaves sem
  downtime.
- 11 testes novos (total: 135).

### Alterado

- **Identificador de chave nos logs agora é hash** (8 hex do SHA-256) em vez dos
  4 primeiros caracteres da chave. O prefixo vazava parte do segredo e deixava
  de distinguir qualquer coisa se as chaves compartilhassem convenção de nome.
- `GET /health` agora informa a versão do serviço.

### Corrigido

- Documentação recomendava `openssl rand -hex 32` sem alternativa para Windows.
- Item de troubleshooting sobre "espaço na variável" estava errado: espaços em
  volta das vírgulas sempre foram tolerados.

---

## [0.2.0] — 2026-09-02

Foco: tornar o projeto publicável em servidor.

### Adicionado

- **API HTTP** (Fastify) como segundo adaptador de entrada, sobre os mesmos
  casos de uso do CLI:
  - `GET /v1/processos/:numero`
  - `GET /v1/advogados/:uf/:oab/processos`
  - `GET /health` (liveness, não consulta fonte externa)
  - `GET /ready` (readiness, com diagnóstico por fonte)
- Autenticação por chave de API (`x-api-key` ou `Authorization: Bearer`).
- Rate limit por chave, com health checks fora da cota.
- Mapeamento centralizado de erro de domínio para status HTTP, separando culpa
  do cliente (4xx), falha rio acima (502/503) e bug nosso (500).
- Desligamento gracioso em SIGTERM — redeploy não derruba requisição em voo.
- `Dockerfile` multi-stage, `.dockerignore`, `docker-compose.yml`.
- `DEPLOY.md`: runbook do Easypanel.
- CI no GitHub Actions (typecheck, lint, testes, build da imagem).
- 23 testes de API (total: 124).

### Alterado

- `npm run dev` e `npm start` agora sobem a API. O CLI segue em `npm run cli`.

---

## [0.1.0] — 2026-09-02

Núcleo do MVP.

### Adicionado

- Domínio: `Processo`, `Movimentacao`, `Parte`, e os value objects `NumeroCNJ`
  (com validação de dígito verificador, ISO 7064 MOD 97-10) e `Oab`.
- Porta `ProcessoProvider` com declaração de capacidades por fonte.
- `DataJudAdapter` — API Pública do CNJ, com mapper anticorrupção e validação de
  payload por Zod.
- `MockCrawlerAdapter` — crawler simulado do e-SAJ (TJSP), com falha configurável
  para exercitar o fallback.
- `ProcessoSearchService` — orquestrador com cadeia ordenada, fallback automático
  e distinção entre "não encontrado" e "fonte fora do ar".
- Cache em memória com TTL e LRU, aplicado por decorator.
- Token bucket para autolimitar as chamadas ao DataJud.
- CLI (`processo`, `oab`, `saude`).
- `CLAUDE.md` com regras de código e arquitetura.
- 101 testes.
