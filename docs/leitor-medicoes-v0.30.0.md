# Leitor de peças — medições e decisões da Etapa 1 — v0.30.0

Documento: `leitor-medicoes-v0.30.0` · 01/10/2026. Acompanha a entrega 0.30.0
(Etapa 1 da `leitor-e-analise-especificacao-v1.2.1`). Tudo aqui foi medido com
dado **sintético** (PDFs gerados por biblioteca, respostas MNI montadas com a
forma da resposta real e bytes inventados), num contêiner Linux x86-64 com Node 22. **Nenhuma consulta ao tribunal foi feita para esta entrega.**

## 1. Montagem do PDF: qpdf, não pdf-lib

280 PDFs sintéticos (1 a 7 páginas, 1 em cada 10 com 3,9 MB, o resto entre 100 e
300 KB — a distribuição da sonda de lote), 160 MB no total, 1.120 páginas:

| Ferramenta                                               | Pico de memória                     | Tempo |
| -------------------------------------------------------- | ----------------------------------- | ----- |
| `qpdf --empty --pages … -- --linearize` (outro processo) | **37 MB** de RSS                    | ~14 s |
| `pdf-lib` (`copyPages` + `save`, dentro do Node)         | **+357 MB** no processo do servidor | —     |

Decisão: o qpdf junta (argumentos em vetor via `execFile`, nunca shell, com
`--linearize` para o PDF.js abrir a primeira página pelos primeiros KB); o
pdf-lib só gera o que é pequeno — páginas de aviso e imagem convertida em
página. A contagem de páginas de cada parte sai do qpdf antes de juntar, e o
total sai do arquivo gerado depois; se não baterem, a montagem falha
(`PdfInvalidoError`) em vez de entregar um índice torto.

## 2. Memória do lote: a conta que justifica `LEITOR_LOTE_MAX_RESPOSTA_MB`

Script reprodutível: `node --expose-gc scripts/medir-memoria-lote.mjs 3 12 24 48`
(depois de `npm run build`). Resposta sintética com 385 movimentos (~180 KB de
pedágio) e 20 documentos; a resposta é carregada antes da medida e o pico é o
`maxRSS` do processo durante a leitura pelo adapter.

**Leitura da resposta pelo adapter (MTOM + XML):**

| Resposta | Antes do ajuste (cópia por anexo) | Depois (vista sobre a resposta) |
| -------- | --------------------------------- | ------------------------------- |
| 3,3 MB   | +11,5 MB                          | +7,9 MB                         |
| 12,3 MB  | +24,8 MB                          | +8,0 MB                         |
| 24,3 MB  | +48,8 MB                          | +8,0 MB                         |
| 48,3 MB  | +74,7 MB                          | +7,9 MB                         |

