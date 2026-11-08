/* Autorização única do Google Drive (OAuth 2.0 para app de computador). Quem clica e consente é o dono da conta.
   Uso: node --env-file=gateway\.env gateway\autorizar-drive.mjs
   Grava o refresh token em gateway\dados\google-oauth.json (fora do GitHub e nunca servido à página). */
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const { GOOGLE_CLIENT_ID: ID, GOOGLE_CLIENT_SECRET: SEGREDO } = process.env;
if (!ID || !SEGREDO) { console.error("Preencha GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET em gateway\\.env."); process.exit(1); }
const DADOS = process.env.GATEWAY_DADOS || join(dirname(fileURLToPath(import.meta.url)), "dados"), PORTA = 8799, RETORNO = `http://127.0.0.1:${PORTA}/`, estado = randomBytes(16).toString("hex");
const ESCOPO = process.env.GOOGLE_ESCOPO || "https://www.googleapis.com/auth/drive.file";
const url = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({ client_id: ID, redirect_uri: RETORNO, response_type: "code", scope: ESCOPO, access_type: "offline", prompt: "consent", state: estado });
const srv = createServer(async (req, res) => {
  const u = new URL(req.url, RETORNO), code = u.searchParams.get("code");
  if (!code || u.searchParams.get("state") !== estado) { res.end("Pedido inválido."); return; }
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: ID, client_secret: SEGREDO, redirect_uri: RETORNO, grant_type: "authorization_code" }) });
  const d = await r.json().catch(() => ({}));
  if (!d.refresh_token) { res.end("O Google não devolveu a autorização."); console.error("Falha: o Google não devolveu refresh token."); process.exit(1); }
  mkdirSync(DADOS, { recursive: true }); writeFileSync(join(DADOS, "google-oauth.json"), JSON.stringify({ refresh_token: d.refresh_token }));
  res.setHeader("Content-Type", "text/plain; charset=utf-8"); res.end("Autorizado. Pode fechar esta aba e reiniciar o gateway.");
  console.log("Autorização gravada. Reinicie o gateway."); setTimeout(() => process.exit(0), 300);
});
srv.listen(PORTA, "127.0.0.1", () => console.log("Abra este endereço na conta do Drive e autorize:\n\n" + url + "\n"));
