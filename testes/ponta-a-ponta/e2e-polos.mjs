/* Testes PONTA A PONTA do filtro REGIONAIS E MUNICÍPIOS do ENVIO INDIVIDUAL (js/localidades.js + js/filtro-regionais.js) com a
   pasta ADMS (js/pasta-adms.js). Dados FICTÍCIOS: o exemplo do projeto com a coluna Localização no formato real do ADMS
   ("End:: ...; 450_POCO REDONDO", "Dispositivo: ITABAIANA"). Banco de teste separado (?bd=...). A pasta é simulada como em
   e2e-pasta-adms.mjs (área privada do navegador); cada leitura de arquivo é contada.
   Uso: node testes\ponta-a-ponta\e2e-polos.mjs [caminho-do-navegador]   (FOTOS=<pasta> grava capturas de tela) */
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { abrirNavegador, espera } from "./cdp.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const resultados = [];
async function teste(nome, f) {
  try { await f(); resultados.push([true, nome]); console.log("OK    " + nome); }
  catch (e) { resultados.push([false, nome, e.message]); console.log("FALHA " + nome + " — " + e.message); }
}
const verdade = (c, m) => { if (!c) throw new Error(m || "condição falsa"); };
const igual = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || "esperado"}: ${JSON.stringify(b)}, obtido: ${JSON.stringify(a)}`); };

/* ---- CSV fictício com localizações no formato real */
function lerCSV(t) {
  const ls = []; let l = [], c = "", q = false;
  for (let i = 0; i < t.length; i++) { const ch = t[i];
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch; }
    else if (ch === '"') q = true; else if (ch === ";") { l.push(c); c = ""; } else if (ch === "\n") { l.push(c.replace(/\r$/, "")); ls.push(l); l = []; c = ""; } else c += ch; }
  if (c || l.length) { l.push(c); ls.push(l); } return ls;
}
const linhaCSV = (l) => l.map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(";");
const base = lerCSV(readFileSync(join(raiz, "exemplos", "navegador-chamadas-ADMS2026-FICTICIO.csv"), "utf8").replace(/^﻿/, ""));
const ic = base.findIndex((l) => l.includes("ID") && l.includes("Localização")), cab = base[ic], iL = cab.indexOf("Localização"), iId = cab.indexOf("ID");
const corpo = base.slice(ic + 1).filter((l) => l.length >= cab.length - 1);
const LOCAIS = ["End:: RUA A_10_CENTRO; 1_ARACAJU", "End:: RUA B_20_ATALAIA; 10_BARRA DOS COQUEIROS", "End:: AV C_5_TAIÇOCA; 20_NOSSA SENHORA DO SOCORRO",
  "End:: RUA S_1_CENTRO; 620_SÃO CRISTÓVÃO", "Dispositivo: ITABAIANA", "ESE_Municipio_Pesquisa: NOSSA SENHORA DA GLORIA", "End:: RUA D_1_CENTRO; 420_MONTE ALEGRE DE SERGIPE",
  "End:: RUA E_2_CENTRO; 450_POCO REDONDO", "Dispositivo: POCO REDONDO", "End:: RUA F_3_CENTRO; 200_POCO VERDE", "End:: RUA G_4_CENTRO; 77_ESTANCIA", "",
  "End:: RUA H_5_CENTRO; AMPARO DO SAO FRANCISCO", "End:: RUA I; 30_PEDRO REGIS", "Dispositivo: SANTO AMARO"];
// Mesma localidade para todas as comunicações do mesmo incidente (como no ADMS); sem incidente: por linha. Exceção: os dois
// primeiros incidentes com várias comunicações recebem localizações MISTAS, como no ADMS real (Incidentes.csv): um com
// comunicação vazia + "70_CARIRA" + "ESE_Municipio_Pesquisa: CARIRA" (deve ficar SÓ em Carira) e um com código de São Cristóvão
// e nome de Aracaju (divergência real).
const iInc = cab.indexOf("Incidente"), porInc = new Map(), chaveInc = (x, i) => (x[iInc] ? "i:" + x[iInc] : "l:" + i);
const qtdInc = new Map(); corpo.forEach((l, i) => { const k = chaveInc(l, i); qtdInc.set(k, (qtdInc.get(k) || 0) + 1); });
const MISTOS = [["", "End:: RUA C_1_CENTRO; 70_CARIRA", "ESE_Municipio_Pesquisa: CARIRA"], ["End:: RUA K_1_X; 620_ARACAJU"]];
const incMistos = [...qtdInc].filter(([, n]) => n >= 2).map(([k]) => k).slice(0, 2), membroN = new Map();
const comLocais = (ls) => ls.map((l, i) => { const x = l.slice(), k = chaveInc(x, i), m = incMistos.indexOf(k);
  if (m >= 0) { const n = membroN.get(k) || 0; membroN.set(k, n + 1); x[iL] = MISTOS[m][Math.min(n, MISTOS[m].length - 1)]; return x; }
  if (!porInc.has(k)) porInc.set(k, LOCAIS[porInc.size % LOCAIS.length]); x[iL] = porInc.get(k); return x; });
if (incMistos.length < 2) throw new Error("o CSV de exemplo precisa de 2 incidentes com várias comunicações");
const montar = (ls) => "﻿sep=;\r\n" + [cab, ...ls].map(linhaCSV).join("\r\n") + "\r\n";
const v1Linhas = comLocais(corpo);
const novas = [["End:: RUA Z_9_CENTRO; 468_PROPRIA", "8888001"], ["End:: RUA Y_8_CENTRO; 501_TOBIAS BARRETO", "8888002"], ["End:: RUA W_7_CENTRO; 700_BREJO GRANDE", "8888003"]].map(([loc, id]) => {
  const x = v1Linhas[v1Linhas.length - 1].slice(); x[iL] = loc; x[iId] = id; x[iInc] = "INC " + id; return x; });
const CSV1 = montar(v1Linhas), CSV2 = montar([...v1Linhas, ...novas]);

/* ---- navegador */
const nav = await abrirNavegador({ exe: process.argv[2] });
const url = pathToFileURL(join(raiz, "index.html")).href + "?bd=e2epolos" + Date.now().toString(36);
const pg = await nav.novaPagina();
const requisicoes = [];
nav.ouvintes.push((m) => { if (m.sessionId === pg.s && m.method === "Network.requestWillBeSent") requisicoes.push(m.params.request.url); });
await pg.cmd("Network.enable");
await pg.cmd("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
  window.__lidos = []; window.__consultas = 0;
  window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle("ADMS", { create: true });
  const B = Blob.prototype; for (const k of ["arrayBuffer", "text", "stream"]) { const o = B[k]; B[k] = function () { if (this.name) window.__lidos.push(this.name); return o.call(this); }; }
  const gf = FileSystemFileHandle.prototype.getFile; FileSystemFileHandle.prototype.getFile = function () { window.__consultas++; return gf.call(this); };
})();` });
await pg.ir(url);
const js = (e) => pg.js(e);
const clicar = (sel) => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) throw new Error("não achei ${sel.replace(/"/g, "'")}"); e.click(); return true; })()`);
const situacao = () => js(`(document.querySelector("#pasta-adms").dataset.situacao || "")`);
const aguardarSituacao = async () => { await pg.aguardar(`(() => { const s = document.querySelector("#pasta-adms").dataset.situacao; return !!s && s !== "iniciando" && s !== "verificando"; })()`, 20000); return situacao(); };
const f5 = async () => { await pg.cmd("Page.reload", {}); await espera(300); await pg.aguardar("document.readyState === 'complete' && document.body.dataset.pronto === '1'"); return aguardarSituacao(); };
const escrever = (texto) => js(`(async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle("ADMS", { create: true });
  const w = await (await d.getFileHandle("chamadas_incidentes.csv", { create: true })).createWritable(); await w.write(${JSON.stringify(texto)}); await w.close(); return true; })()`);
