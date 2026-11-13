/* Exportação do FECHAMENTO DIÁRIO para a pasta compartilhada da empresa (File System Access API do Edge/Chrome).
   Destino: a pasta de rede definida em js/config-local.js (pasta_rede; NÃO versionado, modelo em js/config-local.exemplo.js).
   NÃO usa o Google Drive e não interfere no envio ao Drive.
   - Configuração (uma vez por navegador): o operador seleciona a pasta no seletor nativo do Edge (showDirectoryPicker, leitura e
     gravação). Só é aceita uma pasta chamada "central-callback", e a Central grava e apaga um arquivo de teste para conferir a
     gravação. O identificador da pasta (FileSystemDirectoryHandle) fica no IndexedDB da Central (structured clone).
   - Próximas vezes: o identificador é recuperado; a permissão é consultada (queryPermission) e só é pedida (requestPermission) num
     clique do operador. O seletor não abre de novo enquanto a pasta continuar autorizada.
   - A permissão NÃO é tratada como permanente: revogada, outro navegador/perfil, unidade W: desconectada ou pasta removida são
     detectados e mostrados; nada é marcado como exportado e o fechamento continua guardado na Central.
   - Exportar: grava o CSV do fechamento (o mesmo arquivo do Drive: só totais por operador, sem dados de clientes, com BOM UTF-8 e
     ";" para o Excel) direto na pasta, sem janela "Salvar como". Só depois de LER o arquivo de volta e conferir o SHA-256 a
     exportação é registrada. Nome: fechamento_callbacks_<data>_<polo>_PC<instalação>_OP-<operador>[_vN].csv.
   - Arquivo com o mesmo nome já na pasta: idêntico = só conferido (não regrava); diferente = NÃO sobrescreve e registra o erro. */
