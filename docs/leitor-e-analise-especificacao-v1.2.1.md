# Processo Vivo — Leitor de peças e análise por IA — Especificação v1.2.1

Documento: `leitor-e-analise-especificacao-v1.2.1` · 01/10/2026 · **substitui a v1.2.0**.
Complementa `arquitetura-mvp` (CLAUDE.md), `fontes-de-dados`, `regua-temporal`,
`sonda-movimentos-resultado-v1.0.0` e **`sonda-lote-resultado-v1.1.0`** (a base desta revisão).
Nasce do relato de um usuário de teste (advogado). Versão-alvo do repositório: **0.30.0**
(repositório hoje em 0.29.1).

**Reordena as prioridades** das especificações `ia-especificacao-v1.1.0` e `ia-prompt-agente-v1.1.0`
(seção 9): por decisão do dono, **o Jev sai do caminho**; o critério passa a ser o **melhor
custo-benefício**.

## O que mudou da v1.2.0 para a v1.2.1

Três decisões do dono (01/10/2026) fecham pontos que estavam em aberto; **nenhuma outra parte da
especificação mudou**:

1. **O repositório continua público.** A política de fixtures da seção 10 vale como escrita:
   conteúdo real de peça e nomes reais **não** entram no repositório.
2. **`poppler-utils` entra na imagem já na 0.30.0** (seção 6.1, item 1): decidido, deixa de ser
   recomendação.
3. **O VPS tem bastante espaço livre.** O limite total de disco do leitor deixa de depender de
   conferência prévia; as cotas por PDF e por workspace continuam valendo (seção 8).

## O que mudou da v1.1.0 para a v1.2.0

A sonda de lote (01/10/2026) trocou suposições por medidas, e três delas mudam o desenho:

| Mudança | v1.1.0 | v1.2.0 |
|---|---|---|
| **Download em lote** | Uma chamada ao tribunal por peça (278 peças = 278 chamadas), ritmo 30/min | O tribunal entrega **N peças numa chamada**, medido até 20: lotes **adaptativos por bytes**, 14 a 28 chamadas para 278 peças. Seções 3, 4.2 |
| **Limitador** | Balde próprio de 30/min para os jobs | **Um só balde**: o do `MniAdapter`. Dois baldes somariam acima do teto relatado (~50/min). Disjuntor global de 403. Seção 4.2 |
| **HTML** | Formato "que não dê para converter" vira página de aviso | **~30% das peças são `text/html`** (certidões, alvarás, atos). Estratégia de conversão, nunca só aviso. Seção 4.3 |
| **Tempo** | "Dezenas de segundos" por peça | 0,5 a 1,8 s por chamada medida; estimativa mostrada ao advogado usa a medição. Seção 4.1 |
| **Texto/OCR** | OCR "opcional, decidido depois" | Indício forte de PDF sem texto (~45 a 55% dos PDFs medidos sem fonte): medir já e planejar OCR. Seção 6.1 |
| **Memória e disco** | Sem números | Números iniciais e **teste de memória obrigatório**. Seções 4.3 e 8 |
| **Fixtures** | "Captura real" | Conteúdo real de peça **não entra no repositório** enquanto ele for público. Seção 10 |

## 1. O pedido, nas palavras do usuário

> O essencial agora é um leitor de PDF que possa combinar os arquivos do processo e tornar
> acessível na tela, ao lado. Depois disso, colocar a IA para analisar os PDFs combinados.

