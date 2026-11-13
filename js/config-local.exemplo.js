/* MODELO da configuração local da Central (este arquivo É publicado; não coloque dados reais aqui).
   Para usar: copie este arquivo para js/config-local.js (mesma pasta) e troque os valores pelos caminhos reais da empresa.
   js/config-local.js NÃO é versionado (.gitignore): caminhos de rede, servidores e URLs de implantação ficam só nos computadores
   da operação. Sem ele a Central funciona, mas mostra "não definida" no lugar dos caminhos e a exportação para a pasta de rede
   aceita a pasta chamada "central-callback".
   - pasta_rede: pasta compartilhada onde o ENCERRAR O DIA grava o fechamento (o último nome do caminho é o nome exigido na seleção).
   - pasta_adms: pasta do ADMS mostrada no botão "Copiar caminho" da faixa Pasta ADMS.
   - url_apps_script: só nas cópias de apps-script/central-* (URL /exec do Web App). A Central principal não usa.
   Não use "use strict" aqui. */
window.CENTRAL_CONFIG_LOCAL = {
  pasta_rede: "W:\\PASTA-DA-EQUIPE\\central-callback",
  pasta_adms: "\\\\SERVIDOR\\PASTA\\ADMS",
};
