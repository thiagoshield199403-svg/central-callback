/* Central de Disparos — interface das três modalidades. Usa o Servico e as regras existentes; não tem estado próprio além dos
   filtros e da seleção da tela. Todo texto é inserido com esc() (sem HTML vindo do CSV). */
"use strict";
(function () {
  const N = window.Nucleo, D = window.Disparos, $ = (s) => document.querySelector(s);
  const UI = () => window.CentralUI, srv = () => UI().servico, esc = (v) => UI().esc(v), toast = (m, e) => UI().toastErro(m, !!e);
  const conector = new D.ConectorGateway();
  const MODOS = { individual: ["1", "Envio individual", "Abra um incidente na lista e envie pelo WhatsApp Web, como sempre."],
    lote: ["2", "Envio em lote", "Prepara todos os incidentes elegíveis do lote, com uma única autorização."],
    manual: ["3", "CALLBACK MANUAL", "Acesse a ferramenta para informar manualmente o incidente, telefone e escolher a mensagem que deseja enviar."] };
  /* "selecao" fica só para exibir filas antigas: novas filas vêm do envio em lote. */
  const MODALIDADE = { selecao: "Seleção manual", lote: "Envio em lote" };
  const SITUACAO = { revisao: "Em revisão", autorizada: "Em execução", pausada: "Pausada", concluida: "Concluída", cancelada: "Cancelada" };
  let modo = "individual", status = { pronto: false, modo: "verificando" }, processando = false, filaVista = null, vista = "";
  const horaBR = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR") : "—");
  const etiqueta = (s, extra = "") => `<span class="etq st-${s}">${esc(D.STATUS[s] || s)}${extra}</span>`;
  const fecharModal = () => { $("#modal").classList.add("oculto"); $("#modal-caixa").className = "modal-caixa"; };

  /* Só redesenha se o estado mudou: a consulta se repete enquanto o gateway está indisponível e não pode apagar uma edição em andamento. */
  async function verificarConector() { const novo = await conector.status(), mudou = novo.pronto !== status.pronto || novo.modo !== status.modo; status = novo; if (mudou) atualizar(); }
  function faixaConector() {
    if (status.modo === "simulacao") return `<div class="faixa-conector simulacao"><b>MODO SIMULAÇÃO</b> — nenhuma mensagem será entregue a ninguém. Serve para treinar e conferir o fluxo.</div>`;
    if (status.modo === "producao") return `<div class="faixa-conector producao">Integração ativa: WhatsApp Business Platform · ${(status.modelos_aprovados || []).length} modelo(s) aprovado(s) mapeado(s)</div>`;
    if (status.modo === "verificando") return "";
    return `<div class="faixa-conector indisponivel"><b>Disparo indisponível.</b> ${esc(status.motivo || "")} Você pode preparar e revisar a fila normalmente.</div>`;
  }
  function abas() {
    $("#disparos-abas").innerHTML = Object.entries(MODOS).map(([k, [n, t, d]]) => `<button type="button" class="modo-card${k === modo ? " ativo" : ""}" data-modo="${k}" aria-pressed="${k === modo}">
      <span class="modo-num">${n}</span><span class="modo-txt"><b>${esc(t)}</b><span class="mini">${esc(d)}</span></span></button>`).join("");
  }

  /* ------------------------------------------------------------ desenho geral */
  function atualizar() {
    const s = srv(); if (!s || !s.E) return;
    const lote = s.loteAberto(), sec = $("#central-disparos");
    sec.classList.toggle("oculto", !lote);
    if (!lote) { $("#lote").classList.remove("disparo-oculto"); filaVista = null; vista = ""; return; }
    abas();
    $("#lote").classList.toggle("disparo-oculto", modo !== "individual");
    const ativa = s.filaAtiva(), fila = ativa || (filaVista && s.fila(filaVista));
    const alvo = modo === "individual" ? "individual" : fila ? (fila.situacao === "revisao" ? "revisao" : "acompanhamento") : modo;
    if (alvo === "individual") desenharIndividual(ativa);
    else if (alvo === "lote") desenharLote();
    else if (alvo === "revisao") comRolagem(() => desenharRevisao(fila));
    else comRolagem(() => desenharAcompanhamento(fila));
    vista = alvo;
  }
  function comRolagem(f) { const a = $("#disparos-conteudo .tabela-rolagem"), y = a ? a.scrollTop : 0; f(); const b = $("#disparos-conteudo .tabela-rolagem"); if (b) b.scrollTop = y; }
  const conteudo = (h) => { $("#disparos-conteudo").innerHTML = h; };

  function desenharIndividual(ativa) {
    conteudo(`<p class="ajuda sem-margem">Clique em um incidente na lista abaixo. A mensagem é preparada conforme a ocorrência e o WhatsApp Web abre para você conferir e enviar.</p>
      ${ativa ? `<p class="faixa-conector producao">Há uma fila ${esc((SITUACAO[ativa.situacao] || "").toLowerCase())} neste lote. <button type="button" class="link-botao" data-acao="ver-fila">Ver acompanhamento</button></p>` : ""}`);
  }
  function desenharLote() {
    const lista = srv().incidentesParaDisparo(), ok = lista.filter((x) => x.elegivel), sem = ok.filter((x) => !x.tem_celular).length, por = {};
    ok.forEach((x) => { por[x.ocorrencia] = (por[x.ocorrencia] || 0) + 1; });
    conteudo(`${faixaConector()}<div class="lote-resumo"><div class="metrica destaque"><div class="valor">${ok.length}</div><div class="rotulo">incidentes elegíveis</div></div>
      <div class="metrica"><div class="valor">${lista.length - ok.length}</div><div class="rotulo">já atendidos ou enviados</div></div>
      <div class="metrica"><div class="valor">${sem}</div><div class="rotulo">sem celular (corrigir na revisão)</div></div></div>
      <div class="chips-ocorrencia">${Object.entries(por).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<span class="etq e-sem_telefone">${esc(k)}: ${v}</span>`).join("")}</div>
      <div class="botoes"><button type="button" class="principal" data-acao="preparar-lote" ${ok.length ? "" : "disabled"}>PREPARAR ENVIO DO LOTE (${ok.length})</button></div>
      <p class="mini">Nada é enviado nesta etapa: você confere todas as mensagens antes de autorizar.</p>`);
  }

  /* ------------------------------------------------------------ revisão do lote */
  function desenharRevisao(f) {
    const r = srv().resumoRevisao(f), itens = f.itens.filter((i) => i.status !== "cancelado"), prod = status.modo === "producao";
    const livres = prod ? itens.filter((i) => i.selecionado && (i.editada || !(status.modelos_aprovados || []).includes(i.modelo))).length : 0;
    conteudo(`${faixaConector()}<div class="cabeca-revisao"><div><h3 class="sem-margem">Conferência da fila · ${esc(MODALIDADE[f.modo])}</h3>
        <span class="mini">Confira cada linha. Editar aqui muda só esta mensagem; os modelos originais não são alterados.</span></div>
        <div class="resumo-revisao"><span><b>${r.total}</b> na fila</span><span><b>${r.selecionados}</b> selecionadas</span><span class="${r.invalidos ? "alerta" : ""}"><b>${r.invalidos}</b> telefone inválido</span><span class="${r.duplicadas ? "alerta" : ""}"><b>${r.duplicadas}</b> duplicadas</span>${r.removidos ? `<span><b>${r.removidos}</b> removidas</span>` : ""}</div></div>
      <div class="tabela-rolagem tabela-disparos"><table><thead><tr><th class="c-check"><input type="checkbox" id="dr-todos" aria-label="Selecionar todas" ${r.selecionados === r.total && r.total ? "checked" : ""}></th><th>Incidente</th><th>Tipo de ocorrência</th><th>Destinatário</th><th>Telefone</th><th>Mensagem</th><th></th></tr></thead>
      <tbody>${itens.map((i) => linhaRevisao(i, prod)).join("") || `<tr><td colspan="7" class="mini">Nenhum incidente na fila.</td></tr>`}</tbody></table></div>
      <div class="autorizacao"><div class="autorizacao-info"><div class="contagem"><b>${r.enviaveis}</b> mensagem(ns) será(ão) enviada(s)${r.com_pendencia ? ` · <span class="alerta">${r.com_pendencia} com pendência ficará(ão) de fora</span>` : ""}</div>
          <p class="mini">Envie só a clientes com consentimento registrado. Depois da autorização a fila segue sozinha, sem pedir confirmação a cada contato. Cada mensagem enviada conta como callback seu.${livres ? ` <b>${livres} em texto livre</b>: só são entregues se o cliente tiver falado com a empresa nas últimas 24 horas.` : ""}</p></div>
        <div class="botoes"><button type="button" class="contorno" data-acao="descartar">Descartar fila</button>
        <button type="button" class="btn-autorizar" data-acao="autorizar" ${r.enviaveis && status.pronto && !processando ? "" : "disabled"} title="${status.pronto ? "" : esc(status.motivo || "Integração de envio indisponível")}">AUTORIZAR DISPARO</button></div></div>`);
    const t = $("#dr-todos"); if (t) { t.indeterminate = r.selecionados > 0 && r.selecionados < r.total; t.onchange = () => exec(() => srv().selecionarTodosItens(f.id, t.checked)); }
  }
  function linhaRevisao(i, prod) {
    const ruim = i.pendencias.some((p) => p.codigo === "telefone"), conf = i.pendencias.some((p) => p.codigo === "confirmar");
    const envioTipo = prod ? (!i.editada && (status.modelos_aprovados || []).includes(i.modelo) ? '<span class="etq e-callback_realizado">modelo aprovado</span>' : '<span class="etq e-pendente">texto livre</span>') : "";
    return `<tr data-item="${esc(i.id)}" class="${i.selecionado ? "" : "inelegivel"}">
      <td class="c-check"><input type="checkbox" data-sel aria-label="Selecionar ${esc(i.incidente || i.call_id)}" ${i.selecionado ? "checked" : ""}></td>
      <td><b>${esc(i.incidente || "sem incidente")}</b>${i.comunicacoes > 1 ? ` <span class="chip chip-qtd" title="Enviada só à comunicação principal; as demais comunicações do incidente não recebem">${i.comunicacoes} com.</span>` : ""}<div class="mini">${esc(i.call_id)}</div></td>
      <td>${esc(i.ocorrencia)}${i.risco >= 1 ? ' <span class="chip chip-risco" title="Incidente com indicação de risco: confira esta mensagem">⚠</span>' : ""}</td><td>${esc(i.destinatario || "—")}</td>
      <td class="c-tel-edit"><input data-tel class="${ruim ? "invalido" : ""}" inputmode="tel" maxlength="20" aria-label="Telefone de ${esc(i.incidente || i.call_id)}" value="${esc(i.telefone ? N.formatarTelefone(i.telefone) : "")}" placeholder="(DDD) 9xxxx-xxxx">
        ${conf ? `<label class="confirma"><input type="checkbox" data-conf> é do cliente</label>` : ""}</td>
      <td class="c-msg"><div class="msg-previa">${esc(i.texto)}</div>${i.editada ? '<span class="etq e-pendente">editada</span> ' : ""}${envioTipo}
        ${i.pendencias.map((p) => `<div class="pendencia">${esc(p.texto)}</div>`).join("")}${i.avisos.map((a) => `<div class="mini aviso-linha">${esc(a)}</div>`).join("")}</td>
      <td class="c-acao-fila"><button type="button" class="mini-botao" data-ver>Ver / editar</button> <button type="button" class="mini-botao" data-remover>Remover</button></td></tr>`;
  }
  function abrirMensagem(f, i) {
    $("#modal-caixa").className = "modal-caixa"; delete $("#modal-caixa").dataset.livre;
    $("#modal-caixa").innerHTML = `<h2>Mensagem · ${esc(i.incidente || i.call_id)}</h2><p class="mini">${esc(i.ocorrencia)} · ${esc(i.destinatario || "—")} · ${esc(N.formatarTelefone(i.telefone))}</p>
      <textarea id="dm-texto" maxlength="${N.TEXTO_MAX}" aria-label="Texto da mensagem">${esc(i.texto)}</textarea>
      <p class="mini">A alteração vale só para este envio. O modelo original permanece intacto.</p>
      <div class="botoes fim"><button type="button" class="link-botao" id="dm-restaurar">restaurar texto do modelo</button><button type="button" class="contorno" id="dm-fechar">Fechar</button><button type="button" class="acao" id="dm-salvar">Salvar</button></div>`;
    $("#modal").classList.remove("oculto");
    $("#dm-fechar").onclick = fecharModal;
    $("#dm-restaurar").onclick = async () => { if (await exec(() => srv().restaurarMensagemItem(f.id, i.id))) fecharModal(); };
    $("#dm-salvar").onclick = async () => { if (await exec(() => srv().editarMensagemItem(f.id, i.id, $("#dm-texto").value))) fecharModal(); };
  }

  /* ------------------------------------------------------------ acompanhamento */
  function desenharAcompanhamento(f) {
    const p = srv().painelDisparo(f), emTransito = !!f.executor && new Date(f.executor.expira).getTime() > Date.now();
    const interrompida = f.situacao === "autorizada" && !emTransito && !processando;
    const podeRetomar = (f.situacao === "pausada" && !emTransito || interrompida) && !processando && status.pronto;
    const falhas = f.itens.some((i) => i.status === "falha" && !i.incerto && i.assinatura) && ["concluida", "pausada"].includes(f.situacao) && !processando && !emTransito;
    const fim = ["concluida", "cancelada"].includes(f.situacao);
    const rotulo = interrompida ? "Interrompida" : f.situacao === "autorizada" ? "Em execução" : SITUACAO[f.situacao];
    const c = (v, r, cl = "") => `<div class="metrica ${cl}"><div class="valor">${v}</div><div class="rotulo">${r}</div></div>`;
    conteudo(`${faixaConector()}<div class="cabeca-revisao"><div><h3 class="sem-margem">Acompanhamento · ${esc(MODALIDADE[f.modo])} <span class="etq situacao-${f.situacao}${interrompida ? " interrompida" : ""}">${esc(rotulo)}</span></h3>
        <span class="mini">Autorizado por ${esc(f.autorizacao.operador)} em ${horaBR(f.autorizacao.em)}${interrompida ? " · A aba foi fechada no meio do envio. Clique em Retomar: nada será enviado em duplicidade." : ""}</span></div>
        <div class="botoes">${f.situacao === "autorizada" && !interrompida ? '<button type="button" class="contorno" data-acao="pausar">Pausar</button>' : ""}
        ${podeRetomar ? '<button type="button" class="acao" data-acao="retomar">Retomar</button>' : ""}
        ${falhas ? '<button type="button" class="acao" data-acao="reprocessar">Autorizar novo envio das falhas</button>' : ""}
        ${fim ? "" : '<button type="button" class="perigo" data-acao="cancelar">Cancelar restante</button>'}
        ${fim ? '<button type="button" class="principal" data-acao="nova">Nova seleção</button>' : ""}</div></div>
      <div class="metricas painel-disparo">${c(p.total_selecionado, "total selecionado")}${c(p.total_preparado, "total preparado")}${c(p.total_enviado, "total enviado", "destaque")}${c(p.total_pendente, "total pendente", p.total_pendente ? "andamento" : "")}${c(p.total_falha, "total com falha", p.total_falha ? "falha" : "")}${c(p.percentual + "%", "concluído")}</div>
      <progress class="progresso" max="100" value="${p.percentual}" aria-label="Percentual de conclusão">${p.percentual}%</progress>
      <div class="tabela-rolagem tabela-disparos"><table><thead><tr><th>Incidente</th><th>Tipo de ocorrência</th><th>Destinatário</th><th>Telefone</th><th>Envio</th><th title="Resultado operacional do incidente">Callback</th><th>Tent.</th><th>Último registro</th></tr></thead>
      <tbody>${f.itens.filter((i) => i.assinatura || i.status === "cancelado").map((i) => { const t = i.tentativas[i.tentativas.length - 1];
        return `<tr data-item="${esc(i.id)}"><td><b>${esc(i.incidente || "sem incidente")}</b></td><td>${esc(i.ocorrencia)}</td><td>${esc(i.destinatario || "—")}</td><td>${i.telefone ? esc(N.formatarTelefone(i.telefone)) : esc(i.telefone_mascara || "—")}</td>
          <td>${etiqueta(i.status)}${i.incerto ? ' <span class="etq e-pendente" title="A API não confirmou se a mensagem chegou">incerto</span>' : ""}${i.simulado ? ' <span class="etq e-sem_telefone">simulação</span>' : ""}</td><td>${celulaCallback(i)}</td><td class="c-num">${i.tentativas.length}</td>
          <td class="mini">${t ? horaBR(t.fim || t.inicio) : "—"}${i.erro ? ` · ${esc(i.erro)}` : ""}${i.incerto && !processando ? ' <button type="button" class="link-botao" data-liberar>não chegou: liberar reenvio</button>' : ""}</td></tr>`; }).join("")}</tbody></table></div>`);
  }

  function celulaCallback(i) {
    if (!i.callback) return "—";
    if (i.callback.situacao === "ja_registrado") return '<span class="etq e-sem_telefone" title="O callback já estava registrado: não contou de novo">Já registrado</span>';
    return `<span class="etq e-callback_realizado" title="${esc(horaBR(i.callback.em))}">Realizado</span> <span class="mini">${esc(i.callback.operador)}</span>`;
  }

  /* ------------------------------------------------------------ histórico para auditoria */
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
  async function preparar(chaves, tipo) {
    const f = await exec(() => srv().prepararDisparo(chaves, tipo), "Mensagens preparadas. Confira antes de autorizar.");
    if (f) { filaVista = f.id; await verificarConector(); atualizar(); }
  }
  async function executarFila(id) {
    if (processando) return;
    processando = true; atualizar();
    try { await srv().processarFila(id, conector, { aoProgresso: () => { UI().avisar(); UI().atualizarDuranteFila(); atualizar(); } }); }
    catch (e) { toast(e.message, true); }
    finally { processando = false; UI().recarregar(); }
  }
  async function autorizar(f) {
    if (processando) return;
    status = await conector.status();
    if (await exec(() => srv().autorizarDisparo(f.id, status), "Disparo autorizado.")) { filaVista = f.id; executarFila(f.id); }
    else atualizar(); // recusada: o botão desabilitado no clique volta ao estado real
  }
  $("#disparos-abas").addEventListener("click", (ev) => { const b = ev.target.closest("[data-modo]"); if (!b) return; if (b.dataset.modo === "manual") { window.CentralManual.abrir(); return; } modo = b.dataset.modo; vista = ""; atualizar(); });
  $("#btn-historico-disparos").onclick = abrirHistorico;
  const areaC = $("#disparos-conteudo");
  areaC.addEventListener("click", async (ev) => {
    const s = srv(), f = s.filaAtiva() || (filaVista && s.fila(filaVista)), acao = ev.target.closest("[data-acao]");
    if (acao) {
      const a = acao.dataset.acao;
      if (a === "ver-fila") { modo = "lote"; vista = ""; atualizar(); }
      else if (a === "preparar-lote") preparar(s.incidentesParaDisparo().filter((x) => x.elegivel).map((x) => x.chave), "lote");
      else if (a === "autorizar") { acao.disabled = true; autorizar(f); }
      else if (a === "descartar") { if (await UI().confirmar("Descartar fila", "<p>A fila será descartada. Nenhuma mensagem foi enviada.</p>", "Descartar", "perigo")) { await exec(() => s.descartarFila(f.id)); filaVista = null; vista = ""; atualizar(); } }
      else if (a === "pausar") exec(() => s.pausarFila(f.id), "Pausando: a mensagem em trânsito será concluída.");
      else if (a === "retomar") executarFila(f.id);
      else if (a === "cancelar") { if (await UI().confirmar("Cancelar restante", "<p>As mensagens ainda não enviadas serão canceladas. As já enviadas não são afetadas.</p>", "Cancelar restante", "perigo")) exec(() => s.cancelarRestante(f.id), "Restante da fila cancelado."); }
      else if (a === "reprocessar") { if (await exec(() => s.reprocessarFalhas(f.id), "Novo envio das falhas autorizado.")) executarFila(f.id); }
      else if (a === "nova") { filaVista = null; vista = ""; atualizar(); }
      return;
    }
    const tr = ev.target.closest("tr[data-item]");
    if (tr && f) {
      const i = f.itens.find((x) => x.id === tr.dataset.item); if (!i) return;
      if (ev.target.closest("[data-ver]")) abrirMensagem(f, i);
      else if (ev.target.closest("[data-remover]")) exec(() => s.removerItem(f.id, i.id), "Incidente removido da fila.");
      else if (ev.target.closest("[data-liberar]")) { if (await UI().confirmar("Liberar reenvio", "<p>Confirme somente depois de verificar que a mensagem <b>não</b> chegou ao cliente. Um reenvio pode duplicar a mensagem se ela tiver sido entregue.</p>", "Verifiquei: não chegou", "perigo")) exec(() => s.liberarIncerto(f.id, i.id)); }
      return;
    }
  });
  areaC.addEventListener("change", (ev) => {
    const s = srv(), f = s.filaAtiva(), tr = ev.target.closest("tr[data-item]");
    if (!tr || !f) return;
    const id = tr.dataset.item;
    if (ev.target.matches("[data-sel]")) exec(() => s.selecionarItem(f.id, id, ev.target.checked));
    else if (ev.target.matches("[data-conf]")) exec(() => s.confirmarTelefoneItem(f.id, id, ev.target.checked));
    else if (ev.target.matches("[data-tel]")) exec(() => s.corrigirTelefoneItem(f.id, id, ev.target.value), "Telefone corrigido.").then((r) => { if (!r) atualizar(); });
  });

  /* Gateway indisponível: continua perguntando, para o botão refletir a volta dele sem precisar recarregar a página. */
  setInterval(() => { if (vista && vista !== "individual" && !status.pronto) verificarConector(); }, 5000);

  window.CentralDisparos = { atualizar, verificarConector };
})();
