# CLAUDE.md — LexFlow

Regras de trabalho neste repositório. Vale para agentes de IA e para pessoas.
Se algo aqui conflitar com o código, **o código está errado ou este arquivo está
desatualizado** — resolva a divergência, não a ignore.

---

## 1. O que é o LexFlow

SaaS de consulta e acompanhamento de processos judiciais nos tribunais
brasileiros. O advogado consulta por número CNJ ou pela própria OAB e recebe
metadados, partes e movimentações em um formato único, independentemente da
fonte que respondeu.

**A tese do produto é a busca HÍBRIDA.** Nenhuma fonte isolada resolve:

| Fonte | Custo | Cobertura | Partes/advogados | Inteiro teor | Busca por OAB |
|---|---|---|---|---|---|
| API Pública DataJud (CNJ) | grátis | ~91 tribunais | ❌ não indexa | ❌ só rótulo TPU | ❌ impossível |
| Crawler próprio (e-SAJ, PJe, Projudi) | infra + manutenção | 1 tribunal por crawler | ✅ | ✅ | ✅ |
| Agregadores pagos | R$ por consulta | ampla | ✅ | ✅ | ✅ |

O sistema combina fontes atrás de uma única interface e faz fallback automático.
Toda decisão de arquitetura abaixo existe para servir a isso.

---

## 2. Arquitetura

Clean Architecture com Ports & Adapters. **A dependência aponta sempre para
dentro.**

```
        main/  (composition root; adaptadores de entrada: CLI e API HTTP)
          │  monta e injeta
          ▼
   application/  (ProcessoSearchService — orquestração entre fontes)
          │  usa portas
          ▼
      domain/   (entidades, portas, casos de uso, erros)   ← não importa NADA
          ▲
          │  implementa portas
  infrastructure/  (DataJud, crawlers, cache, HTTP, log, config)
```

### Regra de dependência (inegociável)

- `domain/` **não importa** de `application/`, `infrastructure/` ou `main/`, nem
  de biblioteca de I/O (http, fs, driver de banco).
  - Única exceção tolerada hoje: `zod` em `infrastructure/`, nunca em `domain/`.
- `application/` importa de `domain/`. Nunca de `main/`.
- `infrastructure/` implementa portas de `domain/`. Um adapter não conhece outro
  adapter.
- `main/` é o único lugar que faz `new` de classe de infraestrutura.

Se você precisou importar `DataJudAdapter` fora de `main/factories/`, pare: o
desenho quebrou. Use a porta.

### Estrutura de pastas

```
src/
├── domain/                      # o núcleo, sem I/O
│   ├── entities/                # Processo, Movimentacao, Parte, NumeroCNJ, Oab
│   ├── errors/                  # hierarquia de DomainError
│   ├── ports/                   # ProcessoProvider, Cache, Logger, Clock
│   └── usecases/                # BuscarProcessoPorNumero, BuscarProcessosPorOab
├── application/
│   └── services/                # ProcessoSearchService (orquestrador)
├── infrastructure/
│   ├── adapters/
│   │   ├── datajud/             # adapter + mapper + schemas + aliases
│   │   └── crawler/             # MockCrawlerAdapter + fixtures
│   ├── cache/                   # InMemoryCache, CachedProcessoProvider
│   ├── config/                  # env.ts (validação de configuração)
│   ├── http/                    # HttpClient (timeout + retry)
│   ├── logging/                 # ConsoleLogger
│   └── ratelimit/               # TokenBucketRateLimiter
└── main/
    ├── factories/               # composition root
    ├── cli.ts                   # adaptador de ENTRADA (diagnóstico)
    └── http/                    # adaptador de ENTRADA (API Fastify)
        ├── index.ts             # entrypoint do contêiner
        ├── servidor.ts          # montagem + listen + shutdown gracioso
        ├── erros.ts             # DomainError → status HTTP
        ├── plugins/             # autenticação por chave de API
        └── rotas/               # processos, saúde
tests/                           # espelha src/, + http/, integration/, helpers/
```

CLI e API são dois adaptadores de entrada sobre os **mesmos** casos de uso.
Nenhuma regra vive em um e falta no outro — se você se pegou copiando lógica de
um para o outro, ela pertence ao domínio.

### Padrões em uso e por quê

