/* Central de Disparos — interface das três opções. Usa o Servico e as regras existentes; não tem estado próprio além dos
   filtros, da seleção e da opção de avanço automático. Todo texto é inserido com esc() (sem HTML vindo do CSV).
   Envio em lote: atendimento guiado pelo WhatsApp Web, controlado inteiramente na janela do incidente.
   Abrir o WhatsApp, voltar dele e confirmar o callback são acontecimentos separados: só o clique em CALLBACK REALIZADO
   registra o callback, e a fila só avança por PRÓXIMO INC, PULAR ou (se o operador ativar) logo após essa confirmação.
   Não há detecção de foco nem temporizador: voltar do WhatsApp não muda nada. */
"use strict";
(function () {
  const N = window.Nucleo, D = window.Disparos, $ = (s) => document.querySelector(s);
  const UI = () => window.CentralUI, srv = () => UI().servico, esc = (v) => UI().esc(v), toast = (m, e) => UI().toastErro(m, !!e);
  const MODOS = { individual: ["1", "Envio individual", "Abra um incidente na lista e envie pelo WhatsApp Web, como sempre."],
    lote: ["2", "Envio em lote", "Selecione os incidentes e atenda um a um pelo WhatsApp Web. Você confirma cada callback e decide quando avançar."],
    manual: ["3", "CALLBACK MANUAL", "Acesse a ferramenta para informar manualmente o incidente, telefone e escolher a mensagem que deseja enviar."] };
  /* "selecao" fica só para exibir filas antigas. */
  const MODALIDADE = { selecao: "Seleção manual", lote: "Envio em lote" };
  const SITUACAO = { revisao: "Em revisão", autorizada: "Em execução", atendimento: "Em atendimento", pausada: "Pausada", concluida: "Concluída", cancelada: "Cancelada" };
  const JANELA_WA = "central_whatsapp_web"; // a mesma aba é reaproveitada a cada incidente
  /* Indicador discreto da janela: reflete só o que aconteceu de fato com o incidente. */
  const INDICADOR = { aguardando: ["pendente", "Pendente"], preparado: ["pendente", "Pendente"], aberto: ["aberto", "WhatsApp aberto"], enviado: ["realizado", "Callback realizado"],
    pulado: ["ignorado", "Ignorado"], nao_confirmado: ["nao-realizado", "Não realizado"], falha: ["nao-realizado", "Não realizado"], cancelado: ["ignorado", "Cancelado"] };
  const indicador = (s) => { const [c, t] = INDICADOR[s] || ["pendente", D.STATUS[s] || s]; return `<span class="ind-situacao ind-${c}" data-situacao="${esc(s)}">${esc(t)}</span>`; };
  /* Avanço automático após CALLBACK REALIZADO: DESATIVADO sempre que a Central abre; só o operador o liga, e vale até recarregar. */
  let avancoAuto = false;
  let modo = "individual", filaVista = null, vista = "", cartaoVisto = null, ocupado = false;
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
    if (!lote) { $("#lote").classList.remove("disparo-oculto"); filaVista = null; selecao.clear(); vista = ""; return; }
    abas();
    $("#lote").classList.toggle("disparo-oculto", modo !== "individual");
    const ativa = s.filaAtiva(); if (ativa && ativa.assistido) filaVista = ativa.id; // mesmo depois de recarregar, o fim da fila mostra o resumo
    const fila = ativa || (filaVista && s.fila(filaVista));
    const alvo = modo === "individual" ? "individual" : !fila ? "selecao" : !fila.assistido ? "antiga" : ativa ? "atendimento" : "conclusao";
    if (alvo === "selecao" && vista === "selecao") desenharLinhasSelecao();
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

  /* ------------------------------------------------------------ filtros operacionais (Regionais e municípios, Período, Situação)
     Aplicados ANTES de criar a fila, sobre a base do lote em memória (srv.incidentesParaDisparo): não relê o CSV, não altera o
     lote. Regionais e municípios: seleção múltipla (js/filtro-regionais.js) com as sete regionais completas de js/localidades.js,
     mesmo sem incidentes no arquivo (contagem zero). Instância PRÓPRIA do envio em lote: independe da escolha do envio
     individual e não é lembrada (cada abertura começa em "Todas as regionais"). Cada incidente usa a comunicação PRINCIPAL (a que
     recebe a mensagem): um município e uma data por incidente, sem duplicar. Período = data real do incidente, nunca a importação. */
  const L = window.Localidades;
  const oper = { situacao: "pendentes" };
  // Ao marcar/desmarcar: tira da seleção o que saiu do filtro e redesenha SÓ as linhas e os totais (o painel continua aberto).
  const filtroLote = window.FiltroRegionais.criar({ id: "fr-lote", rotulo: "Regionais e municípios do envio em lote",
    aoMudar: () => { podarSelecao(); if ($("#ds-linhas")) desenharLinhasSelecao(); } });
  const SITUACOES = { pendentes: ["Pendentes (podem entrar na fila)", (x) => x.elegivel], sem_telefone: ["Sem telefone", (x) => !x.telefone],
    realizados: ["Callback já realizado", (x) => x.atendido], todas: ["Todas as situações", () => true] };
  /* Período = o MESMO filtro por data da lista (window.CentralUI.filtroData; padrão HOJE ao abrir a Central). Data do incidente
     calculada por N.dataDoIncidente (Horário da call; sem ele, Recebido ADMS). Sem data: fora de hoje e de qualquer período. */
  const diaDe = (x) => (x.data_incidente ? x.data_incidente.dia : String(x.horario_call || "").slice(0, 10) || null);
  const FD = () => UI().filtroData;
  /* Localidade do INCIDENTE: todas as comunicações juntas (a principal primeiro), como no envio individual. Uma comunicação
     vazia ou sem nome não tira o incidente da regional. Mapa refeito a cada desenho/poda (só leitura do lote em memória). */
  let locsInc = new Map();
  const atualizarLocs = () => { locsInc = new Map(srv().grupos().map((g) => [g.chave, g.membros.map((c) => c.localizacao)])); };
  const localDe = (x) => L.classificarIncidente(locsInc.get(x.chave) || [x.localizacao]);
  const confereLocal = (x) => localDe(x).chaves.some(filtroLote.contem);
  function confereData(x) { return FD().confere(diaDe(x)); }
  const operacional = (x) => confereLocal(x) && confereData(x) && SITUACOES[oper.situacao][1](x);
  function htmlFiltrosOperacionais() {
    const opt = (v, t, sel) => `<option value="${esc(v)}"${sel ? " selected" : ""}>${esc(t)}</option>`;
    const v = FD().campos(), modo = FD().obter().modo, bt = (id, m, t) => `<button type="button" id="${id}" class="mini-botao${modo === m ? " ativo" : ""}" aria-pressed="${modo === m}">${t}</button>`;
    return `<div class="filtros-lote" role="group" aria-label="Filtros do envio em lote">
      <div class="campo-regionais"><span class="campo-rotulo">Regionais e municípios</span><div id="ds-regionais"></div></div>
      <label>De <input id="ds-de" type="date" value="${esc(v.de)}"></label>
      <label>Até <input id="ds-ate" type="date" value="${esc(v.ate)}"></label>
      <label>Situação <select id="ds-situacao">${Object.entries(SITUACOES).map(([k, [t]]) => opt(k, t, k === oper.situacao)).join("")}</select></label>
    </div><div class="filtro-data" role="group" aria-label="Data do incidente no envio em lote"><span class="fd-rotulo">Data do incidente: ${esc(FD().descrever())}</span>
      ${bt("ds-hoje", "hoje", "Hoje")}${bt("ds-todas", "todas", "Todas as datas")}${bt("ds-sem-data", "sem_data", "Sem data")}
      <span class="mini fd-info">O mesmo filtro da lista de incidentes: só o que está nele pode entrar na fila.</span></div>
    <div id="ds-resumo" class="resumo-lote-filtros" aria-live="polite"></div>`;
  }
  /* Totais: importado (comunicações e incidentes do lote) e, depois de Regionais/Período, os incidentes encontrados. */
  function resumoOperacional(lista) {
    const achados = lista.filter((x) => confereLocal(x) && confereData(x)), comPeriodo = ["hoje", "periodo"].includes(FD().obter().modo);
    const semData = (comPeriodo ? lista.filter((x) => confereLocal(x) && !diaDe(x)) : achados.filter((x) => !diaDe(x))).length;
    const c = (v, r, cl = "", id = "") => `<div class="metrica ${cl}"${id ? ` data-total="${id}"` : ""}><div class="valor">${v}</div><div class="rotulo">${r}</div></div>`;
    const comInc = lista.filter((x) => x.incidente).length, soCall = lista.length - comInc; // mesma conta dos cartões: incidentes únicos + CALL sem incidente
    $("#ds-resumo").innerHTML = `<div class="metricas painel-disparo">${c(srv().chamadas().length, `comunicações importadas · ${comInc} incidentes${soCall ? ` + ${soCall} CALL sem incidente` : ""}`, "", "importado")}`
      + c(achados.length, "incidentes encontrados", "destaque", "encontrados") + c(achados.filter((x) => x.elegivel).length, "pendentes", achados.some((x) => x.elegivel) ? "andamento" : "", "pendentes")
      + c(achados.filter((x) => !x.telefone).length, "sem telefone", "", "sem_telefone") + c(achados.filter((x) => x.atendido).length, "já realizados", "", "realizados")
      + c(semData, comPeriodo ? "sem data (fora do período)" : "sem data identificada", "", "sem_data") + `</div>`;
  }
  /* Ao mudar Regionais/Período/Situação, sai da seleção o que ficou fora: a fila nunca recebe incidente escondido. */
  function podarSelecao() {
    atualizarLocs();
    const lista = srv().incidentesParaDisparo();
    for (const k of [...selecao]) { const x = lista.find((y) => y.chave === k); if (!x || !operacional(x)) selecao.delete(k); }
  }
  function mudarOperacional(campo, valor) {
    oper[campo] = valor;
    podarSelecao(); desenharSelecao();
  }

  /* ------------------------------------------------------------ seleção dos incidentes */
  /* Tipos de ocorrência do lote (opções do filtro): o nome do modelo de mensagem sugerido para a comunicação PRINCIPAL de cada
     incidente (x.ocorrencia de srv.incidentesParaDisparo). Única fonte das opções do envio em lote e do envio individual. */
  const opcoesOcorrencia = (lista) => [...new Set(lista.map((x) => x.ocorrencia))].sort();
  const casa = (x) => operacional(x) && casaBusca(x);
  /* Busca, ocorrência e status do envio (sem regionais/período/situação): base também das contagens do filtro de regionais. */
  function casaBusca(x) {
    const b = N.normalizarTexto(filtros.busca);
    if (filtros.ocorrencia && x.ocorrencia !== filtros.ocorrencia) return false;
    if (filtros.envio && x.status !== filtros.envio) return false;
    const digitos = filtros.busca.replace(/\D/g, "");
    return !b || [x.incidente, x.protocolo, x.call_id, x.ocorrencia, x.motivo_adms, x.submotivos, x.nome].some((t) => N.normalizarTexto(t || "").includes(b)) || (digitos.length >= 3 && (x.telefone || "").includes(digitos));
  }
  function desenharSelecao() {
    atualizarLocs();
    const lista = srv().incidentesParaDisparo();
    for (const k of [...selecao]) if (!lista.some((x) => x.chave === k && x.elegivel)) selecao.delete(k);
    conteudo(`${htmlFiltrosOperacionais()}<div class="barra-selecao">
        <input id="ds-busca" type="search" placeholder="Buscar número, protocolo, ocorrência ou contato" aria-label="Buscar incidentes" value="${esc(filtros.busca)}">
        <select id="ds-ocorrencia" aria-label="Filtrar por ocorrência"><option value="">Todas as ocorrências</option>${opcoesOcorrencia(lista).map((o) => `<option${o === filtros.ocorrencia ? " selected" : ""}>${esc(o)}</option>`).join("")}</select>
        <select id="ds-envio" aria-label="Filtrar por status do envio"><option value="">Todos os status</option>${Object.entries(D.STATUS).map(([k, v]) => `<option value="${k}"${k === filtros.envio ? " selected" : ""}>${v}</option>`).join("")}</select>
        <button type="button" class="contorno" data-acao="marcar-todos">Selecionar todos</button><button type="button" class="contorno" data-acao="desmarcar-todos">Desmarcar todos</button>
      </div>
      <div class="tabela-rolagem tabela-disparos"><table><thead><tr><th class="c-check"><input type="checkbox" id="ds-todos" aria-label="Selecionar todos os incidentes visíveis"></th><th>Incidente</th><th>Data e hora</th><th>Localidade</th><th>Ocorrência</th><th>Contato</th><th>Telefone</th><th>Envio</th></tr></thead><tbody id="ds-linhas"></tbody></table></div>
      <div class="rodape-acao"><span id="ds-contagem" class="contagem"></span><button type="button" class="principal" id="ds-iniciar" data-acao="iniciar">INICIAR ATENDIMENTO</button></div>`);
    filtroLote.montar($("#ds-regionais"));
    desenharLinhasSelecao();
    $("#ds-busca").oninput = (ev) => { filtros.busca = ev.target.value; desenharLinhasSelecao(); };
    $("#ds-ocorrencia").onchange = (ev) => { filtros.ocorrencia = ev.target.value; desenharLinhasSelecao(); };
    $("#ds-envio").onchange = (ev) => { filtros.envio = ev.target.value; desenharLinhasSelecao(); };
    // Data: muda o filtro compartilhado (lista + lote); aoMudarFiltroData poda a seleção e redesenha.
    const periodo = () => FD().definir({ modo: "periodo", de: $("#ds-de").value, ate: $("#ds-ate").value });
    $("#ds-de").onchange = periodo; $("#ds-ate").onchange = periodo;
    $("#ds-hoje").onclick = () => FD().definir({ modo: "hoje" });
    $("#ds-todas").onclick = () => FD().definir({ modo: "todas" });
    $("#ds-sem-data").onclick = () => FD().definir({ modo: "sem_data" });
    $("#ds-situacao").onchange = (ev) => mudarOperacional("situacao", ev.target.value);
  }
  function desenharLinhasSelecao() {
    atualizarLocs();
    const base = srv().incidentesParaDisparo(), lista = base.filter(casa);
    if ($("#ds-resumo")) resumoOperacional(base);
    // Contagens do filtro de regionais = incidentes por município com os OUTROS filtros (período, situação, busca, ocorrência, status).
    const cont = new Map();
    for (const x of base) if (confereData(x) && SITUACOES[oper.situacao][1](x) && casaBusca(x)) for (const k of localDe(x).chaves) cont.set(k, (cont.get(k) || 0) + 1);
    filtroLote.atualizar(cont);
    $("#ds-linhas").innerHTML = lista.map((x) => `<tr data-chave="${esc(x.chave)}" class="${selecao.has(x.chave) ? "selecionada" : ""}${x.elegivel ? "" : " inelegivel"}${x.atendido ? " linha-callback" : ""}${x.risco >= 1 ? " linha-risco" : ""}" ${x.elegivel ? "" : `title="${esc(x.motivo_inelegivel)}"`}>
      <td class="c-check"><input type="checkbox" aria-label="Selecionar ${esc(x.incidente || x.call_id)}" ${selecao.has(x.chave) ? "checked" : ""} ${x.elegivel ? "" : "disabled"}></td>
      <td><b>${esc(x.incidente || "sem incidente")}</b>${x.qtd > 1 ? ` <span class="chip chip-qtd" title="A mensagem vai para a comunicação principal do incidente">${x.qtd} com.</span>` : ""}<div class="mini">${esc(x.call_id)}</div></td>
      <td class="data-hora">${esc(N.formatarDataHora(x.horario_call))}</td>${celulaLocalidade(x)}
      <td>${esc(x.ocorrencia)}${x.risco >= 1 ? ' <span class="chip chip-risco" title="Indicação de risco">⚠</span>' : ""}</td><td>${esc(x.nome || "—")}</td>
      <td>${x.telefone ? esc(N.formatarTelefone(x.telefone)) : "—"}${x.tem_celular ? "" : ' <span class="etq e-contato_invalido">sem celular</span>'}</td>
      <td>${x.elegivel ? etiqueta(x.status) : `${x.atendido ? '<span class="etq e-callback_realizado">Callback realizado</span>' : etiqueta(x.status)} <span class="mini">${esc(x.motivo_inelegivel)}</span>`}${x.atendido ? ` <button type="button" class="link-botao" data-hist="${esc(x.chave)}">histórico</button>` : ""}</td></tr>`).join("")
      || `<tr><td colspan="8" class="mini">Nenhum incidente neste filtro.</td></tr>`;
    contarSelecao(lista);
  }
  /* Município reconhecido (nome oficial; regional e código na dica) ou, fora das regionais, o nome do ADMS com o motivo. */
  function celulaLocalidade(x) {
    const c = localDe(x), dica = c.status === "ok" ? `${c.regional_nome}${c.codigo ? " · código " + c.codigo : ""}` : `${L.ESPECIAIS[c.chave]}: ${c.motivo}`;
    return `<td class="c-localidade" title="${esc(dica + (x.localizacao ? "\nADMS: " + x.localizacao : ""))}">${esc(L.rotulo(c))}${c.status === "ok" ? "" : ' <span class="etq e-sem_telefone">?</span>'}</td>`;
  }
  function contarSelecao(lista = srv().incidentesParaDisparo().filter(casa)) {
    const el = lista.filter((x) => x.elegivel), marcados = el.filter((x) => selecao.has(x.chave)).length, t = $("#ds-todos");
    if (t) { t.checked = !!el.length && marcados === el.length; t.indeterminate = marcados > 0 && marcados < el.length; }
    $("#ds-contagem").innerHTML = `<b>${selecao.size}</b> incidente(s) selecionado(s) · ${lista.length} na lista`;
    $("#ds-iniciar").disabled = !selecao.size;
  }

  /* ------------------------------------------------------------ atendimento guiado */
  /* Sem lista de enviados/não enviados: o controle fica todo na janela do incidente. Os contadores resumem a fila. */
  function htmlProgresso(f) {
    const p = srv().painelAtendimento(f), c = (v, r, cl = "") => `<div class="metrica ${cl}"><div class="valor">${v}</div><div class="rotulo">${r}</div></div>`;
    return `<div class="metricas painel-disparo">${c(p.total, "na fila")}${c(p.confirmados, "callback realizado", "destaque")}${c(p.restantes, "restantes", p.restantes ? "andamento" : "")}${c(p.pulados, "ignorados")}${c(p.nao_realizados, "não realizados")}${c(p.percentual + "%", "concluído")}</div>
      <progress class="progresso" max="100" value="${p.percentual}" aria-label="Percentual de conclusão">${p.percentual}%</progress>`;
  }
  function desenharAtendimento(f) {
    const i = srv().itemAtual(f), pausada = f.situacao === "pausada", p = srv().painelAtendimento(f), ant = srv().anteriorAtendimento(f);
    const aberto = i && i.status === "aberto", feito = i && i.status === "enviado", pronto = i && (i.status === "preparado" || aberto), livre = !pausada;
    const ruim = i && i.pendencias.some((x) => x.codigo === "telefone"), conf = i && i.pendencias.some((x) => x.codigo === "confirmar");
    const faixa = pausada ? '<div class="atend-aviso pausa">Atendimento pausado. O progresso está guardado.</div>'
      : feito ? `<div class="atend-aviso ok">Callback registrado. ${avancoAuto ? "" : "Clique em PRÓXIMO INC para continuar."}</div>`
      : aberto ? '<div class="atend-aviso">WhatsApp aberto. Depois de enviar, clique em CALLBACK REALIZADO. Se o WhatsApp deu erro, envie de novo, vá ao PRÓXIMO INC ou PULE.</div>' : "";
    conteudo(`<div class="cabeca-revisao"><div><h3 class="sem-margem">Atendimento em lote <span class="etq situacao-${pausada ? "pausada" : "autorizada"}">${esc(SITUACAO[f.situacao])}</span></h3><span class="mini">Incidente ${p.posicao} de ${p.total}</span></div>
        <div class="botoes">${pausada ? '<button type="button" class="acao" data-acao="at-retomar">Retomar</button>' : '<button type="button" class="contorno" data-acao="at-pausar">Pausar</button>'}<button type="button" class="perigo" data-acao="at-cancelar">Cancelar atendimento</button></div></div>
      ${htmlProgresso(f)}${faixa}
      ${i ? `<article class="atend-card" data-item="${esc(i.id)}">
        <div class="atend-topo"><div><span class="mini">Incidente</span><h2 id="at-incidente">${esc(i.incidente || i.call_id)}</h2></div>
          <div class="atend-situacao">${i.risco >= 1 ? '<span class="chip chip-risco">⚠ Indicação de risco</span>' : ""}<span id="at-situacao">${indicador(i.status)}</span></div></div>
        ${ant ? `<p class="mini atend-anterior" id="at-anterior">Anterior: <b>${esc(ant.incidente || ant.call_id)}</b> ${indicador(ant.status)}</p>` : ""}
        <div class="atend-dados"><div><span class="mini">Cliente</span><b id="at-cliente">${esc(i.destinatario || "—")}</b></div><div><span class="mini">Ocorrência</span><b>${esc(i.ocorrencia)}</b></div>
          <label class="c-tel-edit"><span class="mini">Telefone</span><input data-tel id="at-telefone" class="${ruim ? "invalido" : ""}" inputmode="tel" maxlength="20" aria-label="Telefone do cliente" value="${esc(i.telefone ? N.formatarTelefone(i.telefone) : "")}" placeholder="(DDD) 9xxxx-xxxx" ${aberto || feito ? "disabled" : ""}>${conf ? '<span class="confirma"><input type="checkbox" data-conf> é do cliente</span>' : ""}</label></div>
        <div class="atend-mensagem" id="at-mensagem">${esc(i.texto)}</div>
        <div class="atend-sob-mensagem">${i.editada ? '<span class="etq e-pendente">editada</span>' : ""}${aberto || feito ? "" : '<button type="button" class="link-botao" data-acao="at-editar">Editar mensagem</button>'}</div>
        ${i.pendencias.map((x) => `<div class="pendencia">${esc(x.texto)}</div>`).join("")}${i.avisos.map((a) => `<div class="mini aviso-linha">${esc(a)}</div>`).join("")}
        <label class="atend-auto"><input type="checkbox" id="at-auto" ${avancoAuto ? "checked" : ""}> AVANÇAR AUTOMATICAMENTE APÓS CALLBACK REALIZADO</label>
        <div class="atend-acoes">
          <button type="button" class="principal" data-acao="at-abrir" ${pronto && livre ? "" : "disabled"}>${aberto ? "ENVIAR WHATSAPP NOVAMENTE" : "ENVIAR WHATSAPP"}</button>
          <button type="button" class="btn-callback" data-acao="at-callback" ${aberto && livre ? "" : "disabled"} title="${feito ? "Callback já registrado" : aberto ? "Confirme só se a mensagem foi realmente enviada" : "Envie pelo WhatsApp primeiro"}">CALLBACK REALIZADO</button>
          <button type="button" class="contorno" data-acao="at-proximo" ${livre ? "" : "disabled"}>PRÓXIMO INC</button>
          <button type="button" class="contorno btn-pular" data-acao="at-pular" ${livre && !feito ? "" : "disabled"}>PULAR</button>
        </div>
      </article>` : ""}`);
    if (i && i.id !== cartaoVisto) { cartaoVisto = i.id; $(".atend-card").scrollIntoView({ block: "center" }); }
  }
  function desenharConclusao(f) {
    conteudo(`<div class="cabeca-revisao"><div><h3 class="sem-margem">Atendimento em lote <span class="etq situacao-${f.situacao}">${esc(SITUACAO[f.situacao])}</span></h3><span class="mini">Iniciado por ${esc(f.autorizacao.operador)} em ${horaBR(f.autorizacao.em)}</span></div>
        <div class="botoes"><button type="button" class="principal" data-acao="nova">Nova seleção</button></div></div>${htmlProgresso(f)}`);
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

  /* ------------------------------------------------------------ WhatsApp */
  /* Abrir não é enviar: o incidente fica "WhatsApp aberto" até o operador clicar em CALLBACK REALIZADO, PRÓXIMO INC ou PULAR.
     Não há escuta de foco/visibilidade: voltar à Central, fechar a aba do WhatsApp ou recarregar a página não mudam nada. */
  async function abrirWhatsapp(f, i) {
    const janela = window.open("", JANELA_WA); // no clique, para não ser bloqueado; não navega se a aba já existir
    if (!janela) { toast("O navegador bloqueou a nova janela. Permita pop-ups para a Central.", true); return; }
    try { janela.opener = null; } catch (e) { /* aba já no WhatsApp */ }
    try { janela.focus(); } catch (e) { /* o navegador decide */ }
    const r = await exec(() => srv().abrirAtendimento(f.id, i.id));
    if (!r || r.pulado) { janela.close(); return; }
    janela.location.href = r.url;
  }
  /* Uma ação de cada vez: clique duplo não confirma nem avança duas vezes (o serviço também confere). */
  async function umaVez(f) { if (ocupado) return null; ocupado = true; try { return await f(); } finally { ocupado = false; } }

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
    if (acao) {
      const a = acao.dataset.acao, i = f && f.assistido ? s.itemAtual(f) : null;
      if (a === "ver-fila") { modo = "lote"; vista = ""; atualizar(); }
      else if (a === "marcar-todos") { s.incidentesParaDisparo().filter(casa).filter((x) => x.elegivel).forEach((x) => selecao.add(x.chave)); desenharLinhasSelecao(); }
      else if (a === "desmarcar-todos") { selecao.clear(); desenharLinhasSelecao(); }
      else if (a === "iniciar") {
        podarSelecao(); // garantia: só entra na fila o que está dentro de Regionais/Período/Situação
        const n = await exec(() => s.iniciarAtendimento([...selecao]), "Atendimento iniciado."); if (n) { filaVista = n.id; selecao.clear(); vista = ""; atualizar(); }
      }
      else if (a === "at-abrir" && i) abrirWhatsapp(f, i);
      else if (a === "at-editar" && i) abrirMensagem(f, i);
      else if (a === "at-callback" && i) {
        const auto = avancoAuto; // lido no clique: só a confirmação explícita pode avançar
        if (await umaVez(() => exec(() => s.confirmarEnvioAtendimento(f.id, i.id, "enviado", { avancar: auto }), auto ? "Callback registrado. Próximo incidente." : "Callback registrado."))) UI().recarregar();
      }
      else if (a === "at-proximo" && i) {
        const r = await umaVez(() => exec(() => s.proximoAtendimento(f.id, i.id)));
        if (r && r.mesmo) toast("Não há outro incidente pendente. Envie, ou use PULAR para ignorar este.");
      }
      else if (a === "at-pular" && i) umaVez(() => exec(() => s.pularAtendimento(f.id, i.id)));
      else if (a === "at-pausar") exec(() => s.pausarAtendimento(f.id), "Atendimento pausado.");
      else if (a === "at-retomar") exec(() => s.retomarAtendimento(f.id));
      else if (a === "at-cancelar") { if (await UI().confirmar("Cancelar atendimento", "<p>Os incidentes ainda não atendidos saem da fila. Um WhatsApp aberto e não confirmado fica como não realizado; nada conta como callback.</p>", "Cancelar atendimento", "perigo")) exec(() => s.cancelarAtendimento(f.id), "Atendimento cancelado."); }
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
    if (ev.target.id === "at-auto") { avancoAuto = ev.target.checked; atualizar(); return; }
    if (ev.target.id === "ds-todos") { const lista = s.incidentesParaDisparo().filter(casa).filter((x) => x.elegivel); lista.forEach((x) => (ev.target.checked ? selecao.add(x.chave) : selecao.delete(x.chave))); desenharLinhasSelecao(); return; }
    if (!box || !f) return;
    const id = box.dataset.item;
    if (ev.target.matches("[data-conf]")) exec(() => s.confirmarTelefoneItem(f.id, id, ev.target.checked));
    else if (ev.target.matches("[data-tel]")) exec(() => s.corrigirTelefoneItem(f.id, id, ev.target.value), "Telefone corrigido.").then((r) => { if (!r) atualizar(); });
  });

  /* Filtro por data mudou (aqui ou na lista): sai da seleção o que ficou fora e a tela de seleção é redesenhada. */
  function aoMudarFiltroData() {
    const s = srv(); if (!s || !s.E || !s.loteAberto()) return;
    podarSelecao();
    if (vista === "selecao") desenharSelecao();
  }
  window.CentralDisparos = { atualizar, aoMudarFiltroData, opcoesOcorrencia };
})();
