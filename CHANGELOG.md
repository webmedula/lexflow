# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).
Versionamento semântico: enquanto estiver em `0.x`, mudanças incompatíveis
entram como *minor*.

**Como descobrir qual versão você tem:** `node -p "require('./package.json').version"`
na raiz do projeto, ou o campo `versao` na resposta de `GET /health`.

---

## [0.12.0] — 2026-09-10

**As peças das partes.**

Até aqui o sistema mostrava decisões e julgados, e só. Não era limitação do
código: era o teto da fonte. O DJEN é o diário, e diário publica ato judicial —
petição, contestação, laudo e documento juntado pela parte **nunca são
publicados**. O DataJud não tem documento nenhum. Faltava a fonte que tem.

### Adicionado — MNI 2.2.2 do Projudi/TJGO

- **`MniAdapter`**, contra `https://projudi.tjgo.jus.br/IntercomunicacaoService`.
  O TJGO implementa MNI, ao contrário do que a ausência de `pje.tjgo.jus.br`
  sugere — o endereço só não segue o padrão `/intercomunicacao` do PJe, que ali
  responde 404. O link está na página inicial do próprio Projudi.
- **Autenticação por `idConsultante` + `senhaConsultante`**: usuário e senha do
  advogado, dentro do envelope SOAP. Não passa pela tela de login, então não há
  CAPTCHA nem código por e-mail no caminho, e este tribunal não exige
  certificado digital.
- **Entidade `Peca`** separada de `Movimentacao`: a movimentação diz que algo
  aconteceu, a peça é o arquivo. O TEOR não mora na entidade — `Peca` é metadado
  e circula barato; o arquivo sai por rota própria, uma peça por vez, senão uma
  listagem despejaria dezenas de MB na resposta.
- **Porta `ProvedorDePecas`, deliberadamente separada de `ProcessoProvider`.**
  Não é purismo: `CachedProcessoProvider` indexa por número de processo, **sem
  workspace na chave**. Uma fonte com credencial dentro da cadeia serviria ao
  assinante seguinte a resposta obtida com a credencial do anterior.
- Rotas `GET /v1/processos/:numero/pecas` e
  `GET /v1/processos/:numero/pecas/:id` (download como anexo).
- `npm run cli -- pecas <numero>` lendo a credencial do AMBIENTE, não do banco:
  serve para validar o acesso antes de cadastrar ninguém. Com `--capturar`,
  grava a resposta crua do tribunal.

### Adicionado — cofre de credenciais

- **`credenciais_tribunal`, com a senha cifrada em AES-256-GCM.** É o dado mais
  sensível do banco: a chave de API só abre o LexFlow, esta abre o processo no
  tribunal. GCM e não CBC porque o GCM autentica — adulterar a coluna dá erro de
  decifração, e não um "segredo" corrompido que só falha lá no tribunal
  parecendo senha errada do usuário.
- **Sem `LEXFLOW_CREDENCIAL_CHAVE`, o acesso a peças não é montado** e as rotas
  respondem 501 com a instrução. Não existe caminho que guarde senha em claro.
- Chave gerada por `npm run chave -- --cofre`.
- Rotas `GET/PUT/DELETE /v1/credenciais`. A senha nunca volta na resposta — nem
  mascarada: `***` convidaria a interface a exibir um campo "preenchido" que não
  pode ser reenviado, e o próximo salvamento gravaria os asteriscos como senha.

### Descoberto na captura real, e que teria custado caro

Duas armadilhas que nenhum fixture escrito por quem implementa revelaria. As
duas estão gravadas em `tests/fixtures/mni-tjgo-credencial-invalida-real.txt`:

- **A resposta não é XML puro.** Vem em `multipart/related` (Apache CXF, com
  XOP/MTOM). Quem chamar o parser direto sobre o corpo recebe lixo.
- **O teor dos documentos não vem em base64**, embora o WSDL declare
  `xs:base64Binary`. Vem como parte binária separada, referenciada por
  `<xop:Include href="cid:...">`. Um mapper que lesse `conteudo` como base64
  acharia string vazia e concluiria "o tribunal não liberou o arquivo" — com o
  arquivo ali, na parte seguinte da mesma resposta.
- **Recusa vem com HTTP 200.** `sucesso: false` no corpo. Confiar em
  `resposta.ok` faria "Usuário ou Senha inválida." virar consulta bem-sucedida
  com zero peças — indistinguível de "processo sem documentos".

### Segurança e limites, explícitos

