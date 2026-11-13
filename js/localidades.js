/* Central de Callback COI — REGIONAIS E MUNICÍPIOS (divisão oficial em sete regionais) usada pelos filtros do Envio individual
   e do Envio em lote. Só classifica: não grava nada e não altera chamadas, métricas ou regras.

   COMO O MUNICÍPIO É RECONHECIDO (coluna "Localização" do ADMS, em TODOS os trechos, não só no último):
   - Trechos separados por ";", "·", ":", "|" ou " - ". Formatos reais: "End:: RUA X_10_CENTRO; 430_NOSSA SENHORA DA GLORIA",
     "Dispositivo: ITABAIANA", "ESE_Municipio_Pesquisa: CARIRA" (rótulos de campo do ADMS são ignorados).
   - PRIORIDADE 1 = NOME: um trecho inteiro igual ao nome oficial (ou alias confirmado) de um município. Comparação sem acento,
     sem diferença de maiúsculas, com espaços/sublinhados/apóstrofos normalizados. Nunca por pedaço de texto: endereço do ADMS
     (com "_" e número, ex.: "RUA ARACAJU_10_CENTRO") nunca vira município. Nada de correspondência aproximada.
   - PRIORIDADE 2 = CÓDIGO (prefixo "430_"): só confirma. Código ausente ou fora dos mapas não impede o nome. Código de OUTRO
     município de Sergipe junto do nome = conflito real -> DIVERGÊNCIA PARA REVISÃO.
   - Outros estados: os mesmos números existem na Paraíba (1_JOAO PESSOA, 30_PEDRO REGIS, 113_ITABAIANA). Nome ou par
     código_nome visto SÓ fora de Sergipe no export real (js/localidades-dados.js) = FORA DA ÁREA DE SERGIPE, nunca SE.
   - Dois municípios diferentes no mesmo campo (ou no mesmo incidente) = DIVERGÊNCIA PARA REVISÃO.
   - Incidente com várias comunicações: classificado pelo conjunto (classificarIncidente); comunicação vazia não esconde as
     outras.
   - O valor original da Localização nunca é alterado: o resultado só acrescenta a classificação. */