Duas decisões do dono (29/09/2026): o advogado **marca as peças** que entram (com "selecionar
todas"), e a primeira análise por IA é **resumo e pontos de atenção**, com citação da página.

## 2. O mapa em três etapas (o que vem primeiro)

| Etapa | O que entrega | Precisa de IA? |
|---|---|---|
| **1. Combinar** | Marcar peças, baixar do tribunal em lote e gerar **um PDF único** do processo, com índice de onde começa cada peça | Não |
| **2. Ler ao lado** | Painel à direita da linha do tempo com o PDF combinado, pulo para a peça clicada, busca de texto | Não |
| **3. Analisar** | Resumo, pedidos, prazos possíveis e pontos de atenção, cada afirmação com link para a página | Sim |

As etapas 1 e 2 resolvem o incômodo do advogado ("caçar o arquivo no meio de 278 peças") sem IA e
sem o risco jurídico dela. A etapa 3 só é possível **porque** a 1 existe: sem o PDF combinado e o
mapa de páginas não há como citar a página de cada afirmação.

## 3. Restrições reais que moldam o desenho (de `fontes-de-dados` e da sonda de lote)

**Medido em 01/10/2026** (um processo TJGO de 279 peças, uma tarde; ver `sonda-lote-resultado-v1.1.0`):

- **O tribunal entrega N peças por chamada.** Medido até 20, todas vieram, idênticas às
  individuais. Teto não encontrado. Cada resposta paga um pedágio de ≈ 180 KB de movimentos,
  **uma vez por chamada**.
- **Velocidade**: 0,5 a 1,8 s por chamada; listagem do processo em 0,6 a 0,7 s.
- **Tamanho** varia de 2,3 KB a 3,9 MB por arquivo. A listagem **não informa tamanho**.
- **Formatos**: 70% PDF, **30% `text/html`**. Os HTMLs medidos têm ≈ 18 KB.
- **Memória do processo**: +43 MB com resposta de 2,0 MB; +48 MB com 2,7 MB. Resposta de dezenas
  de MB **não medida**.
- **Texto**: 5 de 9 e 7 de 15 PDFs sem nenhuma fonte detectável (indício de digitalização).
  Camada de texto real não medida.
- Nenhum cabeçalho de limite de requisições visto.

**Mantido de `fontes-de-dados` (não medido de novo, tratar como vigente):**

- Limite relatado de ~50 requisições por minuto; IP de datacenter pode tomar **403 com espera de
  ~30 minutos**; a conta do advogado pode ser bloqueada por tentativa malsucedida. **Sem retry**
  no adapter (a requisição carrega a senha do advogado).
- Dá para **saber pela listagem se a peça existe, mas não se o advogado pode abri-la**: só a
  tentativa responde. Peça recusada tem de aparecer no índice como "não obtida", nunca sumir.
- O arquivo vem em **MTOM** (`xop:Include` em parte binária). Peça recém-juntada pode voltar
  vazia até o primeiro acesso.
- Rótulos do tribunal: 111 de 278 peças são "Outros".
- **Contas e workspaces já existem** (v0.14.0). Não há fila de jobs: ela entra nesta entrega em
  versão mínima.
- A vigilância e a varredura **não usam o MNI**; só as rotas de peças e o painel. O leitor é o
  primeiro uso sustentado do MNI: tem de respeitar o mesmo limitador.

## 4. Etapa 1 — Combinar

### 4.1 Seleção
Caixa de seleção em cada peça na linha do tempo (v0.24.0), botão **Selecionar todas**, atalhos por
tipo de rótulo (Petição, Decisão, Sentença...). Contador ("47 peças") e **estimativa de tempo
calculada com a medição** (chamadas = peças ÷ tamanho do lote; tempo = chamadas × (latência
medida + pausa)), não com a suposição antiga. A estimativa é uma ordem de grandeza e se diz isso na
tela. Confirmação acima de um limite configurável (ponto de partida: 150 peças).
A seleção reaproveita o **método em lote da porta `ProvedorDePecas`**, o mesmo que o ZIP usará.

### 4.2 Trabalho em segundo plano e lotes
Combinar leva minutos, então é um **job**, não uma requisição:

- `POST /processos/:numero/leitor` com os ids das peças → cria o job (`jobId`).
- `GET /processos/:numero/leitor/:jobId` → progresso (`baixadas`, `total`, `recusadas[]`, `estado`:
  `na_fila | baixando | montando | pronto | parcial | pausado_por_bloqueio | falhou`).
- Fila mínima em SQLite (tabela de jobs), **um job por vez por credencial**, retomável depois de
  redeploy (o estado sobrevive; peças já baixadas não são baixadas de novo).

**Download em lote adaptativo (novo):**

1. Pede-se as peças em **lotes** pelo método em lote de `ProvedorDePecas` (uma chamada
   `consultarProcesso` com vários `<documento>`, com `movimentos=true`).
2. **Tamanho inicial do lote: 10; máximo: 20** (valores medidos). Configuráveis.
3. **Adaptação por bytes**: se a resposta do lote anterior passar de um limite
   (`LEITOR_LOTE_MAX_RESPOSTA_MB`, ponto de partida 12 MB), o lote seguinte cai pela metade
   (mínimo 1); se vier muito abaixo (por exemplo menos de 3 MB), pode subir até o máximo. O lote
   nunca cresce depois de uma falha.
4. **Peça ausente numa resposta que teve sucesso** (não é erro de credencial): reaparece no fim
   do job **uma única vez, isolada**. Se continuar ausente, vira `nao_obtida` com motivo
   (`sem_teor` ou `ausente_no_lote`). Peça que o tribunal entrega vazia conta como `vazia`.
5. **Um único limitador**: o do `MniAdapter` (balde de 30 chamadas por minuto, compartilhado por
   todo o processo). O leitor **não cria balde próprio**: dois baldes somariam acima do teto
   relatado. Pausa mínima de 3 s entre chamadas de lote (medida como segura).
6. **Disjuntor global de 403 (novo, no adapter, não só no job):** um HTTP 403 pausa **todas** as
   consultas MNI do processo por uma janela (`MNI_PAUSA_APOS_403_MIN`, padrão 30) e os jobs
   ficam `pausado_por_bloqueio`, retomando sozinhos depois. Isso também protege o resto do
   produto (peças avulsas, painel) de insistir contra um IP bloqueado.
7. **403, credencial recusada ou `sucesso: false` interrompem o job** e entregam o que já foi
   obtido como `parcial`, com a lista do que faltou. **Nunca** insiste. Timeout e 5xx: nenhuma
   repetição automática (a requisição carrega a senha); o job termina `parcial`.
8. **Memória:** a resposta do lote é lida inteira. O agente **mede** o pico de memória com um lote
   de resposta grande (sintético, ou capturado e **não** commitado) e documenta a conta
   "tamanho da resposta × fator" que justifica o limite em MB. Se o contêiner tiver teto de
   memória, o limite deve caber nele com folga.

### 4.3 Montagem
- Ordem dos **autos** (a do MNI), não a do clique.
- Peça **PDF** entra como está. Peça em **imagem** (jpg/png) é convertida em página.
- Peça **HTML (~30% do processo; novo):** o agente **inspeciona a estrutura real** de uns poucos
  HTMLs (tags usadas, tabelas, imagens, tamanho; só as formas, nunca o conteúdo no repositório) e
  **propõe**, antes de implementar, uma de duas estratégias:
  - **A. Renderização textual em PDF** com `pdf-lib` (parágrafos, quebras e tabelas simples), a
    preferida se o HTML for simples (certidões, atos ordinatórios têm ≈ 18 KB);
  - **B. Mantê-las fora do PDF**, listadas no índice como `html_nao_incorporada` e mostradas no
    painel como texto do tribunal **sanitizado**.
  Qualquer HTML do tribunal que chegue à interface passa por **sanitização** (nunca inserido
  cru). Em nenhuma hipótese o HTML vira "página de aviso" silenciosa: o advogado tem de ver que o
  ato existe e onde ler.
- Formato que não dê para converter, arquivo vazio, corrompido ou protegido vira **uma página de
  aviso** no PDF ("Peça 47 não pôde ser incorporada: motivo") e uma linha `nao_obtida` no índice.
- Ferramenta: preferir **qpdf** (não carrega tudo na memória; permite linearizar) chamada com
  argumentos em vetor, nunca por string de shell. `pdf-lib` só para contar páginas e gerar as
  páginas de aviso, imagem e HTML renderizado. O agente **mede memória** com um processo grande e
  justifica a escolha. Precisa constar no Dockerfile (Alpine: `apk add qpdf`).
- **Índice de páginas** (JSON): `[{ pecaId, movimento, rotulo, data, paginaInicial, paginaFinal,
  situacao: 'incorporada' | 'nao_obtida' | 'convertida' | 'html_nao_incorporada', motivo? }]`. É
  a base da navegação da etapa 2 e das **citações da etapa 3**. Página nunca é estimada: é
  contada do PDF gerado.
- Cada resultado mostra a **procedência**: baixado em `<data/hora>`, origem MNI, por qual
  credencial (identificador não reversível). Nunca apresentar o arquivo como "ao vivo".

### 4.4 Atualizar
"Atualizar" baixa **só as peças novas** (`consultarAlteracao` e `hashDocumentos` detectam mudança
barato), reaproveita as já obtidas e remonta o PDF.

## 5. Etapa 2 — Ler ao lado

- Painel à **direita** da linha do tempo (divisor arrastável; no celular, tela cheia com voltar).
- **PDF.js** (`pdfjs-dist`), servido pelo **próprio servidor** (sem CDN, por privacidade e política
  de conteúdo). A interface do repositório é HTML em string, sem build: usar a versão pronta do
  PDF.js como arquivos estáticos numa rota, e dizer no CLAUDE.md que é a única dependência de
  front. `script.ts` já tem ~2.500 linhas: **o painel entra em arquivo próprio**, não dentro dele.
- **Renderização preguiçosa** (só as páginas visíveis) e leitura por trechos: o servidor responde a
  `Range` (`Accept-Ranges: bytes`) no `GET .../leitor/:jobId/pdf`. Processo de milhares de páginas
  tem de abrir sem baixar tudo.
- Clicar numa peça da linha do tempo → o painel pula para `paginaInicial`. Rolar o PDF → destaca a
  peça correspondente. Busca de texto. Zoom. Botão de baixar o PDF combinado.
- Estados honestos: baixando (com progresso), parcial (com a lista do que faltou e o motivo),
  pausado por bloqueio (com horário previsto de retomada), pronto (com data e hora do download).
  Sem "carregando" infinito.

## 6. Etapa 3 — Analisar (só depois das etapas 1 e 2 funcionando)

**Escopo (decidido pelo dono):** resumo do processo e pontos de atenção. Não há mérito, tese,
jurisprudência nem cálculo de prazo pela IA.

### 6.1 Texto por página
Extrair o texto de cada página do PDF combinado (camada de texto; `pdftotext` do poppler, que está
**ausente da imagem Alpine** e exige `apk add poppler-utils`, ou o PDF.js), guardando **peça e
página** de cada trecho. Página com pouco ou nenhum texto é **página sem texto** (escaneada).
Ela **não** é ignorada em silêncio: a análise informa "N páginas não puderam ser lidas".

**Novo:** a sonda de lote encontrou **5 de 9 e 7 de 15 PDFs sem nenhuma fonte detectável**
(indício, não medição). Se isso se confirmar com `pdftotext`, **cerca de metade dos PDFs precisa
de OCR** e a análise por IA sem OCR perderia metade do processo. Por isso:

1. Instalar `poppler-utils` na imagem **já na entrega 0.30.0** (**decidido pelo dono em
   01/10/2026**; custo pequeno; permite à sonda medir a camada de texto e prepara a Etapa 3).
2. Rodar a medição de camada de texto em 2 a 3 processos antes de decidir sobre OCR.
3. OCR (ocrmypdf/tesseract em português) segue **passo separado e opcional**, mas com decisão
   pautada por essa medição, não por suposição.

### 6.2 Como analisar um processo de milhares de páginas
Mandar tudo de uma vez não cabe e seria caro. Desenho em dois níveis, com cache:

1. **Resumo por peça**, só das peças que importam (petição inicial, contestação, réplica,
   decisões, sentença, recursos, laudos). Recibos, comprovantes e documentos pessoais ficam de
   fora. A escolha vem de **regras sem IA** (rótulo do tribunal, tamanho, palavras no início do
   texto) e, para os "Outros", de uma classificação feita pelo **mesmo modelo barato** que
   resume, na mesma chamada. Cache por `hash(peça) + versão do prompt`, sempre por credencial.
2. **Síntese do processo** a partir dos resumos e dos trechos-chave: resumo, partes e pedidos,
   fase atual, últimos atos, **pontos de atenção**, e o que a análise **não conseguiu ler**.

### 6.3 Citação verificada (o que faz isso ser confiável)
Toda afirmação sai com **(peça, página)** e um **trecho literal** curto. O sistema **confere por
código** que a página existe e que o trecho aparece no texto daquela página. Afirmação sem citação
verificável é descartada ou marcada "não verificada". Clicar na citação abre o PDF ao lado na
página certa. É a defesa principal contra invenção do modelo.

### 6.4 Regras que valem para toda análise
1. **A IA só acrescenta**; não altera, esconde nem reordena nada do processo.
2. **Prazo é da régua determinística.** A IA pode apontar "possível prazo", marcado como sugestão,
   com a página. Nunca calcula nem alarma.
3. Aviso permanente: apoio à leitura, não substitui a leitura do advogado.
4. Cada análise leva procedência: modelo, versão do modelo, versão do prompt, data, peças
   cobertas e peças não lidas.
5. Segredo de justiça: só o advogado com acesso o vê; nada disso vai para outro cliente.

### 6.5 Modelo e privacidade
Modelo de linguagem de contexto longo, chamado pelo **AI Gateway da Vercel** (mesma chave
`AI_GATEWAY_API_KEY`) com `zeroDataRetention: true`, falhando fechado. **Nem todo modelo suporta
ZDR.** Escolher o modelo por **avaliação com peças reais anonimizadas** (qualidade do resumo, taxa
de citações verificadas, custo por processo), não por preferência. Contrato/DPA e termos valem
como na seção 8 da especificação do Jev.

### 6.6 Custo-benefício (o critério que decide o desenho)
Não estimo valores em reais. O que o desenho já faz para gastar pouco, em ordem de economia:

1. **Tudo o que não precisa de IA fica sem IA**: montar o PDF, contar páginas, extrair texto,
   filtrar por rótulo e tamanho, verificar citações.
2. **Modelo barato para o volume, modelo forte só para o final.**
3. **Só o que o advogado pediu**, sob demanda, mostrando o tamanho **antes**.
4. **Cache por peça** (`hash + prompt`).
5. **Peça enorme não vai inteira.**
6. **Processamento em lote (não urgente)**, se o provedor oferecer desconto com ZDR.
7. **OCR local só nas páginas sem texto e só se o advogado pedir.**

**Como escolher o modelo, sem opinião:** avaliação com ~20 processos reais anonimizados, 3 ou 4
modelos de faixas de preço diferentes pelo AI Gateway (todos com ZDR), três medidas (citações
verificadas, qualidade lida por um advogado, custo por processo). Vence o **mais barato que passar
do limiar** (ponto de partida: 95% das afirmações com citação conferida).

## 7. Arquitetura (Ports & Adapters, sem exceção)

```
domain/
  entities/ProcessoCombinado.ts  IndicePagina.ts  JobLeitor.ts
  ports/ProvedorDePecas.ts       (+ método em lote: recebe ids e devolve conteúdo por id)
  ports/MontadorDePdf.ts         RepositorioDeArquivos.ts   FilaDeJobs.ts
  ports/ExtratorDeTextoPorPagina.ts   AnalisadorDeProcesso.ts   (Etapa 3)
application/services/ServicoLeitor.ts     ServicoAnalise.ts (Etapa 3)
infrastructure/
  adapters/mni/                       (+ lote, + disjuntor de 403 compartilhado)
  pdf/QpdfMontador.ts  PdfLibPaginas.ts  HtmlParaPdf.ts (estratégia A, se aprovada)
  arquivos/ArquivosEmDisco.ts        (fora do webroot, id aleatório, TTL)
  fila/FilaSqlite.ts
  adapters/analise/  (LLM via gateway; Etapa 3)
main/http/rotas/leitor.ts  main/http/ui/painel-pdf   (arquivo próprio; sem try/catch em rota)
```

Erros só de `domain/errors` (reaproveitar `ProviderIndisponivelError`,
`OperacaoNaoSuportadaError`; novos: `PecaNaoObtidaError`, `PdfInvalidoError`,
`LimiteDeArmazenamentoExcedidoError`, `MniBloqueadoError` para o disjuntor). Só `main/factories/`
faz `new` de infraestrutura.

## 8. Segurança e armazenamento

- **Isolamento por workspace é obrigatório aqui.** **Todo arquivo, job e índice pertence a um
  `workspace`** e **toda** leitura confere o dono. Um PDF do processo X baixado com a credencial do
  advogado A **nunca** é entregue ao advogado B, mesmo sendo o mesmo processo (o perfil de acesso
  de cada um é diferente). O job registra também a credencial usada (identificador não reversível).
- **DECISÃO DO DONO (29/09/2026): o PDF combinado É guardado em disco**, por prazo curto. Isto
  **reverte** o princípio do `CLAUDE.md` §8 ("O arquivo da peça NUNCA fica no nosso disco"). A PR do
  leitor **deve reescrever esse parágrafo** (nova regra: guarda temporária, por workspace, com
  TTL, cota e limpeza; o download individual de peça continua sem guarda) e **ajustar o teste que
  fixa as chaves da rota**, na mesma PR. Contrapartidas obrigatórias: TTL curto e configurável
  (ponto de partida 24 h), cota, limpeza pelo `Agendador` **e no logout/exclusão de conta**,
  arquivo fora do webroot com nome aleatório, **cópia de backup não inclui esses arquivos**, e
  termos/privacidade atualizados. **Segredo de justiça:** até decisão do dono, o padrão é **não
  guardar** processo com `segredoJustica === true`.
- **Tamanho em disco (números da sonda, pontos de partida a calibrar):** arquivo médio ≈ 0,9 MB
  (5 peças), mediana 115 a 214 KB, maior visto 3,9 MB. Ordem de grandeza de um processo de ~280
  peças: de algumas dezenas até ~250 MB. **Pontos de partida:** cota por PDF combinado 300 MB;
  cota por workspace 1 GB; erro claro ao estourar. **O dono informou (01/10/2026) que o VPS tem
  bastante espaço livre**, então o limite total de disco do leitor não é bloqueio; mesmo assim o
  leitor registra o uso de disco (total e por workspace) e emite aviso em log quando passar de um
  limiar configurável, para a limpeza por TTL não ser a única defesa. Valores são palpite
  calibrável, não medição.
- Arquivo em disco fora do diretório servido, nome aleatório não adivinhável, sem conteúdo em log.
- Não desmascarar nem completar dado pessoal. Segredo de justiça: só para quem o tribunal
  entregou.
- A senha do advogado continua como está (nunca em log). Job que recebe 403 não repete.
- Termos de uso e política de privacidade precisam dizer que os PDFs ficam guardados
  temporariamente e por quanto tempo, e (Etapa 3) quais operadores recebem o conteúdo.

## 9. O que acontece com as especificações do Jev (`ia-*-v1.1.0`)

Por decisão do dono, **não dependemos do Jev**. As duas especificações ficam arquivadas com o
status **adiado**, sem sonda e sem prazo. O que elas trazem continua útil e vale para qualquer
modelo: o desenho de porta, o princípio de que a IA só acrescenta, a regra de falhar fechado na
retenção zero, o isolamento por credencial e a política de "incerteza é resposta legítima". A
regra "a IA nunca esconde nem filtra andamento" vale para tudo.

## 10. Testes (regras do repositório valem)

- Vitest, sem rede, sem tempo real (`ClockFalso`), nomes descrevem **comportamento**.
- **Fixtures e dado pessoal (novo):** o repositório é público (**decisão do dono, 01/10/2026:
  continua público**) e o dado real de peça contém nomes de partes e advogados. **Conteúdo real de peça não entra no repositório.** Comportamento do MNI
  testado contra captura real **apenas quanto à estrutura** (envelope, MTOM, atributos), com
  **conteúdo substituído por bytes sintéticos** e nomes anonimizados, registrando a exceção à regra
  "não editar fixtures de captura" no `CLAUDE.md`. PDFs de teste pequenos gerados por biblioteca
  são aceitáveis.
- Casos obrigatórios: ordem dos autos preservada; **índice com páginas exatas** (contadas do PDF
  gerado); peça recusada aparece como `nao_obtida` e não some; **lote devolve peça ausente → peça
  é pedida uma vez isolada e, se continuar ausente, vira `nao_obtida`**; **lote reduz pela
  metade quando a resposta passa do limite em MB**; **403 abre o disjuntor, pausa todo o MNI e
  entrega `parcial`, sem repetir**; **o leitor usa o mesmo limitador do adapter** (teste que falha
  se houver segundo balde); download nunca ultrapassa o ritmo configurado; peça em imagem
  convertida; **HTML é tratado conforme a estratégia aprovada e nunca é servido sem
  sanitização**; arquivo vazio/corrompido vira página de aviso; **workspace B nunca lê arquivo do
  workspace A** (teste explícito); TTL e exclusão de conta apagam o arquivo; `Range` devolve o
  trecho certo; cota estourada falha com erro claro; atualização baixa só as peças novas; senha e
  conteúdo fora do log; **teste de memória com resposta de lote grande sintética**.
- Etapa 3: citação com trecho que não existe na página é rejeitada; página sem texto é informada;
  toda chamada ao gateway leva `zeroDataRetention: true`; a análise mostra o tamanho **antes** de
  rodar e respeita a cota; peça já analisada não gera nova chamada; peça acima do limite entra
  parcial e diz isso; reanalisar com o mesmo `hash + prompt` usa o cache.
- `npm run check` verde antes de qualquer commit; bump no `package.json`, `CHANGELOG.md` e
  `CLAUDE.md` na mesma PR.

## 11. Decisões abertas para o dono

1. **Segredo de justiça:** não guardar (padrão) ou TTL menor.
2. **Estratégia para HTML:** A (renderizar em PDF) ou B (fora do PDF, painel). O agente propõe
   depois de inspecionar a estrutura real; o dono decide.
3. ~~`poppler-utils` na imagem já na 0.30.0~~ **Decidido: sim** (01/10/2026).
4. ~~Repositório público ou privado~~ **Decidido: continua público** (01/10/2026); vale a política de fixtures da seção 10.
5. ~~Espaço em disco do VPS~~ **Decidido: há bastante espaço** (01/10/2026); cotas por PDF e por workspace continuam.
6. Em qual plano entra o leitor (recomendação: Peças, com recurso `leitor` próprio no catálogo).
7. Se o painel abre em tela dividida por padrão ou por botão "Abrir leitor" (recomendação: botão).
8. Se a Etapa 3 entra como plano IA já ou atrás de teste fechado.
9. Qual cota mensal de análises o plano IA inclui (a avaliação de custo dá o número).
10. Maior processo que um cliente de teste quer abrir (para medir memória e tempo).

Fontes: relato do usuário de teste (via João Paulo), `fontes-de-dados`, `regua-temporal`,
`arquitetura-mvp`, `sonda-movimentos-resultado-v1.0.0`, `sonda-lote-resultado-v1.1.0`;
documentação da Vercel sobre Zero Data Retention no AI Gateway. Não medi o tamanho real de um
processo combinado, memória com resposta grande nem a qualidade de um resumo em português
jurídico: por isso o teste de memória (Etapa 1) e a avaliação de modelos (Etapa 3).

## Histórico de versões

- **v1.2.1 (01/10/2026):** registra três decisões do dono (repositório continua público;
  `poppler-utils` na imagem na 0.30.0; VPS com bastante espaço); sem outra mudança de desenho.
- **v1.2.0 (01/10/2026):** incorpora a sonda de lote: download em lote adaptativo, limitador
  único e disjuntor global de 403, tratamento de HTML, estimativa de tempo medida, números de
  tamanho em disco, `poppler-utils` e OCR com base em medição, política de fixtures, painel em
  arquivo próprio; substitui a v1.1.0.
- **v1.1.0 (29/09/2026):** guarda do PDF em disco decidida; isolamento por workspace; versão-alvo
  0.30.0; `pdftotext` ausente no Alpine; sonda com `--listar` e `--agrupada`.
- **v1.0.0 (29/09/2026):** primeira versão.
