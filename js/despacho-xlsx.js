/* DESPACHO OTIMIZADO 2.1 — leitor de XLSX (Office Open XML) SEM bibliotecas e sem rede.
   Um .xlsx é um ZIP com XML dentro. Este leitor faz só o necessário para ler UMA aba de dados:
   - ZIP: lê o diretório central (tamanhos confiáveis mesmo com "data descriptor"); método 0 (guardado) e 8 (deflate), este
     pelo descompressor nativo do navegador (DecompressionStream "deflate-raw"; o Node 18+ dos testes tem o mesmo). Confere o
     CRC-32 e o tamanho de cada parte: arquivo truncado ou corrompido é RECUSADO (nunca devolve dados pela metade).
   - XML: varredura própria (sem DOMParser, que não existe no Node), entidades XML e o escape OOXML _xHHHH_ (ex.: _x000D_).
   - Planilha: textos compartilhados (sharedStrings, inclusive rich text), texto embutido (inlineStr), fórmula (str), número,
     booleano e erro; células vazias PRESERVADAS pela posição (A1, B1...); quebras de linha dentro da célula mantidas ("\n").
   - Datas: número com formato de data (estilos embutidos 14-22, 27-36, 45-47, 50-58 ou formato próprio com d/m/a/h/s) vira
     "aaaa-mm-ddThh:mm:ss" (horário local do ADMS, sem fuso, como a Central). Sistema 1900 e 1904. Texto continua texto.
   Nada aqui conhece o ADMS: as regras do Incidentes.xlsx ficam em js/despacho-incidentes.js. */
