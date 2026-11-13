/* Ponta a ponta: histórico permanente, callback manual, fechamento e Google Drive SIMULADO (o painel BI integrado foi retirado). Navegador real -> gateway real -> APIs simuladas em
   127.0.0.1. Dados fictícios; nada sai do computador. Uso: node testes\ponta-a-ponta\e2e-bi.mjs [pasta-para-fotos] */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { abrirNavegador, espera } from "./cdp.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const fotos = process.argv[2] || null; if (fotos) mkdirSync(fotos, { recursive: true });
const resultados = [];
async function teste(nome, f) { try { await f(); resultados.push([true, nome]); console.log("OK    " + nome); } catch (e) { resultados.push([false, nome]); console.log("FALHA " + nome + " — " + e.message); } }
const verdade = (c, m) => { if (!c) throw new Error(m || "condição falsa"); };
const igual = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || "esperado"}: ${JSON.stringify(b)}, obtido: ${JSON.stringify(a)}`); };
const SEGREDO = "segredo-oauth-de-teste", ACESSO = "acesso-de-teste", PASTA = "application/vnd.google-apps.folder";

/* Google Drive simulado */
const drive = { arquivos: [], fora: false, n: 0, atraso: 0, corromper: false };
const servidor = (f) => new Promise((ok) => { const s = createServer(f); s.listen(0, "127.0.0.1", () => ok(s)); });
const googleS = await servidor((req, res) => {
  const partes = []; req.on("data", (p) => partes.push(p)); req.on("end", () => {
    const corpo = Buffer.concat(partes).toString("utf8"), u = new URL(req.url, "http://x"), js = (s, d) => { res.statusCode = s; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(d)); };
    if (drive.fora) return js(503, {});
    if (u.pathname === "/token") return js(200, { access_token: ACESSO, expires_in: 3600 });
    if (req.headers.authorization !== "Bearer " + ACESSO) return js(401, {});
    if (u.pathname === "/drive/v3/files" && req.method === "GET") {
      const q = u.searchParams.get("q"), nome = /name='([^']+)'/.exec(q), pai = /'([^']+)' in parents/.exec(q), contem = /name contains '([^']+)'/.exec(q), soPasta = q.includes(`mimeType='${PASTA}'`);
      return js(200, { files: drive.arquivos.filter((a) => (!nome || a.name === nome[1]) && (!pai || a.parents.includes(pai[1])) && (!contem || a.name.includes(contem[1])) && (!soPasta || a.mimeType === PASTA)) });
    }
    if (u.pathname === "/drive/v3/files" && req.method === "POST") { const d = JSON.parse(corpo), a = { ...d, id: "p" + ++drive.n }; drive.arquivos.push(a); return js(200, a); }
    if (u.pathname === "/upload/drive/v3/files") { const lim = /boundary=(.+)$/.exec(req.headers["content-type"])[1], p = corpo.split("--" + lim), meta = JSON.parse(p[1].split("\r\n\r\n")[1]), conteudo = p[2].split("\r\n\r\n").slice(1).join("\r\n\r\n").replace(/\r\n$/, ""); const a = { ...meta, id: "f" + ++drive.n, conteudo, modifiedTime: new Date().toISOString() }; drive.arquivos.push(a); return setTimeout(() => js(200, a), drive.atraso); }
    const m = /^\/drive\/v3\/files\/(.+)$/.exec(u.pathname); if (m) { res.end(drive.corromper ? "conteudo-diferente" : drive.arquivos.find((a) => a.id === m[1]).conteudo); return; }
    js(404, {});
  });
});
const metaR = []; const metaS = await servidor((req, res) => { let c = ""; req.on("data", (p) => (c += p)); req.on("end", () => { metaR.push(JSON.parse(c)); res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ messages: [{ id: "wamid." + metaR.length }] })); }); });
const dados = mkdtempSync(join(tmpdir(), "central-bi-")), PORTA = 9100 + Math.floor(Math.random() * 80), BASE = `http://127.0.0.1:${PORTA}`;
const gatewayP = spawn(process.execPath, [join(raiz, "gateway", "servidor.mjs")], { env: { ...process.env, GATEWAY_PORTA: String(PORTA), GATEWAY_DADOS: dados, WHATSAPP_MODO: "producao", WHATSAPP_TOKEN: "t", WHATSAPP_PHONE_NUMBER_ID: "1", WHATSAPP_API_VERSAO: "v0", WHATSAPP_API_BASE: `http://127.0.0.1:${metaS.address().port}`,
  GOOGLE_CLIENT_ID: "cliente", GOOGLE_CLIENT_SECRET: SEGREDO, GOOGLE_REFRESH_TOKEN: "refresh-teste", GOOGLE_DRIVE_RAIZ_ID: "raiz", GOOGLE_API_BASE: `http://127.0.0.1:${googleS.address().port}`, GOOGLE_OAUTH_BASE: `http://127.0.0.1:${googleS.address().port}`, BI_INTERVALO_MS: "700" }, stdio: ["ignore", "pipe", "pipe"] });
