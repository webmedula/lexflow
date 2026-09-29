# Processo Vivo — Leitor de peças e análise por IA — Especificação v1.0.0

Documento: `leitor-e-analise-especificacao-v1.0.0` · 29/09/2026 · nasce do relato de um usuário de
teste (advogado). Complementa `arquitetura-mvp`, `fontes-de-dados` e `regua-temporal` (v0.24.0).
**Reordena as prioridades** das especificações `ia-especificacao-v1.1.0` e
`ia-prompt-agente-v1.1.0` (ver seção 9): por decisão sua, **o Jev sai do caminho**; o critério
passa a ser o **melhor custo-benefício**.

## 1. O pedido, nas palavras do usuário

> O essencial agora é um leitor de PDF que possa combinar os arquivos do processo e tornar
> acessível na tela, ao lado. Depois disso, colocar a IA para analisar os PDFs combinados.

Duas decisões suas (29/09/2026): o advogado **marca as peças** que entram (com "selecionar
todas"), e a primeira análise por IA é **resumo e pontos de atenção**, com citação da página.

## 2. O mapa em três etapas (o que vem primeiro)

| Etapa | O que entrega | Precisa de IA? |
|---|---|---|
| **1. Combinar** | Marcar peças, baixar do tribunal em lote e gerar **um PDF único** do processo, com índice de onde começa cada peça. | Não |
| **2. Ler ao lado** | Painel à direita da linha do tempo que mostra o PDF combinado, pula para a peça clicada, busca texto. | Não |
| **3. Analisar** | Resumo, pedidos, prazos possíveis e pontos de atenção, cada afirmação com link para a página. | Sim (modelo de linguagem) |

As etapas 1 e 2 já resolvem o incômodo do advogado ("caçar o arquivo no meio de 278 peças") sem
nenhuma IA e sem o risco jurídico dela. A etapa 3 só é possível **porque** a 1 existe: sem o PDF
combinado e o mapa de páginas não há como citar a página de onde saiu cada afirmação.

## 3. Restrições reais que moldam o desenho (de `fontes-de-dados`)

- **Cada peça é uma chamada ao tribunal** (MNI, `consultarProcesso` com `documento=<id>`), e cada
  resposta leva ~250 KB de movimentos como pedágio. Processo com 278 peças = 278 chamadas.
- **Limite relatado de ~50 requisições por minuto**; IP de datacenter pode tomar **403 com
  espera de ~30 minutos**; a conta do advogado pode ser bloqueada por tentativa malsucedida.
  **Não há retry** no adapter (a requisição carrega a senha do advogado).
- Dá para **saber pela listagem se a peça existe, mas não se o advogado pode abri-la**: só a
  tentativa responde. Peça recusada tem de aparecer no índice como "não obtida", nunca sumir.
- O arquivo vem em **MTOM** (`xop:Include` em parte binária), não em base64. Peça recém-juntada
  pode voltar vazia até o primeiro acesso.
- Rótulos do tribunal: 111 de 278 peças são "Outros". Nem todo arquivo será PDF.
- Multi-tenant **ainda não existe** (a chave autentica, não separa clientes) e não há fila de
  jobs. Ambos entram nesta entrega em versão mínima (seções 5 e 8).

## 4. Etapa 1 — Combinar

### 4.1 Seleção
Caixa de seleção em cada peça na linha do tempo (v0.24.0), botão **Selecionar todas**, e atalhos
por tipo de rótulo (Petição, Decisão, Sentença...). Contador ("47 peças") e **estimativa de
tempo** (peças ÷ ritmo conservador, abaixo do teto do tribunal). Confirmação acima de um limite
configurável. A seleção reaproveita o mesmo **método em lote da porta `ProvedorDePecas`** que já
está na fila para o ZIP: o mesmo trabalho serve aos dois; o PDF combinado vem primeiro.

### 4.2 Trabalho em segundo plano
Combinar leva minutos, então é um **job**, não uma requisição:

- `POST /processos/:numero/leitor` com os ids das peças → cria o job (`jobId`).
- `GET /processos/:numero/leitor/:jobId` → progresso (`baixadas`, `total`, `recusadas[]`,
  `estado`: `na_fila | baixando | montando | pronto | parcial | falhou`).
- Fila mínima em SQLite (tabela de jobs), um job por vez por credencial, retomável depois de
  redeploy (o estado sobrevive; as peças já baixadas não são baixadas de novo).
- Download **sequencial**, com `TokenBucketRateLimiter` em ritmo abaixo do teto (ponto de
  partida: 30/min, calibrar). **403 ou recusa de credencial interrompe o job** e entrega o que
  já foi obtido como `parcial`, com a lista do que faltou. **Nunca** insiste.

### 4.3 Montagem
- Ordem dos **autos** (a do MNI), não a do clique.
- Peça PDF entra como está. Peça em **imagem** (jpg/png) é convertida em página. Formato que não
  dê para converter, arquivo vazio, corrompido ou protegido vira **uma página de aviso** no PDF
  ("Peça 47 não pôde ser incorporada: motivo") e uma linha "não obtida" no índice.
- Ferramenta: preferir **qpdf** (não carrega tudo na memória; permite linearizar para leitura
  por trechos) chamada com argumentos em vetor, nunca por string de shell. `pdf-lib` só para
  contar páginas e gerar as páginas de aviso/imagem. O agente **mede memória** com um processo
  grande e justifica a escolha. Precisa constar no Dockerfile.
- **Índice de páginas** (JSON): `[{ pecaId, movimento, rotulo, data, paginaInicial,
  paginaFinal, situacao: 'incorporada' | 'nao_obtida' | 'convertida', motivo? }]`. É a base da
  navegação da etapa 2 e das **citações da etapa 3**. Página nunca é estimada: é contada do PDF
  gerado.
- Cada resultado mostra a **procedência**: baixado em `<data/hora>`, origem MNI, por qual
  credencial (identificador não reversível). Nunca apresentar o arquivo como "ao vivo".

### 4.4 Atualizar
"Atualizar" baixa **só as peças novas** (`consultarAlteracao` e `hashDocumentos` detectam
mudança barato), reaproveita as já obtidas e remonta o PDF.

## 5. Etapa 2 — Ler ao lado

- Painel à **direita** da linha do tempo (divisor arrastável; no celular, tela cheia com voltar).
- **PDF.js** (`pdfjs-dist`), servido pelo **próprio servidor** (sem CDN, por privacidade e
  política de conteúdo). A interface do repositório é HTML em string, sem build: usar a versão
  pronta do PDF.js como arquivos estáticos numa rota, e dizer no CLAUDE.md que é a única
  dependência de front.
- **Renderização preguiçosa** (só as páginas visíveis) e leitura por trechos: o servidor
  responde a `Range` (`Accept-Ranges: bytes`) no `GET .../leitor/:jobId/pdf`. Processo de
  milhares de páginas tem de abrir sem baixar tudo.
- Clicar numa peça da linha do tempo → o painel pula para `paginaInicial`. Rolar o PDF →
  destaca a peça correspondente. Busca de texto. Zoom. Botão de baixar o PDF combinado.
- Estados honestos: baixando (com progresso), parcial (com a lista do que faltou), pronto.
  Sem "carregando" infinito.

## 6. Etapa 3 — Analisar (só depois das etapas 1 e 2 funcionando)

**Escopo (decidido por você):** resumo do processo e pontos de atenção. Não há mérito, tese,
jurisprudência nem cálculo de prazo pela IA.

### 6.1 Texto por página
Extrair o texto de cada página do PDF combinado (camada de texto; `pdftotext` do poppler ou o
PDF.js), guardando **peça e página** de cada trecho. Página com pouco ou nenhum texto é
**página sem texto** (escaneada). Ela **não** é ignorada em silêncio: a análise informa "N
páginas não puderam ser lidas". OCR (ocrmypdf/tesseract em português) é um passo **separado e
opcional**, com custo de tempo, decidido depois de medir quantas páginas reais não têm texto.

### 6.2 Como analisar um processo de milhares de páginas
Mandar tudo de uma vez não cabe (o processo medido tem 278 peças) e seria caro. Desenho em dois
níveis, com cache:

1. **Resumo por peça**, só das peças que importam (petição inicial, contestação, réplica,
   decisões, sentença, recursos, laudos). Recibos, comprovantes e documentos pessoais ficam de
   fora. A escolha vem de **regras sem IA** (rótulo do tribunal, tamanho, palavras no início do
   texto) e, para os "Outros", de uma classificação feita pelo **mesmo modelo barato** que
   resume, na mesma chamada ("que tipo de peça é? vale resumir?"). Cache por
   `hash(peça) + versão do prompt`, sempre por credencial (seção 8).
2. **Síntese do processo** a partir dos resumos e dos trechos-chave: resumo, partes e pedidos,
   fase atual, últimos atos, **pontos de atenção** ("intimação para manifestar em curso",
   "pedido de tutela sem decisão"), e o que a análise **não conseguiu ler**.

### 6.3 Citação verificada (o que faz isso ser confiável)
Toda afirmação sai com **(peça, página)** e um **trecho literal** curto. O sistema **confere por
código** que a página existe e que o trecho aparece no texto daquela página. Afirmação sem
citação verificável é descartada ou marcada "não verificada". Clicar na citação abre o PDF ao
lado na página certa. É a defesa principal contra invenção do modelo.

### 6.4 Regras que valem para toda análise
1. **A IA só acrescenta**; não altera, esconde nem reordena nada do processo.
2. **Prazo é da régua determinística.** A IA pode apontar "possível prazo", marcado como
   sugestão, com a página. Nunca calcula nem alarma.
3. Aviso permanente: apoio à leitura, não substitui a leitura do advogado.
4. Cada análise leva procedência: modelo, versão do modelo, versão do prompt, data, peças
   cobertas e peças não lidas.
5. Segredo de justiça: só o advogado com acesso o vê; nada disso vai para outro cliente.

### 6.5 Modelo e privacidade
Modelo de linguagem de contexto longo, chamado pelo **AI Gateway da Vercel** (a mesma chave
`AI_GATEWAY_API_KEY`) com `zeroDataRetention: true`, falhando fechado como na especificação do
Jev. Cuidado: **nem todo modelo suporta ZDR** (a documentação da Vercel cita um que não
suporta em nenhum provedor). Escolher o modelo por **avaliação com peças reais anonimizadas**
(qualidade do resumo, taxa de citações verificadas, custo por processo), não por preferência.
O contrato/DPA e os termos de uso valem como na seção 8 da especificação do Jev.

### 6.6 Custo-benefício (o critério que decide o desenho)
Não estimo valores em reais: os preços mudam e dependem do modelo. A avaliação mede tokens e
custo por processo antes de definir o preço do plano IA. O que o desenho já faz para gastar
pouco, em ordem de economia:

1. **Tudo o que não precisa de IA fica sem IA:** montar o PDF, contar páginas, extrair texto
   (camada de texto local), filtrar por rótulo e por tamanho, verificar citações. Custo zero de
   modelo.
2. **Modelo barato para o volume, modelo forte só para o final.** Os resumos por peça (muito
   texto, tarefa simples) usam um modelo pequeno e barato; a síntese final (pouco texto, tarefa
   difícil) usa um modelo melhor, que recebe só os resumos e os trechos-chave. É aqui que está
   a maior parte da economia.
3. **Só o que o advogado pediu.** A análise roda **sob demanda**, sobre as peças marcadas, e
   mostra **antes** o tamanho ("38 peças, ~1.900 páginas") e o uso do plano (cota mensal de
   análises). Nada de analisar processo inteiro por padrão.
4. **Cache por peça** (`hash + prompt`): reanalisar não paga de novo; peça nova paga só a nova.
5. **Peça enorme não vai inteira.** Acima de um limite de páginas entram início e fim, mais os
   trechos que casam com palavras-chave; o resumo informa que foi parcial.
6. **Processamento em lote (não urgente)**, se o provedor oferecer desconto para chamadas
   assíncronas e ele valer com retenção zero, já que a análise é um job e o advogado não fica
   olhando. Verificar na avaliação; não assumir.
7. **OCR local** (tesseract) só nas páginas sem texto, e só se o advogado pedir, porque custa
   tempo de servidor.

**Como escolher o modelo, sem opinião:** avaliação com ~20 processos reais anonimizados, 3 ou 4
modelos de faixas de preço diferentes pelo AI Gateway (todos com ZDR), mesma pergunta, e três
medidas: **citações verificadas** (%), qualidade do resumo lida por um advogado, e **custo por
processo**. Vence o **mais barato que passar do limiar** de citações verificadas (ponto de
partida: 95% das afirmações com citação conferida), não o melhor em geral.

## 7. Arquitetura (Ports & Adapters, sem exceção)

```
domain/
  entities/ProcessoCombinado.ts  IndicePagina.ts  JobLeitor.ts
  ports/ProvedorDePecas.ts       (+ método em lote, já previsto)
  ports/MontadorDePdf.ts         RepositorioDeArquivos.ts   FilaDeJobs.ts
  ports/ExtratorDeTextoPorPagina.ts   AnalisadorDeProcesso.ts   (Etapa 3)
application/services/ServicoLeitor.ts     ServicoAnalise.ts (Etapa 3)
infrastructure/
  pdf/QpdfMontador.ts  PdfLibPaginas.ts
  arquivos/ArquivosEmDisco.ts        (fora do webroot, id aleatório, TTL)
  fila/FilaSqlite.ts
  adapters/analise/  (LLM via gateway; Etapa 3)
main/http/rotas/leitor.ts  main/http/ui/painel-pdf   (sem try/catch em rota)
```

Erros só de `domain/errors` (reaproveitar `ProviderIndisponivelError`,
`OperacaoNaoSuportadaError`; novos: `PecaNaoObtidaError`, `PdfInvalidoError`,
`LimiteDeArmazenamentoExcedidoError`). Só `main/factories/` faz `new` de infraestrutura.

## 8. Segurança e armazenamento

- **Isolamento por cliente é obrigatório aqui.** A chave autentica, não separa clientes. Enquanto
  não houver multi-tenant completo, **todo arquivo, job e índice pertence a uma credencial**
  (identificador não reversível) e **toda** leitura confere o dono. Um PDF do processo X baixado
  com a credencial do advogado A **nunca** é entregue ao advogado B, mesmo sendo o mesmo processo
  (o perfil de acesso de cada um é diferente).
- Arquivo em disco fora do diretório servido, nome aleatório não adivinhável, sem conteúdo em
  log. **Prazo de validade** configurável (ponto de partida: 24 h para o PDF, mais para o
  índice) com limpeza pelo `Agendador`; **cota** por processo e total de disco, com erro claro
  ao estourar. Backup fora do VPS (pendência já listada) não deve incluir esses arquivos.
- Não desmascarar nem completar dado pessoal. Segredo de justiça: só para quem o tribunal
  entregou.
- A senha do advogado continua como está (nunca em log). Job que recebe 403 não repete.
- Termos de uso e política de privacidade precisam dizer que os PDFs ficam guardados
  temporariamente e por quanto tempo, e (Etapa 3) quais operadores recebem o conteúdo.

## 9. O que acontece com as especificações do Jev (`ia-*-v1.1.0`)

Por decisão sua, **não dependemos do Jev**. As duas especificações ficam arquivadas com o
status **adiado**, sem sonda e sem prazo. O que elas trazem continua útil e vale para qualquer
modelo: o desenho de porta (`Classificador...`), o princípio de que a IA só acrescenta, a
regra de falhar fechado na retenção zero, o isolamento por credencial e a política de
"incerteza é resposta legítima". Se um dia a classificação de andamentos por IA voltar ao
escopo, a mesma porta aceita qualquer modelo, inclusive um modelo barato de linguagem com saída
validada por Zod. A regra "a IA nunca esconde nem filtra andamento" vale para tudo.

## 10. Testes (regras do repositório valem)

- Vitest, sem rede, sem tempo real (`ClockFalso`), nomes descrevem **comportamento**.
- Comportamento do MNI testado contra **captura real** (multipart MTOM); PDFs de teste pequenos
  gerados por biblioteca são aceitáveis para a lógica de montagem.
- Casos obrigatórios: ordem dos autos preservada; **índice com páginas exatas** (contadas do PDF
  gerado); peça recusada aparece como `nao_obtida` e não some; 403 interrompe e entrega `parcial`
  sem repetir; download nunca ultrapassa o ritmo configurado; peça em imagem convertida; arquivo
  vazio/corrompido vira página de aviso; **credencial B nunca lê arquivo da credencial A**
  (teste explícito); `Range` devolve o trecho certo; expiração apaga o arquivo; cota estourada
  falha com erro claro; atualização baixa só as peças novas; senha e conteúdo fora do log.
- Etapa 3: citação com trecho que não existe na página é rejeitada; página sem texto é
  informada; toda chamada ao gateway leva `zeroDataRetention: true`; a análise mostra o
  tamanho **antes** de rodar e respeita a cota; peça já analisada não gera nova chamada; peça
  acima do limite entra parcial e diz isso; reanalisar com o mesmo `hash + prompt` usa o cache.
- `npm run check` verde antes de qualquer commit; bump no `package.json`, `CHANGELOG.md` e
  `CLAUDE.md` na mesma PR.

## 11. Decisões abertas para você

1. **Limite de tamanho** aceitável (peças e MB por processo) e por quanto tempo guardar o PDF.
2. Qual **é o maior processo** que um cliente de teste quer abrir (para medir tempo e memória).
3. Se a **linha do tempo com o painel ao lado** deve abrir em tela dividida por padrão ou por
   botão "Abrir leitor".
4. Se a Etapa 3 entra como **plano IA** já ou fica atrás de teste fechado.
5. Qual **cota mensal de análises** o plano IA inclui (a avaliação de custo da Etapa 3 dá o
   número para decidir).

Fontes: relato do usuário de teste (via João Paulo), `fontes-de-dados`, `regua-temporal`,
`arquitetura-mvp`; documentação da Vercel sobre Zero Data Retention no AI Gateway. Não medi o
tamanho real de um processo combinado nem a qualidade de um resumo em português jurídico: por isso
a sonda de lote (Etapa 1) e a avaliação de modelos (Etapa 3).
