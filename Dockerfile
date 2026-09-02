# Build multi-stage: as devDependencies (TypeScript, Vitest, ESLint) existem só
# no estágio de build. A imagem final leva o JS compilado e as dependências de
# produção — nada de código-fonte, nada de compilador.
#
# No Easypanel, escolha o builder "Dockerfile" e aponte para este arquivo.

# ---------------------------------------------------------------------------
# 1. Dependências (camada cacheada: só refaz quando package*.json mudam)
# ---------------------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# `npm ci` (e não `install`) porque o lockfile é a fonte da verdade: build
# reproduzível, e uma dependência transitiva não muda sozinha entre um deploy
# e outro.
RUN npm ci

# ---------------------------------------------------------------------------
# 2. Build
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---------------------------------------------------------------------------
# 3. Dependências de produção apenas
# ---------------------------------------------------------------------------
FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---------------------------------------------------------------------------
# 4. Runtime
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    HTTP_HOST=0.0.0.0 \
    HTTP_PORT=3000

# `--init` no docker run resolveria isso, mas o Easypanel não expõe essa flag.
# O tini garante que SIGTERM chegue ao Node em vez de morrer no PID 1, que é o
# que faz um redeploy derrubar requisições em voo.
RUN apk add --no-cache tini

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

# A imagem base já traz o usuário `node` (UID 1000). Rodar como root dentro do
# contêiner não é necessário aqui e amplia o estrago de qualquer RCE.
USER node

EXPOSE 3000

# Bate no /health, que de propósito NÃO consulta os tribunais: se consultasse,
# instabilidade do TJSP faria o Docker reiniciar um contêiner saudável.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.HTTP_PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main/http/index.js"]
