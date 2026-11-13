/* Testes PONTA A PONTA da exportação do fechamento para a pasta de rede (js/exportacao-rede.js). Dados 100% fictícios; bancos separados.
   Uso: node testes\ponta-a-ponta\e2e-exportacao-rede.mjs [caminho-do-navegador]
   LIMITES (ditos também no relatório): a janela nativa "Selecionar pasta" não pode ser automatizada. Ela é SUBSTITUÍDA por uma que
   devolve uma PASTA REAL da área privada do navegador (OPFS) chamada "central-callback". Gravação, leitura de volta, identificador
   guardado no IndexedDB, F5 e reabertura do navegador (mesmo perfil) são reais; a unidade W: e dois computadores NÃO são testados aqui.
   - Permissão revogada: queryPermission responde "prompt" (como o navegador); requestPermission concede ou nega conforme o teste.
   - W: indisponível: a pasta é removida enquanto o identificador continua guardado (o acesso falha como numa unidade desconectada).
   - Falha de gravação: o fechamento do arquivo (close) passa a falhar. */
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { abrirNavegador, espera, CONFIG_TESTE } from "./cdp.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const resultados = [];
async function teste(nome, f) {
  try { await f(); resultados.push([true, nome]); console.log("OK    " + nome); }
  catch (e) { resultados.push([false, nome, e.message]); console.log("FALHA " + nome + " — " + e.message); }
}
const verdade = (c, m) => { if (!c) throw new Error(m || "condição falsa"); };
const igual = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || "esperado"}: ${JSON.stringify(b)}, obtido: ${JSON.stringify(a)}`); };

const SIMULACAO = `(() => {
  window.__nPasta = 0; window.__pedidos = 0; window.__abertos = []; window.__rede = [];
  const fe = window.fetch; window.fetch = function (u, o) { window.__rede.push(String(u && u.url || u)); return fe.call(this, u, o); }; // vigia chamadas ao gateway
  // Vigia o conector do Google Drive (por file:// ele responde sem rede; o que importa é se a Central PEDE o envio).
  window.__drive = 0; let dsp; Object.defineProperty(window, "Disparos", { configurable: true, get: () => dsp, set: (v) => { dsp = v;
    const o = v.ConectorGateway.prototype.enviarFechamento; v.ConectorGateway.prototype.enviarFechamento = function (d) { window.__drive++; return o.call(this, d); }; } });
  window.showDirectoryPicker = async (op) => { window.__nPasta++; window.__opcoesPicker = op;
    if (localStorage.getItem("__cancelar") === "1") throw new DOMException("cancelado", "AbortError");
    const r = await navigator.storage.getDirectory(); return r.getDirectoryHandle(localStorage.getItem("__nomePasta") || "central-callback", { create: true }); };
  const D = FileSystemDirectoryHandle.prototype, F = FileSystemHandle.prototype, W = FileSystemWritableFileStream.prototype;
  const gfh = D.getFileHandle; D.getFileHandle = function (n, o) { window.__abertos.push(n); return gfh.call(this, n, o); };
  const q = F.queryPermission; F.queryPermission = function (op) { return localStorage.getItem("__revogada") === "1" ? Promise.resolve("prompt") : q.call(this, op); };
  F.requestPermission = function () { window.__pedidos++; if (localStorage.getItem("__negar") === "1") return Promise.resolve("denied"); localStorage.removeItem("__revogada"); return Promise.resolve("granted"); };
  const cl = W.close; W.close = function () { if (localStorage.getItem("__falharGravacao") === "1") return Promise.reject(new DOMException("disco cheio (simulado)", "QuotaExceededError")); return cl.call(this); };
})();`;

const perfil = mkdtempSync(join(tmpdir(), "central-rede-")), exe = process.argv[2];
let nav = await abrirNavegador({ exe, perfil });
const bd = "e2erede" + Date.now().toString(36), base = pathToFileURL(join(raiz, "index.html")).href;
let pg;
async function abrir(banco = bd) {
  pg = await nav.novaPagina();
  await pg.cmd("Page.addScriptToEvaluateOnNewDocument", { source: SIMULACAO });
  await pg.ir(`${base}?bd=${banco}`); await pg.aguardar("document.body.dataset.pronto === '1'");
}
await abrir();
const js = (e) => pg.js(e), S = "window.CentralUI.servico", R = "window.CentralExportacaoRede";
const clicar = (sel) => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) throw new Error("não achei ${sel.replace(/"/g, "'")}"); e.click(); return true; })()`);
const clicarEscolha = (t) => js(`(() => { const b = [...document.querySelectorAll("#modal [data-escolha]")].find((x) => x.textContent === ${JSON.stringify(t)}); if (!b) throw new Error("sem botão ${t}"); b.click(); return true; })()`);
const ls = (k, v) => js(`(${v === null ? `localStorage.removeItem(${JSON.stringify(k)})` : `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)})`}, true)`);
const pasta = (corpo, nome = "central-callback") => js(`(async () => { const r = await navigator.storage.getDirectory(); const d = await r.getDirectoryHandle(${JSON.stringify(nome)}, { create: true }); ${corpo} })()`);
const arquivos = () => pasta(`const l = []; for await (const [n] of d.entries()) l.push(n); return l.sort();`);
const lerArq = (n) => pasta(`return new TextDecoder("utf-8", { ignoreBOM: true }).decode(await (await (await d.getFileHandle(${JSON.stringify(n)})).getFile()).arrayBuffer());`);
const escreverArq = (n, t) => pasta(`const w = await (await d.getFileHandle(${JSON.stringify(n)}, { create: true })).createWritable(); await w.write(${JSON.stringify(t)}); await w.close(); return true;`);
const situacaoBloco = async () => { await pg.aguardar(`(() => { const e = document.querySelector("#fe-rede"); return !!e && e.dataset.situacao !== "verificando"; })()`); return js(`document.querySelector("#fe-rede").dataset.situacao`); };
const abrirFechamento = async () => { if (!(await js(`!!document.querySelector("#fe-rede")`))) await clicar("#btn-fechamento"); return situacaoBloco(); };
const reabrirFechamento = async () => { await js(`(document.querySelector("#modal").classList.add("oculto"), document.querySelector("#modal-caixa").innerHTML = "", true)`); return abrirFechamento(); };
const textoModal = () => js(`document.querySelector("#modal-caixa").textContent`);
const toast = () => js(`document.querySelector("#toast").textContent`);
const fech = (i = -1) => js(`(() => { const f = ${S}.E.fechamentos.at(${i}); return f ? JSON.parse(JSON.stringify(f)) : null; })()`);
const aguardarExport = (id, n) => pg.aguardar(`(${S}.fechamento(${JSON.stringify(id)}).historico_rede || []).length >= ${n}`, 15000);
const foto = async (n) => { if (process.env.FOTOS) await pg.foto(join(process.env.FOTOS, n + ".png")); };

