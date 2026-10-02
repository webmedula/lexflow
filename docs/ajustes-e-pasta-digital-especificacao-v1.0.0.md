# Ajustes dos advogados e Pasta digital — especificação — v1.0.0

Documento: `ajustes-e-pasta-digital-especificacao-v1.0.0` · 02/10/2026 · repositório
`webmedula/processovivo` (base: **v0.32.0**).

Origem: rodada de conversas do dono do produto com advogados. Duas entregas:

- **0.32.1 — ajustes pequenos** (seções 2 a 4): Atualizações mais curtas, Peças primeiro na tela do
  processo, janela menor para "pede providência".
- **0.33.0 — Pasta digital** (seções 5 a 10): árvore de peças à esquerda e visualizador à direita, no
  estilo da pasta digital do e-SAJ, com abertura de peça sob demanda e opção de montar tudo.

## 1. Decisões do dono (02/10/2026)

| Tema | Decisão |
|---|---|
| Atualizações | Mostrar a última atualização de cada processo (as anteriores continuam acessíveis) |
| Tela do processo | Card "Peças do processo" logo depois dos dados do processo |
| "Pede providência" | **Reduzir a janela de dias** (não remover o card) |
| Leitor | Manter a conversão de HTML (o tribunal entrega ~30% das peças, e quase todos os despachos e decisões, em HTML); aviso mais discreto |
| Pasta digital | Abrir a peça **ao clicar** (baixa só ela) **e** oferecer "Montar pasta completa" |

## 2. Atualizações (0.32.1)

- Uma **linha por processo**, com a atualização **mais recente** em destaque. As anteriores do mesmo
  processo ficam atrás de "+N anteriores", que expande **na própria linha** (nada é descartado:
  regra do `CLAUDE.md` "toda tela que esconde linha diz quantas escondeu").
- Janela de tempo: padrão **15 dias** (`NOVIDADES_JANELA_DIAS`, configurável), com a opção na tela
  "Últimos 15 dias | Todas". Fora da janela, a tela diz "N atualizações mais antigas não mostradas".
- Ordem: mais recente primeiro. "Marcar como vistas" continua valendo para o grupo inteiro do
  processo e conta as atualizações, não as linhas.
- **Triagem ordena, nunca esconde:** o agrupamento não usa `exigeAcao` como filtro. Uma atualização
  anterior que exige ação continua marcada ao expandir.
- Contagem do menu lateral e do painel continuam contando **atualizações não vistas**, não linhas.

## 3. Tela do processo (0.32.1)

Ordem do topo para baixo:

1. Cabeçalho e dados do processo (número, tribunal, vara, distribuição, partes resumidas).
2. **Card "Peças do processo"** (com o botão da Pasta digital; na 0.32.1 ainda "Ler peças ao lado").
3. Última movimentação.
4. "Pede providência" (seção 4).
5. Partes, linha do tempo, demais blocos, como hoje.

Quando as peças ainda não foram carregadas (sem credencial, sem MNI), o card mostra a mensagem atual
do estado, sem ocupar espaço vazio ("bloco de tela só nasce com conteúdo").

## 4. "Pede providência": janela menor (0.32.1)

- `DIAS_DE_PENDENCIA` (`estadoDaPasta.ts`) passa de **30 para 10** e vira configuração
  (`PENDENCIA_JANELA_DIAS`), usada em **um só lugar** por: selo "pede providência" da carteira, card
  do painel e bloco da tela do processo.
- O bloco "Pede providência" da tela do processo lista só os atos dentro da janela. Abaixo dele:
  "N atos anteriores que pedem providência não estão aqui — veja na linha do tempo". A linha do tempo
  **continua marcando** esses atos; nada é ocultado, só deixa de ocupar o topo.
- Mesma redação de sempre: "isto não é contagem de prazo". O sistema não calcula prazo.
- Atualizar `CLAUDE.md` §8 ("Janela nas heurísticas…" fala em 30 dias) e os testes de
  `estadoDaPasta` e do painel.

## 5. Pasta digital — visão (0.33.0)

Substitui o painel "Ler peças ao lado". Na tela do processo, o botão **Pasta digital** abre a
interface em duas colunas: **lista de peças à esquerda**, **visualizador à direita**.

Referência: a pasta digital do e-SAJ (árvore com caixas, intervalo de páginas, visualizador ao lado,
barra "Todas / Nenhuma / Baixar PDF"). Diferença assumida: o e-SAJ já tem a pasta montada; aqui as
peças vêm do tribunal sob demanda e ficam em cache por 24 h.

## 6. Lista de peças (coluna esquerda)

- Todas as peças do processo, **na ordem dos autos** (a mesma da linha do tempo), com: rótulo do
  tribunal, data, e o **estado de cada peça**: `não baixada` · `na fila` · `baixando` · `disponível`
  · `não obtida` (com motivo) · `sigilo` (desabilitada, com motivo).
- Quando o PDF montado existe, mostra também o intervalo de páginas (`p. 41–42`), contado do arquivo.
- Caixa de marcar por peça, atalhos por tipo (os do v0.31), "Todas / Nenhuma", contador.
- Busca por rótulo. Filtro "só disponíveis".
- Teclado: setas navegam, Enter abre, Espaço marca. Foco visível.

