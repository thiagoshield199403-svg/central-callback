/* Testes PONTA A PONTA do filtro TIPO DE OCORRÊNCIA no ENVIO INDIVIDUAL (lista de incidentes) e do painel de filtros.
   Uso: node testes\ponta-a-ponta\e2e-filtro-ocorrencia.mjs [caminho-do-navegador]
   DADOS 100% FICTÍCIOS: parte de exemplos\navegador-chamadas-ADMS2026-FICTICIO.csv e acrescenta comunicações fictícias cujo
   comentário leva a cada tipo de ocorrência (mesmas expressões dos testes de reconhecimento), num banco separado (?bd=...).
   O resultado esperado vem do PRÓPRIO critério do envio em lote (srv.incidentesParaDisparo().ocorrencia): o teste confere que a
   lista individual mostra exatamente os mesmos incidentes, sem recriar regra. WhatsApp: janela simulada, nada é enviado. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { abrirNavegador, espera } from "./cdp.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const resultados = [];
async function teste(nome, f) {
  try { await f(); resultados.push([true, nome]); console.log("OK    " + nome); }
  catch (e) { resultados.push([false, nome, e.message]); console.log("FALHA " + nome + " — " + e.message); }
}
const verdade = (c, m) => { if (!c) throw new Error(m || "condição falsa"); };
const igual = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || "esperado"}: ${JSON.stringify(b)}, obtido: ${JSON.stringify(a)}`); };

/* ---------------- CSV fictício com vários tipos de ocorrência */
const BASE = readFileSync(join(raiz, "exemplos", "navegador-chamadas-ADMS2026-FICTICIO.csv"), "utf8").replace(/^﻿/, "");
const linhas = BASE.replace(/\r?\n$/, "").split(/\r?\n/);
const campos = (l) => [...l.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1]);
const montar = (fs) => fs.map((f) => `"${f}"`).join(";") + ";";
const iCab = linhas.findIndex((l) => l.includes('"ID"') && l.includes('"Horário da call"')), cab = campos(linhas[iCab]);
const col = (n) => { const i = cab.indexOf(n); if (i < 0) throw new Error("coluna " + n); return i; };
const [cHora, cId, cInc, cLoc, cCont, cRec, cSub, cCom] = ["Horário da call", "ID", "Incidente", "Localização", "Contato do reclamante", "Recebido ADMS", "Submotivos", "Comentário"].map(col);
const modelo = campos(linhas[iCab + 1]);
const FRASES = ["galho encostado na rede", "cabo partido na calçada", "CABO DE ALTA TENSAO DESNIVELADO", "luz oscilando o dia todo", "sem energia desde cedo",
  "poste batido por carro", "poste inclinado na esquina", "faísca no ramal", "centelhamento no poste", "dando choque no portão", "pipa presa na rede",
  "transformador fazendo barulho", "TROCAR TRANSFORMADOR, O MESMO ESTA VAZANDO OLEO", "DF-INVERSAO-DE-FASE", "tensão baixa, aparelhos não ligam",
  "sobretensão queimou a TV", "fio rompido", "energia vai e volta"];
let seq = 0;
function nova(frase, municipio, data, sub = "DF") {
  const f = modelo.slice(), n = 9600000 + ++seq;
  f[cId] = "CALL " + n; f[cInc] = "INC " + (8600000 + seq); f[cLoc] = `Rua Ficticia, ${seq}; Bairro Teste; ${municipio}`;
  f[cHora] = data; f[cRec] = data; f[cCont] = "MOBILE: (79) 99700-" + String(1000 + seq); f[cSub] = sub; f[cCom] = "OBS: " + frase;
  return montar(f);
}
const extras = FRASES.map((fr, i) => nova(fr, i % 2 ? "Itabaiana" : "Aracaju", i % 3 ? "11/03/2026 09:" + String(10 + i).padStart(2, "0") + ":00" : "12/03/2026 10:00:00"));
extras.push(nova("cabo partido caído na rua", "Aracaju", "12/03/2026 11:30:00", "RV")); // risco de vida (RV)
const CSV = "﻿" + linhas.join("\r\n") + "\r\n" + extras.join("\r\n") + "\r\n";
const pasta = mkdtempSync(join(tmpdir(), "central-filtro-ocorrencia-")), arquivo = join(pasta, "chamadas-ficticias-ocorrencias.csv");
writeFileSync(arquivo, CSV);

