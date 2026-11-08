/* Teste real e descartável do Google Drive: cria um fechamento FICTÍCIO, envia, lê de volta, confere a leitura pelo BI e manda para a lixeira.
   Usa uma base temporária: gateway\dados\bi-base.json e os fechamentos reais não são tocados. Nada de token aparece na saída.
   Uso: node --env-file=gateway\.env gateway\testar-drive.mjs */
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { criarDrive } from "./drive.mjs";
import { criarSync } from "./bi-sync.mjs";
import { CABECALHO } from "./fechamento-csv.mjs";

const DADOS = process.env.GATEWAY_DADOS || join(dirname(fileURLToPath(import.meta.url)), "dados");
const BASE_REAL = join(DADOS, "bi-base.json"), resumoBase = () => (existsSync(BASE_REAL) ? createHash("sha256").update(readFileSync(BASE_REAL)).digest("hex") : "sem base");
const drive = criarDrive(process.env, DADOS);
if (!drive.configurado) { console.error("Google Drive não configurado: rode o importador da credencial e o autorizar-drive."); process.exit(1); }

const data = "2026-11-01", nome = `fechamento_callbacks_${data}_TESTE-INTEGRACAO.csv`;
const conteudo = `${CABECALHO}\r\n${data};TESTE;TESTE;2;1;0;1\r\n${data};TOTAL;TOTAL;2;1;0;1\r\n`, sha256 = createHash("sha256").update(conteudo, "utf8").digest("hex");
const temp = mkdtempSync(join(tmpdir(), "central-teste-drive-")), antes = resumoBase(), passo = (m) => console.log("OK  " + m);
let id = null, falhou = false;
try {
  await drive.garantirEstrutura(); passo("estrutura de pastas confirmada (BI, HISTORICO, FECHAMENTOS)");
  const envio = await drive.publicar({ nome, data, conteudo, sha256, versao: 1 }); id = envio.arquivo_id; passo(`upload concluído${envio.reaproveitado ? " (arquivo já existia, reaproveitado)" : ""}`);
  const repetido = await drive.publicar({ nome, data, conteudo, sha256, versao: 1 }); if (repetido.arquivo_id !== id || !repetido.reaproveitado) throw new Error("reenvio criou arquivo duplicado"); passo("reenvio não duplicou o arquivo");
  if (await drive.baixar(id) !== conteudo) throw new Error("conteúdo lido difere do enviado"); passo("leitura de volta idêntica ao enviado");
  const sync = criarSync({ drive, dados: temp }); await sync.sincronizar();
  const linha = sync.linhas().find((l) => l.polo === "TESTE" && l.data === data);
  if (sync.estado().situacao !== "ok" || !linha || linha.callbacks !== 2 || linha.resolvidos !== 1) throw new Error("o BI não leu o arquivo de teste"); passo("BI leu o arquivo: 2 executados, 1 resolvido");
} catch (e) { falhou = true; console.error("FALHA: " + e.message); }
finally {
  if (id) { try { await drive.moverParaLixeira(id); const r = criarSync({ drive, dados: mkdtempSync(join(tmpdir(), "central-teste-drive-")) }); await r.sincronizar(); if (r.linhas().some((l) => l.polo === "TESTE")) throw new Error("arquivo ainda listado"); passo("arquivo de teste removido (lixeira do Drive) e fora do BI"); }
    catch (e) { falhou = true; console.error("FALHA ao remover o teste: " + e.message); } }
  if (resumoBase() === antes) passo("base operacional real inalterada"); else { falhou = true; console.error("FALHA: a base real mudou."); }
  rmSync(temp, { recursive: true, force: true });
}
process.exit(falhou ? 1 : 0);
