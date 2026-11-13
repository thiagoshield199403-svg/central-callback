/* Prepara as credenciais, em pasta PRIVADA fora do projeto. Nunca mostra a chave na tela.
   Criar:   node apps-script/nova-credencial.mjs criar <ID> <pasta-privada> <gravacao|leitura|migracao>
   Revogar: node apps-script/nova-credencial.mjs revogar <ID> <pasta-privada>
   Gera <pasta>/credenciais.json (chaves) e <pasta>/Instalar.gs: colar no editor do Apps Script, executar instalarCredenciais e remover. */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [acao, id, a3, a4] = process.argv.slice(2), pasta = resolve(a3 || "");
const PROJETO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (!["criar", "revogar"].includes(acao) || !/^[A-Z0-9_-]{1,40}$/.test(id || "")) throw new Error("Uso: veja o início deste arquivo.");
if (!relative(PROJETO, pasta).startsWith("..")) throw new Error("A pasta das chaves precisa ficar fora do projeto.");
mkdirSync(pasta, { recursive: true });
const ARQ = join(pasta, "credenciais.json"), lista = existsSync(ARQ) ? JSON.parse(readFileSync(ARQ, "utf8")) : {};
if (acao === "criar") {
  const escopo = a4;
  if (!["gravacao", "leitura", "migracao"].includes(escopo)) throw new Error("Escopo inválido.");
  if (lista[id]) throw new Error("Essa credencial já existe: nada foi alterado.");
  lista[id] = { segredo: randomBytes(32).toString("base64url"), ativo: true, escopo };
} else {
  if (!lista[id]) throw new Error("Credencial não encontrada.");
  lista[id].ativo = false;
}
writeFileSync(ARQ, JSON.stringify(lista, null, 2), { mode: 0o600 });
const linhas = Object.entries(lista).map(([k, v]) => `  p.setProperty(${JSON.stringify("CRED_" + k)}, ${JSON.stringify(JSON.stringify(v))});`);
writeFileSync(join(pasta, "Instalar.gs"), `function instalarCredenciais() {\n  var p = PropertiesService.getScriptProperties();\n${linhas.join("\n")}\n  console.log("credenciais aplicadas: ${linhas.length}");\n}\n`, { mode: 0o600 });
console.log(`${acao === "criar" ? "Criada" : "Revogada"}: ${id} (escopo ${lista[id].escopo}). Chave guardada em ${ARQ}.`);
