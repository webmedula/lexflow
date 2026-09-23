import { describe, expect, it } from 'vitest';
import {
  abrirEnvelope,
  extrairPecas,
  tribunalEntregouOConteudo,
} from '../../src/infrastructure/adapters/mni/mni.mapper.js';

/**
 * A forma REAL da resposta de quem não é representante nos autos.
 *
 * Capturada do TJGO em 23/09/2026, com os dados das partes trocados por nomes
 * inventados — o processo era de cliente e o repositório não guarda dado
 * pessoal de terceiro.
 *
 * O que importa nela e foi preservado byte a byte: `sucesso` verdadeiro,
 * `nivelSigilo="0"`, `dadosBasicos` completo com partes e advogado, e NENHUM
 * `<movimento>`. Foram 3 KB contra 273 KB do mesmo processo para quem tem
 * procuração.
 */
const SEM_HABILITACAO = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
<soap:Body>
<ns5:consultarProcessoResposta xmlns:ns2="http://www.cnj.jus.br/tipos-servico-intercomunicacao-2.2.2" xmlns:ns3="http://www.cnj.jus.br/intercomunicacao-2.2.2" xmlns:ns5="http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/">
<ns2:sucesso>true</ns2:sucesso>
<ns2:processo>
<ns3:dadosBasicos numero="5818922-04.2026.8.09.0011" competencia="1" classeProcessual="12135" nivelSigilo="0" intervencaoMP="false" tamanhoProcesso="0">
<ns3:polo polo="AT">
<ns3:parte>
<ns3:pessoa nome="Fulana de Tal" tipoPessoa="fisica" numeroDocumentoPrincipal="00000000191"/>
<ns3:advogado nome="ADVOGADA INVENTADA" inscricao="00000-A-" numeroDocumentoPrincipal="00000000272" intimacao="true" tipoRepresentante="A"/>
</ns3:parte>
</ns3:polo>
<ns3:valorCausa>1000.0</ns3:valorCausa>
</ns3:dadosBasicos>
</ns2:processo>
</ns5:consultarProcessoResposta>
</soap:Body>
</soap:Envelope>`;

/** A mesma resposta, mas com a linha do tempo — o caso de quem tem acesso. */
const COM_ACESSO = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
<soap:Body>
<ns5:consultarProcessoResposta xmlns:ns2="http://www.cnj.jus.br/tipos-servico-intercomunicacao-2.2.2" xmlns:ns3="http://www.cnj.jus.br/intercomunicacao-2.2.2" xmlns:ns5="http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/">
<ns2:sucesso>true</ns2:sucesso>
<ns2:processo>
<ns3:dadosBasicos numero="0311517-22.2015.8.09.0051" nivelSigilo="0"/>
<ns3:movimento dataHora="20260901120000" identificadorMovimento="1"/>
<ns3:movimento dataHora="20260902120000" identificadorMovimento="2"/>
<ns3:documento idDocumento="doc-1" tipoDocumento="57" mimetype="application/pdf" descricao="Petição Inicial"/>
</ns2:processo>
</ns5:consultarProcessoResposta>
</soap:Body>
</soap:Envelope>`;

/** Processo recém-distribuído: tem movimento, ainda não tem documento. */
const SEM_DOCUMENTOS_AINDA = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
<soap:Body>
<ns5:consultarProcessoResposta xmlns:ns2="http://www.cnj.jus.br/tipos-servico-intercomunicacao-2.2.2" xmlns:ns3="http://www.cnj.jus.br/intercomunicacao-2.2.2" xmlns:ns5="http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/">
<ns2:sucesso>true</ns2:sucesso>
<ns2:processo>
<ns3:dadosBasicos numero="0311517-22.2015.8.09.0051" nivelSigilo="0"/>
<ns3:movimento dataHora="20260901120000" identificadorMovimento="1"/>
</ns2:processo>
</ns5:consultarProcessoResposta>
</soap:Body>
</soap:Envelope>`;

describe('MNI — acesso negado disfarçado de sucesso', () => {
  it('cabeçalho SEM movimento nenhum significa conteúdo negado', () => {
    /*
     * A medição que originou este teste: mesma consulta, mesmo processo, duas
     * credenciais. Sem procuração → 3 KB, zero movimentos, `sucesso: true`.
     * Com procuração → 273 KB, 381 movimentos, 278 documentos.
     *
     * Nenhum processo real tem zero movimentos, então zero não é "não há": é
     * omissão. E ela chega sem código de erro nenhum.
     */
    const r = abrirEnvelope(SEM_HABILITACAO);
    expect(tribunalEntregouOConteudo(r.conteudo)).toBe(false);
  });

  it('com linha do tempo, o conteúdo veio', () => {
    const r = abrirEnvelope(COM_ACESSO);
    expect(tribunalEntregouOConteudo(r.conteudo)).toBe(true);
    expect(extrairPecas(r.conteudo, new Map())).toHaveLength(1);
  });

  it('processo com movimento e sem documento NÃO é falta de habilitação', () => {
    /*
     * O falso positivo que a regra tem de evitar. Se a checagem contasse
     * DOCUMENTOS em vez de movimentos, um processo recém-distribuído — que
     * legitimamente ainda não tem peça juntada — seria acusado de negativa de
     * acesso, e o advogado sairia conferindo uma credencial que está correta.
     */
    const r = abrirEnvelope(SEM_DOCUMENTOS_AINDA);
    expect(tribunalEntregouOConteudo(r.conteudo)).toBe(true);
    expect(extrairPecas(r.conteudo, new Map())).toHaveLength(0);
  });

  it('documento sem linha do tempo TAMBÉM é conteúdo entregue', () => {
    /*
     * A outra metade do OU. Se o arquivo chegou, discutir acesso é absurdo —
     * e foi esta metade que faltou na primeira versão da regra: ela reprovava
     * respostas legítimas onde o documento vinha sem os movimentos.
     */
    const xml = COM_ACESSO.replace(/<ns3:movimento[^>]*\/>/g, '');
    const r = abrirEnvelope(xml);
    expect(tribunalEntregouOConteudo(r.conteudo)).toBe(true);
  });

  it('o cabeçalho continua legível mesmo sem acesso ao conteúdo', () => {
    // Importa para a tela: dá para mostrar partes e vara, e explicar que o que
    // falta é o conteúdo. Uma tela em branco diria que não há nada.
    const r = abrirEnvelope(SEM_HABILITACAO);
    expect(JSON.stringify(r.conteudo)).toContain('Fulana de Tal');
  });
});
