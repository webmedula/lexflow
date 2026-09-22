# Briefing para a landing page — Processo Vivo v0.20.0

Documento de apoio para escrever a página de vendas. Tudo aqui é o que o sistema
**faz hoje**, verificado no código e medido contra tribunal de verdade. Onde há
limite, o limite está escrito — porque numa ferramenta ligada a prazo processual
a promessa mal calibrada não gera só reembolso: gera responsabilidade.

---

## 1. Em uma frase

> Os processos do advogado, verificados sozinhos todos os dias — com as **peças**
> das partes, e não só o que saiu no diário oficial.

---

## 2. O que o sistema faz hoje

| Funcionalidade | Estado | Escopo exato |
|---|---|---|
| Consulta por número CNJ | pronto | 27 TJs + 6 TRFs + 24 TRTs + TST |
| Busca por OAB | pronto | nacional, via DJEN |
| Vigilância contínua por OAB | pronto | varre de hora em hora; processo novo entra sozinho na carteira |
| Acompanhamento de processo | pronto | varredura a cada 12h; histórico de "o que mudou" |
| **Peças do processo** | pronto | **só TJGO (Projudi)**, e só onde o advogado tem procuração |
| Aviso por e-mail | pronto | avisa novidade **e** avisa quando não conseguiu verificar |
| Triagem do que exige ação | pronto | ordena por urgência; nunca esconde andamento |
| Filtro por cliente/parte | pronto | acha "os processos do Condomínio X" numa carteira de 130 |
| Contas com ambiente isolado | pronto | cada advogado vê só o que é dele |
| Backup diário verificado | pronto | 7 cópias, conferidas abrindo o arquivo |

**Tribunais na consulta por número (DataJud):** todos os 27 tribunais de justiça
estaduais (TJAC a TJTO, incluindo TJDFT), os 6 tribunais regionais federais
(TRF1 a TRF6) e os 24 tribunais regionais do trabalho (TRT1 a TRT24), mais o
TST. Justiça Estadual, Federal e do Trabalho.

---

## 3. Cobertura — a seção que evita cliente insatisfeito

Esta é a parte que precisa estar na página, em algum lugar honesto, e não
escondida no rodapé.

**Justiça Estadual, Federal e do Trabalho.** A cobertura trabalhista entrou na
v0.20.0, verificada contra um processo real do TRT18 — e foi a correção de um
erro deste briefing, que descrevia como limite do produto o que era uma lista de
configuração desatualizada.

Fora da consulta por número continuam a Justiça **Eleitoral**, a **Militar** e os
tribunais superiores (à exceção do TST). São segmentos pequenos para o público
alvo, mas diga na página quais atende, não quais não atende.

> Recomendação: "Justiça Estadual, Federal e do Trabalho" na página, com todas as
> letras. É melhor perder na landing o cadastro de quem você não atende do que
> ganhá-lo, receber, e devolver na primeira semana com uma reclamação pública
> junto.

**As peças são só do TJGO, por enquanto.** É o diferencial mais forte e o mais
estreito. Vender "peças" sem dizer "TJGO" é o erro mais caro possível aqui.

**Peça exige procuração nos autos.** Mesmo no TJGO, o tribunal só entrega o
arquivo de processos onde o advogado está habilitado. Isso não é limitação do
sistema — é o controle de acesso do processo eletrônico, e não se contorna.
Testado: nos processos em que o advogado consta como responsável, as peças baixam;
nos outros, vem o metadado e não vem o arquivo.

**A busca por OAB é nacional, mas traz o que foi publicado.** O DJEN indexa
advogado em todo o país, então a vigilância funciona amplamente. Mas o que ele
devolve é a publicação — pode achar processo de um tribunal cuja linha do tempo
completa o sistema ainda não consulta.

---

## 4. O diferencial defensável

Quase todo concorrente lê **diário oficial**. O diário publica despacho, decisão
e sentença — atos do juízo. **Petição, contestação, laudo pericial e documento
juntado pela parte nunca aparecem lá.**

Um sistema alimentado só por diário mostra "decisões e julgados" e mais nada.
Não é defeito dele: é o teto da fonte.

O Processo Vivo entra no sistema do tribunal com a credencial do próprio
advogado e traz as peças. Medido num processo real do TJGO: **278 documentos**,
onde a consulta pelo diário mostraria um punhado de publicações.

