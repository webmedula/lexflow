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

## 1. Gere as chaves de API antes de tudo

O serviço **se recusa a subir sem `LEXFLOW_API_KEYS`**. Isso é proposital: a API
do DataJud usa uma Chave Pública compartilhada do CNJ, e um endpoint aberto na
internet transforma seu VPS em proxy gratuito para a cota de todo mundo — o
bloqueio cai sobre a chave, não sobre quem abusou.

Gere uma chave por consumidor (você, o n8n, um cliente), para poder revogar uma
sem derrubar as outras:

```bash
openssl rand -hex 32
```

Guarde. Elas não aparecem em lugar nenhum depois.

---

## 2. Suba o código para o GitHub

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

Cole isto, substituindo os valores marcados:

```env
NODE_ENV=production
HTTP_HOST=0.0.0.0
HTTP_PORT=3000

LEXFLOW_API_KEYS=COLE_AQUI_A_CHAVE_GERADA_NO_PASSO_1
RATE_LIMIT_MAX=60
RATE_LIMIT_WINDOW_MS=60000
HTTP_TRUST_PROXY=true

LEXFLOW_PROVIDER_CHAIN=mock-crawler-tjsp,datajud
DATAJUD_API_KEY=COLE_AQUI_A_CHAVE_DO_CNJ_OU_DEIXE_VAZIO
DATAJUD_RATE_LIMIT_PER_MINUTE=60

CACHE_ENABLED=true
CACHE_TTL_SECONDS=900

LOG_LEVEL=info
```

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

**`/ready` devolve 503**
Nenhuma fonte respondeu. Com `LEXFLOW_PROVIDER_CHAIN=mock-crawler-tjsp,datajud`
o mock sempre responde, então 503 aqui normalmente é a cadeia mal escrita —
confira se não há espaço ou nome errado na variável.

**401 mesmo com a chave certa**
Espaço invisível no fim da variável no painel, ou você está mandando a chave em
`Authorization` sem o prefixo `Bearer `. Ambos os formatos funcionam:
`x-api-key: <chave>` ou `Authorization: Bearer <chave>`.

**502 nas consultas depois de configurar o DataJud**
Log com `chave pública rejeitada (HTTP 401)` = a chave do CNJ está errada ou foi
rotacionada; pegue a atual na wiki do DataJud. Log com
`limite de requisições excedido` = baixe `DATAJUD_RATE_LIMIT_PER_MINUTE`.

**Requisições caindo a cada redeploy**
Não deveria acontecer: o tini repassa o SIGTERM e o Fastify fecha esperando as
respostas em voo. Se acontecer, confira se o `ENTRYPOINT` do Dockerfile foi
alterado.

---

## Próximos passos depois do primeiro deploy

O cache é em memória — cada contêiner tem o seu, e ele evapora a cada redeploy.
Serve para uma instância. Se você escalar para duas, ou quiser que o cache
sobreviva ao deploy, suba um Redis pelo template do Easypanel e implemente a
porta `Cache` em `infrastructure/cache/RedisCache.ts`: é uma classe nova e uma
linha trocada no composition root. Veja "Como estender" no
[CLAUDE.md](./CLAUDE.md).
