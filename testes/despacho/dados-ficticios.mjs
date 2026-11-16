/* Cenário 100% FICTÍCIO do Despacho Otimizado 2.0: só chamadas_incidentes.csv, nos DOIS formatos reais auditados.
   - "pasta": como o ADMS grava na pasta (26 colunas, separador ",", BOM, CRLF, datas m/d/aaaa h:mm:ss AM|PM);
   - "navegador": exportação do Navegador de Chamadas (linha sep=;, filtro antes do cabeçalho, 24 colunas, dd/mm/aaaa);
   - "eletrica": navegador + colunas "Alimentador origem" e "Circuito" (para testar os filtros quando o arquivo as tiver).
   Municípios reais (a regionalização da Central é a referência); ruas, bairros, nomes e números INVENTADOS. */
const p2 = (n) => String(n).padStart(2, "0");
export const br = (d) => `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
export const us = (d) => { const h = d.getHours(); return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()} ${h % 12 || 12}:${p2(d.getMinutes())}:${p2(d.getSeconds())} ${h < 12 ? "AM" : "PM"}`; };

/* call: número da CALL; inc: número do INC ("" = sem INC); min: minutos atrás. */
export const CHAMADAS = [
  // POLO ARACAJU — Aracaju
  { call: 1, inc: "900000001", loc: "RUA TESTE UM_10_BAIRRO TESTE A; 1_ARACAJU", min: 50, alim: "AL-T01", circ: "C-11" },
  { call: 2, inc: "900000001", loc: "RUA TESTE UM_12_BAIRRO TESTE A; 1_ARACAJU", min: 40, alim: "AL-T01", circ: "C-11" },
  { call: 3, inc: "900000001", loc: "RUA TESTE DOIS_3_BAIRRO TESTE B; 1_ARACAJU", min: 30, alim: "AL-T01", circ: "C-11" }, // bairro diferente (minoria)
  { call: 4, inc: "900000002", loc: "RUA TESTE UM_40_BAIRRO TESTE A; 1_ARACAJU", min: 45, alim: "AL-T02", circ: "C-21" },
  { call: 5, inc: "900000003", loc: "RUA TESTE TRES_7_BAIRRO TESTE B; 1_ARACAJU", min: 35, com: "OBS: CLIENTE RELATA FALTA DE FASE NA CASA", alim: "AL-T01", circ: "C-12" },
  { call: 6, inc: "900000004", loc: "RUA SEM NOME_SN_AREA RURAL; 1_ARACAJU", min: 25 },                                       // genérico sem localidade
  { call: 7, inc: "900000005", loc: "POV TESTE VERDE_5_AREA RURAL; 1_ARACAJU", min: 24 },                                     // localidade nomeada
  { call: 8, inc: "900000006", loc: "RUA TESTE QUATRO_9_BAIRRO TESTE B; 1_ARACAJU", min: 20, motivo: "Risco de Vida", sub: "RV", com: "OBS: FIO PARTIDO NO CHAO" },
  { call: 9, inc: "900000007", loc: "ESE_Municipio_Pesquisa: ARACAJU", min: 19, com: "ENDERECO: RUA X; BAIRRO: BAIRRO TESTE C, CIDADE: ARACAJU OBS: SEM ENERGIA" },
  { call: 10, inc: "900000008", loc: "ESE_Municipio_Pesquisa: ARACAJU", min: 18 },                                            // sem endereço nenhum
  { call: 11, inc: "900000011", loc: "RUA TESTE CINCO_5_CENTRO; 1_ARACAJU", min: 17, cust: "04 - Cliente VIP" },
  { call: 12, inc: "900000013", loc: "Dispositivo: CHAVE TESTE; End:: RUA TESTE SEIS_8_BAIRRO TESTE A; 1_ARACAJU", min: 16, alim: "AL-T02", circ: "C-21" },
  // POLO ARACAJU — Barra dos Coqueiros e Nossa Senhora do Socorro
  { call: 13, inc: "900000010", loc: "RUA TESTE SETE_10_CENTRO; 10_BARRA DOS COQUEIROS", min: 15 },                          // CENTRO de outro município
  { call: 14, inc: "900000012", loc: "RUA TESTE OITO_2_BAIRRO TESTE D; 20_NOSSA SENHORA DO SOCORRO", min: 14, sub: "FE; FALTA DE FASE" }, // fase no campo estruturado
  // OUTROS POLOS
  { call: 15, inc: "900000020", loc: "RUA TESTE NOVE_1_CENTRO; 180_LAGARTO", min: 13 },
  { call: 16, inc: "900000021", loc: "RUA TESTE DEZ_2_CENTRO; 180_LAGARTO", min: 12, motivo: "Níveis de Tensão", sub: "NT", com: "OBS: OSCILACAO DE ENERGIA" }, // oscilação ≠ fase
  { call: 17, inc: "900000030", loc: "RUA TESTE ONZE_4_BAIRRO TESTE E; 30_ITABAIANA", min: 11 },
  // MUNICÍPIO FORA DE SERGIPE (não pertence a polo nenhum)
  { call: 18, inc: "900000040", loc: "RUA TESTE DOZE_1_BAIRRO TESTE F; 1_JOAO PESSOA", min: 10 },
  // CHAMADA SEM INC e CALL REPETIDA NO ARQUIVO
  { call: 19, inc: "", loc: "RUA TESTE TREZE_1_CENTRO; 1_ARACAJU", min: 9 },
  { call: 2, inc: "900000001", loc: "RUA TESTE UM_12_BAIRRO TESTE A; 1_ARACAJU", min: 40, alim: "AL-T01", circ: "C-11" },   // CALL 2 de novo: contada 1 vez
];

