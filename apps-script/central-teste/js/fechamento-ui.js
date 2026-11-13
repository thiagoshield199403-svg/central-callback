/* Fechamento diário: gera os arquivos agregados e envia ao Drive pelo gateway. Sem gateway, ficam pendentes na Central. */
"use strict";
(function () {
  const N = window.Nucleo, $ = (s) => document.querySelector(s);
  const UI = () => window.CentralUI, srv = () => UI().servico, esc = (v) => UI().esc(v), toast = (m, e) => UI().toastErro(m, !!e);
  const conector = new window.ConectorAppsScript();
  const horaBR = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR") : "—");
  const dataBR = (d) => d.split("-").reverse().join("/");
  const ST = { enviado: ["Salvo no Drive", "e-callback_realizado"], pendente: ["Pendente", "e-pendente"], falha: ["Falha", "e-contato_invalido"] };
  let aberto = false, filaEnvio = Promise.resolve();

  /* Um envio por vez nesta aba: o seguinte só começa depois e já encontra o anterior marcado como enviado. */
  function enviarPendentes() {
    const p = filaEnvio.then(async () => {
      try { const r = await srv().enviarFechamentosPendentes(conector); UI().avisar(); if (aberto) desenhar(); return r; }
      catch (e) { return null; }
    });
    filaEnvio = p;
    return p;
  }
  /* Abertura da página e encerramento do dia: gera o que falta e tenta enviar. */
  async function automatico() {
    for (const d of srv().diasSemFechamento()) { try { await srv().gerarFechamento(d); } catch (e) { /* sem registros */ } }
    await enviarPendentes();
  }
  async function aposEncerrarDia(data, operador) {
    let erro = null;
    if (srv().fechamentoDesatualizado(data)) { try { await srv().gerarFechamento(data, { motivo: `Novo turno encerrado por ${operador}`, operador }); } catch (e) { erro = e.message; toast(e.message, true); } }
    await automatico();
    return { fechamento: srv().ultimoFechamentoDoDia(data), erro };
  }
  function aguarde(texto) {
    $("#modal-caixa").className = "modal-caixa"; delete $("#modal-caixa").dataset.livre;
    $("#modal-caixa").innerHTML = `<h2>Fechamento diário</h2><p role="status">${esc(texto)}</p>`;
    $("#modal").classList.remove("oculto");
  }
  /* Só informa "concluído" com o envio confirmado pelo gateway. Fora disso, avisa e mantém o arquivo para nova tentativa. */
  async function mostrarResultado(data) {
    const f = srv().ultimoFechamentoDoDia(data);
    if (f.status === "enviado") {
      await UI().escolher("Fechamento concluído", `<p><b>${esc(f.nome)}</b> foi salvo no Google Drive e conferido por leitura do arquivo.</p>
        <p class="mini">Pasta: <span class="caminho">${esc(f.caminho_drive || "FECHAMENTOS")}</span>.</p>`, [{ valor: "ok", rotulo: "OK", classe: "acao" }]);
      return "enviado";
    }
    const v = await UI().escolher("Fechamento ainda NÃO sincronizado", `<p>O turno foi encerrado, mas <b>${esc(f.nome)}</b> ainda não está no Google Drive.</p><p>${esc(f.erro || "O Google Drive não confirmou o envio.")}</p>
      <p class="mini">O arquivo continua guardado na Central (botão Fechamento). Uma nova tentativa é feita sempre que a Central é aberta.</p>`,
      [{ valor: "fechar", rotulo: "Fechar" }, { valor: "tentar", rotulo: "Tentar novamente", classe: "acao" }]);
    if (v !== "tentar") return "pendente";
    aguarde("Enviando o fechamento ao Google Drive…");
    await enviarPendentes(); await UI().recarregar();
    return mostrarResultado(data);
  }
  /* ENCERRAR O DIA: gera, envia pelo gateway e só então mostra o resultado. Não pede pasta local. */
  async function concluirEncerramento(data, operador) {
    aguarde("Enviando o fechamento ao Google Drive…");
    const { fechamento, erro } = await aposEncerrarDia(data, operador);
    await UI().recarregar();
    if (fechamento) return mostrarResultado(data);
    $("#modal").classList.add("oculto");
    if (!erro) toast("Turno encerrado. Não há callbacks registrados neste dia: nenhum fechamento foi enviado ao Drive.");
    return "sem_registros";
  }
  /* Histórico das operações, na seção "Lotes do dia e exportações". */
  function historicoHtml() {
    const l = srv().ultimosFechamentos();
    if (!l.length) return "";
    return "<h3>Fechamentos no Google Drive</h3><ul class='lista'>" + l.map((f) => {
      const n = (f.historico_envio || []).length, tent = n > 1 ? ` · ${n} tentativas` : "";
      const situacao = f.status === "enviado" ? `salvo em ${esc(f.caminho_drive || "FECHAMENTOS")} em ${horaBR(f.enviado_em)}` : `<b>ainda não sincronizado</b>${f.erro ? " · " + esc(f.erro) : ""}`;
      return `<li>${esc(f.nome)} · v${f.versao}<div class="mini">${situacao}${tent}</div></li>`;
    }).join("") + "</ul>";
  }
  function baixar(f) {
    const url = URL.createObjectURL(new Blob([f.conteudo], { type: "text/csv;charset=utf-8" })), a = document.createElement("a");
    a.href = url; a.download = f.nome; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  function desenhar() {
    const l = srv().listaFechamentos();
    $("#modal-caixa").className = "modal-caixa larga"; $("#modal-caixa").dataset.livre = "1";
    $("#modal-caixa").innerHTML = `<button type="button" class="fechar" id="fe-fechar">Fechar</button><h2>Fechamento diário</h2>
      <p class="mini">O arquivo é gerado ao encerrar o dia e contém só totais por operador, sem nenhum dado de cliente. Uma nova versão nunca substitui a anterior.</p>
      <div class="botoes"><button type="button" class="contorno" id="fe-tentar">Enviar pendentes agora</button></div>
      <div class="tabela-rolagem rolagem-curta"><table><thead><tr><th>Dia</th><th>Arquivo</th><th>Versão</th><th>Gerado</th><th>Destino</th><th></th></tr></thead><tbody>
      ${l.map((f) => `<tr data-f="${esc(f.id)}" data-dia="${esc(f.data)}"><td>${dataBR(f.data)}</td><td>${esc(f.nome)}${f.motivo ? `<div class="mini">${esc(f.motivo)}</div>` : ""}</td><td class="c-num">${f.versao}</td><td class="mini">${esc(f.gerado_por)} · ${horaBR(f.gerado_em)}</td>
        <td><span class="etq ${ST[f.status][1]}">${ST[f.status][0]}</span>${f.erro ? `<div class="mini">${esc(f.erro)}</div>` : ""}${(f.historico_envio || []).length ? `<div class="mini">Última tentativa: ${horaBR(f.historico_envio[f.historico_envio.length - 1].em)} · ${f.historico_envio.length} no total</div>` : ""}</td>
        <td class="c-acao-fila"><button type="button" class="mini-botao" data-baixar-f>Baixar</button>${f.desatualizado ? ' <button type="button" class="mini-botao verde" data-reprocessar>Reprocessar</button>' : ""}</td></tr>`).join("") || '<tr><td colspan="6" class="mini">Nenhum fechamento gerado ainda. Ele é criado ao encerrar o dia.</td></tr>'}
      </tbody></table></div><div id="fe-reproc"></div>`;
    $("#modal").classList.remove("oculto");
    $("#fe-fechar").onclick = () => { aberto = false; $("#modal").classList.add("oculto"); };
    $("#fe-tentar").onclick = async () => { const r = await enviarPendentes(); toast(r ? `${r.enviados} enviado(s) · ${r.pendentes} pendente(s).` : "Gateway indisponível.", !r); };
    $("#modal-caixa").querySelectorAll("[data-baixar-f]").forEach((b) => { b.onclick = () => baixar(srv().fechamento(b.closest("tr").dataset.f)); });
    $("#modal-caixa").querySelectorAll("[data-reprocessar]").forEach((b) => { b.onclick = () => {
      const dia = b.closest("tr").dataset.dia;
      $("#fe-reproc").innerHTML = `<div class="linha-form"><label class="flex1">Motivo do reprocessamento de ${dataBR(dia)} <input id="fe-motivo" maxlength="300"></label><button type="button" class="acao" id="fe-confirmar">Gerar nova versão</button></div>`;
      $("#fe-confirmar").onclick = async () => {
        try { await srv().gerarFechamento(dia, { motivo: $("#fe-motivo").value }); toast("Nova versão gerada."); await enviarPendentes(); desenhar(); } catch (e) { toast(e.message, true); }
      };
    }; });
  }
  $("#btn-fechamento").onclick = () => { aberto = true; desenhar(); };
  window.CentralFechamento = { automatico, aposEncerrarDia, concluirEncerramento, historicoHtml };
})();
