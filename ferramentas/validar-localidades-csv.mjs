/* Ferramenta de CONFERÊNCIA (Node, somente leitura): lê um CSV real do ADMS (chamadas_incidentes.csv, export de chamadas ou de
   incidentes, com a coluna "Localização") e mostra como js/localidades.js classifica os registros nas sete regionais.
   NÃO grava nada, NÃO importa, NÃO acessa o banco da Central e NÃO imprime dados de clientes (só municípios, códigos,
   trechos de localização sem números longos e contagens).
   - Por comunicação (cada linha) e, se houver a coluna "Incidente", também por INCIDENTE (como a Central mostra).
   - Taxa de reconhecimento: só sobre linhas da área de Sergipe (coluna "Região" ESE, quando existir) com alguma informação de
     localidade (exclui "Localidade desconhecida" e "Fora da área de Sergipe").
   Uso: node ferramentas\validar-localidades-csv.mjs "<caminho do CSV>" [--json] */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const caminho = process.argv[2];
if (!caminho) { console.error('Uso: node ferramentas\\validar-localidades-csv.mjs "<caminho do CSV>" [--json]'); process.exit(2); }
const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
globalThis.window = globalThis;
const exigir = createRequire(import.meta.url);
for (const f of ["localidades-dados.js", "localidades.js"]) exigir(join(raiz, "js", f));
const L = globalThis.Localidades;

const bytes = readFileSync(caminho);
let texto;
try { texto = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch (e) { texto = new TextDecoder("windows-1252").decode(bytes); }
texto = texto.replace(/^﻿/, "");
function ler(t, sep) {
  const linhas = []; let l = [], c = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch; }
    else if (ch === '"') q = true; else if (ch === sep) { l.push(c); c = ""; }
    else if (ch === "\n") { l.push(c.replace(/\r$/, "")); linhas.push(l); l = []; c = ""; } else c += ch;
  }
  if (c || l.length) { l.push(c); linhas.push(l); }
  return linhas;
}
const sep = [";", ",", "\t", "|"].find((s) => texto.slice(0, 4000).split(s).length > 5) || ";";
const linhas = ler(texto, sep), ic = linhas.findIndex((l) => l.map((x) => x.trim()).includes("Localização"));
if (ic < 0) { console.error("Coluna Localização não encontrada."); process.exit(1); }
const cab = linhas[ic].map((x) => x.trim()), iL = cab.indexOf("Localização"), iR = cab.indexOf("Região"), iI = cab.indexOf("Incidente");
const mascarar = (s) => String(s || "").replace(/\d{3,}/g, "#").slice(0, 90);

const registros = linhas.slice(ic + 1).filter((l) => l.length >= Math.min(cab.length - 1, iL + 1))
  .map((l, n) => ({ loc: l[iL], regiao: iR >= 0 ? l[iR] || "" : "", inc: iI >= 0 && l[iI] ? l[iI] : "linha:" + n }));
function resumo(itens, classe) {
  const porStatus = {}, porRegional = {}, porMunicipio = {}, fora = new Map();
  let base = 0, okBase = 0;
  for (const it of itens) {
    const c = classe(it);
    porStatus[c.status] = (porStatus[c.status] || 0) + 1;
    if (c.status === "ok") {
      porRegional[c.regional_nome] = (porRegional[c.regional_nome] || 0) + 1;
      const k = `${c.regional_nome} | ${c.codigo} ${c.nome}`; porMunicipio[k] = (porMunicipio[k] || 0) + 1;
    } else {
      const k = `${L.ESPECIAIS[c.chave]} | ${mascarar(c.original) || "(vazia)"} | ${c.motivo}`;
      const x = fora.get(k) || { n: 0, regioes: {} }; x.n++; const r = it.regiao || "(sem coluna Região)"; x.regioes[r] = (x.regioes[r] || 0) + 1; fora.set(k, x);
    }
    const daArea = iR < 0 || /\bESE\b/.test(it.regiao);
    if (daArea && c.status !== "desconhecida" && c.status !== "fora_se") { base++; if (c.status === "ok") okBase++; }
  }
  return { total: itens.length, por_status: porStatus, por_regional: Object.fromEntries(Object.entries(porRegional).sort()),
    por_municipio: Object.fromEntries(Object.entries(porMunicipio).sort()), taxa: { reconhecidos: okBase, base, percentual: base ? Math.round((okBase / base) * 10000) / 100 : null },
    fora_das_regionais: [...fora].sort((a, b) => b[1].n - a[1].n).map(([k, v]) => ({ item: k, n: v.n, regioes_adms: v.regioes })) };
}
const porLinha = resumo(registros, (it) => L.classificar(it.loc));
let porIncidente = null;
if (iI >= 0) {
  const grupos = new Map();
  for (const r of registros) { const g = grupos.get(r.inc) || { locs: [], regioes: new Set() }; g.locs.push(r.loc); if (r.regiao) g.regioes.add(r.regiao); grupos.set(r.inc, g); }
  porIncidente = resumo([...grupos.values()].map((g) => ({ locs: g.locs, regiao: [...g.regioes].join("; ") })), (it) => L.classificarIncidente(it.locs));
}
const saida = { arquivo: caminho.split(/[\\/]/).pop(), por_comunicacao: porLinha, por_incidente: porIncidente };
if (process.argv.includes("--json")) { console.log(JSON.stringify(saida, null, 2)); process.exit(0); }
for (const [titulo, r] of [["POR LINHA (comunicação/registro)", porLinha], ["POR INCIDENTE (como a Central agrupa)", porIncidente]]) {
  if (!r) continue;
  console.log(`\n=== ${saida.arquivo} · ${titulo} · ${r.total} · leitura somente (nada gravado)`);
  console.log("Por situação:", r.por_status);
  console.log(`Taxa de reconhecimento (área de Sergipe, com informação): ${r.taxa.reconhecidos}/${r.taxa.base} = ${r.taxa.percentual}%`);
  console.log("Por regional:", r.por_regional);
  console.log("Fora das regionais (fora da Paraíba/Tocantins, até 25):");
  for (const x of r.fora_das_regionais.filter((x) => Object.keys(x.regioes_adms).some((g) => !/^E(PB|TO)\b/.test(g))).slice(0, 25)) console.log(`  ${String(x.n).padStart(6)}  ${x.item}  ${JSON.stringify(x.regioes_adms)}`);
}
