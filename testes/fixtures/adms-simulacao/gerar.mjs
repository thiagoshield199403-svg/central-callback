/* BASE ADMS DE SIMULAÇÃO — Despacho Otimizado 2.1. 100% FICTÍCIA.
   Gera, nesta pasta, os DOIS arquivos que o Despacho lê da pasta ADMS, nos formatos que o sistema aceita hoje:
     - chamadas_incidentes.csv: formato gravado pelo ADMS na pasta (26 colunas, ",", BOM, CRLF, datas m/d/aaaa h:mm:ss AM/PM)
       — o MESMO gerador dos testes (testes/despacho/dados-ficticios.mjs: csvPasta);
     - Incidentes.xlsx: aba "incidentes", linhas 1-2 vazias, cabeçalho na linha 3 com as 48 colunas do arquivo real auditado,
       várias linhas por INC, datas como DATA do Excel — o MESMO montador dos testes (incidentes-ficticio.mjs: xlsxIncidentes);
     - esperado.json: o resultado ESPERADO, calculado AQUI a partir do plano dos dados (independente do código do Despacho).
   Municípios e regionais: os de Sergipe (o mapa da Central é a referência). Ruas, bairros, povoados, equipes, alimentadores,
   subestações, nomes, telefones, UCs, INCs e CALLs: INVENTADOS ("SIM"/"FICTICIA" no nome; INCs na faixa 9502xxxxx).
   Determinístico (semente fixa): só os horários mudam, relativos ao momento da geração (para a base parecer "do turno").
   Uso: node testes\fixtures\adms-simulacao\gerar.mjs            (regrava os 3 arquivos com o horário atual)
        import { gerar } from ".../gerar.mjs"; gerar({ agora, rodada: 2 })   (rodada 2 = "exportação seguinte", com mudanças) */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { csvPasta } from "../../despacho/dados-ficticios.mjs";
import { xlsxIncidentes } from "../../despacho/incidentes-ficticio.mjs";

export const PASTA = dirname(fileURLToPath(import.meta.url));
export const ARQUIVOS = { csv: join(PASTA, "chamadas_incidentes.csv"), xlsx: join(PASTA, "Incidentes.xlsx"), esperado: join(PASTA, "esperado.json") };

