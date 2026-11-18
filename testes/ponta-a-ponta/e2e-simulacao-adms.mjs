/* SIMULAÇÃO OPERACIONAL do DESPACHO OTIMIZADO 2.1 com a BASE ADMS FICTÍCIA (testes/fixtures/adms-simulacao/).
   Faz o caminho do operador no navegador real: a Central conecta a pasta ADMS, o Despacho lê os DOIS arquivos gerados
   (chamadas_incidentes.csv + Incidentes.xlsx, lidos do DISCO), e cada resultado é comparado com esperado.json (calculado pelo
   gerador a partir do plano dos dados, sem usar o código do Despacho). Depois, uma "exportação seguinte" (rodada 2) é gravada
   na pasta e o botão Atualizar relê as duas fontes.
   Os arquivos da pasta fixtures são REGERADOS no início (mesmos dados, horários do momento) e ficam lá para repetir o teste.
   Uso: node testes\ponta-a-ponta\e2e-simulacao-adms.mjs [caminho-do-navegador]   (FOTOS=<pasta> grava capturas) */
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { abrirNavegador, espera } from "./cdp.mjs";
import { gravar, gerar, ARQUIVOS } from "../fixtures/adms-simulacao/gerar.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const resultados = [];
async function teste(nome, f) { try { await f(); resultados.push(true); console.log("OK    " + nome); } catch (e) { resultados.push(false); console.log("FALHA " + nome + " — " + e.message); } }
const verdade = (c, m) => { if (!c) throw new Error(m || "condição falsa"); };
const igual = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || "esperado"}: ${JSON.stringify(b)}, obtido: ${JSON.stringify(a)}`); };
const SIMULACAO = `(() => { window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle("ADMS", { create: true }); })();`;

/* ------------------------------------------------------------ base fictícia: gera e lê do disco */
const AGORA = Date.now();
gravar({ agora: AGORA });
const CSV = readFileSync(ARQUIVOS.csv), XLSX = readFileSync(ARQUIVOS.xlsx), E = JSON.parse(readFileSync(ARQUIVOS.esperado, "utf8"));
const FORA = [...Object.values(E.excluidas).flat(), ...Object.values(E.excecoes).flat()];
const OPS = new Set(E.operacionais);

const exe = process.argv[2], nav = await abrirNavegador({ exe });
await nav.enviar("Browser.grantPermissions", { permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] }).catch(() => nav.enviar("Browser.grantPermissions", { permissions: ["clipboardReadWrite"] }));
const versao = (await nav.enviar("Browser.getVersion")).product;
const bd = "e2esim" + Date.now().toString(36), base = pathToFileURL(raiz).href + "/", rede = [];
const pg = await nav.novaPagina();
nav.ouvintes.push((m) => { if (m.method === "Network.requestWillBeSent") rede.push(m.params.request.url); });
await pg.cmd("Network.enable"); await pg.cmd("Page.addScriptToEvaluateOnNewDocument", { source: SIMULACAO });
const js = (e) => pg.js(e);
const clicar = (sel) => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) throw new Error("não achei ${sel.replace(/"/g, "'")}"); e.click(); return true; })()`);
const texto = (sel) => js(`(document.querySelector(${JSON.stringify(sel)}) || {}).textContent || ""`);
const escolher = (sel, v) => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event("change", { bubbles: true })); return e.value; })()`);
const buscar = async (t) => { await js(`(() => { const e = document.querySelector("#f-busca"); e.value = ${JSON.stringify(t)}; e.dispatchEvent(new Event("input")); return 1; })()`); await espera(400); };
const opfs = (corpo) => js(`(async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle("ADMS", { create: true }); ${corpo} })()`);
const gravarNaPasta = (nome, bytes) => opfs(`const b = Uint8Array.from(atob(${JSON.stringify(Buffer.from(bytes).toString("base64"))}), (c) => c.charCodeAt(0));
  const w = await (await d.getFileHandle(${JSON.stringify(nome)}, { create: true })).createWritable(); await w.write(b); await w.close(); return true;`);
const kpis = () => js(`Object.fromEntries([...document.querySelectorAll("[data-kpi]")].map((e) => [e.dataset.kpi, Number(e.textContent)]))`);
const lerClip = async () => (await js("navigator.clipboard.readText()")).split("\r\n").join("\n");
const lidoInc = () => js("(window.DespachoUI.estado().fontes.incidentes.leitura || {}).lidoEm || 0");
const lidoCh = () => js("window.DespachoUI.estado().lidoEm || 0");
/* cada teste começa do zero: sem filtros, todos os polos, nada selecionado (uma falha não contamina o próximo) */
const zerar = async () => { await clicar("#f-limpar"); await escolher("#polo", ""); await clicar("#sel-limpar"); };
const foto = async (n) => { if (process.env.FOTOS) await pg.foto(join(process.env.FOTOS, n + ".png")); };
const num = (id) => String(id).replace(/^INC\s*/, "");
/* lotes como a tela monta (sem filtros): chave, município, bairro, tipo e INCs na ordem */
const lotes = (f = "{}") => js(`(() => { const U = window.DespachoUI, S = U.estado(); return U.M.montar(S.dados.incs, ${f}).secoes.flatMap((s) => s.lotes.map((l) => ({
  chave: l.chave, tipo: l.tipo, municipio: l.municipio, bairro: l.bairro, incs: l.incs.map((i) => i.id.slice(4)) }))); })()`);
const incsTela = () => js(`window.DespachoUI.estado().dados.incs.map((i) => ({ n: i.id.slice(4), mun: i.municipio.status === "ok" ? Number(i.municipio.codigo) : null,
  bairro: i.bairro ? i.bairro.nome : null, tipo: i.bairro ? i.bairro.tipo : null, equipes: i.adms ? [...i.adms.equipes].sort() : null, status: i.situacao && i.situacao.codigo,
  polo: i.polo || null, origem: i.origem, chamadas: i.chamadas, inc: i.inconsistencias, fase: i.fase.nivel, risco: i.risco.nivel, difs: i.bairrosDiferentes }))`);

/* ------------------------------------------------------------ operador: Central conecta a pasta ADMS e abre o Despacho */
await pg.ir(`${base}index.html?bd=${bd}`); await pg.aguardar("document.body.dataset.pronto === '1'", 20000);
await opfs(`for await (const [n] of d.entries()) await d.removeEntry(n, { recursive: true }); return true;`);
await gravarNaPasta("chamadas_incidentes.csv", CSV); await gravarNaPasta("Incidentes.xlsx", XLSX);
console.log(`Navegador: ${versao} · base: ${E.csv.linhas} linhas de chamadas, ${E.xlsx.linhas} linhas do Incidentes.xlsx, ${E.incs_distintas_total} INCs distintas`);

await teste("1. Importação: Central conecta a pasta ADMS; Despacho lê as DUAS fontes sem aviso de erro", async () => {
  await pg.aguardar(`!!document.querySelector('#pasta-adms [data-adms="selecionar"]')`);
  await clicar('#pasta-adms [data-adms="selecionar"]'); await pg.aguardar(`document.querySelector("#pasta-adms").dataset.conexao === "directory"`, 20000);
  await clicar("#btn-despacho");
  await pg.aguardar("location.pathname.endsWith('despacho.html') && document.body.dataset.pronto === '1' && !!(window.DespachoUI.estado().dados || {}).incidentes", 30000);
  verdade(/^\d{2}\/\d{2},? \d{2}:\d{2}$/.test(await texto("#dados-texto")), "selo chamadas: " + await texto("#dados-texto"));
  verdade(/^\d{2}\/\d{2},? \d{2}:\d{2}$/.test(await texto("#dados-inc-texto")), "selo Incidentes: " + await texto("#dados-inc-texto"));
  igual(await js("document.querySelector('#fonte').classList.contains('oculto')"), true, "aviso nas chamadas");
  igual(await js("document.querySelector('#fonte-inc').classList.contains('oculto')"), true, "aviso no Incidentes: " + await texto("#fonte-inc"));
  await foto("sim-01-carregado");
});
await teste("2. Quantidades carregadas: chamadas (linhas, CALLs, sem INC, repetidas) e Incidentes.xlsx (linhas, INCs, descartada)", async () => {
  const r = await js("(() => { const d = window.DespachoUI.estado().dados; return { ch: d.resumo, inc: d.incidentes.resumo }; })()");
  igual([r.ch.chamadas_validas, r.ch.chamadas_sem_inc, r.ch.incs], [E.csv.chamadas_validas, E.csv.sem_inc, E.csv.incs_distintas], "chamadas: " + JSON.stringify(r.ch));
  igual([r.inc.registros, r.inc.incs, r.inc.descartadas], [E.xlsx.linhas, E.xlsx.incs_distintas, E.xlsx.linhas_descartadas], "Incidentes: " + JSON.stringify(r.inc));
  igual((await kpis()).incs, E.operacionais.length, "KPI de INCs (só operacionais)");
});
await teste("3. Cruzamento das fontes pelo número da INC: nas duas, só nas chamadas, só no Incidentes.xlsx", async () => {
  const c = await js("window.DespachoUI.estado().dados.consol.resumo");
  igual([c.ambas, c.soChamadas, c.soIncidentes], [E.cruzamento.ambas, E.cruzamento.so_chamadas, E.cruzamento.so_incidentes], JSON.stringify(c));
  const so = (await incsTela()).filter((i) => i.origem === "incidentes");
  verdade(so.every((i) => i.bairro === null && i.chamadas === 0), "INC só no Incidentes.xlsx: sem bairro inventado, 0 chamadas");
});
await teste("4. Exclusão: Concluído, Arquivado e Cancelado fora (processamento, lotes, contadores); conferência informa", async () => {
  const ex = await js("Object.fromEntries(['Concluído','Arquivado','Cancelado'].map((s) => [s, window.DespachoUI.estado().dados.consol.excluidas.filter((i) => i.situacao.rotulo === s).map((i) => i.id.slice(4)).sort()]))");
  for (const s of Object.keys(E.excluidas)) igual(ex[s], [...E.excluidas[s]].sort(), s);
  const ids = (await incsTela()).map((i) => i.n).sort();
  igual(ids, E.operacionais, "INCs em uso = operacionais");
  const conf = await texto("[data-conf-inc]");
  verdade(conf.includes("Concluído") && conf.includes("Arquivado") && conf.includes("Cancelado"), conf);
});
await teste("5. Exceções: status vazio, desconhecido, divergente e INC sem registro no ADMS, listadas à parte", async () => {
  const ex = await js("window.DespachoUI.estado().dados.consol.excecoes.map((i) => [i.situacao.codigo, i.id.slice(4)])");
  const por = {}; for (const [c, n] of ex) (por[c] ||= []).push(n);
  for (const k of Object.keys(E.excecoes)) igual((por[k] || []).sort(), [...E.excecoes[k]].sort(), k);
  await clicar("[data-excecoes]");
  const linhas = await js(`[...document.querySelectorAll("#excecoes tbody tr")].map((t) => t.querySelector(".c-inc").textContent.slice(4)).sort()`);
  igual(linhas, Object.values(E.excecoes).flat().sort(), "painel de exceções");
  verdade((await texto("#excecoes")).includes("descartada"), "linha com INC inválida informada");
  igual(await texto("#det-badge"), String(Object.values(E.excecoes).flat().length), "selo do ⓘ = quantidade de exceções");
  await foto("sim-02-excecoes"); await clicar("[data-excecoes]"); await clicar("#btn-detalhes");
  igual(await js(`document.querySelector("#conferencia").classList.contains("oculto")`), true, "detalhes recolhidos de novo");
});
await teste("6. Equipes: identificadas por INC (várias linhas somadas, sem repetir); sem equipe; total de equipes distintas", async () => {
  const t = await incsTela();
  for (const i of t) igual(i.equipes, E.equipes.por_inc[i.n], "equipes da INC " + i.n);
  const eq = await js(`Object.fromEntries([...document.querySelectorAll("#f-equipe option")].filter((o) => o.value).map((o) => [o.value, Number(o.dataset.n)]))`);
  igual(eq.sem, E.equipes.operacionais_sem_equipe.length, "opção Sem equipe");
  igual(eq.com, E.operacionais.length - E.equipes.operacionais_sem_equipe.length, "opção Com equipe");
  igual(await js(`document.querySelector("#f-equipe").dataset.equipes`), String(E.equipes.distintas_operacionais), "equipes distintas");
  verdade((await js(`document.querySelector("#f-equipe").title`)).includes(`${E.equipes.distintas_operacionais} equipe(s) distinta(s)`), "dica do filtro de equipe");
});
await teste("7. Filtros por status (filtro único com quantidades) e por equipe (sem, com, nome da equipe na busca)", async () => {
  await zerar();
  const chips = await js(`Object.fromEntries([...document.querySelectorAll("#f-status option")].filter((o) => o.value).map((o) => [o.value, Number(/\\((\\d+)\\)$/.exec(o.textContent)[1])]))`);
  for (const [st, n] of Object.entries(E.por_status)) {
    igual(chips[st], n, "quantidade na opção " + st);
    await escolher("#f-status", st); igual((await kpis()).incs, n, "filtro status " + st);
    const ts = await js(`[...new Set(window.DespachoUI.M.montar(window.DespachoUI.estado().dados.incs, window.DespachoUI.estado().f).secoes.flatMap((s) => s.lotes.flatMap((l) => l.incs.map((i) => i.situacao.codigo))))]`);
    igual(ts, [st], "lotes só com " + st);
  }
  await clicar("#f-limpar");
  await escolher("#f-status", "interrompido"); igual((await kpis()).incs, E.por_status.interrompido, "Interrompido");
  await escolher("#f-status", ""); igual((await kpis()).incs, E.operacionais.length, "Todos os status tira o filtro");
  await escolher("#f-equipe", "sem"); igual((await kpis()).incs, E.equipes.operacionais_sem_equipe.length, "sem equipe");
  await escolher("#f-equipe", "com"); igual((await kpis()).incs, E.operacionais.length - E.equipes.operacionais_sem_equipe.length, "com equipe");
  await clicar("#f-limpar"); // a lista de status só oferece status com INC no filtro atual: escolher o status ANTES da equipe
  await escolher("#f-status", "aguardando_envio"); await escolher("#f-equipe", "sem");
  igual((await kpis()).incs, E.operacionais.filter((n) => E.status_por_inc[n] === "aguardando_envio" && !E.equipes.por_inc[n].length).length, "status + sem equipe em conjunto");
  await clicar("#f-limpar"); await escolher("#f-status", "enviado"); await escolher("#f-equipe", "sem");
  igual((await kpis()).incs, E.operacionais.filter((n) => E.status_por_inc[n] === "enviado" && !E.equipes.por_inc[n].length).length, "Enviado sem equipe");
  await clicar("#f-limpar");
  const contagem = {}; for (const [n, eqs] of Object.entries(E.equipes.por_inc)) for (const q of eqs) contagem[q] = (contagem[q] || 0) + 1;
  for (const q of Object.keys(contagem).slice(0, 4)) { await buscar(q); igual((await kpis()).incs, contagem[q], "busca pela equipe " + q); }
  await clicar("#f-limpar");
});
await teste("8. Lotes: cada INC operacional em UM lote; lote = município + bairro/localidade esperados; polos somam o total", async () => {
  await zerar();
  const ls = await lotes(), todas = ls.flatMap((l) => l.incs);
  igual([todas.length, new Set(todas).size], [E.operacionais.length, E.operacionais.length], "INCs nos lotes");
  igual([...todas].sort(), E.operacionais, "lotes = operacionais");
  const t = Object.fromEntries((await incsTela()).map((i) => [i.n, i]));
  for (const [n, g] of Object.entries(E.grupos)) {
    igual(t[n].mun, g.municipio, "município da INC " + n);
    igual(t[n].bairro, g.bairro, "bairro/localidade da INC " + n);
  }
  for (const l of ls) {
    const gs = new Set(l.incs.map((n) => `${E.grupos[n].municipio}|${E.grupos[n].bairro}`));
    igual(gs.size, 1, `lote ${l.chave} mistura grupos: ${[...gs].join(" / ")}`);
    if (l.tipo !== "nao_identificado") verdade(E.grupos[l.incs[0]].bairro, "lote nomeado sem bairro esperado: " + l.chave);
  }
  const esperadosNomeados = new Set(E.operacionais.filter((n) => E.grupos[n].bairro).map((n) => `${E.grupos[n].municipio}|${E.grupos[n].bairro}`));
  igual(ls.filter((l) => l.tipo !== "nao_identificado").length, esperadosNomeados.size, "quantidade de lotes nomeados");
  const polos = await js(`[...document.querySelectorAll("#polo option")].map((o) => [o.value, o.textContent])`);
  let soma = 0;
  for (const [v] of polos.filter(([v]) => v)) {
    await escolher("#polo", v); const n = (await kpis()).incs; soma += n;
    igual(n, Object.values(E.polo).filter((p) => p === v).length, "polo " + v);
  }
  await escolher("#polo", "");
  igual(soma, Object.values(E.polo).filter(Boolean).length, "soma dos polos (INC sem município fica só em Todos os polos)");
  await foto("sim-03-lotes");
});
await teste("9. Seleção e desmarcação: lote inteiro, INC avulsa, desmarcar INC, desmarcar lote, tirar pela bandeja, limpar", async () => {
  await zerar();
  const ls = (await lotes()).filter((l) => l.incs.length >= 3), a = ls[0], b = ls[1];
  await clicar(`[data-sel-lote="${a.chave}"]`); igual(Number(await texto("#sel-n")), a.incs.length, "lote marcado");
  await clicar(`.lote-cab[data-abrir="${a.chave}"]`);
  await clicar(`[data-sel="INC ${a.incs[0]}"]`); igual(Number(await texto("#sel-n")), a.incs.length - 1, "desmarcou uma INC");
  igual(await js(`!!document.querySelector('[data-sel-lote="${a.chave}"]').indeterminate`), true, "lote parcial");
  await clicar(`[data-sel="INC ${a.incs[0]}"]`); igual(Number(await texto("#sel-n")), a.incs.length, "marcou de novo");
  await clicar(`[data-sel-lote="${b.chave}"]`); igual(Number(await texto("#sel-n")), a.incs.length + b.incs.length, "segundo lote");
  await clicar("#sel-copiar"); await espera(250);
  // a seleção segue a ordem dos cliques: a INC desmarcada e marcada de novo vai para o fim do primeiro lote
  igual(await lerClip(), `numos in (${[...a.incs.slice(1), a.incs[0], ...b.incs].join(", ")})`, "Copiar selecionadas (formato do SIGODE mantido)");
  await clicar(`[data-sel-lote="${a.chave}"]`); igual(Number(await texto("#sel-n")), b.incs.length, "desmarcou o lote");
  await clicar(`[data-tirar="INC ${b.incs[0]}"]`); igual(Number(await texto("#sel-n")), b.incs.length - 1, "tirou pela bandeja");
  await foto("sim-04-selecao");
  await clicar("#sel-limpar"); igual(Number(await texto("#sel-n")), 0, "limpar");
  igual(await js(`document.querySelector("#sel-copiar").disabled`), true, "sem seleção: copiar desativado");
});
await teste("10. Copiar lote (TODOS os lotes): só números 'n1, n2', na ordem do lote, nada excluído/em exceção", async () => {
  await zerar();
  const ls = await lotes(), copiadas = [];
  for (const l of ls) {
    await clicar(`[data-copiar="${l.chave}"]`); await espera(120);
    const c = await lerClip();
    verdade(/^\d{9}(, \d{9})*$/.test(c), `formato do lote ${l.chave}: "${c}"`);
    igual(c, l.incs.join(", "), "conteúdo do lote " + l.chave);
    copiadas.push(...c.split(", "));
  }
  igual([...copiadas].sort(), E.operacionais, "todas as operacionais copiadas uma vez");
  for (const n of FORA) verdade(!copiadas.includes(n), "INC fora copiada: " + n);
  verdade((await texto("#toast")).includes("copiada(s)"), "aviso de cópia");
});
await teste("11. Copiar INC individual: só o número, com e sem a INC selecionada, sem mexer na seleção nem no lote", async () => {
  await zerar();
  const l = (await lotes()).find((x) => x.incs.length >= 3);
  if (!(await js(`!!document.querySelector('[data-lote="${l.chave}"].aberto')`))) await clicar(`.lote-cab[data-abrir="${l.chave}"]`);
  for (const n of l.incs.slice(0, 3)) {
    await clicar(`[data-copiar-inc="INC ${n}"]`); await espera(150);
    igual(await lerClip(), n, "INC " + n);
  }
  await clicar(`[data-sel="INC ${l.incs[1]}"]`);
  await clicar(`[data-copiar-inc="INC ${l.incs[1]}"]`); await espera(150);
  igual([await lerClip(), Number(await texto("#sel-n"))], [l.incs[1], 1], "selecionada: copia e mantém a seleção");
  igual(await js(`!!document.querySelector('[data-lote="${l.chave}"].aberto')`), true, "lote continua aberto");
  await foto("sim-05-copiar-inc");
  await clicar("#sel-limpar");
});
await teste("12. Situações especiais: inconsistências, equipe por linha, bairro da maioria, risco e falta de fase", async () => {
  await zerar();
  const t = Object.fromEntries((await incsTela()).map((i) => [i.n, i])), esp = Object.entries(E.situacoes_especiais);
  const com = (nota) => esp.filter(([, v]) => v === nota).map(([n]) => n).filter((n) => t[n]);
  for (const n of com("município diferente nas duas fontes")) verdade(t[n].inc.some((x) => x.includes("município diferente nas fontes")), "município " + n);
  for (const n of com("envio anterior à atribuição")) verdade(t[n].inc.some((x) => x.includes("envio anterior ao de atribuição")), "horário " + n);
  for (const n of com("sem equipe com status que exige equipe")) verdade(t[n].inc.some((x) => x.includes("sem equipe associada")), "sem equipe " + n);
  for (const n of com("uma equipe em cada linha do XLSX")) igual(t[n].equipes.length, 2, "equipes somadas de linhas diferentes " + n);
  for (const n of com("uma chamada em outro bairro (minoria)")) verdade(t[n].difs.length > 0, "bairro minoritário registrado " + n);
  for (const n of com("risco de vida")) verdade(t[n].risco >= 2, `risco de vida ${n}: nível ${t[n].risco}`);
  for (const n of com("falta de fase confirmada")) igual(t[n].fase, "confirmada", "fase " + n);
  for (const n of com("falta de fase possível")) igual(t[n].fase, "possivel", "fase possível " + n);
  for (const n of com("oscilação (não é fase)")) igual(t[n].fase, "sem", "oscilação " + n);
  for (const n of com("sem endereço nenhum")) igual(t[n].bairro, null, "sem endereço " + n);
  const multi = E.xlsx.incs_com_varias_linhas.filter((n) => OPS.has(n))[0];
  const l = (await lotes()).find((x) => x.incs.includes(multi));
  if (!(await js(`!!document.querySelector('[data-lote="${l.chave}"].aberto')`))) await clicar(`.lote-cab[data-abrir="${l.chave}"]`);
  await clicar(`[data-detalhe="INC ${multi}"]`);
  const d = await texto("tr.detalhe");
  verdade(d.includes("Status no ADMS") && /atribuição|Horários/.test(d) && d.includes("confirmar no SIGODE"), d.slice(0, 300));
  await foto("sim-06-detalhe"); await clicar(`[data-detalhe="INC ${multi}"]`);
});
await teste("12b. Alimentador por INC: coluna própria com o valor do registro da INC (não do bairro); sem dado = —; vários = todos; cabeçalho sem alimentadores", async () => {
  await zerar();
  const ls = await lotes(), A = E.alimentadores, codigos = [...new Set(Object.values(A).flat())];
  const variosNoLote = ls.filter((l) => new Set(l.incs.map((n) => A[n].join("/"))).size > 1);
  verdade(variosNoLote.length > 0, "a base tem lote (mesmo bairro) com INCs de alimentadores diferentes");
  const sem = Object.keys(A).filter((n) => !A[n].length), varios = Object.keys(A).filter((n) => A[n].length > 1);
  verdade(sem.length >= 1 && varios.length >= 1, `cenários: ${sem.length} sem alimentador, ${varios.length} com vários`);
  let conferidas = 0;
  for (const l of ls) {
    const cab = await texto(`[data-lote="${l.chave}"] .lote-cab`);
    for (const c of codigos) verdade(!cab.includes(c), `cabeçalho do lote ${l.bairro} mostra o alimentador ${c}`);
    verdade(!/Alim\./.test(cab), "cabeçalho sem 'Alim.': " + cab);
    if (!(await js(`!!document.querySelector('[data-lote="${l.chave}"].aberto')`))) await clicar(`.lote-cab[data-abrir="${l.chave}"]`);
    const cel = await js(`Object.fromEntries([...document.querySelectorAll('[data-lote="${l.chave}"] tr.inc')].map((t) => [t.dataset.inc.slice(4),
      { a: [...t.querySelectorAll(".c-alim .alim > span")].map((s) => s.textContent), txt: t.querySelector(".c-alim").textContent.trim(), h: t.querySelector(".c-alim > span").getBoundingClientRect().height }]))`);
    for (const n of l.incs) {
      igual(cel[n].a, A[n], `alimentador da INC ${n} (lote ${l.municipio} · ${l.bairro})`);
      if (!A[n].length) igual(cel[n].txt, "—", "sem alimentador = traço " + n);
      verdade(cel[n].h <= 20, `alimentador da INC ${n} ocupa ${cel[n].h}px (mais de uma linha)`);
      conferidas++;
    }
  }
  igual(conferidas, E.operacionais.length, "todas as INCs operacionais conferidas");
  igual(await js(`[...document.querySelectorAll(".lote.aberto thead th")].map((t) => t.textContent)`), ["", "INC", "Endereço (ADMS)", "Alimentador", "Status", "Equipe", "1ª chamada", "Indicações", "Ações"], "ordem das colunas");
  const v = varios[0], lv = ls.find((l) => l.incs.includes(v));
  if (!(await js(`!!document.querySelector('[data-lote="${lv.chave}"].aberto')`))) await clicar(`.lote-cab[data-abrir="${lv.chave}"]`);
  const t = await js(`(() => { const e = document.querySelector('tr[data-inc="INC ${v}"] .c-alim .alim'); return [e.className, e.title]; })()`);
  verdade(t[0].includes("varios") && t[1].startsWith("Mais de um alimentador"), "INC com vários alimentadores: " + t.join(" | "));
  await foto("sim-08-alimentador");
  await clicar(`.lote-cab[data-abrir="${lv.chave}"]`);
});
await teste("13. Atualização das DUAS fontes (exportação seguinte): status mudam, INC nova entra, concluída sai da seleção", async () => {
  await zerar();
  const g2 = gerar({ agora: Date.now(), rodada: 2 }), E2 = g2.esperado;
  const sai = E2.mudancas.find((m) => m.para === "Concluído").inc;
  const l = (await lotes()).find((x) => x.incs.includes(sai));
  await clicar(`[data-sel-lote="${l.chave}"]`); verdade(await js(`window.DespachoUI.estado().sel.has("INC ${sai}")`), "selecionada antes");
  const tc = await lidoCh(), ti = await lidoInc();
  await espera(50);
  await gravarNaPasta("chamadas_incidentes.csv", Buffer.from(g2.csv, "utf8")); await gravarNaPasta("Incidentes.xlsx", g2.xlsx);
  await clicar("#btn-atualizar"); await pg.aguardar(`(window.DespachoUI.estado().lidoEm || 0) > ${tc} && ((window.DespachoUI.estado().fontes.incidentes.leitura || {}).lidoEm || 0) > ${ti} && !window.DespachoUI.estado().lendo`, 30000);
  igual((await kpis()).incs, E2.operacionais.length, "operacionais depois da atualização");
  igual((await incsTela()).map((i) => i.n).sort(), E2.operacionais, "INCs em uso");
  igual(await js(`window.DespachoUI.estado().sel.has("INC ${sai}")`), false, "INC concluída saiu da seleção");
  const r = await js("window.DespachoUI.estado().dados.resumo");
  igual(r.chamadas_validas, E2.csv.chamadas_validas, "chamadas relidas");
  const t = Object.fromEntries((await incsTela()).map((i) => [i.n, i]));
  for (const m of E2.mudancas) {
    if (m.para === "Concluído" || m.para === "Cancelado") verdade(!t[m.inc], `${m.inc} (${m.de} -> ${m.para}) ainda em uso`);
    else igual(t[m.inc] && t[m.inc].status, { "Enviado": "enviado", "Aguardando Envio": "aguardando_envio" }[m.para], `${m.inc} -> ${m.para}`);
  }
  for (const n of E2.call_extra) verdade(t[n].chamadas >= 2, "chamada nova somada à INC " + n);
  const chips = await js(`Object.fromEntries([...document.querySelectorAll("#f-status option")].filter((o) => o.value).map((o) => [o.value, Number(/\\((\\d+)\\)$/.exec(o.textContent)[1])]))`);
  for (const [st, n] of Object.entries(E2.por_status)) igual(chips[st] || 0, n, "status depois da atualização " + st);
  igual(await js("document.querySelector('#fonte-inc').classList.contains('oculto')"), true, "sem aviso");
  await foto("sim-07-atualizado");
  await clicar("#sel-limpar");
});
await teste("14. Layout 1366/1920 sem rolagem horizontal; nada sai do computador; nenhum erro de JavaScript", async () => {
  igual(await js("document.documentElement.scrollWidth <= innerWidth"), true);
  await pg.tamanho(1920, 1080); igual(await js("document.documentElement.scrollWidth <= innerWidth"), true); await pg.tamanho(1366, 768);
  igual(rede.filter((u) => !u.startsWith("file:") && !u.startsWith("data:") && !u.startsWith("blob:")), [], "requisições externas");
  igual(pg.erros, [], "erros na página");
});

await nav.fechar();
const ok = resultados.filter(Boolean).length;
console.log(`\n${resultados.length} testes da simulação ADMS (${versao}) · ${ok} aprovados · ${resultados.length - ok} com falha`);
process.exitCode = ok === resultados.length ? 0 : 1;
