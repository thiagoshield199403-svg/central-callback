/* Testes PONTA A PONTA da Central de Disparos. Navegador real e gateway real; o WhatsApp Web nunca é aberto de verdade e a API não é usada.
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
const nav = await abrirNavegador({ exe: process.argv[3] });
const pgUrl = `${BASE}/?bd=e2ed${Date.now().toString(36)}`, pg = await nav.novaPagina(pgUrl);
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
const stubAbrir = `(window.__links = window.__links || [], window.open = () => { const j = { closed: false, opener: 1, close() {}, focus() {} }; Object.defineProperty(j, "location", { value: { set href(u) { window.__links.push(u); } } }); return j; }, true)`;
await js(stubAbrir);

await teste("Turno e importação funcionam pelo endereço do gateway; Central de disparos aparece com as 3 opções", async () => {
  await js(`(() => { const f = document.querySelector("#form-dia"); f.operador.value = "opt4"; f.polo.value = "Aracaju"; f.requestSubmit(); return true; })()`);
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
const sair = () => js(`(window.dispatchEvent(new Event("blur")), true)`);
const voltar = () => js(`(document.hasFocus = () => true, window.dispatchEvent(new Event("focus")), document.dispatchEvent(new Event("visibilitychange")), window.dispatchEvent(new Event("focus")), true)`);
const incidenteAtual = () => texto("#at-incidente"), rot = (i) => i.incidente || i.call_id, chaveDe = (i) => lista.find((x) => x.id === i.chamada_id).chave;
const metr = () => js(`${srvJs}.metricasTempoReal().callbacks_realizados`);
let filaGuiada;
await teste("Lote: seleção com busca, marcar e desmarcar; INICIAR só com incidentes marcados", async () => {
  await clicar('[data-modo="lote"]'); await pg.aguardar("!!document.querySelector('#ds-linhas tr[data-chave]')"); verdade(!(await visivel("#linhas")), "lista individual oculta");
  lista = await js(`${srvJs}.incidentesParaDisparo()`); const el = lista.filter((x) => x.elegivel);
  await clicar("[data-acao='marcar-todos']"); verdade((await texto("#ds-contagem")).startsWith(`${el.length} incidente`), "marcou todos");
  await clicar("[data-acao='desmarcar-todos']"); verdade(await js("document.querySelector('#ds-iniciar').disabled"), "iniciar desabilitado sem seleção");
  await js(`(() => { const e = document.querySelector("#ds-busca"); e.value = ${JSON.stringify(el[0].incidente)}; e.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`); igual(await js("document.querySelectorAll('#ds-linhas tr[data-chave]').length"), 1, "pesquisa");
  await js(`(() => { const e = document.querySelector("#ds-busca"); e.value = ""; e.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`); await foto("d2-selecao-lote");
});
await teste("INICIAR ATENDIMENTO: primeiro incidente em destaque com telefone, cliente, número e mensagem; nada é enviado", async () => {
  const al = [...prontos().filter((x) => x.qtd > 1).slice(0, 1), ...prontos().filter((x) => x.qtd === 1).slice(0, 2)]; igual(al.length, 3, "exemplo precisa de 3 incidentes");
  for (const x of al) await js(`document.querySelector('tr[data-chave="${x.chave}"]').click()`);
  await clicar("#ds-iniciar"); await pg.aguardar("!!document.querySelector('#at-incidente')"); filaGuiada = await js(filaJs);
  igual([filaGuiada.situacao, filaGuiada.assistido, filaGuiada.itens.length], ["atendimento", true, 3]); const i = filaGuiada.itens[0];
  igual(await incidenteAtual(), rot(i)); verdade((await js(`document.querySelector("#at-telefone").value`)).replace(/\D/g, "") === i.telefone, "telefone"); igual(await texto("#at-mensagem"), i.texto); verdade((await texto("#at-cliente")).length > 1, "cliente");
  igual(await js(`[...document.querySelectorAll(".painel-disparo .rotulo")].map((r) => r.textContent)`), ["na fila", "atendidos", "restantes", "pulados", "não confirmados", "concluído"]);
  igual([await metr(), meta.recebidas.length], [0, 0]); await foto("d3-atendimento"); await pg.tamanho(390, 844); verdade(await js("document.documentElement.scrollWidth <= innerWidth"), "celular"); await pg.tamanho(1366, 768);
});
await teste("Foco: não avança sem abrir o WhatsApp; abrir não conta; retorno com vários eventos avança uma vez e fica ENVIO NÃO CONFIRMADO", async () => {
  const [a, b] = filaGuiada.itens; await js("(document.hasFocus = () => true, true)");
  await sair(); await voltar(); await espera(700); igual(await incidenteAtual(), rot(a), "sem abrir não avança");
  const n = await js("window.__links.length"); await clicar("[data-acao='at-abrir']"); await pg.aguardar(`window.__links.length === ${n + 1}`); await pg.aguardar(`${filaJs}.itens[0].status === "aberto"`);
  verdade((await js(`window.__links[${n}]`)).startsWith(`https://web.whatsapp.com/send?phone=55${a.telefone}&text=`), "link do WhatsApp Web"); igual([await metr(), meta.recebidas.length], [0, 0], "abrir não conta");
  await voltar(); await espera(700); igual(await incidenteAtual(), rot(a), "sem sair da janela não avança");
  await sair(); await voltar(); await voltar(); await pg.aguardar(`document.querySelector("#at-incidente").textContent === ${JSON.stringify(rot(b))}`); await espera(800);
  igual([await incidenteAtual(), await js(`${filaJs}.itens[0].status`), await metr(), await js(`${filaJs}.eventos.filter((e) => e.tipo === "retorno").length`)], [rot(b), "nao_confirmado", 0, 1], "avançou uma vez e não contou");
  verdade((await texto(".atend-confirmar")).includes("ENVIO NÃO CONFIRMADO"), "lista de confirmação");
});
await teste("Pular identifica o incidente; pausar bloqueia e persiste ao recarregar; retomar; recarregar com WhatsApp aberto não perde progresso", async () => {
  const [, b, c] = filaGuiada.itens; await clicar("[data-acao='at-pular']"); await pg.aguardar(`document.querySelector("#at-incidente").textContent === ${JSON.stringify(rot(c))}`); verdade((await texto(".atend-pulados")).includes(rot(b)), "pulado visível");
  await clicar("[data-acao='at-pausar']"); await pg.aguardar("!!document.querySelector('[data-acao=at-retomar]')"); verdade(await js("document.querySelector('[data-acao=at-abrir]').disabled"), "pausado não abre"); await foto("d4-pausado");
  const reabrir = async () => { await pg.ir(pgUrl); await pg.aguardar("document.body.dataset.pronto === '1'"); await js(stubAbrir); await clicar('[data-modo="lote"]'); };
  await reabrir(); await pg.aguardar("!!document.querySelector('[data-acao=at-retomar]')"); igual([await incidenteAtual(), await js(`${filaJs}.situacao`)], [rot(c), "pausada"], "persistiu");
  await clicar("[data-acao='at-retomar']"); await pg.aguardar("!document.querySelector('[data-acao=at-abrir]').disabled"); await clicar("[data-acao='at-abrir']"); await pg.aguardar(`${filaJs}.itens[2].status === "aberto"`);
  await reabrir(); await pg.aguardar(`${filaJs}.itens[2].status === "nao_confirmado" && ${filaJs}.situacao === "concluida"`); igual(await metr(), 0, "recarregar não conta"); await pg.aguardar("!!document.querySelector('[data-confirmar]')"); await foto("d5-conclusao");
});
await teste("Confirmação: Enviei conta um callback do operador, sem duplicar; Não enviei não conta; incidente confirmado não volta à seleção", async () => {
  const [a, , c] = filaGuiada.itens, conf = (it, r) => clicar(`tr[data-confirma-item="${it.id}"] [data-confirmar="${r}"]`);
  await conf(a, "enviado"); await pg.aguardar(`${filaJs}.itens[0].status === "enviado"`); await pg.aguardar(`!document.querySelector('tr[data-confirma-item="${a.id}"]')`); igual(await metr(), 1);
  const t0 = await js(`${srvJs}.painel().turnos[0]`); igual([t0.operador, t0.callbacks_realizados], ["OPT4", 1], "total do operador"); igual(await js(`document.querySelector("#metricas .metrica.destaque .valor").firstChild.textContent.trim()`), "1", "faixa de indicadores");
  await conf(c, "falha"); await pg.aguardar(`${filaJs}.itens[2].status === "falha"`); igual(await metr(), 1, "não enviei não conta"); igual(await js(`${srvJs}.E.historico_atendimento.length`), 1, "um registro");
  await pg.aguardar("!!document.querySelector('#ds-linhas tr[data-chave]')"); verdade(await js(`document.querySelector('tr[data-chave="${chaveDe(a)}"] input').disabled`), "confirmado bloqueado"); await js(`document.querySelector('tr[data-chave="${chaveDe(a)}"]').click()`); verdade((await texto("#ds-contagem")).startsWith("0 "), "não seleciona");
  verdade(!(await js(`document.querySelector('tr[data-chave="${chaveDe(c)}"] input').disabled`)), "não enviei volta a poder");
});
await teste("Cancelar: o restante sai da fila, o aberto fica não confirmado; encerrar o lote é recusado durante o atendimento", async () => {
  lista = await js(`${srvJs}.incidentesParaDisparo()`); const al = prontos().slice(0, 2); for (const x of al) await js(`document.querySelector('tr[data-chave="${x.chave}"]').click()`);
  await clicar("#ds-iniciar"); await pg.aguardar("!!document.querySelector('#at-incidente')"); await clicar("[data-acao='at-abrir']"); await pg.aguardar(`${filaJs}.itens[0].status === "aberto"`);
  verdade((await js(`${srvJs}.encerrarLote().then(() => "", (e) => e.message)`)).includes("em andamento"), "encerrar recusado");
  await clicar("[data-acao='at-cancelar']"); await pg.aguardar("!!document.querySelector('#m-sim')"); await clicar("#m-sim"); await pg.aguardar(`${filaJs}.situacao === "cancelada"`);
  igual(await js(`${filaJs}.itens.map((i) => i.status)`), ["nao_confirmado", "cancelado"]); igual(await metr(), 1, "cancelar não conta"); await js(`(() => { document.querySelector('[data-confirmar="falha"]').click(); return true; })()`); await pg.aguardar(`${filaJs}.itens[0].status === "falha"`);
  await clicar("[data-acao='nova']");
});
await teste("Foco real: nova aba aberta de verdade e volta à aba da Central apresentam o próximo incidente", async () => {
  const p = await nav.novaPagina(`${BASE}/?bd=e2er${Date.now().toString(36)}`, { largura: 1366, altura: 768 }), pjs = (e) => p.js(e), cl = (s) => pjs(`(() => { document.querySelector(${JSON.stringify(s)}).click(); return true; })()`);
  await p.aguardar("document.body.dataset.pronto === '1'"); await pjs(`(() => { const f = document.querySelector("#form-dia"); f.operador.value = "opt4"; f.polo.value = "Aracaju"; f.requestSubmit(); return true; })()`); await p.aguardar("!!document.querySelector('#importar').offsetParent");
  const doc = await p.cmd("DOM.getDocument", {}), { nodeId } = await p.cmd("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "#arquivo" }); await p.cmd("DOM.setFileInputFiles", { nodeId, files: [join(raiz, "exemplos", "navegador-chamadas-ADMS2026-FICTICIO.csv")] }); await p.aguardar("!!document.querySelector('#btn-confirmar-import')"); await cl("#btn-confirmar-import"); await p.aguardar("document.querySelectorAll('#linhas tr[data-id]').length > 0");
  await pjs(`(window.Nucleo.linkWhatsappWeb = () => "about:blank#teste-sem-whatsapp", true)`); const srv = "window.CentralUI.servico", ch = await pjs(`${srv}.incidentesParaDisparo().filter((x) => x.elegivel && x.tem_celular).slice(0, 2).map((x) => x.chave)`);
  await pjs(`${srv}.iniciarAtendimento(${JSON.stringify(ch)}).then(() => window.CentralUI.recarregar()).then(() => true)`); await cl('[data-modo="lote"]'); await p.aguardar("!!document.querySelector('[data-acao=at-abrir]')");
  await nav.enviar("Target.activateTarget", { targetId: p.targetId }); await espera(300);
  const primeiro = await pjs(`document.querySelector("#at-incidente").textContent`), caixa = await pjs(`(() => { const r = document.querySelector("[data-acao=at-abrir]").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  for (const type of ["mousePressed", "mouseReleased"]) await p.cmd("Input.dispatchMouseEvent", { type, x: caixa.x, y: caixa.y, button: "left", clickCount: 1 });
  await p.aguardar(`window.CentralUI.servico.filaDoLote().itens[0].status === "aberto"`); await espera(800);
  const nova = (await nav.enviar("Target.getTargets")).targetInfos.find((t) => t.type === "page" && t.url.includes("teste-sem-whatsapp")); verdade(nova, "a aba nova abriu"); await espera(300);
  const estado = await pjs(`({ foco: document.hasFocus(), oculta: document.hidden })`); verdade(!estado.foco || estado.oculta, "a Central perdeu o foco: " + JSON.stringify(estado));
  igual(await pjs(`document.querySelector("#at-incidente").textContent`), primeiro, "continua no mesmo enquanto está fora");
  await nav.enviar("Target.activateTarget", { targetId: p.targetId }); await p.aguardar(`document.querySelector("#at-incidente").textContent !== ${JSON.stringify(primeiro)}`, 6000);
  igual(await pjs(`window.CentralUI.servico.filaDoLote().itens[0].status`), "nao_confirmado"); igual(await pjs(`window.CentralUI.servico.metricasTempoReal().callbacks_realizados`), 0); await nav.enviar("Target.closeTarget", { targetId: nova.targetId });
});
await teste("Contato principal: os demais continuam pendentes e o envio individual do painel segue disponível, sem passar pela API", async () => {
  const f = (await js(`${srvJs}.historicoDisparos()`)).find((x) => x.itens.some((y) => y.comunicacoes > 1)), i = f.itens.find((x) => x.comunicacoes > 1); verdade(i, "fila com incidente de várias comunicações");
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
await teste("Histórico: registra cada tentativa com data, hora e resultado; não expõe o telefone completo depois do lote", async () => {
  await clicar("#btn-historico-disparos"); await pg.aguardar("!!document.querySelector('#dh-csv')");
  const h = await js(`document.querySelector("#modal-caixa").innerText`); verdade(h.includes("Histórico de execução"), "título");
  igual(await js("document.querySelectorAll('.fila-historico').length"), 2);
  await foto("d8-historico"); await clicar("#dh-fechar");
  const csv = await js(`${srvJs}.csvAuditoriaDisparos()`); verdade(csv.includes(";enviado;") && !/\b55\d{11}\b/.test(csv), "csv"); igual(meta.recebidas.length, 0, "o lote nunca chama a API");
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
