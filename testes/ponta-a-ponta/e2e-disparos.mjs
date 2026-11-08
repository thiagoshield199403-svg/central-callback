/* Testes PONTA A PONTA da Central de Disparos. Navegador real -> gateway real -> API da Meta SIMULADA em 127.0.0.1.
   Dados 100% fictícios; nenhuma mensagem sai do computador. Uso: node testes\ponta-a-ponta\e2e-disparos.mjs [pasta-para-fotos] */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { abrirNavegador, espera } from "./cdp.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const fotos = process.argv[2] || null; if (fotos) mkdirSync(fotos, { recursive: true });
const resultados = [], TOKEN = "token-secreto-de-teste-e2e";
async function teste(nome, f) {
  try { await f(); resultados.push([true, nome]); console.log("OK    " + nome); }
  catch (e) { resultados.push([false, nome, e.message]); console.log("FALHA " + nome + " — " + e.message); }
}
const verdade = (c, m) => { if (!c) throw new Error(m || "condição falsa"); };
const igual = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || "esperado"}: ${JSON.stringify(b)}, obtido: ${JSON.stringify(a)}`); };

/* API da Meta simulada */
const meta = { recebidas: [], recusar: new Set(), limiteUmaVez: false, auth: [] };
const servidorMeta = createServer((req, res) => {
  let c = ""; req.on("data", (p) => (c += p)); req.on("end", () => {
    const d = JSON.parse(c); meta.auth.push(req.headers.authorization); res.setHeader("Content-Type", "application/json");
    if (meta.limiteUmaVez) { meta.limiteUmaVez = false; res.statusCode = 429; res.end(JSON.stringify({ error: { code: 130429, message: "rate" } })); return; }
    if (meta.recusar.has(d.to)) { res.statusCode = 400; res.end(JSON.stringify({ error: { code: 131026, message: "undeliverable" } })); return; }
    meta.recebidas.push({ ...d, caminho: req.url }); res.end(JSON.stringify({ messages: [{ id: "wamid.teste." + meta.recebidas.length }] }));
  });
});
await new Promise((ok) => servidorMeta.listen(0, "127.0.0.1", ok));
const portaMeta = servidorMeta.address().port;

const dados = mkdtempSync(join(tmpdir(), "central-gateway-"));
writeFileSync(join(dados, "modelos.json"), JSON.stringify({ manual_falta_energia: { template: "falta_energia_teste", idioma: "pt_BR", parametros: ["incidente"] } }));
function iniciarGateway(porta, extra) {
  return new Promise((ok, falha) => {
    const p = spawn(process.execPath, [join(raiz, "gateway", "servidor.mjs")], { env: { ...process.env, GATEWAY_PORTA: String(porta), GATEWAY_DADOS: join(dados, String(porta)), ...extra }, stdio: ["ignore", "pipe", "pipe"] });
    let saida = ""; p.stdout.on("data", (x) => { saida += x; if (saida.includes("modo:")) ok(Object.assign(p, { saida: () => saida })); });
    p.stderr.on("data", (x) => { saida += x; }); p.on("exit", (c) => falha(new Error("gateway saiu: " + saida + c)));
  });
}
const PORTA = 8900 + Math.floor(Math.random() * 90), BASE = `http://127.0.0.1:${PORTA}`, PORTA_SIM = PORTA + 100;
const AMB = { WHATSAPP_MODO: "producao", WHATSAPP_TOKEN: TOKEN, WHATSAPP_PHONE_NUMBER_ID: "12345", WHATSAPP_API_VERSAO: "v0", WHATSAPP_API_BASE: `http://127.0.0.1:${portaMeta}`, WHATSAPP_MODELOS: join(dados, "modelos.json") };
let gateway = await iniciarGateway(PORTA, AMB);
const gatewaySim = await iniciarGateway(PORTA_SIM, { WHATSAPP_MODO: "simulacao" });
const nav = await abrirNavegador({});
const pg = await nav.novaPagina(`${BASE}/?bd=e2ed${Date.now().toString(36)}`);
const js = (e) => pg.js(e);
const clicar = (s) => js(`(() => { const e = document.querySelector(${JSON.stringify(s)}); if (!e) throw new Error("não achei ${s.replace(/"/g, "'")}"); e.click(); return true; })()`);
const texto = (s) => js(`(document.querySelector(${JSON.stringify(s)}) || {}).textContent || ""`);
const visivel = (s) => js(`(() => { const e = document.querySelector(${JSON.stringify(s)}); return !!e && e.offsetParent !== null; })()`);
const foto = async (n) => { if (fotos) await pg.foto(join(fotos, n + ".png")); };
const srvJs = "window.CentralUI.servico";
const filaJs = `${srvJs}.filaDoLote()`;
const cartoes = () => js(`[...document.querySelectorAll(".painel-disparo .metrica")].map((m) => [m.querySelector(".rotulo").textContent, m.querySelector(".valor").textContent])`);
const aguardarFim = (estado = "concluida") => pg.aguardar(`${filaJs}.situacao === "${estado}" && !${filaJs}.executor`, 60000);
const post = (corpo, cab = {}) => fetch(`${BASE}/api/disparo/enviar`, { method: "POST", headers: { "Content-Type": "application/json", ...cab }, body: JSON.stringify(corpo) });

