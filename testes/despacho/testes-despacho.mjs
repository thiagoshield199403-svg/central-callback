/* Testes UNITÁRIOS do Despacho Otimizado 2.0 (Node, sem navegador). Carregam os MESMOS scripts da página (Central + módulo).
   Dados 100% fictícios (dados-ficticios.mjs) nos formatos reais do chamadas_incidentes.csv.
   Uso: node testes\despacho\testes-despacho.mjs [caminho-de-um-chamadas_incidentes.csv-real]
   Com um arquivo real, confere SÓ consistência (contagens), sem imprimir dados de clientes. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { CHAMADAS, ESPERADO, csvPasta, csvNavegador } from "./dados-ficticios.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ctx = { TextDecoder, TextEncoder, console }; ctx.globalThis = ctx; ctx.window = ctx; vm.createContext(ctx);
for (const f of ["localidades-dados.js", "localidades.js", "modelos.js", "nucleo.js", "despacho-config.js", "despacho-motor.js"])
  vm.runInContext(readFileSync(join(raiz, "js", f), "utf8"), ctx, { filename: f });
const { DespachoMotor: M, Nucleo: N, Localidades: L } = ctx;

const resultados = [];
function teste(nome, f) { try { f(); resultados.push(true); console.log("OK    " + nome); } catch (e) { resultados.push(false); console.log("FALHA " + nome + " — " + e.message); } }
const verdade = (c, m) => { if (!c) throw new Error(m || "condição falsa"); };
const igual = (a, b, m) => { const ja = JSON.stringify(a), jb = JSON.stringify(b); if (ja !== jb) throw new Error(`${m || "esperado"}: ${jb}, obtido: ${ja}`); };
const bytes = (t) => new TextEncoder().encode(t);
const AGORA = new Date(2026, 10, 15, 10, 0, 0).getTime();
const PASTA = M.processar(bytes(csvPasta(AGORA))), NAV = M.processar(bytes(csvNavegador(AGORA))), ELE = M.processar(bytes(csvNavegador(AGORA, CHAMADAS, { eletrica: true })));
const inc = (r, n) => r.incs.find((i) => i.id === "INC " + n);
const numeros = (incs) => incs.map((i) => i.id.slice(4)).sort();
const todosDosLotes = (m) => m.secoes.flatMap((s) => s.lotes.flatMap((l) => l.incs.map((i) => i.id)));

/* 1. Leitura do mesmo arquivo da Central */
teste("1. Formato da PASTA ADMS (26 colunas, ',', AM/PM): mesmas contagens do leitor da Central (Nucleo.analisar)", () => {
  const a = N.analisar(bytes(csvPasta(AGORA)));
  igual([PASTA.resumo.linhas_lidas, PASTA.resumo.chamadas_validas, PASTA.resumo.calls_repetidas], [a.resumo.linhas_lidas, a.resumo.chamadas_validas, a.resumo.calls_repetidas_no_arquivo]);
  igual([PASTA.resumo.linhas_lidas, PASTA.resumo.chamadas_validas, PASTA.resumo.calls_repetidas, PASTA.resumo.chamadas_sem_inc, PASTA.resumo.incs],
    [ESPERADO.linhas, ESPERADO.validas, ESPERADO.repetidas, ESPERADO.semInc, ESPERADO.incs]);
  verdade(inc(PASTA, "900000001").primeira === "2026-11-15T09:10:00", "data AM/PM lida pela regra da Central: " + inc(PASTA, "900000001").primeira);
});
teste("1b. Formato do NAVEGADOR DE CHAMADAS (sep=;, filtro antes do cabeçalho): mesmo resultado do formato da pasta", () => {
  const resumir = (r) => r.incs.map((i) => [i.id, i.chamadas, i.municipio.chave, i.bairro && i.bairro.chave, i.fase.nivel, i.risco.nivel]).sort();
  igual(resumir(NAV), resumir(PASTA));
  igual([NAV.resumo.incs, NAV.resumo.chamadas_validas], [ESPERADO.incs, ESPERADO.validas]);
});
teste("1c. Arquivo inválido é recusado com a mensagem da Central (nada é inventado)", () => {
  let erro = ""; try { M.processar(bytes("A;B\r\n1;2\r\n")); } catch (e) { erro = e.message; }
  verdade(/Cabeçalho não reconhecido/.test(erro), erro);
});

