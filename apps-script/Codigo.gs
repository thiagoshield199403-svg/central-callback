/* Central de Callback: gravação de métricas operacionais no Google Drive da conta do COI.
   - Só aceita o CSV agregado do fechamento: data, polo, operador e quantidades. Qualquer outro campo ou coluna é recusado.
   - O site é público: nenhuma chave fica nele. A Central usa uma credencial de gravação (a de leitura só consulta um fechamento já gravado), ambas nas Propriedades do script; o pedido é assinado com HMAC-SHA256 e a chave não trafega.
   - drive.file: o script só enxerga o que ele mesmo criou. Nunca sobrescreve nem apaga arquivos.
   - "enviado" só depois de ler o arquivo de volta do Drive e conferir o SHA-256.
   - A Central pública usa a rota aberta (v2): só publicar, com as mesmas validações, limites de pedidos e deduplicação. Não dá acesso geral ao Drive.
   - O painel BI integrado foi retirado: o serviço não oferece mais leitura consolidada das métricas. */

var CONFIG = { CORPO_MAX: 32768, CONTEUDO_MAX: 16384, JANELA_MS: 600000, NONCE_S: 1500, TAXA_MINUTO: 30, PUBLICAR_6H: 600, FALHAS_MAX: 20, FALHAS_S: 600, LOCK_MS: 25000, DIAS_PASSADO: 400, QUANTIDADE_MAX: 20000 };
var API = "https://www.googleapis.com";
var PASTA_MIME = "application/vnd.google-apps.folder";
var CABECALHO = "data;polo;operador;callbacks_realizados;incidentes_resolvidos;incidentes_cancelados;versao";
var RE_NOME = /^fechamento_callbacks_(\d{4}-\d{2}-\d{2})_([A-Z0-9-]{1,80})_PC([A-F0-9]{8})(?:_v(\d{1,4}))?\.csv$/;
var RE_POLO = /^[\p{L}0-9 ._\/,&()-]{0,80}$/u, RE_OPERADOR = /^[\p{L}0-9 ._-]{1,40}$/u, RE_INT = /^\d{1,7}$/;
var PERMISSOES = { gravacao: ["verificar", "publicar"], leitura: ["verificar", "consultar"], migracao: ["verificar", "migrar"] };
var ACOES = ["verificar", "publicar", "consultar", "migrar"], CAMPOS_ENVIO = ["nome", "data", "versao", "conteudo", "sha256"];
var ORIGEM_MIGRACAO = "MIGRAÇÃO HISTÓRICA", RE_ORIGINAL = /^fechamento_callbacks_(\d{4}-\d{2}-\d{2})_([A-Z0-9-]{1,80})\.csv$/;
var PUBLICO = { id: "PUBLICO", escopo: "publico" };
var MESES = ["JANEIRO", "FEVEREIRO", "MARCO", "ABRIL", "MAIO", "JUNHO", "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"];

function doGet() { return saida_({ resultado: "ok", servico: "central-callback-metricas", api: 1 }); }
function doPost(e) { return saida_(processar_(e && e.postData && e.postData.contents)); }
function saida_(d) { return ContentService.createTextOutput(JSON.stringify(d)).setMimeType(ContentService.MimeType.JSON); }
function recusa_(codigo, detalhe) { return { resultado: "falha", codigo: codigo, detalhe: detalhe }; }
function pendente_(detalhe) { return { resultado: "pendente", detalhe: detalhe }; }
function ErroDrive_(mensagem, status) { this.message = mensagem; this.status = status; }
function ErroValidacao_(mensagem) { this.message = mensagem; }
function chavesExatas_(o, lista) { var k = Object.keys(o).sort(); return JSON.stringify(k) === JSON.stringify(lista.slice().sort()); }

