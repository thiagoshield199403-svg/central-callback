/* Conector da Central e do BI com o Google Apps Script. Não usa chave nem cadastro: o serviço só aceita o CSV agregado do fechamento e a leitura do BI. */
"use strict";
(function () {
  const URL_SERVICO = "https://script.google.com/macros/s/AKfycbycCpCYSUyILljxLyOit-OOXgvZIkBHvinGDBHKGlAZsTW9S3WN4PXRVz9qHIZyxWXm/exec", TEMPO = 90000;
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
      try { const r = await chamar("publicar", { nome: d.nome, data: d.data, versao: d.versao, conteudo: d.conteudo, sha256: d.sha256 }); if (r.resultado === "enviado") r.bi = "atualizado"; return r; }
      catch (e) { return { resultado: "pendente", detalhe: "Serviço de métricas sem resposta. O fechamento continua guardado para nova tentativa." }; }
    }
    static async dadosBI() {
      const r = await chamar("bi", {});
      if (r.resultado !== "ok") throw new Error(r.detalhe || "BI indisponível.");
      return { linhas: r.linhas, sincronizacao: r.sincronizacao };
    }
  }
  window.ConectorAppsScript = ConectorAppsScript;
})();
