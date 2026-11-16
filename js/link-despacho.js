/* Botão DESPACHO OTIMIZADO da Central: abre o módulo independente (despacho.html) na mesma aba, preservando o ?bd= da Central
   (mesmo banco, mesma autorização da pasta ADMS). Não altera nada da Central. */
"use strict";
(function () {
  const b = document.querySelector("#btn-despacho");
  if (b) b.addEventListener("click", () => { location.href = "despacho.html" + location.search; });
})();