"use strict";
(function (raiz) {
  class ErroXLSX extends Error { constructor(mensagem, codigo) { super(mensagem); this.name = "ErroXLSX"; this.codigo = codigo; } }
  const erro = (codigo, msg) => new ErroXLSX(msg, codigo);

  /* ------------------------------------------------------------ ZIP */
  const TABELA_CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = TABELA_CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  const u16 = (b, i) => b[i] | (b[i + 1] << 8);
  const u32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
  const utf8 = new TextDecoder("utf-8");

  function diretorio(bytes) {
    if (!bytes || !bytes.length) throw erro("vazio", "arquivo vazio (0 bytes)");
    if (bytes.length < 22 || u32(bytes, 0) !== 0x04034b50) throw erro("nao_xlsx", "o arquivo não é um XLSX (assinatura ZIP ausente)");
    let fim = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (u32(bytes, i) === 0x06054b50) { fim = i; break; }
    if (fim < 0) throw erro("incompleto", "arquivo incompleto: o final do pacote XLSX não foi encontrado (gravação interrompida?)");
    const total = u16(bytes, fim + 10), tamCD = u32(bytes, fim + 12), iniCD = u32(bytes, fim + 16);
    if (iniCD === 0xFFFFFFFF || total === 0xFFFF) throw erro("nao_suportado", "XLSX em formato ZIP64 (não suportado)");
    if (iniCD + tamCD > fim) throw erro("incompleto", "arquivo incompleto: índice interno do XLSX fora do arquivo");
    const partes = new Map();
    let p = iniCD;
    for (let k = 0; k < total; k++) {
      if (p + 46 > bytes.length || u32(bytes, p) !== 0x02014b50) throw erro("corrompido", "arquivo corrompido: índice interno do XLSX inválido");
      const flags = u16(bytes, p + 8), metodo = u16(bytes, p + 10), crc = u32(bytes, p + 16), comp = u32(bytes, p + 20), tam = u32(bytes, p + 24);
      const nN = u16(bytes, p + 28), nX = u16(bytes, p + 30), nC = u16(bytes, p + 32), ini = u32(bytes, p + 42);
      const nome = utf8.decode(bytes.subarray(p + 46, p + 46 + nN)).replace(/\\/g, "/");
      if (flags & 1) throw erro("protegido", "XLSX protegido por senha (não é possível ler)");
      partes.set(nome.replace(/^\//, ""), { metodo, crc, comp, tam, ini });
      p += 46 + nN + nX + nC;
    }
    return partes;
  }
  /* Descompressor padrão: o do navegador (sem biblioteca). Pode ser trocado em opcoes.inflar (testes). */
  async function inflarNativo(dados) {
    if (typeof DecompressionStream !== "function") throw erro("nao_suportado", "este navegador não descompacta XLSX (use o Edge ou o Chrome atualizados)");
    const fluxo = new Blob([dados]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(fluxo).arrayBuffer());
  }
  async function extrair(bytes, partes, nome, inflar) {
    const e = partes.get(nome);
    if (!e) return null;
    if (e.ini + 30 > bytes.length || u32(bytes, e.ini) !== 0x04034b50) throw erro("corrompido", `arquivo corrompido: parte ${nome} inválida`);
    const ini = e.ini + 30 + u16(bytes, e.ini + 26) + u16(bytes, e.ini + 28);
    if (ini + e.comp > bytes.length) throw erro("incompleto", `arquivo incompleto: parte ${nome} cortada`);
    const dados = bytes.subarray(ini, ini + e.comp);
    let out;
    if (e.metodo === 0) out = dados;
    else if (e.metodo === 8) { try { out = await inflar(dados); } catch (x) { if (x instanceof ErroXLSX) throw x; throw erro("corrompido", `arquivo corrompido: não foi possível descompactar ${nome}`); } }
    else throw erro("nao_suportado", `compressão ${e.metodo} não suportada (${nome})`);
    if (out.length !== e.tam || crc32(out) !== e.crc) throw erro("corrompido", `arquivo corrompido: conteúdo de ${nome} não confere (CRC/tamanho)`);
    return utf8.decode(out);
  }

  /* ------------------------------------------------------------ XML (varredura simples, suficiente para o OOXML) */
  const ENT = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
  function texto(t) {
    if (!t) return "";
    const s = t.indexOf("&") < 0 ? t : t.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, c) =>
      c[0] === "#" ? String.fromCodePoint(c[1] === "x" || c[1] === "X" ? parseInt(c.slice(2), 16) : parseInt(c.slice(1), 10)) : ENT[c] ?? m);
    return s.indexOf("_x") < 0 ? s : s.replace(/_x([0-9a-fA-F]{4})_/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
  }
  function atributos(a) { const o = {}; if (a) for (const m of a.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) o[m[1].replace(/^.*:/, "")] = texto(m[2] ?? m[3]); return o; }
  /* Percorre as marcas: chama f(nome sem prefixo, atributos, tipo "abre"|"fecha"|"vazia", texto antes da marca). */
  function varrer(xml, f) {
    let i = 0, ultimo = 0;
    const n = xml.length;
    while (i < n) {
      const a = xml.indexOf("<", i);
      if (a < 0) break;
      if (xml.startsWith("<?", a)) { i = xml.indexOf("?>", a) + 2; if (i < 2) break; continue; }
      if (xml.startsWith("<!--", a)) { i = xml.indexOf("-->", a) + 3; if (i < 3) break; continue; }
      if (xml.startsWith("<![CDATA[", a)) { const b = xml.indexOf("]]>", a); if (b < 0) break; f("#cdata", null, "texto", xml.slice(a + 9, b)); i = ultimo = b + 3; continue; }
      const b = xml.indexOf(">", a);
      if (b < 0) throw erro("corrompido", "XML do XLSX incompleto");
      const antes = xml.slice(ultimo, a), corpo = xml.slice(a + 1, b);
      i = ultimo = b + 1;
      if (corpo[0] === "/") { f(corpo.slice(1).trim().replace(/^.*:/, ""), null, "fecha", antes); continue; }
      const vazia = corpo.endsWith("/"), c = vazia ? corpo.slice(0, -1) : corpo, esp = c.search(/\s/);
      const nome = (esp < 0 ? c : c.slice(0, esp)).replace(/^.*:/, "");
      f(nome, esp < 0 ? "" : c.slice(esp), vazia ? "vazia" : "abre", antes);
    }
  }

  /* ------------------------------------------------------------ partes da planilha */
  function textosCompartilhados(xml) {
    const out = [];
    if (!xml) return out;
    let atual = null, emT = false, fonetica = 0;
    varrer(xml, (nome, attr, tipo, antes) => {
      if (tipo === "texto") { if (emT && atual !== null && !fonetica) atual += antes; return; }
      if (emT && tipo === "fecha" && nome === "t" && !fonetica && atual !== null) atual += texto(antes);
      if (nome === "si") { if (tipo === "abre") atual = ""; else if (tipo === "fecha") { out.push(atual ?? ""); atual = null; } else out.push(""); }
      else if (nome === "rPh") { if (tipo === "abre") fonetica++; else if (tipo === "fecha") fonetica--; }
      else if (nome === "t") emT = tipo === "abre";
    });
    return out;
  }
  const DATAS_EMBUTIDAS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
  function formatoEhData(codigo) {
    const c = String(codigo || "").replace(/"[^"]*"/g, "").replace(/\\./g, "").replace(/\[(?!h\]|hh\]|m\]|mm\]|s\]|ss\])[^\]]*\]/gi, "").split(";")[0];
    return !/^general$/i.test(c.trim()) && /[dmyhs]/i.test(c);
  }
  /* Estilos: índice do estilo da célula (atributo s) -> é data? */
  function estilosDeData(xml) {
    const formatos = new Map(), ehData = [];
    if (!xml) return ehData;
    let emXfs = false;
    varrer(xml, (nome, attr, tipo) => {
      if (nome === "numFmt" && tipo !== "fecha") { const a = atributos(attr); formatos.set(Number(a.numFmtId), a.formatCode || ""); }
      else if (nome === "cellXfs") emXfs = tipo === "abre";
      else if (nome === "xf" && emXfs && tipo !== "fecha") {
        const id = Number(atributos(attr).numFmtId || 0);
        ehData.push(formatos.has(id) ? formatoEhData(formatos.get(id)) : DATAS_EMBUTIDAS.has(id));
      }
    });
    return ehData;
  }
  const dois = (x) => String(x).padStart(2, "0");
  function serialParaData(v, data1904) {
    if (!Number.isFinite(v) || v < 0 || v > 2958465) return null;
    const ms = (data1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30)) + Math.round(v * 86400) * 1000;
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${dois(d.getUTCMonth() + 1)}-${dois(d.getUTCDate())}T${dois(d.getUTCHours())}:${dois(d.getUTCMinutes())}:${dois(d.getUTCSeconds())}`;
  }
  const colunaDe = (ref) => { const m = /^([A-Z]+)/i.exec(ref || ""); if (!m) return -1; let n = 0; for (const ch of m[1].toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  const linhaDe = (ref) => { const m = /(\d+)$/.exec(ref || ""); return m ? Number(m[1]) : 0; };

  /* Aba -> linhas[]: linhas[0] = linha 1 da planilha; cada linha é um vetor de valores ("" = célula vazia). */
  function lerAba(xml, compartilhados, ehData, data1904, limiteLinhas) {
    const linhas = [];
    let linhaAtual = 0, colAtual = -1, cel = null, emV = false, emIs = false, valor = "", textoIs = "";
    const guardar = () => {
      if (!cel) return;
      let v;
      const t = cel.t || "n";
      if (t === "s") { const k = Number(valor); if (!Number.isInteger(k) || k < 0 || k >= compartilhados.length) throw erro("corrompido", "arquivo corrompido: referência a texto inexistente"); v = compartilhados[k]; }
      else if (t === "inlineStr") v = textoIs;
      else if (t === "str" || t === "e" || t === "d") v = valor;
      else if (t === "b") v = valor === "1" ? "VERDADEIRO" : valor === "0" ? "FALSO" : valor;
      else if (valor === "") v = "";
      else { const num = Number(valor); v = Number.isFinite(num) ? (ehData[Number(cel.s || 0)] ? serialParaData(num, data1904) ?? valor : num) : valor; }
      if (typeof v === "string") v = v.replace(/\r\n?/g, "\n");
      const lin = (linhas[linhaAtual - 1] ||= []);
      lin[colAtual] = v;
      cel = null;
    };
    varrer(xml, (nome, attr, tipo, antes) => {
      if (nome === "row" && tipo !== "fecha") {
        const a = atributos(attr); linhaAtual = a.r ? Number(a.r) : linhaAtual + 1; colAtual = -1;
        if (limiteLinhas && linhaAtual > limiteLinhas) throw erro("nao_suportado", `planilha com mais de ${limiteLinhas} linhas`);
        linhas[linhaAtual - 1] ||= [];
      } else if (nome === "c") {
        if (tipo === "fecha") { if (emV) emV = false; guardar(); return; }
        const a = atributos(attr); colAtual = a.r ? colunaDe(a.r) : colAtual + 1;
        if (a.r && linhaDe(a.r) && linhaDe(a.r) !== linhaAtual) linhaAtual = linhaDe(a.r);
        cel = a; valor = ""; textoIs = "";
        if (tipo === "vazia") { cel = null; (linhas[linhaAtual - 1] ||= [])[colAtual] = ""; }
      } else if (nome === "v" && cel) { if (tipo === "abre") emV = true; else if (tipo === "fecha") { valor += texto(antes); emV = false; } }
      else if (nome === "is" && cel) emIs = tipo === "abre";
      else if (nome === "t" && emIs && tipo === "fecha") textoIs += texto(antes);
    });
    for (let i = 0; i < linhas.length; i++) { const l = (linhas[i] ||= []); for (let j = 0; j < l.length; j++) if (l[j] === undefined) l[j] = ""; }
    return linhas;
  }

  /* ------------------------------------------------------------ API */
  const resolverAlvo = (alvo) => { let t = String(alvo || "").replace(/\\/g, "/"); if (t.startsWith("/")) return t.slice(1); const p = ("xl/" + t).split("/"), out = []; for (const x of p) { if (x === "..") out.pop(); else if (x && x !== ".") out.push(x); } return out.join("/"); };
  /* ler(bytes, { aba: "nome" (sem diferenciar maiúsculas), inflar, limiteLinhas }) ->
     { abas: [nomes], aba, linhas, data1904 }. Erros: ErroXLSX com codigo vazio|nao_xlsx|incompleto|corrompido|sem_aba|protegido|nao_suportado. */
  async function ler(bytes, opcoes = {}) {
    const inflar = opcoes.inflar || inflarNativo;
    const partes = diretorio(bytes);
    const wb = await extrair(bytes, partes, "xl/workbook.xml", inflar);
    if (!wb) throw erro("nao_xlsx", "o arquivo não é uma pasta de trabalho do Excel (xl/workbook.xml ausente)");
    const rels = await extrair(bytes, partes, "xl/_rels/workbook.xml.rels", inflar) || "";
    const alvos = new Map(), abas = [];
    let data1904 = false;
    varrer(rels, (nome, attr, tipo) => { if (nome === "Relationship" && tipo !== "fecha") { const a = atributos(attr); alvos.set(a.Id, a.Target); } });
    varrer(wb, (nome, attr, tipo) => {
      if (tipo === "fecha") return;
      if (nome === "workbookPr") { const v = atributos(attr).date1904; data1904 = v === "1" || v === "true"; }
      if (nome === "sheet") { const a = atributos(attr); abas.push({ nome: a.name || "", caminho: resolverAlvo(alvos.get(a.id)) }); }
    });
    if (!abas.length) throw erro("corrompido", "arquivo sem abas");
    const quero = String(opcoes.aba || "").trim().toLowerCase();
    const aba = quero ? abas.find((a) => a.nome.trim().toLowerCase() === quero) : abas[0];
    if (!aba) throw erro("sem_aba", `aba "${opcoes.aba}" não encontrada (abas no arquivo: ${abas.map((a) => a.nome).join(", ")})`);
    const xmlAba = await extrair(bytes, partes, aba.caminho, inflar);
    if (xmlAba === null) throw erro("corrompido", `arquivo corrompido: conteúdo da aba "${aba.nome}" ausente`);
    const compartilhados = textosCompartilhados(await extrair(bytes, partes, "xl/sharedStrings.xml", inflar));
    const ehData = estilosDeData(await extrair(bytes, partes, "xl/styles.xml", inflar));
    return { abas: abas.map((a) => a.nome), aba: aba.nome, linhas: lerAba(xmlAba, compartilhados, ehData, data1904, opcoes.limiteLinhas || 200000), data1904 };
  }

  raiz.LeitorXLSX = { ler, ErroXLSX, crc32, formatoEhData, serialParaData, colunaDe };
})(typeof window !== "undefined" ? window : globalThis);