O ajuste (em `mtom.ts`): o leitor de multipart deixou de copiar a resposta
inteira e cada anexo binário; os arquivos do lote passam a ser **vistas** sobre
o buffer da resposta. O custo que sobra é fixo (~8 MB: o parser do XML da linha
do tempo). Há teste que fixa a propriedade (`mni-lote.spec.ts`, "os arquivos do
lote são VISTAS da resposta").

**Recebimento pela rede (`fetch` + `arrayBuffer`), servidor local:**

| Resposta | Pico acima do repouso |
| -------- | --------------------- |
| 12 MB    | +64 MB                |
| 24 MB    | +100 MB               |
| 48 MB    | +167 MB               |

**A conta:** pico de um lote ≈ **3 × resposta + ~30 MB** (recebimento ≈ 3×,
porque o `fetch` acumula os pedaços e depois concatena; leitura +8 MB).

- Com o limite padrão de **12 MB**: ≈ **70 MB** acima do repouso do processo
  (que a sonda mediu em ~63 MB). Cabe com folga num contêiner de 512 MB.
- O limite **corta o lote seguinte**, não o atual: a listagem não diz o tamanho
  de nada, e só a resposta anterior informa. O primeiro lote é, portanto, o
  único pedido às cegas — e por isso ele é de **5 peças** (decisão do dono,
  01/10/2026), não de 10. Pior caso: 5 peças do tamanho da maior já vista
  (3,9 MB) → resposta de ~20 MB → pico de **~90 MB** (com 10 seriam ~150 MB).
  O lote só dobra (5 → 10 → 20) depois de uma resposta abaixo de
  `LEITOR_LOTE_CRESCER_ABAIXO_MB` (3 MB), ou seja, quando o próximo lote,
  com o dobro de peças, ficaria na casa de 6 MB — metade do limite.
- **Um job do leitor por vez no processo inteiro**, não só por credencial: dois
  jobs em paralelo somariam os picos. A trava é do módulo (vale até para uma
  segunda instância do serviço), e há teste que falha se dois lotes correrem
  ao mesmo tempo.
- Se o contêiner tiver teto de memória baixo (256 MB), use também
  `LEITOR_LOTE_MAX_RESPOSTA_MB=8`.

**Não medido:** resposta real de dezenas de MB do tribunal, e o comportamento
do tribunal acima de 20 peças por chamada.

## 3. Disco

O PDF combinado tem praticamente o tamanho da soma das peças (160 MB de entrada
→ 160 MB de saída, medido). Os arquivos de trabalho (peças baixadas) são apagados
depois da montagem, então o pico de disco de um job é ~2× o PDF por alguns
segundos. O uso total e por workspace vai para o log a cada montagem e a cada
limpeza; acima de `LEITOR_AVISO_DISCO_MB` (10 GB), aviso.

PDFs pequenos gerados por biblioteca, com muitos objetos, saem do qpdf ~2× maiores
(linearização + tabelas de dica); com arquivos reais de digitalização a diferença
é desprezível (medido no conjunto de 160 MB).

## 4. Tempo

Estimativa mostrada ao advogado (`estimarSegundos`): chamadas = ⌈peças ÷ lote⌉ +
2 (listagem e `consultarAlteracao`), cada uma a 1,8 s (pior valor medido) + 3 s de
pausa. 278 peças → 30 chamadas → **~2,4 min**. Ordem de grandeza: a fila pode
ter outro job na frente e resposta pesada reduz o lote.

Montagem: ~14 s para 280 peças/160 MB, medida acima.

## 5. HTML (~30% das peças): estratégia A — **decidida pelo dono (01/10/2026)**

**A sonda de HTML** (`scripts/sonda-html.mjs`, rodada pelo dono no Console do
Easypanel: 3 peças reais de 1 processo do TJGO, 2 requisições, só estrutura)
mostrou: fragmento sem `<body>`, charset não declarado, só `p`, `span`,
`strong`, `br`, `hr` e `u`; **nenhuma tabela** (nem aninhada, nem
colspan/rowspan); 1 ou 2 imagens `data:` por peça; nenhum script, iframe, form,
link ou atributo `on*`; 11 a 24 KB, 650 a 1.850 caracteres de texto. Texto
simples, sem tabela → **estratégia A**, pela regra que o dono fixou antes da
sonda ("A só vale se forem texto + tabelas simples; tabela aninhada ou imagem
que carregue conteúdo → B").

**Como a conversão funciona** (`infrastructure/pdf/htmlDoTribunal.ts` +
`QpdfMontador.converterHtml`):

- **Tokenizador tolerante, sem DOM.** O HTML vira blocos de texto no servidor;
  nenhuma marcação passa adiante, e o navegador nunca recebe HTML do tribunal.
  Todo atributo é ignorado, inclusive `style`.
- `p`, `div` e `br` quebram linha; `hr` vira linha separadora; `strong`/`b`
  viram negrito e `u` sublinhado (o resto da formatação vira texto puro).
- **Entidades** numéricas (decimal e hex, com a faixa 128–159 lida como
  windows-1252, como fazem os navegadores) e nomeadas (as 96 de Latin-1, mais
  travessões, aspas curvas, reticências…). Desconhecida fica como veio.
- **Codificação:** UTF-8 estrito; com byte inválido, windows-1252 —
  implementado à mão, porque o `TextDecoder('windows-1252')` do Node lê 0x96
  como caractere de controle em vez do travessão.
- **Imagens não entram.** São contadas pela tag (o base64 não é decodificado),
  e a última linha da página diz "Este documento tinha N imagem(ns) que não
  foram incluídas; consulte a peça no tribunal".
- **Caractere sem equivalente na fonte padrão** vira "?" e é contado.
- **Tabela** (não apareceu na sonda): cada linha vira "célula | célula", sem
  inventar layout; tabela aninhada entra como texto da célula de fora.
- **Elemento inesperado** (script, iframe, object, form…) é descartado com o
  conteúdo.
- A primeira linha da página, em cinza, diz que é HTML convertido e que a
  formatação original não foi preservada.
- No índice: `situacao: 'html_convertida'`, com `motivo` dizendo o que ficou de
  fora (imagens, tabela, caracteres trocados, elementos descartados). Se a
  conversão falhar, `html_nao_incorporada` com página de aviso.

**Custo medido** (`node --expose-gc scripts/medir-conversao-html.mjs 84`; 84
HTMLs sintéticos com a forma da sonda, média de 19 KB, 1,5 MB no total):

| Medida | 84 HTMLs | 300 HTMLs |
|---|---|---|
| Tempo total | **~1,3 s** (~15 ms por HTML; o primeiro, ~85 ms, carrega as fontes) | ~4,5 s |
| PDF gerado | 933 KB | 3,3 MB |
| RSS acima do repouso | +69 a +78 MB | +73 a +77 MB |
| Heap retido depois de GC | **+2,9 MB** | +1,9 MB |

O RSS sobe porque o V8 deixa o heap crescer em vez de coletar a cada peça, e
não volta depois do GC; o heap retido (2–3 MB) mostra que nada se acumula. É um
platô: 300 HTMLs custam o mesmo que 84. Com o heap limitado a 64 MB
(`--max-old-space-size=64`), os mesmos 84 rodam com +43 MB, no mesmo tempo. A
conversão é sequencial e acontece na fase de montagem, depois dos lotes, então
esse custo não se soma ao pico de um lote.

## 6. Camada de texto (OCR)

`poppler-utils` entrou na imagem (decisão do dono). A medição de camada de texto
em 2 ou 3 processos reais (seção 6.1 da especificação) **não foi feita** — é
consulta ao tribunal, e fica para quando o dono autorizar.

## 7. Largura do painel (v0.31.1)

Medido no Chromium, contra o servidor local de teste, com o painel aberto num PDF pronto e um rótulo de
peça longo (como os do TJGO), nas larguras 1500, 1366, 1024, 920 e 600 px.

| | 0.31.0 | 0.31.1 |
|---|---|---|
| Borda direita do select "Ir para a peça" (janela de 1366 px) | 1479 px — 113 px fora da tela | 1120 px |
| Largura mínima do select | 728 px (a opção mais longa) | encolhe com o painel |
| Painel com largura salva de 1400 px numa janela de 1366 px | 1400 px (maior que a janela) | 1006 px (janela − 360) |
| `scrollWidth` da barra de ferramentas > largura visível | em todas as larguras | em nenhuma |

Nada aqui consultou o tribunal: é a página do console contra o servidor local
com dados sintéticos.
