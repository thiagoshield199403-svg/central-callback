/* DESPACHO OTIMIZADO 2.1 — Incidentes.xlsx (aba "incidentes" da pasta ADMS): status, equipes e horários de cada INC.
   Recebe as linhas já lidas por js/despacho-xlsx.js (LeitorXLSX). Funções puras: sem tela, sem rede, sem gravação.
   - Cabeçalho na 3ª linha (coluna A vazia), procurado nas 10 primeiras linhas se mudar de lugar (com aviso). Nomes de coluna
     normalizados para comparar (sem acento, maiúsculas, "_" = espaço) — o nome ORIGINAL fica guardado e é o mostrado.
   - Colunas obrigatórias (js/despacho-config.js): sem alguma, o arquivo é RECUSADO (a última leitura válida fica na tela).
   - Várias linhas da mesma INC = UMA INC: equipes somadas sem repetir; campos de valor único que divergem entre as linhas
     viram INCONSISTÊNCIA (o primeiro valor é mostrado e o conflito, listado; nada é corrigido em silêncio).
   - Datas: célula de data do Excel (já convertida pelo leitor) ou texto do ADMS "m/d/aaaa h:mm:ss AM/PM", pela MESMA regra da
     Central (Nucleo.lerDataHora). Data em formato desconhecido: valor original preservado + inconsistência.
   - classificarStatus: ÚNICA função que decide se a INC é operacional, excluída ou exceção (tabela em DespachoConfig).
   Não existe no arquivo (e não é inventado): aceite da equipe, chegada ao local, conclusão, confirmação do despacho. */
