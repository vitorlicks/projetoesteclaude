# Rastro — Hotel Britânico

Rastreio e atribuição de leads de cotação de reserva. Amarra cada conversa de
WhatsApp e cada formulário do site à campanha, anúncio e palavra-chave que a
originou, deixa a equipe marcar o que aconteceu, e devolve o estágio real do
funil para o Google Ads e o Meta como conversão.

O objetivo não é relatório bonito: é **parar de otimizar por clique no botão e
passar a otimizar por reserva confirmada**.

Briefing e decisões de arquitetura: [`docs/BRIEFING.md`](docs/BRIEFING.md).

---

## Como funciona, em quatro passos

1. **`/r.js`** no site guarda `gclid`/`wbraid`/`gbraid`/`fbclid`, `utm_*` e os
   parâmetros de ValueTrack num cookie first-party de 90 dias, e reescreve todo
   botão de WhatsApp da página para passar pelo item 2.
2. **`/w/:slug`** gera um código de 4 caracteres, grava o lead com a origem e
   redireciona para `wa.me` com o código dentro do texto:
   *"Olá! Gostaria de uma cotação de reserva no Hotel Britânico. [#K7F2]"*
3. **Painel** — a equipe marca: Novo → Em contato → Cotação enviada → Reserva
   confirmada (ou Perdido, com motivo).
4. **Cron horário** sobe as conversões: Google Ads por `gclid` ou por
   *Enhanced Conversions for Leads* (telefone com hash), e Meta por CAPI.

## Funil

| Status | O que significa | Vira conversão? |
|---|---|---|
| `novo` | Pedido chegou, ninguém respondeu | não |
| `em_contato` | Atendimento respondeu | não |
| `cotacao_enviada` | Proposta com valor enviada | **sim** (valor cotado) |
| `reserva_confirmada` | Hóspede fechou | **sim** (valor da reserva) |
| `perdido` | Não fechou, com motivo | não |

Mudar de nicho depois é mexer só em `src/funil.ts`.

---

## Deploy (na conta Cloudflare do cliente)

O Worker precisa morar na conta que controla a zona `hotelbritanico.com.br` —
rota de Worker só funciona em zona da mesma conta. É por isso que o deploy é
feito lá, e não na conta da agência.

```bash
npm install
npx wrangler login                      # na conta do CLIENTE

# 1. banco
npx wrangler d1 create rastro           # copie o database_id para wrangler.jsonc
npx wrangler d1 migrations apply rastro --remote

# 2. segredos (nunca no repositório)
npx wrangler secret put SESSION_SECRET  # openssl rand -base64 32
npx wrangler secret put APP_PASSWORD

# 3. deploy
npx wrangler deploy
```

Depois, no painel Cloudflare do cliente, aponte `go.hotelbritanico.com.br` para
o Worker (a rota já está declarada como *custom domain* no `wrangler.jsonc`).

### Antes do primeiro lead real

- [ ] `database_id` preenchido no `wrangler.jsonc`
- [ ] `COOKIE_DOMAIN` = `.hotelbritanico.com.br` (com o ponto na frente)
- [ ] `ALLOWED_ORIGINS` com todos os domínios do site (com e sem `www`)
- [ ] Números reais em `migrations/0002_seed_destinos.sql` — o seed vem com
      `5500000000000` de propósito, para não mandar ninguém para um número errado
- [ ] `TIMEZONE_OFFSET` igual ao fuso configurado na conta do Google Ads
- [ ] Tag `<script async src="https://go.hotelbritanico.com.br/r.js"></script>`
      no site ou no GTM
- [ ] Teste: abra o site com `?gclid=TESTE123`, clique no WhatsApp, confira se o
      lead apareceu com a origem certa

### Ligando o envio de conversão

1. No Google Ads, crie as ações de conversão do tipo **Importar → Outras fontes
   (cliques)** — uma para "Cotação enviada" e outra para "Reserva confirmada".
2. Preencha `GOOGLE_CONVERSION_ACTIONS` no `wrangler.jsonc` com o ID de cada uma:
   `{"cotacao_enviada":"123456789","reserva_confirmada":"987654321"}`
3. Suba os segredos do Google Ads:
   ```bash
   npx wrangler secret put GOOGLE_ADS_DEVELOPER_TOKEN
   npx wrangler secret put GOOGLE_ADS_CLIENT_ID
   npx wrangler secret put GOOGLE_ADS_CLIENT_SECRET
   npx wrangler secret put GOOGLE_ADS_REFRESH_TOKEN
   npx wrangler secret put GOOGLE_ADS_CUSTOMER_ID       # só dígitos
   npx wrangler secret put GOOGLE_ADS_LOGIN_CUSTOMER_ID # a MCC
   ```
4. **Deixe `DRY_RUN` em `"true"`.** Marque alguns leads, abra `/conversoes` e
   confira os payloads montados. Só então mude para `"false"` e faça deploy.
   Conversão importada no Google Ads **não pode ser apagada**.
5. Confirme a versão da API em `GOOGLE_ADS_API_VERSION` antes do primeiro envio real.

Para o Meta, o mesmo caminho com `META_DATASET_ID` e `META_ACCESS_TOKEN`.

---

## Desenvolvimento

```bash
npm run typecheck
npm test
npm run db:local        # aplica migrations no banco local
npm run dev             # http://localhost:8787
```

Copie `.dev.vars.example` para `.dev.vars` e preencha. **Atenção:** valores em
`vars` do `wrangler.jsonc` têm precedência sobre `.dev.vars` no `wrangler dev` —
para testar localmente um valor que já existe em `vars` (como
`GOOGLE_CONVERSION_ACTIONS`), use `wrangler dev --var 'CHAVE:valor'`.

## Estrutura

```
src/
  index.ts              entrada (fetch + scheduled)
  funil.ts              o funil de cotação de reserva — mude aqui para outro nicho
  tracker.ts            o script servido em /r.js
  conversoes.ts         fila de conversão: enfileirar e despachar
  ui.ts                 casca visual, tokens de cor, componentes
  routes/
    coleta.ts           /r.js, /w/:slug, /api/lead   (público)
    auth.ts             sessão assinada
    painel.ts           leads, campanhas, conversões, instalação
  integrations/
    google-ads.ts       upload de conversão offline + enhanced conversions
    meta.ts             CAPI
  lib/                  atribuição, código curto, hash, tempo, normalização
migrations/             esquema do D1
tests/                  vitest — 45 testes da lógica que quebra em silêncio
```

## Custo

Plano gratuito da Cloudflare, com folga de duas ordens de grandeza para o volume
de um hotel: Workers 100.000 req/dia, D1 100.000 linhas escritas/dia, 1 dos 5
cron triggers. Não gravamos pageview — o contexto vive no cookie e só chega ao
banco quando virou lead — o que mantém o consumo baixo e reduz o volume de dado
pessoal guardado.