/* ------------------------------------------------------------ cadastro fictício */
const MUNICIPIOS = [
  { cod: 1, nome: "ARACAJU", polo: "aracaju", peso: 30, se: "SE SIM AJU-NORTE", alims: ["AJN-01F1", "AJN-01F2", "AJN-02F3", "AJS-03F1", "AJS-03F4"],
    bairros: ["BAIRRO SIM ALFA", "BAIRRO SIM BETA", "BAIRRO SIM GAMA", "JARDIM SIM DELTA", "CENTRO"] },
  { cod: 10, nome: "BARRA DOS COQUEIROS", polo: "aracaju", peso: 6, se: "SE SIM BARRA", alims: ["BCQ-01F1", "BCQ-01F2"], bairros: ["CENTRO", "BAIRRO SIM ATLANTICO"] },
  { cod: 20, nome: "NOSSA SENHORA DO SOCORRO", polo: "aracaju", peso: 10, se: "SE SIM SOCORRO", alims: ["NSS-01F1", "NSS-02F2"], bairros: ["BAIRRO SIM AURORA", "BAIRRO SIM PALMEIRA", "CENTRO"] },
  { cod: 620, nome: "SAO CRISTOVAO", polo: "sao_cristovao", peso: 6, se: "SE SIM SAO CRISTOVAO", alims: ["SCR-01F1", "SCR-01F3"], bairros: ["CENTRO", "BAIRRO SIM HISTORICO"] },
  { cod: 30, nome: "ITABAIANA", polo: "itabaiana", peso: 9, se: "SE SIM ITABAIANA", alims: ["ITB-01F2", "ITB-02F1"], bairros: ["CENTRO", "BAIRRO SIM SERRANO"], povoados: ["POV SIM CAJUEIRO"] },
  { cod: 110, nome: "MOITA BONITA", polo: "itabaiana", peso: 3, se: "SE SIM ITABAIANA", alims: ["ITB-03F1"], bairros: ["CENTRO"] },
  { cod: 180, nome: "LAGARTO", polo: "lagarto", peso: 8, se: "SE SIM LAGARTO", alims: ["LAG-01F1", "LAG-01F4", "LAG-02F2"], bairros: ["CENTRO", "BAIRRO SIM LARANJAL"], povoados: ["POV SIM COLONIA NOVA"] },
  { cod: 210, nome: "SIMAO DIAS", polo: "lagarto", peso: 3, se: "SE SIM SIMAO DIAS", alims: ["SMD-01F1"], bairros: ["CENTRO"] },
  { cod: 430, nome: "NOSSA SENHORA DA GLORIA", polo: "gloria", peso: 5, se: "SE SIM GLORIA", alims: ["GLO-01F1", "GLO-01F2"], bairros: ["CENTRO", "BAIRRO SIM SERTAO"] },
  { cod: 461, nome: "PORTO DA FOLHA", polo: "gloria", peso: 3, se: "SE SIM GLORIA", alims: ["GLO-02F1"], bairros: ["CENTRO"], povoados: ["POV SIM ILHA DO RIO"] },
  { cod: 468, nome: "PROPRIA", polo: "propria", peso: 5, se: "SE SIM PROPRIA", alims: ["PRP-01F1", "PRP-01F2"], bairros: ["CENTRO", "BAIRRO SIM RIBEIRINHO"] },
  { cod: 570, nome: "NEOPOLIS", polo: "propria", peso: 2, se: "SE SIM PROPRIA", alims: ["PRP-02F1"], bairros: ["CENTRO"] },
  { cod: 220, nome: "MARUIM", polo: "maruim", peso: 3, se: "SE SIM MARUIM", alims: ["MRM-01F1"], bairros: ["CENTRO"] },
  { cod: 270, nome: "LARANJEIRAS", polo: "maruim", peso: 3, se: "SE SIM MARUIM", alims: ["MRM-02F1"], bairros: ["CENTRO"], povoados: ["POV SIM ENGENHO VELHO"] },
];
const SIGLA = { aracaju: "AJU", sao_cristovao: "SCR", itabaiana: "ITB", lagarto: "LAG", gloria: "GLO", propria: "PRP", maruim: "MRM" };
const N_EQUIPES = { aracaju: 5, sao_cristovao: 2, itabaiana: 3, lagarto: 3, gloria: 2, propria: 2, maruim: 2 };
const EQUIPES = Object.fromEntries(Object.entries(N_EQUIPES).map(([p, n]) => [p, Array.from({ length: n }, (_, k) => `ESE-S-${SIGLA[p]}SIM${String(k + 1).padStart(2, "0")}`)]));
const RUAS = ["RUA SIMULADA UM", "RUA SIMULADA DOIS", "AV SIMULADA CENTRAL", "TV SIMULADA DO PORTO", "RUA FICTICIA DAS FLORES", "RUA FICTICIA DO SOL",
  "AV FICTICIA BEIRA RIO", "RUA SIMULADA DA IGREJA", "RUA SIMULADA PROJETADA 3", "TV FICTICIA DA FEIRA"];
const ELEMENTOS = [
  { tipo: "Consumidor", peso: 45, cli: [1, 1], calls: [1, 2], problemas: ["Falta de energia individual", "Ramal de ligação partido", "Disjuntor do padrão desarmado"] },
  { tipo: "Transformador", peso: 30, cli: [6, 95], calls: [2, 4], problemas: ["Transformador queimado", "Chave fusível do transformador aberta", "Conexão do transformador danificada"] },
  { tipo: "Chave Fusível", peso: 15, cli: [40, 420], calls: [3, 5], problemas: ["Chave fusível aberta", "Árvore sobre a rede", "Cabo partido na rede de média tensão"] },
  { tipo: "Religador", peso: 10, cli: [500, 3200], calls: [4, 6], problemas: ["Desligamento do religador", "Poste abalroado", "Descarga atmosférica na rede"] },
];
const SUBCAUSAS = { "Árvore sobre a rede": "Vegetação", "Poste abalroado": "Abalroamento", "Descarga atmosférica na rede": "Descarga atmosférica" };
/* status -> quantidade de INCs (no Incidentes.xlsx). "" e os dois desconhecidos = exceções; os 2 divergentes são à parte. */
const BOLSA = [["Aguardando Envio", 30], ["Aguardando Reenvio", 9], ["Enviado", 22], ["Em Execução", 22], ["Interrompido", 5],
  ["Concluído", 14], ["Arquivado", 7], ["Cancelado", 6], ["", 2], ["Pendente Validação", 1], ["Em Análise", 1]];
