/* Testes PONTA A PONTA da CONEXÃO com o ADMS (js/pasta-adms.js): seleção por arquivo, persistência do identificador,
   reabertura COMPLETA do navegador (mesmo perfil), renovação da autorização, falha de acesso, diagnóstico e datas.
   Uso: node testes\ponta-a-ponta\e2e-adms-conexao.mjs [caminho-do-navegador]

   O QUE É REAL E O QUE É SIMULADO (importante para não confundir com o teste na rede da Energisa):
   - REAL: navegador Chromium/Edge sem janela, a Central inteira, o IndexedDB (gravação e releitura do identificador), o fechamento
     e a reabertura do navegador com o mesmo perfil, a leitura do arquivo pelo identificador, a origem http://127.0.0.1.
   - SIMULADO: as janelas nativas "Selecionar pasta/arquivo" (não automatizáveis) devolvem uma pasta/arquivo REAL da área privada do
     navegador (OPFS); a permissão "expirada" é simulada (no OPFS o navegador sempre concede); "rede fora" = arquivo removido.
   - NÃO TESTADO AQUI: compartilhamento de rede real, política do Edge corporativo e a opção "Permitir em todas as visitas".
     Isso só o teste na máquina da Energisa confirma (roteiro em docs\PASTA-ADMS.txt). */
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { abrirNavegador, espera, CONFIG_TESTE } from "./cdp.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const EXE = process.argv[2];
const resultados = [];
async function teste(nome, f) {
  try { await f(); resultados.push([true, nome]); console.log("OK    " + nome); }
  catch (e) { resultados.push([false, nome, e.message]); console.log("FALHA " + nome + " — " + e.message); }
}
const verdade = (c, m) => { if (!c) throw new Error(m || "condição falsa"); };
const igual = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || "esperado"}: ${JSON.stringify(b)}, obtido: ${JSON.stringify(a)}`); };

const CSV1 = readFileSync(join(raiz, "exemplos", "navegador-chamadas-ADMS2026-FICTICIO.csv"), "utf8");
const linhas = CSV1.replace(/\r?\n$/, "").split(/\r?\n/), cab = linhas.findIndex((l) => l.includes('"ID"') && l.includes('"Horário da call"'));
const colId = linhas[cab].split(";").indexOf('"ID"'), ultima = linhas[linhas.length - 1].split(";"); ultima[colId] = '"9999101"';
const CSV2 = linhas.concat([ultima.join(";")]).join("\r\n") + "\r\n";
const ultima3 = [...ultima]; ultima3[colId] = '"9999102"';
const CSV3 = linhas.concat([ultima.join(";"), ultima3.join(";")]).join("\r\n") + "\r\n"; // versão nova para o "Verificar agora"
const CAMINHO_PADRAO = "\\\\fs-bi\\ESE\\DTEC\\DEOP\\ADMS"; // fixo em js/pasta-adms.js
// Mesmo conteúdo do CSV2, datas no formato ISO com milissegundos (como costuma sair de exportação automática).
const CSV2_ISO = CSV2.replace(/"(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})"/g, '"$3-$2-$1 $4:$5:$6.000"');
verdade(CSV2_ISO !== CSV2 && /"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.000"/.test(CSV2_ISO), "montagem do CSV ISO");

/* Antes dos scripts da Central em toda carga: janelas nativas e permissão simuladas, vigilância de leituras. */
const INICIO = `(() => {
  window.__lidos = []; window.__nPasta = 0; window.__nArquivo = 0;
  const pastaADMS = async () => (await navigator.storage.getDirectory()).getDirectoryHandle("ADMS", { create: true });
  window.showDirectoryPicker = async () => { window.__nPasta++; return pastaADMS(); };
  window.showOpenFilePicker = async () => { window.__nArquivo++; const nome = localStorage.getItem("__arquivoEscolhido") || "chamadas_incidentes.csv"; return [await (await pastaADMS()).getFileHandle(nome)]; };
  const F = FileSystemHandle.prototype, B = Blob.prototype;
  for (const k of ["arrayBuffer", "text", "stream"]) { const o = B[k]; B[k] = function () { if (this.name) window.__lidos.push(this.name); return o.call(this); }; }
  // expirada: pelo localStorage (mesma sessão) ou pela URL (reabertura: o localStorage pode não ter chegado ao disco ao fechar)
  const q = F.queryPermission; F.queryPermission = function (op) { return (localStorage.getItem("__revogada") === "1" || (location.search.includes("revogada=1") && !sessionStorage.getItem("__concedida"))) ? Promise.resolve("prompt") : q.call(this, op); };
  F.requestPermission = function () { localStorage.removeItem("__revogada"); sessionStorage.setItem("__concedida", "1"); /* como no navegador: a concessão vale para a aba, inclusive no F5 */ window.__pedidoPermissao = (window.__pedidoPermissao || 0) + 1; return Promise.resolve("granted"); };
})();`;

/* Uma "sessão de navegador" com perfil FIXO: fechar e abrir de novo mantém IndexedDB, OPFS e localStorage, como o Edge real. */
async function navegador(perfil, url) {
  const nav = await abrirNavegador({ exe: EXE, perfil });
  const pg = await nav.novaPagina();
  await pg.cmd("Page.addScriptToEvaluateOnNewDocument", { source: INICIO });
  await pg.ir(url);
  await pg.aguardar("document.body.dataset.pronto === '1'");
  const js = (e) => pg.js(e);
  const h = {
    nav, pg, js,
    clicar: (sel) => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) throw new Error("não achei ${sel.replace(/"/g, "'")}"); e.click(); return true; })()`),
    situacao: () => js(`document.querySelector("#pasta-adms").dataset.situacao || ""`),
    texto: () => js(`document.querySelector("#pasta-adms").textContent`),
    caminhoPadrao: () => js(`(() => { const e = document.querySelector("#pasta-adms [data-adms-caminho]"); return e ? e.textContent : null; })()`),
    temBotao: (acao) => js(`!!document.querySelector('#pasta-adms [data-adms="${acao}"]')`),
    aguardarSituacao: async (ms = 20000) => { await pg.aguardar(`(() => { const s = document.querySelector("#pasta-adms").dataset.situacao; return !!s && s !== "iniciando" && s !== "verificando"; })()`, ms); return h.situacao(); },
    f5: async () => { await pg.cmd("Page.reload", {}); await espera(300); await pg.aguardar("document.readyState === 'complete' && document.body.dataset.pronto === '1'"); return h.aguardarSituacao(); },
    opfs: (corpo) => js(`(async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle("ADMS", { create: true }); ${corpo} })()`),
    escrever: (nome, t) => h.opfs(`const w = await (await d.getFileHandle(${JSON.stringify(nome)}, { create: true })).createWritable(); await w.write(${JSON.stringify(t)}); await w.close(); return true;`),
    apagar: (nome) => h.opfs(`await d.removeEntry(${JSON.stringify(nome)}); return true;`),
    info: () => js(`(() => { const s = window.CentralUI.servico, e = s.estado(); return { lotes: e.lotes.map((l) => [l.numero, l.situacao, l.origem || "manual", l.atualizacoes || 0]), chamadas: s.chamadas().length, datas: s.chamadas().map((c) => [c.call_id, c.horario_call]).sort() }; })()`),
    diagnostico: () => js(`window.CentralPastaADMS.diagnostico()`),
    abrirTurno: () => js(`(() => { const f = document.querySelector("#form-dia"); f.operador.value = "adm9"; if (f.polo) f.polo.value = "Aracaju"; f.requestSubmit(); return true; })()`),
    fechar: () => nav.fechar(),
  };
  return h;
}