await new Promise((ok) => gatewayP.stdout.on("data", (x) => String(x).includes("Google Drive:") && ok()));
const nav = await abrirNavegador({ exe: process.argv[3] }), bd = "e2eb" + Date.now().toString(36), pg = await nav.novaPagina(`${BASE}/?bd=${bd}`);
const js = (e) => pg.js(e), S = "window.CentralUI.servico";
const clicar = (s) => js(`(() => { const e = document.querySelector(${JSON.stringify(s)}); if (!e) throw new Error("não achei ${s.replace(/"/g, "'")}"); e.click(); return true; })()`);
const digitar = (s, v) => js(`(() => { const e = document.querySelector(${JSON.stringify(s)}); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
const foto = async (p, n) => { if (fotos) await p.foto(join(fotos, n + ".png")); };
const CSV = join(raiz, "exemplos", "navegador-chamadas-ADMS2026-FICTICIO.csv");
async function importar() { const doc = await pg.cmd("DOM.getDocument", {}), { nodeId } = await pg.cmd("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "#arquivo" }); await pg.cmd("DOM.setFileInputFiles", { nodeId, files: [CSV] }); await pg.aguardar("!!document.querySelector('#btn-confirmar-import')"); await clicar("#btn-confirmar-import"); await pg.aguardar("document.querySelectorAll('#linhas tr[data-id]').length > 0"); }
const janela = () => js(`(window.__links = window.__links || [], window.open = () => { const j = { closed: false, opener: 1, close() {} }; Object.defineProperty(j, "location", { value: { set href(u) { window.__links.push(u); } } }); return j; }, true)`);
const cor = (sel) => js(`getComputedStyle(document.querySelector(${JSON.stringify(sel)})).backgroundColor`);
const VERDE = "rgb(217, 242, 224)";
const metricas = () => js(`${S}.metricasTempoReal()`);
let atendidos;

await pg.aguardar("document.body.dataset.pronto === '1'"); await janela();
await teste("Fluxo do lote: importar, marcar, preparar, autorizar e concluir; envio confirmado vira callback", async () => {
  await js(`(() => { const f = document.querySelector("#form-dia"); f.operador.value = "opt4"; f.polo.value = "Aracaju"; f.requestSubmit(); return true; })()`);
  await pg.aguardar("!!document.querySelector('#importar').offsetParent"); await importar();
  const l = await js(`${S}.incidentesParaDisparo()`); atendidos = l.filter((x) => x.elegivel && x.tem_celular && x.incidente).slice(0, 2);
  await js(`(async () => { const s = ${S}, f = await s.iniciarAtendimento(${JSON.stringify(atendidos.map((x) => x.chave))}); for (const i of f.itens) { await s.abrirAtendimento(f.id, i.id); await s.registrarRetornoAtendimento(f.id, i.id); await s.confirmarEnvioAtendimento(f.id, i.id, "enviado", { avancar: true }); } await window.CentralUI.recarregar(); return true; })()`);
  igual([(await metricas()).callbacks_realizados, metaR.length, await js(`${S}.filaDoLote().situacao`)], [2, 0, "concluida"]);
});
await teste("Linha inteira verde-claro para callback realizado; pendente continua normal", async () => {
  await clicar('[data-modo="individual"]');
  igual(await cor(`#linhas tr[data-grupo="${atendidos[0].chave}"]`), VERDE);
  const p = await js(`${S}.incidentesParaDisparo().find((x) => x.elegivel).chave`); verdade((await cor(`#linhas tr[data-grupo="${p}"]`)) !== VERDE, "pendente não fica verde");
  await foto(pg, "b1-linha-verde");
});
await teste("Cancelamento depois da autorização é registrado; aberta a página de novo, fila e contagem seguem iguais", async () => {
  const c = await js(`${S}.incidentesParaDisparo().filter((x) => x.elegivel && x.tem_celular).slice(0, 1).map((x) => x.chave)`);
  await js(`(async () => { const f = await ${S}.prepararDisparo(${JSON.stringify(c)}, "selecao"); await ${S}.autorizarDisparo(f.id, { pronto: true, modo: "producao" }); await ${S}.cancelarRestante(f.id); return true; })()`);
  await pg.ir(`${BASE}/?bd=${bd}`); await pg.aguardar("document.body.dataset.pronto === '1'"); await janela();
  igual((await metricas()).callbacks_realizados, 2, "reabrir a página não conta de novo");
  igual(await js(`${S}.E.historico_atendimento.filter((r) => r.tipo === "cancelado").length`), 1);
});
await teste("CALLBACK WHATSAPP: sem campo de operador, prévia ao vivo, só conta após confirmar, resolver não gera callback, histórico persiste", async () => {
  await clicar("#btn-manual"); await pg.aguardar("!!document.querySelector('#cm-enviar').offsetParent");
  verdade(!(await js(`!!document.querySelector("#callback-manual input[id*=operador]")`)), "não pode haver campo de operador"); verdade((await js(`document.querySelector("#cm-operador").textContent`)).includes("OPT4"), "operador do turno");
  verdade(!(await js("!!document.querySelector('#linhas').offsetParent")), "módulo independente da lista");
  await digitar("#cm-incidente", "900123"); await digitar("#cm-modelo", "manual_falta_energia");
  verdade((await js(`document.querySelector("#cm-previa-texto").textContent`)).includes("INC 900123"), "prévia");
  await digitar("#cm-telefone", "(79) 99100-0900"); await clicar("#cm-enviar"); await pg.aguardar("window.__links.length === 1 && !!document.querySelector('[data-confirma]')");
  verdade((await js("window.__links[0]")).startsWith("https://web.whatsapp.com/send?phone=5579991000900"), "mecanismo individual");
  igual((await metricas()).callbacks_realizados, 2, "pendente não conta");
  await foto(pg, "b2-manual"); await clicar('[data-confirma="enviado"]'); await pg.aguardar("!!document.querySelector('[data-resolve=\"1\"]')");
  igual((await metricas()).callbacks_realizados, 3); await clicar('[data-resolve="1"]'); await pg.aguardar("!!document.querySelector('[data-resolve=\"0\"]')");
  igual((await metricas()).callbacks_realizados, 3, "resolver não gera callback");
  igual(await js(`[...document.querySelectorAll("#cm-indicadores .valor")].map((v) => v.textContent)`), ["1", "1", "0", "0"]);
  await pg.ir(`${BASE}/?bd=${bd}`); await pg.aguardar("document.body.dataset.pronto === '1'"); await janela(); await clicar("#btn-manual");
  await pg.aguardar("document.querySelectorAll('#cm-linhas tr[data-id]').length === 1");
  await digitar("#cm-f-status", "falha"); await pg.aguardar("document.querySelectorAll('#cm-linhas tr[data-id]').length === 0"); igual(await js(`document.querySelector("#cm-indicadores .valor").textContent`), "0", "indicadores seguem o filtro");
  await digitar("#cm-f-status", ""); await foto(pg, "b3-manual-historico"); await clicar("#btn-manual");
});
await teste("Opção 3 abre a tela manual; incidente e telefone lado a lado; personalizada com prévia; excluir histórico confirma, audita e não apaga contagem", async () => {
  await clicar('[data-modo="manual"]'); await pg.aguardar("!!document.querySelector('#cm-enviar').offsetParent"); verdade(!(await js("!!document.querySelector('#linhas').offsetParent")), "abre direto");
  const caixas = () => js(`["#cm-incidente", "#cm-telefone"].map((s) => { const r = document.querySelector(s).getBoundingClientRect(); return [Math.round(r.top), Math.round(r.width)]; })`);
  const [a, b] = await caixas(); igual(a[0], b[0], "mesma linha"); verdade(Math.abs(a[1] - b[1]) <= 2 && a[1] > 150, "larguras equilibradas");
  await foto(pg, "b2b-manual-compacta"); await pg.tamanho(390, 844); const [c, d] = await caixas(); verdade(d[0] > c[0], "um abaixo do outro no celular"); await pg.tamanho(1366, 768);
  await digitar("#cm-modelo", "manual_falta_energia"); await digitar("#cm-incidente", "900300"); verdade((await js(`document.querySelector("#cm-previa-texto").textContent`)).includes("INC 900300"), "padronizada");
  await js(`(document.querySelector('input[name=cm_modo][value=personalizada]').click(), true)`); verdade(await js("!!document.querySelector('#cm-texto').offsetParent"), "campo livre"); await digitar("#cm-texto", "Texto livre do teste");
  verdade((await js(`document.querySelector("#cm-previa-texto").textContent`)).includes("Texto livre do teste"), "personalizada na prévia"); await js(`(document.querySelector('input[name=cm_modo][value=padronizada]').click(), true)`); await digitar("#cm-incidente", ""); await digitar("#cm-texto", ""); await digitar("#cm-modelo", "");
  const antes = await js(`JSON.stringify([${S}.metricasTempoReal(), ${S}.E.historico_atendimento])`);
  igual(await js(`document.querySelector("#cm-excluir").textContent`), "EXCLUIR HISTÓRICO"); await clicar("#cm-excluir"); await pg.aguardar("!!document.querySelector('#cm-ex-palavra')");
  verdade((await js(`document.querySelector("#modal-caixa").textContent`)).includes("1 registro(s)"), "informa a quantidade"); verdade(await js("document.querySelector('#cm-ex-confirmar').disabled"), "sem clique acidental");
  await clicar("#cm-ex-cancelar"); igual(await js("document.querySelectorAll('#cm-linhas tr[data-id]').length"), 1, "cancelar não muda nada");
  await clicar("#cm-excluir"); await pg.aguardar("!!document.querySelector('#cm-ex-palavra')"); await digitar("#cm-ex-palavra", "excluir"); verdade(await js("document.querySelector('#cm-ex-confirmar').disabled"), "palavra errada"); await digitar("#cm-ex-palavra", "EXCLUIR"); await clicar("#cm-ex-confirmar");
  await pg.aguardar("document.querySelectorAll('#cm-linhas tr[data-id]').length === 0"); igual(await js(`JSON.stringify([${S}.metricasTempoReal(), ${S}.E.historico_atendimento])`), antes, "indicadores intactos");
  igual(await js(`[...document.querySelectorAll("#cm-indicadores .valor")].map((v) => v.textContent)`), ["1", "1", "0", "0"], "indicadores da tela"); igual(await js(`${S}.E.auditoria_manual.map((r) => [r.operador, r.quantidade])`), [["OPT4", 1]], "auditoria");
  await clicar("#btn-manual");
});
await teste("Limpar o lote preserva o histórico; novo CSV reconhece atendidos: linha verde, sem seleção e com histórico visível", async () => {
  await clicar("#btn-encerrar-lote"); await pg.aguardar("!!document.querySelector('#m-sim')"); await clicar("#m-sim"); await pg.aguardar("!!document.querySelector('#importar').offsetParent");
  igual(await js(`${S}.chamadas().length`), 0); verdade((await js(`${S}.E.historico_atendimento.length`)) >= 4, "histórico intacto"); igual(await js(`${S}.historicoDisparos().length`), 2);
  await importar();
  await pg.aguardar(`${S}.incidentesParaDisparo().some((x) => x.chave === ${JSON.stringify(atendidos[0].chave)})`); // a lista antiga pode seguir na tela até o novo lote gravar
  const sel = `#linhas tr[data-grupo="${atendidos[0].chave}"]`, inc = await js(`${S}.incidentesParaDisparo().find((x) => x.chave === ${JSON.stringify(atendidos[0].chave)})`);
  igual(await cor(sel), VERDE); igual([inc.elegivel, inc.atendido], [false, true], "bloqueado no lote"); verdade(inc.motivo_inelegivel.includes("OPT4"), "operador visível");
  verdade((await js(`${S}.prepararDisparo([${JSON.stringify(atendidos[0].chave)}], "lote").then(() => "", (e) => e.message)`)).includes("Nenhum incidente"), "não prepara");
  await foto(pg, "b4-reconhecidos"); await clicar(sel); await pg.aguardar("!!document.querySelector('#p-fechar')"); verdade((await js(`document.querySelector("#painel").textContent`)).includes("OPT4"), "histórico no painel"); await clicar("#p-fechar");
  igual((await metricas()).callbacks_realizados, 3, "reconhecer não conta");
  await clicar('[data-modo="individual"]');
});
let hoje;
const arquivosCsv = () => drive.arquivos.filter((a) => a.name.startsWith("fechamento_"));
await teste("Fechamento: envio OPCIONAL ao Drive publica, cria a pasta do mês sem duplicar e só leva agregados (encerrar o dia não envia)", async () => {
  hoje = await js(`${S}.sessao().data_operacional`);
  await js(`(async () => { await ${S}.encerrarLote(); await ${S}.encerrarDia(); await window.CentralFechamento.aposEncerrarDia(${JSON.stringify(hoje)}, "OPT4"); return true; })()`);
  await espera(500); igual([arquivosCsv().length, await js(`${S}.E.fechamentos[0].status`)], [0, "pendente"], "encerrar o dia não chama o Drive");
  await js("window.CentralFechamento.enviarAoDrive().then(() => true)");
  await pg.aguardar(`${S}.E.fechamentos[0] && ${S}.E.fechamentos[0].status === "enviado"`, 15000);
  igual(arquivosCsv().length, 1); verdade(new RegExp(`^fechamento_callbacks_${hoje}_ARACAJU_PC[A-F0-9]{8}\\.csv$`).test(arquivosCsv()[0].name), arquivosCsv()[0].name);
  igual(drive.arquivos.filter((a) => a.mimeType === PASTA && a.name === "2026").length, 1, "sem pasta duplicada");
  const porId = (id) => drive.arquivos.find((a) => a.id === id), mes = porId(arquivosCsv()[0].parents[0]), ano = porId(mes.parents[0]); igual([/^\d{2}-[A-Z]+$/.test(mes.name), ano.name, porId(ano.parents[0]).name], [true, "2026", "FECHAMENTOS"], "ano e mês em FECHAMENTOS");
  igual(drive.arquivos.filter((a) => a.mimeType === PASTA && a.name === "BI").length, 0, "pasta BI não é mais criada");
  for (const n of ["HISTORICO", "FECHAMENTOS"]) igual(drive.arquivos.filter((a) => a.mimeType === PASTA && a.name === n && a.parents[0] === "raiz").length, 1, "pasta " + n);
  const c = arquivosCsv()[0].conteudo.replace("﻿", "").trim().split("\r\n"); igual(c[0], "data;polo;operador;callbacks_realizados;incidentes_resolvidos;incidentes_cancelados;versao");
  igual(c.slice(1), [`${hoje};Aracaju;OPT4;3;1;1;1`, `${hoje};TOTAL;TOTAL;3;1;1;1`]);
  for (const p of ["INC", "CALL", "Fictício", "99100", "Energisa"]) verdade(!arquivosCsv()[0].conteudo.includes(p), "vazou " + p);
  await pg.ir(`${BASE}/?bd=${bd}`); await pg.aguardar("document.body.dataset.pronto === '1'"); await espera(800); igual(arquivosCsv().length, 1, "reabrir não duplica");
});
await teste("Novo turno gera nova versão auditável sem apagar a anterior", async () => {
  await js(`(async () => { await ${S}.abrirSessao("", "OPT5"); const a = await ${S}.abrirCallbackManual({ incidente: "900200", telefone: "79991000901", modo: "padronizada", modelo: "manual_falta_energia" }); await ${S}.confirmarEnvioManual(a.item.id, "enviado"); await ${S}.encerrarDia(); await window.CentralFechamento.aposEncerrarDia(${JSON.stringify(hoje)}, "OPT5"); await window.CentralFechamento.enviarAoDrive(); return true; })()`);
  await pg.aguardar(`${S}.E.fechamentos[1] && ${S}.E.fechamentos[1].status === "enviado"`, 15000);
  igual(arquivosCsv().map((a) => a.name), [arquivosCsv()[0].name, arquivosCsv()[0].name.replace(".csv", "_v2.csv")]);
  verdade(await js(`${S}.E.fechamentos[1].motivo.includes("OPT5")`), "motivo registrado");
  await pg.aguardar("true"); await espera(1800);
  igual((await (await fetch(BASE + "/api/drive/status")).json()).situacao, "ok", "sincronização do Drive em dia");
  verdade(arquivosCsv()[0].conteudo.includes(";OPT4;") && arquivosCsv()[1].conteudo.includes(";OPT5;"), "versão anterior intacta e nova versão no Drive");
});
await teste("Privacidade no servidor: recusa CSV fora do padrão, com telefone ou de outra origem; segredos não são servidos", async () => {
  const post = (c, cab = { Origin: BASE }) => fetch(BASE + "/api/fechamento", { method: "POST", headers: { "Content-Type": "application/json", ...cab }, body: JSON.stringify(c) });
  const CAB = "data;polo;operador;callbacks_realizados;incidentes_resolvidos;incidentes_cancelados;versao";
  const envio = (conteudo, nome = "fechamento_callbacks_2026-11-01_ARACAJU.csv") => ({ nome, data: "2026-11-01", versao: 1, sha256: "x", conteudo });
  const r1 = await (await post(envio(`${CAB};nome_cliente\r\n2026-11-01;A;B;1;0;0;1;Fulano\r\n`))).json(); igual(r1.codigo, "fora_do_padrao", "coluna extra");
  const r2 = await (await post(envio(`${CAB}\r\n2026-11-01;A;79991000900;1;0;0;1\r\n2026-11-01;TOTAL;TOTAL;1;0;0;1\r\n`))).json(); igual(r2.codigo, "fora_do_padrao", "telefone como operador");
  igual((await (await post(envio(`${CAB}\r\n`, "qualquer.csv"))).json()).codigo, "fora_do_padrao", "nome");
  igual((await post(envio(""), { Origin: "https://site-malicioso.example" })).status, 403);
  for (const c of ["/gateway/drive.mjs", "/gateway/dados/bi-base.json", "/testes/testes.js"]) igual((await fetch(BASE + c)).status, 404, c);
  for (const c of ["/bi.html", "/js/bi.js", "/css/bi.css", "/api/bi/dados"]) igual((await fetch(BASE + c)).status, 404, "BI integrado retirado: " + c);
  const pub = await Promise.all(["/", "/js/fechamento-ui.js", "/api/drive/status"].map(async (c) => (await fetch(BASE + c)).text())); verdade(!pub.some((t) => t.includes(SEGREDO) || t.includes(ACESSO) || t.includes("refresh-teste")), "segredo exposto");
  igual(pg.erros, [], "console");
});
/* ENCERRAR O DIA pela tela: destino principal = pasta de rede (aqui NÃO configurada: o seletor é cancelado). O Drive NÃO é chamado;
   o envio ao Drive continua disponível pelo botão opcional da janela Fechamento, com as mesmas garantias de antes. */