"use strict";
(function (raiz) {
  const CFG = raiz.DespachoConfig, N = raiz.Nucleo, L = raiz.Localidades, C = CFG.incidentes;
  const norm = (t) => L.normalizar(String(t ?? "").replace(/[_\s]+/g, " ")).trim();
  const txt = (v) => (v === null || v === undefined ? "" : String(v).replace(/\r\n?/g, "\n").trim());
  const VAZIOS = new Set(["", "-", "NONE", "NULL", "N/A"]);
  const valor = (v) => { const t = txt(v); return VAZIOS.has(t.toUpperCase()) ? "" : t; };
  const unicos = (xs) => [...new Set(xs.filter(Boolean))];
  class ErroIncidentes extends Error { constructor(m, codigo) { super(m); this.name = "ErroIncidentes"; this.codigo = codigo; } }

  /* ------------------------------------------------------------ regra central de status */
  const TABELA = new Map(Object.entries(C.status).map(([k, v]) => [norm(k), v]));
  function classificarStatus(texto) {
    const original = txt(texto), k = norm(original);
    if (!k) return { grupo: "excecao", codigo: "status_vazio", rotulo: "Sem status", original, motivo: "status vazio no Incidentes.xlsx" };
    const t = TABELA.get(k);
    if (!t) return { grupo: "excecao", codigo: "status_desconhecido", rotulo: original, original, motivo: `status não reconhecido: "${original}"` };
    return { grupo: t.grupo, codigo: k.replace(/ /g, "_").toLowerCase(), rotulo: t.rotulo, original, ordem: t.ordem || 99, destaque: !!t.destaque };
  }
  const STATUS_OPERACIONAIS = [...TABELA.entries()].filter(([, v]) => v.grupo === "operacional").sort((a, b) => a[1].ordem - b[1].ordem)
    .map(([k, v]) => ({ codigo: k.replace(/ /g, "_").toLowerCase(), rotulo: v.rotulo, destaque: !!v.destaque }));

  /* ------------------------------------------------------------ campos */
  /* "INC 143152812" / "143152812" -> "143152812". Outro formato = "" (registro descartado, listado). */
  const numeroInc = (t) => { const m = /^\s*(?:INC\s*)?(\d{4,})\s*$/i.exec(txt(t)); return m ? m[1] : ""; };
  /* "Equipe: ESE-E-ITBCX51 | Equipe: ESE-E-ITBCX53" -> ["ESE-E-ITBCX51", "ESE-E-ITBCX53"] */
  const equipes = (t) => unicos(txt(t).split(/\s*[|\n;]\s*/).map((p) => p.replace(/^\s*equipe\s*:\s*/i, "").trim()).filter((p) => !VAZIOS.has(p.toUpperCase())));
  function data(v) {
    const t = valor(v);
    if (!t) return { iso: null, original: "" };
    const iso = N.lerDataHora(t);
    return { iso, original: t, invalida: !iso };
  }

  /* ------------------------------------------------------------ cabeçalho */
  function cabecalho(linhas) {
    const chaves = Object.entries(C.colunas).filter(([, c]) => c.obrigatoria).map(([, c]) => c.nomes.map(norm));
    const pontua = (l) => { const ns = new Set((l || []).map(norm)); return chaves.filter((alts) => alts.some((a) => ns.has(a))).length; };
    const esperada = C.cabecalhoLinha - 1;
    let idx = pontua(linhas[esperada]) === chaves.length ? esperada : -1;
    if (idx < 0) for (let i = 0; i < Math.min(10, linhas.length); i++) if (pontua(linhas[i]) === chaves.length) { idx = i; break; }
    if (idx < 0) {
      const melhor = linhas.slice(0, 10).map((l, i) => [pontua(l), i]).sort((a, b) => b[0] - a[0])[0] || [0, esperada];
      const ns = new Set((linhas[melhor[1]] || []).map(norm));
      const faltam = Object.entries(C.colunas).filter(([, c]) => c.obrigatoria && !c.nomes.some((n) => ns.has(norm(n)))).map(([, c]) => c.nomes[0]);
      throw new ErroIncidentes(`cabeçalho do Incidentes.xlsx não reconhecido: coluna(s) obrigatória(s) ausente(s): ${faltam.join(", ")}`, "colunas_ausentes");
    }
    const originais = (linhas[idx] || []).map((c) => txt(c)), mapa = {}, avisos = [];
    for (const [campo, c] of Object.entries(C.colunas)) {
      const alvo = c.nomes.map(norm), achadas = originais.map((o, j) => [norm(o), j]).filter(([n]) => n && alvo.includes(n));
      mapa[campo] = achadas.length ? achadas[0][1] : null;
      if (achadas.length > 1) avisos.push(`coluna "${originais[achadas[0][1]]}" aparece ${achadas.length} vezes: usada a primeira`);
    }
    if (idx !== esperada) avisos.push(`cabeçalho na linha ${idx + 1} (esperado na linha ${C.cabecalhoLinha})`);
    return { linha: idx + 1, mapa, colunas: originais.map((o, j) => ({ original: o, normal: norm(o), indice: j })).filter((c) => c.original) , avisos };
  }

  /* ------------------------------------------------------------ processamento */
  /* Campos que DECIDEM algo (status, município, rede, horários): valor diferente entre linhas da mesma INC = inconsistência.
     Campos DESCRITIVOS: cada linha da INC pode trazer um valor próprio (no arquivo real, a coluna Problema muda de uma linha para
     outra da mesma INC) — todos os valores são guardados, sem acusar inconsistência. */
  const UNICOS = ["status", "local", "subregiao", "alimentador_atual", "alimentador_normal", "subestacao_atual", "subestacao_normal", "atribuicao", "enviada",
    "deslocamento", "data_inicial", "incidente_pai"];
  const MULTIPLOS = ["problema", "causa", "sub_causa", "elemento", "tipo_elemento", "power_status"];
  const ROTULOS = { status: "status", local: "local (município)", atribuicao: "data hora atribuição", enviada: "data hora enviada", deslocamento: "data hora deslocamento",
    alimentador_atual: "alimentador atual", subestacao_atual: "subestação atual", data_inicial: "data inicial" };
  /* planilha = resultado de LeitorXLSX.ler -> { cabecalho, incs: Map(numero -> INC), descartadas, avisos, resumo } */
  function processar(planilha) {
    const linhas = planilha.linhas || [], cab = cabecalho(linhas), m = cab.mapa;
    const pegar = (l, campo) => (m[campo] === null ? "" : valor(l[m[campo]]));
    const incs = new Map(), descartadas = [];
    let registros = 0;
    for (let i = cab.linha; i < linhas.length; i++) {
      const l = linhas[i] || [];
      if (!l.some((c) => txt(c))) continue; // linha totalmente vazia
      registros++;
      const bruto = pegar(l, "inc"), numero = numeroInc(bruto);
      if (!numero) { descartadas.push({ linha: i + 1, motivo: bruto ? `número de INC em formato não reconhecido ("${bruto.slice(0, 30)}")` : "linha sem número de INC" }); continue; }
      let x = incs.get(numero);
      if (!x) { x = { numero, id: "INC " + numero, linhas: [], campos: {}, listas: {}, conflitos: {}, equipes: [], obs: [], usuarios: [], ultimas: [] }; incs.set(numero, x); }
      x.linhas.push(i + 1);
      for (const campo of UNICOS) {
        const v = pegar(l, campo);
        if (!v) continue;
        if (!x.campos[campo]) x.campos[campo] = v;
        else if (norm(x.campos[campo]) !== norm(v)) (x.conflitos[campo] ||= new Set([x.campos[campo]])).add(v);
      }
      for (const campo of MULTIPLOS) { const v = pegar(l, campo); if (v) (x.listas[campo] ||= []).push(v); }
      x.equipes.push(...equipes(pegar(l, "equipe")));
      const o = pegar(l, "obs"); if (o) x.obs.push(o);
      const u = pegar(l, "usuario_alteracao"); if (u) x.usuarios.push(u);
      const ua = pegar(l, "ultima_alteracao"); if (ua) x.ultimas.push(ua);
    }
    for (const x of incs.values()) finalizar(x);
    const lista = [...incs.values()];
    return {
      cabecalho: { linha: cab.linha, colunas: cab.colunas, mapa: m }, incs, descartadas, avisos: cab.avisos,
      resumo: { registros, incs: incs.size, linhas_repetidas: registros - descartadas.length - incs.size, descartadas: descartadas.length,
        inconsistencias: lista.filter((x) => x.inconsistencias.length).length,
        porGrupo: { operacional: lista.filter((x) => x.situacao.grupo === "operacional").length, excluido: lista.filter((x) => x.situacao.grupo === "excluido").length,
          excecao: lista.filter((x) => x.situacao.grupo === "excecao").length } },
    };
  }
  function finalizar(x) {
    const c = x.campos, inc = [];
    for (const [campo, s] of Object.entries(x.conflitos)) inc.push(`valores diferentes nas ${x.linhas.length} linhas desta INC para ${ROTULOS[campo] || campo}: ${[...s].join(" / ")}`);
    x.equipes = unicos(x.equipes);
    x.situacao = classificarStatus(c.status);
    if (x.conflitos.status) x.situacao = { grupo: "excecao", codigo: "status_divergente", rotulo: "Status divergente", original: [...x.conflitos.status].join(" / "), motivo: "linhas da mesma INC com status diferentes" };
    x.horarios = {};
    for (const k of ["atribuicao", "enviada", "deslocamento", "data_inicial"]) {
      const d = data(c[k]); x.horarios[k] = d;
      if (d.invalida) inc.push(`${ROTULOS[k]} em formato não reconhecido: "${d.original}"`);
    }
    const h = x.horarios;
    if (h.atribuicao.iso && h.enviada.iso && h.enviada.iso < h.atribuicao.iso) inc.push("horário de envio anterior ao de atribuição");
    if (h.enviada.iso && h.deslocamento.iso && h.deslocamento.iso < h.enviada.iso) inc.push("horário de deslocamento anterior ao de envio");
    if (["enviado", "em_execucao"].includes(x.situacao.codigo) && !x.equipes.length) inc.push(`status "${x.situacao.rotulo}" sem equipe associada`);
    if (["aguardando_envio"].includes(x.situacao.codigo) && h.deslocamento.iso) inc.push("status \"Aguardando Envio\" com horário de deslocamento preenchido");
    x.municipio = c.local ? L.classificarIncidente([c.local]) : { status: "desconhecida", chave: "?desconhecida", nome: "", chaves: [] };
    x.alimentador = c.alimentador_atual || c.alimentador_normal || "";
    x.subestacao = c.subestacao_atual || c.subestacao_normal || "";
    x.obs = unicos(x.obs); x.usuarios = unicos(x.usuarios);
    for (const campo of MULTIPLOS) { x.listas[campo] = unicos(x.listas[campo] || []); c[campo] = x.listas[campo].join(" · "); }
    x.ultimaAlteracao = x.ultimas.map((t) => N.lerDataHora(t)).filter(Boolean).sort().pop() || null;
    delete x.ultimas;
    x.inconsistencias = inc;
  }

  raiz.DespachoIncidentes = { processar, classificarStatus, numeroInc, equipes, cabecalho, STATUS_OPERACIONAIS, ErroIncidentes };
})(typeof window !== "undefined" ? window : globalThis);