const FR = "#filtro-regionais";
// Interação REAL com o componente: clique nas caixas (o clique muda o "checked" e dispara "change", como o mouse).
const marcar = (sel) => clicar(`${FR} ${sel}`).then(() => espera(60));
const limpar = () => clicar(`${FR} [data-fr-acao="limpar"]`).then(() => espera(60));
const selecao = () => js(`[...window.CentralUI.filtroRegionais.selecao()].sort()`);
// Estado visível: localidade (do INCIDENTE inteiro) dos incidentes mostrados, resumo do filtro, totais.
const tela = () => js(`(() => { const s = window.CentralUI.servico, ids = new Set([...document.querySelectorAll("#linhas tr[data-id]")].map((t) => Number(t.dataset.id)));
  const grupos = s.grupos().filter((g) => ids.has(g.principal.id));
  return { linhas: ids.size, chaves: [...new Set(grupos.map((g) => window.Localidades.classificarIncidente(g.membros.map((c) => c.localizacao)).chave))].sort(),
    resumo: document.querySelector("#resumo-filtro").textContent, resumoVisivel: !document.querySelector("#resumo-filtro").classList.contains("oculto"),
    resumoLote: document.querySelector("#resumo-lote").textContent, chamadas: s.chamadas().length,
    gatilho: document.querySelector("${FR} .fr-resumo").textContent }; })()`);
