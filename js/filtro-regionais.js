/* Central de Callback COI — FILTRO DE REGIONAIS E MUNICÍPIOS (seleção múltipla). Um componente, várias instâncias
   independentes: o Envio individual (js/app.js) e o Envio em lote (js/central-disparos.js) criam cada um a sua, com estado
   próprio — marcar algo em uma nunca muda a outra. As regras de reconhecimento ficam em js/localidades.js.
   - Seleção vazia = todos os registros. Regional inteira em um clique; desmarcar um município depois tira só ele.
   - Lista por regional, recolhível; pesquisa por nome ou código; contagens informadas pela tela (já com os outros filtros).
   - Só filtra a exibição: não lê o CSV, não grava e não altera registros. Todo texto passa por esc(). */
"use strict";
(function (raiz) {
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function criar({ id, rotulo = "Regionais e municípios", inicial = [], aoMudar = () => {} } = {}) {
    const L = raiz.Localidades;
    const valida = (k) => !!(L.municipioPorChave(k) || L.ESPECIAIS[k]);
    const sel = new Set((Array.isArray(inicial) ? inicial : []).filter(valida));
    const abertos = new Set();
    let el = null, contagens = new Map(), aberto = false;

    const chavesEspeciais = Object.keys(L.ESPECIAIS);
    const item = (chave, cod, nome, busca) => `<li data-fr-busca="${esc(busca)}" data-fr-cod="${esc(cod)}"><label class="fr-item"><input type="checkbox" data-fr-chave="${esc(chave)}">`
      + `<span class="fr-cod">${esc(cod)}</span><span class="fr-nome">${esc(nome)}</span><span class="fr-n" data-fr-n="${esc(chave)}">0</span></label></li>`;
    const grupo = (gid, nome, itens, dica) => `<section class="fr-grupo" data-fr-grupo="${esc(gid)}">
        <div class="fr-cab"><input type="checkbox" data-fr-regional="${esc(gid)}" aria-label="Selecionar toda a ${esc(nome)}" title="Selecionar toda a ${esc(nome)}">
          <button type="button" class="fr-expandir" data-fr-expandir="${esc(gid)}" aria-expanded="false"${dica ? ` title="${esc(dica)}"` : ""}>${esc(nome)}</button>
          <span class="fr-conta" data-fr-conta="${esc(gid)}"></span></div>
        <ul class="fr-itens">${itens}</ul></section>`;
    function html() {
      const regs = L.REGIONAIS.map((r) => grupo(r.id, r.nome, r.municipios.map((m) => item(m.chave, m.codigo, m.nome, m.normal)).join(""))).join("");
      const fora = grupo("_fora", "Fora das regionais", chavesEspeciais.map((k) => item(k, "", L.ESPECIAIS[k], L.normalizar(L.ESPECIAIS[k]))).join(""),
        "Registros que não puderam ser classificados com segurança (o valor original do ADMS é preservado)");
      return `<div class="fr" data-fr="${esc(id)}">
        <button type="button" class="fr-gatilho" id="${esc(id)}-gatilho" aria-haspopup="true" aria-expanded="false" aria-controls="${esc(id)}-painel" aria-label="${esc(rotulo)}">
          <span class="fr-resumo"></span><span class="fr-badge oculto"></span><span class="fr-seta" aria-hidden="true"></span></button>
        <div class="fr-painel oculto" id="${esc(id)}-painel" role="group" aria-label="${esc(rotulo)}">
          <div class="fr-topo"><input type="search" class="fr-busca" placeholder="Buscar município ou código" aria-label="Buscar município ou código">
            <button type="button" class="mini-botao" data-fr-acao="limpar">Limpar</button></div>
          <div class="fr-selecionados" aria-live="polite"></div>
          <div class="fr-lista">${regs}${fora}</div>
          <div class="fr-rodape"><span class="fr-total"></span><button type="button" class="mini-botao" data-fr-acao="fechar">Fechar</button></div>
        </div></div>`;
    }
    const chavesDoGrupo = (gid) => (gid === "_fora" ? chavesEspeciais : L.chavesDaRegional(gid));
    const q = (s) => (el ? el.querySelector(s) : null), qa = (s) => (el ? [...el.querySelectorAll(s)] : []);

    function atualizar(novas) {
      if (novas) contagens = novas;
      if (!el) return;
      for (const cb of qa("[data-fr-chave]")) cb.checked = sel.has(cb.dataset.frChave);
      for (const n of qa("[data-fr-n]")) { const v = contagens.get(n.dataset.frN) || 0; n.textContent = v; n.classList.toggle("zero", !v); }
      for (const cb of qa("[data-fr-regional]")) {
        const ks = chavesDoGrupo(cb.dataset.frRegional), marcados = ks.filter((k) => sel.has(k)).length;
        cb.checked = marcados === ks.length; cb.indeterminate = marcados > 0 && marcados < ks.length;
        const total = ks.reduce((t, k) => t + (contagens.get(k) || 0), 0);
        const c = q(`[data-fr-conta="${cb.dataset.frRegional}"]`);
        c.textContent = (marcados ? `${marcados}/${ks.length} · ` : "") + total; c.classList.toggle("zero", !total);
        c.title = `${marcados} de ${ks.length} selecionado(s) · ${total} registro(s) com os demais filtros`;
        cb.closest(".fr-grupo").classList.toggle("com-selecao", marcados > 0);
      }
      const nMun = [...sel].filter((k) => L.municipioPorChave(k)).length, nEsp = sel.size - nMun;
      q(".fr-resumo").textContent = L.descrever(sel);
      const badge = q(".fr-badge"); badge.textContent = sel.size; badge.classList.toggle("oculto", !sel.size);
      badge.title = `${nMun} município(s) selecionado(s)` + (nEsp ? ` + ${nEsp} grupo(s) fora das regionais` : "");
      q(".fr-gatilho").classList.toggle("ativo", sel.size > 0);
      q(".fr-total").textContent = sel.size ? `${nMun} município(s) selecionado(s)${nEsp ? ` + ${nEsp} fora das regionais` : ""}` : "Nenhum selecionado: todas as regionais";
      q(".fr-selecionados").innerHTML = chips();
    }
    /* Seleção compacta no painel: regional inteira = uma etiqueta; o resto, uma por município. Cada uma com ×. */
    function chips() {
      if (!sel.size) return "";
      const resto = new Set(sel), out = [];
      for (const r of L.REGIONAIS) {
        const ks = r.municipios.map((m) => m.chave);
        if (ks.every((k) => resto.has(k))) { out.push([`r:${r.id}`, r.nome]); ks.forEach((k) => resto.delete(k)); }
      }
      for (const k of resto) { const m = L.municipioPorChave(k); out.push([`k:${k}`, m ? L.rotuloMunicipio(m) : L.ESPECIAIS[k]]); }
      return out.map(([v, t]) => `<button type="button" class="fr-chip" data-fr-remover="${esc(v)}" title="Remover ${esc(t)} da seleção">${esc(t)}<span aria-hidden="true">×</span></button>`).join("");
    }
    function mudou() { atualizar(); aoMudar(new Set(sel)); }
    function expandir(gid, sim) {
      if (sim) abertos.add(gid); else abertos.delete(gid);
      const g = q(`[data-fr-grupo="${gid}"]`); if (!g) return;
      g.classList.toggle("aberto", sim); g.querySelector("[data-fr-expandir]").setAttribute("aria-expanded", String(sim));
    }
    function buscar(texto) {
      // Só dígitos = código: igual (30 = 030) ou começando por ele (46 -> 461, 468). Texto = parte do nome, sem acento.
      const b = L.normalizar(texto), digitos = /^\d+$/.test(b);
      el.querySelector(".fr").classList.toggle("buscando", !!b);
      for (const g of qa(".fr-grupo")) {
        let algum = false;
        for (const li of g.querySelectorAll("li")) {
          const cod = li.dataset.frCod;
          const ve = !b || (digitos ? !!cod && (Number(cod) === Number(b) || cod.startsWith(b)) : li.dataset.frBusca.includes(b));
          li.classList.toggle("oculto", !ve); algum = algum || ve;
        }
        g.classList.toggle("oculto", !algum);
      }
    }
    function abrir(sim) {
      aberto = sim;
      if (!el) return;
      q(".fr-painel").classList.toggle("oculto", !sim); q(".fr-gatilho").setAttribute("aria-expanded", String(sim));
      el.querySelector(".fr").classList.toggle("aberto", sim);
      if (sim) q(".fr-busca").focus({ preventScroll: true });
    }
    function montar(container) {
      el = container; aberto = false;
      el.innerHTML = html();
      for (const g of abertos) expandir(g, true);
      if (el.__filtroRegionais === api) { atualizar(); return api; } // mesmo contêiner: só redesenha (sem ouvintes repetidos)
      el.__filtroRegionais = api;
      el.addEventListener("change", (ev) => {
        const t = ev.target;
        if (t.dataset.frChave) { if (t.checked) sel.add(t.dataset.frChave); else sel.delete(t.dataset.frChave); mudou(); }
        else if (t.dataset.frRegional) { for (const k of chavesDoGrupo(t.dataset.frRegional)) { if (t.checked) sel.add(k); else sel.delete(k); } mudou(); }
      });
      el.addEventListener("click", (ev) => {
        const t = ev.target.closest("button"); if (!t || !el.contains(t)) return;
        if (t.classList.contains("fr-gatilho")) abrir(!aberto);
        else if (t.dataset.frExpandir) expandir(t.dataset.frExpandir, !abertos.has(t.dataset.frExpandir));
        else if (t.dataset.frAcao === "limpar") { sel.clear(); mudou(); }
        else if (t.dataset.frAcao === "fechar") { abrir(false); q(".fr-gatilho").focus(); }
        else if (t.dataset.frRemover) {
          const [tipo, v] = [t.dataset.frRemover.slice(0, 1), t.dataset.frRemover.slice(2)];
          for (const k of tipo === "r" ? L.chavesDaRegional(v) : [v]) sel.delete(k);
          mudou();
        }
      });
      el.addEventListener("input", (ev) => { if (ev.target.classList.contains("fr-busca")) buscar(ev.target.value); });
      el.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && aberto) { ev.stopPropagation(); abrir(false); q(".fr-gatilho").focus(); } });
      atualizar();
      return api;
    }
    // Clique fora fecha o painel (um ouvinte por instância; vale para o contêiner montado no momento).
    document.addEventListener("mousedown", (ev) => { if (aberto && el && el.isConnected && !el.contains(ev.target)) abrir(false); });

    const api = {
      montar, atualizar,
      selecao: () => new Set(sel),
      definir(chaves) { sel.clear(); for (const k of chaves || []) if (valida(k)) sel.add(k); mudou(); },
      limpar() { sel.clear(); mudou(); },
      descrever: () => L.descrever(sel),
      confere: (loc) => L.confere(loc, sel),
      contem: (chave) => !sel.size || sel.has(chave), // chave já classificada (ex.: localidade do incidente)
      abrir: () => abrir(true), fechar: () => abrir(false), aberto: () => aberto,
    };
    return api;
  }
  raiz.FiltroRegionais = { criar };
})(window);
