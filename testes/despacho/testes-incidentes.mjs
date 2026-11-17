/* Testes UNITÁRIOS do Despacho Otimizado 2.1 — Incidentes.xlsx (leitor XLSX, regra de status, consolidação das duas fontes).
   Dados 100% fictícios (incidentes-ficticio.mjs + dados-ficticios.mjs). Uso: node testes\despacho\testes-incidentes.mjs [Incidentes.xlsx real] [chamadas_incidentes.csv real]
   Com os arquivos REAIS (cópia local da pasta ADMS): confere SÓ consistência e imprime SÓ contagens (nenhum dado de cliente). */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { csvPasta } from "./dados-ficticios.mjs";
import { xlsxIncidentes, ESPERADO_INC } from "./incidentes-ficticio.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ctx = { TextDecoder, TextEncoder, console, Blob, Response, DecompressionStream }; ctx.globalThis = ctx; ctx.window = ctx; vm.createContext(ctx);
for (const f of ["localidades-dados.js", "localidades.js", "modelos.js", "nucleo.js", "despacho-config.js", "despacho-xlsx.js", "despacho-incidentes.js", "despacho-motor.js"])
  vm.runInContext(readFileSync(join(raiz, "js", f), "utf8"), ctx, { filename: f });
const { DespachoMotor: M, DespachoIncidentes: DI, LeitorXLSX: X } = ctx;

const res = [];
async function teste(nome, f) { try { await f(); res.push(true); console.log("OK    " + nome); } catch (e) { res.push(false); console.log("FALHA " + nome + " — " + e.message); } }
const verdade = (c, m) => { if (!c) throw new Error(m || "condição falsa"); };
const igual = (a, b, m) => { const ja = JSON.stringify(a), jb = JSON.stringify(b); if (ja !== jb) throw new Error(`${m || "esperado"}: ${jb}, obtido: ${ja}`); };
const erroDe = async (f) => { try { await f(); return null; } catch (e) { return e.codigo || e.message; } };
const AGORA = new Date(2026, 10, 15, 10, 0, 0).getTime();
const CH = M.processar(new TextEncoder().encode(csvPasta(AGORA)));
const ler = async (op) => DI.processar(await X.ler(xlsxIncidentes(AGORA, op), { aba: "incidentes" }));
const nums = (xs) => xs.map((i) => M.numeroDe(i.id)).sort();