const perfilFile = mkdtempSync(join(tmpdir(), "central-adms-file-")), urlFile = pathToFileURL(join(raiz, "index.html")).href + "?bd=e2econ";
let b = await navegador(perfilFile, urlFile);
await b.opfs(`for await (const [n] of d.entries()) await d.removeEntry(n, { recursive: true }); return true;`);
await b.escrever("chamadas_incidentes.csv", CSV1); await b.escrever("relatorio_outro.csv", '"ID";"X"\r\n"1";"nao deve ser lido"\r\n');
const nCSV1 = await b.js(`window.Nucleo.analisar(new TextEncoder().encode(${JSON.stringify(CSV1)})).validas.length`);

await teste("[file://] Sem conexão: oferece pasta E arquivo; Diagnóstico disponível", async () => {
  igual(await b.aguardarSituacao(), "sem_pasta");
  const t = await b.texto();
  verdade(t.includes("Selecionar pasta") && t.includes("Selecionar arquivo") && t.includes("Diagnóstico"), t);
  verdade(t.includes(CAMINHO_PADRAO), "caminho configurado na faixa");
});
await teste("[file://] Primeiro acesso: caminho padrão apresentado; Copiar caminho não abre janela, não lê e não grava conexão", async () => {
  igual(await b.caminhoPadrao(), CAMINHO_PADRAO, "caminho padrão na faixa");
  verdade(await b.temBotao("copiar") && await b.temBotao("selecionar") && await b.temBotao("arquivo"), "botões do primeiro acesso");
  verdade((await b.texto()).includes("cole o caminho na janela"), await b.texto());
  verdade(await b.js("document.querySelector('#pasta-adms').getBoundingClientRect().height <= 60"), "indicador continua discreto");
  await b.clicar('#pasta-adms [data-adms="copiar"]'); await espera(300);
  verdade((await b.js(`document.querySelector("#toast").textContent`)).includes("Selecionar pasta"), "orientação ao copiar");
  igual(await b.js("[window.__nPasta, window.__nArquivo, window.__lidos.length]"), [0, 0, 0], "nada aberto nem lido");
  igual(await b.js(`window.CentralUI.servico.arm.lerArquivo("pasta_adms").then((h) => h || null)`), null, "nenhuma conexão gravada pelo caminho padrão");
  igual(await b.situacao(), "sem_pasta");
});
await teste("[file://] Selecionar arquivo com outro nome: recusa e não conecta nada", async () => {
  await b.js(`(localStorage.setItem("__arquivoEscolhido", "relatorio_outro.csv"), true)`);
  await b.clicar('#pasta-adms [data-adms="arquivo"]'); await espera(500);
  igual(await b.situacao(), "sem_pasta"); verdade((await b.js(`document.querySelector("#toast").textContent`)).includes("chamadas_incidentes.csv"), "aviso do nome");
  igual(await b.js("window.__lidos"), [], "nada lido");
  await b.js(`(localStorage.removeItem("__arquivoEscolhido"), true)`);
});
await teste("[file://] Selecionar arquivo chamadas_incidentes.csv: conecta, confirma a gravação no IndexedDB e aguarda o turno", async () => {
  await b.clicar('#pasta-adms [data-adms="arquivo"]');
  await b.pg.aguardar(`document.querySelector("#pasta-adms").dataset.situacao === "aguardando_turno"`);
  igual(await b.js(`document.querySelector("#pasta-adms").dataset.conexao`), "file");
  igual(await b.js(`window.CentralUI.servico.arm.lerArquivo("pasta_adms").then((h) => h && h.kind + ":" + h.name)`), "file:chamadas_incidentes.csv", "identificador no IndexedDB");
  verdade((await b.diagnostico()).includes("Gravação confirmada no IndexedDB (última seleção nesta página): true"), "gravação confirmada");
  verdade(!(await b.js(`!!document.querySelector("[data-adms-alerta]")`)), "sem alerta de não guardado");
  igual([await b.caminhoPadrao(), await b.temBotao("copiar")], [null, true], "conectado: caminho padrão não aparece mais (Copiar caminho continua disponível)");
});
await teste("[file://] Autorização expirada: mensagem clara, nenhuma janela abre sozinha; o clique em Abrir o turno renova e carrega", async () => {
  await b.js(`(localStorage.setItem("__revogada", "1"), true)`);
  igual(await b.f5(), "permissao");
  const t = await b.texto();
  verdade(t.includes("Renovar autorização") && t.includes("não é preciso selecionar de novo"), t);
  igual(await b.js("[window.__nPasta, window.__nArquivo, window.__pedidoPermissao || 0, window.__lidos.length]"), [0, 0, 0, 0], "nada automático");
  await b.abrirTurno();
  await b.pg.aguardar(`document.querySelector("#pasta-adms").dataset.situacao === "atualizado"`, 20000);
  igual(await b.js("[window.__nPasta, window.__nArquivo, window.__pedidoPermissao]"), [0, 0, 1], "uma permissão pedida no clique, sem seleção");
  const i = await b.info(); igual(i.lotes, [[1, "aberto", "pasta_adms", 0]]); igual(i.chamadas, nCSV1);
});
await teste("[file://] Datas: todas as chamadas com a data/hora original do ADMS (nenhuma vazia, nenhuma inventada)", async () => {
  const i = await b.info(); verdade(i.datas.every(([, d]) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(d || "")), "horário ausente");
  const esperado = await b.js(`window.Nucleo.analisar(new TextEncoder().encode(${JSON.stringify(CSV1)})).validas.map((v) => [v.call_id, v.horario_call]).sort()`);
  igual(i.datas, esperado, "mesmas datas do arquivo");
  await b.pg.aguardar("document.querySelectorAll('#linhas td.data-hora').length > 0");
  verdade(await b.js(`[...document.querySelectorAll("#linhas td.data-hora")].every((td) => /^\\d{2}\\/\\d{2}\\/\\d{4} \\d{2}:\\d{2}:\\d{2}$/.test(td.textContent.trim()))`), "coluna Data e hora na tela");
});
await teste("[file://] F5 sem alteração: não relê nem duplica", async () => {
  igual(await b.f5(), "sem_alteracoes"); igual(await b.js("window.__lidos"), []); igual((await b.info()).chamadas, nCSV1);
});
await teste("[file://] Reabertura COMPLETA do navegador: conexão recuperada do IndexedDB, sem nova seleção", async () => {
  await b.fechar(); b = await navegador(perfilFile, urlFile);
  igual(await b.aguardarSituacao(), "sem_alteracoes");
  igual(await b.js("[window.__nPasta, window.__nArquivo, window.__lidos.length]"), [0, 0, 0], "sem seleção e sem leitura");
  const d = await b.diagnostico();
  verdade(d.includes(`Ao abrir a página: file "chamadas_incidentes.csv" encontrada no IndexedDB`) && d.includes("Permissão ao abrir: granted"), d);
  igual((await b.info()).chamadas, nCSV1, "turno e lote preservados");
  igual([await b.caminhoPadrao(), await b.temBotao("copiar")], [null, true], "conexão guardada: caminho padrão não a substitui (Copiar caminho continua disponível)");
  igual(await b.js(`window.CentralUI.servico.arm.lerArquivo("pasta_adms").then((h) => h && h.kind + ":" + h.name)`), "file:chamadas_incidentes.csv", "mesma conexão no IndexedDB");
});
await teste("[file://] Reabertura com autorização expirada: pede renovação (um clique), sem selecionar de novo", async () => {
  await b.fechar(); b = await navegador(perfilFile, urlFile + "&revogada=1");
  igual(await b.aguardarSituacao(), "permissao");
  verdade((await b.diagnostico()).includes("Permissão ao abrir: prompt"), "diagnóstico registra a permissão ao abrir");
  igual([await b.temBotao("reconectar"), await b.caminhoPadrao(), await b.temBotao("copiar")], [true, null, true], "renovação, sem caminho padrão (Copiar caminho disponível)");
  await b.clicar('#pasta-adms [data-adms="reconectar"]');
  igual(await b.aguardarSituacao(), "sem_alteracoes");
  igual(await b.js("[window.__nPasta, window.__nArquivo, window.__pedidoPermissao]"), [0, 0, 1]);
});
await teste("[file://] Arquivo alterado: carrega a versão nova sem duplicar; datas ISO com milissegundos dão o mesmo horário", async () => {
  await b.escrever("chamadas_incidentes.csv", CSV2);
  igual(await b.f5(), "atualizado"); const i2 = await b.info(); igual(i2.chamadas, nCSV1 + 1); igual(new Set(i2.datas.map((x) => x[0])).size, i2.datas.length, "CALL duplicada");
  await b.escrever("chamadas_incidentes.csv", CSV2_ISO);
  igual(await b.f5(), "atualizado", "conteúdo diferente (só o formato da data mudou)");
  const i3 = await b.info(); igual(i3.chamadas, nCSV1 + 1, "não duplicou"); igual(i3.datas, i2.datas, "mesmos horários com datas ISO");
  const d = await b.diagnostico();
  verdade(/Data "Horário da call" \(horario_call\): (\d+) reconhecida\(s\) de \1, 0 vazia\(s\)/.test(d), d);
});
await teste("[file://] Falha de acesso (arquivo/rede indisponível): avisa sem travar; volta sozinho no F5 seguinte", async () => {
  await b.apagar("chamadas_incidentes.csv");
  igual(await b.f5(), "pasta_indisponivel");
  const t = await b.texto(); verdade(t.includes("inacessível") && t.includes("importação manual"), t);
  verdade(await b.js("document.querySelectorAll('#linhas tr[data-id]').length > 0"), "Central continua utilizável");
  verdade((await b.diagnostico()).includes("NotFoundError"), "erro registrado no diagnóstico");
  await b.escrever("chamadas_incidentes.csv", CSV2_ISO);
  igual(await b.f5(), "sem_alteracoes");
});
await teste("[file://] Navegador que não guarda a conexão: avisa claramente em vez de esquecer calado", async () => {
  await b.js(`(() => { const a = window.CentralUI.servico.arm, g = a.gravarArquivo.bind(a); a.gravarArquivo = (k, v) => k === "pasta_adms" ? Promise.reject(new DOMException("simulado", "DataCloneError")) : g(k, v); return true; })()`);
  await b.clicar('#pasta-adms [data-adms="arquivo"]');
  await b.pg.aguardar(`!!document.querySelector("[data-adms-alerta]")`);
  verdade((await b.texto()).includes("não guardou a conexão (DataCloneError)"), await b.texto());
  igual(await b.aguardarSituacao(), "sem_alteracoes", "nesta página continua lendo");
  verdade((await b.diagnostico()).includes("Gravação confirmada no IndexedDB (última seleção nesta página): false"));
});
await teste("[file://] Diagnóstico: contexto, conexão, colunas e formatos — sem nenhum dado de cliente", async () => {
  igual(await b.f5(), "sem_alteracoes");
  await b.clicar('#pasta-adms [data-adms="diagnostico"]'); await b.pg.aguardar("!!document.querySelector('#pa-diag-texto')");
  const d = await b.js(`document.querySelector("#pa-diag-texto").value`);
  for (const t of ["[Contexto]", "arquivo LOCAL", "Contexto seguro: true", "APIs: pasta=true arquivo=true", "[Conexão ADMS]", "[CSV — última leitura]", "Horário da call", "[Erros recentes]"]) verdade(d.includes(t), "faltou: " + t);
  const dados = await b.js(`window.Nucleo.analisar(new TextEncoder().encode(${JSON.stringify(CSV1)})).validas.flatMap((v) => [v.nome, v.call_id, v.incidente, v.localizacao, ...v.telefones.map((t) => t.numero)]).filter((x) => x && String(x).length >= 5)`);
  const vazados = dados.filter((x) => d.includes(String(x)));
  igual(vazados, [], "dados de cliente no diagnóstico");
  verdade(!d.includes(urlFile.replace("file:///", "").split("?")[0].slice(0, 20)), "não expõe o caminho de instalação");
  await b.clicar("#pa-diag-fechar");
});
await teste("[file://] Importação manual continua disponível", async () => {
  verdade(await b.js(`!!document.querySelector("#arquivo")`), "campo de importação manual");
});
await teste("[file://] Verificar agora: carrega a versão nova do arquivo sem F5 e sem duplicar", async () => {
  const antes = (await b.info()).chamadas;
  igual(await b.f5(), "sem_alteracoes"); verdade(await b.temBotao("verificar"), "botão Verificar agora");
  await b.escrever("chamadas_incidentes.csv", CSV3);
  await b.clicar('#pasta-adms [data-adms="verificar"]');
  await b.pg.aguardar(`document.querySelector("#pasta-adms").dataset.situacao === "atualizado"`, 20000);
  const i = await b.info(); igual(i.chamadas, antes + 1, "uma CALL nova"); igual(new Set(i.datas.map((x) => x[0])).size, i.datas.length, "CALL duplicada");
  await b.clicar('#pasta-adms [data-adms="verificar"]');
  await b.pg.aguardar(`document.querySelector("#pasta-adms").dataset.situacao === "sem_alteracoes"`, 20000);
  igual((await b.info()).chamadas, antes + 1, "segunda verificação não muda nada");
});
await b.fechar();
try { rmSync(perfilFile, { recursive: true, force: true }); } catch (e) { /* perfil em uso */ }

