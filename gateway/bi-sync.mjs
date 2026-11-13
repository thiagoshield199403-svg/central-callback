/* Sincronização dos fechamentos (o nome do arquivo vem do painel BI, já retirado; o fechamento ainda usa esta base para a cópia local
   e para recusar arquivo de mesmo nome com conteúdo diferente): detecta fechamentos novos e atualiza a base agregada (arquivo JSON, gravação atômica).
   Por dia, polo e computador vale só a MAIOR versão; computadores diferentes se somam. Se o Drive falhar, a base continua servindo os últimos dados e o estado fica "pendente". */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { analisarFechamento } from "./fechamento-csv.mjs";

export function criarSync({ drive, dados, intervalo = 300000 }) {
  const ARQ = join(dados, "bi-base.json"), LOCAL = join(dados, "fechamentos");
  mkdirSync(LOCAL, { recursive: true });
  let base = { arquivos: {}, rejeitados: {} };
  if (existsSync(ARQ)) { try { base = JSON.parse(readFileSync(ARQ, "utf8")); } catch { /* base corrompida: reconstrói na sincronização */ } }
  const st = { situacao: drive.configurado ? "aguardando" : "nao_configurado", ultima_sincronizacao: base.ultima_sincronizacao || null, ultima_tentativa: null, detalhe: null, fonte: drive.configurado ? "drive" : "local" };
  let atual = null, repetir = null, timer = null;

  function salvar() { const t = ARQ + ".tmp"; writeFileSync(t, JSON.stringify(base)); renameSync(t, ARQ); }
  const fonteLocal = () => readdirSync(LOCAL).filter((n) => n.endsWith(".csv")).map((nome) => ({ id: nome, nome, revisao: String(statSync(join(LOCAL, nome)).mtimeMs), ler: async () => readFileSync(join(LOCAL, nome), "utf8") }));
  async function incorporar(lista, ler) {
    let novos = 0;
    for (const a of lista) {
      const atual = base.arquivos[a.nome];
      if ((atual && atual.revisao === a.revisao) || (base.rejeitados[a.nome] && base.rejeitados[a.nome].revisao === a.revisao)) continue;
      try { const p = analisarFechamento(a.nome, await ler(a)); base.arquivos[a.nome] = { ...p, revisao: a.revisao, origem: a.id }; delete base.rejeitados[a.nome]; novos++; }
      catch (e) { if (e.status !== undefined) throw e; base.rejeitados[a.nome] = { revisao: a.revisao, motivo: e.message }; }
    }
    return novos;
  }
  async function rodar() {
    st.ultima_tentativa = new Date().toISOString();
    try {
      if (drive.configurado) { await drive.garantirEstrutura(); const lista = await drive.listarFechamentos(); await incorporar(lista, (a) => drive.baixar(a.id)); st.situacao = "ok"; st.detalhe = null; st.fonte = "drive"; }
      else { await incorporar(fonteLocal(), (a) => a.ler()); st.situacao = "nao_configurado"; st.detalhe = "Google Drive ainda não configurado: mostrando os fechamentos guardados neste computador."; st.fonte = "local"; }
      st.ultima_sincronizacao = base.ultima_sincronizacao = new Date().toISOString();
      salvar();
    } catch (e) { st.situacao = "pendente"; st.detalhe = `Atualização pendente: ${e.message}`; }
    return st;
  }
  /* Pedido durante uma sincronização em curso gera mais uma rodada depois dela: um arquivo recém-enviado nunca fica de fora. */
  function sincronizar() {
    if (!atual) { atual = rodar().finally(() => { atual = null; }); return atual; }
    if (!repetir) repetir = atual.then(() => { repetir = null; return sincronizar(); });
    return repetir;
  }
  function linhas() {
    const melhor = new Map();
    for (const a of Object.values(base.arquivos)) { const k = a.data + "|" + a.polo_arquivo + "|" + (a.computador || ""); if (!melhor.has(k) || melhor.get(k).versao < a.versao) melhor.set(k, a); }
    return [...melhor.values()].flatMap((a) => a.linhas).sort((x, y) => x.data.localeCompare(y.data));
  }
  return {
    sincronizar, linhas,
    incluido: (nome) => !!base.arquivos[nome],
    estado: () => ({ ...st, arquivos: Object.keys(base.arquivos).length, rejeitados: Object.keys(base.rejeitados).length, intervalo_min: Math.round(intervalo / 60000) }),
    iniciar() { sincronizar(); timer = setInterval(sincronizar, intervalo); timer.unref(); },
    guardarLocal(nome, conteudo) { const alvo = join(LOCAL, nome); if (existsSync(alvo)) return readFileSync(alvo, "utf8") === conteudo ? "igual" : "diferente"; writeFileSync(alvo, conteudo); return "novo"; },
  };
}