- **Uma tentativa, sem retry.** Diferente de todos os outros adapters, e de
  propósito: a requisição carrega a senha do advogado, e o Projudi conta
  tentativa malsucedida para bloquear conta. Retry transformaria senha
  desatualizada em três recusas por consulta, e a vigilância de hora em hora
  levaria ao bloqueio no mesmo dia.
- **30 requisições/minuto**, metade do teto relatado antes de bloqueio de IP de
  datacenter (403, espera de ~30 min). Num VPS o IP é de todos os assinantes.
- **A trava que nenhum código contorna:** o MNI devolve as peças conforme o
  perfil de acesso do consultante. Sem procuração nos autos, o metadado vem e o
  conteúdo não. Daí `TeorNaoAutorizadoError` ter nome próprio: a interface diz
  "você não está habilitado neste processo", e não "erro ao baixar".
- Status HTTP novos, escolhidos para dizer o que fazer: **428** (falta
  cadastrar credencial — não 401, que mandaria refazer login à toa), **424** (o
  tribunal recusou a credencial — nem 401 nem 502), **403** (respondeu e negou o
  arquivo — não 404, que diria que a peça não existe).

### Corrigido

- **`.env.example` estava desatualizado e sabotava a busca por OAB.** Trazia
  `LEXFLOW_PROVIDER_CHAIN=mock-crawler-tjsp,datajud` e `DATAJUD_TIMEOUT_MS=8000`.
  Quem seguisse o README (`cp .env.example .env`) subia sem DJEN na cadeia: a
  vigilância respondia 501 e a busca por OAB devolvia zero. O arquivo correto
  tinha virado `env.example` (sem ponto) num dos uploads, e o antigo ficou.
- Removidos do repositório `download` (um `.dockerignore` antigo),
  `download (1)` (um `.gitignore` antigo) e `prettierrc.json`, duplicata de
  `.prettierrc.json`.
- README anunciava v0.8.0 com o `package.json` em 0.11.0.

### Dívida assumida, declarada aqui para não ser esquecida

O caminho de SUCESSO do MNI **ainda não tem captura real**: exige a credencial
de um advogado habilitado nos autos, e não havia nenhuma disponível. Os testes
de sucesso rodam contra um payload montado a partir do WSDL real — que é
exatamente o circuito fechado que o CLAUDE.md manda evitar. Na primeira consulta
bem-sucedida, use `npm run cli -- pecas <numero> --capturar` e substitua o bloco
`xmlComDocumentos` de `tests/infrastructure/MniAdapter.spec.ts` pela resposta de
verdade.

---

## [0.11.0] — 2026-09-07

**O LexFlow passa a parecer o que já era.**

A crítica que originou esta versão foi simples: a tela estava bem construída,
mas parecia ferramenta interna, não produto que se vende. O que denunciava não
era acabamento — era, em ordem, a porta de entrada, a ausência de painel e a
falta de identidade.

### Adicionado — contas de verdade

- **Entrada com e-mail e senha.** "Cole sua chave de API" era o momento mais
  evidente de que aquilo não era um produto: nenhum advogado entende a
  expressão. Agora é login, como qualquer serviço que se paga.
- **Senha com `scrypt` do próprio Node.** Não é bcrypt nem argon2 pela mesma
  razão que levou ao `node:sqlite` no lugar do `better-sqlite3`: **zero
  dependência nativa** — a imagem é Alpine e compilar módulo nativo lá exige
  python, make e g++. Os parâmetros vão gravados junto do hash, para o custo
  poder subir no futuro sem invalidar as senhas antigas.
- **Sessão em cookie HttpOnly**, com o HASH do token no banco — nunca o token.
  Se o banco vazar, o que está lá não abre conta nenhuma. `SameSite=Lax` para
  que chegar pelo link do e-mail de aviso não caia na tela de login, e `Secure`
  apenas sob HTTPS (marcar sempre faria o navegador descartar o cookie em
  `localhost`, com o sintoma "faço login e volto para o login").
- **Cadastro por código de acesso**, que é uma das chaves de `LEXFLOW_API_KEYS`.
  Não é burocracia: a chave do CNJ é compartilhada por todo o país, e um
  formulário aberto na internet transforma o VPS em proxy gratuito para a cota
  alheia — quem leva o bloqueio é a chave. Distribuir uma chave por cliente vira,
  de quebra, o mecanismo natural de onboarding e revogação.
- **A chave de API continua valendo** para integração (n8n, CLI, scripts). Os
  dois caminhos resolvem para o mesmo `workspace`, e nenhuma rota de dados sabe
  qual dos dois trouxe a requisição. A sessão tem precedência: com os dois
  presentes, vence a pessoa — do contrário a carteira "sumiria" conforme a aba.

