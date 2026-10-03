# Pasta digital — medições do backend — v0.33.0

Documento: `pasta-digital-medicoes-v0.33.0` · 03/10/2026.

**O que isto mede e o que NÃO mede.** O ambiente de desenvolvimento não tem
credencial nem rota para o MNI do TJGO, e o `CLAUDE.md` proíbe teste que toque a
rede. Então: o que está aqui é **CPU, memória e disco do NOSSO lado**, com um
tribunal falso (`ProvedorDeLoteFalso`) devolvendo bytes sintéticos. O **tempo de
rede** não foi medido nesta rodada: é PROJETADO pela contagem de chamadas, com os
números da sonda de 01/10/2026 (`docs/sonda-lote-resultado-v1.1.0.md`: 1,8 s no
pior lote) mais a pausa de 3 s. Não confunda as duas colunas.

## Método

Script descartável (não está no repositório), `tsx`, usando os serviços reais —
`ServicoPasta`, `ServicoLeitor`, `GuardaDePecas`, `ArmazemEmDisco`, `QpdfMontador`
(qpdf 11.9 de verdade), SQLite em memória — e relógio falso (a pausa de 3 s não
é dormida). Massa sintética no formato do processo medido: **278 peças**, 70% PDF
(2 KB a 3,9 MB; um em cada cinco com ~3,9 MB, o que é pior que o processo real),
20% HTML (convertido em texto), 10% imagem. Entrada total **212 MB** — acima dos
~160 MB do processo real, de propósito. Memória: RSS do processo `node` somado ao
dos filhos (`qpdf`), amostrado a cada 25 ms. A base (373 MB) inclui os 212 MB de
bytes do tribunal falso mantidos pelo próprio script; **o que vale é o
acréscimo sobre a base**.

## Resultados

| Cenário                                     | CPU/disco (nosso lado)                   | Memória                                              | Disco                                              |
| ------------------------------------------- | ---------------------------------------- | ---------------------------------------------------- | -------------------------------------------------- |
| Clique numa peça (30 cliques, uma a uma)    | mediana **32 ms**, p90 75 ms, máx 126 ms | +27 MB sobre a base                                  | 23 MB para as 30                                   |
| `GET …/pasta` com 278 peças (30 em guarda)  | mediana **20 ms**                        | —                                                    | —                                                  |
| Montar pasta completa (248 peças a buscar)  | **40 s**, 50 lotes                       | **+64 MB** sobre a base (pico da árvore, com o qpdf) | **425 MB** (peças em guarda + combinado de 213 MB) |
| "Baixar PDF" de 30 marcadas, tudo em guarda | 3,8 s                                    | —                                                    | +22 MB (PDF das marcadas)                          |
| …mesmo, chamadas ao tribunal                | **0** (nem a listagem)                   |                                                      |                                                    |

Tempo de rede projetado para a montagem acima: 50 lotes × (1,8 + 3) s ≈ **250 s**
(os lotes encolhem por causa dos arquivos de 3,9 MB; com o processo real, a
estimativa do servidor é a faixa de 77–250 s para 248 peças). Um clique avulso é
UMA chamada (lote de 1): ~1,8 s de tribunal no pior caso medido, mais o debounce
(0,4 s) e, se houver outra chamada recente, o que faltar para a pausa de 3 s.

## O que isto diz

1. **O gargalo do clique é o tribunal, não o nosso servidor.** Guardar uma peça
   (gravar, converter se preciso, `qpdf --check`) leva dezenas de milissegundos.
2. **A memória da montagem não mudou de ordem de grandeza** em relação ao leitor
   v0.30 (`docs/leitor-medicoes-v0.30.0.md`): as peças agora vão para a guarda
   conforme chegam, mas o lote continua sendo o que segura a resposta inteira.
3. **O disco dobra numa pasta completa** (425 MB para 213 MB de combinado):
   a peça avulsa continua em guarda depois que o combinado é montado. É o que
   permite abrir cada peça sozinha e remontar sem rebaixar, e custa disco. O teto
   por PDF é 300 MB, então uma pasta completa ocupa no máximo ~600 MB dos 1 GB da
   conta: cabe UM processo grande por vez, e a regra de substituição tira os mais
   antigos de outros processos quando o seguinte chega. Alternativa, se o disco
   apertar: apagar as peças que o combinado incorporou assim que ele fica pronto
   (o disco volta a 1×, mas a peça avulsa deixa de abrir sozinha e passa a ser
   uma faixa de páginas do combinado). Decisão do dono; não foi tomada aqui.
