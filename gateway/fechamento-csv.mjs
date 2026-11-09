/* Validação do arquivo de fechamento. Barreira de privacidade: só passa o formato agregado exato; qualquer outra coluna ou valor é recusado. */
export const CABECALHO = "data;polo;operador;callbacks_realizados;incidentes_resolvidos;incidentes_cancelados;versao";
export const RE_NOME = /^fechamento_callbacks_(\d{4}-\d{2}-\d{2})_([A-Z0-9-]{1,80})(?:_PC([A-F0-9]{8}))?(?:_v(\d{1,4}))?\.csv$/;
const RE_POLO = /^[\p{L}0-9 ._-]{1,80}$/u, RE_OPERADOR = /^[\p{L}0-9 ._-]{1,40}$/u, RE_INT = /^\d{1,7}$/;

export function analisarFechamento(nome, conteudo) {
  const n = RE_NOME.exec(String(nome || ""));
  if (!n) throw new Error("Nome de arquivo fora do padrão.");
  const data = n[1], versaoNome = Number(n[4] || 1);
  const linhas = String(conteudo || "").replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.length);
  if (linhas[0] !== CABECALHO) throw new Error("Colunas fora do padrão agregado.");
  if (linhas.length < 2 || linhas.length > 502) throw new Error("Quantidade de linhas inválida.");
  const saida = []; let total = null;
  for (const l of linhas.slice(1)) {
    const c = l.split(";");
    if (c.length !== 7) throw new Error("Linha fora do padrão.");
    const [d, polo, operador, cb, res, can, ver] = c;
    if (d !== data) throw new Error("Data da linha difere do arquivo.");
    if (!RE_POLO.test(polo) || !RE_OPERADOR.test(operador) || /\d{8,}/.test(operador) || /\d{8,}/.test(polo)) throw new Error("Polo ou operador inválido.");
    if (![cb, res, can, ver].every((x) => RE_INT.test(x))) throw new Error("Valor não numérico.");
    if (Number(ver) !== versaoNome) throw new Error("Versão difere do nome do arquivo.");
    const reg = { data, polo, operador, callbacks: Number(cb), resolvidos: Number(res), cancelados: Number(can) };
    if (operador === "TOTAL") total = reg; else saida.push(reg);
  }
  if (!total) throw new Error("Linha TOTAL ausente.");
  for (const k of ["callbacks", "resolvidos", "cancelados"]) if (saida.reduce((t, r) => t + r[k], 0) !== total[k]) throw new Error("Total não confere.");
  return { data, polo_arquivo: n[2], computador: n[3] || "", versao: versaoNome, linhas: saida };
}
