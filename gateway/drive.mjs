/* Cliente mínimo da Google Drive API (OAuth 2.0, refresh token só no servidor). Nunca registra tokens.
   Regras: não cria pasta duplicada; não sobrescreve arquivo: mesmo nome e mesmo conteúdo = reaproveita; mesmo nome e conteúdo diferente = recusa. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MESES = ["JANEIRO", "FEVEREIRO", "MARCO", "ABRIL", "MAIO", "JUNHO", "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"];
const PASTA = "application/vnd.google-apps.folder", TEMPO = 20000;
export class ErroDrive extends Error { constructor(m, status) { super(m); this.status = status; } }
const q = (t) => String(t).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
export const nomePastaMes = (data) => { const m = Number(data.slice(5, 7)); return `${String(m).padStart(2, "0")}-${MESES[m - 1]}`; };
const baseSegura = (u, padrao, nome) => { const v = (u || padrao).replace(/\/+$/, ""); if (v !== padrao && !/^http:\/\/127\.0\.0\.1:\d+$/.test(v)) throw new Error(`${nome} só aceita o endereço oficial (ou 127.0.0.1 em teste).`); return v; };

export function criarDrive(amb, dados) {
  const API = baseSegura(amb.GOOGLE_API_BASE, "https://www.googleapis.com", "GOOGLE_API_BASE"), TOKEN_URL = baseSegura(amb.GOOGLE_OAUTH_BASE, "https://oauth2.googleapis.com", "GOOGLE_OAUTH_BASE") + "/token";
  let refresh = amb.GOOGLE_REFRESH_TOKEN;
  const arq = join(dados, "google-oauth.json");
  if (!refresh && existsSync(arq)) { try { refresh = JSON.parse(readFileSync(arq, "utf8")).refresh_token; } catch { /* arquivo inválido: segue não configurado */ } }
  const configurado = !!(amb.GOOGLE_CLIENT_ID && amb.GOOGLE_CLIENT_SECRET && refresh);
  let acesso = null, validade = 0; const cachePastas = new Map();

  async function token() {
    if (acesso && Date.now() < validade - 60000) return acesso;
    let r;
    try { r = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(TEMPO),
      body: new URLSearchParams({ client_id: amb.GOOGLE_CLIENT_ID, client_secret: amb.GOOGLE_CLIENT_SECRET, refresh_token: refresh, grant_type: "refresh_token" }) }); }
    catch { throw new ErroDrive("Sem resposta do Google.", 0); }
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.access_token) throw new ErroDrive("O Google recusou a autorização do Drive.", r.status);
    acesso = d.access_token; validade = Date.now() + (d.expires_in || 3600) * 1000;
    return acesso;
  }
  async function chamar(caminho, op) {
    let r;
    try { r = await fetch(API + caminho, { ...op, headers: { Authorization: `Bearer ${await token()}`, ...(op.headers || {}) }, signal: AbortSignal.timeout(TEMPO) }); }
    catch (e) { if (e instanceof ErroDrive) throw e; throw new ErroDrive("Sem resposta do Google Drive.", 0); }
    if (!r.ok) throw new ErroDrive(`O Google Drive respondeu ${r.status}.`, r.status);
    return r;
  }
  /* Só consultas são repetidas: repetir um envio sem saber se o anterior chegou poderia duplicar o arquivo. Envio falho volta na próxima tentativa, que confere o nome antes. */
  async function api(caminho, op = {}) {
    for (let n = 0; ; n++) {
      try { return await chamar(caminho, op); }
      catch (e) { if ((op.method && op.method !== "GET") || n >= 2 || !(e.status === 0 || e.status === 429 || e.status >= 500)) throw e; await new Promise((ok) => setTimeout(ok, 300 * 3 ** n)); }
    }
  }
  async function listar(consulta, campos = "id,name") {
    const itens = []; let pagina = "";
    do {
      const u = new URLSearchParams({ q: consulta, fields: `nextPageToken,files(${campos})`, pageSize: "200", spaces: "drive", ...(pagina ? { pageToken: pagina } : {}) });
      const d = await (await api(`/drive/v3/files?${u}`)).json();
      itens.push(...(d.files || [])); pagina = d.nextPageToken || "";
    } while (pagina);
    return itens;
  }
  async function achar(nome, pai) { return (await listar(`name='${q(nome)}' and '${q(pai)}' in parents and mimeType='${PASTA}' and trashed=false`))[0] || null; }
  /* Guarda a promessa, não o resultado: envio e sincronização simultâneos não criam a mesma pasta duas vezes. */
  function pasta(nome, pai) {
    const k = pai + "/" + nome;
    if (!cachePastas.has(k)) {
      const p = (async () => { const a = await achar(nome, pai); if (a) return a.id; return (await (await api("/drive/v3/files?fields=id,name", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: nome, mimeType: PASTA, parents: [pai] }) })).json()).id; })();
      cachePastas.set(k, p); p.catch(() => cachePastas.delete(k));
    }
    return cachePastas.get(k);
  }
  const raiz = async () => amb.GOOGLE_DRIVE_RAIZ_ID || pasta("CENTRAL CALLBACK COI", "root");
  const pastaFechamentos = async () => pasta("FECHAMENTOS", await raiz());

  return {
    configurado,
    async garantirEstrutura() { const r = await raiz(); for (const nome of ["BI", "HISTORICO", "FECHAMENTOS"]) await pasta(nome, r); },
    /* Publica um fechamento em FECHAMENTOS/<ano>/<mês>. */
    async publicar({ nome, data, conteudo, sha256, versao }) {
      const destino = await pasta(nomePastaMes(data), await pasta(data.slice(0, 4), await pastaFechamentos()));
      const ja = (await listar(`name='${q(nome)}' and '${q(destino)}' in parents and trashed=false`, "id,name,appProperties"))[0];
      if (ja) {
        if (ja.appProperties && ja.appProperties.sha256 === sha256) return { arquivo_id: ja.id, reaproveitado: true };
        throw new ErroDrive("Já existe um arquivo com este nome e conteúdo diferente: nada foi sobrescrito.", 409);
      }
      const limite = "central-callback-" + sha256.slice(0, 16);
      const meta = { name: nome, mimeType: "text/csv", parents: [destino], appProperties: { sha256, versao: String(versao), origem: "central-callback" } };
      const corpo = `--${limite}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${limite}\r\nContent-Type: text/csv; charset=UTF-8\r\n\r\n${conteudo}\r\n--${limite}--`;
      const d = await (await api("/upload/drive/v3/files?uploadType=multipart&fields=id,name", { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${limite}` }, body: corpo })).json();
      return { arquivo_id: d.id, reaproveitado: false };
    },
    /* Lista os fechamentos de FECHAMENTOS/<ano>/<mês>. */
    async listarFechamentos() {
      const base = await pastaFechamentos(), arquivos = [];
      for (const ano of await listar(`'${q(base)}' in parents and mimeType='${PASTA}' and trashed=false`)) {
        if (!/^\d{4}$/.test(ano.name)) continue;
        for (const mes of await listar(`'${q(ano.id)}' in parents and mimeType='${PASTA}' and trashed=false`))
          arquivos.push(...await listar(`'${q(mes.id)}' in parents and name contains 'fechamento_callbacks_' and trashed=false`, "id,name,modifiedTime"));
      }
      return arquivos.map((a) => ({ id: a.id, nome: a.name, revisao: a.modifiedTime || a.id }));
    },
    /* Só para o teste de integração: vai para a lixeira do Drive, nunca é apagado definitivamente. */
    async moverParaLixeira(id) { await api(`/drive/v3/files/${encodeURIComponent(id)}?fields=id`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }) }); },
    async baixar(id) { return (await api(`/drive/v3/files/${encodeURIComponent(id)}?alt=media`)).text(); },
  };
}