/* 3/4. Polos e municípios (regionalização da Central) */
teste("3. Polos = as 7 regionais oficiais da Central (mesma ordem e mesmos municípios)", () => {
  igual(M.POLOS.map((p) => p.id), L.REGIONAIS.map((r) => r.id));
  igual(M.POLOS.find((p) => p.id === "aracaju").municipios, ["Aracaju", "Barra dos Coqueiros", "Nossa Senhora do Socorro"]);
  igual(M.POLOS.find((p) => p.id === "aracaju").nome, "Polo Aracaju");
});
teste("4. Polo Aracaju reconhece Aracaju, Barra dos Coqueiros e N. Sra. do Socorro — e só eles", () => {
  const m = M.montar(PASTA.incs, { polo: "aracaju" });
  igual(m.secoes.map((s) => s.nome), ["ARACAJU", "BARRA DOS COQUEIROS", "NOSSA SENHORA DO SOCORRO"]);
  igual(numeros(m.secoes.flatMap((s) => s.lotes.flatMap((l) => l.incs))), ESPERADO.poloAracaju);
  igual(M.contarPolos(PASTA.incs).map((p) => [p.id, p.n]), [["aracaju", 12], ["sao_cristovao", 0], ["itabaiana", 1], ["lagarto", 2], ["gloria", 0], ["propria", 0], ["maruim", 0]]);
});

/* 5/6. Bairros e lotes */
teste("5. Bairro identificado automaticamente em cada INC (endereço do ADMS; campo BAIRRO do comentário como reserva)", () => {
  for (const [n, b] of Object.entries(ESPERADO.bairro)) igual(inc(PASTA, n).bairro ? inc(PASTA, n).bairro.nome : null, b, "INC " + n);
  igual(inc(PASTA, "900000005").bairro.tipo, "localidade");
  verdade(/comentário/.test(inc(PASTA, "900000007").bairro.origem), inc(PASTA, "900000007").bairro.origem);
  igual(inc(PASTA, "900000001").bairrosDiferentes, ["BAIRRO TESTE A (2)", "BAIRRO TESTE B (1)"], "chamadas em bairros diferentes ficam registradas");
});
teste("6. Lotes por município e bairro: nunca mistura municípios; cada INC em UM lote; soma = INCs exibidas", () => {
  for (const f of [{}, { polo: "aracaju" }, { polo: "lagarto" }]) {
    const m = M.montar(PASTA.incs, f), ids = todosDosLotes(m);
    igual(ids.length, new Set(ids).size, "INC repetida em lotes");
    igual(ids.length, m.indicadores.incs, "soma dos lotes");
    for (const s of m.secoes) for (const l of s.lotes) igual(new Set(l.incs.map((i) => (i.municipio.status === "ok" ? i.municipio.chave : "?"))).size, 1, "lote com 2 municípios: " + l.chave);
  }
  const m = M.montar(PASTA.incs, { polo: "aracaju" }), aju = m.secoes.find((s) => s.nome === "ARACAJU");
  igual(aju.lotes.map((l) => [l.bairro, numeros(l.incs)]), [
    ["BAIRRO TESTE A", ["900000001", "900000002", "900000013"]], ["BAIRRO TESTE B", ["900000003", "900000006"]], ["BAIRRO TESTE C", ["900000007"]],
    ["CENTRO", ["900000011"]], ["POV TESTE VERDE", ["900000005"]], ["LOCALIZAÇÃO NÃO IDENTIFICADA", ["900000004", "900000008"]]]);
  igual(m.secoes.find((s) => s.nome === "BARRA DOS COQUEIROS").lotes.map((l) => [l.bairro, numeros(l.incs)]), [["CENTRO", ["900000010"]]], "CENTRO da Barra separado do CENTRO de Aracaju");
  igual([m.indicadores.incs, m.indicadores.lotes, m.indicadores.naoIdentificados], [12, 7, 2]);
  igual(aju.lotes[0].incs.map((i) => i.logradouro), ["RUA TESTE SEIS", "RUA TESTE UM", "RUA TESTE UM"], "dentro do lote, ordenado por logradouro (ruas iguais juntas)");
});

