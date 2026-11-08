/* Regras da Central de Callback (porte de backend/app/callback/servico.py e exportacao.py), sobre o armazenamento local.
   - cada chamada tem UM estado no lote: callback_realizado | contato_invalido | sem_telefone | pendente; tentativas à parte;
   - a CALL repetida no arquivo conta uma vez; repetida em outro lote do MESMO dia também (pseudônimo HMAC com chave do dia,
     apagada ao encerrar o dia), valendo o MELHOR estado alcançado;
   - encerrar o lote é atômico: congela as métricas, acumula no dia e só então apaga os dados pessoais;
   - callback só com registro explícito do operador, ou mensagem efetivamente enviada pela Central de Disparos (js/disparos.js);
     abrir o WhatsApp não é tentativa nem callback;
   - a exportação diária é versionada (sem dados pessoais) e nunca sobrescreve uma anterior;
   1.1.0 (recuperado da referência CENTRAL_CALLBACK v1.1.0 + pedido do COI):
   - "Ocorrência resolvida com sucesso" = regra "cliente confirmou normalização" da referência: só depois do callback
     realizado, uma vez por CALL; não encerra nada no ADMS. "Serviço executado" (novo): mesma regra, registro independente;
   - callback realizado, serviço executado e ocorrência resolvida são TRÊS registros distintos; "Reabrir" apaga os dois últimos;
   - no dia, cada CALL conta uma vez: serviço/resolução valem se registrados em qualquer lote (OU), como na referência;
   - envio manual: o operador digita o telefone achado no ADMS; só celular válido abre o WhatsApp; o número NÃO é gravado;
     abrir o WhatsApp (automático ou manual) não é tentativa nem callback. */
