/* Central de Callback COI — alimentação automática pelo ADMS (pasta local ou de rede), sem servidor.
   - O operador conecta UMA vez: a PASTA (showDirectoryPicker) ou o próprio ARQUIVO chamadas_incidentes.csv (showOpenFilePicker).
     O arquivo é a saída quando o Edge recusa a pasta ("contém arquivos de sistema": isso acontece, p. ex., com a raiz de uma
     unidade mapeada). O identificador fica no IndexedDB da Central (armazém "arquivos"). O navegador não aceita caminho escrito
     (\\servidor\...) nem descobre a pasta sozinho: por isso a seleção, e por isso o local onde a Central está instalada não importa.
   - Depois de gravar, o identificador é RELIDO do IndexedDB para confirmar que ficou guardado. Se o navegador não guardar
     (ex.: dados apagados ao fechar, janela InPrivate), a faixa avisa em vez de "esquecer" calada.
   - Autorização expirada (o Edge costuma pedir de novo depois de fechado): a pasta continua lembrada; um clique em
     "Renovar autorização" (ou no "Abrir o turno") pede a permissão, sem nova seleção. Nenhuma janela abre sozinha.
   - Lê SOMENTE chamadas_incidentes.csv. Nenhum outro arquivo da pasta é aberto.
   - Só verifica ao abrir/atualizar a página (F5), ao abrir o turno ou no botão "Verificar agora". Sem setInterval, sem laço.
   - Sem alteração (mesmo nome, tamanho e data de modificação já carregados): NÃO lê o arquivo.
   - Arquivo em gravação pelo ADMS: espera tamanho e data ficarem estáveis (tentativas limitadas); nunca carrega pela metade.
   - Duplicidade: o conteúdo é identificado pelo SHA-256 (já usado pela importação manual) e cada CALL pela marca do dia.
     Sem lote aberto: importa como lote novo (srv.importar, a mesma importação manual). Lote da pasta aberto: srv.atualizarLote
     troca os dados do ADMS pela versão nova sem somar de novo e sem apagar registros do operador.
   - Diagnóstico (botão na faixa): contexto, APIs, identificador, permissão, últimos erros e formato do CSV — sem dados de clientes.
   - Nada sai do computador: nenhuma requisição de rede. Web Worker não é usado: aberto por file://, o navegador bloqueia Worker. */
