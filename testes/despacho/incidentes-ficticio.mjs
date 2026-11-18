/* Incidentes.xlsx 100% FICTÍCIO (Despacho Otimizado 2.1), na ESTRUTURA do arquivo real auditado (16/11/2026):
   aba "incidentes", linhas 1-2 vazias, cabeçalho na linha 3 com a coluna A vazia (e a H sem nome), 48 colunas com os nomes
   reais, várias linhas por INC, equipes "Equipe: X | Equipe: Y", observação com quebra de linha, datas do ADMS.
   O .xlsx é montado aqui mesmo (ZIP + XML), sem biblioteca: deflate do Node (zlib) ou sem compressão; textos compartilhados
   ou embutidos; datas como DATA do Excel (número + formato) ou como TEXTO "m/d/aaaa h:mm:ss AM/PM" (as duas formas possíveis).
   As INCs casam com testes/despacho/dados-ficticios.mjs (chamadas fictícias). Nenhum dado real. */
import zlib from "node:zlib";
import { us } from "./dados-ficticios.mjs";

export const CABECALHO = ["", "cod defeito falha", "num ocorrencia", "UC", "Endereco", "Power Status", "Equipe", "", "Subregiao", "elemento", "local", "status incident",
  "subestacao normal", "subestacao atual", "alimentador normal", "alimentador atual", "qtd cliente interrompidos", "Usuario alteracao", "data hora ultima alteracao",
  "qtd comunicacoes", "duracao incidente", "data inicial", "chi", "data final", "obs ocorrencia", "Sub Causa", "tipo elemento", "qtd clientes atingidos",
  "qtd clientes criticos", "qtd cliente criticos interrompidos", "qtd cliente restaurados", "qtd cliente criticos restaurados", "Total Cust Interruption Duration",
  "data hora atribuicao", "data hora enviada", "data hora deslocamento", "data hora chegada", "inicio interrupcao", "acionado manutencao", "incidente pai",
  "dh combinada", "dh conhecimento", "cod_loc_Primeira_rec", "incidente programado", "incidente interrompido", "qtd clientes nao restaurados", "causa", "Problema"];

