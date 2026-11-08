/* Gateway de envio da Central de Callback (WhatsApp Business Platform / Cloud API oficial). Node 20+, sem dependências.
   - Guarda o token: ele fica SÓ no ambiente deste processo, nunca vai para a página nem para o registro.
   - Serve a própria Central (mesma origem): a página não precisa liberar nenhum domínio externo.
   - Escuta apenas em 127.0.0.1. Para uso em servidor, colocar atrás de proxy HTTPS com login corporativo (ver docs).
   - Idempotência: cada mensagem tem uma chave. O registro em disco é gravado ANTES de chamar a API; a mesma chave nunca gera
     outro envio: devolve o resultado anterior, ou "incerto" se o processo caiu ou a API não respondeu.
   Modos: WHATSAPP_MODO=simulacao (padrão; não entrega nada) ou producao (exige WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID e WHATSAPP_API_VERSAO).
   Uso: node gateway\servidor.mjs   ou   node --env-file=gateway\.env gateway\servidor.mjs */
import { createServer } from "node:http";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { criarDrive, ErroDrive } from "./drive.mjs";
import { criarSync } from "./bi-sync.mjs";
import { analisarFechamento } from "./fechamento-csv.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url)), RAIZ = join(AQUI, "..");
const amb = process.env;
const MODO = amb.WHATSAPP_MODO || "simulacao", PORTA = Number(amb.GATEWAY_PORTA || 8787);
const DADOS = amb.GATEWAY_DADOS || join(AQUI, "dados"), REGISTRO = join(DADOS, "registro-envios.jsonl");
const API_BASE = (amb.WHATSAPP_API_BASE || "https://graph.facebook.com").replace(/\/+$/, "");
const TEMPO_API = Number(amb.WHATSAPP_TEMPO_MS || 20000), TEXTO_MAX = 1500, CORPO_MAX = 16 * 1024;

const POLO_GATEWAY = amb.GATEWAY_POLO || null, NUMERO_ROTULO = amb.WHATSAPP_NUMERO_ROTULO || null;
function encerrar(msg) { console.error("ERRO DE CONFIGURAÇÃO: " + msg); process.exit(1); }
if (!["simulacao", "producao"].includes(MODO)) encerrar("WHATSAPP_MODO deve ser simulacao ou producao.");
if (!/^https:\/\/graph\.facebook\.com$|^http:\/\/127\.0\.0\.1:\d+$/.test(API_BASE)) encerrar("WHATSAPP_API_BASE só aceita o endereço oficial da Meta (ou 127.0.0.1 em teste).");
if (MODO === "producao") for (const k of ["WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_API_VERSAO"]) if (!amb[k]) encerrar(`${k} é obrigatório em producao.`);
const URL_API = MODO === "producao" ? `${API_BASE}/${amb.WHATSAPP_API_VERSAO}/${amb.WHATSAPP_PHONE_NUMBER_ID}/messages` : null;

/* Modelos aprovados na Meta: { "codigo_do_modelo": { "template": "nome", "idioma": "pt_BR", "parametros": ["incidente"] } } */
const ARQ_MODELOS = amb.WHATSAPP_MODELOS || join(AQUI, "modelos-aprovados.json");
let APROVADOS = {};
if (existsSync(ARQ_MODELOS)) { try { APROVADOS = JSON.parse(readFileSync(ARQ_MODELOS, "utf8")); } catch (e) { encerrar(`${ARQ_MODELOS} não é um JSON válido.`); } }

/* ---------------- registro de idempotência (sem texto da mensagem; telefone mascarado) */
mkdirSync(DADOS, { recursive: true });
const registro = new Map();
if (existsSync(REGISTRO)) for (const l of readFileSync(REGISTRO, "utf8").split("\n")) { if (!l.trim()) continue; try { const r = JSON.parse(l); registro.set(r.chave, r); } catch { /* linha parcial de queda */ } }
function anotar(r) { registro.set(r.chave, r); appendFileSync(REGISTRO, JSON.stringify(r) + "\n"); }