/* ---------------- origem http://127.0.0.1 (contexto seguro, como uma origem HTTPS interna) — servidor estático deste teste */
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
const servidor = createServer((q, r) => {
  const c = decodeURIComponent(new URL(q.url, "http://x").pathname), f = normalize(join(raiz, c === "/" ? "index.html" : c));
  if (!/^\/(index\.html|css\/[\w.-]+\.css|js\/[\w.-]+\.js)?$/.test(c) || !f.startsWith(raiz + sep) || !existsSync(f) || !statSync(f).isFile()) { r.statusCode = 404; return r.end(); }
  r.setHeader("Content-Type", TIPOS[extname(f)] || "application/octet-stream"); r.end(readFileSync(f));
});
await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok));
const perfilHttp = mkdtempSync(join(tmpdir(), "central-adms-http-")), urlHttp = `http://127.0.0.1:${servidor.address().port}/index.html?bd=e2econhttp`;
b = await navegador(perfilHttp, urlHttp);
await b.opfs(`for await (const [n] of d.entries()) await d.removeEntry(n, { recursive: true }); return true;`);
await b.escrever("chamadas_incidentes.csv", CSV1);
await teste("[http://127.0.0.1] Contexto seguro: seleciona a PASTA uma vez, abre o turno e carrega", async () => {
  igual(await b.js("window.isSecureContext"), true);
  igual(await b.aguardarSituacao(), "sem_pasta");
  igual(await b.caminhoPadrao(), CAMINHO_PADRAO, "primeiro acesso mostra o caminho padrão");
  await b.clicar('#pasta-adms [data-adms="selecionar"]'); await b.pg.aguardar(`document.querySelector("#pasta-adms").dataset.situacao === "aguardando_turno"`);
  igual(await b.caminhoPadrao(), null, "pasta selecionada: caminho padrão some");
  await b.abrirTurno(); await b.pg.aguardar(`document.querySelector("#pasta-adms").dataset.situacao === "atualizado"`, 20000);
  igual((await b.info()).chamadas, nCSV1);
  verdade((await b.diagnostico()).includes("HTTP (127.0.0.1:"), "diagnóstico identifica a origem");
});
await teste("[http://127.0.0.1] Reabertura completa do navegador: pasta recuperada, sem nova seleção nem leitura", async () => {
  await b.fechar(); b = await navegador(perfilHttp, urlHttp);
  igual(await b.aguardarSituacao(), "sem_alteracoes");
  igual(await b.js("[window.__nPasta, window.__nArquivo, window.__lidos.length]"), [0, 0, 0]);
  igual(await b.js(`document.querySelector("#pasta-adms").dataset.conexao`), "directory");
  igual([await b.caminhoPadrao(), await b.temBotao("copiar")], [null, true], "pasta guardada: caminho padrão não aparece (Copiar caminho disponível)");
});
await teste("[http://127.0.0.1] Console sem erros (o favicon.ico é pedido pelo navegador ao servidor de teste)", async () => { igual(b.pg.erros.filter((e) => !e.includes("favicon.ico")), [], "erros"); });
await b.fechar(); servidor.close();
try { rmSync(perfilHttp, { recursive: true, force: true }); } catch (e) { /* perfil em uso */ }

const falhas = resultados.filter((r) => !r[0]).length;
console.log(`\n${resultados.length} testes da conexão ADMS · ${resultados.length - falhas} aprovados · ${falhas} com falha`);
process.exitCode = falhas ? 1 : 0;