const CAB_PASTA = ["ID", "Incidente", "Prioridade_Chamada", "Motivo", "submotivo", "Comentario", "Emergencia", "Nome_do_Consumidor", "Protocolo", "Contato_Do_Consumidor",
  "Localizacao", "UC", "Tipo_UC", "Prioridade_Consumidor", "Nome", "Roteiro", "Horario_Call", "Horario_agendado", "Recebido_Adms", "RecUser", "Callback", "Medidor_ID",
  "tipo_medidor", "Anexos", "Notas_endereco", "codigo_localidade"];
const CAB_NAV = ["Horário da call", "ID", "UC", "Nome do reclamante", "Protocolo", "Motivo", "Submotivos", "Comentário", "Emergência", "Incidente", "Localização",
  "Horário Agendado", "Recebido ADMS", "Prioridade", "Anexos", "Cust. prioritárias", "Contato do reclamante", "Medidor ID", "Tipo de medidor", "Nota do endereço",
  "Custom ID do SDP", "Idioma", "Callback", "ID do Incidente Pai"];

const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const campoVirgula = (v) => (/[",\r\n]/.test(String(v)) ? q(v) : String(v ?? ""));
function valores(x, agora) {
  const d = new Date(agora - x.min * 60000);
  return { d, call: "CALL " + (8000000 + x.call), inc: x.inc ? "INC " + x.inc : "", motivo: x.motivo || "Falta de Energia", sub: x.sub || "FE",
    com: x.com || "OBS: SEM ENERGIA", nome: "PESSOA FICTICIA " + x.call, tel: "7999" + String(1000000 + x.call), uc: "UC_FICT_" + x.call };
}
export function csvPasta(agora, lista = CHAMADAS) {
  let t = "﻿" + CAB_PASTA.join(",") + "\r\n";
  for (const x of lista) {
    const v = valores(x, agora);
    const o = { ID: v.call, Incidente: v.inc, Prioridade_Chamada: "", Motivo: v.motivo, submotivo: v.sub, Comentario: v.com, Nome_do_Consumidor: v.nome, Protocolo: "1234",
      Contato_Do_Consumidor: v.tel, Localizacao: x.loc, UC: v.uc, Horario_Call: us(v.d), Recebido_Adms: us(v.d), Callback: "Não", Anexos: "Não", Notas_endereco: "" };
    t += CAB_PASTA.map((c) => campoVirgula(o[c] ?? "")).join(",") + "\r\n";
  }
  return t;
}
export function csvNavegador(agora, lista = CHAMADAS, { eletrica = false } = {}) {
  const cab = eletrica ? [...CAB_NAV, "Alimentador origem", "Circuito"] : CAB_NAV;
  const linhas = lista.map((x) => {
    const v = valores(x, agora);
    const o = { "Horário da call": br(v.d), ID: v.call, UC: v.uc, "Nome do reclamante": v.nome, Protocolo: "1234", Motivo: v.motivo, Submotivos: v.sub, "Comentário": v.com,
      Incidente: v.inc, "Localização": x.loc, "Recebido ADMS": br(v.d), Prioridade: "2", Anexos: "Não", "Cust. prioritárias": x.cust || "00 - Não é VIP",
      "Contato do reclamante": "Celular: " + v.tel, Idioma: "Portuguese (Brazil)", Callback: "Não", "Alimentador origem": x.alim || "", Circuito: x.circ || "" };
    return cab.map((c) => q(o[c] ?? "")).join(";") + ";";
  });
  return "﻿sep=;\r\n" + q("Filtrar: [ fictício ]") + ";\r\n\r\n" + cab.map(q).join(";") + ";\r\n" + linhas.join("\r\n") + "\r\n";
}

/* Resultado ESPERADO (conferido à mão a partir de CHAMADAS). */
export const ESPERADO = {
  linhas: 20, validas: 19, repetidas: 1, semInc: 1, incs: 16,
  bairro: { "900000001": "BAIRRO TESTE A", "900000002": "BAIRRO TESTE A", "900000003": "BAIRRO TESTE B", "900000004": null, "900000005": "POV TESTE VERDE",
    "900000006": "BAIRRO TESTE B", "900000007": "BAIRRO TESTE C", "900000008": null, "900000010": "CENTRO", "900000011": "CENTRO", "900000012": "BAIRRO TESTE D",
    "900000013": "BAIRRO TESTE A", "900000020": "CENTRO", "900000021": "CENTRO", "900000030": "BAIRRO TESTE E" },
  poloAracaju: ["900000001", "900000002", "900000003", "900000004", "900000005", "900000006", "900000007", "900000008", "900000010", "900000011", "900000012", "900000013"],
};
