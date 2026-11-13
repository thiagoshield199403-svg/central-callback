/* Testes PONTA A PONTA da alimentação automática pela PASTA ADMS (js/pasta-adms.js). Dados 100% fictícios; banco separado.
   Uso: node testes\ponta-a-ponta\e2e-pasta-adms.mjs [caminho-do-navegador]
   - A janela nativa "Selecionar pasta" não pode ser automatizada: é SUBSTITUÍDA por uma que devolve uma PASTA REAL da área
     privada do navegador (OPFS) chamada "ADMS", com chamadas_incidentes.csv e outros relatórios. O identificador dessa pasta é
     gravado no IndexedDB pela Central e reaproveitado de verdade a cada F5 (Page.reload).
   - Permissão revogada: queryPermission passa a responder "prompt" (como faz o navegador); requestPermission concede no clique.
   - "Arquivo em gravação": outra aba regrava o CSV sem parar enquanto a Central confere (escrita real, concorrente).
   - Leituras e rede são vigiadas: registra cada arquivo aberto/lido e cada requisição feita pela página. */
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

const CSV1 = readFileSync(join(raiz, "exemplos", "navegador-chamadas-ADMS2026-FICTICIO.csv"), "utf8");
// Versão 2: mesma base + 1 CALL nova (cópia da última linha com outro ID). Sem somar de novo as que já estavam.
const linhas = CSV1.replace(/\r?\n$/, "").split(/\r?\n/);
const cab = linhas.findIndex((l) => l.includes('"ID"') && l.includes('"Horário da call"'));
const colId = linhas[cab].split(";").indexOf('"ID"');
const ultima = linhas[linhas.length - 1].split(";");
const idOriginal = ultima[colId]; ultima[colId] = '"9999001"';
const CSV2 = linhas.concat([ultima.join(";")]).join("\r\n") + "\r\n";
ultima[colId] = '"9999002"';
const CSV3 = linhas.concat([ultima.join(";")]).join("\r\n") + "\r\n"; // outra versão (CALL nova diferente)
verdade(idOriginal && idOriginal !== '"9999001"', "montagem do CSV de teste");

const nav = await abrirNavegador({ exe: process.argv[2] });
const bd = "e2eadms" + Date.now().toString(36);
const url = pathToFileURL(join(raiz, "index.html")).href + "?bd=" + bd;
const pg = await nav.novaPagina();
const requisicoes = [];
nav.ouvintes.push((m) => { if (m.sessionId === pg.s && m.method === "Network.requestWillBeSent") requisicoes.push(m.params.request.url); });
await pg.cmd("Network.enable");
// Roda ANTES dos scripts da Central em toda carga (inclusive F5): seletor simulado, vigilância de leituras, permissão simulada.
await pg.cmd("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
  window.__abertos = []; window.__lidos = []; window.__listagens = 0;
  if (localStorage.getItem("__semAPI") === "1") { delete window.showDirectoryPicker; window.showDirectoryPicker = undefined; delete window.showOpenFilePicker; window.showOpenFilePicker = undefined; return; } // como no Firefox: nenhuma das duas APIs
  window.__nPasta = 0;
  window.showDirectoryPicker = async () => { window.__nPasta++; const r = await navigator.storage.getDirectory(); return r.getDirectoryHandle("ADMS", { create: true }); };
  const D = FileSystemDirectoryHandle.prototype, F = FileSystemHandle.prototype, B = Blob.prototype;
  const gfh = D.getFileHandle; D.getFileHandle = function (n, o) { window.__abertos.push(n); return gfh.call(this, n, o); };
  const ent = D.entries; D.entries = function () { window.__listagens++; return ent.call(this); };
  for (const k of ["arrayBuffer", "text", "stream"]) { const o = B[k]; B[k] = function () { if (this.name) window.__lidos.push(this.name); return o.call(this); }; }
  const q = F.queryPermission; F.queryPermission = function (op) { return localStorage.getItem("__revogada") === "1" ? Promise.resolve("prompt") : q.call(this, op); };
  F.requestPermission = function () { localStorage.removeItem("__revogada"); window.__pedidoPermissao = true; return Promise.resolve("granted"); };
})();` });
await pg.ir(url);

const js = (e) => pg.js(e);
const clicar = (sel) => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) throw new Error("não achei ${sel.replace(/"/g, "'")}"); e.click(); return true; })()`);
const situacao = () => js(`(document.querySelector("#pasta-adms").dataset.situacao || "")`);
const textoIndicador = () => js(`document.querySelector("#pasta-adms").textContent`);
const aguardarSituacao = async (ms = 20000) => { await pg.aguardar(`(() => { const s = document.querySelector("#pasta-adms").dataset.situacao; return !!s && s !== "iniciando" && s !== "verificando"; })()`, ms); return situacao(); };
const f5 = async () => { await pg.cmd("Page.reload", {}); await espera(300); await pg.aguardar("document.readyState === 'complete' && document.body.dataset.pronto === '1'"); return aguardarSituacao(); };
const opfs = (corpo) => js(`(async () => { const r = await navigator.storage.getDirectory(); const d = await r.getDirectoryHandle("ADMS", { create: true }); ${corpo} })()`);
const escrever = (nome, texto) => opfs(`const w = await (await d.getFileHandle(${JSON.stringify(nome)}, { create: true })).createWritable(); await w.write(${JSON.stringify(texto)}); await w.close(); return true;`);
const apagar = (nome) => opfs(`await d.removeEntry(${JSON.stringify(nome)}); return true;`);
const srvInfo = () => js(`(() => { const s = window.CentralUI.servico, e = s.estado(); return { lotes: e.lotes.map((l) => ({ n: l.numero, sit: l.situacao, origem: l.origem || "manual", atual: l.atualizacoes || 0 })),
  chamadas: s.chamadas().length, calls: s.chamadas().map((c) => c.call_id), callbacks: e.metricas_tempo_real.callbacks_realizados, processadas: e.metricas_tempo_real.chamadas_processadas }; })()`);
