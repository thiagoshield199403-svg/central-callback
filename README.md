# Central de Callback COI

Ferramenta local para organizar callbacks de incidentes: importa o CSV do ADMS, prepara a mensagem de cada ocorrência, registra o atendimento e gera indicadores agregados.

## Executar

- **Sem servidor:** abra `index.html` no Edge ou no Chrome. Disponível: atendimento individual, preparação e revisão da fila.
- **Com gateway (Node 20+):** `node gateway\servidor.mjs` e abra `http://127.0.0.1:8787/`. Sem configuração, roda em **simulação** e não entrega mensagens.
- **BI:** `http://127.0.0.1:8787/bi.html`.

Os dados de `file://` e de `http://127.0.0.1` ficam separados pelo navegador.

## Documentação

- `LEIA-ME.txt`: uso diário.
- `docs/CENTRAL-DE-DISPAROS.txt`: fila de envio e API oficial do WhatsApp.
- `docs/DRIVE-BI-E-POLOS.txt`: histórico, fechamento, Google Drive, BI e polos.

## Testes (exigem Node)

```
node testes\ponta-a-ponta\rodar-testes-unitarios.mjs
node testes\ponta-a-ponta\e2e.mjs
node testes\ponta-a-ponta\e2e-disparos.mjs
node testes\ponta-a-ponta\e2e-bi.mjs
```

Os testes usam dados fictícios e APIs simuladas em 127.0.0.1.

## Segurança

Credenciais ficam só em `gateway/.env` e `gateway/dados/`, fora do controle de versão. Nunca publique esses arquivos nem dados reais de clientes.
