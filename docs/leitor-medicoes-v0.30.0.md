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
  de nada, e só a resposta anterior informa. O primeiro lote (10 peças) é o
  risco: com 10 peças do tamanho da maior já vista (3,9 MB), a resposta teria
  ~39 MB e o pico seria ~150 MB. Medido no mesmo processo, só 1 em 279 peças
  tinha esse tamanho.
- Se o contêiner tiver teto de memória baixo (256 MB), use
  `LEITOR_LOTE_INICIAL=5` e `LEITOR_LOTE_MAX_RESPOSTA_MB=8`.

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

## 5. HTML (~30% das peças): proposta — **aguardando decisão do dono**

**O que não consegui fazer:** inspecionar HTMLs reais. Não há credencial nem
rede para o tribunal neste ambiente, e a orientação foi não rodar sonda sem
avisar. Deixei pronta a **`scripts/sonda-html.mjs`** (2 requisições: 1
listagem + 1 lote com até 3 HTMLs; imprime só a forma — histograma de tags,
tabelas, imagens por tipo de origem, o que a sanitização teria de remover,
quantidade de caracteres —, nunca texto, nome ou número).

**Proposta: estratégia A (renderizar o texto em páginas do PDF com pdf-lib)**,
condicionada ao resultado da sonda. Motivos:

1. **Índice e citação.** A Etapa 3 cita (peça, página). Certidão, alvará e ato
   ordinatório fora do PDF não teriam página — e são justamente atos com data
   e conteúdo que o advogado precisa citar.
2. **O que se sabe dos HTMLs favorece A:** ≈ 18 KB cada, gerados pelo sistema
   do tribunal (certidão, ato ordinatório) — conteúdo textual, provavelmente
   com uma ou duas tabelas de cabeçalho.
3. **Segurança mais simples:** em A o HTML nunca chega ao navegador. Ele é
   reduzido no servidor a blocos de texto puro (parágrafo, linha de tabela) e
   desenhado como texto; não há marcação para escapar. Em B, cada versão do
   painel teria de manter um sanitizador correto para sempre.
4. **Custo de memória e CPU desprezível** (18 KB por peça).

**Quando B seria melhor** (e a sonda responde isso): se os HTMLs tiverem
imagens essenciais (brasão é decorativo; uma imagem de assinatura ou de
documento não é), tabelas aninhadas complexas, ou formatação que mude o
sentido. Nesses casos, A degradaria o documento sem avisar.

**O que já está implementado e vale para as duas:** a peça HTML é baixada no
mesmo lote (sem custo extra), aparece no índice como `html_nao_incorporada`
com uma **página de aviso** no lugar ("documento do tribunal em HTML: ainda não
incorporado ao PDF — baixe-o individualmente pela linha do tempo"), e o HTML
**nunca** chega à interface nem ao PDF: há teste que procura o conteúdo do HTML
no PDF, no job e no índice. O arquivo de trabalho é apagado na montagem.

## 6. Camada de texto (OCR)

`poppler-utils` entrou na imagem (decisão do dono). A medição de camada de texto
em 2 ou 3 processos reais (seção 6.1 da especificação) **não foi feita** — é
consulta ao tribunal, e fica para quando o dono autorizar.
