/* Armazenamento local da Central (IndexedDB do navegador). Substitui o callback.db (SQLite) da versão com servidor.
   - O estado inteiro fica num único registro: cada gravação é uma transação atômica (tudo ou nada).
   - Controle de revisão: se outra aba gravou depois que esta leu, a gravação é recusada (sem sobrescrever).
   - Nada sai do computador. */
"use strict";
(function (raiz) {
  const ESQUEMA = 1;
  const ARMAZEM = "estado", CHAVE = "central";

  function abrir(nomeBanco) {
    return new Promise((ok, falha) => {
      if (!raiz.indexedDB) { falha(new Error("Este navegador não oferece armazenamento local (IndexedDB). Use o Microsoft Edge ou o Google Chrome.")); return; }
      let pedido;
      try { pedido = raiz.indexedDB.open(nomeBanco, 1); } catch (e) { falha(new Error("Armazenamento local bloqueado neste navegador: " + e.message)); return; }
      pedido.onupgradeneeded = () => {
        const db = pedido.result;
        if (!db.objectStoreNames.contains(ARMAZEM)) db.createObjectStore(ARMAZEM);
        if (!db.objectStoreNames.contains("arquivos")) db.createObjectStore("arquivos"); // pasta de exportação escolhida
      };
      pedido.onsuccess = () => ok(pedido.result);
      pedido.onerror = () => falha(new Error("Não foi possível abrir o armazenamento local: " + (pedido.error && pedido.error.message)));
      pedido.onblocked = () => falha(new Error("O armazenamento está bloqueado por outra aba com versão diferente. Feche as outras abas da Central."));
    });
  }

  class ErroConcorrencia extends Error {}

  class Armazenamento {
    constructor(nomeBanco) { this.nomeBanco = nomeBanco; this.db = null; this.revisao = 0; }
    async iniciar() { this.db = await abrir(this.nomeBanco); return this; }

    ler() {
      return new Promise((ok, falha) => {
        const t = this.db.transaction(ARMAZEM, "readonly"), r = t.objectStore(ARMAZEM).get(CHAVE);
        r.onsuccess = () => {
          const v = r.result || null;
          if (v && v.esquema > ESQUEMA) { falha(new Error(`Os dados foram gravados por uma versão mais nova da Central (esquema ${v.esquema}).`)); return; }
          this.revisao = v ? v.revisao : 0; ok(v);
        };
        r.onerror = () => falha(r.error);
      });
    }

    /* Grava o estado se ninguém gravou desde a última leitura. Tudo numa transação. */
    gravar(estado) {
      return new Promise((ok, falha) => {
        const t = this.db.transaction(ARMAZEM, "readwrite"), loja = t.objectStore(ARMAZEM);
        let novo;
        const atual = loja.get(CHAVE);
        atual.onsuccess = () => {
          const rev = atual.result ? atual.result.revisao : 0;
          if (rev !== this.revisao) { t.abort(); falha(new ErroConcorrencia("Os dados foram alterados em outra aba ou janela da Central. A tela foi recarregada; repita a ação.")); return; }
          novo = { ...estado, esquema: ESQUEMA, revisao: rev + 1, gravado_em: new Date().toISOString() };
          loja.put(novo, CHAVE);
        };
        t.oncomplete = () => { this.revisao = novo.revisao; ok(novo); };
        t.onerror = () => falha(new Error("Falha ao gravar no armazenamento local: " + (t.error && t.error.message)));
        t.onabort = () => { if (t.error) falha(new Error("Gravação cancelada: " + t.error.message)); };
      });
    }

    lerArquivo(chave) {
      return new Promise((ok) => {
        try { const r = this.db.transaction("arquivos", "readonly").objectStore("arquivos").get(chave); r.onsuccess = () => ok(r.result || null); r.onerror = () => ok(null); }
        catch (e) { ok(null); }
      });
    }
    gravarArquivo(chave, valor) {
      return new Promise((ok, falha) => {
        const t = this.db.transaction("arquivos", "readwrite");
        if (valor == null) t.objectStore("arquivos").delete(chave); else t.objectStore("arquivos").put(valor, chave);
        t.oncomplete = () => ok(); t.onerror = () => falha(t.error);
      });
    }
    fechar() { if (this.db) this.db.close(); }
    static apagarBanco(nome) {
      return new Promise((ok) => { const r = raiz.indexedDB.deleteDatabase(nome); r.onsuccess = r.onerror = r.onblocked = () => ok(); });
    }
  }
  Armazenamento.ErroConcorrencia = ErroConcorrencia;
  raiz.Armazenamento = Armazenamento;
})(typeof window !== "undefined" ? window : globalThis);