await pg.aguardar("document.body.dataset.pronto === '1'");
await js(`(window.__links = [], window.open = () => { const j = { closed: false, opener: 1, close() {} }; Object.defineProperty(j, "location", { value: { set href(u) { window.__links.push(u); } } }); return j; }, true)`);

await teste("Turno e importação funcionam pelo endereço do gateway; Central de disparos aparece com as 3 opções", async () => {
  await js(`(() => { const f = document.querySelector("#form-dia"); f.operador.value = "tsa4"; f.polo.value = "Aracaju"; f.requestSubmit(); return true; })()`);
  await pg.aguardar("!!document.querySelector('#importar').offsetParent");
  const doc = await pg.cmd("DOM.getDocument", {}), { nodeId } = await pg.cmd("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "#arquivo" });
  await pg.cmd("DOM.setFileInputFiles", { nodeId, files: [join(raiz, "exemplos", "navegador-chamadas-ADMS2026-FICTICIO.csv")] });
  await pg.aguardar("!!document.querySelector('#btn-confirmar-import')"); await clicar("#btn-confirmar-import");
  await pg.aguardar("document.querySelectorAll('#linhas tr[data-id]').length > 0");
  igual(await js(`[...document.querySelectorAll(".modo-card b")].map((b) => b.textContent)`), ["Envio individual", "Envio em lote", "CALLBACK MANUAL"]);
  verdade(await visivel("#linhas"), "modo individual é o padrão e mostra a lista");
  await foto("d1-modo-individual");
});
await teste("Modo 1 (individual) continua igual: abre o WhatsApp Web e não passa pela API", async () => {
  const id = await js(`${srvJs}.incidentesParaDisparo().find((x) => x.tem_celular && x.elegivel).id`);
  await clicar(`[data-abrir-linha="${id}"]`); await pg.aguardar("!!document.querySelector('[data-wa]')");
  await clicar("[data-wa]"); await pg.aguardar("window.__links.length === 1 || !!document.querySelector('#m-sim')");
  if (!(await js("window.__links.length"))) { await clicar("#m-sim"); await pg.aguardar("window.__links.length === 1"); }
  verdade((await js("window.__links[0]")).startsWith("https://web.whatsapp.com/send?phone=55"), "link");
  igual(meta.recebidas.length, 0, "não pode chamar a API"); await clicar("#p-fechar");
});
let lista;
await teste("Opção 3: abre a tela CALLBACK WHATSAPP existente; as opções 1 e 2 continuam e a seleção à parte saiu", async () => {
  igual(await js(`[...document.querySelectorAll("#disparos-abas .modo-card b")].map((b) => b.textContent)`), ["Envio individual", "Envio em lote", "CALLBACK MANUAL"]);
  verdade((await texto('[data-modo="manual"]')).includes("informar manualmente o incidente, telefone e escolher a mensagem"), "descrição");
  igual(await js("document.querySelectorAll('#callback-manual').length"), 1, "uma única ferramenta");
  await clicar('[data-modo="manual"]'); await pg.aguardar("!!document.querySelector('#cm-enviar').offsetParent"); verdade(!(await visivel("#central-disparos")), "abre direto a tela manual");
  await clicar("#btn-manual"); await pg.aguardar("!!document.querySelector('#central-disparos').offsetParent"); verdade(!(await js("!!document.querySelector('#ds-linhas')")), "sem tela de seleção");
  lista = await js(`${srvJs}.incidentesParaDisparo()`);
});
const prontos = () => lista.filter((x) => x.elegivel && x.tem_celular);
await teste("Conferência: prepara os incidentes pedidos e mostra as colunas previstas; o botão acompanha o gateway sem recarregar a página", async () => {
  const al = prontos().slice(0, 2);
  verdade(al.length === 2, "o CSV de exemplo precisa de 2 incidentes com celular");
  await js(`${srvJs}.prepararDisparo(${JSON.stringify(al.map((x) => x.chave))}, "selecao").then(() => window.CentralUI.recarregar()).then(() => true)`);
  await clicar('[data-modo="lote"]'); await pg.aguardar("!!document.querySelector('.btn-autorizar')");
  igual(await js(`[...document.querySelectorAll("#disparos-conteudo .tabela-disparos th")].map((t) => t.textContent)`), ["", "Incidente", "Tipo de ocorrência", "Destinatário", "Telefone", "Mensagem", ""]);
  igual(await js("document.querySelectorAll('tr[data-item]').length"), 2);
  igual(meta.recebidas.length, 0, "preparar não envia");
  verdade(!(await js("document.querySelector('.btn-autorizar').disabled")), "habilitado com gateway e mensagens prontas");
  await js(`(window.__fetch = window.fetch, window.fetch = (u, o) => (String(u).includes("/api/disparo/status") ? Promise.reject(new Error("fora")) : window.__fetch(u, o)), window.CentralDisparos.verificarConector().then(() => true))`);
  verdade(await js("document.querySelector('.btn-autorizar').disabled"), "gateway fora: desabilitado");
  await js("(window.fetch = window.__fetch, true)"); await pg.aguardar("!document.querySelector('.btn-autorizar').disabled", 8000);
  await foto("d3-revisao");
});
await teste("Revisão: ver e editar a mensagem (só desta fila), telefone inválido é identificado e corrigido", async () => {
  const antes = await js("JSON.stringify(window.MODELOS_MENSAGEM)");
  await clicar("tr[data-item] [data-ver]"); await pg.aguardar("!!document.querySelector('#dm-texto')");
  await js(`(document.querySelector("#dm-texto").value = "Mensagem revisada pelo operador para o teste.", true)`); await clicar("#dm-salvar");
  await pg.aguardar(`${filaJs}.itens[0].editada === true && document.querySelector("#modal").classList.contains("oculto")`);
  igual(await js("JSON.stringify(window.MODELOS_MENSAGEM)"), antes, "modelo original intacto");
  const orig = await js(`document.querySelector("tr[data-item] [data-tel]").value`);
  await js(`(() => { const e = document.querySelector("tr[data-item] [data-tel]"); e.value = "7932001234"; e.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
  await pg.aguardar("document.querySelector('#toast').textContent.includes('FIXO')");
  igual(await js(`${filaJs}.itens[0].status`), "preparado", "valor recusado não entra");
  igual(await js(`document.querySelector("tr[data-item] [data-tel]").value`), orig, "tela volta ao telefone válido");
});
await teste("AUTORIZAR DISPARO: um clique, sem confirmar contato a contato; cada um recebe a sua mensagem; o token não aparece", async () => {
  const f = await js(filaJs);
  await clicar(".btn-autorizar"); await aguardarFim();
  verdade(await js("document.querySelector('#modal').classList.contains('oculto')"), "sem janela de confirmação");
  igual(meta.recebidas.length, 2, "uma mensagem por incidente");
  const mt = await js(filaJs);
  for (const i of mt.itens) { const m = meta.recebidas.find((x) => x.to === "55" + i.telefone); verdade(m, "destinatário " + i.telefone);
    if (i.editada) { igual([m.type, m.text.body], ["text", i.texto], "texto editado nunca vira modelo"); }
    else if (i.modelo === "manual_falta_energia") { igual([m.type, m.template.name, m.template.components[0].parameters[0].text], ["template", "falta_energia_teste", i.incidente || i.call_id]); }
    else igual([m.type, m.text.body], ["text", i.texto]); }
  verdade(meta.auth.every((a) => a === "Bearer " + TOKEN), "gateway autentica");
  verdade(meta.recebidas[0].caminho === "/v0/12345/messages", "URL oficial");
  igual(await cartoes(), [["total selecionado", "2"], ["total preparado", "2"], ["total enviado", "2"], ["total pendente", "0"], ["total com falha", "0"], ["concluído", "100%"]]);
  const pag = await (await fetch(BASE + "/")).text(), est = await (await fetch(BASE + "/api/disparo/status")).text();
  const armazenado = await js(`JSON.stringify(${srvJs}.E)`);
  verdade(![pag, est, armazenado].some((x) => x.includes(TOKEN)), "token exposto");
  verdade(f.itens.length === 2);
  const m = await js(`${srvJs}.metricasTempoReal()`); igual(m.callbacks_realizados, 2, "cada mensagem enviada conta como callback");
  igual(await js(`document.querySelector("#metricas .metrica.destaque .valor").firstChild.textContent.trim()`), "2", "faixa de indicadores");
  const t0 = await js(`${srvJs}.painel().turnos[0]`); igual([t0.operador, t0.callbacks_realizados], ["TSA4", 2], "total do operador");
  igual(await js(`[...document.querySelectorAll("#disparos-conteudo .tabela-disparos tbody tr")].every((l) => l.textContent.includes("Enviado") && l.textContent.includes("Realizado") && l.textContent.includes("TSA4"))`), true, "envio e callback em colunas separadas");
  await foto("d4-acompanhamento");
});
await teste("Sem duplicar: incidente enviado não pode ser preparado de novo", async () => {
  await clicar("[data-acao='nova']"); await pg.aguardar("!!document.querySelector('[data-acao=preparar-lote]')");
  lista = await js(`${srvJs}.incidentesParaDisparo()`);
  const env = lista.filter((x) => x.status === "enviado"); igual(env.length, 2); verdade(env.every((x) => !x.elegivel), "inelegíveis");
  verdade((await js(`${srvJs}.prepararDisparo([${JSON.stringify(env[0].chave)}], "lote").then(() => "", (e) => e.message)`)).includes("Nenhum incidente"), "recusa");
});
await teste("Contato principal: os demais continuam pendentes e o envio individual do painel segue disponível, sem passar pela API", async () => {
  const f = (await js(`${srvJs}.historicoDisparos()`))[0], i = f.itens.find((x) => x.comunicacoes > 1); verdade(i, "fila com incidente de várias comunicações");
  const grupo = await js(`(() => { const g = ${srvJs}.grupoDaChamada(${i.chamada_id}); return { principal: g.principal.id, membros: g.membros }; })()`);
  igual(grupo.principal, i.chamada_id, "só o principal");
  const outro = grupo.membros.find((m) => m.id !== i.chamada_id && m.telefones.some((x) => x.tipo === "celular")); verdade(outro, "outro contato com celular"); igual(outro.estado, "pendente");
  const antes = meta.recebidas.length, links = await js("window.__links.length");
  await clicar('[data-modo="individual"]'); await clicar(`tr[data-id="${i.chamada_id}"]`); await pg.aguardar(`!!document.querySelector('[data-abrir="${outro.id}"]')`);
  await clicar(`[data-abrir="${outro.id}"]`); await pg.aguardar("!!document.querySelector('[data-wa]')"); await foto("d9-outro-contato");
  await clicar("[data-wa]"); await pg.aguardar(`window.__links.length === ${links + 1} || !!document.querySelector('#modal:not(.oculto) #m-sim')`);
  if ((await js("window.__links.length")) === links) { await clicar("#m-sim"); await pg.aguardar(`window.__links.length === ${links + 1}`); }
  igual(meta.recebidas.length, antes, "não passa pela API"); igual(await js(`${srvJs}.obterChamada(${outro.id}).estado`), "pendente", "abrir o WhatsApp não é callback");
  await clicar("#p-fechar");
});
await teste("Modo 2 (lote): prepara todos os elegíveis; limite da API pausa; falha definitiva é registrada; retomar conclui sem duplicar", async () => {
  await clicar('[data-modo="lote"]'); await pg.aguardar("!!document.querySelector('[data-acao=preparar-lote]')");
  await foto("d5-modo-lote");
  await clicar("[data-acao='preparar-lote']"); await pg.aguardar("!!document.querySelector('.btn-autorizar')");
  let f = await js(filaJs); const env = f.itens.filter((i) => i.status === "preparado");
  igual(f.modo, "lote"); verdade(env.length >= 2, `exemplo precisa de 2+ enviáveis, tem ${env.length}`);
  const antes = meta.recebidas.length; meta.recusar.add("55" + env[0].telefone); meta.limiteUmaVez = true;
  await clicar(".btn-autorizar"); await aguardarFim("pausada");
  igual(meta.recebidas.length, antes, "limite: nada aceito"); verdade((await js(`${filaJs}.eventos.some((e) => e.tipo === "pausa_limite")`)), "evento");
  await pg.aguardar("!!document.querySelector('[data-acao=retomar]')"); await foto("d6-pausada"); await clicar("[data-acao='retomar']"); await aguardarFim();
  f = await js(filaJs);
  igual(f.itens.find((i) => i.id === env[0].id).status, "falha", "recusada pela API"); verdade(f.itens.find((i) => i.id === env[0].id).erro.includes("não pode receber"), "motivo traduzido");
  igual(meta.recebidas.length - antes, env.length - 1, "demais enviadas uma vez");
  const dest = meta.recebidas.slice(antes).map((m) => m.to); igual(new Set(dest).size, dest.length, "sem duplicar");
  meta.recusar.clear();
  await pg.aguardar("!!document.querySelector('[data-acao=reprocessar]')"); await clicar("[data-acao='reprocessar']"); await pg.aguardar(`${filaJs}.itens.every((i) => i.status !== "falha") && ${filaJs}.situacao === "concluida" && !${filaJs}.executor`, 60000);
  igual(meta.recebidas.length - antes, env.length, "falha reenviada só depois da nova autorização");
  igual((await js(`${srvJs}.metricasTempoReal()`)).callbacks_realizados, 2 + env.length, "callback só das enviadas, uma vez cada");
  await foto("d7-concluida");
});
await teste("Histórico: registra cada tentativa com data, hora e resultado; não expõe o telefone completo depois do lote", async () => {
  await clicar("#btn-historico-disparos"); await pg.aguardar("!!document.querySelector('#dh-csv')");
  const h = await js(`document.querySelector("#modal-caixa").innerText`); verdade(h.includes("Histórico de execução"), "título");
  igual(await js("document.querySelectorAll('.fila-historico').length"), 2);
  await foto("d8-historico"); await clicar("#dh-fechar");
  const csv = await js(`${srvJs}.csvAuditoriaDisparos()`); verdade(csv.includes(";enviado;") && !/\b55\d{11}\b/.test(csv), "csv");
});
await teste("Gateway: mesma chave nunca envia duas vezes, mesmo depois de reiniciar", async () => {
  const c = { chave: "a".repeat(32), telefone: "79991112222", texto: "Teste", modelo: "manual_atualizacao", incidente: "INC 1", editada: false }, ori = { Origin: BASE }, antes = meta.recebidas.length;
  const a = await (await post(c, ori)).json(), b = await (await post(c, ori)).json();
  igual([a.resultado, b.resultado, b.reaproveitado, a.wamid === b.wamid], ["enviado", "enviado", true, true]);
  const par = await Promise.all([post({ ...c, chave: "b".repeat(32) }, ori), post({ ...c, chave: "b".repeat(32) }, ori)]);
  await Promise.all(par.map((r) => r.json())); igual(meta.recebidas.length - antes, 2, "uma para cada chave, inclusive em paralelo");
  gateway.removeAllListeners("exit"); gateway.kill(); await espera(300); gateway = await iniciarGateway(PORTA, AMB);
  const d = await (await post(c, ori)).json(); igual([d.resultado, d.reaproveitado], ["enviado", true]); igual(meta.recebidas.length - antes, 2, "registro sobreviveu ao reinício");
});
await teste("Gateway: recusa outro site, Host estranho, dados inválidos e não serve arquivos internos", async () => {
  const ok = { chave: "c".repeat(32), telefone: "79991113333", texto: "Teste", modelo: "m", incidente: "INC 2" }, antes = meta.recebidas.length;
  igual((await post(ok, { Origin: "https://site-malicioso.example" })).status, 403); igual((await post(ok)).status, 403, "sem Origin");
  igual((await fetch(`${BASE}/api/disparo/enviar`, { method: "POST", headers: { "Content-Type": "text/plain", Origin: BASE }, body: JSON.stringify(ok) })).status, 415);
  igual((await post({ ...ok, telefone: "7932001234" }, { Origin: BASE })).status, 422, "fixo");
  igual((await post({ ...ok, texto: "x".repeat(1501) }, { Origin: BASE })).status, 422, "texto grande");
  igual(meta.recebidas.length, antes, "nada enviado");
  for (const c of ["/gateway/servidor.mjs", "/gateway/.env", "/docs/ALTERACOES-1.1.0.txt", "/js/../gateway/servidor.mjs", "/..%2fgateway%2fservidor.mjs"]) igual((await fetch(BASE + c)).status, 404, c);
  const http = await import("node:http");
  const st = await new Promise((ok2) => http.get({ host: "127.0.0.1", port: PORTA, path: "/", agent: false, headers: { Host: "evil.example" } }, (r) => { r.resume(); ok2(r.statusCode); }));
  igual(st, 403, "DNS rebinding");
});
await teste("Sem rolagem horizontal da página (1366, 1024 e celular) e console sem erros", async () => {
  await clicar('[data-modo="lote"]');
  for (const [l, a] of [[1366, 768], [1024, 768], [390, 844]]) { await pg.tamanho(l, a); verdade(await js("document.documentElement.scrollWidth <= innerWidth"), `rolagem horizontal em ${l}`); }
  await pg.tamanho(1366, 768); igual(pg.erros, []);
});
await teste("Modo simulação: faixa evidente e a API real não é chamada", async () => {
  const p2 = await nav.novaPagina(`http://127.0.0.1:${PORTA_SIM}/?bd=e2es${Date.now().toString(36)}`), antes = meta.recebidas.length;
  await p2.aguardar("document.body.dataset.pronto === '1'");
  igual(await p2.js("window.CentralUI.servico.E.disparos.length"), 0);
  igual((await (await fetch(`http://127.0.0.1:${PORTA_SIM}/api/disparo/status`)).json()).modo, "simulacao");
  verdade(gatewaySim.saida().includes("SIMULAÇÃO"), "aviso no console");
  igual(meta.recebidas.length, antes);
});
await teste("Aberta por file://: individual funciona, disparo fica indisponível e a rede continua bloqueada", async () => {
  const p3 = await nav.novaPagina(pathToFileURL(join(raiz, "index.html")).href + `?bd=e2ef${Date.now().toString(36)}`);
  await p3.aguardar("document.body.dataset.pronto === '1'");
  const st = await p3.js("new window.Disparos.ConectorGateway().status()"); igual([st.pronto, st.modo], [false, "indisponivel"]);
  const bloqueado = await p3.js(`fetch("${BASE}/api/disparo/status").then(() => false, () => true)`); verdade(bloqueado, "CSP deve bloquear rede em file://");
});

await nav.fechar(); gateway.removeAllListeners("exit"); gatewaySim.removeAllListeners("exit"); gateway.kill(); gatewaySim.kill(); servidorMeta.close();
const falhas = resultados.filter((r) => !r[0]);
console.log(`\n${resultados.length} testes de disparos · ${resultados.length - falhas.length} aprovados · ${falhas.length} com falha`);
process.exitCode = falhas.length ? 1 : 0;
setTimeout(() => process.exit(), 300).unref();