| Padrão | Onde | Por quê |
|---|---|---|
| **Adapter** | `ProcessoProvider` + implementações | API oficial, crawler e mock entram pela mesma porta |
| **Strategy / Chain of Responsibility** | `ProcessoSearchService` | ordem das fontes e fallback são configuração, não `if` |
| **Composite** | `ProcessoSearchService implements ProcessoProvider` | a cadeia inteira é indistinguível de uma fonte |
| **Decorator** | `CachedProcessoProvider` | cache existe em um lugar só; nenhum adapter sabe dele |
| **Anticorruption Layer** | `datajud.mapper.ts` | o vocabulário do CNJ morre na borda |
| **Value Object** | `NumeroCNJ`, `Oab` | se a instância existe, o dado é válido — não se revalida |

---

## 3. A porta `ProcessoProvider`

```ts
interface ProcessoProvider {
  readonly nome: string;
  readonly capacidades: CapacidadesProvider;
  buscarPorNumero(numeroProcesso: string): Promise<Processo>;
  buscarPorOab(oab: string, uf: string): Promise<Processo[]>;
  healthCheck(): Promise<boolean>;
  diagnosticar?(): Promise<DiagnosticoProvider>;  // opcional
}
```

**Ao criar um adapter novo, cumpra o contrato inteiro:**

1. `nome` estável — vai para log, chave de cache e procedência.
2. `capacidades` **honestas**. Declarar que busca por OAB sem buscar é o pior bug
   possível aqui: o orquestrador confia nessa declaração para decidir a quem
   perguntar.
3. Lance **somente** erros de `domain/errors` (tabela abaixo). `throw new Error()`
   cru é bug.
4. `healthCheck()` **nunca lança** — fonte fora do ar devolve `false`.
5. Implemente `diagnosticar()` se a fonte tem mais de um jeito de falhar. Devolver
   só `false` obriga quem opera a adivinhar entre chave errada, rede e tribunal
   fora do ar. E cuidado com a classificação: **4xx que não é de autenticação
   significa que a fonte respondeu e a chave passou** — reprovar por isso tira da
   cadeia uma fonte que estava funcionando.
6. Devolva `Processo`, nunca o payload da fonte.

### Erros e o que cada um provoca no orquestrador

| Erro | Significado | Efeito |
|---|---|---|
| `ProcessoNaoEncontradoError` | a fonte respondeu, não tem o processo | tenta a próxima; se **todas** disserem isso, o resultado final é "não encontrado" |
| `OperacaoNaoSuportadaError` | limitação permanente da fonte | **pula** sem contar como falha |
| `ProviderIndisponivelError` | rede, timeout, 5xx, captcha, tribunal fora | dispara o **fallback** |
| `RespostaInvalidaError` | respondeu, payload fora do contrato | dispara o fallback |
| `NumeroCNJInvalidoError` / `OabInvalidaError` | entrada do usuário inválida | propaga; nenhuma fonte é consultada |
| `TodasAsFontesFalharamError` | a cadeia acabou | 5xx na API; carrega o histórico das tentativas |

**A distinção que sustenta o produto:** "esse processo não existe" ≠ "não
consegui ver esse processo". Colapsar as duas coisas faz o sistema dizer ao
advogado que o processo dele não existe toda vez que o TJSP sair do ar. Nunca
faça isso.

---

## 4. Convenções de código

### Idioma

- **Domínio em português**: `Processo`, `Movimentacao`, `buscarPorNumero`,
  `numeroProcesso`. O vocabulário jurídico brasileiro não tem tradução boa e
  traduzir cria ambiguidade com o cliente. Comentários e mensagens de erro
  também em português.
- **Termos técnicos consagrados em inglês** ficam em inglês: `Cache`, `Logger`,
  `HttpClient`, `RateLimiter`, `healthCheck`, `Adapter`, `Provider`.
- Nomes de arquivo seguem o que exportam: `PascalCase.ts` para classe,
  `camelCase.ts` para função/módulo (`datajud.mapper.ts`).

### TypeScript

- `strict` ligado, mais `noUncheckedIndexedAccess` e
  `exactOptionalPropertyTypes`. Índice de array é `T | undefined` — trate.
  Propriedade opcional se omite (`...(x ? { x } : {})`), não se atribui
  `undefined`.
- **`any` é proibido.** Dado externo entra como `unknown` e é validado com Zod.
- `import type` para tipos (regra de lint ativa).
- Imports relativos **com extensão `.js`** — é ESM + `NodeNext`. `./Processo.js`
  aponta para `Processo.ts`. Sem isso, não roda compilado.
- Retorno explícito em função exportada.

### Estilo

- Entidades **imutáveis** (`Object.freeze` no construtor, `readonly` nos campos).
  Alteração produz cópia (`comAlteracoes`).
