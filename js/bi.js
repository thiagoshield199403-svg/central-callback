/* BI próprio: lê só agregados do gateway (/api/bi/dados), sem bibliotecas externas. Atualiza sozinho; sem resposta, mantém os últimos dados. */
"use strict";
(function () {
  const $ = (s) => document.querySelector(s);
  const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
  const SERIES = [["callbacks", "Callbacks executados", 1], ["resolvidos", "Callbacks resolvidos", 2]];
  const FILTROS = ["#f-ano", "#f-mes", "#f-de", "#f-ate", "#f-operador"];
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (v) => Number(v).toLocaleString("pt-BR");
  const pct = (a, b) => (b ? (100 * a / b).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%" : "—");
  const dataBR = (d) => d.split("-").reverse().join("/"), diaCurto = (d) => d.slice(8) + "/" + d.slice(5, 7);
  const mesLongo = (m) => `${MESES[Number(m.slice(5)) - 1]}/${m.slice(0, 4)}`, mesCurto = (m) => `${m.slice(5)}/${m.slice(2, 4)}`;
  const texto = (s, v) => { $(s).textContent = v; };
  let dados = { linhas: [], sincronizacao: null }, semResposta = false, msgVazia = "";

  function aplicar() {
    const a = $("#f-ano").value, m = $("#f-mes").value, de = $("#f-de").value, ate = $("#f-ate").value, o = $("#f-operador").value;
    return dados.linhas.filter((l) => (!a || l.data.startsWith(a)) && (!m || l.data.slice(5, 7) === m) && (!de || l.data >= de) && (!ate || l.data <= ate) && (!o || l.operador === o));
  }
  const vazio = () => ({ callbacks: 0, resolvidos: 0 });
  function agrupar(ls, f) { const m = new Map(); for (const l of ls) { const k = f(l); if (!m.has(k)) m.set(k, vazio()); const g = m.get(k); for (const [c] of SERIES) g[c] += l[c]; } return m; }
  function total(ls) { const t = vazio(); for (const l of ls) for (const [c] of SERIES) t[c] += l[c]; return t; }
  const ordenado = (m) => [...m].sort((a, b) => a[0].localeCompare(b[0]));
  function escala(max) { const b = max <= 4 ? 1 : Math.pow(10, Math.floor(Math.log10(max))), p = [1, 2, 5, 10].map((x) => x * b).find((x) => Math.ceil(max / x) <= 5) || b * 10; return { passo: p, topo: Math.max(p, Math.ceil(max / p) * p) }; }
  const dicaSeries = (titulo, v) => `<b>${esc(titulo)}</b><br>${SERIES.map(([c, n]) => `${n}: <b>${num(v[c])}</b>`).join("<br>")}`;
  function dica(ev, html) { const d = $("#bi-dica"); d.innerHTML = html; d.classList.remove("oculto"); const w = d.offsetWidth; d.style.left = Math.min(innerWidth - w - 8, ev.clientX + 14) + "px"; d.style.top = Math.max(8, ev.clientY - d.offsetHeight - 10) + "px"; }
  function escondeDica() { $("#bi-dica").classList.add("oculto"); }

  /* Os gráficos são desenhados no tamanho real do painel, para o texto não variar com a largura da tela. */
  function area(sel) { const el = $(sel); return { el, L: Math.max(240, el.clientWidth), A: el.clientHeight || 265 }; }
  const semDados = (el) => { el.innerHTML = `<div class="bi-vazio">${esc(msgVazia)}</div>`; };
  const maximo = (itens) => Math.max(1, ...itens.flatMap(([, v]) => SERIES.map(([c]) => v[c])));
  function eixo(L, A, M, topo, passo) {
    const y = (v) => A - M.b - (A - M.t - M.b) * v / topo; let h = "";
    for (let v = 0; v <= topo; v += passo) h += `<line class="grade" x1="${M.e}" x2="${L - M.d}" y1="${y(v)}" y2="${y(v)}"/><text x="${M.e - 8}" y="${y(v) + 3}" text-anchor="end">${num(v)}</text>`;
    return { y, h };
  }
  const svg = (L, A, rotulo, corpo) => `<svg class="bi-svg" viewBox="0 0 ${L} ${A}" role="img" aria-label="${esc(rotulo)}">${corpo}</svg>`;

  function graficoLinha(sel, itens, rotulo) {
    const { el, L, A } = area(sel), M = { e: 44, d: 46, t: 12, b: 26 }, n = itens.length;
    if (!n) return semDados(el);
    const { passo, topo } = escala(maximo(itens)), e = eixo(L, A, M, topo, passo), util = L - M.e - M.d;
    const x = (i) => (n > 1 ? M.e + util * i / (n - 1) : M.e + util / 2);
    let h = e.h; const salto = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(util / 58))));
    itens.forEach(([r], i) => { if (i % salto === 0) h += `<text x="${x(i)}" y="${A - 8}" text-anchor="middle">${esc(r)}</text>`; });
    for (const [c, , s] of SERIES) { h += `<polyline class="linha s${s}" points="${itens.map(([, v], i) => `${x(i)},${e.y(v[c])}`).join(" ")}"/>`; if (n === 1) h += `<circle class="s${s} ponto" cx="${x(0)}" cy="${e.y(itens[0][1][c])}" r="5"/>`; }
    const fim = SERIES.map(([c]) => ({ y: e.y(itens[n - 1][1][c]), v: itens[n - 1][1][c] })).sort((a, b) => a.y - b.y);
    fim.forEach((f, i) => { if (i && f.y - fim[i - 1].y < 13) f.y = fim[i - 1].y + 13; h += `<text class="rotulo-fim" x="${x(n - 1) + 7}" y="${f.y + 4}">${num(f.v)}</text>`; });
    h += `<line class="mira oculto" y1="${M.t}" y2="${A - M.b}"/><rect class="alvo" x="${M.e}" y="${M.t}" width="${util}" height="${A - M.t - M.b}"/>`;
    el.innerHTML = svg(L, A, rotulo, h);
    const s = el.querySelector("svg"), mira = s.querySelector(".mira"), alvo = s.querySelector(".alvo");
    alvo.addEventListener("mousemove", (ev) => {
      const px = (ev.clientX - s.getBoundingClientRect().left), i = n > 1 ? Math.max(0, Math.min(n - 1, Math.round((px - M.e) / (util / (n - 1))))) : 0;
      mira.setAttribute("x1", x(i)); mira.setAttribute("x2", x(i)); mira.classList.remove("oculto"); dica(ev, dicaSeries(itens[i][2], itens[i][1]));
    });
    alvo.addEventListener("mouseleave", () => { mira.classList.add("oculto"); escondeDica(); });
  }

  function graficoBarras(sel, itens, rotulo) {
    const { el, L, A } = area(sel), M = { e: 44, d: 12, t: 12, b: 26 }, n = itens.length;
    if (!n) return semDados(el);
    const { passo, topo } = escala(maximo(itens)), e = eixo(L, A, M, topo, passo), fx = (L - M.e - M.d) / n, q_s = SERIES.length, lb = Math.max(2, Math.min(26, (fx * 0.72 - 2 * (q_s - 1)) / q_s));
    const salto = Math.max(1, Math.ceil(46 / fx)); let h = e.h;
    itens.forEach(([r, v], i) => {
      const x0 = M.e + fx * i + (fx - q_s * lb - 2 * (q_s - 1)) / 2;
      SERIES.forEach(([c, , s], k) => {
        const y = e.y(v[c]), a = A - M.b - y, x1 = x0 + k * (lb + 2), q = Math.min(4, a, lb / 2);
        if (a > 0) h += `<path class="s${s}" d="M${x1},${A - M.b}V${y + q}q0,-${q} ${q},-${q}H${x1 + lb - q}q${q},0 ${q},${q}V${A - M.b}Z"/>`;
      });
      if (i % salto === 0) h += `<text x="${M.e + fx * i + fx / 2}" y="${A - 8}" text-anchor="middle">${esc(r)}</text>`;
      h += `<rect class="alvo" data-i="${i}" x="${M.e + fx * i}" y="${M.t}" width="${fx}" height="${A - M.t - M.b}"/>`;
    });
    el.innerHTML = svg(L, A, rotulo, h);
    el.querySelectorAll(".alvo").forEach((a) => {
      a.addEventListener("mousemove", (ev) => { const it = itens[Number(a.dataset.i)]; dica(ev, dicaSeries(it[2], it[1])); });
      a.addEventListener("mouseleave", escondeDica);
    });
  }

  function graficoTaxa(sel, t) {
    const { el, L, A } = area(sel);
    if (!t.callbacks && !t.resolvidos) return semDados(el);
    const r = Math.min(L * 0.24, A * 0.31), esp = r * 0.38, cx = L / 2, cy = A / 2 - 14, circ = 2 * Math.PI * r, f = t.callbacks ? Math.min(1, t.resolvidos / t.callbacks) : 0;
    let h = `<circle class="trilha" cx="${cx}" cy="${cy}" r="${r}" stroke-width="${esp}"/>`;
    if (f > 0) h += `<circle class="arco blue" cx="${cx}" cy="${cy}" r="${r}" stroke-width="${esp}" stroke-dasharray="${circ * f} ${circ}" transform="rotate(-90 ${cx} ${cy})"/>`;
    h += `<text class="centro" x="${cx}" y="${cy + 8}" text-anchor="middle">${pct(t.resolvidos, t.callbacks)}</text><text class="nome" x="${cx}" y="${cy + r + esp / 2 + 24}" text-anchor="middle">Resolvidos ÷ executados</text>`;
    h += `<circle class="alvo" cx="${cx}" cy="${cy}" r="${r + esp / 2}"/>`;
    el.innerHTML = svg(L, A, "Taxa de resolução", h);
    const a = el.querySelector(".alvo");
    a.addEventListener("mousemove", (ev) => dica(ev, `<b>Taxa de resolução: ${pct(t.resolvidos, t.callbacks)}</b><br>${num(t.resolvidos)} resolvidos de ${num(t.callbacks)} executados`));
    a.addEventListener("mouseleave", escondeDica);
  }

  function tabela(sel, itens, classe = "") {
    $(sel).innerHTML = itens.length
      ? itens.map(([r, v]) => `<tr><td${classe ? ` class="${classe}"` : ""}>${esc(r)}</td>${SERIES.map(([c]) => `<td class="num">${num(v[c])}</td>`).join("")}<td class="num">${pct(v.resolvidos, v.callbacks)}</td></tr>`).join("")
      : `<tr><td colspan="4" class="empty">${esc(msgVazia)}</td></tr>`;
  }

  function desenhar() {
    msgVazia = dados.linhas.length ? "Nenhum dado neste filtro." : "Ainda não há fechamentos sincronizados.";
    const ls = aplicar(), t = total(ls);
    texto("#k-callbacks", num(t.callbacks)); texto("#k-resolvidos", num(t.resolvidos)); texto("#k-taxa", pct(t.resolvidos, t.callbacks)); texto("#k-operadores", num(new Set(ls.map((l) => l.operador)).size));
    texto("#m-callbacks", num(t.callbacks)); texto("#m-resolvidos", num(t.resolvidos)); texto("#m-taxa", pct(t.resolvidos, t.callbacks));
    texto("#h-callbacks", ls.length ? `${dataBR(ls[0].data)} a ${dataBR(ls[ls.length - 1].data)}` : "Sem dados no filtro");

    const dia = ordenado(agrupar(ls, (l) => l.data)).map(([k, v]) => [diaCurto(k), v, dataBR(k)]);
    const mes = ordenado(agrupar(ls, (l) => l.data.slice(0, 7))).map(([k, v]) => [mesCurto(k), v, mesLongo(k)]);
    const op = [...agrupar(ls, (l) => l.operador)].sort((a, b) => b[1].callbacks - a[1].callbacks || a[0].localeCompare(b[0])).map(([k, v]) => [k, v, k]);
    const soma = vazio(), acumulado = dia.map(([r, v, ti]) => { for (const [k] of SERIES) soma[k] += v[k]; return [r, { ...soma }, ti]; });

    graficoBarras("#c-mes", mes, "Comparativo mensal");
    graficoTaxa("#c-taxas", t);
    graficoLinha("#c-dia", dia, "Evolução diária");
    graficoBarras("#c-op", op.slice(0, 12), "Comparativo por operador");
    graficoLinha("#c-ac", acumulado, "Histórico acumulado");
    tabela("#t-operador", op, "operator");
    tabela("#t-mes", mes.map(([, v, ti]) => [ti, v]));
    tabela("#t-dia", dia.map(([, v, ti]) => [ti, v]));
    tabela("#t-ac", acumulado.map(([, v, ti]) => [ti, v]));
  }

  function opcoes(sel, vals, rotulo, fmt = (x) => x) { const a = sel.value; sel.innerHTML = `<option value="">${rotulo}</option>` + vals.map((v) => `<option value="${esc(v)}"${v === a ? " selected" : ""}>${esc(fmt(v))}</option>`).join(""); }

  function statusSync() {
    const s = dados.sincronizacao || {}, sit = semResposta ? "pendente" : s.situacao || "aguardando", ok = sit === "ok" && !semResposta;
    const quando = s.ultima_sincronizacao ? new Date(s.ultima_sincronizacao).toLocaleString("pt-BR") : "nunca";
    const rotulo = { ok: "em dia", pendente: "pendente", nao_configurado: "Google Drive não configurado", aguardando: "aguardando" }[sit] || sit;
    texto("#bi-sync", `Última atualização: ${quando} · Sincronização: ${rotulo} · ${num(s.arquivos || 0)} arquivo(s)`);
    $("#bi-status").className = "status" + (ok ? "" : " alerta");
    $("#bi-status").innerHTML = `<b>●</b> ${esc(semResposta ? "Servidor sem resposta" : { ok: "Sincronizado", pendente: "Atualização pendente", nao_configurado: "Dados locais" }[sit] || "Aguardando sincronização")}`;
    const aviso = semResposta ? "Servidor do BI sem resposta: mostrando os últimos dados carregados."
      : sit === "pendente" ? `Google Drive indisponível: mostrando os últimos dados sincronizados. ${s.detalhe || ""}`
      : sit === "nao_configurado" ? s.detalhe || "Google Drive não configurado." : "";
    texto("#bi-aviso", aviso); $("#bi-aviso").classList.toggle("oculto", !aviso);

    const ls = dados.linhas, t = total(ls);
    texto("#a-arquivos", num(s.arquivos || 0)); texto("#a-recusados", num(s.rejeitados || 0));
    texto("#a-dias", num(new Set(ls.map((l) => l.data)).size)); texto("#a-operadores", num(new Set(ls.map((l) => l.operador)).size));
    texto("#a-callbacks", num(t.callbacks)); texto("#a-resolvidos", num(t.resolvidos));
    texto("#a-ultima", quando); texto("#a-periodo", ls.length ? `${dataBR(ls[0].data)} – ${dataBR(ls[ls.length - 1].data)}` : "—");
  }

  async function carregar() {
    try { const r = await fetch("/api/bi/dados", { cache: "no-store" }); if (!r.ok) throw new Error(); dados = await r.json(); semResposta = false; }
    catch (e) { semResposta = true; }
    const anos = [...new Set(dados.linhas.map((l) => l.data.slice(0, 4)))].sort().reverse(), mesesD = [...new Set(dados.linhas.map((l) => l.data.slice(5, 7)))].sort();
    opcoes($("#f-ano"), anos, "Todos os anos"); opcoes($("#f-mes"), mesesD, "Todos os meses", (m) => MESES[Number(m) - 1]); opcoes($("#f-operador"), [...new Set(dados.linhas.map((l) => l.operador))].sort(), "Todos os operadores");
    statusSync(); if (!$(".bi-svg:hover")) desenhar();
  }

  document.querySelectorAll("[data-legenda]").forEach((el) => {
    const linha = el.dataset.legenda === "linha";
    el.innerHTML = SERIES.map(([, n, i]) => `<span><i class="c${i} ${linha ? "traco" : "dot"}"></i>${n}</span>`).join("");
  });
  for (const id of FILTROS) $(id).addEventListener("change", desenhar);
  $("#f-limpar").onclick = () => { for (const id of FILTROS) $(id).value = ""; desenhar(); };
  let timerResize = null;
  window.addEventListener("resize", () => { clearTimeout(timerResize); timerResize = setTimeout(desenhar, 120); });
  carregar().finally(() => { document.body.dataset.pronto = "1"; setInterval(carregar, 60000); });
})();
