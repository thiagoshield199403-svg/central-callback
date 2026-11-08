/* Central de Disparos — fila de envio por incidentes. Estende o Servico: mesmo estado, mesma gravação atômica.
   ATENDIMENTO GUIADO (assistido): a tela de lote usa esta mesma fila, abrindo cada incidente no WhatsApp Web. Quem envia é o operador; nada aqui chama a API.
   O restante deste comentário descreve o motor anterior por API, mantido só para as filas já registradas.
   - As mensagens vêm das regras existentes (N.sugerirMensagem + Servico._textoMensagem); os modelos nunca são alterados.
   - Nada é enviado sem autorização explícita (autorizarDisparo). A autorização congela a fila: cada item recebe uma assinatura.
   - Antes de cada envio o item é GRAVADO como "enviando"; depois, grava-se o resultado. Se a aba cair no meio, a chave de
     idempotência do item é reutilizada e o gateway devolve o resultado anterior em vez de enviar de novo.
   - Sem resposta (rede/gateway) ou limite da API: o item volta para a fila e a fila pausa. Nada se perde.
   - Mensagem EFETIVAMENTE enviada conta como callback do operador que autorizou, uma única vez por chamada. Preparada, pendente,
     com falha, incerta ou simulada não conta. item.status é o envio; chamada.estado é o resultado operacional.
   - O envio vai só para o contato principal do incidente; os demais usam o envio individual do painel.
   - Ao encerrar o lote, telefone, nome e texto são apagados das filas; fica a auditoria (telefone mascarado e hash do texto).
   Tokens e credenciais NUNCA passam por aqui: ficam só no gateway (gateway/servidor.mjs). */
