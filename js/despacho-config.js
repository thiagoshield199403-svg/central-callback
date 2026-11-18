/* DESPACHO OTIMIZADO COI 2.0 — configuração editável (só o que é regra deste módulo).
   Leitura do CSV, validação das chamadas, consolidação por INC, município, polo, risco e indício de falta de fase vêm da
   Central (js/nucleo.js e js/localidades.js): nada disso é repetido aqui. */
"use strict";
(function (raiz) {
  raiz.DespachoConfig = {
    versao: "2.1.0",
    arquivo: "chamadas_incidentes.csv",   // o MESMO arquivo lido pela Central (js/pasta-adms.js)
    verificarACadaSeg: 60,                // confere data/tamanho dos arquivos (só relê o que mudou), com a página visível

    /* ---------------- 2.1: segunda fonte — Incidentes.xlsx (na MESMA pasta ADMS). Só o Despacho lê; a Central não. */
    incidentes: {
      arquivo: "incidentes.xlsx",         // comparado sem diferenciar maiúsculas (no ADMS: "Incidentes.xlsx")
      aba: "incidentes",
      cabecalhoLinha: 3,                  // linha esperada do cabeçalho (procurado nas 10 primeiras se mudar, com aviso)
      /* Campo -> nomes aceitos (comparados sem acento/maiúsculas/"_"). obrigatoria: sem ela o arquivo é recusado. */
      colunas: {
        inc: { nomes: ["num ocorrencia"], obrigatoria: true },
        status: { nomes: ["status incident", "status incidente"], obrigatoria: true },
        equipe: { nomes: ["Equipe"], obrigatoria: true },
        local: { nomes: ["local"], obrigatoria: true },
        atribuicao: { nomes: ["data hora atribuicao"], obrigatoria: true },
        enviada: { nomes: ["data hora enviada"], obrigatoria: true },
        deslocamento: { nomes: ["data hora deslocamento"], obrigatoria: true },
        subregiao: { nomes: ["Subregiao"] },
        alimentador_atual: { nomes: ["alimentador atual"] }, alimentador_normal: { nomes: ["alimentador normal"] },
        subestacao_atual: { nomes: ["subestacao atual"] }, subestacao_normal: { nomes: ["subestacao normal"] },
        data_inicial: { nomes: ["data inicial"] }, ultima_alteracao: { nomes: ["data hora ultima alteracao"] },
        usuario_alteracao: { nomes: ["Usuario alteracao"] }, power_status: { nomes: ["Power Status"] },
        clientes_interrompidos: { nomes: ["qtd cliente interrompidos"] }, comunicacoes: { nomes: ["qtd comunicacoes"] },
        elemento: { nomes: ["elemento"] }, tipo_elemento: { nomes: ["tipo elemento"] }, incidente_pai: { nomes: ["incidente pai"] },
        causa: { nomes: ["causa"] }, sub_causa: { nomes: ["Sub Causa"] }, problema: { nomes: ["Problema"] }, obs: { nomes: ["obs ocorrencia"] },
      },
      /* REGRA CENTRAL DE STATUS (js/despacho-incidentes.js, classificarStatus): única fonte da decisão.
         operacional = entra em lotes, seleção, contadores e cópia; excluido = sai no processamento (não só da tela);
         status vazio ou fora desta tabela = EXCEÇÃO (lista à parte, fora dos lotes). */
      status: {
        "AGUARDANDO ENVIO": { grupo: "operacional", rotulo: "Aguardando Envio", ordem: 1 },
        "AGUARDANDO REENVIO": { grupo: "operacional", rotulo: "Aguardando Reenvio", ordem: 2 },
        "ENVIADO": { grupo: "operacional", rotulo: "Enviado", ordem: 3 },
        "EM EXECUCAO": { grupo: "operacional", rotulo: "Em Execução", ordem: 4 },
        "INTERROMPIDO": { grupo: "operacional", rotulo: "Interrompido", ordem: 5, destaque: true },
        "CONCLUIDO": { grupo: "excluido", rotulo: "Concluído" },
        "ARQUIVADO": { grupo: "excluido", rotulo: "Arquivado" },
        "CANCELADO": { grupo: "excluido", rotulo: "Cancelado" },
      },
    },
    /* Atualidade (o robô do ADMS regrava cada arquivo a cada ~5-7 min, em momentos diferentes). */
    atualidade: { desatualizadaMin: 15, distanciaFontesMin: 15 },

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

    /* prefixo: só para EXIBIR "INC n" na tela. "Copiar selecionadas": numos in (n1, n2, ...). "Copiar lote" e o botão de
       cada INC: só os números, "n1, n2, ..." (mesmo separador). */
    copia: { prefixo: "INC ", abertura: "numos in (", separador: ", ", fechamento: ")" },
  };
})(typeof window !== "undefined" ? window : globalThis);