/* ---------------- autenticação */
function hex_(bytes) { return bytes.map(function (b) { return ("0" + (b & 255).toString(16)).slice(-2); }).join(""); }
function sha256Texto_(t) { return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, t, Utilities.Charset.UTF_8)); }
function hmac_(texto, chave) { return hex_(Utilities.computeHmacSha256Signature(texto, chave, Utilities.Charset.UTF_8)); }
function iguais_(a, b) { if (a.length !== b.length) return false; var d = 0; for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
function credencial_(id) {
  var bruto = PropertiesService.getScriptProperties().getProperty("CRED_" + id);
  if (!bruto) return null;
  try { var c = JSON.parse(bruto); return c && c.ativo === true && c.segredo ? { id: id, segredo: c.segredo, escopo: c.escopo || "" } : null; } catch (e) { return null; }
}
function contar_(cache, chave, segundos) { var n = Number(cache.get(chave) || 0) + 1; cache.put(chave, String(n), segundos); return n; }

function processar_(texto) {
  try {
    if (typeof texto !== "string" || !texto || texto.length > CONFIG.CORPO_MAX) return recusa_("pedido_invalido", "Pedido inválido.");
    var p; try { p = JSON.parse(texto); } catch (e) { return recusa_("pedido_invalido", "Pedido inválido."); }
    if (p && p.v === 2) return publico_(p);
    if (!p || typeof p !== "object" || !chavesExatas_(p, ["v", "id", "ts", "nonce", "acao", "corpo", "sig"])) return recusa_("pedido_invalido", "Pedido inválido.");
    if (p.v !== 1 || typeof p.id !== "string" || !/^[A-Z0-9_-]{1,40}$/.test(p.id) || typeof p.ts !== "number" || typeof p.nonce !== "string" || !/^[a-f0-9]{32}$/.test(p.nonce) || typeof p.corpo !== "string" || typeof p.sig !== "string" || !/^[a-f0-9]{64}$/.test(p.sig)) return recusa_("pedido_invalido", "Pedido inválido.");
    if (ACOES.indexOf(p.acao) < 0) return recusa_("pedido_invalido", "Ação desconhecida.");
    var cache = CacheService.getScriptCache(), chaveFalha = "falha:" + p.id;
    if (Number(cache.get(chaveFalha) || 0) >= CONFIG.FALHAS_MAX) return recusa_("bloqueado", "Muitas tentativas inválidas. Aguarde alguns minutos.");
    var cred = credencial_(p.id), canonico = [p.v, p.id, p.ts, p.nonce, p.acao, sha256Texto_(p.corpo)].join("\n");
    if (!iguais_(hmac_(canonico, cred ? cred.segredo : "credencial-inexistente"), p.sig) || !cred) { contar_(cache, chaveFalha, CONFIG.FALHAS_S); console.warn("assinatura recusada: " + p.id); return recusa_("nao_autorizado", "Acesso não autorizado."); }
    if (Math.abs(Date.now() - p.ts) > CONFIG.JANELA_MS) return recusa_("expirado", "O relógio deste computador está incorreto ou o pedido expirou.");
    var chaveNonce = "nonce:" + p.nonce;
    if (cache.get(chaveNonce)) { console.warn("nonce repetido: " + p.id); return recusa_("repetido", "Pedido repetido."); }
    cache.put(chaveNonce, "1", CONFIG.NONCE_S);
    if (contar_(cache, "taxa:" + p.id + ":" + Math.floor(Date.now() / 60000), 120) > CONFIG.TAXA_MINUTO) return pendente_("Muitos envios em pouco tempo. Tente novamente em instantes.");
    if ((PERMISSOES[cred.escopo] || []).indexOf(p.acao) < 0) { console.warn("ação não permitida: " + p.id + " " + p.acao); return recusa_("nao_permitido", "Esta credencial não permite esta ação."); }
    var corpo; try { corpo = JSON.parse(p.corpo); } catch (e) { return recusa_("pedido_invalido", "Pedido inválido."); }
    if (!corpo || typeof corpo !== "object") return recusa_("pedido_invalido", "Pedido inválido.");
    return p.acao === "verificar" ? (chavesExatas_(corpo, []) ? { resultado: "ok", escopo: cred.escopo } : recusa_("fora_do_padrao", "Campos não permitidos no pedido.")) : p.acao === "publicar" ? publicar_(corpo, cred) : p.acao === "consultar" ? consultar_(corpo, cred) : migrar_(corpo, cred);
  } catch (e) {
    if (e instanceof ErroValidacao_) return recusa_("fora_do_padrao", e.message);
    if (e instanceof ErroDrive_) return e.status === 409 ? recusa_("conflito", e.message) : pendente_(e.message);
    console.error("erro interno: " + (e && e.message));
    return pendente_("Falha temporária no serviço de métricas.");
  }
}

/* Rota aberta da Central: sem chave no navegador. Só a ação publicar, com limite global de pedidos; a validação e a deduplicação são as mesmas. */
function publico_(p) {
  if (!chavesExatas_(p, ["v", "acao", "corpo"]) || typeof p.corpo !== "string" || p.acao !== "publicar") return recusa_("pedido_invalido", "Pedido inválido.");
  var cache = CacheService.getScriptCache(), minuto = Math.floor(Date.now() / 60000);
  if (contar_(cache, "taxa:pub:" + p.acao + ":" + minuto, 120) > CONFIG.TAXA_MINUTO) return pendente_("Muitos pedidos em pouco tempo. Tente novamente em instantes.");
  if (contar_(cache, "taxa:pub:6h:" + Math.floor(Date.now() / 21600000), 21600) > CONFIG.PUBLICAR_6H) return pendente_("Limite de envios atingido. Tente novamente mais tarde.");
  var corpo; try { corpo = JSON.parse(p.corpo); } catch (e) { return recusa_("pedido_invalido", "Pedido inválido."); }
  if (!corpo || typeof corpo !== "object") return recusa_("pedido_invalido", "Pedido inválido.");
  return publicar_(corpo, PUBLICO);
}

/* ---------------- validação: barreira de privacidade e de indicadores */
function hojeLocal_() { return Utilities.formatDate(new Date(), "America/Maceio", "yyyy-MM-dd"); }
function diasEntre_(a, b) { return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000); }
function analisar_(nome, conteudo) {
  var n = RE_NOME.exec(String(nome || ""));
  if (!n) throw new ErroValidacao_("Nome de arquivo fora do padrão.");
  var data = n[1], versao = Number(n[4] || 1);
  if (isNaN(Date.parse(data + "T00:00:00Z")) || versao < 1) throw new ErroValidacao_("Data ou versão inválida.");
  var linhas = String(conteudo || "").replace(/^﻿/, "").split(/\r?\n/).filter(function (l) { return l.length; });
  if (linhas[0] !== CABECALHO) throw new ErroValidacao_("Colunas fora do padrão agregado.");
  if (linhas.length < 2 || linhas.length > 502) throw new ErroValidacao_("Quantidade de linhas inválida.");
  var saida = [], total = null, vistos = {};
  linhas.slice(1).forEach(function (l) {
    var c = l.split(";");
    if (c.length !== 7) throw new ErroValidacao_("Linha fora do padrão.");
    if (c[0] !== data) throw new ErroValidacao_("Data da linha difere do arquivo.");
    if (!RE_POLO.test(c[1]) || !RE_OPERADOR.test(c[2]) || /\d{8,}/.test(c[1]) || /\d{8,}/.test(c[2])) throw new ErroValidacao_("Polo ou operador inválido.");
    if (![c[3], c[4], c[5], c[6]].every(function (x) { return RE_INT.test(x); })) throw new ErroValidacao_("Valor não numérico.");
    if (Number(c[6]) !== versao) throw new ErroValidacao_("Versão difere do nome do arquivo.");
    var reg = { polo: c[1], operador: c[2], callbacks: Number(c[3]), resolvidos: Number(c[4]), cancelados: Number(c[5]) };
    if (reg.callbacks > CONFIG.QUANTIDADE_MAX || reg.resolvidos > CONFIG.QUANTIDADE_MAX || reg.cancelados > CONFIG.QUANTIDADE_MAX) throw new ErroValidacao_("Quantidade fora do limite.");
    if (c[2] === "TOTAL") { if (total) throw new ErroValidacao_("Linha TOTAL repetida."); total = reg; return; }
    var chave = c[1] + "|" + c[2]; if (vistos[chave]) throw new ErroValidacao_("Operador repetido."); vistos[chave] = 1;
    saida.push(reg);
  });
  if (!total) throw new ErroValidacao_("Linha TOTAL ausente.");
  ["callbacks", "resolvidos", "cancelados"].forEach(function (k) { if (saida.reduce(function (t, r) { return t + r[k]; }, 0) !== total[k]) throw new ErroValidacao_("Total não confere."); });
  return { data: data, computador: n[3], versao: versao, linhas: saida };
}