const novoTurnoComCallback = (op, inc) => js(`(async () => { const s = ${S}; await s.abrirSessao("", "${op}"); const a = await s.abrirCallbackManual({ incidente: "${inc}", telefone: "79991000902", modo: "padronizada", modelo: "manual_falta_energia" }); await s.confirmarEnvioManual(a.item.id, "enviado"); await window.CentralUI.recarregar(); return true; })()`);
const semPasta = () => js("(window.__pasta = 0, window.showDirectoryPicker = window.showSaveFilePicker = async () => { window.__pasta++; throw new DOMException('x', 'AbortError'); }, true)");
const modalCom = (t, p = pg) => p.aguardar(`document.querySelector("#modal-caixa").textContent.includes(${JSON.stringify(t)})`, 20000);
const modalTexto = () => js(`document.querySelector("#modal-caixa").textContent`);
const clicarEscolha = (r, p = pg) => p.js(`([...document.querySelectorAll("#modal [data-escolha]")].find((b) => b.textContent === ${JSON.stringify(r)}).click(), true)`);
const encerrarPelaTela = async (p = pg) => {
  await p.js("(document.querySelector('#btn-encerrar-dia').click(), true)"); await p.aguardar("!!document.querySelector('#m-sim')");
  igual(await p.js("document.querySelector('#m-sim').textContent"), "Encerrar e exportar para a pasta de rede"); await p.js("(document.querySelector('#m-sim').click(), true)");
  await modalCom("NÃO exportado", p); verdade(!(await p.js(`document.querySelector("#modal-caixa").textContent`)).includes("Drive"), "o resultado não fala em Drive"); await clicarEscolha("Depois", p);
};
const enviarDrivePeloBotao = async (p = pg) => {
  await p.js(`(document.querySelector("#toast").textContent = "", document.querySelector("#btn-fechamento").click(), true)`); await p.aguardar("!!document.querySelector('#fe-tentar')");
  igual(await p.js("document.querySelector('#fe-tentar').textContent"), "Enviar ao Google Drive (opcional)"); await p.js("(document.querySelector('#fe-tentar').click(), true)");
  await p.aguardar(`document.querySelector("#toast").textContent.includes("Google Drive")`, 20000); const t = await p.js(`document.querySelector("#toast").textContent`);
  await p.js(`(document.querySelector("#fe-fechar") && document.querySelector("#fe-fechar").click(), true)`); return t;
};
const fotografarAnteriores = () => js(`JSON.stringify(${S}.E.fechamentos.map((f) => [f.id, f.nome, f.conteudo, f.sha256, f.versao]))`);
await teste("ENCERRAR O DIA não chama o Drive; o envio opcional só conta com upload confirmado; sem duplicar e histórico registrado", async () => {
  await pg.ir(`${BASE}/?bd=${bd}`); await pg.aguardar("document.body.dataset.pronto === '1'"); await janela(); await semPasta(); await novoTurnoComCallback("OPT6", "900210");
  const n0 = arquivosCsv().length; await encerrarPelaTela(); await espera(600);
  igual([arquivosCsv().length, await js(`${S}.E.fechamentos.at(-1).status`), await js(`(${S}.E.fechamentos.at(-1).historico_envio || []).length`)], [n0, "pendente", 0], "nenhum envio ao Drive no encerramento");
  drive.atraso = 900; const envio = enviarDrivePeloBotao(); await espera(300); igual(await js(`${S}.E.fechamentos.at(-1).status`), "pendente", "não conta antes do upload"); verdade((await envio).includes("1 enviado"), "toast"); drive.atraso = 0;
  igual([arquivosCsv().length, await js(`${S}.E.fechamentos.at(-1).status`), await js(`${S}.E.fechamentos.at(-1).nome`).then((n) => n.endsWith("_v3.csv"))], [n0 + 1, "enviado", true]);
  igual(await js(`${S}.E.fechamentos.at(-1).historico_envio.map((h) => h.resultado)`), ["enviado"]); await foto(pg, "b8-fechamento-drive-opcional");
  await pg.aguardar(`document.querySelector("#lista-exportacoes").textContent.includes("Google Drive: salvo em")`); verdade(!/BI/.test(await js(`document.querySelector("#lista-exportacoes").textContent`)), "sem texto de BI na lista de fechamentos");
  igual(arquivosCsv().filter((a) => a.conteudo.includes(";OPT6;")).length, 1, "o novo arquivo está no Drive");
});
await teste("Drive indisponível (envio opcional): não marca enviado, preserva os dados, não altera fechamentos anteriores e o reenvio não duplica", async () => {
  await novoTurnoComCallback("OPT7", "900220"); await encerrarPelaTela(); const antes = await fotografarAnteriores(), n0 = arquivosCsv().length;
  drive.fora = true; verdade((await enviarDrivePeloBotao()).includes("1 não enviado"), "avisa"); await foto(pg, "b9-fechamento-pendente");
  igual([arquivosCsv().length, await js(`${S}.E.fechamentos.at(-1).status`), await js("window.__pasta")], [n0, "pendente", 0]);
  verdade((await js(`${S}.E.fechamentos.at(-1).conteudo`)).includes(";OPT7;"), "dados preservados"); igual(await fotografarAnteriores(), antes, "anteriores intactos");
  await enviarDrivePeloBotao(); drive.fora = false; verdade((await enviarDrivePeloBotao()).includes("1 enviado"), "reenvio");
  igual(arquivosCsv().length, n0 + 1, "um único arquivo depois de repetir"); igual(await js(`${S}.E.fechamentos.at(-1).historico_envio.map((h) => h.resultado).at(-1)`), "enviado");
  verdade((await js(`${S}.E.fechamentos.at(-1).historico_envio.length`)) >= 3, "cada tentativa registrada");
  await pg.ir(`${BASE}/?bd=${bd}`); await pg.aguardar("document.body.dataset.pronto === '1'"); await espera(800); igual(arquivosCsv().length, n0 + 1, "reabrir não duplica");
});
await teste("Sem confirmação não há sucesso: arquivo lido do Drive diferente fica pendente; envios simultâneos do mesmo arquivo criam um só", async () => {
  await janela(); await semPasta(); await novoTurnoComCallback("OPT8", "900230"); await encerrarPelaTela(); const n0 = arquivosCsv().length;
  drive.corromper = true; await enviarDrivePeloBotao(); verdade((await js(`${S}.E.fechamentos.at(-1).erro`)).includes("difere do enviado"), await js(`${S}.E.fechamentos.at(-1).erro`));
  igual(await js(`${S}.E.fechamentos.at(-1).status`), "pendente");
  drive.corromper = false; await enviarDrivePeloBotao(); igual([arquivosCsv().length, await js(`${S}.E.fechamentos.at(-1).status`)], [n0 + 1, "enviado"], "reaproveita, não duplica");
  const { createHash } = await import("node:crypto"), CAB = "data;polo;operador;callbacks_realizados;incidentes_resolvidos;incidentes_cancelados;versao", conteudo = `${CAB}\r\n2026-11-02;Aracaju;OPX;1;0;0;1\r\n2026-11-02;TOTAL;TOTAL;1;0;0;1\r\n`;
  const corpo = JSON.stringify({ nome: "fechamento_callbacks_2026-11-02_ARACAJU.csv", data: "2026-11-02", versao: 1, conteudo, sha256: createHash("sha256").update(conteudo, "utf8").digest("hex") });
  drive.atraso = 400; const r = await Promise.all([1, 2, 3].map(async () => (await fetch(BASE + "/api/fechamento", { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: corpo })).json())); drive.atraso = 0;
  igual(r.map((x) => [x.resultado, x.confirmado]), [["enviado", true], ["enviado", true], ["enviado", true]]); igual(arquivosCsv().filter((a) => a.name.includes("2026-11-02")).length, 1, "um arquivo só");
  igual(pg.erros, [], "console");
});
await teste("Dois computadores no mesmo polo e dia: encerramento simultâneo e envio opcional geram arquivos distintos, sem sobrescrita e sem contar em dobro", async () => {
  const abrir = async (sufixo) => { const p = await nav.novaPagina(`${BASE}/?bd=${bd}${sufixo}`); await p.aguardar("document.body.dataset.pronto === '1'"); await p.js("(window.showDirectoryPicker = async () => { throw new DOMException('x', 'AbortError'); }, true)"); return p; };
  const pcA = await abrir("pca"), pcB = await abrir("pcb"), turno = (p, op, inc) => p.js(`(async () => { const s = ${S}; await s.abrirSessao("Aracaju", "${op}"); const a = await s.abrirCallbackManual({ incidente: "${inc}", telefone: "79991000903", modo: "padronizada", modelo: "manual_falta_energia" }); await s.confirmarEnvioManual(a.item.id, "enviado"); await window.CentralUI.recarregar(); return true; })()`);
  const encerrar = async (p) => { await encerrarPelaTela(p); await enviarDrivePeloBotao(p); };
  await Promise.all([turno(pcA, "PCA1", "900301"), turno(pcB, "PCB1", "900302")]);
  const n0 = arquivosCsv().length; await Promise.all([encerrar(pcA), encerrar(pcB)]);
  const nomes = await Promise.all([pcA, pcB].map((p) => p.js(`${S}.E.fechamentos.at(-1).nome`))); verdade(nomes[0] !== nomes[1], "nomes distintos: " + nomes);
  igual(arquivosCsv().length, n0 + 2, "os dois no Drive"); for (const n of nomes) igual(arquivosCsv().filter((a) => a.name === n).length, 1, "sem duplicar " + n);
  const fotoA = arquivosCsv().find((a) => a.name === nomes[0]).conteudo; await turno(pcA, "PCA2", "900303"); await encerrar(pcA);
  const v2 = await pcA.js(`${S}.E.fechamentos.at(-1).nome`); igual(v2, nomes[0].replace(".csv", "_v2.csv"), "nova versão na sequência do computador");
  igual(arquivosCsv().find((a) => a.name === nomes[0]).conteudo, fotoA, "versão anterior intacta"); igual([...pcA.erros, ...pcB.erros], [], "console");
});
await nav.fechar(); gatewayP.kill(); googleS.close(); metaS.close();
const falhas = resultados.filter((r) => !r[0]).length;
console.log(`\n${resultados.length} testes de histórico, fechamento e Drive · ${resultados.length - falhas} aprovados · ${falhas} com falha`);
process.exitCode = falhas ? 1 : 0; setTimeout(() => process.exit(), 300).unref();