/* 7. Filtros */
teste("7. Sem coluna elétrica no arquivo: alimentador/circuito = não disponível (nada inventado)", () => {
  igual(PASTA.colunas, { alimentador: null, circuito: null, subestacao: null, equipamento: null });
  verdade(PASTA.incs.every((i) => !i.alimentadores.length && !i.circuitos.length), "valores inventados");
  igual(inc(PASTA, "900000013").equipamentos, ["CHAVE TESTE"], "equipamento só do 'Dispositivo:' da Localização");
});
teste("7b. Com a coluna no arquivo: filtros Polo + Alimentador + Circuito funcionam em conjunto", () => {
  igual([ELE.colunas.alimentador, ELE.colunas.circuito], ["Alimentador origem", "Circuito"]);
  igual(numeros(M.montar(ELE.incs, { polo: "aracaju", alimentador: "AL-T01" }).secoes.flatMap((s) => s.lotes.flatMap((l) => l.incs))), ["900000001", "900000003"]);
  igual(numeros(M.montar(ELE.incs, { polo: "aracaju", alimentador: "AL-T01", circuito: "C-12" }).secoes.flatMap((s) => s.lotes.flatMap((l) => l.incs))), ["900000003"]);
  igual(numeros(M.montar(ELE.incs, { polo: "lagarto", alimentador: "AL-T01" }).secoes.flatMap((s) => s.lotes.flatMap((l) => l.incs))), [], "alimentador de outro polo");
  const op = M.opcoes(ELE.incs, { polo: "aracaju", alimentador: "AL-T01" });
  igual(op.circuito.map((o) => [o.valor, o.n]), [["C-11", 1], ["C-12", 1]], "opções do circuito respeitam o alimentador escolhido");
  igual(M.montar(ELE.incs, { polo: "aracaju" }).secoes[0].lotes[0].alimentadores, ["AL-T02", "AL-T01"], "alimentadores do lote");
});
teste("7c. Filtros por município, bairro, busca e indicação", () => {
  igual(numeros(M.montar(PASTA.incs, { polo: "aracaju", municipio: "010" }).secoes.flatMap((s) => s.lotes.flatMap((l) => l.incs))), ["900000010"]);
  igual(numeros(M.montar(PASTA.incs, { polo: "aracaju", municipio: "001", bairro: "BAIRRO TESTE B" }).secoes.flatMap((s) => s.lotes.flatMap((l) => l.incs))), ["900000003", "900000006"]);
  igual(numeros(M.montar(PASTA.incs, { busca: "900000012" }).secoes.flatMap((s) => s.lotes.flatMap((l) => l.incs))), ["900000012"]);
  igual(numeros(M.montar(PASTA.incs, { prioridade: "fase" }).secoes.flatMap((s) => s.lotes.flatMap((l) => l.incs))), ["900000003", "900000012"]);
  igual(numeros(M.montar(PASTA.incs, { prioridade: "risco" }).secoes.flatMap((s) => s.lotes.flatMap((l) => l.incs))), ["900000006"]);
});

/* 8. Consolidação */
teste("8. INCs repetidas consolidadas: 19 chamadas válidas = 16 INCs + 2 chamadas repetidas do mesmo INC + 1 sem INC", () => {
  igual([inc(PASTA, "900000001").chamadas, PASTA.resumo.consolidadas, PASTA.resumo.chamadas_em_incs], [3, 2, 18]);
  igual(PASTA.resumo.incs + PASTA.resumo.consolidadas + PASTA.resumo.chamadas_sem_inc, PASTA.resumo.chamadas_validas);
  igual(PASTA.semInc.map((c) => c.call_id), ["CALL 8000019"], "chamada sem INC fica fora dos lotes, listada à parte");
  igual(new Set(PASTA.incs.map((i) => i.id)).size, PASTA.incs.length);
});