"use strict";
(function (raiz) {
  const N = raiz.Nucleo;
  const ESTADOS = ["pendente", "callback_realizado", "contato_invalido", "sem_telefone"];
  const PRECEDENCIA = { pendente: 0, sem_telefone: 1, contato_invalido: 2, callback_realizado: 3 };
  const MEIOS = ["whatsapp", "ligacao", "outro"];
  const ACOES = ["callback_realizado", "sem_sucesso", "contato_invalido", "reabrir"];
  const CONFIG_PADRAO = { estacao: "", operador: "", polo: "", url_sharepoint: "" };

  class ErroCallback extends Error { constructor(msg, status = 409) { super(msg); this.status = status; } }
  const agoraIso = () => new Date().toISOString();
  const clonar = (x) => JSON.parse(JSON.stringify(x));
  const contar = (lista, f) => lista.reduce((o, x) => { const k = f(x); o[k] = (o[k] || 0) + 1; return o; }, {});
  const limpar = (t, n) => String(t || "").split(/\s+/).filter(Boolean).join(" ").slice(0, n);
  const RESULTADOS = { servico_executado: { campo: "servico_executado_em", rotulo: "Serviço executado" },
    resolvida: { campo: "resolvida_em", rotulo: "Ocorrência resolvida com sucesso" } };
  const comCallback = (c) => c.estado === "callback_realizado";
  /* Callback registrado bloqueia o envio individual. Exceção: callback vindo da Central de Disparos não impede enviar a OUTRO número do contato. */
  const bloqueiaIndividual = (c, numero) => comCallback(c) && !(c.callback_telefone && c.callback_telefone !== numero);
  const semSucesso = (c) => c.tentativas.filter((t) => t.resultado === "sem_sucesso").length;
  /* Junta uma CALL do lote à marca do dia (mesma regra no encerramento e no tempo real): melhor estado, tentativas somadas,
     serviço/resolução em OU (só contam se o estado final do dia for callback realizado). */
  function acumular(marcas, c, inc) {
    const m = marcas[c.marca], serv = comCallback(c) && !!c.servico_executado_em, res = comCallback(c) && !!c.resolvida_em;
    if (!m) { marcas[c.marca] = { estado: c.estado, motivo: c.motivo, subtipo: c.subtipo, tentativas: c.tentativas.length, lotes: 1,
      sem_sucesso: semSucesso(c), servico: serv, resolvida: res, inc: inc || null }; return; }
    if (PRECEDENCIA[c.estado] > PRECEDENCIA[m.estado]) m.estado = c.estado; // melhor resultado alcançado no dia
    m.tentativas += c.tentativas.length; m.lotes += 1; m.subtipo = m.subtipo || c.subtipo;
    m.sem_sucesso = (m.sem_sucesso || 0) + semSucesso(c); m.servico = !!m.servico || serv; m.resolvida = !!m.resolvida || res;
    m.inc = m.inc || inc || null;
  }

  function estadoVazio() {
    return { config: { ...CONFIG_PADRAO, instalacao_id: N.novoId() }, sessao: null, lotes: [], chamadas: [], marcas: {},
      exportacoes: [], dias_encerrados: [], proximo_id: 1, disparos: [], historico_atendimento: [], callbacks_manuais: [], fechamentos: [], auditoria_manual: [] };
  }

  class Servico {
    constructor(armazenamento, aoMudar) { this.arm = armazenamento; this.E = null; this.aoMudar = aoMudar || (() => {}); this._cadeia = Promise.resolve(); }

    /* Central de Disparos: a fila grava enquanto o operador usa a tela. Leituras e gravações passam por UMA cadeia, para que
       uma gravação nunca parta de uma cópia antiga e apague o resultado da anterior (ex.: o status "enviado" de uma mensagem). */
    _emOrdem(f) { const r = this._cadeia.then(f); this._cadeia = r.catch(() => {}); return r; }
    carregar() { return this._emOrdem(() => this._carregarAgora()); }
    async _carregarAgora() {
      const lido = await this.arm.ler();
      this.E = lido || estadoVazio();
      for (const k of ["disparos", "historico_atendimento", "callbacks_manuais", "fechamentos", "auditoria_manual"]) this.E[k] = this.E[k] || []; // estados gravados por versões anteriores
      if (!lido) await this._salvar(this.E);
      return this;
    }

    /* Toda alteração: copia, aplica, grava de uma vez. Falhou: nada muda (nem em memória). */
    _alterar(f) { return this._emOrdem(() => this._alterarAgora(f)); }
    async _alterarAgora(f) {
      const novo = clonar(this.E);
      const r = f(novo);
      try { this.E = await this.arm.gravar(novo); }
      catch (e) { if (e instanceof raiz.Armazenamento.ErroConcorrencia) await this._carregarAgora(); throw e; }
      this.aoMudar();
      return r;
    }
    async _salvar(e) { this.E = await this.arm.gravar(e); }

    /* ------------------------------------------------ configuração */
    configuracao() { return { ...CONFIG_PADRAO, ...this.E.config }; }
    salvarConfiguracao(d) {
      return this._alterar((E) => { for (const k of Object.keys(CONFIG_PADRAO)) if (d[k] != null) E.config[k] = limpar(d[k], 300); return E.config; });
    }

    /* ------------------------------------------------ dia */
    sessao() { return this.E.sessao && this.E.sessao.situacao === "aberta" ? this.E.sessao : null; }
    /* 1.1.0 (regra da referência): o turno pede só a identificação do operador (sigla, ex.: TSA4). O polo vem da
       Configuração (Polo padrão, definido uma vez); só é pedido na abertura se ainda não estiver configurado. */
    abrirSessao(polo, operador) {
      return this._alterar((E) => {
        if (E.sessao && E.sessao.situacao === "aberta") throw new ErroCallback("Já existe um dia aberto. Encerre-o (e exporte) antes de abrir outro.");
        operador = limpar(operador, 40);
        if (!operador) throw new ErroCallback("Informe a sua sigla de operador (ex.: TSA4).", 422);
        polo = limpar(polo, 80) || limpar(E.config.polo, 80);
        if (!polo) throw new ErroCallback("Informe o polo da operação (fica salvo na Configuração).", 422);
        if (!E.config.polo) E.config.polo = polo;
        if (!E.config.operador) E.config.operador = operador; // sigla lembrada como padrão da estação (só se ainda não houver)
        E.sessao = { id: N.novoId(), data_operacional: N.hojeLocal(), polo, operador,
          estacao: E.config.estacao || null, chave_marca: N.aleatorioHex(32), aberta_em: agoraIso(), situacao: "aberta" };
        E.lotes = []; E.marcas = {}; E.chamadas = [];
        return E.sessao;
      });
    }
    marca(sessao, callId) { return N.hmacSha256Hex(sessao.chave_marca, callId.toUpperCase()); }
    aviso() {
      const s = this.sessao();
      if (s && s.data_operacional < N.hojeLocal()) {
        const [a, m, d] = s.data_operacional.split("-");
        return `O dia aberto é de ${d}/${m}/${a}. Se o turno já terminou, encerre e exporte antes de começar o novo dia.`;
      }
      return null;
    }

    /* ------------------------------------------------ lote */
    loteAberto() { const s = this.sessao(); return s ? this.E.lotes.find((l) => l.situacao === "aberto") || null : null; }
    previa(bytes) {
      const r = N.analisar(bytes), s = this.sessao();
      let repetidas = 0, ja = false;
      if (s) {
        repetidas = r.validas.filter((v) => this.marca(s, v.call_id) in this.E.marcas).length;
        ja = this.E.lotes.some((l) => l.arquivo_sha256 === r.resumo.sha256);
      }
      return { resumo: { ...r.resumo, calls_ja_vistas_hoje: repetidas, arquivo_ja_importado_hoje: ja }, erros: r.erros,
        amostra: r.validas.slice(0, 20).map((v) => ({ linha: v.linha_arquivo, call_id: v.call_id, incidente: v.incidente,
          motivo: v.motivo, subtipo: v.subtipo, estado: v.estado })) };
    }
    importar(nome, bytes, shaPrevia) {
      const r = N.analisar(bytes); // fora da transação: análise pura
      return this._alterar((E) => {
        const s = E.sessao && E.sessao.situacao === "aberta" ? E.sessao : null;
        if (!s) throw new ErroCallback("Abra o dia (polo e operador) antes de importar.");
        if (E.lotes.some((l) => l.situacao === "aberto")) throw new ErroCallback("Já há um lote aberto. Encerre e limpe o lote atual antes de importar outro CSV.");
        if (shaPrevia && shaPrevia !== r.resumo.sha256) throw new ErroCallback("O arquivo mudou depois da prévia. Gere a prévia novamente.");
        if (!r.validas.length) throw new ErroCallback("Nenhuma chamada válida no arquivo.", 422);
        const numero = E.lotes.reduce((m, l) => Math.max(m, l.numero), 0) + 1;
        const lote = { id: N.novoId(), numero, arquivo_nome: String(nome || "arquivo.csv").slice(0, 255), arquivo_sha256: r.resumo.sha256,
          resumo_importacao: { ...r.resumo, erros: r.erros.map((e) => ({ linha: e.linha, codigo: e.codigo, mensagem: e.mensagem })) },
          situacao: "aberto", importado_em: agoraIso(), encerrado_em: null, metricas: null };
        E.lotes.push(lote);
        for (const v of r.validas) {
          const m = this.marca(s, v.call_id), anterior = E.marcas[m] ? E.marcas[m].estado : null;
          const ch = { ...v, id: E.proximo_id++, lote_id: lote.id, marca: m, ja_vista_no_dia: anterior != null,
            estado_anterior_no_dia: anterior, meio_callback: null, tentativas: [], whatsapp_aberto_em: null, whatsapp_manual: false,
            servico_executado_em: null, resolvida_em: null, observacao: null, atualizado_em: null };
          if (anterior === "callback_realizado") { ch.estado = "callback_realizado"; ch.observacao = "Callback já realizado em lote anterior do dia."; }
          E.chamadas.push(ch);
        }
        // 1.0.2: agrupamento por incidente feito na importação; registrado em cada comunicação (para conferência/auditoria).
        // Nenhuma comunicação é removida; métricas e callbacks continuam por CALL.
        for (const g of N.agruparIncidentes(E.chamadas.filter((c) => c.lote_id === lote.id)))
          g.membros.forEach((c, i) => Object.assign(c, { grupo_chave: g.chave, grupo_principal: i === 0, grupo_qtd: g.qtd,
            grupo_posicao: i + 1, risco_nivel: N.indicacaoRisco(c).nivel }));
        return lote;
      });
    }
    chamadas() { const l = this.loteAberto(); return l ? this.E.chamadas.filter((c) => c.lote_id === l.id) : []; }
    /* 1.0.2: linhas da tabela = incidentes (comunicações do mesmo incidente juntas). Recalculado das comunicações do lote,
       pela mesma regra da importação: funciona também para lotes importados antes da 1.0.2. */
    grupos() { return N.agruparIncidentes(this.chamadas()); }
    grupoDaChamada(id) { const c = this.obterChamada(id); return this.grupos().find((g) => g.chave === N.chaveIncidente(c)); }
    obterChamada(id) {
      const l = this.loteAberto(), c = this.E.chamadas.find((x) => x.id === id);
      if (!c || !l || c.lote_id !== l.id) throw new ErroCallback("Chamada não encontrada no lote aberto.", 404);
      return c;
    }
    registrar(id, acao, meio, observacao) {
      this.obterChamada(id);
      return this._alterar((E) => {
        const ch = E.chamadas.find((x) => x.id === id);
        if (!ACOES.includes(acao)) throw new ErroCallback("Ação desconhecida.", 422);
        if (acao !== "reabrir" && !MEIOS.includes(meio)) throw new ErroCallback("Informe o meio (whatsapp, ligacao ou outro).", 422);
        observacao = String(observacao || "").trim().slice(0, 500) || null;
        if (acao === "reabrir") {
          if (ch.estado === "pendente") throw new ErroCallback("A chamada já está pendente.");
          if (!observacao) throw new ErroCallback("Explique por que está reabrindo (correção de registro).", 422);
          ch.estado = "pendente"; ch.meio_callback = null; ch.servico_executado_em = null; ch.resolvida_em = null;
          ch.callback_origem = null; ch.callback_operador = null; ch.callback_em = null; ch.callback_telefone = null;
          this._reabrirNoHistorico(E, ch);
        } else {
          if (ch.estado === "callback_realizado") throw new ErroCallback("Callback já registrado para esta chamada. Use 'Reabrir' se o registro estiver errado.");
          ch.tentativas.push({ meio, resultado: acao, momento: agoraIso() });
          if (acao === "callback_realizado") { ch.estado = "callback_realizado"; ch.meio_callback = meio; this._anotarCallback(E, ch, { origem: "registro_manual", meio }); }
          else if (acao === "contato_invalido") ch.estado = "contato_invalido";
        }
        if (observacao) ch.observacao = observacao;
        ch.atualizado_em = agoraIso();
        return ch;
      });
    }
    /* 1.1.0: "Serviço executado" e "Ocorrência resolvida com sucesso": só depois do callback realizado; uma vez cada; independentes. */
    registrarResultado(id, tipo) {
      this.obterChamada(id);
      const r = RESULTADOS[tipo];
      if (!r) throw new ErroCallback("Resultado desconhecido.", 422);
      return this._alterar((E) => {
        const ch = E.chamadas.find((x) => x.id === id);
        if (!comCallback(ch)) throw new ErroCallback(`Registre o callback realizado antes de marcar "${r.rotulo}".`);
        if (ch[r.campo]) throw new ErroCallback(`"${r.rotulo}" já foi registrado para esta chamada. Use 'Reabrir' se o registro estiver errado.`);
        ch[r.campo] = agoraIso(); ch.atualizado_em = agoraIso();
        if (tipo === "resolvida") this._resolverNoHistorico(E, ch, true);
        return ch;
      });
    }
    /* 1.1.0: desfazer (corrigir) "Serviço executado" ou "Ocorrência resolvida" registrado por engano. Não mexe no callback,
       nas tentativas nem no outro registro. (Reabrir continua apagando os dois junto com o callback.) */
    desfazerResultado(id, tipo) {
      this.obterChamada(id);
      const r = RESULTADOS[tipo];
      if (!r) throw new ErroCallback("Resultado desconhecido.", 422);
      return this._alterar((E) => {
        const ch = E.chamadas.find((x) => x.id === id);
        if (!ch[r.campo]) throw new ErroCallback(`"${r.rotulo}" não está registrado para esta chamada.`);
        ch[r.campo] = null; ch.atualizado_em = agoraIso();
        if (tipo === "resolvida") this._resolverNoHistorico(E, ch, false);
        return ch;
      });
    }
    _textoMensagem(c, modelo, textoEditado) {
      if (textoEditado != null && String(textoEditado).trim()) {
        try { return N.textoDoOperador(textoEditado); } catch (e) { throw new ErroCallback(e.message, 422); }
      }
      return N.renderizar(N.escolherModelo(null, modelo || N.sugerirMensagem(c).codigo), c, this.sessao().polo);
    }
    /* Prepara o link do WhatsApp Web. NÃO envia: o operador confere e envia. Não é tentativa nem callback. */
    abrirWhatsapp(id, numero, modelo, confirmoTelefone, textoEditado) {
      const c = this.obterChamada(id), tel = c.telefones.find((t) => t.numero === numero);
      if (!tel) throw new ErroCallback("Telefone não pertence a esta chamada.", 404);
      if (tel.tipo !== "celular") throw new ErroCallback("WhatsApp só para celular. Para este número, use a ligação.", 422);
      if (tel.requer_confirmacao && !confirmoTelefone) throw new ErroCallback("Telefone encontrado no comentário: confirme que é do cliente antes de abrir o WhatsApp.", 422);
      if (bloqueiaIndividual(c, numero)) throw new ErroCallback("Callback já registrado para esta chamada.");
      const texto = this._textoMensagem(c, modelo, textoEditado);
      return this._alterar((E) => { E.chamadas.find((x) => x.id === id).whatsapp_aberto_em = agoraIso(); return { url: N.linkWhatsappWeb(numero, texto), texto }; });
    }
    /* 1.1.0: envio manual — telefone achado pelo operador no cadastro do cliente no ADMS. Valida e normaliza; só celular.
       O número NÃO é gravado (fica só na tela). Só marca que o WhatsApp foi aberto: não é tentativa nem callback. */
    abrirWhatsappManual(id, telefoneDigitado, modelo, textoEditado) {
      const c = this.obterChamada(id), v = N.validarTelefoneManual(telefoneDigitado);
      if (!v.ok) throw new ErroCallback(v.erro, 422);
      if (bloqueiaIndividual(c, v.numero)) throw new ErroCallback("Callback já registrado para esta chamada.");
      const texto = this._textoMensagem(c, modelo, textoEditado);
      return this._alterar((E) => { const ch = E.chamadas.find((x) => x.id === id); ch.whatsapp_aberto_em = agoraIso(); ch.whatsapp_manual = true;
        return { url: N.linkWhatsappWeb(v.numero, texto), texto, numero: v.numero, exibir: v.exibir }; });
    }
    detalhe(id, modelo) {
      // 1.0.2: pré-seleciona a mensagem sugerida pelo reconhecimento (recalculada: vale também para lotes antigos)
      const c = this.obterChamada(id), sug = N.sugerirMensagem(c), m = N.escolherModelo(null, modelo || sug.codigo), g = this.grupoDaChamada(id);
      return { ...c, modelo: m.codigo, mensagem: N.renderizar(m, c, this.sessao().polo), modelos: N.catalogo(),
        sugestao: sug, sugestao_texto: N.descreverSugestao(sug), localizacao: c.localizacao,
        modelos_agrupados: N.catalogoAgrupado(), risco: N.indicacaoRisco(c),
        grupo: { chave: g.chave, incidente: g.incidente, qtd: g.qtd, avisos: g.avisos, principal_id: g.principal.id,
          posicao: g.membros.findIndex((x) => x.id === id) + 1,
          membros: g.membros.map((x) => ({ id: x.id, call_id: x.call_id, horario_call: x.horario_call, motivo: x.motivo, submotivos: x.submotivos,
            tipo_ocorrencia: x.tipo_ocorrencia, subtipo: x.subtipo, estado: x.estado, tentativas: x.tentativas.length, risco: N.indicacaoRisco(x) })) } };
    }

    metricasLote(lista) {
      const pe = contar(lista, (c) => c.estado), r = { chamadas: lista.length };
      for (const e of ESTADOS) r[e] = pe[e] || 0;
      r.tentativas = lista.reduce((s, c) => s + c.tentativas.length, 0);
      r.tentativas_sem_sucesso = lista.reduce((s, c) => s + semSucesso(c), 0);
      r.servico_executado = lista.filter((c) => comCallback(c) && c.servico_executado_em).length;
      r.resolvida = lista.filter((c) => comCallback(c) && c.resolvida_em).length;
      r.ja_vistas_em_lote_anterior = lista.filter((c) => c.ja_vista_no_dia).length;
      r.por_motivo = contar(lista, (c) => c.motivo || "não informado");
      r.por_subtipo = contar(lista, (c) => c.subtipo || "nao_identificado");
      return r;
    }
    encerrarLote() {
      return this._alterar((E) => {
        const lote = E.lotes.find((l) => l.situacao === "aberto");
        if (!lote) throw new ErroCallback("Não há lote aberto.");
        if (this._encerrarFilasDoLote) this._encerrarFilasDoLote(E, lote.id); // Central de Disparos: recusa fila ativa; apaga dados pessoais das filas
        const lista = E.chamadas.filter((c) => c.lote_id === lote.id), metr = this.metricasLote(lista);
        for (const c of lista) acumular(E.marcas, c, this.marcaIncidente(E.sessao, c.incidente));
        lote.metricas = metr; lote.situacao = "encerrado"; lote.encerrado_em = agoraIso();
        E.chamadas = E.chamadas.filter((c) => c.lote_id !== lote.id); // apaga os dados pessoais do lote
        return { metricas_lote: metr, metricas_dia: this._metricasDia(E) };
      });
    }
    _metricasDia(E) {
      const s = E.sessao;
      if (!s) return null;
      if (s.situacao === "encerrada" && s.metricas_finais) return s.metricas_finais;
      const marcas = Object.values(E.marcas), pe = contar(marcas, (m) => m.estado), cb = pe.callback_realizado || 0;
      const comCb = marcas.filter((m) => m.estado === "callback_realizado"), resolvidas = comCb.filter((m) => m.resolvida).length;
      const incs = {};
      for (const m of marcas) if (m.inc) (incs[m.inc] = incs[m.inc] || []).push(m);
      return { lotes: E.lotes.filter((l) => l.situacao === "encerrado").length, chamadas_processadas: marcas.length,
        callbacks_realizados: cb, pendencias_contabilizadas: pe.pendente || 0, sem_telefone: pe.sem_telefone || 0,
        contatos_invalidos: pe.contato_invalido || 0, tentativas: marcas.reduce((t, m) => t + m.tentativas, 0),
        tentativas_sem_sucesso: marcas.reduce((t, m) => t + (m.sem_sucesso || 0), 0),
        servicos_executados: comCb.filter((m) => m.servico).length, ocorrencias_resolvidas: resolvidas,
        callbacks_sem_resolucao: cb - resolvidas, taxa_resolucao: cb ? N.arredondar1(100 * resolvidas / cb) : 0,
        chamadas_em_mais_de_um_lote: marcas.filter((m) => m.lotes > 1).length,
        incidentes_unicos: Object.keys(incs).length, chamadas_sem_incidente: marcas.filter((m) => !m.inc).length,
        incidentes_com_callback: Object.values(incs).filter((g) => g.some((m) => m.estado === "callback_realizado")).length,
        por_motivo: contar(marcas, (m) => m.motivo || "não informado"), por_subtipo: contar(marcas, (m) => m.subtipo || "nao_identificado") };
    }
    /* Pseudônimo do incidente no dia (domínio separado do da CALL, como na referência). Sem incidente = null. */
    marcaIncidente(sessao, inc) { return inc ? N.hmacSha256Hex(sessao.chave_marca, "INCIDENTE|" + inc) : null; }
    metricasDia() { return this.sessao() ? this._metricasDia(this.E) : null; }
    /* 1.0.2: indicadores EM TEMPO REAL = lotes encerrados + lote em andamento, pela MESMA regra do encerramento
       (CALL única no dia, melhor resultado). Calculado em memória sobre uma cópia: não grava nada e não altera as métricas
       oficiais do dia (que continuam sendo as dos lotes encerrados, usadas na exportação). */
    metricasTempoReal() {
      const s = this.sessao(); if (!s) return null;
      const E = { sessao: s, lotes: this.E.lotes, marcas: clonar(this.E.marcas) }, lista = this.chamadas();
      for (const c of lista) acumular(E.marcas, c, this.marcaIncidente(s, c.incidente));
      return { ...this._metricasDia(E), lotes_em_andamento: this.loteAberto() ? 1 : 0, inclui_lote_aberto: !!this.loteAberto() };
    }
    /* 1.0.2: indicador de encerramento: lotes encerrados x importados no dia e o último encerramento (sem contar duas vezes:
       cada lote tem um id e uma única situação "encerrado"). */
    resumoLotes() {
      const ls = this.sessao() ? this.E.lotes : [], enc = ls.filter((l) => l.situacao === "encerrado").sort((a, b) => String(b.encerrado_em).localeCompare(String(a.encerrado_em)));
      const u = enc[0];
      return { importados: ls.length, encerrados: enc.length, em_andamento: ls.filter((l) => l.situacao === "aberto").length,
        ultimo: u ? { numero: u.numero, encerrado_em: u.encerrado_em, chamadas: u.metricas.chamadas, callbacks: u.metricas.callback_realizado, pendentes: u.metricas.pendente } : null };
    }
    /* 1.1.0: o arquivo do dia sairia com qual nome (para a tela e o teste). */
    nomeArquivoDoDia() {
      const s = this.sessao(); if (!s) return null;
      return N.nomeArquivoDia(s, 1 + (this.E.dias_encerrados || []).filter((d) => d.id !== s.id && N.nomeArquivoDia(d) === N.nomeArquivoDia(s)).length);
    }

    /* ------------------------------------------------ exportação */
    _exportar(E, definitiva) {
      const s = E.sessao, metricas = definitiva && s.metricas_finais ? s.metricas_finais : this._metricasDia(E);
      const anteriores = E.exportacoes.filter((x) => x.sessao_id === s.id).sort((a, b) => b.versao - a.versao), ant = anteriores[0];
      const versao = (ant ? ant.versao : 0) + 1;
      const exp = { id: N.novoId(), sessao_id: s.id, versao, substitui_id: ant ? ant.id : null, definitiva: !!definitiva, exportado_em: N.agoraLocalIso() };
      // 1.1.0: arquivo diário (uma linha agregada). Turno: 2º turno do mesmo polo no mesmo dia neste navegador recebe _T2.
      const turno = 1 + (E.dias_encerrados || []).filter((d) => d.id !== s.id && d.data_operacional === s.data_operacional
        && N.nomeArquivoDia(d) === N.nomeArquivoDia(s)).length;
      const conteudo = N.csvDia(N.linhaDia(s, exp, metricas));
      Object.assign(exp, { nome: N.nomeArquivoDia(s, turno), linhas: 1, conteudo, formato: "diario-1.1.0",
        sha256: N.sha256Hex(new TextEncoder().encode(conteudo)), data_operacional: s.data_operacional, polo: s.polo, salvo: null });
      E.exportacoes.unshift(exp);
      return exp;
    }
    exportar() {
      return this._alterar((E) => {
        if (!E.sessao || E.sessao.situacao !== "aberta") throw new ErroCallback("Abra o dia antes de exportar.");
        const exp = this._exportar(E, false);
        return { ...exp, lote_aberto_nao_incluido: E.lotes.some((l) => l.situacao === "aberto") };
      });
    }
    encerrarDia() {
      return this._alterar((E) => {
        const s = E.sessao;
        if (!s || s.situacao !== "aberta") throw new ErroCallback("O dia já foi encerrado.");
        if (E.lotes.some((l) => l.situacao === "aberto")) throw new ErroCallback("Encerre e limpe o lote aberto antes de encerrar o dia.");
        s.metricas_finais = this._metricasDia(E);
        const exp = this._exportar(E, true);
        E.dias_encerrados.unshift({ id: s.id, data_operacional: s.data_operacional, polo: s.polo, operador: s.operador,
          metricas_finais: s.metricas_finais, lotes: E.lotes.map((l) => ({ numero: l.numero, arquivo_nome: l.arquivo_nome, metricas: l.metricas })),
          encerrada_em: agoraIso() });
        E.marcas = {}; E.lotes = []; E.chamadas = []; E.sessao = null; // sem a chave do dia, não há como voltar às CALLs
        return { exportacao: exp, metricas: s.metricas_finais };
      });
    }
    /* 1.1.0: cópia de contingência (Downloads) quando o destino falhou. NÃO conta como salvo no destino. */
    marcarContingencia(idExp) { return this._alterar((E) => { const x = E.exportacoes.find((e) => e.id === idExp); if (x) x.contingencia = { em: agoraIso() }; }); }
    marcarSalvo(idExp, onde) { return this._alterar((E) => { const x = E.exportacoes.find((e) => e.id === idExp); if (x) x.salvo = { onde, em: agoraIso() }; }); }
    exportacao(id) { return this.E.exportacoes.find((e) => e.id === id) || null; }

    /* 1.1.0: painel (dashboard). Fonte: os turnos registrados NESTE navegador (dias encerrados + turno aberto, em tempo real).
       Cada turno entra uma vez; dentro do turno cada CALL conta uma vez. Indicador que um turno antigo (anterior à 1.1.0) não
       tinha fica null (exibido como "—"), nunca como zero inventado. */
    painel() {
      const CAMPOS = ["chamadas_processadas", "callbacks_realizados", "tentativas_sem_sucesso", "contatos_invalidos", "sem_telefone",
        "servicos_executados", "ocorrencias_resolvidas", "pendencias_contabilizadas", "tentativas"];
      const s = this.sessao(), turnos = [];
      if (s) turnos.push({ id: s.id, data: s.data_operacional, polo: s.polo, operador: s.operador || "—", aberto: true, m: this.metricasTempoReal() });
      for (const d of this.E.dias_encerrados || []) turnos.push({ id: d.id, data: d.data_operacional, polo: d.polo, operador: d.operador || "—", aberto: false, m: d.metricas_finais || {} });
      const linha = (t) => Object.fromEntries(CAMPOS.map((k) => [k, typeof t.m[k] === "number" ? t.m[k] : null]));
      const agrupar = (chave) => {
        const mapa = new Map();
        for (const t of turnos) {
          const k = chave(t), l = linha(t);
          if (!mapa.has(k)) mapa.set(k, { chave: k, turnos: 0, incompleto: false, ...Object.fromEntries(CAMPOS.map((c) => [c, 0])) });
          const g = mapa.get(k); g.turnos++;
          for (const c of CAMPOS) { if (l[c] == null) g.incompleto = true; else g[c] += l[c]; }
        }
        return [...mapa.values()];
      };
      return { campos: CAMPOS, turnos: turnos.map((t) => ({ ...t, ...linha(t) })),
        por_dia: agrupar((t) => t.data).sort((a, b) => b.chave.localeCompare(a.chave)),
        por_operador: agrupar((t) => t.operador).sort((a, b) => a.chave.localeCompare(b.chave, "pt-BR")),
        por_polo: agrupar((t) => t.polo || "—").sort((a, b) => a.chave.localeCompare(b.chave, "pt-BR")) };
    }

    /* ------------------------------------------------ visão geral para a tela */
    estado() {
      const s = this.sessao(), lote = this.loteAberto();
      return { configuracao: this.configuracao(), sessao: s ? { id: s.id, data_operacional: s.data_operacional, operador: s.operador,
          polo: s.polo, estacao: s.estacao, aberta_em: s.aberta_em } : null,
        metricas_dia: this.metricasDia(), metricas_tempo_real: this.metricasTempoReal(), resumo_lotes: this.resumoLotes(),
        lote_aberto: lote, lote_em_andamento: lote ? this.metricasLote(this.chamadas()) : null,
        lotes: s ? this.E.lotes.slice().sort((a, b) => a.numero - b.numero) : [], aviso: this.aviso(), nome_arquivo_dia: this.nomeArquivoDoDia(),
        exportacoes: this.E.exportacoes.slice(0, 20).map(({ conteudo, ...r }) => r), dias_encerrados: this.E.dias_encerrados.slice(0, 10) };
    }
  }
  Servico.ErroCallback = ErroCallback;
  Servico.MEIOS = MEIOS;
  Servico.RESULTADOS = RESULTADOS;
  raiz.Servico = Servico;
})(typeof window !== "undefined" ? window : globalThis);
