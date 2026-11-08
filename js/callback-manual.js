/* Aba CALLBACK WHATSAPP: callback manual, independente do lote. O operador vem do turno aberto; não há campo de operador. */
"use strict";
(function () {
  const N = window.Nucleo, $ = (s) => document.querySelector(s);
  const UI = () => window.CentralUI, srv = () => UI().servico, esc = (v) => UI().esc(v), toast = (m, e) => UI().toastErro(m, !!e);
  const filtros = { incidente: "", operador: "", de: "", ate: "", status: "" };
  let aberta = false, modelosProntos = false;
  const horaBR = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR") : "—");
  const ENVIO = { pendente: ["Pendente", "e-pendente"], enviado: ["Enviado", "e-callback_realizado"], falha: ["Falha", "e-contato_invalido"] };
  const RESOL = { aguardando: ["Aguardando resolução", "e-sem_telefone"], resolvido: ["Resolvido", "e-resolvida"] };
  const etq = ([t, c]) => `<span class="etq ${c}">${t}</span>`;
  const modo = () => (document.querySelector('input[name="cm_modo"]:checked') || {}).value || "padronizada";

  function alternar(valor) {
    aberta = valor;
    document.querySelector("main").classList.toggle("aba-manual", aberta);
    $("#callback-manual").classList.toggle("oculto", !aberta);
    $("#btn-manual").textContent = aberta ? "Voltar à Central" : "Callback WhatsApp";
    if (aberta) atualizar();
  }
  function preencherModelos() {
    if (modelosProntos) return;
    $("#cm-modelo").innerHTML = '<option value="">Selecione o tipo de ocorrência</option>' + N.catalogoAgrupado().map((g) => `<optgroup label="${esc(g.grupo.toUpperCase())}">${g.modelos.map((m) => `<option value="${esc(m.codigo)}">${esc(m.nome)}</option>`).join("")}</optgroup>`).join("");
    modelosProntos = true;
  }
  function previa() {
    const ehP = modo() === "personalizada";
    $("#cm-bloco-padrao").classList.toggle("oculto", ehP); $("#cm-bloco-livre").classList.toggle("oculto", !ehP);
    let t = "";
    try { if (ehP ? $("#cm-texto").value.trim() : $("#cm-modelo").value) t = srv().textoManual({ incidente: $("#cm-incidente").value, modo: modo(), modelo: $("#cm-modelo").value, texto: $("#cm-texto").value }); } catch (e) { t = ""; }
    const b = $("#cm-previa-texto"); b.textContent = t || "A mensagem aparece aqui conforme você preenche os campos.";
    b.classList.toggle("vazia", !t);
  }
  function atualizar() {
    const s = srv(); if (!s || !s.E) return;
    if (!aberta) return;
    preencherModelos();
    const sess = s.sessao();
    $("#cm-operador").textContent = sess ? `Operador: ${sess.operador} · ${sess.polo}` : "Abra o turno para enviar";
    $("#cm-enviar").disabled = !sess;
    const ops = s.operadoresManuais(), sel = $("#cm-f-operador"), atual = sel.value;
    sel.innerHTML = '<option value="">Todos os operadores</option>' + ops.map((o) => `<option${o === atual ? " selected" : ""}>${esc(o)}</option>`).join("");
    const lista = s.historicoManual(filtros), ind = s.indicadoresManuais(s.historicoManual(filtros, { incluirOcultos: true }));
    const ocultos = s.E.callbacks_manuais.filter((i) => i.excluido_em).length, ult = s.E.auditoria_manual[s.E.auditoria_manual.length - 1];
    $("#cm-excluir").disabled = !sess || !lista.some((i) => i.status_envio !== "pendente");
    $("#cm-ocultos").textContent = ocultos ? `${ocultos} registro(s) fora desta lista, mantidos para auditoria e nos indicadores. Última exclusão: ${ult.operador} em ${horaBR(ult.em)} (${ult.quantidade}).` : "";
    const c = (v, r, cl = "") => `<div class="metrica ${cl}"><div class="valor">${v}</div><div class="rotulo">${r}</div></div>`;
    $("#cm-indicadores").innerHTML = c(ind.enviadas, "mensagens enviadas", "destaque") + c(ind.resolvidos, "incidentes resolvidos", "resultado") + c(ind.pendentes_resolucao, "pendentes de resolução") + c(ind.falhas, "falhas", ind.falhas ? "falha" : "");
    $("#cm-linhas").innerHTML = lista.map((i) => `<tr data-id="${esc(i.id)}"><td><b>${esc(i.incidente)}</b></td><td>${esc(N.formatarTelefone(i.telefone))}</td><td>${esc(i.operador)}</td><td class="data-hora">${horaBR(i.criado_em)}</td><td>${esc(i.tipo_mensagem)}</td>
      <td>${etq(ENVIO[i.status_envio])}${i.callback === "ja_registrado" ? ' <span class="mini" title="O incidente já tinha callback: não contou de novo">já contado</span>' : ""}</td><td>${etq(RESOL[i.status_resolucao])}</td>
      <td class="c-acao-fila">${i.status_envio === "pendente" ? '<button type="button" class="mini-botao verde" data-confirma="enviado">Enviei</button> <button type="button" class="mini-botao" data-confirma="falha">Falhou</button>'
        : i.status_envio === "enviado" ? (i.status_resolucao === "aguardando" ? '<button type="button" class="mini-botao verde" data-resolve="1">Marcar resolvido</button>' : '<button type="button" class="link-botao" data-resolve="0">desfazer</button>') : ""}</td></tr>`).join("")
      || '<tr><td colspan="8" class="mini">Nenhum atendimento neste filtro.</td></tr>';
  }
  async function exec(f, msg) { try { const r = await f(); UI().avisar(); UI().recarregar(); if (msg) toast(msg); return r; } catch (e) { toast(e.message, true); return null; } }
  async function enviar() {
    const janela = window.open("about:blank", "_blank"); // abre no clique (evita bloqueio de pop-up)
    try {
      const r = await srv().abrirCallbackManual({ incidente: $("#cm-incidente").value, telefone: $("#cm-telefone").value, modo: modo(), modelo: $("#cm-modelo").value, texto: $("#cm-texto").value });
      if (janela) { janela.opener = null; janela.location.href = r.url; } else toast("O navegador bloqueou a nova janela. Permita pop-ups para a Central.", true);
      toast(`WhatsApp Web aberto para ${r.exibir}. Depois de enviar, clique em "Enviei" no histórico.`);
      $("#cm-incidente").value = ""; $("#cm-telefone").value = ""; $("#cm-texto").value = ""; $("#cm-modelo").selectedIndex = 0;
      UI().avisar(); UI().recarregar(); previa();
    } catch (e) { if (janela) janela.close(); toast(e.message, true); }
  }
  /* Exclusão visual: a lista muda, os callbacks contados e a auditoria não. O texto é digitado para impedir exclusão por clique acidental. */
  function pedirExclusao() {
    const lista = srv().historicoManual(filtros), alvo = lista.filter((i) => i.status_envio !== "pendente"), pendentes = lista.length - alvo.length;
    const fechar = () => { $("#modal").classList.add("oculto"); $("#modal-caixa").className = "modal-caixa"; };
    $("#modal-caixa").className = "modal-caixa"; delete $("#modal-caixa").dataset.livre;
    $("#modal-caixa").innerHTML = `<h2>Excluir histórico</h2><p><b>${alvo.length}</b> registro(s) sairão desta lista.${pendentes ? ` <b>${pendentes}</b> com envio pendente permanecerão, para você confirmar o envio.` : ""}</p>
      <ul class="lista mini"><li>Callbacks contados, indicadores, fechamentos diários e BI <b>não mudam</b>.</li><li>Os registros continuam guardados neste computador para auditoria; a exclusão fica registrada com o seu operador.</li><li>Registros excluídos não poderão mais ser marcados como resolvidos nesta tela.</li></ul>
      <label>Para confirmar, digite EXCLUIR <input id="cm-ex-palavra" maxlength="10" autocomplete="off"></label>
      <div class="botoes fim"><button type="button" class="contorno" id="cm-ex-cancelar">Cancelar</button><button type="button" class="perigo" id="cm-ex-confirmar" disabled>Excluir ${alvo.length} registro(s)</button></div>`;
    $("#modal").classList.remove("oculto");
    $("#cm-ex-cancelar").onclick = fechar;
    $("#cm-ex-palavra").oninput = (ev) => { $("#cm-ex-confirmar").disabled = ev.target.value !== "EXCLUIR"; };
    $("#cm-ex-confirmar").onclick = async () => { const palavra = $("#cm-ex-palavra").value; fechar(); await exec(() => srv().ocultarHistoricoManual(alvo.map((i) => i.id), palavra), "Registros retirados da lista. Indicadores preservados."); };
  }
  $("#cm-excluir").onclick = pedirExclusao;
  $("#btn-manual").onclick = () => alternar(!aberta);
  document.querySelectorAll('input[name="cm_modo"]').forEach((r) => { r.onchange = previa; });
  for (const id of ["#cm-modelo", "#cm-texto", "#cm-incidente"]) $(id).addEventListener("input", previa);
  $("#cm-enviar").onclick = enviar;
  const lig = (id, k) => $(id).addEventListener("input", (ev) => { filtros[k] = ev.target.value; atualizar(); });
  lig("#cm-f-incidente", "incidente"); lig("#cm-f-operador", "operador"); lig("#cm-f-de", "de"); lig("#cm-f-ate", "ate"); lig("#cm-f-status", "status");
  $("#cm-linhas").addEventListener("click", (ev) => {
    const tr = ev.target.closest("tr[data-id]"); if (!tr) return;
    const c = ev.target.closest("[data-confirma]"), r = ev.target.closest("[data-resolve]");
    if (c) exec(() => srv().confirmarEnvioManual(tr.dataset.id, c.dataset.confirma), c.dataset.confirma === "enviado" ? "Envio confirmado." : "Falha registrada.");
    else if (r) exec(() => srv().marcarResolucaoManual(tr.dataset.id, r.dataset.resolve === "1"), r.dataset.resolve === "1" ? "Marcado como resolvido." : "Resolução desfeita.");
  });
  previa();
  window.CentralManual = { atualizar, abrir: () => alternar(true) };
})();