// Esperado (independente da tela): incidentes com algum membro na seleção e nos demais filtros da lista.
const esperado = (chaves) => js(`(() => { const s = window.CentralUI.servico, L = window.Localidades, N = window.Nucleo, f = window.CentralUI.filtroData, sel = new Set(${JSON.stringify(chaves)});
  const est = document.querySelector("#filtro-estado").value, b = document.querySelector("#busca").value.trim().toUpperCase();
  const conf = (c) => !est || (est === "servico" ? c.estado === "callback_realizado" && !!c.servico_executado_em : est === "resolvida" ? c.estado === "callback_realizado" && !!c.resolvida_em : est === "risco" ? N.indicacaoRisco(c).nivel >= 1 : c.estado === est);
  const casa = (c) => conf(c) && (!b || [c.call_id, c.incidente, c.nome, c.localizacao].some((x) => (x || "").toUpperCase().includes(b)));
  return s.grupos().filter((g) => f.confere(N.dataDoIncidente(g).dia) && L.confereResultado(L.classificarIncidente(g.membros.map((c) => c.localizacao)), sel) && g.membros.some(casa)).length; })()`);
// Conta COMUNICAÇÕES cujo INCIDENTE tem a localidade pedida (a mesma conta do resumo do filtro).
const contar = (pred) => js(`window.CentralUI.servico.grupos().flatMap((g) => { const x = window.Localidades.classificarIncidente(g.membros.map((c) => c.localizacao)); return g.membros.map(() => x); }).filter((x) => ${pred}).length`);
const contarIncidentes = (pred) => js(`window.CentralUI.servico.grupos().map((g) => window.Localidades.classificarIncidente(g.membros.map((c) => c.localizacao))).filter((x) => ${pred}).length`);

await pg.aguardar("document.body.dataset.pronto === '1'");
await escrever(CSV1);
await js(`(() => { const f = document.querySelector("#form-dia"); f.operador.value = "pol1"; f.polo.value = "Aracaju"; f.requestSubmit(); return true; })()`);
await aguardarSituacao();
await clicar('#pasta-adms [data-adms="selecionar"]');
await pg.aguardar(`document.querySelector("#pasta-adms").dataset.situacao === "atualizado"`, 20000);
await pg.aguardar("document.querySelectorAll('#linhas tr[data-id]').length > 0");
await clicar("#fd-todas"); await espera(100);
const total = await js(`window.Nucleo.analisar(new TextEncoder().encode(${JSON.stringify(CSV1)})).validas.length`);
const naoOk = await contarIncidentes(`x.status !== "ok"`);