### Adicionado — painel e primeiro uso

- **Painel como tela inicial.** Antes o usuário caía numa lista. Lista não
  responde à pergunta que ele traz ao abrir — "tem alguma coisa me esperando?".
  Quatro números: novidades não lidas, processos acompanhados, inscrições
  vigiadas e **quando foi a última verificação**. O último é o que quase nenhum
  concorrente mostra, e é o que separa "nada aconteceu" de "o sistema parou de
  olhar".
- **Primeira execução guiada**, em três passos, começando pelo que dá resultado
  sem digitar número nenhum (cadastrar a OAB). Um painel zerado é a pior
  primeira impressão possível de um SaaS.

### Alterado — identidade visual

- **Tema claro** com fundo levemente quente, verde-petróleo como marca e serifa
  nos títulos. A escolha é comercial, não estética: escuro lê como ferramenta de
  programador, e praticamente todo software jurídico brasileiro é azul — o
  petróleo mantém a seriedade sem se confundir com os concorrentes.
- **Marca em SVG inline** (também usada como favicon), sistema de cor em tokens,
  hierarquia tipográfica e estados vazios desenhados.
- Tudo continua **sem nenhum recurso externo**: fonte do sistema, zero CDN, zero
  build. Um teste garante isso — carregar Google Fonts quebraria o console de
  quem estiver atrás do firewall de um fórum.

### Corrigido

- **Campos de filtro sem estilo.** Os `input` e `select` das telas de processos,
  atualizações e busca não usavam a classe do sistema de design e apareciam com
  a aparência nativa do navegador no meio de uma interface desenhada. Foi visto
  em captura de tela real, não no código.
- **Rodapé flutuando no meio da página** sempre que o conteúdo era curto — que é
  exatamente o caso de quem acabou de assinar.
- **501 logado como erro, com stack trace.** Vigilância por OAB sem o DJEN na
  cadeia não é falha, é configuração; a cada abertura da aba o log ganhava um
  stack. É assim que se aprende a ignorar o log, que é o único lugar onde o 500
  de verdade aparece. Virou aviso, sem stack.

### Migração

A primeira conta criada **adota o workspace derivado da primeira chave de API**.
Sem isso, você criaria sua conta e encontraria a carteira vazia, achando que o
deploy apagou os dados. Sai uma linha no log quando acontece.

---

## [0.10.0] — 2026-09-05

**O sistema deixa de vigiar o que você digitou e passa a vigiar o seu nome.**

Até aqui era preciso saber o número do processo para acompanhá-lo — ou seja, era
preciso já saber que o processo existe. Esta versão inverte isso e fecha o ciclo:
detecta sozinho, separa o que pede providência, e avisa.

### Adicionado

- **Vigilância contínua por OAB.** O advogado cadastra a inscrição uma vez; toda
  publicação nova no nome dele entra sozinha na carteira. Novas rotas
  `/v1/vigilancias` e aba **Vigilância** no console.
  - A primeira varredura olha **30 dias**, não o histórico inteiro: um advogado
    com 1.871 publicações veria a carteira toda entrar como "novidade" e o aviso
    de verdade sumiria no meio.
  - As seguintes retomam com **2 dias de sobreposição**, porque o DJEN indexa
    com atraso e varrer do exato ponto de parada perderia publicação — que é
    perder prazo.
  - Roda **de hora em hora**, contra as 12h da varredura de processos. Pode,
    porque só toca o DJEN (200ms, sem chave). Amarrar as duas no mesmo relógio
    fazia a fonte lenta ditar o ritmo da rápida, e é na rápida que estão as
    publicações que abrem prazo.
- **Notificação por e-mail**, via SMTP (`Notificador` como porta, para o
  WhatsApp entrar depois sem mexer no resumo). Um e-mail por ciclo, agrupado por
  processo, com o trecho do teor — não um e-mail por movimentação.
- **Aviso de que NÃO conseguimos verificar.** Se a última varredura bem-sucedida
  passar de 26h, sai um alerta. É metade da funcionalidade, não um extra:
  notificação é uma promessa, e a partir do primeiro aviso o advogado passa a
  ler silêncio como "não houve nada". Um sistema que só avisa novidade é pior do
  que não ter notificação, porque troca incerteza conhecida por falsa segurança.
- **Triagem do que exige ação** (`domain/entities/triagem.ts`): separa o ato que
  abre prazo ou pede providência (`INTIME-SE`, `MANIFESTE-SE`, "prazo de N
  dias", sentença, decisão, acórdão) do registro de cartório (juntada,
  expedição, conclusão). Aplicada uma vez, na construção do `Processo`, para que
  API, e-mail e tela concordem. **Nunca esconde andamento** — só ordena e
  destaca.
