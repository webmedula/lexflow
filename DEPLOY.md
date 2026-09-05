# Deploy do LexFlow no Easypanel

Runbook do zero até a API respondendo no seu domínio. Se algo falhar, a seção
[Quando der errado](#quando-der-errado) cobre os tropeços mais comuns.

---

## 0. Antes de começar

- VPS com Easypanel instalado e acessível
- Repositório no GitHub com este código (público ou privado)
- Um subdomínio apontado para o IP do VPS — ex.: `lexflow.webmedula.com.br`,
  registro **A** → IP do VPS
- (Opcional) Chave Pública do DataJud:
  <https://datajud-wiki.cnj.jus.br/api-publica/acesso/>

Sem a chave do DataJud o serviço sobe igual — só roda com o crawler mock, o que
é suficiente para validar o deploy inteiro.

---

## 1. Gere as chaves de API

O serviço **se recusa a subir sem `LEXFLOW_API_KEYS`**, e também recusa chave com
menos de 24 caracteres. Isso é proposital: a API do DataJud usa uma Chave Pública
compartilhada do CNJ, e um endpoint aberto na internet transforma seu VPS em
proxy gratuito para a cota de todo mundo — o bloqueio cai sobre a chave, não
sobre quem abusou.

### O que essa chave é (e o que não é)

Não é algo emitido por ninguém, nem tem relação com a chave do CNJ. É **um
segredo aleatório que você inventa**, e o LexFlow compara com o que chega no
header `x-api-key`. Quem tem a string entra; quem não tem, não. Só isso.

O que importa é que seja **aleatória de verdade** e **longa o bastante**. O
padrão do projeto é 32 bytes (256 bits) em hexadecimal — 64 caracteres. Não
existe força bruta viável contra isso.

Duas coisas que parecem chave e não são: senha que você inventou de cabeça
(previsível) e `Math.random()` (não é criptográfico — algumas saídas revelam o
gerador). Use sempre um gerador criptográfico do sistema.

### Como gerar

**Pelo próprio projeto (funciona em Windows, Linux e Mac):**

```bash
npm run chave
```

```
  chave 1
    valor .......... 5f0eb8d08f4889fdb46ece84fc4187bd4260e010702897a731e9b11a4632888a
    identificador .. 3ca36306
```

O **identificador** é o hash curto que aparece nos logs. Anote-o ao lado do nome
do consumidor ("3ca36306 = n8n") — assim, meses depois, você lê uma linha de log
e sabe de qual integração veio a requisição, sem nunca ter anotado a chave em
lugar nenhum além do gerenciador de senhas.

Variações:

```bash
npm run chave -- --rotulo n8n     # com nome, para não se perder
npm run chave -- 3                # três chaves de uma vez
npm run chave -- 3 --env          # já no formato LEXFLOW_API_KEYS=a,b,c
```

**Sem o projeto em mãos, só com o Node instalado:**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**PowerShell puro (Windows, sem Node):**

```powershell
$b = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Fill($b)
-join ($b | ForEach-Object { $_.ToString('x2') })
```

**Git Bash, WSL, Linux ou Mac:**

```bash
openssl rand -hex 32
```

**Direto no VPS, via SSH** — útil quando você já está lá configurando:

```bash
openssl rand -hex 32
```

### Quantas chaves criar

Uma **por consumidor**, não uma para tudo. Separe pelo menos:

| Consumidor | Para quê |
|---|---|
| `seu-uso` | testes manuais, `curl`, Postman |
| `n8n` | seus fluxos de automação |
| `<cliente>` | cada integração externa, se houver |

O motivo é revogação: se a chave do n8n vazar num log ou num print, você tira
**só ela** da variável e redeploya. Com chave única compartilhada, revogar uma
significa derrubar todo mundo ao mesmo tempo.

No `LEXFLOW_API_KEYS` elas vão separadas por vírgula:

```env
LEXFLOW_API_KEYS=5f0eb8d0...888a,03a5babf...6ec2,5f3ae83a...e38d3
```

Espaços em volta das vírgulas são tolerados. Chaves repetidas são recusadas no
arranque — repetir anula o motivo de ter várias.

### Onde guardar

- **Gerenciador de senhas** (Bitwarden, 1Password, KeePass) — é a cópia oficial.
  O script não salva nada em disco; fechou o terminal, a chave se foi.
- **Easypanel → aba Environment** — é onde o serviço lê. Trate como segredo:
  não imprima em log de build, não cole em issue, não mande por WhatsApp.
- **Nunca no Git.** O `.gitignore` já barra o `.env`, mas confira antes do
  primeiro push. Chave que entrou no histórico do Git continua lá mesmo depois
  de você apagar o arquivo num commit seguinte — nesse caso, gere outra.

### Rotação, sem derrubar ninguém

Troca periódica (ou vazamento) sem janela de indisponibilidade:

1. Gere a chave nova: `npm run chave -- --rotulo n8n-nova`
2. No Easypanel, **acrescente** a nova à lista, mantendo a antiga:
   `LEXFLOW_API_KEYS=<antiga>,<nova>`
3. Redeploy. Agora as duas funcionam.
4. Atualize o consumidor (n8n, script, cliente) para usar a nova.
5. Confirme nos logs que o identificador antigo parou de aparecer.
6. Remova a antiga da lista e redeploye de novo.

Se a chave **vazou**, pule a gentileza: tire a comprometida na hora e redeploye.
Alguns minutos de erro no consumidor legítimo custam menos que uma chave viva na
mão de terceiro.

---

## 2. Suba o código para o GitHub

> **Já subiu uma versão antes?** Pule para
> [Atualizando de uma versão anterior](#atualizando-de-uma-versão-anterior),
> no fim deste documento — tem uma armadilha do upload pelo navegador que
> precisa ser checada.

```bash
cd lexflow
git init
git add .
git commit -m "LexFlow: núcleo, API HTTP e Docker"
git branch -M main
git remote add origin git@github.com:SEU-USUARIO/lexflow.git
git push -u origin main
```

O `.gitignore` já barra `.env`, `node_modules/` e `dist/`. **Confira que o
`.env` não subiu** — se subiu, considere as chaves queimadas e gere outras.

---

## 3. Crie o serviço no Easypanel

No painel: **Projeto → + Service → App**. Nome: `lexflow-api`.

### Aba Source

| Campo | Valor |
|---|---|
| Type | GitHub |
| Repository | `SEU-USUARIO/lexflow` |
| Branch | `main` |
| Build Path | `/` |

Repositório privado exige conectar a conta do GitHub ao Easypanel antes (o
painel guia isso na própria aba).

### Aba Build

| Campo | Valor |
|---|---|
| Method | **Dockerfile** |
| File | `Dockerfile` |

Nixpacks também detectaria o projeto, mas o Dockerfile é a escolha certa aqui:
ele fixa Node 22, faz o build multi-stage (a imagem final não leva TypeScript
nem Vitest), roda como usuário não-root e trata SIGTERM via tini. Com Nixpacks
você fica na mão da heurística de detecção — e ela muda entre versões.

### Aba Environment

Cole isto **como está** e depois preencha só a linha do `LEXFLOW_API_KEYS` com a
chave do passo 1:

```env
NODE_ENV=production
HTTP_HOST=0.0.0.0
HTTP_PORT=3000

# ↓ cole aqui a chave gerada no passo 1 (npm run chave)
LEXFLOW_API_KEYS=
RATE_LIMIT_MAX=60
RATE_LIMIT_WINDOW_MS=60000
HTTP_TRUST_PROXY=true

LEXFLOW_PROVIDER_CHAIN=mock-crawler-tjsp,datajud
# Deixe vazia até ter a Chave Pública do CNJ. Vazia = o DataJud sai da cadeia
# e o serviço roda só com o crawler, sem erro.
DATAJUD_API_KEY=
DATAJUD_RATE_LIMIT_PER_MINUTE=60

CACHE_ENABLED=true
CACHE_TTL_SECONDS=900

# Banco: precisa apontar para o volume montado em /dados
LEXFLOW_DB_PATH=/dados/lexflow.db
# Varredura automática dos processos acompanhados. 0 desliga.
SYNC_INTERVALO_HORAS=12
SYNC_PAUSA_MS=1500

LOG_LEVEL=info
```

> **Não escreva um texto de exemplo no lugar de um valor que você ainda não tem.**
> Uma variável com `COLE_AQUI_...` dentro não está vazia: o serviço a aceita como
> credencial e só falha depois, na primeira chamada — longe da causa. A partir da
> v0.4.1 o LexFlow detecta esses textos e avisa, mas o hábito certo é deixar a
> linha vazia mesmo.

### Aba Mounts — **obrigatório a partir da v0.8.0**

O LexFlow agora guarda os processos acompanhados e o histórico de novidades num
arquivo SQLite. Sem um volume, esse arquivo vive dentro do contêiner e **é
apagado a cada redeploy** — o usuário perde a carteira inteira e o histórico de
"o que mudou".

Em **Mounts → Add Mount**:

| Campo | Valor |
|---|---|
| Type | **Volume** |
| Name | `lexflow-dados` |
| Mount Path | `/dados` |

O `Dockerfile` já define `LEXFLOW_DB_PATH=/dados/lexflow.db` e cria o diretório
com o dono certo. Você só precisa montar o volume.

Para conferir depois do deploy: acompanhe um processo, faça um **Deploy** de
novo e veja se ele continua na lista. Se sumiu, o volume não está montado.

### Aba Domains

| Campo | Valor |
|---|---|
| Host | `lexflow.webmedula.com.br` |
| Path | `/` |
| Protocol | HTTP |
| **Port** | **3000** |
| HTTPS | ligado (Let's Encrypt) |

**A porta alvo tem que ser 3000** — é onde o contêiner escuta. Esse é o campo
que mais gera "502 Bad Gateway" quando fica errado.

### Deploy

Botão **Deploy**. Acompanhe o log de build: as quatro etapas do Dockerfile
(deps → build → prod-deps → runtime) aparecem nomeadas.

---

## 4. Confirme que subiu

```bash
# Liveness — não deve pedir chave
curl https://lexflow.webmedula.com.br/health
# {"status":"ok","uptimeSegundos":12}

# Readiness — mostra o estado de cada fonte
curl https://lexflow.webmedula.com.br/ready
# {"status":"pronto","fontes":[{"provider":"mock-crawler-tjsp","saudavel":true},…]}

# Consulta de verdade
curl -H "x-api-key: SUA_CHAVE" \
  https://lexflow.webmedula.com.br/v1/processos/1234567-47.2023.8.26.0100

# A carteira de um advogado
curl -H "x-api-key: SUA_CHAVE" \
  https://lexflow.webmedula.com.br/v1/advogados/SP/234567/processos

# Sem chave deve dar 401 — se der 200, a autenticação não está ativa
curl -i https://lexflow.webmedula.com.br/v1/processos/1234567-47.2023.8.26.0100
```

---

## 5. Deploy contínuo

Com a fonte GitHub configurada, o Easypanel expõe um **webhook de deploy**
(aba Source, "Deploy Webhook"). Cole a URL em
`GitHub → Settings → Webhooks → Add webhook`, content type
`application/json`. A partir daí, todo push na `main` redeploya sozinho.

O `.github/workflows/ci.yml` roda typecheck, lint, testes e o build da imagem em
cada push. Vale proteger a branch `main` exigindo o CI verde — assim um deploy
quebrado não chega ao VPS.

---

## Endpoints

| Método | Rota | Auth | O que faz |
|---|---|---|---|
| GET | `/health` | não | processo vivo (Docker/Easypanel usam esta) |
| GET | `/ready` | não | consegue atender? lista o estado das fontes |
| GET | `/v1/processos/:numero` | sim | processo por número CNJ, com ou sem máscara |
| GET | `/v1/advogados/:uf/:oab/processos` | sim | carteira do advogado |

Query opcional na carteira: `?ordenarPor=DISTRIBUICAO` (padrão:
`ULTIMA_MOVIMENTACAO`).

Toda resposta de processo traz `x-lexflow-fonte` (qual fonte respondeu) e
`x-lexflow-cache` (`true` se veio da memória). Não trate dado de cache como
consulta ao vivo quando houver prazo em jogo.

### Códigos de status

| Código | Significado | É problema seu? |
|---|---|---|
| 400 | número CNJ ou OAB inválidos | não, o cliente errou |
| 401 | chave ausente ou inválida | não |
| 404 | consultamos, o processo não existe | não |
| 429 | limite de requisições estourado | não |
| 501 | nenhuma fonte sabe fazer essa busca | é escopo, não falha |
| 502 | as fontes externas falharam | **rio acima** — tribunal ou CNJ |
| 503 | fonte temporariamente indisponível | rio acima, tente de novo |
| 500 | bug do LexFlow | **sim** — só este merece alarme |

Essa separação é deliberada: se tribunal fora do ar virasse 500, o alarme
tocaria o tempo todo por algo que não é seu, e o 500 de verdade se perderia no
meio.

---

## Testando local antes de subir

```bash
docker compose up --build
curl -H "x-api-key: chave-local-de-desenvolvimento" \
  http://localhost:3000/v1/processos/1234567-47.2023.8.26.0100
```

É a mesma imagem que o Easypanel constrói. Se passar aqui, passa lá.

---

## Quando der errado

**502 Bad Gateway no domínio, mas o contêiner está "running"**
A porta alvo do domínio não bate com a do contêiner. Confira: `Port = 3000` na
aba Domains e `HTTP_PORT=3000` no Environment.

**O contêiner reinicia em loop**
Veja o log. Se aparecer `Configuração recusada: defina LEXFLOW_API_KEYS…`, é a
guarda do passo 1 — a variável não foi salva. Se aparecer
`Configuração inválida:` seguido do nome de uma variável, o valor está fora do
formato (número onde se esperava número, URL onde se esperava URL).

**Sobe, o log diz "LexFlow no ar", mas nada responde**
`HTTP_HOST` está como `127.0.0.1`. Dentro do contêiner isso significa "só eu
mesmo": o proxy não alcança. Tem que ser `0.0.0.0`.

**Uma fonte aparece no `/ready` com `saudavel: false`**
A partir da v0.4.0 vem o campo `motivo` junto, dizendo o que é. Se o motivo
mencionar **texto de exemplo**, a variável ficou com o placeholder da
documentação em vez do valor real — apague o conteúdo dela (ou cole a chave de
verdade) e redeploye. Uma fonte com credencial de exemplo aparece na lista como
se estivesse com problema de disponibilidade, quando na verdade nunca foi
configurada.

**`/ready` devolve 503**
Nenhuma fonte respondeu. Com `LEXFLOW_PROVIDER_CHAIN=mock-crawler-tjsp,datajud`
o mock sempre responde, então 503 aqui normalmente é a cadeia mal escrita —
confira se não há espaço ou nome errado na variável.

**401 mesmo com a chave certa**
Espaços em volta das vírgulas são tolerados, então não é isso. As causas reais:
a chave foi truncada no copiar-e-colar (confira o tamanho — deve ter 64
caracteres), ou você está mandando em `Authorization` sem o prefixo `Bearer `.
Ambos os formatos valem: `x-api-key: <chave>` ou `Authorization: Bearer <chave>`.
Para saber qual chave o servidor aceitou, compare o campo `chave` do log com o
identificador que o `npm run chave` imprimiu.

**Contêiner recusa subir com "Configuração de autenticação recusada"**
A mensagem diz exatamente o quê: chave ausente, chave com menos de 24
caracteres, chave repetida, ou `LEXFLOW_AUTH_DISABLED=true` junto com
`LEXFLOW_API_KEYS` preenchida (ambíguo — escolha um dos dois).

**502 nas consultas depois de configurar o DataJud**
Log com `chave pública rejeitada (HTTP 401)` = a chave do CNJ está errada ou foi
rotacionada; pegue a atual na wiki do DataJud. Log com
`limite de requisições excedido` = baixe `DATAJUD_RATE_LIMIT_PER_MINUTE`.

**Requisições caindo a cada redeploy**
Não deveria acontecer: o tini repassa o SIGTERM e o Fastify fecha esperando as
respostas em voo. Se acontecer, confira se o `ENTRYPOINT` do Dockerfile foi
alterado.

---

## Atualizando de uma versão anterior

### Antes de tudo: confira se os arquivos ocultos estão no repositório

Se você subiu o código pelo **"Add file → Upload files" do GitHub no navegador**,
provavelmente faltam arquivos. O Explorer do Windows esconde tudo que começa com
ponto, então o que você arrastou não incluiu:

| Arquivo | O que acontece sem ele |
|---|---|
| `.gitignore` | **o mais grave** — nada impede o `.env` (com sua chave) e o `node_modules/` de irem para o repositório no próximo commit |
| `.dockerignore` | build mais lento; o contexto inteiro vai para o daemon |
| `.env.example` | some a referência de quais variáveis existem |
| `.github/workflows/ci.yml` | não há CI: erro só aparece no deploy |

Como conferir: no GitHub, digite <kbd>t</kbd> na página do repositório e busque
por `gitignore`. Ou abra
`https://github.com/SEU-USUARIO/lexflow/blob/main/.gitignore` direto — 404
significa que não está lá.

**Se faltar o `.gitignore`, resolva isso antes de qualquer outra coisa.** Sem
ele, um `git add .` distraído publica sua chave de API num repositório — e chave
que entrou no histórico do Git continua lá mesmo depois de apagada num commit
seguinte. Nesse caso, a saída é gerar outra.

### O jeito que resolve de vez: usar Git

O upload pelo navegador não apaga arquivos removidos, não versiona direito e
esconde dotfiles. Vale os cinco minutos de instalar o Git.

1. Instale: <https://git-scm.com/download/win> (aceite os padrões)
2. Descompacte o zip novo **por cima** da sua pasta do projeto, substituindo os
   arquivos. Seu `.env` local não está no zip, então ele sobrevive.
3. No PowerShell, dentro da pasta:

```powershell
git init
git remote add origin https://github.com/SEU-USUARIO/lexflow.git
git fetch origin
git checkout -b main
git add -A
git commit -m "Atualiza para a v0.3.0"
git push -u origin main --force
```

O `--force` aqui é intencional e seguro: o histórico atual é um único commit de
upload, e você está substituindo por um commit completo — com os dotfiles, que é
o ponto. Da segunda vez em diante, `git push` normal.

Confira o resultado: a raiz do repositório deve mostrar `.gitignore`,
`.dockerignore`, `.env.example` e a pasta `.github/`.

Nos próximos ciclos, o fluxo vira:

```powershell
git add -A
git commit -m "o que mudou"
git push
```

E, com o webhook do passo 5 configurado, o Easypanel redeploya sozinho.

### Se preferir continuar pelo navegador

Dá para fazer, mas precisa de um passo extra para os dotfiles:

1. No Explorer: aba **Exibir → Mostrar → Itens ocultos**
2. Arraste os arquivos **e** as pastas, incluindo `.github/`
3. Crie os arquivos que teimarem em não subir pelo próprio GitHub:
   **Add file → Create new file**, digite `.gitignore` no nome e cole o conteúdo

Ainda assim, arquivos que deixaram de existir no projeto continuarão no
repositório — o upload só adiciona e sobrescreve. Por isso o Git é melhor.

### Confirme que o deploy pegou a versão nova

```bash
curl https://lexflow.webmedula.com.br/health
# {"status":"ok","versao":"0.3.0","uptimeSegundos":12}
```

Se o campo `versao` continuar mostrando a anterior, o Easypanel não pegou o
commit novo: verifique o branch configurado na aba Source e rode um Deploy
manual.

---

## Próximos passos depois do primeiro deploy

O cache é em memória — cada contêiner tem o seu, e ele evapora a cada redeploy.
Serve para uma instância. Se você escalar para duas, ou quiser que o cache
sobreviva ao deploy, suba um Redis pelo template do Easypanel e implemente a
porta `Cache` em `infrastructure/cache/RedisCache.ts`: é uma classe nova e uma
linha trocada no composition root. Veja "Como estender" no
[CLAUDE.md](./CLAUDE.md).