/* Um dia com 1 callback manual confirmado por operador; depois o dia é encerrado e o fechamento gerado (sem gateway: Drive pendente). */
let hoje;
async function diaComCallback(op, inc) {
  await js(`(async () => { const s = ${S}; if (!s.E.config.polo) { const f = document.querySelector("#form-dia"); f.operador.value = ${JSON.stringify(op)}; f.polo.value = "Aracaju"; f.requestSubmit(); await new Promise((r) => setTimeout(r, 600)); }
    if (!s.sessao()) await s.abrirSessao("", ${JSON.stringify(op)});
    const a = await s.abrirCallbackManual({ incidente: ${JSON.stringify(inc)}, telefone: "79991000901", modo: "padronizada", modelo: "manual_falta_energia" });
    await s.confirmarEnvioManual(a.item.id, "enviado"); const d = s.sessao().data_operacional; await s.encerrarDia();
    const ant = s.ultimoFechamentoDoDia(d); await s.gerarFechamento(d, ant ? { motivo: "Novo turno encerrado por ${op}", operador: ${JSON.stringify(op)} } : {}); await window.CentralUI.recarregar(); return d; })()`);
  hoje = await js(`${S}.E.fechamentos.at(-1).data`);
  return fech();
}

await pasta(`for await (const [n] of d.entries()) await d.removeEntry(n, { recursive: true }); return true;`);
let f1;
await teste("Antes de configurar: Pasta não configurada, EXPORTAR desabilitado, nenhum seletor aberto sozinho", async () => {
  f1 = await diaComCallback("OPR1", "900501");
  verdade(f1 && f1.status !== "enviado", "fechamento gerado e ainda sem Drive (sem gateway)");
  igual(await abrirFechamento(), "nao_configurada");
  igual(await js(`[document.querySelector("#fe-rede-estado").textContent, document.querySelector("#fe-rede-configurar").textContent, document.querySelector("#fe-rede-exportar").disabled, window.__nPasta]`),
    ["Pasta não configurada", "CONFIGURAR PASTA DE EXPORTAÇÃO", true, 0]);
  verdade((await textoModal()).includes(CONFIG_TESTE.pasta_rede), "caminho de destino (configuração local) visível");
  verdade((await js(`document.querySelector("tr[data-f] .c-rede").textContent`)).includes("Pendente"), "linha pendente");
  await foto("r1-nao-configurada");
});
await teste("1. Primeira seleção: pasta com outro nome é recusada; cancelar não muda nada; a pasta certa fica guardada no IndexedDB", async () => {
  await ls("__nomePasta", "Documentos"); await clicar("#fe-rede-configurar"); await pg.aguardar("window.__nPasta === 1");
  await pg.aguardar(`document.querySelector("#toast").textContent.includes("Pasta recusada")`); igual(await situacaoBloco(), "nao_configurada");
  await ls("__nomePasta", null); await ls("__cancelar", "1"); await clicar("#fe-rede-configurar"); await pg.aguardar(`document.querySelector("#toast").textContent.includes("cancelada")`);
  igual(await situacaoBloco(), "nao_configurada"); await ls("__cancelar", null);
  await clicar("#fe-rede-configurar"); await pg.aguardar(`document.querySelector("#toast").textContent.includes("configurada e testada")`);
  igual(await situacaoBloco(), "configurada");
  igual(await js("window.__opcoesPicker.mode"), "readwrite", "pede leitura e gravação");
  const h = await js(`(async () => { const h = await ${S}.arm.lerArquivo("pasta_rede_fechamento"); return h ? [h.kind, h.name, h instanceof FileSystemDirectoryHandle] : null; })()`);
  igual(h, ["directory", "central-callback", true], "FileSystemDirectoryHandle guardado por structured clone");
  await foto("r2-configurada");
});
await teste("2. Gravação de arquivo de teste: a configuração grava, lê e apaga um arquivo temporário; nada sobra na pasta", async () => {
  verdade((await js("window.__abertos")).some((n) => /^\.teste-gravacao-central-[0-9a-f]+\.tmp$/.test(n)), "arquivo de teste gravado");
  igual(await arquivos(), [], "arquivo de teste removido");
});
let nome1;
await teste("Exportar: grava direto na pasta (sem Salvar como e sem novo seletor), lê de volta e só então marca como exportado", async () => {
  await clicar("#fe-rede-exportar"); await aguardarExport(f1.id, 1);
  const f = await fech(0); nome1 = f.exportacao_rede.arquivo;
  verdade(new RegExp(`^fechamento_callbacks_${hoje}_ARACAJU_PC[A-F0-9]{8}_OP-OPR1\\.csv$`).test(nome1), nome1);
  igual(await arquivos(), [nome1]); igual(await lerArq(nome1), f1.conteudo, "conteúdo idêntico ao fechamento (com BOM)");
  verdade(f1.conteudo.startsWith("﻿data;polo;operador;"), "CSV para Excel: BOM UTF-8 e ';'");
  verdade(!/79991000901|900501/.test(f1.conteudo), "sem telefone ou incidente de cliente");
  igual([f.exportacao_rede.status, f.exportacao_rede.operador, f.exportacao_rede.sha256 === f1.sha256, f.historico_rede.map((r) => r.resultado)], ["exportado", "OPR1", true, ["exportado"]]);
  igual([f.conteudo, f.sha256, f.nome, f.versao, f.status], [f1.conteudo, f1.sha256, f1.nome, f1.versao, f1.status], "fechamento original e status do Drive intactos");
  igual([await js("window.__nPasta"), await js("typeof window.showSaveFilePicker === 'function' ? 'existe' : 'não'")], [3, "existe"], "nenhum seletor novo (3 = as três tentativas de configuração)");
  await situacaoBloco(); verdade((await js(`document.querySelector("#fe-rede-detalhe").textContent`)).includes("Exportação concluída"), "estado concluído");
  verdade((await js(`document.querySelector("tr[data-f] .c-rede").textContent`)).includes("Exportado"), "linha exportada");
  await foto("r3-exportado");
});
await teste("Falha na gravação: nada é marcado como exportado, nada sobra na pasta e o fechamento continua guardado", async () => {
  const f2 = await diaComCallback("OPR1", "900502"); await reabrirFechamento();
  await ls("__falharGravacao", "1"); await clicar("#fe-rede-exportar"); await aguardarExport(f2.id, 1);
  const f = await fech(); igual([f.exportacao_rede.status, f.historico_rede.at(-1).resultado], ["pendente", "falha"]);
  verdade(f.historico_rede.at(-1).detalhe.includes("QuotaExceededError"), f.historico_rede.at(-1).detalhe);
  igual(await arquivos(), [nome1], "arquivo incompleto removido"); igual(f.conteudo, f2.conteudo, "dados preservados");
  await situacaoBloco(); verdade((await js(`document.querySelector("#fe-rede-detalhe").textContent`)).includes("pendente ou com erro"), "estado com erro");
  verdade((await js(`document.querySelector("tr[data-f] .c-rede").textContent`)).includes("Pendente"), "linha pendente com o erro");
  await ls("__falharGravacao", null); await clicar("#fe-rede-exportar"); await aguardarExport(f2.id, 2);
  igual((await fech()).exportacao_rede.status, "exportado", "nova tentativa grava (sem falso conflito)"); igual((await arquivos()).length, 2);
  await foto("r4-falha-e-repeticao");
});
await teste("3. Atualizar a página (F5): a pasta é recuperada do IndexedDB e a exportação segue sem abrir o seletor", async () => {
  await pg.cmd("Page.reload", {}); await espera(300); await pg.aguardar("document.readyState === 'complete' && document.body.dataset.pronto === '1'");
  igual(await abrirFechamento(), "configurada"); const f3 = await diaComCallback("OPR2", "900503"); await reabrirFechamento();
  await clicar("#fe-rede-exportar"); await aguardarExport(f3.id, 1);
  igual([await js("window.__nPasta"), (await fech()).exportacao_rede.status, (await arquivos()).length], [0, "exportado", 3]);
});
await teste("4. Fechar e reabrir o navegador (mesmo perfil): pasta recuperada, nenhum seletor, nenhuma exportação perdida", async () => {
  await nav.fechar(); nav = await abrirNavegador({ exe, perfil }); await abrir();
  igual(await abrirFechamento(), "configurada"); igual(await js("window.__nPasta"), 0);
  igual(await js(`${S}.E.fechamentos.map((f) => f.exportacao_rede && f.exportacao_rede.status)`), ["exportado", "exportado", "exportado"]);
});
await teste("5. Permissão revogada: mostra Permissão necessária; pede autorização só no clique; negada não marca nada", async () => {
  const f4 = await diaComCallback("OPR2", "900504"); await ls("__revogada", "1"); igual(await reabrirFechamento(), "permissao");
  igual(await js(`[document.querySelector("#fe-rede-estado").textContent, document.querySelector("#fe-rede-autorizar").classList.contains("oculto"), window.__pedidos]`), ["Permissão necessária", false, 0], "sem pedido automático");
  await foto("r5-permissao");
  await ls("__negar", "1"); await clicar("#fe-rede-exportar"); await pg.aguardar(`document.querySelector("#toast").textContent.includes("não foi autorizada")`);
  const neg = await fech(); igual([await js("window.__pedidos"), neg.exportacao_rede.status, neg.historico_rede.map((r) => [r.resultado, r.operador]), (await arquivos()).length], [1, "pendente", [["falha", "OPR2"]], 3], "nada exportado; tentativa registrada");
  await ls("__negar", null); await clicar("#fe-rede-exportar"); await aguardarExport(f4.id, 2);
  igual([await js("window.__pedidos"), (await fech()).exportacao_rede.status, await situacaoBloco(), await js("window.__nPasta")], [2, "exportado", "configurada", 0]);
});
await teste("6. Pasta indisponível (como W: desconectada): estado Pasta indisponível, erro registrado, dados intactos; volta sozinha ao reconectar", async () => {
  const f5 = await diaComCallback("OPR2", "900505"); const guardados = {};
  for (const n of await arquivos()) guardados[n] = await lerArq(n);
  await js(`(async () => { const r = await navigator.storage.getDirectory(); await r.removeEntry("central-callback", { recursive: true }); return true; })()`);
  igual(await reabrirFechamento(), "indisponivel"); verdade((await js(`document.querySelector("#fe-rede-detalhe").textContent`)).includes("unidade W:"), "orienta sobre a unidade W:");
  await foto("r6-indisponivel");
  await clicar("#fe-rede-exportar"); await pg.aguardar(`document.querySelector("#toast").textContent.includes("Nada foi marcado como exportado")`);
  const ind = await fech(); igual([ind.exportacao_rede.status, ind.historico_rede.at(-1).resultado, ind.conteudo], ["pendente", "falha", f5.conteudo], "não marca, registra a falha e não perde dados");
  verdade(ind.historico_rede.at(-1).detalhe.includes("NotFoundError"), ind.historico_rede.at(-1).detalhe);
  for (const [n, t] of Object.entries(guardados)) await escreverArq(n, t); // a unidade "volta"
  igual(await reabrirFechamento(), "configurada"); await clicar("#fe-rede-exportar"); await aguardarExport(f5.id, 2);
  igual([(await fech()).exportacao_rede.status, (await arquivos()).length, await js("window.__nPasta")], ["exportado", 5, 0]);
});
await teste("7. Reexportar o mesmo fechamento: idêntico não regrava; apagado é gravado de novo; diferente NÃO é sobrescrito", async () => {
  await reabrirFechamento(); const id = f1.id, n0 = (await js(`${S}.fechamento(${JSON.stringify(id)}).historico_rede.length`));
  const reexportar = async (n) => { await clicar(`[data-exportar-rede="${id}"]`); await pg.aguardar("!!document.querySelector('#modal [data-escolha]')"); verdade((await textoModal()).includes("já foi exportado"), "pede confirmação"); await clicarEscolha("Conferir e exportar"); await aguardarExport(id, n); await situacaoBloco(); return js(`${S}.fechamento(${JSON.stringify(id)}).historico_rede.at(-1)`); };
  igual((await reexportar(n0 + 1)).resultado, "ja_estava_na_pasta"); igual(await lerArq(nome1), f1.conteudo);
  await pasta(`await d.removeEntry(${JSON.stringify(nome1)}); return true;`); igual((await reexportar(n0 + 2)).resultado, "exportado"); igual(await lerArq(nome1), f1.conteudo, "regravado");
  await escreverArq(nome1, "editado por alguém"); const r = await reexportar(n0 + 3);
  igual([r.resultado, await lerArq(nome1)], ["conflito", "editado por alguém"], "não sobrescreve");
  igual(await js(`${S}.fechamento(${JSON.stringify(id)}).exportacao_rede.status`), "exportado", "a exportação confirmada antes não é apagada");
  verdade((await toast()).includes("NÃO exportado"), "avisa o conflito");
  await escreverArq(nome1, f1.conteudo);
  await clicar(`[data-exportar-rede="${id}"]`); await pg.aguardar("!!document.querySelector('#modal [data-escolha]')"); await clicarEscolha("Cancelar"); await situacaoBloco();
  igual(await js(`${S}.fechamento(${JSON.stringify(id)}).historico_rede.length`), n0 + 3, "cancelar não registra tentativa");
});
await teste("8 (parcial). Duas instalações com operadores diferentes gravando na MESMA pasta: nomes distintos, nada sobrescrito", async () => {
  const antes = await arquivos(), conteudos = {}; for (const n of antes) conteudos[n] = await lerArq(n);
  await abrir(bd + "b"); igual(await abrirFechamento(), "nao_configurada", "outra instalação começa sem pasta");
  const g = await diaComCallback("OPB9", "900601"); await reabrirFechamento(); await clicar("#fe-rede-configurar"); await pg.aguardar(`document.querySelector("#toast").textContent.includes("configurada e testada")`);
  await clicar("#fe-rede-exportar"); await aguardarExport(g.id, 1);
  const novo = (await fech()).exportacao_rede.arquivo, depois = await arquivos();
  verdade(/_OP-OPB9\.csv$/.test(novo) && !antes.includes(novo), novo); igual(depois.length, antes.length + 1);
  verdade(novo.split("_PC")[1].slice(0, 8) !== nome1.split("_PC")[1].slice(0, 8), "identificação do computador diferente");
  for (const n of antes) igual(await lerArq(n), conteudos[n], "arquivo da outra instalação intacto: " + n);
});
/* ---------------- ENCERRAR O DIA com a pasta de rede como destino principal (banco novo: começa sem pasta configurada) */
const bdE = bd + "enc";
const turnoComCallback = (op, inc) => js(`(async () => { const s = ${S}; if (!s.E.config.polo) { const f = document.querySelector("#form-dia"); f.operador.value = "${op}"; f.polo.value = "Aracaju"; f.requestSubmit(); await new Promise((r) => setTimeout(r, 600)); }
  if (!s.sessao()) await s.abrirSessao("", "${op}");
  if ("${inc}") { const a = await s.abrirCallbackManual({ incidente: "${inc}", telefone: "79991000902", modo: "padronizada", modelo: "manual_falta_energia" }); await s.confirmarEnvioManual(a.item.id, "enviado"); }
  await window.CentralUI.recarregar(); return true; })()`);