- Sem herança entre entidades. Composição.
- Data é sempre `Date` no domínio; `string` ISO só ao serializar.
- Prettier decide formatação: aspas simples, vírgula final, 90 colunas.
- `console.*` só no CLI e no logger — o lint bloqueia no resto.
- **stdout é dado, stderr é log.** Não misture: quebra `npm run cli -- ... > x.json`.

### Comentários

Comente **por que**, não **o que**. `// incrementa i` não ajuda ninguém.
`// laço em vez de sleep único: outra corrotina pode tomar o token antes` ajuda.
Onde uma decisão parece estranha, o comentário explica a restrição que a causou.

---

## 5. Comandos

```bash
npm install              # dependências
cp .env.example .env     # configuração local (defina LEXFLOW_API_KEYS)

npm run dev              # API com reload
npm run build && npm run start:local   # API a partir do build
docker compose up --build              # a MESMA imagem que vai para o VPS

npm run chave            # gera chave de API + o identificador que sai no log
npm run chave -- 3 --env # três chaves no formato da variável de ambiente

npm run cli -- processo 1234567-47.2023.8.26.0100
npm run cli -- processo 12345674720238260100 --json
npm run cli -- oab 234567 SP
npm run cli -- saude

npm test                 # suíte completa (Vitest)
npm run test:watch       # modo watch
npm run test:cov         # cobertura, mínimo 70% no núcleo
npm run typecheck        # tsc --noEmit
npm run lint             # ESLint
npm run format           # Prettier
npm run check            # typecheck + lint + test  ← rode antes de commitar
npm run build            # compila para dist/
```

**Antes de qualquer commit: `npm run check` verde.** Sem exceção.

---

## 6. Testes

- Vitest. Arquivos em `tests/`, espelhando `src/`, sufixo `.spec.ts`.
- **Nenhum teste toca a rede.** `HttpClient` é dublado por subclasse;
  `MockCrawlerAdapter` já é o dublê da camada de crawler.
- **Nenhum teste depende de tempo real.** `Clock` e a função aleatória são
  injetáveis — use `ClockFalso` e `aleatorio: () => 0.1` em vez de `sleep`.
- **Comportamento de fonte externa se testa contra CAPTURA REAL**, nunca contra
  fixture inventado. `tests/fixtures/datajud-tjgo-real.json` é a resposta que o
  CNJ devolveu de fato; ao mexer no adapter ou no mapper do DataJud, o teste que
  vale é `datajud-payload-real.spec.ts`. O motivo está gravado: 161 testes verdes
  não pegaram que `dataAjuizamento` vem em `yyyyMMddHHmmss` e não em ISO, porque
  eu havia escrito o fixture, o parser e a asserção — um circuito fechado que não
  tocava a realidade. Ao capturar payload novo, salve como fixture e não edite os
  valores.
- Fixtures usam números CNJ com **dígito verificador válido**. Um DV inválido na
  massa faz a suíte passar sem nunca exercitar `NumeroCNJ`, e o bug só aparece
  contra o tribunal de verdade. Helper para gerar: veja o fim de
  `tests/domain/NumeroCNJ.spec.ts`.
- O nome do teste descreve o **comportamento**, não o método:
  `'cai para a fonte seguinte quando a primária está indisponível'`, não
  `'testa buscarPorNumero'`.
- Todo caminho de erro do orquestrador tem teste. Fallback sem teste é fallback
  que não existe.

---

## 7. Como estender

### Adicionar um tribunal ao DataJud

1. Sigla em `TRIBUNAIS_SUPORTADOS` (`infrastructure/adapters/datajud/tribunais.ts`).
2. Par `J.TR` no mapa `SIGLAS_POR_SEGMENTO_TRIBUNAL` em
   `domain/entities/NumeroCNJ.ts`.
3. Teste com um número real daquele tribunal.

### Criar um crawler de verdade

1. `infrastructure/adapters/crawler/<Tribunal>CrawlerAdapter.ts`, implementando
   `ProcessoProvider`.
2. Declare capacidades reais e lance apenas erros de domínio.
3. Espelhe a suíte de `MockCrawlerAdapter.spec.ts` — o mock é o **gêmeo de
   contrato** do crawler real; os dois devem passar nos mesmos testes de
   comportamento.
4. Registre no `switch` de `main/factories/makeProcessoSearchService.ts` e
   documente o nome em `.env.example`.
5. Rate limiting **obrigatório**. Crawler sem limite derruba o tribunal e queima
   o IP.

### Trocar o cache por Redis

Implemente `domain/ports/Cache.ts` em `infrastructure/cache/RedisCache.ts` e
troque uma linha no composition root. Nada mais muda. Se você precisou mexer em
outro arquivo, a porta está errada.

### Adicionar uma rota HTTP

