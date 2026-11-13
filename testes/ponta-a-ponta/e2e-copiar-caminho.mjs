/* Testes PONTA A PONTA do botão "Copiar caminho" da faixa Pasta ADMS (js/pasta-adms.js). Dados fictícios; banco separado.
   Uso: node testes\ponta-a-ponta\e2e-copiar-caminho.mjs [caminho-do-navegador]
   - O caminho é FIXO em js/pasta-adms.js (\\fs-bi\ESE\DTEC\DEOP\ADMS) e é copiado na hora, sem janela, campo ou pergunta.
   - A área de transferência é REAL: o navegador concede a permissão e o teste lê o que foi copiado (navigator.clipboard.readText).
   - A janela nativa "Selecionar pasta" é substituída por uma pasta real da área privada do navegador (OPFS), como em e2e-pasta-adms. */
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { abrirNavegador, espera } from "./cdp.mjs";
const ESPERADO = "\\\\fs-bi\\ESE\\DTEC\\DEOP\\ADMS";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const resultados = [];
async function teste(nome, f) {
  try { await f(); resultados.push([true, nome]); console.log("OK    " + nome); }
  catch (e) { resultados.push([false, nome, e.message]); console.log("FALHA " + nome + " — " + e.message); }
}
const verdade = (c, m) => { if (!c) throw new Error(m || "condição falsa"); };
const igual = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || "esperado"}: ${JSON.stringify(b)}, obtido: ${JSON.stringify(a)}`); };

const CSV = readFileSync(join(raiz, "exemplos", "navegador-chamadas-ADMS2026-FICTICIO.csv"), "utf8");
const SIMULACAO = `(() => {
  window.__nPasta = 0; window.__nArquivo = 0;
  window.showDirectoryPicker = async () => { window.__nPasta++; return (await navigator.storage.getDirectory()).getDirectoryHandle("ADMS", { create: true }); };
  window.showOpenFilePicker = async () => { window.__nArquivo++; throw new DOMException("x", "AbortError"); };
  if (localStorage.getItem("__semClipboard") === "1") navigator.clipboard.writeText = () => Promise.reject(new DOMException("negado (simulado)", "NotAllowedError"));
})();`;

const nav = await abrirNavegador({ exe: process.argv[2] });
await nav.enviar("Browser.grantPermissions", { permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] }).catch(() => nav.enviar("Browser.grantPermissions", { permissions: ["clipboardReadWrite"] }));
const versao = (await nav.enviar("Browser.getVersion")).product;
const bd = "e2ecopiar" + Date.now().toString(36), base = pathToFileURL(join(raiz, "index.html")).href;
let pg;
async function abrir(op = {}, banco = bd) {
  pg = await nav.novaPagina("about:blank", op);
  await pg.cmd("Emulation.setFocusEmulationEnabled", { enabled: true }); // a área de transferência exige página em foco
  await pg.cmd("Page.addScriptToEvaluateOnNewDocument", { source: SIMULACAO });
  await pg.ir(`${base}?bd=${banco}`); await pg.aguardar("document.body.dataset.pronto === '1'");
  await pg.aguardar(`(() => { const s = document.querySelector("#pasta-adms").dataset.situacao; return !!s && s !== "iniciando" && s !== "verificando"; })()`, 20000);
}
const js = (e) => pg.js(e);
const botoes = () => js(`[...document.querySelectorAll("#pasta-adms [data-adms]")].map((b) => b.textContent)`);
const clicar = (sel) => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) throw new Error("não achei ${sel.replace(/"/g, "'")}"); e.click(); return true; })()`);
const escreverClip = (t) => js(`navigator.clipboard.writeText(${JSON.stringify(t)}).then(() => true)`);
const lerClip = () => js(`navigator.clipboard.readText()`);
const toast = () => js(`document.querySelector("#toast").textContent`);
const semJanela = () => js(`document.querySelector("#modal").classList.contains("oculto") && !document.querySelector("#adms-caminho-novo") && !document.querySelector("#modal input")`);
const copiar = async () => { await js(`(document.querySelector("#toast").textContent = "", true)`); await clicar('#pasta-adms [data-adms="copiar"]'); await pg.aguardar(`document.querySelector("#toast").textContent.length > 0`); };

