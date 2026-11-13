/* Fechamento diário: gera os arquivos agregados (só totais por operador) e os exporta para a PASTA DE REDE (destino principal,
   js/exportacao-rede.js). O Google Drive passou a ser OPCIONAL e manual (Fechamento > Enviar ao Google Drive): o encerramento do
   dia e a abertura da Central não chamam mais o Drive. O histórico do Drive dos fechamentos anteriores continua visível. */
"use strict";
(function () {
  const N = window.Nucleo, $ = (s) => document.querySelector(s);
  const UI = () => window.CentralUI, srv = () => UI().servico, esc = (v) => UI().esc(v), toast = (m, e) => UI().toastErro(m, !!e);
  const R = () => window.CentralExportacaoRede;
  const conector = new window.Disparos.ConectorGateway();
  const horaBR = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR") : "—");
  const dataBR = (d) => d.split("-").reverse().join("/");
  const ST = { enviado: ["Salvo no Drive", "e-callback_realizado"], pendente: ["Não enviado", "e-sem_telefone"], falha: ["Falha", "e-contato_invalido"] };
  let aberto = false, filaEnvio = Promise.resolve();

  /* GOOGLE DRIVE (opcional, só por clique). Um envio por vez nesta aba: o seguinte já encontra o anterior marcado como enviado. */
  function enviarAoDrive() {
    const p = filaEnvio.then(async () => {
      try { const r = await srv().enviarFechamentosPendentes(conector); UI().avisar(); if (aberto) desenhar(); return r; }
      catch (e) { return null; }
    });
    filaEnvio = p;
    return p;
  }
  /* Gera os fechamentos que faltam (dias anteriores sem fechamento). Não exporta nem envia nada. Devolve os ids gerados. */
  async function gerarFaltantes() {
    const ids = [];
    for (const d of srv().diasSemFechamento()) { try { ids.push((await srv().gerarFechamento(d)).id); } catch (e) { /* sem registros */ } }
    return ids;
  }
  /* Abertura da página: só gera o que falta (sem Drive e sem pedir pasta). */
  async function automatico() { await gerarFaltantes(); }
  async function aposEncerrarDia(data, operador) {
    let erro = null; const ids = [];
    if (srv().fechamentoDesatualizado(data)) { try { ids.push((await srv().gerarFechamento(data, { motivo: `Novo turno encerrado por ${operador}`, operador })).id); } catch (e) { erro = e.message; toast(e.message, true); } }
    ids.push(...(await gerarFaltantes()));
    const fechamento = srv().ultimoFechamentoDoDia(data);
    // Também as versões anteriores deste dia ainda não exportadas (ex.: encerramento anterior com a pasta indisponível).
    for (const f of srv().E.fechamentos) if (f.data === data && !ids.includes(f.id)) ids.push(f.id);
    return { fechamento, erro, ids };
  }
  function aguarde(texto) {
    $("#modal-caixa").className = "modal-caixa"; delete $("#modal-caixa").dataset.livre;
    $("#modal-caixa").innerHTML = `<h2>Fechamento diário</h2><p role="status">${esc(texto)}</p>`;
    $("#modal").classList.remove("oculto");
  }
  const caminhoHtml = () => `<span class="caminho">${esc(R().CAMINHO)}</span>`;
  const naoExportado = (ids) => ids.map((id) => srv().fechamento(id)).filter((f) => f && !(f.exportacao_rede && f.exportacao_rede.status === "exportado"));
  const guardado = `<p class="mini">O fechamento foi realizado e está guardado na Central (botão Fechamento), com a exportação <b>pendente</b>. Nenhum dado foi apagado.</p>`;
  /* Resultado do encerramento. "Concluído" só aparece depois da gravação conferida por leitura do arquivo na pasta. */
  async function exportarComResultado(ids) {
    const pend = naoExportado(ids);
    if (!pend.length) {
      const f = srv().fechamento(ids[ids.length - 1]);
      await UI().escolher("Fechamento concluído", `<p><b>${esc(f.exportacao_rede.arquivo)}</b> já está na pasta de rede ${caminhoHtml()}.</p>`, [{ valor: "ok", rotulo: "OK", classe: "acao" }]);
      return "exportado";
    }
    const s = await R().situacao();
    if (s.estado === "sem_suporte" || s.estado === "nao_configurada") {
      const pode = s.estado === "nao_configurada";
      const v = await UI().escolher("Fechamento realizado, mas NÃO exportado", `<p>${pode ? `A pasta de exportação ainda não foi configurada neste navegador. Clique em <b>Configurar pasta agora</b> e selecione ${caminhoHtml()}.` : esc(s.detalhe)}</p>${guardado}`,
        [{ valor: "depois", rotulo: "Depois" }, ...(pode ? [{ valor: "configurar", rotulo: "Configurar pasta agora", classe: "acao" }] : [])]);
      if (v !== "configurar") return "pendente";
      const c = await R().configurar();
      if (c.erro) { toast(c.erro, true); return exportarComResultado(ids); }
    }
    aguarde("Gravando o fechamento na pasta de rede…");
    const r = await R().exportar(pend.map((f) => f.id));
    await UI().recarregar();
    const ruins = (r.itens || []).filter((i) => i.resultado !== "exportado" && i.resultado !== "ja_estava_na_pasta");
    if (!r.erro && !ruins.length) {
      await UI().escolher("Fechamento concluído", `<p>O fechamento foi gravado na pasta de rede ${caminhoHtml()} e conferido por leitura do arquivo:</p>
        <ul class="lista">${r.itens.map((i) => `<li><b>${esc(i.arquivo)}</b>${i.resultado === "ja_estava_na_pasta" ? " (já estava na pasta, idêntico)" : ""}</li>`).join("")}</ul>`, [{ valor: "ok", rotulo: "OK", classe: "acao" }]);
      return "exportado";
    }
    const permissao = r.estado === "permissao";
    const motivo = r.erro || ruins.map((i) => i.detalhe).join(" ");
    const v = await UI().escolher("Fechamento realizado, mas NÃO exportado", `<p>${permissao ? "O navegador precisa renovar a autorização para gravar na pasta de rede. Clique em <b>Autorizar e exportar</b>." : esc(motivo)}</p>${guardado}`,
      [{ valor: "depois", rotulo: "Depois" }, permissao ? { valor: "tentar", rotulo: "Autorizar e exportar", classe: "acao" } : { valor: "tentar", rotulo: "Tentar novamente", classe: "acao" }]);
    return v === "tentar" ? exportarComResultado(ids) : "pendente";
  }
  /* ENCERRAR O DIA: gera o fechamento, guarda na Central e exporta para a pasta de rede. Não chama o Google Drive. */
  async function concluirEncerramento(data, operador) {
    aguarde("Gerando o fechamento…");
    const { fechamento, erro, ids } = await aposEncerrarDia(data, operador);
    await UI().recarregar();
    if (fechamento) return exportarComResultado(ids);
    $("#modal").classList.add("oculto");
    if (!erro) toast("Turno encerrado. Não há callbacks registrados neste dia: nenhum fechamento foi gerado.");
    return "sem_registros";
  }
  /* Histórico das operações, na seção "Lotes do dia e exportações" (inclui o Drive dos fechamentos antigos). */
  function historicoHtml() {
    const l = srv().ultimosFechamentos();
    if (!l.length) return "";
    return "<h3>Fechamentos</h3><ul class='lista'>" + l.map((f) => {
      const x = f.exportacao_rede, rede = x && x.status === "exportado" ? `pasta de rede: ${esc(x.arquivo)} em ${horaBR(x.em)}` : f.status === "enviado" && !x ? "fechamento anterior à pasta de rede" : `<b>pasta de rede: exportação pendente</b>${x && x.detalhe ? " · " + esc(x.detalhe) : ""}`;
      const drive = f.status === "enviado" ? ` · Google Drive: salvo em ${esc(f.caminho_drive || "FECHAMENTOS")} em ${horaBR(f.enviado_em)}` : "";
      return `<li>${esc(f.nome)} · v${f.versao}<div class="mini">${rede}${drive}</div></li>`;
    }).join("") + "</ul>";
  }
  function baixar(f) {
    const url = URL.createObjectURL(new Blob([f.conteudo], { type: "text/csv;charset=utf-8" })), a = document.createElement("a");
    a.href = url; a.download = f.nome; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  function desenhar() {
    const l = srv().listaFechamentos(), R = window.CentralExportacaoRede; // exportação para a pasta de rede (js/exportacao-rede.js)
    $("#modal-caixa").className = "modal-caixa larga"; $("#modal-caixa").dataset.livre = "1";
    $("#modal-caixa").innerHTML = `<button type="button" class="fechar" id="fe-fechar">Fechar</button><h2>Fechamento diário</h2>
      <p class="mini">O arquivo é gerado ao encerrar o dia e exportado para a pasta de rede. Contém só totais por operador, sem nenhum dado de cliente. Uma nova versão nunca substitui a anterior.</p>
      ${R ? R.blocoHtml() : ""}
      <div class="tabela-rolagem rolagem-curta"><table><thead><tr><th>Dia</th><th>Arquivo</th><th>Versão</th><th>Gerado</th><th>Google Drive</th>${R ? "<th>Pasta de rede</th>" : ""}<th></th></tr></thead><tbody>
      ${l.map((f) => `<tr data-f="${esc(f.id)}" data-dia="${esc(f.data)}"><td>${dataBR(f.data)}</td><td>${esc(f.nome)}${f.motivo ? `<div class="mini">${esc(f.motivo)}</div>` : ""}</td><td class="c-num">${f.versao}</td><td class="mini">${esc(f.gerado_por)} · ${horaBR(f.gerado_em)}</td>
        <td><span class="etq ${ST[f.status][1]}">${ST[f.status][0]}</span>${f.erro ? `<div class="mini">${esc(f.erro)}</div>` : ""}${(f.historico_envio || []).length ? `<div class="mini">Última tentativa: ${horaBR(f.historico_envio[f.historico_envio.length - 1].em)} · ${f.historico_envio.length} no total</div>` : ""}</td>${R ? `<td class="c-rede">${R.celula(f)}</td>` : ""}
        <td class="c-acao-fila"><button type="button" class="mini-botao" data-baixar-f>Baixar</button>${f.desatualizado ? ' <button type="button" class="mini-botao verde" data-reprocessar>Reprocessar</button>' : ""}</td></tr>`).join("") || `<tr><td colspan="${R ? 7 : 6}" class="mini">Nenhum fechamento gerado ainda. Ele é criado ao encerrar o dia.</td></tr>`}
      </tbody></table></div><div id="fe-reproc"></div>
      <div class="botoes"><button type="button" class="contorno" id="fe-tentar" title="Opcional: envia ao Google Drive (pelo gateway) os fechamentos ainda não enviados">Enviar ao Google Drive (opcional)</button></div>`;
    $("#modal").classList.remove("oculto");
    $("#fe-fechar").onclick = () => { aberto = false; $("#modal").classList.add("oculto"); };
    $("#fe-tentar").onclick = async () => { const r = await enviarAoDrive(); toast(r ? `Google Drive: ${r.enviados} enviado(s) · ${r.pendentes} não enviado(s).` : "Gateway do Google Drive indisponível.", !r); };
    if (R) R.ligar($("#modal-caixa"), async () => { if (aberto) desenhar(); });
    $("#modal-caixa").querySelectorAll("[data-baixar-f]").forEach((b) => { b.onclick = () => baixar(srv().fechamento(b.closest("tr").dataset.f)); });
    $("#modal-caixa").querySelectorAll("[data-reprocessar]").forEach((b) => { b.onclick = () => {
      const dia = b.closest("tr").dataset.dia;
      $("#fe-reproc").innerHTML = `<div class="linha-form"><label class="flex1">Motivo do reprocessamento de ${dataBR(dia)} <input id="fe-motivo" maxlength="300"></label><button type="button" class="acao" id="fe-confirmar">Gerar nova versão</button></div>`;
      $("#fe-confirmar").onclick = async () => {
        try { await srv().gerarFechamento(dia, { motivo: $("#fe-motivo").value }); toast("Nova versão gerada. Exporte-a para a pasta de rede."); desenhar(); } catch (e) { toast(e.message, true); }
      };
    }; });
  }
  $("#btn-fechamento").onclick = () => { aberto = true; desenhar(); };
  window.CentralFechamento = { automatico, aposEncerrarDia, concluirEncerramento, historicoHtml, enviarAoDrive };
})();
