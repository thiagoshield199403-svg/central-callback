/* Testes PONTA A PONTA dos filtros operacionais do ENVIO EM LOTE (Regionais e municípios, Período, Situação).
   Uso: node testes\ponta-a-ponta\e2e-lote-filtros.mjs [caminho-do-navegador]   (FOTOS=<pasta> grava capturas de tela)
   DADOS 100% FICTÍCIOS, só para o teste: parte de exemplos\navegador-chamadas-ADMS2026-FICTICIO.csv e acrescenta comunicações
   fictícias em municípios REAIS das sete regionais (js/localidades.js), gravadas num arquivo temporário e importadas num banco
   separado (?bd=...). Nada vai para a base real. As contagens esperadas são calculadas aqui, no Node, com as mesmas regras,
   e comparadas com o que a tela mostra. WhatsApp: a janela é simulada (window.open), nada é enviado. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { abrirNavegador, espera } from "./cdp.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const resultados = [];
async function teste(nome, f) {
  try { await f(); resultados.push([true, nome]); console.log("OK    " + nome); }
  catch (e) { resultados.push([false, nome, e.message]); console.log("FALHA " + nome + " — " + e.message); }
}
const verdade = (c, m) => { if (!c) throw new Error(m || "condição falsa"); };
const igual = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || "esperado"}: ${JSON.stringify(b)}, obtido: ${JSON.stringify(a)}`); };

/* ---------------- CSV fictício de várias regionais */
const BASE = readFileSync(join(raiz, "exemplos", "navegador-chamadas-ADMS2026-FICTICIO.csv"), "utf8").replace(/^﻿/, "");
const linhas = BASE.replace(/\r?\n$/, "").split(/\r?\n/);
const campos = (l) => [...l.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1]); // todos os campos vêm entre aspas
const montar = (fs) => fs.map((f) => `"${f}"`).join(";") + ";";
const iCab = linhas.findIndex((l) => l.includes('"ID"') && l.includes('"Horário da call"')), cab = campos(linhas[iCab]);
const col = (n) => { const i = cab.indexOf(n); if (i < 0) throw new Error("coluna " + n); return i; };
const [cHora, cId, cInc, cLoc, cCont, cRec] = ["Horário da call", "ID", "Incidente", "Localização", "Contato do reclamante", "Recebido ADMS"].map(col);
const modelo = campos(linhas[iCab + 1]);
let seq = 0;
function nova(municipio, data, { contato = "MOBILE: (79) 99800-" + String(1000 + seq), loc = null, inc = null } = {}) {
  const f = modelo.slice(), n = 9700000 + ++seq;
  f[cId] = "CALL " + n; f[cInc] = inc || "INC " + (8700000 + seq); f[cLoc] = loc !== null ? loc : `End:: RUA FICTICIA_${seq}_BAIRRO TESTE; ${municipio}`;
  f[cHora] = data; f[cRec] = data; f[cCont] = contato;
  return montar(f);
}
const extras = [
  nova("1_ARACAJU", "13/03/2026 08:00:00"), nova("10_BARRA DOS COQUEIROS", "11/03/2026 09:30:00"), nova("20_NOSSA SENHORA DO SOCORRO", "12/03/2026 10:00:00"),
  nova("280_PIRAMBU", "11/03/2026 11:00:00"), nova("468_PROPRIA", "12/03/2026 12:00:00"), nova("570_NEOPOLIS", "13/03/2026 13:00:00"),
  nova("220_MARUIM", "10/03/2026 14:00:00"), nova("210_SIMAO DIAS", "11/03/2026 15:00:00"), nova("490_AQUIDABA", "12/03/2026 16:00:00"),
  nova("420_MONTE ALEGRE DE SERGIPE", "12/03/2026 16:30:00"), nova("450_POCO REDONDO", "12/03/2026 17:30:00"), nova("POCO REDONDO", "12/03/2026 18:00:00"),
  nova("200_POCO VERDE", "12/03/2026 18:10:00"), nova("SANTO AMARO", "12/03/2026 18:20:00"), nova("AMPARO DO SAO FRANCISCO", "12/03/2026 18:30:00"),
  nova("350_CANINDE DE SAO FRANCISCO", "12/03/2026 18:40:00"), nova("30_PEDRO REGIS", "12/03/2026 18:50:00"),
  // Incidente com duas comunicações (formato real): a mais recente (principal) com Localização VAZIA; a outra no campo de pesquisa.
  nova("", "12/03/2026 19:10:00", { loc: "", inc: "INC 8799001" }), nova("", "12/03/2026 19:00:00", { loc: "ESE_Municipio_Pesquisa: CANHOBA", inc: "INC 8799001" }),
  nova("", "12/03/2026 19:20:00", { loc: "CENTRO · CARIRA" }), nova("", "12/03/2026 19:30:00", { loc: "x; 620_ARACAJU" }),
  nova("1_ARACAJU", ""), // sem data identificada
  nova("10_BARRA DOS COQUEIROS", "12/03/2026 17:00:00", { contato: "" }), // sem telefone
];
const CSV = "﻿" + linhas.join("\r\n") + "\r\n" + extras.join("\r\n") + "\r\n";
const pasta = mkdtempSync(join(tmpdir(), "central-lote-filtros-")), arquivo = join(pasta, "chamadas-ficticias-varias-regionais.csv");
writeFileSync(arquivo, CSV);

