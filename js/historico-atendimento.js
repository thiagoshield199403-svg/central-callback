/* Histórico permanente de atendimento, callback manual (aba CALLBACK WHATSAPP) e fechamento diário. Estende o Servico: mesmo estado,
   mesma gravação atômica.
   - E.historico_atendimento: registros por incidente, sobrevivem ao encerramento do lote e do dia. Nunca são apagados; reabrir só muda
     o status. É o que reconhece, por ID, um incidente já atendido em lote anterior. Fica só neste navegador.
   - E.callbacks_manuais: histórico da aba CALLBACK WHATSAPP. "Excluir" só tira da lista (excluido_em); E.auditoria_manual registra quem, quando e quantos.
   - Status de envio, status do callback e resolução são campos independentes. Marcar resolvido nunca gera callback.
   - O operador vem sempre do turno aberto (E.sessao), nunca de campo digitado neste módulo.
   - E.fechamentos: arquivo diário SÓ com agregados por operador, versionado; nunca substitui em silêncio. */
"use strict";
(function (raiz) {
  const N = raiz.Nucleo, Servico = raiz.Servico, Erro = Servico.ErroCallback;
  const agora = () => new Date().toISOString();
  const CAB_FECHAMENTO = ["data", "polo", "operador", "callbacks_realizados", "incidentes_resolvidos", "incidentes_cancelados", "versao"];
  const limpo = (t) => String(t || "").replace(/[;"\r\n]+/g, " ").trim();
  const sessaoAberta = (E) => (E.sessao && E.sessao.situacao === "aberta" ? E.sessao : null);
  function efetivoEm(E, chave) {
    for (let n = E.historico_atendimento.length - 1; n >= 0; n--) { const r = E.historico_atendimento[n]; if (r.tipo === "callback" && r.chave === chave && r.status === "realizado") return r; }
    return null;
  }
  const normalizarIncidente = (t) => {
    const v = String(t || "").trim().split(/\s+/).filter(Boolean).join(" ").toUpperCase();
    const m = /^(?:INC\s*)?(\d+)$/.exec(v);
    return m ? "INC " + m[1] : v;
  };
  const nomePolo = (p) => String(p || "SEM-POLO").normalize("NFKD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "SEM-POLO";

  Object.assign(Servico.prototype, {
    /* ------------------------------------------------ registros */
    _anotarCallback(E, ch, o) {
      const s = sessaoAberta(E); if (!s) return null;
      const chave = ch.chave || N.chaveIncidente(ch);
      const repetido = E.historico_atendimento.find((r) => r.tipo === "callback" && r.status === "realizado" && r.call_id && r.call_id === ch.call_id && r.sessao_id === s.id);
      if (repetido) return repetido; // a mesma CALL não gera dois registros no turno
      const manual = String(ch.call_id || "").startsWith("MANUAL:") ? null : E.historico_atendimento.find((r) => r.tipo === "callback" && r.status === "realizado" && r.chave === chave && r.sessao_id === s.id && String(r.call_id || "").startsWith("MANUAL:"));
      if (manual) { // callback manual feito antes de o incidente entrar no lote: é a mesma atuação; passa a contar só pela CALL
        const item = E.callbacks_manuais.find((x) => "MANUAL:" + x.id === manual.call_id);
        if (item) { delete E.marcas[item.marca]; item.marca = null; item.call_id = ch.call_id; }
        manual.call_id = ch.call_id;
        if (manual.resolvido_em) ch.resolvida_em = manual.resolvido_em;
        return manual;
      }
      const lote = E.lotes.find((l) => l.situacao === "aberto");
      const r = { id: N.novoId(), tipo: "callback", chave, incidente: ch.incidente || null, call_id: ch.call_id || null, operador: s.operador, polo: s.polo, estacao: s.estacao || null, sessao_id: s.id,
        data: s.data_operacional, em: o.em || agora(), meio: o.meio, origem: o.origem, resultado_envio: o.resultado || "nao_se_aplica", whatsapp: o.whatsapp || null, status: "realizado",
        lote_numero: lote ? lote.numero : null, reaberto_em: null, resolvido_em: null, resolvido_por: null, resolvido_data: null };
      E.historico_atendimento.push(r);
      return r;
    },
    _anotarCancelado(E, f, i) {
      const s = sessaoAberta(E); if (!s) return;
      E.historico_atendimento.push({ id: N.novoId(), tipo: "cancelado", chave: i.incidente ? "INC:" + i.incidente : "CALL:" + i.call_id, incidente: i.incidente || null, call_id: i.call_id || null,
        operador: (f.autorizacao && f.autorizacao.operador) || s.operador, polo: s.polo, sessao_id: s.id, data: s.data_operacional, em: agora(), fila_id: f.id });
    },
    _reabrirNoHistorico(E, ch) {
      for (const r of E.historico_atendimento) if (r.tipo === "callback" && r.status === "realizado" && r.call_id === ch.call_id && r.chave === N.chaveIncidente(ch)) {
        Object.assign(r, { status: "reaberto", reaberto_em: agora(), resolvido_em: null, resolvido_por: null, resolvido_data: null });
      }
    },
    _resolverNoHistorico(E, ch, resolvido) {
      const s = sessaoAberta(E); if (!s) return;
      const r = E.historico_atendimento.slice().reverse().find((x) => x.tipo === "callback" && x.status === "realizado" && x.call_id === ch.call_id);
      if (r) Object.assign(r, resolvido ? { resolvido_em: agora(), resolvido_por: s.operador, resolvido_data: s.data_operacional } : { resolvido_em: null, resolvido_por: null, resolvido_data: null });
    },

    /* ------------------------------------------------ consulta */
    atendimentoDoIncidente(chave) {
      if (this._indiceDe !== this.E) {
        this._indice = new Map();
        for (const r of this.E.historico_atendimento) if (r.tipo === "callback" && r.status === "realizado") this._indice.set(r.chave, r);
        this._indiceDe = this.E;
      }
      return this._indice.get(chave) || null;
    },
    historicoDoIncidente(chave) { return this.E.historico_atendimento.filter((r) => r.chave === chave).slice().reverse(); },
    _efetivoEm(E, chave) { return efetivoEm(E, chave); },

    /* ------------------------------------------------ CALLBACK WHATSAPP (manual) */
    textoManual({ incidente, modo, modelo, texto }) {
      const inc = normalizarIncidente(incidente);
      if (modo === "personalizada") return N.textoDoOperador(texto);
      const m = N.escolherModelo(null, modelo);
      return N.renderizar(m, { incidente: inc, call_id: inc, tipo_ocorrencia: null }, this.sessao() ? this.sessao().polo : "");
    },
    /* Prepara o envio pelo mecanismo individual existente (link do WhatsApp Web). Fica Pendente até o operador confirmar: só então conta. */
    abrirCallbackManual(d) {
      if (!this.sessao()) return Promise.reject(new Erro("Abra o turno antes de usar o Callback WhatsApp.", 422));
      const incidente = normalizarIncidente(d.incidente);
      if (!incidente) return Promise.reject(new Erro("Informe o número do incidente.", 422));
      const v = N.validarTelefoneManual(d.telefone);
      if (!v.ok) return Promise.reject(new Erro(v.erro, 422));
      if (d.modo !== "personalizada" && !d.modelo) return Promise.reject(new Erro("Selecione o tipo de ocorrência.", 422));
      let texto; try { texto = this.textoManual({ ...d, incidente }); } catch (e) { return Promise.reject(new Erro(e.message, 422)); }
      const m = d.modo === "personalizada" ? null : N.escolherModelo(null, d.modelo);
      return this._alterar((E) => {
        const s = sessaoAberta(E);
        const item = { id: N.novoId(), incidente, chave: "INC:" + incidente, telefone: v.numero, operador: s.operador, polo: s.polo, estacao: s.estacao || null, sessao_id: s.id, data: s.data_operacional, criado_em: agora(),
          modo: d.modo === "personalizada" ? "personalizada" : "padronizada", modelo: m ? m.codigo : null, tipo_mensagem: m ? m.nome : "Personalizada",
          status_envio: "pendente", enviado_em: null, callback: null, status_resolucao: "aguardando", resolvido_em: null, resolvido_por: null };
        E.callbacks_manuais.push(item);
        return { item, url: N.linkWhatsappWeb(v.numero, texto), exibir: v.exibir };
      });
    },
    /* Confirmação do operador: Enviado conta como callback (uma vez por incidente); Falha não conta. */
    confirmarEnvioManual(id, resultado) {
      if (!["enviado", "falha"].includes(resultado)) return Promise.reject(new Erro("Resultado desconhecido.", 422));
      return this._alterar((E) => {
        const s = sessaoAberta(E); if (!s) throw new Erro("Abra o turno para confirmar o envio.", 422);
        const i = E.callbacks_manuais.find((x) => x.id === id); if (!i) throw new Erro("Registro não encontrado.", 404);
        if (i.status_envio !== "pendente") throw new Erro("Este envio já foi confirmado.");
        i.status_envio = resultado; i.operador_confirmou = s.operador;
        if (resultado === "falha") return i;
        i.enviado_em = agora();
        if (efetivoEm(E, i.chave)) { i.callback = "ja_registrado"; return i; }
        const lote = E.lotes.find((l) => l.situacao === "aberto");
        const g = lote ? N.agruparIncidentes(E.chamadas.filter((c) => c.lote_id === lote.id)).find((x) => x.chave === i.chave) : null;
        if (g) {
          const ch = g.principal;
          if (ch.estado !== "callback_realizado") {
            ch.tentativas.push({ meio: "whatsapp", resultado: "callback_realizado", momento: i.enviado_em, origem: "callback_manual", operador: s.operador });
            Object.assign(ch, { estado: "callback_realizado", meio_callback: "whatsapp", callback_origem: "callback_manual", callback_operador: s.operador, callback_em: i.enviado_em, callback_telefone: i.telefone, atualizado_em: i.enviado_em });
          }
          i.call_id = ch.call_id;
          this._anotarCallback(E, ch, { origem: "callback_manual", meio: "whatsapp", resultado: "confirmado", em: i.enviado_em });
        } else {
          // Fora do lote: entra nos indicadores do dia pela mesma estrutura (E.marcas), uma vez por incidente.
          const marca = N.hmacSha256Hex(E.sessao.chave_marca, "MANUAL|" + i.incidente);
          if (!E.marcas[marca]) E.marcas[marca] = { estado: "callback_realizado", motivo: null, subtipo: null, tentativas: 1, lotes: 1, sem_sucesso: 0, servico: false, resolvida: false, inc: N.hmacSha256Hex(E.sessao.chave_marca, "INCIDENTE|" + i.incidente) };
          i.marca = marca;
          this._anotarCallback(E, { chave: i.chave, incidente: i.incidente, call_id: "MANUAL:" + i.id }, { origem: "callback_manual", meio: "whatsapp", resultado: "confirmado", em: i.enviado_em });
        }
        i.callback = "registrado";
        return i;
      });
    },
    /* Resultado operacional: não é envio e não gera callback. */
    marcarResolucaoManual(id, resolvido) {
      return this._alterar((E) => {
        const s = sessaoAberta(E); if (!s) throw new Erro("Abra o turno para registrar a resolução.", 422);
        const i = E.callbacks_manuais.find((x) => x.id === id); if (!i) throw new Erro("Registro não encontrado.", 404);
        if (i.status_envio !== "enviado") throw new Erro("Só é possível resolver depois do envio confirmado.");
        Object.assign(i, resolvido ? { status_resolucao: "resolvido", resolvido_em: agora(), resolvido_por: s.operador } : { status_resolucao: "aguardando", resolvido_em: null, resolvido_por: null });
        // "ja_registrado": o callback é de outro envio; a resolução vale para ele, sem gerar outro callback.
        const r = i.callback === "registrado" ? E.historico_atendimento.find((x) => x.tipo === "callback" && x.status === "realizado" && (x.call_id === i.call_id || x.call_id === "MANUAL:" + i.id))
          : i.callback === "ja_registrado" ? efetivoEm(E, i.chave) : null;
        if (r) {
          Object.assign(r, resolvido ? { resolvido_em: i.resolvido_em, resolvido_por: s.operador, resolvido_data: s.data_operacional } : { resolvido_em: null, resolvido_por: null, resolvido_data: null });
          const origem = E.callbacks_manuais.find((x) => "MANUAL:" + x.id === r.call_id);
          if (origem && origem.marca && E.marcas[origem.marca]) E.marcas[origem.marca].resolvida = !!resolvido;
          const ch = r.call_id ? E.chamadas.find((c) => c.call_id === r.call_id) : null;
          if (ch && ch.estado === "callback_realizado") ch.resolvida_em = resolvido ? i.resolvido_em : null;
        }
        return i;
      });
    },
    /* Só tira da lista. Envio pendente fica, senão o operador não conseguiria confirmar. */
    ocultarHistoricoManual(ids, confirmacao) {
      if (confirmacao !== "EXCLUIR") return Promise.reject(new Erro("Digite EXCLUIR para confirmar.", 422));
      return this._alterar((E) => {
        const s = sessaoAberta(E); if (!s) throw new Erro("Abra o turno para excluir o histórico.", 422);
        const pedidos = new Set(ids || []), alvo = E.callbacks_manuais.filter((i) => pedidos.has(i.id) && !i.excluido_em && i.status_envio !== "pendente");
        if (!alvo.length) throw new Erro("Não há registros que possam ser excluídos.", 422);
        const em = agora();
        alvo.forEach((i) => Object.assign(i, { excluido_em: em, excluido_por: s.operador }));
        E.auditoria_manual.push({ id: N.novoId(), tipo: "exclusao_visual_historico", em, operador: s.operador, polo: s.polo, sessao_id: s.id, quantidade: alvo.length, registros: alvo.map((i) => i.id) });
        return { quantidade: alvo.length };
      });
    },
    historicoManual(f = {}, { incluirOcultos = false } = {}) {
      const b = normalizarIncidente(f.incidente || "").replace(/^INC /, "");
      return this.E.callbacks_manuais.filter((i) => (incluirOcultos || !i.excluido_em) && (!b || i.incidente.includes(b)) && (!f.operador || i.operador === f.operador) && (!f.de || i.data >= f.de) && (!f.ate || i.data <= f.ate)
        && (!f.status || i.status_envio === f.status || i.status_resolucao === f.status)).slice().reverse();
    },
    indicadoresManuais(lista) {
      const env = lista.filter((i) => i.status_envio === "enviado");
      return { enviadas: env.length, resolvidos: env.filter((i) => i.status_resolucao === "resolvido").length, pendentes_resolucao: env.filter((i) => i.status_resolucao === "aguardando").length, falhas: lista.filter((i) => i.status_envio === "falha").length };
    },
    operadoresManuais() { return [...new Set(this.E.callbacks_manuais.map((i) => i.operador))].sort(); },

    /* ------------------------------------------------ fechamento diário: somente agregados */
    _consolidar(E, data) {
      const m = new Map(), g = (polo, op) => { const k = polo + "|" + op; if (!m.has(k)) m.set(k, { polo, operador: op, callbacks: 0, resolvidos: new Set(), cancelados: new Set() }); return m.get(k); };
      for (const r of E.historico_atendimento) {
        if (r.tipo === "callback" && r.status === "realizado") {
          if (r.data === data) g(r.polo, r.operador).callbacks++;
          if (r.resolvido_data === data) g(r.polo, r.resolvido_por).resolvidos.add(r.chave);
        } else if (r.tipo === "cancelado" && r.data === data) g(r.polo, r.operador).cancelados.add(r.chave);
      }
      return [...m.values()].map((x) => ({ polo: limpo(x.polo), operador: limpo(x.operador), callbacks: x.callbacks, resolvidos: x.resolvidos.size, cancelados: x.cancelados.size }))
        .sort((a, b) => a.polo.localeCompare(b.polo) || a.operador.localeCompare(b.operador));
    },
    consolidadoDia(data) { return this._consolidar(this.E, data); },
    _csvFechamento(data, linhas, versao) {
      const soma = (k) => linhas.reduce((t, l) => t + l[k], 0);
      const f = (polo, op, c, r, x) => [data, polo, op, c, r, x, versao].join(";");
      return "﻿" + [CAB_FECHAMENTO.join(";"), ...linhas.map((l) => f(l.polo, l.operador, l.callbacks, l.resolvidos, l.cancelados)),
        f("TOTAL", "TOTAL", soma("callbacks"), soma("resolvidos"), soma("cancelados"))].join("\r\n") + "\r\n";
    },
    /* Primeira versão: sem motivo. Nova versão: só com motivo (reprocessamento autorizado) e só se os dados mudaram. */
    gerarFechamento(data, { motivo = null, operador = null } = {}) {
      return this._alterar((E) => {
        const s = sessaoAberta(E);
        if (s && s.data_operacional === data) throw new Erro("Encerre o dia antes de gerar o fechamento.");
        const anteriores = E.fechamentos.filter((f) => f.data === data), ant = anteriores[anteriores.length - 1], linhas = this._consolidar(E, data);
        if (!linhas.length && !ant) throw new Erro("Não há registros neste dia.", 422);
        const assinatura = N.sha256Hex(JSON.stringify(linhas));
        if (ant && ant.assinatura === assinatura) throw new Erro("O fechamento deste dia já foi concluído e os dados não mudaram.");
        if (ant && !String(motivo || "").trim()) throw new Erro("Reprocessamento exige um motivo.", 422);
        const versao = ant ? ant.versao + 1 : 1, base = `fechamento_callbacks_${data}_${nomePolo(E.config.polo)}`, conteudo = this._csvFechamento(data, linhas, versao);
        const f = { id: N.novoId(), data, polo: E.config.polo, versao, nome: `${base}${versao > 1 ? "_v" + versao : ""}.csv`, conteudo, sha256: N.sha256Hex(conteudo), assinatura, gerado_em: agora(),
          gerado_por: (s && s.operador) || operador || E.config.operador || "—", motivo: motivo ? String(motivo).trim().slice(0, 300) : null, substitui: ant ? ant.nome : null, status: "pendente", drive_id: null, enviado_em: null, erro: null };
        E.fechamentos.push(f);
        return f;
      });
    },
    diasSemFechamento() {
      const s = this.sessao(), dias = new Set(this.E.historico_atendimento.map((r) => r.data)), feitos = new Set(this.E.fechamentos.map((f) => f.data));
      return [...dias].filter((d) => !feitos.has(d) && !(s && s.data_operacional === d)).sort();
    },
    fechamentoDesatualizado(data) {
      const l = this.E.fechamentos.filter((f) => f.data === data).pop();
      return !!l && l.assinatura !== N.sha256Hex(JSON.stringify(this._consolidar(this.E, data)));
    },
    /* Só conta como enviado o que o gateway confirmou lendo o arquivo de volta do Drive. Cada tentativa fica no histórico do próprio fechamento. */
    async enviarFechamentosPendentes(conector) {
      const r = { enviados: 0, pendentes: 0 };
      for (const f of this.E.fechamentos.filter((x) => x.status !== "enviado")) {
        const resp = await conector.enviarFechamento({ nome: f.nome, data: f.data, versao: f.versao, conteudo: f.conteudo, sha256: f.sha256 });
        const ok = resp.resultado === "enviado" && resp.confirmado === true && !!resp.arquivo_id;
        await this._alterar((E) => {
          const x = E.fechamentos.find((y) => y.id === f.id);
          if (!x) return;
          const erro = ok ? null : resp.detalhe || "O Google Drive não confirmou o envio.", status = ok ? "enviado" : resp.resultado === "falha" ? "falha" : "pendente";
          if (ok) Object.assign(x, { status, drive_id: resp.arquivo_id, enviado_em: agora(), erro, caminho_drive: resp.caminho || null, bi: resp.bi || null });
          else Object.assign(x, { status, erro });
          x.historico_envio = [...(x.historico_envio || []), { em: agora(), resultado: status, detalhe: erro, reaproveitado: !!resp.reaproveitado, bi: resp.bi || null }].slice(-30);
        });
        if (ok) r.enviados++; else r.pendentes++;
      }
      return r;
    },
    listaFechamentos() { return this.E.fechamentos.slice().reverse().map((f) => ({ ...f, conteudo: undefined, desatualizado: this.fechamentoDesatualizado(f.data) && this.E.fechamentos.filter((x) => x.data === f.data).pop().id === f.id })); },
    fechamento(id) { return this.E.fechamentos.find((f) => f.id === id) || null; },
    ultimoFechamentoDoDia(data) { return this.E.fechamentos.filter((f) => f.data === data).pop() || null; },
    ultimosFechamentos(n = 10) { return this.E.fechamentos.slice(-n).reverse().map(({ conteudo, ...f }) => f); },
  });
})(typeof window !== "undefined" ? window : globalThis);