- **Modo log do notificador**: sem SMTP configurado, o caminho inteiro continua
  sendo exercitado e o log mostra o que teria saído.

### Alterado — a tela do processo

O topo respondia "o que é este processo?" quando a pergunta do advogado ao abrir
é "o que eu preciso fazer?". A ordem mudou:

1. **Pede providência** — o que abre prazo, com trecho do texto
2. **Última movimentação** — agora com o inteiro teor, não só o rótulo
   ("Ato ordinatório" é categoria, não informação)
3. **Partes** — quem está do outro lado importa mais que a data de distribuição
4. Ficha cadastral, com **hora** na verificação (verificado às 03h e às 14h são
   coisas diferentes quando se conta prazo) e as fontes que responderam
5. Andamentos, com filtros (tudo / pede providência / com inteiro teor) e
   **"ler o ato inteiro"** por andamento

### Corrigido

- **O DJEN devolve um aviso no lugar do inteiro teor** quando o documento não é
  público: `ARQUIVOS DIGITAIS INDISPONÍVEIS (NÃO SÃO DO TIPO PÚBLICO)`. São
  **43 das 62 publicações** do processo de teste — 69%. O mapper guardava esse
  aviso como se fosse o despacho, e a tela exibiria 43 andamentos com um
  "inteiro teor" que só diz que não há inteiro teor. Agora é reconhecido, marcado
  como `teorIndisponivel` e acompanhado do link para o tribunal. Efeito colateral
  desejado: com o teor legitimamente ausente, o orquestrador volta a considerar
  que falta conteúdo e continua perguntando às outras fontes.
- **Corpo de requisição inválido virava HTTP 500.** `ZodError` não estava
  mapeado, então um campo faltando acendia alarme de produção em vez de dizer ao
  cliente qual campo corrigir. Agora é 400, com o nome do campo.
- **Resumo reenviado a cada ciclo.** O filtro do repositório é
  `detectada_em >= desde`, e usar o instante do último envio reincluía a novidade
  detectada no mesmo milissegundo. O usuário receberia o mesmo aviso para sempre
  e pararia de confiar no aviso.

### Notas de arquitetura

- `Movimentacao` ganhou `teorIndisponivel`, `exigeAcao`, `fonte` e `url`.
- Falha de varredura **não** marca a inscrição como varrida: marcar abriria um
  buraco silencioso exatamente no período em que a fonte esteve fora.
- A vigilância **funde** o retrato guardado com o que o DJEN traz, nunca
  substitui — o DJEN não tem os andamentos internos, e substituir faria um
  processo de 361 andamentos aparecer com 8.
- `nodemailer` é a primeira dependência de runtime nova desde o Fastify.

### ⚠️ Ação necessária no deploy

Se `LEXFLOW_PROVIDER_CHAIN` estiver preenchida no Easypanel com o valor antigo,
**troque para `datajud,djen`**. Valor explícito ganha do padrão do código — foi
por isso que o DJEN não entrou na v0.9.0. Sem `djen` na cadeia, a vigilância por
OAB responde 501.

---

## [0.9.0] — 2026-09-05

**A busca por OAB passa a existir — e o processo passa a vir inteiro.**

Até aqui o LexFlow enxergava metade de cada processo: o DataJud entrega
metadados e a linha do tempo codificada, mas não indexa parte nem advogado, e
por isso `buscarPorOab` só sabia lançar `OperacaoNaoSuportadaError`. Esta versão
fecha o buraco com uma segunda fonte oficial.

### Como cheguei aqui — e por que NÃO tem crawler

O plano era escrever um crawler do tribunal. Investiguei antes de codar, e a
investigação matou o plano duas vezes:

1. **O TJGO não usa eproc.** O campo `sistema` do DataJud diz `Eproc`, mas
   nenhum host de eproc do TJGO existe (`eproc.tjgo.jus.br`, `eproc1`, `eproc2`
   — todos sem DNS). O sistema real é o **Projudi**. Um adapter escrito a partir
   daquele campo teria sido escrito contra um sistema que o tribunal não usa.
2. **A consulta pública do Projudi é protegida por Cloudflare Turnstile.** O
   formulário carrega `challenges.cloudflare.com/turnstile/v0/api.js` em modo
   `render=explicit` e o botão Buscar nasce `disabled`, só habilitando com token
   válido. Não é rate limit: é desafio anti-bot em toda consulta. E o formulário
   **não tem campo de OAB** — mesmo vencido o desafio, a funcionalidade
   pretendida não estava lá.