/* ---------------- contagens esperadas, calculadas no Node com as MESMAS regras (independente da tela) */
const exigir = createRequire(import.meta.url);
globalThis.window = globalThis;
for (const f of ["modelos.js", "nucleo.js", "localidades-dados.js", "localidades.js"]) exigir(join(raiz, "js", f));
const N = globalThis.Nucleo, L = globalThis.Localidades;
const comunicacoes = N.analisar(new TextEncoder().encode(CSV)).validas;
const incidentes = N.agruparIncidentes(comunicacoes).map((g) => ({ ...L.classificarIncidente(g.membros.map((c) => c.localizacao)), gchave: g.chave, principal_vazia: !g.principal.localizacao, dia: String(g.principal.horario_call || "").slice(0, 10), inc: g.principal.incidente || "", tem_telefone: g.principal.telefones.some((x) => x.numero) }));
const esperado = (f) => incidentes.filter(f).length;
// O incidente aparece em cada município reconhecido nas suas comunicações (chaves), como na Central.
const em = (x, ks) => x.chaves.some((k) => ks.includes(k)), naRegional = (x, id) => em(x, L.chavesDaRegional(id));
const incsDe = (f) => incidentes.filter(f).map((x) => x.gchave).sort();

/* ---------------- navegador */
const nav = await abrirNavegador({ exe: process.argv[2] });
const pg = await nav.novaPagina(pathToFileURL(join(raiz, "index.html")).href + "?bd=e2elf" + Date.now().toString(36));
const js = (e) => pg.js(e), S = "window.CentralUI.servico";
const clicar = (s) => js(`(() => { const e = document.querySelector(${JSON.stringify(s)}); if (!e) throw new Error("não achei ${s.replace(/"/g, "'")}"); e.click(); return true; })()`);
const escolher = async (sel, valor) => { await js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(valor)}; e.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`); await espera(120); };
const FR = "#ds-regionais";
const marcar = async (sel) => { await clicar(`${FR} ${sel}`); await espera(80); };
const limpar = async () => { await clicar(`${FR} [data-fr-acao="limpar"]`); await espera(80); };
const so = async (...chaves) => { await limpar(); for (const k of chaves) await marcar(`[data-fr-chave="${k}"]`); };
const regional = async (id) => { await limpar(); await marcar(`[data-fr-regional="${id}"]`); };
const linhasTela = () => js(`[...document.querySelectorAll("#ds-linhas tr[data-chave]")].map((t) => ({ chave: t.dataset.chave, local: t.querySelector(".c-localidade").textContent.trim(), data: t.querySelector(".data-hora").textContent, elegivel: !t.classList.contains("inelegivel") }))`);
const totais = () => js(`Object.fromEntries([...document.querySelectorAll("#ds-resumo [data-total]")].map((m) => [m.dataset.total, Number(m.querySelector(".valor").textContent)]))`);
const base = () => js(`JSON.stringify([${S}.estado().lotes.map((l) => [l.id, l.situacao]), ${S}.chamadas().map((c) => [c.id, c.call_id, c.localizacao, c.horario_call])])`);
const metr = () => js(`${S}.metricasTempoReal().callbacks_realizados`);
await pg.aguardar("document.body.dataset.pronto === '1'");
await js(`(window.__links = [], window.open = () => { const j = { closed: false, opener: 1, close() {}, focus() {} }; Object.defineProperty(j, "location", { value: { set href(u) { window.__links.push(u); } } }); return j; }, true)`);
await js(`(() => { const f = document.querySelector("#form-dia"); f.operador.value = "flt1"; if (f.polo) f.polo.value = "Aracaju"; f.requestSubmit(); return true; })()`);
await pg.aguardar("!!document.querySelector('#importar').offsetParent");
const doc = await pg.cmd("DOM.getDocument", {}), { nodeId } = await pg.cmd("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "#arquivo" });
await pg.cmd("DOM.setFileInputFiles", { nodeId, files: [arquivo] }); await pg.aguardar("!!document.querySelector('#btn-confirmar-import')"); await clicar("#btn-confirmar-import");
await pg.aguardar("document.querySelectorAll('#linhas tr[data-id]').length > 0");
await clicar('[data-modo="lote"]'); await pg.aguardar("!!document.querySelector('#ds-regionais .fr')");
const baseInicial = await base(), lotesInicial = await js(`${S}.estado().lotes.length`);

await teste("Totais antes dos filtros: comunicações importadas, incidentes únicos (agrupados), pendentes, sem telefone e sem data", async () => {
  igual(await js(`${S}.chamadas().length`), comunicacoes.length, "comunicações no lote");
  verdade(comunicacoes.length > incidentes.length, "há incidentes com várias comunicações");
  const t = await totais();
  igual([t.importado, t.encontrados, t.sem_telefone, t.realizados, t.sem_data], [comunicacoes.length, incidentes.length, esperado((x) => !x.tem_telefone), 0, esperado((x) => !x.dia)]);
  igual(await js(`[...document.querySelector("#ds-situacao").options].map((o) => o.value)[0]`), "pendentes", "situação padrão: pendentes");
  igual((await linhasTela()).length, t.pendentes, "lista mostra os pendentes");
  igual(await js(`document.querySelector("${FR} .fr-resumo").textContent`), "Todas as regionais");
});
await teste("Regionais: as sete regionais e todos os municípios aparecem, inclusive sem incidentes neste arquivo (contagem 0)", async () => {
  await escolher("#ds-situacao", "todas");
  const p = await js(`(() => { const r = document.querySelector("${FR}"); return { grupos: [...r.querySelectorAll(".fr-expandir")].map((b) => b.textContent.trim()),
    chaves: [...r.querySelectorAll(".fr-itens [data-fr-chave]")].map((x) => x.dataset.frChave), sc: r.querySelector('[data-fr-conta="sao_cristovao"]').textContent,
    aju: Number(r.querySelector('[data-fr-conta="aracaju"]').textContent), cont: Object.fromEntries([...r.querySelectorAll("[data-fr-n]")].map((n) => [n.dataset.frN, Number(n.textContent)])) }; })()`);
  igual(p.grupos.slice(0, 7), L.REGIONAIS.map((r) => r.nome)); igual(p.chaves.slice(0, 63), L.MUNICIPIOS.map((m) => m.chave));
  igual(p.sc, "0", "regional sem dados mostra zero"); igual(p.aju, esperado((x) => naRegional(x, "aracaju")));
  for (const m of L.MUNICIPIOS) igual(p.cont[m.chave], esperado((x) => x.chaves.includes(m.chave)), "contagem de " + m.nome);
  igual([p.cont["450"], p.cont["?fora_se"], p.cont["?divergente"]], [2, 1, esperado((x) => x.chaves.includes("?divergente"))], "Poço Redondo com e sem código no 450; PEDRO REGIS fora de SE; divergências");
  verdade(p.cont["?divergente"] >= 1, "620_ARACAJU divergente");
  verdade(p.cont["510"] >= 1 && p.cont["070"] >= 1, "Canhoba (principal vazia) e Carira (CENTRO · CARIRA) contados nas regionais");
});
await teste("Regional Aracaju (um clique): só Aracaju, Barra dos Coqueiros e Nossa Senhora do Socorro", async () => {
  await regional("aracaju");
  const ls = await linhasTela();
  igual(ls.length, esperado((x) => naRegional(x, "aracaju")), "todas as localidades da regional");
  igual(ls.map((x) => x.chave).sort(), incsDe((x) => naRegional(x, "aracaju")), "só incidentes com comunicação em Aracaju, Barra ou Socorro");
  if (process.env.FOTOS) {
    await clicar(`${FR} .fr-gatilho`); await clicar(`${FR} [data-fr-expandir="aracaju"]`); await pg.foto(join(process.env.FOTOS, "regionais-lote-1366.png"));
    await pg.tamanho(390, 844); await pg.foto(join(process.env.FOTOS, "regionais-lote-390.png")); verdade(await js("document.documentElement.scrollWidth <= innerWidth"), "rolagem lateral no celular");
    await pg.tamanho(1366, 768); await clicar(`${FR} [data-fr-expandir="aracaju"]`); await clicar(`${FR} [data-fr-acao="fechar"]`);
  }
});
await teste("Desmarcar um município (Aracaju) depois da regional inteira; município sem incidente mostra zero, sem erro", async () => {
  await marcar('[data-fr-chave="001"]');
  const ls = await linhasTela(); igual(ls.length, esperado((x) => em(x, ["010", "020"])));
  verdade(ls.every((x) => x.local !== "Aracaju"), "Aracaju saiu");
  await so("620");
  igual([(await linhasTela()).length, (await totais()).encontrados], [0, 0], "São Cristóvão sem incidentes");
  verdade((await js(`document.querySelector("#ds-linhas").textContent`)).includes("Nenhum incidente neste filtro"));
});
await teste("Cada regional: só incidentes dos seus municípios, nas quantidades calculadas com as mesmas regras", async () => {
  for (const r of L.REGIONAIS) {
    await regional(r.id);
    const ls = await linhasTela(), nomes = r.municipios.map((m) => m.nome);
    igual(ls.length, esperado((x) => naRegional(x, r.id)), "quantidade em " + r.nome);
    igual(ls.map((x) => x.chave).sort(), incsDe((x) => naRegional(x, r.id)), r.nome);
    verdade(ls.every((x) => nomes.includes(x.local) || incidentes.find((i) => i.gchave === x.chave).chaves.length > 1), `${r.nome}: ${JSON.stringify(ls.map((x) => x.local))}`);
  }
});
await teste("Seleção múltipla: municípios de regionais diferentes (Monte Alegre + Poço Redondo 450 + Pirambu)", async () => {
  await so("420", "450", "280");
  const ls = await linhasTela(); igual(ls.length, 4); igual(ls.map((x) => x.local).sort(), ["Monte Alegre de Sergipe", "Pirambu", "Poço Redondo", "Poço Redondo"]);
  igual(await js(`document.querySelector("${FR} .fr-resumo").textContent`), "Monte Alegre de Sergipe, Poço Redondo, Pirambu");
});
await teste("Correspondências confirmadas no lote: 200 Poço Verde (Lagarto), 320 Santo Amaro das Brotas, 480 Amparo, 350 Canindé; outro estado fica fora", async () => {
  for (const [k, nome, reg] of [["200", "Poço Verde", "lagarto"], ["450", "Poço Redondo", "gloria"], ["320", "Santo Amaro das Brotas", "maruim"], ["480", "Amparo de São Francisco", "propria"], ["350", "Canindé de São Francisco", "gloria"]]) {
    await so(k); const ls = await linhasTela();
    igual(ls.length, esperado((x) => x.chaves.includes(k)), k); verdade(ls.length > 0 && ls.every((x) => x.local === nome), `${k}: ${JSON.stringify(ls.map((x) => x.local))}`);
    igual(L.municipioPorChave(k).regional, reg);
  }
  await regional("lagarto"); verdade((await linhasTela()).some((x) => x.local === "Poço Verde"), "Poço Verde na Regional Lagarto");
  await so("?fora_se"); const d = await linhasTela(); igual(d.length, 1); verdade(d[0].local.startsWith("Pedro Regis"), d[0].local);
  await so("?divergente"); const v = await linhasTela(); igual(v.map((x) => x.chave).sort(), incsDe((x) => x.chaves.includes("?divergente"))); verdade(v.some((x) => x.local.startsWith("Aracaju")), JSON.stringify(v));
  await so("510"); const c = await linhasTela(); verdade(c.some((x) => x.chave === "i:INC 8799001" || x.chave.includes("8799001")), "incidente com principal vazia encontrado em Canhoba: " + JSON.stringify(c));
  verdade(c.every((x) => x.local === "Canhoba"), "coluna Localidade do lote mostra o município do incidente");
  await so("?desconhecida"); verdade(!(await linhasTela()).some((x) => x.chave.includes("8799001")), "não aparece em desconhecidos");
});
await teste("Período (data real do incidente): só incidentes entre a data inicial e a final; sem data fica fora e é contado", async () => {
  await limpar(); await escolher("#ds-de", "2026-03-11"); await escolher("#ds-ate", "2026-03-12");
  const ls = await linhasTela();
  igual(ls.length, esperado((x) => x.dia >= "2026-03-11" && x.dia <= "2026-03-12"));
  verdade(ls.every((x) => /^1[12]\/03\/2026/.test(x.data)), JSON.stringify(ls.map((x) => x.data)));
  igual((await totais()).sem_data, 1, "incidente sem data informado");
  await marcar('[data-fr-regional="gloria"]');
  igual((await linhasTela()).length, esperado((x) => naRegional(x, "gloria") && x.dia >= "2026-03-11" && x.dia <= "2026-03-12"), "regional + período");
  await limpar(); await escolher("#ds-de", "2026-03-13"); await escolher("#ds-ate", "");
  igual((await linhasTela()).length, esperado((x) => x.dia >= "2026-03-13"), "só data inicial");
  await escolher("#ds-de", ""); await escolher("#ds-ate", "2026-03-10");
  igual((await linhasTela()).length, esperado((x) => x.dia && x.dia <= "2026-03-10"), "só data final");
  await escolher("#ds-ate", "");
  verdade((await linhasTela()).some((x) => x.data === "—"), "sem período, o incidente sem data aparece");
});
await teste("Combinação com tipo de ocorrência e pesquisa; contagens do painel acompanham", async () => {
  await regional("aracaju");
  const oc = await js(`[...document.querySelector("#ds-ocorrencia").options].map((o) => o.value).filter(Boolean)[0]`);
  await escolher("#ds-ocorrencia", oc);
  const ls = await linhasTela(), cont = await js(`Number(document.querySelector('${FR} [data-fr-conta="aracaju"]').textContent.split("·").pop())`);
  igual(cont, ls.length, "contagem da regional = linhas com a ocorrência");
  verdade(await js(`[...document.querySelectorAll("#ds-linhas tr[data-chave] td:nth-child(5)")].every((td) => td.textContent.startsWith(${JSON.stringify(oc)}))`), "só a ocorrência");
  await escolher("#ds-ocorrencia", "");
  await js(`(() => { const b = document.querySelector("#ds-busca"); b.value = "INC 870000"; b.dispatchEvent(new Event("input")); return true; })()`); await espera(80);
  igual((await linhasTela()).length, esperado((x) => naRegional(x, "aracaju") && x.inc.includes("INC 870000")), "regional + pesquisa");
  await js(`(() => { const b = document.querySelector("#ds-busca"); b.value = ""; b.dispatchEvent(new Event("input")); return true; })()`); await espera(80);
});
await teste("Sem telefone: situação própria e total; continua fora da contagem de realizados", async () => {
  await limpar(); await escolher("#ds-situacao", "sem_telefone");
  const ls = await linhasTela(); igual(ls.length, (await totais()).sem_telefone); verdade(ls.length >= 1);
  verdade(await js(`[...document.querySelectorAll("#ds-linhas tr[data-chave]")].every((t) => t.children[6].textContent.startsWith("—"))`), "sem número na coluna Telefone");
});
let chaveFeita;
await teste("Já realizado: sai dos pendentes, aparece em 'Callback já realizado', não é selecionável e não entra na fila", async () => {
  await escolher("#ds-situacao", "pendentes"); await so("001");
  const antes = await totais(), alvo = (await linhasTela())[0];
  chaveFeita = alvo.chave;
  await js(`(async () => { const s = ${S}, g = s.grupos().find((x) => x.chave === ${JSON.stringify(chaveFeita)}); await s.registrar(g.principal.id, "callback_realizado", "ligacao"); await window.CentralUI.recarregar(); return true; })()`);
  await espera(300); await escolher("#ds-situacao", "pendentes");
  const depois = await totais();
  igual([depois.pendentes, depois.realizados], [antes.pendentes - 1, antes.realizados + 1]);
  verdade(!(await linhasTela()).some((x) => x.chave === chaveFeita), "realizado fora dos pendentes");
  await escolher("#ds-situacao", "realizados");
  const r = await linhasTela(); verdade(r.some((x) => x.chave === chaveFeita && !x.elegivel), "listado como realizado, sem seleção");
  const recusa = await js(`${S}.iniciarAtendimento([${JSON.stringify(chaveFeita)}]).then(() => "aceitou", (e) => e.message)`);
  verdade(recusa.includes("Nenhum incidente"), "o serviço recusa: " + recusa);
});
await teste("Seleção acompanha os filtros: trocar a regional tira da seleção o que ficou fora (nada escondido vai para a fila)", async () => {
  await escolher("#ds-situacao", "pendentes"); await regional("aracaju");
  await clicar("[data-acao='marcar-todos']"); const marcados = await js(`Number(document.querySelector("#ds-contagem b").textContent)`);
  igual(marcados, (await totais()).pendentes, "selecionar todos = pendentes do filtro");
  await regional("itabaiana");
  const sel = await js(`Number(document.querySelector("#ds-contagem b").textContent)`), visiveisMarcados = await js(`document.querySelectorAll("#ds-linhas tr[data-chave] input:checked").length`);
  igual(sel, visiveisMarcados, "tudo o que continua selecionado está visível no filtro novo (nada escondido)");
  verdade(sel < marcados, "o que era só de Aracaju saiu da seleção");
});
await teste("Trocar filtros não reimporta nem altera a base do lote (mesmas comunicações, mesmos dados, nenhum lote novo)", async () => {
  igual(await base(), baseInicial); igual(await js(`${S}.estado().lotes.length`), lotesInicial);
  const calls = await js(`${S}.chamadas().map((c) => c.call_id)`); igual(new Set(calls).size, calls.length, "CALL duplicada");
});
await teste("Independência: a seleção do lote não muda a do envio individual", async () => {
  igual(await js(`[...window.CentralUI.filtroRegionais.selecao()]`), [], "individual continua sem seleção");
});
let fila;
await teste("Fila só com o filtro escolhido: Aracaju, pendentes; sem incidente repetido", async () => {
  await so("001"); await escolher("#ds-de", ""); await escolher("#ds-ate", "");
  await clicar("[data-acao='marcar-todos']"); const n = (await totais()).pendentes; verdade(n >= 2, "precisa de 2+ incidentes");
  await clicar("#ds-iniciar"); await pg.aguardar("!!document.querySelector('#at-incidente')");
  fila = await js(`${S}.filaDoLote()`);
  igual(fila.itens.length, n, "itens na fila = encontrados pendentes");
  const locs = await js(`${S}.filaDoLote().itens.map((i) => window.Localidades.classificarIncidente(${S}.grupos().find((g) => g.membros.some((c) => c.id === i.chamada_id)).membros.map((c) => c.localizacao)).chaves)`);
  verdade(locs.every((ks) => ks.includes("001")), "todo incidente da fila tem comunicação em Aracaju: " + JSON.stringify(locs)); igual(new Set(fila.itens.map((i) => i.chamada_id)).size, fila.itens.length, "repetido");
  verdade(!fila.itens.some((i) => i.chave === chaveFeita), "o já realizado não entrou");
});
await teste("Atendimento preservado: avanço automático desligado; abrir não conta; CALLBACK REALIZADO conta uma vez; PRÓXIMO INC e PULAR não contam", async () => {
  igual(await js(`document.querySelector("#at-auto").checked`), false);
  const m0 = await metr(), [a] = fila.itens;
  await clicar("[data-acao='at-abrir']"); await pg.aguardar(`${S}.filaDoLote().itens[0].status === "aberto"`); igual(await metr(), m0, "abrir não conta");
  await js(`(() => { const x = document.querySelector("[data-acao=at-callback]"); x.click(); x.click(); return true; })()`); await pg.aguardar(`${S}.filaDoLote().itens[0].status === "enviado"`); await espera(400);
  igual(await metr(), m0 + 1, "um callback"); igual(await js(`document.querySelector("#at-incidente").textContent`), a.incidente || a.call_id, "não avança sozinho");
  await clicar("[data-acao='at-proximo']"); await pg.aguardar(`${S}.filaDoLote().atual_id !== ${JSON.stringify(a.id)}`);
  if (fila.itens.length >= 2) { await clicar("[data-acao='at-pular']"); await espera(300); }
  igual(await metr(), m0 + 1, "próximo/pular não contam");
  igual(pg.erros, [], "console");
  verdade(!pg.console.some((c) => c.tipo === "error"), JSON.stringify(pg.console.filter((c) => c.tipo === "error")));
});

await nav.fechar();
try { rmSync(pasta, { recursive: true, force: true }); } catch (e) { /* arquivo temporário */ }
const falhas = resultados.filter((r) => !r[0]).length;
console.log(`\nExemplo de contagem (arquivo fictício): ${comunicacoes.length} comunicações → ${incidentes.length} incidentes; Regional Aracaju ${esperado((x) => naRegional(x, "aracaju"))}; Aracaju ${esperado((x) => x.chaves.includes("001"))}; Barra ${esperado((x) => x.chaves.includes("010"))}; 11 a 12/03 ${esperado((x) => x.dia >= "2026-03-11" && x.dia <= "2026-03-12")}`);
console.log(`${resultados.length} testes dos filtros do envio em lote · ${resultados.length - falhas} aprovados · ${falhas} com falha`);
process.exitCode = falhas ? 1 : 0;
