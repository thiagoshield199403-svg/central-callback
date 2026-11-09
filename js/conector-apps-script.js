/* Conector da Central e do BI com o Google Apps Script. A chave de acesso (gravação na Central, leitura no BI) é digitada uma vez em cada navegador e fica guardada como CryptoKey
   NÃO EXTRAÍVEL no IndexedDB: serve para assinar os pedidos e nem o próprio JavaScript consegue lê-la de volta. Nenhuma chave vem no código da página. */
"use strict";
(function () {
  const URL_SERVICO = "https://script.google.com/macros/s/AKfycbycCpCYSUyILljxLyOit-OOXgvZIkBHvinGDBHKGlAZsTW9S3WN4PXRVz9qHIZyxWXm/exec", AMBIENTE = "producao", PAPEL = /bi\.html$/.test(location.pathname) ? "leitura" : "gravacao", BD = "central-callback-metricas", LOJA = "credencial", TEMPO = 90000;
  const enc = new TextEncoder(), hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

  function abrir() {
    return new Promise((ok, falha) => {
      const r = indexedDB.open(BD, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(LOJA);
      r.onsuccess = () => ok(r.result); r.onerror = () => falha(r.error);
    });
  }
  async function loja(modo, f) {
    const b = await abrir();
    try { return await new Promise((ok, falha) => { const t = b.transaction(LOJA, modo), r = f(t.objectStore(LOJA)); t.oncomplete = () => ok(r.result); t.onerror = t.onabort = () => falha(t.error); }); }
    finally { b.close(); }
  }
  const ler = () => loja("readonly", (s) => s.get(PAPEL));
  const guardar = (v) => loja("readwrite", (s) => s.put(v, PAPEL));
  const apagar = () => loja("readwrite", (s) => s.delete(PAPEL));

  async function definir(id, segredo) {
    if (!/^[A-Z0-9_-]{1,40}$/.test(id)) throw new Error("Identificação da credencial inválida.");
    if (segredo.length < 16) throw new Error("Chave da credencial inválida.");
    const chave = await crypto.subtle.importKey("raw", enc.encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    await guardar({ id, chave });
  }
  async function chamar(acao, dados) {
    const c = await ler();
    if (!c) return { resultado: "pendente", codigo: "sem_credencial", detalhe: "Informe a credencial de acesso neste navegador." };
    const corpo = JSON.stringify(dados), ts = Date.now(), nonce = hex(crypto.getRandomValues(new Uint8Array(16))), resumo = hex(await crypto.subtle.digest("SHA-256", enc.encode(corpo)));
    const sig = hex(await crypto.subtle.sign("HMAC", c.chave, enc.encode([1, c.id, ts, nonce, acao, resumo].join("\n"))));
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), TEMPO);
    try {
      // text/plain evita a verificação prévia de CORS, que o Apps Script não atende.
      const r = await fetch(URL_SERVICO, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ v: 1, id: c.id, ts, nonce, acao, corpo, sig }), cache: "no-store", signal: ctl.signal });
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

  /* ---------------- barra de teste e formulário da credencial */
  const $ = (s) => document.querySelector(s);
  async function mostrarCredencial() {
    let c = null;
    try { c = await ler(); } catch (e) { /* armazenamento bloqueado: segue sem credencial */ }
    $("#as-cred").textContent = c ? `Credencial: ${c.id}` : "Sem credencial neste navegador";
    $("#as-remover").hidden = !c;
  }
  async function salvar(ev) {
    ev.preventDefault();
    const id = $("#as-id").value.trim().toUpperCase(), segredo = $("#as-chave").value.trim(), msg = $("#as-msg");
    $("#as-chave").value = "";
    msg.textContent = "Conferindo a credencial…";
    try {
      await definir(id, segredo);
      let r;
      try { r = await chamar("verificar", {}); }
      catch (e) { msg.textContent = "Credencial guardada, mas o serviço não respondeu para conferir."; await mostrarCredencial(); return; }
      if (r.resultado === "falha") { await apagar(); msg.textContent = "Credencial recusada: " + r.detalhe; await mostrarCredencial(); return; }
      if (r.resultado === "ok" && r.escopo !== PAPEL) { await apagar(); msg.textContent = "Esta credencial não serve para esta tela."; await mostrarCredencial(); return; }
      if (r.resultado === "ok") { msg.textContent = "Credencial válida."; window.dispatchEvent(new Event("as-credencial")); }
      else msg.textContent = "Credencial guardada. " + (r.detalhe || "");
      await mostrarCredencial();
    } catch (e) { msg.textContent = e.message; }
  }
  function montar() {
    const barra = document.createElement("div");
    barra.className = "as-barra" + (AMBIENTE === "teste" ? "" : " producao"); barra.id = "as-barra";
    barra.innerHTML = (AMBIENTE === "teste" ? '<b>VERSÃO DE TESTE</b><span>Métricas pelo Google Apps Script, na pasta de teste</span>' : "<span>Métricas no Google Drive do COI</span>") + '<span id="as-cred"></span><button type="button" id="as-abrir">Credencial de acesso</button>';
    document.body.prepend(barra);
    const d = document.createElement("dialog");
    d.className = "as-caixa"; d.id = "as-dialogo";
    d.innerHTML = '<form id="as-form" autocomplete="off"><h2>Credencial de acesso</h2><p>A chave fica protegida neste navegador e não pode ser lida de volta.</p><label>Identificação <input id="as-id" required maxlength="40" autocomplete="off"></label><label>Chave <input id="as-chave" type="password" required autocomplete="new-password"></label><p id="as-msg" role="status"></p><div class="as-botoes"><button type="submit" id="as-salvar">Salvar e conferir</button><button type="button" id="as-remover" hidden>Remover deste navegador</button><button type="button" id="as-fechar">Fechar</button></div></form>';
    document.body.append(d);
    $("#as-abrir").onclick = () => { $("#as-msg").textContent = ""; d.showModal(); };
    $("#as-fechar").onclick = () => d.close();
    $("#as-form").onsubmit = salvar;
    $("#as-remover").onclick = async () => { await apagar(); $("#as-msg").textContent = "Credencial removida deste navegador."; await mostrarCredencial(); };
    mostrarCredencial();
  }
  if (document.body) montar(); else document.addEventListener("DOMContentLoaded", montar);
})();
