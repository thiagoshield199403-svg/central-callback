/* Testes PONTA A PONTA do DESPACHO OTIMIZADO 2.0 (despacho.html) integrado à Central. Dados 100% FICTÍCIOS
   (testes/despacho/dados-ficticios.mjs) nos formatos reais do chamadas_incidentes.csv; nenhum arquivo real é lido ou alterado.
   Uso: node testes\ponta-a-ponta\e2e-despacho.mjs [caminho-do-navegador]      (FOTOS=<pasta> grava capturas de tela)
   - A pasta ADMS é uma pasta da área privada do navegador (OPFS); a janela "Selecionar pasta" é substituída por ela.
   - A pasta é conectada PELA CENTRAL; o Despacho reaproveita essa autorização sem abrir seletor nenhum.
   - Área de transferência real (permissão concedida pelo teste). */
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { abrirNavegador, espera } from "./cdp.mjs";
import { CHAMADAS, csvPasta, csvNavegador } from "../despacho/dados-ficticios.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const resultados = [];
async function teste(nome, f) { try { await f(); resultados.push(true); console.log("OK    " + nome); } catch (e) { resultados.push(false); console.log("FALHA " + nome + " — " + e.message); } }
const verdade = (c, m) => { if (!c) throw new Error(m || "condição falsa"); };
const igual = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || "esperado"}: ${JSON.stringify(b)}, obtido: ${JSON.stringify(a)}`); };

const SIMULACAO = `(() => {
  window.__nPasta = 0;
  window.showDirectoryPicker = async () => { window.__nPasta++; return (await navigator.storage.getDirectory()).getDirectoryHandle("ADMS", { create: true }); };
  const F = FileSystemHandle.prototype, q = F.queryPermission;
  F.queryPermission = function (op) { return localStorage.getItem("__revogada") === "1" ? Promise.resolve("prompt") : q.call(this, op); };
  F.requestPermission = function () { localStorage.removeItem("__revogada"); window.__pedidos = (window.__pedidos || 0) + 1; return Promise.resolve("granted"); };
})();`;

const exe = process.argv[2], nav = await abrirNavegador({ exe });
await nav.enviar("Browser.grantPermissions", { permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] }).catch(() => nav.enviar("Browser.grantPermissions", { permissions: ["clipboardReadWrite"] }));
const versao = (await nav.enviar("Browser.getVersion")).product;
const bd = "e2edesp" + Date.now().toString(36), base = pathToFileURL(raiz).href + "/";
const rede = [];
let pg;
async function abrir(caminho) {
  pg = await nav.novaPagina();
  nav.ouvintes.push((m) => { if (m.method === "Network.requestWillBeSent") rede.push(m.params.request.url); });
  await pg.cmd("Network.enable"); await pg.cmd("Emulation.setFocusEmulationEnabled", { enabled: true });
  await pg.cmd("Page.addScriptToEvaluateOnNewDocument", { source: SIMULACAO });
  await pg.ir(`${base}${caminho}?bd=${bd}`); await pg.aguardar("document.body.dataset.pronto === '1'", 20000);
}
const js = (e) => pg.js(e);
const clicar = (sel) => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) throw new Error("não achei ${sel.replace(/"/g, "'")}"); e.click(); return true; })()`);
const texto = (sel) => js(`(document.querySelector(${JSON.stringify(sel)}) || {}).textContent || ""`);
const escolher = (sel, v) => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event("change", { bubbles: true })); return e.value; })()`);
const opfs = (corpo) => js(`(async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle("ADMS", { create: true }); ${corpo} })()`);
const escrever = (t) => opfs(`const w = await (await d.getFileHandle("chamadas_incidentes.csv", { create: true })).createWritable(); await w.write(${JSON.stringify(t)}); await w.close(); return true;`);
const kpis = () => js(`Object.fromEntries([...document.querySelectorAll("[data-kpi]")].map((e) => [e.dataset.kpi, Number(e.textContent)]))`);
const lerClip = async () => (await js("navigator.clipboard.readText()")).split("\r\n").join("\n"); // o Windows grava CRLF
const lidoEm = () => js("window.DespachoUI.estado().lidoEm || 0");
const aguardarLeitura = (antes) => pg.aguardar(`(window.DespachoUI.estado().lidoEm || 0) > ${antes} && !window.DespachoUI.estado().lendo`, 20000);
const nomesLotes = () => js(`[...document.querySelectorAll(".secao")].map((s) => [s.querySelector("h2 span").textContent, [...s.querySelectorAll(".lote-cab .bairro")].map((b) => b.textContent + "=" + b.closest(".lote-cab").querySelector(".qtd").textContent)])`);
const foto = async (n) => { if (process.env.FOTOS) await pg.foto(join(process.env.FOTOS, n + ".png")); };
const AGORA = Date.now();

/* ------------------------------------------------------------ Central: conecta a pasta e abre o módulo */
await abrir("index.html");
await opfs(`for await (const [n] of d.entries()) await d.removeEntry(n, { recursive: true }); return true;`);
await escrever(csvPasta(AGORA));
console.log("Navegador: " + versao);

await teste("Central: botão DESPACHO OTIMIZADO no topo; pasta ADMS conectada pela Central", async () => {
  igual((await texto("#btn-despacho")).trim(), "DESPACHO OTIMIZADO");
  await pg.aguardar(`!!document.querySelector('#pasta-adms [data-adms="selecionar"]')`);
  await clicar('#pasta-adms [data-adms="selecionar"]'); await pg.aguardar(`document.querySelector("#pasta-adms").dataset.conexao === "directory"`, 20000);
});
await teste("1. Central → Despacho: mesmo ?bd=, MESMO arquivo e MESMA autorização, sem abrir seletor", async () => {
  await clicar("#btn-despacho"); await espera(400);
  await pg.aguardar("location.pathname.endsWith('despacho.html') && document.body.dataset.pronto === '1' && !!window.DespachoUI.estado().dados", 20000);
  verdade((await js("location.search")).includes(bd), "mesmo banco");
  igual([await js("window.__nPasta"), await js("window.DespachoUI.estado().con.origem"), await js("window.DespachoUI.estado().arquivo.nome")], [0, "central", "chamadas_incidentes.csv"]);
});
await teste("Tela compacta: cabeçalho, data do arquivo no selo, sem faixas de texto; conferência com a fonte nos detalhes (ⓘ)", async () => {
  igual((await texto(".titulo h1")).trim(), "DESPACHO OTIMIZADO");
  verdade(/^\d{2}\/\d{2},? \d{2}:\d{2}$/.test(await texto("#dados-texto")), await texto("#dados-texto"));
  verdade(/Arquivo|gravou .* lido às \d{2}:\d{2}/.test(await js(`document.querySelector("#dados").title`)), await js(`document.querySelector("#dados").title`));
  igual(await js(`[!!document.querySelector(".sigode"), !!document.querySelector("#status-ind"), document.querySelector("#conferencia").classList.contains("oculto")]`), [false, false, true], "sem faixa SIGODE, sem botões de status, detalhes recolhidos");
  await clicar("#btn-detalhes"); igual(await js(`document.querySelector("#conferencia").classList.contains("oculto")`), false, "ⓘ abre os detalhes");
  verdade((await texto("#conferencia")).includes("confirmar o despacho no SIGODE"), "SIGODE nos detalhes");
  const c = await texto("#conferencia");
  verdade(c.includes("20 linha(s)") && c.includes("19 chamada(s) válida(s)") && c.includes("16 INC(s)") && c.includes("2 chamada(s) repetida(s)") && c.includes("1 chamada(s) sem INC") && c.includes("1 CALL repetida"), c);
  igual(await kpis(), { incs: 16, lotes: 9, nao_ident: 3, fase: 2 });
  await clicar("#btn-detalhes"); igual(await js(`document.querySelector("#conferencia").classList.contains("oculto")`), true, "ⓘ fecha os detalhes");
  await foto("desp-1-todos");
});
await teste("3/4/6. Polo Aracaju: só Aracaju, Barra e Socorro; lotes por município e bairro; não identificados por último", async () => {
  await escolher("#polo", "aracaju");
  igual(await kpis(), { incs: 12, lotes: 7, nao_ident: 2, fase: 2 });
  igual(await nomesLotes(), [
    ["ARACAJU", ["BAIRRO TESTE A=3 INCs", "BAIRRO TESTE B=2 INCs", "BAIRRO TESTE C=1 INC", "CENTRO=1 INC", "POV TESTE VERDE=1 INC", "LOCALIZAÇÃO NÃO IDENTIFICADA=2 INCs"]],
    ["BARRA DOS COQUEIROS", ["CENTRO=1 INC"]], ["NOSSA SENHORA DO SOCORRO", ["BAIRRO TESTE D=1 INC"]]]);
  igual(await js(`document.querySelector('#polo option[value="aracaju"]').title`), "Aracaju, Barra dos Coqueiros, Nossa Senhora do Socorro", "municípios do polo (dica da opção)");
  igual(await js(`[...document.querySelectorAll("#polo option")].map((o) => o.textContent)`), ["Todos os polos (16)", "Polo Aracaju (12)", "Polo São Cristóvão (0)", "Polo Itabaiana (1)",
    "Polo Lagarto (2)", "Polo Glória (0)", "Polo Propriá (0)", "Polo Maruim (0)"]);
  igual(await js("document.querySelectorAll('.lote.aberto').length"), 0, "nada expandido ao abrir");
  await foto("desp-2-polo-aracaju");
});
await teste("7. Sem coluna no arquivo: filtros de Alimentador e Circuito desativados e explicados (nada inventado)", async () => {
  igual(await js(`[document.querySelector("#f-alimentador").disabled, document.querySelector("#f-circuito").disabled, document.querySelector("#f-alimentador").options[0].textContent]`),
    [true, true, "Alimentador: sem dado"]);
});
await teste("Lote expande ao clicar; só UM aberto por vez; detalhes da INC com o texto original e 'consultar no SIGODE'", async () => {
  await clicar('.lote-cab[data-abrir="001|BAIRRO TESTE A"]');
  igual(await js(`[...document.querySelectorAll(".lote.aberto tr.inc .c-inc")].map((e) => e.textContent)`), ["INC 900000013", "INC 900000001", "INC 900000002"]);
  await clicar('.lote-cab[data-abrir="001|BAIRRO TESTE B"]');
  igual(await js(`[...document.querySelectorAll(".lote.aberto")].map((e) => e.dataset.lote)`), ["001|BAIRRO TESTE B"]);
  await clicar('[data-detalhe="INC 900000003"]');
  const d = await texto("tr.detalhe");
  verdade(d.includes("RUA TESTE TRES_7_BAIRRO TESTE B; 1_ARACAJU") && d.includes("possível") && d.includes("consultar no SIGODE"), d);
  await foto("desp-3-lote-aberto");
});
await teste("10. Copiar lote: só os números 'n1, n2, n3', sem duplicidade; lote marcado como copiado", async () => {
  await clicar('[data-copiar="001|BAIRRO TESTE A"]'); await espera(300);
  igual(await lerClip(), "900000013, 900000001, 900000002");
  verdade((await texto("#toast")).startsWith("3 INC(s) copiada(s)"), await texto("#toast"));
  await clicar('[data-copiar="001|BAIRRO TESTE C"]'); await espera(300);
  igual(await lerClip(), "900000007", "lote com um só incidente");
  verdade((await texto('[data-lote="001|BAIRRO TESTE A"] .copiado')).startsWith("copiado"), "selo copiado");
});
await teste("10b. Seleção manual (INCs de lotes diferentes + lote inteiro) e cópia só das selecionadas, sem duplicar", async () => {
  await clicar('[data-sel="INC 900000003"]'); await clicar('[data-sel-lote="001|BAIRRO TESTE B"]'); // 003 já marcada: o lote completa (003 + 006)
  igual(await texto("#sel-n"), "2");
  await clicar('[data-sel-lote="010|CENTRO"]');
  igual(await texto("#sel-n"), "3");
  await clicar("#sel-copiar"); await espera(300);
  igual(await lerClip(), "numos in (900000003, 900000006, 900000010)");
  await foto("desp-4-selecao");
  await clicar("#sel-limpar"); igual(await texto("#sel-n"), "0");
  igual(await js(`document.querySelector("#sel-copiar").disabled`), true, "sem seleção: botão desativado (validação mantida)");
});
await teste("10c. Copiar INC individual: só o número, sem mexer na seleção, no lote aberto nem na altura da linha", async () => {
  const sel = '[data-copiar-inc="INC 900000003"]';
  igual(await js(`document.querySelector(${JSON.stringify(sel)}).title`), "Copiar número do incidente", "tooltip");
  igual(await js(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); return b.previousSibling.textContent + "|" + b.closest("td").className + "|" + b.closest("td").nextElementSibling.className; })()`),
    "INC 900000003|c-inc|c-end", "entre o número e o endereço");
  const centro = await js(`(() => { const b = document.querySelector(${JSON.stringify(sel)}), td = b.closest("td"), r = document.createRange(); r.selectNodeContents(td.firstChild);
    const t = r.getBoundingClientRect(), c = b.getBoundingClientRect(); return Math.abs((t.top + t.bottom) / 2 - (c.top + c.bottom) / 2); })()`);
  verdade(centro <= 1.5, "alinhado ao centro do número (diferença " + centro + "px)");
  const alturas = await js(`(() => { const tr = document.querySelector(${JSON.stringify(sel)}).closest("tr"), b = tr.querySelector("[data-copiar-inc]"); const com = tr.getBoundingClientRect().height;
    b.style.display = "none"; const sem = tr.getBoundingClientRect().height; b.style.display = ""; return [com, sem]; })()`);
  verdade(alturas[0] <= alturas[1] + 0.5, "a linha não ficou mais alta: " + alturas.join(" vs "));
  const aberto = await js(`!!document.querySelector('[data-lote="001|BAIRRO TESTE B"].aberto')`);
  await clicar(sel); await espera(200);
  igual(await lerClip(), "900000003", "só o número da INC");
  igual(await texto("#sel-n"), "0", "seleção não mudou");
  igual(await js(`document.querySelector('[data-sel="INC 900000003"]').checked`), false, "checkbox não foi marcado");
  igual(await js(`!!document.querySelector('[data-lote="001|BAIRRO TESTE B"].aberto')`), aberto, "lote continua como estava");
  igual(await js(`document.querySelector(${JSON.stringify(sel)}).classList.contains("feito")`), true, "retorno visual (✓)");
  await foto("desp-4b-copiar-inc");
  await espera(1400);
  igual(await js(`document.querySelector(${JSON.stringify(sel)}).classList.contains("feito")`), false, "retorno visual some sozinho");
  // com a INC selecionada: copia do mesmo jeito e a seleção continua
  await clicar('[data-sel="INC 900000006"]'); igual(await texto("#sel-n"), "1");
  await clicar('[data-copiar-inc="INC 900000006"]'); await espera(200);
  igual(await lerClip(), "900000006", "INC selecionada");
  igual(await texto("#sel-n"), "1", "seleção mantida");
  await clicar("#sel-limpar");
});
await teste("Filtros: município + bairro + indicação + busca funcionam em conjunto com o polo", async () => {
  await escolher("#f-municipio", "001"); await escolher("#f-bairro", "BAIRRO TESTE B");
  igual((await kpis()).incs, 2);
  await escolher("#f-prioridade", "risco"); igual((await kpis()).incs, 1);
  await clicar("#f-limpar"); igual((await kpis()).incs, 12);
  await js(`(() => { const e = document.querySelector("#f-busca"); e.value = "900000012"; e.dispatchEvent(new Event("input")); return 1; })()`); await espera(400);
  igual((await kpis()).incs, 1); await clicar("#f-limpar");
});
await teste("2/7b. Atualizar: arquivo novo (com Alimentador e Circuito) é relido; filtros elétricos passam a funcionar em conjunto", async () => {
  await escrever(csvNavegador(AGORA, CHAMADAS, { eletrica: true }));
  const t = await lidoEm(); await clicar("#btn-atualizar"); await aguardarLeitura(t);
  igual(await js(`document.querySelector("#f-alimentador").disabled`), false);
  await escolher("#f-alimentador", "AL-T01"); igual((await kpis()).incs, 2);
  await escolher("#f-circuito", "C-12"); igual((await kpis()).incs, 1);
  verdade(!(await texto(".lote-cab")).includes("AL-T01"), "cabeçalho do lote sem alimentador");
  await clicar(".lote-cab[data-abrir]"); igual((await texto("tr.inc .c-alim")).trim(), "AL-T01", "alimentador na linha da INC");
  await foto("desp-5-alimentador");
  await clicar("#f-limpar");
});
await teste("2b. Conferência automática: arquivo sem mudança NÃO é relido; arquivo alterado é relido sozinho", async () => {
  const t = await lidoEm(); await js("window.DespachoUI.atualizar(false, false)"); await espera(300);
  igual(await lidoEm(), t, "sem mudança, sem releitura");
  await escrever(csvPasta(AGORA, [...CHAMADAS, { call: 30, inc: "900000050", loc: "RUA NOVA_1_BAIRRO TESTE A; 1_ARACAJU", min: 1 }]));
  await js("window.DespachoUI.atualizar(false, false)"); await aguardarLeitura(t);
  igual((await kpis()).incs, 13, "nova INC no polo");
});
await teste("Falha de leitura (arquivo removido): aviso e a ÚLTIMA leitura válida continua na tela", async () => {
  await opfs(`await d.removeEntry("chamadas_incidentes.csv"); return true;`);
  await js("window.DespachoUI.atualizar(true, false)"); await espera(300);
  verdade(/não foi encontrado/.test(await texto("#fonte")), await texto("#fonte"));
  igual((await kpis()).incs, 13, "dados mantidos");
  await escrever(csvPasta(AGORA)); const t = await lidoEm(); await clicar('[data-fonte="atualizar"]'); await aguardarLeitura(t);
  igual((await kpis()).incs, 12);
});
await teste("Seleção do polo e INCs copiadas lembradas no F5; autorização expirada pede só 'Autorizar leitura'", async () => {
  await js(`localStorage.setItem("__revogada", "1")`);
  await pg.ir(`${base}despacho.html?bd=${bd}`); await pg.aguardar("document.body.dataset.pronto === '1'", 20000);
  verdade((await texto("#fonte")).includes("Autorizar leitura"), await texto("#fonte"));
  await clicar('[data-fonte="autorizar"]'); await pg.aguardar("!!window.DespachoUI.estado().dados", 20000);
  igual([await js("document.querySelector('#polo').value"), (await kpis()).incs, await js("window.__nPasta")], ["aracaju", 12, 0]);
  verdade((await texto('[data-lote="001|BAIRRO TESTE A"] .copiado')).startsWith("copiado"), "copiado lembrado nesta aba");
});
await teste("Layout 1366x768 sem rolagem horizontal; nada sai do computador; sem erros de JavaScript", async () => {
  igual(await js("document.documentElement.scrollWidth <= innerWidth"), true);
  await pg.tamanho(1920, 1080); igual(await js("document.documentElement.scrollWidth <= innerWidth"), true); await pg.tamanho(1366, 768);
  const fora = rede.filter((u) => !u.startsWith("file:") && !u.startsWith("data:") && !u.startsWith("blob:"));
  igual(fora, [], "requisições externas");
  igual(pg.erros, [], "erros na página");
});
await teste("11. Volta para a Central (mesmo banco): Central abre normal e a pasta ADMS continua conectada", async () => {
  await clicar("#btn-central");
  await pg.aguardar("location.pathname.endsWith('index.html') && document.body.dataset.pronto === '1'", 20000);
  verdade((await js("location.search")).includes(bd));
  await pg.aguardar(`document.querySelector("#pasta-adms").dataset.conexao === "directory"`, 20000);
  igual(pg.erros, [], "erros na Central");
});

await nav.fechar();
const ok = resultados.filter(Boolean).length;
console.log(`\n${resultados.length} testes ponta a ponta (${versao}) · ${ok} aprovados · ${resultados.length - ok} com falha`);
process.exitCode = ok === resultados.length ? 0 : 1;
