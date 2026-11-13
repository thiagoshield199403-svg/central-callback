/* Central de Callback COI — interface (aplicação web local, aberta direto pelo index.html; sem servidor).
   Todo texto vindo do CSV é inserido como TEXTO (esc), nunca como HTML. O estado fica no armazenamento local do navegador
   (IndexedDB) e sobrevive ao fechamento do navegador. No envio individual a Central NÃO envia mensagens: abre o WhatsApp Web
   com o texto e o operador confere, envia e registra o resultado. O disparo autorizado em fila fica em js/disparos.js e usa o gateway.
   1.1.0: visual e funções recuperados da referência CENTRAL_CALLBACK (texto editável, prévia com amostra, localização resumida,
   filtros, créditos), envio manual de WhatsApp, serviço executado / ocorrência resolvida, painel e exportação diária. */
"use strict";
(function () {
  const N = window.Nucleo;
  const $ = (s) => document.querySelector(s);
  const ESTADOS = { pendente: "Pendente", callback_realizado: "Callback realizado", contato_invalido: "Contato inválido", sem_telefone: "Sem telefone" };
  const MEIOS = { whatsapp: "WhatsApp", ligacao: "Ligação", outro: "Outro" };
  const params = new URLSearchParams(location.search);
  /* CÓPIA DE DESENVOLVIMENTO: usa um banco SEPARADO ("-dev"), para não tocar nos dados da versão em uso
     ("central-callback-coi"). Na publicação autorizada, trocar BANCO_BASE para "central-callback-coi".
     (A faixa "CÓPIA DE DESENVOLVIMENTO" foi retirada a pedido; o nome do banco aparece só em Configuração.) */
  const BANCO_BASE = "central-callback-coi-dev";
  const NOME_BANCO = BANCO_BASE + (params.get("bd") ? "-" + params.get("bd").replace(/[^a-z0-9-]/gi, "").slice(0, 30) : "");
  let srv = null, estado = null, chamadas = [], grupos = [], selecionada = null, previaAtual = null, arquivoAtual = null;
  // Painel aberto: modelo escolhido e texto editado (preservados quando a tela é redesenhada após uma ação, como na referência).
  let painelEstado = { id: null, modelo: null, texto: null };
  const telefoneManual = {}; // telefone digitado no envio manual: SÓ em memória (nunca gravado), por chamada
  const canal = "BroadcastChannel" in window ? new BroadcastChannel(NOME_BANCO) : null;

  function esc(v) { return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function dataBR(iso) { if (!iso) return "—"; const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso); return isNaN(d) ? esc(iso) : d.toLocaleDateString("pt-BR"); }
  function horaBR(iso) { if (!iso) return "—"; const d = new Date(iso); return isNaN(d) ? esc(iso) : d.toLocaleString("pt-BR"); }
  function hhmm(iso) { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); }
  function toast(msg, erro = false) {
    const t = $("#toast"); t.textContent = msg; t.className = "toast" + (erro ? " erro" : "");
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add("oculto"), erro ? 7000 : 4000);
  }
  window.CentralUI = { toast: (m) => toast(m), // toast: usado pela página de testes
    esc, confirmar, escolher, toastErro: toast, avisar: () => avisarOutrasAbas(), recarregar: () => carregar(), atualizarDuranteFila: () => atualizarDuranteFila() };
  window.CentralUI.operadorAtual = () => (estado && estado.sessao ? estado.sessao.operador : null); // restante: Central de Disparos

  function confirmar(titulo, html, rotulo = "Confirmar", classe = "acao") {
    return new Promise((ok) => {
      $("#modal-caixa").className = "modal-caixa";
      $("#modal-caixa").innerHTML = `<h2>${esc(titulo)}</h2><div>${html}</div>
        <div class="botoes fim"><button id="m-nao" class="contorno">Cancelar</button>
        <button id="m-sim" class="${classe}">${esc(rotulo)}</button></div>`;
      $("#modal").classList.remove("oculto");
      const fim = (v) => { $("#modal").classList.add("oculto"); ok(v); };
      $("#m-nao").onclick = () => fim(false); $("#m-sim").onclick = () => fim(true);
    });
  }
  function fecharModal() { $("#modal").classList.add("oculto"); $("#modal-caixa").className = "modal-caixa"; }
  $("#modal").addEventListener("click", (ev) => { if (ev.target.id === "modal" && $("#modal-caixa").dataset.livre) fecharModal(); });
  async function executar(f, sucesso) {
    try { const r = await f(); if (sucesso) toast(typeof sucesso === "function" ? sucesso(r) : sucesso); return r; }
    catch (e) { toast(e.message, true); if (e instanceof Armazenamento.ErroConcorrencia) await carregar(); return undefined; }
  }

  /* ------------------------------------------------------------ estado geral */
  async function carregar() {
    estado = srv.estado();
    const s = estado.sessao;
    $("#dia-info").textContent = s ? `Dia ${dataBR(s.data_operacional)} · ${s.operador || "operador não informado"} · ${/^polo(\s|$)/i.test(s.polo) ? "" : "Polo "}${s.polo}${s.estacao ? " · Estação " + s.estacao : ""}` : "Nenhum turno aberto";
    $("#btn-exportar").disabled = !s; $("#btn-encerrar-dia").disabled = !s;
    $("#btn-exportar").title = s ? `Gera ${estado.nome_arquivo_dia} (indicadores, sem dados de clientes) e abre a janela do Windows para salvar` : "Abra o turno primeiro";
    const av = $("#aviso"); av.textContent = estado.aviso || ""; av.classList.toggle("oculto", !estado.aviso);
    $("#abrir-dia").classList.toggle("oculto", !!s);
    if (!s) {
      const cfg = estado.configuracao, f = $("#form-dia");
      f.operador.value ||= cfg.operador || "";
      $("#campo-polo").classList.toggle("oculto", !!cfg.polo); // polo: só se ainda não configurado (regra da referência)
      f.polo.required = !cfg.polo;
    }
    $("#importar").classList.toggle("oculto", !s || !!estado.lote_aberto);
    $("#lote").classList.toggle("oculto", !estado.lote_aberto);
    $("#historico").classList.toggle("oculto", !s && !estado.exportacoes.length);
    metricas(); historico();
    if (estado.lote_aberto) carregarChamadas(); else { chamadas = []; fecharPainel(); }
    window.CentralDisparos.atualizar(); window.CentralManual.atualizar();
    if (window.CentralPastaADMS) window.CentralPastaADMS.aoCarregar(estado); // pasta ADMS: turno recém-aberto carrega o CSV
  }
  function avisarOutrasAbas() { if (canal) canal.postMessage("mudou"); }
  function atualizarTudo() { avisarOutrasAbas(); estado = srv.estado(); metricas(); historico(); if (estado.lote_aberto) carregarChamadas(); window.CentralDisparos.atualizar(); }

  /* Durante o disparo: atualiza totais e lista, sem redesenhar o painel aberto (não apaga o que o operador está digitando). */
  function atualizarDuranteFila() { estado = srv.estado(); metricas(); if (estado.lote_aberto) { chamadas = srv.chamadas(); grupos = srv.grupos(); desenharTabela(); } }

  /* ------------------------------------------------------------ indicadores (faixa do dia) */
  /* Tempo real = lotes encerrados + lote em andamento, pela regra do encerramento (CALL única no dia, melhor resultado).
     Cada CALL conta uma vez. Nada é somado na tela: tudo vem do serviço. A exportação considera só os lotes encerrados. */
  let destaqueEncerramento = 0;
  const pct = (a, b) => (b ? Math.round(100 * a / b) : 0);
  // extra = percentual pequeno ao lado do número (mantém o rótulo curto e o cartão baixo)
  const card = (v, r, d = "", t = "", extra = "") => `<div class="metrica ${d}"${t ? ` title="${esc(t)}"` : ""}><div class="valor">${esc(v)}${extra ? ` <small>${esc(extra)}</small>` : ""}</div><div class="rotulo">${esc(r)}</div></div>`;
  function cartoes(m) {
    return card(m.chamadas_processadas, "total de chamadas", "", "CALLs distintas do dia (cada chamada conta uma vez)")
      + card(m.callbacks_realizados, "callbacks realizados", "destaque", "Percentual sobre o total de chamadas", pct(m.callbacks_realizados, m.chamadas_processadas) + "%")
      + card(m.tentativas_sem_sucesso ?? 0, "tentativas sem sucesso", "", "Registros de 'Tentativa sem sucesso'")
      + card(m.contatos_invalidos, "contatos inválidos") + card(m.sem_telefone, "sem telefone")
      + card(m.servicos_executados ?? 0, "serviços executados", "resultado", "Registrados pelo operador depois do callback")
      + card(m.ocorrencias_resolvidas ?? 0, "ocorrências resolvidas", "resultado", "Cliente confirmou que a situação foi normalizada. Percentual sobre os callbacks realizados.", pct(m.ocorrencias_resolvidas, m.callbacks_realizados) + "%")
      + card(m.pendencias_contabilizadas, "ocorrências pendentes", "", "Chamadas ainda sem callback, contato inválido ou sem telefone")
      + card(m.tentativas, "tentativas (total)");
  }
  function metricas() {
    const m = estado.metricas_tempo_real, rl = estado.resumo_lotes, a = estado.lote_em_andamento, el = $("#metricas"), nota = $("#nota-metricas-txt");
    if (!m) { el.innerHTML = ""; if (nota) nota.remove(); return; }
    const u = rl.ultimo, recente = Date.now() - destaqueEncerramento < 8000;
    const dica = (u ? `Último encerramento: lote ${u.numero} às ${hhmm(u.encerrado_em)} — ${u.chamadas} chamadas, ${u.callbacks} callbacks, ${u.pendentes} pendentes.` : "Nenhum lote encerrado hoje.")
      + (a ? ` Lote em andamento: ${a.callback_realizado}/${a.chamadas} com callback.` : "");
    el.innerHTML = card(`${rl.encerrados}/${rl.importados}`, a ? `lotes encerrados · 1 em andamento` : u ? `lotes encerrados · ✓ lote ${u.numero} ${hhmm(u.encerrado_em)}` : "lotes encerrados",
        "encerramento" + (a ? " andamento" : "") + (recente ? " pulso" : ""), dica)
      + cartoes(m);
    let p = nota;
    if (!p) { p = document.createElement("p"); p.id = "nota-metricas-txt"; p.className = "mini metricas-nota"; el.after(p); }
    p.textContent = `Incidentes: ${m.incidentes_unicos ?? 0} únicos · ${m.incidentes_com_callback ?? 0} com callback · ${m.chamadas_sem_incidente ?? 0} CALL(s) sem incidente · `
      + `${m.callbacks_sem_resolucao ?? 0} callback(s) sem resolução confirmada.`
      + (m.inclui_lote_aberto ? " Inclui o lote em andamento; a exportação considera só os lotes encerrados." : "");
  }

  function historico() {
    const lotes = estado.lotes || [], ex = estado.exportacoes || [];
    $("#historico-titulo").textContent = `Lotes do dia e exportações (${lotes.length} lote(s) · ${ex.length} exportação(ões))`;
    $("#lista-lotes").innerHTML = lotes.length ? "<ul class='lista'>" + lotes.map((l) =>
      `<li>Lote ${l.numero} · ${esc(l.arquivo_nome)} · ${l.situacao === "aberto" ? "<b>aberto</b>" : "encerrado " + horaBR(l.encerrado_em)}
       ${l.metricas ? ` · ${l.metricas.chamadas} chamadas, ${l.metricas.callback_realizado} callbacks, ${l.metricas.pendente} pendentes` : ""}</li>`).join("") + "</ul>" : "";
    $("#lista-exportacoes").innerHTML = (ex.length ? "<h3>Exportações</h3><ul class='lista'>" + ex.map((e) =>
      `<li>${esc(e.nome)} · v${e.versao}${e.definitiva ? " (definitiva)" : ""} · ${horaBR(e.exportado_em)}
        <button class="mini-botao" data-baixar="${esc(e.id)}">salvar</button>
       <div class="mini">${e.salvo ? esc(e.salvo.onde) + " em " + horaBR(e.salvo.em) : e.definitiva ? "cópia local opcional: o fechamento do dia vai para a pasta de rede" : "<b>ainda não salvo no destino</b>"}${e.contingencia && !e.salvo ? ` · cópia de contingência baixada para Downloads em ${horaBR(e.contingencia.em)} (não está no destino)` : ""}</div></li>`).join("") + "</ul>" : "")
      + window.CentralFechamento.historicoHtml()
      + `<p class="mini">Exportação manual (botão Exportar do dia): pasta <span class="caminho">${esc(N.PASTA_EXPORTACAO_SUGERIDA)}</span>. O botão Encerrar o dia grava o fechamento na pasta de rede <span class="caminho">${esc(window.CentralExportacaoRede ? window.CentralExportacaoRede.CAMINHO : "")}</span>.</p>`;
    document.querySelectorAll("[data-baixar]").forEach((b) => b.onclick = () => salvarArquivo(srv.exportacao(b.dataset.baixar)));
  }

  /* ------------------------------------------------------------ salvar a exportação: DESTINO OBRIGATÓRIO */
  /* Destino: N.PASTA_EXPORTACAO_SUGERIDA.
     LIMITE DO NAVEGADOR (Edge/Chrome, File System Access): a janela "Salvar como" não aceita um caminho escrito como pasta
     inicial; aceita só uma pasta que o usuário já selecionou. Por isso:
     1) na 1ª vez neste navegador, o operador seleciona a pasta CENTRAL DE CALLBACK (só é aceita pasta com esse nome);
     2) daí em diante a janela "Salvar como" abre SEMPRE nela, com o nome do arquivo preenchido (sem "lembrar a última pasta":
        o destino tem prioridade);
     3) depois da escolha, a Central confere se o arquivo ficou DENTRO da pasta de destino; fora dela, NÃO grava e avisa;
     4) W: inacessível / sem permissão / gravação falhou: NADA é dado como salvo; o arquivo continua guardado na Central
        (Lotes do dia e exportações > salvar) e há uma "cópia de contingência" opcional para Downloads, marcada como tal.
     Sem a função no navegador (ex.: Firefox): só a cópia de contingência, com o aviso da limitação. */
  const DESTINO = N.PASTA_EXPORTACAO_SUGERIDA, NOME_PASTA_DESTINO = "CENTRAL DE CALLBACK", CHAVE_DESTINO = "pasta_destino";
  const TIPOS_CSV = [{ description: "Arquivo CSV (Power BI)", accept: { "text/csv": [".csv"] } }];
  const nomePasta = (t) => String(t || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
  const ehPastaDestino = (h) => !!h && h.kind === "directory" && nomePasta(h.name) === NOME_PASTA_DESTINO;
  const podeDestino = () => typeof window.showSaveFilePicker === "function" && typeof window.showDirectoryPicker === "function";
  async function lerHandle(chave) { try { return await srv.arm.lerArquivo(chave); } catch (e) { return null; } }
  async function destinoGravado() {
    const h = await lerHandle(CHAVE_DESTINO);
    if (ehPastaDestino(h)) return h;
    const antiga = await lerHandle("pasta_exportacao"); // pasta inicial escolhida na 1.1.0 anterior: vale se for a de destino
    return ehPastaDestino(antiga) ? antiga : null;
  }
  /* Modal com vários botões (sem alert/confirm do navegador). Resolve com o valor do botão; cada clique é um gesto do usuário. */
  function escolher(titulo, html, botoes) {
    return new Promise((ok) => {
      $("#modal-caixa").className = "modal-caixa"; delete $("#modal-caixa").dataset.livre;
      $("#modal-caixa").innerHTML = `<h2>${esc(titulo)}</h2><div>${html}</div><div class="botoes fim">${botoes.map((b, i) =>
        `<button data-escolha="${i}" class="${b.classe || "contorno"}">${esc(b.rotulo)}</button>`).join("")}</div>`;
      $("#modal").classList.remove("oculto");
      $("#modal-caixa").querySelectorAll("[data-escolha]").forEach((b) => b.onclick = () => { fecharModal(); ok(botoes[Number(b.dataset.escolha)].valor); });
    });
  }
  const caminhoHtml = `<span class="caminho">${esc(DESTINO)}</span>`;
  /* Seleção (única) da pasta de destino. Só aceita a pasta CENTRAL DE CALLBACK. */
  async function configurarDestino() {
    const atual = await destinoGravado();
    let h;
    try { h = await window.showDirectoryPicker({ mode: "readwrite", startIn: atual || "documents" }); }
    catch (e) { return { erro: e.name === "AbortError" ? "Seleção da pasta cancelada." : "Não foi possível selecionar a pasta: " + e.message }; }
    if (!ehPastaDestino(h)) return { erro: `Pasta recusada: "${h.name}". Selecione exatamente a pasta ${NOME_PASTA_DESTINO} em ${DESTINO}.` };
    await srv.arm.gravarArquivo(CHAVE_DESTINO, h);
    toast(`Destino configurado: ${h.name}.`);
    return { h };
  }
  /* Confere se a pasta de destino está acessível (quando o navegador já tem permissão). Unidade W: desconectada = erro. */
  async function verificarDestino(dir) {
    let perm = "prompt";
    try { perm = await dir.queryPermission({ mode: "readwrite" }); } catch (e) { /* navegador sem consulta de permissão */ }
    if (perm !== "granted") return { verificado: false };
    try { await dir.keys().next(); return { verificado: true }; }
    catch (e) { return { erro: `A pasta de destino não está acessível (${e.name}: ${e.message}). A unidade W: está conectada? (Citrix/VPN/rede)` }; }
  }
  async function salvarArquivo(exp) {
    if (!exp) return null;
    if (!podeDestino()) return falhaSalvar(exp, "Este navegador não permite abrir a janela Salvar na pasta de destino. Use o Microsoft Edge ou o Google Chrome.", false);
    let dir = await destinoGravado();
    if (!dir) {
      const v = await escolher("Destino da exportação (configuração única)", `<p>Os arquivos do dia são salvos em ${caminhoHtml}.</p>
        <p>O navegador não permite que a Central abra esse caminho sozinha na primeira vez: clique em <b>Selecionar a pasta</b>, navegue até
        <b>${esc(NOME_PASTA_DESTINO)}</b> e confirme em <b>Selecionar pasta</b>. Isso é feito só uma vez neste navegador.</p>`,
        [{ valor: "nao", rotulo: "Agora não" }, { valor: "sim", rotulo: "Selecionar a pasta", classe: "acao" }]);
      if (v !== "sim") return naoSalvo(exp, "Destino não configurado.");
      const cfg = await configurarDestino();
      if (cfg.erro) return naoSalvo(exp, cfg.erro);
      dir = cfg.h;
    }
    const ver = await verificarDestino(dir);
    if (ver.erro) return falhaSalvar(exp, ver.erro, true);
    return abrirSalvar(exp, dir, false);
  }
  async function abrirSalvar(exp, dir, repetido) {
    let h;
    try { h = await window.showSaveFilePicker({ suggestedName: exp.nome, types: TIPOS_CSV, startIn: dir }); }
    catch (e) {
      if (e.name === "AbortError") return naoSalvo(exp, "Salvamento cancelado.");
      // Sem gesto recente do usuário (ex.: logo após selecionar a pasta), o navegador exige um novo clique.
      if (!repetido && (e.name === "SecurityError" || e.name === "NotAllowedError")) {
        const v = await escolher("Salvar o arquivo do dia", `<p>Clique em <b>Abrir a janela Salvar</b> para salvar <b>${esc(exp.nome)}</b> em ${caminhoHtml}.</p>`,
          [{ valor: "nao", rotulo: "Cancelar" }, { valor: "sim", rotulo: "Abrir a janela Salvar", classe: "acao" }]);
        return v === "sim" ? abrirSalvar(exp, dir, true) : naoSalvo(exp, "Salvamento cancelado.");
      }
      return falhaSalvar(exp, `A janela Salvar não abriu na pasta de destino (${e.name}: ${e.message}). A unidade W: está acessível?`, true);
    }
    let dentro = null;
    try { dentro = await dir.resolve(h); } catch (e) { dentro = null; }
    if (!dentro || dentro.length !== 1) {
      return falhaSalvar(exp, `O local escolhido não é a pasta de destino ${NOME_PASTA_DESTINO}. Nada foi gravado. (Se a janela abriu em outra pasta, a unidade W: pode estar inacessível.)`, true);
    }
    try { const w = await h.createWritable(); await w.write(new Blob([exp.conteudo], { type: "text/csv;charset=utf-8" })); await w.close(); }
    catch (e) { return falhaSalvar(exp, `Falha ao gravar ${h.name} na pasta de destino (${e.name}: ${e.message}).`, true); }
    await srv.marcarSalvo(exp.id, `salvo na pasta de destino ${NOME_PASTA_DESTINO} como ${h.name}`); atualizarTudo();
    toast(`Arquivo salvo na pasta ${NOME_PASTA_DESTINO}: ${h.name}.`);
    return "salvo";
  }
  function naoSalvo(exp, motivo) {
    toast(`${motivo} O arquivo NÃO foi salvo; ele continua guardado na Central (Lotes do dia e exportações > salvar).`, true);
    return null;
  }
  /* Falha: nada é dado como salvo e nada é descartado. Contingência só por escolha explícita (e registrada como tal). */
  async function falhaSalvar(exp, motivo, podeRepetir) {
    const v = await escolher("Arquivo NÃO salvo no destino", `<p><b>${esc(exp.nome)}</b> não foi salvo em ${caminhoHtml}.</p><p>${esc(motivo)}</p>
      <p class="mini">O arquivo continua guardado na Central (Lotes do dia e exportações &gt; salvar). A cópia de contingência vai para a pasta
      Downloads e <b>não</b> conta como entregue no destino: mova-a para a pasta CENTRAL DE CALLBACK quando a unidade W: voltar.</p>`,
      [{ valor: "fechar", rotulo: "Fechar" }, { valor: "contingencia", rotulo: "Baixar cópia de contingência" },
        ...(podeRepetir ? [{ valor: "repetir", rotulo: "Tentar de novo", classe: "acao" }] : [])]);
    if (v === "repetir") return salvarArquivo(exp);
    if (v === "contingencia") {
      const url = URL.createObjectURL(new Blob([exp.conteudo], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a"); a.href = url; a.download = exp.nome; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      await srv.marcarContingencia(exp.id); atualizarTudo();
      toast(`Cópia de contingência enviada para Downloads (${exp.nome}). Ela NÃO está no destino W:.`, true);
      return "contingencia";
    }
    toast("O arquivo NÃO foi salvo; ele continua guardado na Central.", true);
    return null;
  }

  /* ------------------------------------------------------------ turno */
  $("#form-dia").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    if (await executar(() => srv.abrirSessao(f.polo.value, f.operador.value.trim().toUpperCase()), "Turno aberto.")) { avisarOutrasAbas(); carregar(); }
  });
  $("#btn-exportar").onclick = async () => {
    if (estado.lote_aberto) {
      const a = estado.lote_em_andamento;
      if (!await confirmar("Exportar do dia", `<p>O lote aberto (<b>${a.chamadas}</b> chamadas, ${a.callback_realizado} callbacks) <b>não entra</b> no arquivo:
        a exportação considera só os lotes encerrados.</p><p class="mini">Para incluí-lo, cancele, encerre o lote e exporte de novo.</p>`, "Exportar mesmo assim")) return;
    }
    const r = await executar(() => srv.exportar());
    if (!r) return;
    avisarOutrasAbas(); carregar();
    await salvarArquivo(srv.exportacao(r.id));
  };
  $("#btn-encerrar-dia").onclick = async () => {
    if (estado.lote_aberto) { toast("Encerre e limpe o lote aberto antes de encerrar o dia.", true); return; }
    const m = estado.metricas_dia;
    if (!await confirmar("Encerrar o dia", `<p>Será gerado o fechamento do dia (${m.chamadas_processadas} chamadas e ${m.callbacks_realizados} callbacks) e exportado para a <b>pasta de rede</b>.
        Depois disso o turno não recebe mais lotes.</p>`, "Encerrar e exportar para a pasta de rede")) return;
    const operadorDia = estado.sessao.operador, dataDia = estado.sessao.data_operacional;
    const r = await executar(() => srv.encerrarDia());
    if (!r) return;
    avisarOutrasAbas(); carregar();
    await window.CentralFechamento.concluirEncerramento(dataDia, operadorDia);
  };

  /* ------------------------------------------------------------ importação */
  const lerBytes = (arquivo) => new Promise((ok, falha) => {
    const fr = new FileReader(); fr.onload = () => ok(new Uint8Array(fr.result)); fr.onerror = () => falha(new Error("Não foi possível ler o arquivo: " + (fr.error && fr.error.message))); fr.readAsArrayBuffer(arquivo);
  });
  $("#arquivo").addEventListener("change", async (ev) => {
    arquivoAtual = ev.target.files[0]; previaAtual = null; $("#previa").innerHTML = "";
    if (!arquivoAtual) return;
    try {
      previaAtual = srv.previa(await lerBytes(arquivoAtual));
      const r = previaAtual.resumo, est = r.por_estado_inicial || {}, am = previaAtual.amostra || [];
      $("#previa").innerHTML = `<h3>Prévia</h3>
        <p><b>${r.chamadas_validas}</b> chamada(s) válida(s) de ${r.linhas_lidas} linha(s) ·
        pendentes ${est.pendente || 0} · sem telefone ${est.sem_telefone || 0} · contato inválido ${est.contato_invalido || 0}<br>
        <span class="mini">Separador “${esc(r.separador === "\t" ? "tabulação" : r.separador)}” · ${esc(r.codificacao)} · ${r.colunas_reconhecidas} colunas reconhecidas
        ${r.linhas_antes_do_cabecalho ? `· ${r.linhas_antes_do_cabecalho} linha(s) de filtro do ADMS antes do cabeçalho (ignoradas)` : ""}
        ${r.colunas_ausentes.length ? `· colunas não presentes no arquivo (não impedem a importação): ${esc(r.colunas_ausentes.join(", "))}` : ""}</span><br>
        ${r.calls_repetidas_no_arquivo ? `${r.calls_repetidas_no_arquivo} CALL repetida(s) no arquivo (contadas uma vez) · ` : ""}
        ${r.calls_ja_vistas_hoje ? `<b>${r.calls_ja_vistas_hoje} CALL(s) já vistas hoje</b> em lote anterior (não contam de novo) · ` : ""}
        ${r.arquivo_ja_importado_hoje ? "<b>Este arquivo já foi importado hoje.</b>" : ""}</p>
        ${r.agrupamento ? `<p class="mini">Incidentes: <b>${r.agrupamento.incidentes_distintos}</b> distintos${r.agrupamento.comunicacoes_sem_incidente ? ` + ${r.agrupamento.comunicacoes_sem_incidente} comunicação(ões) sem incidente` : ""}
          · <b>${r.agrupamento.incidentes_com_multiplas_comunicacoes}</b> com múltiplas comunicações (${r.agrupamento.comunicacoes_nesses_incidentes} comunicações)
          · ${r.agrupamento.grupos_com_indicacao_de_risco} com indicação de risco · a lista terá <b>${r.agrupamento.linhas_na_tabela}</b> linha(s).</p>` : ""}
        ${previaAtual.erros.length ? `<div class="erros">${previaAtual.erros.map((e) => `Linha ${e.linha}: ${esc(e.mensagem)}`).join("<br>")}</div>` : ""}
        ${am.length ? `<details class="amostra"><summary>Ver os primeiros ${am.length} registro(s) de ${r.chamadas_validas}</summary>
          <div class="tabela-rolagem previa-registros"><table><thead><tr><th>Linha</th><th>CALL</th><th>Horário</th><th>Incidente</th><th>Motivo</th><th>Situação</th></tr></thead><tbody>
          ${am.map((x) => `<tr><td>${x.linha}</td><td>${esc(x.call_id)}</td><td>${esc(N.formatarDataHora(x.horario_call))}</td><td>${esc(x.incidente || "—")}</td>
            <td>${esc(x.motivo || "—")}</td><td><span class="etq e-${x.estado}">${ESTADOS[x.estado] || esc(x.estado)}</span></td></tr>`).join("")}
          </tbody></table></div></details>` : ""}
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

  /* ------------------------------------------------------------ lote (lista de OS) */
  function carregarChamadas() {
    chamadas = srv.chamadas(); grupos = srv.grupos();
    const l = estado.lote_aberto, a = estado.lote_em_andamento, multi = grupos.filter((g) => g.qtd > 1).length;
    $("#lote-titulo").textContent = `Lote ${l.numero} · ${l.arquivo_nome}`;
    $("#resumo-lote").textContent = `${a.chamadas} chamadas em ${grupos.length} linha(s)${multi ? ` (${multi} incidente(s) com várias comunicações)` : ""} · ${a.pendente} pendentes · ${a.callback_realizado} callbacks · ${a.servico_executado} serviços executados · ${a.resolvida} resolvidas · ${a.contato_invalido} contatos inválidos · ${a.sem_telefone} sem telefone · ${a.tentativas} tentativas`;
    montarFiltroOcorrencia();
    desenharTabela();
    if (selecionada) abrirChamada(selecionada, painelEstado.id === selecionada ? painelEstado.modelo : null);
  }
  function etiquetaSugestao(c) {
    const s = N.sugerirMensagem(c), m = N.modelos().find((x) => x.codigo === s.codigo);
    if (!m || s.origem === "generico") return c.tipo_ocorrencia === "risco_de_vida" ? '<span class="etq risco" title="sigla RV no ADMS">risco de vida</span>' : "";
    return `<span class="etq ${s.risco ? "risco" : "e-sem_telefone"}" title="Mensagem sugerida: ${esc(m.nome)} — ${esc(N.descreverSugestao(s))}">${esc(m.nome)}${s.origem === "texto" ? " ·txt" : ""}</span>`;
  }
  function celulaIncidente(g, c) {
    const risco = g.avisos.find((a) => a.tipo === "risco"), suspeitas = g.avisos.filter((a) => a.tipo === "possivel");
    let html = `<b>${esc(c.incidente || "sem incidente")}</b>`;
    if (g.qtd > 1) {
      const dica = [g.avisos[0].texto, ...suspeitas.map((a) => a.texto), "Clique para ver as comunicações."].join("\n");
      html += ` <a href="#" class="chip chip-qtd${suspeitas.length ? " chip-suspeita" : ""}" data-ver="${c.id}" title="${esc(dica)}">${g.qtd} com.</a>`;
    }
    if (risco) html += ` <span class="chip chip-risco" title="${esc(risco.texto + (risco.detalhe ? "\n" + risco.detalhe : ""))}">⚠</span>`;
    return html;
  }
  /* Situação: um único estado do callback + marcas independentes de serviço executado e ocorrência resolvida. */
  function situacao(c) {
    const cb = c.estado === "callback_realizado";
    const base = cb && c.resolvida_em
      ? `<span class="etq e-resolvida" title="Callback realizado · ocorrência resolvida com sucesso (${hhmm(c.resolvida_em)})">Resolvida</span>`
      : `<span class="etq e-${c.estado}">${ESTADOS[c.estado]}</span>`;
    return base + (cb && c.servico_executado_em ? `<span class="marca-res ok" title="Serviço executado (${hhmm(c.servico_executado_em)})">Serv.</span>` : "");
  }
  /* Bolinha de resolução na linha (age sobre a comunicação mostrada na linha). Três estados, distintos também por SÍMBOLO e
     BORDA (não só pela cor): ○ tracejada = indisponível (sem callback); ○ = pode registrar; ✓ verde cheia = resolvida. */
  function bolinha(c, g) {
    const cb = c.estado === "callback_realizado", ok = cb && !!c.resolvida_em;
    const alvo = g && g.qtd > 1 ? " (comunicação principal deste incidente)" : "";
    const [classe, simbolo, dica] = ok
      ? ["resolvida", "✓", `Ocorrência resolvida com sucesso às ${hhmm(c.resolvida_em)}${alvo}. Clique para desfazer (corrigir).`]
      : cb ? ["pronta", "", `Clique para registrar: ocorrência resolvida com sucesso${alvo}.`]
        : ["bloqueada", "", `Resolução: só depois do callback realizado${alvo}.`];
    return `<button type="button" class="bolinha ${classe}" data-bolinha="${c.id}" title="${esc(dica)}" aria-label="${esc(dica)}"
      aria-pressed="${ok}"${!cb ? ' aria-disabled="true"' : ""}>${simbolo}</button>`;
  }
  function confere(c, f) {
    if (!f) return true;
    if (f === "servico") return c.estado === "callback_realizado" && !!c.servico_executado_em;
    if (f === "resolvida") return c.estado === "callback_realizado" && !!c.resolvida_em;
    if (f === "risco") return N.indicacaoRisco(c).nivel >= 1;
    return c.estado === f;
  }
  /* REGIONAIS E MUNICÍPIOS (js/localidades.js + js/filtro-regionais.js): seleção múltipla que filtra SÓ a exibição das
     chamadas já carregadas do lote aberto. Não relê o CSV, não remove nada da base e não muda métricas: o resumo do lote
     continua com a base completa; o resumo do filtro usa a mesma conta do lote (srv.metricasLote) sobre as chamadas da
     seleção. Instância PRÓPRIA do envio individual (o envio em lote tem a sua). Escolha lembrada só neste navegador. */
  /* FILTRO POR DATA DO INCIDENTE (N.dataDoIncidente / N.conferirFiltroData). Só visualização e seleção: não relê o CSV, não
     altera nem remove registros e não muda métricas. Fica SÓ em memória: ao abrir a Central (ou F5) volta sempre para HOJE.
     É o MESMO filtro do envio em lote (js/central-disparos.js): mudar lá ou aqui vale para os dois. */
  let filtroData = N.filtroDataPadrao();
  const camposFiltroData = (f = filtroData) => (f.modo === "hoje" ? { de: N.hojeLocal(), ate: N.hojeLocal() } : f.modo === "periodo" ? { de: f.de, ate: f.ate } : { de: "", ate: "" });
  function definirFiltroData(f) {
    filtroData = N.normalizarFiltroData(f);
    desenharFiltroData();
    if (estado && estado.lote_aberto) desenharTabela();
    if (window.CentralDisparos && window.CentralDisparos.aoMudarFiltroData) window.CentralDisparos.aoMudarFiltroData();
  }
  window.CentralUI.filtroData = { obter: () => ({ ...filtroData }), definir: definirFiltroData, campos: () => camposFiltroData(),
    descrever: () => N.descreverFiltroData(filtroData), confere: (dia) => N.conferirFiltroData(dia, filtroData) };
  function desenharFiltroData() {
    const v = camposFiltroData();
    $("#fd-de").value = v.de; $("#fd-ate").value = v.ate;
    for (const [id, modo] of [["#fd-hoje", "hoje"], ["#fd-todas", "todas"], ["#fd-sem-data", "sem_data"], ["#fd-aplicar", "periodo"]]) {
      const b = $(id); b.classList.toggle("ativo", filtroData.modo === modo); b.setAttribute("aria-pressed", String(filtroData.modo === modo));
    }
  }
  $("#fd-aplicar").onclick = () => {
    const de = $("#fd-de").value, ate = $("#fd-ate").value;
    if (de && ate && de > ate) { toast("A data inicial é posterior à data final. Corrija o período e aplique de novo.", true); return; }
    definirFiltroData({ modo: "periodo", de, ate });
  };
  $("#fd-hoje").onclick = () => definirFiltroData({ modo: "hoje" });
  $("#fd-todas").onclick = () => definirFiltroData({ modo: "todas" });
  $("#fd-sem-data").onclick = () => definirFiltroData({ modo: "sem_data" });
  for (const id of ["#fd-de", "#fd-ate"]) $(id).addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); $("#fd-aplicar").click(); } });
  desenharFiltroData();
  /* PREENCHER DATAS AUSENTES: lê o CSV atual da pasta ADMS, mostra a prévia (nada gravado) e só grava após a confirmação.
     Grava SOMENTE horario_call e recebido_adms vazios (srv.preencherDatas, uma transação). */
  let preenchendo = false;
  $("#fd-preencher").onclick = async () => {
    if (preenchendo) return;
    preenchendo = true; $("#fd-preencher").disabled = true;
    try {
      let lido;
      try { lido = await window.CentralPastaADMS.lerArquivoAtual(); } catch (e) { toast("Não foi possível ler o CSV da pasta ADMS: " + e.message, true); return; }
      let p;
      try { p = srv.previaDatas(lido.bytes); } catch (e) { toast("Não foi possível analisar o CSV: " + e.message, true); return; }
      const li = (k, v, t) => `<li data-conta="${k}"><b>${v}</b> ${esc(t)}</li>`;
      const tabela = `<ul class="lista">${li("ausentes", p.com_datas_ausentes, `registro(s) com data ausente no lote ${p.lote_numero} (de ${p.chamadas_no_lote}): ${p.sem_horario_call} sem Horário da call, ${p.sem_recebido_adms} sem Recebido ADMS`)}
        ${li("horario", p.recebem_horario_call, "poderão receber Horário da call")}${li("recebido", p.recebem_recebido_adms, "poderão receber Recebido ADMS")}
        ${li("atualizar", p.registros_a_atualizar, "registro(s) serão atualizados")}${li("sem_correspondencia", p.sem_correspondencia, "sem correspondência no CSV (CALL não encontrada): não alterados")}
        ${li("ambiguas", p.ambiguas, "correspondência ambígua (datas diferentes para a mesma CALL ou incidente divergente): não alterados")}
        ${li("sem_data_no_csv", p.sem_data_no_csv, "encontrados, mas sem data válida no CSV: continuam vazios")}</ul>
        <p class="mini">Arquivo: ${esc(lido.nome)} · ${p.linhas_no_csv} linha(s) · colunas de data: ${esc(p.colunas_de_data.horario_call || "Horário da call AUSENTE")} / ${esc(p.colunas_de_data.recebido_adms || "Recebido ADMS AUSENTE")}.
        Nada é inserido, removido ou sobrescrito. Estado, tentativas, callbacks, WhatsApp, observações e histórico não mudam. A data da importação nunca é usada.</p>`;
      if (!p.registros_a_atualizar) { await escolher("Preencher datas ausentes — prévia", tabela + "<p><b>Nada a preencher com este arquivo.</b> Nenhum registro foi alterado.</p>", [{ valor: 1, rotulo: "Fechar", classe: "acao" }]); return; }
      if (!await confirmar("Preencher datas ausentes — prévia", tabela, `Gravar datas em ${p.registros_a_atualizar} registro(s)`)) { toast("Cancelado: nenhum registro foi alterado."); return; }
      const r = await executar(() => srv.preencherDatas(lido.bytes, p.sha256, p.lote_id));
      if (!r) return;
      avisarOutrasAbas(); carregar();
      await escolher("Datas preenchidas", `<ul class="lista">${li("gravados", r.gravados, "registro(s) atualizados")}${li("horario", r.recebem_horario_call, "receberam Horário da call")}
        ${li("recebido", r.recebem_recebido_adms, "receberam Recebido ADMS")}${li("sem_correspondencia", r.sem_correspondencia, "sem correspondência (não alterados)")}
        ${li("ambiguas", r.ambiguas, "ambíguos (não alterados)")}${li("sem_data_no_csv", r.sem_data_no_csv, "sem data válida no CSV (continuam vazios)")}
        ${li("ainda_sem_horario", r.ainda_sem_horario_call, "registro(s) do lote ainda sem Horário da call")}${li("ainda_sem_recebido", r.ainda_sem_recebido_adms, "registro(s) do lote ainda sem Recebido ADMS")}</ul>`,
        [{ valor: 1, rotulo: "Fechar", classe: "acao" }]);
    } finally { preenchendo = false; $("#fd-preencher").disabled = false; }
  };
  /* Célula "Data e hora": horário da call; sem ele, a data de RECEBIMENTO no ADMS, marcada como tal. */
  const DICA_RECEBIDO = "Horário da call vazio no ADMS: esta é a data de RECEBIMENTO no ADMS (Recebido_Adms), não necessariamente a da ocorrência.";
  function celulaData(c, di) {
    if (di.origem === "recebido_adms") return `<td class="data-hora" title="${esc(DICA_RECEBIDO)}">${esc(N.formatarDataHora(di.iso))} <span class="etq e-recebido">receb.</span></td>`;
    return `<td class="data-hora"${di.dia ? "" : ' title="Sem data identificada no ADMS (Horário da call e Recebido ADMS vazios ou em formato não reconhecido)"'}>${esc(N.formatarDataHora(c.horario_call || di.iso))}</td>`;
  }

  const L = window.Localidades, CHAVE_REGIONAIS = "central-filtro-regionais";
  let regionaisSalvas = [];
  try { regionaisSalvas = JSON.parse(localStorage.getItem(CHAVE_REGIONAIS) || "[]"); } catch (e) { regionaisSalvas = []; }
  const filtroRegionais = window.FiltroRegionais.criar({ id: "fr-individual", rotulo: "Regionais e municípios do envio individual", inicial: regionaisSalvas,
    aoMudar: (s) => { try { localStorage.setItem(CHAVE_REGIONAIS, JSON.stringify([...s])); } catch (e) { /* só não lembra */ } if (estado && estado.lote_aberto) desenharTabela(); } });
  filtroRegionais.montar($("#filtro-regionais"));
  window.CentralUI.filtroRegionais = filtroRegionais;
  /* TIPO DE OCORRÊNCIA (envio individual): mesmas opções e mesmo critério do envio em lote — o nome do modelo sugerido para a
     comunicação principal do incidente (srv.incidentesParaDisparo / CentralDisparos.opcoesOcorrencia). Só filtra a exibição:
     não reclassifica, não grava e não altera o lote. A escolha fica só em memória. */
  const ocorrenciaPorGrupo = () => new Map(srv.incidentesParaDisparo().map((x) => [x.chave, x.ocorrencia]));
  function montarFiltroOcorrencia() {
    const sel = $("#filtro-ocorrencia"), atual = sel.value, ops = window.CentralDisparos.opcoesOcorrencia(srv.incidentesParaDisparo());
    sel.innerHTML = `<option value="">Todas as ocorrências</option>` + ops.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join("");
    sel.value = ops.includes(atual) ? atual : "";
  }
  /* Localidade de cada INCIDENTE (todas as comunicações juntas, a principal primeiro): uma comunicação vazia ou sem nome não
     tira o incidente da regional (js/localidades.js, classificarIncidente). Só leitura: nada é gravado. */
  const localDoGrupo = (g) => L.classificarIncidente(g.membros.map((c) => c.localizacao));
  /* Linha azul: totais das chamadas da seleção (mesma conta do lote) + aviso dos incidentes que não entram em nenhuma regional. */
  function resumoFiltro(sel, locais) {
    const el = $("#resumo-filtro"), fora = grupos.filter((g) => locais.get(g.chave).status !== "ok").length;
    const nota = fora ? ` · ${fora} incidente(s) fora das regionais (desconhecida, não reconhecida, divergência ou fora de Sergipe): veja "Fora das regionais" no filtro` : "";
    if (!sel.size) { el.textContent = nota ? nota.slice(3) : ""; el.classList.toggle("oculto", !nota); return; }
    const lista = grupos.filter((g) => L.confereIncidente(locais.get(g.chave), sel)).flatMap((g) => g.membros), m = srv.metricasLote(lista);
    el.textContent = `Filtro ${L.descrever(sel)}: ${m.chamadas} chamadas · ${m.pendente} pendentes · ${m.callback_realizado} callbacks · ${m.servico_executado} serviços executados · ${m.resolvida} resolvidas · ${m.contato_invalido} contatos inválidos · ${m.sem_telefone} sem telefone · ${m.tentativas} tentativas${nota}`;
    el.classList.remove("oculto");
  }
  function desenharTabela() {
    const f = $("#filtro-estado").value, b = $("#busca").value.trim().toUpperCase(), sel = filtroRegionais.selecao();
    const casaOutros = (c) => confere(c, f) && (!b || [c.call_id, c.incidente, c.nome, c.localizacao].some((x) => (x || "").toUpperCase().includes(b)));
    const locais = new Map(grupos.map((g) => [g.chave, localDoGrupo(g)]));
    resumoFiltro(sel, locais);
    const datas = new Map(grupos.map((g) => [g.chave, N.dataDoIncidente(g)])), hoje = N.hojeLocal();
    const naData = (g) => N.conferirFiltroData(datas.get(g.chave).dia, filtroData, hoje);
    const oc = $("#filtro-ocorrencia").value, ocs = oc ? ocorrenciaPorGrupo() : null;
    const lista = grupos.filter((g) => naData(g) && (!ocs || ocs.get(g.chave) === oc) && L.confereIncidente(locais.get(g.chave), sel) && g.membros.some(casaOutros));
    // Contagens do filtro de regionais: incidentes por município com TODOS os outros filtros aplicados (data, ocorrência, situação, pesquisa).
    const cont = new Map();
    for (const g of grupos) {
      if (!naData(g) || (ocs && ocs.get(g.chave) !== oc)) continue;
      if (!g.membros.some(casaOutros)) continue;
      for (const k of locais.get(g.chave).chaves) cont.set(k, (cont.get(k) || 0) + 1);
    }
    filtroRegionais.atualizar(cont);
    infoFiltroData(datas, hoje, lista);
    const idsSel = selecionada ? (grupos.find((g) => g.membros.some((m) => m.id === selecionada)) || { membros: [] }).membros.map((m) => m.id) : [];
    const rd = N.resumoFiltroData([...datas.values()].map((d) => d.dia), filtroData, hoje);
    const vazio = rd.no_filtro === 0 && rd.total
      ? `Nenhum incidente em ${esc(N.descreverFiltroData(filtroData, hoje))}.${rd.outras_datas ? ` ${rd.outras_datas} em outras datas.` : ""}${rd.sem_data && filtroData.modo !== "sem_data" ? ` ${rd.sem_data} sem data identificada.` : ""} Use <b>Todas as datas</b> ou escolha outro período.`
      : "Nenhuma ocorrência neste filtro.";
    $("#linhas").innerHTML = lista.map((g) => {
      const c = g.principal, tel = c.telefones.find((t) => t.numero), di = datas.get(g.chave);
      const feitos = g.membros.filter((m) => m.estado === "callback_realizado").length, at = srv.atendimentoDoIncidente(g.chave);
      return `<tr data-id="${c.id}" data-call="${esc(c.call_id)}" data-grupo="${esc(g.chave)}" class="${idsSel.includes(c.id) ? "selecionada" : ""}${at || c.estado === "callback_realizado" ? " linha-callback" : ""}${g.risco >= 1 ? " linha-risco" : ""}">
        <td class="c-inc">${celulaIncidente(g, c)}${c.ja_vista_no_dia ? ' <span class="mini" title="Apareceu em lote anterior do dia">↺</span>' : ""}</td>
        ${celulaData(c, di)}
        <td class="c-motivo" title="${esc(c.motivo || "")}">${esc(c.motivo || "—")}${etiquetaSugestao(c)}</td>
        <td class="c-cliente" title="${esc(c.nome || "")}">${esc(c.nome || "—")}</td>
        <td class="c-tel">${tel ? esc(N.formatarTelefone(tel.numero)) + (tel.requer_confirmacao ? ' <span class="mini" title="Telefone achado no comentário: confirmar antes de usar">*</span>' : "") : "—"}</td>
        <td class="c-local" title="${esc(c.localizacao || "")}">${esc(N.resumirLocalizacao(c.localizacao) || "—")}</td>
        <td class="c-num">${g.qtd > 1 ? g.membros.reduce((s, x) => s + x.tentativas.length, 0) : c.tentativas.length}</td>
        <td class="c-sit">${at && c.estado !== "callback_realizado" ? `<span class="etq e-callback_realizado" title="Callback realizado por ${esc(at.operador)} em ${esc(horaBR(at.em))}">Já atendido · ${esc(at.operador)}</span>` : situacao(c)}${c.whatsapp_aberto_em && c.estado === "pendente" ? ` <span class="mini" title="WhatsApp aberto${c.whatsapp_manual ? " (envio manual)" : ""}">WA</span>` : ""}${g.qtd > 1 ? ` <span class="mini" title="comunicações deste incidente com callback">${feitos}/${g.qtd}</span>` : ""}</td>
        <td class="c-acoes">${bolinha(c, g)}<button class="mini-botao" data-abrir-linha="${c.id}">Abrir</button></td></tr>`;
    }).join("") || `<tr><td colspan="9" class="mini">${vazio}</td></tr>`;
  }
  /* Linha de informação do filtro por data: o que está na tela e o que ficou de fora (nada é escondido sem aviso). */
  function infoFiltroData(datas, hoje, lista) {
    const dias = [...datas.values()], r = N.resumoFiltroData(dias.map((d) => d.dia), filtroData, hoje);
    const semData = srv.chamadasSemData(), bp = $("#fd-preencher");
    bp.classList.toggle("oculto", !semData || !window.CentralPastaADMS);
    bp.textContent = `Preencher datas ausentes (${semData})`;
    const soRecebido = lista.filter((g) => datas.get(g.chave).origem === "recebido_adms").length;
    $("#fd-sem-data").textContent = `Sem data (${r.sem_data})`;
    $("#fd-info").textContent = `Exibindo: ${N.descreverFiltroData(filtroData, hoje)} · ${lista.length} incidente(s)`
      + (filtroData.modo !== "todas" && r.outras_datas ? ` · ${r.outras_datas} em outras datas` : "")
      + (filtroData.modo !== "todas" && filtroData.modo !== "sem_data" && r.sem_data ? ` · ${r.sem_data} sem data (fora do filtro)` : "")
      + (soRecebido ? ` · ${soRecebido} com data de recebimento no ADMS (sem Horário da call)` : "");
  }
  $("#filtro-estado").onchange = desenharTabela; $("#busca").oninput = desenharTabela; $("#filtro-ocorrencia").onchange = desenharTabela;
  $("#linhas").addEventListener("click", (ev) => {
    const bol = ev.target.closest("[data-bolinha]");
    if (bol) { ev.stopPropagation(); clicarBolinha(Number(bol.dataset.bolinha), bol); return; }
    const ver = ev.target.closest("[data-ver]");
    if (ver) { ev.preventDefault(); abrirChamada(Number(ver.dataset.ver)); const t = $("#painel .comunicacoes"); if (t) t.scrollIntoView({ block: "start" }); return; }
    const tr = ev.target.closest("tr[data-id]"); if (tr) abrirChamada(Number(tr.dataset.id));
  });

  $("#btn-encerrar-lote").onclick = async () => {
    const a = estado.lote_em_andamento;
    if (!await confirmar("Encerrar e limpar o lote", `<p>As métricas deste lote serão somadas ao dia:</p>
        <p><b>${a.chamadas}</b> chamadas · <b>${a.callback_realizado}</b> callbacks · ${a.servico_executado} serviços executados · ${a.resolvida} resolvidas ·
        <b>${a.pendente}</b> pendências · ${a.sem_telefone} sem telefone · ${a.contato_invalido} contatos inválidos · ${a.tentativas} tentativas</p>
        <p><b>Os dados das chamadas (nomes, telefones, endereços, comentários) serão apagados</b> e não poderão ser recuperados.
        Pendências deste lote ficam contabilizadas como pendências do dia.</p>
        ${srv.pendentesConfirmacao().length ? `<p><b>${srv.pendentesConfirmacao().length} envio(s) não confirmado(s)</b> ficarão sem contar como callback.</p>` : ""}`, "Encerrar e limpar", "perigo")) return;
    const numero = estado.lote_aberto.numero;
    const r = await executar(() => srv.encerrarLote(), (x) => `✓ Lote ${numero} encerrado: ${x.metricas_lote.chamadas} chamadas, ${x.metricas_lote.callback_realizado} callbacks. Métricas preservadas; dados das chamadas apagados.`);
    if (r) { selecionada = null; for (const k of Object.keys(telefoneManual)) delete telefoneManual[k]; destaqueEncerramento = Date.now(); avisarOutrasAbas(); carregar(); }
  };

  /* ------------------------------------------------------------ chamada (painel lateral) */
  function fecharPainel() { $("#painel").classList.add("oculto"); selecionada = null; desenharTabela(); }
  function abrirChamada(id, modelo = null) {
    selecionada = id;
    let d;
    try { d = srv.detalhe(id, modelo); } catch (e) { toast(e.message, true); fecharPainel(); return; }
    desenharTabela();
    const p = $("#painel"); p.classList.remove("oculto");
    const feito = d.estado === "callback_realizado", atHist = srv.historicoDoIncidente(N.chaveIncidente(d)), sub = (N.SUBTIPOS[d.subtipo || ""] || {}).rotulo;
    const viaDisparo = feito && !!d.callback_telefone, podeWa = (n) => !feito || (viaDisparo && n !== d.callback_telefone); // envio a OUTRO contato após o disparo
    const mesmo = painelEstado.id === d.id && painelEstado.modelo === d.modelo && painelEstado.texto != null;
    const texto = mesmo ? painelEstado.texto : d.mensagem;
    const botaoRes = (tipo, rotulo, quando) => quando
      ? `<span class="feito" title="Registrado em ${esc(horaBR(quando))}">✓ ${rotulo} (${hhmm(quando)})</span> <button class="link-botao" data-desfazer="${tipo}" title="Desfazer este registro (correção)">desfazer</button>`
      : `<button class="mini-botao verde" data-resultado="${tipo}">✓ ${rotulo}</button>`;
    p.innerHTML = `<button class="fechar" id="p-fechar">Fechar</button>
      <h2><b>${esc(d.incidente || "Sem incidente")}</b> ${situacao(d)}</h2>
      ${d.grupo.qtd > 1 ? `<p class="mini"><b>Comunicação ${d.grupo.posicao} de ${d.grupo.qtd}</b> do ${esc(d.grupo.incidente)}${d.id === d.grupo.principal_id ? " (principal)" : ""} · ${esc(d.call_id)}</p>` : `<p class="mini">${esc(d.call_id)}</p>`}
      ${d.grupo.avisos.map((a) => `<div class="aviso-grupo aviso-${a.tipo}">${esc(a.texto)}${a.detalhe ? `<div class="mini">${esc(a.detalhe)}</div>` : ""}</div>`).join("")}
      ${d.risco.nivel === 1 ? `<div class="aviso-grupo aviso-risco">Indício de risco nesta comunicação: ${esc(d.risco.origem)}</div>` : ""}
      ${d.ja_vista_no_dia ? `<p class="mini">Esta CALL apareceu em lote anterior do dia (situação: ${esc(ESTADOS[d.estado_anterior_no_dia] || "—")}). Ela conta uma vez no dia.</p>` : ""}
      <dl class="dl"><dt>Motivo</dt><dd>${esc(d.motivo || "—")} · ${esc(d.submotivos || "")}</dd>
        <dt>Subtipo</dt><dd>${esc(sub || "não identificado")}</dd>
        <dt>Cliente</dt><dd>${esc(d.nome || "—")}</dd><dt>UC</dt><dd>${esc(d.uc || "—")}</dd>
        <dt>Localização</dt><dd>${esc(d.localizacao || "—")}</dd><dt>Comentário</dt><dd>${esc(d.comentario || "—")}</dd>
        <dt>Data e hora</dt><dd>${esc(N.formatarDataHora(d.horario_call))} <span class="mini">(horário da call no ADMS${d.horario_call ? "" : ": vazio ou não reconhecido"})</span></dd>
        ${!d.horario_call && d.recebido_adms ? `<dt>Recebido ADMS</dt><dd>${esc(N.formatarDataHora(d.recebido_adms))} <span class="mini">(data de recebimento no ADMS, não necessariamente a da ocorrência)</span></dd>` : ""}
        ${d.incidente_pai ? `<dt>Incidente pai</dt><dd>${esc(d.incidente_pai)}</dd>` : ""}</dl>
      ${d.grupo.qtd > 1 ? `<h3>Comunicações do incidente (${d.grupo.qtd})</h3>
        <div class="tabela-rolagem rolagem-curta"><table class="comunicacoes"><thead><tr><th>Data e hora</th><th>CALL</th><th>Motivo / submotivo</th><th>Situação</th><th></th></tr></thead><tbody>
        ${d.grupo.membros.map((m, i) => `<tr class="${m.id === d.id ? "selecionada" : ""}"><td>${esc(N.formatarDataHora(m.horario_call))}</td>
          <td>${esc(m.call_id)}${i === 0 ? ' <span class="mini">principal</span>' : ""}</td>
          <td>${esc(m.motivo || "—")} · ${esc(m.submotivos || "")}${m.risco.nivel ? ` <span class="etq risco" title="${esc(m.risco.origem)}">${m.risco.nivel === 2 ? "risco" : "indício"}</span>` : ""}</td>
          <td><span class="etq e-${m.estado}">${ESTADOS[m.estado]}</span></td>
          <td>${m.id === d.id ? '<span class="mini">aberta</span>' : `<button class="mini-botao" data-abrir="${m.id}">Abrir</button>`}</td></tr>`).join("")}
        </tbody></table></div>` : ""}
      ${atHist.length ? `<h3>Histórico do incidente</h3><ul class="lista mini">${atHist.map((r) => `<li><b>${esc(r.operador)}</b> · ${horaBR(r.em)} · ${r.tipo === "cancelado" ? "envio cancelado" : `callback ${esc(r.status)} (${esc(MEIOS[r.meio] || r.meio)})${r.resolvido_em ? " · resolvido" : ""}`}</li>`).join("")}</ul>` : ""}
      <h3>Telefones</h3>
      ${d.telefones.length ? d.telefones.map((t) => `<div class="telefone"><div><b>${esc(N.formatarTelefone(t.numero))}</b> <span class="mini">${esc(t.tipo)}${t.requer_confirmacao ? " · achado no comentário: confirme" : ""}</span></div>
        <div>${t.tipo === "celular" && t.numero && podeWa(t.numero) ? `<button class="acao" data-wa="${esc(t.numero)}" data-conf="${t.requer_confirmacao ? 1 : 0}">Abrir WhatsApp Web</button>` : ""}</div></div>`).join("")
        : '<p class="mini">O ADMS não trouxe telefone. Procure o cadastro do cliente no incidente e use o <b>Envio manual</b> abaixo.</p>'}
      ${viaDisparo ? `<p class="mini">Mensagem confirmada para ${esc(N.formatarTelefone(d.callback_telefone))} por ${esc(d.callback_operador)} em ${esc(horaBR(d.callback_em))}. Para falar com outro contato, use os botões de envio.</p>` : ""}
      <h3>Mensagem</h3>
      <select id="p-modelo" aria-label="Mensagem">${d.modelos_agrupados.map((g) => `<optgroup label="${esc(g.grupo.toUpperCase())}">${g.modelos.map((m) =>
        `<option value="${esc(m.codigo)}" ${m.codigo === d.modelo ? "selected" : ""}>${esc(m.nome)}${m.prioridade ? "  ⚠ PRIORIDADE" : ""}</option>`).join("")}</optgroup>`).join("")}</select>
      <div class="rotulo-msg"><span class="mini" id="p-sugestao">${d.modelo === d.sugestao.codigo ? "✓ Sugerida automaticamente" : "Escolhida pelo operador (sugestão: " + esc((N.modelos().find((x) => x.codigo === d.sugestao.codigo) || {}).nome || "") + ")"} — ${esc(d.sugestao_texto)}</span>
        <button class="link-botao" id="p-restaurar" title="Volta ao texto do modelo escolhido">restaurar texto</button></div>
      <textarea id="p-texto" maxlength="${N.TEXTO_MAX}" aria-label="Texto da mensagem">${esc(texto)}</textarea>
      <div class="linha-envio">
        <button class="contorno" id="p-copiar">Copiar texto</button>
        <button class="acao" id="p-manual" title="Abre o WhatsApp Web com esta mensagem para o telefone digitado ao lado" ${feito && !viaDisparo ? "disabled" : ""}>Envio manual</button>
        <input id="p-tel-manual" inputmode="tel" maxlength="20" placeholder="(DDD) 9xxxx-xxxx" aria-label="Telefone para envio manual" value="${esc(telefoneManual[d.id] || "")}" ${feito && !viaDisparo ? "disabled" : ""}>
      </div>
      <p class="mini dica-envio" id="p-dica-envio">Abrir o WhatsApp não envia nada e não conta como callback nem tentativa: confira, envie e registre abaixo.</p>
      <h3>Registrar resultado</h3>
      <div class="linha-form"><label>Meio <select id="p-meio">${Object.entries(MEIOS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>
        <label class="flex1">Observação (opcional) <input id="p-obs" maxlength="500"></label></div>
      <div class="botoes">
        <button class="principal" data-acao="callback_realizado" ${feito ? "disabled" : ""}>Callback realizado</button>
        <button class="contorno" data-acao="sem_sucesso" ${feito ? "disabled" : ""}>Tentativa sem sucesso</button>
        <button class="perigo" data-acao="contato_invalido" ${feito ? "disabled" : ""}>Contato inválido</button>
        ${d.estado !== "pendente" ? '<button class="contorno" data-acao="reabrir">Reabrir (corrigir)</button>' : ""}
      </div>
      ${feito ? `<div class="linha-resultado"><span class="mini">Depois do callback:</span>
        ${botaoRes("servico_executado", "Serviço executado", d.servico_executado_em)}
        ${botaoRes("resolvida", "Ocorrência resolvida com sucesso", d.resolvida_em)}</div>`
        : '<p class="mini">Serviço executado e ocorrência resolvida ficam disponíveis depois do callback realizado.</p>'}
      ${d.tentativas.length ? `<h3>Tentativas</h3><ul class="lista">${d.tentativas.map((h) => `<li>${horaBR(h.momento)} · ${esc(MEIOS[h.meio] || h.meio)} · ${esc(ESTADOS[h.resultado] || (h.resultado === "sem_sucesso" ? "sem sucesso" : h.resultado))}${h.origem === "disparo" ? ` · Central de Disparos · ${esc(h.operador)}` : ""}</li>`).join("")}</ul>` : ""}`;
    painelEstado = { id: d.id, modelo: d.modelo, texto: mesmo ? painelEstado.texto : null };
    $("#p-fechar").onclick = fecharPainel;
    p.querySelectorAll("[data-abrir]").forEach((b) => b.onclick = () => abrirChamada(Number(b.dataset.abrir)));
    $("#p-modelo").onchange = (ev) => { painelEstado.texto = null; abrirChamada(id, ev.target.value); };
    $("#p-texto").oninput = (ev) => { painelEstado.texto = ev.target.value; };
    $("#p-restaurar").onclick = () => { painelEstado.texto = null; $("#p-texto").value = d.mensagem; toast("Texto do modelo restaurado."); };
    $("#p-copiar").onclick = async () => { try { await navigator.clipboard.writeText($("#p-texto").value); toast("Texto copiado."); } catch (e) { $("#p-texto").select(); toast("Selecione e copie com Ctrl+C."); } };
    const tel = $("#p-tel-manual");
    tel.oninput = () => { telefoneManual[d.id] = tel.value; dicaTelefone(false); };
    tel.onkeydown = (ev) => { if (ev.key === "Enter") { ev.preventDefault(); envioManual(d); } };
    $("#p-manual").onclick = () => envioManual(d);
    p.querySelectorAll("[data-wa]").forEach((b) => b.onclick = () => abrirWhatsapp(d, b.dataset.wa, b.dataset.conf === "1"));
    p.querySelectorAll("[data-acao]").forEach((b) => b.onclick = () => registrar(d, b.dataset.acao));
    p.querySelectorAll("[data-resultado]").forEach((b) => b.onclick = () => registrarResultado(d, b.dataset.resultado));
    p.querySelectorAll("[data-desfazer]").forEach((b) => b.onclick = () => desfazerResultado(d, b.dataset.desfazer));
  }
  /* Dica ao lado do campo: valida enquanto digita (sem incomodar antes de ter 10 dígitos). */
  function dicaTelefone(forcar) {
    const tel = $("#p-tel-manual"), dica = $("#p-dica-envio"), dig = tel.value.replace(/\D/g, "");
    if (!forcar && dig.length < 10) { tel.classList.remove("invalido"); dica.className = "mini dica-envio"; dica.textContent = "Abrir o WhatsApp não envia nada e não conta como callback nem tentativa: confira, envie e registre abaixo."; return null; }
    const v = N.validarTelefoneManual(tel.value);
    tel.classList.toggle("invalido", !v.ok);
    dica.className = "mini dica-envio " + (v.ok ? "ok" : "erro");
    dica.textContent = v.ok ? `Celular válido: ${v.exibir}. Clique em Envio manual para abrir o WhatsApp Web.` : v.erro;
    return v;
  }
  async function envioManual(d) {
    const v = dicaTelefone(true);
    if (!v || !v.ok) { $("#p-tel-manual").focus(); return; }
    const janela = window.open("about:blank", "_blank"); // abre no clique (evita bloqueio de pop-up)
    try {
      const r = await srv.abrirWhatsappManual(d.id, $("#p-tel-manual").value, $("#p-modelo").value, $("#p-texto").value);
      if (janela) { janela.opener = null; janela.location.href = r.url; } else toast("O navegador bloqueou a nova janela. Permita pop-ups para a Central.", true);
      toast(`WhatsApp Web aberto para ${r.exibir}. Confira e envie; depois registre o resultado.`);
      atualizarTudo();
    } catch (e) { if (janela) janela.close(); toast(e.message, true); }
  }
  async function abrirWhatsapp(d, numero, comentario) {
    if (comentario && !await confirmar("Telefone do comentário", "<p>Este número foi achado no comentário do ADMS. Confirme que é do cliente antes de abrir o WhatsApp.</p>", "É do cliente")) return;
    const janela = window.open("about:blank", "_blank"); // abre no clique (evita bloqueio de pop-up)
    try {
      const r = await srv.abrirWhatsapp(d.id, numero, $("#p-modelo").value, comentario, $("#p-texto").value);
      if (janela) { janela.opener = null; janela.location.href = r.url; } else toast("O navegador bloqueou a nova janela. Permita pop-ups para a Central.", true);
      atualizarTudo();
    } catch (e) { if (janela) janela.close(); toast(e.message, true); }
  }
  async function registrar(d, acao) {
    const obs = $("#p-obs").value.trim();
    if (acao === "reabrir" && !obs) { toast("Explique na observação por que está reabrindo.", true); $("#p-obs").focus(); return; }
    if (acao === "reabrir" && (d.servico_executado_em || d.resolvida_em)
      && !await confirmar("Reabrir (corrigir)", "<p>Reabrir apaga também os registros de <b>serviço executado</b> e <b>ocorrência resolvida</b> desta chamada.</p>", "Reabrir")) return;
    const r = await executar(() => srv.registrar(d.id, acao, acao === "reabrir" ? null : $("#p-meio").value, obs || null),
      acao === "callback_realizado" ? "Callback registrado." : "Registro salvo.");
    if (r) atualizarTudo();
  }
  /* Bolinha da lista: registra a resolução sem abrir os detalhes; mesmas regras do painel (só após callback, uma vez).
     Resolvida: clique pede confirmação e desfaz. Botão travado durante a gravação (evita clique duplo). */
  let gravandoBolinha = false;
  async function clicarBolinha(id, botao) {
    if (gravandoBolinha) return;
    const c = srv.chamadas().find((x) => x.id === id); // estado atual gravado (não a cópia da tela)
    if (!c) return;
    if (c.estado !== "callback_realizado") { toast("A ocorrência só pode ser marcada como resolvida depois do callback realizado.", true); return; }
    gravandoBolinha = true; if (botao) botao.disabled = true;
    try {
      if (c.resolvida_em) {
        if (await confirmar("Desfazer resolução", `<p>Desfazer o registro <b>ocorrência resolvida com sucesso</b> de ${esc(c.incidente || c.call_id)}?</p>
          <p class="mini">O callback e o serviço executado (se houver) continuam registrados.</p>`, "Desfazer")) {
          if (await executar(() => srv.desfazerResultado(id, "resolvida"), "Resolução desfeita.")) atualizarTudo();
        }
      } else if (await executar(() => srv.registrarResultado(id, "resolvida"), "Ocorrência resolvida registrada. Para desfazer, clique de novo na bolinha.")) atualizarTudo();
    } finally { gravandoBolinha = false; desenharTabela(); }
  }
  async function desfazerResultado(d, tipo) {
    const rot = tipo === "resolvida" ? "ocorrência resolvida com sucesso" : "serviço executado";
    if (!await confirmar("Desfazer registro", `<p>Desfazer o registro <b>${rot}</b> desta chamada?</p><p class="mini">O callback continua registrado.</p>`, "Desfazer")) return;
    if (await executar(() => srv.desfazerResultado(d.id, tipo), "Registro desfeito.")) atualizarTudo();
  }
  async function registrarResultado(d, tipo) {
    const r = await executar(() => srv.registrarResultado(d.id, tipo), tipo === "resolvida" ? "Ocorrência resolvida registrada." : "Serviço executado registrado.");
    if (r) atualizarTudo();
  }

  /* ------------------------------------------------------------ painel (dashboard) */
  $("#btn-painel").onclick = () => abrirPainelIndicadores("hoje");
  function abrirPainelIndicadores(aba) {
    const P = srv.painel(), m = estado.metricas_tempo_real;
    const v = (x, inc) => (x == null ? "—" : x) + (inc ? "*" : "");
    const COLS = [["chamadas_processadas", "Chamadas"], ["callbacks_realizados", "Callbacks"], ["tentativas_sem_sucesso", "Sem sucesso"],
      ["contatos_invalidos", "Inválidos"], ["sem_telefone", "Sem tel."], ["servicos_executados", "Serv. exec."], ["ocorrencias_resolvidas", "Resolvidas"],
      ["pendencias_contabilizadas", "Pendentes"]];
    const tabela = (linhas, titulo, extra) => linhas.length ? `<div class="painel-rolagem"><table class="tabela-painel"><thead><tr><th>${titulo}</th>${extra ? "<th>Turnos</th>" : ""}
      ${COLS.map(([, r]) => `<th>${r}</th>`).join("")}<th>% callback</th></tr></thead><tbody>
      ${linhas.map((l) => `<tr><td>${esc(l.rotulo)}</td>${extra ? `<td>${l.turnos}</td>` : ""}${COLS.map(([k]) => `<td>${v(l[k], l.incompleto && l[k] != null && k !== "chamadas_processadas" && k !== "callbacks_realizados")}</td>`).join("")}
        <td>${l.chamadas_processadas ? pct(l.callbacks_realizados, l.chamadas_processadas) + "%" : "—"}</td></tr>`).join("")}</tbody></table></div>`
      : '<p class="mini">Nenhum turno registrado neste navegador.</p>';
    const abas = { hoje: "Hoje", dia: "Por dia", operador: "Por operador", polo: "Por polo" };
    let corpo;
    if (aba === "hoje") corpo = m ? `<div class="metricas">${cartoes(m)}</div><p class="mini">Turno aberto: ${esc(estado.sessao.operador)} · ${esc(estado.sessao.polo)} · ${dataBR(estado.sessao.data_operacional)}.
        ${m.inclui_lote_aberto ? "Inclui o lote em andamento." : ""} Taxa de resolução: ${String(m.taxa_resolucao).replace(".", ",")}% dos callbacks.</p>`
      : '<p class="mini">Nenhum turno aberto. Veja os turnos anteriores nas outras abas.</p>';
    else if (aba === "dia") corpo = tabela(P.por_dia.map((g) => ({ ...g, rotulo: dataBR(g.chave) })), "Dia", true);
    else if (aba === "operador") corpo = tabela(P.por_operador.map((g) => ({ ...g, rotulo: g.chave })), "Operador", true);
    else corpo = tabela(P.por_polo.map((g) => ({ ...g, rotulo: g.chave })), "Polo", true);
    const incompleto = [...P.por_dia, ...P.por_operador, ...P.por_polo].some((g) => g.incompleto);
    $("#modal-caixa").className = "modal-caixa larga painel-indicadores"; $("#modal-caixa").dataset.livre = "1";
    $("#modal-caixa").innerHTML = `<button class="fechar" id="pi-fechar">Fechar</button><h2>Painel de indicadores</h2>
      <div class="abas">${Object.entries(abas).map(([k, r]) => `<button data-aba="${k}" class="${k === aba ? "ativa" : ""}">${r}</button>`).join("")}</div>
      ${corpo}
      <p class="mini">Fonte: turnos registrados <b>neste navegador</b> (turno aberto em tempo real + dias encerrados). Cada chamada conta uma vez por turno.
        O consolidado de todos os operadores é feito no Power BI com os arquivos do EXPORTAR DO DIA.${incompleto ? " * Turnos anteriores à versão 1.1.0 não tinham este indicador: o total mostrado soma só os turnos que têm." : ""}</p>`;
    $("#modal").classList.remove("oculto");
    $("#pi-fechar").onclick = fecharModal;
    $("#modal-caixa").querySelectorAll("[data-aba]").forEach((b) => b.onclick = () => abrirPainelIndicadores(b.dataset.aba));
  }

  /* ------------------------------------------------------------ configuração */
  $("#btn-config").onclick = abrirConfiguracao;
  async function abrirConfiguracao() {
    const c = estado.configuracao, pasta = await destinoGravado();
    $("#modal-caixa").className = "modal-caixa"; delete $("#modal-caixa").dataset.livre;
    $("#modal-caixa").innerHTML = `<h2>Configuração da estação</h2>
      <form id="form-cfg" class="grade">
        <label>Polo padrão (vai no nome do arquivo do dia) <input name="polo" maxlength="80" value="${esc(c.polo)}"></label>
        <label>Sigla padrão do operador <input name="operador" maxlength="40" value="${esc(c.operador)}"></label>
        <label>Identificação da estação (opcional) <input name="estacao" maxlength="80" value="${esc(c.estacao)}"></label>
        <label>Endereço da biblioteca do SharePoint (opcional) <input name="url_sharepoint" maxlength="300" value="${esc(c.url_sharepoint)}" placeholder="https://…"></label>
        <div><b>Destino obrigatório do EXPORTAR DO DIA</b><br>
          <span class="caminho">${esc(N.PASTA_EXPORTACAO_SUGERIDA)}</span><br>
          <span class="mini" id="cfg-destino-situacao">${pasta ? "✓ Pasta <b>" + esc(pasta.name) + "</b> selecionada neste navegador: a janela Salvar abre nela." : "<b>Ainda não selecionada neste navegador</b> (será pedida no primeiro EXPORTAR DO DIA)."}</span><br>
          ${podeDestino() ? `<button type="button" id="cfg-pasta" class="contorno mini-botao">${pasta ? "Selecionar de novo…" : "Selecionar a pasta…"}</button>`
            : '<p class="mini"><b>Este navegador não permite salvar no destino</b>: use o Microsoft Edge ou o Google Chrome.</p>'}
          <p class="mini">O navegador não aceita um caminho escrito (W:\\…): a pasta ${esc(NOME_PASTA_DESTINO)} é selecionada uma vez e lembrada. Só essa pasta é aceita.</p></div>
        <p class="mini">Os dados ficam só neste computador e neste navegador. Limpar os dados de navegação ou usar janela anônima apaga o turno em andamento:
          exporte ao fim de cada dia.<br>Instalação: ${esc(c.instalacao_id)} · Versão ${esc(N.VERSAO)} · Armazenamento: ${esc(NOME_BANCO)}.</p>
        <div class="botoes fim"><button type="button" id="cfg-cancelar" class="contorno">Cancelar</button><button class="acao">Salvar</button></div>
      </form>`;
    $("#modal").classList.remove("oculto");
    $("#cfg-cancelar").onclick = fecharModal;
    if ($("#cfg-pasta")) $("#cfg-pasta").onclick = async () => { const r = await configurarDestino(); if (r.erro) toast(r.erro, true); else abrirConfiguracao(); };
    $("#form-cfg").onsubmit = async (ev) => {
      ev.preventDefault();
      if (await executar(() => srv.salvarConfiguracao(Object.fromEntries(new FormData(ev.target))), "Configuração salva.")) { fecharModal(); avisarOutrasAbas(); carregar(); }
    };
  }

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
    document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && !$("#modal").classList.contains("oculto") && $("#modal-caixa").dataset.livre) fecharModal(); });
    window.CentralUI.servico = srv;
    carregar();
    window.CentralFechamento.automatico();
    if (window.CentralPastaADMS) window.CentralPastaADMS.iniciar(); // pasta ADMS: confere chamadas_incidentes.csv (abertura/F5)
    document.body.dataset.pronto = "1";
  }
  // Espera todos os scripts: servida por HTTP, o armazenamento pode responder antes de os módulos seguintes carregarem.
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();
})();
