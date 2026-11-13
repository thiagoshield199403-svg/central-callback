/* Central de Callback COI — núcleo de regras (sem tela, sem armazenamento).
   Porte fiel do código Python da Central 1.0.1 (backend/app): adms/leitor.py, adms/telefones.py, adms/analise.py,
   atendimento/subtipos.py, callback/importacao.py, callback/mensagens.py, callback/exportacao.py.
   Não depende de servidor, Python, Node.js nem internet. */
"use strict";
(function (raiz) {
  const N = {};
  N.VERSAO = "1.1.0-web-dev";

  /* ================================================================ texto */
  function semAcento(t) { return String(t ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\x00-\x7f]/g, ""); }
  N.normalizarTexto = (t) => semAcento(t).toUpperCase().split(/\s+/).filter(Boolean).join(" ");
  const chaveCabecalho = (nome) => N.normalizarTexto(nome).replace(/:+$/, "").trim();

  /* ================================================================ SHA-256 / HMAC (JS puro: funciona em file://) */
  const K = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb,
    0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f,
    0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
  function sha256Bytes(dados) {
    const msg = dados instanceof Uint8Array ? dados : new Uint8Array(dados);
    const l = msg.length, total = ((l + 9 + 63) >> 6) << 6, b = new Uint8Array(total);
    b.set(msg); b[l] = 0x80;
    const bits = l * 8, dv = new DataView(b.buffer);
    dv.setUint32(total - 8, Math.floor(bits / 0x100000000)); dv.setUint32(total - 4, bits >>> 0);
    const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const w = new Uint32Array(64);
    for (let o = 0; o < total; o += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
      for (let i = 16; i < 64; i++) {
        const x = w[i - 15], y = w[i - 2];
        const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
        const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let [a, bb, c, d, e, f, g, hh] = h;
      for (let i = 0; i < 64; i++) {
        const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        const t1 = (hh + S1 + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
        const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        const t2 = (S0 + ((a & bb) ^ (a & c) ^ (bb & c))) >>> 0;
        hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = bb; bb = a; a = (t1 + t2) >>> 0;
      }
      h[0] += a; h[1] += bb; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
    }
    const saida = new Uint8Array(32), so = new DataView(saida.buffer);
    for (let i = 0; i < 8; i++) so.setUint32(i * 4, h[i]);
    return saida;
  }
  const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  const utf8 = (t) => new TextEncoder().encode(t);
  N.sha256Hex = (dados) => hex(sha256Bytes(typeof dados === "string" ? utf8(dados) : dados));
  N.hmacSha256Hex = function (chaveHex, texto) {
    let chave = new Uint8Array(chaveHex.match(/../g).map((x) => parseInt(x, 16)));
    if (chave.length > 64) chave = sha256Bytes(chave);
    const k = new Uint8Array(64); k.set(chave);
    const ipad = k.map((x) => x ^ 0x36), opad = k.map((x) => x ^ 0x5c), m = utf8(texto);
    const interno = new Uint8Array(64 + m.length); interno.set(ipad); interno.set(m, 64);
    const externo = new Uint8Array(96); externo.set(opad); externo.set(sha256Bytes(interno), 64);
    return hex(sha256Bytes(externo));
  };
  N.aleatorioHex = function (n) {
    const b = new Uint8Array(n); (raiz.crypto || globalThis.crypto).getRandomValues(b); return hex(b);
  };
  N.novoId = () => N.aleatorioHex(16);

  /* ================================================================ leitor CSV (adms/leitor.py) */
  N.COLUNAS = {
    "!": "info_adicional", "ID": "call_id", "Horário da call": "horario_call", "Motivo": "motivo", "Submotivos": "submotivos",
    "UC": "uc", "Nome do reclamante": "nome_reclamante", "Comentário": "comentario", "Emergência": "emergencia",
    "Incidente": "incidente", "Alimentador origem": "alimentador", "Localização": "localizacao", "Prioridade": "prioridade",
    "Cust. prioritárias": "cust_prioritarias", "Tipo UC:": "tipo_uc", "Protocolo": "protocolo",
    "Contato do reclamante": "contato", "Medidor ID": "medidor_id", "Nota do endereço": "nota_endereco",
    "Custom ID do SDP": "custom_id_sdp", "Recebido ADMS": "recebido_adms", "Anexos": "anexos",
    "ID do Incidente Pai": "incidente_pai",
  };
  const MAPA = {};
  for (const [k, v] of Object.entries(N.COLUNAS)) MAPA[chaveCabecalho(k)] = v;
  N.SEPARADORES = [";", ",", "\t", "|"];
  N.MAX_PREAMBULO = 20;

  class ErroArquivo extends Error {}
  N.ErroArquivo = ErroArquivo;

  N.decodificar = function (bytes) {
    try { return [new TextDecoder("utf-8", { fatal: true }).decode(bytes), "utf-8"]; } catch (e) { /* tenta a próxima */ }
    return [new TextDecoder("windows-1252").decode(bytes), "cp1252"];
  };

  /* Leitor com as regras do módulo csv do Python (strict=False, quotechar='"'): aspas dobradas, quebras de linha dentro
     de aspas, aspas no meio de campo sem aspas tratadas como texto. Devolve registros com a linha física final. */
  function* registrosCSV(texto, sep) {
    let i = 0, linha = 0;
    const n = texto.length;
    while (i < n) {
      const campos = [];
      let campo = "", emAspas = false, inicioCampo = true, fim = false;
      while (i < n) {
        const c = texto[i];
        if (emAspas) {
          if (c === '"') {
            if (texto[i + 1] === '"') { campo += '"'; i += 2; continue; }
            emAspas = false; i++; continue;
          }
          if (c === "\r" && texto[i + 1] === "\n") { campo += "\r\n"; i += 2; linha++; continue; }
          if (c === "\n" || c === "\r") linha++;
          campo += c; i++; continue;
        }
        if (c === '"' && inicioCampo) { emAspas = true; inicioCampo = false; i++; continue; }
        if (c === sep) { campos.push(campo); campo = ""; inicioCampo = true; i++; continue; }
        if (c === "\r" || c === "\n") {
          i += (c === "\r" && texto[i + 1] === "\n") ? 2 : 1; linha++; fim = true; break;
        }
        campo += c; inicioCampo = false; i++;
      }
      if (!fim) linha++; // última linha sem quebra
      if (campos.length === 0 && campo === "" && !emAspas && inicioCampo) { yield { campos: [], linha }; continue; }
      campos.push(campo);
      yield { campos, linha };
    }
  }
  N._registrosCSV = registrosCSV;

  function ehCabecalho(campos) { return campos.some((c) => MAPA[chaveCabecalho(c)] === "call_id"); }

  N.lerCSV = function (bytes) {
    bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (!bytes.some((b) => b !== 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d && b !== 0x0b && b !== 0x0c))
      throw new ErroArquivo("O arquivo está vazio.");
    if (bytes.subarray(0, 4096).includes(0)) throw new ErroArquivo("O arquivo não parece ser um CSV de texto (planilha .xlsx ou arquivo binário?).");
    let [texto, codificacao] = N.decodificar(bytes);
    let separador = null, tinhaSep = false;
    const q = texto.indexOf("\n"), primeira = q < 0 ? texto : texto.slice(0, q);
    const marcador = primeira.trim().replace(/^"+|"+$/g, "");
    if (marcador.toLowerCase().startsWith("sep=") && marcador.length >= 5) {
      separador = marcador[4]; tinhaSep = true; texto = q < 0 ? "" : texto.slice(q + 1);
    }
    let cabecalho = null, iter = null, pulados = 0;
    for (const cand of separador ? [separador] : N.SEPARADORES) {
      const it = registrosCSV(texto, cand);
      let p = 0, achou = null;
      for (let r = it.next(); !r.done; r = it.next()) {
        if (ehCabecalho(r.value.campos)) { achou = r.value.campos; break; }
        p++; if (p > N.MAX_PREAMBULO) break;
      }
      if (achou) { cabecalho = achou; iter = it; pulados = p; separador = cand; break; }
    }
    if (!cabecalho) {
      if (!texto.trim()) throw new ErroArquivo("O arquivo não tem cabeçalho.");
      if (!tinhaSep && !N.SEPARADORES.some((s) => texto.includes(s))) throw new ErroArquivo("Não foi possível identificar o separador de colunas.");
      throw new ErroArquivo(`Cabeçalho não reconhecido: a coluna 'ID' (número da chamada) não foi encontrada nas primeiras ${N.MAX_PREAMBULO} linhas. Use a exportação CSV do Navegador de Chamadas.`);
    }
    cabecalho = cabecalho.map((c) => c.trim());
    let nNomeadas = cabecalho.length;
    while (nNomeadas && !cabecalho[nNomeadas - 1]) nNomeadas--;
    const reconhecidas = {}, indices = {}, desconhecidas = [];
    cabecalho.forEach((nome, i) => {
      const chave = MAPA[chaveCabecalho(nome)];
      if (chave && !(chave in reconhecidas)) { reconhecidas[chave] = nome; indices[chave] = i; } else if (nome) desconhecidas.push(nome);
    });
    const ausentes = Object.entries(N.COLUNAS).filter(([, ch]) => !(ch in reconhecidas)).map(([o]) => o);
    const arquivo = { codificacao, separador, tinha_linha_sep: tinhaSep, cabecalho, colunas_reconhecidas: reconhecidas,
      colunas_ausentes: ausentes, colunas_desconhecidas: desconhecidas, linhas: [], linhas_antes_do_cabecalho: pulados };
    for (let r = iter.next(); !r.done; r = iter.next()) {
      const campos = r.value.campos, numero = r.value.linha + (tinhaSep ? 1 : 0);
      if (!campos.some((c) => c.trim())) continue;
      const divergente = campos.length < nNomeadas || campos.slice(nNomeadas).some((c) => c.trim());
      const original = {};
      for (let i = 0; i < cabecalho.length; i++) original[cabecalho[i] || `coluna_${i + 1}`] = i < campos.length ? campos[i] : "";
      for (let x = cabecalho.length; x < campos.length; x++) original[`coluna_extra_${x + 1}`] = campos[x];
      const valores = {};
      for (const [ch, i] of Object.entries(indices)) valores[ch] = i < campos.length ? campos[i] : "";
      arquivo.linhas.push({ numero, original, valores, colunas_divergentes: divergente });
    }
    return arquivo;
  };

  /* ================================================================ telefones (adms/telefones.py) */
  const DDDS = new Set([11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45,
    46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89,
    91, 92, 93, 94, 95, 96, 97, 98, 99]);
  const PALAVRAS_CONTEXTO = /(?<![A-Za-z0-9_À-ÿ])(tel|fone|telefone|cel|celular|contato|whats|whatsapp|zap|wpp|ligar)(?![A-Za-z0-9_À-ÿ])/i;
  const digitos = (t) => String(t).replace(/\D/g, "");
  N.normalizarTelefone = function (t) {
    let d = digitos(t);
    if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
    else if ((d.length === 11 || d.length === 12) && d.startsWith("0")) d = d.slice(1);
    return d;
  };
  function trivial(d) {
    const ass = d.slice(2);
    if (new Set(d).size === 1 || new Set(ass).size === 1) return true;
    const ult = ass.slice(-8);
    return ["0123456789012", "9876543210987"].some((s) => s.includes(ult));
  }
  N.classificarTelefone = function (d) {
    if (d.length !== 10 && d.length !== 11) return ["invalido", "quantidade de dígitos diferente de 10 ou 11"];
    if (!DDDS.has(parseInt(d.slice(0, 2), 10))) return ["invalido", "DDD inexistente"];
    if (trivial(d)) return ["invalido", "sequência trivial ou de teste"];
    if (d.length === 11) return d[2] === "9" ? ["celular", null] : ["invalido", "11 dígitos sem o 9 inicial de celular"];
    if ("2345".includes(d[2])) return ["fixo", null];
    return ["invalido", "10 dígitos fora do padrão de telefone fixo"];
  };
  function montar(origem, rotulo, bruto) {
    const d = N.normalizarTelefone(bruto), [tipo, motivo] = N.classificarTelefone(d), doComentario = origem === "comentario";
    if (tipo === "celular") return { numero: d, tipo, origem, rotulo, requer_confirmacao: doComentario, motivo: "WhatsApp não verificado" };
    if (tipo === "fixo") return { numero: d, tipo, origem, rotulo, requer_confirmacao: doComentario, motivo: "telefone fixo: contato por ligação" };
    return { numero: d || null, tipo, origem, rotulo, requer_confirmacao: false, motivo };
  }
  N.extrairDoContato = function (valor) {
    if (!valor || !valor.trim()) return [];
    const partes = valor.split(/([A-Za-zÀ-ú_ ]+):/), itens = [];
    if (partes.length === 1) valor.split(/[;,/]/).forEach((p) => itens.push([null, p]));
    else {
      if (partes[0].trim()) itens.push([null, partes[0]]);
      for (let i = 1; i < partes.length - 1; i += 2)
        partes[i + 1].split(/[;,/]/).forEach((t) => itens.push([partes[i].trim().toUpperCase(), t]));
    }
    return itens.map(([r, b]) => [r, b.trim()]).filter(([, b]) => digitos(b)).map(([r, b]) => montar("contato_reclamante", r, b));
  };
  const RE_IDENT = /\b[A-Z]{2,5}_UC_\d+\b|\b(?:CALL|INC)\s*\d+\b|\b\d+(?:_\d+)+\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b\d{1,2}:\d{2}(?::\d{2})?\b|\b\d{5}-\d{3}\b|\b\d+(?:\.\d+){2,}\b/gi;
  const RE_CAND = /(?<![\d_])(?:\+?55[\s.-]*)?(?:\(?0?\d{2}\)?[\s.-]*)?9?[\s.-]?\d{4}[\s.-]?\d{4}(?![\d_])/g;
  N.extrairDoComentario = function (texto) {
    if (!texto) return [];
    const limpo = texto.replace(RE_IDENT, (m) => " ".repeat(m.length)), saida = [];
    for (const m of limpo.matchAll(RE_CAND)) {
      const bruto = m[0].trim();
      const n = N.normalizarTelefone(bruto).length;
      if (n !== 10 && n !== 11) continue;
      const t = montar("comentario", null, bruto);
      if (t.tipo !== "invalido") saida.push(t);
    }
    return saida;
  };
  N.telefonesDaLinha = function (valores, comentario) {
    const doContato = N.extrairDoContato(valores.contato), numeros = new Set(doContato.map((t) => t.numero));
    return doContato.concat(N.extrairDoComentario(comentario).filter((t) => !numeros.has(t.numero)));
  };
  /* 1.1.0: telefone digitado pelo operador (envio manual). Aceita com ou sem +55, 0, parênteses, espaços e hífens.
     Só celular válido abre o WhatsApp: fixo, DDD inexistente, sequência de teste ou quantidade errada de dígitos são recusados. */
  N.validarTelefoneManual = function (bruto) {
    const d0 = digitos(bruto || "");
    if (!d0) return { ok: false, erro: "Digite o telefone com DDD (ex.: 79 99999-1234)." };
    if (d0.length === 8 || d0.length === 9) return { ok: false, erro: "Falta o DDD: digite o telefone com DDD (ex.: 79 99999-1234)." };
    const d = N.normalizarTelefone(d0), [tipo, motivo] = N.classificarTelefone(d);
    if (tipo === "fixo") return { ok: false, fixo: true, numero: d, erro: `${N.formatarTelefone(d)} é telefone FIXO: o WhatsApp só abre para celular. Faça o contato por ligação.` };
    if (tipo !== "celular") return { ok: false, erro: `Telefone inválido (${motivo}). Confira o número no ADMS.` };
    return { ok: true, numero: d, exibir: N.formatarTelefone(d) };
  };
  N.formatarTelefone = function (n) {
    if (!n) return "—";
    if (n.length === 11) return `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}`;
    if (n.length === 10) return `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`;
    return n;
  };

  /* ================================================================ camada tratada (adms/analise.py) */
  const txt = (v) => { if (v == null) return null; v = String(v).trim(); return v || null; };
  const ident = (v) => { v = txt(v); return v ? v.split(/\s+/).join(" ").toUpperCase() : null; };
  const VERD = new Set(["SIM", "S", "YES", "Y", "TRUE", "1"]), FALSO = new Set(["NAO", "N", "NO", "FALSE", "0"]);
  const bool = (v) => { v = txt(v); if (!v) return null; const k = N.normalizarTexto(v); return VERD.has(k) ? true : FALSO.has(k) ? false : null; };
  function data(v) {
    v = txt(v); if (!v) return [null, false];
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?: (\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(v);
    if (!m) return [null, true];
    const [, d, mo, a, h = "0", mi = "0", s = "0"] = m;
    const dt = new Date(Date.UTC(+a, +mo - 1, +d, +h, +mi, +s));
    if (dt.getUTCDate() !== +d || dt.getUTCMonth() !== +mo - 1 || +h > 23 || +mi > 59 || +s > 59) return [null, true];
    const p = (x) => String(x).padStart(2, "0");
    return [`${a}-${p(mo)}-${p(d)}T${p(h)}:${p(mi)}:${p(s)}`, false]; // horário local do ADMS, sem fuso (como no Python)
  }
  function submotivos(v) {
    v = txt(v); if (!v) return null;
    const vistos = [];
    for (const parte of v.split(/[;,]/)) { const s = parte.trim().toUpperCase(); if (s && !vistos.includes(s)) vistos.push(s); }
    return vistos.join("; ") || null;
  }
  N.tratar = function (linha) {
    const v = linha.valores, avisos = [];
    const [horario, hInv] = data(v.horario_call), [, rInv] = data(v.recebido_adms);
    if (hInv || rInv) avisos.push(["aviso", "data_invalida", "Data/hora fora do formato dd/mm/aaaa hh:mm:ss (valor original preservado)."]);
    return [{
      call_id: ident(v.call_id), incidente: ident(v.incidente), incidente_pai: ident(v.incidente_pai), uc: txt(v.uc),
      custom_id_sdp: txt(v.custom_id_sdp), horario_call: horario, motivo: txt(v.motivo), submotivos: submotivos(v.submotivos),
      emergencia: bool(v.emergencia), nome_reclamante: txt(v.nome_reclamante), localizacao: txt(v.localizacao),
      nota_endereco: txt(v.nota_endereco), comentario: txt(v.comentario),
    }, avisos];
  };

  /* ================================================================ tipo e subtipo (atendimento/servico.py, subtipos.py) */
  const TIPOS = [["RV", "risco_de_vida"], ["FE", "falta_de_energia"], ["NT", "nivel_de_tensao"], ["DF", "defeito"], ["OT", "outros"]];
  N.tipoOcorrencia = function (sub) {
    const siglas = new Set(String(sub || "").split(";").map((s) => s.trim()));
    const t = TIPOS.find(([s]) => siglas.has(s));
    return t ? t[1] : "nao_classificado";
  };
  const S = (codigo, rotulo, risco, semFoto, termos) => ({ codigo, rotulo, risco, sem_foto: semFoto, termos });
  N.SUBTIPOS = Object.fromEntries([
    S("falta_energia", "Falta de energia", false, false, ["FALTA DE ENERGIA"]),
    S("condutor_partido", "Condutor partido", true, true, ["CONDUTOR PARTIDO"]),
    S("poste_abalroado", "Poste abalroado", true, true, ["POSTE ABALROADO"]),
    S("choque_eletrico", "Choque elétrico", true, true, ["CHOQUE ELETRICO", "CHOQUE NA INSTALACAO"]),
    S("faiscas_rede", "Faíscas / centelhamento na rede", true, true, ["CENTELHAMENTO NA REDE", "FAISCAS NA REDE", "FAISCA NA REDE"]),
    S("faiscas_ramal", "Faíscas / centelhamento no ramal de serviço", true, true, ["CENTELHAMENTO NO RAMAL", "FAISCAS NO RAMAL", "FAISCA NO RAMAL"]),
    S("incendio", "Incêndio", true, true, ["INCENDIO"]),
    S("oscilacao", "Oscilação de energia", false, false, ["OSCILACAO"]),
    S("tensao_alta", "Tensão alta", false, false, ["TENSAO ALTA"]),
    S("tensao_baixa", "Tensão baixa", false, false, ["TENSAO BAIXA"]),
    S("defeito_transformador", "Defeito em transformador", false, false, ["DEFEITO NO TRANSFORMADOR", "DEFEITO EM TRANSFORMADOR"]),
    S("problema_ramal", "Problema no ramal de serviço", false, false, ["PROBLEMA NO RAMAL"]),
    S("arvore_rede", "Árvore na rede", false, false, ["ARVORE NA REDE"]),
    S("objeto_estranho_rede", "Objeto estranho na rede", false, false, ["OBJETO ESTRANHO"]),
    S("poste_inclinado", "Poste inclinado", false, false, ["POSTE INCLINADO"]),
    S("transformador_oleo", "Transformador com vazamento de óleo", false, false, ["TRANSFORMADOR VAZANDO OLEO", "VAZAMENTO DE OLEO"]),
    S("condutor_desnivelado", "Condutor desnivelado", false, false, ["CONDUTOR DESNIVELADO"]),
    S("defeito_disjuntor", "Defeito no disjuntor", false, false, ["DEFEITO NO DISJUNTOR"]),
    S("inversao_fase", "Inversão de fase", false, false, ["INVERSAO DE FASE"]),
    S("poste_auxiliar_quebrado", "Poste auxiliar quebrado", false, false, ["POSTE AUXILIAR"]),
  ].map((s) => [s.codigo, s]));
  const normSub = (t) => semAcento(t || "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean).join(" ");
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  N.detectarSubtipo = function (lista, tipo) {
    const texto = lista.filter(Boolean).map(normSub).join(" | ");
    if (!texto) return [null, "sem texto de submotivo"];
    const achados = Object.values(N.SUBTIPOS).filter((s) => s.termos.some((t) => new RegExp(`(?<![A-Z0-9])${escRe(t)}(?![A-Z0-9])`).test(texto)))
      .map((s) => s.codigo).sort();
    if (!achados.length) return [null, "submotivo sem subtipo reconhecido (ex.: só a sigla)"];
    if (achados.length > 1) return [null, `ambíguo (${achados.join(", ")}): escolha manual`];
    const sub = N.SUBTIPOS[achados[0]];
    if (tipo === "risco_de_vida" && !sub.risco) return [null, `'${sub.rotulo}' não é de risco, mas o atendimento é de risco de vida: escolha manual`];
    return [sub.codigo, `reconhecido no texto do submotivo ('${sub.rotulo}')`];
  };

  /* ================================================================ análise para um lote (callback/importacao.py) */
  const USAVEIS = new Set(["celular", "fixo"]);
  N.estadoInicial = function (tels) {
    if (!tels.length) return "sem_telefone";
    if (!tels.some((t) => t.numero && USAVEIS.has(t.tipo))) return "contato_invalido";
    return "pendente";
  };
  function chaveOriginal(o) { return JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]])); }
  N.analisar = function (bytes) {
    bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const arquivo = N.lerCSV(bytes), validas = [], erros = [], vistos = new Map();
    for (const linha of arquivo.linhas) {
      const [campos, avisos] = N.tratar(linha), call = campos.call_id;
      if (linha.colunas_divergentes) { erros.push({ linha: linha.numero, codigo: "colunas_divergentes", mensagem: "Quantidade de colunas diferente do cabeçalho; linha não importada." }); continue; }
      if (!call) { erros.push({ linha: linha.numero, codigo: "sem_call_id", mensagem: "Linha sem o número da chamada (coluna ID); não importada." }); continue; }
      const h = chaveOriginal(linha.original);
      if (vistos.has(call)) {
        erros.push({ linha: linha.numero, codigo: "call_repetida_no_arquivo", call_id: call,
          mensagem: "CALL repetida no arquivo" + (vistos.get(call) === h ? "" : " com valores diferentes") + "; vale a primeira ocorrência (contada uma vez)." });
        continue;
      }
      vistos.set(call, h);
      for (const [, codigo, mensagem] of avisos) erros.push({ linha: linha.numero, codigo, call_id: call, mensagem });
      const tels = N.telefonesDaLinha(linha.valores, campos.comentario);
      const tipo = N.tipoOcorrencia(campos.submotivos), [subtipo] = N.detectarSubtipo([campos.submotivos], tipo);
      validas.push({ linha_arquivo: linha.numero, call_id: call, incidente: campos.incidente, incidente_pai: campos.incidente_pai,
        uc: campos.uc, custom_id_sdp: campos.custom_id_sdp, horario_call: campos.horario_call, motivo: campos.motivo,
        submotivos: campos.submotivos, tipo_ocorrencia: tipo, subtipo, emergencia: campos.emergencia, nome: campos.nome_reclamante,
        localizacao: campos.localizacao, nota_endereco: campos.nota_endereco, comentario: campos.comentario, telefones: tels,
        estado: N.estadoInicial(tels) });
    }
    const porEstado = {}, porMensagem = {};
    for (const v of validas) {
      porEstado[v.estado] = (porEstado[v.estado] || 0) + 1;
      v.sugestao = N.sugerirMensagem(v); // 1.0.2: mensagem sugerida e o motivo (auditoria); o operador pode trocar
      porMensagem[v.sugestao.codigo] = (porMensagem[v.sugestao.codigo] || 0) + 1;
    }
    return { validas, erros, resumo: {
      codificacao: arquivo.codificacao, separador: arquivo.separador, colunas_reconhecidas: Object.keys(arquivo.colunas_reconhecidas).length,
      colunas_ausentes: arquivo.colunas_ausentes, colunas_desconhecidas: arquivo.colunas_desconhecidas, linhas_lidas: arquivo.linhas.length,
      linhas_antes_do_cabecalho: arquivo.linhas_antes_do_cabecalho, chamadas_validas: validas.length,
      linhas_com_erro: erros.filter((e) => e.codigo === "colunas_divergentes" || e.codigo === "sem_call_id").length,
      calls_repetidas_no_arquivo: erros.filter((e) => e.codigo === "call_repetida_no_arquivo").length, por_estado_inicial: porEstado,
      com_telefone_so_no_comentario: validas.filter((v) => v.telefones.length && v.telefones.every((t) => t.requer_confirmacao)).length,
      agrupamento: N.resumoAgrupamento(validas), por_mensagem_sugerida: porMensagem,
      sha256: N.sha256Hex(bytes),
    } };
  };

  /* ================================================================ mensagens (callback/mensagens.py) */
  N.GENERICO = "manual_atualizacao";
  N.TIPOS_ROTULO = { risco_de_vida: "risco de vida", falta_de_energia: "falta de energia", nivel_de_tensao: "nível de tensão",
    defeito: "defeito", outros: "outros", nao_classificado: "não classificado" };
  N.modelos = () => (raiz.MODELOS_MENSAGEM || []).filter((m) => m.gatilho === "manual" && m.ativo !== false);
  N.escolherModelo = function (subtipo, codigo) {
    const lista = N.modelos();
    if (codigo) { const m = lista.find((x) => x.codigo === codigo); if (!m) throw new Error("Modelo de mensagem inexistente."); return m; }
    return lista.find((m) => subtipo && m.subtipo_ocorrencia === subtipo) || lista.find((m) => m.codigo === N.GENERICO);
  };
  N.renderizar = function (modelo, ch, polo) {
    const valores = { saudacao: "Olá", incidente: ch.incidente || "não informado", protocolo: ch.incidente || ch.call_id, polo,
      tipo_ocorrencia: N.TIPOS_ROTULO[ch.tipo_ocorrencia] || ch.tipo_ocorrencia, fim_previsto: "a confirmar",
      referencia_incidente: ch.incidente ? `Referência do atendimento: ${ch.incidente}` : "" };
    let texto = modelo.texto.replace(/\{([a-z_]+)\}/g, (m, k) => (k in valores ? valores[k] : m));
    if (ch.incidente && !texto.includes(ch.incidente)) texto += `\n\nReferência do atendimento: ${ch.incidente}`;
    return texto;
  };
  N.linkWhatsappWeb = (numero, texto) => `https://web.whatsapp.com/send?phone=55${numero}&text=${encodeURIComponent(texto)}`;
  /* 1.1.0 (recuperado da referência: mensagens.py com_saudacao/texto_do_operador): o operador pode editar o texto antes de
     abrir o WhatsApp; a saudação institucional aprovada na Web ("Olá, aqui é a Energisa.") é garantida no início, sem duplicar. */
  N.SAUDACAO = "Olá, aqui é a Energisa.";
  N.TEXTO_MAX = 1500;
  N.comSaudacao = function (texto) {
    texto = String(texto || "").trim();
    const inicio = semAcento(texto.slice(0, 40)).toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
    if (inicio.startsWith("ola aqui e a energisa")) return texto;
    return texto ? `${N.SAUDACAO} ${texto}` : N.SAUDACAO;
  };
  N.textoDoOperador = function (texto) {
    texto = String(texto || "").replace(/\r\n/g, "\n").trim();
    if (!texto) throw new Error("O texto da mensagem está vazio.");
    if (texto.length > N.TEXTO_MAX) throw new Error(`O texto da mensagem passa de ${N.TEXTO_MAX} caracteres.`);
    return N.comSaudacao(texto);
  };
  /* 1.1.0 (recuperado da referência: classificacao.py resumir_localizacao): só exibição na tabela; o texto completo continua
     no detalhe e no tooltip. 'RUA X_20_LT 3_JATOBA; 10_BARRA DOS COQUEIROS' -> 'JATOBA · BARRA DOS COQUEIROS'. */
  N.resumirLocalizacao = function (loc) {
    const t = String(loc || "").split(/\s+/).filter(Boolean).join(" ");
    if (!t) return "";
    const partes = t.split(";").map((p) => p.trim()).filter(Boolean);
    if (partes.length < 2) return t.length <= 48 ? t : t.slice(0, 47) + "…";
    const cidade = partes[partes.length - 1].replace(/^\d+_/, "").trim(), end = partes[0];
    const bairro = end.includes("_") ? end.slice(end.lastIndexOf("_") + 1).trim() : "";
    let itens = [bairro, cidade].filter(Boolean);
    if (itens.length === 2 && itens[0].toUpperCase() === itens[1].toUpperCase()) itens = itens.slice(0, 1);
    return itens.join(" · ") || t.slice(0, 48);
  };
  /* 1.0.2: lista para o operador agrupada por assunto e em ordem alfabética (de assunto e de título, pt-BR).
     "prioridade" = modelo de subtipo de RISCO (regra existente em SUBTIPOS); é só marcação visual, não muda a ordem. */
  const alfa = (a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" });
  N.catalogo = () => N.modelos().map((m) => ({ codigo: m.codigo, nome: m.nome, grupo: m.grupo || "Geral", subtipo: m.subtipo_ocorrencia || null,
    subtipo_rotulo: (N.SUBTIPOS[m.subtipo_ocorrencia || ""] || {}).rotulo || null,
    prioridade: !!(N.SUBTIPOS[m.subtipo_ocorrencia || ""] || {}).risco }))
    .sort((a, b) => alfa(a.grupo, b.grupo) || alfa(a.nome, b.nome));
  N.catalogoAgrupado = function () {
    const grupos = [];
    for (const m of N.catalogo()) {
      let g = grupos[grupos.length - 1];
      if (!g || g.grupo !== m.grupo) grupos.push(g = { grupo: m.grupo, modelos: [] });
      g.modelos.push(m);
    }
    return grupos;
  };

  /* ================================================================ 1.0.2: data/hora da comunicação (coluna "Horário da call") */
  /* Campo usado: "Horário da call" do CSV do ADMS (registro da comunicação do cliente). Não é a importação, nem o callback.
     Nos CSVs reais: 62/62 preenchidos e válidos; "Recebido ADMS" é sempre POSTERIOR (entrada no ADMS), por isso não é usado. */
  N.formatarDataHora = function (iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(iso || "");
    return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}:${m[6]}` : "—";
  };

  /* ================================================================ 1.0.2: indicação de risco (sem inventar classificação) */
  /* Nível 2 = risco já classificado pelas regras existentes: sigla RV (risco de vida), emergência = Sim, ou subtipo de risco.
     Nível 1 = só um INDÍCIO no texto (comentário/submotivo) com os termos das regras já existentes: os termos dos subtipos de risco
     da Central e as regras de risco da BETA (cabo/fio/condutor partido ou rompido, choque, incêndio/fogo, faísca/centelhamento,
     poste abalroado). O nível 1 NÃO classifica: só avisa o operador para conferir. */
  const contem = (texto, termo) => new RegExp(`(?<![A-Z0-9])${escRe(termo)}(?![A-Z0-9])`).test(texto);

  /* ================================================================ 1.0.2: texto da comunicação (o que o cliente relatou) */
  /* Auditoria dos CSVs reais: o "Submotivos" traz só a SIGLA (FE/DF/RV/NT) e o relato está no "Comentário", depois de "OBS:"
     (ou "COMENTARIOS:"), no meio de campos que NÃO são a ocorrência: REFERENCIA (pontos de referência), ENDERECO, BAIRRO, CIDADE,
     UC, COND CLIMA, ROTEIRO, TEL, PROTOCOLO, "GERADO VIA URA". Esses campos são retirados antes do reconhecimento para evitar
     falsos positivos (ex.: um povoado chamado "Baixa ..." não é tensão baixa). Nada é alterado no registro original. */
  const SEM_ACENTO = (t) => String(t || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toUpperCase();
  N.textoLivre = function (comentario) {
    let t = SEM_ACENTO(comentario).replace(/\s+/g, " ");
    if (!t.trim()) return "";
    const iC = t.indexOf("COMENTARIOS:"), iO = t.indexOf("OBS:");
    if (iC >= 0) t = t.slice(iC + 12); else if (iO >= 0) t = t.slice(iO + 4);
    t = t.split(/GERADO VIA URA|\bPROTOCOLO\b|\bTEL(?:EFONE)?\s*[:#\d]/)[0];
    t = t.replace(/\bREFERENCIA\s*:.*?(?=\bCOND CLIMA\b|\bOBS:|$)/g, " ")
      .replace(/\bCOND(?:ICAO)? CLIMA\s*:\s*(?:NAO INFORMADA|[A-Z]+)\.?/g, " ")
      .replace(/\b(?:ENDERECO|BAIRRO|CIDADE|UC|ROTEIRO|PONTO DE REFERENCIA)\s*:[^;]*(?:;|$)/g, " ");
    return normSub(t);
  };
  N.textoComunicacao = function (ch) {
    const sub = normSub(ch.submotivos || "").split(" ").filter((p) => !/^[A-Z]{2}$/.test(p)).join(" "); // tira as siglas
    return [sub, N.textoLivre(ch.comentario)].filter(Boolean).join(" | ");
  };

  /* ================================================================ 1.0.2: reconhecimento por palavras-chave -> mensagem */
  /* Cada regra: lista de GRUPOS; todos os grupos precisam aparecer (palavra inteira; variações por radical). A PRIMEIRA regra que
     casar vence; as regras de RISCO vêm primeiro (uma ocorrência de risco nunca recebe mensagem comum). Fontes: termos dos
     subtipos da Central, regras da BETA (31/10) e expressões dos CSVs reais (auditoria 04/11). Ver docs\RECONHECIMENTO-MENSAGENS.txt */
  const FE = ["FALTA DE ENERGI\\w*", "SEM ENERGI\\w*", "FALTA DE LUZ", "SEM LUZ", "ENERGIA FALTOU", "LUZ FALTOU", "FALTOU (?:A )?(?:ENERGIA|LUZ)",
    "NAO HA ENERGI\\w*", "NAO TEM ENERGI\\w*", "SEM FORNECIMENTO", "APAGAO", "ACABOU (?:A )?(?:ENERGIA|LUZ)", "QUEDA DE ENERGIA"];
  const FAISCA = ["FAISCA\\w*", "CENTELHA\\w*"], CABO = ["CABOS?", "FIOS?", "CONDUTOR(?:ES)?", "FIACAO"], POSTE = ["POSTES?"];
  N.REGRAS_MENSAGEM = [
    { id: "R1", codigo: "manual_condutor_partido", risco: true, rotulo: "cabo/condutor partido ou caído", grupos: [CABO.concat(["REDE"]), ["PARTID[OA]S?", "ROMPID[OA]S?", "ARREBENTAD[OA]S?", "CAID[OA]S?", "NO CHAO"]] },
    { id: "R2", codigo: "manual_choque_eletrico", risco: true, rotulo: "choque elétrico", grupos: [["CHOQUES?", "ELETRIFICAD[OA]S?"]] },
    { id: "R3", codigo: "manual_incendio", risco: true, rotulo: "incêndio/fogo", grupos: [["INCENDIO\\w*", "FOGO", "CHAMAS?"]] },
    { id: "R4", codigo: "manual_faiscas_ramal", risco: true, rotulo: "faíscas no ramal", grupos: [FAISCA, ["RAMAL", "RAMAIS"]] },
    { id: "R5", codigo: "manual_faiscas_rede", risco: true, rotulo: "faíscas/centelhamento", grupos: [FAISCA] },
    { id: "R6", codigo: "manual_poste_abalroado", risco: true, rotulo: "poste abalroado/atingido", grupos: [POSTE, ["ABALROAD[OA]S?", "BATID[OA]S?", "BATEU", "BATERAM", "ATINGID[OA]S?", "DERRUBAD[OA]S?", "COLISAO", "ACIDENTE"]] },
    { id: "N1", codigo: "manual_poste_ferragens_expostas", rotulo: "ferragens expostas", grupos: [["FERRAGE\\w*", "VERGALH\\w*"]] },
    { id: "N2", codigo: "manual_transformador_oleo", rotulo: "transformador com óleo/vazamento", grupos: [["OLEO"], ["TRANSFORMADOR\\w*", "TRAFOS?", "VAZAND\\w*", "VAZAMENTO\\w*"]] },
    { id: "N3", codigo: "manual_defeito_transformador", rotulo: "transformador", grupos: [["TRANSFORMADOR\\w*", "TRAFOS?"]] },
    { id: "N4", codigo: "manual_poste_inclinado", rotulo: "poste inclinado", grupos: [POSTE, ["INCLINAD[OA]S?", "TORT[OA]S?", "ENTORTAD[OA]S?", "PENDENDO", "CAINDO", "TOMBANDO"]] },
    { id: "N5", codigo: "manual_poste_auxiliar_quebrado", rotulo: "poste auxiliar", grupos: [["POSTE AUXILIAR", "POSTINHO"]] },
    { id: "N6", codigo: "manual_condutor_desnivelado", rotulo: "cabo desnivelado/baixo", grupos: [CABO.concat(["REDE"]), ["DESNIVE\\w*", "FROUX[OA]S?", "ARRIAD[OA]S?", "MUITO BAIX[OA]S?"]] },
    { id: "N7", codigo: "manual_arvore_rede", rotulo: "árvore/galho na rede", grupos: [["ARVORES?", "GALHOS?", "GALHADA", "COQUEIROS?", "PALMEIRAS?", "BAMBU\\w*"]] },
    { id: "N8", codigo: "manual_objeto_estranho_rede", rotulo: "objeto/pipa na rede", grupos: [["OBJETOS?", "PIPAS?", "PAPAGAIOS?", "LONAS?"]] },
    { id: "N9", codigo: "manual_inversao_fase", rotulo: "inversão de fase", grupos: [["INVERSAO DE FASES?", "FASES? INVERTIDAS?", "AO CONTRARIO", "SENTIDO CONTRARIO"]] },
    { id: "N10", codigo: "manual_defeito_disjuntor", rotulo: "defeito no disjuntor", grupos: [["DISJUNTOR\\w*"], ["DEFEITO\\w*", "QUEBRAD[OA]S?", "DESARMA\\w*", "ESQUENTA\\w*", "QUEIMAD[OA]S?", "DERRETID[OA]S?", "ESTRAGAD[OA]S?", "NAO ARMA", "NAO LIGA"]] },
    { id: "N11", codigo: "manual_problema_ramal", rotulo: "ramal de serviço", grupos: [["RAMAL", "RAMAIS"]] },
    { id: "N12", codigo: "manual_oscilacao", rotulo: "oscilação", grupos: [["OSCILA\\w*", "PISCAND[OA]", "PISCA PISCA", "VAI E VOLTA", "VAI E VEM", "CAI E VOLTA"]] },
    { id: "N13", codigo: "manual_tensao_alta", rotulo: "tensão alta", grupos: [["TENSAO ALTA", "SOBRETENSAO", "VOLTAGEM ALTA"]] },
    { id: "N14", codigo: "manual_tensao_baixa", rotulo: "tensão baixa", grupos: [["TENSAO BAIXA", "SUBTENSAO", "VOLTAGEM BAIXA", "ENERGIA FRACA", "LUZ FRACA"]] },
    { id: "N15", codigo: "manual_falta_energia_geral", rotulo: "falta de energia geral/vizinhança", grupos: [FE, ["GERAL", "COLETIV[OA]S?", "VIZINH\\w*", "RUA TODA", "TODA A RUA", "BAIRRO TODO", "TODO O BAIRRO", "LOCALIDADE"]] },
    { id: "N16", codigo: "manual_falta_energia", rotulo: "falta de energia", grupos: [FE] },
  ];
  const RE_REGRA = new Map();
  const casaGrupo = (texto, alts) => { const k = alts.join("|"); if (!RE_REGRA.has(k)) RE_REGRA.set(k, new RegExp(`(?<![A-Z0-9])(?:${k})(?![A-Z0-9])`));
    const m = RE_REGRA.get(k).exec(texto); return m ? m[0] : null; };
  N.regrasQueCasam = (texto) => N.REGRAS_MENSAGEM.map((r) => { const ts = r.grupos.map((g) => casaGrupo(texto, g)); return ts.every(Boolean) ? { regra: r, termos: ts } : null; }).filter(Boolean);
  const modeloRisco = (codigo) => { const m = (raiz.MODELOS_MENSAGEM || []).find((x) => x.codigo === codigo); return !!(m && (N.SUBTIPOS[m.subtipo_ocorrencia || ""] || {}).risco); };
  /* Sugestão de mensagem. Ordem de decisão:
     1. Regra de RISCO no texto ou subtipo de risco no submotivo -> mensagem de risco (prevalece sobre qualquer outra).
     2. Subtipo reconhecido no TEXTO do submotivo (regra existente desde a 7.3).
     3. Primeira regra de palavra-chave que casar no texto da comunicação.
     4. Sigla FE (Falta de Energia) sem outra indicação -> falta de energia.
     5. Nada confiável -> mensagem genérica aprovada.
     Segurança: em chamada de RISCO DE VIDA (sigla RV) uma mensagem comum nunca é aplicada automaticamente (vai a genérica). */
  N.sugerirMensagem = function (ch) {
    const texto = N.textoComunicacao(ch), casadas = N.regrasQueCasam(texto), sub = ch.subtipo ? N.SUBTIPOS[ch.subtipo] : null;
    const porSub = sub ? (N.modelos().find((m) => m.subtipo_ocorrencia === ch.subtipo) || null) : null;
    const risco = casadas.find((c) => c.regra.risco);
    const res = (codigo, origem, termo, regra) => ({ codigo, origem, termo: termo || null, regra: regra || null, risco: modeloRisco(codigo),
      todas: casadas.map((c) => c.regra.id) });
    let r;
    if (porSub && sub.risco) r = res(porSub.codigo, "submotivo", sub.rotulo, "SUBTIPO");
    else if (risco) r = res(risco.regra.codigo, "texto", risco.termos.join(" + "), risco.regra.id);
    else if (porSub) r = res(porSub.codigo, "submotivo", sub.rotulo, "SUBTIPO");
    else if (casadas.length) r = res(casadas[0].regra.codigo, "texto", casadas[0].termos.join(" + "), casadas[0].regra.id);
    else if (ch.tipo_ocorrencia === "falta_de_energia") r = res("manual_falta_energia", "sigla", "FE (Falta de Energia)", "SIGLA_FE");
    else r = res(N.GENERICO, "generico", null, null);
    if (ch.tipo_ocorrencia === "risco_de_vida" && !r.risco && r.codigo !== N.GENERICO)
      r = { ...res(N.GENERICO, "generico", null, null), bloqueada: r.codigo, motivo_bloqueio: "chamada de risco de vida (RV): mensagem comum não é aplicada automaticamente" };
    if (!N.modelos().some((m) => m.codigo === r.codigo)) r = res(N.GENERICO, "generico", null, null);
    return r;
  };
  N.descreverSugestao = function (s) {
    if (!s) return "";
    if (s.origem === "texto") return `palavra-chave no texto: "${s.termo.toLowerCase()}" (regra ${s.regra})`;
    if (s.origem === "submotivo") return `subtipo no submotivo: ${s.termo}`;
    if (s.origem === "sigla") return "sigla FE do ADMS (sem outra indicação no texto)";
    return s.bloqueada ? `genérica — ${s.motivo_bloqueio}` : "genérica — nenhuma indicação confiável";
  };

  /* Indicação de risco (agrupamento). Nível 2 = já classificado: sigla RV, emergência = Sim, ou subtipo de risco.
     Nível 1 = INDÍCIO no texto da comunicação por uma regra de risco (R1-R6): não reclassifica; avisa e prioriza para conferência. */
  N.indicacaoRisco = function (ch) {
    const sub = N.SUBTIPOS[ch.subtipo || ""];
    if (ch.tipo_ocorrencia === "risco_de_vida") return { nivel: 2, origem: "submotivo RV (risco de vida) no ADMS" };
    if (sub && sub.risco) return { nivel: 2, origem: `subtipo de risco: ${sub.rotulo}` };
    if (ch.emergencia === true) return { nivel: 2, origem: "marcada como emergência no ADMS" };
    const c = N.regrasQueCasam(N.textoComunicacao(ch)).find((x) => x.regra.risco);
    return c ? { nivel: 1, origem: `termo "${c.termos.join(" + ").toLowerCase()}" no texto (${c.regra.rotulo}; não classificado: conferir)` } : { nivel: 0, origem: null };
  };
  const TERMOS_FASE = ["FALTA DE FASE", "FALTANDO FASE", "FASE FALTANDO", "SEM FASE", "MEIA FASE", "UMA FASE", "SO UMA FASE"];
  N.indicioFaltaDeFase = (ch) => { const t = N.textoComunicacao(ch); return TERMOS_FASE.some((x) => contem(t, x)); };

  /* ================================================================ 1.0.2: agrupamento das comunicações do mesmo incidente */
  /* Chave = número do Incidente do ADMS (já normalizado). Nunca agrupa por UC, nome ou descrição parecida. Sem incidente = sozinha.
     "ID do Incidente Pai" não é usado para juntar incidentes diferentes (nos CSVs reais ele vem vazio).
     Comunicação principal: 1º maior nível de risco; 2º a mais recente ("Horário da call"); 3º a primeira do arquivo.
     Nenhuma comunicação é descartada: todas continuam no lote, com o seu callback, e entram nas métricas como antes. */
  N.chaveIncidente = (ch) => (ch.incidente ? "INC:" + ch.incidente : "CALL:" + ch.call_id);
  N.agruparIncidentes = function (lista) {
    const mapa = new Map();
    lista.forEach((ch, ordem) => {
      const k = N.chaveIncidente(ch);
      if (!mapa.has(k)) mapa.set(k, []);
      mapa.get(k).push({ ch, ordem, risco: N.indicacaoRisco(ch) });
    });
    const grupos = [];
    for (const [chave, itens] of mapa) {
      itens.sort((a, b) => (b.risco.nivel - a.risco.nivel) || String(b.ch.horario_call || "").localeCompare(String(a.ch.horario_call || "")) || (a.ordem - b.ordem));
      const p = itens[0], n = itens.length, maxRisco = p.risco.nivel, avisos = [];
      if (n > 1) avisos.push({ tipo: "multiplas", texto: `INCIDENTE COM MÚLTIPLAS COMUNICAÇÕES — ${n} REGISTROS` });
      if (maxRisco >= 1) avisos.push({ tipo: "risco", texto: "ATENÇÃO: EXISTE COMUNICAÇÃO COM INDICAÇÃO DE RISCO — VERIFICAR PRIORITARIAMENTE.",
        detalhe: itens.filter((x) => x.risco.nivel >= 1).map((x) => `${x.ch.call_id}: ${x.risco.origem}`).join(" · ") });
      const fe = itens.filter((x) => x.ch.tipo_ocorrencia === "falta_de_energia");
      const unidades = new Set(fe.map((x) => x.ch.uc || x.ch.custom_id_sdp || x.ch.nome || x.ch.call_id));
      if (unidades.size >= 2) avisos.push({ tipo: "possivel", texto: `POSSÍVEL OCORRÊNCIA GERAL — ${fe.length} comunicações de falta de energia de ${unidades.size} unidades diferentes neste incidente (não confirmado).` });
      if (itens.some((x) => N.indicioFaltaDeFase(x.ch))) avisos.push({ tipo: "possivel", texto: "POSSÍVEL FALTA DE FASE — citada no texto de comunicação (não confirmado)." });
      grupos.push({ chave, incidente: p.ch.incidente || null, principal: p.ch, membros: itens.map((x) => x.ch), qtd: n, risco: maxRisco,
        risco_origem: p.risco.origem, avisos, ordem: Math.min(...itens.map((x) => x.ordem)),
        tipos: [...new Set(itens.map((x) => x.ch.tipo_ocorrencia))] });
    }
    // Ordem da tabela (regra obrigatória): ESTRITAMENTE cronológica, do mais recente para o mais antigo, pela data e hora
    // ("Horário da call") da comunicação PRINCIPAL já escolhida. O risco NÃO altera a posição (só o alerta visual).
    // Empate: número do incidente (crescente, numérico); depois a chave; sem data e hora vai para o fim. Não altera registros.
    grupos.sort(N.compararCronologico);
    return grupos;
  };
  const numeroIncidente = (g) => { const m = /(\d+)/.exec(g.incidente || ""); return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER; };
  N.compararCronologico = function (a, b) {
    const ha = a.principal.horario_call || "", hb = b.principal.horario_call || "";
    if (ha !== hb) { if (!ha) return 1; if (!hb) return -1; return hb.localeCompare(ha); }
    return (numeroIncidente(a) - numeroIncidente(b)) || String(a.chave).localeCompare(String(b.chave));
  };
  N.resumoAgrupamento = function (lista) {
    const g = N.agruparIncidentes(lista), multi = g.filter((x) => x.qtd > 1);
    return { incidentes_distintos: g.filter((x) => x.incidente).length, comunicacoes_sem_incidente: g.filter((x) => !x.incidente).length,
      incidentes_com_multiplas_comunicacoes: multi.length, comunicacoes_nesses_incidentes: multi.reduce((s, x) => s + x.qtd, 0),
      grupos_com_indicacao_de_risco: g.filter((x) => x.risco >= 1).length, linhas_na_tabela: g.length };
  };

  /* ================================================================ data/hora operacional (fuso.py: America/Maceio) */
  N.FUSO = "America/Maceio";
  function partes(d) {
    const f = new Intl.DateTimeFormat("en-CA", { timeZone: N.FUSO, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    return Object.fromEntries(f.formatToParts(d).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  }
  N.hojeLocal = (d = new Date()) => { const p = partes(d); return `${p.year}-${p.month}-${p.day}`; };
  N.agoraLocalIso = function (d = new Date()) {
    const p = partes(d), local = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    const off = Math.round((local - Math.floor(d.getTime() / 1000) * 1000) / 60000), s = off < 0 ? "-" : "+", a = Math.abs(off);
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${s}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
  };

  /* ================================================================ exportação (callback/exportacao.py) */
  N.COLUNAS_EXPORTACAO = ["id_exportacao", "chave_consolidacao", "versao", "substitui_id_exportacao", "definitiva", "data_operacional",
    "instalacao", "estacao", "operador", "polo", "indicador", "dimensao", "valor", "exportado_em"];
  N.INDICADORES = ["lotes", "chamadas_processadas", "callbacks_realizados", "pendencias_contabilizadas", "sem_telefone",
    "contatos_invalidos", "tentativas", "chamadas_em_mais_de_um_lote"];
  N.seguroPlanilha = (v) => { const t = v == null ? "" : String(v); return /^[=+\-@\t\r]/.test(t) ? "'" + t : t; };
  N.nomeSeguro = (t) => (String(t || "").replace(/[^A-Za-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30)) || "sem-identificacao";
  const sorted = (o) => Object.keys(o || {}).sort().map((k) => [k, o[k]]);
  function campoCSV(v) { const t = String(v); return /[;"\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; }
  N.arredondar1 = (x) => Math.round(x * 10 + Number.EPSILON * 10) / 10;
  N.linhasExportacao = function (sessao, exp, m, instalacao) {
    const base = [exp.id, sessao.id, exp.versao, exp.substitui_id || "", exp.definitiva ? "sim" : "nao", sessao.data_operacional,
      instalacao, sessao.estacao || "", sessao.operador || "", sessao.polo];
    const q = exp.exportado_em, saida = N.INDICADORES.map((i) => base.concat([i, "", m[i] || 0, q]));
    const total = m.chamadas_processadas || 0, pct = total ? N.arredondar1(100 * (m.callbacks_realizados || 0) / total) : 0;
    saida.push(base.concat(["percentual_callbacks", "", Number.isInteger(pct) && total ? pct.toFixed(1) : pct, q]));
    for (const [k, n] of sorted(m.por_motivo)) saida.push(base.concat(["chamadas_por_motivo", k, n, q]));
    for (const [k, n] of sorted(m.por_subtipo)) saida.push(base.concat(["chamadas_por_subtipo", k, n, q]));
    return saida;
  };
  N.csvExportacao = function (registros) {
    const linhas = [N.COLUNAS_EXPORTACAO.join(";")].concat(registros.map((r) => r.map((x) => campoCSV(N.seguroPlanilha(x))).join(";")));
    return "﻿" + linhas.join("\r\n") + "\r\n";
  };
  N.nomeExportacao = (s, versao) => `indicadores_${s.data_operacional}_${N.nomeSeguro(s.estacao)}_${N.nomeSeguro(s.operador)}_${s.id.slice(0, 8)}_v${versao}.csv`;
  /* Acima: formato LONGO da 1.0.x (uma linha por indicador), mantido no código para referência. Desde a 1.1.0 o botão
     EXPORTAR DO DIA e o encerramento do dia geram o arquivo DIÁRIO abaixo. */

  /* ================================================================ 1.1.0: exportação diária (Power BI) */
  /* Uma linha por turno (dia + polo + operador), só contagens operacionais, sem nome, telefone, UC, endereço, comentário,
     CALL ou incidente. Percentuais NÃO vão no arquivo (calcular no Power BI a partir das contagens, sem média de média).
     Consolidação sem dupla contagem: por id_turno, usar só a linha de MAIOR versao (a definitiva é a última). */
  N.COLUNAS_DIA = ["data", "polo", "operador", "total_chamadas", "callbacks_realizados", "tentativas", "tentativas_sem_sucesso",
    "contatos_invalidos", "sem_telefone", "servicos_executados", "ocorrencias_resolvidas", "pendencias", "lotes_encerrados",
    "id_turno", "versao", "definitiva", "exportado_em"];
  N.linhaDia = (sessao, exp, m) => [sessao.data_operacional, sessao.polo || "", sessao.operador || "", m.chamadas_processadas || 0,
    m.callbacks_realizados || 0, m.tentativas || 0, m.tentativas_sem_sucesso || 0, m.contatos_invalidos || 0, m.sem_telefone || 0,
    m.servicos_executados || 0, m.ocorrencias_resolvidas || 0, m.pendencias_contabilizadas || 0, m.lotes || 0,
    sessao.id, exp.versao, exp.definitiva ? "sim" : "nao", exp.exportado_em];
  N.csvDia = (linha) => "﻿" + [N.COLUNAS_DIA.join(";"), linha.map((x) => campoCSV(N.seguroPlanilha(x))).join(";")].join("\r\n") + "\r\n";
  /* Nome: CALLBACK_<POLO>_<dd-mm-aaaa>.csv (ex.: CALLBACK_ARACAJU_04-11-2026.csv). Polo em maiúsculas, sem acento; espaços viram
     hífen. Segundo turno do mesmo polo no mesmo dia neste navegador: sufixo _T2, _T3... (para não sobrescrever o primeiro). */
  N.nomeArquivoDia = function (sessao, turno = 1) {
    const [a, m, d] = String(sessao.data_operacional).split("-");
    const polo = semAcento(sessao.polo || "").toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "SEM-POLO";
    return `CALLBACK_${polo}_${d}-${m}-${a}${turno > 1 ? "_T" + turno : ""}.csv`;
  };
  N.PASTA_EXPORTACAO_SUGERIDA = "W:\\SUA-PASTA-DE-REDE\\CENTRAL DE CALLBACK";

  raiz.Nucleo = N;
})(typeof window !== "undefined" ? window : globalThis);
