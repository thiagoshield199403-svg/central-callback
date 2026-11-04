/* Central de Callback COI — interface (aplicação web local, aberta direto pelo index.html; sem servidor).
   Todo texto vindo do CSV é inserido como TEXTO (esc), nunca como HTML. O estado fica no armazenamento local do navegador
   (IndexedDB) e sobrevive ao fechamento do navegador. A Central NUNCA envia mensagens: abre o WhatsApp Web com o texto e o
   operador confere, envia e registra o resultado. */
"use strict";
(function () {
  const N = window.Nucleo;
  const $ = (s) => document.querySelector(s);
  const ESTADOS = { pendente: "Pendente", callback_realizado: "Callback realizado", contato_invalido: "Contato inválido", sem_telefone: "Sem telefone" };
  const MEIOS = { whatsapp: "WhatsApp", ligacao: "Ligação", outro: "Outro" };
  const params = new URLSearchParams(location.search);
  /* CÓPIA DE DESENVOLVIMENTO: usa um banco SEPARADO ("-dev"), para não tocar nos dados da versão em uso
     ("central-callback-coi"). Na promoção autorizada, trocar BANCO_BASE para "central-callback-coi" e EM_DESENVOLVIMENTO para false. */
  const BANCO_BASE = "central-callback-coi-dev", EM_DESENVOLVIMENTO = true;
  const NOME_BANCO = BANCO_BASE + (params.get("bd") ? "-" + params.get("bd").replace(/[^a-z0-9-]/gi, "").slice(0, 30) : "");
  let srv = null, estado = null, chamadas = [], grupos = [], selecionada = null, previaAtual = null, arquivoAtual = null, bytesAtuais = null;
  const canal = "BroadcastChannel" in window ? new BroadcastChannel(NOME_BANCO) : null;

  function esc(v) { return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function dataBR(iso) { if (!iso) return "—"; const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso); return isNaN(d) ? esc(iso) : d.toLocaleDateString("pt-BR"); }
  function horaBR(iso) { if (!iso) return "—"; const d = new Date(iso); return isNaN(d) ? esc(iso) : d.toLocaleString("pt-BR"); }
  function toast(msg, erro = false) {
    const t = $("#toast"); t.textContent = msg; t.className = "toast" + (erro ? " erro" : "");
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add("oculto"), erro ? 7000 : 3500);
  }
  window.CentralUI = { toast: (m) => toast(m) }; // usado só pela página de testes

  function confirmar(titulo, html, rotulo = "Confirmar", classe = "acao") {
    return new Promise((ok) => {
      $("#modal-caixa").innerHTML = `<h2>${esc(titulo)}</h2><div>${html}</div>
        <div class="botoes fim"><button id="m-nao" class="contorno">Cancelar</button>
        <button id="m-sim" class="${classe}">${esc(rotulo)}</button></div>`;
      $("#modal").classList.remove("oculto");
      const fim = (v) => { $("#modal").classList.add("oculto"); ok(v); };
      $("#m-nao").onclick = () => fim(false); $("#m-sim").onclick = () => fim(true);
    });
  }
  async function executar(f, sucesso) {
    try { const r = await f(); if (sucesso) toast(typeof sucesso === "function" ? sucesso(r) : sucesso); return r; }
    catch (e) { toast(e.message, true); if (e instanceof Armazenamento.ErroConcorrencia) await carregar(); return undefined; }
  }

  /* ------------------------------------------------------------ estado geral */
  async function carregar() {
    estado = srv.estado();
    const s = estado.sessao;
    $("#dia-info").textContent = s ? `Dia ${dataBR(s.data_operacional)} · Polo ${s.polo}${s.operador ? " · " + s.operador : ""}${s.estacao ? " · Estação " + s.estacao : ""}` : "Nenhum dia aberto";
    $("#btn-exportar").disabled = !s; $("#btn-encerrar-dia").disabled = !s;
    const av = $("#aviso"); av.textContent = estado.aviso || ""; av.classList.toggle("oculto", !estado.aviso);
    $("#abrir-dia").classList.toggle("oculto", !!s);
    if (!s) { const cfg = estado.configuracao, f = $("#form-dia"); f.polo.value ||= cfg.polo || ""; f.operador.value ||= cfg.operador || ""; }
    $("#importar").classList.toggle("oculto", !s || !!estado.lote_aberto);
    $("#lote").classList.toggle("oculto", !estado.lote_aberto);
    $("#historico").classList.toggle("oculto", !s && !estado.exportacoes.length);
    metricas(); historico();
    if (estado.lote_aberto) carregarChamadas(); else { chamadas = []; fecharPainel(); }
  }
  function avisarOutrasAbas() { if (canal) canal.postMessage("mudou"); }

  /* 1.0.2: indicadores em TEMPO REAL (lotes encerrados + lote em andamento, mesma regra do encerramento; calculados em memória,
     sem gravação extra) e indicador compacto de encerramento dos lotes. A exportação continua usando só os lotes encerrados. */
  let destaqueEncerramento = 0;
  function metricas() {
    const m = estado.metricas_tempo_real, rl = estado.resumo_lotes, a = estado.lote_em_andamento, el = $("#metricas");
    if (!m) { el.innerHTML = ""; return; }
    const pct = m.chamadas_processadas ? Math.round(100 * m.callbacks_realizados / m.chamadas_processadas) : 0;
    const card = (v, r, d = "", t = "") => `<div class="metrica ${d}"${t ? ` title="${esc(t)}"` : ""}><div class="valor">${esc(v)}</div><div class="rotulo">${esc(r)}</div></div>`;
    const u = rl.ultimo, recente = Date.now() - destaqueEncerramento < 8000;
    el.innerHTML = card(`${rl.encerrados}/${rl.importados}`, u ? `lotes encerrados · ✓ lote ${u.numero} às ${new Date(u.encerrado_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : "lotes encerrados",
        "encerramento" + (recente ? " pulso" : ""), u ? `Último encerramento: lote ${u.numero} — ${u.chamadas} chamadas, ${u.callbacks} callbacks, ${u.pendentes} pendentes` : "Nenhum lote encerrado hoje")
      + card(m.chamadas_processadas, "chamadas processadas") + card(m.callbacks_realizados, `callbacks (${pct}%)`, "destaque")
      + card(m.pendencias_contabilizadas, "pendências") + card(m.sem_telefone, "sem telefone") + card(m.contatos_invalidos, "contatos inválidos")
      + card(m.tentativas, "tentativas")
      + card(a ? `${a.callback_realizado}/${a.chamadas}` : "0", a ? "lote em andamento (callbacks/chamadas)" : "lotes em andamento", a ? "andamento" : "");
    $("#nota-metricas").textContent = m.inclui_lote_aberto
      ? "Indicadores em tempo real: incluem o lote em andamento. A exportação considera só os lotes encerrados." : "";
  }

  function historico() {
    const lotes = estado.lotes || [];
    $("#lista-lotes").innerHTML = lotes.length ? "<h3>Lotes</h3><ul class='lista'>" + lotes.map((l) =>
      `<li>Lote ${l.numero} · ${esc(l.arquivo_nome)} · ${l.situacao === "aberto" ? "<b>aberto</b>" : "encerrado " + horaBR(l.encerrado_em)}
       ${l.metricas ? ` · ${l.metricas.chamadas} chamadas, ${l.metricas.callback_realizado} callbacks, ${l.metricas.pendente} pendentes` : ""}</li>`).join("") + "</ul>" : "";
    const ex = estado.exportacoes || [];
    $("#lista-exportacoes").innerHTML = (ex.length ? "<h3>Exportações</h3><ul class='lista'>" + ex.map((e) =>
      `<li>v${e.versao}${e.definitiva ? " (definitiva)" : ""} · dia ${dataBR(e.data_operacional)} · ${horaBR(e.exportado_em)} ·
        <button class="contorno mini-botao" data-baixar="${esc(e.id)}">baixar de novo</button>
       <div class="mini">${esc(e.nome)} · ${e.salvo ? "salvo: " + esc(e.salvo.onde) : "<b>ainda não salvo</b>"}</div></li>`).join("") + "</ul>" : "")
      + `<p class="mini">Os arquivos de indicadores são salvos na pasta de downloads do navegador (ou na pasta escolhida em Configuração).
         Coloque-os na pasta do SharePoint CENTRAL_CALLBACK/INDICADORES.${estado.configuracao.url_sharepoint ? ` <a href="${esc(estado.configuracao.url_sharepoint)}" target="_blank" rel="noopener">Abrir a biblioteca do SharePoint</a>` : ""}</p>`;
    document.querySelectorAll("[data-baixar]").forEach((b) => b.onclick = () => salvarArquivo(srv.exportacao(b.dataset.baixar), true));
  }

  /* ------------------------------------------------------------ salvar exportação (download ou pasta escolhida) */
  async function pastaEscolhida() { return srv.arm.lerArquivo("pasta_exportacao"); }
  async function salvarArquivo(exp, novamente = false) {
    if (!exp) return;
    const pasta = await pastaEscolhida();
    if (pasta && !novamente) {
      try {
        let perm = await pasta.queryPermission({ mode: "readwrite" });
        if (perm !== "granted") perm = await pasta.requestPermission({ mode: "readwrite" });
        if (perm === "granted") {
          let existe = true;
          try { await pasta.getFileHandle(exp.nome); } catch (e) { existe = false; }
          if (existe) throw new Error(`Já existe ${exp.nome} na pasta (nada foi sobrescrito).`);
          const h = await pasta.getFileHandle(exp.nome, { create: true }), w = await h.createWritable();
          await w.write(new Blob([exp.conteudo], { type: "text/csv;charset=utf-8" })); await w.close();
          await srv.marcarSalvo(exp.id, `pasta ${pasta.name}`); avisarOutrasAbas(); carregar();
          return `salvo na pasta ${pasta.name}`;
        }
      } catch (e) { toast(`Não foi possível gravar na pasta escolhida (${e.message}). O arquivo será baixado.`, true); }
    }
    const url = URL.createObjectURL(new Blob([exp.conteudo], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = exp.nome; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    if (!exp.salvo) { await srv.marcarSalvo(exp.id, "downloads do navegador"); avisarOutrasAbas(); carregar(); }
    return "baixado para a pasta de downloads";
  }

  /* ------------------------------------------------------------ dia */
  $("#form-dia").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    if (await executar(() => srv.abrirSessao(f.polo.value, f.operador.value || null), "Dia aberto.")) { avisarOutrasAbas(); carregar(); }
  });
  $("#btn-exportar").onclick = async () => {
    const r = await executar(() => srv.exportar());
    if (!r) return;
    const onde = await salvarArquivo(srv.exportacao(r.id));
    toast(`Indicadores exportados (versão ${r.versao}): ${onde}. ${r.lote_aberto_nao_incluido ? "O lote aberto NÃO entrou: encerre-o e exporte de novo." : ""}`);
    avisarOutrasAbas(); carregar();
  };
  $("#btn-encerrar-dia").onclick = async () => {
    if (estado.lote_aberto) { toast("Encerre e limpe o lote aberto antes de encerrar o dia.", true); return; }
    const m = estado.metricas_dia;
    if (!await confirmar("Encerrar o dia", `<p>Será gerada a exportação <b>definitiva</b> do dia com ${m.chamadas_processadas} chamadas e ${m.callbacks_realizados} callbacks.
        Depois disso o dia não recebe mais lotes.</p>`, "Encerrar e exportar")) return;
    const r = await executar(() => srv.encerrarDia());
    if (!r) return;
    const onde = await salvarArquivo(srv.exportacao(r.exportacao.id));
    toast(`Dia encerrado. Arquivo ${r.exportacao.nome}: ${onde}.`);
    avisarOutrasAbas(); carregar();
  };

  /* ------------------------------------------------------------ importação */
  const lerBytes = (arquivo) => new Promise((ok, falha) => {
    const fr = new FileReader(); fr.onload = () => ok(new Uint8Array(fr.result)); fr.onerror = () => falha(new Error("Não foi possível ler o arquivo: " + (fr.error && fr.error.message))); fr.readAsArrayBuffer(arquivo);
  });
  $("#arquivo").addEventListener("change", async (ev) => {
    arquivoAtual = ev.target.files[0]; previaAtual = null; bytesAtuais = null; $("#previa").innerHTML = "";
    if (!arquivoAtual) return;
    try {
      bytesAtuais = await lerBytes(arquivoAtual);
      previaAtual = srv.previa(bytesAtuais);
      const r = previaAtual.resumo, est = r.por_estado_inicial || {};
      $("#previa").innerHTML = `<h3>Prévia</h3>
        <p><b>${r.chamadas_validas}</b> chamada(s) válida(s) de ${r.linhas_lidas} linha(s) ·
        pendentes ${est.pendente || 0} · sem telefone ${est.sem_telefone || 0} · contato inválido ${est.contato_invalido || 0}<br>
        Separador “${esc(r.separador === "\t" ? "tabulação" : r.separador)}” · ${esc(r.codificacao)} · ${r.colunas_reconhecidas} colunas reconhecidas
        ${r.linhas_antes_do_cabecalho ? `· ${r.linhas_antes_do_cabecalho} linha(s) de filtro do ADMS antes do cabeçalho (ignoradas)` : ""}
        ${r.colunas_ausentes.length ? `· <b>ausentes:</b> ${esc(r.colunas_ausentes.join(", "))}` : ""}<br>
        ${r.calls_repetidas_no_arquivo ? `${r.calls_repetidas_no_arquivo} CALL repetida(s) no arquivo (contadas uma vez) · ` : ""}
        ${r.calls_ja_vistas_hoje ? `<b>${r.calls_ja_vistas_hoje} CALL(s) já vistas hoje</b> em lote anterior (não contam de novo) · ` : ""}
        ${r.arquivo_ja_importado_hoje ? "<b>Este arquivo já foi importado hoje.</b>" : ""}</p>
        ${r.agrupamento ? `<p>Incidentes: <b>${r.agrupamento.incidentes_distintos}</b> distintos${r.agrupamento.comunicacoes_sem_incidente ? ` + ${r.agrupamento.comunicacoes_sem_incidente} comunicação(ões) sem incidente` : ""}
          · <b>${r.agrupamento.incidentes_com_multiplas_comunicacoes}</b> com múltiplas comunicações (${r.agrupamento.comunicacoes_nesses_incidentes} comunicações)
          · ${r.agrupamento.grupos_com_indicacao_de_risco} com indicação de risco · a tabela terá <b>${r.agrupamento.linhas_na_tabela}</b> linha(s).
          Todas as comunicações são mantidas (callback e métricas por CALL).</p>` : ""}
        ${previaAtual.erros.length ? `<div class="erros">${previaAtual.erros.map((e) => `Linha ${e.linha}: ${esc(e.mensagem)}`).join("<br>")}</div>` : ""}
        <div class="botoes"><button id="btn-confirmar-import" class="principal">Importar ${r.chamadas_validas} chamada(s)</button>
        <button id="btn-cancelar-import" class="contorno">Cancelar</button></div>`;
      $("#btn-cancelar-import").onclick = () => { $("#arquivo").value = ""; $("#previa").innerHTML = ""; };
      $("#btn-confirmar-import").onclick = importar;
    } catch (e) { $("#previa").innerHTML = `<p class="etq e-contato_invalido">Não foi possível ler o arquivo: ${esc(e.message)}</p>`; }
  });
  async function importar() {
    let bytes;
    try { bytes = await lerBytes(arquivoAtual); } catch (e) { toast(e.message, true); return; } // relê: confere se mudou
    const l = await executar(() => srv.importar(arquivoAtual.name, bytes, previaAtual.resumo.sha256), (x) => `Lote ${x.numero} importado.`);
    if (l) { $("#arquivo").value = ""; $("#previa").innerHTML = ""; avisarOutrasAbas(); carregar(); }
  }

  /* ------------------------------------------------------------ lote */
  function carregarChamadas() {
    chamadas = srv.chamadas(); grupos = srv.grupos();
    const l = estado.lote_aberto, a = estado.lote_em_andamento, multi = grupos.filter((g) => g.qtd > 1).length;
    $("#lote-titulo").textContent = `Lote ${l.numero} · ${l.arquivo_nome}`;
    $("#resumo-lote").textContent = `${a.chamadas} chamadas (comunicações) em ${grupos.length} linha(s)${multi ? `, ${multi} incidente(s) com múltiplas comunicações` : ""} · ${a.pendente} pendentes · ${a.callback_realizado} callbacks · ${a.contato_invalido} contatos inválidos · ${a.sem_telefone} sem telefone · ${a.tentativas} tentativas`;
    desenharTabela();
    if (selecionada) abrirChamada(selecionada);
  }
  /* 1.0.2: uma linha por incidente. Mostra a comunicação PRINCIPAL (risco > mais recente) e a quantidade de comunicações.
     Filtro e busca valem para QUALQUER comunicação do incidente. */
  /* Etiqueta da mensagem sugerida (reconhecimento por palavras-chave; o motivo fica no title). */
  function etiquetaSugestao(c) {
    const s = N.sugerirMensagem(c), m = N.modelos().find((x) => x.codigo === s.codigo);
    if (!m || s.origem === "generico") return c.tipo_ocorrencia === "risco_de_vida" ? '<span class="etq risco" title="sigla RV no ADMS">risco de vida</span>' : "";
    return `<span class="etq ${s.risco ? "risco" : "e-sem_telefone"}" title="Mensagem sugerida: ${esc(m.nome)} — ${esc(N.descreverSugestao(s))}">${esc(m.nome)}${s.origem === "texto" ? " ·txt" : ""}</span>`;
  }
  /* Ajuste final da tabela: coluna Incidente estreita. Mostra só o número, a quantidade de comunicações (etiqueta clicável que
     abre as comunicações) e o risco grave (⚠). As suspeitas (ocorrência geral / falta de fase) NÃO viram etiquetas na tabela:
     continuam calculadas pelas mesmas regras, no tooltip da quantidade e nos avisos do painel. Mudança só visual. */
  function celulaIncidente(g, c) {
    const risco = g.avisos.find((a) => a.tipo === "risco"), suspeitas = g.avisos.filter((a) => a.tipo === "possivel");
    let html = `<b>${esc(c.incidente || "—")}</b>`;
    if (g.qtd > 1) {
      const dica = [g.avisos[0].texto, ...suspeitas.map((a) => a.texto), "Clique para ver as comunicações."].join("\n");
      html += ` <a href="#" class="chip chip-qtd${suspeitas.length ? " chip-suspeita" : ""}" data-ver="${c.id}" title="${esc(dica)}">${g.qtd} com.</a>`;
    }
    if (risco) html += ` <span class="chip chip-risco" title="${esc(risco.texto + (risco.detalhe ? "\n" + risco.detalhe : ""))}">⚠</span>`;
    return html;
  }
  /* 1.0.2: uma linha por incidente com a comunicação PRINCIPAL (risco > mais recente). CALL não aparece como coluna (continua
     interno: duplicidade, histórico, auditoria e busca). Filtro e busca valem para QUALQUER comunicação do incidente. */
  function desenharTabela() {
    const f = $("#filtro-estado").value, b = $("#busca").value.trim().toUpperCase();
    const casa = (c) => (!f || c.estado === f) && (!b || [c.call_id, c.incidente, c.nome, c.localizacao].some((x) => (x || "").toUpperCase().includes(b)));
    const lista = grupos.filter((g) => g.membros.some(casa));
    const idsSel = selecionada ? (grupos.find((g) => g.membros.some((m) => m.id === selecionada)) || { membros: [] }).membros.map((m) => m.id) : [];
    $("#linhas").innerHTML = lista.map((g) => {
      const c = g.principal, tel = c.telefones.find((t) => t.numero);
      const feitos = g.membros.filter((m) => m.estado === "callback_realizado").length;
      return `<tr data-id="${c.id}" data-call="${esc(c.call_id)}" data-grupo="${esc(g.chave)}" class="${idsSel.includes(c.id) ? "selecionada" : ""}${g.risco >= 1 ? " linha-risco" : ""}">
        <td class="c-inc">${celulaIncidente(g, c)}${c.ja_vista_no_dia ? ' <span class="mini" title="Apareceu em lote anterior do dia">↺</span>' : ""}</td>
        <td class="data-hora">${esc(N.formatarDataHora(c.horario_call))}</td>
        <td class="c-motivo" title="${esc(c.motivo || "")}">${esc(c.motivo || "—")} ${etiquetaSugestao(c)}</td>
        <td class="c-cliente" title="${esc(c.nome || "")}">${esc(c.nome || "—")}</td>
        <td class="c-tel">${tel ? esc(N.formatarTelefone(tel.numero)) + (tel.requer_confirmacao ? ' <span class="mini" title="Telefone achado no comentário: confirmar antes de usar">*</span>' : "") : "—"}</td>
        <td class="c-local" title="${esc(c.localizacao || "")}">${esc(c.localizacao || "—")}</td>
        <td class="c-num">${c.tentativas.length}</td>
        <td class="c-sit"><span class="etq e-${c.estado}">${ESTADOS[c.estado]}</span>${c.whatsapp_aberto_em && c.estado === "pendente" ? ' <span class="mini" title="WhatsApp aberto">WA</span>' : ""}${g.qtd > 1 ? ` <span class="mini" title="comunicações deste incidente com callback">${feitos}/${g.qtd}</span>` : ""}</td>
        <td class="c-acoes"><button class="contorno mini-botao" data-abrir-linha="${c.id}">Abrir</button></td></tr>`;
    }).join("") || `<tr><td colspan="9" class="mini">Nenhuma chamada neste filtro.</td></tr>`;
  }
  $("#filtro-estado").onchange = desenharTabela; $("#busca").oninput = desenharTabela;
  $("#linhas").addEventListener("click", (ev) => {
    const ver = ev.target.closest("[data-ver]");
    if (ver) { ev.preventDefault(); abrirChamada(Number(ver.dataset.ver)); const t = $("#painel .comunicacoes"); if (t) t.scrollIntoView({ block: "start" }); return; }
    const tr = ev.target.closest("tr[data-id]"); if (tr) abrirChamada(Number(tr.dataset.id));
  });

  $("#btn-encerrar-lote").onclick = async () => {
    const a = estado.lote_em_andamento;
    if (!await confirmar("Encerrar e limpar o lote", `<p>As métricas deste lote serão somadas ao dia:</p>
        <p><b>${a.chamadas}</b> chamadas · <b>${a.callback_realizado}</b> callbacks · <b>${a.pendente}</b> pendências · ${a.sem_telefone} sem telefone · ${a.contato_invalido} contatos inválidos · ${a.tentativas} tentativas</p>
        <p><b>Os dados das chamadas (nomes, telefones, endereços, comentários) serão apagados</b> e não poderão ser recuperados.
        Pendências deste lote ficam contabilizadas como pendências do dia.</p>`, "Encerrar e limpar", "perigo")) return;
    const numero = estado.lote_aberto.numero;
    const r = await executar(() => srv.encerrarLote(), (x) => `✓ Lote ${numero} encerrado: ${x.metricas_lote.chamadas} chamadas, ${x.metricas_lote.callback_realizado} callbacks. Métricas preservadas; dados das chamadas apagados.`);
    if (r) { selecionada = null; destaqueEncerramento = Date.now(); avisarOutrasAbas(); carregar(); }
  };

  /* ------------------------------------------------------------ chamada */
  function fecharPainel() { $("#painel").classList.add("oculto"); selecionada = null; desenharTabela(); }
  function abrirChamada(id, modelo = null) {
    selecionada = id;
    let d;
    try { d = srv.detalhe(id, modelo); } catch (e) { toast(e.message, true); fecharPainel(); return; }
    desenharTabela();
    const p = $("#painel"); p.classList.remove("oculto");
    const feito = d.estado === "callback_realizado", sub = (N.SUBTIPOS[d.subtipo || ""] || {}).rotulo;
    p.innerHTML = `<button class="fechar" id="p-fechar">Fechar</button>
      <h2>${esc(d.incidente || "Sem incidente")} <span class="etq e-${d.estado}">${ESTADOS[d.estado]}</span></h2>
      <p class="mini">Identificador interno da comunicação: ${esc(d.call_id)}</p>
      ${d.grupo.qtd > 1 ? `<p class="mini"><b>Comunicação ${d.grupo.posicao} de ${d.grupo.qtd}</b> do ${esc(d.grupo.incidente)}${d.id === d.grupo.principal_id ? " (principal)" : ""}.</p>` : ""}
      ${d.grupo.avisos.map((a) => `<div class="aviso-grupo aviso-${a.tipo}">${esc(a.texto)}${a.detalhe ? `<div class="mini">${esc(a.detalhe)}</div>` : ""}</div>`).join("")}
      ${d.risco.nivel === 1 ? `<div class="aviso-grupo aviso-risco">Indício de risco nesta comunicação: ${esc(d.risco.origem)}</div>` : ""}
      ${d.ja_vista_no_dia ? `<p class="mini">Esta CALL apareceu em lote anterior do dia (situação: ${esc(ESTADOS[d.estado_anterior_no_dia] || "—")}). Ela conta uma vez no dia.</p>` : ""}
      <dl class="dl"><dt>Incidente</dt><dd>${esc(d.incidente || "não informado")}</dd>
        <dt>Incidente pai</dt><dd>${esc(d.incidente_pai || "—")}</dd>
        <dt>Motivo</dt><dd>${esc(d.motivo || "—")} · ${esc(d.submotivos || "")}</dd>
        <dt>Subtipo</dt><dd>${esc(sub || "não identificado")}</dd>
        <dt>Cliente</dt><dd>${esc(d.nome || "—")}</dd><dt>UC</dt><dd>${esc(d.uc || "—")}</dd>
        <dt>Localização</dt><dd>${esc(d.localizacao || "—")}</dd><dt>Comentário</dt><dd>${esc(d.comentario || "—")}</dd>
        <dt>Data e hora da comunicação</dt><dd>${esc(N.formatarDataHora(d.horario_call))} <span class="mini">(Horário da call no ADMS)</span></dd></dl>
      ${d.grupo.qtd > 1 ? `<h3>Comunicações do incidente (${d.grupo.qtd})</h3>
        <table class="comunicacoes"><thead><tr><th>Data e hora</th><th>CALL</th><th>Motivo / submotivo</th><th>Situação</th><th></th></tr></thead><tbody>
        ${d.grupo.membros.map((m, i) => `<tr class="${m.id === d.id ? "selecionada" : ""}"><td>${esc(N.formatarDataHora(m.horario_call))}</td>
          <td>${esc(m.call_id)}${i === 0 ? ' <span class="mini">principal</span>' : ""}</td>
          <td>${esc(m.motivo || "—")} · ${esc(m.submotivos || "")}${m.risco.nivel ? ` <span class="etq risco" title="${esc(m.risco.origem)}">${m.risco.nivel === 2 ? "risco" : "indício"}</span>` : ""}</td>
          <td><span class="etq e-${m.estado}">${ESTADOS[m.estado]}</span></td>
          <td>${m.id === d.id ? '<span class="mini">aberta</span>' : `<button class="contorno mini-botao" data-abrir="${m.id}">Abrir</button>`}</td></tr>`).join("")}
        </tbody></table>` : ""}
      <h3>Telefones</h3>
      ${d.telefones.length ? d.telefones.map((t) => `<div class="telefone"><div><b>${esc(N.formatarTelefone(t.numero))}</b> <span class="mini">${esc(t.tipo)}${t.requer_confirmacao ? " · achado no comentário: confirme" : ""}</span></div>
        <div>${t.tipo === "celular" && t.numero && !feito ? `<button class="acao" data-wa="${esc(t.numero)}" data-conf="${t.requer_confirmacao ? 1 : 0}">Abrir WhatsApp Web</button>` : ""}</div></div>`).join("") : '<p class="mini">Chamada sem telefone.</p>'}
      <h3>Mensagem</h3>
      <select id="p-modelo">${d.modelos_agrupados.map((g) => `<optgroup label="${esc(g.grupo)}">${g.modelos.map((m) =>
        `<option value="${esc(m.codigo)}" ${m.codigo === d.modelo ? "selected" : ""}>${esc(m.nome)}${m.prioridade ? "  ⚠ PRIORIDADE" : ""}</option>`).join("")}</optgroup>`).join("")}</select>
      <p class="mini" id="p-sugestao">${d.modelo === d.sugestao.codigo ? "✓ Sugerida automaticamente" : "Escolhida pelo operador (sugestão: " + esc((N.modelos().find((x) => x.codigo === d.sugestao.codigo) || {}).nome || "") + ")"} — ${esc(d.sugestao_texto)}</p>
      <textarea id="p-texto" readonly>${esc(d.mensagem)}</textarea>
      <div class="botoes"><button class="contorno" id="p-copiar">Copiar texto</button></div>
      <p class="mini">Abrir o WhatsApp não envia nada e não conta como callback. Envie pelo WhatsApp Web e registre o resultado abaixo.</p>
      <h3>Registrar resultado</h3>
      <div class="linha-form"><label>Meio <select id="p-meio">${Object.entries(MEIOS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>
        <label class="flex1">Observação (opcional) <input id="p-obs" maxlength="500"></label></div>
      <div class="botoes">
        <button class="principal" data-acao="callback_realizado" ${feito ? "disabled" : ""}>Callback realizado</button>
        <button class="contorno" data-acao="sem_sucesso" ${feito ? "disabled" : ""}>Tentativa sem sucesso</button>
        <button class="perigo" data-acao="contato_invalido" ${feito ? "disabled" : ""}>Contato inválido</button>
        ${d.estado !== "pendente" ? '<button class="contorno" data-acao="reabrir">Reabrir (corrigir)</button>' : ""}
      </div>
      ${d.tentativas.length ? `<h3>Tentativas</h3><ul class="lista">${d.tentativas.map((h) => `<li>${horaBR(h.momento)} · ${esc(MEIOS[h.meio] || h.meio)} · ${esc(ESTADOS[h.resultado] || (h.resultado === "sem_sucesso" ? "sem sucesso" : h.resultado))}</li>`).join("")}</ul>` : ""}`;
    $("#p-fechar").onclick = fecharPainel;
    p.querySelectorAll("[data-abrir]").forEach((b) => b.onclick = () => abrirChamada(Number(b.dataset.abrir)));
    $("#p-modelo").onchange = (ev) => abrirChamada(id, ev.target.value);
    $("#p-copiar").onclick = async () => { try { await navigator.clipboard.writeText($("#p-texto").value); toast("Texto copiado."); } catch (e) { $("#p-texto").select(); toast("Selecione e copie com Ctrl+C."); } };
    p.querySelectorAll("[data-wa]").forEach((b) => b.onclick = () => abrirWhatsapp(d, b.dataset.wa, b.dataset.conf === "1"));
    p.querySelectorAll("[data-acao]").forEach((b) => b.onclick = () => registrar(d, b.dataset.acao));
  }
  async function abrirWhatsapp(d, numero, comentario) {
    if (comentario && !await confirmar("Telefone do comentário", "<p>Este número foi achado no comentário do ADMS. Confirme que é do cliente antes de abrir o WhatsApp.</p>", "É do cliente")) return;
    const janela = window.open("about:blank", "_blank"); // abre no clique (evita bloqueio de pop-up)
    try {
      const r = await srv.abrirWhatsapp(d.id, numero, $("#p-modelo").value, comentario);
      if (janela) { janela.opener = null; janela.location.href = r.url; } else toast("O navegador bloqueou a nova janela. Permita pop-ups para a Central.", true);
      avisarOutrasAbas(); estado = srv.estado(); carregarChamadas();
    } catch (e) { if (janela) janela.close(); toast(e.message, true); }
  }
  async function registrar(d, acao) {
    const obs = $("#p-obs").value.trim();
    if (acao === "reabrir" && !obs) { toast("Explique na observação por que está reabrindo.", true); $("#p-obs").focus(); return; }
    const r = await executar(() => srv.registrar(d.id, acao, acao === "reabrir" ? null : $("#p-meio").value, obs || null),
      acao === "callback_realizado" ? "Callback registrado." : "Registro salvo.");
    if (r) { avisarOutrasAbas(); estado = srv.estado(); metricas(); carregarChamadas(); }
  }

  /* ------------------------------------------------------------ configuração */
  $("#btn-config").onclick = async () => {
    const c = estado.configuracao, pasta = await pastaEscolhida(), podePasta = "showDirectoryPicker" in window;
    $("#modal-caixa").innerHTML = `<h2>Configuração da estação</h2>
      <form id="form-cfg" class="grade">
        <label>Identificação da estação <input name="estacao" maxlength="80" value="${esc(c.estacao)}"></label>
        <label>Operador padrão <input name="operador" maxlength="80" value="${esc(c.operador)}"></label>
        <label>Polo padrão <input name="polo" maxlength="80" value="${esc(c.polo)}"></label>
        <label>Endereço da biblioteca do SharePoint (opcional) <input name="url_sharepoint" maxlength="300" value="${esc(c.url_sharepoint)}" placeholder="https://…"></label>
        <div><b>Pasta de exportação</b><br><span class="mini">${pasta ? "Escolhida: " + esc(pasta.name) : "Nenhuma: os arquivos vão para a pasta de downloads do navegador."}</span><br>
          ${podePasta ? `<button type="button" id="cfg-pasta" class="contorno">Escolher pasta (ex.: SharePoint sincronizado)</button>
          ${pasta ? '<button type="button" id="cfg-sem-pasta" class="contorno">Usar downloads</button>' : ""}` : '<span class="mini">Este navegador não permite escolher pasta; use a pasta de downloads.</span>'}</div>
        <p class="mini">Instalação: ${esc(c.instalacao_id)} · Versão ${esc(N.VERSAO)} · Dados guardados neste navegador (${esc(NOME_BANCO)}).</p>
        <div class="botoes fim"><button type="button" id="cfg-cancelar" class="contorno">Cancelar</button><button class="acao">Salvar</button></div>
      </form>`;
    $("#modal").classList.remove("oculto");
    $("#cfg-cancelar").onclick = () => $("#modal").classList.add("oculto");
    if ($("#cfg-pasta")) $("#cfg-pasta").onclick = async () => {
      try { const h = await window.showDirectoryPicker({ mode: "readwrite", id: "central-callback-indicadores" }); await srv.arm.gravarArquivo("pasta_exportacao", h); toast(`Pasta escolhida: ${h.name}`); $("#btn-config").onclick(); }
      catch (e) { if (e.name !== "AbortError") toast("Não foi possível usar a pasta: " + e.message, true); }
    };
    if ($("#cfg-sem-pasta")) $("#cfg-sem-pasta").onclick = async () => { await srv.arm.gravarArquivo("pasta_exportacao", null); toast("Exportações irão para downloads."); $("#btn-config").onclick(); };
    $("#form-cfg").onsubmit = async (ev) => {
      ev.preventDefault();
      if (await executar(() => srv.salvarConfiguracao(Object.fromEntries(new FormData(ev.target))), "Configuração salva.")) { $("#modal").classList.add("oculto"); avisarOutrasAbas(); carregar(); }
    };
  };

  /* ------------------------------------------------------------ início */
  async function iniciar() {
    try {
      const arm = await new Armazenamento(NOME_BANCO).iniciar();
      srv = await new Servico(arm).carregar();
    } catch (e) {
      document.querySelector("main").innerHTML = `<section class="cartao"><h2>A Central não pôde iniciar</h2><p>${esc(e.message)}</p>
        <p class="ajuda">Abra o arquivo index.html no Microsoft Edge ou no Google Chrome, fora de janela anônima/InPrivate.</p></section>`;
      return;
    }
    if (canal) canal.onmessage = async () => { try { await srv.carregar(); carregar(); } catch (e) { toast(e.message, true); } };
    window.addEventListener("focus", async () => { try { const rev = srv.arm.revisao; await srv.carregar(); if (srv.arm.revisao !== rev) carregar(); } catch (e) { /* mantém a tela */ } });
    window.CentralUI.servico = srv;
    carregar();
    if (EM_DESENVOLVIMENTO) {
      const faixa = document.createElement("div");
      faixa.className = "faixa-dev";
      faixa.textContent = `CÓPIA DE DESENVOLVIMENTO ${N.VERSAO} — dados separados da versão em uso (${NOME_BANCO}). Não usar na operação sem autorização.`;
      document.body.prepend(faixa);
    }
    document.body.dataset.pronto = "1";
  }
  iniciar();
})();