**Como isso vira frase de venda:**

> "Seu cliente pergunta o que a outra parte alegou. O diário oficial não
> responde isso. O Processo Vivo sim."

E o motivo de ser defensável: não é uma funcionalidade que o concorrente copia
numa sprint. Exige integração com o sistema de cada tribunal, credencial do
advogado guardada com segurança, e tratamento de um protocolo (MNI/SOAP com
MTOM) que falha de formas silenciosas.

---

## 5. Para quem é — e para quem não é

**É para:** advogado autônomo ou escritório pequeno, de Goiás, que atua na
Justiça Estadual, Federal ou do Trabalho e tem carteira grande o bastante para não conseguir
conferir tudo à mão. O caso de uso que apareceu no teste real: 130 processos numa
única OAB.

**Também serve para o trabalhista**, desde a v0.20.0 — com consulta,
acompanhamento, vigilância por OAB e aviso, tudo sem depender de credencial
nenhuma. O que ele não tem é peça, que hoje só existe no TJGO.

**Ainda não é para:** escritório que precisa de gestão financeira, controle de
honorários e timesheet (isso é Projuris, Astrea, ADVBOX); quem precisa das peças
fora do TJGO; advogado da Justiça Eleitoral ou Militar.

**Onde você ganha do concorrente:** peças, e preço. Onde você perde: cobertura
e maturidade. Não tente competir em "sistema de gestão completo" — você perde
essa comparação e ela nem é a sua briga.

---

## 6. Provas concretas (números reais, todos medidos)

Use com moderação, mas use: número específico convence mais que adjetivo.

- **278 documentos** recuperados de um processo real do TJGO.
- **130 processos** numa única consulta por OAB, com filtro por cliente.
- **Um processo com 361 andamentos** aparece com **8** em sistemas que leem só o
  diário — foi o que motivou a busca híbrida entre três fontes.
- **69%** das publicações de um processo de teste vieram do diário com o aviso
  "arquivos digitais indisponíveis" no lugar do inteiro teor.
- **Verificação de hora em hora** para publicações novas no nome do advogado.
- **492 testes automatizados**, backup diário conferido abrindo o arquivo.

---

## 7. Objeções prováveis, e a resposta honesta

**"Já uso o Jusbrasil / Escavador."**
São bases de consulta e publicação. Não entram no tribunal com a sua credencial,
então não trazem as peças. São complementares, não substitutos.

**"Meu sistema de gestão já avisa publicação."**
Avisa o que saiu no diário. Pergunte ao advogado a última vez que ele precisou
ler a contestação da outra parte e teve que abrir o Projudi à mão.

**"É seguro dar minha senha do Projudi?"**
A resposta honesta é boa aqui, e vale detalhar na página: a senha é guardada
cifrada (AES-256-GCM), com a chave fora do banco — um vazamento do banco não
entrega credencial nenhuma. O sistema faz **uma única tentativa** por consulta,
nunca repete, justamente para não arriscar bloqueio da conta do advogado no
tribunal. E a senha nunca aparece em log, nem em tela, nem na resposta da API.

**"E se o sistema falhar e eu perder um prazo?"**
Esta é a objeção mais importante, e a resposta não pode ser bravata. O sistema
avisa quando **não conseguiu verificar** — silêncio nunca significa "não houve
nada". Mas a conferência do prazo continua sendo do advogado, e a página precisa
dizer isso.

---

## 8. O que NÃO prometer

Leia esta seção antes de escrever qualquer headline.

**Não prometa "nunca mais perca um prazo".** É a frase mais tentadora do
mercado e a mais perigosa. Ela transfere para você uma responsabilidade que o
sistema não pode cumprir: fonte fora do ar, publicação que atrasa, tribunal não
coberto. Se um advogado perder um prazo confiando nessa frase, você terá
prometido por escrito algo que não entrega.

Alternativa que vende quase igual e é verdadeira:
> "Seus processos verificados todos os dias — e um aviso quando não
> conseguirmos verificar."

**Não prometa cálculo de prazo.** O sistema não calcula dias úteis, recesso nem
suspensão. Isso é deliberado: cálculo errado de prazo é dano direto.

