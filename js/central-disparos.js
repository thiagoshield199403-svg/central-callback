/* Central de Disparos — interface das três opções. Usa o Servico e as regras existentes; não tem estado próprio além dos
   filtros, da seleção e do retorno de foco. Todo texto é inserido com esc() (sem HTML vindo do CSV).
   Envio em lote: atendimento guiado pelo WhatsApp Web. O operador envia; a Central só apresenta o próximo quando ele volta. */
"use strict";
(function () {
  const N = window.Nucleo, D = window.Disparos, $ = (s) => document.querySelector(s);
  const UI = () => window.CentralUI, srv = () => UI().servico, esc = (v) => UI().esc(v), toast = (m, e) => UI().toastErro(m, !!e);
  const MODOS = { individual: ["1", "Envio individual", "Abra um incidente na lista e envie pelo WhatsApp Web, como sempre."],
    lote: ["2", "Envio em lote", "Selecione os incidentes e atenda um a um pelo WhatsApp Web. Ao voltar para a Central, o próximo aparece sozinho."],
    manual: ["3", "CALLBACK MANUAL", "Acesse a ferramenta para informar manualmente o incidente, telefone e escolher a mensagem que deseja enviar."] };
  /* "selecao" fica só para exibir filas antigas. */
  const MODALIDADE = { selecao: "Seleção manual", lote: "Envio em lote" };
  const SITUACAO = { revisao: "Em revisão", autorizada: "Em execução", atendimento: "Em atendimento", pausada: "Pausada", concluida: "Concluída", cancelada: "Cancelada" };
  const JANELA_WA = "central_whatsapp_web"; // a mesma aba é reaproveitada a cada incidente
  let modo = "individual", filaVista = null, vista = "", retorno = null, timerRetorno = null, recuperou = false, cartaoVisto = null;
  const selecao = new Set(), filtros = { busca: "", ocorrencia: "", envio: "" };
  const horaBR = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR") : "—");
  const etiqueta = (s, extra = "") => `<span class="etq st-${s}">${esc(D.STATUS[s] || s)}${extra}</span>`;
  const fecharModal = () => { $("#modal").classList.add("oculto"); $("#modal-caixa").className = "modal-caixa"; };
  const conteudo = (h) => { $("#disparos-conteudo").innerHTML = h; };

  function abas() {
    $("#disparos-abas").innerHTML = Object.entries(MODOS).map(([k, [n, t, d]]) => `<button type="button" class="modo-card${k === modo ? " ativo" : ""}" data-modo="${k}" aria-pressed="${k === modo}">
      <span class="modo-num">${n}</span><span class="modo-txt"><b>${esc(t)}</b><span class="mini">${esc(d)}</span></span></button>`).join("");
  }

  /* ------------------------------------------------------------ desenho geral */
  function atualizar() {
    const s = srv(); if (!s || !s.E) return;
    const lote = s.loteAberto(), sec = $("#central-disparos");
    sec.classList.toggle("oculto", !lote);
    if (!lote) { $("#lote").classList.remove("disparo-oculto"); filaVista = null; selecao.clear(); vista = ""; retorno = null; return; }
    if (recuperarRetorno(s)) return;
    abas();
    $("#lote").classList.toggle("disparo-oculto", modo !== "individual");
    const ativa = s.filaAtiva(), fila = ativa || (filaVista && s.fila(filaVista));
    const alvo = modo === "individual" ? "individual" : !fila ? "selecao" : !fila.assistido ? "antiga" : ativa ? "atendimento" : "conclusao";
    if (alvo === "selecao" && vista === "selecao") { desenharLinhasSelecao(); $("#ds-confirmacoes").innerHTML = htmlConfirmacoes(); }
    else if (alvo === "individual") desenharIndividual(ativa);
    else if (alvo === "selecao") desenharSelecao();
    else if (alvo === "atendimento") desenharAtendimento(fila);
    else if (alvo === "conclusao") desenharConclusao(fila);
    else desenharFilaAntiga(fila);
    vista = alvo;
  }
  function desenharIndividual(ativa) {
    conteudo(`<p class="ajuda sem-margem">Clique em um incidente na lista abaixo. A mensagem é preparada conforme a ocorrência e o WhatsApp Web abre para você conferir e enviar.</p>
      ${ativa ? `<p class="faixa-conector producao">Há um atendimento em lote ${esc((SITUACAO[ativa.situacao] || "").toLowerCase())}. <button type="button" class="link-botao" data-acao="ver-fila">Voltar ao atendimento</button></p>` : ""}`);
  }
  /* Fila preparada na versão anterior (revisão/API): só pode ser encerrada. Nada mais é enviado por ela. */
  function desenharFilaAntiga(f) {
    conteudo(`<p class="faixa-conector indisponivel">Existe uma fila da versão anterior neste lote (${esc((SITUACAO[f.situacao] || "").toLowerCase())}). Encerre-a para iniciar o atendimento guiado. O que já foi registrado continua no histórico.</p>
      <div class="botoes"><button type="button" class="perigo" data-acao="encerrar-antiga">Encerrar fila antiga</button></div>`);
  }

  /* ------------------------------------------------------------ seleção dos incidentes */
  function casa(x) {
    const b = N.normalizarTexto(filtros.busca);
    if (filtros.ocorrencia && x.ocorrencia !== filtros.ocorrencia) return false;
    if (filtros.envio && x.status !== filtros.envio) return false;
    const digitos = filtros.busca.replace(/\D/g, "");
    return !b || [x.incidente, x.protocolo, x.call_id, x.ocorrencia, x.motivo_adms, x.submotivos, x.nome].some((t) => N.normalizarTexto(t || "").includes(b)) || (digitos.length >= 3 && (x.telefone || "").includes(digitos));
  }
  function desenharSelecao() {
    const lista = srv().incidentesParaDisparo();
    for (const k of [...selecao]) if (!lista.some((x) => x.chave === k && x.elegivel)) selecao.delete(k);
    conteudo(`<div id="ds-confirmacoes">${htmlConfirmacoes()}</div><div class="barra-selecao">
        <input id="ds-busca" type="search" placeholder="Buscar número, protocolo, ocorrência ou contato" aria-label="Buscar incidentes" value="${esc(filtros.busca)}">
        <select id="ds-ocorrencia" aria-label="Filtrar por ocorrência"><option value="">Todas as ocorrências</option>${[...new Set(lista.map((x) => x.ocorrencia))].sort().map((o) => `<option${o === filtros.ocorrencia ? " selected" : ""}>${esc(o)}</option>`).join("")}</select>
        <select id="ds-envio" aria-label="Filtrar por status do envio"><option value="">Todos os status</option>${Object.entries(D.STATUS).map(([k, v]) => `<option value="${k}"${k === filtros.envio ? " selected" : ""}>${v}</option>`).join("")}</select>
        <button type="button" class="contorno" data-acao="marcar-todos">Selecionar todos</button><button type="button" class="contorno" data-acao="desmarcar-todos">Desmarcar todos</button>
      </div>
      <div class="tabela-rolagem tabela-disparos"><table><thead><tr><th class="c-check"><input type="checkbox" id="ds-todos" aria-label="Selecionar todos os incidentes visíveis"></th><th>Incidente</th><th>Ocorrência</th><th>Contato</th><th>Telefone</th><th>Envio</th></tr></thead><tbody id="ds-linhas"></tbody></table></div>
      <div class="rodape-acao"><span id="ds-contagem" class="contagem"></span><button type="button" class="principal" id="ds-iniciar" data-acao="iniciar">INICIAR ATENDIMENTO</button></div>`);
    desenharLinhasSelecao();
    $("#ds-busca").oninput = (ev) => { filtros.busca = ev.target.value; desenharLinhasSelecao(); };
    $("#ds-ocorrencia").onchange = (ev) => { filtros.ocorrencia = ev.target.value; desenharLinhasSelecao(); };
    $("#ds-envio").onchange = (ev) => { filtros.envio = ev.target.value; desenharLinhasSelecao(); };
  }
  function desenharLinhasSelecao() {
    const lista = srv().incidentesParaDisparo().filter(casa);
    $("#ds-linhas").innerHTML = lista.map((x) => `<tr data-chave="${esc(x.chave)}" class="${selecao.has(x.chave) ? "selecionada" : ""}${x.elegivel ? "" : " inelegivel"}${x.atendido ? " linha-callback" : ""}${x.risco >= 1 ? " linha-risco" : ""}" ${x.elegivel ? "" : `title="${esc(x.motivo_inelegivel)}"`}>
      <td class="c-check"><input type="checkbox" aria-label="Selecionar ${esc(x.incidente || x.call_id)}" ${selecao.has(x.chave) ? "checked" : ""} ${x.elegivel ? "" : "disabled"}></td>
      <td><b>${esc(x.incidente || "sem incidente")}</b>${x.qtd > 1 ? ` <span class="chip chip-qtd" title="A mensagem vai para a comunicação principal do incidente">${x.qtd} com.</span>` : ""}<div class="mini">${esc(x.call_id)}</div></td>
      <td>${esc(x.ocorrencia)}${x.risco >= 1 ? ' <span class="chip chip-risco" title="Indicação de risco">⚠</span>' : ""}</td><td>${esc(x.nome || "—")}</td>
      <td>${x.telefone ? esc(N.formatarTelefone(x.telefone)) : "—"}${x.tem_celular ? "" : ' <span class="etq e-contato_invalido">sem celular</span>'}</td>
      <td>${x.elegivel ? etiqueta(x.status) : `${x.atendido ? '<span class="etq e-callback_realizado">Callback realizado</span>' : etiqueta(x.status)} <span class="mini">${esc(x.motivo_inelegivel)}</span>`}${x.atendido ? ` <button type="button" class="link-botao" data-hist="${esc(x.chave)}">histórico</button>` : ""}</td></tr>`).join("")
      || `<tr><td colspan="6" class="mini">Nenhum incidente neste filtro.</td></tr>`;
    contarSelecao(lista);
  }
  function contarSelecao(lista = srv().incidentesParaDisparo().filter(casa)) {
    const el = lista.filter((x) => x.elegivel), marcados = el.filter((x) => selecao.has(x.chave)).length, t = $("#ds-todos");
    if (t) { t.checked = !!el.length && marcados === el.length; t.indeterminate = marcados > 0 && marcados < el.length; }
    $("#ds-contagem").innerHTML = `<b>${selecao.size}</b> incidente(s) selecionado(s) · ${lista.length} na lista`;
    $("#ds-iniciar").disabled = !selecao.size;
  }

  /* ------------------------------------------------------------ atendimento guiado */
  function htmlConfirmacoes() {
    const l = srv().pendentesConfirmacao(); if (!l.length) return "";
    return `<section class="atend-confirmar" aria-label="Envios a confirmar"><h3 class="sem-margem">ENVIO NÃO CONFIRMADO (${l.length})</h3><p class="mini">O WhatsApp Web não informa se a mensagem saiu. Só "Enviei" conta como callback.</p>
      <div class="tabela-rolagem rolagem-curta"><table><tbody>${l.map(({ fila, item: i }) => `<tr data-confirma-fila="${esc(fila)}" data-confirma-item="${esc(i.id)}"><td><b>${esc(i.incidente || i.call_id)}</b></td><td>${esc(i.ocorrencia)}</td><td>${i.telefone ? esc(N.formatarTelefone(i.telefone)) : "—"}</td><td class="c-acao-fila"><button type="button" class="mini-botao verde" data-confirmar="enviado">Enviei</button> <button type="button" class="mini-botao" data-confirmar="falha">Não enviei</button></td></tr>`).join("")}</tbody></table></div></section>`;
  }
  const htmlPulados = (f) => { const l = f.itens.filter((i) => i.status === "pulado"); return l.length ? `<p class="mini atend-pulados"><b>Pulados:</b> ${l.map((i) => esc(i.incidente || i.call_id)).join(", ")}</p>` : ""; };
  function htmlProgresso(f) {
    const p = srv().painelAtendimento(f), c = (v, r, cl = "") => `<div class="metrica ${cl}"><div class="valor">${v}</div><div class="rotulo">${r}</div></div>`;
    return `<div class="metricas painel-disparo">${c(p.total, "na fila")}${c(p.atendidos, "atendidos", "destaque")}${c(p.restantes, "restantes", p.restantes ? "andamento" : "")}${c(p.pulados, "pulados")}${c(p.nao_confirmados, "não confirmados")}${c(p.percentual + "%", "concluído")}</div>
      <progress class="progresso" max="100" value="${p.percentual}" aria-label="Percentual de conclusão">${p.percentual}%</progress>`;
  }
  function desenharAtendimento(f) {
    const i = srv().itemAtual(f), pausada = f.situacao === "pausada", aberto = i && i.status === "aberto", pronto = i && (i.status === "preparado" || aberto), p = srv().painelAtendimento(f);
    const ruim = i && i.pendencias.some((x) => x.codigo === "telefone"), conf = i && i.pendencias.some((x) => x.codigo === "confirmar");
    const faixa = pausada ? '<div class="atend-aviso pausa">Atendimento pausado. O progresso está guardado.</div>'
      : aberto ? '<div class="atend-aviso">WhatsApp aberto. Confira, envie e volte para esta janela: o próximo incidente aparece sozinho.</div>' : "";
    conteudo(`<div class="cabeca-revisao"><div><h3 class="sem-margem">Atendimento em lote <span class="etq situacao-${pausada ? "pausada" : "autorizada"}">${esc(SITUACAO[f.situacao])}</span></h3><span class="mini">Incidente ${Math.min(p.total, p.total - p.restantes + 1)} de ${p.total}</span></div>
        <div class="botoes">${pausada ? '<button type="button" class="acao" data-acao="at-retomar">Retomar</button>' : '<button type="button" class="contorno" data-acao="at-pausar">Pausar</button>'}<button type="button" class="perigo" data-acao="at-cancelar">Cancelar atendimento</button></div></div>
      ${htmlProgresso(f)}${faixa}
      ${i ? `<article class="atend-card" data-item="${esc(i.id)}">
        <div class="atend-topo"><div><span class="mini">Incidente</span><h2 id="at-incidente">${esc(i.incidente || i.call_id)}</h2></div>${i.risco >= 1 ? '<span class="chip chip-risco">⚠ Indicação de risco</span>' : ""}</div>
        <div class="atend-dados"><div><span class="mini">Cliente</span><b id="at-cliente">${esc(i.destinatario || "—")}</b></div><div><span class="mini">Ocorrência</span><b>${esc(i.ocorrencia)}</b></div>
          <label class="c-tel-edit"><span class="mini">Telefone</span><input data-tel id="at-telefone" class="${ruim ? "invalido" : ""}" inputmode="tel" maxlength="20" aria-label="Telefone do cliente" value="${esc(i.telefone ? N.formatarTelefone(i.telefone) : "")}" placeholder="(DDD) 9xxxx-xxxx" ${aberto ? "disabled" : ""}>${conf ? '<span class="confirma"><input type="checkbox" data-conf> é do cliente</span>' : ""}</label></div>
        <div class="atend-mensagem" id="at-mensagem">${esc(i.texto)}</div>${i.editada ? '<span class="etq e-pendente">editada</span>' : ""}
        ${i.pendencias.map((x) => `<div class="pendencia">${esc(x.texto)}</div>`).join("")}${i.avisos.map((a) => `<div class="mini aviso-linha">${esc(a)}</div>`).join("")}
        <div class="botoes atend-acoes"><button type="button" class="principal" data-acao="at-abrir" ${pronto && !pausada ? "" : "disabled"}>${aberto ? "ABRIR WHATSAPP NOVAMENTE" : "ABRIR WHATSAPP"}</button>${aberto ? "" : '<button type="button" class="contorno" data-acao="at-editar">Editar mensagem</button>'}<button type="button" class="contorno" data-acao="at-pular" ${pausada ? "disabled" : ""}>Pular</button></div>
      </article>` : ""}
      ${htmlPulados(f)}${htmlConfirmacoes()}`);
    if (i && i.id !== cartaoVisto) { cartaoVisto = i.id; $(".atend-card").scrollIntoView({ block: "center" }); }
  }
  function desenharConclusao(f) {
    conteudo(`<div class="cabeca-revisao"><div><h3 class="sem-margem">Atendimento em lote <span class="etq situacao-${f.situacao}">${esc(SITUACAO[f.situacao])}</span></h3><span class="mini">Iniciado por ${esc(f.autorizacao.operador)} em ${horaBR(f.autorizacao.em)}</span></div>
        <div class="botoes"><button type="button" class="principal" data-acao="nova">Nova seleção</button></div></div>${htmlProgresso(f)}${htmlPulados(f)}${htmlConfirmacoes()}`);
  }
  function abrirMensagem(f, i) {
    $("#modal-caixa").className = "modal-caixa"; delete $("#modal-caixa").dataset.livre;
    $("#modal-caixa").innerHTML = `<h2>Mensagem · ${esc(i.incidente || i.call_id)}</h2><p class="mini">${esc(i.ocorrencia)} · ${esc(i.destinatario || "—")}</p>
      <textarea id="dm-texto" maxlength="${N.TEXTO_MAX}" aria-label="Texto da mensagem">${esc(i.texto)}</textarea>
      <p class="mini">A alteração vale só para este envio. O modelo original permanece intacto.</p>
      <div class="botoes fim"><button type="button" class="link-botao" id="dm-restaurar">restaurar texto do modelo</button><button type="button" class="contorno" id="dm-fechar">Fechar</button><button type="button" class="acao" id="dm-salvar">Salvar</button></div>`;
    $("#modal").classList.remove("oculto");
    $("#dm-fechar").onclick = fecharModal;
    $("#dm-restaurar").onclick = async () => { if (await exec(() => srv().restaurarMensagemItem(f.id, i.id))) fecharModal(); };
    $("#dm-salvar").onclick = async () => { if (await exec(() => srv().editarMensagemItem(f.id, i.id, $("#dm-texto").value))) fecharModal(); };
  }

  /* ------------------------------------------------------------ WhatsApp e retorno à janela */
  async function abrirWhatsapp(f, i) {
    const janela = window.open("", JANELA_WA); // no clique, para não ser bloqueado; não navega se a aba já existir
    if (!janela) { toast("O navegador bloqueou a nova janela. Permita pop-ups para a Central.", true); return; }
    try { janela.opener = null; } catch (e) { /* aba já no WhatsApp */ }
    try { janela.focus(); } catch (e) { /* o navegador decide */ }
    retorno = { fila: f.id, item: i.id, saiu: false }; // antes de gravar, para não perder a saída da janela
    const r = await exec(() => srv().abrirAtendimento(f.id, i.id));
    if (!r || r.pulado) { retorno = null; janela.close(); return; }
    janela.location.href = r.url;
    if (retorno) retorno.saiu = retorno.saiu || document.hidden || !document.hasFocus();
  }
  const marcarSaida = () => { if (retorno) retorno.saiu = true; };
  /* Foco e visibilidade disparam juntos: tudo passa por um único temporizador, e a primeira checagem válida consome o retorno. */
  function agendarRetorno() { clearTimeout(timerRetorno); timerRetorno = setTimeout(checarRetorno, 350); }
  async function checarRetorno() {
    if (!retorno || !retorno.saiu || document.hidden || !document.hasFocus()) return;
    const r = retorno; retorno = null;
    await exec(() => srv().registrarRetornoAtendimento(r.fila, r.item));
  }
  /* A página foi recarregada com um WhatsApp aberto: o operador já voltou. Nada se perde e nada conta como callback. */
  function recuperarRetorno(s) {
    if (recuperou) return false;
    recuperou = true;
    const f = s.filaAtiva(), i = f && f.assistido && s.itemAtual(f);
    if (!i || i.status !== "aberto") return false;
    exec(() => s.registrarRetornoAtendimento(f.id, i.id));
    return true;
  }
  window.addEventListener("blur", marcarSaida);
  window.addEventListener("focus", agendarRetorno);
  document.addEventListener("visibilitychange", () => { if (document.hidden) marcarSaida(); else agendarRetorno(); });

  /* ------------------------------------------------------------ histórico */
  function celulaCallback(i) {
    if (!i.callback) return "—";
    if (i.callback.situacao === "ja_registrado") return '<span class="etq e-sem_telefone" title="O callback já estava registrado: não contou de novo">Já registrado</span>';
    return `<span class="etq e-callback_realizado" title="${esc(horaBR(i.callback.em))}">Realizado</span> <span class="mini">${esc(i.callback.operador)}</span>`;
  }
  function abrirHistoricoIncidente(chave) {
    const l = srv().historicoDoIncidente(chave);
    $("#modal-caixa").className = "modal-caixa"; $("#modal-caixa").dataset.livre = "1";
    $("#modal-caixa").innerHTML = `<button type="button" class="fechar" id="dhi-fechar">Fechar</button><h2>Histórico de ${esc(chave.replace(/^(INC|CALL):/, ""))}</h2><ul class="lista">${l.map((r) => `<li><b>${esc(r.operador)}</b> · ${horaBR(r.em)} · ${r.tipo === "cancelado" ? "envio cancelado" : `callback ${esc(r.status)} (${esc(r.origem)}, ${esc(r.meio)})${r.resolvido_em ? " · resolvido" : ""}`}</li>`).join("") || '<li class="mini">Sem registros.</li>'}</ul>`;
    $("#modal").classList.remove("oculto"); $("#dhi-fechar").onclick = fecharModal;
  }
  function abrirHistorico() {
    const filas = srv().historicoDisparos();
    $("#modal-caixa").className = "modal-caixa larga"; $("#modal-caixa").dataset.livre = "1";
    $("#modal-caixa").innerHTML = `<button type="button" class="fechar" id="dh-fechar">Fechar</button><h2>Histórico de execução</h2>
      <p class="mini">Cada tentativa registra data, hora e resultado. Ao encerrar o lote, nome, telefone completo e texto são apagados; ficam o telefone mascarado e o hash da mensagem.</p>
      <div class="botoes"><button type="button" class="contorno" id="dh-csv" ${filas.length ? "" : "disabled"}>Exportar auditoria (CSV)</button></div>
      ${filas.map((f) => { const p = srv().painelDisparo(f); return `<details class="fila-historico"><summary><b>${horaBR(f.criada_em)}</b> · ${esc(MODALIDADE[f.modo])} · lote ${f.lote_numero} · ${esc(SITUACAO[f.situacao])}${f.autorizacao && f.autorizacao.conector_modo === "simulacao" ? " · simulação" : ""} · ${p.total_enviado}/${p.total_selecionado} enviadas · ${p.total_falha} falha(s)</summary>
        <div class="tabela-rolagem rolagem-curta"><table><thead><tr><th>Incidente</th><th>Telefone</th><th>Envio</th><th>Callback</th><th>Tentativas</th></tr></thead><tbody>${f.itens.map((i) => `<tr><td>${esc(i.incidente || i.call_id)}</td><td>${esc(i.telefone_mascara || "—")}</td><td>${etiqueta(i.status)}</td><td>${celulaCallback(i)}</td>
          <td class="mini">${i.tentativas.map((t) => `#${t.n} ${horaBR(t.inicio)} → ${esc(t.resultado || "em andamento")}${t.codigo ? ` (${esc(t.codigo)})` : ""}${t.wamid ? ` · ${esc(t.wamid)}` : ""}`).join("<br>") || esc(i.erro || "—")}</td></tr>`).join("")}</tbody></table></div>
        <ul class="lista mini">${f.eventos.map((e) => `<li>${horaBR(e.em)} · ${esc(e.tipo)}${e.incidente ? ` · ${esc(e.incidente)}` : ""}${e.detalhe ? ` · ${esc(e.detalhe)}` : ""}</li>`).join("")}</ul></details>`; }).join("") || '<p class="mini">Nenhuma fila registrada neste navegador.</p>'}`;
    $("#modal").classList.remove("oculto");
    $("#dh-fechar").onclick = fecharModal;
    $("#dh-csv").onclick = () => {
      const url = URL.createObjectURL(new Blob([srv().csvAuditoriaDisparos()], { type: "text/csv;charset=utf-8" })), a = document.createElement("a");
      a.href = url; a.download = `AUDITORIA_DISPAROS_${N.hojeLocal()}.csv`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
    };
  }

  /* ------------------------------------------------------------ ações */
  async function exec(f, msg) {
    try { const r = await f(); UI().avisar(); atualizar(); if (msg) toast(msg); return r === undefined ? true : r; }
    catch (e) { toast(e.message, true); if (e instanceof Armazenamento.ErroConcorrencia) atualizar(); return null; }
  }
  $("#disparos-abas").addEventListener("click", (ev) => { const b = ev.target.closest("[data-modo]"); if (!b) return; if (b.dataset.modo === "manual") { window.CentralManual.abrir(); return; } modo = b.dataset.modo; vista = ""; atualizar(); });
  $("#btn-historico-disparos").onclick = abrirHistorico;
  const areaC = $("#disparos-conteudo");
  areaC.addEventListener("click", async (ev) => {
    const s = srv(), f = s.filaAtiva() || (filaVista && s.fila(filaVista)), acao = ev.target.closest("[data-acao]");
    const hist = ev.target.closest("[data-hist]"); if (hist) { abrirHistoricoIncidente(hist.dataset.hist); return; }
    const conf = ev.target.closest("[data-confirmar]");
    if (conf) { const tr = conf.closest("tr"); if (await exec(() => s.confirmarEnvioAtendimento(tr.dataset.confirmaFila, tr.dataset.confirmaItem, conf.dataset.confirmar), conf.dataset.confirmar === "enviado" ? "Envio confirmado: callback registrado." : "Registrado como não enviado.")) UI().recarregar(); return; }
    if (acao) {
      const a = acao.dataset.acao, i = f && f.assistido ? s.itemAtual(f) : null;
      if (a === "ver-fila") { modo = "lote"; vista = ""; atualizar(); }
      else if (a === "marcar-todos") { s.incidentesParaDisparo().filter(casa).filter((x) => x.elegivel).forEach((x) => selecao.add(x.chave)); desenharLinhasSelecao(); }
      else if (a === "desmarcar-todos") { selecao.clear(); desenharLinhasSelecao(); }
      else if (a === "iniciar") { const n = await exec(() => s.iniciarAtendimento([...selecao]), "Atendimento iniciado."); if (n) { filaVista = n.id; selecao.clear(); vista = ""; atualizar(); } }
      else if (a === "at-abrir" && i) abrirWhatsapp(f, i);
      else if (a === "at-editar" && i) abrirMensagem(f, i);
      else if (a === "at-pular" && i) { retorno = null; exec(() => s.pularAtendimento(f.id, i.id)); }
      else if (a === "at-pausar") { retorno = null; exec(() => s.pausarAtendimento(f.id), "Atendimento pausado."); }
      else if (a === "at-retomar") exec(() => s.retomarAtendimento(f.id));
      else if (a === "at-cancelar") { if (await UI().confirmar("Cancelar atendimento", "<p>Os incidentes ainda não atendidos saem da fila. Os envios não confirmados continuam aguardando a sua confirmação.</p>", "Cancelar atendimento", "perigo")) { retorno = null; exec(() => s.cancelarAtendimento(f.id), "Atendimento cancelado."); } }
      else if (a === "encerrar-antiga") { if (await UI().confirmar("Encerrar fila antiga", "<p>As mensagens ainda não enviadas dessa fila serão canceladas.</p>", "Encerrar", "perigo")) { await exec(() => (f.situacao === "revisao" ? s.descartarFila(f.id) : s.cancelarRestante(f.id))); filaVista = null; vista = ""; atualizar(); } }
      else if (a === "nova") { filaVista = null; vista = ""; atualizar(); }
      return;
    }
    const lin = ev.target.closest("tr[data-chave]");
    if (lin && !lin.classList.contains("inelegivel") && vista === "selecao") {
      const k = lin.dataset.chave, marcar = !selecao.has(k);
      if (marcar) selecao.add(k); else selecao.delete(k);
      lin.classList.toggle("selecionada", marcar); lin.querySelector("input").checked = marcar; contarSelecao();
    }
  });
  areaC.addEventListener("change", (ev) => {
    const s = srv(), f = s.filaAtiva(), box = ev.target.closest("[data-item]");
    if (ev.target.id === "ds-todos") { const lista = s.incidentesParaDisparo().filter(casa).filter((x) => x.elegivel); lista.forEach((x) => (ev.target.checked ? selecao.add(x.chave) : selecao.delete(x.chave))); desenharLinhasSelecao(); return; }
    if (!box || !f) return;
    const id = box.dataset.item;
    if (ev.target.matches("[data-conf]")) exec(() => s.confirmarTelefoneItem(f.id, id, ev.target.checked));
    else if (ev.target.matches("[data-tel]")) exec(() => s.corrigirTelefoneItem(f.id, id, ev.target.value), "Telefone corrigido.").then((r) => { if (!r) atualizar(); });
  });

  window.CentralDisparos = { atualizar };
})();
