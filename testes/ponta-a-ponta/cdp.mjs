/* Ferramenta de TESTE (só desenvolvimento; a Central não usa Node). Abre o Chrome/Edge sem janela, com um perfil
   temporário, e conversa com ele pelo Chrome DevTools Protocol (WebSocket nativo do Node 22+). Sem dependências. */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CANDIDATOS = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
];
export const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));
export const CONFIG_TESTE = { pasta_rede: "W:\\PASTA-TESTE\\central-callback", pasta_adms: "\\\\servidor-teste\\ADMS" };

export async function abrirNavegador({ exe, largura = 1366, altura = 768, porta = 9300 + Math.floor(Math.random() * 500), downloads, perfil: perfilFixo } = {}) {
  exe = exe || CANDIDATOS.find(existsSync);
  const perfil = perfilFixo || mkdtempSync(join(tmpdir(), "central-teste-")); // perfil fixo: reabrir o navegador com os mesmos dados
  const proc = spawn(exe, [`--remote-debugging-port=${porta}`, `--user-data-dir=${perfil}`, "--headless=new", "--no-first-run",
    "--no-default-browser-check", "--disable-gpu", `--window-size=${largura},${altura}`, "--allow-file-access-from-files", "about:blank"],
    { stdio: "ignore" });
  let info = null;
  for (let i = 0; i < 100 && !info; i++) {
    try { info = await (await fetch(`http://127.0.0.1:${porta}/json/version`)).json(); } catch { await espera(100); }
  }
  if (!info) throw new Error("O navegador não respondeu ao DevTools.");
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((ok, falha) => { ws.onopen = ok; ws.onerror = falha; });
  let id = 0; const pend = new Map(), ouvintes = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.falha(new Error(m.error.message)) : p.ok(m.result); }
    else if (m.method) ouvintes.forEach((f) => f(m));
  };
  const enviar = (method, params = {}, sessionId) => new Promise((ok, falha) => {
    const n = ++id; pend.set(n, { ok, falha }); ws.send(JSON.stringify({ id: n, method, params, sessionId }));
  });
  if (downloads) await enviar("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads, eventsEnabled: true });
  const nav = {
    enviar, ouvintes,
    /* todasAsDatas (padrão): os CSVs fictícios dos testes são de março/2026; a Central abre filtrada em HOJE. Para as baterias
       antigas continuarem vendo o lote inteiro (como antes do filtro por data), assim que a Central fica pronta (inclusive a cada
       F5) o filtro passa para "Todas as datas" — o mesmo que o clique do operador. O padrão HOJE é testado em
       e2e-filtro-data.mjs, que abre a página com { todasAsDatas: false }. Nada disso existe no código da Central. */
    async novaPagina(url = "about:blank", { largura: l = largura, altura: a = altura, todasAsDatas = true } = {}) {
      const { targetId } = await enviar("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await enviar("Target.attachToTarget", { targetId, flatten: true });
      const pg = new Pagina(enviar, sessionId, ouvintes, targetId);
      await pg.cmd("Runtime.enable"); await pg.cmd("Page.enable"); await pg.cmd("Log.enable");
      /* Configuração local (js/config-local.js, NÃO versionada) com valores FICTÍCIOS e fixos nos testes: os testes nunca dependem
         dos caminhos reais da empresa, e o arquivo real (se existir) não substitui estes valores (propriedade só de leitura). */
      await pg.cmd("Page.addScriptToEvaluateOnNewDocument", { source: `Object.defineProperty(window, "CENTRAL_CONFIG_LOCAL", { value: Object.freeze(${JSON.stringify(CONFIG_TESTE)}), writable: false, configurable: false });` });
      if (todasAsDatas) await pg.cmd("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
        const ob = new MutationObserver(() => { const b = document.body; if (!b || b.dataset.pronto !== "1") return; ob.disconnect();
          const f = window.CentralUI && window.CentralUI.filtroData; if (f) f.definir({ modo: "todas" }); });
        ob.observe(document, { subtree: true, attributes: true, attributeFilter: ["data-pronto"] });
      })();` });
      await pg.cmd("Emulation.setDeviceMetricsOverride", { width: l, height: a, deviceScaleFactor: 1, mobile: l < 600 });
      if (url !== "about:blank") await pg.ir(url);
      return pg;
    },
    async fechar() { try { await enviar("Browser.close"); } catch { /* já fechado */ } ws.close(); proc.kill(); await espera(400); try { if (!perfilFixo) rmSync(perfil, { recursive: true, force: true }); } catch { /* perfil em uso */ } },
  };
  return nav;
}

class Pagina {
  constructor(enviar, sessionId, ouvintes, targetId) {
    this.enviar = enviar; this.s = sessionId; this.targetId = targetId; this.console = []; this.erros = [];
    ouvintes.push((m) => {
      if (m.sessionId !== this.s) return;
      if (m.method === "Runtime.consoleAPICalled") this.console.push({ tipo: m.params.type, texto: m.params.args.map((a) => a.value ?? a.description).join(" ") });
      if (m.method === "Runtime.exceptionThrown") this.erros.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
      if (m.method === "Log.entryAdded" && m.params.entry.level === "error" && !/js\/config-local\.js$/.test(m.params.entry.url || "")) this.erros.push("[log] " + m.params.entry.text + " " + (m.params.entry.url || ""));
    });
  }
  cmd(metodo, p) { return this.enviar(metodo, p, this.s); }
  async ir(url) { await this.cmd("Page.navigate", { url }); await espera(300); await this.aguardar("document.readyState === 'complete'"); }
  async js(expr) {
    // expr deve ser UMA expressão (use uma função imediata para vários comandos)
    const r = await this.cmd("Runtime.evaluate", { expression: `(async () => { return (${expr}); })()`, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error("Erro no JS da página: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
  async aguardar(expr, ms = 15000) {
    const fim = Date.now() + ms;
    while (Date.now() < fim) { try { if (await this.js(expr)) return true; } catch { /* página ainda carregando */ } await espera(100); }
    throw new Error("Tempo esgotado aguardando: " + expr);
  }
  async foto(caminho) {
    const { writeFileSync } = await import("node:fs");
    const r = await this.cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    writeFileSync(caminho, Buffer.from(r.data, "base64"));
  }
  async tamanho(largura, altura) { await this.cmd("Emulation.setDeviceMetricsOverride", { width: largura, height: altura, deviceScaleFactor: 1, mobile: largura < 600 }); await espera(200); }
}