await teste("XLSX real-like: cabeçalho na linha 3, coluna A vazia preservada, observação multilinha, datas do Excel", async () => {
  const p = await X.ler(xlsxIncidentes(AGORA), { aba: "Incidentes" });
  igual([p.aba, p.linhas[2][0], p.linhas[2][2], p.linhas[2].length], ["incidentes", "", "num ocorrencia", 48]);
  const r = DI.processar(p), x = r.incs.get("900000001");
  igual([r.cabecalho.linha, r.resumo.registros, r.resumo.incs, r.resumo.descartadas], [3, ESPERADO_INC.registros, ESPERADO_INC.incs, ESPERADO_INC.descartadas]);
  igual(x.obs, ["Usuario: SIGOD: EQUIPE NO LOCAL\nAGUARDANDO MATERIAL"], "quebra de linha mantida");
  verdade(/^2026-11-15T09:15:00$/.test(x.horarios.atribuicao.iso), x.horarios.atribuicao.iso);
});
await teste("Mesmo resultado com: sem compressão, texto embutido e datas em TEXTO AM/PM", async () => {
  const a = await ler(), b = await ler({ compressao: "store", textos: "embutidos", datas: "texto" });
  const r = (q) => [...q.incs.values()].map((x) => [x.numero, x.situacao.codigo, x.equipes, x.horarios.atribuicao.iso, x.horarios.enviada.iso]);
  igual(r(b), r(a));
});
await teste("Regra central de status: 5 operacionais, 3 excluídos, vazio/desconhecido = exceção (sem acento/maiúsculas)", async () => {
  const g = (t) => DI.classificarStatus(t).grupo;
  igual(["Aguardando Envio", "aguardando reenvio", "ENVIADO", "Em Execucao", "Interrompido"].map(g), Array(5).fill("operacional"));
  igual(["Concluído", "Arquivado", "cancelado"].map(g), ["excluido", "excluido", "excluido"]);
  igual([DI.classificarStatus("").codigo, DI.classificarStatus("Pendente X").codigo], ["status_vazio", "status_desconhecido"]);
  verdade(DI.classificarStatus("Interrompido").destaque, "interrompido com identificação própria");
});
await teste("Várias linhas e várias equipes da mesma INC: uma INC, equipes sem repetir; status divergente = exceção", async () => {
  const r = await ler();
  igual([r.incs.get("900000001").linhas.length, r.incs.get("900000001").equipes], [2, ["ESE-T-EQ01", "ESE-T-EQ02"]]);
  igual(r.incs.get("900000021").situacao.codigo, "status_divergente");
});
await teste("Consolidação: só operacionais seguem; excluídas e exceções fora de lotes, contadores e cópia", async () => {
  const c = M.consolidar(CH, await ler());
  igual(nums(c.incs), ESPERADO_INC.operacionais); igual(nums(c.excluidas), ESPERADO_INC.excluidas);
  igual(Object.fromEntries(c.excecoes.map((i) => [M.numeroDe(i.id), i.situacao.codigo])), ESPERADO_INC.excecoes);
  const m = M.montar(c.incs, {}), ids = m.secoes.flatMap((s) => s.lotes.flatMap((l) => l.incs.map((i) => i.id)));
  igual([ids.length, m.indicadores.incs], [ESPERADO_INC.operacionais.length, ESPERADO_INC.operacionais.length]);
  const copia = M.textoCopia(ids);
  for (const n of [...ESPERADO_INC.excluidas, ...Object.keys(ESPERADO_INC.excecoes)]) verdade(!copia.includes(n), "INC fora entrou na cópia: " + n);
});
await teste("INC só no Incidentes: município do 'local', sem bairro inventado; só nas chamadas: sem_registro_adms", async () => {
  const c = M.consolidar(CH, await ler()), so = c.incs.find((i) => i.id === "INC 900000060");
  igual([so.origem, so.municipio.nome, so.bairro, so.localizacaoIncompleta, so.chamadas], ["incidentes", "Nossa Senhora do Socorro", null, true, 0]);
  igual(c.incs.find((i) => i.id === "INC 900000062").municipio.status, "desconhecida");
  igual(c.excecoes.find((i) => i.id === "INC 900000040").origem, "chamadas");
});
await teste("Inconsistências sinalizadas (não corrigidas) e filtros por status / sem equipe", async () => {
  const c = M.consolidar(CH, await ler()), i13 = c.incs.find((i) => i.id === "INC 900000013"), i30 = c.incs.find((i) => i.id === "INC 900000030");
  verdade(i13.inconsistencias.some((t) => /sem equipe/.test(t)) && i13.inconsistencias.some((t) => /envio anterior/.test(t)), JSON.stringify(i13.inconsistencias));
  verdade(i30.inconsistencias.some((t) => /município diferente/.test(t)) && i30.municipio.nome === "Itabaiana", "lote usa o município das chamadas");
  igual(nums(M.montar(c.incs, { status: "interrompido" }).secoes.flatMap((s) => s.lotes.flatMap((l) => l.incs))), ["900000005"]);
  igual(M.montar(c.incs, { equipe: "sem" }).indicadores.incs, M.montar(c.incs, {}).indicadores.semEquipe);
});
await teste("Arquivo ausente/vazio, não-XLSX, incompleto, corrompido, aba e coluna obrigatória ausentes: recusados", async () => {
  const b = xlsxIncidentes(AGORA);
  igual(await erroDe(() => X.ler(new Uint8Array(0))), "vazio");
  igual(await erroDe(() => X.ler(new TextEncoder().encode(csvPasta(AGORA)))), "nao_xlsx");
  igual(await erroDe(() => X.ler(b.slice(0, Math.floor(b.length * 0.7)))), "incompleto");
  const ruim = b.slice(); const meio = Math.floor(b.length / 2); for (let i = meio; i < meio + 60; i++) ruim[i] ^= 0xff; // dentro dos dados da aba
  igual(await erroDe(() => X.ler(ruim)), "corrompido");
  igual(await erroDe(() => X.ler(xlsxIncidentes(AGORA, { aba: "Planilha1" }), { aba: "incidentes" })), "sem_aba");
  igual(await erroDe(() => ler({ semColuna: "status incident" })), "colunas_ausentes");
});
await teste("Troca de leitura: extração antiga e arquivo sem registros recusados; avisos de atualidade", async () => {
  const ant = { arquivo: { lastModified: 1000 }, total: 10 };
  igual(M.aceitarLeitura(ant, { arquivo: { lastModified: 900 }, total: 10 }).motivo, "extracao_antiga");
  igual(M.aceitarLeitura(ant, { arquivo: { lastModified: 2000 }, total: 0 }).motivo, "sem_registros");
  igual(M.aceitarLeitura(ant, { arquivo: { lastModified: 2000 }, total: 8 }).aceita, true);
  const av = M.avisosAtualidade({ chamadas: { arquivo: { lastModified: AGORA - 5 * 60000 } }, incidentes: { arquivo: { lastModified: AGORA - 20 * 60000 } } }, AGORA);
  igual(av.map((a) => [a.fonte, a.tipo]), [["incidentes", "desatualizada"], ["incidentes", "distantes"]]);
});
await teste("Sem Incidentes.xlsx: modo 2.0 preservado (mesmas INCs e lotes)", async () => {
  const c = M.consolidar(CH, null);
  igual([c.modo, c.incs.length, M.montar(c.incs, {}).indicadores.lotes], ["so_chamadas", CH.incs.length, M.montar(CH.incs, {}).indicadores.lotes]);
});

