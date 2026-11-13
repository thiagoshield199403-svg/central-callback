/* Testes PONTA A PONTA: data/hora do ADMS (cabeçalho antigo "Horário da call"/"Recebido ADMS" e real "Horario_Call"/"Recebido_Adms")
   na importação MANUAL e na leitura da PASTA ADMS, e o FILTRO POR DATA do incidente na lista e no envio em lote.
   Dados 100% fictícios, gerados com datas relativas a HOJE (America/Maceio); banco separado.
   Uso: node testes\ponta-a-ponta\e2e-filtro-data.mjs [caminho-do-navegador]
   A janela "Selecionar pasta" é substituída por uma pasta real da área privada do navegador (OPFS), como em e2e-pasta-adms.mjs.
   A página abre com { todasAsDatas: false }: aqui vale o padrão real da Central (HOJE). */
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { abrirNavegador, espera } from "./cdp.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const resultados = [];
async function teste(nome, f) {
  try { await f(); resultados.push([true, nome]); console.log("OK    " + nome); }
  catch (e) { resultados.push([false, nome, e.message]); console.log("FALHA " + nome + " — " + e.message); }
}
const verdade = (c, m) => { if (!c) throw new Error(m || "condição falsa"); };
const igual = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || "esperado"}: ${JSON.stringify(b)}, obtido: ${JSON.stringify(a)}`); };

/* ---------------- CSV fictício com datas relativas a hoje */
const hojeLocal = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Maceio", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const somar = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const HOJE = hojeLocal(), ONTEM = somar(HOJE, -1), ANTIGA = somar(HOJE, -7);
const br = (iso, h) => iso.split("-").reverse().join("/") + " " + h;
const CAB = ["!", "ID", "Horário da call", "Motivo", "Submotivos", "UC", "Nome do reclamante", "Comentário", "Emergência", "Incidente",
  "Alimentador origem", "Localização", "Prioridade", "Cust. prioritárias", "Tipo UC:", "Protocolo", "Contato do reclamante", "Medidor ID",
  "Nota do endereço", "Custom ID do SDP", "Recebido ADMS", "Anexos", "ID do Incidente Pai"];
const REAL = { "Horário da call": "Horario_Call", "Recebido ADMS": "Recebido_Adms" };
function linha(n, hora, recebido = hora) {
  return { "!": "Não", ID: `CALL 77${n}`, "Horário da call": hora, Motivo: "Falta de energia", Submotivos: "FE", UC: `FIC_UC_${n}`,
    "Nome do reclamante": `Cliente Fictício ${n}`, "Comentário": "", "Emergência": "Não", Incidente: `INC 66${n}`, "Alimentador origem": "ALF01C1",
    "Localização": `Rua Exemplo, ${n}; Bairro Modelo; Aracaju`, Prioridade: "Normal", "Cust. prioritárias": "00-Não é VIP", "Tipo UC:": "RESIDENTIAL",
    Protocolo: `1_2_${n}`, "Contato do reclamante": `MOBILE: 79 99${String(n).padStart(3, "0")}-${String(1000 + n)}`, "Medidor ID": `MED${n}`,
    "Nota do endereço": "", "Custom ID do SDP": `FIC_UC_${n}`, "Recebido ADMS": recebido, Anexos: "Não", "ID do Incidente Pai": "" };
}
const linhas = (base) => [
  linha(base + 1, br(HOJE, "08:00:00")), linha(base + 2, br(HOJE, "09:15:30")), linha(base + 3, br(HOJE, "10:40:00")),
  linha(base + 4, br(ONTEM, "22:10:00")), linha(base + 5, br(ONTEM, "23:50:00")),
  linha(base + 6, br(ANTIGA, "12:00:00")),
  linha(base + 7, "", ""), // sem data nenhuma
  linha(base + 8, "", br(HOJE, "07:05:00")), // só Recebido ADMS (data de recebimento)
];
const q = (v) => '"' + String(v).replace(/"/g, '""') + '"';
function csv(ls, nomes = {}) {
  return "﻿" + CAB.map((c) => q(nomes[c] || c)).join(";") + "\r\n" + ls.map((l) => CAB.map((c) => q(l[c] ?? "")).join(";")).join("\r\n") + "\r\n";
}
const CSV_REAL_A = csv(linhas(100), REAL), CSV_ANTIGO = csv(linhas(200)), CSV_REAL_B = csv(linhas(300), REAL), CSV_ANTIGO_PASTA = csv(linhas(400));
const pastaTmp = mkdtempSync(join(tmpdir(), "central-filtro-data-"));
const arq = (nome, t) => { const p = join(pastaTmp, nome); writeFileSync(p, t); return p; };
const ARQ_ANTIGO = arq("navegador-chamadas-antigo.csv", CSV_ANTIGO), ARQ_REAL = arq("chamadas_incidentes_manual.csv", CSV_REAL_B);
// Lote "legado": colunas de data com nomes não reconhecidos = gravado SEM datas, como fazia o parser antigo.
const ARQ_LEGADO = arq("legado-sem-datas.csv", csv(linhas(500), { "Horário da call": "HC_LEGADO", "Recebido ADMS": "RA_LEGADO" }));
// CSV atual da pasta para o preenchimento: sem a CALL 77503 (sem correspondência) e com a 77504 repetida com outra hora (ambígua).
const CSV_PASTA_DATAS = (() => { const ls = linhas(500).filter((l) => l.ID !== "CALL 77503"); const d = { ...ls.find((l) => l.ID === "CALL 77504"), "Horário da call": br(ONTEM, "01:02:03") }; return csv(ls.concat([d]), REAL); })();

/* ---------------- navegador */
const nav = await abrirNavegador({ exe: process.argv[2] });
const url = pathToFileURL(join(raiz, "index.html")).href + "?bd=e2efd" + Date.now().toString(36);
const pg = await nav.novaPagina("about:blank", { todasAsDatas: false });
await pg.cmd("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
  window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle("ADMS", { create: true });
})();` });
await pg.ir(url);
const js = (e) => pg.js(e), S = "window.CentralUI.servico";
const clicar = (s) => js(`(() => { const e = document.querySelector(${JSON.stringify(s)}); if (!e) throw new Error("não achei ${s.replace(/"/g, "'")}"); e.click(); return true; })()`);
const valor = async (sel, v) => { await js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`); await espera(120); };
const opfs = (corpo) => js(`(async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle("ADMS", { create: true }); ${corpo} })()`);
const escrever = (nome, t) => opfs(`const w = await (await d.getFileHandle(${JSON.stringify(nome)}, { create: true })).createWritable(); await w.write(${JSON.stringify(t)}); await w.close(); return true;`);
const situacaoPasta = () => js(`document.querySelector("#pasta-adms").dataset.situacao || ""`);
const aguardarPasta = async () => { await pg.aguardar(`(() => { const s = document.querySelector("#pasta-adms").dataset.situacao; return !!s && !["iniciando", "verificando"].includes(s); })()`, 20000); return situacaoPasta(); };
const f5 = async () => { await pg.cmd("Page.reload", {}); await espera(300); await pg.aguardar("document.readyState === 'complete' && document.body.dataset.pronto === '1'"); return aguardarPasta(); };
const tela = () => js(`[...document.querySelectorAll("#linhas tr[data-id]")].map((t) => ({ inc: t.querySelector(".c-inc b").textContent, data: t.querySelector(".data-hora").textContent.trim() }))`);
const incs = async () => (await tela()).map((x) => x.inc).sort();
const info = () => js(`document.querySelector("#fd-info").textContent`);
const datasNaBase = () => js(`${S}.chamadas().map((c) => [c.call_id, c.horario_call, c.recebido_adms]).sort()`);
const importarManual = async (arquivo) => {
  const doc = await pg.cmd("DOM.getDocument", {}), { nodeId } = await pg.cmd("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "#arquivo" });
  await pg.cmd("DOM.setFileInputFiles", { nodeId, files: [arquivo] });
  await pg.aguardar("!!document.querySelector('#btn-confirmar-import')");
  const previa = await js(`[...document.querySelectorAll("#previa tbody tr")].map((t) => t.children[2].textContent)`);
  await clicar("#btn-confirmar-import");
  await pg.aguardar(`!!${S}.estado().lote_aberto && document.querySelector("#lote-titulo").textContent.includes(${JSON.stringify(arquivo.split(/[\\/]/).pop())})`);
  return previa;
};
const encerrarLote = () => js(`${S}.encerrarLote().then(() => (window.CentralUI.recarregar(), true))`);
const esperadoHoje = (b) => [`INC 66${b + 1}`, `INC 66${b + 2}`, `INC 66${b + 3}`, `INC 66${b + 8}`];
const todosIncs = (b) => [1, 2, 3, 4, 5, 6, 7, 8].map((i) => `INC 66${b + i}`).sort();

await pg.aguardar("document.body.dataset.pronto === '1'");
await opfs(`for await (const [n] of d.entries()) await d.removeEntry(n, { recursive: true }); return true;`);
await escrever("chamadas_incidentes.csv", CSV_REAL_A);

await teste("Pasta ADMS + cabeçalho REAL (Horario_Call/Recebido_Adms): datas importadas e lista abre só com HOJE", async () => {
  await clicar('#pasta-adms [data-adms="selecionar"]');
  await pg.aguardar(`document.querySelector("#pasta-adms").dataset.situacao === "aguardando_turno"`);
  await js(`(() => { const f = document.querySelector("#form-dia"); f.operador.value = "fdt1"; if (f.polo) f.polo.value = "Aracaju"; f.requestSubmit(); return true; })()`);
  await pg.aguardar(`document.querySelector("#pasta-adms").dataset.situacao === "atualizado"`, 20000);
  await pg.aguardar("document.querySelectorAll('#linhas tr[data-id]').length > 0");
  const base = await datasNaBase(), d = (n) => base.find((x) => x[0] === `CALL 77${n}`);
  igual(d(101), [`CALL 77101`, `${HOJE}T08:00:00`, `${HOJE}T08:00:00`], "Horario_Call e Recebido_Adms lidos");
  igual(d(107), [`CALL 77107`, null, null], "sem data continua sem data (nunca a importação)");
  igual(d(108), [`CALL 77108`, null, `${HOJE}T07:05:00`], "só recebimento");
  igual(await incs(), esperadoHoje(100).sort(), "padrão = hoje");
  igual(await js(`[document.querySelector("#fd-de").value, document.querySelector("#fd-ate").value, document.querySelector("#fd-hoje").classList.contains("ativo")]`), [HOJE, HOJE, true]);
  const t = await tela();
  verdade(t.filter((x) => x.inc !== "INC 66108").every((x) => x.data.startsWith(br(HOJE, "").trim())), JSON.stringify(t));
  const rec = t.find((x) => x.inc === "INC 66108"); verdade(rec.data.includes("receb."), "data de recebimento marcada: " + rec.data);
  const i = await info(); verdade(i.includes("3 em outras datas") && i.includes("1 sem data") && i.includes("1 com data de recebimento"), i);
  verdade((await js(`window.CentralPastaADMS.diagnostico()`)).includes(`Data "Horario_Call" (horario_call): 6 reconhecida(s) de 8, 2 vazia(s)`), "diagnóstico com o cabeçalho real");
});
await teste("Painel do incidente sem Horário da call mostra Recebido ADMS como data de RECEBIMENTO", async () => {
  await js(`(document.querySelector('#linhas tr[data-call="CALL 77108"]').click(), true)`); await espera(200);
  const p = await js(`document.querySelector("#painel").textContent`);
  verdade(p.includes("Recebido ADMS") && p.includes("data de recebimento no ADMS, não necessariamente a da ocorrência"), p.slice(0, 400));
  await clicar("#p-fechar");
});
await teste("Ontem / outra data / intervalo (Aplicar filtro), Sem data, Todas as datas e botão Hoje", async () => {
  await valor("#fd-de", ONTEM); await valor("#fd-ate", ONTEM); await clicar("#fd-aplicar");
  igual(await incs(), ["INC 66104", "INC 66105"], "ontem");
  await valor("#fd-de", ANTIGA); await valor("#fd-ate", ANTIGA); await clicar("#fd-aplicar");
  igual(await incs(), ["INC 66106"], "outra data");
  await valor("#fd-de", ANTIGA); await valor("#fd-ate", HOJE); await clicar("#fd-aplicar");
  igual(await incs(), ["INC 66101", "INC 66102", "INC 66103", "INC 66104", "INC 66105", "INC 66106", "INC 66108"], "intervalo (sem data fica fora)");
  await valor("#fd-de", HOJE); await valor("#fd-ate", ONTEM); await clicar("#fd-aplicar");
  igual(await incs(), ["INC 66101", "INC 66102", "INC 66103", "INC 66104", "INC 66105", "INC 66106", "INC 66108"], "período inválido não é aplicado");
  verdade((await js(`document.querySelector("#toast").textContent`)).includes("posterior"), "aviso de período inválido");
  await clicar("#fd-sem-data"); igual(await incs(), ["INC 66107"], "sem data, à parte");
  verdade((await tela())[0].data === "—", "sem data aparece com traço");
  await clicar("#fd-todas"); igual(await incs(), todosIncs(100), "todas as datas");
  await clicar("#fd-hoje"); igual(await incs(), esperadoHoje(100).sort(), "Hoje");
});
await teste("F5 volta sempre para HOJE, sem reimportar", async () => {
  await clicar("#fd-todas");
  const lotes = await js(`${S}.estado().lotes.length`);
  igual(await f5(), "sem_alteracoes");
  igual(await incs(), esperadoHoje(100).sort()); igual(await js(`${S}.estado().lotes.length`), lotes, "nenhum lote novo");
});
let chaveFeita, baseAntes, histAntes;
await teste("Envio em lote: padrão HOJE; seleção e fila só com o filtro; confirmado não volta para a fila", async () => {
  chaveFeita = await js(`(async () => { const g = ${S}.grupos().find((x) => x.incidente === "INC 66101"); await ${S}.registrar(g.principal.id, "callback_realizado", "whatsapp"); window.CentralUI.recarregar(); return g.chave; })()`);
  baseAntes = await js(`JSON.stringify(${S}.chamadas())`); histAntes = await js(`JSON.stringify(${S}.E.historico_atendimento)`);
  await clicar('[data-modo="lote"]'); await pg.aguardar("!!document.querySelector('#ds-hoje')");
  igual(await js(`[document.querySelector("#ds-de").value, document.querySelector("#ds-ate").value, document.querySelector("#ds-hoje").classList.contains("ativo")]`), [HOJE, HOJE, true], "lote abre em hoje");
  await valor("#ds-situacao", "pendentes");
  await clicar("[data-acao='marcar-todos']");
  igual(await js(`Number(document.querySelector("#ds-contagem b").textContent)`), 3, "pendentes de hoje (66102, 66103, 66108)");
  await valor("#ds-de", ONTEM); await valor("#ds-ate", ONTEM);
  igual(await js(`Number(document.querySelector("#ds-contagem b").textContent)`), 0, "trocar a data tira da seleção o que ficou fora");
  igual(await js(`[...document.querySelectorAll("#ds-linhas tr[data-chave]")].length`), 2, "ontem no lote");
  await clicar("#ds-hoje"); await clicar("[data-acao='marcar-todos']");
  await clicar("#ds-iniciar"); await pg.aguardar("!!document.querySelector('#at-incidente')");
  const fila = await js(`${S}.filaDoLote().itens.map((i) => i.incidente).sort()`);
  igual(fila, ["INC 66102", "INC 66103", "INC 66108"], "fila só com os de hoje, sem o confirmado");
  await js(`${S}.cancelarAtendimento(${S}.filaDoLote().id).then(() => (window.CentralUI.recarregar(), true))`); await espera(200);
});
await teste("Filtro da lista e do lote é o MESMO (mudar no lote vale na lista)", async () => {
  await clicar('[data-modo="lote"]'); await pg.aguardar("!!document.querySelector('#ds-todas') || !!document.querySelector(\"[data-acao='nova']\")");
  if (await js(`!!document.querySelector("[data-acao='nova']")`)) { await clicar("[data-acao='nova']"); await pg.aguardar("!!document.querySelector('#ds-todas')"); }
  await clicar("#ds-todas");
  await clicar('[data-modo="individual"]'); await espera(150);
  igual(await incs(), todosIncs(100)); verdade(await js(`document.querySelector("#fd-todas").classList.contains("ativo")`));
  await clicar("#fd-hoje");
});
await teste("Callbacks, tentativas e histórico preservados; filtro não altera nem remove registros", async () => {
  const chave = (lista) => lista.map((c) => [c.id, c.call_id, c.estado, c.tentativas, c.whatsapp_aberto_em, c.observacao, c.resolvida_em, c.servico_executado_em, c.horario_call, c.recebido_adms]);
  igual(chave(await js(`${S}.chamadas()`)), chave(JSON.parse(baseAntes)), "registros iguais depois de trocar filtros e preparar/cancelar a fila");
  const g = await js(`${S}.grupos().find((x) => x.chave === ${JSON.stringify(chaveFeita)}).principal`);
  igual([g.estado, g.tentativas.length], ["callback_realizado", 1], "callback mantido");
  igual(await js(`${S}.chamadas().length`), 8, "nenhuma comunicação removida");
  verdade((await js(`JSON.stringify(${S}.E.historico_atendimento)`)).length >= histAntes.length, "histórico não encolhe");
});
await teste("Importação MANUAL com cabeçalho ANTIGO: prévia e lista com data e hora", async () => {
  await encerrarLote(); await pg.aguardar("!!document.querySelector('#importar').offsetParent");
  const previa = await importarManual(ARQ_ANTIGO);
  verdade(previa.length === 8 && previa.filter((x) => x !== "—").length === 6, "prévia: " + JSON.stringify(previa));
  await pg.aguardar("document.querySelectorAll('#linhas tr[data-id]').length > 0");
  igual(await incs(), esperadoHoje(200).sort());
  verdade((await tela()).every((x) => x.data !== "—"), JSON.stringify(await tela()));
});
await teste("Importação MANUAL com cabeçalho REAL (Horario_Call/Recebido_Adms): prévia e lista com data e hora", async () => {
  await encerrarLote(); await pg.aguardar("!!document.querySelector('#importar').offsetParent");
  const previa = await importarManual(ARQ_REAL);
  verdade(previa.filter((x) => x !== "—").length === 6, "prévia: " + JSON.stringify(previa));
  await pg.aguardar("document.querySelectorAll('#linhas tr[data-id]').length > 0");
  igual(await incs(), esperadoHoje(300).sort());
  const d = await datasNaBase(); igual(d.find((x) => x[0] === "CALL 77304"), ["CALL 77304", `${ONTEM}T22:10:00`, `${ONTEM}T22:10:00`]);
});
await teste("Pasta ADMS com cabeçalho ANTIGO continua funcionando (lote novo da pasta, datas lidas)", async () => {
  await encerrarLote();
  await escrever("chamadas_incidentes.csv", CSV_ANTIGO_PASTA);
  igual(await f5(), "atualizado");
  await pg.aguardar("document.querySelectorAll('#linhas tr[data-id]').length > 0");
  igual(await incs(), esperadoHoje(400).sort());
  const d = await datasNaBase(); igual(d.find((x) => x[0] === "CALL 77406"), ["CALL 77406", `${ANTIGA}T12:00:00`, `${ANTIGA}T12:00:00`]);
});
const contas = () => js(`Object.fromEntries([...document.querySelectorAll("#modal-caixa [data-conta]")].map((l) => [l.dataset.conta, Number(l.querySelector("b").textContent)]))`);
let revAntes, idCb;
await teste("Preencher datas: lote gravado sem datas (legado) + CSV atual da pasta; F5 não reimporta lote manual", async () => {
  await encerrarLote(); await pg.aguardar("!!document.querySelector('#importar').offsetParent");
  await importarManual(ARQ_LEGADO);
  igual(await js(`${S}.chamadasSemData()`), 8, "lote sem datas");
  idCb = await js(`(async () => { const c = ${S}.chamadas().find((x) => x.call_id === "CALL 77502"); await ${S}.registrar(c.id, "callback_realizado", "whatsapp", "obs ficticia"); return c.id; })()`);
  await escrever("chamadas_incidentes.csv", CSV_PASTA_DATAS);
  igual(await f5(), "lote_manual", "a pasta não mexe no lote");
  igual(await incs(), [], "Hoje: nenhum incidente (todos sem data)");
  verdade(await js(`!document.querySelector("#fd-preencher").classList.contains("oculto") && document.querySelector("#fd-preencher").textContent.includes("(8)")`), "botão visível com a contagem");
});
await teste("Preencher datas: prévia com as contagens; Cancelar não grava nada", async () => {
  revAntes = await js(`${S}.arm.revisao`);
  await clicar("#fd-preencher"); await pg.aguardar(`!document.querySelector("#modal").classList.contains("oculto") && !!document.querySelector("#modal-caixa [data-conta]")`, 20000);
  igual(await contas(), { ausentes: 8, horario: 4, recebido: 5, atualizar: 5, sem_correspondencia: 1, ambiguas: 1, sem_data_no_csv: 1 });
  await clicar("#m-nao"); await espera(200);
  igual(await js(`${S}.arm.revisao`), revAntes, "nada gravado"); igual(await js(`${S}.chamadasSemData()`), 8);
});
await teste("Preencher datas: confirmar grava só as datas; relatório; callback, tentativas e observação intactos; lista mostra as datas", async () => {
  const antes = await js(`${S}.chamadas().map((c) => { const x = { ...c }; delete x.horario_call; delete x.recebido_adms; return x; })`);
  await js(`(document.querySelector("#modal-caixa").innerHTML = "", true)`); // descarta o modal antigo (cancelado), já oculto
  await clicar("#fd-preencher"); await pg.aguardar(`!document.querySelector("#modal").classList.contains("oculto") && !!document.querySelector("#m-sim")`, 20000);
  await clicar("#m-sim");
  await pg.aguardar(`document.querySelector("#modal-caixa").textContent.includes("Datas preenchidas")`, 20000);
  const r = await contas(); await clicar("#modal-caixa [data-escolha]");
  igual([r.gravados, r.horario, r.recebido, r.sem_correspondencia, r.ambiguas, r.sem_data_no_csv, r.ainda_sem_horario, r.ainda_sem_recebido], [5, 4, 5, 1, 1, 1, 4, 3]);
  const depois = await js(`${S}.chamadas().map((c) => { const x = { ...c }; delete x.horario_call; delete x.recebido_adms; return x; })`);
  igual(depois, antes, "nenhum outro campo mudou");
  const c = await js(`${S}.obterChamada(${idCb})`);
  igual([c.estado, c.tentativas.length, c.observacao, c.horario_call], ["callback_realizado", 1, "obs ficticia", `${HOJE}T09:15:30`], "callback preservado e data preenchida");
  igual(await incs(), ["INC 66501", "INC 66502", "INC 66508"], "Hoje: datas reais (66508 pela data de recebimento; 66503/66504/66507 continuam sem data)");
  igual(await js(`${S}.estado().lotes.map((l) => l.situacao).filter((x) => x === "aberto").length`), 1, "o mesmo lote continua aberto");
  igual(await js(`${S}.loteAberto().arquivo_nome`), "legado-sem-datas.csv", "nenhum lote novo, nada reimportado");
  igual(await js(`${S}.chamadas().length`), 8, "nada inserido/removido");
  verdade(await js(`document.querySelector("#fd-preencher").textContent.includes("(4)")`), "restam 4 com alguma data ausente");
});
await teste("Sem rolagem horizontal com o filtro (1366 e 390 px) e console sem erros", async () => {
  verdade(await js("document.documentElement.scrollWidth <= innerWidth"), "1366");
  await pg.tamanho(390, 844); verdade(await js("document.documentElement.scrollWidth <= innerWidth"), "390"); await pg.tamanho(1366, 768);
  igual(pg.erros, [], "erros");
  verdade(!pg.console.some((c) => c.tipo === "error"), JSON.stringify(pg.console.filter((c) => c.tipo === "error")));
});

await nav.fechar();
try { rmSync(pastaTmp, { recursive: true, force: true }); } catch (e) { /* temporário */ }
const falhas = resultados.filter((r) => !r[0]).length;
console.log(`\n${resultados.length} testes ponta a ponta (data ADMS e filtro por data) · ${resultados.length - falhas} aprovados · ${falhas} com falha`);
process.exitCode = falhas ? 1 : 0;