/* inc, status, equipe, local, alim, se, atrib/env/desl = minutos atrás (null = vazio), linhas = repetir a linha N vezes. */
export const REGISTROS = [
  { inc: "900000001", status: "Em Execução", equipe: "Equipe: ESE-T-EQ01 | Equipe: ESE-T-EQ02", local: "ARACAJU", alim: "AL-T01", se: "SE_T1", atrib: 45, env: 40, desl: 30, linhas: 2,
    obs: "Usuario: SIGOD: EQUIPE NO LOCAL\nAGUARDANDO MATERIAL" },
  { inc: "900000002", status: "Enviado", equipe: "Equipe: ESE-T-EQ03", local: "ARACAJU", alim: "AL-T02", se: "SE_T1", atrib: 30, env: 25 },
  { inc: "900000003", status: "Aguardando Envio", equipe: "", local: "ARACAJU", alim: "AL-T01", se: "SE_T1" },
  { inc: "900000004", status: "Concluído", equipe: "Equipe: ESE-T-EQ09", local: "ARACAJU", atrib: 60, env: 55, desl: 50 },
  { inc: "900000005", status: "Interrompido", equipe: "Equipe: ESE-T-EQ04", local: "ARACAJU", atrib: 20, env: 18 },
  { inc: "900000006", status: "Aguardando Reenvio", equipe: "", local: "ARACAJU" },
  { inc: "900000007", status: "Arquivado", equipe: "", local: "ARACAJU" },
  { inc: "900000008", status: "Cancelado", equipe: "", local: "ARACAJU" },
  { inc: "900000010", status: "Em Execução", equipe: "Equipe: ESE-T-EQ05", local: "BARRA DOS COQUEIROS", atrib: 15, env: 12, desl: 10 },
  { inc: "900000011", status: "Pendente Validação", equipe: "", local: "ARACAJU" },       // status desconhecido -> exceção
  { inc: "900000012", status: "", equipe: "", local: "NOSSA SENHORA DO SOCORRO" },           // status vazio -> exceção
  { inc: "900000013", status: "Enviado", equipe: "", local: "ARACAJU", atrib: 10, env: 12 }, // sem equipe + envio antes da atribuição
  { inc: "900000020", status: "Aguardando Envio", equipe: "", local: "LAGARTO" },
  { inc: "900000021", status: "Em Execução", equipe: "Equipe: ESE-T-EQ07", local: "LAGARTO", divergente: "Enviado" }, // status diferente na 2ª linha
  { inc: "900000030", status: "Enviado", equipe: "Equipe: ESE-T-EQ06", local: "ARACAJU", atrib: 9, env: 8 },          // município diferente das chamadas (Itabaiana)
  // 900000040 (João Pessoa nas chamadas) NÃO está no Incidentes.xlsx -> sem_registro_adms
  { inc: "900000060", status: "Aguardando Envio", equipe: "", local: "NOSSA SENHORA DO SOCORRO", alim: "AL-T09" },   // só no Incidentes.xlsx
  { inc: "900000061", status: "Concluído", equipe: "Equipe: ESE-T-EQ08", local: "ARACAJU" },                         // só no Incidentes.xlsx e excluído
  { inc: "900000062", status: "Enviado", equipe: "Equipe: ESE-T-EQ10", local: "" },                                   // só no Incidentes.xlsx, sem município
  { inc: "XYZ-1", status: "Enviado", equipe: "", local: "ARACAJU" },                                                   // número inválido -> descartada
];
/* Resultado ESPERADO (conferido à mão a partir de REGISTROS + CHAMADAS). */
export const ESPERADO_INC = {
  registros: 21, incs: 18, descartadas: 1,
  operacionais: ["900000001", "900000002", "900000003", "900000005", "900000006", "900000010", "900000013", "900000020", "900000030", "900000060", "900000062"],
  excluidas: ["900000004", "900000007", "900000008", "900000061"],
  excecoes: { "900000011": "status_desconhecido", "900000012": "status_vazio", "900000021": "status_divergente", "900000040": "sem_registro_adms" },
};

/* ------------------------------------------------------------ montagem do .xlsx */
const xmlEsc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const colLetra = (i) => { let s = ""; i++; while (i) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };
const serial = (d) => (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()) - Date.UTC(1899, 11, 30)) / 86400000;

export function linhasIncidentes(agora, registros = REGISTROS) {
  const linhas = [];
  const dt = (min) => (min == null ? null : new Date(agora - min * 60000));
  for (const r of registros) {
    const o = { "num ocorrencia": /^\d+$/.test(r.inc) ? "INC " + r.inc : r.inc, UC: "UC_FICT", Endereco: "xxxx", "Power Status": "Interrompido", Equipe: r.equipe, Subregiao: "Teste",
      elemento: "ESE_UC_FICT", local: r.local, "status incident": r.status, "subestacao normal": r.se || "", "subestacao atual": r.se || "", "alimentador normal": r.alim || "",
      "alimentador atual": r.alim || "", "qtd cliente interrompidos": 1, "qtd comunicacoes": 1, "data inicial": dt(70), "obs ocorrencia": r.obs || "", "Sub Causa": "Nenhuma",
      "tipo elemento": "Consumidor", "data hora atribuicao": dt(r.atrib), "data hora enviada": dt(r.env), "data hora deslocamento": dt(r.desl), causa: "FE" };
    linhas.push(o);
    for (let k = 1; k < (r.linhas || 1); k++) linhas.push({ ...o });
    if (r.divergente) linhas.push({ ...o, "status incident": r.divergente });
  }
  return linhas;
}
/* opções: compressao "deflate"|"store"; textos "compartilhados"|"embutidos"; datas "excel"|"texto"; aba (nome); semColuna (nome a omitir);
   linhas: linhas já montadas ({ coluna do CABECALHO: valor }), no lugar de registros (usado pela base de simulação em testes/fixtures). */
