/* Testes automatizados da Central de Callback (versão web). Só dados FICTÍCIOS.
   Rodam num banco separado ("central-callback-coi-testes"), apagado no fim: não tocam nos dados do operador. */
"use strict";
(async function () {
  const N = window.Nucleo, saida = document.getElementById("resultado"), resultados = [];
  const BANCO = "central-callback-coi-testes";
  function registrarResultado(ok, nome, det) {
    resultados.push({ ok, nome, det });
    const li = document.createElement("li"); li.className = ok ? "ok" : "falha";
    li.textContent = (ok ? "OK  " : "FALHA  ") + nome + (det ? " — " + det : ""); saida.appendChild(li);
  }
  async function teste(nome, f) {
    try { await f(); registrarResultado(true, nome); } catch (e) { registrarResultado(false, nome, e && e.message || String(e)); }
  }
  function igual(a, b, msg) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${msg || "esperado"}: ${y}, obtido: ${x}`); }
  function verdade(c, msg) { if (!c) throw new Error(msg || "condição falsa"); }
  async function falhaCom(f, trecho) {
    try { await f(); } catch (e) { if (!String(e.message).includes(trecho)) throw new Error(`erro diferente: ${e.message}`); return e; }
    throw new Error(`deveria falhar com "${trecho}"`);
  }

  /* ---------------------------------------------------- gerador fictício (porte de backend/tests/csv_ficticio.py) */
  const CAB = ["!", "ID", "Horário da call", "Motivo", "Submotivos", "UC", "Nome do reclamante", "Comentário", "Emergência", "Incidente",
    "Alimentador origem", "Localização", "Prioridade", "Cust. prioritárias", "Tipo UC:", "Protocolo", "Contato do reclamante", "Medidor ID",
    "Nota do endereço", "Custom ID do SDP", "Recebido ADMS", "Anexos", "ID do Incidente Pai"];
  const CAB2026 = ["   !", "Horário da call", "ID", "Incidente", "UC", "Nome do reclamante", "Protocolo", "Motivo", "Submotivos", "Comentário",
    "Emergência", "Localização", "Horário Agendado", "Recebido ADMS", "Prioridade", "Anexos", "Cust. prioritárias", "Contato do reclamante",
    "Medidor ID", "Tipo de medidor", "Nota do endereço", "Custom ID do SDP", "Idioma", "Callback", "ID do Incidente Pai"];
  function linha(call, inc = "", contato = "", comentario = "", o = {}) {
    const n = call ? call.split(/\s+/).pop() : "0", municipio = o.municipio === undefined ? "Cidade Alfa" : o.municipio, h = o.horario || "10/03/2026 08:15:00";
    return { "!": "Não", ID: call, "Horário da call": h, Motivo: o.motivo || "Falta de energia", Submotivos: o.submotivos || "FE",
      UC: o.uc === undefined ? `FIC_UC_${n}` : o.uc, "Nome do reclamante": o.nome === undefined ? `Cliente Fictício ${n}` : o.nome,
      "Comentário": comentario, "Emergência": "Não", Incidente: inc, "Alimentador origem": "ALF01C1",
      "Localização": municipio ? `Rua Exemplo, ${n}; Bairro Modelo; ${municipio}` : "Rua Exemplo", Prioridade: "Normal",
      "Cust. prioritárias": "00-Não é VIP", "Tipo UC:": "RESIDENTIAL", Protocolo: `1_2_${n}`, "Contato do reclamante": contato,
      "Medidor ID": `MED${n}`, "Nota do endereço": "", "Custom ID do SDP": o.sdp === undefined ? `FIC_UC_${n}` : o.sdp,
      "Recebido ADMS": h, Anexos: "Não", "ID do Incidente Pai": o.pai || "" };
  }
  const cenarioPadrao = () => [
    linha("CALL 0000001", "INC 0000100", "MOBILE: (79) 99100-0001"),
    linha("CALL 0000002", "INC 0000100", "TELEPHONE: 79991000001", "", { submotivos: "RV; RV" }),
    linha("CALL 0000003", "INC 0000101", "MOBILE: 79 3200-0003"),
    linha("CALL 0000004", "INC 0000101", "", "Cliente pede retorno no tel 79 99100-0004", { municipio: "Cidade Beta" }),
    linha("CALL 0000005", "INC 0000102", "TELEPHONE: 0000000000", "Teste de treinamento"),
    linha("CALL 0000006", "", "MOBILE: 79991000006", "", { municipio: "Cidade Gama", uc: "", sdp: "FIC_SDP_6" }),
    linha("CALL 0000001", "INC 0000100", "MOBILE: (79) 99100-0001"),
    linha("", "INC 0000103", "MOBILE: 79991000008"),
    linha("CALL 0000007", "INC 0000103", "MOBILE: 79991000007", "Sem energia há 3 dias desde 01/03/2026 10:00, CEP 49000-000, roteiro 12_345_678",
      { pai: "INC 0000100", sdp: "FIC_SDP_7" }),
  ];
  function cp1252(t) { return Uint8Array.from(t, (c) => { const x = c.charCodeAt(0); if (x > 255) throw new Error("fora do cp1252 de teste"); return x; }); }
  const q = (v) => '"' + String(v).replace(/"/g, '""') + '"';
  function gerarCSV(linhas, { sep = ";", linhaSep = true, cod = "utf-8-sig" } = {}) {
    let t = linhaSep ? `sep=${sep}\r\n` : "";
    t += CAB.map(q).join(sep) + "\r\n";
    for (const l of linhas || cenarioPadrao()) t += CAB.map((c) => q(l[c] ?? "")).join(sep) + "\r\n";
    return cod === "cp1252" ? cp1252(t) : new TextEncoder().encode((cod === "utf-8-sig" ? "﻿" : "") + t);
  }
  function gerarCSV2026(linhas, { filtro, linhaSep = true, cod = "utf-8-sig" } = {}) {
    let t = linhaSep ? "sep=;\r\n" : "";
    t += q(filtro || "Filtrar: [ (Região normal Contém ' CIDADE ALFA' E Localização não contém 'X'; OU Localização Contém '10_BAIRRO') ]") + ";\r\n\r\n";
    const extras = { "Horário Agendado": "", "Tipo de medidor": "", Idioma: "Portuguese (Brazil)", Callback: "Não" };
    t += CAB2026.map(q).join(";") + ";\r\n";
    for (const l of linhas || cenarioPadrao()) { const d = { ...extras, ...l, "   !": l["!"] }; t += CAB2026.map((c) => q(d[c] ?? "")).join(";") + ";\r\n"; }
    return cod === "cp1252" ? cp1252(t) : new TextEncoder().encode("﻿" + t);
  }
  function loteCSV(n, inicio = 1, { semTelefone = [], invalidos = [] } = {}) {
    const ls = [];
    for (let i = inicio; i < inicio + n; i++) {
      const contato = semTelefone.includes(i) ? "" : invalidos.includes(i) ? "TELEPHONE: 0000000000"
        : `MOBILE: 79 9${String(8000 + (i % 1000)).padStart(4, "0")}-${String(i % 10000).padStart(4, "0")}`;
      ls.push(linha(`CALL ${String(i).padStart(7, "0")}`, `INC ${String(500000 + i).padStart(7, "0")}`, contato, "Sem energia (fictício)"));
    }
    return gerarCSV(ls);
  }

  /* ==================================================== núcleo */
  await teste("SHA-256 (vetores NIST)", () => {
    igual(N.sha256Hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    igual(N.sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    igual(N.sha256Hex("a".repeat(1000)), "41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3");
  });
  await teste("HMAC-SHA256 (RFC 4231, caso 2)", () =>
    igual(N.hmacSha256Hex("4a656665", "what do ya want for nothing?"), "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"));

  await teste("Leitor: formato antigo do ADMS (sep=, 23 colunas)", () => {
    const a = N.lerCSV(gerarCSV());
    igual([a.separador, a.tinha_linha_sep, a.codificacao, Object.keys(a.colunas_reconhecidas).length, a.colunas_ausentes.length, a.linhas.length], [";", true, "utf-8", 23, 0, 9]);
    igual(a.linhas[0].numero, 3); igual(a.linhas[0].original["Contato do reclamante"], "MOBILE: (79) 99100-0001");
  });
  await teste("Leitor: Windows-1252 e vírgula sem sep=", () => {
    const a = N.lerCSV(gerarCSV([linha("CALL 1", "INC 1", "", "", { municipio: "Estância Fictícia" })], { linhaSep: false, sep: ",", cod: "cp1252" }));
    igual([a.codificacao, a.separador], ["cp1252", ","]); verdade(a.linhas[0].valores.localizacao.endsWith("Estância Fictícia"));
  });
  await teste("Leitor: tabulação em Windows-1252", () => {
    const a = N.lerCSV(gerarCSV([linha("CALL 1", "INC 1", "MOBILE: 79991000001", "Comentário com acentuação")], { linhaSep: false, sep: "\t", cod: "cp1252" }));
    igual([a.separador, a.linhas.length, a.linhas[0].valores.comentario], ["\t", 1, "Comentário com acentuação"]);
  });
  await teste("Leitor: comentário com quebra de linha e numeração física", () => {
    const a = N.lerCSV(gerarCSV([linha("CALL 1", "INC 1", "", "linha um\nlinha dois"), linha("CALL 2", "INC 1")]));
    igual(a.linhas[0].valores.comentario, "linha um\nlinha dois"); igual(a.linhas[1].numero, 5);
  });
  await teste("Leitor: aspas dobradas dentro do campo", () => {
    const a = N.lerCSV(gerarCSV([linha("CALL 1", "INC 1", "", 'disse "urgente"; ligar')]));
    igual(a.linhas[0].valores.comentario, 'disse "urgente"; ligar');
  });
  await teste("Leitor: colunas ausentes e desconhecidas", () => {
    const cab = CAB.filter((c) => c !== "Anexos").concat(["Coluna Nova"]);
    const a = N.lerCSV(new TextEncoder().encode("sep=;\r\n" + cab.map(q).join(";") + "\r\n" + cab.map(() => q("x")).join(";")));
    igual(a.colunas_ausentes, ["Anexos"]); igual(a.colunas_desconhecidas, ["Coluna Nova"]);
  });
  await teste("Leitor 1.0.1: CSV ATUAL do ADMS com 'Filtrar: [...]' antes do cabeçalho", () => {
    const a = N.lerCSV(gerarCSV2026());
    igual([a.separador, a.tinha_linha_sep, a.linhas_antes_do_cabecalho, Object.keys(a.colunas_reconhecidas).length], [";", true, 2, 21]);
    igual(a.colunas_ausentes, ["Alimentador origem", "Tipo UC:"]);
    igual(a.colunas_desconhecidas, ["Horário Agendado", "Tipo de medidor", "Idioma", "Callback"]);
    igual([a.linhas.length, a.linhas.some((l) => l.colunas_divergentes), a.linhas[0].numero], [9, false, 5]);
    igual(a.linhas[0].valores.call_id, "CALL 0000001");
  });
  await teste("Leitor 1.0.1: formato atual sem sep= e em Windows-1252", () => {
    const a = N.lerCSV(gerarCSV2026(null, { linhaSep: false, cod: "cp1252" }));
    igual([a.separador, a.tinha_linha_sep, a.codificacao, a.linhas.length, a.linhas[0].numero], [";", false, "cp1252", 9, 4]);
  });
  await teste("Leitor 1.0.1: vírgulas no filtro não enganam o separador", () => {
    const a = N.lerCSV(gerarCSV2026(null, { linhaSep: false, filtro: "Filtrar: [ Localização Contém 'A, B, C, D, E, F' ]" }));
    igual([a.separador, a.linhas.length], [";", 9]);
  });
  await teste("Leitor 1.0.1: linha incompleta e valor além do cabeçalho continuam divergentes", () => {
    const base = new TextDecoder().decode(gerarCSV2026([linha("CALL 1", "INC 1")])).replace(/^﻿/, "");
    const ult = base.trimEnd().split("\r\n").pop();
    const a = N.lerCSV(new TextEncoder().encode(base + '"Sim";"10/03/2026 08:00:00";"CALL 2"\r\n' + ult + '"sobrando"\r\n'));
    igual(a.linhas.map((l) => l.colunas_divergentes), [false, true, true]); igual(a.linhas[1].numero, 6);
  });
  await teste("Leitor 1.0.1: linha sem o ';' final não é divergente", () => {
    const t = new TextDecoder().decode(gerarCSV2026([linha("CALL 1", "INC 1")])).trimEnd();
    const a = N.lerCSV(new TextEncoder().encode(t.replace(/;$/, "") + "\r\n"));
    igual([a.linhas.length, a.linhas[0].colunas_divergentes], [1, false]);
  });
  await teste("Leitor: arquivos inválidos informam o motivo", async () => {
    await falhaCom(() => N.lerCSV(new Uint8Array()), "vazio");
    await falhaCom(() => N.lerCSV(Uint8Array.from([0x50, 0x4b, 3, 4, 0, 0])), "planilha");
    await falhaCom(() => N.lerCSV(new TextEncoder().encode('sep=;\r\n"Nome";"Outro"\r\n"a";"b"')), "coluna 'ID'");
    await falhaCom(() => N.lerCSV(new TextEncoder().encode("sem separador nenhum")), "separador");
    let longo = "sep=;\r\n"; for (let i = 0; i < 25; i++) longo += `"linha ${i}";\r\n`;
    await falhaCom(() => N.lerCSV(new TextEncoder().encode(longo + CAB.join(";") + "\r\n")), "coluna 'ID'");
  });

  await teste("Telefones: normalização e classificação", () => {
    igual(N.normalizarTelefone("+55 (79) 99100-0001"), "79991000001"); igual(N.normalizarTelefone("0 79 3200-0003"), "7932000003");
    igual(N.normalizarTelefone("79.3200.0003"), "7932000003");
    igual(N.classificarTelefone("79991000001"), ["celular", null]); igual(N.classificarTelefone("7932000003"), ["fixo", null]);
    for (const n of ["7981000003", "2099100000", "79811110000", "0000000000", "79912345678", "123"]) igual(N.classificarTelefone(n)[0], "invalido", n);
  });
  await teste("Telefones: rótulo não define o tipo; vários números", () => {
    igual(N.extrairDoContato("MOBILE: 79 3200-0003")[0].tipo, "fixo"); igual(N.extrairDoContato("MOBILE: 79 3200-0003")[0].rotulo, "MOBILE");
    igual(N.extrairDoContato("TELEPHONE: 79991000001")[0].tipo, "celular");
    igual(N.extrairDoContato("TELEPHONE: 7932000003; MOBILE: 79991000001").map((t) => t.tipo), ["fixo", "celular"]);
    igual(N.extrairDoContato(""), []); igual(N.extrairDoContato("MOBILE:"), []);
  });
  await teste("Telefones: comentário ignora números que não são telefone e exige confirmação", () => {
    igual(N.extrairDoComentario("Sem energia há 3 dias desde 01/03/2026 10:00, CEP 49000-000, roteiro 12_345_678, UC FIC_UC_12345678901, CALL 0000123456, INC 9876543210, coord 10.123.45.678901"), []);
    const c = N.extrairDoComentario("ligar no cel 79 99100-0004 por favor");
    igual([c.length, c[0].requer_confirmacao, c[0].numero], [1, true, "79991000004"]);
  });
  await teste("Classificação: tipo pela sigla do submotivo; subtipo só pelo texto; risco prevalece", () => {
    igual(["FE", "DF", "RV", "NT", "OT", "XX"].map(N.tipoOcorrencia), ["falta_de_energia", "defeito", "risco_de_vida", "nivel_de_tensao", "outros", "nao_classificado"]);
    igual(N.detectarSubtipo(["RV; CONDUTOR PARTIDO"], "risco_de_vida")[0], "condutor_partido");
    igual(N.detectarSubtipo(["FE"], "falta_de_energia")[0], null);
    igual(N.detectarSubtipo(["RV; TENSAO ALTA"], "risco_de_vida")[0], null);
    igual(N.detectarSubtipo(["CONDUTOR PARTIDO; INCENDIO"], "risco_de_vida")[0], null);
    igual(N.detectarSubtipo(["Choque na instalação"], "risco_de_vida")[0], "choque_eletrico");
  });
  await teste("Mensagens: 23 manuais (21 anteriores + 2 novas) e escolha por subtipo preservada", () => {
    igual(N.modelos().length, 23);
    igual(N.escolherModelo("condutor_partido").codigo, "manual_condutor_partido");
    igual(N.escolherModelo("choque_eletrico").codigo, "manual_choque_eletrico");
    igual(N.escolherModelo(null).codigo, "manual_atualizacao");
    const t = N.renderizar(N.escolherModelo("condutor_partido"), { incidente: "INC 0000001", call_id: "CALL 1", tipo_ocorrencia: "risco_de_vida" }, "Polo Fictício");
    verdade(!t.toLowerCase().includes("foto") && t.includes("Referência do atendimento: INC 0000001") && !/\{[a-z_]+\}/.test(t));
    verdade(!t.includes("Polo Fictício"), "a saudação não pode citar o polo");
  });
  await teste("1.0.2 Saudação 'Olá, aqui é a Energisa.' em TODAS as mensagens; sem SAIR, Central de Comunicação, polo ou WhatsApp do polo", () => {
    const todos = window.MODELOS_MENSAGEM;
    igual(todos.length, 27);
    for (const m of todos) {
      verdade(m.texto.startsWith("Olá, aqui é a Energisa."), `${m.codigo} sem a saudação`);
      verdade(!/SAIR|Central de Comunica|\{polo\}|WhatsApp do|\{saudacao\}/.test(m.texto), `${m.codigo} com trecho proibido`);
      const r = N.renderizar(m, { incidente: "INC 1", call_id: "CALL 1", tipo_ocorrencia: "falta_de_energia" }, "Polo Aracaju");
      verdade(r.startsWith("Olá, aqui é a Energisa.") && !r.includes("Polo Aracaju") && !/SAIR/.test(r), `${m.codigo} renderizada`);
    }
  });
  await teste("1.0.2 Conteúdo anterior preservado em cada mensagem alterada", () => {
    for (const m of window.MODELOS_MENSAGEM) {
      if (["manual_falta_energia_geral", "manual_poste_ferragens_expostas"].includes(m.codigo)) { igual(m.texto_anterior, null); continue; }
      verdade(m.texto_anterior && m.nome_anterior, `${m.codigo} sem texto anterior`);
      if (m.codigo !== "manual_atualizacao") {   // orientações específicas mantidas: o texto novo = anterior sem cabeçalho e sem SAIR
        const miolo = m.texto.replace(/^Olá, aqui é a Energisa\. /, "").replace(/\.$/, "");
        verdade(m.texto_anterior.includes(miolo.slice(0, 30)), `${m.codigo} perdeu orientações`);
      }
    }
  });
  await teste("1.0.2 Novas mensagens: falta de energia geral, poste com ferragens expostas e genérica (textos exatos)", () => {
    const por = Object.fromEntries(N.modelos().map((m) => [m.codigo, m]));
    igual(por.manual_falta_energia_geral.nome, "Falta de energia geral — confirmação com vizinhos");
    igual(por.manual_falta_energia_geral.texto, "Olá, aqui é a Energisa. Estamos entrando em contato referente a uma solicitação de falta de energia. Poderia nos informar se a falta de energia está acontecendo apenas na sua residência ou se os vizinhos da localidade também estão sem energia?");
    igual(por.manual_poste_ferragens_expostas.nome, "Poste com ferragens expostas");
    igual(por.manual_poste_ferragens_expostas.texto, "Olá, aqui é a Energisa. Estamos entrando em contato referente à ocorrência de ferragens expostas em um poste. Para nos ajudar a compreender melhor a situação, poderia enviar uma foto do local, caso seja seguro realizar o registro? Não se aproxime do poste nem toque em estruturas ou componentes da rede elétrica.");
    igual(por.manual_atualizacao.texto, "Olá, aqui é a Energisa. Estamos entrando em contato referente a uma solicitação que você registrou conosco. Você poderia nos fornecer mais informações sobre a situação?");
    verdade(!/atualiza/i.test(por.manual_atualizacao.texto), "genérica não pode anunciar atualização");
    // as novas não entram na classificação automática (sem subtipo)
    igual([por.manual_falta_energia_geral.subtipo_ocorrencia, por.manual_poste_ferragens_expostas.subtipo_ocorrencia], [null, null]);
    igual(N.escolherModelo("falta_energia").codigo, "manual_falta_energia");
  });
  await teste("1.0.2 Lista de mensagens: grupos e títulos em ordem alfabética, sem duplicar, prioridade marcada", () => {
    const g = N.catalogoAgrupado(), alfa = (a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" });
    const nomesG = g.map((x) => x.grupo);
    igual(nomesG, nomesG.slice().sort(alfa), "grupos fora de ordem");
    for (const x of g) igual(x.modelos.map((m) => m.nome), x.modelos.map((m) => m.nome).sort(alfa), "títulos fora de ordem em " + x.grupo);
    const todos = g.flatMap((x) => x.modelos.map((m) => m.codigo));
    igual([todos.length, new Set(todos).size], [23, 23]);
    const de = (nome) => g.find((x) => x.grupo === nome).modelos.map((m) => m.nome);
    igual(de("Poste"), ["Poste abalroado", "Poste auxiliar quebrado", "Poste com ferragens expostas", "Poste inclinado"]);
    igual(de("Falta de energia"), ["Falta de energia — residência", "Falta de energia geral — confirmação com vizinhos"]);
    igual(g.flatMap((x) => x.modelos).filter((m) => m.prioridade).map((m) => m.codigo).sort(),
      ["manual_choque_eletrico", "manual_condutor_partido", "manual_faiscas_ramal", "manual_faiscas_rede", "manual_incendio", "manual_poste_abalroado"]);
  });
  await teste("1.0.2 Data e hora da comunicação (Horário da call) em formato legível", () => {
    igual(N.formatarDataHora("2026-11-01T05:02:29"), "01/11/2026 05:02:29"); igual(N.formatarDataHora(null), "—");
    const a = N.analisar(gerarCSV([linha("CALL 1", "INC 1", "MOBILE: 79991000001", "", { horario: "01/11/2026 05:02:29" })]));
    igual(a.validas[0].horario_call, "2026-11-01T05:02:29");
  });

  /* ---------- 1.0.2: agrupamento por incidente (dados fictícios) */
  const H = (hh) => `10/03/2026 ${hh}:00`;
  const contingencia = () => [  // INC 9900001 com 5 comunicações (como o exemplo INC 144039114 da especificação)
    linha("CALL 0000011", "INC 9900001", "MOBILE: 79991000011", "", { horario: H("08:00"), submotivos: "FE", uc: "FIC_UC_A" }),
    linha("CALL 0000012", "INC 9900001", "MOBILE: 79991000012", "", { horario: H("08:10"), submotivos: "NT; OSCILACAO", uc: "FIC_UC_B" }),
    linha("CALL 0000013", "INC 9900001", "MOBILE: 79991000013", "", { horario: H("08:20"), submotivos: "FE", uc: "FIC_UC_C" }),
    linha("CALL 0000014", "INC 9900001", "MOBILE: 79991000014", "", { horario: H("08:30"), submotivos: "RV; CONDUTOR PARTIDO", uc: "FIC_UC_D" }),
    linha("CALL 0000015", "INC 9900001", "MOBILE: 79991000015", "", { horario: H("08:40"), submotivos: "FE", uc: "FIC_UC_E" }),
  ];
  const gruposDe = (ls) => N.agruparIncidentes(N.analisar(gerarCSV(ls)).validas);
  await teste("1.0.2 Agrupamento: 5 comunicações do mesmo incidente = 1 linha com quantidade 5", () => {
    const g = gruposDe(contingencia());
    igual([g.length, g[0].qtd, g[0].incidente, g[0].membros.length], [1, 5, "INC 9900001", 5]);
    verdade(g[0].avisos.some((a) => a.texto === "INCIDENTE COM MÚLTIPLAS COMUNICAÇÕES — 5 REGISTROS"));
  });
  await teste("1.0.2 Principal = comunicação com RISCO (mesmo não sendo a mais recente)", () => {
    const g = gruposDe(contingencia())[0];
    igual([g.principal.call_id, g.risco], ["CALL 0000014", 2]);
    verdade(g.avisos.some((a) => a.texto === "ATENÇÃO: EXISTE COMUNICAÇÃO COM INDICAÇÃO DE RISCO — VERIFICAR PRIORITARIAMENTE."));
    igual(g.principal.subtipo, "condutor_partido");
  });
  await teste("1.0.2 Principal = a MAIS RECENTE quando não há risco (nunca a mais antiga)", () => {
    const ls = contingencia().filter((l) => l.ID !== "CALL 0000014");
    const g = gruposDe(ls)[0];
    igual([g.qtd, g.principal.call_id, g.risco], [4, "CALL 0000015", 0]);
    igual(gruposDe(ls.slice().reverse())[0].principal.call_id, "CALL 0000015", "ordem do arquivo não pode mudar a escolha");
    verdade(!g.avisos.some((a) => a.tipo === "risco"));
  });
  await teste("1.0.2 Indício de risco só no texto: avisa e prioriza, sem classificar", () => {
    const ls = [linha("CALL 0000021", "INC 9900002", "MOBILE: 79991000021", "Cliente informa cabo partido na rua", { horario: H("07:00") }),
      linha("CALL 0000022", "INC 9900002", "MOBILE: 79991000022", "Sem energia", { horario: H("09:00"), uc: "FIC_UC_X" })];
    const g = gruposDe(ls)[0];
    igual([g.principal.call_id, g.risco, g.principal.tipo_ocorrencia, g.principal.subtipo], ["CALL 0000021", 1, "falta_de_energia", null]);
    verdade(g.avisos.find((a) => a.tipo === "risco").detalhe.includes("não classificado"));
  });
  await teste("1.0.2 Não agrupa incidentes diferentes com a mesma UC, nem comunicações sem incidente", () => {
    const ls = [linha("CALL 0000031", "INC 9900003", "MOBILE: 79991000031", "", { uc: "FIC_UC_IGUAL" }),
      linha("CALL 0000032", "INC 9900004", "MOBILE: 79991000032", "", { uc: "FIC_UC_IGUAL" }),
      linha("CALL 0000033", "", "MOBILE: 79991000033", "", { uc: "FIC_UC_IGUAL" }),
      linha("CALL 0000034", "", "MOBILE: 79991000034", "", { uc: "FIC_UC_IGUAL" })];
    const g = gruposDe(ls);
    igual([g.length, g.every((x) => x.qtd === 1)], [4, true]);
    igual(N.resumoAgrupamento(N.analisar(gerarCSV(ls)).validas).incidentes_distintos, 2);
  });
  await teste("1.0.2 Avisos de possível ocorrência geral e de falta de fase (sem afirmar)", () => {
    const g = gruposDe(contingencia())[0];
    verdade(g.avisos.some((a) => a.tipo === "possivel" && a.texto.startsWith("POSSÍVEL OCORRÊNCIA GERAL") && a.texto.includes("não confirmado")));
    const f = gruposDe([linha("CALL 0000041", "INC 9900005", "MOBILE: 79991000041", "casa com meia fase")])[0];
    verdade(f.avisos.some((a) => a.texto.startsWith("POSSÍVEL FALTA DE FASE")));
    const um = gruposDe([linha("CALL 0000042", "INC 9900006", "MOBILE: 79991000042")])[0];
    igual(um.avisos, []);
  });
  await teste("Exportação: proteção contra fórmula e nome de arquivo seguro", () => {
    igual(["=CMD", "+1", "-2", "@x", "ok"].map(N.seguroPlanilha), ["'=CMD", "'+1", "'-2", "'@x", "ok"]);
    igual(N.nomeSeguro("=CMD|calc"), "CMD-calc"); igual(N.nomeSeguro(""), "sem-identificacao");
  });
  await teste("Data operacional e horário no fuso de Sergipe (America/Maceio)", () => {
    const d = new Date(Date.UTC(2026, 10, 4, 2, 30, 0)); // 23:30 do dia 03 em Sergipe
    igual(N.hojeLocal(d), "2026-11-03"); igual(N.agoraLocalIso(d), "2026-11-03T23:30:00-03:00");
  });

  /* ---------- 1.0.2 (refinamento): reconhecimento por palavras-chave -> mensagem pré-selecionada */
  const sug = (sigla, comentario, extra = {}) => {
    const c = { submotivos: sigla, comentario, tipo_ocorrencia: N.tipoOcorrencia(sigla), ...extra };
    c.subtipo = c.subtipo !== undefined ? c.subtipo : N.detectarSubtipo([sigla], c.tipo_ocorrencia)[0];
    return N.sugerirMensagem(c);
  };
  await teste("Reconhecimento: texto livre ignora referência, endereço, clima, telefone e protocolo", () => {
    const t = N.textoLivre("ROTEIRO: 1 234 567 REFERENCIA: POVOADO BAIXA VERDE COND CLIMA: NORMAL OBS: ESTOU SEM ENERGIA PROTOCOLO: 123456");
    igual(t, "ESTOU SEM ENERGIA");
    igual(N.textoLivre("OBS: UC: ; ENDERECO: LAGOA DA VOLTA, S/N, BAIRRO: AREA RURAL; COMENTARIOS: SEM INFORMACOES ADICIONAIS"), "SEM INFORMACOES ADICIONAIS");
    igual(sug("FE", "REFERENCIA: POVOADO BAIXA VERDE COND CLIMA: NORMAL OBS: ").codigo, "manual_falta_energia", "nome de lugar não pode virar tensão baixa");
    igual(sug("NT", "REFERENCIA: LAGOA DA VOLTA COND CLIMA: NAO INFORMADA. OBS: - GERADO VIA URA - TEL: 79999999999").codigo, "manual_atualizacao");
  });
  // Exemplos REAIS ANONIMIZADOS (estrutura e expressões dos CSVs de 01/11; sem nomes, telefones, endereços ou protocolos reais)
  const REAIS = [
    ["FE", "ROTEIRO: 1 234 5678 REFERENCIA: RUA DO MERCADO COND CLIMA: NORMAL OBS: CABO DE AT PARTIDO TEL 79900000000 / NAO CITOU OUTRO RT 1", "manual_condutor_partido", "texto"],
    ["DF", "ROTEIRO: 1 234 5678 COND CLIMA: NORMAL OBS: TROCAR TRANSFORMADOR, O MESMO ESTA VAZANDO OLEO RT", "manual_transformador_oleo", "texto"],
    ["DF", "REFERENCIA: PONTO DE REFERENCIA COND CLIMA: NAO INFORMADA. OBS: DF-INVERSAO-DE-FASE GERADO VIA URA - TEL: 79900000000", "manual_inversao_fase", "texto"],
    ["FE", "REFERENCIA: AO LADO DA IGREJA COND CLIMA: NAO INFORMADA. OBS: FALTA DE ENERGICA LOCAL E VIZINHANCA PROTOCOLO: 1234567890", "manual_falta_energia_geral", "texto"],
    ["FE", "ROTEIRO: 1 234 5678 COND CLIMA: NORMAL OBS: FALTA DE ENERGIA GERAL , APOS CARRETA PASSAR E CAUSAR ESTOURO NOS FIOS", "manual_falta_energia_geral", "texto"],
    ["DF", "REFERENCIA: LANCHONETE NO PONTO FINAL COND CLIMA: NORMAL OBS: CABO DE ALTA TENSAO DESNIVELADO", "manual_condutor_desnivelado", "texto"],
    ["FE", "ROTEIRO: 1 REFERENCIA: VIZINHO A LOJA COND CLIMA: NAO INFORMADA. OBS: ESTOU SEM ENERGIA PROTOCOLO: 1234567890", "manual_falta_energia", "texto"],
    ["FE", "ROTEIRO: 1 REFERENCIA: PROX A POUSADA COND CLIMA: NAO INFORMADA. OBS: DESDE ONTEM QUE ESTAMOS APENAS COM UMA FASE FUNCIONANDO", "manual_falta_energia", "sigla"],
    ["FE", "ROTEIRO:", "manual_falta_energia", "sigla"],
    ["DF", "ROTEIRO:", "manual_atualizacao", "generico"],
    ["NT", "ROTEIRO:", "manual_atualizacao", "generico"],
    ["RV", "ROTEIRO:", "manual_atualizacao", "generico"],
  ];
  await teste("Reconhecimento: exemplos reais anonimizados -> mensagem esperada", () => {
    for (const [sigla, com, esperado, origem] of REAIS) { const s = sug(sigla, com); igual([s.codigo, s.origem], [esperado, origem], `${sigla} "${com.slice(-45)}"`); }
  });
  await teste("Reconhecimento: palavras-chave e variações -> mensagem", () => {
    const casos = [["galho encostado na rede", "manual_arvore_rede"], ["Árvore caiu sobre os fios", "manual_arvore_rede"], ["coqueiro na fiação", "manual_arvore_rede"],
      ["cabo partido na calçada", "manual_condutor_partido"], ["fio rompido", "manual_condutor_partido"], ["condutor caído no chão", "manual_condutor_partido"],
      ["luz oscilando o dia todo", "manual_oscilacao"], ["energia vai e volta", "manual_oscilacao"], ["lâmpadas piscando", "manual_oscilacao"],
      ["sem energia desde cedo", "manual_falta_energia"], ["falta de luz", "manual_falta_energia"], ["faltou energia na rua toda", "manual_falta_energia_geral"],
      ["ferragens expostas no poste", "manual_poste_ferragens_expostas"], ["poste com ferragem aparecendo", "manual_poste_ferragens_expostas"],
      ["poste batido por carro", "manual_poste_abalroado"], ["poste inclinado na esquina", "manual_poste_inclinado"], ["faísca no ramal", "manual_faiscas_ramal"],
      ["centelhamento no poste", "manual_faiscas_rede"], ["pegando fogo na caixa de medição", "manual_incendio"], ["dando choque no portão", "manual_choque_eletrico"],
      ["pipa presa na rede", "manual_objeto_estranho_rede"], ["transformador fazendo barulho", "manual_defeito_transformador"], ["disjuntor desarmando", "manual_defeito_disjuntor"],
      ["problema no ramal da casa", "manual_problema_ramal"], ["tensão baixa, aparelhos não ligam", "manual_tensao_baixa"], ["sobretensão queimou a TV", "manual_tensao_alta"]];
    for (const [t, esperado] of casos) igual(sug("DF", "OBS: " + t).codigo, esperado, t);
  });
  await teste("Reconhecimento: risco prevalece sobre ocorrência comum; RV nunca recebe mensagem comum", () => {
    const a = sug("FE", "OBS: sem energia, e tem um cabo partido na frente");
    igual([a.codigo, a.risco, a.origem], ["manual_condutor_partido", true, "texto"]);
    igual(sug("FE", "OBS: árvore na rede soltando faísca").codigo, "manual_faiscas_rede");
    const b = sug("RV", "OBS: galho encostado na rede");
    igual([b.codigo, b.bloqueada], ["manual_atualizacao", "manual_arvore_rede"]);
    igual(sug("RV", "OBS: fio partido").codigo, "manual_condutor_partido");
    igual(sug("RV; CONDUTOR PARTIDO", "OBS: sem energia").codigo, "manual_condutor_partido", "subtipo de risco do submotivo prevalece");
    igual(sug("FE; OSCILACAO", "").codigo, "manual_oscilacao", "subtipo do submotivo continua valendo");
    verdade(N.REGRAS_MENSAGEM.slice(0, 6).every((r) => r.risco) && N.REGRAS_MENSAGEM.slice(6).every((r) => !r.risco), "regras de risco primeiro");
    for (const r of N.REGRAS_MENSAGEM) verdade(N.modelos().some((m) => m.codigo === r.codigo), "regra aponta para mensagem inexistente: " + r.id);
  });
  await teste("Reconhecimento: indício de risco no texto usa as mesmas regras (nível 1) sem reclassificar", () => {
    const c = { submotivos: "FE", tipo_ocorrencia: "falta_de_energia", subtipo: null, comentario: "REFERENCIA: X COND CLIMA: NORMAL OBS: CABO DE AT PARTIDO" };
    const r = N.indicacaoRisco(c);
    verdade(r.nivel === 1 && r.origem.includes("cabo") && r.origem.includes("não classificado"));
    igual(N.indicacaoRisco({ ...c, comentario: "REFERENCIA: RUA DO FOGO COND CLIMA: NORMAL OBS: sem energia" }).nivel, 0, "nome de rua na referência não é risco");
  });

  /* ---------- incidentes repetidos: cenários obrigatórios */
  const L = (call, inc, hh, sub, com = "", uc) => linha(call, inc, `MOBILE: 7999${String(call).slice(-7)}`, com, { horario: H(hh), submotivos: sub, uc: uc || "FIC_UC_" + call.slice(-3) });
  await teste("Cenário: várias comunicações de falta de energia -> mais recente; suspeita de ocorrência geral", () => {
    const g = gruposDe([L("CALL 0000051", "INC 9910001", "08:00", "FE"), L("CALL 0000052", "INC 9910001", "08:30", "FE"), L("CALL 0000053", "INC 9910001", "08:15", "FE")])[0];
    igual([g.qtd, g.principal.call_id, g.risco], [3, "CALL 0000052", 0]); verdade(g.avisos.some((a) => a.texto.startsWith("POSSÍVEL OCORRÊNCIA GERAL")));
  });
  await teste("Cenário: falta de energia e oscilação (sem risco) -> mais recente", () => {
    const g = gruposDe([L("CALL 0000061", "INC 9910002", "09:00", "NT; OSCILACAO"), L("CALL 0000062", "INC 9910002", "08:00", "FE")])[0];
    igual([g.principal.call_id, g.risco], ["CALL 0000061", 0]);
  });
  await teste("Cenário: falta de energia com cabo partido no texto -> cabo partido prevalece (7 comunicações)", () => {
    const ls = []; for (let i = 0; i < 7; i++) ls.push(L(`CALL 000007${i}`, "INC 9910003", `09:0${i}`, "FE", i === 2 ? "OBS: cabo partido na rua" : "OBS: sem energia"));
    const g = gruposDe(ls)[0];
    igual([g.qtd, g.principal.call_id, g.risco], [7, "CALL 0000072", 1]);
    igual(N.sugerirMensagem(g.principal).codigo, "manual_condutor_partido");
  });
  await teste("Cenário: comunicação ANTIGA de risco e recente comum -> a de risco", () => {
    const g = gruposDe([L("CALL 0000081", "INC 9910004", "07:00", "RV; CONDUTOR PARTIDO"), L("CALL 0000082", "INC 9910004", "10:00", "FE")])[0];
    igual([g.principal.call_id, g.risco], ["CALL 0000081", 2]);
  });
  await teste("Cenário: comunicação RECENTE de risco -> a de risco", () => {
    const g = gruposDe([L("CALL 0000091", "INC 9910005", "07:00", "FE"), L("CALL 0000092", "INC 9910005", "10:00", "RV")])[0];
    igual([g.principal.call_id, g.risco], ["CALL 0000092", 2]);
  });
  await teste("Cenário: incidentes distintos com a mesma UC, telefone e descrição -> não agrupa", () => {
    const a = linha("CALL 0000101", "INC 9910006", "MOBILE: 79991000999", "OBS: sem energia", { uc: "FIC_UC_SAME" });
    const b = linha("CALL 0000102", "INC 9910007", "MOBILE: 79991000999", "OBS: sem energia", { uc: "FIC_UC_SAME" });
    igual(gruposDe([a, b]).map((g) => g.qtd), [1, 1]);
  });

  /* ---------- ordenação cronológica obrigatória (mais recente -> mais antigo), risco NÃO muda a posição */
  const LH = (call, inc, dataHora, sub, com = "") => linha(call, inc, `MOBILE: 7999${call.slice(-7)}`, com, { horario: dataHora, submotivos: sub, uc: "FIC_UC_" + call.slice(-4) });
  const exemploOrdem = () => [   // misturado e fora de ordem no arquivo, como o exemplo da especificação
    LH("CALL 0000201", "INC 9920001", "03/11/2026 21:52:00", "RV; CONDUTOR PARTIDO"),               // risco
    LH("CALL 0000202", "INC 9920002", "04/11/2026 02:15:00", "FE", "OBS: sem energia"),            // comum
    LH("CALL 0000203", "INC 9920003", "03/11/2026 23:39:00", "FE"),                                 // múltiplas (principal: mais recente)
    LH("CALL 0000204", "INC 9920003", "03/11/2026 23:10:00", "NT; OSCILACAO"),
    LH("CALL 0000205", "INC 9920004", "04/11/2026 02:28:00", "RV"),                                 // risco
    LH("CALL 0000206", "INC 9920005", "03/11/2026 22:30:00", "FE", "OBS: cabo partido na rua"),    // indício de risco
  ];
  await teste("Ordenação: estritamente cronológica (exemplo da especificação), riscos não vão para o início", () => {
    const g = gruposDe(exemploOrdem());
    igual(g.map((x) => [N.formatarDataHora(x.principal.horario_call).slice(0, 16), x.incidente]), [
      ["04/11/2026 02:28", "INC 9920004"], ["04/11/2026 02:15", "INC 9920002"], ["03/11/2026 23:39", "INC 9920003"],
      ["03/11/2026 22:30", "INC 9920005"], ["03/11/2026 21:52", "INC 9920001"]]);
    igual(g.map((x) => x.risco), [2, 0, 0, 1, 2], "alertas de risco preservados");
    for (let i = 1; i < g.length; i++) verdade(g[i - 1].principal.horario_call >= g[i].principal.horario_call, "fora de ordem em " + i);
  });
  await teste("Ordenação: linha agrupada usa a data e hora da comunicação PRINCIPAL (risco antigo vence o recente)", () => {
    const ls = [LH("CALL 0000211", "INC 9921001", "04/11/2026 01:00:00", "FE"),                      // mais recente, comum
      LH("CALL 0000212", "INC 9921001", "03/11/2026 20:00:00", "RV; CONDUTOR PARTIDO"),               // antiga, RISCO -> principal
      LH("CALL 0000213", "INC 9921002", "03/11/2026 22:00:00", "FE")];
    const g = gruposDe(ls);
    igual(g.map((x) => [x.incidente, x.principal.call_id]), [["INC 9921002", "CALL 0000213"], ["INC 9921001", "CALL 0000212"]]);
  });
  await teste("Ordenação: empate de horário -> número do incidente (estável, independe da ordem do arquivo)", () => {
    const ls = [LH("CALL 0000221", "INC 9930009", "04/11/2026 10:00:00", "FE"), LH("CALL 0000222", "INC 9930002", "04/11/2026 10:00:00", "RV"),
      LH("CALL 0000223", "INC 9930005", "04/11/2026 10:00:00", "FE")];
    const esperado = ["INC 9930002", "INC 9930005", "INC 9930009"];
    igual(gruposDe(ls).map((x) => x.incidente), esperado);
    igual(gruposDe(ls.slice().reverse()).map((x) => x.incidente), esperado);
  });
  await teste("Ordenação: não altera os registros originais (ordem do arquivo e linhas do CSV preservadas)", () => {
    const a = N.analisar(gerarCSV(exemploOrdem()));
    const antes = JSON.stringify(a.validas.map((v) => [v.linha_arquivo, v.call_id, v.horario_call]));
    N.agruparIncidentes(a.validas);
    igual(JSON.stringify(a.validas.map((v) => [v.linha_arquivo, v.call_id, v.horario_call])), antes);
  });

  /* ==================================================== serviço + armazenamento (banco de TESTES) */
  await Armazenamento.apagarBanco(BANCO);
  async function novoServico() { return new Servico(await new Armazenamento(BANCO).iniciar()).carregar(); }
  async function abrirDia(s, polo = "Polo Fictício", operador = "Operador Teste") { if (s.sessao()) await reiniciar(s); await s._alterar((E) => { E.historico_atendimento = []; E.callbacks_manuais = []; E.fechamentos = []; }); await s.abrirSessao(polo, operador); } // cada teste começa sem histórico permanente
  async function reiniciar(s) { if (s.loteAberto()) await s.encerrarLote(); if (s.sessao()) await s.encerrarDia(); }
  async function importar(s, bytes, nome = "lote.csv") { const p = s.previa(bytes); await s.importar(nome, bytes, p.resumo.sha256); return s.chamadas(); }
  async function processarLote(s, bytes, callbacks, extra = 0) {
    const chs = await importar(s, bytes), pend = chs.filter((x) => x.estado === "pendente");
    for (const x of pend.slice(0, callbacks)) await s.registrar(x.id, "callback_realizado", "whatsapp");
    for (const x of pend.slice(callbacks, callbacks + extra)) await s.registrar(x.id, "sem_sucesso", "ligacao");
    return s.encerrarLote();
  }
  const S = await novoServico();

  await teste("Prévia identifica ids e erros sem gravar; CALL/Incidente/Pai separados", async () => {
    await abrirDia(S);
    const p = S.previa(gerarCSV()), r = p.resumo;
    igual([r.separador, r.colunas_reconhecidas, r.chamadas_validas, r.calls_repetidas_no_arquivo, r.linhas_com_erro], [";", 23, 7, 1, 1]);
    verdade(S.loteAberto() === null, "prévia gravou");
    const chs = await importar(S, gerarCSV()), c7 = chs.find((x) => x.call_id === "CALL 0000007");
    igual([c7.incidente, c7.incidente_pai, c7.uc, c7.custom_id_sdp, chs.length], ["INC 0000103", "INC 0000100", "FIC_UC_0000007", "FIC_SDP_7", 7]);
  });
  await teste("Importação do CSV ATUAL do ADMS (regressão do erro do executável)", async () => {
    await abrirDia(S);
    const p = S.previa(gerarCSV2026());
    igual([p.resumo.chamadas_validas, p.resumo.linhas_com_erro, p.resumo.linhas_antes_do_cabecalho], [7, 1, 2]);
    const chs = await importar(S, gerarCSV2026());
    igual(chs.length, 7); igual(chs.find((x) => x.call_id === "CALL 0000005").estado, "contato_invalido");
  });
  await teste("SHA-256: arquivo alterado depois da prévia é recusado", async () => {
    await abrirDia(S);
    const p = S.previa(loteCSV(2));
    await falhaCom(() => S.importar("a.csv", loteCSV(3), p.resumo.sha256), "mudou depois da prévia");
  });
  await teste("Arquivo ilegível informa erro", async () => { await abrirDia(S); await falhaCom(() => S.previa(Uint8Array.from([0, 1, 2])), "planilha"); });
  await teste("Estados iniciais: sem telefone e contato inválido", async () => {
    await abrirDia(S);
    const chs = await importar(S, loteCSV(5, 1, { semTelefone: [2], invalidos: [3] })), e = Object.fromEntries(chs.map((x) => [x.call_id, x.estado]));
    igual([e["CALL 0000002"], e["CALL 0000003"], Object.values(e).filter((x) => x === "pendente").length], ["sem_telefone", "contato_invalido", 3]);
  });
  await teste("Motivo e subtipo pelo texto; mensagem de condutor partido sem pedir foto", async () => {
    await abrirDia(S);
    const chs = await importar(S, gerarCSV([linha("CALL 0000001", "INC 0000001", "MOBILE: 79991000001", "", { submotivos: "RV; CONDUTOR PARTIDO" })]));
    igual([chs[0].tipo_ocorrencia, chs[0].subtipo], ["risco_de_vida", "condutor_partido"]);
    const d = S.detalhe(chs[0].id);
    verdade(d.modelo === "manual_condutor_partido" && !d.mensagem.toLowerCase().includes("foto") && d.mensagem.includes("Referência do atendimento: INC 0000001"));
  });
  await teste("Abrir WhatsApp Web não conta tentativa nem callback", async () => {
    await abrirDia(S);
    const ch = (await importar(S, loteCSV(1)))[0], num = ch.telefones[0].numero, r = await S.abrirWhatsapp(ch.id, num);
    verdade(r.url.startsWith(`https://web.whatsapp.com/send?phone=55${num}&text=`));
    const d = S.chamadas()[0]; igual([d.estado, d.tentativas.length, !!d.whatsapp_aberto_em], ["pendente", 0, true]);
    igual([S.estado().lote_em_andamento.callback_realizado, S.estado().lote_em_andamento.tentativas], [0, 0]);
  });
  await teste("WhatsApp só para celular; telefone do comentário exige confirmação", async () => {
    await abrirDia(S);
    const [fixo, coment] = await importar(S, gerarCSV([linha("CALL 0000001", "INC 1", "MOBILE: 79 3200-0003"), linha("CALL 0000002", "INC 2", "", "Cliente pede retorno no tel 79 99100-0004")]));
    await falhaCom(() => S.abrirWhatsapp(fixo.id, fixo.telefones[0].numero), "só para celular");
    await falhaCom(() => S.abrirWhatsapp(coment.id, coment.telefones[0].numero), "comentário");
    await S.abrirWhatsapp(coment.id, coment.telefones[0].numero, null, true);
  });
  await teste("Callback único, tentativas, meio obrigatório e reabertura com justificativa", async () => {
    await abrirDia(S);
    const ch = (await importar(S, loteCSV(1)))[0];
    igual((await S.registrar(ch.id, "sem_sucesso", "ligacao")).tentativas.length, 1);
    igual(S.chamadas()[0].estado, "pendente");
    const r = await S.registrar(ch.id, "callback_realizado", "whatsapp"); igual([r.estado, r.tentativas.length, r.meio_callback], ["callback_realizado", 2, "whatsapp"]);
    await falhaCom(() => S.registrar(ch.id, "callback_realizado", "whatsapp"), "já registrado");
    await falhaCom(() => S.registrar(ch.id, "reabrir", null), "Explique");
    igual((await S.registrar(ch.id, "reabrir", null, "Registro feito na chamada errada")).estado, "pendente");
    await falhaCom(() => S.registrar(ch.id, "callback_realizado", "xyz"), "Informe o meio");
    await falhaCom(() => S.registrar(ch.id, "callback_realizado", null), "Informe o meio");
  });
  await teste("Contato inválido registrado pelo operador", async () => {
    await abrirDia(S);
    const ch = (await importar(S, loteCSV(1)))[0];
    igual((await S.registrar(ch.id, "contato_invalido", "ligacao")).estado, "contato_invalido");
  });
  await teste("Três lotes acumulam (exemplo da especificação: 120/95/25/3)", async () => {
    await abrirDia(S);
    await processarLote(S, loteCSV(40, 1), 30); await processarLote(S, loteCSV(35, 1001), 28);
    const m = (await processarLote(S, loteCSV(45, 2001), 37)).metricas_dia;
    igual([m.chamadas_processadas, m.callbacks_realizados, m.pendencias_contabilizadas, m.lotes], [120, 95, 25, 3]);
  });
  await teste("Encerrar lote apaga dados pessoais e preserva métricas (10/5/1/1/3/7)", async () => {
    await abrirDia(S);
    await processarLote(S, loteCSV(10, 1, { semTelefone: [1], invalidos: [2] }), 5, 2);
    const m = S.metricasDia();
    igual([m.chamadas_processadas, m.callbacks_realizados, m.sem_telefone, m.contatos_invalidos, m.pendencias_contabilizadas, m.tentativas], [10, 5, 1, 1, 3, 7]);
    const bruto = JSON.stringify(await S.arm.ler());
    verdade(!bruto.includes("Cliente Fict") && !bruto.includes("CALL 0000001") && !bruto.includes("Rua Exemplo") && !bruto.includes("79 98"), "dado pessoal no armazenamento");
  });
  await teste("Um lote aberto por vez; encerrar duas vezes é recusado", async () => {
    await abrirDia(S);
    await importar(S, loteCSV(2));
    await falhaCom(() => S.importar("b.csv", loteCSV(2, 10), S.previa(loteCSV(2, 10)).resumo.sha256), "Encerre");
    await S.encerrarLote(); await falhaCom(() => S.encerrarLote(), "Não há lote aberto");
    igual(S.metricasDia().chamadas_processadas, 2);
  });
  await teste("Reimportação: CALL repetida entre lotes conta uma vez, melhor resultado preservado (4/2/2/2/4)", async () => {
    await abrirDia(S);
    await processarLote(S, loteCSV(4, 1), 1);
    igual(S.previa(loteCSV(4, 1)).resumo.calls_ja_vistas_hoje, 4);
    igual(S.previa(loteCSV(4, 1)).resumo.arquivo_ja_importado_hoje, true);
    const chs = await importar(S, loteCSV(4, 1)), um = chs.find((x) => x.call_id === "CALL 0000001");
    igual([um.estado, um.ja_vista_no_dia], ["callback_realizado", true]);
    await S.registrar(chs.find((x) => x.call_id === "CALL 0000002").id, "callback_realizado", "ligacao");
    // pior resultado depois do melhor não rebaixa: CALL 1 reaberta neste lote fica pendente aqui, mas o dia mantém o callback
    await S.registrar(um.id, "reabrir", null, "teste de precedência");
    const m = (await S.encerrarLote()).metricas_dia;
    igual([m.chamadas_processadas, m.callbacks_realizados, m.pendencias_contabilizadas, m.lotes, m.chamadas_em_mais_de_um_lote], [4, 2, 2, 2, 4]);
  });
  await teste("Lote aberto fica fora do total do dia", async () => {
    await abrirDia(S);
    await processarLote(S, loteCSV(5), 2);
    const chs = await importar(S, loteCSV(3, 100)); await S.registrar(chs[0].id, "callback_realizado", "ligacao");
    const e = S.estado();
    igual([e.metricas_dia.chamadas_processadas, e.metricas_dia.callbacks_realizados, e.lote_em_andamento.chamadas, e.lote_em_andamento.pendente], [5, 2, 3, 2]);
  });
  await teste("Persistência após fechar e reabrir a Central", async () => {
    await abrirDia(S);
    await processarLote(S, loteCSV(6), 4);
    const chs = await importar(S, loteCSV(2, 50)); await S.registrar(chs[0].id, "callback_realizado", "ligacao");
    const outro = await novoServico(), e = outro.estado();
    verdade(e.sessao && e.lote_aberto, "sessão/lote perdidos"); igual(e.metricas_dia.callbacks_realizados, 4);
    igual(outro.chamadas().filter((x) => x.estado === "callback_realizado").length, 1);
    outro.arm.fechar(); await S.carregar();
  });
  await teste("Duas abas: gravação concorrente é recusada sem sobrescrever", async () => {
    await abrirDia(S);
    const outra = await novoServico();
    await outra.salvarConfiguracao({ estacao: "ESTACAO-B" });
    await falhaCom(() => S.salvarConfiguracao({ estacao: "ESTACAO-A" }), "outra aba");
    igual(S.configuracao().estacao, "ESTACAO-B"); // recarregou a versão gravada pela outra aba
    await S.salvarConfiguracao({ estacao: "" }); outra.arm.fechar();
  });
  await teste("1.1.0 Exportação do dia: colunas, valores, versões, sem dados pessoais, proteção de fórmula", async () => {
    await abrirDia(S, "Aracaju", "=CMD|calc");
    const dem = []; for (let i = 1; i <= 40; i++) dem.push(linha(`CALL ${9000000 + i}`, `INC ${8000000 + i}`, `TELEPHONE: (79) 9${9100 + i}-${1000 + i}`, "Sem energia desde 07:30"));
    const chs = await importar(S, gerarCSV(dem));
    for (const c of chs.slice(0, 10)) await S.registrar(c.id, "callback_realizado", "whatsapp");
    await S.registrarResultado(chs[0].id, "servico_executado"); await S.registrarResultado(chs[0].id, "resolvida");
    await S.registrarResultado(chs[1].id, "resolvida");
    await S.registrar(chs[20].id, "sem_sucesso", "ligacao"); await S.registrar(chs[20].id, "sem_sucesso", "whatsapp");
    await S.registrar(chs[21].id, "contato_invalido", "ligacao");
    await S.encerrarLote();
    const e1 = await S.exportar(), e2 = await S.exportar();
    verdade(e1.id !== e2.id && e1.versao === 1 && e2.versao === 2 && e2.substitui_id === e1.id);
    igual([e1.nome, e2.nome], ["CALLBACK_ARACAJU_" + S.sessao().data_operacional.split("-").reverse().join("-") + ".csv", e1.nome]);
    const linhas = S.exportacao(e2.id).conteudo.replace(/^﻿/, "").trimEnd().split("\r\n").map((l) => l.split(";"));
    igual(linhas[0], N.COLUNAS_DIA); igual(linhas.length, 2, "uma linha por turno");
    const r = Object.fromEntries(linhas[1].map((v, i) => [linhas[0][i], v]));
    igual([r.polo, r.total_chamadas, r.callbacks_realizados, r.tentativas, r.tentativas_sem_sucesso, r.contatos_invalidos, r.servicos_executados,
      r.ocorrencias_resolvidas, r.pendencias, r.lotes_encerrados, r.versao, r.definitiva], ["Aracaju", "40", "10", "13", "2", "1", "1", "2", "29", "1", "2", "nao"]);
    verdade(r.operador.startsWith("'"), "fórmula não neutralizada");
    igual(r.id_turno, S.sessao().id);
    const bruto = S.exportacao(e2.id).conteudo.replace(/\b[0-9a-f]{32}\b/g, "<id>");
    for (const p of ["Cliente Fictício", "Rua Exemplo", "FIC_UC_", "CALL 9", "INC 8", "99", "Sem energia desde"]) verdade(!bruto.includes(p), "proibido: " + p);
  });
  await teste("Encerrar o dia exige lote fechado, gera definitiva e apaga as marcas da CALL", async () => {
    await abrirDia(S);
    await importar(S, loteCSV(3));
    await falhaCom(() => S.encerrarDia(), "Encerre e limpe o lote");
    await S.encerrarLote();
    const r = await S.encerrarDia();
    verdade(r.exportacao.definitiva && r.metricas.chamadas_processadas === 3);
    const E = await S.arm.ler(); igual([Object.keys(E.marcas).length, E.sessao, E.lotes.length, E.chamadas.length], [0, null, 0, 0]);
    await falhaCom(() => S.importar("x.csv", loteCSV(1), null), "Abra o dia");
  });
  await teste("Consolidação Power BI: por id_turno, só a maior versão (sem dupla contagem)", async () => {
    await abrirDia(S);
    await processarLote(S, loteCSV(4), 1); await S.exportar();
    await processarLote(S, loteCSV(4, 10), 2); const fim = await S.encerrarDia();
    const todas = S.E.exportacoes.filter((x) => x.sessao_id === fim.exportacao.sessao_id);
    const maior = Math.max(...todas.map((x) => x.versao)), vale = todas.find((x) => x.versao === maior);
    const l = vale.conteudo.trimEnd().split("\r\n"), cab = l[0].replace(/^﻿/, "").split(";"), val = l[1].split(";");
    igual([todas.length, val[cab.indexOf("callbacks_realizados")], val[cab.indexOf("definitiva")], vale.definitiva], [2, "3", "sim", true]);
  });

  await teste("1.0.2 Serviço: importação grava o agrupamento; callbacks e métricas continuam por CALL", async () => {
    await abrirDia(S);
    const p = S.previa(gerarCSV(contingencia()));
    igual([p.resumo.agrupamento.linhas_na_tabela, p.resumo.agrupamento.incidentes_com_multiplas_comunicacoes, p.resumo.agrupamento.comunicacoes_nesses_incidentes], [1, 1, 5]);
    const chs = await importar(S, gerarCSV(contingencia()));
    igual(chs.length, 5);
    igual(chs.filter((c) => c.grupo_principal).map((c) => c.call_id), ["CALL 0000014"]);
    verdade(chs.every((c) => c.grupo_chave === "INC:INC 9900001" && c.grupo_qtd === 5));
    const g = S.grupos(); igual([g.length, g[0].qtd], [1, 5]);
    const d = S.detalhe(chs.find((c) => c.call_id === "CALL 0000011").id);
    igual([d.grupo.qtd, d.grupo.membros[0].call_id, d.grupo.posicao], [5, "CALL 0000014", 5]);
    await S.registrar(chs.find((c) => c.call_id === "CALL 0000014").id, "callback_realizado", "ligacao");
    await S.registrar(chs.find((c) => c.call_id === "CALL 0000011").id, "callback_realizado", "whatsapp");
    const m = (await S.encerrarLote()).metricas_dia;
    igual([m.chamadas_processadas, m.callbacks_realizados, m.pendencias_contabilizadas], [5, 2, 3]);
  });
  await teste("1.0.2 Compatibilidade: lote gravado pela 1.0.1 (sem campos de agrupamento) abre e é agrupado", async () => {
    await abrirDia(S);
    await importar(S, gerarCSV(contingencia()));
    const E = await S.arm.ler();
    for (const c of E.chamadas) for (const k of ["grupo_chave", "grupo_principal", "grupo_qtd", "grupo_posicao", "risco_nivel"]) delete c[k];
    const bruto = await new Armazenamento(BANCO).iniciar(); bruto.revisao = E.revisao;
    await bruto.gravar(E); bruto.fechar();
    const novo = await novoServico();
    igual([novo.chamadas().length, novo.chamadas()[0].grupo_chave, novo.grupos().length, novo.grupos()[0].principal.call_id], [5, undefined, 1, "CALL 0000014"]);
    novo.arm.fechar(); await S.carregar(); await S.encerrarLote();
  });

  await teste("Ordenação no serviço: após importar e após registrar callback/tentativa a ordem continua cronológica", async () => {
    await abrirDia(S);
    const chs = await importar(S, gerarCSV(exemploOrdem()));
    const ordem = () => S.grupos().map((g) => g.incidente);
    const esperado = ["INC 9920004", "INC 9920002", "INC 9920003", "INC 9920005", "INC 9920001"];
    igual(ordem(), esperado);
    await S.registrar(chs.find((c) => c.call_id === "CALL 0000201").id, "callback_realizado", "ligacao");
    await S.registrar(chs.find((c) => c.call_id === "CALL 0000204").id, "sem_sucesso", "whatsapp");
    igual(ordem(), esperado, "registro não pode mudar a ordem");
    await S.encerrarLote();
  });
  await teste("Indicadores em tempo real: atualizam sem encerrar o lote e sem gravação extra", async () => {
    await abrirDia(S);
    const chs = await importar(S, loteCSV(4));
    let e = S.estado();
    igual([e.metricas_tempo_real.chamadas_processadas, e.metricas_tempo_real.callbacks_realizados, e.metricas_tempo_real.lotes_em_andamento, e.metricas_dia.chamadas_processadas], [4, 0, 1, 0]);
    await S.registrar(chs[0].id, "callback_realizado", "whatsapp");
    await S.registrar(chs[1].id, "sem_sucesso", "ligacao");
    await S.registrar(chs[2].id, "contato_invalido", "outro");
    const rev = S.arm.revisao;
    e = S.estado(); S.estado(); S.estado();
    igual(S.arm.revisao, rev, "ler indicadores não pode gravar");
    const t = e.metricas_tempo_real;
    igual([t.callbacks_realizados, t.tentativas, t.contatos_invalidos, t.pendencias_contabilizadas, t.lotes], [1, 3, 1, 2, 0]);
    igual(e.metricas_dia.callbacks_realizados, 0, "métrica oficial (exportação) continua só com lotes encerrados");
    const fim = await S.encerrarLote();
    igual(S.estado().metricas_tempo_real.callbacks_realizados, fim.metricas_dia.callbacks_realizados);
    igual(JSON.stringify({ ...S.estado().metricas_tempo_real, lotes_em_andamento: undefined, inclui_lote_aberto: undefined }), JSON.stringify({ ...S.metricasDia(), lotes_em_andamento: undefined, inclui_lote_aberto: undefined }));
  });
  await teste("Tempo real respeita CALL única no dia e melhor resultado (reimportação)", async () => {
    await abrirDia(S);
    await processarLote(S, loteCSV(3), 1);
    const chs = await importar(S, loteCSV(3));
    const t = S.estado().metricas_tempo_real;
    igual([t.chamadas_processadas, t.callbacks_realizados, t.chamadas_em_mais_de_um_lote], [3, 1, 3]);
    await S.encerrarLote();
  });
  await teste("Indicador de encerramento: conta cada lote uma vez e mostra o último", async () => {
    await abrirDia(S);
    await processarLote(S, loteCSV(2), 1);
    await processarLote(S, loteCSV(3, 10), 2);
    await importar(S, loteCSV(1, 20));
    const r = S.estado().resumo_lotes;
    igual([r.importados, r.encerrados, r.em_andamento, r.ultimo.numero, r.ultimo.chamadas, r.ultimo.callbacks], [3, 2, 1, 2, 3, 2]);
    await falhaCom(() => S.encerrarLote().then(() => S.encerrarLote()), "Não há lote aberto");
    igual(S.estado().resumo_lotes.encerrados, 3);
    igual(S.metricasDia().lotes, 3);
  });
  await teste("Detalhe pré-seleciona a mensagem sugerida (e o operador pode trocar)", async () => {
    await abrirDia(S);
    const chs = await importar(S, gerarCSV([linha("CALL 0000111", "INC 1", "MOBILE: 79991000111", "OBS: galho encostado na rede"),
      linha("CALL 0000112", "INC 2", "MOBILE: 79991000112", "OBS: sem energia"), linha("CALL 0000113", "INC 3", "MOBILE: 79991000113", "", { submotivos: "DF" })]));
    const d = (call, m) => S.detalhe(chs.find((c) => c.call_id === call).id, m);
    igual([d("CALL 0000111").modelo, d("CALL 0000112").modelo, d("CALL 0000113").modelo], ["manual_arvore_rede", "manual_falta_energia", "manual_atualizacao"]);
    verdade(d("CALL 0000111").sugestao_texto.includes("galho"));
    igual(d("CALL 0000111", "manual_oscilacao").modelo, "manual_oscilacao");
    verdade(chs.every((c) => c.sugestao && c.sugestao.codigo), "sugestão gravada na importação (auditoria)");
    const r = await S.abrirWhatsapp(chs[0].id, "79991000111");
    verdade(decodeURIComponent(r.url.split("text=")[1]).includes("árvore na rede elétrica"), "WhatsApp com a mensagem sugerida");
    await S.encerrarLote();
  });

  /* ==================================================== 1.1.0 */
  await teste("1.1.0 Telefone manual: normaliza DDD/+55/0 e aceita só celular válido", () => {
    const ok = (t) => N.validarTelefoneManual(t);
    for (const t of ["79 99999-1234", "(79) 99999-1234", "+55 (79) 99999-1234", "5579999991234", "079999991234", " 79-9-9999-1234 "])
      igual([ok(t).ok, ok(t).numero], [true, "79999991234"], "deveria aceitar " + t);
    igual(ok("79 99999-1234").exibir, "(79) 99999-1234");
    verdade(!ok("79 3211-4567").ok && ok("79 3211-4567").fixo && ok("79 3211-4567").erro.includes("FIXO"), "fixo deveria ser recusado");
    verdade(ok("99999-1234").erro.includes("DDD"), "sem DDD");
    verdade(ok("").erro.includes("Digite"), "vazio");
    for (const t of ["20 99999-1234", "79 9999-123456", "79 99999-999", "79 99999-9999", "79 89999-1234", "abc"]) verdade(!ok(t).ok, "deveria recusar " + t);
  });
  await teste("1.1.0 Texto editado: saudação aprovada garantida, sem duplicar; limite de tamanho", () => {
    igual(N.textoDoOperador("Bom dia, tudo certo?"), "Olá, aqui é a Energisa. Bom dia, tudo certo?");
    igual(N.textoDoOperador("Olá, aqui é a Energisa. Teste"), "Olá, aqui é a Energisa. Teste");
    igual(N.textoDoOperador("OLA! Aqui e a Energisa. Teste"), "OLA! Aqui e a Energisa. Teste");
    let erro = null; try { N.textoDoOperador("   "); } catch (e) { erro = e.message; } verdade(erro && erro.includes("vazio"));
    erro = null; try { N.textoDoOperador("x".repeat(1501)); } catch (e) { erro = e.message; } verdade(erro && erro.includes("1500"));
  });
  await teste("1.1.0 Localização resumida (bairro · cidade), igual à referência", () => {
    igual(N.resumirLocalizacao("RUA X_20_LT 3_JATOBA; 10_BARRA DOS COQUEIROS"), "JATOBA · BARRA DOS COQUEIROS");
    igual(N.resumirLocalizacao("Rua Exemplo, 1; Bairro Modelo; Cidade Alfa"), "Cidade Alfa");
    igual(N.resumirLocalizacao("ARACAJU_ARACAJU; 1_ARACAJU"), "ARACAJU");
    igual(N.resumirLocalizacao(""), "");
  });
  await teste("1.1.0 Nome automático do arquivo do dia", () => {
    igual(N.nomeArquivoDia({ data_operacional: "2026-11-04", polo: "Aracaju" }), "CALLBACK_ARACAJU_04-11-2026.csv");
    igual(N.nomeArquivoDia({ data_operacional: "2026-11-04", polo: "Nossa Senhora do Socorro" }), "CALLBACK_NOSSA-SENHORA-DO-SOCORRO_04-11-2026.csv");
    igual(N.nomeArquivoDia({ data_operacional: "2026-11-04", polo: "São Cristóvão / Itabaiana" }), "CALLBACK_SAO-CRISTOVAO-ITABAIANA_04-11-2026.csv");
    igual(N.nomeArquivoDia({ data_operacional: "2026-11-04", polo: "" }), "CALLBACK_SEM-POLO_04-11-2026.csv");
    igual(N.nomeArquivoDia({ data_operacional: "2026-11-04", polo: "Aracaju" }, 2), "CALLBACK_ARACAJU_04-11-2026_T2.csv");
  });
  await teste("1.1.0 Turno: só a sigla; polo vem da Configuração (pedido só na 1ª vez)", async () => {
    await reiniciar(S);
    const poloAntes = S.configuracao().polo;
    await S.salvarConfiguracao({ polo: "" });
    await falhaCom(() => S.abrirSessao("", "OPT4"), "polo");
    await falhaCom(() => S.abrirSessao("Aracaju", "  "), "sigla");
    await S.abrirSessao("Aracaju", "OPT4");
    igual([S.sessao().polo, S.sessao().operador, S.configuracao().polo], ["Aracaju", "OPT4", "Aracaju"]);
    await reiniciar(S);
    await S.abrirSessao("", "OPT5");
    igual([S.sessao().polo, S.estado().nome_arquivo_dia.startsWith("CALLBACK_ARACAJU_") && /_T\d+\.csv$/.test(S.estado().nome_arquivo_dia)], ["Aracaju", true]);
    await reiniciar(S); await S.salvarConfiguracao({ polo: poloAntes });
  });
  await teste("1.1.0 Serviço executado e ocorrência resolvida: só após callback, uma vez, independentes; reabrir apaga", async () => {
    await abrirDia(S);
    const [a, b] = await importar(S, loteCSV(2));
    await falhaCom(() => S.registrarResultado(a.id, "resolvida"), "antes de marcar");
    await falhaCom(() => S.registrarResultado(a.id, "servico_executado"), "antes de marcar");
    await falhaCom(() => S.registrarResultado(a.id, "outra_coisa"), "desconhecido");
    await S.registrar(a.id, "callback_realizado", "whatsapp");
    const r1 = await S.registrarResultado(a.id, "resolvida");
    igual([r1.estado, !!r1.resolvida_em, r1.servico_executado_em, r1.tentativas.length], ["callback_realizado", true, null, 1], "resolvida não marca serviço nem tentativa");
    await falhaCom(() => S.registrarResultado(a.id, "resolvida"), "já foi registrado");
    await S.registrarResultado(a.id, "servico_executado");
    await S.registrar(b.id, "callback_realizado", "ligacao"); await S.registrarResultado(b.id, "servico_executado");
    let t = S.estado().metricas_tempo_real;
    igual([t.callbacks_realizados, t.servicos_executados, t.ocorrencias_resolvidas, t.callbacks_sem_resolucao, t.taxa_resolucao], [2, 2, 1, 1, 50]);
    const lote = S.estado().lote_em_andamento; igual([lote.servico_executado, lote.resolvida], [2, 1]);
    const ra = await S.registrar(a.id, "reabrir", null, "registro errado");
    igual([ra.estado, ra.servico_executado_em, ra.resolvida_em], ["pendente", null, null]);
    t = S.estado().metricas_tempo_real;
    igual([t.callbacks_realizados, t.servicos_executados, t.ocorrencias_resolvidas], [1, 1, 0]);
    await S.encerrarLote();
  });
  await teste("1.1.0 Indicadores sem dupla contagem: CALL em 2 lotes conta 1 vez; resolução vale do lote anterior", async () => {
    await abrirDia(S);
    let chs = await importar(S, loteCSV(3));
    await S.registrar(chs[0].id, "callback_realizado", "whatsapp"); await S.registrarResultado(chs[0].id, "resolvida");
    await S.registrarResultado(chs[0].id, "servico_executado");
    await S.registrar(chs[1].id, "sem_sucesso", "ligacao");
    await S.encerrarLote();
    chs = await importar(S, loteCSV(3)); // mesmas CALLs de novo
    igual(chs[0].estado, "callback_realizado");
    await S.registrar(chs[1].id, "sem_sucesso", "whatsapp"); await S.registrar(chs[1].id, "callback_realizado", "whatsapp");
    const vivo = S.estado().metricas_tempo_real;
    const m = (await S.encerrarLote()).metricas_dia;
    igual([m.chamadas_processadas, m.callbacks_realizados, m.ocorrencias_resolvidas, m.servicos_executados, m.tentativas_sem_sucesso, m.pendencias_contabilizadas, m.incidentes_unicos],
      [3, 2, 1, 1, 2, 1, 3]);
    igual([vivo.chamadas_processadas, vivo.callbacks_realizados, vivo.ocorrencias_resolvidas, vivo.tentativas_sem_sucesso], [3, 2, 1, 2], "tempo real = encerramento");
  });
  await teste("1.1.0 Envio manual: valida, abre o WhatsApp com a mensagem, não conta tentativa/callback e não grava o número", async () => {
    await abrirDia(S);
    const [c] = await importar(S, loteCSV(1, 1, { semTelefone: [1] }));
    igual(c.estado, "sem_telefone");
    await falhaCom(() => S.abrirWhatsappManual(c.id, "79 3211-4567"), "FIXO");
    await falhaCom(() => S.abrirWhatsappManual(c.id, "12345"), "inválido");
    await falhaCom(() => S.abrirWhatsappManual(c.id, "99988-7766"), "DDD");
    const r = await S.abrirWhatsappManual(c.id, "(79) 98877-6655", "manual_oscilacao");
    verdade(r.url.startsWith("https://web.whatsapp.com/send?phone=5579988776655&text="), r.url);
    verdade(decodeURIComponent(r.url.split("text=")[1]).startsWith("Olá, aqui é a Energisa. Estamos verificando sua ocorrência de oscilação"), "mensagem escolhida");
    const r2 = await S.abrirWhatsappManual(c.id, "79988776655", null, "Texto que o operador editou");
    igual(decodeURIComponent(r2.url.split("text=")[1]), "Olá, aqui é a Energisa. Texto que o operador editou");
    const d = S.chamadas()[0];
    igual([d.estado, d.tentativas.length, !!d.whatsapp_aberto_em, d.whatsapp_manual], ["sem_telefone", 0, true, true]);
    igual([S.estado().lote_em_andamento.tentativas, S.estado().metricas_tempo_real.callbacks_realizados], [0, 0]);
    verdade(!JSON.stringify(await S.arm.ler()).includes("88776655"), "o número digitado não pode ser gravado");
    await S.registrar(c.id, "callback_realizado", "whatsapp");
    await falhaCom(() => S.abrirWhatsappManual(c.id, "79988776655"), "já registrado");
    await S.encerrarLote();
  });
  await teste("1.1.0 WhatsApp do ADMS usa o texto editado pelo operador", async () => {
    await abrirDia(S);
    const [c] = await importar(S, loteCSV(1));
    const r = await S.abrirWhatsapp(c.id, c.telefones[0].numero, null, false, "Pode confirmar o endereço?");
    igual(decodeURIComponent(r.url.split("text=")[1]), "Olá, aqui é a Energisa. Pode confirmar o endereço?");
    await S.encerrarLote();
  });
  await teste("1.1.0 Painel: por dia, operador e polo; cada turno uma vez; turno antigo sem o indicador = null", async () => {
    await reiniciar(S);
    await S.abrirSessao("Aracaju", "OPT4"); await processarLote(S, loteCSV(4), 2, 1); await S.encerrarDia();
    await S.abrirSessao("Aracaju", "TSB1"); await processarLote(S, loteCSV(3, 50), 1);
    const P = S.painel();
    const hoje = P.por_dia.find((g) => g.chave === S.sessao().data_operacional);
    verdade(hoje.turnos >= 2 && hoje.chamadas_processadas >= 7);
    const ops = Object.fromEntries(P.por_operador.map((g) => [g.chave, g]));
    igual([ops.TSB1.turnos, ops.TSB1.chamadas_processadas, ops.TSB1.callbacks_realizados, ops.TSB1.tentativas_sem_sucesso], [1, 3, 1, 0]);
    verdade(ops.OPT4.callbacks_realizados >= 2 && ops.OPT4.tentativas_sem_sucesso >= 1);
    verdade(P.por_polo.some((g) => g.chave === "Aracaju" && g.turnos >= 2));
    // turno gravado pela versão anterior (sem os indicadores novos): nada de zero inventado
    await S._alterar((E) => { E.dias_encerrados.push({ id: "antigo", data_operacional: "2026-10-01", polo: "Polo Velho", operador: "OPV",
      metricas_finais: { chamadas_processadas: 5, callbacks_realizados: 2, pendencias_contabilizadas: 3, sem_telefone: 0, contatos_invalidos: 0, tentativas: 2 } }); });
    const velho = S.painel().por_polo.find((g) => g.chave === "Polo Velho"), t = S.painel().turnos.find((x) => x.id === "antigo");
    igual([velho.incompleto, t.servicos_executados, t.ocorrencias_resolvidas, t.callbacks_realizados], [true, null, null, 2]);
    await reiniciar(S);
  });

  await teste("1.1.0 Desfazer resolução/serviço: só se registrado; mantém callback e o outro registro; sem dupla contagem", async () => {
    await abrirDia(S);
    const [a] = await importar(S, loteCSV(1));
    await falhaCom(() => S.desfazerResultado(a.id, "resolvida"), "não está registrado");
    await S.registrar(a.id, "callback_realizado", "whatsapp");
    await S.registrarResultado(a.id, "resolvida"); await S.registrarResultado(a.id, "servico_executado");
    await falhaCom(() => S.registrarResultado(a.id, "resolvida"), "já foi registrado");
    igual(S.estado().metricas_tempo_real.ocorrencias_resolvidas, 1, "registro duplicado não pode contar duas vezes");
    const r = await S.desfazerResultado(a.id, "resolvida");
    igual([r.estado, r.resolvida_em, !!r.servico_executado_em, r.tentativas.length], ["callback_realizado", null, true, 1]);
    let t = S.estado().metricas_tempo_real; igual([t.callbacks_realizados, t.ocorrencias_resolvidas, t.servicos_executados], [1, 0, 1]);
    await falhaCom(() => S.desfazerResultado(a.id, "resolvida"), "não está registrado");
    await falhaCom(() => S.desfazerResultado(a.id, "outra"), "desconhecido");
    await S.registrarResultado(a.id, "resolvida"); // pode registrar de novo depois de desfazer
    t = (await S.encerrarLote()).metricas_dia; igual([t.ocorrencias_resolvidas, t.servicos_executados], [1, 1]);
  });
  await teste("1.1.0 Cópia de contingência não conta como salvo no destino", async () => {
    await abrirDia(S);
    const e = await S.exportar();
    await S.marcarContingencia(e.id);
    const x = S.exportacao(e.id); igual([x.salvo, !!x.contingencia], [null, true]);
  });

  /* ---------------------------------------------------- Central de Disparos (conector falso: nada sai do navegador) */
  const PRONTO = { pronto: true, modo: "producao" };
  const semEspera = { intervalo: 0, esperar: async () => {} };
  function conectorFalso(regra) {
    const c = { envios: [], chaves: new Set(), enviar: async (e) => { c.envios.push(e);
      const r = regra ? regra(e, c.envios.length) : null; if (r) return r;
      c.chaves.add(e.chave); return { resultado: "enviado", wamid: "wamid." + c.envios.length }; } };
    return c;
  }
  const linhasDisparo = () => [
    linha("CALL 0000201", "INC 0000300", "MOBILE: 79991000201", "Fio partido na rua", { submotivos: "RV" }),
    linha("CALL 0000202", "INC 0000301", "MOBILE: 79991000202"),
    linha("CALL 0000203", "INC 0000302", "MOBILE: 79991000203", "", { submotivos: "NT" }),
    linha("CALL 0000204", "INC 0000303", "", "Cliente pede retorno no tel 79 99100-0204"),
    linha("CALL 0000205", "INC 0000304", "MOBILE: 79 3200-0205"),
  ];
  async function loteDisparo() {
    await abrirDia(S);
    const b = gerarCSV(linhasDisparo()); await S.importar("d.csv", b, S.previa(b).resumo.sha256);
    return S.incidentesParaDisparo();
  }
  const chavesDe = (l, ...incs) => l.filter((x) => incs.includes(x.incidente)).map((x) => x.chave);
  const statusDe = (f, inc) => f.itens.find((i) => i.incidente === inc).status;
  const fechar = async () => { if (S.loteAberto()) { for (const f of S.E.disparos) if (["autorizada", "pausada"].includes(f.situacao)) { f.executor = null; await S.cancelarRestante(f.id); } await S.encerrarLote(); } };
  const modelosAntes = JSON.stringify(window.MODELOS_MENSAGEM);

  await teste("Disparos: prepara só os selecionados, cada um com a mensagem das regras existentes", async () => {
    const l = await loteDisparo();
    const f = await S.prepararDisparo(chavesDe(l, "INC 0000300", "INC 0000301"), "selecao");
    igual(f.itens.length, 2);
    for (const i of f.itens) {
      const c = S.obterChamada(i.chamada_id), sug = N.sugerirMensagem(c);
      igual(i.modelo, sug.codigo); igual(i.texto, S._textoMensagem(c, sug.codigo), "texto da regra existente"); igual(i.status, "preparado");
    }
    await S.descartarFila(f.id); await fechar();
  });
  await teste("Disparos: nada é enviado sem autorização explícita", async () => {
    const l = await loteDisparo(), f = await S.prepararDisparo(chavesDe(l, "INC 0000301"), "selecao"), c = conectorFalso();
    await falhaCom(() => S.processarFila(f.id, c, semEspera), "não está em condição");
    igual(c.envios.length, 0);
    await falhaCom(() => S.autorizarDisparo(f.id, { pronto: false, modo: "indisponivel" }), "não está disponível");
    igual(S.fila(f.id).situacao, "revisao");
    await S.descartarFila(f.id); await fechar();
  });
  await teste("Disparos: revisão identifica telefone inválido, confirmação e duplicada; só o enviável é autorizado", async () => {
    const l = await loteDisparo();
    let f = await S.prepararDisparo(l.map((x) => x.chave), "lote");
    igual(statusDe(f, "INC 0000304"), "aguardando", "fixo não pode ser enviado");
    igual(statusDe(f, "INC 0000303"), "aguardando", "telefone do comentário pede confirmação");
    const a = f.itens.find((i) => i.incidente === "INC 0000300"), b = f.itens.find((i) => i.incidente === "INC 0000301");
    await S.corrigirTelefoneItem(f.id, b.id, a.telefone);
    await S.editarMensagemItem(f.id, b.id, a.texto); f = S.fila(f.id);
    verdade(f.itens.find((i) => i.id === b.id).pendencias.some((p) => p.codigo === "duplicada"), "duplicada");
    igual(S.resumoRevisao(f).duplicadas, 1);
    await falhaCom(() => S.corrigirTelefoneItem(f.id, b.id, "7932000205"), "FIXO");
    const c = conectorFalso();
    f = await S.autorizarDisparo(f.id, PRONTO); await S.processarFila(f.id, c, semEspera); f = S.fila(f.id);
    igual(c.envios.length, 2, "só INC 300 e INC 302");
    igual([statusDe(f, "INC 0000300"), statusDe(f, "INC 0000301"), statusDe(f, "INC 0000304")], ["enviado", "cancelado", "cancelado"]);
    await fechar();
  });
  await teste("Disparos: editar o texto não altera o modelo original; restaurar volta ao texto do modelo", async () => {
    const l = await loteDisparo(); let f = await S.prepararDisparo(chavesDe(l, "INC 0000301"), "selecao"); const i = f.itens[0], orig = i.texto;
    await S.editarMensagemItem(f.id, i.id, "Texto alterado pelo operador."); f = S.fila(f.id);
    verdade(f.itens[0].editada && f.itens[0].texto.startsWith(N.SAUDACAO), "saudação garantida pela regra existente");
    igual(JSON.stringify(window.MODELOS_MENSAGEM), modelosAntes, "modelos intactos");
    await S.restaurarMensagemItem(f.id, i.id); igual([S.fila(f.id).itens[0].texto, S.fila(f.id).itens[0].editada], [orig, false]);
    await falhaCom(() => S.editarMensagemItem(f.id, i.id, "x".repeat(1600)), "passa de");
    await S.descartarFila(f.id); await fechar();
  });
  await teste("Disparos: após autorizar a fila não aceita edição e cada envio guarda o vínculo incidente/telefone/mensagem", async () => {
    const l = await loteDisparo(); let f = await S.prepararDisparo(chavesDe(l, "INC 0000300", "INC 0000301"), "selecao"); const c = conectorFalso();
    f = await S.autorizarDisparo(f.id, PRONTO);
    await falhaCom(() => S.editarMensagemItem(f.id, f.itens[0].id, "outro"), "já foi autorizada");
    await S.processarFila(f.id, c, semEspera); f = S.fila(f.id);
    for (const i of f.itens) { const e = c.envios.find((x) => x.chave === i.chave); igual([e.telefone, e.texto, e.incidente], [i.telefone, i.texto, i.incidente]);
      igual([i.tentativas.length, i.tentativas[0].resultado, !!i.tentativas[0].inicio, !!i.tentativas[0].fim], [1, "enviado", true, true]); }
    igual(S.painelDisparo(f).percentual, 100); igual(f.situacao, "concluida");
    await fechar();
  });
  await teste("Disparos: incidente já enviado não pode ser preparado de novo no lote", async () => {
    const l = await loteDisparo(); let f = await S.prepararDisparo(chavesDe(l, "INC 0000301"), "selecao");
    await S.autorizarDisparo(f.id, PRONTO); await S.processarFila(f.id, conectorFalso(), semEspera);
    igual(S.incidentesParaDisparo().find((x) => x.incidente === "INC 0000301").elegivel, false);
    await falhaCom(() => S.prepararDisparo(chavesDe(l, "INC 0000301"), "selecao"), "Nenhum incidente");
    await fechar();
  });
  const enviarUm = async (l, inc, conector) => { let f = await S.prepararDisparo(chavesDe(l, inc), "selecao"); f = await S.autorizarDisparo(f.id, PRONTO); await S.processarFila(f.id, conector || conectorFalso(), semEspera); return S.fila(f.id); };
  await teste("Callback: mensagem enviada registra callback do operador, com data e hora, e soma no total dele", async () => {
    const l = await loteDisparo(), antes = S.painel().turnos[0].callbacks_realizados;
    const f = await enviarUm(l, "INC 0000301"), i = f.itens[0], c = S.obterChamada(i.chamada_id);
    igual([c.estado, c.meio_callback, c.callback_origem, c.callback_operador, c.tentativas.length], ["callback_realizado", "whatsapp", "disparo", "Operador Teste", 1]);
    verdade(!isNaN(new Date(c.callback_em)) && c.callback_em === c.tentativas[0].momento, "data e hora");
    igual([i.status, i.callback.situacao, i.callback.operador], ["enviado", "registrado", "Operador Teste"], "envio e resultado separados");
    const t = S.painel().turnos[0]; igual([t.operador, t.callbacks_realizados], ["Operador Teste", antes + 1]);
    const dia = (await S.encerrarLote()).metricas_dia; igual(dia.callbacks_realizados, 1, "entra no dia uma vez");
  });
  await teste("Callback: não conta preparada, pendente, falha, limite, sem conexão, incerta ou simulada", async () => {
    const l = await loteDisparo(), id = S.incidentesParaDisparo().find((x) => x.incidente === "INC 0000301").id;
    const pendente = () => igual([S.obterChamada(id).estado, S.obterChamada(id).tentativas.length, S.obterChamada(id).callback_operador || null], ["pendente", 0, null]);
    let f = await S.prepararDisparo(chavesDe(l, "INC 0000301"), "selecao"); pendente();
    f = await S.autorizarDisparo(f.id, PRONTO); pendente();
    for (const r of [{ resultado: "limite" }, { resultado: "sem_conexao" }]) { await S.processarFila(f.id, { enviar: async () => r }, semEspera); pendente(); }
    await S.processarFila(f.id, { enviar: async () => ({ resultado: "falha", codigo: 1 }) }, semEspera); pendente();
    await S.reprocessarFalhas(f.id); await S.processarFila(f.id, { enviar: async () => ({ resultado: "incerto" }) }, semEspera); pendente();
    await fechar();
    const l2 = await loteDisparo(); f = await S.prepararDisparo(chavesDe(l2, "INC 0000301"), "selecao");
    await S.autorizarDisparo(f.id, { pronto: true, modo: "simulacao" }); await S.processarFila(f.id, { enviar: async () => ({ resultado: "enviado", wamid: "sim", simulado: true }) }, semEspera);
    igual(S.obterChamada(S.fila(f.id).itens[0].chamada_id).estado, "pendente", "simulação");
    await fechar();
  });
  await teste("Callback: registrado manualmente depois da autorização não envia nem conta de novo", async () => {
    const l = await loteDisparo(); let f = await S.prepararDisparo(chavesDe(l, "INC 0000301"), "selecao"); f = await S.autorizarDisparo(f.id, PRONTO);
    const id = f.itens[0].chamada_id; await S.registrar(id, "callback_realizado", "ligacao");
    const c = conectorFalso(); await S.processarFila(f.id, c, semEspera); f = S.fila(f.id);
    igual([c.envios.length, f.itens[0].status, f.itens[0].callback.situacao, f.situacao], [0, "cancelado", "ja_registrado", "concluida"]);
    const ch = S.obterChamada(id); igual([ch.tentativas.length, ch.meio_callback, ch.callback_origem || null], [1, "ligacao", null], "registro manual preservado");
    igual(S.metricasTempoReal().callbacks_realizados, 1);
    await fechar();
  });
  await teste("Callback: registrado manualmente com a mensagem em trânsito não soma de novo", async () => {
    const l = await loteDisparo(); let f = await S.prepararDisparo(chavesDe(l, "INC 0000301"), "selecao"); f = await S.autorizarDisparo(f.id, PRONTO); const id = f.itens[0].chamada_id;
    await S.processarFila(f.id, { enviar: async () => { await S.registrar(id, "callback_realizado", "ligacao"); return { resultado: "enviado", wamid: "w1" }; } }, semEspera); f = S.fila(f.id);
    igual([f.itens[0].status, f.itens[0].callback.situacao], ["enviado", "ja_registrado"]);
    igual([S.obterChamada(id).tentativas.length, S.obterChamada(id).meio_callback], [1, "ligacao"]); igual(S.metricasTempoReal().callbacks_realizados, 1);
    await fechar();
  });
  await teste("Callback: depois do disparo o registro manual é recusado e 'Reabrir' corrige sem mudar o status de envio", async () => {
    const l = await loteDisparo(), f = await enviarUm(l, "INC 0000301"), id = f.itens[0].chamada_id;
    await falhaCom(() => S.registrar(id, "callback_realizado", "ligacao"), "já registrado");
    igual(S.obterChamada(id).tentativas.length, 1);
    await S.registrar(id, "reabrir", null, "correção de teste"); const c = S.obterChamada(id);
    igual([c.estado, c.callback_operador, c.callback_em, c.callback_origem, S.fila(f.id).itens[0].status], ["pendente", null, null, null, "enviado"]);
    igual(S.incidentesParaDisparo().find((x) => x.id === id).elegivel, false, "continua sem poder reenviar a mesma mensagem");
    await fechar();
  });
  await teste("Callback: reconsulta depois de queda da aba conta uma única vez", async () => {
    const l = await loteDisparo(); let f = await S.prepararDisparo(chavesDe(l, "INC 0000301"), "selecao"); f = await S.autorizarDisparo(f.id, PRONTO); const id = f.itens[0].chamada_id;
    await S._alterar((E) => { const x = E.disparos.find((d) => d.id === f.id); x.itens[0].status = "enviando"; x.itens[0].tentativas.push({ n: 1, inicio: new Date().toISOString(), fim: null }); x.executor = { id: "morta", expira: new Date(Date.now() - 1000).toISOString() }; });
    await S.processarFila(f.id, { enviar: async () => ({ resultado: "enviado", wamid: "w", reaproveitado: true }) }, semEspera);
    igual([S.obterChamada(id).estado, S.obterChamada(id).tentativas.length, S.metricasTempoReal().callbacks_realizados], ["callback_realizado", 1, 1]);
    await fechar();
  });
  await teste("Contatos: selecionar o incidente envia só ao contato principal; os demais ficam pendentes e livres no painel", async () => {
    await abrirDia(S);
    const b = gerarCSV([linha("CALL 0000301", "INC 0000400", "MOBILE: 79991000301", "", { horario: "10/03/2026 09:00:00" }), linha("CALL 0000302", "INC 0000400", "MOBILE: 79991000302", "", { horario: "10/03/2026 08:00:00" })]);
    await S.importar("c.csv", b, S.previa(b).resumo.sha256);
    const l = S.incidentesParaDisparo(); igual(l.length, 1); const c = conectorFalso();
    const f = await enviarUm(l, "INC 0000400", c); igual([f.itens.length, c.envios.length, c.envios[0].telefone], [1, 1, "79991000301"]);
    const principal = S.obterChamada(f.itens[0].chamada_id), outra = S.chamadas().find((x) => x.id !== principal.id);
    igual([principal.estado, outra.estado, outra.tentativas.length], ["callback_realizado", "pendente", 0]);
    const r = await S.abrirWhatsapp(outra.id, "79991000302", null, false, null); verdade(r.url.includes("phone=5579991000302"), "envio individual ao outro contato");
    igual(S.obterChamada(outra.id).estado, "pendente", "abrir o WhatsApp continua sem contar callback"); igual(c.envios.length, 1);
    await fechar();
  });
  await teste("Contatos: após o disparo, outro número do mesmo contato segue disponível; callback manual continua bloqueando", async () => {
    await abrirDia(S);
    const b = gerarCSV([linha("CALL 0000311", "INC 0000410", "MOBILE: 79991000311; TELEPHONE: 79991000312")]);
    await S.importar("c.csv", b, S.previa(b).resumo.sha256);
    const l = S.incidentesParaDisparo(), id = (await enviarUm(l, "INC 0000410")).itens[0].chamada_id;
    verdade((await S.abrirWhatsapp(id, "79991000312", null, false, null)).url.includes("5579991000312"), "outro número");
    verdade((await S.abrirWhatsappManual(id, "79991000399", null, null)).url.includes("5579991000399"), "envio manual a outro número");
    await falhaCom(() => S.abrirWhatsapp(id, "79991000311", null, false, null), "Callback já registrado");
    await falhaCom(() => S.abrirWhatsappManual(id, "(79) 99100-0311", null, null), "Callback já registrado");
    igual(S.metricasTempoReal().callbacks_realizados, 1);
    await S.registrar(id, "reabrir", null, "teste"); await S.registrar(id, "callback_realizado", "ligacao");
    await falhaCom(() => S.abrirWhatsapp(id, "79991000312", null, false, null), "Callback já registrado");
    await fechar();
  });
  await teste("Disparos: falha definitiva segue a fila; reprocessar usa a mesma chave", async () => {
    const l = await loteDisparo(); let f = await S.prepararDisparo(chavesDe(l, "INC 0000300", "INC 0000301"), "selecao");
    let n = 0; const c = conectorFalso(() => (++n === 1 ? { resultado: "falha", codigo: 131026, detalhe: "recusado" } : null));
    f = await S.autorizarDisparo(f.id, PRONTO); await S.processarFila(f.id, c, semEspera); f = S.fila(f.id);
    igual([f.situacao, S.painelDisparo(f).total_falha, S.painelDisparo(f).total_enviado], ["concluida", 1, 1]);
    const chave = f.itens.find((i) => i.status === "falha").chave;
    await S.reprocessarFalhas(f.id); await S.processarFila(f.id, c, semEspera); f = S.fila(f.id);
    igual(c.envios.filter((e) => e.chave === chave).length, 2, "mesma chave");
    igual(S.painelDisparo(f).total_enviado, 2); verdade(f.eventos.some((e) => e.tipo === "reprocessamento_autorizado"));
    await fechar();
  });
  await teste("Disparos: sem conexão a fila pausa, nada se perde, e ao retomar o item segue com a mesma chave", async () => {
    const l = await loteDisparo(); let f = await S.prepararDisparo(chavesDe(l, "INC 0000300", "INC 0000301"), "selecao");
    const fora = { enviar: async () => { throw new TypeError("Failed to fetch"); } };
    f = await S.autorizarDisparo(f.id, PRONTO); await S.processarFila(f.id, fora, semEspera); f = S.fila(f.id);
    igual([f.situacao, f.itens.map((i) => i.status).sort().join()], ["pausada", "preparado,preparado"]);
    igual(f.executor, null, "libera a posse");
    const chaves = f.itens.map((i) => i.chave), c = conectorFalso();
    await S.processarFila(f.id, c, semEspera); f = S.fila(f.id);
    igual([f.situacao, c.envios.length], ["concluida", 2]); igual(c.envios.map((e) => e.chave).sort(), chaves.slice().sort());
    igual(f.itens.map((i) => i.tentativas.length).sort(), [1, 2], "a fila pausou na 1ª falha: cada tentativa fica registrada");
    await fechar();
  });
  await teste("Disparos: limite da API pausa a fila; pausar e cancelar param o que falta", async () => {
    const l = await loteDisparo(); let f = await S.prepararDisparo(chavesDe(l, "INC 0000300", "INC 0000301", "INC 0000302"), "selecao");
    const lim = conectorFalso((e, n) => (n === 2 ? { resultado: "limite", codigo: 130429, detalhe: "limite" } : null));
    f = await S.autorizarDisparo(f.id, PRONTO); await S.processarFila(f.id, lim, semEspera); f = S.fila(f.id);
    igual([f.situacao, S.painelDisparo(f).total_enviado, S.painelDisparo(f).total_pendente], ["pausada", 1, 2]);
    await S.processarFila(f.id, conectorFalso(async () => null) && { enviar: async () => { await S.pausarFila(f.id); return { resultado: "enviado", wamid: "w" }; } }, semEspera); f = S.fila(f.id);
    igual([f.situacao, S.painelDisparo(f).total_enviado], ["pausada", 2], "pausa após a mensagem em trânsito");
    const antes = S.painelDisparo(f).total_enviado;
    await S.cancelarRestante(f.id); f = S.fila(f.id);
    igual([f.situacao, S.painelDisparo(f).total_enviado, S.painelDisparo(f).total_cancelado], ["cancelada", antes, 1]);
    await fechar();
  });
  await teste("Disparos: queda da aba durante o envio não reenvia por conta própria e retoma com a mesma chave", async () => {
    const l = await loteDisparo(); let f = await S.prepararDisparo(chavesDe(l, "INC 0000301"), "selecao");
    f = await S.autorizarDisparo(f.id, PRONTO);
    const chave = f.itens[0].chave;
    await S._alterar((E) => { const x = E.disparos.find((d) => d.id === f.id); x.itens[0].status = "enviando"; x.itens[0].tentativas.push({ n: 1, inicio: new Date().toISOString(), fim: null }); x.executor = { id: "aba-morta", expira: new Date(Date.now() + 60000).toISOString() }; });
    await falhaCom(() => S.processarFila(f.id, conectorFalso(), semEspera), "envio em curso");
    await S._alterar((E) => { E.disparos.find((d) => d.id === f.id).executor.expira = new Date(Date.now() - 1000).toISOString(); });
    const c = conectorFalso(); await S.processarFila(f.id, c, semEspera); f = S.fila(f.id);
    igual([c.envios.length, c.envios[0].chave, f.itens[0].status], [1, chave, "enviado"]); verdade(f.eventos.some((e) => e.tipo === "recuperado"));
    await fechar();
  });
  await teste("Disparos: resultado incerto bloqueia reenvio até o operador liberar (com chave nova)", async () => {
    const l = await loteDisparo(); let f = await S.prepararDisparo(chavesDe(l, "INC 0000301"), "selecao");
    let n = 0; const c = conectorFalso(() => (++n === 1 ? { resultado: "incerto", codigo: "x", detalhe: "?" } : null));
    f = await S.autorizarDisparo(f.id, PRONTO); await S.processarFila(f.id, c, semEspera); f = S.fila(f.id);
    igual([f.itens[0].status, f.itens[0].incerto], ["falha", true]); const chave = f.itens[0].chave;
    await falhaCom(() => S.reprocessarFalhas(f.id), "Não há falhas");
    await S.liberarIncerto(f.id, f.itens[0].id); await S.reprocessarFalhas(f.id); await S.processarFila(f.id, c, semEspera); f = S.fila(f.id);
    verdade(f.itens[0].status === "enviado" && f.itens[0].chave !== chave, "liberado com chave nova");
    await fechar();
  });
  await teste("Disparos: item alterado depois da autorização é bloqueado (vínculo preservado)", async () => {
    const l = await loteDisparo(); let f = await S.prepararDisparo(chavesDe(l, "INC 0000301"), "selecao");
    f = await S.autorizarDisparo(f.id, PRONTO);
    await S._alterar((E) => { E.disparos.find((d) => d.id === f.id).itens[0].telefone = "79991009999"; });
    const c = conectorFalso(); await S.processarFila(f.id, c, semEspera);
    igual([c.envios.length, S.fila(f.id).itens[0].status], [0, "falha"]);
    await fechar();
  });
  await teste("Disparos: gravações simultâneas não se sobrescrevem (resultado do envio não se perde)", async () => {
    const l = await loteDisparo(), a = S.obterChamada(l[0].id), b = S.obterChamada(l[1].id);
    await Promise.all([S.registrar(a.id, "sem_sucesso", "ligacao"), S.registrar(b.id, "sem_sucesso", "ligacao"), S.registrar(a.id, "sem_sucesso", "ligacao")]);
    igual([S.obterChamada(a.id).tentativas.length, S.obterChamada(b.id).tentativas.length], [2, 1]);
    await fechar();
  });
  await teste("Disparos: lote não encerra com fila ativa; ao encerrar apaga telefone, nome e texto e mantém a auditoria", async () => {
    const l = await loteDisparo(); let f = await S.prepararDisparo(chavesDe(l, "INC 0000301"), "selecao");
    f = await S.autorizarDisparo(f.id, PRONTO);
    await falhaCom(() => S.encerrarLote(), "fila de envio em andamento");
    await S.processarFila(f.id, conectorFalso(), semEspera); await S.encerrarLote(); f = S.fila(f.id);
    const i = f.itens[0], bruto = JSON.stringify(S.E.disparos);
    igual([i.telefone, i.destinatario, i.texto, i.texto_modelo, f.dados_apagados], [null, null, null, null, true]);
    verdade(i.telefone_mascara.endsWith("0202") && !bruto.includes("79991000202") && !bruto.includes("Cliente Fictício"), "dados pessoais");
    igual([i.status, i.tentativas.length], ["enviado", 1]); verdade(/^[0-9a-f]{64}$/.test(i.hash_texto), "hash");
    const csv = S.csvAuditoriaDisparos(); verdade(csv.includes("INC 0000301") && csv.includes("enviado") && !csv.includes("79991000202"), "auditoria sem telefone");
  });
  await teste("Disparos: simulação não bloqueia o envio real posterior", async () => {
    const l = await loteDisparo(); let f = await S.prepararDisparo(chavesDe(l, "INC 0000301"), "selecao");
    await S.autorizarDisparo(f.id, { pronto: true, modo: "simulacao" }); await S.processarFila(f.id, conectorFalso(() => ({ resultado: "enviado", wamid: "sim.1", simulado: true })), semEspera);
    igual(S.incidentesParaDisparo().find((x) => x.incidente === "INC 0000301").elegivel, true);
    await fechar();
  });
  await teste("Disparos: filas antigas são lidas; estado sem o campo 'disparos' continua abrindo", async () => {
    await S._alterar((E) => { delete E.disparos; }); await S.carregar(); igual(S.E.disparos, []);
  });

  /* ---------------------------------------------------- histórico permanente, callback manual e fechamento */
  const importarLinhas = async (ls) => { const b = gerarCSV(ls); await S.importar("h.csv", b, S.previa(b).resumo.sha256); return S.incidentesParaDisparo(); };
  const novoTurno = async (op = "OP2") => { if (S.loteAberto()) await S.encerrarLote(); if (S.sessao()) await S.encerrarDia(); await S.abrirSessao("Polo Fictício", op); };
  const umaLinha = (call, inc) => linha(call, inc, "MOBILE: 79991000501");
  await teste("Histórico: incidente atendido é reconhecido em lote e turno posteriores, sem contar callback de novo", async () => {
    await abrirDia(S); let l = await importarLinhas([umaLinha("CALL 0000501", "INC 0000500")]);
    await S.registrar(l[0].id, "callback_realizado", "ligacao");
    await novoTurno(); l = await importarLinhas([umaLinha("CALL 0000502", "INC 0000500")]);
    const a = S.atendimentoDoIncidente("INC:INC 0000500"); igual([a.operador, a.meio, a.status], ["Operador Teste", "ligacao", "realizado"]);
    igual([l[0].elegivel, l[0].atendido, S.obterChamada(l[0].id).estado], [false, true, "pendente"]);
    igual(S.metricasTempoReal().callbacks_realizados, 0, "reconhecer não é callback");
    await falhaCom(() => S.prepararDisparo([l[0].chave], "selecao"), "Nenhum incidente");
    igual(S.historicoDoIncidente("INC:INC 0000500").length, 1);
    await S.encerrarLote();
  });
  await teste("Histórico: preparada, falha, incerta, cancelada e simulada não geram registro; reabrir mantém o registro como reaberto", async () => {
    await abrirDia(S); let l = await importarLinhas([umaLinha("CALL 0000511", "INC 0000510"), linha("CALL 0000512", "INC 0000511", "MOBILE: 79991000512"), linha("CALL 0000513", "INC 0000512", "MOBILE: 79991000513")]);
    let f = await S.prepararDisparo(l.map((x) => x.chave), "selecao"); f = await S.autorizarDisparo(f.id, PRONTO);
    await S.processarFila(f.id, { enviar: async (e) => (e.incidente === "INC 0000510" ? { resultado: "falha" } : e.incidente === "INC 0000511" ? { resultado: "incerto" } : { resultado: "limite" }) }, semEspera);
    igual(S.E.historico_atendimento.filter((r) => r.tipo === "callback").length, 0);
    await S.cancelarRestante(f.id);
    igual(S.E.historico_atendimento.map((r) => r.tipo), ["cancelado"]);
    const c = l[0].id; await S.encerrarLote(); await abrirDia(S); l = await importarLinhas([umaLinha("CALL 0000514", "INC 0000513")]);
    await S.registrar(l[0].id, "callback_realizado", "whatsapp"); await S.registrar(l[0].id, "reabrir", null, "correção");
    igual([S.E.historico_atendimento.length, S.E.historico_atendimento[0].status, S.atendimentoDoIncidente("INC:INC 0000513")], [1, "reaberto", null]); verdade(c);
    await S.encerrarLote();
  });
  await teste("Limpeza do lote preserva histórico de callbacks, disparos e lotes finalizados", async () => {
    await abrirDia(S); const l = await importarLinhas([umaLinha("CALL 0000521", "INC 0000520")]); const f = await enviarUm(l, "INC 0000520");
    await S.encerrarLote();
    igual([S.chamadas().length, S.E.historico_atendimento.length, S.fila(f.id).itens[0].status, S.E.lotes.length, S.E.lotes[0].situacao], [0, 1, "enviado", 1, "encerrado"]);
    await S.encerrarDia(); igual([S.E.historico_atendimento.length, !!S.fila(f.id), S.E.dias_encerrados[0].lotes.length], [1, true, 1]);
  });
  await teste("Manual: operador vem do turno; só conta depois de confirmar o envio; falha não conta", async () => {
    await S._alterar((E) => { E.sessao = null; }); await falhaCom(() => S.abrirCallbackManual({ incidente: "1", telefone: "79991000601", modo: "padronizada", modelo: "manual_falta_energia" }), "Abra o turno");
    await abrirDia(S, "Polo Fictício", "OPT4");
    await falhaCom(() => S.abrirCallbackManual({ incidente: "", telefone: "79991000601", modo: "padronizada", modelo: "manual_falta_energia" }), "incidente");
    await falhaCom(() => S.abrirCallbackManual({ incidente: "600", telefone: "7932001234", modo: "padronizada", modelo: "manual_falta_energia" }), "FIXO");
    const r = await S.abrirCallbackManual({ incidente: "600", telefone: "(79) 99100-0601", modo: "padronizada", modelo: "manual_falta_energia", operador: "INVENTADO" });
    igual([r.item.operador, r.item.incidente, r.item.status_envio], ["OPT4", "INC 600", "pendente"]); verdade(r.url.includes("web.whatsapp.com") && decodeURIComponent(r.url).includes("INC 600"), "link");
    igual(S.metricasTempoReal().callbacks_realizados, 0, "pendente não conta");
    await S.confirmarEnvioManual(r.item.id, "enviado"); igual(S.metricasTempoReal().callbacks_realizados, 1);
    await falhaCom(() => S.confirmarEnvioManual(r.item.id, "enviado"), "já foi confirmado");
    const f = await S.abrirCallbackManual({ incidente: "601", telefone: "79991000602", modo: "personalizada", texto: "Texto livre" });
    verdade(decodeURIComponent(f.url).includes("Olá, aqui é a Energisa. Texto livre"), "saudação da regra existente");
    await S.confirmarEnvioManual(f.item.id, "falha"); igual(S.metricasTempoReal().callbacks_realizados, 1, "falha não conta");
  });
  await teste("Manual: segundo telefone do mesmo incidente não conta de novo; resolver não gera callback; histórico persiste e filtra", async () => {
    await abrirDia(S, "Polo Fictício", "OPT4");
    const a = await S.abrirCallbackManual({ incidente: "INC 610", telefone: "79991000611", modo: "padronizada", modelo: "manual_falta_energia" }); await S.confirmarEnvioManual(a.item.id, "enviado");
    const b = await S.abrirCallbackManual({ incidente: "610", telefone: "79991000612", modo: "padronizada", modelo: "manual_falta_energia" }); const cb = await S.confirmarEnvioManual(b.item.id, "enviado");
    igual([cb.status_envio, cb.callback, S.metricasTempoReal().callbacks_realizados], ["enviado", "ja_registrado", 1]);
    const antes = S.E.historico_atendimento.length;
    const res = await S.marcarResolucaoManual(a.item.id, true); igual([res.status_resolucao, res.status_envio, S.E.historico_atendimento.length, S.metricasTempoReal().callbacks_realizados, S.metricasTempoReal().ocorrencias_resolvidas], ["resolvido", "enviado", antes, 1, 1]);
    await S.carregar(); igual(S.historicoManual({}).length, 2, "persiste");
    igual(S.indicadoresManuais(S.historicoManual({})), { enviadas: 2, resolvidos: 1, pendentes_resolucao: 1, falhas: 0 });
    igual(S.historicoManual({ status: "resolvido" }).length, 1); igual(S.historicoManual({ incidente: "999" }).length, 0); igual(S.historicoManual({ operador: "OUTRO" }).length, 0); igual(S.historicoManual({ de: "2999-01-01" }).length, 0);
  });
  await teste("Manual: incidente do lote aberto marca o principal uma única vez e não duplica com o disparo", async () => {
    await abrirDia(S, "Polo Fictício", "OPT4"); const l = await importarLinhas([umaLinha("CALL 0000621", "INC 0000620")]);
    const a = await S.abrirCallbackManual({ incidente: "INC 0000620", telefone: "79991000621", modo: "padronizada", modelo: "manual_falta_energia" }); await S.confirmarEnvioManual(a.item.id, "enviado");
    const c = S.obterChamada(l[0].id); igual([c.estado, c.callback_origem, S.metricasTempoReal().callbacks_realizados, S.E.historico_atendimento.length], ["callback_realizado", "callback_manual", 1, 1]);
    await falhaCom(() => S.prepararDisparo([l[0].chave], "selecao"), "Nenhum incidente"); await falhaCom(() => S.registrar(l[0].id, "callback_realizado", "ligacao"), "já registrado");
    await S.encerrarLote();
  });
  await teste("Manual antes de o incidente entrar no lote: o registro individual no mesmo turno não conta de novo e mantém a resolução", async () => {
    await abrirDia(S, "Polo Fictício", "OPT4");
    const a = await S.abrirCallbackManual({ incidente: "INC 0000630", telefone: "79991000631", modo: "padronizada", modelo: "manual_falta_energia" }); await S.confirmarEnvioManual(a.item.id, "enviado"); await S.marcarResolucaoManual(a.item.id, true);
    igual([S.metricasTempoReal().callbacks_realizados, S.metricasTempoReal().ocorrencias_resolvidas], [1, 1]);
    const l = await importarLinhas([umaLinha("CALL 0000631", "INC 0000630")]); await S.registrar(l[0].id, "callback_realizado", "whatsapp");
    const data = S.sessao().data_operacional, cons = S.consolidadoDia(data)[0];
    igual([S.metricasTempoReal().callbacks_realizados, S.metricasTempoReal().ocorrencias_resolvidas, S.E.historico_atendimento.length, cons.callbacks, cons.resolvidos], [1, 1, 1, 1, 1]);
    await S.registrar(l[0].id, "reabrir", null, "correção de teste"); igual([S.metricasTempoReal().callbacks_realizados, S.consolidadoDia(data).length ? S.consolidadoDia(data)[0].callbacks : 0], [0, 0], "reabrir zera a única atuação");
    await S.encerrarLote();
  });
  await teste("Manual em incidente já contado: marcar resolvido atualiza o indicador sem gerar callback; desfazer volta", async () => {
    await abrirDia(S, "Polo Fictício", "OPT4"); const l = await importarLinhas([umaLinha("CALL 0000641", "INC 0000640")]); await S.registrar(l[0].id, "callback_realizado", "ligacao");
    const a = await S.abrirCallbackManual({ incidente: "INC 0000640", telefone: "79991000641", modo: "padronizada", modelo: "manual_falta_energia" }), c = await S.confirmarEnvioManual(a.item.id, "enviado"); igual(c.callback, "ja_registrado");
    await S.marcarResolucaoManual(a.item.id, true); const data = S.sessao().data_operacional;
    igual([S.metricasTempoReal().callbacks_realizados, S.metricasTempoReal().ocorrencias_resolvidas, S.consolidadoDia(data)[0].callbacks, S.consolidadoDia(data)[0].resolvidos], [1, 1, 1, 1]);
    await S.marcarResolucaoManual(a.item.id, false); igual([S.metricasTempoReal().ocorrencias_resolvidas, S.consolidadoDia(data)[0].resolvidos], [0, 0]);
    await S.encerrarLote();
  });
  await teste("Excluir histórico manual: exige a palavra, mantém pendentes, não mexe em indicadores nem fechamento e fica auditado", async () => {
    await abrirDia(S, "Polo Fictício", "OPT4"); const novo = async (n) => (await S.abrirCallbackManual({ incidente: "INC " + n, telefone: "79991000651", modo: "padronizada", modelo: "manual_falta_energia" })).item.id;
    const a = await novo("650"), b = await novo("651"), c = await novo("652"); await S.confirmarEnvioManual(a, "enviado"); await S.confirmarEnvioManual(b, "falha");
    const data = S.sessao().data_operacional, antes = JSON.stringify([S.metricasTempoReal(), S.consolidadoDia(data), S.E.historico_atendimento]), ind = S.indicadoresManuais(S.historicoManual({}));
    await falhaCom(() => S.ocultarHistoricoManual([a, b, c], "excluir"), "EXCLUIR"); igual(S.historicoManual({}).length, 3, "sem a palavra nada muda");
    const r = await S.ocultarHistoricoManual([a, b, c], "EXCLUIR"); igual(r.quantidade, 2, "pendente não sai");
    igual(S.historicoManual({}).map((i) => i.id), [c]); igual(JSON.stringify([S.metricasTempoReal(), S.consolidadoDia(data), S.E.historico_atendimento]), antes, "contagem intacta");
    igual(S.indicadoresManuais(S.historicoManual({}, { incluirOcultos: true })), ind); igual(S.E.callbacks_manuais.length, 3, "nada apagado");
    await S.carregar(); const ult = S.E.auditoria_manual[S.E.auditoria_manual.length - 1]; igual([ult.operador, ult.quantidade, ult.registros.length], ["OPT4", 2, 2]); igual(S.historicoManual({}).length, 1, "persiste");
  });
  const tresIncidentes = async () => { await abrirDia(S, "Polo Fictício", "OPT4"); return importarLinhas([umaLinha("CALL 0000661", "INC 0000660"), umaLinha("CALL 0000663", "INC 0000662"), umaLinha("CALL 0000665", "INC 0000664")]); };
  const atualDe = (id) => S.itemAtual(S.fila(id));
  const cbs = () => S.metricasTempoReal().callbacks_realizados;
  await teste("Lote guiado: abrir, voltar, erro e recarregar não contam nem avançam; só CALLBACK REALIZADO conta, uma vez; sem avanço automático fica no incidente", async () => {
    const l = await tresIncidentes(), filas = S.E.disparos.length, f = await S.iniciarAtendimento(l.map((x) => x.chave));
    igual([S.E.disparos.length, f.situacao, f.assistido, f.autorizacao.conector_modo], [filas + 1, "atendimento", true, "whatsapp_web"]);
    const i1 = atualDe(f.id), i2 = f.itens[1]; igual(i1.incidente, "INC 0000660");
    await falhaCom(() => S.abrirAtendimento(f.id, i2.id), "não é o atual");
    await falhaCom(() => S.confirmarEnvioAtendimento(f.id, i1.id, "enviado"), "abra o WhatsApp"); igual(cbs(), 0, "sem abrir não confirma");
    const r = await S.abrirAtendimento(f.id, i1.id); verdade(r.url.startsWith("https://web.whatsapp.com/send?phone=55"), "mesmo link do envio individual"); igual([atualDe(f.id).status, cbs()], ["aberto", 0], "abrir não conta");
    // 1) voltar sem enviar (mesmo repetido) e 2) erro no WhatsApp com nova tentativa: continua no mesmo incidente, sem callback
    await S.registrarRetornoAtendimento(f.id, i1.id); await S.registrarRetornoAtendimento(f.id, i1.id); await S.abrirAtendimento(f.id, i1.id);
    igual([S.fila(f.id).itens[0].status, atualDe(f.id).incidente, cbs(), S.fila(f.id).itens[0].tentativas.length, S.fila(f.id).eventos.filter((e) => e.tipo === "retorno").length], ["aberto", "INC 0000660", 0, 2, 1], "retorno não conta nem avança");
    // 9) recarregar a página não transforma o pendente em realizado
    await S.carregar(); igual([atualDe(f.id).incidente, atualDe(f.id).status, cbs(), S.obterChamada(l[0].id).estado], ["INC 0000660", "aberto", 0, "pendente"], "recarregar não conta");
    // 3) e 6) CALLBACK REALIZADO sem avanço automático: registra uma vez e continua no incidente
    await S.confirmarEnvioAtendimento(f.id, i1.id, "enviado"); const data = S.sessao().data_operacional;
    igual([S.metricasTempoReal().callbacks_realizados, S.E.historico_atendimento.length, S.consolidadoDia(data)[0].callbacks, S.obterChamada(l[0].id).estado], [1, 1, 1, "callback_realizado"]);
    igual([atualDe(f.id).incidente, atualDe(f.id).status, S.fila(f.id).situacao], ["INC 0000660", "enviado", "atendimento"], "não avança sozinho");
    // 8) confirmar de novo não duplica; o WhatsApp não reabre para quem já teve callback
    await falhaCom(() => S.confirmarEnvioAtendimento(f.id, i1.id, "enviado"), "não está aguardando"); igual([cbs(), S.E.historico_atendimento.length], [1, 1], "sem duplicar");
    await falhaCom(() => S.abrirAtendimento(f.id, i1.id), "já foi registrado");
    await S.pularAtendimento(f.id, i1.id); igual([S.fila(f.id).itens[0].status, atualDe(f.id).incidente, cbs()], ["enviado", "INC 0000662", 1], "PULAR depois do callback só avança, sem desfazer");
    await S.pularAtendimento(f.id, i1.id); igual(atualDe(f.id).incidente, "INC 0000662", "clique repetido não avança duas vezes");
    igual([S.anteriorAtendimento(S.fila(f.id)).incidente, S.painelAtendimento(S.fila(f.id)).posicao], ["INC 0000660", 2]);
    await falhaCom(() => S.prepararDisparo([l[0].chave], "lote"), "Já existe uma fila");
    await S.cancelarAtendimento(f.id); await falhaCom(() => S.prepararDisparo([l[0].chave], "lote"), "Nenhum incidente");
    await S.encerrarLote();
  });
  await teste("Lote guiado: PRÓXIMO INC e PULAR não registram callback; avanço automático só depois da confirmação explícita", async () => {
    const l = await tresIncidentes(), f = await S.iniciarAtendimento(l.map((x) => x.chave)), [a, b, c] = f.itens, st = () => S.fila(f.id).itens.map((x) => x.status);
    // 4) abrir e ir ao PRÓXIMO INC sem confirmar: fica "não realizado", sem callback; clique repetido não avança duas vezes
    await S.abrirAtendimento(f.id, a.id); const r = await S.proximoAtendimento(f.id, a.id); await S.proximoAtendimento(f.id, a.id);
    igual([st()[0], r.proximo.id, atualDe(f.id).id, cbs(), S.obterChamada(a.chamada_id).estado], ["nao_confirmado", b.id, b.id, 0, "pendente"]);
    // 5) PULAR depois de abrir: ignorado, sem callback
    await S.abrirAtendimento(f.id, b.id); await S.pularAtendimento(f.id, b.id); await S.pularAtendimento(f.id, b.id);
    igual([st()[1], atualDe(f.id).id, cbs()], ["pulado", c.id, 0]);
    // 7) avanço automático: abrir não avança; só a confirmação avança (aqui conclui a fila)
    await S.abrirAtendimento(f.id, c.id); await S.registrarRetornoAtendimento(f.id, c.id); igual([atualDe(f.id).id, S.fila(f.id).situacao], [c.id, "atendimento"], "abrir e voltar não avançam");
    await S.confirmarEnvioAtendimento(f.id, c.id, "enviado", { avancar: true });
    igual([st(), S.fila(f.id).situacao, cbs()], [["nao_confirmado", "pulado", "enviado"], "concluida", 1]);
    const p = S.painelAtendimento(S.fila(f.id)); igual([p.confirmados, p.nao_realizados, p.pulados, p.restantes], [1, 1, 1, 0]);
    const sel = S.incidentesParaDisparo(); igual(["INC 0000660", "INC 0000662", "INC 0000664"].map((n) => sel.find((x) => x.incidente === n).elegivel), [true, true, false], "não realizado e ignorado podem ser atendidos de novo");
    await S.encerrarLote();
  });
  await teste("Lote guiado: PRÓXIMO INC sem abrir deixa para depois; o único pendente continua na tela até PULAR", async () => {
    const l = await tresIncidentes(), f = await S.iniciarAtendimento(l.map((x) => x.chave)), [a, b, c] = f.itens;
    await S.proximoAtendimento(f.id, a.id); igual([atualDe(f.id).id, S.fila(f.id).itens[0].status], [b.id, "preparado"], "continua pendente");
    await S.pularAtendimento(f.id, b.id); await S.pularAtendimento(f.id, c.id); igual(atualDe(f.id).id, a.id, "volta ao que ficou para depois");
    const r = await S.proximoAtendimento(f.id, a.id); igual([r.mesmo, atualDe(f.id).id, S.fila(f.id).situacao], [true, a.id, "atendimento"]);
    await S.pularAtendimento(f.id, a.id); igual([S.fila(f.id).situacao, cbs()], ["concluida", 0]);
    await S.encerrarLote();
  });
  await teste("Lote guiado: fila gravada pela versão anterior (sem ponteiro) continua no incidente aberto e passa a usar o ponteiro", async () => {
    const l = await tresIncidentes(), f = await S.iniciarAtendimento(l.map((x) => x.chave)), [a, b] = f.itens;
    await S.abrirAtendimento(f.id, a.id); await S._alterar((E) => { const x = E.disparos.find((y) => y.id === f.id); delete x.atual_id; delete x.anterior_id; });
    igual(atualDe(f.id).id, a.id, "regra antiga: o aberto é o atual"); await S.registrarRetornoAtendimento(f.id, a.id); igual(atualDe(f.id).id, a.id, "voltar não avança");
    await S.proximoAtendimento(f.id, a.id); igual([atualDe(f.id).id, S.fila(f.id).atual_id, S.fila(f.id).itens[0].status], [b.id, b.id, "nao_confirmado"]);
    await S.cancelarAtendimento(f.id); await S.encerrarLote();
  });
  await teste("Lote guiado: pular, pausar, retomar, cancelar e persistência; Não enviei libera o incidente; encerrar é recusado em andamento", async () => {
    const l = await tresIncidentes(), f = await S.iniciarAtendimento(l.map((x) => x.chave));
    await S.pularAtendimento(f.id, atualDe(f.id).id); await S.pausarAtendimento(f.id); const i = atualDe(f.id); igual(i.incidente, "INC 0000662");
    await falhaCom(() => S.abrirAtendimento(f.id, i.id), "Retome"); await falhaCom(() => S.proximoAtendimento(f.id, i.id), "Retome"); await falhaCom(() => S.pularAtendimento(f.id, i.id), "Retome"); await falhaCom(() => S.encerrarLote(), "em andamento");
    await S.carregar(); igual([S.fila(f.id).situacao, atualDe(f.id).incidente, S.painelAtendimento(S.fila(f.id)).pulados], ["pausada", "INC 0000662", 1], "persistiu");
    await S.retomarAtendimento(f.id); await S.abrirAtendimento(f.id, i.id); await S.cancelarAtendimento(f.id);
    igual(S.fila(f.id).itens.map((x) => x.status), ["pulado", "nao_confirmado", "cancelado"]); igual(S.pendentesConfirmacao().length, 1);
    await S.confirmarEnvioAtendimento(f.id, i.id, "falha"); igual([S.metricasTempoReal().callbacks_realizados, S.incidentesParaDisparo().every((x) => x.elegivel)], [0, true], "não enviei não conta e libera");
    await S.encerrarLote();
  });
  await teste("Lote guiado: telefone com pendência bloqueia a abertura até corrigir; callback por outra via pula sem contar de novo", async () => {
    await abrirDia(S, "Polo Fictício", "OPT4"); const l = await importarLinhas([linha("CALL 0000671", "INC 0000670", ""), umaLinha("CALL 0000673", "INC 0000672")]), f = await S.iniciarAtendimento(l.map((x) => x.chave));
    const i = atualDe(f.id); await falhaCom(() => S.abrirAtendimento(f.id, i.id), "celular"); await S.corrigirTelefoneItem(f.id, i.id, "79991000671"); await S.abrirAtendimento(f.id, i.id); await S.registrarRetornoAtendimento(f.id, i.id); await S.proximoAtendimento(f.id, i.id);
    await S.registrar(l[1].id, "callback_realizado", "ligacao"); const r = await S.abrirAtendimento(f.id, atualDe(f.id).id);
    igual([r.pulado, S.fila(f.id).situacao, S.metricasTempoReal().callbacks_realizados], [true, "concluida", 1]);
    await S.encerrarLote();
  });
  await teste("Fechamento: só agregados por operador, com total; sem nenhum dado de cliente", async () => {
    await abrirDia(S, "Polo Fictício", "OPT4"); const l = await importarLinhas([umaLinha("CALL 0000701", "INC 0000700"), linha("CALL 0000702", "INC 0000701", "MOBILE: 79991000702")]);
    const f = await enviarUm(l, "INC 0000700"); await S.registrarResultado(f.itens[0].chamada_id, "resolvida");
    const m = await S.abrirCallbackManual({ incidente: "INC 0000799", telefone: "79991000799", modo: "personalizada", texto: "Mensagem secreta do cliente" }); await S.confirmarEnvioManual(m.item.id, "enviado");
    const hoje = S.sessao().data_operacional; await falhaCom(() => S.gerarFechamento(hoje), "Encerre o dia");
    await S.encerrarLote(); await S.encerrarDia();
    const x = await S.gerarFechamento(hoje), ls = x.conteudo.replace("﻿", "").trim().split("\r\n");
    igual(ls[0], "data;polo;operador;callbacks_realizados;incidentes_resolvidos;incidentes_cancelados;versao");
    igual(ls.slice(1), [`${hoje};Polo Fictício;OPT4;2;1;0;1`, `${hoje};TOTAL;TOTAL;2;1;0;1`]);
    for (const p of ["INC", "CALL", "79991", "Cliente", "Rua", "secreta", "FIC_UC"]) verdade(!x.conteudo.includes(p), "vazou " + p);
    await falhaCom(() => S.gerarFechamento(hoje), "já foi concluído");
    igual(S.diasSemFechamento(), []);
  });
  await teste("Fechamento: registro da exportação para a pasta de rede não altera o fechamento nem o Drive; falha depois de exportado não apaga a confirmação", async () => {
    await abrirDia(S, "Polo Fictício", "OPT6"); const a = await S.abrirCallbackManual({ incidente: "720", telefone: "79991000721", modo: "padronizada", modelo: "manual_falta_energia" }); await S.confirmarEnvioManual(a.item.id, "enviado");
    const hoje = S.sessao().data_operacional; await S.encerrarDia(); const f = await S.gerarFechamento(hoje), antes = JSON.stringify([f.conteudo, f.sha256, f.nome, f.versao, f.status, f.assinatura]);
    await S.registrarExportacaoRede(f.id, { arquivo: "x_OP-OPT6.csv", operador: "OPT6", resultado: "falha", detalhe: "NotFoundError" });
    igual([S.fechamento(f.id).exportacao_rede.status, S.fechamento(f.id).historico_rede.length], ["pendente", 1], "falha registrada como pendente, não exportado");
    const r = await S.registrarExportacaoRede(f.id, { arquivo: "x_OP-OPT6.csv", operador: "OPT6", pasta: "central-callback", resultado: "exportado" });
    igual([r.status, r.arquivo, r.operador, r.sha256 === f.sha256], ["exportado", "x_OP-OPT6.csv", "OPT6", true]);
    await S.registrarExportacaoRede(f.id, { arquivo: "x_OP-OPT6.csv", operador: "OPT6", resultado: "conflito", detalhe: "diferente" });
    const x = S.fechamento(f.id); igual([x.exportacao_rede.status, x.historico_rede.map((h) => h.resultado)], ["exportado", ["falha", "exportado", "conflito"]]);
    igual(JSON.stringify([x.conteudo, x.sha256, x.nome, x.versao, x.status, x.assinatura]), antes, "fechamento e status do Drive intactos");
    verdade(!S.fechamentoDesatualizado(hoje), "registrar não torna o fechamento desatualizado");
    await falhaCom(() => S.registrarExportacaoRede("inexistente", { resultado: "exportado" }), "não encontrado");
  });
  await teste("Fechamento: dados novos exigem motivo e geram nova versão, sem substituir a anterior; envio idempotente", async () => {
    await abrirDia(S, "Polo Fictício", "OPT4"); const a = await S.abrirCallbackManual({ incidente: "710", telefone: "79991000711", modo: "padronizada", modelo: "manual_falta_energia" }); await S.confirmarEnvioManual(a.item.id, "enviado");
    const hoje = S.sessao().data_operacional; await S.encerrarDia(); const v1 = await S.gerarFechamento(hoje);
    await S.abrirSessao("Polo Fictício", "OPT5"); const b = await S.abrirCallbackManual({ incidente: "711", telefone: "79991000712", modo: "padronizada", modelo: "manual_falta_energia" }); await S.confirmarEnvioManual(b.item.id, "enviado"); await S.encerrarDia();
    verdade(S.fechamentoDesatualizado(hoje), "detecta dados novos"); await falhaCom(() => S.gerarFechamento(hoje), "motivo");
    const v2 = await S.gerarFechamento(hoje, { motivo: "Novo turno" }); igual([v2.versao, v2.substitui, v2.nome.endsWith("_v2.csv"), S.E.fechamentos.length], [2, v1.nome, true, 2]);
    await S.enviarFechamentosPendentes({ enviarFechamento: async () => ({ resultado: "enviado", arquivo_id: "x" }) }); igual([S.E.fechamentos[0].status, S.E.fechamentos[0].drive_id], ["pendente", null], "sem confirmação não conta como enviado");
    await S.enviarFechamentosPendentes({ enviarFechamento: async () => ({ resultado: "pendente", detalhe: "Drive fora" }) }); igual([S.E.fechamentos[0].status, S.E.fechamentos[0].erro, S.E.fechamentos[0].historico_envio.length], ["pendente", "Drive fora", 2], "registra cada tentativa");
    const chamadas = []; const c = { enviarFechamento: async (d) => { chamadas.push(d.nome); return { resultado: "enviado", confirmado: true, arquivo_id: "x", caminho: "FECHAMENTOS/2026/11-NOVEMBRO", bi: "atualizado" }; } };
    igual((await S.enviarFechamentosPendentes(c)).enviados, 2); igual((await S.enviarFechamentosPendentes(c)).enviados, 0); igual(chamadas.length, 2);
    await S.enviarFechamentosPendentes({ enviarFechamento: async () => { throw new Error("não deveria"); } });
    verdade(/_PC[A-F0-9]{8}\.csv$/.test(v1.nome) && v2.nome === v1.nome.replace(".csv", "_v2.csv"), "identificação do computador estável entre versões");
    igual([S.E.fechamentos[0].caminho_drive, S.E.fechamentos[0].erro, S.E.fechamentos[0].historico_envio.at(-1).resultado, S.ultimoFechamentoDoDia(hoje).id, S.ultimosFechamentos()[0].conteudo], ["FECHAMENTOS/2026/11-NOVEMBRO", null, "enviado", v2.id, undefined]);
  });

  await teste("Fechamento: sequência antiga, sem identificação do computador, continua com o mesmo nome e não é contada em dobro", async () => {
    await abrirDia(S, "Polo Fictício", "OPT4"); const a = await S.abrirCallbackManual({ incidente: "720", telefone: "79991000721", modo: "padronizada", modelo: "manual_falta_energia" }); await S.confirmarEnvioManual(a.item.id, "enviado");
    const hoje = S.sessao().data_operacional; await S.encerrarDia(); const v1 = await S.gerarFechamento(hoje), antigo = v1.nome.replace(/_PC[A-F0-9]{8}/, "");
    await S._alterar((E) => { E.fechamentos[E.fechamentos.length - 1].nome = antigo; });
    await S.abrirSessao("Polo Fictício", "OPT5"); const b = await S.abrirCallbackManual({ incidente: "721", telefone: "79991000722", modo: "padronizada", modelo: "manual_falta_energia" }); await S.confirmarEnvioManual(b.item.id, "enviado"); await S.encerrarDia();
    const v2 = await S.gerarFechamento(hoje, { motivo: "Novo turno" }); igual(v2.nome, antigo.replace(".csv", "_v2.csv"));
  });

  /* Filtro REGIONAIS E MUNICÍPIOS (js/localidades.js + js/filtro-regionais.js): divisão oficial, reconhecimento no ADMS e seleção. */
  const REG_ESPERADAS = {
    aracaju: [["001", "Aracaju"], ["010", "Barra dos Coqueiros"], ["020", "Nossa Senhora do Socorro"]],
    sao_cristovao: [["620", "São Cristóvão"], ["630", "Itaporanga d'Ajuda"]],
    itabaiana: [["030", "Itabaiana"], ["050", "Areia Branca"], ["060", "Campo do Brito"], ["070", "Carira"], ["080", "Frei Paulo"], ["090", "Macambira"], ["100", "Malhador"],
      ["110", "Moita Bonita"], ["120", "Aparecida"], ["130", "Pedra Mole"], ["140", "Pinhão"], ["150", "Ribeirópolis"], ["160", "São Domingos"], ["170", "São Miguel do Aleixo"]],
    lagarto: [["180", "Lagarto"], ["190", "Salgado"], ["200", "Poço Verde"], ["210", "Simão Dias"]],
    gloria: [["340", "Nossa Senhora das Dores"], ["350", "Canindé de São Francisco"], ["360", "Capela"], ["370", "Cumbe"], ["380", "Feira Nova"], ["390", "Gararu"],
      ["400", "Graccho Cardoso"], ["410", "Itabi"], ["420", "Monte Alegre de Sergipe"], ["430", "Nossa Senhora da Glória"], ["440", "Lourdes"], ["450", "Poço Redondo"], ["461", "Porto da Folha"]],
    propria: [["468", "Propriá"], ["480", "Amparo de São Francisco"], ["490", "Aquidabã"], ["500", "Telha"], ["510", "Canhoba"], ["521", "Cedro de São João"], ["530", "Ilha das Flores"],
      ["541", "Japoatã"], ["550", "Malhada dos Bois"], ["560", "Muribeca"], ["570", "Neópolis"], ["580", "Pacatuba"], ["590", "Santana do São Francisco"], ["600", "São Francisco"], ["700", "Brejo Grande"]],
    maruim: [["220", "Maruim"], ["230", "Carmópolis"], ["240", "Divina Pastora"], ["250", "General Maynard"], ["260", "Japaratuba"], ["270", "Laranjeiras"], ["280", "Pirambu"],
      ["290", "Riachuelo"], ["300", "Rosário do Catete"], ["310", "Santa Rosa de Lima"], ["320", "Santo Amaro das Brotas"], ["330", "Siriri"]],
  };
  await teste("Regionais: sete regionais, com todos os municípios e os códigos confirmados (001/010/020, 620/630, 200 Poço Verde)", async () => {
    const L = window.Localidades;
    igual(L.REGIONAIS.map((r) => r.nome), ["Regional Aracaju", "Regional São Cristóvão", "Regional Itabaiana", "Regional Lagarto", "Regional Glória", "Regional Propriá", "Regional Maruim"]);
    for (const r of L.REGIONAIS) igual(r.municipios.map((m) => [m.codigo, m.nome]), REG_ESPERADAS[r.id], r.nome);
    igual(L.MUNICIPIOS.length, 63, "63 municípios");
    igual(new Set(L.MUNICIPIOS.map((m) => m.chave)).size, 63, "chave única por município");
    igual(new Set(L.MUNICIPIOS.map((m) => m.codigo)).size, 63, "cada código em um único município (sem cruzamento entre regionais)");
    igual(new Set(L.MUNICIPIOS.map((m) => m.normal)).size, 63, "cada nome em um único município (sem duplicidade)");
    verdade(L.MUNICIPIOS.every((m) => /^\d{3}$/.test(m.codigo)), "todos com código de três dígitos");
    igual(L.chavesDaRegional("aracaju"), ["001", "010", "020"], "Aracaju: só os três");
    igual(L.chavesDaRegional("sao_cristovao"), ["620", "630"], "São Cristóvão: só os dois");
    for (const [k, r, n] of [["001", "aracaju", "Aracaju"], ["010", "aracaju", "Barra dos Coqueiros"], ["020", "aracaju", "Nossa Senhora do Socorro"], ["620", "sao_cristovao", "São Cristóvão"], ["630", "sao_cristovao", "Itaporanga d'Ajuda"]])
      igual([L.municipioPorChave(k).regional, L.municipioPorChave(k).nome, L.MUNICIPIOS.filter((m) => m.codigo === k).length], [r, n, 1], "código " + k);
  });
  await teste("Regionais: reconhecimento no formato real do ADMS (código + nome, Dispositivo:, acento, maiúsculas, apóstrofo)", async () => {
    const L = window.Localidades, k = (loc) => L.classificar(loc).chave;
    igual([k("End:: RUA X_10_CENTRO; 1_ARACAJU"), k("End:: R A_1_X; 10_BARRA DOS COQUEIROS"), k("End:: R; 20_NOSSA SENHORA DO SOCORRO"), k("y; 620_SÃO CRISTOVÃO"),
      k("y; 630_ITAPORANGA D AJUDA"), k("Rua A; Bairro; Itaporanga d'Ajuda")], ["001", "010", "020", "620", "630", "630"]);
    igual([k("x; 001_ARACAJU"), k("Dispositivo: ARACAJU"), k("x; 620_ARACAJU"), k("x; 1_SAO CRISTOVAO"), k("x; 10_NOSSA SENHORA DO SOCORRO")],
      ["001", "001", "?divergente", "?divergente", "?divergente"], "código e nome validados juntos nos cinco códigos novos");
    igual([k("x; 30_ITABAIANA"), k("x; 030_Itabaiana"), k("Dispositivo: ITABAIANA"), k("x; 350_CANINDE DE SAO FRANCISCO"), k("x; 461_PORTO DA FOLHA"), k("x;   700_brejo   grande ")],
      ["030", "030", "030", "350", "461", "700"]);
    const c = L.classificar("End:: RUA I; 430_NOSSA SENHORA DA GLÓRIA");
    igual([c.status, c.regional, c.nome, c.codigo, c.codigo_adms, c.municipio, c.original], ["ok", "gloria", "Nossa Senhora da Glória", "430", 430, "NOSSA SENHORA DA GLORIA", "430_NOSSA SENHORA DA GLÓRIA"]);
  });
  await teste("Regionais: aliases confirmados (Aparecida, Graccho Cardoso, Lourdes, Santo Amaro, Amparo do São Francisco) e nada por aproximação", async () => {
    const L = window.Localidades, k = (loc) => L.classificar(loc).chave, st = (loc) => L.classificar(loc).status;
    igual([k("x; 120_NOSSA SENHORA APARECIDA"), k("x; 400_GRACHO CARDOSO"), k("x; 440_NOSSA SENHORA DE LOURDES"), k("x; 400_GRACCHO CARDOSO"), k("x; 120_APARECIDA")], ["120", "400", "440", "400", "120"]);
    igual(Object.keys(L.ALIASES).sort(), ["AMPARO DO SAO FRANCISCO", "GRACHO CARDOSO", "NOSSA SENHORA APARECIDA", "NOSSA SENHORA DE LOURDES", "SANTO AMARO"]);
    igual([st("x; NSRA DA GLORIA"), st("x; N SRA DO SOCORRO"), st("x; M BONITA"), st("x; ITABAIAN"), st("x; SANTO AMAR"), st("x; AMPARO DO SAO")], ["nao_reconhecido", "nao_reconhecido", "nao_reconhecido", "nao_reconhecido", "nao_reconhecido", "nao_reconhecido"]);
    igual([k("RUA ARACAJU_10_CENTRO; 620_SAO CRISTOVAO"), k("AV SIMAO DIAS_200_CENTRO; 1_ARACAJU"), k("RUA NSRA DA GLORIA; 30_ITABAIANA")], ["620", "001", "030"], "nome de município dentro do endereço não conta");
    igual(k("End:: RUA NSRA DA GLORIA_10_CENTRO; 30_ITABAIANA"), "030", "rua com nome de município não confunde: vale o último trecho");
  });
  await teste("Regionais: códigos repetidos em outro estado não classificam errado: o município de outro estado fica FORA DA ÁREA DE SERGIPE", async () => {
    const L = window.Localidades, st = (loc) => L.classificar(loc).status;
    igual([st("x; 1_JOAO PESSOA"), st("x; 30_PEDRO REGIS"), st("x; 113_ITABAIANA"), st("x; 179_APARECIDA"), st("x; 181_SAO FRANCISCO"), st("x; 77_ESTANCIA")],
      ["fora_se", "fora_se", "fora_se", "fora_se", "fora_se", "nao_reconhecido"]);
    igual([st("x; 10_SAO MIGUEL DE TAIPU"), st("x; 20_ALHANDRA"), st("x; 1_JOAO PESSOA")], ["fora_se", "fora_se", "fora_se"], "Paraíba com os números 1/10/20 não vira Aracaju/Barra/Socorro");
    igual([st("Dispositivo: APARECIDA"), st("x; 120_APARECIDA")], ["fora_se", "ok"], "APARECIDA solto só existe na Paraíba no ADMS; com o código 120 é Sergipe");
    igual([st(""), st("Dispositivo: CH 12345"), st("End:: RUA SEM MUNICIPIO_0_X")], ["desconhecida", "desconhecida", "desconhecida"]);
  });
  await teste("Regionais: 200_POCO VERDE = Poço Verde (Lagarto); 450_POCO REDONDO = Poço Redondo (Glória); sem confundir os dois", async () => {
    const L = window.Localidades, c = (loc) => L.classificar(loc), v = (loc) => { const x = c(loc); return [x.status, x.chave, x.nome, x.regional_nome]; };
    igual(v("End:: R; 200_POCO VERDE"), ["ok", "200", "Poço Verde", "Regional Lagarto"]);
    igual(v("End:: R; 450_POCO REDONDO"), ["ok", "450", "Poço Redondo", "Regional Glória"]);
    igual([v("Dispositivo: POCO VERDE")[1], v("Dispositivo: POCO REDONDO")[1]], ["200", "450"], "sem código: nome único em cada regional");
    igual([c("x; 200_POCO REDONDO").status, c("x; 450_POCO VERDE").status], ["divergente", "divergente"], "código de um com o nome do outro não classifica");
    verdade(L.confere("x; 200_POCO VERDE", new Set(["200"])) && !L.confere("x; 200_POCO VERDE", new Set(["450"])) && !L.confere("x; 450_POCO REDONDO", new Set(["200"])));
  });
  await teste("Regionais: SANTO AMARO = 320 Santo Amaro das Brotas (Maruim); AMPARO DO SAO FRANCISCO = 480 Amparo de São Francisco (Propriá)", async () => {
    const L = window.Localidades, v = (loc) => { const x = L.classificar(loc); return [x.status, x.chave, x.nome, x.regional_nome, x.original]; };
    igual(v("Dispositivo: SANTO AMARO"), ["ok", "320", "Santo Amaro das Brotas", "Regional Maruim", "SANTO AMARO"]);
    igual(v("x; 320_SANTO AMARO DAS BROTAS")[1], "320"); igual(v("x; 320_SANTO AMARO")[1], "320");
    igual(v("End:: R; AMPARO DO SAO FRANCISCO"), ["ok", "480", "Amparo de São Francisco", "Regional Propriá", "AMPARO DO SAO FRANCISCO"]);
    igual([v("x; 480_AMPARO DE SAO FRANCISCO")[1], v("x; 480_AMPARO DO SAO FRANCISCO")[1]], ["480", "480"]);
    igual([L.classificar("x; 999_SANTO AMARO").chave, L.classificar("x; 33_AMPARO DO SAO FRANCISCO").chave], ["320", "480"], "código fora dos mapas não impede o nome");
    igual([L.classificar("x; 220_SANTO AMARO").status, L.classificar("x; 468_AMPARO DO SAO FRANCISCO").status], ["divergente", "divergente"], "código de OUTRO município de Sergipe = revisão");
  });
  await teste("Regionais: código 350 só como Canindé (Glória); nenhum município de Maruim com 350", async () => {
    const L = window.Localidades;
    igual(L.MUNICIPIOS.filter((m) => m.codigo === "350").map((m) => [m.regional, m.nome]), [["gloria", "Canindé de São Francisco"]]);
    verdade(!L.chavesDaRegional("maruim").includes("350"));
    igual([L.classificar("x; 350_CANINDE DE SAO FRANCISCO").regional, L.classificar("x; 350_MARUIM").status], ["gloria", "divergente"]);
  });
  await teste("Regionais: seleção (regional inteira, um, vários, regionais diferentes, desmarcar um, limpar) e texto compacto", async () => {
    const L = window.Localidades, locs = { aju: "x; 1_ARACAJU", sc: "x; 620_SAO CRISTOVAO", ita: "x; 30_ITABAIANA", ab: "x; 50_AREIA BRANCA", mon: "x; 420_MONTE ALEGRE DE SERGIPE", pr: "x; 450_POCO REDONDO" };
    const passa = (sel) => Object.entries(locs).filter(([, l]) => L.confere(l, sel)).map(([n]) => n);
    igual(passa(new Set()), Object.keys(locs), "vazia = todos");
    const ita = new Set(L.chavesDaRegional("itabaiana")); igual(passa(ita), ["ita", "ab"], "regional inteira");
    igual(L.descrever(ita), "Regional Itabaiana");
    ita.delete("050"); igual(passa(ita), ["ita"], "desmarcar um município depois da regional inteira");
    igual(L.descrever(ita).startsWith("Itabaiana, Campo do Brito, Carira +"), true, L.descrever(ita));
    igual(passa(new Set(["030"])), ["ita"], "um município"); igual(passa(new Set(["030", "050"])), ["ita", "ab"], "vários da mesma regional");
    igual(passa(new Set(["001", "620"])), ["aju", "sc"], "regionais diferentes"); igual(L.descrever(new Set(["001", "620"])), "Aracaju, São Cristóvão");
    igual(passa(new Set(["420", "450"])), ["mon", "pr"]); igual(L.descrever(new Set()), "Todas as regionais");
  });
  await teste("Regionais: componente — instâncias independentes, clique na regional, desmarcar, pesquisa por nome/código, limpar", async () => {
    const F = window.FiltroRegionais, a = document.createElement("div"), b = document.createElement("div"), avisos = [];
    document.body.append(a, b);
    try {
      const fa = F.criar({ id: "t-fa", aoMudar: (s) => avisos.push(["a", s.size]) }).montar(a), fb = F.criar({ id: "t-fb", aoMudar: (s) => avisos.push(["b", s.size]) }).montar(b);
      const marcar = (el, sel) => { const x = el.querySelector(sel); x.checked = !x.checked; x.dispatchEvent(new Event("change", { bubbles: true })); };
      marcar(a, '[data-fr-regional="gloria"]'); igual(fa.selecao().size, 13, "regional inteira em um clique"); igual(fb.selecao().size, 0, "a outra instância não muda");
      marcar(a, '[data-fr-chave="450"]'); igual([fa.selecao().size, fa.selecao().has("450")], [12, false], "só o desmarcado sai");
      const rg = a.querySelector('[data-fr-regional="gloria"]'); igual([rg.checked, rg.indeterminate], [false, true], "regional parcial");
      marcar(b, '[data-fr-chave="001"]'); marcar(b, '[data-fr-chave="620"]'); igual([...fb.selecao()].sort(), ["001", "620"]); igual(fa.selecao().size, 12);
      igual(b.querySelector(".fr-resumo").textContent, "Aracaju, São Cristóvão"); igual(b.querySelector(".fr-badge").textContent, "2");
      fa.atualizar(new Map([["340", 5], ["350", 2]])); igual(a.querySelector('[data-fr-n="340"]').textContent, "5"); igual(a.querySelector('[data-fr-conta="gloria"]').textContent, "12/13 · 7");
      const busca = a.querySelector(".fr-busca"), vis = () => [...a.querySelectorAll("li:not(.oculto) [data-fr-chave]")].map((x) => x.dataset.frChave);
      busca.value = "monte"; busca.dispatchEvent(new Event("input", { bubbles: true })); igual(vis(), ["420"], "busca por nome");
      busca.value = "30"; busca.dispatchEvent(new Event("input", { bubbles: true })); igual(vis(), ["030", "300"], "busca por código: 30 = 030 (e 300 começa com 30)");
      busca.value = "461"; busca.dispatchEvent(new Event("input", { bubbles: true })); igual(vis(), ["461"]);
      busca.value = "sao cristovao"; busca.dispatchEvent(new Event("input", { bubbles: true })); igual(vis(), ["620"], "busca sem acento");
      busca.value = "1"; busca.dispatchEvent(new Event("input", { bubbles: true })); igual(vis(), ["001", "100", "110", "120", "130", "140", "150", "160", "170", "180", "190"], "código 1 = 001 e prefixo");
      a.querySelector('[data-fr-acao="limpar"]').click(); igual([fa.selecao().size, fb.selecao().size], [0, 2], "limpar só a própria");
      b.querySelector('[data-fr-remover="k:001"]').click(); igual([...fb.selecao()], ["620"], "remover pela etiqueta");
      igual(F.criar({ id: "t-fc", inicial: ["030", "inexistente", "?ambiguo", "?fora_se"] }).selecao().size, 2, "seleção salva inválida (ou categoria antiga) é ignorada");
      verdade(avisos.some(([q]) => q === "a") && avisos.some(([q]) => q === "b"));
    } finally { a.remove(); b.remove(); }
  });
  await teste("Regionais: formatos observados na tela (nome em qualquer trecho, ESE_Municipio_Pesquisa, ·, -, :) e as quatro categorias", async () => {
    const L = window.Localidades, c = (loc) => L.classificar(loc), r = (loc) => { const x = c(loc); return x.status === "ok" ? x.regional_nome : L.ESPECIAIS[x.chave]; };
    igual([r("CENTRO · SAO CRISTOVAO"), r("CENTRO · CARIRA"), r("ESE_Municipio_Pesquisa: ARACAJU"), r("CANHOBA"), r("ESE_Municipio_Pesquisa: NOSSA SENHORA DA GLORIA"),
      r("MANGABEIRA · JOAO PESSOA"), r(""), r("RUA X; ESTANCIA")],
      ["Regional São Cristóvão", "Regional Itabaiana", "Regional Aracaju", "Regional Propriá", "Regional Glória", "Fora da área de Sergipe", "Localidade desconhecida", "Localidade não reconhecida"]);
    igual([c("CENTRO · CARIRA").chave, c("ESE_Municipio_Pesquisa: ARACAJU").chave, c("CANHOBA").chave, c("CENTRO · SAO CRISTOVAO").chave, c("ESE_Municipio_Pesquisa: NOSSA SENHORA DA GLORIA").chave],
      ["070", "001", "510", "620", "430"], "códigos dos municípios reconhecidos pelo nome");
    const k = (loc) => c(loc).chave;
    igual([k("CARIRA"), k("70_CARIRA"), k("070_CARIRA"), k("Carira"), k("carira"), k("  CARIRA  ")], ["070", "070", "070", "070", "070", "070"], "sem código, com código, maiúsculas/minúsculas, espaços");
    igual([k("São Cristóvão"), k("SAO CRISTOVAO"), k("sao_cristovao"), k("CENTRO - SÃO CRISTÓVÃO"), k("RUA X; SAO CRISTOVAO"), k("Municipio: SAO CRISTOVAO")], ["620", "620", "620", "620", "620", "620"], "acento, sublinhado, hífen, ponto e vírgula, dois-pontos");
    igual([k("x; 620_ARACAJU"), k("ARACAJU; LAGARTO"), k("CENTRO · ARACAJU · JOAO PESSOA")], ["?divergente", "?divergente", "?divergente"], "código e nome realmente divergentes; dois municípios no mesmo campo");
    igual([k("x; 30_PEDRO REGIS"), k("x; 113_ITABAIANA")], ["?fora_se", "?fora_se"], "outro estado com código que coincide com código sergipano");
    igual(k("Dispositivo: LAGARTO; End:: RUA A_380_AP 101_ESPACO TROPICAL; 10_BARRA DOS COQUEIROS"), "010", "Dispositivo (nome do equipamento) não vence a cidade do endereço com código");
    igual(k("Dispositivo: MOITA BONITA; NOSSA SENHORA DAS DORES; End:: LD GRANDE_S/N_CASA_AREA RURAL; 150_RIBEIROPOLIS"), "150");
    igual([k("Dispositivo: ITABAIANA"), k("Dispositivo: ARACAJU; ESE_Municipio_Pesquisa: CARIRA")], ["030", "070"], "só Dispositivo: vale o equipamento; campo de município vence o equipamento");
    igual(Object.keys(L.ESPECIAIS), ["?desconhecida", "?nao_reconhecido", "?divergente", "?fora_se"]);
  });
  await teste("Regionais: incidente com várias comunicações é classificado pelo conjunto (comunicação vazia não esconde o município)", async () => {
    const L = window.Localidades, i = (...ls) => L.classificarIncidente(ls).chave;
    igual(i("", "RUA A_1_CENTRO; 70_CARIRA"), "070", "principal vazia + Carira");
    igual(i("RUA A_1_CENTRO; 70_CARIRA", "", "ESE_Municipio_Pesquisa: CARIRA"), "070");
    igual(i("x; 510_CANHOBA", "x; 541_JAPOATA"), "510", "dois municípios: vale a comunicação principal (a primeira)");
    igual(L.classificarIncidente(["x; 510_CANHOBA", "x; 541_JAPOATA"]).chaves, ["510", "541"], "e o incidente aparece nos dois municípios");
    igual(i("x; 180_LAGARTO", "x; 1_JOAO PESSOA"), "180", "principal em Sergipe");
    const d = L.classificarIncidente(["", "x; 510_CANHOBA", "x; 541_JAPOATA"]);
    igual([d.chave, d.chaves], ["?divergente", ["510", "541", "?divergente"]], "principal sem município e as outras em municípios diferentes = revisão");
    const sel = (...k) => new Set(k), r = L.classificarIncidente(["", "RUA A_1_CENTRO; 70_CARIRA"]);
    igual([L.confereIncidente(r, sel("070")), L.confereIncidente(r, sel("?desconhecida")), L.confereIncidente(r, sel()), L.confereIncidente(d, sel("541"))], [true, false, true, true]);
    igual([i("", ""), i("x; 1_JOAO PESSOA", ""), i("RUA X; ESTANCIA", "")], ["?desconhecida", "?fora_se", "?nao_reconhecido"]);
    verdade(Object.isFrozen(L.classificarIncidente(["", "x; 70_CARIRA"])));
  });
  await teste("Regionais: classificar não altera o registro nem o texto original da Localização", async () => {
    const L = window.Localidades, c = { localizacao: "End:: RUA A_1_X; 400_GRACHO CARDOSO", nome: "Teste" }, antes = JSON.stringify(c);
    const x = L.classificar(c.localizacao); verdade(Object.isFrozen(x), "resultado imutável (cache protegido)");
    igual(JSON.stringify(c), antes); igual(L.classificar(c.localizacao).original, "400_GRACHO CARDOSO");
  });
  await teste("Envio em lote: incidentes trazem localização e data da comunicação principal (base para os filtros); lote intacto", async () => {
    await abrirDia(S, "Polo Fictício", "OPF1"); const l = await importarLinhas([linha("CALL 0000901", "INC 0000900", "MOBILE: 79991000901")]);
    const antes = JSON.stringify(S.chamadas()), x = S.incidentesParaDisparo().find((i) => i.incidente === "INC 0000900"), c = S.obterChamada(l[0].id);
    igual([x.localizacao, x.horario_call], [c.localizacao, c.horario_call]); igual(JSON.stringify(S.chamadas()), antes, "consultar não altera o lote");
    await S.encerrarLote();
  });

  /* Datas do ADMS: formatos brasileiro e ISO (exportação automática); nada ambíguo é adivinhado. */
  await teste("Datas do ADMS: dd/mm/aaaa e aaaa-mm-dd, com segundos, frações e 'T'; mm/dd/aaaa com AM/PM; fuso e datas impossíveis são recusados", async () => {
    const ok = { "10/03/2026 08:15:32": "2026-03-10T08:15:32", "10/03/2026 08:15": "2026-03-10T08:15:00", "1/3/2026 8:05:09": "2026-03-01T08:05:09",
      "10/03/2026 08:15:32.123": "2026-03-10T08:15:32", "10-03-2026 08:15:32": "2026-03-10T08:15:32", "2026-03-10 08:15:32": "2026-03-10T08:15:32",
      "2026-03-10T08:15:32.1234567": "2026-03-10T08:15:32", "2026/03/10 08:15": "2026-03-10T08:15:00", " 10/03/2026   08:15:32 ": "2026-03-10T08:15:32",
      "03/10/2026 8:15:32 AM": "2026-03-10T08:15:32" }; // com AM/PM: mês/dia (formato do chamadas_incidentes.csv da pasta ADMS)
    for (const [v, iso] of Object.entries(ok)) igual(N.lerDataHora(v), iso, v);
    for (const v of ["31/02/2026 10:00:00", "13/25/2026 8:15:32 AM", "2026-03-10T08:15:32Z", "2026-03-10 08:15:32-03:00", "10/03-2026 08:15", "10/03/2026 24:00:00", "", "ontem"]) igual(N.lerDataHora(v), null, v);
    const [c, avisos] = N.tratar({ valores: { call_id: "1", horario_call: "13/10/2026 8:15:32 PM" } }); // mês 13: impossível
    igual(c.horario_call, null, "não inventa"); verdade(avisos[0][2].includes("99/99/9999 9:99:99 AA") && !avisos[0][2].includes("13/10/2026"), "aviso mostra só o formato");
  });
  await teste("Diagnóstico do CSV: colunas, separador e formato das datas, sem dados de clientes", async () => {
    const csv = '"ID";"Horário da call";"Recebido ADMS";"Nome do reclamante"\r\n"CALL 1";"2026-03-10 08:15:32.000";"10/03/2026 08:16:00";"Fulano de Tal"\r\n"CALL 2";"13/10/2026 8:15 PM";"";"Beltrano"\r\n';
    const d = N.diagnosticoCSV(new TextEncoder().encode(csv));
    igual([d.separador, d.linhas, d.cabecalho], [";", 2, ["ID", "Horário da call", "Recebido ADMS", "Nome do reclamante"]]);
    igual([d.datas.horario_call.reconhecidas, d.datas.horario_call.formatos_nao_reconhecidos], [1, { "99/99/9999 9:99 AA": 1 }]);
    igual([d.datas.recebido_adms.reconhecidas, d.datas.recebido_adms.vazias], [1, 1]);
    verdade(!/Fulano|Beltrano|CALL 1/.test(JSON.stringify(d)), "dado de cliente no diagnóstico");
  });

  /* Pasta ADMS (js/pasta-adms.js): nova versão do CSV substitui os dados do lote da pasta sem somar de novo. */
  await teste("Pasta ADMS: versão nova no lote aberto não duplica, preserva registros e mantém métricas por CALL", async () => {
    await abrirDia(S);
    const b1 = loteCSV(4); const l = await S.importar("chamadas_incidentes.csv", b1, N.sha256Hex(b1), "pasta_adms");
    igual(l.origem, "pasta_adms"); verdade(S.arquivoNaBase(N.sha256Hex(b1)), "conteúdo na base");
    const [c1] = S.chamadas(); await S.registrar(c1.id, "callback_realizado", "whatsapp");
    const ids = S.chamadas().map((c) => c.id);
    const b2 = loteCSV(6); const r = await S.atualizarLote("chamadas_incidentes.csv", b2, N.sha256Hex(b2));
    igual([r.novas, r.atualizadas, r.preservadas, r.fora_do_arquivo], [2, 3, 1, 0]);
    igual(S.chamadas().length, 6); igual(new Set(S.chamadas().map((c) => c.call_id)).size, 6, "CALL repetida");
    verdade(ids.every((id) => S.chamadas().some((c) => c.id === id)), "mesmos ids para as CALLs que já estavam");
    igual(S.obterChamada(c1.id).estado, "callback_realizado"); igual(S.obterChamada(c1.id).tentativas.length, 1);
    igual(S.estado().lotes.length, 1); igual(S.loteAberto().atualizacoes, 1);
    verdade(S.arquivoNaBase(N.sha256Hex(b1)) && S.arquivoNaBase(N.sha256Hex(b2)), "as duas versões reconhecidas");
    const b3 = loteCSV(3, 3); const r3 = await S.atualizarLote("chamadas_incidentes.csv", b3, N.sha256Hex(b3));
    igual([r3.novas, r3.fora_do_arquivo, S.chamadas().length], [0, 3, 6], "CALL que saiu do arquivo continua no lote");
    await falhaCom(() => S.atualizarLote("x.csv", b3, "0".repeat(64)), "mudou durante a leitura");
    await S.encerrarLote();
    const m = S.metricasDia(); igual([m.chamadas_processadas, m.callbacks_realizados], [6, 1]);
  });
  await teste("Pasta ADMS: lote importado à mão não recebe versão da pasta; sem lote, recusa", async () => {
    await abrirDia(S);
    await falhaCom(() => S.atualizarLote("c.csv", loteCSV(2), null), "Não há lote aberto");
    await importar(S, loteCSV(2));
    await falhaCom(() => S.atualizarLote("c.csv", loteCSV(3), null), "importado manualmente");
    igual(S.chamadas().length, 2); verdade(!S.loteAberto().origem, "importação manual sem origem");
  });

  /* ==================================================== data/hora do ADMS (Horario_Call / Recebido_Adms) e filtro por data */
  const REAL = { "Horário da call": "Horario_Call", "Recebido ADMS": "Recebido_Adms" };
  function gerarCSVReal(linhas, nomes = REAL) { // cabeçalho como no chamadas_incidentes.csv da pasta ADMS
    let t = CAB.map((c) => q(nomes[c] || c)).join(";") + "\r\n";
    for (const l of linhas) t += CAB.map((c) => q(l[c] ?? "")).join(";") + "\r\n";
    return new TextEncoder().encode(t);
  }
  const brData = (iso, hh = "09:30:00") => iso.split("-").reverse().join("/") + " " + hh;
  const somarDias = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const HOJE = N.hojeLocal(), ONTEM = somarDias(HOJE, -1), ANTIGA = somarDias(HOJE, -10), FUTURA = somarDias(HOJE, 2);
  const semHora = (l, recebido = "") => Object.assign(l, { "Horário da call": "", "Recebido ADMS": recebido });
  const cenarioDatas = () => [
    linha("CALL 0000901", "INC 0000901", "MOBILE: 79991000901", "", { horario: brData(HOJE, "08:00:00") }),
    linha("CALL 0000902", "INC 0000902", "MOBILE: 79991000902", "", { horario: brData(HOJE, "10:00:00") }),
    linha("CALL 0000903", "INC 0000903", "MOBILE: 79991000903", "", { horario: brData(ONTEM, "23:59:00") }),
    linha("CALL 0000904", "INC 0000904", "MOBILE: 79991000904", "", { horario: brData(ANTIGA) }),
    linha("CALL 0000905", "INC 0000905", "MOBILE: 79991000905", "", { horario: brData(FUTURA) }),
    semHora(linha("CALL 0000906", "INC 0000906", "MOBILE: 79991000906")), // sem data nenhuma
    semHora(linha("CALL 0000907", "INC 0000907", "MOBILE: 79991000907"), brData(HOJE, "07:00:00")), // só Recebido ADMS
  ];
  await teste("Data ADMS 1: CSV com cabeçalho ANTIGO ('Horário da call' / 'Recebido ADMS') continua reconhecido", () => {
    const a = N.analisar(gerarCSV([linha("CALL 1", "INC 1", "MOBILE: 79991000001", "", { horario: "12/11/2026 14:35:10" })]));
    igual([a.resumo.colunas_ausentes, a.validas[0].horario_call, a.validas[0].recebido_adms], [[], "2026-11-12T14:35:10", "2026-11-12T14:35:10"]);
  });
  await teste("Data ADMS 2: CSV REAL da pasta ('Horario_Call' / 'Recebido_Adms') reconhece data e hora", () => {
    const b = gerarCSVReal([linha("CALL 1", "INC 1", "MOBILE: 79991000001", "", { horario: "12/11/2026 14:35:10" })]);
    const a = N.analisar(b), arq = N.lerCSV(b), d = N.diagnosticoCSV(b);
    igual([arq.colunas_reconhecidas.horario_call, arq.colunas_reconhecidas.recebido_adms], ["Horario_Call", "Recebido_Adms"]);
    verdade(!a.resumo.colunas_ausentes.includes("Horário da call") && !a.resumo.colunas_ausentes.includes("Recebido ADMS"), JSON.stringify(a.resumo.colunas_ausentes));
    igual([a.validas[0].horario_call, a.validas[0].recebido_adms, N.formatarDataHora(a.validas[0].horario_call)], ["2026-11-12T14:35:10", "2026-11-12T14:35:10", "12/11/2026 14:35:10"]);
    igual([d.datas.horario_call.coluna, d.datas.horario_call.reconhecidas, d.datas.recebido_adms.coluna], ["Horario_Call", 1, "Recebido_Adms"]);
    igual(a.erros, [], "sem aviso de data");
  });
  await teste("Data ADMS 2b: cabeçalho tolera maiúsculas, acentos, espaços e '_' (sem inventar data)", () => {
    for (const nome of ["HORARIO_CALL", "horario_call", "Horário_Call", " Horario  Call ", "Horario_Call:"]) {
      const a = N.analisar(gerarCSVReal([linha("CALL 1", "INC 1", "", "", { horario: "01/11/2026 05:02:29" })], { "Horário da call": nome, "Recebido ADMS": "RECEBIDO_ADMS" }));
      igual([a.validas[0].horario_call, a.validas[0].recebido_adms], ["2026-11-01T05:02:29", "2026-11-01T05:02:29"], nome);
    }
    const vazio = N.analisar(gerarCSVReal([semHora(linha("CALL 1", "INC 1"))])).validas[0];
    igual([vazio.horario_call, vazio.recebido_adms], [null, null], "vazio continua vazio (nunca a data da importação)");
  });
  await teste("Filtro por data 3-6: hoje, ontem, outras datas e sem data (data real do incidente)", () => {
    const g = N.agruparIncidentes(N.analisar(gerarCSVReal(cenarioDatas())).validas), dias = new Map(g.map((x) => [x.incidente, N.dataDoIncidente(x)]));
    igual(dias.get("INC 0000903"), { dia: ONTEM, iso: ONTEM + "T23:59:00", origem: "horario_call" });
    igual(dias.get("INC 0000906"), { dia: null, iso: null, origem: null }, "sem data não vira hoje");
    igual(dias.get("INC 0000907"), { dia: HOJE, iso: HOJE + "T07:00:00", origem: "recebido_adms" }, "Recebido ADMS marcado como recebimento");
    const em = (f) => g.filter((x) => N.conferirFiltroData(dias.get(x.incidente).dia, f, HOJE)).map((x) => x.incidente).sort();
    igual(em(N.filtroDataPadrao()), ["INC 0000901", "INC 0000902", "INC 0000907"], "padrão = hoje");
    igual(em({ modo: "periodo", de: ONTEM, ate: ONTEM }), ["INC 0000903"], "ontem");
    igual(em({ modo: "periodo", de: ANTIGA, ate: ANTIGA }), ["INC 0000904"], "data antiga");
    igual(em({ modo: "periodo", de: FUTURA, ate: "" }), ["INC 0000905"], "data futura");
    igual(em({ modo: "sem_data" }), ["INC 0000906"], "sem data, à parte");
    igual(em({ modo: "todas" }).length, 7, "todas as datas");
    igual(N.resumoFiltroData([...dias.values()].map((d) => d.dia), N.filtroDataPadrao(), HOJE), { total: 7, no_filtro: 3, outras_datas: 3, sem_data: 1, hoje: 3 });
  });
  await teste("Filtro por data 7-8: intervalo (inclusive, invertido, só início/fim) e botão Hoje", () => {
    const f = N.normalizarFiltroData;
    igual(f({ modo: "periodo", de: HOJE, ate: ONTEM }), { modo: "periodo", de: HOJE, ate: ONTEM }, "datas do operador não são trocadas");
    verdade(!N.conferirFiltroData(HOJE, { modo: "periodo", de: HOJE, ate: ONTEM }, HOJE), "início depois do fim = período vazio");
    verdade(N.conferirFiltroData(HOJE, { modo: "periodo", de: ONTEM, ate: "" }, HOJE) && !N.conferirFiltroData(ANTIGA, { modo: "periodo", de: ONTEM, ate: "" }, HOJE), "só data inicial");
    verdade(N.conferirFiltroData(ANTIGA, { modo: "periodo", de: "", ate: ONTEM }, HOJE) && !N.conferirFiltroData(HOJE, { modo: "periodo", de: "", ate: ONTEM }, HOJE), "só data final");
    igual(f({ modo: "periodo", de: "", ate: "" }), { modo: "todas", de: "", ate: "" }, "período vazio = todas");
    igual(f({ modo: "xyz" }), { modo: "hoje", de: "", ate: "" }, "inválido = hoje");
    verdade(N.conferirFiltroData(ONTEM, { modo: "periodo", de: ONTEM, ate: HOJE }, HOJE) && N.conferirFiltroData(HOJE, { modo: "periodo", de: ONTEM, ate: HOJE }, HOJE), "limites inclusivos");
    verdade(!N.conferirFiltroData(ANTIGA, { modo: "periodo", de: ONTEM, ate: HOJE }, HOJE) && !N.conferirFiltroData(null, { modo: "periodo", de: ONTEM, ate: HOJE }, HOJE), "fora do intervalo / sem data");
    verdade(N.conferirFiltroData(HOJE, { modo: "hoje" }, HOJE) && !N.conferirFiltroData(ONTEM, { modo: "hoje" }, HOJE), "Hoje");
    igual(N.descreverFiltroData({ modo: "hoje" }, "2026-11-12"), "Hoje (12/11/2026)");
    igual(N.descreverFiltroData({ modo: "periodo", de: "2026-11-10", ate: "2026-11-12" }), "10/11/2026 a 12/11/2026");
  });
  await teste("Filtro por data 9: envio em lote recebe a data do incidente; só o filtrado entra na fila; confirmado não volta", async () => {
    await abrirDia(S); await importar(S, gerarCSVReal(cenarioDatas()), "chamadas_incidentes.csv");
    const lista = S.incidentesParaDisparo(), hoje = lista.filter((x) => N.conferirFiltroData(x.data_incidente.dia, N.filtroDataPadrao(), HOJE));
    igual(hoje.map((x) => x.incidente).sort(), ["INC 0000901", "INC 0000902", "INC 0000907"]);
    const feito = hoje[0]; await S.registrar(feito.id, "callback_realizado", "whatsapp");
    const elegiveis = S.incidentesParaDisparo().filter((x) => x.elegivel && N.conferirFiltroData(x.data_incidente.dia, N.filtroDataPadrao(), HOJE));
    verdade(!elegiveis.some((x) => x.chave === feito.chave), "callback confirmado não fica elegível");
    const f = await S.iniciarAtendimento(elegiveis.map((x) => x.chave));
    igual(f.itens.map((i) => i.incidente).sort(), elegiveis.map((x) => x.incidente).sort(), "fila = só os de hoje");
    verdade(f.itens.every((i) => ![ "INC 0000903", "INC 0000904", "INC 0000905", "INC 0000906"].includes(i.incidente)), "nenhuma outra data na fila");
    await S.cancelarAtendimento(f.id);
    const recusa = await S.iniciarAtendimento([feito.chave]).then(() => "aceitou", (e) => e.message);
    verdade(recusa.includes("Nenhum incidente"), "confirmado não é reenviado: " + recusa);
  });
  await teste("Filtro por data 10: callbacks, tentativas e histórico preservados; nova versão (Horario_Call) não altera registros", async () => {
    await abrirDia(S); const b1 = gerarCSV(cenarioDatas()); // lote com cabeçalho antigo, vindo da pasta
    await S.importar("chamadas_incidentes.csv", b1, N.sha256Hex(b1), "pasta_adms");
    const [c1, c2] = S.chamadas();
    await S.registrar(c1.id, "callback_realizado", "whatsapp"); await S.registrar(c2.id, "sem_sucesso", "ligacao");
    const antes = JSON.stringify([S.obterChamada(c1.id), S.obterChamada(c2.id)]), hist = JSON.stringify(S.E.historico_atendimento);
    const b2 = gerarCSVReal(cenarioDatas()); const r = await S.atualizarLote("chamadas_incidentes.csv", b2, N.sha256Hex(b2));
    igual([r.novas, r.preservadas], [0, 2]);
    igual(JSON.stringify([S.obterChamada(c1.id), S.obterChamada(c2.id)]), antes, "registros do operador intactos");
    igual(JSON.stringify(S.E.historico_atendimento), hist, "histórico intacto");
    igual(S.chamadas().length, 7, "nada removido pelo filtro");
    verdade(S.chamadas().filter((c) => c.id !== c1.id && c.id !== c2.id && c.call_id !== "CALL 0000906").every((c) => c.horario_call || c.recebido_adms), "datas lidas na versão nova");
  });

  /* ==================================================== Preencher datas ausentes (lote gravado pelo parser antigo) */
  const LEGADO = { "Horário da call": "HC_LEGADO", "Recebido ADMS": "RA_LEGADO" }; // colunas não reconhecidas = datas vazias, como no parser antigo
  const linhasDatas = () => [1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => linha(`CALL 00008${i}0`, `INC 00008${i}0`, `MOBILE: 79 9910-08${i}0`, "", { horario: brData(HOJE, `0${i}:00:00`) }));
  const clonarJ = (x) => JSON.parse(JSON.stringify(x));
  const semCampos = (c) => { const x = { ...c }; delete x.horario_call; delete x.recebido_adms; return x; };
  async function loteLegado() { // lote aberto com 9 chamadas sem data; algumas com registro do operador
    await abrirDia(S); await importar(S, gerarCSVReal(linhasDatas(), LEGADO), "legado.csv");
    const cs = S.chamadas(), id = (n) => cs.find((c) => c.call_id === `CALL 00008${n}0`).id;
    verdade(cs.every((c) => !c.horario_call && !c.recebido_adms), "lote legado sem datas");
    await S.registrar(id(1), "callback_realizado", "whatsapp", "obs fictícia"); await S.registrar(id(2), "sem_sucesso", "ligacao");
    await S.registrarResultado(id(1), "servico_executado");
    // CALL 9: já tem horario_call (não pode ser sobrescrito); falta só recebido_adms (registro de versão anterior, sem o campo)
    await S._alterar((E) => { const c = E.chamadas.find((x) => x.id === id(9)); c.horario_call = HOJE + "T23:00:00"; delete c.recebido_adms; });
    return id;
  }
  function csvAtualDatas() { // CSV ATUAL da pasta (cabeçalho real)
    const ls = linhasDatas();
    const sem3 = ls.filter((l) => l.ID !== "CALL 0000830"); // CALL 3: sem correspondência
    const dup4 = { ...ls[3], "Horário da call": brData(ONTEM, "04:00:00") }; // CALL 4 com datas diferentes: ambígua
    sem3.find((l) => l.ID === "CALL 0000850").Incidente = "INC 9999999"; // CALL 5: incidente divergente: ambígua
    semHora(sem3.find((l) => l.ID === "CALL 0000860")); // CALL 6: sem data válida no CSV
    semHora(sem3.find((l) => l.ID === "CALL 0000870"), brData(HOJE, "06:30:00")); // CALL 7: só Recebido ADMS
    sem3.find((l) => l.ID === "CALL 0000890")["Horário da call"] = brData(ONTEM, "11:11:11"); // CALL 9: data diferente da gravada
    return gerarCSVReal(sem3.concat([dup4, { ...ls[0] }])); // CALL 1 repetida com valores idênticos: não é ambígua
  }
  await teste("Preencher datas: prévia conta ausentes, horário, recebido, sem correspondência e ambíguos — sem gravar nada", async () => {
    await loteLegado(); const rev = S.arm.revisao, antes = JSON.stringify(S.E);
    const p = S.previaDatas(csvAtualDatas());
    igual([p.chamadas_no_lote, p.com_datas_ausentes, p.sem_horario_call, p.sem_recebido_adms], [9, 9, 8, 9]);
    igual([p.recebem_horario_call, p.recebem_recebido_adms, p.registros_a_atualizar, p.sem_correspondencia, p.ambiguas, p.sem_data_no_csv], [3, 5, 5, 1, 2, 1]);
    igual(p.colunas_de_data, { horario_call: "Horario_Call", recebido_adms: "Recebido_Adms" });
    igual([S.arm.revisao, JSON.stringify(S.E)], [rev, antes], "prévia não grava");
  });
  await teste("Preencher datas: só os 2 campos vazios; nada inserido/removido; data existente nunca sobrescrita; operador e histórico idênticos", async () => {
    const id = await loteLegado(), b = csvAtualDatas(), p = S.previaDatas(b);
    const antes = clonarJ(S.E), r = await S.preencherDatas(b, p.sha256, p.lote_id);
    igual([r.gravados, r.recebem_horario_call, r.recebem_recebido_adms, r.sem_correspondencia, r.ambiguas, r.sem_data_no_csv], [5, 3, 5, 1, 2, 1]);
    const c = (n) => S.obterChamada(id(n));
    igual([c(1).horario_call, c(1).recebido_adms], [HOJE + "T01:00:00", HOJE + "T01:00:00"], "CALL 1 (com callback) recebeu as datas");
    igual([c(2).horario_call, c(8).horario_call], [HOJE + "T02:00:00", HOJE + "T08:00:00"]);
    igual([c(3).horario_call, c(4).horario_call, c(5).horario_call, c(6).horario_call, c(6).recebido_adms], [null, null, null, null, null], "não identificados/ambíguos/sem data continuam vazios");
    igual([c(7).horario_call, c(7).recebido_adms], [null, HOJE + "T06:30:00"], "só recebimento");
    igual([c(9).horario_call, c(9).recebido_adms], [HOJE + "T23:00:00", HOJE + "T09:00:00"], "horário existente NÃO sobrescrito (CSV traz outro); recebido vazio preenchido");
    igual(S.E.chamadas.length, antes.chamadas.length, "nada inserido nem removido");
    igual(S.E.chamadas.map((x) => x.id), antes.chamadas.map((x) => x.id), "mesmos registros, mesma ordem");
    igual(S.E.chamadas.map(semCampos), antes.chamadas.map(semCampos), "nenhum outro campo das chamadas mudou (estado, tentativas, callbacks, WhatsApp, observações, grupo)");
    for (const k of ["historico_atendimento", "marcas", "disparos", "callbacks_manuais", "sessao", "exportacoes", "dias_encerrados"]) igual(S.E[k], antes[k], k + " intacto");
    igual([c(1).estado, c(1).tentativas.length, !!c(1).servico_executado_em, c(1).observacao, c(2).tentativas.length], ["callback_realizado", 1, true, "obs fictícia", 1]);
    const auditoria = S.loteAberto().preenchimento_datas; igual([auditoria.length, auditoria[0].registros], [1, 5], "registro de auditoria no lote");
    const r2 = await S.preencherDatas(b, p.sha256, p.lote_id); igual(r2.gravados, 0, "segunda execução não muda nada");
  });
  await teste("Preencher datas: tudo ou nada (falha na gravação não deixa nada alterado) e recusa arquivo/lote diferente da prévia", async () => {
    await loteLegado(); const b = csvAtualDatas(), p = S.previaDatas(b), antes = JSON.stringify(S.E), gravar = S.arm.gravar;
    S.arm.gravar = () => Promise.reject(new Error("falha simulada do disco"));
    try { await falhaCom(() => S.preencherDatas(b, p.sha256, p.lote_id), "falha simulada"); } finally { S.arm.gravar = gravar; }
    igual(JSON.stringify(S.E), antes, "nada alterado em memória");
    await S.carregar(); igual(S.chamadas().filter((c) => c.horario_call).length, 1, "nada gravado no armazenamento (só a CALL 9 já tinha)");
    await falhaCom(() => S.preencherDatas(b, "0".repeat(64), p.lote_id), "arquivo mudou");
    await falhaCom(() => S.preencherDatas(b, p.sha256, "outro-lote"), "lote mudou");
  });

  /* ==================================================== chamadas_incidentes.csv REAL da pasta ADMS (12/11/2026)
     Estrutura conferida no arquivo da rede: UTF-8 com BOM, separador ",", sem aspas, CRLF, 26 colunas nesta ordem, datas
     mm/dd/aaaa h:mm:ss AM|PM e contato só com dígitos. Valores FICTÍCIOS (nenhum dado de cliente real). */
  const CAB_PASTA = ["ID", "Incidente", "Prioridade_Chamada", "Motivo", "submotivo", "Comentario", "Emergencia", "Nome_do_Consumidor",
    "Protocolo", "Contato_Do_Consumidor", "Localizacao", "UC", "Tipo_UC", "Prioridade_Consumidor", "Nome", "Roteiro", "Horario_Call",
    "Horario_agendado", "Recebido_Adms", "RecUser", "Callback", "Medidor_ID", "tipo_medidor", "Anexos", "Notas_endereco", "codigo_localidade"];
  const DE_PARA_PASTA = { ID: "ID", Incidente: "Incidente", Motivo: "Motivo", submotivo: "Submotivos", Comentario: "Comentário",
    Nome_do_Consumidor: "Nome do reclamante", Protocolo: "Protocolo", Contato_Do_Consumidor: "Contato do reclamante", Localizacao: "Localização",
    UC: "UC", Tipo_UC: "Tipo UC:", Horario_Call: "Horário da call", Recebido_Adms: "Recebido ADMS", Medidor_ID: "Medidor ID", Notas_endereco: "Nota do endereço" };
  const FIXOS_PASTA = { Prioridade_Chamada: "1", Prioridade_Consumidor: "Normal", Nome: "Operador Ficticio", Roteiro: "R1", RecUser: "usuario_ficticio", Callback: "Sim", codigo_localidade: "1" };
  const campoCSV = (v) => (/[",\r\n]/.test(String(v)) ? q(v) : String(v));
  // "dd/mm/aaaa hh:mm:ss" (24 h) -> "m/d/aaaa h:mm:ss AM|PM", como o ADMS grava na pasta
  function paraAMPM(br) {
    if (!br) return "";
    const [, d, m, a, h, mi, s] = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(br), hh = +h;
    return `${+m}/${+d}/${a} ${hh % 12 === 0 ? 12 : hh % 12}:${mi}:${s} ${hh < 12 ? "AM" : "PM"}`;
  }
  function gerarCSVPasta(linhas) {
    let t = "﻿" + CAB_PASTA.join(",") + "\r\n";
    for (const l of linhas) t += CAB_PASTA.map((c) => {
      const v = DE_PARA_PASTA[c] ? l[DE_PARA_PASTA[c]] ?? "" : FIXOS_PASTA[c] ?? "";
      return campoCSV(c === "Horario_Call" || c === "Recebido_Adms" ? paraAMPM(v) : c === "Contato_Do_Consumidor" ? String(v).replace(/\D/g, "") : v);
    }).join(",") + "\r\n";
    return new TextEncoder().encode(t);
  }

  await teste("AM/PM 1: equivalência obrigatória — '12/11/2026 18:13:51' (Navegador) = '11/12/2026 6:13:51 PM' (pasta ADMS)", () => {
    igual(N.lerDataHora("12/11/2026 18:13:51"), "2026-11-12T18:13:51");
    igual(N.lerDataHora("11/12/2026 6:13:51 PM"), "2026-11-12T18:13:51");
    igual(N.formatarDataHora(N.lerDataHora("11/12/2026 6:13:51 PM")), "12/11/2026 18:13:51");
    // pares reais (só datas) da comparação Navegador x pasta ADMS de 12/11/2026
    for (const [br, us] of [["12/11/2026 18:11:03", "11/12/2026 6:11:03 PM"], ["12/11/2026 17:42:58", "11/12/2026 5:42:58 PM"], ["12/11/2026 18:13:53", "11/12/2026 6:13:53 PM"]])
      igual(N.lerDataHora(us), N.lerDataHora(br), us);
  });
  await teste("AM/PM 2: AM, PM, meia-noite, meio-dia, mês e dia com um dígito", () => {
    const ok = {
      "10/7/2026 11:31:20 AM": "2026-10-07T11:31:20", "10/7/2026 4:36:59 PM": "2026-10-07T16:36:59", "11/9/2026 9:05:00 AM": "2026-11-09T09:05:00",
      "11/12/2026 12:00:00 AM": "2026-11-12T00:00:00", "11/12/2026 12:59:59 AM": "2026-11-12T00:59:59", "11/12/2026 1:00:00 AM": "2026-11-12T01:00:00",
      "11/12/2026 12:00:00 PM": "2026-11-12T12:00:00", "11/12/2026 12:30:15 PM": "2026-11-12T12:30:15", "11/12/2026 1:00:00 PM": "2026-11-12T13:00:00",
      "11/12/2026 11:59:59 PM": "2026-11-12T23:59:59", "1/2/2026 3:04:05 AM": "2026-01-02T03:04:05", "01/02/2026 03:04:05 PM": "2026-01-02T15:04:05",
      "2/28/2026 8:00 PM": "2026-02-28T20:00:00", "11/12/2026 6:13:51 pm": "2026-11-12T18:13:51", " 11/12/2026  6:13:51  PM ": "2026-11-12T18:13:51",
    };
    for (const [v, iso] of Object.entries(ok)) igual(N.lerDataHora(v), iso, v);
  });
  await teste("AM/PM 3: datas/horas impossíveis e valores vazios são recusados; sem AM/PM nada é adivinhado", () => {
    for (const v of ["11/12/2026 0:10:00 AM", "11/12/2026 13:00:00 PM", "11/12/2026 6:60:00 PM", "11/12/2026 6:13:61 PM", "2/30/2026 6:13:51 PM",
      "13/12/2026 6:13:51 PM", "0/12/2026 6:13:51 PM", "11/0/2026 6:13:51 PM", "11/12/2026 6:13:51PM", "11/12/2026 6:13:51 XM", "11-12-2026 6:13:51 PM",
      "11/12/26 6:13:51 PM", "11/12/2026 PM", "11/12/2026 6:13:51 PM -03:00"]) igual(N.lerDataHora(v), null, v);
    for (const v of ["", "   ", null, undefined]) igual(N.lerDataHora(v), null, String(v));
    igual(N.tratar({ valores: { call_id: "1", horario_call: "", recebido_adms: " " } })[1], [], "vazio não gera aviso");
    igual(N.lerDataHora("11/12/2026 18:13:51"), "2026-12-11T18:13:51", "sem AM/PM continua dia/mês (inalterado)");
    igual(N.lerDataHora("11/30/2026 18:13:51"), null, "sem AM/PM, mês 30 não é reinterpretado como mm/dd");
  });
  await teste("Pasta ADMS real: cabeçalho, separador ',', BOM e aliases (contato, nome, submotivo, nota do endereço)", () => {
    const b = gerarCSVPasta([linha("CALL 0000701", "INC 0000701", "79991000701", "Sem energia", { horario: "12/11/2026 18:13:51", submotivos: "FE" })]);
    const arq = N.lerCSV(b), a = N.analisar(b), v = a.validas[0];
    igual([arq.codificacao, arq.separador, arq.tinha_linha_sep, arq.cabecalho.length], ["utf-8", ",", false, 26]);
    igual([arq.colunas_reconhecidas.contato, arq.colunas_reconhecidas.nome_reclamante, arq.colunas_reconhecidas.submotivos, arq.colunas_reconhecidas.nota_endereco,
      arq.colunas_reconhecidas.horario_call, arq.colunas_reconhecidas.recebido_adms], ["Contato_Do_Consumidor", "Nome_do_Consumidor", "submotivo", "Notas_endereco", "Horario_Call", "Recebido_Adms"]);
    verdade(!arq.colunas_desconhecidas.some((c) => ["Contato_Do_Consumidor", "Nome_do_Consumidor", "submotivo", "Notas_endereco"].includes(c)), JSON.stringify(arq.colunas_desconhecidas));
    // aliases antigos continuam valendo
    const antigo = N.lerCSV(gerarCSV([linha("CALL 1", "INC 1", "MOBILE: 79991000001")])).colunas_reconhecidas;
    igual([antigo.contato, antigo.nome_reclamante, antigo.submotivos, antigo.nota_endereco, antigo.horario_call], ["Contato do reclamante", "Nome do reclamante", "Submotivos", "Nota do endereço", "Horário da call"]);
    igual([v.horario_call, v.recebido_adms, v.nome, v.submotivos], ["2026-11-12T18:13:51", "2026-11-12T18:13:51", "Cliente Fictício 0000701", "FE"]);
    igual(a.erros, [], "sem aviso de data");
  });
  await teste("Pasta ADMS real: telefone extraído de 'Contato_Do_Consumidor' (celular, fixo, inválido e vazio)", () => {
    const ls = [linha("CALL 0000711", "INC 0000711", "79991000711"), linha("CALL 0000712", "INC 0000712", "7932000712"),
      linha("CALL 0000713", "INC 0000713", "0000000000"), linha("CALL 0000714", "INC 0000714", "")];
    const a = N.analisar(gerarCSVPasta(ls)), t = (call) => a.validas.find((x) => x.call_id === call).telefones;
    igual(t("CALL 0000711").map((x) => [x.numero, x.tipo, x.origem]), [["79991000711", "celular", "contato_reclamante"]]);
    igual(t("CALL 0000712").map((x) => [x.numero, x.tipo]), [["7932000712", "fixo"]]);
    igual(t("CALL 0000713").map((x) => x.tipo), ["invalido"]); igual(t("CALL 0000714"), []);
    // mesma regra do cabeçalho antigo: o resultado é idêntico ao da exportação do Navegador
    const antigo = N.analisar(gerarCSV(ls)).validas.map((x) => x.telefones.map((y) => [y.numero, y.tipo]));
    igual(a.validas.map((x) => x.telefones.map((y) => [y.numero, y.tipo])), antigo, "mesmas regras de telefone");
  });
  const cenarioPasta = () => [
    linha("CALL 0000721", "INC 0000721", "79991000721", "", { horario: brData(HOJE, "00:05:00") }),
    linha("CALL 0000722", "INC 0000722", "79991000722", "", { horario: brData(HOJE, "12:00:00") }),
    linha("CALL 0000723", "INC 0000723", "79991000723", "", { horario: brData(ONTEM, "18:13:51") }),
    semHora(linha("CALL 0000724", "INC 0000724", "79991000724")),
  ];
  await teste("Pasta ADMS real: importação MANUAL grava data/hora AM/PM convertida e telefones", async () => {
    await abrirDia(S); const cs = await importar(S, gerarCSVPasta(cenarioPasta()), "chamadas_incidentes.csv");
    const c = (n) => cs.find((x) => x.call_id === `CALL 000072${n}`);
    igual([c(1).horario_call, c(2).horario_call, c(3).horario_call, c(3).recebido_adms], [HOJE + "T00:05:00", HOJE + "T12:00:00", ONTEM + "T18:13:51", ONTEM + "T18:13:51"]);
    igual([c(4).horario_call, c(4).recebido_adms], [null, null], "vazio continua vazio (nunca a data da importação)");
    igual(c(1).telefones.map((t) => [t.numero, t.tipo]), [["79991000721", "celular"]]);
    verdade(!S.loteAberto().origem, "importação manual"); await S.encerrarLote();
  });
  await teste("Pasta ADMS real: importação AUTOMÁTICA e nova versão AM/PM preservam registros, callbacks e histórico", async () => {
    await abrirDia(S); const b1 = gerarCSVPasta(cenarioPasta());
    await S.importar("chamadas_incidentes.csv", b1, N.sha256Hex(b1), "pasta_adms");
    igual(S.loteAberto().origem, "pasta_adms");
    const c1 = S.chamadas().find((x) => x.call_id === "CALL 0000721"), c2 = S.chamadas().find((x) => x.call_id === "CALL 0000722");
    igual(c1.horario_call, HOJE + "T00:05:00");
    await S.registrar(c1.id, "callback_realizado", "whatsapp", "obs fictícia"); await S.registrar(c2.id, "sem_sucesso", "ligacao");
    const antes = JSON.stringify([S.obterChamada(c1.id), S.obterChamada(c2.id)]), hist = JSON.stringify(S.E.historico_atendimento), ids = S.chamadas().map((x) => x.id);
    const b2 = gerarCSVPasta(cenarioPasta().concat([linha("CALL 0000725", "INC 0000725", "79991000725", "", { horario: brData(HOJE, "23:59:59") })]));
    const r = await S.atualizarLote("chamadas_incidentes.csv", b2, N.sha256Hex(b2));
    igual([r.novas, r.preservadas], [1, 2]);
    igual(JSON.stringify([S.obterChamada(c1.id), S.obterChamada(c2.id)]), antes, "registros do operador intactos");
    igual(JSON.stringify(S.E.historico_atendimento), hist, "histórico intacto");
    verdade(ids.every((id) => S.chamadas().some((x) => x.id === id)), "nada removido");
    igual(S.chamadas().find((x) => x.call_id === "CALL 0000725").horario_call, HOJE + "T23:59:59");
    await S.encerrarLote();
  });
  await teste("Preencher datas com o CSV REAL (AM/PM): prévia e gravação recuperam as datas; ambíguos bloqueados; nada mais muda", async () => {
    const id = await loteLegado();
    // mesmo cenário de csvAtualDatas(), no formato real da pasta (CALL 3 ausente, 4 e 5 ambíguas, 6 sem data, 7 só recebido, 9 com data gravada)
    const ls = linhasDatas(), sem3 = ls.filter((l) => l.ID !== "CALL 0000830"), dup4 = { ...ls[3], "Horário da call": brData(ONTEM, "04:00:00") };
    sem3.find((l) => l.ID === "CALL 0000850").Incidente = "INC 9999999";
    semHora(sem3.find((l) => l.ID === "CALL 0000860")); semHora(sem3.find((l) => l.ID === "CALL 0000870"), brData(HOJE, "18:30:00"));
    sem3.find((l) => l.ID === "CALL 0000890")["Horário da call"] = brData(ONTEM, "11:11:11");
    const b = gerarCSVPasta(sem3.concat([dup4, { ...ls[0] }]));
    verdade(new TextDecoder().decode(b).includes(" AM,") && new TextDecoder().decode(b).includes(" PM,"), "CSV de teste usa AM/PM");
    const rev = S.arm.revisao, antesPrevia = JSON.stringify(S.E), p = S.previaDatas(b);
    igual([S.arm.revisao, JSON.stringify(S.E)], [rev, antesPrevia], "prévia não grava");
    igual([p.recebem_horario_call, p.recebem_recebido_adms, p.registros_a_atualizar, p.sem_correspondencia, p.ambiguas, p.sem_data_no_csv], [3, 5, 5, 1, 2, 1]);
    igual(p.colunas_de_data, { horario_call: "Horario_Call", recebido_adms: "Recebido_Adms" });
    const antes = clonarJ(S.E), r = await S.preencherDatas(b, p.sha256, p.lote_id), c = (n) => S.obterChamada(id(n));
    igual([r.gravados, r.ambiguas, r.sem_correspondencia], [5, 2, 1]);
    igual([c(1).horario_call, c(1).recebido_adms, c(2).horario_call, c(8).horario_call], [HOJE + "T01:00:00", HOJE + "T01:00:00", HOJE + "T02:00:00", HOJE + "T08:00:00"]);
    igual([c(7).horario_call, c(7).recebido_adms], [null, HOJE + "T18:30:00"], "PM convertido no recebimento");
    igual([c(3).horario_call, c(4).horario_call, c(5).horario_call, c(6).horario_call], [null, null, null, null], "sem correspondência/ambíguos/sem data continuam vazios");
    igual([c(9).horario_call, c(9).recebido_adms], [HOJE + "T23:00:00", HOJE + "T09:00:00"], "data existente NÃO sobrescrita");
    igual(S.E.chamadas.map((x) => x.id), antes.chamadas.map((x) => x.id), "nada inserido nem removido");
    igual(S.E.chamadas.map(semCampos), antes.chamadas.map(semCampos), "nenhum outro campo mudou");
    for (const k of ["historico_atendimento", "marcas", "disparos", "callbacks_manuais", "sessao", "exportacoes", "dias_encerrados"]) igual(S.E[k], antes[k], k + " intacto");
    igual([c(1).estado, c(1).tentativas.length, c(1).observacao], ["callback_realizado", 1, "obs fictícia"]);
  });

  S.arm.fechar();
  await Armazenamento.apagarBanco(BANCO);
  const falhas = resultados.filter((r) => !r.ok).length;
  document.title = `TESTES ${resultados.length - falhas}/${resultados.length}` +
    (falhas ? " | " + resultados.filter((r) => !r.ok).map((r) => `${r.nome} :: ${r.det}`).join(" || ") : "");
  document.getElementById("placar").textContent = falhas ? `${falhas} teste(s) com FALHA de ${resultados.length}` : `Todos os ${resultados.length} testes aprovados`;
  document.getElementById("placar").className = falhas ? "falha" : "ok";
  document.body.dataset.fim = falhas ? "falha" : "ok";
})();
