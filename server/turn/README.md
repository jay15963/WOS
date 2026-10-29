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

No PowerShell do Windows use `npx.cmd` no lugar de `npx` (o Windows bloqueia scripts `.ps1`).
**Atenção:** no comando vai o NOME literal (`TURN_KEY_ID`); o valor você cola quando aparecer `Enter a secret value`.
Conferir: `npx wrangler secret list` deve mostrar só esses dois nomes.

Implantado em: `https://wos-turn.wos-jay.workers.dev` (fixado em `src/net/rtc.js`, `TURN_ENDPOINT_DEFAULT`).

Teste forçando o TURN (simula NAT incompatível): no console do navegador,
`localStorage.setItem('wos.forceRelay','1')`, conecte duas abas; o relatório deve mostrar
"via TURN (repetidor) · relay↔relay". Para voltar: `localStorage.removeItem('wos.forceRelay')`.

O `deploy` mostra o endereço (ex.: `https://wos-turn.SEU-SUBDOMINIO.workers.dev`). Cole esse endereço no
jogo em **Configurações → TURN da Cloudflare** (ou peça para fixá-lo no código em `src/net/rtc.js`).

Origens permitidas: `jay15963.github.io` e `localhost:5173` (edite `ALLOWED_ORIGINS` em `src/index.js`).
Custo: grátis até 1.000 GB/mês de TURN; o Worker em si usa o plano gratuito (100 mil requisições/dia).