const nValidas = (csv) => js(`window.Nucleo.analisar(new TextEncoder().encode(${JSON.stringify(csv)})).validas.length`);

await pg.aguardar("document.body.dataset.pronto === '1'");
await opfs(`for await (const [n] of d.entries()) await d.removeEntry(n, { recursive: true }); return true;`);
await escrever("chamadas_incidentes.csv", CSV1);
await escrever("relatorio_outro.csv", '"ID";"X"\r\n"1";"nao deve ser lido"\r\n');
await escrever("chamadas_incidentes_antigo.csv", CSV2);
await escrever("indicadores.xlsx", "PK-nao-e-csv");
const v1 = await nValidas(CSV1), v2 = await nValidas(CSV2);
verdade(v2 === v1 + 1, `CSV2 deveria ter 1 chamada a mais (${v1} / ${v2})`);

await teste("Abertura por file://: API de pasta disponível e indicador discreto sem pasta conectada", async () => {
  verdade(url.startsWith("file:///"));
  igual(await aguardarSituacao(), "sem_pasta");
  verdade((await textoIndicador()).includes("Selecionar pasta"), "botão Selecionar pasta");
  verdade(await js("document.querySelector('#pasta-adms').getBoundingClientRect().height <= 60"), "indicador grande demais");
});
await teste("Antes do turno: pasta selecionada fica aguardando o turno (sem importar)", async () => {
  await clicar('#pasta-adms [data-adms="selecionar"]');
  await pg.aguardar(`document.querySelector("#pasta-adms").dataset.situacao === "aguardando_turno"`);
  igual(await js("window.__lidos"), [], "não deveria ler antes do turno");
});
await teste("Abrir o turno carrega chamadas_incidentes.csv sozinho (lote da pasta)", async () => {
  await js(`(() => { const f = document.querySelector("#form-dia"); f.operador.value = "adm1"; f.polo.value = "Aracaju"; f.requestSubmit(); return true; })()`);
  await pg.aguardar(`document.querySelector("#pasta-adms").dataset.situacao === "atualizado"`, 20000);
  await pg.aguardar("document.querySelectorAll('#linhas tr[data-id]').length > 0");
  const i = await srvInfo();
  igual(i.lotes, [{ n: 1, sit: "aberto", origem: "pasta_adms", atual: 0 }]);
  igual(i.chamadas, v1, "chamadas do lote");
  igual(await js("window.__lidos"), ["chamadas_incidentes.csv"], "arquivos lidos");
  verdade((await textoIndicador()).includes("Última atualização"), "última atualização no indicador");
});
await teste("F5 sem alterar o arquivo: não relê, não reprocessa e não duplica", async () => {
  igual(await f5(), "sem_alteracoes");
  igual(await js("window.__lidos"), [], "o arquivo não deveria ser lido");
  const i = await srvInfo();
  igual(i.lotes.length, 1); igual(i.chamadas, v1); igual(i.processadas, v1);
  igual(await f5(), "sem_alteracoes"); igual((await srvInfo()).chamadas, v1, "segundo F5");
});
let idCb;
await teste("Arquivo novo (F5): carrega a versão nova sem somar de novo e preserva o callback registrado", async () => {
  idCb = await js(`(async () => { const s = window.CentralUI.servico, c = s.chamadas().find((x) => x.estado === "pendente");
    await s.registrar(c.id, "callback_realizado", "whatsapp"); return c.id; })()`);
  igual((await srvInfo()).callbacks, 1);
  await escrever("chamadas_incidentes.csv", CSV2);
  igual(await f5(), "atualizado");
  const i = await srvInfo();
  igual(i.lotes, [{ n: 1, sit: "aberto", origem: "pasta_adms", atual: 1 }], "mesmo lote, uma atualização");
  igual(i.chamadas, v1 + 1, "só a CALL nova entrou"); igual(i.processadas, v1 + 1);
  igual(new Set(i.calls).size, i.calls.length, "CALL duplicada no lote");
  igual(i.callbacks, 1, "callbacks");
  igual(await js(`window.CentralUI.servico.obterChamada(${idCb}).estado`), "callback_realizado", "callback preservado");
  verdade((await textoIndicador()).includes("1 nova(s)"), await textoIndicador());
  igual(await js("window.__lidos"), ["chamadas_incidentes.csv"]);
});
await teste("Arquivo regravado com o MESMO conteúdo: lê uma vez, reconhece e não atualiza", async () => {
  await espera(50); await escrever("chamadas_incidentes.csv", CSV2);
  igual(await f5(), "sem_alteracoes");
  igual((await srvInfo()).lotes[0].atual, 1, "não deveria contar outra atualização");
  igual(await f5(), "sem_alteracoes"); igual(await js("window.__lidos"), [], "já memorizado: não lê de novo");
});
await teste("Demais arquivos da pasta nunca são abertos nem lidos; nenhuma listagem da pasta", async () => {
  igual(await f5(), "sem_alteracoes");
  const abertos = await js("window.__abertos");
  verdade(abertos.length > 0 && abertos.every((n) => n === "chamadas_incidentes.csv"), JSON.stringify(abertos));
  igual(await js("window.__listagens"), 0, "listagens da pasta");
});
await teste("Arquivo em gravação pelo ADMS: espera, informa e não carrega dados incompletos", async () => {
  const outra = await nav.novaPagina(pathToFileURL(join(raiz, "LEIA-ME.txt")).href);
  await outra.js(`(async () => { const r = await navigator.storage.getDirectory(), d = await r.getDirectoryHandle("ADMS");
    window.__parar = false; let n = 0;
    (async () => { while (!window.__parar) { const w = await (await d.getFileHandle("chamadas_incidentes.csv")).createWritable();
      await w.write(${JSON.stringify(CSV2)}.slice(0, 2000 + (n++ % 7) * 900)); await w.close(); await new Promise((ok) => setTimeout(ok, 120)); } })();
    return true; })()`);
  await espera(400);
  const s = await f5();
  await outra.js("(window.__parar = true)"); await espera(400);
  await outra.cmd("Page.close").catch(() => {});
  igual(s, "em_gravacao");
  const i = await srvInfo();
  igual(i.chamadas, v1 + 1, "nada parcial pode entrar"); igual(i.lotes[0].atual, 1);
  await escrever("chamadas_incidentes.csv", CSV2);
  igual(await f5(), "sem_alteracoes", "terminada a gravação, volta ao normal");
});
await teste("Arquivo indisponível: avisa, oferece selecionar e o painel continua funcionando", async () => {
  await apagar("chamadas_incidentes.csv");
  igual(await f5(), "nao_encontrado");
  igual(await js("document.querySelectorAll('#linhas tr[data-id]').length > 0"), true, "lote continua na tela");
  igual((await srvInfo()).chamadas, v1 + 1);
  await js(`(async () => { await (await navigator.storage.getDirectory()).removeEntry("ADMS", { recursive: true }); return true; })()`);
  igual(await f5(), "pasta_indisponivel");
  verdade((await textoIndicador()).includes("Selecionar pasta"));
  await escrever("chamadas_incidentes.csv", CSV2); await escrever("relatorio_outro.csv", "x");
  igual(await f5(), "sem_alteracoes", "pasta de volta");
});
await teste("Autorização revogada: aguarda permissão sem travar; Renovar autorização volta a ler sem nova seleção", async () => {
  await js(`(localStorage.setItem("__revogada", "1"), true)`);
  igual(await f5(), "permissao");
  verdade((await textoIndicador()).includes("Renovar autorização")); const nPastaAntes = await js("window.__nPasta");
  igual(await js("window.__lidos"), []);
  igual(await js("document.querySelectorAll('#linhas tr[data-id]').length > 0"), true, "Central utilizável");
  await clicar('#pasta-adms [data-adms="reconectar"]');
  await pg.aguardar(`document.querySelector("#pasta-adms").dataset.situacao === "sem_alteracoes"`);
  igual(await js("window.__pedidoPermissao === true"), true);
  igual(await js("window.__nPasta"), nPastaAntes, "renovar não pode abrir a janela de seleção de novo");
});
await teste("Importação manual continua funcionando; a pasta não mistura versão em lote manual", async () => {
  await js(`window.CentralUI.servico.encerrarLote().then(() => (window.CentralUI.recarregar(), true))`);
  await pg.aguardar("!!document.querySelector('#importar').offsetParent");
  const doc = await pg.cmd("DOM.getDocument", {});
  const { nodeId } = await pg.cmd("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "#arquivo" });
  await pg.cmd("DOM.setFileInputFiles", { nodeId, files: [join(raiz, "exemplos", "navegador-chamadas-CONTINGENCIA-FICTICIO.csv")] });
  await pg.aguardar("!!document.querySelector('#btn-confirmar-import')"); await clicar("#btn-confirmar-import");
  await pg.aguardar("!!window.CentralUI.servico.estado().lote_aberto && document.querySelector('#lote-titulo').textContent.startsWith('Lote 2')");
  let i = await srvInfo();
  igual(i.lotes.map((l) => [l.n, l.sit, l.origem]), [[1, "encerrado", "pasta_adms"], [2, "aberto", "manual"]]);
  const n2 = i.chamadas;
  await escrever("chamadas_incidentes.csv", CSV1);
  igual(await f5(), "lote_manual");
  i = await srvInfo(); igual(i.chamadas, n2, "lote manual intacto"); igual(i.lotes.length, 2);
});
await teste("Lote encerrado + versão nova (F5): novo lote da pasta; CALL do dia conta uma vez, callback mantido", async () => {
  const antes = await srvInfo();
  await js(`window.CentralUI.servico.encerrarLote().then(() => true)`);
  await escrever("chamadas_incidentes.csv", CSV1);
  igual(await f5(), "sem_alteracoes", "versão antiga, já aplicada hoje: não volta a importar");
  await escrever("chamadas_incidentes.csv", CSV3);
  igual(await f5(), "atualizado");
  const i = await srvInfo();
  igual(i.lotes.map((l) => [l.n, l.sit, l.origem]), [[1, "encerrado", "pasta_adms"], [2, "encerrado", "manual"], [3, "aberto", "pasta_adms"]]);
  igual(i.chamadas, v1 + 1);
  igual(i.callbacks, antes.callbacks, "callbacks do dia não somam de novo");
  igual(i.processadas, antes.processadas + 1, "só a CALL 9999002 é nova no dia");
  igual(await f5(), "sem_alteracoes", "F5 seguinte");
});
await teste("Indicadores e Painel continuam funcionando", async () => {
  verdade((await js("document.querySelector('#metricas').textContent")).length > 20, "métricas");
  await clicar("#btn-painel"); await espera(300);
  verdade(await js("!document.querySelector('#modal').classList.contains('oculto') && document.querySelector('#modal-caixa').textContent.includes('Painel de indicadores')"), "painel");
  await clicar("#pi-fechar");
});
await teste("Nenhuma informação enviada para fora: só arquivos locais (file://)", async () => {
  const externas = requisicoes.filter((u) => !u.startsWith("file://") && !u.startsWith("data:"));
  igual(externas, [], "requisições externas");
  verdade(requisicoes.length > 0, "monitor de rede ativo");
});
await teste("Navegador sem a API: informa e mantém a importação manual (sem simular conexão)", async () => {
  await js(`(localStorage.setItem("__semAPI", "1"), true)`);
  igual(await f5(), "indisponivel");
  verdade(!(await textoIndicador()).includes("Verificar agora"), "não pode oferecer verificação");
  await js(`(localStorage.removeItem("__semAPI"), true)`);
});
await teste("Console sem erros (CSP, JavaScript)", async () => {
  verdade(pg.erros.length === 0, pg.erros.join(" || "));
  verdade(!pg.console.some((c) => c.tipo === "error"), JSON.stringify(pg.console.filter((c) => c.tipo === "error")));
});

await nav.fechar();
const falhas = resultados.filter((r) => !r[0]);
console.log(`\n${resultados.length} testes ponta a ponta (pasta ADMS) · ${resultados.length - falhas.length} aprovados · ${falhas.length} com falha`);
process.exitCode = falhas.length ? 1 : 0;
