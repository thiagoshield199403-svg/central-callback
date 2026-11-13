/* Conector da Central com o Google Apps Script. Não usa chave nem cadastro: o serviço só aceita o CSV agregado do fechamento. */
"use strict";
(function () {
  const URL_SERVICO = (window.CENTRAL_CONFIG_LOCAL || {}).url_apps_script || "" /* URL /exec do Web App: em js/config-local.js (não versionado) */, TEMPO = 90000;
  async function chamar(acao, dados) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), TEMPO);
    try {
      // text/plain evita a verificação prévia de CORS, que o Apps Script não atende.
      const r = await fetch(URL_SERVICO, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ v: 2, acao, corpo: JSON.stringify(dados) }), cache: "no-store", signal: ctl.signal });
      return await r.json();
    } finally { clearTimeout(t); }
  }
  class ConectorAppsScript {
    async enviarFechamento(d) {
      try { return await chamar("publicar", { nome: d.nome, data: d.data, versao: d.versao, conteudo: d.conteudo, sha256: d.sha256 }); }
      catch (e) { return { resultado: "pendente", detalhe: "Serviço de métricas sem resposta. O fechamento continua guardado para nova tentativa." }; }
    }
  }
  window.ConectorAppsScript = ConectorAppsScript;
})();
