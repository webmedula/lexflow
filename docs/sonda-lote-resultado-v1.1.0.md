# Sonda de lote — resultado — v1.1.0

Documento: `sonda-lote-resultado-v1.1.0` · 01/10/2026 · **substitui a v1.0.0**. Fecha o passo A1 do
leitor de peças. Scripts `scripts/sonda-lote.mjs` v1.0.0 (5 peças, individual e agrupado) e v1.1.0
(`--lote=N`, uma única chamada agrupada). Repositório v0.29.1, rodado no Console do Easypanel
com a credencial do workspace da conta. Mesmo processo TJGO (2015, 279 peças, com procuração do
advogado de teste, fora de segredo de justiça), mesma tarde.

## O que mudou da v1.0.0 para a v1.1.0

Acrescenta as rodadas `--lote=10` e `--lote=20` (teto do modo agrupado e memória). Não muda
nenhuma conclusão anterior; confirma e reforça.

## Rodadas

| Rodada | O que pediu | Entregues | Tempo | Resposta | Arquivos (soma) |
|---|---|---|---|---|---|
| 1. v1.0.0, individual | 5 peças, uma por requisição (3 PDFs, 2 HTMLs) | 5 de 5 | 0,5 a 1,2 s cada (4,0 s no total) | 5.567.577 B (soma) | média 935 KB; maior 3,9 MB |
| 1b. v1.0.0, agrupada | as mesmas 5 numa chamada | 5 de 5, idênticas | 1,4 s | 4.857.611 B | , |
| 2. v1.1.0, `--lote=10` | 10 peças em amostra espaçada | 10 de 10 | 1,2 s | 2.031.154 B | 1.846.549 B |
| 3. v1.1.0, `--lote=20` | 20 peças em amostra espaçada | **20 de 20** | 1,8 s | 2.743.507 B | 2.551.808 B |

Em todas: nenhum 403, nenhuma peça vazia ou sem teor, nenhum cabeçalho de limite de requisições.
Listagem do processo: 0,6 a 0,7 s para 279 peças e 281.743 B.

## Medições

| Medida | Valor |
|---|---|
| Teto de peças por chamada | **não encontrado até 20** (todas vieram) |
| Pedágio de movimentos por resposta | ≈ 178 a 190 KB, uma vez por chamada |
| Latência por chamada agrupada | 1,2 s (10 peças) e 1,8 s (20 peças) |
| Tamanho de arquivo | mediana 115 a 214 KB nos lotes; menor 2,3 KB; maior visto 3,9 MB (rodada 1) e 359 KB nos lotes |
| Formatos no processo (listagem) | PDF 195 (70%) · text/html 84 (30%) |
| Formatos nas amostras | lote 10: 9 PDF + 1 HTML · lote 20: 15 PDF + 5 HTML |
| HTML baixado | ≈ 18 KB cada |
| Memória (RSS do processo da sonda) | antes 63 MB; pico 106 MB com resposta de 2,0 MB (+43 MB); pico 111 MB com 2,7 MB (+48 MB) |
| PDFs "sem nenhuma fonte" (indício de digitalização) | rodada 1: 1 de 3 · lote 10: 5 de 9 · lote 20: 7 de 15 |
| Camada de texto real | **não medida**: `pdftotext` ausente e o Console não é root (`apk add` negado) |

Extrapolação medida (tempo do tribunal + pausa de 3 s): processo de 278 peças ≈ 28 chamadas de 10
(1,9 min) ou ≈ 14 chamadas de 20 (1,1 min). No modo individual da v1.0.0 eram 278 chamadas e
≈ 17,6 min.

## Leitura dos números

1. **O modo agrupado funciona e escala até 20 peças** sem erro, sem recusa e sem perda de
   conteúdo (idêntico ao individual na comparação direta).
2. **A memória cresce pouco com o tamanho da resposta**: de 2,0 para 2,7 MB de resposta, o
   acréscimo foi de 43 para 48 MB. A maior parte é custo fixo (módulos, listagem de 385
   movimentos, parser). **Não** se deve extrapolar linear a partir daqui: não foi medida uma
   resposta de dezenas de MB, e as amostras dos lotes **não pegaram as peças grandes** (a de
   3,9 MB da rodada 1 não estava nelas).
3. **Os tamanhos variam muito** (2,3 KB a 3,9 MB). O teto do lote deve ser por **bytes**, não
   só por quantidade de peças, e a listagem **não informa tamanho**: só a resposta anterior
   permite adaptar.
4. **A taxa de HTML (~25 a 30%) é estável**: 84 de 279 na listagem, 5 de 20 numa amostra.
5. **Indício forte e consistente de PDF sem texto**: 5 de 9 e 7 de 15 sem nenhuma fonte
   detectável (a contagem é por regex e só pode subestimar fontes). É indício, não medição.
6. **Velocidade**: 0,5 a 1,8 s por chamada, muito abaixo das "dezenas de segundos" que a spec
   supunha. É uma tarde, um processo.

## Limites desta medição

- Um processo, uma serventia, um horário. Recalibrar com outros.
- Lotes de 10 e 20 só com peças pequenas e médias. **Memória e tempo com respostas grandes (dezenas
  de MB) não medidos.** O comportamento do tribunal acima de 20 peças por chamada não medido.
- Camada de texto não medida.
- Conteúdo do HTML não inspecionado (a sonda não o grava, de propósito).

## Histórico de versões

- **v1.1.0 (01/10/2026):** acrescenta as rodadas `--lote=10` e `--lote=20`, memória, formatos
  nas amostras; substitui a v1.0.0.
- **v1.0.0 (01/10/2026):** 5 peças individuais e agrupadas (substituída).
