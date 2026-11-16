/* DESPACHO OTIMIZADO COI 2.0 — tela. Lê chamadas_incidentes.csv LOCALMENTE (File System Access), sem rede e sem gravar no ADMS.
   - Conexão: a MESMA que a Central guardou (banco da Central, chave "pasta_adms": pasta ou o próprio arquivo); só LÊ esse banco.
     Sem ela: "Selecionar arquivo" aqui (guardado no banco próprio) ou "Abrir arquivo" avulso (sem atualização automática).
   - Atualização: botão Atualizar (relê sempre) e conferência a cada CFG.verificarACadaSeg com a página visível (só relê se o
     tamanho/data do arquivo mudaram). Arquivo sendo gravado pelo ADMS: espera ficar estável. Falha: a última leitura válida fica.
   - Dados só em memória. Guardados no navegador: polo escolhido (local), seleção e INCs já copiados (só nesta aba). */
"use strict";
(function () {
  const CFG = window.DespachoConfig, M = window.DespachoMotor, N = window.Nucleo;
  const $ = (s) => document.querySelector(s);
  const params = new URLSearchParams(location.search);
  const sufixo = params.get("bd") ? "-" + params.get("bd").replace(/[^a-z0-9-]/gi, "").slice(0, 30) : "";
  const BANCOS_CENTRAL = ["central-callback-coi-dev" + sufixo, "central-callback-coi" + sufixo]; // nomes da Central (js/app.js)
  const BANCO_PROPRIO = "despacho-otimizado-coi" + sufixo, CHAVE_CENTRAL = "pasta_adms", CHAVE_PROPRIA = "arquivo_chamadas";
  const K_POLO = "despacho-polo" + sufixo, K_SEL = "despacho-sel" + sufixo, K_COP = "despacho-copiados" + sufixo;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));
  const hhmm = (ms) => (ms ? new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—");
  const dataHora = (ms) => (ms ? new Date(ms).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");
  const isoCurto = (iso) => { const m = /^\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso || ""); return m ? `${m[2]}/${m[1]} ${m[3]}:${m[4]}` : "—"; };
  const ler = (loja, k, padrao) => { try { const v = loja.getItem(k); return v ? JSON.parse(v) : padrao; } catch (e) { return padrao; } };
  const gravar = (loja, k, v) => { try { loja.setItem(k, JSON.stringify(v)); } catch (e) { /* sem armazenamento */ } };

  const S = {
    con: null, estado: "verificando", aviso: "", arquivo: null, lidoEm: null, verificadoEm: null, dados: null, lendo: false,
    f: { polo: ler(localStorage, K_POLO, ""), municipio: "", bairro: "", alimentador: "", circuito: "", prioridade: "", busca: "" },
    aberto: null, detalhe: null, verSemInc: false,
    sel: new Set(ler(sessionStorage, K_SEL, [])), copiados: new Map(ler(sessionStorage, K_COP, [])),
  };

  /* ------------------------------------------------------------ conexão (a mesma da Central) */
  async function bancoExiste(nome) {
    try { if (indexedDB.databases) return (await indexedDB.databases()).some((d) => d.name === nome); } catch (e) { /* sem a função */ }
    return nome === BANCOS_CENTRAL[0]; // sem como listar: só o nome em uso pela Central
  }
  async function lerChave(banco, chave) {
    if (!(await bancoExiste(banco))) return null; // não cria banco vazio com o nome da Central
    let arm = null;
    try { arm = await new window.Armazenamento(banco).iniciar(); return await arm.lerArquivo(chave); } catch (e) { return null; }
    finally { try { if (arm) arm.fechar(); } catch (e) { /* já fechado */ } }
  }
  async function obterConexao() {
    for (const b of BANCOS_CENTRAL) { const h = await lerChave(b, CHAVE_CENTRAL); if (h && (h.kind === "directory" || h.kind === "file")) return { h, origem: "central" }; }
    const p = await lerChave(BANCO_PROPRIO, CHAVE_PROPRIA); if (p && p.kind === "file") return { h: p, origem: "despacho" };
    return null;
  }
  const temAPI = () => "FileSystemHandle" in window && typeof window.showOpenFilePicker === "function";
  async function permissao(h, pedir) {
    let p = "prompt";
    try { p = await h.queryPermission({ mode: "read" }); } catch (e) { /* trata como pendente */ }
    if (p !== "granted" && pedir) { try { p = await h.requestPermission({ mode: "read" }); } catch (e) { /* sem gesto do usuário */ } }
    return p;
  }
  async function acharArquivo(h) {
    if (h.kind === "file") return h;
    try { return await h.getFileHandle(CFG.arquivo); } catch (e) { if (e.name !== "NotFoundError" && e.name !== "TypeMismatchError") throw e; }
    for await (const [nome, x] of h.entries()) if (x.kind === "file" && nome.toLowerCase() === CFG.arquivo) return x;
    return null;
  }
  /* Mesma regra da Central (js/pasta-adms.js): tamanho e data iguais em duas consultas; nunca lê arquivo pela metade. */
  async function lerEstavel(fh, primeiro) {
    let a = primeiro;
    for (let t = 0; t < 4; t++) {
      await espera(t === 0 ? 300 : 1200);
      const b = await fh.getFile();
      if (b.size > 0 && b.size === a.size && b.lastModified === a.lastModified) {
        try { const bytes = new Uint8Array(await b.arrayBuffer()); if (bytes.length === b.size) return { arquivo: b, bytes }; }
        catch (e) { if (e.name !== "NotReadableError") throw e; }
      }
      a = await fh.getFile();
    }
    return null;
  }
  const msgErro = (e) => (e && (e.name === "NotAllowedError" || e.name === "SecurityError") ? "sem permissão de leitura"
    : e && (e.name === "NotFoundError" || e.name === "NotReadableError") ? "arquivo ou pasta indisponível (rede fora, pasta movida ou arquivo removido)" : (e && e.message) || String(e));

  /* ------------------------------------------------------------ leitura */
  function carregarBytes(bytes, arquivo) {
    const dados = M.processar(bytes);
    S.dados = dados; S.arquivo = arquivo; S.lidoEm = Date.now(); S.aviso = "";
    const ids = new Set(dados.incs.map((i) => i.id));
    for (const id of [...S.sel]) if (!ids.has(id)) S.sel.delete(id); // INC que saiu do arquivo deixa a seleção
    gravar(sessionStorage, K_SEL, [...S.sel]);
  }
  async function atualizar(forcar, gesto) {
    if (S.lendo) return;
    S.lendo = true; render();
    try {
      if (!S.con) S.con = await obterConexao();
      if (!S.con) { S.estado = temAPI() ? "sem_conexao" : "sem_api"; return; }
      const perm = await permissao(S.con.h, gesto);
      if (perm !== "granted") { S.estado = "permissao"; return; }
      let fh, f;
      try { fh = await acharArquivo(S.con.h); } catch (e) { S.estado = "erro"; S.aviso = msgErro(e); return; }
      if (!fh) { S.estado = "nao_encontrado"; return; }
      try { f = await fh.getFile(); } catch (e) { S.estado = "erro"; S.aviso = msgErro(e); return; }
      S.verificadoEm = Date.now();
      if (!forcar && S.dados && S.arquivo && S.arquivo.size === f.size && S.arquivo.lastModified === f.lastModified) { S.estado = "ok"; return; }
      const lido = await lerEstavel(fh, f);
      if (!lido) { S.estado = "em_gravacao"; return; }
      try { carregarBytes(lido.bytes, { nome: lido.arquivo.name, size: lido.arquivo.size, lastModified: lido.arquivo.lastModified }); S.estado = "ok"; }
      catch (e) { S.estado = "erro"; S.aviso = "arquivo não reconhecido: " + ((e && e.message) || e); }
    } catch (e) { S.estado = "erro"; S.aviso = msgErro(e); }
    finally { S.lendo = false; render(); document.body.dataset.pronto = "1"; }
  }
  async function selecionarArquivo() {
    let hs;
    try { hs = await window.showOpenFilePicker({ id: "despacho-chamadas", multiple: false, types: [{ description: "CSV do ADMS", accept: { "text/csv": [".csv"] } }] }); }
    catch (e) { if (e.name !== "AbortError") toast("Não foi possível selecionar: " + e.message, true); return; }
    const h = hs && hs[0]; if (!h) return;
    if (h.name.toLowerCase() !== CFG.arquivo) { toast(`Escolha o arquivo ${CFG.arquivo} (foi escolhido "${h.name}").`, true); return; }
    let arm = null;
    try { arm = await new window.Armazenamento(BANCO_PROPRIO).iniciar(); await arm.gravarArquivo(CHAVE_PROPRIA, h); } catch (e) { toast("O arquivo foi aberto, mas a conexão não ficou guardada neste navegador.", true); }
    finally { try { if (arm) arm.fechar(); } catch (e) { /* já fechado */ } }
    S.con = { h, origem: "despacho" }; S.dados = null; S.arquivo = null; await atualizar(true, true);
  }
  async function abrirManual(file) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      carregarBytes(bytes, { nome: file.name, size: file.size, lastModified: file.lastModified });
      S.con = null; S.estado = "manual"; render();
    } catch (e) { toast("Arquivo não reconhecido: " + ((e && e.message) || e), true); }
  }

  /* ------------------------------------------------------------ cópia */
  async function copiar(ids, oque) {
    const texto = M.textoCopia(ids);
    if (!texto) { toast("Nenhuma INC para copiar.", true); return false; }
    let ok = false;
    try { await navigator.clipboard.writeText(texto); ok = true; }
    catch (e) {
      try { const t = document.createElement("textarea"); t.value = texto; t.setAttribute("readonly", ""); t.style.position = "fixed"; t.style.opacity = "0"; document.body.appendChild(t); t.select(); ok = document.execCommand("copy"); t.remove(); } catch (x) { ok = false; }
    }
    if (!ok) { toast("O navegador não permitiu copiar. Tente de novo.", true); return false; }
    const n = texto.split(CFG.copia.separador).length, agora = Date.now();
    for (const id of ids) S.copiados.set(id, agora);
    gravar(sessionStorage, K_COP, [...S.copiados]);
    toast(`${n} INC(s) copiada(s)${oque ? " — " + oque : ""}. Confira no SIGODE antes de lançar.`);
    render();
    return true;
  }

  /* ------------------------------------------------------------ desenho */
  const tag = (cls, t, title) => `<span class="tag ${cls}"${title ? ` title="${esc(title)}"` : ""}>${esc(t)}</span>`;
  function tagsInc(i) {
    const t = [];
    if (i.risco.nivel >= 2) t.push(tag("vermelho", "Risco de vida", i.risco.origem));
    else if (i.risco.nivel === 1) t.push(tag("laranja", "Indício de risco", i.risco.origem));
    if (i.fase.nivel === "confirmada") t.push(tag("azul-forte", "Falta de fase", i.fase.origem));
    else if (i.fase.nivel === "possivel") t.push(tag("azul", "Possível falta de fase", i.fase.origem));
    for (const c of i.clientes) t.push(tag("neutro", c, "Cust. prioritárias do ADMS"));
    if (i.chamadas > 1) t.push(tag("neutro", `${i.chamadas} chamadas`, "Chamadas do mesmo INC consolidadas"));
    return t.join("");
  }
  function eletrica(itens) {
    const p = [];
    if (itens.alimentadores.length) p.push("Alim. " + itens.alimentadores.join(", "));
    if (itens.circuitos.length) p.push("Circ. " + itens.circuitos.join(", "));
    if (itens.subestacoes && itens.subestacoes.length) p.push("SE " + itens.subestacoes.join(", "));
    return p.length ? `<span class="eletrica">${esc(p.join(" · "))}</span>` : "";
  }
  function linhaInc(i, lote) {
    const end = [i.logradouro, i.numeroEnd, i.complemento].filter(Boolean).join(", ") || (i.localizacoes[0] || "sem endereço");
    const aberto = S.detalhe === i.id;
    let h = `<tr class="inc${S.sel.has(i.id) ? " sel" : ""}" data-inc="${esc(i.id)}">
      <td class="c-sel"><input type="checkbox" data-sel="${esc(i.id)}"${S.sel.has(i.id) ? " checked" : ""} aria-label="Selecionar ${esc(i.id)}"></td>
      <td class="c-inc">${esc(i.id)}${S.copiados.has(i.id) ? `<span class="ok" title="Copiada às ${hhmm(S.copiados.get(i.id))}">✓</span>` : ""}</td>
      <td class="c-end" title="${esc(i.localizacoes.join(" | "))}">${esc(end)}${lote.tipo === "nao_identificado" ? ` <span class="fraco">· ${esc(i.bairroMotivo)}</span>` : ""}</td>
      <td class="c-hora">${esc(isoCurto(i.primeira))}</td>
      <td class="c-tags">${tagsInc(i)}</td>
      <td class="c-mais"><button type="button" class="mini fantasma" data-detalhe="${esc(i.id)}" aria-expanded="${aberto}">${aberto ? "Fechar" : "Detalhes"}</button></td></tr>`;
    if (aberto) {
      const d = [];
      d.push(["Localização (original do ADMS)", i.localizacoes.join("<br>") ? i.localizacoes.map(esc).join("<br>") : "vazia"]);
      d.push(["Município", esc(i.municipio.status === "ok" ? `${i.municipio.codigo} — ${i.municipio.nome}` : `não identificado (${i.municipio.motivo || i.municipio.status})`)]);
      d.push(["Bairro", i.bairro ? `${esc(i.bairro.nome)} <span class="fraco">(${esc(i.bairro.origem)})</span>` : `<span class="laranja-t">não identificado</span> <span class="fraco">(${esc(i.bairroMotivo)})</span>`]);
      if (i.bairrosDiferentes.length) d.push(["Atenção", esc("chamadas em bairros diferentes: " + i.bairrosDiferentes.join(", ") + " — conferir")]);
      d.push(["Alimentador / circuito", esc([i.alimentadores.join(", "), i.circuitos.join(", ")].filter(Boolean).join(" · ") || "não informado no arquivo")]);
      if (i.equipamentos.length) d.push(["Equipamento", esc(i.equipamentos.join(", "))]);
      d.push(["Falta de fase", esc(i.fase.nivel === "confirmada" ? "confirmada — " + i.fase.origem : i.fase.nivel === "possivel" ? "possível — " + i.fase.origem : "sem informação suficiente")]);
      if (i.risco.nivel) d.push(["Risco", esc(i.risco.origem)]);
      d.push(["Chamadas", i.calls.map((c) => `${esc(c.call_id)} · ${esc(isoCurto(c.horario))} · ${esc(c.motivo || "—")}`).join("<br>")]);
      d.push(["Despacho", "<strong>consultar no SIGODE</strong> (o arquivo de chamadas não informa equipe nem despacho)"]);
      h += `<tr class="detalhe"><td></td><td colspan="5"><dl>${d.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("")}</dl></td></tr>`;
    }
    return h;
  }
  function htmlLote(l) {
    const aberto = S.aberto === l.chave, ids = l.incs.map((i) => i.id), nSel = ids.filter((x) => S.sel.has(x)).length;
    const todosCop = ids.every((x) => S.copiados.has(x)), ult = Math.max(0, ...ids.map((x) => S.copiados.get(x) || 0));
    const tags = [];
    if (l.nRiscoVida) tags.push(tag("vermelho", `${l.nRiscoVida} risco de vida`));
    else if (l.nRisco) tags.push(tag("laranja", `${l.nRisco} indício de risco`));
    if (l.nFase) tags.push(tag(l.nFaseConf ? "azul-forte" : "azul", `${l.nFase} falta de fase${l.nFaseConf ? "" : " (possível)"}`));
    return `<div class="lote${aberto ? " aberto" : ""}${l.tipo === "nao_identificado" ? " nao-ident" : ""}" data-lote="${esc(l.chave)}">
      <div class="lote-cab" data-abrir="${esc(l.chave)}" tabindex="0" role="button" aria-expanded="${aberto}">
        <input type="checkbox" data-sel-lote="${esc(l.chave)}" aria-label="Selecionar o lote"${nSel === ids.length ? " checked" : ""}${nSel && nSel < ids.length ? ' data-parcial="1"' : ""}>
        <span class="seta" aria-hidden="true"></span>
        <span class="nome"><span class="mun">${esc(l.municipio)}</span><span class="bairro">${esc(l.bairro)}</span>${l.tipo === "localidade" ? '<span class="fraco"> · localidade</span>' : ""}</span>
        <span class="qtd">${l.n} INC${l.n > 1 ? "s" : ""}</span>
        ${tags.join("")}${eletrica(l)}
        <span class="esp"></span>
        ${todosCop ? `<span class="copiado">copiado ${hhmm(ult)}</span>` : ""}
        <button type="button" class="copiar" data-copiar="${esc(l.chave)}">Copiar lote</button>
      </div>
      ${aberto ? `<div class="lote-corpo">${l.tipo === "nao_identificado" ? `<p class="nota">Bairro não reconhecido no endereço do ADMS: o texto original está em Detalhes. Confira a localização antes de juntar com outro lote.</p>` : ""}
        <table><thead><tr><th></th><th>INC</th><th>Endereço (ADMS)</th><th>1ª chamada</th><th>Indicações</th><th></th></tr></thead><tbody>${l.incs.map((i) => linhaInc(i, l)).join("")}</tbody></table></div>` : ""}
    </div>`;
  }
  function preencherSelect(el, todos, ops, valor, indisponivel) {
    const tem = ops.some((o) => o.valor === valor);
    el.innerHTML = `<option value="">${esc(indisponivel || todos)}</option>` + ops.map((o) => `<option value="${esc(o.valor)}"${o.valor === valor ? " selected" : ""}>${esc(o.rotulo)} (${o.n})</option>`).join("");
    el.disabled = !!indisponivel; el.title = indisponivel ? "Coluna ausente no chamadas_incidentes.csv: não há como filtrar sem inventar o dado" : "";
    return tem ? valor : "";
  }
  function renderFonte() {
    const el = $("#fonte"), b = (acao, t, cls = "") => `<button type="button" class="mini ${cls}" data-fonte="${acao}">${t}</button>`;
    const msg = {
      sem_conexao: [`A pasta ADMS não está conectada na Central neste navegador. Conecte-a na Central (faixa Pasta ADMS) ou selecione o arquivo ${CFG.arquivo} aqui.`, b("selecionar", "Selecionar arquivo", "primario") + b("manual", "Abrir arquivo avulso")],
      sem_api: ["Este navegador não permite acessar a pasta ADMS (use o Edge ou o Chrome). É possível abrir o arquivo avulso, sem atualização automática.", b("manual", "Abrir arquivo avulso", "primario")],
      permissao: ["O navegador precisa da sua autorização para ler o arquivo (a mesma da Central). Clique em Autorizar leitura.", b("autorizar", "Autorizar leitura", "primario")],
      nao_encontrado: [`${CFG.arquivo} não foi encontrado na pasta conectada.`, b("atualizar", "Tentar de novo") + b("selecionar", "Selecionar arquivo")],
      em_gravacao: ["O ADMS está gravando o arquivo agora: a leitura anterior foi mantida. Tente em instantes.", b("atualizar", "Tentar de novo")],
      erro: [`Falha na leitura: ${S.aviso}.${S.dados ? " A última leitura válida continua na tela." : ""}`, b("atualizar", "Tentar de novo") + (temAPI() ? b("selecionar", "Selecionar arquivo") : "")],
      manual: ["Arquivo aberto avulso: sem atualização automática. Para atualizar, abra o arquivo de novo.", b("manual", "Abrir outro arquivo")],
    }[S.estado];
    el.classList.toggle("oculto", !msg);
    el.className = "fonte" + (msg ? " s-" + S.estado : " oculto");
    if (msg) el.innerHTML = `<span>${esc(msg[0])}</span><span class="botoes">${msg[1]}</span>`;
  }
  function renderDados() {
    const el = $("#dados"), t = $("#dados-texto");
    if (!S.dados) { el.className = "dados " + (S.lendo ? "lendo" : "vazio"); t.textContent = S.lendo ? "Lendo…" : "Sem dados"; return; }
    const idade = S.arquivo.lastModified ? (Date.now() - S.arquivo.lastModified) / 60000 : 0;
    el.className = "dados " + (S.lendo ? "lendo" : S.estado === "ok" || S.estado === "manual" ? (idade > 60 ? "velho" : "ok") : "falha");
    t.textContent = `Arquivo de ${dataHora(S.arquivo.lastModified)} · lido às ${hhmm(S.lidoEm)}${S.estado === "manual" ? " (avulso)" : ""}`;
    el.title = `Última atualização dos dados: o ADMS gravou ${CFG.arquivo} em ${dataHora(S.arquivo.lastModified)}; lido às ${hhmm(S.lidoEm)}`
      + (S.verificadoEm ? `; conferido às ${hhmm(S.verificadoEm)}` : "") + (idade > 60 ? ". ATENÇÃO: arquivo sem atualização há mais de 60 min." : "");
  }
  function render() {
    renderFonte(); renderDados();
    $("#btn-atualizar").disabled = S.lendo;
    const d = S.dados, main = $("#lotes");
    const pol = $("#polo"), polos = d ? M.contarPolos(d.incs) : M.POLOS.map((p) => ({ ...p, n: null }));
    pol.innerHTML = `<option value="">Todos os polos${d ? ` (${d.incs.length})` : ""}</option>` + polos.map((p) => `<option value="${p.id}"${p.id === S.f.polo ? " selected" : ""} title="${esc(p.municipios.join(", "))}">${esc(p.nome)}${p.n !== null ? ` (${p.n})` : ""}</option>`).join("");
    if (!d) {
      main.innerHTML = `<div class="vazio">${S.lendo ? "Lendo o arquivo…" : "Nenhum dado carregado."}</div>`;
      $("#conferencia").innerHTML = ""; document.querySelectorAll("[data-kpi]").forEach((e) => (e.textContent = "—")); renderBandeja(); return;
    }
    // filtros (em conjunto): opções calculadas com os demais filtros aplicados
    const op = M.opcoes(d.incs, S.f);
    S.f.municipio = preencherSelect($("#f-municipio"), "Todos os municípios", op.municipio, S.f.municipio);
    S.f.bairro = preencherSelect($("#f-bairro"), "Todos os bairros", op.bairro, S.f.bairro);
    S.f.alimentador = preencherSelect($("#f-alimentador"), "Todos os alimentadores", op.alimentador, S.f.alimentador, d.colunas.alimentador ? "" : "Alimentador: sem dado no arquivo");
    S.f.circuito = preencherSelect($("#f-circuito"), "Todos os circuitos", op.circuito, S.f.circuito, d.colunas.circuito ? "" : "Circuito: sem dado no arquivo");
    $("#f-prioridade").value = S.f.prioridade;
    const r = M.montar(d.incs, S.f), k = r.indicadores;
    const kp = (n, v) => { const e = document.querySelector(`[data-kpi="${n}"]`); e.textContent = v; e.dataset.atual = v; };
    kp("incs", k.incs); kp("lotes", k.lotes); kp("nao_ident", k.naoIdentificados); kp("fase", k.faseConfirmada + k.fasePossivel);
    document.querySelector('[data-kpi-det="incs"]').textContent = `reunindo ${k.chamadas} chamada(s)`;
    document.querySelector('[data-kpi-det="lotes"]').textContent = `por município e bairro${k.lotesNaoIdent ? ` · +${k.lotesNaoIdent} não identificado(s)` : ""}`;
    document.querySelector('[data-kpi-det="fase"]').textContent = `${k.faseConfirmada} confirmada(s) · ${k.fasePossivel} possível(is)`;
    document.querySelector('[data-kpi="nao_ident"]').closest(".kpi").classList.toggle("zero", !k.naoIdentificados);
    // conferência com a fonte
    const R = d.resumo, polo = M.POLOS.find((p) => p.id === S.f.polo);
    $("#conferencia").innerHTML = `<span><strong>Fonte:</strong> ${R.linhas_lidas} linha(s) · ${R.chamadas_validas} chamada(s) válida(s) → <strong>${R.incs} INC(s)</strong>`
      + ` (${R.consolidadas} chamada(s) repetida(s) do mesmo INC consolidada(s))${R.chamadas_sem_inc ? ` · <button type="button" class="link" data-sem-inc>${R.chamadas_sem_inc} chamada(s) sem INC</button>` : ""}`
      + `${R.linhas_com_erro ? ` · ${R.linhas_com_erro} linha(s) com erro descartada(s)` : ""}${R.calls_repetidas ? ` · ${R.calls_repetidas} CALL repetida(s) contada(s) uma vez` : ""}</span>`
      + `<span>${polo ? `<strong>${esc(polo.nome)}:</strong> ${esc(polo.municipios.join(", "))} · ` : ""}Exibindo ${k.incs} INC(s)`
      + `${R.periodo ? ` · chamadas de ${isoCurto(R.periodo[0])} a ${isoCurto(R.periodo[1])}` : ""}</span>`
      + (S.verSemInc ? `<div class="sem-inc"><strong>Chamadas sem número de INC</strong> (não entram em lotes: não há INC para lançar):<br>${d.semInc.map((c) => `${esc(c.call_id)} · ${esc(isoCurto(c.horario))} · ${esc(c.motivo || "—")} · ${esc(c.localizacao || "Localização vazia")}`).join("<br>")}</div>` : "");
    // lotes por município
    main.innerHTML = r.secoes.length ? r.secoes.map((s) => `<section class="secao${s.especial ? " especial" : ""}">
        <h2><span>${esc(s.nome)}</span><span class="info">${s.n} INC(s) · ${s.lotes.length} lote(s)${s.nNaoIdent ? ` · ${s.nNaoIdent} sem bairro` : ""}${s.nFase ? ` · ${s.nFase} falta de fase` : ""}${s.nRisco ? ` · ${s.nRisco} com risco` : ""}</span></h2>
        ${s.especial ? `<p class="nota">Município não reconhecido ou divergente na Localização: confira o endereço antes de despachar.</p>` : ""}
        ${s.lotes.map(htmlLote).join("")}</section>`).join("")
      : `<div class="vazio">Nenhuma INC com os filtros atuais.</div>`;
    main.querySelectorAll("[data-parcial]").forEach((x) => (x.indeterminate = true));
    renderBandeja();
  }
  function renderBandeja() {
    const ids = [...S.sel];
    $("#sel-n").textContent = ids.length;
    $("#sel-itens").innerHTML = ids.slice(0, 30).map((id) => `<span class="chip">${esc(id)}<button type="button" data-tirar="${esc(id)}" aria-label="Tirar ${esc(id)}">×</button></span>`).join("") + (ids.length > 30 ? `<span class="fraco">+${ids.length - 30}</span>` : "");
    $("#sel-copiar").disabled = !ids.length; $("#sel-limpar").disabled = !ids.length;
    $("#bandeja").classList.toggle("vazia", !ids.length);
  }
  let tmToast;
  function toast(t, erro) { const e = $("#toast"); e.textContent = t; e.className = "toast" + (erro ? " erro" : ""); clearTimeout(tmToast); tmToast = setTimeout(() => e.classList.add("oculto"), erro ? 6000 : 3500); }

  /* ------------------------------------------------------------ eventos */
  const loteDe = (chave) => { const r = M.montar(S.dados.incs, S.f); for (const s of r.secoes) for (const l of s.lotes) if (l.chave === chave) return l; return null; };
  const salvarSel = () => gravar(sessionStorage, K_SEL, [...S.sel]);
  $("#lotes").addEventListener("click", (ev) => {
    const t = ev.target;
    if (t.matches("[data-sel]")) { t.checked ? S.sel.add(t.dataset.sel) : S.sel.delete(t.dataset.sel); salvarSel(); render(); return; }
    if (t.matches("[data-sel-lote]")) { ev.stopPropagation(); const l = loteDe(t.dataset.selLote); if (l) { const todos = l.incs.every((i) => S.sel.has(i.id)); l.incs.forEach((i) => (todos ? S.sel.delete(i.id) : S.sel.add(i.id))); salvarSel(); render(); } return; }
    const cp = t.closest("[data-copiar]"); if (cp) { ev.stopPropagation(); const l = loteDe(cp.dataset.copiar); if (l) copiar(l.incs.map((i) => i.id), `${l.municipio} · ${l.bairro}`); return; }
    const dt = t.closest("[data-detalhe]"); if (dt) { S.detalhe = S.detalhe === dt.dataset.detalhe ? null : dt.dataset.detalhe; render(); return; }
    const ab = t.closest("[data-abrir]"); if (ab) { S.aberto = S.aberto === ab.dataset.abrir ? null : ab.dataset.abrir; S.detalhe = null; render(); }
  });
  $("#lotes").addEventListener("keydown", (ev) => { const ab = ev.target.closest && ev.target.matches("[data-abrir]") && ev.target; if (ab && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); ab.click(); } });
  $("#conferencia").addEventListener("click", (ev) => { if (ev.target.closest("[data-sem-inc]")) { S.verSemInc = !S.verSemInc; render(); } });
  $("#fonte").addEventListener("click", (ev) => {
    const a = ev.target.closest("[data-fonte]"); if (!a) return;
    if (a.dataset.fonte === "autorizar" || a.dataset.fonte === "atualizar") atualizar(true, true);
    if (a.dataset.fonte === "selecionar") selecionarArquivo();
    if (a.dataset.fonte === "manual") $("#arquivo-manual").click();
  });
  $("#arquivo-manual").addEventListener("change", (ev) => { const f = ev.target.files && ev.target.files[0]; if (f) abrirManual(f); ev.target.value = ""; });
  $("#polo").addEventListener("change", (ev) => { S.f.polo = ev.target.value; S.f.municipio = S.f.bairro = S.f.alimentador = S.f.circuito = ""; S.aberto = null; gravar(localStorage, K_POLO, S.f.polo); render(); });
  for (const [id, campo] of [["#f-municipio", "municipio"], ["#f-bairro", "bairro"], ["#f-alimentador", "alimentador"], ["#f-circuito", "circuito"], ["#f-prioridade", "prioridade"]])
    $(id).addEventListener("change", (ev) => { S.f[campo] = ev.target.value; if (campo === "municipio") S.f.bairro = ""; S.aberto = null; render(); });
  let tmBusca; $("#f-busca").addEventListener("input", (ev) => { clearTimeout(tmBusca); tmBusca = setTimeout(() => { S.f.busca = ev.target.value.trim(); render(); }, 200); });
  $("#f-limpar").addEventListener("click", () => { Object.assign(S.f, { municipio: "", bairro: "", alimentador: "", circuito: "", prioridade: "", busca: "" }); $("#f-busca").value = ""; render(); });
  $("#btn-atualizar").addEventListener("click", () => (S.estado === "manual" ? $("#arquivo-manual").click() : atualizar(true, true)));
  $("#btn-central").addEventListener("click", (ev) => { ev.preventDefault(); location.href = "index.html" + location.search; });
  $("#sel-limpar").addEventListener("click", () => { S.sel.clear(); salvarSel(); render(); });
  $("#sel-copiar").addEventListener("click", () => copiar([...S.sel], "selecionadas"));
  $("#sel-itens").addEventListener("click", (ev) => { const b = ev.target.closest("[data-tirar]"); if (b) { S.sel.delete(b.dataset.tirar); salvarSel(); render(); } });
  // conferência periódica (só data/tamanho; relê só se mudou) e ao voltar para a aba
  setInterval(() => { if (document.visibilityState === "visible" && S.con && S.estado !== "manual" && !S.lendo) atualizar(false, false); }, CFG.verificarACadaSeg * 1000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && S.con && S.estado === "ok") atualizar(false, false); });
  setInterval(() => { if (S.dados) renderDados(); }, 30000); // idade do arquivo no selo

  window.DespachoUI = { estado: () => S, atualizar, render, M };
  render();
  atualizar(true, false);
})();
