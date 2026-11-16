/* DESPACHO OTIMIZADO COI 2.0 — configuração editável (só o que é regra deste módulo).
   Leitura do CSV, validação das chamadas, consolidação por INC, município, polo, risco e indício de falta de fase vêm da
   Central (js/nucleo.js e js/localidades.js): nada disso é repetido aqui. */
"use strict";
(function (raiz) {
  raiz.DespachoConfig = {
    versao: "2.0.0",
    arquivo: "chamadas_incidentes.csv",   // o MESMO arquivo lido pela Central (js/pasta-adms.js)
    verificarACadaSeg: 60,                // confere data/tamanho do arquivo (só relê se mudou), com a página visível

    /* Bairro "genérico" no endereço do ADMS: não identifica um bairro. Se o logradouro for um povoado/assentamento/etc.
       (prefixos abaixo), o lote usa esse nome; senão, a INC vai para LOCALIZAÇÃO NÃO IDENTIFICADA do município. */
    bairrosGenericos: ["AREA RURAL", "ZONA RURAL", "AREA URBANA", "ZONA URBANA", "POVOADO", "CONJUNTO", "ASSENTAMENTO",
      "SEM BAIRRO", "NAO INFORMADO", "NAO CONSTA", "OUTROS"],
    localidadesRurais: ["POV", "POVOADO", "ASSENT", "ASSENTAMENTO", "DIST", "DISTRITO", "FAZ", "FAZENDA", "SIT", "SITIO",
      "PROJETO", "PA", "COLONIA", "VILA", "LOT", "LOTEAMENTO", "CJ", "CONJ", "CONJUNTO", "RES", "RESIDENCIAL", "CONDOMINIO"],

    /* Colunas elétricas: usadas SÓ se existirem no cabeçalho (o chamadas_incidentes.csv auditado não as traz). */
    colunas: {
      alimentador: ["Alimentador origem", "Alimentador atual", "Alimentador", "Alimentador_Origem", "Alimentador_Atual"],
      circuito: ["Circuito"],
      subestacao: ["Subestação", "Subestacao"],
      equipamento: ["Dispositivo", "Equipamento"],
    },

    /* "Cust. prioritárias" do ADMS: código antes do " - " (00 = não é VIP). */
    clientesPrioritarios: { "01": "Indústria", "04": "VIP", "11": "Essencial" },

    /* prefixo: só para EXIBIR "INC n" na tela. Cópia para o SIGODE: numos in (n1, n2, ...). */
    copia: { prefixo: "INC ", abertura: "numos in (", separador: ", ", fechamento: ")" },
  };
})(typeof window !== "undefined" ? window : globalThis);
