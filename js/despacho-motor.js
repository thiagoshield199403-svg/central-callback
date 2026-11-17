/* DESPACHO OTIMIZADO COI 2.0 — motor (funções puras: sem tela, sem rede, sem gravação).
   FONTE ÚNICA: chamadas_incidentes.csv, o mesmo arquivo da Central. Tudo o que a Central já faz é REUTILIZADO:
   - leitura, cabeçalhos aceitos, chamadas válidas/descartadas e CALL repetida ............ Nucleo.analisar / Nucleo.lerCSV
   - consolidação das chamadas do mesmo INC (comunicação principal) ........................ Nucleo.agruparIncidentes
   - município e polo (regionais oficiais da Central) ...................................... Localidades.classificarIncidente
   - risco de vida (classificado / indício) e indício de falta de fase no texto ............ Nucleo.indicacaoRisco / indicioFaltaDeFase
   Regras PRÓPRIAS deste módulo (só elas):
   - BAIRRO: 1º trecho de endereço da Localização no formato do ADMS "LOGRADOURO_NÚMERO[_COMPLEMENTO]_BAIRRO; COD_MUNICÍPIO".
     O bairro é o ÚLTIMO pedaço após "_". Bairro genérico ("AREA RURAL"...) só vira lote se o logradouro for uma localidade
     nomeada (POV/ASSENT/FAZ...); senão = LOCALIZAÇÃO NÃO IDENTIFICADA. Sem endereço no formato: campo "BAIRRO:" do comentário
     (gerado pelo atendimento), se houver. Nada é adivinhado; o texto original é sempre mostrado.
   - Alimentador / circuito / subestação / equipamento: SÓ de colunas que existirem no arquivo (e "Dispositivo:" da Localização).
   - Falta de fase: CONFIRMADA = campo estruturado do ADMS (Motivo/Submotivos) cita falta de fase; POSSÍVEL = citada só no texto
     livre (regra da Central); SEM INFORMAÇÃO = o resto. Oscilação ou falta de energia NUNCA viram falta de fase.
   - O arquivo NÃO informa despacho/equipe: nada aqui afirma que um INC foi despachado.
   2.1 — SEGUNDA FONTE (Incidentes.xlsx, js/despacho-incidentes.js): consolidar() cruza as duas leituras pelo número da INC.
   - Localização/endereço/bairro: das chamadas. Status, equipes, horários, alimentador/subestação: do Incidentes.xlsx.
   - Status (DespachoIncidentes.classificarStatus): SÓ as INCs "operacionais" seguem para montar(); Concluído/Arquivado/
     Cancelado saem AQUI (lista "excluidas") e status vazio/desconhecido/divergente vai para "excecoes" — nenhuma das duas
     entra em lotes, seleção, contadores ou cópia, porque a tela só recebe "incs".
   - Só nas chamadas (com o Incidentes.xlsx lido): "sem_registro_adms" -> exceções (status e equipe desconhecidos).
   - Só no Incidentes.xlsx: município do campo "local"; bairro/endereço NÃO são inventados (localização incompleta).
   - Sem Incidentes.xlsx disponível: modo "so_chamadas" = funcionamento 2.0 (a tela avisa que nada foi filtrado por status). */