**Não diga "todos os tribunais do Brasil".** São 27 TJs, 6 TRFs, 24 TRTs e o
TST — o que já é quase tudo o que um advogado comum encontra, e ainda assim não
é "todos".

**Não diga "todas as peças de qualquer processo".** É TJGO, e onde há procuração.

**Não use nome de cliente, print com número de processo real ou depoimento que
você não tenha.** Além do óbvio, há LGPD e segredo de justiça no meio.

**Não invente selo, prêmio ou "usado por X escritórios"** enquanto não for
verdade. Advocacia é comunidade pequena e que confere.

---

## 9. Estrutura sugerida da página

**1. Herói.**
Título na dor real, não na tecnologia.
Candidatos:
- "O diário oficial não mostra a contestação. Nós mostramos."
- "Acompanhe seus processos — inclusive as peças que as partes juntaram."
- "Seus processos verificados todos os dias, com as peças que o diário não publica."

Subtítulo com o escopo, já aqui: *Justiça Estadual, Federal e do Trabalho.
Peças no TJGO.*
CTA: "Criar conta grátis" — o cadastro é aberto e leva menos de um minuto.

**2. O problema, em três linhas.**
O diário publica o que o juízo decide. O que a outra parte alegou, o que o perito
concluiu, o documento que foi juntado — nada disso sai no diário. Para ver, é
abrir o sistema do tribunal, processo por processo.

**3. Como funciona, em três passos.**
Crie a conta com e-mail e senha → informe sua OAB e seus processos entram
sozinhos → cadastre seu acesso ao tribunal e as peças passam a vir junto.
Vale mostrar que é progressivo: a pessoa usa antes de entregar a senha do
Projudi. Isso derruba a objeção de confiança sem precisar argumentar.

**4. O diferencial, com o número.**
278 documentos de um processo real. Um print da tela de peças vale mais que
qualquer parágrafo — com o número do processo borrado.

**5. Segurança.**
Seção curta e específica. Senha do tribunal cifrada, chave fora do banco, uma
tentativa por consulta, nada em log. Advogado desconfia, e com razão.

**6. Cobertura, honesta.**
Tribunais atendidos, peças no TJGO. Transforme em vantagem: *"Preferimos dizer
onde funciona a prometer o Brasil inteiro."*

**7. Preço.**
Ver a seção 10 — ainda não existe cobrança no sistema.

**8. FAQ.**
Use as objeções da seção 7, com as respostas honestas.

**Rodapé:** CNPJ da WebMedula, contato@processovivo.com.br, política de
privacidade e termos. Para um SaaS que guarda credencial de terceiro, a
política de privacidade não é enfeite — é o que um advogado vai ler antes de
digitar a senha do Projudi dele.

---

## 10. O que falta antes de cobrar de alguém

Para a página não prometer o que a operação ainda não sustenta:

- **Cobrança e planos não existem no sistema.** Hoje dá para vender manualmente
  (Pix ou boleto por fora, você libera a conta), o que é razoável para os
  primeiros assinantes e insustentável a partir de uns dez. Se a página tiver
  tabela de preços, ela precisa de um caminho de pagamento que funcione.
- ~~E-mail em configuração.~~ **Resolvido em 19/09/2026.** A entrega sai por
  provedor transacional (Resend), com o domínio verificado e DKIM próprio — o
  remetente é `contato@processovivo.com.br` e a mensagem chega na caixa de
  entrada, não no spam. Recuperação de senha e aviso de movimentação estão no
  ar.
- **Backup fora do VPS ainda é manual.** Não vai para a página, mas se você
  escrever "seus dados seguros", precisa estar resolvido.
- **Termos de uso e política de privacidade** não existem ainda. Com credencial
  de terceiro e dado de processo, não é opcional — e vale uma conversa com um
  advogado de verdade, não um modelo genérico da internet.

---

## 11. Tom

O público é advogado: cético por formação, treinado para achar a cláusula ruim.
Exagero funciona contra você. A página que vende para esse público é a que
mostra que você conhece o problema em detalhe — "o diário não publica peça de
parte" é uma frase que faz o advogado parar de rolar a tela, porque ele sabe que
é verdade e nunca viu ninguém dizer.

Escreva como quem já sofreu o problema, não como quem quer vender software.
