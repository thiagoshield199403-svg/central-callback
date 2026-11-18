/* Testes PONTA A PONTA do DESPACHO OTIMIZADO 2.1: duas fontes (chamadas_incidentes.csv + Incidentes.xlsx) no navegador real.
   Dados 100% FICTÍCIOS (testes/despacho/dados-ficticios.mjs + incidentes-ficticio.mjs); nenhum arquivo real é lido ou alterado.
   Uso: node testes\ponta-a-ponta\e2e-despacho-incidentes.mjs [caminho-do-navegador]   (FOTOS=<pasta> grava capturas)
   A pasta ADMS é uma pasta da área privada do navegador (OPFS), conectada PELA CENTRAL (mesma autorização para os dois arquivos). */
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { abrirNavegador, espera } from "./cdp.mjs";
import { csvPasta, CHAMADAS } from "../despacho/dados-ficticios.mjs";
import { xlsxIncidentes, REGISTROS, ESPERADO_INC } from "../despacho/incidentes-ficticio.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const resultados = [];
async function teste(nome, f) { try { await f(); resultados.push(true); console.log("OK    " + nome); } catch (e) { resultados.push(false); console.log("FALHA " + nome + " — " + e.message); } }
const verdade = (c, m) => { if (!c) throw new Error(m || "condição falsa"); };
const igual = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || "esperado"}: ${JSON.stringify(b)}, obtido: ${JSON.stringify(a)}`); };
const SIMULACAO = `(() => { window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle("ADMS", { create: true }); })();`;

const exe = process.argv[2], nav = await abrirNavegador({ exe });
await nav.enviar("Browser.grantPermissions", { permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] }).catch(() => nav.enviar("Browser.grantPermissions", { permissions: ["clipboardReadWrite"] }));
const versao = (await nav.enviar("Browser.getVersion")).product;
const bd = "e2edinc" + Date.now().toString(36), base = pathToFileURL(raiz).href + "/", rede = [];
const pg = await nav.novaPagina();
nav.ouvintes.push((m) => { if (m.method === "Network.requestWillBeSent") rede.push(m.params.request.url); });
await pg.cmd("Network.enable"); await pg.cmd("Page.addScriptToEvaluateOnNewDocument", { source: SIMULACAO });
const js = (e) => pg.js(e);
const clicar = (sel) => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) throw new Error("não achei ${sel.replace(/"/g, "'")}"); e.click(); return true; })()`);
const texto = (sel) => js(`(document.querySelector(${JSON.stringify(sel)}) || {}).textContent || ""`);
const escolher = (sel, v) => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event("change", { bubbles: true })); return e.value; })()`);
const opfs = (corpo) => js(`(async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle("ADMS", { create: true }); ${corpo} })()`);
const escreverCsv = (t) => opfs(`const w = await (await d.getFileHandle("chamadas_incidentes.csv", { create: true })).createWritable(); await w.write(${JSON.stringify(t)}); await w.close(); return true;`);
const escreverXlsx = (bytes, nome = "Incidentes.xlsx") => opfs(`const b = Uint8Array.from(atob(${JSON.stringify(Buffer.from(bytes).toString("base64"))}), (c) => c.charCodeAt(0));
  const w = await (await d.getFileHandle(${JSON.stringify(nome)}, { create: true })).createWritable(); await w.write(b); await w.close(); return true;`);
const kpis = () => js(`Object.fromEntries([...document.querySelectorAll("[data-kpi]")].map((e) => [e.dataset.kpi, Number(e.textContent)]))`);
const lerClip = async () => (await js("navigator.clipboard.readText()")).split("\r\n").join("\n");
const lidoInc = () => js("(window.DespachoUI.estado().fontes.incidentes.leitura || {}).lidoEm || 0");
const lidoCh = () => js("window.DespachoUI.estado().lidoEm || 0");
const fimLeitura = () => pg.aguardar("!window.DespachoUI.estado().lendo", 20000);
const foto = async (n) => { if (process.env.FOTOS) await pg.foto(join(process.env.FOTOS, n + ".png")); };
const AGORA = Date.now();
const FORA = [...ESPERADO_INC.excluidas, ...Object.keys(ESPERADO_INC.excecoes)];
const lotesNaTela = () => js(`(() => { const M = window.DespachoUI.M, S = window.DespachoUI.estado(); return M.montar(S.dados.incs, S.f).secoes.flatMap((s) => s.lotes.map((l) => l.chave)); })()`);

/* ------------------------------------------------------------ Central conecta a pasta; o Despacho lê as duas fontes */
await pg.ir(`${base}index.html?bd=${bd}`); await pg.aguardar("document.body.dataset.pronto === '1'", 20000);
await opfs(`for await (const [n] of d.entries()) await d.removeEntry(n, { recursive: true }); return true;`);
await escreverCsv(csvPasta(AGORA)); await escreverXlsx(xlsxIncidentes(AGORA));
console.log("Navegador: " + versao);

await teste("Central conecta a pasta; Despacho lê chamadas + Incidentes.xlsx com a MESMA autorização (sem seletor)", async () => {
  await pg.aguardar(`!!document.querySelector('#pasta-adms [data-adms="selecionar"]')`);
  await clicar('#pasta-adms [data-adms="selecionar"]'); await pg.aguardar(`document.querySelector("#pasta-adms").dataset.conexao === "directory"`, 20000);
  await clicar("#btn-despacho");
  await pg.aguardar("location.pathname.endsWith('despacho.html') && document.body.dataset.pronto === '1' && !!(window.DespachoUI.estado().dados || {}).incidentes", 20000);
  verdade(/^\d{2}\/\d{2},? \d{2}:\d{2}$/.test(await texto("#dados-inc-texto")), await texto("#dados-inc-texto"));
  verdade(/^\d{2}\/\d{2},? \d{2}:\d{2}$/.test(await texto("#dados-texto")), "selo das chamadas");
  verdade(/lido às \d{2}:\d{2}/.test(await js(`document.querySelector("#dados-inc").title`)), "leitura completa na dica do selo");
  igual(await js(`[!!document.querySelector(".sigode"), !!document.querySelector("#status-ind")]`), [false, false], "tela compacta: sem faixa SIGODE e sem botões de status");
  igual(await js("document.querySelector('#fonte-inc').classList.contains('oculto')"), true, "sem aviso com as duas fontes ok");
});
await teste("Só INCs operacionais nos contadores e nos lotes; Concluído/Arquivado/Cancelado e exceções fora", async () => {
  igual((await kpis()).incs, ESPERADO_INC.operacionais.length);
  const ids = await js(`window.DespachoUI.estado().dados.incs.map((i) => i.id.slice(4)).sort()`);
  igual(ids, ESPERADO_INC.operacionais);
  igual(await js(`document.querySelector("#polo option").textContent`), `Todos os polos (${ESPERADO_INC.operacionais.length})`);
  const conf = await texto("[data-conf-inc]");
  verdade(conf.includes("fora dos lotes") && conf.includes("Concluído") && conf.includes("Arquivado") && conf.includes("Cancelado") && conf.includes("4 exceção(ões)"), conf);
  await foto("dinc-1-todos");
});
await teste("Cópia de TODOS os lotes e seleção de TODOS os lotes: nenhuma INC excluída ou em exceção", async () => {
  let todas = "";
  for (const k of await lotesNaTela()) { await clicar(`[data-copiar="${k}"]`); await espera(150); todas += await lerClip(); }
  for (const n of FORA) verdade(!todas.includes(n), "INC fora copiada: " + n);
  for (const n of ESPERADO_INC.operacionais) verdade(todas.includes(n), "INC operacional não copiada: " + n);
  for (const k of await lotesNaTela()) await clicar(`[data-sel-lote="${k}"]`);
  igual(Number(await texto("#sel-n")), ESPERADO_INC.operacionais.length, "seleção = operacionais");
  await clicar("#sel-copiar"); await espera(250);
  const sel = await lerClip(); for (const n of FORA) verdade(!sel.includes(n), "selecionada fora: " + n);
  await clicar("#sel-limpar");
});
await teste("Status com quantidades no filtro único (ordem operacional) e filtros (status, sem equipe, inconsistência) em conjunto", async () => {
  const chips = await js(`Object.fromEntries([...document.querySelectorAll("#f-status option")].filter((o) => o.value).map((o) => [o.value, Number(/\\((\\d+)\\)$/.exec(o.textContent)[1])]))`);
  igual([chips.em_execucao, chips.enviado, chips.aguardando_envio, chips.aguardando_reenvio, chips.interrompido], [2, 4, 3, 1, 1], JSON.stringify(chips));
  igual(await js(`[...document.querySelectorAll("#f-status option")].filter((o) => o.value).map((o) => o.value)`), await js(`window.DespachoIncidentes.STATUS_OPERACIONAIS.map((s) => s.codigo)`), "ordem operacional");
  const eq = await js(`Object.fromEntries([...document.querySelectorAll("#f-equipe option")].filter((o) => o.value).map((o) => [o.value, Number(o.dataset.n)]))`);
  await escolher("#f-status", "interrompido"); igual((await kpis()).incs, 1);
  await escolher("#f-status", ""); igual((await kpis()).incs, ESPERADO_INC.operacionais.length, "Todos os status tira o filtro");
  await escolher("#f-equipe", "sem"); igual((await kpis()).incs, eq.sem, "quantidade da opção Sem equipe");
  await escolher("#polo", "aracaju"); verdade((await kpis()).incs <= eq.sem, "polo + sem equipe");
  await clicar("#f-limpar"); await escolher("#polo", "");
  await escolher("#f-status", "enviado"); igual((await kpis()).incs, 4); await clicar("#f-limpar");
  await escolher("#f-equipe", "inconsistente"); verdade((await kpis()).incs >= 2, "INC 013 e 030"); igual((await kpis()).incs, eq.inconsistente, "quantidade da opção"); await clicar("#f-limpar");
  igual(await js(`document.querySelector("#f-alimentador").disabled`), false, "alimentador vem do Incidentes.xlsx");
});
await teste("Detalhes da INC: status, equipes, horários, observação multilinha e 'confirmar no SIGODE' (nada inventado)", async () => {
  await clicar('.lote-cab[data-abrir="001|BAIRRO TESTE A"]'); await clicar('[data-detalhe="INC 900000001"]');
  const d = await texto("tr.detalhe");
  verdade(d.includes("Em Execução") && d.includes("ESE-T-EQ01, ESE-T-EQ02") && /atribuição \d{2}\/\d{2} \d{2}:\d{2}/.test(d) && d.includes("confirmar no SIGODE"), d);
  verdade(d.includes("EQUIPE NO LOCAL") && d.includes("AGUARDANDO MATERIAL"), "observação");
  verdade(!/chegada|conclus[aã]o \d|aceite \d/i.test(d.replace("aceite, chegada e conclusão não são informados", "")), "nenhum dado inventado");
  igual(await js(`document.querySelector('tr.inc[data-inc="INC 900000001"] .c-equipe').textContent.trim()`), "ESE-T-EQ01 +1");
  await foto("dinc-2-detalhe");
});
await teste("Área de exceções: as 4 INCs (desconhecido, vazio, divergente, sem registro no ADMS), fora dos lotes", async () => {
  await clicar("[data-excecoes]");
  const linhas = await js(`[...document.querySelectorAll("#excecoes tbody tr")].map((t) => t.querySelector(".c-inc").textContent.slice(4)).sort()`);
  igual(linhas, Object.keys(ESPERADO_INC.excecoes).sort());
  verdade((await texto("#excecoes")).includes("linha(s) do Incidentes.xlsx descartada"), "linha com INC inválida informada");
  await foto("dinc-3-excecoes"); await clicar("[data-excecoes]");
});
await teste("Uma fonte falhando (XLSX corrompido): aviso só do Incidentes; última leitura válida mantida; chamadas continuam", async () => {
  const b = xlsxIncidentes(AGORA); const ruim = b.slice(); const m = Math.floor(b.length / 2); for (let i = m; i < m + 60; i++) ruim[i] ^= 0xff;
  await escreverXlsx(ruim);
  const ti = await lidoInc(); await clicar("#btn-atualizar"); await fimLeitura();
  verdade(/Falha na leitura do Incidentes\.xlsx: arquivo não reconhecido: arquivo corrompido.*última leitura válida/.test(await texto("#fonte-inc")), await texto("#fonte-inc"));
  igual([await lidoInc(), (await kpis()).incs], [ti, ESPERADO_INC.operacionais.length], "dados do Incidentes mantidos");
  igual(await js("document.querySelector('#fonte').classList.contains('oculto')"), true, "chamadas sem aviso");
  await escreverCsv(csvPasta(AGORA, [...CHAMADAS, { call: 30, inc: "900000050", loc: "RUA NOVA_1_BAIRRO TESTE A; 1_ARACAJU", min: 1 }]));
  const tc = await lidoCh(); await clicar("#btn-atualizar"); await fimLeitura();
  verdade((await lidoCh()) > tc, "chamadas relidas");
  verdade((await texto("[data-conf-inc]")).includes("5 exceção(ões)"), "INC nova das chamadas sem registro no Incidentes (leitura válida antiga) vai para exceções");
  await foto("dinc-4-xlsx-corrompido");
});
await teste("XLSX incompleto (gravação interrompida) e removido: recusado / não encontrado, sem apagar a tela", async () => {
  const b = xlsxIncidentes(AGORA); await escreverXlsx(b.slice(0, Math.floor(b.length * 0.6)));
  await clicar("#btn-atualizar"); await fimLeitura();
  verdade(/arquivo incompleto/.test(await texto("#fonte-inc")), await texto("#fonte-inc"));
  await opfs(`await d.removeEntry("Incidentes.xlsx"); return true;`);
  await clicar("#btn-atualizar"); await fimLeitura();
  verdade(/Incidentes\.xlsx não foi encontrado.*última leitura válida/.test(await texto("#fonte-inc")), await texto("#fonte-inc"));
  igual((await kpis()).incs, ESPERADO_INC.operacionais.length, "status ainda aplicado (leitura válida anterior)");
});
await teste("XLSX válido de novo com mudança de status: INC concluída sai dos lotes, da seleção e da cópia", async () => {
  await clicar('[data-sel-lote="001|BAIRRO TESTE A"]'); verdade((await js(`window.DespachoUI.estado().sel.has("INC 900000002")`)), "002 selecionada");
  const reg = REGISTROS.map((r) => (r.inc === "900000002" ? { ...r, status: "Concluído" } : r));
  await escreverXlsx(xlsxIncidentes(AGORA, { registros: reg, datas: "texto", textos: "embutidos" }));
  const ti = await lidoInc(); await clicar("#btn-atualizar"); await fimLeitura();
  verdade((await lidoInc()) > ti, "Incidentes relido");
  igual((await kpis()).incs, ESPERADO_INC.operacionais.length - 1);
  igual(await js(`window.DespachoUI.estado().sel.has("INC 900000002")`), false, "saiu da seleção");
  await clicar("#sel-copiar"); await espera(250); verdade(!(await lerClip()).includes("900000002"), "não copiada");
  await clicar("#sel-limpar");
});
await teste("Aviso de fonte desatualizada (> 15 min) e de fontes distantes", async () => {
  await js(`(() => { const r = Date.now; window.__dnow = r; Date.now = () => r() + 20 * 60000; window.DespachoUI.render(); return true; })()`);
  verdade(/sem atualização há (2\d|19) min/.test(await texto("[data-atualidade]")), await texto("#fonte-inc"));
  igual(await js(`document.querySelector("#dados-inc").classList.contains("velho")`), true);
  verdade(/há (2\d|19) min/.test(await texto("#dados-inc-texto")), "idade no selo: " + await texto("#dados-inc-texto"));
  igual(await js(`[document.querySelector("#btn-detalhes").classList.contains("alerta"), document.querySelector("#det-badge").textContent]`), [true, "!"], "ⓘ em laranja com aviso");
  await js(`(Date.now = window.__dnow, window.DespachoUI.render(), true)`);
});
await teste("Layout 1366 e 1920 sem rolagem horizontal; nada sai do computador; sem erros de JavaScript", async () => {
  igual(await js("document.documentElement.scrollWidth <= innerWidth"), true);
  await pg.tamanho(1920, 1080); igual(await js("document.documentElement.scrollWidth <= innerWidth"), true); await pg.tamanho(1366, 768);
  igual(rede.filter((u) => !u.startsWith("file:") && !u.startsWith("data:") && !u.startsWith("blob:")), [], "requisições externas");
  igual(pg.erros, [], "erros na página");
});

await nav.fechar();
const ok = resultados.filter(Boolean).length;
console.log(`\n${resultados.length} testes ponta a ponta 2.1 (${versao}) · ${ok} aprovados · ${resultados.length - ok} com falha`);
process.exitCode = ok === resultados.length ? 0 : 1;