Em `main/http/rotas/`. A rota traduz HTTP → caso de uso → JSON e **não** trata
erro: o `errorHandler` do servidor centraliza a tradução para status. Se você
escreveu `try/catch` com `reply.code(...)` dentro de uma rota, mova o caso novo
para `main/http/erros.ts` — é assim que o mesmo erro deixa de virar 404 numa
rota e 500 na outra.

Rota que dispensa autenticação precisa entrar em `rotasPublicas` ao registrar o
plugin de autenticação — hoje só `/health` e `/ready`.

---

## 8. Restrições operacionais e jurídicas

Não são detalhes — moldam o código.

- **Chave do DataJud é compartilhada.** A API Pública usa uma Chave Pública única
  do CNJ. Estourar a cota prejudica todos que usam a mesma chave e pode gerar
  bloqueio. Por isso o rate limiter é do **nosso** lado, e não uma reação ao 429.
- **Nunca commite `.env`.** A chave vai em variável de ambiente.
- **Crawler é um convidado no servidor alheio.** Respeite intervalo entre
  requisições, horário de menor movimento e `robots.txt`. Sem paralelismo
  agressivo contra tribunal.
- **Segredo de justiça:** `processo.segredoJustica === true` significa que
  partes e movimentações podem estar suprimidas na origem. Não tente
  complementar por outra fonte, e nunca exiba para quem não é parte.
- **Dado pessoal (LGPD):** documentos de parte vêm mascarados da fonte pública.
  Guarde como veio — não desmascare, não complete, não infira.
- **A API não pode ficar aberta.** A chave do CNJ é compartilhada; um endpoint
  público transforma o VPS em proxy gratuito para a cota alheia. Por isso
  `main/http/index.ts` **recusa subir** sem `LEXFLOW_API_KEYS`, a menos que
  `LEXFLOW_AUTH_DISABLED=true` seja declarado. Não remova essa guarda.
- **Chave nunca vai para o log nem para a resposta.** O log registra o
  `identificarChave()` — 8 hex do SHA-256, não reversível e imune a prefixo
  comum. Nunca troque por um prefixo da chave: vaza segredo e colapsa todas as
  chaves que compartilhem convenção de nome. O handler de erro devolve mensagem
  genérica em 500 porque a original pode conter URL interna ou trecho de payload.
- **Nunca escreva placeholder no lugar de um valor.** Em bloco de configuração
  pronto para copiar, a linha vai vazia e a instrução vai em comentário. Um
  `COLE_AQUI_...` não é vazio: passa por toda checagem de presença e vira
  credencial de mentira, que só falha lá na frente. `pareceValorDeExemplo()`
  (em `infrastructure/config/placeholder.ts`) é a rede de segurança, não a
  desculpa para voltar a usar placeholder.
- **Configuração de autenticação é validada no arranque** (`main/http/chaves.ts`):
  sem chave, chave com menos de `TAMANHO_MINIMO_CHAVE`, chave repetida, ou
  `LEXFLOW_AUTH_DISABLED` junto com chaves preenchidas — todos derrubam a
  montagem. Chave fraca é pior do que nenhuma: passa sensação de proteção.
- **Prazo processual é responsabilidade do advogado.** A `procedencia` (fonte +
  `consultadoEm` + `deCache`) acompanha todo `Processo` justamente para que a
  interface possa mostrar quando o dado foi visto. Nunca apresente dado de cache
  como se fosse consulta ao vivo.

---

## 9. Versionamento

A versão vive **só** no `package.json` — `src/infrastructure/config/versao.ts` a
lê em tempo de execução, e ela sai no log de arranque e em `GET /health`. Nunca
duplique o número numa constante: no dia em que divergir, será exatamente quando
você estiver olhando um log tentando descobrir se o deploy pegou.

Toda entrega que muda comportamento: bump no `package.json` **e** entrada no
`CHANGELOG.md`, na mesma PR.

---

## 10. Estado atual e próximos passos

**Pronto:** domínio, portas, casos de uso, `DataJudAdapter`,
`MockCrawlerAdapter`, `ProcessoSearchService` com fallback, cache com TTL/LRU,
rate limiter, config validada, CLI, API HTTP (Fastify) com chave de API e rate
limit, Dockerfile multi-stage, CI, 172 testes.

**Não implementado (decisão consciente do MVP):** persistência em banco,
multi-tenant (a chave autentica, não separa clientes), crawler real,
monitoramento de movimentações com notificação, fila de jobs. O cache é em
memória — uma instância, e evapora no redeploy.

Ao implementar qualquer um deles, **atualize este arquivo na mesma PR.**
