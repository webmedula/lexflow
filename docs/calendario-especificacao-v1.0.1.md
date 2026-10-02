# Calendário — especificação — v1.0.1

Documento: `calendario-especificacao-v1.0.1` · 01/10/2026 · para o repositório `webmedula/processovivo`
(base: **v0.31.1**, já com o leitor na `main`; o calendário entra na próxima versão menor, **0.32.0**).

## 1. Objetivo

Dar ao advogado uma agenda dos eventos dos seus processos (audiência, perícia, prazo, reunião) em
**uma tela do sistema** e em um **feed ICS** que ele assina no Google Agenda, Outlook ou Apple
Calendário. A agenda mistura duas origens, sempre distinguíveis:

- **Detectado:** data lida de um andamento já recebido (ex.: "audiência designada para 12/11/2026
  às 14:30"). Nasce como **sugerido**.
- **Manual:** criado ou editado pelo advogado. Nasce **confirmado**.

O advogado **confirma** um sugerido para ele valer. O sistema nunca afirma um prazo: lê datas que
estão escritas no andamento e mostra de onde vieram.

## 2. Decisões do dono (fechadas em 01/10/2026)

| Tema | Decisão |
|---|---|
| Conteúdo | Ambos: datas lidas de andamentos **e** eventos criados/confirmados pelo advogado |
| Formato | Tela no sistema **+** feed ICS |
| Plano | Recurso do **Acompanhamento**, ou seja, todos os planos |
| Ordem | Depois do leitor (feito: v0.31.1 na `main`) |

## 3. Fora do escopo (não fazer)

Cálculo automático de prazo (vale o `CLAUDE.md`: só como calculadora de cálculo visível, nunca como
afirmação), alertas por e-mail/push/WhatsApp, sincronização de mão dupla, OAuth com Google ou
Microsoft, convites a terceiros, eventos recorrentes, anexos, escritório com vários membros, análise
por IA, chamada nova ao MNI ou a qualquer tribunal (a detecção usa só o que já foi gravado).

## 4. Modelo de domínio

Entidade `EventoDeCalendario` (nomes em português, em `src/domain/entities/`):

- `id` (UUID), `workspace`, `numeroProcesso` (CNJ, 20 dígitos), `tribunal`.
- `tipo`: `audiencia | pericia | prazo | reuniao | outro`.
- `titulo` (texto curto, até 140), `observacao` opcional (até 1000, **só do advogado**).
- Quando: `dataLocal` (`AAAA-MM-DD`), `horaLocal` opcional (`HH:MM`), `duracaoMin` opcional.
  Sem hora = **dia inteiro**. Fuso fixo `America/Sao_Paulo`. **Nunca** converter data sem hora por
  UTC (erro clássico que desloca o dia).
- `origem`: `detectado | manual`.
- `estado`: `sugerido | confirmado | descartado`.
- `procedencia` (só em `detectado`): `{ movimentacaoId, dataDoAndamento, trecho }`, com `trecho` de
  até 200 caracteres do andamento **sem nomes de partes** (ver seção 10).
- `sequencia` (inteiro, sobe a cada alteração; usado no ICS), `criadoEm`, `atualizadoEm`,
  `confirmadoEm?`.

Regras: descartado nunca reaparece como sugerido (a deduplicação cobre descartados); alterar um
detectado confirmado mantém a procedência; `dataLocal` precisa ser data válida do calendário.

## 5. Detecção (função pura em `domain/`)

`detectarEventosNoAndamento(andamento): EventoSugerido[]`, **sem rede, sem relógio, sem I/O**.

- Reconhece **somente data explícita** no texto: `dd/mm/aaaa` (e `dd/mm/aa`), com hora `HH:MM` ou
  `HHhMM`, junto de palavra-gatilho: `audiência` (e variações: conciliação, instrução, julgamento,
  una), `perícia`/`pericial`, `sessão de julgamento`, `designad*`/`redesignad*`.
- Mapeia `tipo`: audiência/perícia conforme o gatilho; `prazo` só quando houver **data final
  escrita** ("até 20/10/2026"). **"Prazo de 15 dias" sem data não gera evento** (calcular seria
  afirmar prazo). Nesse caso a triagem existente continua sinalizando o andamento como hoje.
- "Cancelada", "retirada de pauta", "redesignada" no mesmo andamento: não cria sugestão nova; se
  houver evento detectado antes **para o mesmo processo e tipo**, marca-o para revisão (campo
  `revisar: true`, mostrado como "o andamento mais recente sugere mudança; confira").
- Várias datas no mesmo texto: gerar só as que estiverem coladas a um gatilho; na dúvida, **não
  gerar** (falso negativo é aceitável, falso positivo confiante não).
- **Idempotência:** chave de deduplicação
  `(workspace, numeroProcesso, movimentacaoId, tipo, dataLocal, horaLocal)`. Reprocessar o mesmo
  andamento não duplica.
- Data anterior a hoje (relógio injetado) **não gera evento**, inclusive no preenchimento retroativo
  da seção 6.

Testes de tabela com **textos sintéticos** (repositório público: nada de texto, nome ou número reais
de processos).

## 6. Quando a detecção roda

1. **Em ingestão:** quando o sync/vigilância gravar andamentos novos (ponto único, depois de gravar,
   dentro da mesma unidade de trabalho; falha da detecção **não** pode derrubar o sync: registra em
   log e segue).
2. **Preenchimento retroativo** (6.2) ao ativar o calendário numa conta: andamentos dos últimos 180 dias já
   gravados, rodado em lote pelo `Agendador`, sem rede.

Nenhuma chamada nova a tribunal.

## 7. Persistência

Tabelas novas na migração do `banco.ts` (mesmo estilo de `ALTER`/`CREATE IF NOT EXISTS` existente):

- `eventos_calendario` com as colunas da seção 4, índice `(workspace, dataLocal)` e índice único de
  deduplicação da seção 5.
- `calendario_feeds`: `workspace`, `tokenHash` (SHA-256), `incluiSugeridos` (0/1), `criadoEm`,
  `revogadoEm?`. **O token em claro nunca é gravado**; aparece uma única vez na criação.

Porta `RepositorioDeEventos` em `application/ports`, adaptador SQLite em `infrastructure/`. **Toda**
consulta filtra por `workspace` (isolamento inegociável; teste explícito de que o workspace B não lê
nem altera evento do A, nem pelo feed).

## 8. Plano e recurso

Acrescentar `'calendario'` a `RecursoDoPlano`/`RECURSOS` (`src/domain/entities/Plano.ts`) e incluir
no plano base (Acompanhamento) e, por herança já existente, nos demais. Teste que fixa a lista de
recursos deve ser atualizado na mesma PR. Plano vencido/sem o recurso: as rotas da tela respondem
403 padrão do sistema; o **feed** responde 404 (não revela que o token existiu).

## 9. Rotas (Zod nas bordas; sem `try/catch`; erros só de `domain/errors`)

Sessão autenticada (gate do recurso):

- `GET /calendario/eventos?de=AAAA-MM-DD&ate=AAAA-MM-DD&estado=...` (intervalo máximo 400 dias).
- `POST /calendario/eventos` (manual → `confirmado`).
- `PATCH /calendario/eventos/:id` (editar; `confirmar` = mudar estado para `confirmado`).
- `POST /calendario/eventos/:id/descartar`.
- `POST /calendario/feed` (cria ou **regenera** o token; devolve a URL completa uma única vez).
- `GET /calendario/feed` (diz se existe feed, desde quando, `incluiSugeridos`; **nunca** a URL).
- `DELETE /calendario/feed` (revoga).

Pública, só pelo token:

- `GET /calendario/feed/:token.ics` → `text/calendar; charset=utf-8`, `Cache-Control: private,
  max-age=300`, **comparação do hash em tempo constante**, limitador de taxa por IP, sem cookie, sem
  cabeçalho de identificação do workspace. Token inválido, revogado ou plano sem o recurso: **404**
  igual em todos os casos.

Atualizar o teste que fixa as chaves/rotas da API, se houver.

## 10. Feed ICS (RFC 5545)

- `PRODID:-//Processo Vivo//Calendario//PT-BR`, `VERSION:2.0`, `CALSCALE:GREGORIAN`,
  `X-WR-CALNAME:Processo Vivo`, `REFRESH-INTERVAL;VALUE=DURATION:PT1H` (e `X-PUBLISHED-TTL`).
- Linhas com **CRLF**, **dobra em 75 octetos** (contando UTF-8, não caracteres), escape de `\`, `;`,
  `,` e quebra de linha.
- `UID:<id>@processovivo.com.br` **estável**; `SEQUENCE` = `sequencia`; `DTSTAMP` = `atualizadoEm`
  em UTC.
- Dia inteiro: `DTSTART;VALUE=DATE:AAAAMMDD` (`DTEND` = dia seguinte). Com hora:
  `DTSTART;TZID=America/Sao_Paulo:AAAAMMDDTHHMMSS` com `VTIMEZONE` fixo `-0300` (o Brasil não tem
  horário de verão desde 2019; documentar isso no código).
- Janela: de 30 dias atrás a 365 dias à frente.
- Quem entra: `confirmado` sempre; `sugerido` só se `incluiSugeridos` (padrão **desligado**, com
  `SUMMARY` prefixado "[sugerido]"); `descartado` entra como `STATUS:CANCELLED` por 30 dias, para o
  app do advogado apagar de vez, depois sai.
- **Privacidade (o feed sai do nosso controle):** `SUMMARY` = `<Tipo> — <número CNJ>`; **sem nomes de
  partes, sem trecho do andamento, sem observação**. `DESCRIPTION` = link para o processo no sistema
  + "Origem: lido do andamento de dd/mm/aaaa" ou "Criado por você". Processo com
  `segredoJustica === true`: `SUMMARY` = "<Tipo> (processo sigiloso)", **sem número**, sem link com
  número.
- Procedência e honestidade: o texto da descrição diz que a data foi lida do andamento e deve ser
  conferida no processo. Nunca "prazo fatal" nem equivalente.

## 11. Tela (arquivo próprio, **não** inflar `script.ts` de ~2.500 linhas)

`src/main/http/ui/calendario.ts` (módulo próprio, servido como os demais, sem build, sem CDN).

- Entrada no menu: "Calendário".
- Visões: **Agenda** (lista por dia, padrão, melhor no celular) e **Mês** (grade). Navegação
  anterior/próximo/hoje.
- Sugeridos em estilo distinto (rótulo "Sugerido", **não só por cor**), com a procedência ("lido do
  andamento de 03/10/2026") e link para o andamento na linha do tempo. Ações: **Confirmar**,
  **Editar**, **Descartar**. Evento com `revisar: true` mostra o aviso.
- Criar evento manual: formulário com tipo, título, processo (busca entre os processos do
  workspace), data, hora opcional, observação.
- Painel "Assinar no meu calendário": cria/regenera/revoga o feed, copia a URL (mostrada uma única
  vez), opção "incluir sugeridos", e texto claro: "quem tiver esta URL vê estes eventos; regenere se
  vazar". Instruções curtas para Google Agenda, Outlook e Apple.
- Acessibilidade: foco visível, navegação por teclado, rótulos reais, contraste. Datas exibidas em
  `dd/mm/aaaa`, semana começando no domingo, nomes em português.
- Estados vazios e erros honestos; nunca "carregando" sem fim.
- Sem o recurso no plano: mensagem padrão de recurso indisponível; o resto do sistema não muda.

## 12. Testes (sem rede, sem tempo real: relógio injetado)

1. **Detecção** (tabela): formatos de data/hora, gatilhos, "prazo de N dias" sem data **não** gera,
   data passada não gera, cancelamento/redesignação marca revisão, múltiplas datas, texto sem
   gatilho, idempotência.
2. **Domínio:** estados e transições válidas/inválidas, descartado não reaparece.
3. **Repositório:** isolamento por workspace (A × B) em leitura, escrita e feed; deduplicação.
4. **ICS:** CRLF, dobra de 75 octetos com acentos, escapes, `UID` estável, `SEQUENCE` sobe, dia
   inteiro (sem deslocar o dia), `TZID` com `VTIMEZONE`, `CANCELLED`, janela, **sem nome de parte e
   sem trecho**, sigilo sem número. Validar a saída com parser ICS **como dependência de
   desenvolvimento** ou, se preferir não adicionar, com verificador próprio e casos conhecidos.
5. **Feed:** token válido/inválido/revogado/regenerado (o antigo morre), plano sem recurso → 404
   idêntico, comparação em tempo constante, limitador de taxa, token em claro nunca no banco.
6. **Rotas:** Zod, intervalo máximo, 403 sem recurso, isolamento.
7. **Ingestão:** falha na detecção não derruba o sync; retroativo idempotente.
8. **Teste que falha** se o módulo do calendário importar adaptador de rede/MNI/DataJud.

## 13. Decisões em aberto (recomendação entre parênteses)

1. `incluiSugeridos` no feed: desligado por padrão (**sim**).
2. Descartado entra como `CANCELLED` por 30 dias no feed (**sim**).
3. Backfill de 180 dias ao ativar (**sim**; 365 se preferir).
4. Alertas por e-mail de audiência próxima: **versão futura** (Resend já existe).
5. Eventos de prazo: só com data explícita; ligação com a calculadora de prazo fica para depois.
6. Janela do feed: -30/+365 dias (**ok**).

## 14. Histórico de versões

- **v1.0.1 (01/10/2026):** base passa a v0.31.1 e versão-alvo 0.32.0 (leitor já mergeado); sem mudança de regra.
- **v1.0.0 (01/10/2026):** primeira versão (substituída).