console.log("Navegador: " + versao);
await abrir();
await teste("Primeiro acesso: Copiar caminho, Selecionar pasta, Selecionar arquivo e Diagnóstico na faixa", async () => {
  igual(await js(`document.querySelector("#pasta-adms").dataset.situacao`), "sem_pasta");
  igual(await botoes(), ["Copiar caminho", "Selecionar pasta", "Selecionar arquivo", "Diagnóstico"]);
  verdade((await js(`document.querySelector("#pasta-adms").textContent`)).includes(ESPERADO), "caminho configurado visível");
});
await teste("Copiar caminho grava o caminho FIXO na área de transferência real; não abre janela nem muda a conexão", async () => {
  await escreverClip("conteúdo anterior"); await copiar();
  igual(await lerClip(), ESPERADO, "área de transferência");
  igual(await toast(), "Caminho copiado.", "só a mensagem discreta");
  igual(await semJanela(), true, "nenhuma janela, modal ou campo de preenchimento");
  igual(await js(`[window.__nPasta, window.__nArquivo, document.querySelector("#pasta-adms").dataset.situacao, document.querySelector("#pasta-adms").dataset.conexao]`), [0, 0, "sem_pasta", ""]);
});
await teste("Com a pasta conectada: Copiar caminho continua disponível e funcionando; a conexão guardada não muda", async () => {
  await js(`(async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle("ADMS", { create: true }); const w = await (await d.getFileHandle("chamadas_incidentes.csv", { create: true })).createWritable(); await w.write(${JSON.stringify(CSV)}); await w.close(); return true; })()`);
  await clicar('#pasta-adms [data-adms="selecionar"]');
  await pg.aguardar(`document.querySelector("#pasta-adms").dataset.conexao === "directory" && !["iniciando", "verificando"].includes(document.querySelector("#pasta-adms").dataset.situacao)`, 20000);
  const b = await botoes(); verdade(b.includes("Copiar caminho") && b.includes("Diagnóstico") && b.includes("Trocar pasta"), JSON.stringify(b));
  igual(await js(`!!document.querySelector("#pasta-adms [data-adms-caminho]")`), false, "o caminho padrão não substitui a pasta conectada na faixa");
  await escreverClip("outro"); const n = await js("window.__nPasta"); await copiar();
  igual([await lerClip(), await js("window.__nPasta"), await js(`document.querySelector("#pasta-adms").dataset.conexao`)], [ESPERADO, n, "directory"]);
});
await teste("Depois de atualizar a página (F5) com a pasta guardada: Copiar caminho continua na faixa", async () => {
  await pg.cmd("Page.reload", {}); await espera(300); await pg.aguardar("document.readyState === 'complete' && document.body.dataset.pronto === '1'");
  await pg.aguardar(`(() => { const s = document.querySelector("#pasta-adms").dataset.situacao; return !!s && s !== "iniciando" && s !== "verificando"; })()`, 20000);
  verdade((await botoes()).includes("Copiar caminho"), JSON.stringify(await botoes())); await escreverClip("x"); await copiar(); igual(await lerClip(), ESPERADO);
});
await teste("Área de transferência recusada pelo navegador: cópia alternativa ou orientação com o caminho, sem erro", async () => {
  await abrir({}, bd + "b"); await js(`(localStorage.setItem("__semClipboard", "1"), location.reload(), true)`); await espera(500);
  await pg.aguardar("document.readyState === 'complete' && document.body.dataset.pronto === '1'");
  await pg.aguardar(`(() => { const s = document.querySelector("#pasta-adms").dataset.situacao; return !!s && s !== "iniciando" && s !== "verificando"; })()`, 20000);
  await js(`navigator.clipboard.readText().then(() => true)`).catch(() => true);
  await copiar(); const t = await toast();
  verdade(t.startsWith("Caminho copiado.") || t.startsWith("Caminho selecionado") || t.includes(ESPERADO), t);
  await js(`(localStorage.removeItem("__semClipboard"), true)`);
});
await teste("Sem config-local.js (como no GitHub Pages): copia o mesmo caminho na hora, sem pedir nada", async () => {
  await abrir({ config: {} }, bd + "c");
  igual(await botoes(), ["Copiar caminho", "Selecionar pasta", "Selecionar arquivo", "Diagnóstico"]);
  igual(await js(`(document.querySelector("#pasta-adms [data-adms-caminho]") || {}).textContent`), ESPERADO, "caminho na faixa");
  await escreverClip("x"); await copiar();
  igual([await lerClip(), await toast(), await semJanela()], [ESPERADO, "Caminho copiado.", true]);
});
await teste("Sem erros de JavaScript na página", async () => { igual(pg.erros, []); });

await nav.fechar();
const falhas = resultados.filter((r) => !r[0]);
console.log(`\n${resultados.length - falhas.length}/${resultados.length} testes do botão Copiar caminho passaram (${versao}).`);
process.exit(falhas.length ? 1 : 0);