"use strict";
(function () {
  const CFG = window.CENTRAL_CONFIG_LOCAL || {}, CAMINHO = typeof CFG.pasta_rede === "string" ? CFG.pasta_rede.trim() : "", CHAVE = "pasta_rede_fechamento";
  const CAMINHO_TELA = CAMINHO || "pasta de rede não definida (js/config-local.js)";
  const UI = () => window.CentralUI, srv = () => UI().servico, esc = (v) => UI().esc(v), N = window.Nucleo;
  const horaBR = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR") : "—");
  const normal = (t) => String(t || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[\s_]+/g, "-").trim();
  const temAPI = () => typeof window.showDirectoryPicker === "function" && "FileSystemHandle" in window;
  const NOME_PASTA = normal(CAMINHO.split(/[\\/]/).filter(Boolean).pop() || "central-callback"); // o último nome do caminho configurado
  const ehPasta = (h) => !!h && h.kind === "directory" && normal(h.name) === NOME_PASTA;
  const sigla = (t) => String(t || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 20) || "SEM-OPERADOR";
  const operadorAgora = (f) => (UI().operadorAtual && UI().operadorAtual()) || (f && f.gerado_por) || srv().E.config.operador || "—";
  const ESTADOS = {
    sem_suporte: "Navegador sem suporte", nao_configurada: "Pasta não configurada", permissao: "Permissão necessária",
    indisponivel: "Pasta indisponível", configurada: "Pasta configurada",
  };
  let ultimoErro = null;
  /* Fechamento antigo, já salvo no Google Drive antes da pasta de rede virar o destino principal e nunca exportado: é histórico.
     Não conta como pendente e não entra no EXPORTAR FECHAMENTO; pode ser exportado pelo botão da própria linha. */
  const historicoDrive = (f) => f.status === "enviado" && !f.exportacao_rede;
  const aExportar = (f) => !historicoDrive(f) && !(f.exportacao_rede && f.exportacao_rede.status === "exportado");

  /* Nome do arquivo na pasta: identifica dia, polo, computador (instalação), operador e versão. */
  function nomeArquivo(f) {
    const m = /^(.*?)(_v\d+)?\.csv$/.exec(f.nome) || [null, f.nome.replace(/\.csv$/, ""), ""];
    return `${m[1]}_OP-${sigla(f.gerado_por)}${m[2] || ""}.csv`;
  }
  async function lerHandle() { try { return await srv().arm.lerArquivo(CHAVE); } catch (e) { return null; } }
  const descreverErro = (e) => (e && e.name ? `${e.name}: ${e.message}` : String(e));
  const erroDeAcesso = (e) => `A pasta não está acessível (${descreverErro(e)}). A unidade W: está conectada (rede/VPN/Citrix)?`;
  async function acessivel(h) { try { for await (const k of h.keys()) { void k; break; } return null; } catch (e) { return erroDeAcesso(e); } }
  async function permissao(h) { try { return await h.queryPermission({ mode: "readwrite" }); } catch (e) { return "prompt"; } }

  /* Situação atual SEM pedir nada ao operador (pode rodar ao abrir a tela). */
  async function situacao() {
    if (!temAPI()) return { estado: "sem_suporte", detalhe: "Use o Microsoft Edge ou o Google Chrome: este navegador não grava em pastas do computador." };
    const h = await lerHandle();
    if (!ehPasta(h)) return { estado: "nao_configurada" };
    if ((await permissao(h)) !== "granted") return { estado: "permissao", pasta: h.name, detalhe: "O navegador precisa da sua autorização para gravar na pasta (clique em Autorizar acesso ou Exportar)." };
    const erro = await acessivel(h);
    return erro ? { estado: "indisponivel", pasta: h.name, detalhe: erro } : { estado: "configurada", pasta: h.name };
  }
  /* Grava, lê de volta e apaga um arquivo de teste: confirma que a pasta aceita gravação. */
  async function testarGravacao(h) {
    const nome = `.teste-gravacao-central-${N.aleatorioHex(4)}.tmp`, txt = "teste de gravacao da Central de Callback " + new Date().toISOString();
    try {
      const fh = await h.getFileHandle(nome, { create: true }), w = await fh.createWritable();
      await w.write(txt); await w.close();
      const lido = await (await fh.getFile()).text();
      if (lido !== txt) throw new Error("o conteúdo lido difere do gravado");
    } catch (e) { return `A pasta não aceitou a gravação de teste (${descreverErro(e)}).`; }
    finally { try { await h.removeEntry(nome); } catch (e) { /* teste já removido ou pasta indisponível */ } }
    return null;
  }
  /* CONFIGURAR / TROCAR PASTA: sempre a partir de um clique (o seletor exige gesto do usuário). */
  async function configurar() {
    if (!temAPI()) return { erro: "Este navegador não permite gravar em pastas do computador. Use o Microsoft Edge ou o Google Chrome." };
    const atual = await lerHandle();
    let h;
    try { h = await window.showDirectoryPicker({ id: "central-callback-rede", mode: "readwrite", ...(ehPasta(atual) ? { startIn: atual } : {}) }); }
    catch (e) { return { erro: e.name === "AbortError" ? "Seleção da pasta cancelada. Nada foi alterado." : "Não foi possível selecionar a pasta: " + descreverErro(e) }; }
    if (!ehPasta(h)) return { erro: `Pasta recusada: "${h.name}". Selecione exatamente a pasta ${NOME_PASTA}${CAMINHO ? ` em ${CAMINHO}` : ""}.` };
    if ((await permissao(h)) !== "granted") {
      let p = "denied"; try { p = await h.requestPermission({ mode: "readwrite" }); } catch (e) { /* sem gesto */ }
      if (p !== "granted") return { erro: "A gravação na pasta não foi autorizada. Nada foi alterado." };
    }
    const erro = await testarGravacao(h);
    if (erro) return { erro: erro + " A pasta anterior (se houver) foi mantida." };
    await srv().arm.gravarArquivo(CHAVE, h);
    return { pasta: h.name };
  }
  /* Garante pasta autorizada e acessível. Pode pedir permissão (só chamado a partir de clique). */
  async function prepararPasta() {
    if (!temAPI()) return { erro: "Este navegador não permite gravar em pastas do computador. Use o Microsoft Edge ou o Google Chrome.", estado: "sem_suporte" };
    const h = await lerHandle();
    if (!ehPasta(h)) return { erro: "A pasta de exportação não está configurada neste navegador.", estado: "nao_configurada" };
    if ((await permissao(h)) !== "granted") {
      let p = "prompt";
      try { p = await h.requestPermission({ mode: "readwrite" }); } catch (e) { return { erro: "O navegador não abriu o pedido de autorização (" + descreverErro(e) + "). Clique em Autorizar acesso.", estado: "permissao" }; }
      if (p !== "granted") return { erro: "A gravação na pasta não foi autorizada.", estado: "permissao" };
    }
    const erro = await acessivel(h);
    return erro ? { erro, estado: "indisponivel" } : { h };
  }
  async function lerTexto(fh) { return new TextDecoder("utf-8", { ignoreBOM: true }).decode(await (await fh.getFile()).arrayBuffer()); }

  /* Exporta UM fechamento para a pasta já preparada. Devolve o registro gravado no fechamento. */
  async function exportarUm(h, f) {
    const arquivo = nomeArquivo(f), operador = operadorAgora(f), base = { arquivo, operador, pasta: h.name };
    const registrar = (resultado, detalhe) => srv().registrarExportacaoRede(f.id, { ...base, resultado, detalhe }).then((r) => ({ resultado, detalhe, arquivo, ...r }));
    let existente = null;
    try { existente = await h.getFileHandle(arquivo); } catch (e) {
      if (e.name !== "NotFoundError") return registrar("falha", erroDeAcesso(e));
    }
    if (existente) {
      let atual;
      try { atual = await lerTexto(existente); } catch (e) { return registrar("falha", "Não foi possível ler o arquivo que já está na pasta (" + descreverErro(e) + ")."); }
      if (N.sha256Hex(atual) === f.sha256) return registrar("ja_estava_na_pasta", "O arquivo já estava na pasta, idêntico (conferido por SHA-256). Nada foi regravado.");
      return registrar("conflito", `Já existe na pasta um arquivo ${arquivo} com conteúdo DIFERENTE. Ele NÃO foi sobrescrito; verifique-o antes de exportar de novo.`);
    }
    // O arquivo não existia: se esta tentativa falhar, o que ela criou (vazio ou incompleto) é removido, para não virar "conflito".
    let w = null, criado = false;
    const desfazer = async () => { if (criado) { try { await h.removeEntry(arquivo); } catch (x) { /* pasta indisponível */ } } };
    try {
      const fh = await h.getFileHandle(arquivo, { create: true }); criado = true;
      w = await fh.createWritable();
      await w.write(new Blob([f.conteudo], { type: "text/csv;charset=utf-8" })); await w.close(); w = null;
      const lido = await lerTexto(fh);
      if (N.sha256Hex(lido) !== f.sha256) { await desfazer(); return registrar("falha", "O arquivo gravado na pasta difere do fechamento (SHA-256). Exporte novamente."); }
    } catch (e) {
      if (w) { try { await w.abort(); } catch (x) { /* nada gravado */ } }
      await desfazer();
      return registrar("falha", "Falha ao gravar na pasta: " + erroDeAcesso(e));
    }
    return registrar("exportado", null);
  }
  /* Exporta os fechamentos indicados (ou todos os que ainda não estão na pasta). Só a partir de clique. */
  async function exportar(ids) {
    const lista = (ids || srv().E.fechamentos.filter(aExportar).map((f) => f.id))
      .map((id) => srv().fechamento(id)).filter(Boolean);
    const prep = await prepararPasta();
    if (prep.erro) {
      ultimoErro = prep.erro;
      // Tentativa real com pasta configurada (permissão negada ou pasta indisponível): fica registrada em cada fechamento.
      if (prep.estado === "permissao" || prep.estado === "indisponivel") {
        for (const f of lista) await srv().registrarExportacaoRede(f.id, { arquivo: nomeArquivo(f), operador: operadorAgora(f), resultado: "falha", detalhe: prep.erro });
      }
      return { erro: prep.erro, estado: prep.estado, itens: [] };
    }
    const itens = [];
    for (const f of lista) itens.push({ nome: f.nome, ...(await exportarUm(prep.h, f)) });
    ultimoErro = itens.filter((i) => i.resultado === "falha" || i.resultado === "conflito").map((i) => i.detalhe)[0] || null;
    return { itens };
  }
  const pendentes = () => srv().E.fechamentos.filter(aExportar);

  /* ------------------------------------------------------------ interface (dentro da janela Fechamento) */
  function celula(f) {
    const x = f.exportacao_rede, ult = (f.historico_rede || []).slice(-1)[0];
    const etq = historicoDrive(f) ? '<span class="etq e-sem_telefone">Não exportado</span><div class="mini">fechamento anterior, já salvo no Google Drive</div>' : !x ? '<span class="etq e-pendente">Pendente</span>' : x.status === "exportado" ? '<span class="etq e-callback_realizado">Exportado</span>' : '<span class="etq e-pendente">Pendente</span>';
    const info = x && x.status === "exportado" ? `${esc(x.arquivo)} · ${esc(x.operador)} · ${horaBR(x.em)}` : "";
    const erro = ult && (ult.resultado === "falha" || ult.resultado === "conflito") ? `<div class="mini">Última tentativa (${horaBR(ult.em)}): ${esc(ult.detalhe)}</div>` : "";
    return `${etq}${info ? `<div class="mini">${info}</div>` : ""}${erro}<div><button type="button" class="mini-botao" data-exportar-rede="${esc(f.id)}">${x && x.status === "exportado" ? "Exportar novamente" : "Exportar"}</button></div>`;
  }
  function blocoHtml() {
    return `<div class="rede-bloco" id="fe-rede" data-situacao="verificando">
      <div class="rede-topo"><b>Pasta de rede</b> <span class="caminho">${esc(CAMINHO_TELA)}</span> <span class="etq" id="fe-rede-estado">verificando…</span></div>
      <div class="mini" id="fe-rede-detalhe"></div>
      <div class="botoes"><button type="button" class="acao" id="fe-rede-exportar">EXPORTAR FECHAMENTO</button>
        <button type="button" class="contorno" id="fe-rede-configurar">CONFIGURAR PASTA DE EXPORTAÇÃO</button>
        <button type="button" class="contorno oculto" id="fe-rede-autorizar">Autorizar acesso</button></div></div>`;
  }
  async function atualizarBloco() {
    const el = document.querySelector("#fe-rede"); if (!el) return;
    const s = await situacao(), cls = { configurada: "e-callback_realizado", permissao: "e-pendente", nao_configurada: "e-pendente", indisponivel: "e-contato_invalido", sem_suporte: "e-contato_invalido" }[s.estado];
    const p = pendentes().length;
    el.dataset.situacao = s.estado;
    const est = el.querySelector("#fe-rede-estado"); est.className = "etq " + cls; est.textContent = ESTADOS[s.estado];
    const resumo = !srv().E.fechamentos.length ? "Nenhum fechamento gerado ainda." : p ? `${p} fechamento(s) com exportação pendente ou com erro.` : "Exportação concluída: todos os fechamentos estão na pasta.";
    el.querySelector("#fe-rede-detalhe").textContent = [s.pasta ? `Pasta autorizada: ${s.pasta}.` : "", s.detalhe || "", resumo, ultimoErro && p ? "Último erro: " + ultimoErro : ""].filter(Boolean).join(" ");
    el.querySelector("#fe-rede-configurar").textContent = s.estado === "nao_configurada" || s.estado === "sem_suporte" ? "CONFIGURAR PASTA DE EXPORTAÇÃO" : "Trocar pasta";
    el.querySelector("#fe-rede-configurar").disabled = s.estado === "sem_suporte";
    el.querySelector("#fe-rede-exportar").disabled = s.estado === "sem_suporte" || s.estado === "nao_configurada" || !p;
    el.querySelector("#fe-rede-autorizar").classList.toggle("oculto", s.estado !== "permissao");
  }
  function avisarResultado(r) {
    if (r.erro) { UI().toastErro(`${r.erro} Nada foi marcado como exportado; o fechamento continua guardado na Central.`, true); return; }
    const ok = r.itens.filter((i) => i.resultado === "exportado").length, ja = r.itens.filter((i) => i.resultado === "ja_estava_na_pasta").length, ruins = r.itens.filter((i) => i.resultado === "falha" || i.resultado === "conflito");
    if (!r.itens.length) { UI().toastErro("Não há fechamento pendente de exportação."); return; }
    if (ruins.length) UI().toastErro(`${ruins.length} fechamento(s) NÃO exportado(s): ${ruins[0].detalhe}${ok ? ` (${ok} gravado(s) com sucesso)` : ""}`, true);
    else UI().toastErro(`Exportação concluída: ${ok ? `${ok} arquivo(s) gravado(s) e conferido(s)` : ""}${ok && ja ? "; " : ""}${ja ? `${ja} já estava(m) na pasta, idêntico(s)` : ""}.`);
  }
  /* Liga os botões da janela Fechamento. "redesenhar" refaz a tabela depois de cada ação. */
  function ligar(raiz, redesenhar) {
    const botao = (sel, f) => { const b = raiz.querySelector(sel); if (b) b.onclick = async () => { b.disabled = true; try { await f(b); } finally { b.disabled = false; await redesenhar(); } }; };
    botao("#fe-rede-configurar", async () => {
      const r = await configurar();
      if (r.erro) UI().toastErro(r.erro, true); else { ultimoErro = null; UI().toastErro(`Pasta de exportação configurada e testada: ${r.pasta}.`); }
    });
    botao("#fe-rede-autorizar", async () => { const p = await prepararPasta(); UI().toastErro(p.erro ? p.erro : "Acesso à pasta autorizado.", !!p.erro); });
    botao("#fe-rede-exportar", async () => avisarResultado(await exportar()));
    raiz.querySelectorAll("[data-exportar-rede]").forEach((b) => { b.onclick = async () => {
      const f = srv().fechamento(b.dataset.exportarRede); if (!f) return;
      if (f.exportacao_rede && f.exportacao_rede.status === "exportado") {
        const v = await UI().escolher("Exportar novamente", `<p><b>${esc(f.nome)}</b> já foi exportado em ${horaBR(f.exportacao_rede.em)} como <b>${esc(f.exportacao_rede.arquivo)}</b>.</p>
          <p class="mini">A Central confere o arquivo na pasta: se estiver idêntico, nada é regravado; se tiver sido apagado, é gravado de novo; se estiver diferente, NÃO é sobrescrito.</p>`,
          [{ valor: "nao", rotulo: "Cancelar" }, { valor: "sim", rotulo: "Conferir e exportar", classe: "acao" }]);
        if (v !== "sim") { await redesenhar(); return; }
      }
      avisarResultado(await exportar([f.id])); await redesenhar();
    }; });
    atualizarBloco();
  }
  window.CentralExportacaoRede = { CAMINHO: CAMINHO_TELA, NOME_PASTA, situacao, configurar, exportar, nomeArquivo, pendentes, celula, blocoHtml, ligar, atualizarBloco };
})();
