/* DESPACHO OTIMIZADO COI 2.1 — tela. Lê LOCALMENTE (File System Access), sem rede e sem gravar no ADMS, DUAS fontes da pasta ADMS:
   - chamadas_incidentes.csv (o mesmo da Central): endereço, bairro, chamadas — a base dos lotes;
   - Incidentes.xlsx (só o Despacho lê): status, equipes, horários de atribuição/envio/deslocamento, alimentador/subestação.
   - Conexão: a MESMA que a Central guardou (banco da Central, chave "pasta_adms"); só LÊ esse banco. Pasta conectada = os dois
     arquivos com UMA autorização. Se a Central guardou só o arquivo CSV, o Incidentes.xlsx pode ser selecionado aqui (uma vez).
   - ATUALIZAR: lê as duas fontes (cada uma só se estiver estável: tamanho e data iguais antes e depois da leitura), valida cada
     uma por inteiro e SÓ DEPOIS recalcula a tela, de uma vez. Fonte que falhar (ausente, em gravação, incompleta, corrompida,
     extração antiga, sem registros) mantém a SUA última leitura válida e mostra o aviso; a outra segue normalmente.
   - Sem Incidentes.xlsx lido nenhuma vez: funcionamento 2.0 (só chamadas), com aviso de que nada foi filtrado por status.
   - A cada CFG.verificarACadaSeg (página visível) confere data/tamanho e relê só o que mudou.
   - Dados só em memória. Guardados no navegador: polo escolhido (local), seleção e INCs já copiados (só nesta aba). */