/* ---------------- Google Drive (REST, só com drive.file) */
function chamar_(caminho, op) {
  op = op || {};
  var metodo = op.method || "get", tentativas = metodo === "get" ? 3 : 1;
  for (var n = 0; ; n++) {
    var r;
    try { r = UrlFetchApp.fetch(API + caminho, { method: metodo, headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() }, contentType: op.contentType, payload: op.payload, muteHttpExceptions: true }); }
    catch (e) { if (n + 1 >= tentativas) throw new ErroDrive_("Sem resposta do Google Drive.", 0); Utilities.sleep(300 * Math.pow(3, n)); continue; }
    var s = r.getResponseCode();
    if (s >= 200 && s < 300) return r;
    console.warn("Drive " + s + ": " + r.getContentText().slice(0, 300));
    if (n + 1 >= tentativas || !(s === 429 || s >= 500)) throw new ErroDrive_("O Google Drive respondeu " + s + ".", s);
    Utilities.sleep(300 * Math.pow(3, n));
  }
}
function aspas_(t) { return String(t).replace(/\\/g, "\\\\").replace(/'/g, "\\'"); }
function listar_(q, campos) {
  var u = "/drive/v3/files?spaces=drive&pageSize=10&fields=" + encodeURIComponent("files(" + campos + ")") + "&q=" + encodeURIComponent(q);
  return JSON.parse(chamar_(u).getContentText()).files || [];
}
function pasta_(nome, pai) {
  var cache = CacheService.getScriptCache(), chave = "pasta:" + sha256Texto_(pai + "/" + nome), memo = cache.get(chave);
  if (memo) return memo;
  var a = listar_("name='" + aspas_(nome) + "' and '" + aspas_(pai) + "' in parents and mimeType='" + PASTA_MIME + "' and trashed=false", "id,name")[0];
  var id = a ? a.id : JSON.parse(chamar_("/drive/v3/files?fields=id", { method: "post", contentType: "application/json", payload: JSON.stringify({ name: nome, mimeType: PASTA_MIME, parents: [pai] }) }).getContentText()).id;
  cache.put(chave, id, 21600);
  return id;
}
function nomeMes_(data) { var m = Number(data.slice(5, 7)); return ("0" + m).slice(-2) + "-" + MESES[m - 1]; }
function raizNome_() {
  var n = PropertiesService.getScriptProperties().getProperty("PASTA_RAIZ");
  if (!n) throw new ErroDrive_("Serviço de métricas sem pasta configurada.", 0);
  return n;
}
function pastaMes_(data) {
  var raiz = raizNome_();
  return { id: pasta_(nomeMes_(data), pasta_(data.slice(0, 4), pasta_("FECHAMENTOS", pasta_(raiz, "root")))), caminho: raiz + "/FECHAMENTOS/" + data.slice(0, 4) + "/" + nomeMes_(data) };
}
function buscar_(nome, pai) { return listar_("name='" + aspas_(nome) + "' and '" + aspas_(pai) + "' in parents and trashed=false", "id,name,appProperties")[0] || null; }
function confirmar_(id, sha) {
  if (!id) throw new ErroDrive_("O Google Drive não informou o arquivo criado.", 502);
  var bytes = chamar_("/drive/v3/files/" + encodeURIComponent(id) + "?alt=media").getContent();
  if (hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes)) !== sha) throw new ErroDrive_("O arquivo lido de volta do Drive difere do enviado.", 502);
}
function marcaRaiz_() { return sha256Texto_(raizNome_()).slice(0, 16); }
function enviarArquivo_(nome, conteudo, destino, sha, shaGravado, versao, cred, extras) {
  var props = { sha256: sha, gravado: shaGravado, versao: String(versao), credencial: cred.id, raiz: marcaRaiz_() };
  Object.keys(extras).forEach(function (k) { props[k] = extras[k]; });
  var limite = "central-callback-" + sha.slice(0, 16), meta = { name: nome, mimeType: "text/csv", parents: [destino], appProperties: props };
  var corpo = "--" + limite + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify(meta) + "\r\n--" + limite + "\r\nContent-Type: text/csv; charset=UTF-8\r\n\r\n" + conteudo + "\r\n--" + limite + "--";
  var tipo = "multipart/related; boundary=" + limite, bytes = Utilities.newBlob(corpo, tipo).getBytes();
  return JSON.parse(chamar_("/upload/drive/v3/files?uploadType=multipart&fields=id", { method: "post", contentType: tipo, payload: bytes }).getContentText()).id;
}