/* Conferência independente no Node (mesmo núcleo): o arquivo tem de cobrir muitos tipos para o teste valer. */
const exigir = createRequire(import.meta.url);
globalThis.window = globalThis;
for (const f of ["modelos.js", "nucleo.js"]) exigir(join(raiz, "js", f));
const N = globalThis.Nucleo;
const tiposNoArquivo = new Set(N.analisar(new TextEncoder().encode(CSV)).validas.map((v) => N.modelos().find((m) => m.codigo === N.sugerirMensagem(v).codigo).nome));
verdade(tiposNoArquivo.size >= 15, "o CSV de teste cobre poucos tipos: " + [...tiposNoArquivo].join(", "));

/* ---------------- navegador */
const nav = await abrirNavegador({ exe: process.argv[2] });
const pg = await nav.novaPagina(pathToFileURL(join(raiz, "index.html")).href + "?bd=e2eoc" + Date.now().toString(36));
const js = (e) => pg.js(e), S = "window.CentralUI.servico";
const clicar = (s) => js(`(() => { const e = document.querySelector(${JSON.stringify(s)}); if (!e) throw new Error("não achei ${s.replace(/"/g, "'")}"); e.click(); return true; })()`);
const escolher = async (sel, valor, ev = "change") => { await js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(valor)}; e.dispatchEvent(new Event(${JSON.stringify(ev)}, { bubbles: true })); return true; })()`); await espera(80); };
const opcoes = (sel) => js(`[...document.querySelector(${JSON.stringify(sel)}).options].map((o) => o.value)`);
const visiveis = () => js(`[...document.querySelectorAll("#linhas tr[data-grupo]")].map((t) => t.dataset.grupo).sort()`);
// Esperado = critério do envio em lote (ocorrência de srv.incidentesParaDisparo) + o mesmo recorte de data/regionais/situação/busca da lista.
const esperado = (oc, { regionais = [], busca = "", estado = "" } = {}) => js(`(() => { const s = ${S}, N = window.Nucleo, L = window.Localidades, f = window.CentralUI.filtroData;
  const oc = new Map(s.incidentesParaDisparo().map((x) => [x.chave, x.ocorrencia])), b = ${JSON.stringify(busca)}.toUpperCase();
  const conf = (c) => { const e = ${JSON.stringify(estado)}; if (!e) return true; if (e === "risco") return N.indicacaoRisco(c).nivel >= 1; return c.estado === e; };
  const casa = (c) => L.confere(c.localizacao, new Set(${JSON.stringify(regionais)})) && conf(c) && (!b || [c.call_id, c.incidente, c.nome, c.localizacao].some((x) => (x || "").toUpperCase().includes(b)));
  return s.grupos().filter((g) => f.confere(N.dataDoIncidente(g).dia) && (!${JSON.stringify(oc)} || oc.get(g.chave) === ${JSON.stringify(oc)}) && g.membros.some(casa)).map((g) => g.chave).sort(); })()`);
const base = () => js(`JSON.stringify([${S}.estado().lotes.map((l) => [l.id, l.situacao]), ${S}.chamadas().map((c) => [c.id, c.call_id, c.estado, c.horario_call, c.localizacao, c.tentativas.length, c.whatsapp_aberto_em || null])])`);

await pg.aguardar("document.body.dataset.pronto === '1'");
await js(`(window.__links = [], window.open = () => { const j = { closed: false, opener: 1, close() {}, focus() {} }; Object.defineProperty(j, "location", { value: { set href(u) { window.__links.push(u); } } }); return j; }, true)`);
await js(`(() => { const f = document.querySelector("#form-dia"); f.operador.value = "occ1"; if (f.polo) f.polo.value = "Aracaju"; f.requestSubmit(); return true; })()`);
await pg.aguardar("!!document.querySelector('#importar').offsetParent");
const doc = await pg.cmd("DOM.getDocument", {}), { nodeId } = await pg.cmd("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "#arquivo" });
await pg.cmd("DOM.setFileInputFiles", { nodeId, files: [arquivo] }); await pg.aguardar("!!document.querySelector('#btn-confirmar-import')"); await clicar("#btn-confirmar-import");
await pg.aguardar("document.querySelectorAll('#linhas tr[data-id]').length > 0");
const baseInicial = await base();
let tipos = [];

await teste("1. Todas as ocorrências: opções = critério do envio em lote; lista completa", async () => {
  const ops = await opcoes("#filtro-ocorrencia"), doLote = await js(`window.CentralDisparos.opcoesOcorrencia(${S}.incidentesParaDisparo())`);
  igual(ops, ["", ...doLote], "mesmas opções do envio em lote"); tipos = doLote;
  for (const t of tiposNoArquivo) verdade(tipos.includes(t), "faltou o tipo " + t);
  for (const t of ["Choque elétrico", "Condutor desnivelado", "Condutor partido", "Defeito no transformador", "Falta de energia — residência", "Faíscas na rede",
    "Faíscas no ramal de serviço", "Inversão de fase", "Objeto estranho na rede", "Oscilação de energia", "Poste abalroado", "Poste inclinado",
    "Solicitação não identificada — pedir mais informações", "Tensão alta", "Tensão baixa", "Transformador com vazamento de óleo", "Árvore na rede"]) verdade(tipos.includes(t), "faltou no filtro: " + t);
  igual(await js(`document.querySelector("#filtro-ocorrencia").value`), "", "padrão: todas");
  const v = await visiveis(); igual(v, await esperado("")); igual(v.length, await js(`${S}.grupos().length`), "lista completa");
});
await teste("2. Cada tipo de ocorrência mostra só os incidentes daquele tipo; 'Todas' restaura a lista", async () => {
  let soma = 0;
  for (const t of tipos) {
    await escolher("#filtro-ocorrencia", t);
    const v = await visiveis(), e = await esperado(t);
    igual(v, e, "tipo " + t); verdade(v.length >= 1, "nenhum incidente em " + t); soma += v.length;
    verdade((await js(`document.querySelector("#fd-info").textContent`)).includes(`${v.length} incidente(s)`), "contagem na linha de informação");
  }
  igual(soma, await js(`${S}.grupos().length`), "os tipos somam a lista inteira (cada incidente em um tipo só)");
  await escolher("#filtro-ocorrencia", ""); igual((await visiveis()).length, await js(`${S}.grupos().length`), "Todas restaura");
});
await teste("3. Combinação com a pesquisa (incidente, CALL, nome, local)", async () => {
  await escolher("#filtro-ocorrencia", "Condutor partido");
  const alvo = await js(`${S}.incidentesParaDisparo().find((x) => x.ocorrencia === "Condutor partido")`), outro = await js(`${S}.incidentesParaDisparo().find((x) => x.ocorrencia === "Poste inclinado")`);
  await escolher("#busca", alvo.call_id, "input"); igual(await visiveis(), [alvo.chave], "CALL do tipo escolhido");
  await escolher("#busca", alvo.incidente, "input"); igual(await visiveis(), [alvo.chave], "número do incidente");
  await escolher("#busca", outro.call_id, "input"); igual(await visiveis(), [], "CALL de outro tipo fica fora");
  verdade((await js(`document.querySelector("#linhas").textContent`)).includes("Nenhuma ocorrência neste filtro"), "mensagem de lista vazia");
  await escolher("#busca", "Itabaiana", "input"); igual(await visiveis(), await esperado("Condutor partido", { busca: "Itabaiana" }), "local");
  await escolher("#busca", "", "input"); await escolher("#filtro-ocorrencia", "");
});
await teste("4. Combinação com o filtro de data (período, Hoje, Todas as datas)", async () => {
  await escolher("#filtro-ocorrencia", "Falta de energia — residência");
  await escolher("#fd-de", "2026-03-11"); await escolher("#fd-ate", "2026-03-11"); await clicar("#fd-aplicar"); await espera(100);
  const v = await visiveis(); igual(v, await esperado("Falta de energia — residência"), "período 11/03");
  verdade(await js(`[...document.querySelectorAll("#linhas tr[data-grupo] td.data-hora")].every((td) => td.textContent.startsWith("11/03/2026"))`), "só 11/03");
  await clicar("#fd-hoje"); await espera(100); igual(await visiveis(), [], "Hoje: dados fictícios são de março");
  await clicar("#fd-todas"); await espera(100); igual(await visiveis(), await esperado("Falta de energia — residência"), "Todas as datas");
  await escolher("#filtro-ocorrencia", "");
});
await teste("5. Combinação com Regionais e municípios e Situação", async () => {
  await js("(window.CentralUI.filtroRegionais.definir([\"030\"]), true)"); await espera(80);
  for (const t of ["Falta de energia — residência", "Condutor partido", "Tensão alta"]) {
    await escolher("#filtro-ocorrencia", t);
    igual(await visiveis(), await esperado(t, { regionais: ["030"] }), "Itabaiana + " + t);
  }
  verdade(await js(`[...document.querySelectorAll("#linhas tr[data-grupo] .c-local")].every((td) => /Itabaiana/i.test(td.title))`), "só Itabaiana");
  await js("(window.CentralUI.filtroRegionais.limpar(), true)"); await espera(80); await escolher("#filtro-ocorrencia", "Condutor partido"); await escolher("#filtro-estado", "risco");
  igual(await visiveis(), await esperado("Condutor partido", { estado: "risco" }), "situação: com indício de risco");
  await escolher("#filtro-estado", ""); await escolher("#filtro-ocorrencia", "");
});
await teste("6. Filtrar não altera a base: mesmas comunicações, mesmos estados, nenhum lote novo", async () => {
  igual(await base(), baseInicial);
});
await teste("7. Alertas de risco preservados: faixa e fundo vermelhos, ⚠ e etiqueta de risco nos incidentes perigosos", async () => {
  await escolher("#filtro-ocorrencia", "Condutor partido");
  const r = await js(`(() => { const gr = new Map(${S}.grupos().map((g) => [g.chave, g])), tr = [...document.querySelectorAll("#linhas tr[data-grupo]")];
    return tr.map((t) => { const g = gr.get(t.dataset.grupo), td = t.querySelector("td"), chip = t.querySelector(".chip-risco");
      return { risco: g.risco, classe: t.classList.contains("linha-risco"), faixa: getComputedStyle(td).boxShadow, fundo: getComputedStyle(t).backgroundColor,
        chip: !!chip, chipFundo: chip ? getComputedStyle(chip).backgroundColor : null, etq: !!t.querySelector(".c-motivo .etq.risco") }; }); })()`);
  verdade(r.length >= 2 && r.every((x) => x.risco >= 1), "condutor partido com risco: " + JSON.stringify(r));
  for (const x of r) {
    verdade(x.classe && x.faixa.includes("rgb(180, 35, 24)") && x.fundo === "rgb(255, 246, 245)", "faixa/fundo de risco: " + JSON.stringify(x));
    verdade(x.chip && x.chipFundo === "rgb(180, 35, 24)", "⚠ vermelho: " + JSON.stringify(x));
    verdade(x.etq, "etiqueta da mensagem em vermelho (risco)");
  }
  await escolher("#filtro-ocorrencia", "Oscilação de energia");
  verdade(await js(`[...document.querySelectorAll("#linhas tr[data-grupo]")].every((t) => !t.classList.contains("linha-risco") && !t.querySelector(".chip-risco"))`), "ocorrência comum não parece perigosa");
  await escolher("#filtro-ocorrencia", "");
});
await teste("8-9. Abrir incidente filtrado e preparar a mensagem de WhatsApp (modelo sugerido e texto)", async () => {
  await escolher("#filtro-ocorrencia", "Poste inclinado");
  const x = await js(`${S}.incidentesParaDisparo().find((y) => y.ocorrencia === "Poste inclinado")`);
  await clicar(`#linhas tr[data-grupo="${x.chave}"]`); await pg.aguardar("!!document.querySelector('#p-modelo')");
  verdade((await js(`document.querySelector("#painel h2").textContent`)).includes(x.incidente), "painel do incidente");
  igual(await js(`document.querySelector("#p-modelo").value`), x.modelo, "mesma mensagem sugerida do envio em lote");
  const texto = await js(`document.querySelector("#p-texto").value`);
  verdade(texto.startsWith("Olá, aqui é a Energisa.") && texto.includes(x.incidente), texto.slice(0, 80));
  await clicar("#painel [data-wa]"); await pg.aguardar("window.__links.length > 0");
  const url = await js("window.__links[window.__links.length - 1]");
  verdade(/whatsapp\.com|wa\.me/.test(url) && decodeURIComponent(url).includes(x.incidente), "link do WhatsApp com a mensagem: " + url.slice(0, 60));
  await js(`(document.querySelector("#p-fechar") && document.querySelector("#p-fechar").click(), true)`); await escolher("#filtro-ocorrencia", "");
});
await teste("10. Envio em lote preservado: filtro próprio com as mesmas opções, independente do individual", async () => {
  await escolher("#filtro-ocorrencia", "Tensão baixa");
  await clicar('[data-modo="lote"]'); await pg.aguardar("!!document.querySelector('#ds-ocorrencia')");
  await escolher("#ds-situacao", "todas");
  igual(await opcoes("#ds-ocorrencia"), ["", ...tipos], "mesmas opções");
  igual(await js(`document.querySelector("#ds-ocorrencia").value`), "", "o lote não herda a escolha do individual");
  await escolher("#ds-ocorrencia", "Árvore na rede");
  const lote = await js(`[...document.querySelectorAll("#ds-linhas tr[data-chave]")].map((t) => t.dataset.chave).sort()`);
  igual(lote, await esperado("Árvore na rede"), "lote filtra pelo mesmo critério");
  await clicar('[data-modo="individual"]'); await espera(150);
  igual(await js(`document.querySelector("#filtro-ocorrencia").value`), "Tensão baixa", "o individual não herda a escolha do lote");
  igual(await visiveis(), await esperado("Tensão baixa"));
  await escolher("#filtro-ocorrencia", "");
});
await teste("11. Alinhamento e responsividade dos filtros (1366, 1024 e 390): mesma altura, sem sobreposição, sem rolagem lateral", async () => {
  const medir = () => js(`(() => { const r = (e) => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, b: b.bottom, d: b.right }; };
    const campos = [...document.querySelectorAll(".barra-filtros > .campo")].map((l) => ({ l: r(l), c: r(l.querySelector(".fr-gatilho") || l.querySelector("select, input")) }));
    const data = [...document.querySelectorAll("#filtro-data input[type=date], #filtro-data > .mini-botao:not(.oculto), #filtro-data .segmentos .mini-botao")].map(r);
    return { campos, data, pagina: document.documentElement.scrollWidth - innerWidth, largura: innerWidth }; })()`);
  const sobrepoe = (a, b) => a.x < b.d - 1 && b.x < a.d - 1 && a.y < b.b - 1 && b.y < a.b - 1;
  for (const [l, a] of [[1366, 768], [1024, 768], [390, 844]]) {
    await pg.tamanho(l, a); const m = await medir();
    igual(m.campos.length, 4, "quatro campos (regionais, ocorrência, situação, pesquisa)");
    verdade(m.pagina <= 0, `${l}: rolagem lateral (${m.pagina}px)`);
    verdade(new Set(m.campos.map((x) => Math.round(x.c.h))).size === 1, `${l}: alturas diferentes ${JSON.stringify(m.campos.map((x) => x.c.h))}`);
    verdade(new Set(m.data.map((x) => Math.round(x.h))).size === 1, `${l}: data/botões com alturas diferentes ${JSON.stringify(m.data.map((x) => x.h))}`);
    for (let i = 0; i < m.campos.length; i++) for (let j = i + 1; j < m.campos.length; j++) verdade(!sobrepoe(m.campos[i].l, m.campos[j].l), `${l}: campos ${i} e ${j} sobrepostos`);
    for (let i = 0; i < m.data.length; i++) for (let j = i + 1; j < m.data.length; j++) verdade(!sobrepoe(m.data[i], m.data[j]), `${l}: controles de data ${i} e ${j} sobrepostos`);
    verdade(m.campos.every((x) => x.l.d <= m.largura + 0.5 && x.l.x >= 0), `${l}: campo fora da tela`);
    if (l === 1366) verdade(new Set(m.campos.map((x) => Math.round(x.c.y))).size === 1, "1366: os quatro campos na mesma linha");
    if (l === 1366) verdade(new Set(m.data.map((x) => Math.round(x.b))).size === 1, "1366: datas e botões alinhados pela base");
    if (l === 390) verdade(new Set(m.campos.map((x) => Math.round(x.c.y))).size === 4, "390: um campo por linha");
    if (process.env.FOTOS) await pg.foto(join(process.env.FOTOS, `filtro-ocorrencia-${l}.png`));
  }
  await pg.tamanho(1366, 768);
});
await teste("12. Console sem erros", async () => { igual(pg.erros, [], "erros"); });

await nav.fechar();
try { rmSync(pasta, { recursive: true, force: true }); } catch (e) { /* arquivo temporário */ }
const falhas = resultados.filter((r) => !r[0]).length;
console.log(`\nTipos de ocorrência no arquivo fictício: ${tiposNoArquivo.size}`);
console.log(`${resultados.length} testes do filtro de ocorrência (envio individual) · ${resultados.length - falhas} aprovados · ${falhas} com falha`);
process.exitCode = falhas ? 1 : 0;