/* 9. Não identificados */
teste("9. Localização não identificada: genérico sem localidade, só município, fora de SE — nenhuma INC descartada", () => {
  verdade(/AREA RURAL/.test(inc(PASTA, "900000004").bairroMotivo), inc(PASTA, "900000004").bairroMotivo);
  verdade(/sem endereço/.test(inc(PASTA, "900000008").bairroMotivo), inc(PASTA, "900000008").bairroMotivo);
  igual(inc(PASTA, "900000004").localizacoes, ["RUA SEM NOME_SN_AREA RURAL; 1_ARACAJU"], "texto original mantido");
  const t = M.montar(PASTA.incs, {}), esp = t.secoes[t.secoes.length - 1];
  igual([esp.especial, numeros(esp.lotes[0].incs), esp.lotes[0].bairro], [true, ["900000040"], "LOCALIZAÇÃO NÃO IDENTIFICADA"]);
  igual(t.indicadores.incs, ESPERADO.incs, "todas as INCs aparecem em Todos os polos");
});
teste("9b. Endereço: formatos do ADMS (completo, com complemento, rótulos, código, incompleto)", () => {
  const e = (x) => { const r = M.endereco(x); return [r.formato, r.logradouro, r.numero, r.complemento, r.bairroBruto, r.equipamento]; };
  igual(e("RUA A_10_CENTRO; 430_NOSSA SENHORA DA GLORIA"), ["completo", "RUA A", "10", "", "CENTRO", ""]);
  igual(e("RUA A_20_LT 3_JATOBA; 10_BARRA DOS COQUEIROS"), ["completo", "RUA A", "20", "LT 3", "JATOBA", ""]);
  igual(e("Dispositivo: CH 1; End:: RUA B_5_X; 1_ARACAJU"), ["completo", "RUA B", "5", "", "X", "CH 1"]);
  igual(e("ESE_Municipio_Pesquisa: CARIRA"), ["ausente", "", "", "", "", ""]);
  igual(e("RUA C_CENTRO; 1_ARACAJU"), ["incompleto", "RUA C", "CENTRO", "", "", ""]);
  igual(e(""), ["ausente", "", "", "", "", ""]);
  igual(M.bairroDaChamada({ localizacao: "FAZ FAZENDA_1_AREA RURAL; 1_ARACAJU" }, "ARACAJU").bairro, null, "'FAZ FAZENDA' não é localidade nomeada");
  igual(M.bairroDaChamada({ localizacao: "RUA X_1_ARACAJU; 1_ARACAJU" }, "ARACAJU").bairro, null, "nome da cidade no lugar do bairro");
  igual(M.bairroDaChamada({ localizacao: "RUA X_1_S/N; 1_ARACAJU" }, "ARACAJU").bairro, null);
});

/* 6 (fase). Falta de fase e prioridades */
teste("6b. Falta de fase: confirmada (campo estruturado), possível (só texto), sem informação; oscilação NÃO é fase", () => {
  igual(inc(PASTA, "900000012").fase.nivel, "confirmada");
  igual(inc(PASTA, "900000003").fase.nivel, "possivel");
  igual(inc(PASTA, "900000021").fase.nivel, "sem", "oscilação");
  igual(inc(PASTA, "900000002").fase.nivel, "sem", "falta de energia comum");
  const m = M.montar(PASTA.incs, { polo: "aracaju" });
  igual([m.indicadores.faseConfirmada, m.indicadores.fasePossivel], [1, 1]);
  igual(m.secoes.map((s) => [s.nome, s.nFase]), [["ARACAJU", 1], ["BARRA DOS COQUEIROS", 0], ["NOSSA SENHORA DO SOCORRO", 1]], "por município");
  igual([inc(PASTA, "900000006").risco.nivel, inc(PASTA, "900000002").risco.nivel], [2, 0], "risco de vida pela regra da Central (sigla RV)");
  igual(inc(NAV, "900000011").clientes, ["VIP"], "cliente prioritário do campo Cust. prioritárias");
});