## 7. Visualizador (coluna direita) — abrir ao clicar

- Clicar numa peça pede **apenas aquela peça** ao tribunal pelo método em lote existente (lote de 1),
  guarda o resultado em **cache por workspace** (24 h, mesma cota do PDF combinado) e mostra no PDF.js.
  Peça HTML do tribunal é convertida em texto como hoje (v0.30.0) e mostrada do mesmo jeito.
- **Proteção do tribunal (inegociável):** usa o **mesmo e único limitador** do `MniAdapter`, com a
  pausa mínima de 3 s entre chamadas e o disjuntor de 403. Cliques em sequência rápida **não geram
  uma chamada por clique**: a fila guarda só o último pedido pendente (os intermediários são
  descartados antes de ir ao tribunal), com debounce de ~400 ms. Peça já em cache abre sem chamada.
- Sem pré-busca (prefetch) nesta versão: nenhuma peça é buscada sem o advogado ter pedido.
- Estados honestos: "Baixando esta peça…", "Aguardando (fila do tribunal)", "Pausado pelo tribunal
  até HH:MM", "Esta peça não pôde ser obtida: <motivo>", "Sem habilitação nos autos", e a data/hora
  da obtenção + "não é consulta ao vivo". Nunca "carregando" sem fim: se a busca passar do tempo
  limite, a tela para e oferece "tentar de novo".
- Peça em **segredo de justiça**: continua desabilitada (nada é guardado em disco).

## 8. Montar pasta completa e baixar

- **"Montar pasta completa"**: cria o job em lote já existente para todas as peças não sigilosas que
  ainda não estão em cache. A lista atualiza o estado de cada peça **conforme os lotes chegam**; o
  advogado pode ler enquanto monta. Estimativa de tempo pela medição (≈ 2,4 min para 278 peças).
  Confirmação acima do limite configurável (como hoje, 150).
- Ao terminar, o PDF combinado com índice de páginas passa a existir e a lista mostra os intervalos
  de páginas. O modo **"Ver tudo seguido"** (leitor contínuo da v0.31) fica disponível.
- **"Baixar PDF" (marcadas):** junta as peças marcadas, na ordem dos autos, usando o que já está em
  cache e **buscando só o que falta**. Se faltar peça, mostra "serão buscadas N peças no tribunal
  (~X s)" antes de iniciar. Nome do arquivo: `processo-<número>-pecas-selecionadas.pdf`, com índice.
- **Atualizar:** busca só as peças novas (como hoje).

## 9. Armazenamento, isolamento e privacidade

- Cache por peça: nome aleatório, **fora do diretório servido**, por workspace, TTL 24 h, cota de
  1 GB por workspace (mesma do leitor; peça avulsa e PDF combinado somam), fora do backup, limpeza
  pelo `Agendador`. Peça em cache **reaproveitada** na montagem (nunca baixar duas vezes).
- Regra de substituição da cota: a da v0.31.1 (saem primeiro os mais antigos de **outros** processos;
  nunca sai o que um pedido em andamento vai usar).
- **Isolamento por workspace (inegociável):** toda leitura confere o dono. Teste explícito A × B.
- Procedência em toda resposta (`aoVivo: false`). Nenhum conteúdo de peça em log, resposta de erro
  ou índice. `CLAUDE.md` §8: acrescentar a peça avulsa em cache à regra de armazenamento.

## 10. Rotas e testes (sugestão; o agente pode propor ajustes)

- `GET /v1/processos/:numero/pasta` — lista de peças + estado de cada uma (cache) + intervalos.
- `POST /v1/processos/:numero/pasta/pecas/:pecaId` — pede aquela peça (idempotente; respeita fila).
- `GET /v1/processos/:numero/pasta/pecas/:pecaId/arquivo` — PDF da peça (Range).
- `POST /v1/processos/:numero/pasta/montar` — "Montar pasta completa".
- `POST /v1/processos/:numero/pasta/baixar` — PDF das marcadas.
- Sem `try/catch` na rota; erros só de `domain/errors`.

Testes (sem rede, sem tempo real): cliques rápidos geram no máximo 1 chamada por janela de 3 s e
descartam os intermediários; peça em cache não chama o tribunal; 403 pausa e a tela mostra o horário;
montagem parcial atualiza estados por lote; baixar marcadas usa cache e só busca o que falta;
isolamento A × B; segredo de justiça nunca é guardado; teste que falha se o módulo criar um segundo
limitador; HTML do tribunal nunca chega ao DOM sem conversão.

## 11. Fora do escopo

Pré-busca automática, OCR, análise por IA, ZIP de peças, busca de texto dentro das peças (continua
como no leitor), convite de membros, alarmes de prazo.

## 12. Decisões em aberto

1. Janela de "Atualizações": 15 dias (**sim**) ou outro valor.
2. `PENDENCIA_JANELA_DIAS` em 10 (**sim**) ou 7.
3. Depois de usar, avaliar pré-busca da próxima peça (recomendo **não** antes de medir bloqueios).

## 13. Histórico de versões

- **v1.0.0 (02/10/2026):** primeira versão.