await teste("Sem seleção: todas as chamadas na lista (nada escondido); aviso das que ficam fora das regionais; base completa", async () => {
  const t = await tela();
  igual(t.chamadas, total, "base do lote"); igual(t.gatilho, "Todas as regionais");
  igual(t.linhas, await js("window.CentralUI.servico.grupos().length"), "todos os incidentes visíveis");
  verdade(naoOk > 0 && t.resumoVisivel && t.resumo.startsWith(naoOk + " incidente(s) fora das regionais"), t.resumo);
  verdade(t.resumoLote.startsWith(total + " chamadas"), "resumo do lote mantém a base completa: " + t.resumoLote);
});
await teste("Painel: sete regionais recolhíveis + 'Fora das regionais'; 63 municípios com código e nome na mesma linha, sem duplicar", async () => {
  await clicar(`${FR} .fr-gatilho`);
  const p = await js(`(() => { const r = document.querySelector("${FR}"); return { aberto: !r.querySelector(".fr-painel").classList.contains("oculto"),
    grupos: [...r.querySelectorAll(".fr-expandir")].map((b) => b.textContent.trim()), itens: r.querySelectorAll(".fr-itens [data-fr-chave]").length,
    chaves: [...r.querySelectorAll("[data-fr-chave]")].map((x) => x.dataset.frChave), visiveisFechado: [...r.querySelectorAll(".fr-item")].filter((x) => x.offsetParent).length,
    linha: (() => { const l = r.querySelector('[data-fr-chave="030"]').closest(".fr-item"); return [l.querySelector(".fr-cod").textContent, l.querySelector(".fr-nome").textContent]; })() }; })()`);
  verdade(p.aberto, "painel abriu");
  igual(p.grupos, ["Regional Aracaju", "Regional São Cristóvão", "Regional Itabaiana", "Regional Lagarto", "Regional Glória", "Regional Propriá", "Regional Maruim", "Fora das regionais"]);
  igual(p.itens, 63 + 4); igual(new Set(p.chaves).size, p.chaves.length, "sem linha duplicada"); igual(p.visiveisFechado, 0, "grupos começam recolhidos");
  igual(p.linha, ["030", "Itabaiana"]);
  await clicar(`${FR} [data-fr-expandir="gloria"]`);
  igual(await js(`[...document.querySelectorAll('${FR} [data-fr-grupo="gloria"] .fr-item')].filter((x) => x.offsetParent).length`), 13, "Glória expandida");
  await clicar(`${FR} [data-fr-expandir="gloria"]`);
  igual(await js(`[...document.querySelectorAll('${FR} [data-fr-grupo="gloria"] .fr-item')].filter((x) => x.offsetParent).length`), 0, "Glória recolhida");
});
await teste("Regional inteira em um clique: Regional Aracaju = só Aracaju, Socorro e Barra; resumo e contagem", async () => {
  await marcar('[data-fr-regional="aracaju"]');
  const t = await tela(), n = await contar(`x.regional === "aracaju"`);
  igual(await selecao(), ["001", "010", "020"]);
  igual(t.chaves, ["001", "010", "020"]); igual(t.linhas, await esperado(["001", "010", "020"]));
  verdade(t.resumo.startsWith(`Filtro Regional Aracaju: ${n} chamadas`), t.resumo + " / esperado " + n); igual(t.gatilho, "Regional Aracaju");
  igual(await js(`document.querySelector("${FR} .fr-badge").textContent`), "3", "quantidade selecionada");
});
await teste("Desmarcar um município depois da regional inteira tira só ele (Barra dos Coqueiros)", async () => {
  await marcar('[data-fr-chave="010"]');
  const t = await tela(); igual(await selecao(), ["001", "020"]); igual(t.chaves, ["001", "020"]);
  igual(await js(`(() => { const x = document.querySelector('${FR} [data-fr-regional="aracaju"]'); return [x.checked, x.indeterminate]; })()`), [false, true]);
});
await teste("Municípios de regionais diferentes (Aracaju + São Cristóvão) e vários da mesma regional (Monte Alegre + Glória)", async () => {
  await limpar(); await marcar('[data-fr-chave="001"]'); await marcar('[data-fr-chave="620"]');
  let t = await tela(); igual(t.chaves, ["001", "620"]); igual(t.linhas, await esperado(["001", "620"])); igual(t.gatilho, "Aracaju, São Cristóvão");
  await limpar(); await marcar('[data-fr-chave="420"]'); await marcar('[data-fr-chave="450"]');
  t = await tela(); igual(t.chaves, ["420", "450"]); igual(t.linhas, await esperado(["420", "450"]));
});
await teste("Correspondências confirmadas: 200 Poço Verde, 450 Poço Redondo, 320 Santo Amaro das Brotas, 480 Amparo — cada seleção encontra os seus registros", async () => {
  const rot = (k) => js(`(() => { const l = document.querySelector('${FR} [data-fr-chave="${k}"]').closest(".fr-item"); return l.querySelector(".fr-cod").textContent + " — " + l.querySelector(".fr-nome").textContent; })()`);
  igual([await rot("200"), await rot("450"), await rot("320"), await rot("480"), await rot("350")], ["200 — Poço Verde", "450 — Poço Redondo", "320 — Santo Amaro das Brotas", "480 — Amparo de São Francisco", "350 — Canindé de São Francisco"]);
  for (const [k, adms] of [["200", ["200_POCO VERDE"]], ["450", ["450_POCO REDONDO", "Dispositivo: POCO REDONDO"]], ["320", ["Dispositivo: SANTO AMARO"]], ["480", ["AMPARO DO SAO FRANCISCO"]]]) {
    await limpar(); await marcar(`[data-fr-chave="${k}"]`); const t = await tela();
    igual(t.chaves, [k], k); igual(t.linhas, await esperado([k]), "linhas " + k); verdade(t.linhas > 0, "registros em " + k);
    const locs = await js(`[...new Set(window.CentralUI.servico.chamadas().filter((c) => window.Localidades.chave(c.localizacao) === ${JSON.stringify(k)}).map((c) => c.localizacao.split(";").pop().trim()))].sort()`);
    igual(locs, [...adms].sort(), "valor original do ADMS em " + k);
  }
  await limpar();
  for (const k of ["?desconhecida", "?nao_reconhecido", "?divergente", "?fora_se"]) {
    await marcar(`[data-fr-chave="${k}"]`); const t = await tela(); igual(t.chaves, [k], k); verdade(t.linhas > 0, "registros em " + k); await marcar(`[data-fr-chave="${k}"]`);
  }
  await limpar();
});
await teste("Formatos novos: ESE_Municipio_Pesquisa reconhecido; incidente com comunicação vazia fica SÓ na regional (não vai para desconhecidos)", async () => {
  await limpar(); await marcar('[data-fr-chave="430"]');
  verdade(await js(`window.CentralUI.servico.chamadas().some((c) => c.localizacao === "ESE_Municipio_Pesquisa: NOSSA SENHORA DA GLORIA")`), "o CSV tem o formato");
  igual((await tela()).linhas, await esperado(["430"])); verdade((await tela()).linhas > 0);
  const incCarira = await js(`(() => { const g = window.CentralUI.servico.grupos().find((g) => g.membros.some((c) => c.localizacao === "ESE_Municipio_Pesquisa: CARIRA")); return g.chave; })()`);
  const visivel = () => js(`[...document.querySelectorAll("#linhas tr[data-grupo]")].some((t) => t.dataset.grupo === ${JSON.stringify(incCarira)})`);
  await limpar(); await marcar('[data-fr-chave="070"]'); verdade(await visivel(), "incidente misto aparece em Carira");
  await limpar(); await marcar('[data-fr-chave="?desconhecida"]'); verdade(!(await visivel()), "incidente misto NÃO aparece em desconhecidos");
  await limpar(); await marcar('[data-fr-chave="?divergente"]');
  verdade(await js(`[...document.querySelectorAll("#linhas tr[data-grupo]")].some((t) => window.CentralUI.servico.grupos().find((g) => g.chave === t.dataset.grupo).membros.some((c) => (c.localizacao || "").includes("620_ARACAJU")))`), "620_ARACAJU = divergência para revisão");
  await limpar();
});
await teste("Pesquisa no painel por código e por nome (sem acento); limpar a pesquisa volta a lista", async () => {
  const vis = () => js(`[...document.querySelectorAll("${FR} .fr-item")].filter((x) => x.offsetParent).map((x) => x.querySelector("input").dataset.frChave)`);
  const buscar = (t) => js(`(() => { const b = document.querySelector("${FR} .fr-busca"); b.value = ${JSON.stringify(t)}; b.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
  await buscar("420"); igual(await vis(), ["420"]); await buscar("aparecida"); igual(await vis(), ["120"]); await buscar("sao cristovao"); igual(await vis(), ["620"]);
  await buscar("poço redondo"); igual(await vis(), ["450"]); await buscar("poco verde"); igual(await vis(), ["200"]); await buscar("001"); igual(await vis(), ["001"]);
  await buscar(""); igual(await vis(), [], "sem pesquisa: grupos recolhidos");
});
await teste("Combinação com Situação e Pesquisa; contagens do painel acompanham os outros filtros", async () => {
  await limpar(); await marcar('[data-fr-regional="gloria"]');
  const sel = await selecao();
  const n = () => js(`Number(document.querySelector('${FR} [data-fr-conta="gloria"]').textContent.split("·").pop())`);
  const antes = await n(); igual(antes, (await tela()).linhas, "contagem da regional = linhas da lista");
  await js(`(() => { const e = document.querySelector("#filtro-estado"); e.value = "pendente"; e.dispatchEvent(new Event("change")); return true; })()`); await espera(80);
  igual((await tela()).linhas, await esperado(sel), "Glória + pendentes"); igual(await n(), (await tela()).linhas, "contagem com a situação");
  await js(`(() => { const e = document.querySelector("#busca"); e.value = "INC"; e.dispatchEvent(new Event("input")); return true; })()`); await espera(80);
  igual((await tela()).linhas, await esperado(sel), "Glória + pendentes + pesquisa");
  await js(`(() => { const e = document.querySelector("#busca"); e.value = ""; e.dispatchEvent(new Event("input")); const s = document.querySelector("#filtro-estado"); s.value = ""; s.dispatchEvent(new Event("change")); return true; })()`); await espera(80);
  igual(await n(), antes);
});
await teste("Limpar todas as seleções volta para Todas as regionais", async () => {
  await limpar(); const t = await tela(); igual(await selecao(), []); igual(t.gatilho, "Todas as regionais"); igual(t.linhas, await js("window.CentralUI.servico.grupos().length"));
});
await teste("Indicadores: callback registrado aparece no resumo do filtro; trocar o filtro não mexe nos cartões do dia", async () => {
  const id = await js(`(async () => { const s = window.CentralUI.servico, c = s.chamadas().find((x) => window.Localidades.chave(x.localizacao) === "030" && x.estado === "pendente");
    await s.registrar(c.id, "callback_realizado", "whatsapp"); window.CentralUI.recarregar(); return c.id; })()`);
  await espera(200); await marcar('[data-fr-chave="030"]');
  const t = await tela(), n = await contar(`x.chave === "030"`);
  verdade(t.resumo.includes(`: ${n} chamadas`) && t.resumo.includes("· 1 callbacks"), t.resumo);
  const cartoes = await js("document.querySelector('#metricas').textContent");
  await marcar('[data-fr-regional="propria"]'); igual(await js("document.querySelector('#metricas').textContent"), cartoes, "cartões do dia");
  igual(await js(`window.CentralUI.servico.obterChamada(${id}).estado`), "callback_realizado");
});
await teste("Trocar a seleção não lê nem consulta o CSV de novo; base intacta", async () => {
  await js("(window.__lidos = [], window.__consultas = 0, true)");
  await limpar(); await marcar('[data-fr-regional="itabaiana"]'); await marcar('[data-fr-chave="030"]'); await marcar('[data-fr-chave="?divergente"]'); await limpar();
  igual([await js("window.__lidos.length"), await js("window.__consultas")], [0, 0]);
  igual((await tela()).chamadas, total, "base intacta");
});
await teste("F5 sem alteração: sem duplicidade, sem releitura; seleção do envio individual é lembrada", async () => {
  await marcar('[data-fr-chave="001"]'); await marcar('[data-fr-chave="450"]');
  igual(await f5(), "sem_alteracoes"); igual(await js("window.__lidos"), []);
  await clicar("#fd-todas"); await espera(100);
  const t = await tela(); igual(t.chamadas, total); igual(await selecao(), ["001", "450"]); igual(t.chaves, ["001", "450"]);
});
await teste("Novo CSV ADMS (F5): municípios novos reconhecidos sozinhos (468, 700); desconhecido fica 'não reconhecida'; sem duplicar", async () => {
  await escrever(CSV2);
  igual(await f5(), "atualizado"); await clicar("#fd-todas"); await espera(100);
  const t = await tela();
  igual(t.chamadas, total + 3); igual(await js("new Set(window.CentralUI.servico.chamadas().map((c) => c.call_id)).size"), total + 3);
  await limpar(); await marcar('[data-fr-regional="propria"]'); igual((await tela()).chaves, ["468", "480", "700"], "468 e 700 novos + 480 Amparo já existente");
  await limpar(); await marcar('[data-fr-chave="?nao_reconhecido"]');
  verdade(await js(`window.CentralUI.servico.chamadas().some((c) => (c.localizacao || "").includes("TOBIAS") && window.Localidades.chave(c.localizacao) === "?nao_reconhecido")`), "Tobias Barreto não reconhecida");
  igual(await js(`window.CentralUI.servico.chamadas().filter((c) => (c.localizacao || "").includes("TOBIAS"))[0].localizacao`), "End:: RUA Y_8_CENTRO; 501_TOBIAS BARRETO", "valor original preservado");
  await limpar(); igual(await f5(), "sem_alteracoes"); igual((await tela()).chamadas, total + 3, "F5 seguinte");
});
await teste("Envio individual e envio em lote são independentes (uma seleção não altera a outra)", async () => {
  await clicar("#fd-todas"); await limpar(); await marcar('[data-fr-chave="001"]'); await marcar('[data-fr-chave="620"]');
  await clicar('[data-modo="lote"]'); await pg.aguardar("!!document.querySelector('#ds-regionais .fr')");
  igual(await js(`document.querySelector("#ds-regionais .fr-resumo").textContent`), "Todas as regionais", "lote começa sem seleção");
  await clicar('#ds-regionais [data-fr-chave="420"]'); await espera(60); await clicar('#ds-regionais [data-fr-chave="450"]'); await espera(60);
  igual(await js(`document.querySelector("#ds-regionais .fr-resumo").textContent`), "Monte Alegre de Sergipe, Poço Redondo");
  igual(await selecao(), ["001", "620"], "individual não mudou");
  await clicar('[data-modo="individual"]'); await espera(100);
  igual((await tela()).chaves, ["001", "620"]);
  await clicar('[data-modo="lote"]'); await pg.aguardar("!!document.querySelector('#ds-regionais .fr')");
  igual(await js(`document.querySelector("#ds-regionais .fr-resumo").textContent`), "Monte Alegre de Sergipe, Poço Redondo", "lote manteve a sua");
  await clicar('[data-modo="individual"]'); await espera(100); await limpar();
});
await teste("Importação manual preservada (com o filtro aplicado também ao lote manual)", async () => {
  await js(`window.CentralUI.servico.encerrarLote().then(() => (window.CentralUI.recarregar(), true))`);
  await pg.aguardar("!!document.querySelector('#importar').offsetParent");
  const doc = await pg.cmd("DOM.getDocument", {});
  const { nodeId } = await pg.cmd("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "#arquivo" });
  await pg.cmd("DOM.setFileInputFiles", { nodeId, files: [join(raiz, "exemplos", "navegador-chamadas-FICTICIO.csv")] });
  await pg.aguardar("!!document.querySelector('#btn-confirmar-import')"); await clicar("#btn-confirmar-import");
  await pg.aguardar("document.querySelector('#lote-titulo').textContent.startsWith('Lote 2')");
  await clicar("#fd-todas"); await espera(100);
  const t = await tela(); igual(t.chamadas, await js("window.CentralUI.servico.chamadas().length")); verdade(t.linhas > 0, "lista do lote manual");
});
await teste("Responsivo (1366, 1024, 390): campo alinhado, painel aberto dentro da tela, sem rolagem lateral", async () => {
  for (const [l, a] of [[1366, 768], [1024, 768], [390, 844]]) {
    await pg.tamanho(l, a); await clicar(`${FR} .fr-gatilho`); await clicar(`${FR} [data-fr-expandir="itabaiana"]`); await espera(80);
    const m = await js(`(() => { const r = (e) => e.getBoundingClientRect(), p = r(document.querySelector("${FR} .fr-painel")), g = r(document.querySelector("${FR} .fr-gatilho")), o = r(document.querySelector("#filtro-ocorrencia"));
      return { rolagem: document.documentElement.scrollWidth - innerWidth, esq: p.left, dir: p.right, larg: innerWidth, alturaG: g.height, alturaO: o.height,
        linha: (() => { const i = r(document.querySelector('${FR} [data-fr-chave="030"]')), n = r(document.querySelector('${FR} [data-fr-chave="030"]').closest(".fr-item").querySelector(".fr-nome")); return Math.abs((i.top + i.bottom) / 2 - (n.top + n.bottom) / 2); })() }; })()`);
    verdade(m.rolagem <= 0, `${l}px: rolagem lateral ${m.rolagem}`); verdade(m.esq >= 0 && m.dir <= m.larg + 0.5, `${l}px: painel fora da tela ${JSON.stringify(m)}`);
    igual(Math.round(m.alturaG), Math.round(m.alturaO), `${l}px: mesma altura dos outros campos`); verdade(m.linha <= 2, `${l}px: caixa e nome alinhados`);
    if (process.env.FOTOS) await pg.foto(join(process.env.FOTOS, `regionais-individual-${l}.png`));
    await clicar(`${FR} [data-fr-expandir="itabaiana"]`); await clicar(`${FR} [data-fr-acao="fechar"]`);
  }
  await pg.tamanho(1366, 768);
});
await teste("Nada enviado para fora e console sem erros", async () => {
  igual(requisicoes.filter((u) => !u.startsWith("file://") && !u.startsWith("data:")), []);
  verdade(pg.erros.length === 0, pg.erros.join(" || "));
  verdade(!pg.console.some((c) => c.tipo === "error"), JSON.stringify(pg.console.filter((c) => c.tipo === "error")));
});

await nav.fechar();
const falhas = resultados.filter((r) => !r[0]);
console.log(`\n${resultados.length} testes ponta a ponta (regionais e municípios · envio individual) · ${resultados.length - falhas.length} aprovados · ${falhas.length} com falha`);
process.exitCode = falhas.length ? 1 : 0;