"use strict";
(function () {
  const CFG = window.DespachoConfig, M = window.DespachoMotor, DI = window.DespachoIncidentes, X = window.LeitorXLSX;
  const $ = (s) => document.querySelector(s);
  const params = new URLSearchParams(location.search);
  const sufixo = params.get("bd") ? "-" + params.get("bd").replace(/[^a-z0-9-]/gi, "").slice(0, 30) : "";
  const BANCOS_CENTRAL = ["central-callback-coi-dev" + sufixo, "central-callback-coi" + sufixo]; // nomes da Central (js/app.js)
  const BANCO_PROPRIO = "despacho-otimizado-coi" + sufixo, CHAVE_CENTRAL = "pasta_adms", CHAVE_PROPRIA = "arquivo_chamadas", CHAVE_INC = "arquivo_incidentes";
  const K_POLO = "despacho-polo" + sufixo, K_SEL = "despacho-sel" + sufixo, K_COP = "despacho-copiados" + sufixo;
  const ARQ_INC = CFG.incidentes.arquivo, NOME_INC = "Incidentes.xlsx";
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));
  const hhmm = (ms) => (ms ? new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—");
  const dataHora = (ms) => (ms ? new Date(ms).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");
  const isoCurto = (iso) => { const m = /^\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso || ""); return m ? `${m[2]}/${m[1]} ${m[3]}:${m[4]}` : "—"; };
  const ler = (loja, k, padrao) => { try { const v = loja.getItem(k); return v ? JSON.parse(v) : padrao; } catch (e) { return padrao; } };
  const gravar = (loja, k, v) => { try { loja.setItem(k, JSON.stringify(v)); } catch (e) { /* sem armazenamento */ } };

  /* Uma fonte: estado da ÚLTIMA tentativa + a ÚLTIMA LEITURA VÁLIDA (a que a tela usa). */
  const novaFonte = () => ({ estado: "verificando", aviso: "", verificadoEm: null, leitura: null });
  const S = {
    con: null, conInc: null, estado: "verificando", aviso: "", arquivo: null, lidoEm: null, verificadoEm: null, dados: null, lendo: false,
    fontes: { chamadas: novaFonte(), incidentes: novaFonte() },
    f: { polo: ler(localStorage, K_POLO, ""), municipio: "", bairro: "", alimentador: "", circuito: "", prioridade: "", status: "", equipe: "", busca: "" },
    aberto: null, detalhe: null, verSemInc: false, verExcecoes: false,
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
  async function guardarProprio(chave, h) {
    let arm = null;
    try { arm = await new window.Armazenamento(BANCO_PROPRIO).iniciar(); await arm.gravarArquivo(chave, h); return true; } catch (e) { return false; }
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
  /* Procura UM arquivo pelo nome (sem diferenciar maiúsculas) na pasta, ou devolve o próprio arquivo se for ele. */
  async function acharArquivo(h, nome) {
    if (h.kind === "file") return h.name.toLowerCase() === nome ? h : null;
    try { return await h.getFileHandle(nome); } catch (e) { if (e.name !== "NotFoundError" && e.name !== "TypeMismatchError") throw e; }
    for await (const [n, x] of h.entries()) if (x.kind === "file" && n.toLowerCase() === nome) return x;
    return null;
  }
  /* Leitura segura (mesma regra da Central, js/pasta-adms.js, reforçada): tamanho e data iguais ANTES e DEPOIS de ler os bytes;
     se o ADMS regravar no meio, tenta de novo (até 4 vezes). Nunca devolve arquivo pela metade. */
  async function lerEstavel(fh, primeiro) {
    let a = primeiro;
    for (let t = 0; t < 4; t++) {
      await espera(t === 0 ? 300 : 1200);
      const b = await fh.getFile();
      if (b.size > 0 && b.size === a.size && b.lastModified === a.lastModified) {
        try {
          const bytes = new Uint8Array(await b.arrayBuffer()), depois = await fh.getFile();
          if (bytes.length === b.size && depois.size === b.size && depois.lastModified === b.lastModified) return { arquivo: b, bytes };
        } catch (e) { if (e.name !== "NotReadableError") throw e; }
      }
      a = await fh.getFile();
    }
    return null;
  }
  const msgErro = (e) => (e && (e.name === "NotAllowedError" || e.name === "SecurityError") ? "sem permissão de leitura"
    : e && (e.name === "NotFoundError" || e.name === "NotReadableError") ? "arquivo ou pasta indisponível (rede fora, pasta movida ou arquivo removido)" : (e && e.message) || String(e));

  /* ------------------------------------------------------------ leitura das fontes */
  /* Interpreta os bytes de uma fonte. Erro = arquivo recusado (inválido, incompleto, corrompido, colunas ausentes). */
  async function interpretar(nome, bytes) {
    if (nome === "chamadas") { const dados = M.processar(bytes); return { dados, total: dados.resumo.chamadas_validas }; }
    const dados = DI.processar(await X.ler(bytes, { aba: CFG.incidentes.aba }));
    return { dados, total: dados.resumo.registros };
  }
  const MOTIVO_RECUSA = {
    extracao_antiga: "o arquivo encontrado é MAIS ANTIGO que a leitura em uso (extração antiga): a leitura atual foi mantida",
    sem_registros: "o arquivo novo não tem nenhum registro (exportação incompleta?): a leitura anterior foi mantida",
  };
  /* Lê UMA fonte e, se válida, troca a SUA última leitura válida. Não mexe na tela. Devolve true se a leitura válida mudou. */
  async function lerFonte(nome, h, forcar) {
    const F = S.fontes[nome], alvo = nome === "chamadas" ? CFG.arquivo : ARQ_INC;
    if (!h) { F.estado = "sem_conexao"; return false; }
    let fh, f;
    try { fh = await acharArquivo(h, alvo); } catch (e) { F.estado = "erro"; F.aviso = msgErro(e); return false; }
    if (!fh) { F.estado = "nao_encontrado"; return false; }
    try { f = await fh.getFile(); } catch (e) { F.estado = "erro"; F.aviso = msgErro(e); return false; }
    F.verificadoEm = Date.now();
    const L = F.leitura;
    if (!forcar && L && L.arquivo.size === f.size && L.arquivo.lastModified === f.lastModified) { F.estado = "ok"; F.aviso = ""; return false; }
    let lido;
    try { lido = await lerEstavel(fh, f); } catch (e) { F.estado = "erro"; F.aviso = msgErro(e); return false; }
    if (!lido) { F.estado = "em_gravacao"; return false; }
    let r;
    try { r = await interpretar(nome, lido.bytes); }
    catch (e) { F.estado = "erro"; F.aviso = "arquivo não reconhecido: " + ((e && e.message) || e); return false; }
    const nova = { arquivo: { nome: lido.arquivo.name, size: lido.arquivo.size, lastModified: lido.arquivo.lastModified }, total: r.total, dados: r.dados, lidoEm: Date.now() };
    const dec = M.aceitarLeitura(L, nova);
    if (!dec.aceita) { F.estado = "recusado"; F.aviso = MOTIVO_RECUSA[dec.motivo] || dec.motivo; return false; }
    F.leitura = nova; F.estado = "ok"; F.aviso = "";
    return true;
  }
  /* Recalcula a tela a partir das ÚLTIMAS LEITURAS VÁLIDAS (tudo de uma vez: sem estado intermediário). */
  function recalcular() {
    const c = S.fontes.chamadas.leitura, i = S.fontes.incidentes.leitura;
    if (!c) return;
    const consol = M.consolidar(c.dados, i ? i.dados : null);
    S.dados = { colunas: c.dados.colunas, resumo: c.dados.resumo, semInc: c.dados.semInc, incs: consol.incs, consol, incidentes: i ? i.dados : null };
    S.arquivo = c.arquivo; S.lidoEm = c.lidoEm;
    const ids = new Set(consol.incs.map((x) => x.id));
    for (const id of [...S.sel]) if (!ids.has(id)) S.sel.delete(id); // INC excluída, em exceção ou fora do arquivo deixa a seleção
    gravar(sessionStorage, K_SEL, [...S.sel]);
  }
  /* Conexão do Incidentes.xlsx: a pasta da Central (mesma autorização) ou o arquivo selecionado aqui. */
  async function handleIncidentes(gesto) {
    if (S.con && S.con.h.kind === "directory") return S.con.h;
    if (!S.conInc) S.conInc = await lerChave(BANCO_PROPRIO, CHAVE_INC);
    if (!S.conInc) return null;
    return (await permissao(S.conInc, gesto)) === "granted" ? S.conInc : "permissao";
  }
  async function atualizar(forcar, gesto) {
    if (S.lendo) return;
    S.lendo = true; render();
    try {
      if (S.estado === "manual") return;
      if (!S.con) S.con = await obterConexao();
      if (!S.con) { S.estado = temAPI() ? "sem_conexao" : "sem_api"; return; }
      const perm = await permissao(S.con.h, gesto);
      if (perm !== "granted") { S.estado = "permissao"; return; }
      const hInc = await handleIncidentes(gesto);
      const [mc, mi] = await Promise.all([
        lerFonte("chamadas", S.con.h, forcar),
        hInc === "permissao" ? Promise.resolve((S.fontes.incidentes.estado = "permissao", false)) : lerFonte("incidentes", hInc, forcar),
      ]);
      const c = S.fontes.chamadas;
      S.estado = c.estado; S.aviso = c.aviso; S.verificadoEm = c.verificadoEm;
      if (mc || mi || (!S.dados && c.leitura)) recalcular();
    } catch (e) { S.estado = "erro"; S.aviso = msgErro(e); }
    finally { S.lendo = false; render(); document.body.dataset.pronto = "1"; }
  }
  async function selecionarArquivo() {
    let hs;
    try { hs = await window.showOpenFilePicker({ id: "despacho-chamadas", multiple: false, types: [{ description: "CSV do ADMS", accept: { "text/csv": [".csv"] } }] }); }
    catch (e) { if (e.name !== "AbortError") toast("Não foi possível selecionar: " + e.message, true); return; }
    const h = hs && hs[0]; if (!h) return;
    if (h.name.toLowerCase() !== CFG.arquivo) { toast(`Escolha o arquivo ${CFG.arquivo} (foi escolhido "${h.name}").`, true); return; }
    if (!(await guardarProprio(CHAVE_PROPRIA, h))) toast("O arquivo foi aberto, mas a conexão não ficou guardada neste navegador.", true);
    S.con = { h, origem: "despacho" }; S.estado = "verificando"; S.fontes.chamadas = novaFonte(); S.dados = null; S.arquivo = null; await atualizar(true, true);
  }
  async function selecionarIncidentes() {
    let hs;
    try { hs = await window.showOpenFilePicker({ id: "despacho-incidentes", multiple: false, types: [{ description: "Incidentes do ADMS", accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] } }] }); }
    catch (e) { if (e.name !== "AbortError") toast("Não foi possível selecionar: " + e.message, true); return; }
    const h = hs && hs[0]; if (!h) return;
    if (h.name.toLowerCase() !== ARQ_INC) { toast(`Escolha o arquivo ${NOME_INC} (foi escolhido "${h.name}").`, true); return; }
    if (!(await guardarProprio(CHAVE_INC, h))) toast("O arquivo foi aberto, mas a conexão não ficou guardada neste navegador.", true);
    S.conInc = h; S.fontes.incidentes = novaFonte(); await atualizar(true, true);
  }
  /* Arquivo avulso (sem atualização automática): CSV de chamadas ou Incidentes.xlsx, cada um na sua fonte. */
  async function abrirManual(file) {
    const ehInc = /\.xlsx$/i.test(file.name), nome = ehInc ? "incidentes" : "chamadas";
    try {
      const r = await interpretar(nome, new Uint8Array(await file.arrayBuffer()));
      S.fontes[nome] = { estado: "ok", aviso: "", verificadoEm: Date.now(), leitura: { arquivo: { nome: file.name, size: file.size, lastModified: file.lastModified }, total: r.total, dados: r.dados, lidoEm: Date.now() } };
      if (!ehInc) { S.con = null; S.estado = "manual"; }
      recalcular(); render();
    } catch (e) { toast("Arquivo não reconhecido: " + ((e && e.message) || e), true); }
  }

  /* ------------------------------------------------------------ cópia (só INCs operacionais) */
  async function copiar(ids, oque) {
    const validos = new Set(S.dados ? S.dados.incs.map((i) => i.id) : []);
    ids = ids.filter((id) => validos.has(id)); // garantia: INC excluída/exceção nunca vai para o SIGODE
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
  const comAdms = () => !!(S.dados && S.dados.incidentes);
  function tagStatus(i) {
    if (!i.situacao) return "";
    return tag(i.situacao.destaque ? "interrompido" : "st", i.situacao.rotulo, "Status no Incidentes.xlsx (ADMS)");
  }
  function tagsInc(i) {
    const t = [];
    if (i.risco.nivel >= 2) t.push(tag("vermelho", "Risco de vida", i.risco.origem));
    else if (i.risco.nivel === 1) t.push(tag("laranja", "Indício de risco", i.risco.origem));
    if (i.fase.nivel === "confirmada") t.push(tag("azul-forte", "Falta de fase", i.fase.origem));
    else if (i.fase.nivel === "possivel") t.push(tag("azul", "Possível falta de fase", i.fase.origem));
    for (const c of i.clientes) t.push(tag("neutro", c, "Cust. prioritárias do ADMS"));
    if (i.chamadas > 1) t.push(tag("neutro", `${i.chamadas} chamadas`, "Chamadas do mesmo INC consolidadas"));
    if (i.inconsistencias && i.inconsistencias.length) t.push(tag("inconsistente", "inconsistência", i.inconsistencias.join("\n")));
    return t.join("");
  }
  function celEquipe(i) {
    if (!i.adms) return `<span class="fraco">—</span>`;
    if (!i.adms.equipes.length) return tag("sem-equipe", "sem equipe", "Nenhuma equipe associada no Incidentes.xlsx");
    const e = i.adms.equipes;
    return `<span class="equipe" title="${esc(e.join(", "))}">${esc(e[0])}${e.length > 1 ? ` <span class="fraco">+${e.length - 1}</span>` : ""}</span>`;
  }
  function eletrica(itens) {
    const p = [];
    if (itens.alimentadores.length) p.push("Alim. " + itens.alimentadores.join(", "));
    if (itens.circuitos.length) p.push("Circ. " + itens.circuitos.join(", "));
    if (itens.subestacoes && itens.subestacoes.length) p.push("SE " + itens.subestacoes.join(", "));
    return p.length ? `<span class="eletrica">${esc(p.join(" · "))}</span>` : "";
  }
  const hora = (h) => (h && h.iso ? isoCurto(h.iso) : h && h.original ? `${h.original} (formato não reconhecido)` : "não informado");
  function linhaInc(i, lote) {
    const end = [i.logradouro, i.numeroEnd, i.complemento].filter(Boolean).join(", ") || (i.localizacoes[0] || (i.localizacaoIncompleta ? "localização incompleta (só município)" : "sem endereço"));
    const aberto = S.detalhe === i.id, adms = comAdms();
    let h = `<tr class="inc${S.sel.has(i.id) ? " sel" : ""}" data-inc="${esc(i.id)}">
      <td class="c-sel"><input type="checkbox" data-sel="${esc(i.id)}"${S.sel.has(i.id) ? " checked" : ""} aria-label="Selecionar ${esc(i.id)}"></td>
      <td class="c-inc">${esc(i.id)}${S.copiados.has(i.id) ? `<span class="ok" title="Copiada às ${hhmm(S.copiados.get(i.id))}">✓</span>` : ""}</td>
      <td class="c-end" title="${esc(i.localizacoes.join(" | "))}">${esc(end)}${lote.tipo === "nao_identificado" ? ` <span class="fraco">· ${esc(i.bairroMotivo)}</span>` : ""}</td>
      ${adms ? `<td class="c-status">${tagStatus(i)}</td><td class="c-equipe">${celEquipe(i)}</td>` : ""}
      <td class="c-hora">${esc(isoCurto(i.primeira))}</td>
      <td class="c-tags">${tagsInc(i)}</td>
      <td class="c-mais"><button type="button" class="mini fantasma" data-detalhe="${esc(i.id)}" aria-expanded="${aberto}">${aberto ? "Fechar" : "Detalhes"}</button></td></tr>`;
    if (aberto) {
      const d = [];
      d.push(["Localização (original do ADMS)", i.localizacoes.length ? i.localizacoes.map(esc).join("<br>") : i.localizacaoIncompleta ? '<span class="laranja-t">sem chamada: só o município do Incidentes.xlsx é conhecido</span>' : "vazia"]);
      d.push(["Município", esc(i.municipio.status === "ok" ? `${i.municipio.codigo} — ${i.municipio.nome}` : `não identificado (${i.municipio.motivo || i.municipio.status})`)]);
      d.push(["Bairro", i.bairro ? `${esc(i.bairro.nome)} <span class="fraco">(${esc(i.bairro.origem)})</span>` : `<span class="laranja-t">não identificado</span> <span class="fraco">(${esc(i.bairroMotivo)})</span>`]);
      if (i.bairrosDiferentes.length) d.push(["Atenção", esc("chamadas em bairros diferentes: " + i.bairrosDiferentes.join(", ") + " — conferir")]);
      if (i.adms) {
        const a = i.adms;
        d.push(["Status no ADMS", `${tagStatus(i)} <span class="fraco">Incidentes.xlsx${a.ultimaAlteracao ? ` · última alteração ${esc(isoCurto(a.ultimaAlteracao))}` : ""}</span>`]);
        d.push(["Equipe(s)", a.equipes.length ? esc(a.equipes.join(", ")) : '<span class="laranja-t">nenhuma equipe associada</span>']);
        d.push(["Horários do ADMS", `atribuição ${esc(hora(a.horarios.atribuicao))} · envio ${esc(hora(a.horarios.enviada))} · deslocamento ${esc(hora(a.horarios.deslocamento))}`]);
        d.push(["Alimentador / subestação", esc([a.alimentador && "Alim. " + a.alimentador + (a.alimentadorNormal && a.alimentadorNormal !== a.alimentador ? ` (normal ${a.alimentadorNormal})` : ""), a.subestacao && "SE " + a.subestacao].filter(Boolean).join(" · ") || "não informado")]);
        if (a.problema || a.causa) d.push(["Problema / causa (ADMS)", esc([a.problema, a.causa && "causa " + a.causa].filter(Boolean).join(" · "))]);
        if (a.obs.length) d.push(["Observação do ADMS", `<span class="obs">${esc(a.obs.join("\n\n"))}</span>`]);
      } else if (adms) d.push(["Status no ADMS", '<span class="laranja-t">sem registro no Incidentes.xlsx</span>']);
      if (i.inconsistencias && i.inconsistencias.length) d.push(["Inconsistências", `<span class="laranja-t">${i.inconsistencias.map(esc).join("<br>")}</span>`]);
      d.push(["Alimentador / circuito", esc([i.alimentadores.join(", "), i.circuitos.join(", ")].filter(Boolean).join(" · ") || "não informado no arquivo")]);
      if (i.equipamentos.length) d.push(["Equipamento", esc(i.equipamentos.join(", "))]);
      d.push(["Falta de fase", esc(i.fase.nivel === "confirmada" ? "confirmada — " + i.fase.origem : i.fase.nivel === "possivel" ? "possível — " + i.fase.origem : "sem informação suficiente")]);
      if (i.risco.nivel) d.push(["Risco", esc(i.risco.origem)]);
      d.push(["Chamadas", i.calls.length ? i.calls.map((c) => `${esc(c.call_id)} · ${esc(isoCurto(c.horario))} · ${esc(c.motivo || "—")}`).join("<br>") : "nenhuma chamada no chamadas_incidentes.csv"]);
      d.push(["Despacho", adms ? "<strong>confirmar no SIGODE</strong> (o Incidentes.xlsx informa status, equipe e horários do ADMS; aceite, chegada e conclusão não são informados)"
        : "<strong>consultar no SIGODE</strong> (o arquivo de chamadas não informa equipe nem despacho)"]);
      h += `<tr class="detalhe"><td></td><td colspan="${adms ? 7 : 5}"><dl>${d.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("")}</dl></td></tr>`;
    }
    return h;
  }
  function htmlLote(l) {
    const aberto = S.aberto === l.chave, ids = l.incs.map((i) => i.id), nSel = ids.filter((x) => S.sel.has(x)).length, adms = comAdms();
    const todosCop = ids.every((x) => S.copiados.has(x)), ult = Math.max(0, ...ids.map((x) => S.copiados.get(x) || 0));
    const tags = [];
    if (l.nRiscoVida) tags.push(tag("vermelho", `${l.nRiscoVida} risco de vida`));
    else if (l.nRisco) tags.push(tag("laranja", `${l.nRisco} indício de risco`));
    if (l.nFase) tags.push(tag(l.nFaseConf ? "azul-forte" : "azul", `${l.nFase} falta de fase${l.nFaseConf ? "" : " (possível)"}`));
    if (l.nInterrompido) tags.push(tag("interrompido", `${l.nInterrompido} interrompido`));
    if (l.nSemEquipe) tags.push(tag("sem-equipe", `${l.nSemEquipe} sem equipe`));
    if (l.nInconsistente) tags.push(tag("inconsistente", `${l.nInconsistente} inconsistência`));
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
      ${aberto ? `<div class="lote-corpo">${l.tipo === "nao_identificado" ? `<p class="nota">Bairro não reconhecido no endereço do ADMS (ou INC sem chamada): o texto original está em Detalhes. Confira a localização antes de juntar com outro lote.</p>` : ""}
        <table><thead><tr><th></th><th>INC</th><th>Endereço (ADMS)</th>${adms ? "<th>Status</th><th>Equipe</th>" : ""}<th>1ª chamada</th><th>Indicações</th><th></th></tr></thead><tbody>${l.incs.map((i) => linhaInc(i, l)).join("")}</tbody></table></div>` : ""}
    </div>`;
  }
  function preencherSelect(el, todos, ops, valor, indisponivel, dica) {
    const tem = ops.some((o) => o.valor === valor);
    el.innerHTML = `<option value="">${esc(indisponivel || todos)}</option>` + ops.map((o) => `<option value="${esc(o.valor)}"${o.valor === valor ? " selected" : ""}>${esc(o.rotulo)} (${o.n})</option>`).join("");
    el.disabled = !!indisponivel; el.title = indisponivel ? dica || "Coluna ausente no chamadas_incidentes.csv: não há como filtrar sem inventar o dado" : "";
    return tem ? valor : "";
  }
  const b = (acao, t, cls = "") => `<button type="button" class="mini ${cls}" data-fonte="${acao}">${t}</button>`;
  function renderFonte() {
    const el = $("#fonte");
    const msg = {
      sem_conexao: [`A pasta ADMS não está conectada na Central neste navegador. Conecte-a na Central (faixa Pasta ADMS) ou selecione o arquivo ${CFG.arquivo} aqui.`, b("selecionar", "Selecionar arquivo", "primario") + b("manual", "Abrir arquivo avulso")],
      sem_api: ["Este navegador não permite acessar a pasta ADMS (use o Edge ou o Chrome). É possível abrir o arquivo avulso, sem atualização automática.", b("manual", "Abrir arquivo avulso", "primario")],
      permissao: ["O navegador precisa da sua autorização para ler os arquivos (a mesma da Central). Clique em Autorizar leitura.", b("autorizar", "Autorizar leitura", "primario")],
      nao_encontrado: [`${CFG.arquivo} não foi encontrado na pasta conectada.${S.dados ? " A última leitura válida continua na tela." : ""}`, b("atualizar", "Tentar de novo") + b("selecionar", "Selecionar arquivo")],
      em_gravacao: ["O ADMS está gravando o arquivo de chamadas agora: a leitura anterior foi mantida. Tente em instantes.", b("atualizar", "Tentar de novo")],
      recusado: [`Chamadas: ${S.aviso}.`, b("atualizar", "Tentar de novo")],
      erro: [`Falha na leitura de ${CFG.arquivo}: ${S.aviso}.${S.dados ? " A última leitura válida continua na tela." : ""}`, b("atualizar", "Tentar de novo") + (temAPI() ? b("selecionar", "Selecionar arquivo") : "")],
      manual: ["Arquivo aberto avulso: sem atualização automática. Para atualizar, abra o arquivo de novo.", b("manual", "Abrir outro arquivo")],
    }[S.estado];
    el.className = "fonte" + (msg ? " s-" + S.estado : " oculto");
    el.innerHTML = msg ? `<span>${esc(msg[0])}</span><span class="botoes">${msg[1]}</span>` : "";
  }
  /* Faixa da 2ª fonte (Incidentes.xlsx) + avisos de atualidade das duas fontes. Separada da faixa das chamadas. */
  function renderFonteInc() {
    const el = $("#fonte-inc"), F = S.fontes.incidentes, tem = !!F.leitura, manter = tem ? " A última leitura válida do Incidentes.xlsx continua em uso." : " Sem ele: lotes como na versão 2.0, sem status nem equipe — nada foi filtrado por status.";
    const linhas = [];
    if (S.estado !== "manual" && S.con && S.estado !== "permissao") {
      const m = {
        nao_encontrado: [`${NOME_INC} não foi encontrado na pasta conectada.${manter}`, b("atualizar", "Tentar de novo")],
        sem_conexao: [`A Central guardou só o arquivo de chamadas: selecione o ${NOME_INC} da mesma pasta ADMS (uma vez).${manter}`, b("selecionar-inc", `Selecionar ${NOME_INC}`, "primario")],
        permissao: [`O navegador precisa da sua autorização para ler o ${NOME_INC}.`, b("autorizar", "Autorizar leitura", "primario")],
        em_gravacao: [`O ADMS está gravando o ${NOME_INC} agora.${manter}`, b("atualizar", "Tentar de novo")],
        recusado: [`${NOME_INC}: ${F.aviso}.`, b("atualizar", "Tentar de novo")],
        erro: [`Falha na leitura do ${NOME_INC}: ${F.aviso}.${manter}`, b("atualizar", "Tentar de novo")],
      }[F.estado];
      if (m) linhas.push(`<div class="fonte s-${F.estado === "erro" || F.estado === "recusado" ? "erro" : "aviso"}" data-fonte-inc="${F.estado}"><span>${esc(m[0])}</span><span class="botoes">${m[1]}</span></div>`);
    } else if (S.estado === "manual" && !tem) linhas.push(`<div class="fonte s-aviso" data-fonte-inc="manual"><span>${esc(`Sem ${NOME_INC}: lotes sem status nem equipe. Abra também o ${NOME_INC} avulso, se tiver.`)}</span><span class="botoes">${b("manual", `Abrir ${NOME_INC} avulso`)}</span></div>`);
    const nomes = { chamadas: "chamadas_incidentes.csv", incidentes: NOME_INC };
    const avisos = M.avisosAtualidade({ chamadas: S.fontes.chamadas.leitura, incidentes: F.leitura }, Date.now());
    if (avisos.length) linhas.push(`<div class="atualidade" data-atualidade>${avisos.map((a) => a.tipo === "desatualizada"
      ? `<span>${esc(nomes[a.fonte])} sem atualização há ${a.minutos} min (o ADMS regrava a cada ~5-7 min): dados podem estar desatualizados.</span>`
      : `<span>As fontes estão distantes: ${esc(nomes[a.fonte])} foi gravado ${a.minutos} min antes da outra. Status e endereço podem não corresponder ao mesmo momento.</span>`).join("")}</div>`);
    el.innerHTML = linhas.join("");
    el.classList.toggle("oculto", !linhas.length);
  }
  function selo(el, t, L, estadoOk, rotulo) {
    if (!L) { el.className = "dados " + (S.lendo ? "lendo" : estadoOk === "vazio" ? "vazio" : "falha"); return; }
    const idade = L.arquivo.lastModified ? (Date.now() - L.arquivo.lastModified) / 60000 : 0;
    el.className = "dados " + (S.lendo ? "lendo" : estadoOk === "ok" ? (idade >= CFG.atualidade.desatualizadaMin ? "velho" : "ok") : "falha");
    el.title = `${rotulo}: o ADMS gravou ${L.arquivo.nome} em ${dataHora(L.arquivo.lastModified)}; lido às ${hhmm(L.lidoEm)}` + (idade >= CFG.atualidade.desatualizadaMin ? `. ATENÇÃO: sem atualização há ${Math.floor(idade)} min.` : "");
  }
  function renderDados() {
    const el = $("#dados"), t = $("#dados-texto"), c = S.fontes.chamadas.leitura;
    if (!S.dados || !c) { el.className = "dados " + (S.lendo ? "lendo" : "vazio"); t.textContent = S.lendo ? "Lendo…" : "Sem dados"; }
    else {
      selo(el, t, c, S.estado === "ok" || S.estado === "manual" ? "ok" : "falha", "Chamadas");
      t.textContent = `Arquivo de ${dataHora(c.arquivo.lastModified)} · lido às ${hhmm(c.lidoEm)}${S.estado === "manual" ? " (avulso)" : ""}`;
    }
    const ei = $("#dados-inc"), ti = $("#dados-inc-texto"), F = S.fontes.incidentes, i = F.leitura;
    if (!i) { ei.className = "dados " + (S.lendo ? "lendo" : "falha"); ti.textContent = S.lendo ? "Lendo…" : "não lido"; ei.title = `${NOME_INC}: nenhuma leitura válida ainda`; }
    else { selo(ei, ti, i, F.estado === "ok" ? "ok" : "falha", NOME_INC); ti.textContent = `Arquivo de ${dataHora(i.arquivo.lastModified)} · lido às ${hhmm(i.lidoEm)}`; }
  }
  /* Indicadores por status (2.1): clique filtra. Contados com os demais filtros, sem o de status/equipe. */
  function renderStatus(d) {
    const el = $("#status-ind");
    if (!d || !d.incidentes) { el.innerHTML = ""; el.classList.add("oculto"); return; }
    const k = M.montar(d.incs, { ...S.f, status: "", equipe: "" }).indicadores;
    const chip = (attr, v, rot, n, cls = "") => `<button type="button" class="chip-st ${cls}${S.f[attr] === v ? " ativo" : ""}" data-filtro="${attr}" data-valor="${esc(v)}" aria-pressed="${S.f[attr] === v}"><b data-ind="${esc(v)}">${n}</b> ${esc(rot)}</button>`;
    el.innerHTML = DI.STATUS_OPERACIONAIS.map((s) => chip("status", s.codigo, s.rotulo, k.porStatus[s.codigo] || 0, s.destaque ? "interrompido" : "")).join("")
      + `<span class="sep"></span>` + chip("equipe", "sem", "sem equipe", k.semEquipe, k.semEquipe ? "sem-equipe" : "")
      + chip("equipe", "inconsistente", "com inconsistência", k.inconsistencias, k.inconsistencias ? "inconsistente" : "")
      + `<span class="fraco eq">${k.equipes} equipe(s) distinta(s) associada(s)</span>`;
    el.classList.remove("oculto");
  }
  function htmlExcecoes(d) {
    const c = d.consol, linha = (i) => `<tr><td class="c-inc">${esc(i.id)}</td><td>${esc(i.situacao.rotulo)}${i.situacao.original && i.situacao.original !== i.situacao.rotulo ? ` <span class="fraco">("${esc(i.situacao.original)}")</span>` : ""}</td>
      <td>${esc(i.situacao.motivo || "")}</td><td>${esc(i.municipio.nome || "—")}</td><td>${esc({ ambas: "chamadas + Incidentes", chamadas: "só chamadas", incidentes: "só Incidentes" }[i.origem])}</td></tr>`;
    const desc = d.incidentes ? d.incidentes.descartadas : [];
    return `<div class="excecoes" id="excecoes"><strong>Exceções — fora dos lotes, da seleção, dos contadores e da cópia</strong> (status vazio, desconhecido ou divergente, ou INC sem registro no ${NOME_INC}). Conferir no SIGODE/ADMS.
      ${c.excecoes.length ? `<table><thead><tr><th>INC</th><th>Status</th><th>Motivo</th><th>Município</th><th>Origem</th></tr></thead><tbody>${c.excecoes.map(linha).join("")}</tbody></table>` : '<p class="fraco">Nenhuma exceção.</p>'}
      ${desc.length ? `<p class="fraco">${desc.length} linha(s) do ${NOME_INC} descartada(s): ${desc.map((x) => `linha ${x.linha} — ${esc(x.motivo)}`).join("; ")}</p>` : ""}</div>`;
  }
  function render() {
    renderFonte(); renderFonteInc(); renderDados();
    $("#btn-atualizar").disabled = S.lendo;
    const d = S.dados, main = $("#lotes");
    const pol = $("#polo"), polos = d ? M.contarPolos(d.incs) : M.POLOS.map((p) => ({ ...p, n: null }));
    pol.innerHTML = `<option value="">Todos os polos${d ? ` (${d.incs.length})` : ""}</option>` + polos.map((p) => `<option value="${p.id}"${p.id === S.f.polo ? " selected" : ""} title="${esc(p.municipios.join(", "))}">${esc(p.nome)}${p.n !== null ? ` (${p.n})` : ""}</option>`).join("");
    renderStatus(d);
    if (!d) {
      main.innerHTML = `<div class="vazio">${S.lendo ? "Lendo o arquivo…" : "Nenhum dado carregado."}</div>`;
      $("#conferencia").innerHTML = ""; document.querySelectorAll("[data-kpi]").forEach((e) => (e.textContent = "—")); renderBandeja(); return;
    }
    // filtros (em conjunto): opções calculadas com os demais filtros aplicados
    const op = M.opcoes(d.incs, S.f), adms = !!d.incidentes, temAlim = d.incs.some((i) => i.alimentadores.length);
    S.f.municipio = preencherSelect($("#f-municipio"), "Todos os municípios", op.municipio, S.f.municipio);
    S.f.bairro = preencherSelect($("#f-bairro"), "Todos os bairros", op.bairro, S.f.bairro);
    S.f.alimentador = preencherSelect($("#f-alimentador"), "Todos os alimentadores", op.alimentador, S.f.alimentador, temAlim ? "" : "Alimentador: sem dado no arquivo");
    S.f.circuito = preencherSelect($("#f-circuito"), "Todos os circuitos", op.circuito, S.f.circuito, d.colunas.circuito ? "" : "Circuito: sem dado no arquivo");
    S.f.status = preencherSelect($("#f-status"), "Todos os status", op.status, S.f.status, adms ? "" : "Status: sem Incidentes.xlsx", `Status vem do ${NOME_INC} (não lido)`);
    $("#f-equipe").disabled = !adms; if (!adms) S.f.equipe = ""; $("#f-equipe").value = S.f.equipe;
    $("#f-prioridade").value = S.f.prioridade;
    const r = M.montar(d.incs, S.f), k = r.indicadores;
    const kp = (n, v) => { const e = document.querySelector(`[data-kpi="${n}"]`); e.textContent = v; e.dataset.atual = v; };
    kp("incs", k.incs); kp("lotes", k.lotes); kp("nao_ident", k.naoIdentificados); kp("fase", k.faseConfirmada + k.fasePossivel);
    document.querySelector('[data-kpi-det="incs"]').textContent = adms ? `${k.chamadas} chamada(s) · ${k.semEquipe} sem equipe` : `reunindo ${k.chamadas} chamada(s)`;
    document.querySelector('[data-kpi-det="lotes"]').textContent = `por município e bairro${k.lotesNaoIdent ? ` · +${k.lotesNaoIdent} não identificado(s)` : ""}`;
    document.querySelector('[data-kpi-det="fase"]').textContent = `${k.faseConfirmada} confirmada(s) · ${k.fasePossivel} possível(is)`;
    document.querySelector('[data-kpi="nao_ident"]').closest(".kpi").classList.toggle("zero", !k.naoIdentificados);
    $(".kpi-incs .rot").textContent = adms ? "INCs operacionais" : "INCs identificadas";
    // conferência com as fontes
    const R = d.resumo, polo = M.POLOS.find((p) => p.id === S.f.polo), C = d.consol.resumo;
    const fora = adms ? Object.entries(C.excluidasPorStatus).map(([s, n]) => `${n} ${s}`).join(", ") : "";
    $("#conferencia").innerHTML = `<span><strong>Fonte:</strong> ${R.linhas_lidas} linha(s) · ${R.chamadas_validas} chamada(s) válida(s) → <strong>${R.incs} INC(s)</strong>`
      + ` (${R.consolidadas} chamada(s) repetida(s) do mesmo INC consolidada(s))${R.chamadas_sem_inc ? ` · <button type="button" class="link" data-sem-inc>${R.chamadas_sem_inc} chamada(s) sem INC</button>` : ""}`
      + `${R.linhas_com_erro ? ` · ${R.linhas_com_erro} linha(s) com erro descartada(s)` : ""}${R.calls_repetidas ? ` · ${R.calls_repetidas} CALL repetida(s) contada(s) uma vez` : ""}</span>`
      + `<span>${polo ? `<strong>${esc(polo.nome)}:</strong> ${esc(polo.municipios.join(", "))} · ` : ""}Exibindo ${k.incs} INC(s)`
      + `${R.periodo ? ` · chamadas de ${isoCurto(R.periodo[0])} a ${isoCurto(R.periodo[1])}` : ""}</span>`
      + (adms ? `<span class="conf-inc" data-conf-inc><strong>${NOME_INC}:</strong> ${d.incidentes.resumo.registros} linha(s) → ${d.incidentes.resumo.incs} INC(s) · operacionais ${C.incs}`
        + ` (${C.ambas} nas duas fontes, ${C.soIncidentes} só no Incidentes)${fora ? ` · <strong>fora dos lotes:</strong> ${esc(fora)}` : ""}`
        + ` · <button type="button" class="link" data-excecoes>${C.excecoes} exceção(ões)</button></span>` : "")
      + (S.verSemInc ? `<div class="sem-inc"><strong>Chamadas sem número de INC</strong> (não entram em lotes: não há INC para lançar):<br>${d.semInc.map((c) => `${esc(c.call_id)} · ${esc(isoCurto(c.horario))} · ${esc(c.motivo || "—")} · ${esc(c.localizacao || "Localização vazia")}`).join("<br>")}</div>` : "")
      + (adms && S.verExcecoes ? htmlExcecoes(d) : "");
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
  $("#conferencia").addEventListener("click", (ev) => {
    if (ev.target.closest("[data-sem-inc]")) { S.verSemInc = !S.verSemInc; render(); }
    if (ev.target.closest("[data-excecoes]")) { S.verExcecoes = !S.verExcecoes; render(); }
  });
  $("#status-ind").addEventListener("click", (ev) => {
    const c = ev.target.closest("[data-filtro]"); if (!c) return;
    S.f[c.dataset.filtro] = S.f[c.dataset.filtro] === c.dataset.valor ? "" : c.dataset.valor; S.aberto = null; render();
  });
  const acaoFonte = (ev) => {
    const a = ev.target.closest("[data-fonte]"); if (!a) return;
    if (a.dataset.fonte === "autorizar" || a.dataset.fonte === "atualizar") atualizar(true, true);
    if (a.dataset.fonte === "selecionar") selecionarArquivo();
    if (a.dataset.fonte === "selecionar-inc") selecionarIncidentes();
    if (a.dataset.fonte === "manual") $("#arquivo-manual").click();
  };
  $("#fonte").addEventListener("click", acaoFonte); $("#fonte-inc").addEventListener("click", acaoFonte);
  $("#arquivo-manual").addEventListener("change", (ev) => { const f = ev.target.files && ev.target.files[0]; if (f) abrirManual(f); ev.target.value = ""; });
  $("#polo").addEventListener("change", (ev) => { S.f.polo = ev.target.value; S.f.municipio = S.f.bairro = S.f.alimentador = S.f.circuito = ""; S.aberto = null; gravar(localStorage, K_POLO, S.f.polo); render(); });
  for (const [id, campo] of [["#f-municipio", "municipio"], ["#f-bairro", "bairro"], ["#f-alimentador", "alimentador"], ["#f-circuito", "circuito"], ["#f-prioridade", "prioridade"], ["#f-status", "status"], ["#f-equipe", "equipe"]])
    $(id).addEventListener("change", (ev) => { S.f[campo] = ev.target.value; if (campo === "municipio") S.f.bairro = ""; S.aberto = null; render(); });
  let tmBusca; $("#f-busca").addEventListener("input", (ev) => { clearTimeout(tmBusca); tmBusca = setTimeout(() => { S.f.busca = ev.target.value.trim(); render(); }, 200); });
  $("#f-limpar").addEventListener("click", () => { Object.assign(S.f, { municipio: "", bairro: "", alimentador: "", circuito: "", prioridade: "", status: "", equipe: "", busca: "" }); $("#f-busca").value = ""; render(); });
  $("#btn-atualizar").addEventListener("click", () => (S.estado === "manual" ? $("#arquivo-manual").click() : atualizar(true, true)));
  $("#btn-central").addEventListener("click", (ev) => { ev.preventDefault(); location.href = "index.html" + location.search; });
  $("#sel-limpar").addEventListener("click", () => { S.sel.clear(); salvarSel(); render(); });
  $("#sel-copiar").addEventListener("click", () => copiar([...S.sel], "selecionadas"));
  $("#sel-itens").addEventListener("click", (ev) => { const bt = ev.target.closest("[data-tirar]"); if (bt) { S.sel.delete(bt.dataset.tirar); salvarSel(); render(); } });
  // conferência periódica (só data/tamanho; relê só o que mudou) e ao voltar para a aba
  setInterval(() => { if (document.visibilityState === "visible" && S.con && S.estado !== "manual" && !S.lendo) atualizar(false, false); }, CFG.verificarACadaSeg * 1000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && S.con && S.estado === "ok") atualizar(false, false); });
  setInterval(() => { if (S.dados) { renderDados(); renderFonteInc(); } }, 30000); // idade dos arquivos nos selos e avisos de atualidade

  window.DespachoUI = { estado: () => S, atualizar, render, M };
  render();
  atualizar(true, false);
})();