/* ---------------- ações */
function publicar_(d, cred) {
  if (!chavesExatas_(d, CAMPOS_ENVIO)) return recusa_("fora_do_padrao", "Campos não permitidos no pedido.");
  return gravar_(d, cred, { origem: "apps-script" });
}
/* Migração: credencial própria, um único arquivo de destino por arquivo original (o nome deriva do original), origem registrada no Drive. */
function migrar_(d, cred) {
  if (!chavesExatas_(d, CAMPOS_ENVIO.concat("nome_original"))) return recusa_("fora_do_padrao", "Campos não permitidos no pedido.");
  var n = RE_ORIGINAL.exec(String(d.nome_original || ""));
  if (!n || d.nome !== "fechamento_callbacks_" + n[1] + "_" + n[2] + "_PC" + sha256Texto_(d.nome_original).slice(0, 8).toUpperCase() + ".csv") return recusa_("fora_do_padrao", "Nome de migração fora do padrão.");
  return gravar_(d, cred, { origem: ORIGEM_MIGRACAO, nome_original: d.nome_original });
}
function gravar_(d, cred, extras) {
  if (typeof d.conteudo !== "string" || d.conteudo.length > CONFIG.CONTEUDO_MAX || typeof d.sha256 !== "string") return recusa_("fora_do_padrao", "Conteúdo inválido.");
  var a = analisar_(d.nome, d.conteudo), sha = sha256Texto_(d.conteudo);
  if (sha !== d.sha256 || d.data !== a.data || d.versao !== a.versao) return recusa_("integridade", "Conteúdo não confere.");
  var atraso = diasEntre_(a.data, hojeLocal_());
  if (atraso < -1 || atraso > CONFIG.DIAS_PASSADO) return recusa_("fora_do_padrao", "Data do fechamento fora do período aceito.");
  var trava = LockService.getScriptLock();
  if (!trava.tryLock(CONFIG.LOCK_MS)) return pendente_("Serviço de métricas ocupado. Tente novamente em instantes.");
  try {
    // O Apps Script não preserva o BOM: grava sempre sem ele e confere exatamente esses bytes. appProperties guarda o hash do pedido, usado na deduplicação.
    var semBom = d.conteudo.replace(/^﻿/, ""), shaGravado = sha256Texto_(semBom), mes = pastaMes_(a.data), ja = buscar_(d.nome, mes.id);
    if (ja) {
      if (!ja.appProperties || ja.appProperties.sha256 !== sha) throw new ErroDrive_("Já existe um arquivo com este nome e conteúdo diferente: nada foi sobrescrito.", 409);
      confirmar_(ja.id, shaGravado);
      return { resultado: "enviado", confirmado: true, arquivo_id: ja.id, reaproveitado: true, caminho: mes.caminho };
    }
    // Na rota aberta o operador pode ter escolhido não enviar uma versão anterior: a sequência não é exigida.
    if (a.versao > 1 && cred.escopo !== "publico") {
      var anterior = d.nome.replace(/(_v\d+)?\.csv$/, "") + (a.versao > 2 ? "_v" + (a.versao - 1) : "") + ".csv";
      if (!buscar_(anterior, mes.id)) return recusa_("sequencia", "A versão anterior deste fechamento ainda não foi gravada.");
    }
    var id = enviarArquivo_(d.nome, semBom, mes.id, sha, shaGravado, a.versao, cred, extras);
    confirmar_(id, shaGravado);
    return { resultado: "enviado", confirmado: true, arquivo_id: id, reaproveitado: false, caminho: mes.caminho };
  } finally { trava.releaseLock(); }
}
function consultar_(d, cred) {
  if (!chavesExatas_(d, ["nome"])) return recusa_("fora_do_padrao", "Campos não permitidos no pedido.");
  var n = RE_NOME.exec(String(d.nome || ""));
  if (!n) return recusa_("fora_do_padrao", "Nome de arquivo fora do padrão.");
  var mes = pastaMes_(n[1]), ja = buscar_(d.nome, mes.id);
  if (!ja) return { resultado: "ok", existe: false };
  return { resultado: "ok", existe: true, arquivo_id: ja.id, sha256: (ja.appProperties || {}).sha256 || null, conteudo: chamar_("/drive/v3/files/" + encodeURIComponent(ja.id) + "?alt=media").getContentText(), caminho: mes.caminho };
}