const RESPOSTA_INCERTA = { resultado: "incerto", codigo: "resultado_incerto", detalhe: "A API não confirmou este envio. Verifique no WhatsApp Manager antes de tentar de novo." };
const TRADUCAO = { 131047: "Fora da janela de 24 horas: esta mensagem precisa de um modelo aprovado pela Meta.", 131026: "O número não pode receber mensagens pelo WhatsApp.", 131021: "Remetente e destinatário são o mesmo número.",
  132000: "Parâmetros do modelo não conferem com o aprovado.", 132001: "Modelo inexistente ou não aprovado neste idioma.", 132015: "Modelo pausado pela Meta por baixa qualidade.", 132016: "Modelo desativado pela Meta.", 133010: "Número de envio não registrado na Cloud API." };
const LIMITES = new Set([4, 80007, 130429, 131048, 131056]);
const CONFIG = new Set([0, 3, 10, 190, 200, 131031]);

function interpretarErro(status, corpo) {
  const e = (corpo && corpo.error) || {}, codigo = e.code;
  if (status === 429 || LIMITES.has(codigo)) return { resultado: "limite", codigo: codigo || status, detalhe: "Limite de envio da API atingido: a fila foi pausada." };
  if (status === 401 || CONFIG.has(codigo)) return { resultado: "limite", codigo: codigo || status, detalhe: "A API recusou a credencial ou a permissão: fila pausada. Avise o administrador do gateway." };
  if (status >= 500) return { ...RESPOSTA_INCERTA, codigo: status };
  return { resultado: "falha", codigo: codigo || status, detalhe: TRADUCAO[codigo] || `Recusado pela API (código ${codigo || status}).` };
}
function montarMensagem(m) {
  const base = { messaging_product: "whatsapp", recipient_type: "individual", to: "55" + m.telefone };
  const ap = m.editada ? null : APROVADOS[m.modelo]; // texto editado nunca vira modelo: seria enviar outra coisa
  if (!ap) return { ...base, type: "text", text: { preview_url: false, body: m.texto } };
  const valores = { incidente: m.incidente }, parametros = (ap.parametros || []).map((p) => ({ type: "text", text: String(valores[p] ?? "") }));
  return { ...base, type: "template", template: { name: ap.template, language: { code: ap.idioma || "pt_BR" }, ...(parametros.length ? { components: [{ type: "body", parameters: parametros }] } : {}) } };
}
async function chamarApi(m) {
  if (MODO === "simulacao") return { resultado: "enviado", wamid: "sim." + m.chave.slice(0, 16), simulado: true };
  let resp, corpo;
  try {
    resp = await fetch(URL_API, { method: "POST", headers: { Authorization: `Bearer ${amb.WHATSAPP_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(montarMensagem(m)), signal: AbortSignal.timeout(TEMPO_API) });
    corpo = await resp.json().catch(() => null);
  } catch (e) { return { ...RESPOSTA_INCERTA, codigo: "sem_resposta_api" }; } // pode ter chegado à Meta: não reenviar sozinho
  const id = corpo && corpo.messages && corpo.messages[0] && corpo.messages[0].id;
  if (resp.ok && id) return { resultado: "enviado", wamid: id };
  if (resp.ok) return { ...RESPOSTA_INCERTA, codigo: "resposta_sem_id" };
  return interpretarErro(resp.status, corpo);
}
/* Sem nenhum await entre a consulta e a anotação: duas requisições com a mesma chave nunca passam juntas. */
async function enviar(m) {
  const ant = registro.get(m.chave);
  if (ant && ant.fase === "enviado") return { resultado: "enviado", wamid: ant.wamid, simulado: !!ant.simulado, reaproveitado: true };
  if (ant && (ant.fase === "em_andamento" || ant.fase === "incerto")) return { ...RESPOSTA_INCERTA, codigo: "resultado_incerto", reaproveitado: true };
  const marca = { chave: m.chave, incidente: m.incidente, telefone: "•••••" + m.telefone.slice(-4), modo: MODO };
  anotar({ ...marca, fase: "em_andamento", em: new Date().toISOString() });
  const r = await chamarApi(m);
  const fase = r.resultado === "enviado" ? "enviado" : r.resultado === "incerto" ? "incerto" : "recusado";
  anotar({ ...marca, fase, em: new Date().toISOString(), wamid: r.wamid || null, simulado: !!r.simulado, codigo: r.codigo || null });
  return r;
}

/* ---------------- HTTP */
const HOSTS = new Set([`127.0.0.1:${PORTA}`, `localhost:${PORTA}`, ...String(amb.GATEWAY_HOSTS || "").split(",").map((x) => x.trim()).filter(Boolean)]);
const SEGURANCA = { "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer", "Cache-Control": "no-store" };
const TIPOS = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
function json(res, status, d) { res.writeHead(status, { ...SEGURANCA, "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(d)); }
const recusa = (res, status, detalhe) => json(res, status, { resultado: "falha", codigo: "pedido_invalido", detalhe });
function lerCorpo(req) {
  return new Promise((ok, falha) => {
    let n = 0; const partes = [];
    req.on("data", (p) => { n += p.length; if (n > CORPO_MAX) { falha(new Error("grande")); req.destroy(); } else partes.push(p); });
    req.on("end", () => ok(Buffer.concat(partes).toString("utf8"))); req.on("error", falha);
  });
}
/* Só a própria Central: bloqueia pedidos de outros sites e DNS rebinding. */
function mesmaOrigem(req) {
  const o = req.headers.origin;
  if (!o) return false;
  try { return HOSTS.has(req.headers.host) && new URL(o).host === req.headers.host; } catch { return false; }
}
function validar(d) {
  if (!d || typeof d !== "object") return "Pedido inválido.";
  if (typeof d.chave !== "string" || !/^[0-9a-f]{16,64}$/.test(d.chave)) return "Chave de envio inválida.";
  if (typeof d.telefone !== "string" || !/^\d{2}9\d{8}$/.test(d.telefone)) return "Telefone inválido.";
  if (typeof d.texto !== "string" || !d.texto.trim() || d.texto.length > TEXTO_MAX) return "Texto inválido.";
  if (typeof d.modelo !== "string" || typeof d.incidente !== "string" || !d.incidente) return "Vínculo do incidente ausente.";
  return null;
}
const PUBLICOS = /^\/(index\.html|bi\.html|css\/[\w.-]+\.css|js\/[\w.-]+\.js)$/;
function servirArquivo(req, res, caminho) {
  if (caminho === "/") caminho = "/index.html";
  if (!PUBLICOS.test(caminho)) { res.writeHead(404, SEGURANCA); res.end("Não encontrado"); return; }
  const alvo = normalize(join(RAIZ, caminho));
  if (!alvo.startsWith(RAIZ + sep) || !existsSync(alvo)) { res.writeHead(404, SEGURANCA); res.end("Não encontrado"); return; }
  res.writeHead(200, { ...SEGURANCA, "Content-Type": TIPOS[extname(alvo)] }); res.end(readFileSync(alvo));
}
const drive = criarDrive(amb, DADOS), sync = criarSync({ drive, dados: DADOS, intervalo: Number(amb.BI_INTERVALO_MS || 300000) });
/* Barreira de privacidade no servidor: só passa CSV agregado. Guarda localmente antes de publicar: nada se perde se o Drive estiver fora. */
async function receberFechamento(d) {
  let p; try { p = analisarFechamento(d && d.nome, d && d.conteudo); } catch (e) { return { resultado: "falha", codigo: "fora_do_padrao", detalhe: e.message }; }
  const sha = createHash("sha256").update(d.conteudo, "utf8").digest("hex");
  if (sha !== d.sha256 || d.data !== p.data || d.versao !== p.versao) return { resultado: "falha", codigo: "integridade", detalhe: "Conteúdo não confere." };
  if (sync.guardarLocal(d.nome, d.conteudo) === "diferente") return { resultado: "falha", codigo: "conflito", detalhe: "Já existe outro arquivo com este nome: nada foi sobrescrito." };
  if (!drive.configurado) { sync.sincronizar(); return { resultado: "pendente", detalhe: "Google Drive ainda não configurado: arquivo guardado neste computador." }; }
  try { const r = await drive.publicar({ nome: d.nome, data: p.data, conteudo: d.conteudo, sha256: sha, versao: p.versao }); sync.sincronizar(); return { resultado: "enviado", ...r }; }
  catch (e) { if (e instanceof ErroDrive) return e.status === 409 ? { resultado: "falha", codigo: "conflito", detalhe: e.message } : { resultado: "pendente", detalhe: e.message }; throw e; }
}
const servidor = createServer(async (req, res) => {
  try {
    if (!HOSTS.has(req.headers.host)) { res.writeHead(403, SEGURANCA); res.end("Host não permitido"); return; }
    const caminho = new URL(req.url, "http://x").pathname;
    if (caminho === "/api/disparo/status" && req.method === "GET")
      return json(res, 200, { pronto: true, modo: MODO, modelos_aprovados: Object.keys(APROVADOS), polo: POLO_GATEWAY, numero_rotulo: NUMERO_ROTULO });
    if (caminho === "/api/bi/dados" && req.method === "GET") return json(res, 200, { linhas: sync.linhas(), sincronizacao: sync.estado() });
    if (caminho === "/api/drive/status" && req.method === "GET") return json(res, 200, { configurado: drive.configurado, ...sync.estado() });
    if (caminho === "/api/fechamento" && req.method === "POST") {
      if (!mesmaOrigem(req)) return recusa(res, 403, "Origem não permitida.");
      if (!/^application\/json/i.test(req.headers["content-type"] || "")) return recusa(res, 415, "Tipo de conteúdo inválido.");
      let d; try { d = JSON.parse(await lerCorpo(req)); } catch { return recusa(res, 400, "Corpo inválido."); }
      return json(res, 200, await receberFechamento(d));
    }
    if (caminho === "/api/disparo/enviar" && req.method === "POST") {
      if (!mesmaOrigem(req)) return recusa(res, 403, "Origem não permitida.");
      if (!/^application\/json/i.test(req.headers["content-type"] || "")) return recusa(res, 415, "Tipo de conteúdo inválido.");
      let d; try { d = JSON.parse(await lerCorpo(req)); } catch { return recusa(res, 400, "Corpo inválido."); }
      const erro = validar(d);
      if (erro) return recusa(res, 422, erro);
      return json(res, 200, await enviar(d));
    }
    if (caminho === "/favicon.ico") { res.writeHead(204, SEGURANCA); res.end(); return; }
    if (req.method === "GET" || req.method === "HEAD") return servirArquivo(req, res, caminho);
    res.writeHead(405, SEGURANCA); res.end();
  } catch (e) { console.error("Erro interno:", e.message); if (!res.headersSent) recusa(res, 500, "Erro interno do gateway."); else res.end(); }
});
servidor.listen(PORTA, "127.0.0.1", () => {
  console.log(`Central de Callback: http://127.0.0.1:${PORTA}/  ·  modo: ${MODO.toUpperCase()}  ·  modelos aprovados: ${Object.keys(APROVADOS).length}`);
  if (MODO === "simulacao") console.log("SIMULAÇÃO: nenhuma mensagem será entregue a ninguém.");
  console.log(`BI: http://127.0.0.1:${PORTA}/bi.html  ·  Google Drive: ${drive.configurado ? "configurado" : "NÃO configurado (fechamentos ficam neste computador)"}`);
  sync.iniciar();
});
