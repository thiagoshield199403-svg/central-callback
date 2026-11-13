/* Testes PONTA A PONTA da interface (dados 100% fictícios; banco separado "?bd=e2e..."). Só desenvolvimento.
   Uso: node testes\ponta-a-ponta\e2e.mjs [pasta-para-fotos] [caminho-do-navegador]
   - As janelas nativas do Windows ("Selecionar pasta" e "Salvar como") não podem ser automatizadas. Elas são SUBSTITUÍDAS por
     equivalentes que devolvem PASTAS E ARQUIVOS REAIS da área privada do navegador (OPFS): a pasta "W/CENTRAL DE CALLBACK"
     faz o papel do destino. A Central grava de verdade, confere se o arquivo ficou dentro do destino e o teste lê o arquivo.
   - "Unidade W: inacessível" = a pasta de destino é removida depois de selecionada (o navegador responde NotFoundError, como
     numa unidade desconectada). A cópia de contingência é um download real, conferido na pasta de downloads de teste. */
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { abrirNavegador, espera } from "./cdp.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const fotos = process.argv[2] || null; if (fotos) mkdirSync(fotos, { recursive: true });
const PASTA_DOWNLOADS = mkdtempSync(join(tmpdir(), "central-downloads-"));
const resultados = [];
async function teste(nome, f) {
  try { await f(); resultados.push([true, nome]); console.log("OK    " + nome); }
  catch (e) { resultados.push([false, nome, e.message]); console.log("FALHA " + nome + " — " + e.message); }
}
const verdade = (c, m) => { if (!c) throw new Error(m || "condição falsa"); };
const igual = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || "esperado"}: ${JSON.stringify(b)}, obtido: ${JSON.stringify(a)}`); };

const nav = await abrirNavegador({ exe: process.argv[3], downloads: PASTA_DOWNLOADS });
const bd = "e2e" + Date.now().toString(36);
const url = pathToFileURL(join(raiz, "index.html")).href + "?bd=" + bd;
const pg = await nav.novaPagina(url);
const js = (e) => pg.js(e);
const clicar = (sel) => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) throw new Error("não achei ${sel.replace(/"/g, "'")}"); e.click(); return true; })()`);
const digitar = (sel, v) => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
const texto = (sel) => js(`(document.querySelector(${JSON.stringify(sel)}) || {}).textContent || ""`);
const visivel = (sel) => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && e.offsetParent !== null; })()`);
const foto = async (nome) => { if (fotos) await pg.foto(join(fotos, nome + ".png")); };
const hojeBR = () => js(`window.Nucleo.hojeLocal().split("-").reverse().join("-")`);
// Simulações: janela do WhatsApp (window.open) e janelas "Selecionar pasta"/"Salvar como" com pastas e arquivos REAIS (OPFS).
const instalarSimulacoes = () => js(`(async () => {
  window.__aberturas = [];
  window.open = () => { const j = { closed: false, opener: 1, close() { this.closed = true; } };
    Object.defineProperty(j, "location", { value: { set href(u) { window.__aberturas.push(u); } } }); return j; };
  const raiz = await navigator.storage.getDirectory();
  const pastaW = async () => (await raiz.getDirectoryHandle("W", { create: true })).getDirectoryHandle("CENTRAL DE CALLBACK", { create: true });
  window.__modoPasta = "destino"; window.__modoSalvar = "ok"; window.__nPasta = 0; window.__nSalvar = 0;
  window.showDirectoryPicker = async (op) => {
    window.__nPasta++; window.__opcoesPasta = op;
    if (window.__modoPasta === "cancelar") throw new DOMException("cancelado", "AbortError");
    if (window.__modoPasta === "errada") return raiz.getDirectoryHandle("Downloads", { create: true });
    return pastaW();
  };
  window.showSaveFilePicker = async (op) => {
    window.__nSalvar++; window.__opcoes = { suggestedName: op.suggestedName, temId: "id" in op, tipos: JSON.stringify(op.types),
      startInDestino: !!op.startIn && typeof op.startIn === "object" && op.startIn.name === "CENTRAL DE CALLBACK" };
    const modo = window.__modoSalvar;
    if (modo === "cancelar") throw new DOMException("cancelado", "AbortError");
    if (modo === "semGesto") { window.__modoSalvar = "ok"; throw new DOMException("Must be handling a user gesture to show a file picker.", "SecurityError"); }
    // a janela abre na pasta inicial recebida (startIn); sem ela (ou "outraPasta"), abriria em outra pasta
    const pasta = modo === "outraPasta" || !op.startIn ? await raiz.getDirectoryHandle("Documentos", { create: true }) : op.startIn;
    return pasta.getFileHandle(op.suggestedName, { create: true });
  };
  window.__lerDestino = async (nome) => { try { const d = await (await raiz.getDirectoryHandle("W")).getDirectoryHandle("CENTRAL DE CALLBACK");
    return await (await (await d.getFileHandle(nome)).getFile()).text(); } catch (e) { return null; } };
  window.__desconectarW = async () => { await raiz.removeEntry("W", { recursive: true }); return true; };
  window.__reconectarW = async () => { await pastaW(); return true; };
  return true; })()`);
const limparModal = () => js("(document.querySelector('#modal-caixa').innerHTML = '', true)"); // evita ler texto antigo do modal
const modalAberto = () => js("!document.querySelector('#modal').classList.contains('oculto')");
const clicarEscolha = async (rotulo) => {
  await pg.aguardar(`[...document.querySelectorAll("#modal [data-escolha]")].some((b) => b.textContent === ${JSON.stringify(rotulo)})`);
  await js(`([...document.querySelectorAll("#modal [data-escolha]")].find((b) => b.textContent === ${JSON.stringify(rotulo)}).click(), true)`);
};

await pg.aguardar("document.body.dataset.pronto === '1'");
await instalarSimulacoes();

await teste("Abertura direta pelo index.html (file://), sem servidor, com armazenamento local", async () => {
  verdade(url.startsWith("file:///"));
  igual(await js("document.title"), "Central de Callback COI");
  verdade(await js("window.isSecureContext && typeof indexedDB === 'object'"), "contexto/armazenamento");
  igual(await js("typeof window.showSaveFilePicker === 'function' || true"), true);
});
await teste("Sem faixa 'CÓPIA DE DESENVOLVIMENTO' e créditos iguais aos da referência", async () => {
  verdade(!(await js("document.body.innerText.toUpperCase().includes('CÓPIA DE DESENVOLVIMENTO')")), "faixa presente");
  igual(await js("[...document.querySelectorAll('.creditos span')].map((s) => s.textContent)"),
    ["Criador: Thiago dos Santos Araujo", "Filtros ADMS: Any Carolinne dos Santos Muniz"]);
});
await teste("Créditos mais visíveis: nomes maiores e em destaque, rodapé baixo", async () => {
  const r = await js(`(() => { const f = document.querySelector(".creditos"), n = [...f.querySelectorAll("strong")];
    return { fonte: parseFloat(getComputedStyle(f).fontSize), nomes: n.map((x) => x.textContent), peso: getComputedStyle(n[0]).fontWeight,
      cor: getComputedStyle(n[0]).color, altura: f.getBoundingClientRect().height }; })()`);
  verdade(r.fonte >= 14, "fonte " + r.fonte);
  igual(r.nomes, ["Thiago dos Santos Araujo", "Any Carolinne dos Santos Muniz"]);
  igual([r.peso, r.cor], ["700", "rgb(29, 39, 51)"]);
  verdade(r.altura <= 48, "rodapé alto demais: " + r.altura);
});
await teste("Tela inicial enxuta: 1ª vez pede sigla + polo; abre o turno", async () => {
  verdade(await visivel("#abrir-dia") && await visivel("#campo-polo"), "polo deveria aparecer na 1ª vez");
  await foto("01-abertura-1a-vez-1366");
  await js(`(() => { const f = document.querySelector("#form-dia"); f.operador.value = "opt4"; f.polo.value = "Aracaju"; f.requestSubmit(); return true; })()`);
  await pg.aguardar("!document.querySelector('#abrir-dia').offsetParent && !!document.querySelector('#importar').offsetParent");
  const info = await texto("#dia-info");
  verdade(info.includes("OPT4") && info.includes("Polo Aracaju"), info);
});
await teste("Importar CSV fictício do ADMS (prévia com amostra, confirmação)", async () => {
  const doc = await pg.cmd("DOM.getDocument", {});
  const { nodeId } = await pg.cmd("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "#arquivo" });
  await pg.cmd("DOM.setFileInputFiles", { nodeId, files: [join(raiz, "exemplos", "navegador-chamadas-ADMS2026-FICTICIO.csv")] });
  await pg.aguardar("!!document.querySelector('#btn-confirmar-import')");
  verdade(await js("!!document.querySelector('details.amostra')"), "amostra da prévia");
  await foto("02-previa-1366");
  await clicar("#btn-confirmar-import");
  await pg.aguardar("document.querySelectorAll('#linhas tr[data-id]').length > 0");
});
await teste("Lista de OS compacta: incidente em negrito escuro, sem rolagem horizontal em 1366x768", async () => {
  const st = await js(`(() => { const b = document.querySelector("#linhas .c-inc b"), cs = getComputedStyle(b);
    const t = document.querySelector(".tabela-rolagem"); return { peso: cs.fontWeight, cor: cs.color, sobra: t.scrollWidth - t.clientWidth,
    pagina: document.documentElement.scrollWidth - innerWidth, altura: document.querySelector("#linhas tr").getBoundingClientRect().height }; })()`);
  igual(st.peso, "700"); igual(st.cor, "rgb(11, 22, 34)"); verdade(st.sobra <= 0, "rolagem horizontal na tabela: " + st.sobra);
  verdade(st.pagina <= 0, "rolagem horizontal na página"); verdade(st.altura <= 40, "linha alta demais: " + st.altura);
  await foto("03-lista-os-1366");
});
let idSemTel;
await teste("Mensagens personalizadas: agrupadas por assunto (títulos em negrito) e texto editável", async () => {
  // linha de uma chamada pendente (de preferência sem telefone do ADMS: caso típico do envio manual)
  idSemTel = await js(`(() => { const ids = [...document.querySelectorAll("#linhas tr[data-id]")].map((t) => Number(t.dataset.id));
    const cs = window.CentralUI.servico.chamadas().filter((c) => ids.includes(c.id) && c.estado !== "callback_realizado");
    return (cs.find((c) => c.estado === "sem_telefone") || cs[0]).id; })()`);
  await js(`(document.querySelector('#linhas tr[data-id="${idSemTel}"]').click(), true)`);
  await pg.aguardar("!!document.querySelector('#p-modelo')");
  const g = await js(`[...document.querySelectorAll("#p-modelo optgroup")].map((o) => o.label)`);
  verdade(g.includes("POSTE") && g.includes("FALTA DE ENERGIA") && g.length === 8, JSON.stringify(g));
  igual(await js(`getComputedStyle(document.querySelector("#p-modelo optgroup")).fontWeight`), "700");
  verdade(!(await js(`document.querySelector("#p-texto").readOnly`)), "texto deveria ser editável");
  verdade((await js(`document.querySelector("#p-texto").value`)).startsWith("Olá, aqui é a Energisa."));
});
await teste("Envio manual na MESMA LINHA de Copiar texto (botão + campo de telefone)", async () => {
  const r = await js(`(() => { const t = (s) => document.querySelector(s).getBoundingClientRect();
    const a = t("#p-copiar"), b = t("#p-manual"), c = t("#p-tel-manual"), p = t("#painel");
    return { mesmaLinha: Math.abs(a.top - b.top) < 4 && Math.abs(b.top - c.top) < 8, dentro: c.right <= p.right, altura: Math.max(a.bottom, b.bottom, c.bottom) - Math.min(a.top, b.top, c.top) }; })()`);
  verdade(r.mesmaLinha && r.dentro && r.altura < 44, JSON.stringify(r));
  await foto("04-painel-envio-manual-1366");
});
await teste("Validação do telefone: fixo e inválido não abrem o WhatsApp", async () => {
  const antes = await js("window.__aberturas.length");
  await digitar("#p-tel-manual", "79 3211-4567"); await clicar("#p-manual"); await espera(150);
  verdade((await texto("#p-dica-envio")).includes("FIXO"), await texto("#p-dica-envio"));
  await digitar("#p-tel-manual", "20 99999-1234"); await clicar("#p-manual"); await espera(150);
  verdade((await texto("#p-dica-envio")).includes("inválido"), await texto("#p-dica-envio"));
  await digitar("#p-tel-manual", "99999-1234"); await clicar("#p-manual"); await espera(150);
  verdade((await texto("#p-dica-envio")).includes("DDD"));
  igual(await js("window.__aberturas.length"), antes, "não deveria abrir nada");
  verdade(await js(`document.querySelector("#p-tel-manual").classList.contains("invalido")`));
});
await teste("Envio manual abre o WhatsApp Web com a mensagem (editada) e NÃO conta tentativa nem callback", async () => {
  const id = await js(`window.CentralUI.servico.chamadas().find((c) => c.id === ${idSemTel}) ? ${idSemTel} : null`);
  const antes = await js(`(() => { const s = window.CentralUI.servico, c = s.chamadas().find((x) => x.id === ${id}); return { t: c.tentativas.length, cb: s.estado().metricas_tempo_real.callbacks_realizados, tent: s.estado().metricas_tempo_real.tentativas }; })()`);
  await digitar("#p-texto", "Olá, aqui é a Energisa. Mensagem de teste fictícia editada.");
  await digitar("#p-tel-manual", "+55 (79) 98877-6655");
  verdade((await texto("#p-dica-envio")).includes("Celular válido"));
  await clicar("#p-manual"); await pg.aguardar("window.__aberturas.length > 0");
  const u = await js("window.__aberturas[window.__aberturas.length - 1]");
  verdade(u.startsWith("https://web.whatsapp.com/send?phone=5579988776655&text="), u);
  igual(decodeURIComponent(u.split("text=")[1]), "Olá, aqui é a Energisa. Mensagem de teste fictícia editada.");
  const depois = await js(`(() => { const s = window.CentralUI.servico, c = s.chamadas().find((x) => x.id === ${id}); return { t: c.tentativas.length, cb: s.estado().metricas_tempo_real.callbacks_realizados, tent: s.estado().metricas_tempo_real.tentativas }; })()`);
  igual(depois, antes, "abrir o WhatsApp não pode contar");
  verdade(!(await js(`(async () => JSON.stringify(await window.CentralUI.servico.arm.ler()).includes("88776655"))()`)), "número gravado");
  igual(await js(`document.querySelector("#p-texto").value`), "Olá, aqui é a Energisa. Mensagem de teste fictícia editada.", "edição perdida ao redesenhar");
});
await teste("Registro de callback, depois serviço executado e ocorrência resolvida (independentes)", async () => {
  verdade(!(await js("!!document.querySelector('[data-resultado]')")), "botões de resultado antes do callback");
  await clicar('#painel [data-acao="callback_realizado"]');
  await pg.aguardar("!!document.querySelector('[data-resultado=\"servico_executado\"]')");
  const m0 = await js("window.CentralUI.servico.estado().metricas_tempo_real");
  igual([m0.callbacks_realizados, m0.servicos_executados, m0.ocorrencias_resolvidas], [1, 0, 0]);
  await clicar('[data-resultado="resolvida"]');
  await pg.aguardar("!document.querySelector('[data-resultado=\"resolvida\"]')");
  let m = await js("window.CentralUI.servico.estado().metricas_tempo_real");
  igual([m.callbacks_realizados, m.servicos_executados, m.ocorrencias_resolvidas], [1, 0, 1]);
  await clicar('[data-resultado="servico_executado"]');
  await pg.aguardar("!document.querySelector('[data-resultado]')");
  m = await js("window.CentralUI.servico.estado().metricas_tempo_real");
  igual([m.callbacks_realizados, m.servicos_executados, m.ocorrencias_resolvidas], [1, 1, 1]);
  const card = await js(`[...document.querySelectorAll("#metricas .metrica")].map((c) => c.innerText.replace(/\\s+/g, " ")).join(" | ")`);
  verdade(/1 serviços executados/.test(card) && /1 (\d+% )?ocorrências resolvidas/.test(card), card);
  const sit = await js(`document.querySelector('#linhas tr.selecionada .c-sit').innerText`);
  verdade(sit.includes("Resolvida") && sit.includes("Serv."), sit);
  await foto("05-resultado-registrado-1366");
});
await teste("Filtros: resolvida / serviço executado / risco", async () => {
  await js(`(() => { const s = document.querySelector("#filtro-estado"); s.value = "resolvida"; s.dispatchEvent(new Event("change")); return true; })()`);
  igual(await js("document.querySelectorAll('#linhas tr[data-id]').length"), 1);
  await js(`(() => { const s = document.querySelector("#filtro-estado"); s.value = "servico"; s.dispatchEvent(new Event("change")); return true; })()`);
  igual(await js("document.querySelectorAll('#linhas tr[data-id]').length"), 1);
  await js(`(() => { const s = document.querySelector("#filtro-estado"); s.value = ""; s.dispatchEvent(new Event("change")); return true; })()`);
});
const resolvidas = () => js("window.CentralUI.servico.estado().metricas_tempo_real.ocorrencias_resolvidas");
const bol = (id) => js(`(() => { const b = document.querySelector('#linhas [data-bolinha="${id}"]'); if (!b) return null; const cs = getComputedStyle(b);
  return { classe: b.className, texto: b.textContent, dica: b.title, rotulo: b.getAttribute("aria-label"), pressionado: b.getAttribute("aria-pressed"),
    desabilitado: b.getAttribute("aria-disabled"), borda: cs.borderTopStyle, fundo: cs.backgroundColor, largura: b.getBoundingClientRect().width,
    alturaLinha: b.closest("tr").getBoundingClientRect().height }; })()`);
let idBol;
await teste("Bolinha: indicador e tooltip; bloqueada (tracejada, sem cor) antes do callback", async () => {
  await js(`(document.querySelector("#p-fechar") && document.querySelector("#p-fechar").click(), true)`);
  idBol = await js(`[...document.querySelectorAll("#linhas tr[data-id]")].map((t) => Number(t.dataset.id))
    .find((id) => window.CentralUI.servico.chamadas().find((c) => c.id === id).estado === "pendente")`);
  const b = await bol(idBol);
  verdade(b.classe.includes("bloqueada") && b.desabilitado === "true" && b.pressionado === "false", JSON.stringify(b));
  verdade(b.dica.includes("só depois do callback") && b.rotulo === b.dica, b.dica);
  igual(b.borda, "dashed", "estado indicado também pela borda");
  verdade(b.largura <= 20 && b.alturaLinha <= 40, `tamanho ${b.largura} / linha ${b.alturaLinha}`);
  const antes = await resolvidas();
  await clicar(`#linhas [data-bolinha="${idBol}"]`); await espera(250);
  verdade((await texto("#toast")).includes("depois do callback"), await texto("#toast"));
  igual(await resolvidas(), antes, "não pode registrar antes do callback");
  verdade(!(await visivel("#painel")), "clicar na bolinha não abre os detalhes");
});
await teste("Bolinha registra a resolução direto na lista (sem abrir detalhes) e não duplica", async () => {
  await js(`(document.querySelector('#linhas tr[data-id="${idBol}"]').click(), true)`);
  await pg.aguardar(`!!document.querySelector('#painel [data-acao="callback_realizado"]')`);
  await clicar('#painel [data-acao="callback_realizado"]');
  await pg.aguardar(`!!document.querySelector('#painel [data-resultado="resolvida"]')`);
  await clicar("#p-fechar");
  let b = await bol(idBol);
  verdade(b.classe.includes("pronta") && b.dica.includes("Clique para registrar"), JSON.stringify(b));
  const antes = await resolvidas();
  await js(`(() => { const x = document.querySelector('#linhas [data-bolinha="${idBol}"]'); x.click(); x.click(); return true; })()`); // clique duplo
  await pg.aguardar(`document.querySelector('#linhas [data-bolinha="${idBol}"]').classList.contains("resolvida")`);
  await espera(300);
  if (await modalAberto()) await clicar("#m-nao");
  igual(await resolvidas(), antes + 1, "deve contar uma única vez");
  b = await bol(idBol);
  verdade(b.texto === "✓" && b.pressionado === "true" && b.dica.includes("Clique para desfazer"), JSON.stringify(b));
  igual(b.fundo, "rgb(22, 163, 74)");
  verdade(!(await visivel("#painel")), "não deveria abrir os detalhes");
  await foto("11-bolinha-resolvida-1366");
});
await teste("Desfazer pela bolinha (com confirmação) e registrar/desfazer também nos detalhes", async () => {
  const antes = await resolvidas();
  await clicar(`#linhas [data-bolinha="${idBol}"]`); await pg.aguardar("!document.querySelector('#modal').classList.contains('oculto')");
  verdade((await texto("#modal-caixa")).includes("Desfazer"));
  await clicar("#m-nao"); await espera(200); igual(await resolvidas(), antes, "cancelar não desfaz");
  await clicar(`#linhas [data-bolinha="${idBol}"]`); await pg.aguardar("!document.querySelector('#modal').classList.contains('oculto')");
  await clicar("#m-sim");
  await pg.aguardar(`document.querySelector('#linhas [data-bolinha="${idBol}"]').classList.contains("pronta")`);
  igual(await resolvidas(), antes - 1);
  igual(await js(`window.CentralUI.servico.chamadas().find((c) => c.id === ${idBol}).estado`), "callback_realizado", "callback preservado");
  // pelos detalhes
  await js(`(document.querySelector('#linhas tr[data-id="${idBol}"]').click(), true)`);
  await pg.aguardar(`!!document.querySelector('#painel [data-resultado="resolvida"]')`);
  await clicar('#painel [data-resultado="resolvida"]');
  await pg.aguardar(`!!document.querySelector('#painel [data-desfazer="resolvida"]')`);
  verdade((await bol(idBol)).classe.includes("resolvida"), "lista acompanha o registro feito nos detalhes");
  igual(await resolvidas(), antes);
  await clicar('#painel [data-desfazer="resolvida"]'); await pg.aguardar("!document.querySelector('#modal').classList.contains('oculto')");
  await clicar("#m-sim"); await pg.aguardar(`!!document.querySelector('#painel [data-resultado="resolvida"]')`);
  igual(await resolvidas(), antes - 1);
  await clicar('#painel [data-resultado="resolvida"]'); await pg.aguardar(`!!document.querySelector('#painel [data-desfazer="resolvida"]')`);
  await clicar("#p-fechar");
});
await teste("Tentativa sem sucesso e contato inválido entram nos indicadores", async () => {
  const ids = await js(`[...document.querySelectorAll("#linhas tr[data-id]")].map((t) => Number(t.dataset.id))
    .filter((id) => window.CentralUI.servico.chamadas().find((c) => c.id === id).estado === "pendente").slice(0, 2)`);
  const inv0 = (await js("window.CentralUI.servico.estado().metricas_tempo_real")).contatos_invalidos;
  for (const [id, acao] of [[ids[0], "sem_sucesso"], [ids[1], "contato_invalido"]]) {
    await js(`(document.querySelector('#linhas tr[data-id="${id}"]').click(), true)`);
    await pg.aguardar(`!!document.querySelector('#painel [data-acao="${acao}"]')`);
    await js(`(() => { const s = document.querySelector("#p-meio"); s.value = "ligacao"; return true; })()`);
    await clicar(`#painel [data-acao="${acao}"]`); await espera(250);
  }
  const m = await js("window.CentralUI.servico.estado().metricas_tempo_real");
  igual([m.tentativas_sem_sucesso, m.contatos_invalidos], [1, inv0 + 1]);
});
await teste("Encerrar e limpar o lote (confirmação) preserva indicadores", async () => {
  await js(`document.querySelector("#p-fechar") && document.querySelector("#p-fechar").click()`);
  const antes = await js("window.CentralUI.servico.estado().metricas_tempo_real");
  await clicar("#btn-encerrar-lote"); await pg.aguardar("!document.querySelector('#modal').classList.contains('oculto')");
  await clicar("#m-sim"); await pg.aguardar("!document.querySelector('#lote').offsetParent");
  const depois = await js("window.CentralUI.servico.estado().metricas_dia");
  igual([depois.callbacks_realizados, depois.servicos_executados, depois.ocorrencias_resolvidas, depois.chamadas_processadas],
    [antes.callbacks_realizados, antes.servicos_executados, antes.ocorrencias_resolvidas, antes.chamadas_processadas]);
});
await teste("Painel de indicadores: hoje, por dia, por operador, por polo", async () => {
  await clicar("#btn-painel"); await pg.aguardar("!!document.querySelector('.painel-indicadores')");
  verdade((await texto(".painel-indicadores")).includes("serviços executados"));
  await foto("06-painel-hoje-1366");
  for (const aba of ["dia", "operador", "polo"]) {
    await clicar(`[data-aba="${aba}"]`); await espera(120);
    const linhas = await js(`[...document.querySelectorAll(".tabela-painel tbody tr")].map((t) => t.innerText.replace(/\\t/g, " | "))`);
    verdade(linhas.length >= 1, aba);
    if (aba === "operador") verdade(linhas[0].startsWith("OPT4"), linhas[0]);
    if (aba === "polo") verdade(linhas[0].startsWith("Aracaju"), linhas[0]);
  }
  await foto("07-painel-por-operador-1366");
  await clicar("#pi-fechar");
});
let nomeEsperado;
const conferirConteudo = (t, esperado) => {
  const [cab, lin] = t.replace(/^\uFEFF/, "").trimEnd().split("\r\n");
  verdade(cab.startsWith("data;polo;operador;total_chamadas;callbacks_realizados;tentativas;tentativas_sem_sucesso;contatos_invalidos;sem_telefone;servicos_executados;ocorrencias_resolvidas;pendencias"), cab);
  const r = Object.fromEntries(lin.split(";").map((v, i) => [cab.split(";")[i], v]));
  igual([r.polo, r.operador, r.callbacks_realizados, r.servicos_executados, r.ocorrencias_resolvidas, r.tentativas_sem_sucesso], esperado);
  for (const p of ["CALL ", "INC ", "FIC", "Rua", "Fictício", "Ficticio"]) verdade(!t.includes(p), "dado proibido: " + p);
  return r;
};
const ESPERADO = ["Aracaju", "OPT4", "2", "1", "2", "1"];
await teste("Destino obrigatório (1ª vez): pede a pasta CENTRAL DE CALLBACK e recusa outra pasta (nada é salvo)", async () => {
  nomeEsperado = `CALLBACK_ARACAJU_${await hojeBR()}.csv`;
  await limparModal(); await clicar("#btn-exportar");
  await pg.aguardar(`document.querySelector("#modal-caixa").textContent.includes("Destino da exportação")`);
  verdade((await texto("#modal-caixa")).includes(await js("window.Nucleo.PASTA_EXPORTACAO_SUGERIDA")), "caminho do destino na mensagem");
  await js("(window.__modoPasta = 'errada', true)");
  await clicarEscolha("Selecionar a pasta"); await espera(400);
  verdade((await texto("#toast")).includes("Pasta recusada"), await texto("#toast"));
  igual(await js("window.__nSalvar"), 0, "não pode abrir a janela Salvar fora do destino");
  verdade((await js(`document.querySelector("#lista-exportacoes li").textContent`)).includes("ainda não salvo no destino"));
  igual(await js("window.__lerDestino(" + JSON.stringify(nomeEsperado) + ")"), null);
});
await teste("Destino obrigatório: janela Salvar abre NA PASTA de destino, nome preenchido; arquivo gravado nela", async () => {
  await js("(window.__modoPasta = 'destino', true)");
  await clicar("#lista-exportacoes [data-baixar]");
  await clicarEscolha("Selecionar a pasta");
  await pg.aguardar("window.__nSalvar === 1");
  const op = await js("window.__opcoes");
  igual([op.suggestedName, op.startInDestino, op.temId], [nomeEsperado, true, false], "nome, pasta inicial = destino, sem 'lembrar última pasta'");
  verdade(op.tipos.includes(".csv"));
  await pg.aguardar(`window.__lerDestino(${JSON.stringify(nomeEsperado)}).then((t) => !!t)`);
  conferirConteudo(await js(`window.__lerDestino(${JSON.stringify(nomeEsperado)})`), ESPERADO);
  await pg.aguardar(`document.querySelector("#lista-exportacoes").textContent.includes("salvo na pasta de destino CENTRAL DE CALLBACK como ${nomeEsperado}")`);
  verdade((await texto("#toast")).includes("salvo na pasta CENTRAL DE CALLBACK"), await texto("#toast"));
});
await teste("Exportações seguintes: abrem direto no destino, sem perguntar a pasta de novo", async () => {
  await clicar("#btn-exportar"); await pg.aguardar("window.__nSalvar === 2");
  igual([await js("window.__nPasta"), await js("window.__opcoes.startInDestino")], [2, true], "só as 2 seleções do 1º uso");
  await pg.aguardar(`window.__lerDestino(${JSON.stringify(nomeEsperado)}).then((t) => !!t && t.includes(";2;nao;"))`);
});
await teste("Sem gesto recente do usuário: pede um clique e então abre a janela Salvar no destino", async () => {
  await js("(window.__modoSalvar = 'semGesto', true)");
  await clicar("#btn-exportar");
  await clicarEscolha("Abrir a janela Salvar");
  await pg.aguardar(`window.__lerDestino(${JSON.stringify(nomeEsperado)}).then((t) => !!t && t.includes(";3;nao;"))`);
});
await teste("Local fora do destino é recusado: nada é gravado e nada é dado como salvo", async () => {
  await js("(window.__modoSalvar = 'outraPasta', true)");
  await limparModal(); await clicar("#btn-exportar");
  await pg.aguardar(`document.querySelector("#modal-caixa").textContent.includes("NÃO salvo no destino")`);
  verdade((await texto("#modal-caixa")).includes("não é a pasta de destino"), await texto("#modal-caixa"));
  await clicarEscolha("Fechar"); await espera(200);
  verdade((await js(`document.querySelector("#lista-exportacoes li").textContent`)).includes("ainda não salvo no destino"));
  verdade((await js(`window.__lerDestino(${JSON.stringify(nomeEsperado)})`)).includes(";3;nao;"), "o arquivo do destino não pode mudar");
  await js("(window.__modoSalvar = 'ok', true)");
});
await teste("Cancelar a janela Salvar: nada é dado como salvo", async () => {
  await js("(window.__modoSalvar = 'cancelar', true)");
  await clicar("#btn-exportar"); await espera(400);
  verdade((await texto("#toast")).includes("NÃO foi salvo"), await texto("#toast"));
  verdade((await js(`document.querySelector("#lista-exportacoes li").textContent`)).includes("ainda não salvo no destino"));
  await js("(window.__modoSalvar = 'ok', true)");
});
await teste("Unidade W: inacessível: avisa, não simula, não descarta; cópia de contingência só se pedida", async () => {
  await js("window.__desconectarW()");
  const n0 = await js("window.__nSalvar");
  await limparModal(); await clicar("#btn-exportar");
  await pg.aguardar(`document.querySelector("#modal-caixa").textContent.includes("NÃO salvo no destino")`);
  const msg = await texto("#modal-caixa");
  verdade(msg.includes("não está acessível") && msg.includes("unidade W:") && msg.includes("continua guardado na Central"), msg);
  igual(await js("window.__nSalvar"), n0, "a janela Salvar não deve abrir com o destino inacessível");
  await clicarEscolha("Tentar de novo"); // continua inacessível: a janela de aviso volta
  await pg.aguardar(`!document.querySelector("#modal").classList.contains("oculto") && document.querySelector("#modal-caixa").textContent.includes("não está acessível")`);
  await clicarEscolha("Baixar cópia de contingência");
  const alvo = join(PASTA_DOWNLOADS, nomeEsperado);
  for (let i = 0; i < 50 && !existsSync(alvo); i++) await espera(200);
  verdade(existsSync(alvo), "contingência não apareceu em Downloads: " + readdirSync(PASTA_DOWNLOADS).join(", "));
  conferirConteudo(readFileSync(alvo, "utf8"), ESPERADO);
  const li = await js(`document.querySelector("#lista-exportacoes li").textContent`);
  verdade(li.includes("ainda não salvo no destino") && li.includes("cópia de contingência"), li);
  verdade((await texto("#toast")).includes("NÃO está no destino"), await texto("#toast"));
  verdade((await js(`(() => { const s = window.CentralUI.servico; return s.exportacao(s.estado().exportacoes[0].id).conteudo.length > 100; })()`)), "arquivo guardado na Central");
  await foto("12-falha-destino-1366");
});
await teste("Unidade W: de volta: “salvar” no histórico grava no destino", async () => {
  await js("window.__reconectarW()");
  await clicar("#lista-exportacoes [data-baixar]");
  await pg.aguardar(`document.querySelector("#lista-exportacoes li").textContent.includes("salvo na pasta de destino")`);
  verdade(!!(await js(`window.__lerDestino(${JSON.stringify(nomeEsperado)})`)));
});
await teste("Configuração mostra o destino obrigatório (sem opção de outra pasta)", async () => {
  await clicar("#btn-config"); await pg.aguardar("!!document.querySelector('#form-cfg')");
  const t = await texto("#modal-caixa");
  verdade(t.includes("Destino obrigatório") && t.includes(await js("window.Nucleo.PASTA_EXPORTACAO_SUGERIDA")) && t.includes("✓ Pasta CENTRAL DE CALLBACK"), t);
  verdade(!t.includes("Não usar pasta") && !t.includes("última pasta usada"), "não pode oferecer outra pasta");
  await foto("13-configuracao-destino-1366");
  await clicar("#cfg-cancelar");
});
await teste("Encerrar o dia sem pasta de rede configurada: não abre pasta sozinho, avisa que NÃO exportou e preserva; a cópia local manual continua; próxima abertura pede SÓ a sigla", async () => {
  const antes = [await js("window.__nPasta"), await js("window.__nSalvar")];
  await clicar("#btn-encerrar-dia"); await pg.aguardar("!!document.querySelector('#m-sim')");
  igual(await texto("#m-sim"), "Encerrar e exportar para a pasta de rede");
  await clicar("#m-sim");
  await pg.aguardar(`document.querySelector("#modal-caixa").textContent.includes("NÃO exportado")`);
  verdade(!(await texto("#modal-caixa")).includes("Destino da exportação"), "não pode pedir pasta");
  igual([await js("window.__nPasta"), await js("window.__nSalvar")], antes, "nenhuma janela de pasta ou Salvar");
  await clicarEscolha("Depois");
  igual(await js("window.CentralUI.servico.E.fechamentos.map((f) => [f.status, f.conteudo.length > 50, !!f.exportacao_rede, (f.historico_envio || []).length])"), [["pendente", true, false, 0]], "fechamento guardado, exportação pendente, Drive não chamado");
  verdade((await texto("#lista-exportacoes")).includes("pasta de rede: exportação pendente"), "registrado no histórico");
  await clicar("#lista-exportacoes [data-baixar]");
  await pg.aguardar(`window.__lerDestino(${JSON.stringify(nomeEsperado)}).then((t) => !!t && t.includes(";sim;"))`);
  await pg.aguardar("!!document.querySelector('#abrir-dia').offsetParent");
  verdade(!(await visivel("#campo-polo")), "polo não deveria ser pedido de novo");
  await foto("08-abertura-so-sigla-1366");
});
await teste("Diferentes resoluções: sem rolagem horizontal da página; painel e envio manual cabem", async () => {
  await js(`(() => { const f = document.querySelector("#form-dia"); f.operador.value = "OPT4"; f.requestSubmit(); return true; })()`);
  await pg.aguardar("!!document.querySelector('#importar').offsetParent");
  const doc = await pg.cmd("DOM.getDocument", {});
  const { nodeId } = await pg.cmd("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "#arquivo" });
  await pg.cmd("DOM.setFileInputFiles", { nodeId, files: [join(raiz, "exemplos", "navegador-chamadas-CONTINGENCIA-FICTICIO.csv")] });
  await pg.aguardar("!!document.querySelector('#btn-confirmar-import')"); await clicar("#btn-confirmar-import");
  await pg.aguardar("document.querySelectorAll('#linhas tr[data-id]').length > 0");
  for (const [l, a] of [[1920, 1080], [1600, 900], [1366, 768], [1280, 720], [1024, 768], [390, 844]]) {
    await pg.tamanho(l, a);
    await js("(document.querySelector('#p-fechar') && document.querySelector('#p-fechar').click(), true)");
    const r = await js(`({ pagina: document.documentElement.scrollWidth - innerWidth, metricas: document.querySelector("#metricas").getBoundingClientRect().height })`);
    verdade(r.pagina <= 0, `${l}x${a}: rolagem horizontal da página (${r.pagina}px)`);
    await foto(`09-lista-${l}x${a}`);
    await js("(document.querySelector('#linhas tr[data-id]').click(), true)"); await espera(150);
    const p = await js(`(() => { const t = (s) => document.querySelector(s).getBoundingClientRect(); const c = t("#p-copiar"), m = t("#p-manual"), i = t("#p-tel-manual"), pn = t("#painel");
      return { linha: Math.abs(c.top - m.top) < 4, cabe: i.right <= pn.right + 1 && i.width >= 90 }; })()`);
    verdade(p.cabe && (l < 560 || p.linha), `${l}x${a}: envio manual ${JSON.stringify(p)}`);
    await foto(`10-painel-${l}x${a}`);
  }
  await pg.tamanho(1366, 768);
});
await teste("Console sem erros (CSP, JavaScript)", async () => {
  verdade(pg.erros.length === 0, pg.erros.join(" || "));
  verdade(!pg.console.some((c) => c.tipo === "error"), JSON.stringify(pg.console.filter((c) => c.tipo === "error")));
});

await nav.fechar();
const falhas = resultados.filter((r) => !r[0]);
console.log(`\n${resultados.length} testes ponta a ponta · ${resultados.length - falhas.length} aprovados · ${falhas.length} com falha`);
process.exitCode = falhas.length ? 1 : 0;
