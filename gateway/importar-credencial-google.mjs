/* Leva o JSON baixado do Google Cloud para gateway\.env sem exibir o segredo na tela.
   Uso: node gateway\importar-credencial-google.mjs "caminho\client_secret_....json"
   Arquivo .env novo começa em SIMULAÇÃO: este passo nunca liga envio real de WhatsApp. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const origem = process.argv[2], ENV = process.env.GATEWAY_ENV || join(dirname(fileURLToPath(import.meta.url)), ".env");
const parar = (m) => { console.error(m); process.exit(1); };
if (!origem || !existsSync(origem)) parar("Informe o caminho do arquivo JSON baixado do Google Cloud.");
let cred; try { cred = JSON.parse(readFileSync(origem, "utf8")).installed; } catch { parar("O arquivo não é um JSON válido."); }
if (!cred || !cred.client_id || !cred.client_secret) parar('O arquivo precisa ser de um cliente OAuth do tipo "App para computador".');

const novos = { GOOGLE_CLIENT_ID: cred.client_id, GOOGLE_CLIENT_SECRET: cred.client_secret, GOOGLE_ESCOPO: "https://www.googleapis.com/auth/drive.file" };
const existia = existsSync(ENV), linhas = (existia ? readFileSync(ENV, "utf8") : "# Credenciais locais: nunca publique este arquivo.\nWHATSAPP_MODO=simulacao\n").split(/\r?\n/).filter((l) => !/^\s*(GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET|GOOGLE_ESCOPO)=/.test(l));
while (linhas.length && !linhas[linhas.length - 1].trim()) linhas.pop();
writeFileSync(ENV, [...linhas, ...Object.entries(novos).map(([k, v]) => `${k}=${v}`)].join("\n") + "\n", { mode: 0o600 });
console.log(`Credencial gravada em gateway\\.env${existia ? "" : " (novo, em modo simulação)"}. Próximo passo: node --env-file=gateway\\.env gateway\\autorizar-drive.mjs`);
console.log("Depois de concluir, apague o JSON baixado.");
