/* Monta uma CÓPIA da Central ligada ao Apps Script. Os arquivos originais do site e o gateway não são alterados.
   Uso: node apps-script/montar-central-teste.mjs <url-do-web-app> <pasta-de-saida> [--producao]
   Para abrir: node apps-script/montar-central-teste.mjs --servir [porta] [pasta]     (só em 127.0.0.1) */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url)), RAIZ = join(AQUI, ".."), PADRAO = join(AQUI, "central-teste");

if (process.argv[2] === "--servir") {
  const porta = Number(process.argv[3] || 8791), base = resolve(process.argv[4] || PADRAO);
  const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml" };
  createServer((q, r) => {
    const c = decodeURIComponent(new URL(q.url, "http://x").pathname), f = normalize(join(base, c === "/" ? "index.html" : c));
    if (q.method !== "GET" || !f.startsWith(base + sep) || !existsSync(f) || !extname(f)) { r.statusCode = 404; return r.end("não encontrado"); }
    r.setHeader("Content-Type", TIPOS[extname(f)] || "application/octet-stream"); r.setHeader("Cache-Control", "no-store"); r.end(readFileSync(f));
  }).listen(porta, "127.0.0.1", () => console.log("Central em http://127.0.0.1:" + porta + "/"));
} else {
  const producao = process.argv.includes("--producao"), args = process.argv.slice(2).filter((a) => a !== "--producao"), url = args[0];
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url || "") || !args[1]) throw new Error("Informe a URL /exec do Web App e a pasta de saída.");
  const saida = resolve(args[1]);
  if (existsSync(saida)) throw new Error("A pasta de saída já existe: nada foi alterado.");
  mkdirSync(saida, { recursive: true });
  for (const p of ["css", "js"]) cpSync(join(RAIZ, p), join(saida, p), { recursive: true });
  cpSync(join(RAIZ, "index.html"), join(saida, "index.html")); // o painel BI integrado (bi.html) foi retirado da Central
  writeFileSync(join(saida, "js", "conector-apps-script.js"), readFileSync(join(AQUI, "conector-apps-script.js"), "utf8"));
  // A URL do Web App fica na configuração LOCAL da cópia (js/config-local.js, ignorada pelo Git), junto com a da raiz, se houver.
  const cfgRaiz = join(RAIZ, "js", "config-local.js");
  writeFileSync(join(saida, "js", "config-local.js"), (existsSync(cfgRaiz) ? readFileSync(cfgRaiz, "utf8") + "\n" : "window.CENTRAL_CONFIG_LOCAL = {};\n")
    + "window.CENTRAL_CONFIG_LOCAL.url_apps_script = " + JSON.stringify(url) + ";\n");

  const CSP = ["connect-src 'self'", "connect-src 'self' https://script.google.com https://script.googleusercontent.com"];
  const CONECTOR = '<script src="js/conector-apps-script.js"></script>\n  ';
  function ajustar(arquivo, trocas) {
    const f = join(saida, arquivo); let t = readFileSync(f, "utf8"); const eol = t.includes("\r\n") ? "\r\n" : "\n";
    for (let [de, para] of trocas) { de = de.replaceAll("\n", eol); para = para.replaceAll("\n", eol); if (t.split(de).length !== 2) throw new Error("Trecho esperado não encontrado em " + arquivo + ": " + de); t = t.replace(de, () => para); }
    writeFileSync(f, t);
  }
  const titulo = (t) => (producao ? [] : [["<title>" + t + "</title>", "<title>[TESTE] " + t + "</title>"]]);
  ajustar("index.html", [CSP, ...titulo("Central de Callback COI"), ['<script src="js/fechamento-ui.js">', CONECTOR + '<script src="js/fechamento-ui.js">']]);
  ajustar("js/app.js", [
    ['e enviado ao <b>Google Drive</b>.\n        Depois disso o turno não recebe mais lotes.</p>`, "Encerrar e enviar ao Drive")', 'e você poderá conferir os números e decidir se envia ao Google Drive.\n        Depois disso o turno não recebe mais lotes.</p>`, "Encerrar o dia")'],
  ]);
  ajustar("js/historico-atendimento.js", [
    ['for (const f of this.E.fechamentos.filter((x) => x.status !== "enviado")) {', 'for (const f of this.E.fechamentos.filter((x) => x.status !== "enviado" && x.status !== "nao_enviado" && x.envio_autorizado === true)) {'],
    ["    listaFechamentos() {", `    /* Decisão do operador antes do envio. Sem autorização, o fechamento fica só neste navegador. */
    decidirEnvioFechamento(id, autorizar) {
      return this._alterar((E) => {
        const x = E.fechamentos.find((y) => y.id === id);
        if (!x) return null;
        x.decisao_envio = { autorizado: !!autorizar, em: agora() };
        if (autorizar) x.envio_autorizado = true; else Object.assign(x, { status: "nao_enviado", envio_autorizado: false, erro: null });
        return x;
      });
    },
    listaFechamentos() {`],
  ]);
  ajustar("js/fechamento-ui.js", [
    ["/* Fechamento diário: gera os arquivos agregados e envia ao Drive pelo gateway. Sem gateway, ficam pendentes na Central. */", "/* Fechamento diário: gera os arquivos agregados e, com a confirmação do operador, envia ao Drive. Sem internet, ficam pendentes na Central. */"],
    ["new window.Disparos.ConectorGateway()", "new window.ConectorAppsScript()"],
    ['falha: ["Falha", "e-contato_invalido"] };', 'falha: ["Falha", "e-contato_invalido"], nao_enviado: ["Não enviado", "e-pendente"] };'],
    ["  /* ENCERRAR O DIA: gera, envia pelo gateway e só então mostra o resultado. Não pede pasta local. */", `  const aguardaDecisao = (f) => f.status !== "enviado" && f.status !== "nao_enviado" && !f.envio_autorizado;
  function totais(f) { const c = f.conteudo.replace(/^\uFEFF/, "").trim().split(/\\r?\\n/).pop().split(";"); return { executados: Number(c[3]), resolvidos: Number(c[4]) }; }
  /* O operador confere os números e decide. Só com a confirmação o fechamento é transmitido. */
  async function decidirEnvio(id, data) {
    const t = totais(srv().fechamento(id));
    const v = await UI().escolher("Enviar fechamento ao Drive", \`<p><b>Você realmente deseja enviar este fechamento ao Google Drive?</b></p><p>Confira os números antes de confirmar. Se forem apenas testes, você pode optar por não enviar.</p>
      <p id="fe-totais">Callbacks executados: <b>\${t.executados}</b><br>Callbacks resolvidos: <b>\${t.resolvidos}</b></p>\`, [{ valor: "nao", rotulo: "NÃO ENVIAR" }, { valor: "sim", rotulo: "CONFIRMAR ENVIO", classe: "acao" }]);
    await srv().decidirEnvioFechamento(id, v === "sim"); await UI().recarregar();
    if (v !== "sim") { toast("Fechamento não enviado ao Drive."); return "nao_enviado"; }
    aguarde("Enviando o fechamento ao Google Drive…");
    await enviarPendentes(); await UI().recarregar();
    return mostrarResultado(data);
  }
  /* ENCERRAR O DIA: gera o fechamento, pergunta se deve ser enviado e só então mostra o resultado. Não pede pasta local. */`],
    ['    aguarde("Enviando o fechamento ao Google Drive…");\n    const { fechamento, erro } = await aposEncerrarDia(data, operador);\n    await UI().recarregar();\n    if (fechamento) return mostrarResultado(data);', `    aguarde("Preparando o fechamento…");
    const { fechamento, erro } = await aposEncerrarDia(data, operador);
    await UI().recarregar();
    if (fechamento && aguardaDecisao(fechamento)) return decidirEnvio(fechamento.id, data);
    if (fechamento && fechamento.status === "nao_enviado") { $("#modal").classList.add("oculto"); toast("Turno encerrado. Fechamento não enviado ao Drive."); return "nao_enviado"; }
    if (fechamento) return mostrarResultado(data);`],
    ['const situacao = f.status === "enviado" ?', 'const situacao = f.status === "nao_enviado" ? "não enviado ao Drive, por decisão do operador" : aguardaDecisao(f) ? "aguardando decisão de envio" : f.status === "enviado" ?'],
    ['<td class="c-acao-fila"><button type="button" class="mini-botao" data-baixar-f>Baixar</button>', '<td class="c-acao-fila">${aguardaDecisao(f) ? \'<button type="button" class="mini-botao verde" data-decidir>Decidir envio</button> \' : ""}<button type="button" class="mini-botao" data-baixar-f>Baixar</button>'],
    ['"Gateway indisponível."', '"Serviço indisponível."'],
    ['    $("#modal-caixa").querySelectorAll("[data-reprocessar]").forEach(', '    $("#modal-caixa").querySelectorAll("[data-decidir]").forEach((b) => { b.onclick = async () => { const l = b.closest("tr"); await decidirEnvio(l.dataset.f, l.dataset.dia); desenhar(); }; });\n    $("#modal-caixa").querySelectorAll("[data-reprocessar]").forEach('],
    ['toast("Nova versão gerada."); await enviarPendentes(); desenhar();', 'toast("Nova versão gerada."); await decidirEnvio(srv().ultimoFechamentoDoDia(dia).id, dia); desenhar();'],
  ]);
  console.log("Central montada em " + saida);
}