const OPERACIONAIS = { "Aguardando Envio": "aguardando_envio", "Aguardando Reenvio": "aguardando_reenvio", Enviado: "enviado", "Em Execução": "em_execucao", Interrompido: "interrompido" };
const EXCLUIDOS = ["Concluído", "Arquivado", "Cancelado"];
const OBS = { "Aguardando Envio": "", "Aguardando Reenvio": "EQUIPE INFORMOU QUE ESTA FORA DA AREA\nREENVIAR PARA OUTRA EQUIPE", Enviado: "EQUIPE ACIONADA PELO COI",
  "Em Execução": "Usuario: SIGOD: EQUIPE NO LOCAL", Interrompido: "SERVICO INTERROMPIDO\nAGUARDANDO MANOBRA NA SUBESTACAO", "Concluído": "SERVICO CONCLUIDO - ENERGIA RESTABELECIDA",
  Arquivado: "ARQUIVADO: OCORRENCIA DUPLICADA", Cancelado: "CANCELADO: CLIENTE INFORMOU RETORNO DA ENERGIA" };

/* ------------------------------------------------------------ sorteio determinístico */
function aleatorio(semente) {
  let a = semente >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/* ------------------------------------------------------------ plano das ocorrências */
function planejar() {
  const r = aleatorio(20261117);
  const entre = (a, b) => a + Math.floor(r() * (b - a + 1));
  const um = (xs) => xs[Math.floor(r() * xs.length)];
  const pesado = (xs) => { let s = r() * xs.reduce((t, x) => t + x.peso, 0); for (const x of xs) if ((s -= x.peso) < 0) return x; return xs[xs.length - 1]; };
  const status = BOLSA.flatMap(([s, n]) => Array(n).fill(s));
  for (let i = status.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [status[i], status[j]] = [status[j], status[i]]; }
  status.push("Em Execução", "Enviado"); // as 2 INCs de status DIVERGENTE (2ª linha com outro status) ficam no fim

  let numero = 950210000;
  const casos = status.map((st, i) => {
    numero += entre(3, 140);
    const mun = pesado(MUNICIPIOS), el = pesado(ELEMENTOS);
    const povoado = mun.povoados && r() < 0.35 ? um(mun.povoados) : null;
    const bairro = povoado || um(mun.bairros);
    const di = entre(6, 1800); // início da interrupção: de 6 min a 30 h atrás (ontem e hoje)
    const passo = (de, a, b) => Math.max(1, de - entre(a, b));
    const atrib = passo(di, 2, 40), env = passo(atrib, 1, 15), desl = passo(env, 2, 30), fim = passo(desl, 10, 120);
    const c = { i, inc: String(numero), status: st, mun, el, bairro, povoado: !!povoado, rua: um(RUAS), num: entre(1, 1999),
      alim: um(mun.alims), se: mun.se, clientes: entre(...el.cli), problema: um(el.problemas), di, horarios: {}, equipes: [], linhas: 1,
      nCalls: entre(...el.calls), motivo: "Falta de Energia", sub: "FE", com: um(["OBS: SEM ENERGIA", "OBS: SEM ENERGIA NA RUA TODA", "OBS: CLIENTE SEM ENERGIA DESDE CEDO"]),
      usuario: "SIM.OPERADOR" + String(entre(1, 6)).padStart(2, "0"), xlsx: true, chamadas: true };
    const equipe = () => um(EQUIPES[mun.polo]);
    if (st === "Aguardando Envio" || st === "" || st === "Pendente Validação" || st === "Em Análise") {
      // ainda sem equipe
    } else if (st === "Aguardando Reenvio") { c.horarios = { atrib, env }; if (r() < 0.5) c.equipes = [equipe()]; }
    else if (st === "Enviado") { c.horarios = { atrib, env }; c.equipes = [equipe()]; }
    else { c.horarios = { atrib, env, desl, ...(EXCLUIDOS.includes(st) ? { fim } : {}) }; c.equipes = st === "Cancelado" && r() < 0.5 ? [] : [equipe()]; }
    if (c.equipes.length && el.tipo !== "Consumidor" && el.tipo !== "Transformador" && r() < 0.4) c.equipes = [...new Set([...c.equipes, equipe()])];
    if (el.tipo !== "Consumidor" && r() < 0.45) c.linhas = entre(2, 4);
    return c;
  });

  /* ---- situações obrigatórias (sobre casos escolhidos por regra fixa, sempre os mesmos) */
  const achar = (f, pular = 0) => casos.filter((c) => !c.marcado && f(c))[pular];
  const marcar = (c, nota) => { c.marcado = nota; return c; };
  const n = casos.length;
  casos[n - 2].divergente = "Enviado"; casos[n - 1].divergente = "Aguardando Reenvio";
  casos[n - 2].equipes = [EQUIPES[casos[n - 2].mun.polo][0]]; casos[n - 1].equipes = [EQUIPES[casos[n - 1].mun.polo][1]];
  marcar(casos[n - 2], "status divergente"); marcar(casos[n - 1], "status divergente");
  // só no Incidentes.xlsx (sem chamada): 8 INCs de vários status; uma delas sem município (campo local vazio)
  for (const k of [5, 19, 33, 47, 61, 75, 89, 103]) { casos[k].chamadas = false; marcar(casos[k], "só no Incidentes.xlsx"); }
  casos[33].semLocal = true; casos[33].marcado = "só no Incidentes.xlsx, sem município";
  const env = (k) => achar((c) => c.status === "Enviado" && c.chamadas, k), exe = (k) => achar((c) => c.status === "Em Execução" && c.chamadas, k);
  for (const proximo of [() => env(0), () => env(0), () => exe(0)]) { const c = proximo(); c.equipes = []; marcar(c, "sem equipe com status que exige equipe"); } // um de cada vez: o marcado sai da busca
  { const c = env(0); c.horarios.env = c.horarios.atrib + 5; marcar(c, "envio anterior à atribuição"); }
  { const c = exe(0); c.equipes = EQUIPES[c.mun.polo].slice(0, 2); c.linhas = 2; c.equipePorLinha = true; marcar(c, "uma equipe em cada linha do XLSX"); }
  { const c = achar((c) => c.status === "Aguardando Envio" && c.mun.cod === 1 && c.chamadas); c.localXlsx = "NOSSA SENHORA DO SOCORRO"; marcar(c, "município diferente nas duas fontes"); }
  { const c = achar((c) => c.status === "Aguardando Envio" && c.mun.cod === 1 && c.chamadas && !c.povoado); c.locSoMunicipio = true; c.com = `ENDERECO: ${c.rua}; BAIRRO: ${c.bairro}, CIDADE: ARACAJU OBS: SEM ENERGIA`; marcar(c, "sem endereço; bairro só no comentário"); }
  { const c = achar((c) => c.status === "Aguardando Envio" && c.chamadas && !c.povoado); c.locSoMunicipio = true; c.bairro = null; marcar(c, "sem endereço nenhum"); }
  { const c = achar((c) => c.status === "Enviado" && c.chamadas && !c.povoado); c.areaRural = true; c.bairro = null; marcar(c, "AREA RURAL sem localidade"); }
  { const c = achar((c) => OPERACIONAIS[c.status] && c.chamadas && !c.povoado && c.mun.bairros.length > 1); c.nCalls = 3; c.bairroMinoria = c.mun.bairros.find((b) => b !== c.bairro); marcar(c, "uma chamada em outro bairro (minoria)"); }
  for (let k = 0; k < 3; k++) { const c = achar((c) => OPERACIONAIS[c.status] && c.chamadas && c.alim); c.alim = ""; marcar(c, "sem alimentador"); }
  for (let k = 0; k < 2; k++) { const c = achar((c) => OPERACIONAIS[c.status] && c.chamadas); c.se = ""; marcar(c, "sem subestação"); }
  for (let k = 0; k < 2; k++) { const c = achar((c) => OPERACIONAIS[c.status] && c.chamadas); Object.assign(c, { motivo: "Risco de Vida", sub: "RV", com: "OBS: FIO PARTIDO NO CHAO PERTO DA ESCOLA" }); marcar(c, "risco de vida"); }
  for (let k = 0; k < 2; k++) { const c = achar((c) => OPERACIONAIS[c.status] && c.chamadas); c.sub = "FE; FALTA DE FASE"; marcar(c, "falta de fase confirmada"); }
  for (let k = 0; k < 2; k++) { const c = achar((c) => OPERACIONAIS[c.status] && c.chamadas); c.com = "OBS: CLIENTE RELATA FALTA DE FASE, SO METADE DA CASA FUNCIONA"; marcar(c, "falta de fase possível"); }
  { const c = achar((c) => OPERACIONAIS[c.status] && c.chamadas); Object.assign(c, { motivo: "Níveis de Tensão", sub: "NT", com: "OBS: OSCILACAO DE ENERGIA" }); marcar(c, "oscilação (não é fase)"); }
  { const c = achar((c) => OPERACIONAIS[c.status] && c.chamadas && c.alim && c.linhas === 1 && c.mun.alims.length > 1); c.linhas = 2; c.alim2 = c.mun.alims.find((a) => a !== c.alim);
    marcar(c, "alimentador atual diferente entre as linhas do XLSX"); } // carga transferida: as DUAS linhas são reais, nenhuma é escolhida

  // só nas chamadas (sem registro no Incidentes.xlsx): 6 INCs -> exceção
  const soChamadas = Array.from({ length: 6 }, (_, k) => {
    numero += entre(3, 140);
    const mun = MUNICIPIOS[(k * 5) % MUNICIPIOS.length];
    return { inc: String(numero), status: null, mun, el: ELEMENTOS[0], bairro: mun.bairros[0], rua: RUAS[k], num: 10 + k, di: entre(3, 25), nCalls: 1 + (k % 2),
      motivo: "Falta de Energia", sub: "FE", com: "OBS: SEM ENERGIA", xlsx: false, chamadas: true, equipes: [], horarios: {}, linhas: 0, marcado: "só nas chamadas" };
  });
  return { casos, soChamadas, entre, um };
}

/* ------------------------------------------------------------ rodada 2: a "próxima exportação" do ADMS */
function aplicarRodada2(casos, soChamadas) {
  const mudancas = [];
  const op = (st) => casos.find((c) => c.status === st && c.chamadas && !c.marcado && !c.mudou);
  { const c = op("Enviado"); c.status = "Concluído"; c.horarios.desl = Math.max(1, c.horarios.env - 5); c.horarios.fim = 1; c.mudou = true; mudancas.push({ inc: c.inc, de: "Enviado", para: "Concluído" }); }
  { const c = op("Em Execução"); c.status = "Cancelado"; c.mudou = true; mudancas.push({ inc: c.inc, de: "Em Execução", para: "Cancelado" }); }
  { const c = op("Aguardando Envio"); c.status = "Enviado"; c.equipes = [EQUIPES[c.mun.polo][0]]; c.horarios = { atrib: 3, env: 2 }; c.mudou = true; mudancas.push({ inc: c.inc, de: "Aguardando Envio", para: "Enviado" }); }
  const lag = MUNICIPIOS.find((m) => m.cod === 180);
  const novo = { i: casos.length, inc: "950299001", status: "Aguardando Envio", mun: lag, el: ELEMENTOS[1], bairro: "BAIRRO SIM LARANJAL", rua: "RUA SIMULADA NOVA", num: 77,
    alim: "LAG-01F1", se: lag.se, clientes: 12, problema: "Transformador queimado", di: 4, horarios: {}, equipes: [], linhas: 1, nCalls: 2, motivo: "Falta de Energia", sub: "FE",
    com: "OBS: SEM ENERGIA", usuario: "SIM.OPERADOR01", xlsx: true, chamadas: true, mudou: true };
  casos.push(novo); mudancas.push({ inc: novo.inc, de: null, para: "Aguardando Envio" });
  return mudancas;
}

/* ------------------------------------------------------------ arquivos */
export function gerar({ agora = Date.now(), rodada = 1 } = {}) {
  const { casos, soChamadas } = planejar();
  const mudancas = rodada >= 2 ? aplicarRodada2(casos, soChamadas) : [];
  const data = (min) => (min == null ? null : new Date(agora - min * 60000));

  /* chamadas_incidentes.csv */
  let call = 0;
  const chamadas = [];
  const locDe = (c, bairro) => {
    const cidade = `${c.mun.cod}_${c.mun.nome}`;
    if (c.locSoMunicipio) return `ESE_Municipio_Pesquisa: ${c.mun.nome}`;
    if (c.areaRural) return `RUA SEM NOME_SN_AREA RURAL; ${cidade}`;
    if (c.povoado) return `${bairro}_${c.num}_AREA RURAL; ${cidade}`;
    return `${c.rua}_${c.num}_${bairro}; ${cidade}`;
  };
  for (const c of [...casos, ...soChamadas]) {
    if (!c.chamadas) continue;
    for (let k = 0; k < c.nCalls; k++) {
      const bairro = c.bairroMinoria && k === c.nCalls - 1 ? c.bairroMinoria : c.bairro;
      let loc = locDe(c, bairro);
      if (k === 1 && c.el.tipo !== "Consumidor" && !c.locSoMunicipio && !c.areaRural) loc = `Dispositivo: CHAVE SIM ${c.inc.slice(-4)}; End:: ${loc}`; // 2ª chamada pelo equipamento
      chamadas.push({ call: ++call, inc: c.inc, loc, min: Math.max(1, c.di - 1 - k * 3), motivo: c.motivo, sub: c.sub, com: c.com });
    }
  }
  // chamadas sem INC (ainda não associadas) e CALL repetida no arquivo (o ADMS grava a mesma CALL duas vezes às vezes)
  for (let k = 0; k < 4; k++) { const m = MUNICIPIOS[k * 3]; chamadas.push({ call: ++call, inc: "", loc: `${RUAS[k + 2]}_${100 + k}_${m.bairros[0]}; ${m.cod}_${m.nome}`, min: 2 + k, motivo: "Falta de Energia", sub: "FE", com: "OBS: SEM ENERGIA" }); }
  chamadas.push({ ...chamadas[3] }, { ...chamadas[10] });
  if (rodada >= 2) { const c = casos.find((x) => OPERACIONAIS[x.status] && x.chamadas && !x.marcado && !x.mudou); chamadas.push({ call: ++call, inc: c.inc, loc: locDe(c, c.bairro), min: 1, motivo: "Falta de Energia", sub: "FE", com: "OBS: CLIENTE LIGOU DE NOVO" }); c.callExtra = true; }
  const csv = csvPasta(agora, chamadas);

  /* Incidentes.xlsx */
  const linhas = [];
  for (const c of casos) {
    if (!c.xlsx) continue;
    const h = c.horarios, eqStr = (eqs) => eqs.map((e) => "Equipe: " + e).join(" | ");
    const base = {
      "cod defeito falha": c.el.tipo === "Consumidor" ? "FE01" : "FE0" + (2 + ELEMENTOS.indexOf(c.el)), "num ocorrencia": "INC " + c.inc,
      UC: "UC_SIM_" + c.inc.slice(-5), Endereco: "xxxx", "Power Status": "Interrompido", Equipe: eqStr(c.equipes), Subregiao: "Sergipe - Simulação",
      elemento: `ESE_${c.el.tipo === "Consumidor" ? "UC" : c.el.tipo.toUpperCase().replace(/[^A-Z]/g, "")}_SIM_${c.inc.slice(-4)}`,
      local: c.semLocal ? "" : c.localXlsx || c.mun.nome, "status incident": c.status,
      "subestacao normal": c.se || "", "subestacao atual": c.se || "", "alimentador normal": c.alim || "", "alimentador atual": c.alim || "",
      "qtd cliente interrompidos": EXCLUIDOS.includes(c.status) ? 0 : c.clientes, "qtd clientes atingidos": c.clientes, "qtd clientes criticos": c.clientes > 300 ? 2 : 0,
      "qtd cliente restaurados": EXCLUIDOS.includes(c.status) ? c.clientes : 0, "qtd clientes nao restaurados": EXCLUIDOS.includes(c.status) ? 0 : c.clientes,
      "Usuario alteracao": c.usuario, "data hora ultima alteracao": data(Math.min(c.di, ...Object.values(h))), "qtd comunicacoes": c.chamadas ? c.nCalls : 0,
      "data inicial": data(c.di), "inicio interrupcao": data(c.di), "dh conhecimento": data(c.di), "data final": data(h.fim),
      "obs ocorrencia": OBS[c.status] ?? "", "Sub Causa": SUBCAUSAS[c.problema] || "Falha de equipamento", "tipo elemento": c.el.tipo, causa: "FE", Problema: c.problema,
      "data hora atribuicao": data(h.atrib), "data hora enviada": data(h.env), "data hora deslocamento": data(h.desl),
      "incidente programado": "Não", "incidente interrompido": c.status === "Interrompido" ? "Sim" : "Não", "acionado manutencao": "Não",
    };
    for (let k = 0; k < c.linhas; k++) {
      const l = { ...base, UC: base.UC + "-" + (k + 1), Problema: k ? `${c.problema} (UC ${k + 1})` : c.problema };
      if (c.equipePorLinha) l.Equipe = eqStr([c.equipes[k]]);
      if (c.alim2 && k === 1) l["alimentador atual"] = c.alim2;
      linhas.push(l);
    }
    if (c.divergente) linhas.push({ ...base, "status incident": c.divergente });
  }
  linhas.push({ ...linhas[0], "num ocorrencia": "INC SIM-ERRO", UC: "UC_SIM_INVALIDA" }); // número de INC inválido -> linha descartada
  const xlsx = xlsxIncidentes(agora, { linhas, datas: "excel", textos: "compartilhados", compressao: "deflate" });

  return { csv, xlsx, esperado: esperado(casos, soChamadas, chamadas, linhas, mudancas, agora, rodada) };
}

/* ------------------------------------------------------------ resultado esperado (calculado do PLANO, não do Despacho) */
function esperado(casos, soChamadas, chamadas, linhas, mudancas, agora, rodada) {
  const doXlsx = casos.filter((c) => c.xlsx), situacao = (c) => (c.divergente ? "divergente" : OPERACIONAIS[c.status] ? "operacional" : EXCLUIDOS.includes(c.status) ? "excluido" : "excecao");
  const ops = doXlsx.filter((c) => situacao(c) === "operacional");
  const porStatus = {}; for (const c of ops) porStatus[OPERACIONAIS[c.status]] = (porStatus[OPERACIONAIS[c.status]] || 0) + 1;
  const statusXlsx = {}; for (const c of doXlsx) { const k = c.divergente ? `${c.status} / ${c.divergente} (divergente)` : c.status || "(vazio)"; statusXlsx[k] = (statusXlsx[k] || 0) + 1; }
  const excluidas = Object.fromEntries(EXCLUIDOS.map((s) => [s, doXlsx.filter((c) => c.status === s && !c.divergente).map((c) => c.inc)]));
  const excecoes = {
    status_vazio: doXlsx.filter((c) => c.status === "" && !c.divergente).map((c) => c.inc),
    status_desconhecido: doXlsx.filter((c) => situacao(c) === "excecao" && c.status !== "").map((c) => c.inc),
    status_divergente: doXlsx.filter((c) => c.divergente).map((c) => c.inc),
    sem_registro_adms: soChamadas.map((c) => c.inc),
  };
  const callsUnicas = new Set(chamadas.map((c) => c.call));
  const todasEquipes = [...new Set(doXlsx.flatMap((c) => c.equipes))].sort();
  /* bairro/localidade esperado de cada INC operacional: o da maioria das chamadas; sem endereço = só pelo "BAIRRO:" do comentário */
  const grupo = (c) => {
    if (!c.chamadas) return { municipio: c.semLocal ? null : c.mun.cod, bairro: null };
    if (c.areaRural) return { municipio: c.mun.cod, bairro: null };
    if (c.locSoMunicipio) return { municipio: c.mun.cod, bairro: c.bairro };
    return { municipio: c.mun.cod, bairro: c.bairro, localidade: !!c.povoado };
  };
  return {
    gerado_em: new Date(agora).toISOString(), rodada, mudancas,
    csv: { linhas: chamadas.length, chamadas_validas: callsUnicas.size, call_repetidas: chamadas.length - callsUnicas.size, sem_inc: chamadas.filter((c) => !c.inc).length,
      incs_distintas: new Set(chamadas.filter((c) => c.inc).map((c) => c.inc)).size },
    xlsx: { linhas: linhas.length, incs_distintas: doXlsx.length, linhas_descartadas: 1,
      incs_com_varias_linhas: doXlsx.filter((c) => c.linhas + (c.divergente ? 1 : 0) > 1).map((c) => c.inc), status: statusXlsx },
    incs_distintas_total: new Set([...doXlsx.map((c) => c.inc), ...soChamadas.map((c) => c.inc)]).size,
    cruzamento: { ambas: doXlsx.filter((c) => c.chamadas).length, so_chamadas: soChamadas.length, so_incidentes: doXlsx.filter((c) => !c.chamadas).length },
    operacionais: ops.map((c) => c.inc).sort(), por_status: porStatus, status_por_inc: Object.fromEntries(ops.map((c) => [c.inc, OPERACIONAIS[c.status]])), excluidas, excecoes,
    equipes: { distintas_no_arquivo: todasEquipes.length, lista: todasEquipes, por_inc: Object.fromEntries(ops.map((c) => [c.inc, [...c.equipes].sort()])),
      operacionais_sem_equipe: ops.filter((c) => !c.equipes.length).map((c) => c.inc).sort(),
      distintas_operacionais: new Set(ops.flatMap((c) => c.equipes)).size },
    grupos: Object.fromEntries(ops.map((c) => [c.inc, grupo(c)])),
    alimentadores: Object.fromEntries(ops.map((c) => [c.inc, [c.alim, c.alim2].filter(Boolean)])), // o da INC (todas as linhas do XLSX); vazio = sem dado
    polo: Object.fromEntries(ops.map((c) => [c.inc, c.semLocal && !c.chamadas ? null : c.mun.polo])),
    situacoes_especiais: Object.fromEntries([...casos, ...soChamadas].filter((c) => c.marcado).map((c) => [c.inc, c.marcado])),
    call_extra: casos.filter((c) => c.callExtra).map((c) => c.inc),
  };
}

export function gravar(opcoes = {}) {
  const g = gerar(opcoes);
  writeFileSync(ARQUIVOS.csv, g.csv, "utf8");
  writeFileSync(ARQUIVOS.xlsx, g.xlsx);
  writeFileSync(ARQUIVOS.esperado, JSON.stringify(g.esperado, null, 2) + "\n", "utf8");
  return g;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { esperado: e } = gravar();
  console.log(`chamadas_incidentes.csv: ${e.csv.linhas} linhas · ${e.csv.chamadas_validas} chamadas · ${e.csv.incs_distintas} INCs`);
  console.log(`Incidentes.xlsx: ${e.xlsx.linhas} linhas · ${e.xlsx.incs_distintas} INCs (${e.xlsx.incs_com_varias_linhas.length} com várias linhas)`);
  console.log(`INCs distintas (duas fontes): ${e.incs_distintas_total} · operacionais ${e.operacionais.length} · equipes ${e.equipes.distintas_no_arquivo}`);
  console.log("Gravados em " + PASTA);
}