/* 10. Cópia */
teste("10. Cópia: 'numos in (n1, n2)', sem 'INC', sem quebra de linha, sem duplicidade, na ordem", () => {
  igual(M.textoCopia(["INC 900000001", "INC 900000002", "INC 900000001", "900000003"]), "numos in (900000001, 900000002, 900000003)");
  const l = M.montar(PASTA.incs, { polo: "aracaju" }).secoes[0].lotes[0];
  igual(M.textoCopia(l.incs.map((i) => i.id)), "numos in (900000013, 900000001, 900000002)", "lote");
  igual(M.textoCopia(["INC 900000006"]), "numos in (900000006)", "um só incidente");
  igual(M.textoCopia(["INC 900000006", "INC 900000006"]), "numos in (900000006)", "repetido");
  const t = M.textoCopia(PASTA.incs.map((i) => i.id));
  verdade(!/INC|\n|\r/.test(t) && /^numos in \(\d+(, \d+)*\)$/.test(t), "nenhum texto além da expressão: " + t);
  igual(PASTA.incs[0].id.startsWith("INC "), true, "a tela continua exibindo 'INC n'");
  igual(M.textoCopia([]), "", "nenhuma INC: nada a copiar (validação da tela)");
});
teste("10c. Copiar lote: só os números 'n1, n2, n3' (sem 'numos in', parênteses ou 'INC'), na ordem do lote; INC individual", () => {
  const l = M.montar(PASTA.incs, { polo: "aracaju" }).secoes[0].lotes[0];
  igual(M.textoNumeros(l.incs.map((i) => i.id)), "900000013, 900000001, 900000002", "lote, mesma ordem");
  igual(M.textoNumeros(["INC 900000006"]), "900000006", "um só incidente");
  igual(M.textoNumeros(["INC 900000006", "INC 900000006", "900000007"]), "900000006, 900000007", "sem repetição");
  const t = M.textoNumeros(PASTA.incs.map((i) => i.id));
  verdade(/^\d+(, \d+)*$/.test(t) && !/numos|\(|\)|INC|\n|\r/.test(t), "nenhum texto além dos números: " + t);
  igual(M.textoNumeros([]), "", "nenhuma INC: nada a copiar");
  igual(M.numeroInc("INC 144061719"), "144061719", "número de uma INC (botão ao lado do número)");
  igual(M.textoCopia(["INC 900000001", "INC 900000002"]), "numos in (900000001, 900000002)", "Copiar selecionadas mantém o formato");
});
teste("Nenhum campo de despacho/equipe é produzido (o arquivo não informa)", () => {
  const chaves = new Set(PASTA.incs.flatMap((i) => Object.keys(i)));
  for (const k of ["equipe", "equipes", "status", "situacao", "despachado"]) verdade(!chaves.has(k), "campo indevido: " + k);
});

/* Arquivo REAL (opcional): só consistência, sem imprimir dados de clientes. */
const real = process.argv[2];
if (real) {
  const b = new Uint8Array(readFileSync(real)), r = M.processar(b), a = N.analisar(b), R = r.resumo;
  teste(`REAL: ${R.chamadas_validas} chamadas válidas = ${R.incs} INCs + ${R.consolidadas} repetidas consolidadas + ${R.chamadas_sem_inc} sem INC`, () => {
    igual(R.chamadas_validas, a.resumo.chamadas_validas, "mesmo total da Central");
    igual(R.incs + R.consolidadas + R.chamadas_sem_inc, R.chamadas_validas);
    igual(R.incs, new Set(a.validas.filter((v) => v.incidente).map((v) => v.incidente)).size, "INCs distintos");
  });
  teste("REAL: soma dos lotes = INCs; cada INC em um lote; nenhum lote mistura municípios", () => {
    const m = M.montar(r.incs, {}), ids = todosDosLotes(m);
    igual([ids.length, new Set(ids).size], [R.incs, R.incs]);
    for (const p of M.POLOS) { const mp = M.montar(r.incs, { polo: p.id }); igual(todosDosLotes(mp).length, mp.indicadores.incs, p.nome); }
    for (const s of m.secoes) for (const l of s.lotes) igual(new Set(l.incs.map((i) => (i.municipio.status === "ok" ? i.municipio.chave : "?"))).size, 1, l.chave);
  });
  const t = M.montar(r.incs, {}).indicadores;
  console.log(`      real: colunas elétricas = ${JSON.stringify(r.colunas)}; polos = ${M.contarPolos(r.incs).map((p) => `${p.nome} ${p.n}`).join(", ")}`);
  console.log(`      real: lotes ${t.lotes} (+${t.lotesNaoIdent} não identificados), sem bairro ${t.naoIdentificados}, fase ${t.faseConfirmada} confirmada/${t.fasePossivel} possível, risco ${t.risco}`);
}

const ok = resultados.filter(Boolean).length;
console.log(`\n${resultados.length} testes · ${ok} aprovados · ${resultados.length - ok} com falha`);
process.exitCode = ok === resultados.length ? 0 : 1;
