/* Ferramenta de DESENVOLVIMENTO (Node): gera js/localidades-dados.js a partir de um export REAL de incidentes do ADMS
   (ex.: HISTORICO.csv, com as colunas "Localização" e "Região"). Grava SÓ: nome do município -> UF, e os pares "código_NOME" vistos SÓ fora de Sergipe. Sem contagens, sem regiões do ADMS e
   sem nenhum dado de cliente, endereço ou incidente (o arquivo gerado é publicado).
   Uso: node ferramentas\gerar-localidades.mjs "<caminho>\HISTORICO.csv"
   - Município/código: os MESMOS trechos que js/localidades.js reconhece (Localidades.trechos), sem regra repetida aqui.
   - UF: "SE" se aparece em alguma Região "ESE - ..."; "PB" se só em "EPB - ..."; "TO" se só em "ETO - ..."; senão null.
   - js/localidades.js usa a tabela só para separar "Fora da área de Sergipe" (ex.: 1_JOAO PESSOA, 113_ITABAIANA). */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const origem = process.argv[2];
if (!origem) throw new Error("Informe o caminho do CSV de referência.");
const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
globalThis.window = globalThis;
createRequire(import.meta.url)(join(raiz, "js", "localidades.js"));
const L = globalThis.Localidades;

const texto = readFileSync(origem, "utf8").replace(/^﻿/, "");
function ler(t) {
  const linhas = []; let l = [], c = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch; }
    else if (ch === '"') q = true; else if (ch === ";") { l.push(c); c = ""; }
    else if (ch === "\n") { l.push(c.replace(/\r$/, "")); linhas.push(l); l = []; c = ""; } else c += ch;
  }
  if (c || l.length) { l.push(c); linhas.push(l); }
  return linhas;
}
const linhas = ler(texto), ic = linhas.findIndex((l) => l.includes("Localização") && l.includes("Região"));
if (ic < 0) throw new Error("Cabeçalho com Localização e Região não encontrado.");
const cab = linhas[ic], iL = cab.indexOf("Localização"), iR = cab.indexOf("Região");
const nomes = {}, pares = {}; let total = 0, comNome = 0;
const somar = (tab, k, regs) => { const x = tab[k] || (tab[k] = { n: 0, regioes: {} }); x.n++; for (const r of regs) x.regioes[r] = (x.regioes[r] || 0) + 1; };
for (const l of linhas.slice(ic + 1)) {
  if (l.length < cab.length - 1) continue;
  total++;
  const regs = String(l[iR] || "").split(";").map((r) => r.trim()).filter(Boolean);
  const ts = L.trechos(l[iL]).filter((t) => t.nome);
  if (ts.length) comNome++;
  for (const t of ts) { somar(nomes, t.nome, regs); if (t.codigo !== null) somar(pares, `${t.codigo}_${t.nome}`, regs); }
}
const uf = (regioes) => {
  const rs = Object.keys(regioes);
  if (!rs.length) return null;
  if (rs.some((r) => /^ESE\b/.test(r))) return "SE";
  if (rs.every((r) => /^EPB\b/.test(r))) return "PB";
  if (rs.every((r) => /^ETO\b/.test(r))) return "TO";
  return null;
};
const municipios = {};
for (const [m, x] of Object.entries(nomes).sort()) municipios[m] = { uf: uf(x.regioes) };
const paresFora = Object.entries(pares).filter(([, x]) => { const u = uf(x.regioes); return u && u !== "SE"; }).map(([k]) => k).sort();
const saida = join(raiz, "js", "localidades-dados.js");
writeFileSync(saida, `/* GERADO por ferramentas/gerar-localidades.mjs — não editar à mão. Referência: export de incidentes do ADMS.
   Só nome do município e UF: sem contagens, sem dados de clientes, endereços ou incidentes.
   uf: "SE" (alguma Região ESE), "PB"/"TO" (só Regiões EPB/ETO). pares_fora: "código_NOME" vistos SÓ fora de Sergipe. */
"use strict";
window.LOCALIDADES_REFERENCIA = ${JSON.stringify({ gerado_em: new Date().toISOString().slice(0, 10), municipios, pares_fora: paresFora }, null, 0)};
`);
console.log(`${Object.keys(municipios).length} nomes · ${paresFora.length} pares código_nome fora de SE · ${total} incidentes (${comNome} com nome) → ${saida}`);