const encerrarPelaTela = async () => {
  await pg.aguardar("!document.querySelector('#btn-encerrar-dia').disabled"); await clicar("#btn-encerrar-dia"); await pg.aguardar("!!document.querySelector('#m-sim')");
  igual(await js("document.querySelector('#m-sim').textContent"), "Encerrar e exportar para a pasta de rede");
  verdade(!/Drive/.test(await textoModal()), "a confirmação não fala em Drive"); await clicar("#m-sim");
};
const modalCom = (t) => pg.aguardar(`document.querySelector("#modal-caixa").textContent.includes(${JSON.stringify(t)})`, 20000);
const chamadasDrive = () => js("[window.__drive, ...window.__rede.filter((u) => /api\\/(fechamento|drive)|googleapis/.test(u))]");
const fotoFechamentos = () => js(`JSON.stringify(${S}.E.fechamentos.map((f) => [f.id, f.nome, f.conteudo, f.sha256, f.versao, f.status, f.drive_id || null]))`);
let antigo;
await teste("Encerramento 7 (preparação). Fechamento antigo já enviado ao Drive fica preservado e visível", async () => {
  await abrir(bdE);
  antigo = { id: "antigo-drive-1", data: "2026-10-01", polo: "Aracaju", versao: 1, nome: "fechamento_callbacks_2026-10-01_ARACAJU.csv", conteudo: "﻿data;polo;operador;callbacks_realizados;incidentes_resolvidos;incidentes_cancelados;versao\r\n2026-10-01;Aracaju;OLD1;2;0;0;1\r\n2026-10-01;TOTAL;TOTAL;2;0;0;1\r\n",
    sha256: "x", assinatura: "x", gerado_em: "2026-10-01T22:00:00.000Z", gerado_por: "OLD1", motivo: null, substitui: null, status: "enviado", drive_id: "drive-antigo", enviado_em: "2026-10-01T22:01:00.000Z", erro: null, caminho_drive: "FECHAMENTOS/2026/10-OUTUBRO", historico_envio: [{ em: "2026-10-01T22:01:00.000Z", resultado: "enviado" }] };
  await js(`${S}._alterar((E) => { E.fechamentos.push(${JSON.stringify(antigo)}); }).then(() => true)`);
  igual(await abrirFechamento(), "nao_configurada");
  const linha = await js(`document.querySelector('tr[data-f="antigo-drive-1"]').textContent`); verdade(linha.includes("Salvo no Drive") && linha.includes("01/10/2026"), linha);
  await reabrirFechamento(); await js(`(document.querySelector("#modal").classList.add("oculto"), true)`);
});
let fA;
await teste("Encerramento 2. Sem pasta configurada: fechamento realizado e guardado, NÃO exportado, orienta a configurar", async () => {
  await turnoComCallback("OPE1", "900701"); await encerrarPelaTela(); await modalCom("NÃO exportado");
  const m = await textoModal(); verdade(m.includes("não foi configurada") && m.includes(CONFIG_TESTE.pasta_rede) && m.includes("pendente"), m);
  verdade(!/concluído/i.test(m) && !/Drive/.test(m), "sem sucesso e sem Drive"); await foto("e2-sem-pasta");
  fA = await fech(); verdade(fA && fA.data !== "2026-10-01" && !fA.exportacao_rede, "gerado, sem exportação registrada");
  await clicarEscolha("Depois"); igual(await js("window.__nPasta"), 0, "o seletor só abre se o operador pedir");
});
await teste("Encerramento 1. Pasta configurada e autorizada: grava, confere e só então mostra Fechamento concluído (inclui a versão pendente do dia)", async () => {
  await turnoComCallback("OPE2", "900702"); await encerrarPelaTela(); await modalCom("NÃO exportado"); await clicarEscolha("Configurar pasta agora");
  await modalCom("Fechamento concluído"); const m = await textoModal(), f = await fech();
  igual([fA.exportacao_rede, f.versao], [undefined, 2]);
  const v1 = await js(`${S}.fechamento(${JSON.stringify(fA.id)}).exportacao_rede.arquivo`), v2 = f.exportacao_rede.arquivo;
  verdade(m.includes(v1) && m.includes(v2) && m.includes("conferido"), m); verdade(/_OP-OPE2_v2\.csv$/.test(v2), v2);
  igual([await lerArq(v1), await lerArq(v2)], [fA.conteudo, f.conteudo], "arquivos reais na pasta, idênticos aos fechamentos");
  await foto("e1-concluido"); await clicarEscolha("OK");
  await turnoComCallback("OPE3", "900703"); await encerrarPelaTela(); await modalCom("Fechamento concluído");
  const f3 = await fech(); igual([f3.exportacao_rede.status, f3.exportacao_rede.operador, await lerArq(f3.exportacao_rede.arquivo) === f3.conteudo], ["exportado", "OPE3", true]);
  igual(await js("window.__nPasta"), 1, "sem novo seletor"); await clicarEscolha("OK");
});
await teste("Encerramento 3. Permissão revogada: pede autorização; negada = NÃO exportado com Autorizar e exportar; autorizada = concluído", async () => {
  await turnoComCallback("OPE4", "900704"); await ls("__revogada", "1"); await ls("__negar", "1"); await encerrarPelaTela();
  await modalCom("NÃO exportado"); verdade((await textoModal()).includes("renovar a autorização"), await textoModal()); await foto("e3-permissao");
  const f = await fech(); igual([f.exportacao_rede.status, f.historico_rede.at(-1).resultado], ["pendente", "falha"]);
  await ls("__negar", null); await clicarEscolha("Autorizar e exportar"); await modalCom("Fechamento concluído");
  igual((await fech()).exportacao_rede.status, "exportado"); await clicarEscolha("OK");
});
await teste("Encerramento 4. W: indisponível: fechamento realizado, NÃO exportado, pendente registrado, nada apagado; Tentar novamente após reconectar", async () => {
  await turnoComCallback("OPE5", "900705"); const guardados = {}; for (const n of await arquivos()) guardados[n] = await lerArq(n);
  await js(`(async () => { const r = await navigator.storage.getDirectory(); await r.removeEntry("central-callback", { recursive: true }); return true; })()`);
  const antes = await fotoFechamentos(); await encerrarPelaTela(); await modalCom("NÃO exportado");
  const m = await textoModal(); verdade(m.includes("unidade W:") && m.includes("Nenhum dado foi apagado") && !/concluído/i.test(m), m); await foto("e4-indisponivel");
  const f = await fech(); igual([f.exportacao_rede.status, f.historico_rede.at(-1).resultado, f.historico_rede.at(-1).operador], ["pendente", "falha", "OPE5"]);
  igual(JSON.parse(await fotoFechamentos()).slice(0, -1), JSON.parse(antes), "fechamentos anteriores intactos");
  await clicarEscolha("Tentar novamente"); await pg.aguardar(`(${S}.E.fechamentos.at(-1).historico_rede || []).length === 2 && !!document.querySelector("#modal [data-escolha]")`); await modalCom("NÃO exportado");
  for (const [n, t] of Object.entries(guardados)) await escreverArq(n, t);
  await clicarEscolha("Tentar novamente"); await modalCom("Fechamento concluído"); igual((await fech()).exportacao_rede.status, "exportado"); await clicarEscolha("OK");
  await abrirFechamento(); verdade((await js(`document.querySelector("#fe-rede-detalhe").textContent`)).includes("Exportação concluída"), "nada pendente"); await js(`(document.querySelector("#modal").classList.add("oculto"), true)`);
});
await teste("Encerramento 5. Repetição: encerrar de novo sem dados novos não cria versão nem regrava; o arquivo continua único", async () => {
  const n0 = (await arquivos()).length, k0 = await js(`${S}.E.fechamentos.length`);
  await turnoComCallback("OPE6", ""); await encerrarPelaTela(); await modalCom("Fechamento concluído"); verdade((await textoModal()).includes("já está na pasta"), await textoModal());
  igual([(await arquivos()).length, await js(`${S}.E.fechamentos.length`)], [n0, k0]); await clicarEscolha("OK");
});
await teste("Encerramento 6 e 7. Fechamentos guardados na Central depois de F5; o antigo do Drive segue intacto, visível e não é exportado", async () => {
  igual(await chamadasDrive(), [0], "nenhuma chamada ao Drive/gateway em todos os encerramentos acima");
  const antes = await fotoFechamentos();
  await pg.cmd("Page.reload", {}); await espera(300); await pg.aguardar("document.readyState === 'complete' && document.body.dataset.pronto === '1'");
  igual(await fotoFechamentos(), antes, "IndexedDB preservado");
  const a = await js(`JSON.parse(JSON.stringify(${S}.fechamento("antigo-drive-1")))`);
  igual([a.conteudo, a.status, a.drive_id, a.caminho_drive, a.historico_envio.length, a.exportacao_rede], [antigo.conteudo, "enviado", "drive-antigo", "FECHAMENTOS/2026/10-OUTUBRO", 1, undefined]);
  verdade(!(await arquivos()).some((n) => n.includes("2026-10-01")), "o encerramento não exporta fechamentos de outros dias");
  igual(await abrirFechamento(), "configurada"); const linha = await js(`document.querySelector('tr[data-f="antigo-drive-1"]').textContent`);
  verdade(linha.includes("Salvo no Drive") && linha.includes("Não exportado") && linha.includes("já salvo no Google Drive") && !linha.includes("Pendente"), linha); await foto("e6-historico");
  await js(`(document.querySelector("#modal").classList.add("oculto"), document.querySelector("details") && [...document.querySelectorAll("details")].forEach((d) => d.open = true), true)`);
  verdade((await js(`document.querySelector("#lista-exportacoes").textContent`)).includes("Google Drive: salvo em FECHAMENTOS/2026/10-OUTUBRO"), "histórico antigo do Drive na lista");
});
await teste("Encerramento 8. Nenhuma chamada ao Google Drive/gateway no encerramento nem ao abrir a Central; o envio ao Drive é só o botão opcional", async () => {
  igual(await chamadasDrive(), [0], "sem chamadas desde o último F5 (abertura da Central)");
  await abrirFechamento(); igual(await js(`document.querySelector("#fe-tentar").textContent`), "Enviar ao Google Drive (opcional)");
  await clicar("#fe-tentar"); await pg.aguardar(`document.querySelector("#toast").textContent.includes("Google Drive")`);
  verdade((await chamadasDrive())[0] > 0, "o botão opcional ainda usa a integração do Drive");
});
await teste("Sem a API (ex.: Firefox): Navegador sem suporte, botões desabilitados, nada é simulado", async () => {
  const p = await nav.novaPagina(); await p.cmd("Page.addScriptToEvaluateOnNewDocument", { source: "delete window.showDirectoryPicker; window.showDirectoryPicker = undefined;" });
  await p.ir(`${base}?bd=${bd}`); await p.aguardar("document.body.dataset.pronto === '1'"); await p.js(`(document.querySelector("#btn-fechamento").click(), true)`);
  await p.aguardar(`(() => { const e = document.querySelector("#fe-rede"); return !!e && e.dataset.situacao !== "verificando"; })()`);
  igual(await p.js(`[document.querySelector("#fe-rede").dataset.situacao, document.querySelector("#fe-rede-exportar").disabled, document.querySelector("#fe-rede-configurar").disabled]`), ["sem_suporte", true, true]);
});
await teste("Sem erros de JavaScript na página", async () => { igual(pg.erros, []); });

await nav.fechar(); try { rmSync(perfil, { recursive: true, force: true }); } catch { /* perfil em uso */ }
const falhas = resultados.filter((r) => !r[0]);
console.log(`\n${resultados.length - falhas.length}/${resultados.length} testes de exportação para a pasta de rede passaram.`);
process.exit(falhas.length ? 1 : 0);