"use strict";
(function (raiz) {
  const CFG = raiz.DespachoConfig, N = raiz.Nucleo, L = raiz.Localidades;
  const norm = (t) => L.normalizar(String(t ?? "").replace(/_+/g, " "));
  const GENERICOS = new Set(CFG.bairrosGenericos), RURAIS = new Set(CFG.localidadesRurais);
  const VAZIOS = new Set(["", "-", "NONE", "NULL", "N/A", "NA"]);
  const limpo = (v) => { const t = String(v ?? "").replace(/\s+/g, " ").trim(); return VAZIOS.has(t.toUpperCase()) ? "" : t; };
  const unicos = (xs) => [...new Set(xs.filter(Boolean))];
  const temNome = (t) => (t.match(/[A-Z]/g) || []).length >= 3 && !/^(S ?\/? ?N|SN|SEM NUMERO)$/.test(t);

  /* ------------------------------------------------------------ endereço e bairro */
  /* Localização -> { logradouro, numero, complemento, bairroBruto, equipamento, formato: "completo"|"incompleto"|"ausente" } */
  function endereco(loc) {
    let end = null, equipamento = "";
    for (const p of String(loc || "").split(";").map((s) => s.trim()).filter(Boolean)) {
      const r = /^([^:_]*(?:_[^:_]*)*?)\s*:+\s*(.*)$/.exec(p);
      let valor = p;
      if (r) {
        const rot = norm(r[1]);
        if (rot === "DISPOSITIVO") { equipamento = limpo(r[2]); continue; }
        if (rot !== "END" && rot !== "ENDERECO") continue; // ESE_Municipio_Pesquisa, Municipio... não são endereço
        valor = r[2];
      }
      if (/^\d+\s*_/.test(valor)) continue; // "430_NOSSA SENHORA DA GLORIA" = código + município
      if (!end && valor.includes("_")) end = valor;
    }
    if (!end) return { formato: "ausente", logradouro: "", numero: "", complemento: "", bairroBruto: "", equipamento };
    const ps = end.split("_").map((x) => x.replace(/\s+/g, " ").trim());
    if (ps.length < 3) return { formato: "incompleto", logradouro: ps[0] || "", numero: ps[1] || "", complemento: "", bairroBruto: "", equipamento };
    return { formato: "completo", logradouro: ps[0], numero: ps[1], complemento: ps.slice(2, -1).filter(Boolean).join(" "), bairroBruto: ps[ps.length - 1], equipamento };
  }
  /* Campo "BAIRRO:" do comentário gerado pelo atendimento (só o valor do campo; o resto do comentário não é usado). */
  function bairroDoComentario(com) {
    const t = norm(com);
    const m = /(?:^|[\s;,.])BAIRRO\s*:\s*([A-Z0-9][A-Z0-9 .'\/-]{1,50}?)\s*(?=[,;.]|\s[A-Z]{3,}(?: [A-Z]+)?\s*:|$)/.exec(t);
    return m ? m[1].trim() : "";
  }
  /* Bairro de UMA chamada. municipioNormal = nome do município (normalizado) para não tratar a cidade como bairro. */
  function bairroDaChamada(ch, municipioNormal) {
    const e = endereco(ch.localizacao);
    const avaliar = (bruto, origem) => {
      const b = norm(bruto);
      if (!b || !temNome(b)) return null;
      if (GENERICOS.has(b) || (municipioNormal && b === municipioNormal)) {
        const lg = norm(e.logradouro), tok = lg.split(" ")[0], resto = lg.slice(tok.length).trim();
        // "FAZ FAZENDA", "POV POVOADO": o nome é só o tipo de lugar, não identifica a localidade
        if (RURAIS.has(tok) && temNome(resto) && !RURAIS.has(resto) && !GENERICOS.has(resto))
          return { chave: lg, nome: lg, tipo: "localidade", origem: `${origem}: bairro genérico "${b}"; localidade do logradouro` };
        return { chave: null, generico: b, origem: `${origem}: bairro genérico "${b}" sem localidade nomeada` };
      }
      return { chave: b, nome: b, tipo: "bairro", origem };
    };
    let r = e.formato === "completo" ? avaliar(e.bairroBruto, "endereço da Localização") : null;
    if (!r || !r.chave) { const c = bairroDoComentario(ch.comentario); const rc = c ? avaliar(c, "campo BAIRRO do comentário") : null; if (rc && rc.chave) r = rc; else r = r || rc; }
    return { endereco: e, bairro: r && r.chave ? r : null, motivo: r && !r.chave ? r.origem
      : e.formato === "ausente" ? "Localização sem endereço (só município, código ou vazia)" : e.formato === "incompleto" ? "endereço sem o trecho do bairro" : "bairro não reconhecido no endereço" };
  }

  /* ------------------------------------------------------------ colunas elétricas (só se existirem) */
  function colunasEletricas(cabecalho) {
    const nomes = cabecalho.map((c) => norm(c).replace(/:+$/, "").trim()), out = {};
    for (const [campo, alts] of Object.entries(CFG.colunas)) {
      out[campo] = null;
      for (const a of alts) { const j = nomes.indexOf(norm(a)); if (j >= 0 && cabecalho[j]) { out[campo] = cabecalho[j]; break; } }
    }
    return out;
  }

  /* ------------------------------------------------------------ falta de fase */
  /* Reutiliza o reconhecimento de termos da Central (indicioFaltaDeFase) aplicado SÓ aos campos estruturados = confirmada.
     Os campos vão pelo caminho do "comentário": no caminho do submotivo a Central retira as palavras de 2 letras (siglas FE/RV),
     o que apagaria o "DE" de "FALTA DE FASE". */
  function faltaDeFase(chs) {
    const conf = chs.find((c) => N.indicioFaltaDeFase({ submotivos: "", comentario: [c.motivo, c.submotivos].filter(Boolean).join("; ") }));
    if (conf) return { nivel: "confirmada", origem: `${conf.call_id}: Motivo/Submotivos do ADMS` };
    const poss = chs.find((c) => N.indicioFaltaDeFase(c));
    if (poss) return { nivel: "possivel", origem: `${poss.call_id}: citada no texto da chamada (não confirmado)` };
    return { nivel: "sem", origem: "" };
  }

  /* ------------------------------------------------------------ processamento do arquivo */
  const rotuloInc = (inc) => { const m = /^\s*(?:INC\s*)?(\d+)\s*$/i.exec(inc || ""); return m ? CFG.copia.prefixo + m[1] : String(inc || "").trim(); };
  const polosDe = (chaves) => unicos((chaves || []).map((k) => (L.municipioPorChave(k) || {}).regional));

  function processar(bytes) {
    const a = N.analisar(bytes), arq = N.lerCSV(bytes); // mesma leitura e mesmas regras de validade da Central
    const porLinha = new Map(arq.linhas.map((l) => [l.numero, l]));
    const cols = colunasEletricas(arq.cabecalho);
    const val = (ch, campo) => { const c = cols[campo], l = porLinha.get(ch.linha_arquivo); return c && l ? limpo(l.original[c]) : ""; };
    const cust = (ch) => { const l = porLinha.get(ch.linha_arquivo); const m = /^\s*(\d{1,3})\s*-/.exec(l ? l.valores.cust_prioritarias || "" : ""); return m ? CFG.clientesPrioritarios[m[1].padStart(2, "0")] || "" : ""; };
    const grupos = N.agruparIncidentes(a.validas), incs = [], semInc = [];
    for (const g of grupos) {
      const chs = g.membros;
      if (!g.incidente) { semInc.push(...chs.map((c) => ({ call_id: c.call_id, horario: c.horario_call, motivo: c.motivo, localizacao: c.localizacao || "" }))); continue; }
      const mun = L.classificarIncidente(chs.map((c) => c.localizacao)); // a principal primeiro (agruparIncidentes)
      const mNorm = mun.status === "ok" ? L.normalizar(mun.nome) : "";
      const bs = chs.map((c) => ({ ch: c, ...bairroDaChamada(c, mNorm) }));
      // bairro do INC: o mais citado nas chamadas (empate: o da principal); chamadas em bairros diferentes ficam registradas
      const cont = new Map();
      for (const x of bs) if (x.bairro) { const k = x.bairro.chave; cont.set(k, { b: x.bairro, n: (cont.get(k) ? cont.get(k).n : 0) + 1 }); }
      let bairro = null;
      if (cont.size) { const ord = [...cont.values()].sort((p, q) => q.n - p.n || (q.b.chave === (bs[0].bairro || {}).chave) - (p.b.chave === (bs[0].bairro || {}).chave)); bairro = ord[0].b; }
      const ref = bs.find((x) => bairro && x.bairro && x.bairro.chave === bairro.chave) || bs[0];
      const risco = chs.map((c) => N.indicacaoRisco(c)).sort((p, q) => q.nivel - p.nivel)[0];
      const horarios = chs.map((c) => c.horario_call || c.recebido_adms).filter(Boolean).sort();
      incs.push({
        id: rotuloInc(g.incidente), incidente: g.incidente, chamadas: chs.length,
        calls: chs.map((c) => ({ call_id: c.call_id, horario: c.horario_call || c.recebido_adms || null, motivo: c.motivo || "", localizacao: c.localizacao || "" })),
        municipio: { status: mun.status, chave: mun.chave, nome: mun.nome || "", codigo: mun.codigo || "", motivo: mun.motivo || "", chaves: [...mun.chaves] },
        polo: mun.status === "ok" ? mun.regional : "", polosCandidatos: mun.status === "ok" ? [mun.regional] : polosDe(mun.chaves),
        bairro, bairroMotivo: bairro ? "" : ref.motivo,
        bairrosDiferentes: cont.size > 1 ? [...cont.values()].sort((p, q) => q.n - p.n).map((x) => `${x.b.nome} (${x.n})`) : [],
        logradouro: ref.endereco.logradouro, numeroEnd: ref.endereco.numero, complemento: ref.endereco.complemento,
        localizacoes: unicos(chs.map((c) => limpo(c.localizacao))),
        alimentadores: unicos(chs.map((c) => val(c, "alimentador"))), circuitos: unicos(chs.map((c) => val(c, "circuito"))),
        subestacoes: unicos(chs.map((c) => val(c, "subestacao"))), equipamentos: unicos([...chs.map((c) => val(c, "equipamento")), ...bs.map((x) => x.endereco.equipamento)]),
        fase: faltaDeFase(chs), risco: { nivel: risco.nivel, origem: risco.origem || "" }, clientes: unicos(chs.map(cust)),
        motivos: unicos(chs.map((c) => c.motivo)), primeira: horarios[0] || null, ultima: horarios[horarios.length - 1] || null,
      });
    }
    const r = a.resumo, horas = a.validas.map((c) => c.horario_call).filter(Boolean).sort();
    return {
      colunas: cols, incs, semInc,
      resumo: { linhas_lidas: r.linhas_lidas, chamadas_validas: r.chamadas_validas, linhas_com_erro: r.linhas_com_erro, calls_repetidas: r.calls_repetidas_no_arquivo,
        chamadas_sem_inc: semInc.length, chamadas_em_incs: r.chamadas_validas - semInc.length, incs: incs.length,
        consolidadas: r.chamadas_validas - semInc.length - incs.length, colunas_ausentes: r.colunas_ausentes, sha256: r.sha256,
        periodo: horas.length ? [horas[0], horas[horas.length - 1]] : null },
    };
  }

  /* ------------------------------------------------------------ 2.1: consolidação das duas fontes */
  const numeroDe = (inc) => { const m = /^\s*(?:INC\s*)?(\d+)\s*$/i.exec(inc || ""); return m ? m[1] : ""; };
  function admsDe(x) {
    const c = x.campos;
    return { status: x.situacao, equipes: x.equipes, horarios: x.horarios, alimentador: x.alimentador, subestacao: x.subestacao,
      alimentadorNormal: c.alimentador_normal || "", subestacaoNormal: c.subestacao_normal || "", local: c.local || "", subregiao: c.subregiao || "",
      powerStatus: c.power_status || "", elemento: c.elemento || "", tipoElemento: c.tipo_elemento || "", causa: c.causa || "", subCausa: c.sub_causa || "",
      problema: c.problema || "", incidentePai: c.incidente_pai || "", obs: x.obs, usuarios: x.usuarios, ultimaAlteracao: x.ultimaAlteracao, linhas: x.linhas.length };
  }
  const SEM_REGISTRO = { grupo: "excecao", codigo: "sem_registro_adms", rotulo: "Sem registro no ADMS",
    motivo: "INC das chamadas sem registro no Incidentes.xlsx (nova e ainda não exportada, ou já encerrada): status e equipe desconhecidos" };
  /* chamadas = processar(csv); adms = DespachoIncidentes.processar(xlsx) ou null. Devolve { modo, incs (só operacionais),
     excluidas, excecoes, resumo }. */
  function consolidar(chamadas, adms) {
    const base = chamadas ? chamadas.incs : [];
    if (!adms) {
      const incs = base.map((i) => ({ ...i, origem: "chamadas", adms: null, situacao: null, inconsistencias: [] }));
      return { modo: "so_chamadas", incs, excluidas: [], excecoes: [], resumo: { incs: incs.length, ambas: 0, soChamadas: incs.length, soIncidentes: 0, excluidasPorStatus: {}, excecoes: 0 } };
    }
    const todos = [], vistos = new Set();
    for (const i of base) {
      const n = numeroDe(i.incidente), x = adms.incs.get(n);
      if (!x) { todos.push({ ...i, origem: "chamadas", adms: null, situacao: SEM_REGISTRO, inconsistencias: [] }); continue; }
      vistos.add(n);
      const inc = [...x.inconsistencias];
      if (i.municipio.status === "ok" && x.municipio.status === "ok" && i.municipio.chave !== x.municipio.chave)
        inc.push(`município diferente nas fontes: chamadas = ${i.municipio.nome}; Incidentes.xlsx = ${x.municipio.nome} (o lote usa o das chamadas)`);
      todos.push({ ...i, origem: "ambas", adms: admsDe(x), situacao: x.situacao, inconsistencias: inc,
        alimentadores: unicos([...i.alimentadores, x.alimentador]), subestacoes: unicos([...i.subestacoes, x.subestacao]) });
    }
    for (const x of adms.incs.values()) {
      if (vistos.has(x.numero)) continue;
      const mun = x.municipio, ok = mun.status === "ok";
      todos.push({
        id: rotuloInc(x.numero), incidente: x.numero, chamadas: 0, calls: [],
        municipio: { status: mun.status, chave: mun.chave, nome: mun.nome || "", codigo: mun.codigo || "", motivo: mun.motivo || (x.campos.local ? "" : "campo local vazio no Incidentes.xlsx"), chaves: [...(mun.chaves || [])] },
        polo: ok ? mun.regional : "", polosCandidatos: ok ? [mun.regional] : polosDe(mun.chaves),
        bairro: null, bairroMotivo: "localização incompleta: INC só no Incidentes.xlsx (sem chamada) — só o município é conhecido", bairrosDiferentes: [],
        logradouro: "", numeroEnd: "", complemento: "", localizacoes: [], alimentadores: unicos([x.alimentador]), circuitos: [], subestacoes: unicos([x.subestacao]),
        equipamentos: [], fase: { nivel: "sem", origem: "" }, risco: { nivel: 0, origem: "" }, clientes: [], motivos: [],
        primeira: x.horarios.data_inicial.iso, ultima: x.horarios.data_inicial.iso,
        origem: "incidentes", localizacaoIncompleta: true, adms: admsDe(x), situacao: x.situacao, inconsistencias: [...x.inconsistencias],
      });
    }
    const incs = todos.filter((i) => i.situacao.grupo === "operacional"), excluidas = todos.filter((i) => i.situacao.grupo === "excluido");
    const excecoes = todos.filter((i) => i.situacao.grupo === "excecao"), porRotulo = (xs) => xs.reduce((o, i) => ((o[i.situacao.rotulo] = (o[i.situacao.rotulo] || 0) + 1), o), {});
    return { modo: "duas_fontes", incs, excluidas, excecoes,
      resumo: { incs: incs.length, ambas: todos.filter((i) => i.origem === "ambas").length, soChamadas: todos.filter((i) => i.origem === "chamadas").length,
        soIncidentes: todos.filter((i) => i.origem === "incidentes").length, excluidasPorStatus: porRotulo(excluidas), excecoesPorMotivo: porRotulo(excecoes), excecoes: excecoes.length } };
  }
  const semEquipe = (i) => !!i.adms && !i.adms.equipes.length;

  /* ------------------------------------------------------------ 2.1: troca de leitura e atualidade (regras puras) */
  /* Uma leitura nova de UMA fonte só substitui a anterior se não for pior: arquivo com data de modificação ANTERIOR à da leitura
     em uso (extração antiga reaparecendo) ou sem nenhum registro quando a anterior tinha (exportação incompleta) = recusada.
     leitura = { arquivo: { lastModified }, total } */
  function aceitarLeitura(anterior, nova) {
    if (!anterior) return { aceita: true };
    if (nova.arquivo.lastModified < anterior.arquivo.lastModified) return { aceita: false, motivo: "extracao_antiga" };
    if (!nova.total && anterior.total) return { aceita: false, motivo: "sem_registros" };
    return { aceita: true };
  }
  /* fontes = { chamadas: {arquivo}|null, incidentes: {arquivo}|null } -> avisos (não rejeitam nada: as fontes são gravadas
     em momentos diferentes pelo robô do ADMS; só informam). */
  function avisosAtualidade(fontes, agora) {
    const A = CFG.atualidade, out = [];
    for (const [nome, f] of Object.entries(fontes)) {
      if (!f || !f.arquivo || !f.arquivo.lastModified) continue;
      const min = Math.floor((agora - f.arquivo.lastModified) / 60000);
      if (min >= A.desatualizadaMin) out.push({ fonte: nome, tipo: "desatualizada", minutos: min });
    }
    const a = fontes.chamadas && fontes.chamadas.arquivo, b = fontes.incidentes && fontes.incidentes.arquivo;
    if (a && b && a.lastModified && b.lastModified) {
      const d = Math.floor(Math.abs(a.lastModified - b.lastModified) / 60000);
      if (d >= A.distanciaFontesMin) out.push({ fonte: a.lastModified < b.lastModified ? "chamadas" : "incidentes", tipo: "distantes", minutos: d });
    }
    return out;
  }

  /* ------------------------------------------------------------ polos, filtros e lotes */
  const POLOS = L.REGIONAIS.map((r) => ({ id: r.id, nome: "Polo " + r.nome.replace(/^Regional\s+/i, ""), regional: r.nome, municipios: r.municipios.map((m) => m.nome) }));
  const NAO_IDENT = "?nao_identificada", SEM_MUN = "?sem_municipio";
  const noPolo = (inc, polo) => !polo || inc.polo === polo || (inc.municipio.status === "divergente" && inc.polosCandidatos.includes(polo));
  const chaveMun = (inc) => (inc.municipio.status === "ok" ? inc.municipio.chave : SEM_MUN);
  const chaveBairro = (inc) => (inc.municipio.status === "ok" && inc.bairro ? inc.bairro.chave : NAO_IDENT);
  function passa(inc, f, ignorar) {
    if (!noPolo(inc, f.polo)) return false;
    if (f.municipio && ignorar !== "municipio" && chaveMun(inc) !== f.municipio) return false;
    if (f.bairro && ignorar !== "bairro" && chaveBairro(inc) !== f.bairro) return false;
    if (f.alimentador && ignorar !== "alimentador" && !inc.alimentadores.includes(f.alimentador)) return false;
    if (f.circuito && ignorar !== "circuito" && !inc.circuitos.includes(f.circuito)) return false;
    if (f.prioridade === "fase" && inc.fase.nivel === "sem") return false;
    if (f.prioridade === "fase_confirmada" && inc.fase.nivel !== "confirmada") return false;
    if (f.prioridade === "risco" && inc.risco.nivel < 1) return false;
    if (f.status && ignorar !== "status" && (!inc.situacao || inc.situacao.codigo !== f.status)) return false;
    if (f.equipe === "sem" && !semEquipe(inc)) return false;
    if (f.equipe === "com" && !(inc.adms && inc.adms.equipes.length)) return false;
    if (f.equipe === "inconsistente" && !(inc.inconsistencias && inc.inconsistencias.length)) return false;
    if (f.busca) {
      const b = norm(f.busca), d = b.replace(/\D/g, "");
      const alvo = norm([inc.id, inc.logradouro, inc.bairro ? inc.bairro.nome : "", inc.municipio.nome, ...inc.alimentadores, ...inc.circuitos, ...inc.equipamentos,
        ...(inc.adms ? inc.adms.equipes : [])].join(" "));
      if (!(alvo.includes(b) || (d.length >= 4 && inc.id.replace(/\D/g, "").includes(d)))) return false;
    }
    return true;
  }
  const alfa = (x, y) => String(x).localeCompare(String(y), "pt-BR", { sensitivity: "base", numeric: true });
  const ordemInc = (x, y) => alfa(norm(x.logradouro), norm(y.logradouro)) || ((parseInt(x.numeroEnd, 10) || 1e9) - (parseInt(y.numeroEnd, 10) || 1e9)) || alfa(x.id, y.id);

  /* Opções de cada filtro: calculadas com os OUTROS filtros aplicados (os filtros funcionam em conjunto). */
  function opcoes(incs, f) {
    const conta = (ignorar, chave, rotulo) => {
      const m = new Map();
      for (const i of incs) if (passa(i, f, ignorar)) for (const [k, r] of chave(i)) { const o = m.get(k) || { valor: k, rotulo: r, n: 0 }; o.n++; m.set(k, o); }
      return [...m.values()].sort((a, b) => alfa(a.rotulo, b.rotulo));
    };
    return {
      municipio: conta("municipio", (i) => [[chaveMun(i), i.municipio.status === "ok" ? i.municipio.nome : "Município não identificado / divergente"]]),
      bairro: conta("bairro", (i) => [[chaveBairro(i), chaveBairro(i) === NAO_IDENT ? "Localização não identificada" : i.bairro.nome + (f.municipio ? "" : " · " + i.municipio.nome)]]),
      alimentador: conta("alimentador", (i) => i.alimentadores.map((x) => [x, x])),
      circuito: conta("circuito", (i) => i.circuitos.map((x) => [x, x])),
      status: conta("status", (i) => (i.situacao ? [[i.situacao.codigo, i.situacao.rotulo]] : [])),
    };
  }
  function contarPolos(incs) { return POLOS.map((p) => ({ ...p, n: incs.filter((i) => noPolo(i, p.id)).length })); }

  /* Lotes: UM município por seção; um lote por bairro (ou localidade nomeada); INC sem bairro -> LOCALIZAÇÃO NÃO IDENTIFICADA
     do município; INC sem município (ou divergente) -> seção própria. Cada INC entra em UM lote só. */
  function montar(incs, f = {}) {
    const lista = incs.filter((i) => passa(i, f)), secoes = new Map();
    for (const i of lista) {
      const km = chaveMun(i);
      if (!secoes.has(km)) secoes.set(km, { chave: km, nome: km === SEM_MUN ? "MUNICÍPIO NÃO IDENTIFICADO OU DIVERGENTE" : i.municipio.nome.toUpperCase(),
        codigo: i.municipio.codigo, polo: i.polo, especial: km === SEM_MUN, lotes: new Map(), n: 0, nFase: 0, nFaseConf: 0, nRisco: 0, nNaoIdent: 0 });
      const s = secoes.get(km), kb = chaveBairro(i);
      if (!s.lotes.has(kb)) s.lotes.set(kb, { chave: km + "|" + kb, municipio: s.nome, municipioChave: km, bairro: kb === NAO_IDENT ? "LOCALIZAÇÃO NÃO IDENTIFICADA" : i.bairro.nome,
        tipo: kb === NAO_IDENT ? "nao_identificado" : i.bairro.tipo, incs: [] });
      s.lotes.get(kb).incs.push(i); s.n++;
      if (i.fase.nivel !== "sem") s.nFase++; if (i.fase.nivel === "confirmada") s.nFaseConf++; if (i.risco.nivel >= 1) s.nRisco++; if (kb === NAO_IDENT) s.nNaoIdent++;
    }
    const out = [...secoes.values()].map((s) => {
      const lotes = [...s.lotes.values()].map((l) => {
        l.incs.sort(ordemInc);
        return { ...l, n: l.incs.length, alimentadores: unicos(l.incs.flatMap((i) => i.alimentadores)), circuitos: unicos(l.incs.flatMap((i) => i.circuitos)),
          subestacoes: unicos(l.incs.flatMap((i) => i.subestacoes)), nFase: l.incs.filter((i) => i.fase.nivel !== "sem").length,
          nFaseConf: l.incs.filter((i) => i.fase.nivel === "confirmada").length, nRisco: l.incs.filter((i) => i.risco.nivel >= 1).length,
          nRiscoVida: l.incs.filter((i) => i.risco.nivel >= 2).length, nSemEquipe: l.incs.filter(semEquipe).length,
          nInterrompido: l.incs.filter((i) => i.situacao && i.situacao.destaque).length, nInconsistente: l.incs.filter((i) => i.inconsistencias && i.inconsistencias.length).length };
      }).sort((a, b) => (a.tipo === "nao_identificado") - (b.tipo === "nao_identificado") || b.n - a.n || alfa(a.bairro, b.bairro));
      return { ...s, lotes };
    }).sort((a, b) => a.especial - b.especial || b.n - a.n || alfa(a.nome, b.nome));
    const todosLotes = out.flatMap((s) => s.lotes);
    return {
      secoes: out,
      indicadores: { incs: lista.length, lotes: todosLotes.filter((l) => l.tipo !== "nao_identificado").length, lotesNaoIdent: todosLotes.filter((l) => l.tipo === "nao_identificado").length,
        naoIdentificados: lista.filter((i) => chaveBairro(i) === NAO_IDENT).length, faseConfirmada: lista.filter((i) => i.fase.nivel === "confirmada").length,
        fasePossivel: lista.filter((i) => i.fase.nivel === "possivel").length, risco: lista.filter((i) => i.risco.nivel >= 1).length,
        chamadas: lista.reduce((t, i) => t + i.chamadas, 0),
        porStatus: lista.reduce((o, i) => { if (i.situacao) o[i.situacao.codigo] = (o[i.situacao.codigo] || 0) + 1; return o; }, {}),
        semEquipe: lista.filter(semEquipe).length, inconsistencias: lista.filter((i) => i.inconsistencias && i.inconsistencias.length).length,
        equipes: unicos(lista.flatMap((i) => (i.adms ? i.adms.equipes : []))).length },
    };
  }

  /* Texto para o SIGODE: "numos in (n1, n2, ...)" — só os NÚMEROS (sem "INC"), separados por ", ", sem repetição, na ordem
     recebida. Usado pelas duas cópias (lote e selecionadas). Nenhuma INC = "" (a tela avisa e não copia nada).
     A exibição na tela continua "INC n" (rotuloInc). */
  const numeroInc = (inc) => { const m = /^\s*(?:INC\s*)?(\d+)\s*$/i.exec(inc || ""); return m ? m[1] : String(inc || "").trim(); };
  function textoCopia(ids) {
    const ns = unicos(ids.map(numeroInc));
    return ns.length ? CFG.copia.abertura + ns.join(CFG.copia.separador) + CFG.copia.fechamento : "";
  }

  raiz.DespachoMotor = { processar, consolidar, aceitarLeitura, avisosAtualidade, montar, opcoes, contarPolos, textoCopia, endereco, bairroDaChamada, bairroDoComentario, colunasEletricas, faltaDeFase, rotuloInc, passa,
    numeroDe, POLOS, NAO_IDENT, SEM_MUN };
})(typeof window !== "undefined" ? window : globalThis);