export function xlsxIncidentes(agora, { registros = REGISTROS, linhas: prontas = null, compressao = "deflate", textos = "compartilhados", datas = "excel", aba = "incidentes", semColuna = null, linhaCabecalho = 3 } = {}) {
  const cab = CABECALHO.map((c) => (c === semColuna ? "coluna removida" : c));
  const linhas = prontas || linhasIncidentes(agora, registros);
  const compart = [], idx = new Map();
  const texto = (s) => { if (!idx.has(s)) { idx.set(s, compart.length); compart.push(s); } return idx.get(s); };
  const celula = (ref, v) => {
    if (v === null || v === undefined || v === "") return "";
    if (v instanceof Date) return datas === "excel" ? `<c r="${ref}" s="1"><v>${serial(v)}</v></c>` : celula(ref, us(v));
    if (typeof v === "number") return `<c r="${ref}"><v>${v}</v></c>`;
    const s = String(v).replace(/\r?\n/g, "\r\n").replace(/\r/g, "_x000D_");
    return textos === "compartilhados" ? `<c r="${ref}" t="s"><v>${texto(s)}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(s)}</t></is></c>`;
  };
  let sd = "";
  const linha = (n, vals) => { sd += `<row r="${n}">${vals.map((v, j) => celula(colLetra(j) + n, v)).join("")}</row>`; };
  linha(linhaCabecalho, cab);
  linhas.forEach((o, i) => linha(linhaCabecalho + 1 + i, cab.map((c) => (c ? o[c] : ""))));
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sd}</sheetData></worksheet>`;
  const arquivos = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr/><sheets><sheet name="${xmlEsc(aba)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="styles" Target="styles.xml"/><Relationship Id="rId3" Type="sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
    "xl/styles.xml": `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="m/d/yyyy h:mm:ss AM/PM"/></numFmts><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164" applyNumberFormat="1"/></cellXfs></styleSheet>`,
    "xl/worksheets/sheet1.xml": sheet,
  };
  if (textos === "compartilhados") arquivos["xl/sharedStrings.xml"] = `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${compart.length}" uniqueCount="${compart.length}">${compart.map((s) => `<si><t xml:space="preserve">${xmlEsc(s)}</t></si>`).join("")}</sst>`;
  return zip(arquivos, compressao);
}
/* ZIP mínimo (o mesmo formato que o Excel grava): cabeçalhos locais + diretório central + fim. */
export function zip(arquivos, compressao = "deflate") {
  const partes = [], central = [];
  let pos = 0;
  for (const [nome, conteudo] of Object.entries(arquivos)) {
    const dados = Buffer.from(conteudo, "utf8"), comp = compressao === "deflate" ? zlib.deflateRawSync(dados) : dados, metodo = compressao === "deflate" ? 8 : 0;
    const n = Buffer.from(nome, "utf8"), crc = zlib.crc32(dados);
    const loc = Buffer.alloc(30); loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4); loc.writeUInt16LE(metodo, 8); loc.writeUInt32LE(crc, 14);
    loc.writeUInt32LE(comp.length, 18); loc.writeUInt32LE(dados.length, 22); loc.writeUInt16LE(n.length, 26);
    const cen = Buffer.alloc(46); cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(metodo, 10); cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(dados.length, 24); cen.writeUInt16LE(n.length, 28); cen.writeUInt32LE(pos, 42);
    partes.push(loc, n, comp); central.push(cen, n);
    pos += 30 + n.length + comp.length;
  }
  const cd = Buffer.concat(central), fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(central.length / 2, 8); fim.writeUInt16LE(central.length / 2, 10); fim.writeUInt32LE(cd.length, 12); fim.writeUInt32LE(pos, 16);
  return new Uint8Array(Buffer.concat([...partes, cd, fim]));
}