"use strict";
(function (raiz) {
  const REFDADOS = raiz.LOCALIDADES_REFERENCIA || { municipios: {}, pares_fora: [] };
  const REF = REFDADOS.municipios || {}; // nome -> { uf } no export real: só para separar "Fora da área de Sergipe"
  const PARES_FORA = new Set(REFDADOS.pares_fora || []);

  /* Divisão oficial com os códigos CONFIRMADOS pelo COI (legendas dos mapas + correção de 12/11/2026: 001/010/020, 620/630,
     200 = Poço Verde, 450 = Poço Redondo, 350 só Canindé). Cada código pertence a um único município e a uma única regional. */
  const REGIONAIS_BASE = [
    ["aracaju", "Regional Aracaju", [["001", "Aracaju"], ["010", "Barra dos Coqueiros"], ["020", "Nossa Senhora do Socorro"]]],
    ["sao_cristovao", "Regional São Cristóvão", [["620", "São Cristóvão"], ["630", "Itaporanga d'Ajuda"]]],
    ["itabaiana", "Regional Itabaiana", [["030", "Itabaiana"], ["050", "Areia Branca"], ["060", "Campo do Brito"], ["070", "Carira"], ["080", "Frei Paulo"],
      ["090", "Macambira"], ["100", "Malhador"], ["110", "Moita Bonita"], ["120", "Aparecida"], ["130", "Pedra Mole"], ["140", "Pinhão"],
      ["150", "Ribeirópolis"], ["160", "São Domingos"], ["170", "São Miguel do Aleixo"]]],
    ["lagarto", "Regional Lagarto", [["180", "Lagarto"], ["190", "Salgado"], ["200", "Poço Verde"], ["210", "Simão Dias"]]],
    ["gloria", "Regional Glória", [["340", "Nossa Senhora das Dores"], ["350", "Canindé de São Francisco"], ["360", "Capela"], ["370", "Cumbe"],
      ["380", "Feira Nova"], ["390", "Gararu"], ["400", "Graccho Cardoso"], ["410", "Itabi"], ["420", "Monte Alegre de Sergipe"],
      ["430", "Nossa Senhora da Glória"], ["440", "Lourdes"], ["450", "Poço Redondo"], ["461", "Porto da Folha"]]],
    ["propria", "Regional Propriá", [["468", "Propriá"], ["480", "Amparo de São Francisco"], ["490", "Aquidabã"], ["500", "Telha"], ["510", "Canhoba"],
      ["521", "Cedro de São João"], ["530", "Ilha das Flores"], ["541", "Japoatã"], ["550", "Malhada dos Bois"], ["560", "Muribeca"],
      ["570", "Neópolis"], ["580", "Pacatuba"], ["590", "Santana do São Francisco"], ["600", "São Francisco"], ["700", "Brejo Grande"]]],
    ["maruim", "Regional Maruim", [["220", "Maruim"], ["230", "Carmópolis"], ["240", "Divina Pastora"], ["250", "General Maynard"], ["260", "Japaratuba"],
      ["270", "Laranjeiras"], ["280", "Pirambu"], ["290", "Riachuelo"], ["300", "Rosário do Catete"], ["310", "Santa Rosa de Lima"],
      ["320", "Santo Amaro das Brotas"], ["330", "Siriri"]]],
  ];

  /* ALIASES (tabela única, explícita): nome como vem no ADMS -> código do município da tabela acima. Só entra grafia
     CONFIRMADA: pelo MESMO código no export real do ADMS (HISTORICO.csv, 30.313 linhas, só consulta) ou pelo COI.
     NÃO incluídos: "NSRA"/"N SRA"/"STO"/"M. BONITA"/"P. REDONDO": no ADMS só aparecem em nomes de RUA ("RUA NSRA DA GLORIA"),
     nunca como município. */
  const ALIASES = {
    "NOSSA SENHORA APARECIDA": "120", // ADMS "120_NOSSA SENHORA APARECIDA" (145 incidentes) = mapa "120 — Aparecida"
    "GRACHO CARDOSO": "400",          // ADMS "400_GRACHO CARDOSO" (141) = mapa "400 — Graccho Cardoso"
    "NOSSA SENHORA DE LOURDES": "440", // ADMS "440_NOSSA SENHORA DE LOURDES" (65) = mapa "440 — Lourdes"
    "SANTO AMARO": "320",             // confirmado pelo COI: "Dispositivo: SANTO AMARO" (57, sem código) = 320 Santo Amaro das Brotas
    "AMPARO DO SAO FRANCISCO": "480", // confirmado pelo COI: "AMPARO DO SAO FRANCISCO" (2, sem código) = 480 Amparo de São Francisco
  };
  /* Rótulos de campo do ADMS que aparecem dentro da Localização (não são lugar). */
  const ROTULOS = new Set(["END", "DISPOSITIVO", "ESE MUNICIPIO PESQUISA", "MUNICIPIO", "MUNICIPIO PESQUISA", "LOCALIZACAO", "ENDERECO"]);

  /* O que não entra em nenhuma regional (selecionável no filtro, nada é escondido). */
  const ESPECIAIS = {
    "?desconhecida": "Localidade desconhecida",
    "?nao_reconhecido": "Localidade não reconhecida",
    "?divergente": "Divergência para revisão",
    "?fora_se": "Fora da área de Sergipe",
  };

  const semAcento = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const normalizar = (s) => semAcento(String(s || "")).replace(/['’`´]/g, " ").toUpperCase().replace(/\s+/g, " ").trim();

  const REGIONAIS = REGIONAIS_BASE.map(([id, nome, ms]) => ({ id, nome, municipios: ms.map(([codigo, n]) => ({
    chave: codigo || normalizar(n), codigo, nome: n, normal: normalizar(n), regional: id, regional_nome: nome })) }));
  const MUNICIPIOS = REGIONAIS.flatMap((r) => r.municipios);
  const PORCHAVE = new Map(MUNICIPIOS.map((m) => [m.chave, m]));
  const PORCODIGO = new Map(MUNICIPIOS.filter((m) => m.codigo).map((m) => [Number(m.codigo), m]));
  const PORNOME = new Map();
  const ligar = (nome, m) => { const l = PORNOME.get(nome) || []; if (!l.includes(m)) l.push(m); PORNOME.set(nome, l); };
  for (const m of MUNICIPIOS) ligar(m.normal, m);
  for (const [nome, chave] of Object.entries(ALIASES)) ligar(nome, PORCHAVE.get(chave));

  const nomeBonito = (m) => String(m || "").toLowerCase().replace(/(^|\s)(\S)/g, (t, e, l) => e + l.toUpperCase()).replace(/\s(Da|Das|De|Do|Dos|D)\s/g, (t) => t.toLowerCase());
  const rotuloMunicipio = (m) => (m.codigo ? `${m.codigo} — ${m.nome}` : m.nome);
  const tresDigitos = (n) => String(n).padStart(3, "0");
  const conhecido = (nome) => PORNOME.has(nome) || !!REF[nome];

  /* Trechos da Localização -> [{ codigo (número|null), nome (normalizado; "" = não é nome: endereço, número, vazio), original,
     origem: "dispositivo" | "campo" }]. Separadores: ";", "·", "|", " - "; rótulo de campo "X: valor" ("Dispositivo:", "End::",
     "ESE_Municipio_Pesquisa:") é separado do valor. Endereço do ADMS ("RUA X_10_CENTRO") tem "_" e número: não é nome. Nome com
     "_" no lugar de espaço ("SAO_BENTO") só vale se for um nome conhecido (das regionais ou do export real). */
  function trechos(loc) {
    const segs = String(loc || "").replace(/\s+/g, " ").split(/[;·•|]|\s[-–]\s/).map((p) => p.trim()).filter(Boolean), out = [];
    for (const seg of segs) {
      const r = seg.match(/^([^:]*?)\s*:+\s*(.*)$/);
      const rotulo = r ? normalizar(r[1].replace(/_+/g, " ")) : "";
      const origem = rotulo === "DISPOSITIVO" ? "dispositivo" : "campo";
      const valores = r ? (ROTULOS.has(rotulo) ? [r[2]] : [r[1], ...r[2].split(/:+/)]) : [seg];
      for (const v of valores.map((x) => x.trim()).filter(Boolean)) {
        let u = v, codigo = null;
        const m = u.match(/^(\d+)\s*_\s*(.*)$/);
        if (m) { codigo = Number(m[1]); u = m[2]; }
        let nome = normalizar(u);
        if (nome.includes("_")) { const sub = normalizar(nome.replace(/_+/g, " ")); nome = !/\d/.test(sub) && (conhecido(sub) || ROTULOS.has(sub)) ? sub : ""; }
        if (!/^[A-Z][A-Z ]{1,59}$/.test(nome) || ROTULOS.has(nome)) nome = "";
        out.push({ codigo, nome, original: v, origem });
      }
    }
    return out;
  }
  /* Força da evidência de um trecho: 3 = código e nome do MESMO município do mapa ("430_NOSSA SENHORA DA GLORIA", a cidade do
     endereço no ADMS); 2 = nome sem código (ou com código que não é de mapa), inclusive "ESE_Municipio_Pesquisa: X";
     1 = nome do equipamento ("Dispositivo: X": chave/transformador que pode ter o nome de OUTRO município). Vale o nível mais
     forte; dois municípios diferentes no mesmo nível = divergência. */
  const forca = (t, m) => (t.origem === "dispositivo" ? 1 : m && t.codigo !== null && PORCODIGO.get(t.codigo) === m ? 3 : 2);
  /* Nome do município como veio no ADMS (normalizado) no trecho reconhecido, ou o último nome encontrado, ou "". */
  const municipio = (loc) => classificar(loc).municipio;
  /* Outro estado: par código_nome visto só fora de SE; ou nome visto só fora de SE no export real, sem o código do mapa que o
     confirme como de Sergipe (ex.: "APARECIDA" solto só existe na Paraíba; em SE o ADMS usa 120_NOSSA SENHORA APARECIDA). */
  function foraDeSE(t, se) {
    if (t.codigo !== null && PARES_FORA.has(`${t.codigo}_${t.nome}`)) return true;
    const r = REF[t.nome];
    if (!r || !r.uf || r.uf === "SE") return false;
    return !(se && t.codigo !== null && PORCODIGO.get(t.codigo) === se[0]);
  }

  const cache = new Map();
  /* { status: ok|divergente|fora_se|nao_reconhecido|desconhecida, chave (código do município ou "?status"), nome (oficial, ou o
       do ADMS), codigo, regional, regional_nome, municipio (nome do ADMS normalizado), codigo_adms, original (trecho do ADMS),
       motivo, uf } — objeto congelado (cache). */
  function classificar(loc) {
    const k = String(loc || "");
    if (cache.has(k)) return cache.get(k);
    const ts = trechos(k), conflitos = [], textos = [], niveis = { 1: [], 2: [], 3: [] };
    for (const t of ts) {
      if (!t.nome) continue;
      const cm = t.codigo !== null ? PORCODIGO.get(t.codigo) : null, se = PORNOME.get(t.nome);
      if (foraDeSE(t, se)) { niveis[t.origem === "dispositivo" ? 1 : t.codigo !== null && PARES_FORA.has(`${t.codigo}_${t.nome}`) ? 3 : 2].push({ fora: true, t }); continue; }
      if (se) {
        const m = se[0];
        if (cm && cm !== m) conflitos.push(`código ${tresDigitos(t.codigo)} = ${cm.nome} (${cm.regional_nome}), mas o nome é ${m.nome} (${m.regional_nome})`);
        else niveis[forca(t, m)].push({ m, t });
        continue;
      }
      textos.push(t);
    }
    // Nível mais forte com algum lugar identificado; municípios distintos desse nível (e outros estados do mesmo nível).
    const topo = niveis[3].length ? niveis[3] : niveis[2].length ? niveis[2] : niveis[1];
    const achados = new Map(), foras = [];
    for (const a of topo) { if (a.fora) foras.push(a.t); else if (!achados.has(a.m.chave)) achados.set(a.m.chave, a); }
    const ultimo = [...ts].reverse().find((t) => t.nome) || ts[ts.length - 1] || { codigo: null, nome: "", original: "" };
    const base = (t) => ({ municipio: t.nome, codigo_adms: t.codigo, original: t.original });
    const fora = (status, t, motivo, extra) => ({ ...base(t), status, chave: "?" + status, nome: t.nome ? nomeBonito(t.nome) : "", codigo: "", regional: "", regional_nome: "", motivo, ...extra });
    let c;
    if (conflitos.length || achados.size > 1 || (achados.size === 1 && foras.length)) {
      const ms = [...achados.values()].map((a) => a.m.nome), fs = foras.map((t) => nomeBonito(t.nome));
      c = fora("divergente", [...achados.values()][0] ? [...achados.values()][0].t : ultimo,
        conflitos.length ? conflitos.join("; ") : `mais de um município no mesmo campo: ${[...ms, ...fs].join(" / ")}`);
    } else if (achados.size === 1) {
      const { m, t } = [...achados.values()][0];
      c = { ...base(t), status: "ok", chave: m.chave, nome: m.nome, codigo: m.codigo, regional: m.regional, regional_nome: m.regional_nome,
        motivo: t.codigo !== null && t.codigo !== Number(m.codigo) ? `código ${t.codigo} do ADMS não é o do mapa (${m.codigo}); reconhecido pelo nome` : "" };
    } else if (foras.length) {
      const t = foras[0], r = REF[t.nome];
      const daUF = r && r.uf && r.uf !== "SE";
      c = fora("fora_se", t, `${nomeBonito(t.nome)}: município de outro estado${daUF ? ` (${r.uf})` : ` (o par ${t.codigo}_${t.nome} só aparece fora de Sergipe no ADMS)`}`, { uf: daUF ? r.uf : "" });
    } else if (textos.length) c = fora("nao_reconhecido", textos[textos.length - 1], "nome não cadastrado nas sete regionais");
    else c = fora("desconhecida", ultimo, k.trim() ? "sem nome de município na Localização (só endereço, código ou rótulo)" : "Localização vazia");
    Object.freeze(c);
    if (cache.size > 5000) cache.clear();
    cache.set(k, c);
    return c;
  }
  /* Incidente com várias comunicações (a PRINCIPAL primeiro — a que recebe a mensagem):
     - localidade do incidente = a da principal, se reconhecida; senão, o único município reconhecido nas demais comunicações
       (comunicação vazia ou sem nome não tira o incidente da regional);
     - principal sem município e as demais em municípios diferentes = divergência para revisão;
     - nenhum município: a categoria mais informativa (divergência > fora de SE > não reconhecida > desconhecida).
     chaves = TODOS os municípios reconhecidos nas comunicações (o incidente aparece em cada um deles, como antes) ou, sem
     nenhum, a categoria; se o incidente for divergência, ela também entra. Comunicação vazia nunca põe o incidente em
     "desconhecida" quando outra comunicação tem município. */
  const ORDEM_FORA = ["divergente", "fora_se", "nao_reconhecido", "desconhecida"];
  const cacheInc = new Map();
  function classificarIncidente(locs) {
    const lista = (Array.isArray(locs) ? locs : [locs]).map((x) => String(x || ""));
    const k = lista.join("");
    if (cacheInc.has(k)) return cacheInc.get(k);
    const cs = lista.map(classificar), oks = new Map();
    for (const c of cs) if (c.status === "ok" && !oks.has(c.chave)) oks.set(c.chave, c);
    let r;
    if (cs[0] && cs[0].status === "ok") r = cs[0];
    else if (oks.size === 1) r = [...oks.values()][0];
    else if (oks.size > 1) r = { ...(cs[0] || classificar("")), status: "divergente", chave: "?divergente", codigo: "", regional: "", regional_nome: "",
      nome: [...oks.values()].map((c) => c.nome).join(" / "), motivo: `principal sem município; comunicações em municípios diferentes: ${[...oks.values()].map((c) => c.nome).join(" / ")}` };
    else r = ORDEM_FORA.map((st) => cs.find((c) => c.status === st)).find(Boolean) || classificar("");
    const chaves = oks.size ? [...oks.keys(), ...(r.status === "divergente" ? ["?divergente"] : [])] : [r.chave];
    r = Object.freeze({ ...r, chaves: Object.freeze(chaves) });
    if (cacheInc.size > 5000) cacheInc.clear();
    cacheInc.set(k, r);
    return r;
  }
  /* O incidente passa na seleção se ALGUMA das suas chaves (municípios reconhecidos, ou a categoria) estiver selecionada. */
  const confereIncidente = (r, selecao) => !selecao || !selecao.size || r.chaves.some((x) => selecao.has(x));
  const chave = (loc) => classificar(loc).chave;
  /* Seleção vazia (ou ausente) = todos os registros. Senão, o registro passa se a sua chave estiver selecionada. */
  const confereResultado = (c, selecao) => !selecao || !selecao.size || selecao.has(c.chave);
  const confere = (loc, selecao) => confereResultado(classificar(loc), selecao);
  const chavesDaRegional = (id) => (REGIONAIS.find((r) => r.id === id) || { municipios: [] }).municipios.map((m) => m.chave);
  /* Texto compacto da seleção: regional inteira vira o nome da regional; o resto, os municípios (máx. 3 + "+n"). */
  function descrever(selecao, max = 3) {
    if (!selecao || !selecao.size) return "Todas as regionais";
    const partes = [], resto = new Set(selecao);
    for (const r of REGIONAIS) { const ks = r.municipios.map((m) => m.chave); if (ks.every((x) => resto.has(x))) { partes.push(r.nome); ks.forEach((x) => resto.delete(x)); } }
    for (const k of resto) partes.push(PORCHAVE.has(k) ? PORCHAVE.get(k).nome : ESPECIAIS[k] || k);
    return partes.length > max ? partes.slice(0, max).join(", ") + ` +${partes.length - max}` : partes.join(", ");
  }
  const rotulo = (c) => (c.status === "ok" ? c.nome : c.nome || "—");

  raiz.Localidades = { REGIONAIS, MUNICIPIOS, ALIASES, ESPECIAIS, normalizar, trechos, municipio, classificar, classificarIncidente, confereIncidente, chave,
    confere, confereResultado, chavesDaRegional, descrever, rotulo, rotuloMunicipio, nomeBonito, municipioPorChave: (k) => PORCHAVE.get(k) || null, REF };
})(typeof window !== "undefined" ? window : globalThis);