/* Arquivos REAIS (opcional): o XLSX gravado pelo robô do ADMS, lido pelo MESMO leitor do navegador. */
const [realX, realC] = process.argv.slice(2);
if (realX) {
  let inc;
  await teste("REAL: Incidentes.xlsx lido (aba incidentes, cabeçalho, colunas obrigatórias, todas as datas reconhecidas)", async () => {
    inc = DI.processar(await X.ler(new Uint8Array(readFileSync(realX)), { aba: "incidentes" }));
    const datas = [...inc.incs.values()].flatMap((i) => Object.values(i.horarios)).filter((h) => h.original);
    console.log(`      real: cabeçalho na linha ${inc.cabecalho.linha} · ${inc.resumo.registros} registros -> ${inc.resumo.incs} INCs · descartadas ${inc.resumo.descartadas} · avisos ${JSON.stringify(inc.avisos)}`);
    console.log(`      real: status ${JSON.stringify([...inc.incs.values()].reduce((o, i) => ((o[i.situacao.rotulo] = (o[i.situacao.rotulo] || 0) + 1), o), {}))} · datas ${datas.filter((h) => h.iso).length}/${datas.length} reconhecidas`);
    igual(datas.filter((h) => !h.iso).length, 0, "datas não reconhecidas");
    igual(inc.resumo.incs + inc.resumo.linhas_repetidas + inc.resumo.descartadas, inc.resumo.registros);
  });
  if (realC && inc) await teste("REAL: consolidação — nenhuma INC excluída/exceção em lote ou cópia; soma confere", async () => {
    const ch = M.processar(new Uint8Array(readFileSync(realC))), c = M.consolidar(ch, inc), m = M.montar(c.incs, {});
    const ids = m.secoes.flatMap((s) => s.lotes.flatMap((l) => l.incs.map((i) => i.id))), fora = new Set([...c.excluidas, ...c.excecoes].map((i) => i.id));
    console.log(`      real: operacionais ${c.incs.length} (duas fontes ${c.resumo.ambas}, só Incidentes ${c.resumo.soIncidentes}) · excluídas ${JSON.stringify(c.resumo.excluidasPorStatus)} · exceções ${JSON.stringify(c.resumo.excecoesPorMotivo)}`);
    igual([ids.length, new Set(ids).size, ids.filter((i) => fora.has(i)).length], [c.incs.length, c.incs.length, 0]);
    igual(c.resumo.ambas + c.resumo.soChamadas, ch.resumo.incs, "INCs das chamadas");
  });
}

const ok = res.filter(Boolean).length;
console.log(`\n${res.length} testes · ${ok} aprovados · ${res.length - ok} com falha`);
process.exitCode = ok === res.length ? 0 : 1;
