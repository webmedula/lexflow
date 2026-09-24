import { describe, expect, it } from 'vitest';
import {
  abrirEnvelope,
  extrairMovimentos,
  extrairPecas,
} from '../../src/infrastructure/adapters/mni/mni.mapper.js';

/**
 * A forma dos `<movimento>` na resposta do Projudi/TJGO, com os dados das
 * partes removidos.
 *
 * O que importa nela, e é o que esta suíte protege: o `<documento>` traz
 * `movimento="47660211"` e existe um `<movimento
 * identificadorMovimento="47660211">` na MESMA resposta. É a única junção
 * peça↔andamento afirmada por uma fonte — DataJud e DJEN numeram movimento de
 * outro jeito e não têm campo em comum com o MNI.
 *
 * As duas formas de nomear o ato aparecem de propósito: `movimentoLocal` com
 * `descricao` (o caso comum no Projudi) e `movimentoNacional` só com o código
 * (onde o nome tem de ser emprestado da TPU).
 */
const RESPOSTA = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
<soap:Body>
<ns5:consultarProcessoResposta xmlns:ns2="http://www.cnj.jus.br/tipos-servico-intercomunicacao-2.2.2" xmlns:ns3="http://www.cnj.jus.br/intercomunicacao-2.2.2" xmlns:ns5="http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/">
<ns2:sucesso>true</ns2:sucesso>
<ns2:processo>
<ns3:dadosBasicos numero="0311517-22.2015.8.09.0051" nivelSigilo="0"/>
<ns3:movimento dataHora="20260914093000" identificadorMovimento="47660211" nivelSigilo="0">
  <ns3:movimentoLocal codigoMovimento="123" codigoPaiNacional="581" descricao="Juntada de Petição de Contestação"/>
</ns3:movimento>
<ns3:movimento dataHora="20260303141500" identificadorMovimento="47110900" nivelSigilo="0">
  <ns3:movimentoNacional codigoNacional="219">
    <ns3:complemento>tipo_de_decisao: liminar</ns3:complemento>
  </ns3:movimentoNacional>
</ns3:movimento>
<ns3:movimento identificadorMovimento="9999" nivelSigilo="0">
  <ns3:movimentoLocal codigoMovimento="7" descricao="Movimento sem data"/>
</ns3:movimento>
<ns3:documento idDocumento="doc-1" tipoDocumento="57" mimetype="application/pdf" descricao="Contestação" movimento="47660211" dataHora="20260914093000"/>
<ns3:documento idDocumento="doc-2" tipoDocumento="0" mimetype="application/pdf" descricao="Outros" movimento="47660211" dataHora="20260914093000"/>
</ns2:processo>
</ns5:consultarProcessoResposta>
</soap:Body>
</soap:Envelope>`;

describe('MNI — os movimentos que o mapper jogava fora', () => {
  it('o número do documento aponta para um movimento da mesma resposta', () => {
    /*
     * O teste que justifica a régua temporal inteira. Se esta correspondência
     * não valesse, entregar o documento na linha do evento exigiria
     * correlacionar fontes que não têm campo em comum — e casar por data
     * penduraria a contestação embaixo do despacho errado.
     */
    const r = abrirEnvelope(RESPOSTA);
    const movimentos = extrairMovimentos(r.conteudo);
    const pecas = extrairPecas(r.conteudo, new Map());

    const identificadores = new Set(
      movimentos.map((m) => Number(m.idExterno?.split(':')[1])),
    );
    expect(pecas.every((p) => identificadores.has(p.movimento ?? -1))).toBe(true);
  });

  it('o rótulo sai do que o tribunal escreveu, quando ele escreve', () => {
    const movimentos = extrairMovimentos(abrirEnvelope(RESPOSTA).conteudo);
    expect(movimentos[0]?.titulo).toBe('Juntada de Petição de Contestação');
    // `codigoPaiNacional` é o código da TPU quando o tribunal usa nomenclatura
    // local — é por ele que a linha do tribunal encontra a mesma da fonte
    // pública, e sem ele a régua duplicaria o ato.
    expect(movimentos[0]?.codigoTpu).toBe(581);
  });

  it('sem descrição, o título nomeia o código — para ser trocado depois', () => {
    // O tribunal manda só `codigoNacional` em parte dos movimentos. Uma linha
    // sem título nenhum seria pior; `batizarPeloCodigo` troca este texto pelo
    // nome que o DataJud dá ao mesmo número da TPU.
    const movimentos = extrairMovimentos(abrirEnvelope(RESPOSTA).conteudo);
    const decisao = movimentos.find((m) => m.codigoTpu === 219);
    expect(decisao?.titulo).toBe('Movimento 219');
    expect(decisao?.complementos).toEqual(['tipo_de_decisao: liminar']);
  });

  it('movimento SEM data é descartado', () => {
    /*
     * Uma régua temporal teria de pôr esse ato em algum lugar, e qualquer lugar
     * escolhido seria mentira sobre quando ele aconteceu — no topo parece o mais
     * recente, no fim parece o mais antigo. As duas versões mentem sobre prazo.
     */
    const movimentos = extrairMovimentos(abrirEnvelope(RESPOSTA).conteudo);
    expect(movimentos).toHaveLength(2);
    expect(movimentos.some((m) => m.titulo === 'Movimento sem data')).toBe(false);
  });

  it('a data compacta do MNI é interpretada, não passada ao construtor do Date', () => {
    // `new Date('20260914093000')` devolve Invalid Date sem lançar, e o ato
    // apareceria sem data em vez de dar erro.
    const movimentos = extrairMovimentos(abrirEnvelope(RESPOSTA).conteudo);
    const m = movimentos[0];
    expect(m?.data.getFullYear()).toBe(2026);
    expect(m?.data.getMonth()).toBe(8);
    expect(m?.data.getDate()).toBe(14);
    expect(m?.data.getHours()).toBe(9);
  });

  it('a fonte fica carimbada como mni', () => {
    // Numa régua montada de três bases, "de onde veio esta linha" é informação
    // de prazo: o DJEN dá só o dia e o MNI dá hora cheia.
    const movimentos = extrairMovimentos(abrirEnvelope(RESPOSTA).conteudo);
    expect(movimentos.every((m) => m.fonte === 'mni')).toBe(true);
  });

  it('resposta sem processo não quebra', () => {
    const r = abrirEnvelope(`<?xml version="1.0"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>
<ns5:consultarProcessoResposta xmlns:ns2="http://www.cnj.jus.br/tipos-servico-intercomunicacao-2.2.2" xmlns:ns5="http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/">
<ns2:sucesso>false</ns2:sucesso><ns2:mensagem>Usuário ou Senha inválida.</ns2:mensagem>
</ns5:consultarProcessoResposta></soap:Body></soap:Envelope>`);
    expect(extrairMovimentos(r.conteudo)).toEqual([]);
  });
});
