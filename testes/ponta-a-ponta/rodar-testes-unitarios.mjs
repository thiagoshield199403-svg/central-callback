/* Roda testes\testes.html num navegador sem janela e mostra o placar. Uso: node testes\ponta-a-ponta\rodar-testes-unitarios.mjs */
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { abrirNavegador } from "./cdp.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const nav = await abrirNavegador({ exe: process.argv[2] });
try {
  const pg = await nav.novaPagina(pathToFileURL(join(raiz, "testes", "testes.html")).href);
  await pg.aguardar("document.body.dataset.fim", 180000);
  const r = await pg.js(`({ placar: document.getElementById("placar").textContent,
    itens: [...document.querySelectorAll("#resultado li")].map((l) => l.textContent) })`);
  for (const l of r.itens) if (!l.startsWith("OK")) console.log(l);
  console.log(r.itens.length + " testes executados. " + r.placar);
  if (pg.erros.length) console.log("Erros no console:", pg.erros);
  process.exitCode = r.placar.startsWith("Todos") ? 0 : 1;
} finally { await nav.fechar(); }
