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
  async function abrirDia(s, polo = "Polo Fictício", operador = "Operador Teste") { if (s.sessao()) await reiniciar(s); await s.abrirSessao(polo, operador); }
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
    await falhaCom(() => S.abrirSessao("", "TSA4"), "polo");
    await falhaCom(() => S.abrirSessao("Aracaju", "  "), "sigla");
    await S.abrirSessao("Aracaju", "TSA4");
    igual([S.sessao().polo, S.sessao().operador, S.configuracao().polo], ["Aracaju", "TSA4", "Aracaju"]);
    await reiniciar(S);
    await S.abrirSessao("", "TSA5");
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
    await S.abrirSessao("Aracaju", "TSA4"); await processarLote(S, loteCSV(4), 2, 1); await S.encerrarDia();
    await S.abrirSessao("Aracaju", "TSB1"); await processarLote(S, loteCSV(3, 50), 1);
    const P = S.painel();
    const hoje = P.por_dia.find((g) => g.chave === S.sessao().data_operacional);
    verdade(hoje.turnos >= 2 && hoje.chamadas_processadas >= 7);
    const ops = Object.fromEntries(P.por_operador.map((g) => [g.chave, g]));
    igual([ops.TSB1.turnos, ops.TSB1.chamadas_processadas, ops.TSB1.callbacks_realizados, ops.TSB1.tentativas_sem_sucesso], [1, 3, 1, 0]);
    verdade(ops.TSA4.callbacks_realizados >= 2 && ops.TSA4.tentativas_sem_sucesso >= 1);
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

  S.arm.fechar();
  await Armazenamento.apagarBanco(BANCO);
  const falhas = resultados.filter((r) => !r.ok).length;
  document.title = `TESTES ${resultados.length - falhas}/${resultados.length}` +
    (falhas ? " | " + resultados.filter((r) => !r.ok).map((r) => `${r.nome} :: ${r.det}`).join(" || ") : "");
  document.getElementById("placar").textContent = falhas ? `${falhas} teste(s) com FALHA de ${resultados.length}` : `Todos os ${resultados.length} testes aprovados`;
  document.getElementById("placar").className = falhas ? "falha" : "ok";
  document.body.dataset.fim = falhas ? "falha" : "ok";
})();