"use strict";
(function () {
  const NOME_ARQUIVO = "chamadas_incidentes.csv", CHAVE_PASTA = "pasta_adms", CHAVE_VERSAO = "pasta_adms_versao", CHAVE_DIAG = "pasta_adms_diagnostico";
  /* Caminho padrão da pasta ADMS: SÓ referência na tela do primeiro acesso (sem conexão guardada). Não é gravado, não abre nada
     sozinho e não substitui a conexão já autorizada: o Edge não aceita caminho escrito no seletor; o operador cola na janela. */
  // Vem da configuração local (js/config-local.js, não versionada). Sem ela, a faixa mostra "não definido" e não oferece copiar.
  const CFG = window.CENTRAL_CONFIG_LOCAL || {}, CAMINHO_CONFIG = typeof CFG.pasta_adms === "string" ? CFG.pasta_adms.trim() : "";
  /* Sem js/config-local.js (ex.: Central publicada no GitHub Pages), o operador informa o caminho UMA vez e ele fica SÓ neste
     navegador (localStorage), nunca no código publicado. O config-local.js, quando existe, tem prioridade. */
  const CHAVE_CAMINHO_NAVEGADOR = "central-pasta-adms-caminho";
  const caminhoDoNavegador = () => { try { return (localStorage.getItem(CHAVE_CAMINHO_NAVEGADOR) || "").trim(); } catch (e) { return ""; } };
  const caminhoPadrao = () => CAMINHO_CONFIG || caminhoDoNavegador();
  const ESPERA_ESTAVEL_MS = 1200, TENTATIVAS = 4;
  const $ = (s) => document.querySelector(s);
  const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));
  const temHandle = () => "FileSystemHandle" in window;
  const podePasta = () => temHandle() && typeof window.showDirectoryPicker === "function";
  const podeArquivo = () => temHandle() && typeof window.showOpenFilePicker === "function";
  const suportado = () => podePasta() || podeArquivo();
  const esc = (v) => window.CentralUI.esc(v);
  const hora = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); };
  const ehArquivo = () => !!pasta && pasta.kind === "file";
  const alvo = () => (ehArquivo() ? "o arquivo" : "a pasta");
  let srv = null, pasta = null, versao = null, emAndamento = null, sessaoVista, naoGuardado = null;
  let situacao = { tipo: "iniciando", texto: "Verificando a pasta ADMS…" };
  /* Diagnóstico em memória (o do CSV também fica guardado, para o F5 sem leitura). Nunca contém conteúdo do arquivo. */
  const diag = { aberto_em: new Date().toISOString(), conexao_ao_abrir: null, permissao_ao_abrir: null, erro_ao_ler_conexao: null,
    guardado_confirmado: null, armazenamento_persistente: null, erros: [], arquivo: null, csv: null };
  const anotarErro = (onde, e) => { diag.erros.push({ em: new Date().toISOString(), onde, nome: (e && e.name) || "Erro", mensagem: String((e && e.message) || e).slice(0, 200) }); diag.erros = diag.erros.slice(-8); };

  const lerChave = async (k) => { try { return await srv.arm.lerArquivo(k); } catch (e) { anotarErro("ler " + k, e); return null; } };
  const gravarChave = async (k, v) => { try { await srv.arm.gravarArquivo(k, v); return null; } catch (e) { anotarErro("gravar " + k, e); return e; } };

  /* ------------------------------------------------------------ indicador */
  function mostrar(tipo, texto) {
    situacao = { tipo, texto };
    const el = $("#pasta-adms");
    if (!el) return;
    const b = (acao, rotulo, titulo = "") => `<button type="button" class="mini-botao" data-adms="${acao}"${titulo ? ` title="${esc(titulo)}"` : ""}>${rotulo}</button>`;
    const botoes = [];
    if (tipo === "permissao") botoes.push(b("reconectar", "Renovar autorização", "Pede ao navegador a permissão de leitura de novo, sem selecionar a pasta"));
    const semConexao = ["sem_pasta", "pasta_indisponivel", "nao_encontrado"].includes(tipo);
    const primeiroAcesso = !pasta && tipo === "sem_pasta"; // nenhuma conexão guardada no IndexedDB
    // Sempre disponível (o operador pode precisar do caminho a qualquer momento). Só copia texto: não muda a conexão guardada.
    const CAMINHO_PADRAO = caminhoPadrao();
    botoes.push(b("copiar", "Copiar caminho", CAMINHO_PADRAO ? `Copia ${CAMINHO_PADRAO} para colar na janela de Selecionar pasta` : "Informe uma vez o caminho da pasta ADMS (fica salvo só neste navegador) e copie"));
    if (semConexao) {
      if (podePasta()) botoes.push(b("selecionar", "Selecionar pasta"));
      if (podeArquivo()) botoes.push(b("arquivo", "Selecionar arquivo", `Escolher diretamente ${NOME_ARQUIVO} (use se o Edge recusar a pasta)`));
    }
    if (pasta && !["permissao", "indisponivel", "verificando", "iniciando"].includes(tipo)) botoes.push(b("verificar", "Verificar agora"));
    if (pasta && !semConexao && !["indisponivel"].includes(tipo)) {
      if (podePasta()) botoes.push(b("selecionar", "Trocar pasta", "Escolher outra pasta"));
      if (podeArquivo()) botoes.push(b("arquivo", "Trocar arquivo", `Escolher diretamente ${NOME_ARQUIVO}`));
    }
    botoes.push(b("diagnostico", "Diagnóstico", "Informações técnicas da conexão (sem dados de clientes)"));
    el.className = "pasta-adms s-" + tipo;
    el.dataset.situacao = tipo;
    el.dataset.conexao = pasta ? pasta.kind : "";
    el.innerHTML = `<span class="pa-rotulo">Pasta ADMS</span>`
      + `<span class="pa-pasta" title="Arquivo lido: ${NOME_ARQUIVO}">${pasta ? (ehArquivo() ? "arquivo " : "") + esc(pasta.name)
        : primeiroAcesso ? (CAMINHO_PADRAO ? `caminho padrão: <code class="pa-caminho" data-adms-caminho>${esc(CAMINHO_PADRAO)}</code>` : "caminho padrão não definido (clique em Copiar caminho para informar)") : "não conectada"}</span>`
      + `<span class="pa-situacao">${esc(texto)}</span>`
      + (naoGuardado ? `<span class="pa-alerta" data-adms-alerta="nao_guardado">${esc(naoGuardado)}</span>` : "")
      + (versao && versao.processado_em ? `<span class="pa-ultima">Última atualização: ${esc(hora(versao.processado_em))}</span>` : "")
      + `<span class="pa-botoes">${botoes.join("")}</span>`;
    el.querySelectorAll("[data-adms]").forEach((x) => x.onclick = () => acao(x.dataset.adms));
  }
  async function acao(qual) {
    if (qual === "selecionar") return selecionar();
    if (qual === "arquivo") return selecionarArquivo();
    if (qual === "reconectar") return reconectar();
    if (qual === "verificar") return verificar();
    if (qual === "diagnostico") return mostrarDiagnostico();
    if (qual === "copiar") return copiarCaminho();
  }
  /* Só copia o texto do caminho padrão (js/config-local.js). Não abre janela, não pede permissão e não grava nada. */
  async function copiarCaminho() {
    let CAMINHO_PADRAO = caminhoPadrao();
    if (!CAMINHO_PADRAO) { CAMINHO_PADRAO = await informarCaminho(); if (!CAMINHO_PADRAO) return; }
    const dica = "Clique em Selecionar pasta, cole na barra de endereço da janela (Ctrl+V) e confirme a pasta.";
    try { await navigator.clipboard.writeText(CAMINHO_PADRAO); window.CentralUI.toast("Caminho copiado. " + dica); }
    catch (e) {
      // Sem acesso à área de transferência: tenta a cópia clássica; se nem isso, seleciona o texto para Ctrl+C.
      let ok = false;
      try { const t = document.createElement("textarea"); t.value = CAMINHO_PADRAO; t.setAttribute("readonly", ""); t.style.position = "fixed"; t.style.opacity = "0"; document.body.appendChild(t); t.select(); ok = document.execCommand("copy"); t.remove(); } catch (x) { ok = false; }
      if (ok) { window.CentralUI.toast("Caminho copiado. " + dica); return; }
      const el = document.querySelector("#pasta-adms [data-adms-caminho]");
      if (el) { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); window.CentralUI.toast("Caminho selecionado: copie com Ctrl+C. " + dica); }
      else window.CentralUI.toast("Copie o caminho: " + CAMINHO_PADRAO + " · " + dica);
    }
  }

  /* Pede o caminho da pasta ADMS uma vez (só quando não há config-local.js nem caminho salvo) e guarda SÓ neste navegador. */
  async function informarCaminho() {
    const UI = window.CentralUI;
    const ok = await UI.confirmar("Caminho da pasta ADMS", `<p>Este computador ainda não tem o caminho da pasta ADMS. Informe-o uma vez (ex.: <code>\\\\SERVIDOR\\PASTA\\ADMS</code>):
      ele fica salvo <b>só neste navegador</b> e não é publicado.</p><label>Caminho <input id="adms-caminho-novo" maxlength="300" autocomplete="off" spellcheck="false"></label>`, "Salvar e copiar");
    const v = ok ? String((document.querySelector("#adms-caminho-novo") || {}).value || "").trim() : "";
    if (!ok) return "";
    if (!v) { UI.toastErro("Nenhum caminho informado: nada foi copiado.", true); return ""; }
    try { localStorage.setItem(CHAVE_CAMINHO_NAVEGADOR, v); } catch (e) { /* navegador sem armazenamento: copia mesmo assim */ }
    mostrar(situacao.tipo, situacao.texto);
    return v;
  }

  /* ------------------------------------------------------------ conexão (pasta ou arquivo) */
  async function selecionar() {
    let h;
    try { h = await window.showDirectoryPicker({ id: "pasta-adms", mode: "read" }); }
    catch (e) {
      if (e.name !== "AbortError") { anotarErro("selecionar pasta", e); window.CentralUI.toastErro("Não foi possível selecionar a pasta: " + e.message + (podeArquivo() ? " Tente Selecionar arquivo." : ""), true); }
      return;
    }
    return conectar(h);
  }
  async function selecionarArquivo() {
    let hs;
    try { hs = await window.showOpenFilePicker({ id: "pasta-adms", multiple: false, types: [{ description: "CSV do ADMS", accept: { "text/csv": [".csv"] } }] }); }
    catch (e) { if (e.name !== "AbortError") { anotarErro("selecionar arquivo", e); window.CentralUI.toastErro("Não foi possível selecionar o arquivo: " + e.message, true); } return; }
    const h = hs && hs[0];
    if (!h) return;
    if (h.name.toLowerCase() !== NOME_ARQUIVO) { window.CentralUI.toastErro(`Escolha o arquivo ${NOME_ARQUIVO} (foi escolhido "${h.name}"). Nada foi conectado.`, true); return; }
    return conectar(h);
  }
  async function conectar(h) {
    pasta = h; versao = null; naoGuardado = null;
    await gravarChave(CHAVE_VERSAO, null);
    const erro = await gravarChave(CHAVE_PASTA, h);
    // Confirma relendo do IndexedDB: só assim a próxima abertura encontrará a conexão.
    let ok = false;
    if (!erro) { const lido = await lerChave(CHAVE_PASTA); try { ok = !!lido && lido.kind === h.kind && await lido.isSameEntry(h); } catch (e) { anotarErro("conferir gravação", e); } }
    diag.guardado_confirmado = ok;
    if (!ok) naoGuardado = `O navegador não guardou a conexão${erro ? ` (${erro.name})` : ""}: ela vale só enquanto esta página estiver aberta. Veja o Diagnóstico.`;
    try { if (navigator.storage && navigator.storage.persist) diag.armazenamento_persistente = await navigator.storage.persist(); } catch (e) { anotarErro("storage.persist", e); }
    return verificar();
  }
  /* A permissão só pode ser pedida com um clique do usuário (regra do navegador): por isso o botão — e o "Abrir o turno". */
  async function reconectar() {
    if (!pasta) return podePasta() ? selecionar() : selecionarArquivo();
    let perm = "denied";
    try { perm = await pasta.requestPermission({ mode: "read" }); } catch (e) { anotarErro("requestPermission", e); }
    if (perm !== "granted") { mostrar("permissao", `Permissão não concedida. Clique em Renovar autorização e escolha Permitir (de preferência "Permitir em todas as visitas", se o Edge oferecer).`); return; }
    if (emAndamento) await emAndamento.catch(() => {}); // garante uma verificação nova, já com a permissão
    return verificar();
  }
  async function permissao(h) {
    try { return await h.queryPermission({ mode: "read" }); } catch (e) { anotarErro("queryPermission", e); return "prompt"; }
  }
  /* Abre SÓ o arquivo chamadas_incidentes.csv. Se o nome vier com maiúsculas diferentes, procura pelo NOME na listagem
     (uma vez, sem abrir nenhum arquivo). Conexão por arquivo: é o próprio identificador. Erros sobem para quem chamou. */
  async function acharArquivo(h) {
    if (h.kind === "file") return h;
    try { return await h.getFileHandle(NOME_ARQUIVO); }
    catch (e) { if (e.name !== "NotFoundError" && e.name !== "TypeMismatchError") throw e; }
    for await (const [nome, x] of h.entries()) if (x.kind === "file" && nome.toLowerCase() === NOME_ARQUIVO) return x;
    return null;
  }
  const mesmaVersao = (v, f) => !!v && v.nome === f.name && v.tamanho === f.size && v.modificado === f.lastModified;
  /* Traduz o erro do navegador numa situação clara. NotAllowed/Security = permissão; NotFound/NotReadable = rede, pasta ou arquivo
     inacessível (o navegador não distingue rede fora de pasta removida). */
  function situacaoDoErro(e) {
    if (e.name === "NotAllowedError" || e.name === "SecurityError") return ["permissao", `O navegador não autorizou a leitura d${ehArquivo() ? "o arquivo" : "a pasta"} ADMS. Clique em Renovar autorização.`];
    if (ehArquivo() && e.name === "NotFoundError") return ["pasta_indisponivel", `${NOME_ARQUIVO} inacessível (rede da empresa fora, pasta movida ou arquivo removido). A importação manual continua disponível.`];
    return ["pasta_indisponivel", `${ehArquivo() ? "Arquivo" : "Pasta"} indisponível (rede desconectada, sem acesso ao compartilhamento ou pasta removida). A importação manual continua disponível.`];
  }

  /* ------------------------------------------------------------ verificação (uma por vez) */
  function verificar() {
    if (!emAndamento) emAndamento = executar().catch((e) => { anotarErro("verificação", e); mostrar("erro", "Erro de leitura: " + e.message); }).finally(() => { emAndamento = null; });
    return emAndamento;
  }
  async function executar() {
    if (!suportado()) { mostrar("indisponivel", "Este navegador não permite conectar pasta (use o Edge ou o Chrome). Use a importação manual."); return; }
    if (!pasta) { mostrar("sem_pasta", `Não conectada. Clique em Selecionar pasta e cole o caminho na janela. Importação manual disponível.`); return; }
    const perm = await permissao(pasta);
    if (perm !== "granted") { mostrar("permissao", `A autorização para ler ${alvo()} ADMS precisa ser renovada (o Edge pede de novo depois de fechado). Clique em Renovar autorização — não é preciso selecionar de novo.`); return; }
    mostrar("verificando", "Verificando…");
    let fh;
    try { fh = await acharArquivo(pasta); }
    catch (e) { anotarErro("abrir " + pasta.kind, e); mostrar(...situacaoDoErro(e)); return; }
    if (!fh) { mostrar("nao_encontrado", `${NOME_ARQUIVO} não encontrado nesta pasta.`); return; }
    let f;
    try { f = await fh.getFile(); } catch (e) { anotarErro("consultar arquivo", e); mostrar(...situacaoDoErro(e)); return; }
    diag.arquivo = { tamanho: f.size, modificado: new Date(f.lastModified).toISOString(), consultado_em: new Date().toISOString() };
    const estado = srv.estado();
    // Sem alteração e já na base de hoje: não lê o arquivo.
    if (mesmaVersao(versao, f) && srv.arquivoNaBase(versao.sha256)) { mostrar("sem_alteracoes", "Arquivo sem alterações."); return; }
    if (!estado.sessao) { mostrar("aguardando_turno", "Abra o turno para carregar o CSV da pasta."); return; }
    const lote = estado.lote_aberto;
    if (lote && lote.origem !== "pasta_adms") { // não mistura a pasta com um lote importado à mão
      mostrar("lote_manual", "O lote aberto foi importado manualmente: a versão da pasta é carregada depois de encerrá-lo."); return;
    }
    mostrar("verificando", "Lendo o arquivo…");
    let lido;
    try { lido = await lerEstavel(fh, f); } catch (e) { anotarErro("ler arquivo", e); mostrar(...situacaoDoErro(e)); return; }
    if (!lido) { mostrar("em_gravacao", "O ADMS está gravando o arquivo: nada foi carregado. Clique em Verificar agora em instantes."); return; }
    let bytes = lido.bytes;
    const registro = { nome: lido.arquivo.name, tamanho: lido.arquivo.size, modificado: lido.arquivo.lastModified };
    await espera(0); // deixa a tela mostrar "Lendo…" antes do processamento
    const sha = window.Nucleo.sha256Hex(bytes);
    try { diag.csv = { lido_em: new Date().toISOString(), ...window.Nucleo.diagnosticoCSV(bytes) }; await gravarChave(CHAVE_DIAG, diag.csv); } catch (e) { anotarErro("diagnóstico do CSV", e); }
    if (srv.arquivoNaBase(sha)) { // conteúdo igual ao já carregado (ex.: arquivo regravado sem mudanças)
      await guardarVersao({ ...registro, sha256: sha }); bytes = null;
      mostrar("sem_alteracoes", "Arquivo sem alterações."); return;
    }
    let texto;
    try {
      if (!lote) {
        const l = await srv.importar(registro.nome, bytes, sha, "pasta_adms");
        texto = `Atualizado: lote ${l.numero} importado da pasta.`;
      } else {
        const r = await srv.atualizarLote(registro.nome, bytes, sha);
        texto = `Atualizado: lote ${r.lote.numero} com a versão nova (${r.novas} nova(s), ${r.atualizadas} atualizada(s), ${r.preservadas} com registro preservado${r.fora_do_arquivo ? `, ${r.fora_do_arquivo} fora do arquivo mantida(s)` : ""}).`;
      }
    } catch (e) {
      bytes = null;
      anotarErro("importar", e);
      if (window.Armazenamento && e instanceof window.Armazenamento.ErroConcorrencia) { try { await srv.carregar(); } catch (x) { /* mantém */ } }
      mostrar("erro", "Não carregado: " + e.message);
      window.CentralUI.recarregar();
      return;
    }
    bytes = null; // libera a cópia do arquivo
    await guardarVersao({ ...registro, sha256: sha });
    mostrar("atualizado", texto);
    window.CentralUI.toast(texto);
    window.CentralUI.avisar(); window.CentralUI.recarregar();
  }
  async function guardarVersao(v) { versao = { ...v, processado_em: new Date().toISOString() }; await gravarChave(CHAVE_VERSAO, versao); }
  /* Leitura segura: tamanho e data de modificação iguais em duas consultas seguidas; se o arquivo mudar durante a leitura,
     o navegador recusa (NotReadableError) e tenta de novo. Limite: TENTATIVAS. */
  async function lerEstavel(fh, primeiro) {
    let a = primeiro;
    for (let t = 0; t < TENTATIVAS; t++) {
      await espera(ESPERA_ESTAVEL_MS);
      const b = await fh.getFile();
      if (b.size > 0 && b.size === a.size && b.lastModified === a.lastModified) {
        try {
          const bytes = new Uint8Array(await b.arrayBuffer());
          if (bytes.length === b.size) return { arquivo: b, bytes };
        } catch (e) { if (e.name !== "NotReadableError") throw e; }
      }
      a = await fh.getFile();
    }
    return null;
  }

  /* ------------------------------------------------------------ diagnóstico (sem dados de clientes) */
  async function relatorio() {
    const L = [], s = (v) => (v === null || v === undefined ? "—" : String(v));
    const u = location, ua = navigator.userAgent, edge = /Edg\/([\d.]+)/.exec(ua), chrome = /Chrome\/([\d.]+)/.exec(ua);
    let persistente = null, agora = null;
    try { persistente = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : null; } catch (e) { /* sem informação */ }
    if (pasta) agora = await permissao(pasta);
    L.push("DIAGNÓSTICO ADMS — Central de Callback", "Gerado em: " + new Date().toLocaleString("pt-BR"), "");
    L.push("[Contexto]", `Aberta por: ${u.protocol === "file:" ? (u.host ? "arquivo em pasta de REDE (file://servidor/...)" : "arquivo LOCAL (file:///...)") : u.protocol.replace(":", "").toUpperCase() + " (" + u.host + ")"}`,
      `Contexto seguro: ${s(window.isSecureContext)}`, `Navegador: ${edge ? "Edge " + edge[1] : chrome ? "Chrome " + chrome[1] : "outro"}`,
      `APIs: pasta=${podePasta()} arquivo=${podeArquivo()} IndexedDB=${!!window.indexedDB} storage.persist=${!!(navigator.storage && navigator.storage.persist)}`,
      `Armazenamento persistente concedido: ${s(persistente)}`, "");
    L.push("[Conexão ADMS]", `Ao abrir a página: ${s(diag.conexao_ao_abrir)}`, `Permissão ao abrir: ${s(diag.permissao_ao_abrir)}`,
      `Conexão atual: ${pasta ? pasta.kind + " \"" + pasta.name + "\"" : "nenhuma"}`, `Permissão agora: ${s(agora)}`,
      `Gravação confirmada no IndexedDB (última seleção nesta página): ${s(diag.guardado_confirmado)}`,
      `Situação: ${situacao.tipo} — ${situacao.texto}`, "");
    L.push("[Arquivo]", diag.arquivo ? `Tamanho: ${diag.arquivo.tamanho} bytes · modificado: ${diag.arquivo.modificado} · consultado: ${diag.arquivo.consultado_em}` : "Não consultado nesta página.",
      versao ? `Última versão carregada: ${s(versao.processado_em)} (${s(versao.tamanho)} bytes)` : "Nenhuma versão carregada.", "");
    const c = diag.csv;
    L.push("[CSV — última leitura]");
    if (!c) L.push("Ainda não lido neste computador.");
    else {
      L.push(`Lido em: ${c.lido_em} · codificação: ${c.codificacao} · separador: ${JSON.stringify(c.separador)} · linhas: ${c.linhas}`,
        `Colunas: ${c.cabecalho.join(" | ")}`, `Colunas esperadas ausentes: ${c.colunas_ausentes.join(", ") || "nenhuma"}`);
      for (const [campo, r] of Object.entries(c.datas)) {
        const fmt = Object.entries(r.formatos_nao_reconhecidos).map(([p, n]) => `"${p}" ×${n}`).join(", ");
        L.push(`Data "${r.coluna}" (${campo}): ${r.presente ? `${r.reconhecidas} reconhecida(s) de ${r.total}, ${r.vazias} vazia(s)${fmt ? "; formatos NÃO reconhecidos: " + fmt : ""}` : "coluna AUSENTE no arquivo"}`);
      }
    }
    L.push("", "[Erros recentes]", ...(diag.erros.length ? diag.erros.map((e) => `${e.em} · ${e.onde}: ${e.nome} — ${e.mensagem}`) : ["nenhum"]));
    return L.join("\n");
  }
  async function mostrarDiagnostico() {
    const t = await relatorio(), caixa = $("#modal-caixa");
    if (!caixa) return;
    caixa.className = "modal-caixa larga"; caixa.dataset.livre = "1";
    caixa.innerHTML = `<button type="button" class="fechar" id="pa-diag-fechar">Fechar</button><h2>Diagnóstico da conexão ADMS</h2>
      <p class="mini">Sem dados de clientes: só contexto, permissões, erros e o formato das colunas. Pode ser copiado e enviado ao suporte.</p>
      <textarea id="pa-diag-texto" readonly class="pa-diag-texto">${esc(t)}</textarea>
      <div class="botoes fim"><button type="button" class="acao" id="pa-diag-copiar">Copiar</button></div>`;
    $("#modal").classList.remove("oculto");
    const fechar = () => { $("#modal").classList.add("oculto"); caixa.className = "modal-caixa"; };
    $("#pa-diag-fechar").onclick = fechar;
    $("#pa-diag-copiar").onclick = async () => {
      const ta = $("#pa-diag-texto");
      try { await navigator.clipboard.writeText(ta.value); window.CentralUI.toast("Diagnóstico copiado."); }
      catch (e) { ta.select(); try { document.execCommand("copy"); window.CentralUI.toast("Diagnóstico copiado."); } catch (x) { window.CentralUI.toastErro("Selecione o texto e copie com Ctrl+C.", true); } }
    };
  }

  /* ------------------------------------------------------------ ganchos da Central (js/app.js) */
  async function iniciar() {
    srv = window.CentralUI.servico;
    if (!$("#pasta-adms")) return;
    if (suportado()) {
      const h = await lerChave(CHAVE_PASTA);
      pasta = h && (h.kind === "directory" || h.kind === "file") ? h : null;
      diag.conexao_ao_abrir = pasta ? `${pasta.kind} "${pasta.name}" encontrada no IndexedDB` : "nenhuma conexão guardada neste navegador";
      versao = pasta ? await lerChave(CHAVE_VERSAO) : null;
      diag.csv = await lerChave(CHAVE_DIAG);
      if (pasta) diag.permissao_ao_abrir = await permissao(pasta);
    }
    // O operador clica em "Abrir o turno" de qualquer forma: esse clique também renova a autorização expirada (sem nova seleção).
    const form = $("#form-dia");
    if (form) form.addEventListener("submit", () => { if (pasta && situacao.tipo === "permissao") reconectar(); }, true);
    sessaoVista = srv.estado().sessao ? srv.estado().sessao.id : null;
    await verificar();
  }
  /* Chamado a cada redesenho da Central: só age quando um turno acaba de ser aberto (para carregar o CSV que esperava o turno). */
  function aoCarregar(estado) {
    if (!srv || sessaoVista === undefined) return;
    const id = estado.sessao ? estado.sessao.id : null;
    if (id && id !== sessaoVista) { sessaoVista = id; verificar(); } else sessaoVista = id;
  }
  /* "Preencher datas ausentes" (js/app.js): lê o chamadas_incidentes.csv ATUAL e devolve os bytes. NÃO importa, NÃO atualiza o
     lote e NÃO muda a versão memorizada. Chamado num clique (a autorização expirada pode ser renovada nele). */
  async function lerArquivoAtual() {
    if (!suportado()) throw new Error("Este navegador não permite ler a pasta ADMS (use o Edge ou o Chrome).");
    if (!pasta) throw new Error(`Pasta ADMS não conectada: conecte a pasta (ou o arquivo ${NOME_ARQUIVO}) na faixa Pasta ADMS.`);
    let perm = await permissao(pasta);
    if (perm !== "granted") { try { perm = await pasta.requestPermission({ mode: "read" }); } catch (e) { anotarErro("requestPermission (datas)", e); } }
    if (perm !== "granted") throw new Error("Sem autorização para ler a pasta ADMS. Clique em Renovar autorização e tente de novo.");
    if (emAndamento) await emAndamento.catch(() => {}); // não lê junto com uma verificação em curso
    let fh, f, lido;
    try { fh = await acharArquivo(pasta); } catch (e) { anotarErro("abrir (datas)", e); throw new Error(situacaoDoErro(e)[1]); }
    if (!fh) throw new Error(`${NOME_ARQUIVO} não encontrado na pasta ADMS.`);
    try { f = await fh.getFile(); lido = await lerEstavel(fh, f); } catch (e) { anotarErro("ler (datas)", e); throw new Error(situacaoDoErro(e)[1]); }
    if (!lido) throw new Error("O ADMS está gravando o arquivo agora. Tente de novo em instantes.");
    return { nome: lido.arquivo.name, bytes: lido.bytes, modificado: lido.arquivo.lastModified };
  }
  window.CentralPastaADMS = { iniciar, aoCarregar, verificar, situacao: () => situacao, diagnostico: relatorio, lerArquivoAtual, NOME_ARQUIVO };
})();