Contornar CAPTCHA está fora de cogitação: é o tribunal dizendo que não quer
robô, e dependeria de serviço pago de resolução, com custo por consulta e
quebra a cada ajuste da Cloudflare.

A saída foi outra fonte oficial.

### Adicionado

- **`DjenAdapter`** — Diário de Justiça Eletrônico Nacional, via Comunica API do
  CNJ (`comunicaapi.pje.jus.br`). Sem chave, sem CAPTCHA, cobertura nacional.
  Traz o que faltava:
  - **busca por OAB de verdade** (`numeroOab` + `ufOab`), a funcionalidade que
    faz um advogado assinar;
  - **partes**, com polo;
  - **advogados**, com número e UF da inscrição;
  - **inteiro teor** do ato publicado, não só o rótulo.
- **Enriquecimento entre fontes** no `ProcessoSearchService`. Achar o processo
  deixou de encerrar a busca: as fontes seguintes que sabem algo que a vencedora
  não sabe são consultadas e os resultados são fundidos. É o que torna a
  arquitetura híbrida de fato híbrida, e não só uma cadeia de fallback.
- **`fundirProcessos`** (`domain/entities/fusaoProcessos.ts`) — regra de
  precedência entre fontes: a preferida vence em campo escalar, a complementar
  só preenche buraco, e as linhas do tempo se unem sem duplicar.
- **Capacidade `retornaLinhaDoTempoCompleta`** na porta `ProcessoProvider`.
  Sem ela o orquestrador via um resultado do DJEN com partes e teor, concluía
  que não faltava nada, e nunca perguntava ao DataJud — um processo com 361
  andamentos apareceria com 8.
- **`Movimentacao.idExterno`, `.url` e `.fonte`.** O `idExterno` conserta um bug
  latente na detecção de novidades: a chave era `data|titulo`, e o DJEN informa
  só o dia, então duas decisões publicadas no mesmo dia no mesmo processo
  viravam uma só e a segunda nunca era avisada.
- **Acompanhar em lote** na tela: o resultado da busca por OAB ganhou o botão
  *Acompanhar todos*. Digitar a própria inscrição uma vez e sair com a carteira
  inteira sob vigilância é o fluxo que fecha o produto.
- `tests/fixtures/djen-comunica-real.json` — captura real, com as armadilhas
  anotadas no cabeçalho.
- Suíte de integração `hibrido-datajud-djen.spec.ts`, que roda a cadeia contra
  as duas capturas reais e falha se o enriquecimento parar de acontecer.

### Corrigido

- **Enriquecimento não reabre fonte já descartada.** Uma fonte que acabou de dar
  timeout, que não cobre o tribunal ou que reprovou no health check não é
  consultada de novo na etapa de complemento.
- **O tribunal considerado no complemento é o do número CONSULTADO**, não o do
  processo devolvido — senão uma fonte que responde errado passa a decidir quem
  mais é chamado.
- `HttpClient.get` passou a aceitar `OpcoesRequisicao` (timeout e tentativas por
  chamada), como o `postJson` já aceitava.
- Duas mensagens da interface afirmavam que busca por OAB e inteiro teor
  "dependem do crawler do tribunal". Virou mentira quando o DJEN entrou, e
  mensagem desatualizada manda o usuário procurar defeito onde não há.

### Alterado

- **`LEXFLOW_PROVIDER_CHAIN` mudou de `mock-crawler-tjsp,datajud` para
  `datajud,djen`.** O mock saiu do padrão: em produção ele inventaria processo.
  Sem `DATAJUD_API_KEY` a cadeia degrada sozinha para só o DJEN — que não exige
  chave, então o serviço sobe e funciona sem nenhuma configuração de fonte.

### Limites honestos desta fonte

- O DJEN só conhece o que foi **publicado no diário**. Juntada, conclusão e
  expediente de cartório não aparecem — para isso o DataJud continua na cadeia.
- Histórico curto: consulta a 2020 devolve zero. O DJEN concentra as publicações
  nacionais a partir de 2023/2024.
- `destinatarios` e `destinatarioadvogados` vêm como listas irmãs, sem ligação
  entre si. Com um destinatário — o caso comum — a associação é inequívoca; com
  vários, os advogados são atribuídos a todas as partes daquela comunicação.
- O DJEN não informa se a parte é pessoa física ou jurídica. Fica
  `DESCONHECIDO`; adivinhar por sufixo erra com espólio e condomínio.

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