"use strict";
(function (raiz) {
  const N = raiz.Nucleo, Servico = raiz.Servico, ErroCallback = Servico.ErroCallback;
  const STATUS = { aguardando: "Aguardando", preparado: "Preparado", enviando: "Enviando", enviado: "Enviado", falha: "Falha", cancelado: "Cancelado", aberto: "WhatsApp aberto", nao_confirmado: "Envio não confirmado", pulado: "Pulado" };
  const ATIVAS = ["revisao", "autorizada", "pausada", "atendimento"];
  const aguardaAtendimento = (i) => i.status === "preparado" || i.status === "aguardando";
  const jaAbordado = (s) => ["enviado", "aberto", "nao_confirmado"].includes(s);
  /* O incidente da vez sempre sai do estado gravado: não há ponteiro que possa avançar duas vezes. */
  const atualDe = (f) => f.itens.find((i) => i.status === "aberto") || f.itens.find(aguardaAtendimento) || null;
  function concluirSeAcabou(f) { if (f.situacao === "atendimento" && !atualDe(f)) { f.situacao = "concluida"; f.concluida_em = new Date().toISOString(); f.eventos.push({ em: f.concluida_em, tipo: "concluida", detalhe: null, incidente: null }); } }
  const TEMPO_EXECUTOR = 45000, INTERVALO_PADRAO = 1200, TEMPO_RESPOSTA = 30000;
  const agora = () => new Date().toISOString();
  const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));
  const mascarar = (t) => (t ? "•••••" + String(t).slice(-4) : "—");
  const hashTexto = (t) => N.sha256Hex(String(t || ""));
  const conteudo = (i) => `${i.telefone}|${hashTexto(i.texto)}`;
  const assinar = (i) => N.sha256Hex(`${i.id}|${i.chamada_id}|${i.telefone}|${hashTexto(i.texto)}`);
  const real = (f) => !(f.autorizacao && f.autorizacao.conector_modo === "simulacao");
  const vivo = (x) => !!x && new Date(x.expira).getTime() > Date.now();

  function evento(f, tipo, detalhe, item) {
    f.eventos.push({ em: agora(), tipo, detalhe: detalhe || null, incidente: item ? item.incidente || item.call_id : null });
  }
  function achar(E, id) { const f = E.disparos.find((x) => x.id === id); if (!f) throw new ErroCallback("Fila de envio não encontrada.", 404); return f; }
  function naRevisao(E, id) { const f = achar(E, id); if (f.assistido && ["atendimento", "pausada"].includes(f.situacao)) return f; if (f.situacao !== "revisao") throw new ErroCallback("Esta fila já foi autorizada: as mensagens não podem mais ser alteradas."); return f; }
  function itemDe(f, id) { const i = f.itens.find((x) => x.id === id); if (!i) throw new ErroCallback("Incidente não encontrado na fila.", 404); return i; }

  /* Recalcula pendências e status da revisão. Pendência bloqueia o item ("Aguardando"); aviso só informa. */
  function revisar(E, f) {
    const jaEnviadas = new Set(E.disparos.filter((x) => x.lote_id === f.lote_id && x.id !== f.id && real(x))
      .flatMap((x) => x.itens.filter((i) => i.status === "enviado").map(conteudo)));
    const vistos = new Set(), porTelefone = {};
    const emAberto = (i) => i.status !== "cancelado" && (!f.assistido || aguardaAtendimento(i)); // no atendimento guiado, item já tratado não muda de status
    for (const i of f.itens) if (emAberto(i) && i.selecionado && i.telefone) porTelefone[i.telefone] = (porTelefone[i.telefone] || 0) + 1;
    for (const i of f.itens) {
      if (!emAberto(i)) continue;
      const p = [], v = N.validarTelefoneManual(i.telefone || "");
      if (!i.telefone) p.push({ codigo: "telefone", texto: "Sem celular no ADMS: informe o número do cliente." });
      else if (!v.ok) p.push({ codigo: "telefone", texto: v.erro });
      else if (i.requer_confirmacao && !i.confirmado) p.push({ codigo: "confirmar", texto: "Telefone achado no comentário: confirme que é do cliente." });
      if (v.ok) {
        const k = conteudo(i);
        if (jaEnviadas.has(k)) p.push({ codigo: "ja_enviada", texto: "Esta mensagem já foi enviada a este telefone neste lote." });
        else if (i.selecionado && vistos.has(k)) p.push({ codigo: "duplicada", texto: "Mensagem duplicada: mesmo telefone e mesmo texto de outro item da fila." });
        if (i.selecionado) vistos.add(k);
      }
      i.pendencias = p;
      i.avisos = i.telefone && porTelefone[i.telefone] > 1 ? [`Mesmo telefone em ${porTelefone[i.telefone]} incidentes da fila.`] : [];
      i.status = p.length ? "aguardando" : "preparado";
    }
  }

  function escolherTelefone(c) {
    const cel = c.telefones.filter((t) => t.tipo === "celular" && t.numero);
    return cel.find((t) => !t.requer_confirmacao) || cel[0] || c.telefones.find((t) => t.numero) || null;
  }

  /* Status do incidente na última fila real do lote em que ele apareceu. */
  function statusNoLote(E, loteId, chamadaId) {
    for (let n = E.disparos.length - 1; n >= 0; n--) {
      const f = E.disparos[n];
      if (f.lote_id !== loteId || !real(f) || (!f.autorizacao && f.situacao === "cancelada")) continue; // rascunho descartado não conta
      const i = f.itens.find((x) => x.chamada_id === chamadaId);
      if (i) return i.status;
    }
    return "aguardando";
  }

  Object.assign(Servico.prototype, {
    /* Gravação do executor: outra aba pode ter gravado; repete sobre o estado novo. */
    async _alterarInsistindo(f) {
      for (let t = 0; ; t++) {
        try { return await this._alterar(f); }
        catch (e) { if (!(e instanceof raiz.Armazenamento.ErroConcorrencia) || t >= 5) throw e; await espera(60 * (t + 1)); }
      }
    },

    /* ------------------------------------------------ seleção */
    incidentesParaDisparo() {
      const lote = this.loteAberto(); if (!lote) return [];
      return this.grupos().map((g) => {
        const c = g.principal, sug = N.sugerirMensagem(c), m = N.modelos().find((x) => x.codigo === sug.codigo), tel = escolherTelefone(c);
        const status = statusNoLote(this.E, lote.id, c.id);
        const at = this.atendimentoDoIncidente(g.chave);
        const motivo = at ? `Por ${at.operador} em ${new Date(at.em).toLocaleString("pt-BR")}` : c.estado === "callback_realizado" ? "Callback já realizado" : status === "enviado" ? "Mensagem já enviada" : jaAbordado(status) ? "Envio não confirmado: confirme antes de atender de novo" : null;
        return { chave: g.chave, id: c.id, incidente: c.incidente, call_id: c.call_id, protocolo: c.incidente || c.call_id, nome: c.nome, motivo_adms: c.motivo, // protocolo = o mesmo usado nas mensagens (N.renderizar)
          submotivos: c.submotivos, modelo: sug.codigo, ocorrencia: m ? m.nome : "Mensagem genérica", telefone: tel ? tel.numero : null,
          tem_celular: !!tel && tel.tipo === "celular", atendido: !!at || c.estado === "callback_realizado", qtd: g.qtd, risco: g.risco, estado: c.estado, status, elegivel: !motivo, motivo_inelegivel: motivo };
      });
    },
    filaDoLote() {
      const l = this.loteAberto(); if (!l) return null;
      return this.E.disparos.filter((f) => f.lote_id === l.id).pop() || null;
    },
    filaAtiva() { const f = this.filaDoLote(); return f && ATIVAS.includes(f.situacao) ? f : null; },
    fila(id) { return this.E.disparos.find((f) => f.id === id) || null; },
    historicoDisparos() { return this.E.disparos.slice().reverse(); },

    /* ------------------------------------------------ preparação: gera a mensagem de cada incidente pelas regras existentes */
    prepararDisparo(chaves, modo, { assistido = false } = {}) {
      if (!["selecao", "lote"].includes(modo)) throw new ErroCallback("Modalidade de envio desconhecida.", 422);
      const pedidas = new Set(chaves || []);
      if (!pedidas.size) return Promise.reject(new ErroCallback("Selecione pelo menos um incidente.", 422));
      return this._alterar((E) => {
        const lote = E.lotes.find((l) => l.situacao === "aberto");
        if (!lote || !E.sessao) throw new ErroCallback("Não há lote aberto.");
        if (E.disparos.some((f) => f.lote_id === lote.id && ATIVAS.includes(f.situacao))) throw new ErroCallback("Já existe uma fila em andamento neste lote. Conclua ou cancele antes de preparar outra.");
        const f = { id: N.novoId(), lote_id: lote.id, lote_numero: lote.numero, modo, situacao: "revisao", criada_em: agora(), operador: E.sessao.operador,
          autorizacao: null, reprocessos: [], executor: null, concluida_em: null, dados_apagados: false, itens: [], eventos: [] };
        let ignorados = 0;
        for (const g of N.agruparIncidentes(E.chamadas.filter((c) => c.lote_id === lote.id))) {
          if (!pedidas.has(g.chave)) continue;
          const c = g.principal;
          if (c.estado === "callback_realizado" || jaAbordado(statusNoLote(E, lote.id, c.id)) || this._efetivoEm(E, g.chave)) { ignorados++; continue; }
          const sug = N.sugerirMensagem(c), m = N.escolherModelo(null, sug.codigo), tel = escolherTelefone(c), texto = this._textoMensagem(c, sug.codigo);
          f.itens.push({ id: N.novoId(), chave: N.novoId(), chamada_id: c.id, call_id: c.call_id, incidente: c.incidente, comunicacoes: g.qtd, risco: g.risco,
            modelo: m.codigo, ocorrencia: m.nome, destinatario: c.nome || null, telefone: tel ? tel.numero : null, telefone_origem: tel ? tel.origem : null,
            telefone_mascara: mascarar(tel && tel.numero), requer_confirmacao: !!(tel && tel.requer_confirmacao), confirmado: false, texto, texto_modelo: texto, editada: false,
            hash_texto: hashTexto(texto), selecionado: true, status: "aguardando", assinatura: null, pendencias: [], avisos: [], tentativas: [], incerto: false,
            wamid: null, enviado_em: null, erro: null, simulado: false, callback: null });
        }
        if (!f.itens.length) throw new ErroCallback("Nenhum incidente selecionado pode ser preparado (callback já realizado ou mensagem já enviada).", 422);
        revisar(E, f);
        if (assistido) {
          f.assistido = true; f.situacao = "atendimento";
          f.autorizacao = { em: agora(), operador: E.sessao.operador, polo: E.sessao.polo, estacao: E.sessao.estacao || null, whatsapp: null, total: f.itens.length, conector_modo: "whatsapp_web", resumo: null };
          f.itens.forEach((i) => { i.assinatura = assinar(i); });
        }
        evento(f, "preparada", `${f.itens.length} incidente(s) preparados${ignorados ? `; ${ignorados} ignorado(s)` : ""}`);
        E.disparos.push(f);
        return f;
      });
    },

    /* ------------------------------------------------ atendimento guiado pelo WhatsApp Web (tela de envio em lote) */
    iniciarAtendimento(chaves) { return this.prepararDisparo(chaves, "lote", { assistido: true }); },
    itemAtual(f) { return atualDe(f); },
    abrirAtendimento(filaId, itemId) {
      return this._alterar((E) => {
        const f = achar(E, filaId);
        if (f.situacao === "pausada") throw new ErroCallback("Retome o atendimento para continuar.");
        if (f.situacao !== "atendimento") throw new ErroCallback("Este atendimento não está em andamento.");
        const i = itemDe(f, itemId), atual = atualDe(f);
        if (!atual || atual.id !== i.id) throw new ErroCallback("Este incidente não é o atual da fila.");
        const ch = E.chamadas.find((x) => x.id === i.chamada_id);
        if (i.status !== "aberto" && ch && ch.estado === "callback_realizado") { i.status = "pulado"; i.erro = "Callback registrado por outra via durante o atendimento."; i.callback = { situacao: "ja_registrado", operador: null, em: agora() }; evento(f, "callback_ja_registrado", i.erro, i); concluirSeAcabou(f); return { pulado: true }; }
        if (i.status !== "aberto") { revisar(E, f); if (i.status !== "preparado") throw new ErroCallback(i.pendencias.map((p) => p.texto).join(" ") || "Corrija a pendência deste incidente.", 422); }
        i.status = "aberto"; i.tentativas.push({ n: i.tentativas.length + 1, inicio: agora(), fim: null, resultado: "whatsapp_aberto", codigo: null, detalhe: null, wamid: null });
        evento(f, "whatsapp_aberto", null, i);
        return { url: N.linkWhatsappWeb(i.telefone, i.texto) };
      });
    },
    /* Retorno à janela. Repetido, não faz nada: só muda quem ainda está "aberto". */
    registrarRetornoAtendimento(filaId, itemId) {
      return this._alterarInsistindo((E) => {
        const f = achar(E, filaId), i = itemDe(f, itemId);
        if (i.status === "aberto") { i.status = "nao_confirmado"; const t = i.tentativas[i.tentativas.length - 1]; if (t) t.fim = agora(); evento(f, "retorno", "Retornou à Central: envio não confirmado.", i); concluirSeAcabou(f); }
        return f;
      });
    },
    pularAtendimento(filaId, itemId) {
      return this._alterar((E) => {
        const f = achar(E, filaId), i = itemDe(f, itemId);
        if (f.situacao !== "atendimento") throw new ErroCallback("Retome o atendimento para continuar.");
        const atual = atualDe(f); if (!atual || atual.id !== i.id) return f; // clique repetido
        const t = i.tentativas[i.tentativas.length - 1]; if (t && !t.fim) t.fim = agora();
        i.status = "pulado"; evento(f, "pulado", null, i); concluirSeAcabou(f);
        return f;
      });
    },
    pausarAtendimento(filaId) { return this._alterar((E) => { const f = achar(E, filaId); if (f.situacao !== "atendimento") throw new ErroCallback("O atendimento não está em andamento."); f.situacao = "pausada"; evento(f, "pausada", `por ${E.sessao.operador}`); return f; }); },
    retomarAtendimento(filaId) { return this._alterar((E) => { const f = achar(E, filaId); if (f.situacao !== "pausada" || !f.assistido) throw new ErroCallback("O atendimento não está pausado."); f.situacao = "atendimento"; evento(f, "retomada", `por ${E.sessao.operador}`); concluirSeAcabou(f); return f; }); },
    /* Cancelar o atendimento não é cancelar o incidente: não entra em nenhum indicador. */
    cancelarAtendimento(filaId) {
      return this._alterar((E) => {
        const f = achar(E, filaId);
        if (!f.assistido || !["atendimento", "pausada"].includes(f.situacao)) throw new ErroCallback("O atendimento não está em andamento.");
        let n = 0;
        for (const i of f.itens) {
          if (aguardaAtendimento(i)) { i.status = "cancelado"; i.erro = "Atendimento cancelado pelo operador."; n++; }
          else if (i.status === "aberto") { i.status = "nao_confirmado"; const t = i.tentativas[i.tentativas.length - 1]; if (t) t.fim = agora(); }
        }
        f.situacao = "cancelada"; f.concluida_em = agora(); evento(f, "cancelada", `${n} incidente(s) não atendido(s)`);
        return f;
      });
    },
    /* Só o operador sabe se a mensagem saiu. "enviado" usa o mesmo registro de callback da fila: uma vez por chamada. */
    confirmarEnvioAtendimento(filaId, itemId, resultado) {
      if (!["enviado", "falha"].includes(resultado)) return Promise.reject(new ErroCallback("Resultado desconhecido.", 422));
      return this._alterar((E) => {
        const f = achar(E, filaId), i = itemDe(f, itemId);
        if (i.status !== "nao_confirmado") throw new ErroCallback("Este envio não está aguardando confirmação.");
        if (!E.sessao || E.sessao.situacao !== "aberta") throw new ErroCallback("Abra o turno para confirmar o envio.", 422);
        const momento = agora(), t = i.tentativas[i.tentativas.length - 1]; if (t) t.resultado = resultado === "enviado" ? "confirmado_pelo_operador" : "operador_nao_enviou";
        if (resultado === "falha") { i.status = "falha"; i.erro = "O operador informou que não enviou."; evento(f, "nao_enviado", null, i); return i; }
        i.status = "enviado"; i.enviado_em = momento; i.erro = null; this._registrarCallbackDoEnvio(E, f, i, momento); evento(f, "envio_confirmado", `por ${E.sessao.operador}`, i);
        return i;
      });
    },
    pendentesConfirmacao() {
      const l = this.loteAberto(); if (!l) return [];
      return this.E.disparos.filter((f) => f.lote_id === l.id && f.assistido).flatMap((f) => f.itens.filter((i) => i.status === "nao_confirmado").map((item) => ({ fila: f.id, item }))).reverse();
    },
    painelAtendimento(f) {
      const c = (...s) => f.itens.filter((i) => s.includes(i.status)).length, total = f.itens.length, restantes = c("preparado", "aguardando", "aberto"), cancelados = c("cancelado");
      return { total, atendidos: c("nao_confirmado", "enviado", "falha"), restantes, pulados: c("pulado"), nao_confirmados: c("nao_confirmado"), confirmados: c("enviado"), cancelados, percentual: total ? Math.round(100 * (total - restantes) / total) : 0 };
    },

    /* ------------------------------------------------ revisão */
    _naRevisao(filaId, itemId, aplicar) {
      return this._alterar((E) => { const f = naRevisao(E, filaId), i = itemDe(f, itemId); if (f.assistido && !aguardaAtendimento(i)) throw new ErroCallback("Este incidente já foi aberto no WhatsApp."); const r = aplicar(i, f); revisar(E, f); return r === undefined ? i : r; });
    },
    selecionarItem(filaId, itemId, valor) { return this._naRevisao(filaId, itemId, (i) => { i.selecionado = !!valor; }); },
    selecionarTodosItens(filaId, valor) {
      return this._alterar((E) => { const f = naRevisao(E, filaId); f.itens.forEach((i) => { if (i.status !== "cancelado") i.selecionado = !!valor; }); revisar(E, f); return f; });
    },
    /* Edita SÓ o texto deste item; o modelo original continua intacto. Usa a mesma validação do painel individual. */
    editarMensagemItem(filaId, itemId, texto) {
      return this._naRevisao(filaId, itemId, (i, f) => {
        let t; try { t = N.textoDoOperador(texto); } catch (e) { throw new ErroCallback(e.message, 422); }
        i.texto = t; i.hash_texto = hashTexto(t); i.editada = t !== i.texto_modelo;
        evento(f, i.editada ? "mensagem_editada" : "mensagem_restaurada", null, i);
      });
    },
    restaurarMensagemItem(filaId, itemId) {
      return this._naRevisao(filaId, itemId, (i, f) => { i.texto = i.texto_modelo; i.hash_texto = hashTexto(i.texto); i.editada = false; evento(f, "mensagem_restaurada", null, i); });
    },
    corrigirTelefoneItem(filaId, itemId, bruto) {
      return this._naRevisao(filaId, itemId, (i, f) => {
        const v = N.validarTelefoneManual(bruto);
        if (!v.ok) throw new ErroCallback(v.erro, 422);
        i.telefone = v.numero; i.telefone_mascara = mascarar(v.numero); i.telefone_origem = "corrigido_operador"; i.requer_confirmacao = false;
        evento(f, "telefone_corrigido", `novo: ${i.telefone_mascara}`, i);
      });
    },
    confirmarTelefoneItem(filaId, itemId, valor) { return this._naRevisao(filaId, itemId, (i) => { i.confirmado = !!valor; }); },
    removerItem(filaId, itemId) {
      return this._naRevisao(filaId, itemId, (i, f) => { i.status = "cancelado"; i.selecionado = false; i.pendencias = []; evento(f, "item_removido", null, i); });
    },
    descartarFila(filaId) {
      return this._alterar((E) => { const f = naRevisao(E, filaId); f.situacao = "cancelada"; f.concluida_em = agora();
        f.itens.forEach((i) => { i.status = "cancelado"; }); evento(f, "descartada", "Fila descartada antes da autorização; nada foi enviado."); return f; });
    },
    resumoRevisao(f) {
      const ativos = f.itens.filter((i) => i.status !== "cancelado"), sel = ativos.filter((i) => i.selecionado);
      return { total: ativos.length, selecionados: sel.length, enviaveis: sel.filter((i) => i.status === "preparado").length, com_pendencia: sel.filter((i) => i.pendencias.length).length,
        invalidos: ativos.filter((i) => i.pendencias.some((p) => p.codigo === "telefone")).length,
        duplicadas: ativos.filter((i) => i.pendencias.some((p) => p.codigo === "duplicada" || p.codigo === "ja_enviada")).length,
        removidos: f.itens.length - ativos.length };
    },

    /* ------------------------------------------------ autorização única */
    autorizarDisparo(filaId, statusConector) {
      return this._alterar((E) => {
        const f = naRevisao(E, filaId);
        if (!statusConector || !statusConector.pronto) throw new ErroCallback("A integração de envio não está disponível. Nada foi autorizado.");
        revisar(E, f);
        const ok = f.itens.filter((i) => i.selecionado && i.status === "preparado");
        if (!ok.length) throw new ErroCallback("Não há mensagem pronta para enviar: corrija as pendências ou selecione incidentes.", 422);
        for (const i of f.itens) {
          if (ok.includes(i)) i.assinatura = assinar(i);
          else if (i.status !== "cancelado") { i.erro = i.selecionado ? "Excluído na autorização: pendência não resolvida." : "Excluído na autorização: não selecionado."; i.status = "cancelado"; }
        }
        f.autorizacao = { em: agora(), operador: E.sessao.operador, polo: E.sessao.polo, estacao: E.sessao.estacao || null, whatsapp: statusConector.numero_rotulo || null, total: ok.length, conector_modo: statusConector.modo, resumo: N.sha256Hex(ok.map((i) => i.assinatura).join("")) };
        f.situacao = "autorizada";
        evento(f, "autorizada", `${ok.length} mensagem(ns) autorizada(s) por ${E.sessao.operador} (${statusConector.modo})`);
        return f;
      });
    },

    /* ------------------------------------------------ execução */
    /* Assume a fila e processa até acabar, pausar ou ser cancelada. Só um executor por vez (aba com posse válida).
       Em caso de falha ao gravar ANTES do envio, nada é enviado. */
    async processarFila(filaId, conector, { intervalo = INTERVALO_PADRAO, aoProgresso = () => {}, esperar = espera } = {}) {
      const executor = N.novoId(), expira = () => new Date(Date.now() + TEMPO_EXECUTOR).toISOString();
      await this._alterarInsistindo((E) => {
        const f = achar(E, filaId);
        if (!["autorizada", "pausada"].includes(f.situacao)) throw new ErroCallback("Esta fila não está em condição de envio.");
        if (vivo(f.executor)) throw new ErroCallback("Há um envio em curso nesta fila (outra aba ou mensagem em trânsito). Aguarde alguns segundos.");
        if (f.situacao === "pausada" || f.executor) evento(f, "retomada", `por ${E.sessao ? E.sessao.operador : "operador"}`);
        f.situacao = "autorizada"; f.executor = { id: executor, expira: expira() };
        for (const i of f.itens) if (i.status === "enviando") { i.status = "preparado"; evento(f, "recuperado", "Envio interrompido: será reconsultado com a mesma chave, sem duplicar.", i); }
      });
      aoProgresso();
      for (;;) {
        const passo = await this._alterarInsistindo((E) => {
          const f = achar(E, filaId);
          if (!f.executor || f.executor.id !== executor) return { fim: true };
          if (f.situacao !== "autorizada") { f.executor = null; return { fim: true }; }
          const i = f.itens.find((x) => x.status === "preparado" && x.assinatura);
          if (!i) { f.situacao = "concluida"; f.concluida_em = agora(); f.executor = null; evento(f, "concluida", null); return { fim: true }; }
          if (assinar(i) !== i.assinatura) { i.status = "falha"; i.erro = "Item alterado depois da autorização: envio bloqueado."; evento(f, "integridade", i.erro, i); return { pular: true }; }
          const ch = E.chamadas.find((x) => x.id === i.chamada_id), emDuvida = i.tentativas.some((t) => !t.fim); // em dúvida: reconsulta com a mesma chave
          if (ch && ch.estado === "callback_realizado" && !emDuvida) {
            i.status = "cancelado"; i.erro = "Callback já registrado depois da autorização: mensagem não enviada."; i.callback = { situacao: "ja_registrado", operador: null, em: agora() };
            evento(f, "callback_ja_registrado", i.erro, i); return { pular: true };
          }
          i.status = "enviando"; i.tentativas.push({ n: i.tentativas.length + 1, inicio: agora(), fim: null, resultado: null, codigo: null, detalhe: null, wamid: null });
          f.executor.expira = expira();
          return { envio: { item_id: i.id, chave: i.chave, telefone: i.telefone, texto: i.texto, modelo: i.modelo, editada: i.editada, incidente: i.incidente || i.call_id } };
        });
        aoProgresso();
        if (passo.fim) return;
        if (passo.pular) continue;
        let r;
        try { r = await conector.enviar(passo.envio); }
        catch (e) { r = { resultado: "sem_conexao", detalhe: e && e.message || "Sem resposta do gateway." }; }
        const pausar = await this._alterarInsistindo((E) => this._aplicarResultado(E, achar(E, filaId), passo.envio.item_id, r));
        aoProgresso();
        if (pausar) { await this._alterarInsistindo((E) => { const f = achar(E, filaId); if (f.executor && f.executor.id === executor) f.executor = null; }); aoProgresso(); return; }
        await esperar(intervalo);
      }
    },
    /* Mesmo registro do callback manual (Servico.registrar): assim totais, painel por operador e exportação contam sem regra nova.
       Já registrado (manual ou anterior): não conta de novo. O responsável é quem autorizou (a fila não atravessa turnos). */
    _registrarCallbackDoEnvio(E, f, i, momento) {
      const ch = E.chamadas.find((x) => x.id === i.chamada_id), operador = f.autorizacao.operador;
      if (!ch) return;
      if (ch.estado === "callback_realizado") { i.callback = { situacao: "ja_registrado", operador: null, em: momento }; evento(f, "callback_ja_registrado", "Enviada, mas o callback já estava registrado: não contou de novo.", i); return; }
      ch.tentativas.push({ meio: "whatsapp", resultado: "callback_realizado", momento, origem: "disparo", operador, fila_id: f.id });
      Object.assign(ch, { estado: "callback_realizado", meio_callback: "whatsapp", callback_origem: "disparo", callback_operador: operador, callback_em: momento, callback_telefone: i.telefone, atualizado_em: momento });
      this._anotarCallback(E, ch, { origem: "disparo", meio: "whatsapp", resultado: "confirmado", em: momento, whatsapp: f.autorizacao.whatsapp });
      i.callback = { situacao: "registrado", operador, em: momento };
      evento(f, "callback_registrado", `por ${operador}`, i);
    },
    /* Grava o resultado da tentativa. Devolve true se a fila deve pausar. */
    _aplicarResultado(E, f, itemId, r) {
      const i = itemDe(f, itemId), t = i.tentativas[i.tentativas.length - 1], res = r.resultado;
      Object.assign(t, { fim: agora(), resultado: res, codigo: r.codigo || null, detalhe: r.detalhe || null, wamid: r.wamid || null });
      if (res === "enviado") { i.status = "enviado"; i.wamid = r.wamid || null; i.enviado_em = t.fim; i.erro = null; i.simulado = !!r.simulado; if (!i.simulado && real(f)) this._registrarCallbackDoEnvio(E, f, i, t.fim); return false; }
      if (res === "incerto") { i.status = "falha"; i.incerto = true; i.erro = r.detalhe || "Resultado incerto."; return false; }
      if (res === "falha") { i.status = "falha"; i.erro = r.detalhe || "Recusado pela API."; return false; }
      // limite da API, configuração ou sem conexão: a mensagem não foi aceita; volta para a fila e pausa
      if (f.situacao === "cancelada") { i.status = "cancelado"; i.erro = "Cancelado pelo operador antes do envio."; return true; }
      i.status = "preparado"; i.erro = r.detalhe || null;
      if (f.situacao === "autorizada") f.situacao = "pausada";
      evento(f, res === "limite" ? "pausa_limite" : "pausa_conexao", r.detalhe || null, i);
      return true;
    },
    pausarFila(filaId) {
      return this._alterar((E) => { const f = achar(E, filaId); if (f.situacao !== "autorizada") throw new ErroCallback("A fila não está em execução."); f.situacao = "pausada"; evento(f, "pausada", `por ${f.operador}`); return f; });
    },
    cancelarRestante(filaId) {
      return this._alterar((E) => {
        const f = achar(E, filaId);
        if (!["autorizada", "pausada"].includes(f.situacao)) throw new ErroCallback("A fila não está em execução.");
        let n = 0;
        for (const i of f.itens) {
          if (i.status === "preparado" && i.assinatura) { i.status = "cancelado"; i.erro = "Cancelado pelo operador antes do envio."; n++; if (real(f)) this._anotarCancelado(E, f, i); }
          else if (i.status === "enviando" && !vivo(f.executor)) { i.status = "falha"; i.incerto = true; i.erro = "Envio interrompido: confirme no WhatsApp Manager se a mensagem chegou."; }
        }
        f.situacao = "cancelada"; f.concluida_em = agora(); evento(f, "cancelada", `${n} mensagem(ns) não enviada(s)`); return f;
      });
    },
    /* Nova autorização explícita. Mesma chave: o gateway nunca reenvia o que já foi aceito. */
    reprocessarFalhas(filaId) {
      return this._alterar((E) => {
        const f = achar(E, filaId);
        if (!["concluida", "pausada"].includes(f.situacao)) throw new ErroCallback("Só é possível reprocessar uma fila concluída ou pausada.");
        const lista = f.itens.filter((i) => i.status === "falha" && !i.incerto && i.assinatura);
        if (!lista.length) throw new ErroCallback("Não há falhas que possam ser reprocessadas.", 422);
        lista.forEach((i) => { i.status = "preparado"; i.erro = null; });
        f.situacao = "pausada"; f.concluida_em = null;
        const op = E.sessao ? E.sessao.operador : f.operador; f.reprocessos.push({ em: agora(), operador: op, total: lista.length });
        evento(f, "reprocessamento_autorizado", `${lista.length} falha(s) por ${op}`);
        return f;
      });
    },
    /* Resultado incerto: só o operador, depois de verificar que NÃO chegou, libera nova tentativa (com chave nova). */
    liberarIncerto(filaId, itemId) {
      return this._alterar((E) => {
        const f = achar(E, filaId), i = itemDe(f, itemId);
        if (!i.incerto) throw new ErroCallback("Este item não está com resultado incerto.");
        i.incerto = false; i.chave = N.novoId(); evento(f, "incerto_liberado", `por ${E.sessao ? E.sessao.operador : f.operador}: operador verificou que não foi entregue`, i);
        return i;
      });
    },
    painelDisparo(f) {
      const it = f.autorizacao ? f.itens.filter((i) => i.assinatura) : f.itens.filter((i) => i.status !== "cancelado" && i.selecionado);
      const c = (s) => it.filter((i) => i.status === s).length, enviado = c("enviado"), falha = c("falha"), cancelado = c("cancelado");
      const pendente = c("preparado") + c("enviando");
      return { total_selecionado: it.length, total_preparado: f.autorizacao ? it.length : c("preparado"), total_enviado: enviado, total_pendente: f.autorizacao ? pendente : 0, total_falha: falha,
        total_cancelado: cancelado, percentual: it.length ? Math.round(100 * (enviado + falha + cancelado) / it.length) : 0 };
    },
    /* Encerramento do lote (chamado por encerrarLote): recusa fila em execução, descarta rascunho, apaga dados pessoais. */
    _encerrarFilasDoLote(E, loteId) {
      const filas = E.disparos.filter((f) => f.lote_id === loteId);
      if (filas.some((f) => ["autorizada", "pausada", "atendimento"].includes(f.situacao))) throw new ErroCallback("Há uma fila de envio em andamento neste lote. Conclua ou cancele a fila antes de encerrar o lote.");
      for (const f of filas) {
        if (f.situacao === "revisao") { f.situacao = "cancelada"; f.concluida_em = agora(); f.itens.forEach((i) => { if (i.status !== "cancelado") { i.status = "cancelado"; i.erro = "Lote encerrado antes da autorização."; } }); evento(f, "descartada", "Lote encerrado antes da autorização."); }
        for (const i of f.itens) { i.telefone_mascara = mascarar(i.telefone); i.telefone = null; i.destinatario = null; i.texto = null; i.texto_modelo = null; i.pendencias = []; i.avisos = []; }
        f.dados_apagados = true;
      }
    },
    /* CSV de auditoria: sem nome, telefone completo ou texto da mensagem. */
    csvAuditoriaDisparos() {
      const cab = ["fila", "modalidade", "autorizada_em", "operador", "conector", "incidente", "ocorrencia", "telefone", "mensagem_sha256", "editada", "status", "tentativa", "inicio", "fim", "resultado", "codigo", "detalhe", "id_mensagem", "callback", "callback_operador", "callback_em"];
      const campo = (v) => { const t = N.seguroPlanilha(v == null ? "" : v); return /[;"\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
      const linhas = [cab.join(";")];
      for (const f of this.E.disparos) for (const i of f.itens) {
        const base = [f.id.slice(0, 8), f.modo, f.autorizacao ? f.autorizacao.em : "", f.autorizacao ? f.autorizacao.operador : f.operador, f.autorizacao ? f.autorizacao.conector_modo : "", i.incidente || i.call_id, i.ocorrencia, i.telefone_mascara || mascarar(i.telefone), i.hash_texto, i.editada ? "sim" : "nao", i.status];
        const ts = i.tentativas.length ? i.tentativas : [{}];
        for (const t of ts) linhas.push([...base, t.n, t.inicio, t.fim, t.resultado, t.codigo, t.detalhe || (i.tentativas.length ? "" : i.erro), t.wamid, i.callback ? i.callback.situacao : "", i.callback ? i.callback.operador : "", i.callback ? i.callback.em : ""].map(campo).join(";"));
      }
      return "﻿" + linhas.join("\r\n") + "\r\n";
    },
  });

  /* Conector do gateway (mesma origem). Sem gateway (ex.: aberto por file://) fica indisponível: preparar e revisar continuam funcionando. */
  class ConectorGateway {
    constructor(base = "") { this.base = base; }
    async status() {
      if (raiz.location && raiz.location.protocol === "file:") return { pronto: false, modo: "indisponivel", motivo: "A Central foi aberta direto do arquivo. Para disparar, abra pelo endereço do gateway (veja docs\\CENTRAL-DE-DISPAROS.txt)." };
      try {
        const r = await fetch(this.base + "/api/disparo/status", { cache: "no-store" });
        if (!r.ok) throw new Error("HTTP " + r.status);
        return await r.json();
      } catch (e) { return { pronto: false, modo: "indisponivel", motivo: "Gateway de envio não encontrado." }; }
    }
    async enviarFechamento(d) {
      if (raiz.location && raiz.location.protocol === "file:") return { resultado: "pendente", detalhe: "Sem gateway: abra a Central pelo endereço do gateway para enviar." };
      try {
        const r = await fetch(this.base + "/api/fechamento", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(d) });
        return (await r.json().catch(() => null)) || { resultado: "falha", detalhe: `Resposta inválida (HTTP ${r.status}).` };
      } catch (e) { return { resultado: "pendente", detalhe: "Gateway sem resposta." }; }
    }
    async enviar(envio) {
      const c = new AbortController(), t = setTimeout(() => c.abort(), TEMPO_RESPOSTA);
      try {
        const r = await fetch(this.base + "/api/disparo/enviar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(envio), signal: c.signal });
        const d = await r.json().catch(() => null);
        if (!d || !d.resultado) return { resultado: "sem_conexao", detalhe: `Resposta inválida do gateway (HTTP ${r.status}).` };
        return d;
      } catch (e) { return { resultado: "sem_conexao", detalhe: "Sem resposta do gateway." }; }
      finally { clearTimeout(t); }
    }
  }
  raiz.Disparos = { STATUS, ConectorGateway, mascarar };
})(typeof window !== "undefined" ? window : globalThis);
