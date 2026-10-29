# WOS · Worker de credenciais TURN (Cloudflare)

Entrega ao jogo credenciais TURN temporárias (6 h) da Cloudflare. A chave de longo prazo fica só nos
"secrets" do Worker, nunca no código público. O jogo só usa o TURN quando a conexão direta (P2P) falha.

Passo a passo (uma vez):

```bash
cd server/turn
npx wrangler login
npx wrangler deploy
npx wrangler secret put TURN_KEY_ID
npx wrangler secret put TURN_KEY_API_TOKEN
```

O `deploy` mostra o endereço (ex.: `https://wos-turn.SEU-SUBDOMINIO.workers.dev`). Cole esse endereço no
jogo em **Configurações → TURN da Cloudflare** (ou peça para fixá-lo no código em `src/net/rtc.js`).

Origens permitidas: `jay15963.github.io` e `localhost:5173` (edite `ALLOWED_ORIGINS` em `src/index.js`).
Custo: grátis até 1.000 GB/mês de TURN; o Worker em si usa o plano gratuito (100 mil requisições/dia).
