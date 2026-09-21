# Briefing — Ferramenta de atribuição de leads (estilo Tintim)

> Documento vivo. Versão do briefing: 2.0 — 21/09/2026.
> A v1 previa dois Workers em contas separadas; a decisão de hospedar tudo na
> conta do cliente simplificou para um Worker só. Histórico no git.
> Nome de trabalho do projeto: **Rastro** (aberto a mudança).

---

## 1. O problema que estamos resolvendo

O Google Ads e o Meta Ads otimizam pelo evento que a gente manda pra eles. Hoje o evento
que a agência manda é **"clicou no botão de WhatsApp"** — que não é um lead, é uma
intenção. O resultado disso:

- O algoritmo aprende a buscar gente que clica em botão, não gente que compra.
- Ninguém sabe qual **palavra-chave** ou qual **criativo** gerou a venda, só quanto custou o clique.
- O cliente reclama que "o lead não presta" e a agência não tem dado pra rebater nem pra corrigir.

A ferramenta amarra cada conversa de WhatsApp (e cada formulário) à campanha,
anúncio e palavra-chave que a originou, deixa a equipe marcar o que aconteceu com o lead,
e devolve **o estágio real do funil** pra plataforma de anúncio como conversão.

**Definição de pronto da v1:** eu consigo abrir o dashboard, ver que o lead do WhatsApp
de terça-feira veio da palavra-chave `[conserto geladeira brastemp]`, marcar que ele
virou uma venda de R$ 480, e o Google Ads receber essa venda com o `gclid` correto.

---

## 2. Decisões travadas no briefing

| Tema | Decisão | Consequência |
|---|---|---|
| Cliente | Hotel Britânico, instalação dedicada | Uma instalação por cliente, sem multi-tenant. Replicar = novo deploy, não novo inquilino |
| Funil | Cotação de reserva de hotel | Novo → Em contato → Cotação enviada → Reserva confirmada / Perdido. Definido em `src/funil.ts` |
| Canais rastreados | WhatsApp + formulário de site | Ligação e Instagram Direct ficam fora (exigem telefonia / não têm identificador confiável) |
| Usuários | Só a equipe da agência | Senha compartilhada + nome do operador para a trilha de auditoria |
| Onde o status é marcado | Na própria ferramenta | A lista de leads vira cartões no celular: é onde o atendimento marca |
| Amarração WhatsApp | Código curto injetado no texto da mensagem | Determinístico, funciona com WhatsApp comum. Perde ~5% (lead apaga o código) |
| Hospedagem | **Tudo na conta Cloudflare do cliente**, em `go.hotelbritanico.com.br` | Cookie 100% first-party, zero perda em Safari/iOS, um Worker só |
| Banco | D1 (SQLite) na mesma conta | KV free só permite 1.000 escritas/dia — inviável |
| Google Ads | API direta (developer token já existente) | Upload automático por cron, com `DRY_RUN` antes do primeiro envio real |
| Escopo da entrega 1 | Fatia vertical completa | Rastreio + painel + envio de conversão, ponta a ponta |

---

## 3. Arquitetura

Um Worker só, na conta Cloudflare do cliente. O motivo é concreto: **rota de
Worker só funciona em zona da mesma conta**. Como o subdomínio é do cliente, o
Worker mora lá — e, já que mora lá, o banco e o painel moram junto. Some a API
de ingestão entre contas, some o segundo deploy, some o token compartilhado.

```
┌──────────────── CONTA CLOUDFLARE DO CLIENTE ────────────────┐
│                                                             │
│  hotelbritanico.com.br        go.hotelbritanico.com.br      │
│  ┌──────────────────┐         ┌─────────────────────────┐   │
│  │ site + /r.js     │────────▶│  WORKER                 │   │
│  │ cookie _rastro   │ clique  │  /w/:slug  redirect     │   │
│  │ (90 dias)        │ ou form │  /api/lead formulário   │   │
│  └──────────────────┘         │  /  painel (sessão)     │   │
│                               │  cron horário           │   │
│                               └───────────┬─────────────┘   │
│                                     ┌─────▼─────┐           │
│                                     │  D1       │           │
│                                     └───────────┘           │
└─────────────────────────────────────────┬───────────────────┘
                                 ┌────────▼────────┐
                                 │ Google Ads API  │
                                 │ Meta CAPI       │
                                 └─────────────────┘
```

**O que se perde com essa escolha, e é justo registrar:** não existe visão
consolidada da carteira — cada cliente tem seu painel e seu banco. Para dois ou
três clientes isso não incomoda; passando disso, o caminho é um painel de
agência que lê as instalações por API, não refazer a arquitetura.

**Risco:** se a agência perder acesso à conta Cloudflare do cliente, o rastreio
daquele cliente para e os dados ficam lá. Mitigação prática: manter o
`database_id` e um export periódico do D1 fora da conta do cliente.

## 4. O caminho do lead, passo a passo

### 4.1 WhatsApp

1. Pessoa clica no anúncio → cai em `hotelbritanico.com.br/?gclid=Cj0KC...&utm_campaign=...`
2. O `/r.js` (tag no GTM ou no `<head>`) lê `gclid`, `wbraid`, `gbraid`, `fbclid`,
   todos os `utm_*`, mais os parâmetros de ValueTrack (`keyword`, `matchtype`,
   `campaignid`, `adgroupid`, `creative`, `device`, `network`, `placement`).
   Guarda num cookie first-party `_rastro` de 90 dias em `.hotelbritanico.com.br`.
   **Não manda nada pro servidor ainda.**
3. O mesmo script reescreve todo link `wa.me` / `api.whatsapp.com` da página para
   `https://go.hotelbritanico.com.br/w/reservas` — o usuário não vê diferença.
   Botões de eventos/grupos podem usar `data-rastro-slug="eventos"`.
4. Pessoa clica. O Worker lê o cookie (mesmo domínio-raiz, por isso chega),
   gera um código de 4 caracteres, grava o lead e responde `302` para:
   `https://wa.me/55…?text=Olá! Gostaria de uma cotação de reserva no Hotel Britânico. [#K7F2]`
5. A mensagem chega na recepção com o código. Quem atende abre o painel — o lead
   já está no topo — e vê a palavra-chave que trouxe aquela pessoa.
6. Ao longo do atendimento, marca: **Em contato → Cotação enviada (com valor) →
   Reserva confirmada (com valor) ou Perdido (com motivo)**.

Dois cuidados que o código já toma, e que são a diferença entre dado limpo e lixo:

- **Clique repetido em até 30 minutos reaproveita o mesmo lead.** Sem isso, a
  pessoa que clica três vezes no botão vira três cotações no relatório.
- **Pré-visualização de link e robô de SEO não viram lead.** O próprio WhatsApp
  busca a URL para montar o preview do link; sem o filtro, cada compartilhamento
  criaria um lead fantasma — e, pior, uma conversão falsa no Google Ads.

### 4.2 Formulário

Sem perda nenhuma: o `/r.js` injeta o contexto num campo oculto e, no envio,
manda o lead para `/api/lead` via `sendBeacon` — que sobrevive à navegação que o
submit provoca. Não depende do backend do site do hotel. Telefone é normalizado
para E.164 e datas no formato brasileiro viram ISO na entrada.

### 4.3 Devolução pra plataforma

Um cron horário pega os leads com status mudado desde o último envio e manda:

- **Google Ads**, `uploadClickConversions`:
  - Se tem `gclid` → upload direto, com `conversion_action`, `conversion_date_time`
    (no fuso da conta, formato `yyyy-mm-dd hh:mm:ss+|-hh:mm`), `conversion_value`, `order_id`.
  - Se não tem `gclid` (tráfego iOS/`wbraid`, ou a pessoa entrou direto) → **Enhanced
    Conversions for Leads**, casando pelo telefone do lead com SHA-256 em formato E.164.
    Isso é uma vantagem grande do nosso caso: **no WhatsApp a gente sempre tem o telefone.**
  - Cada status vira uma ação de conversão diferente no Google Ads: "Cotação
    enviada" como sinal de meio de funil e "Reserva confirmada" com o valor real.
    A campanha passa a otimizar por reserva, não por clique no botão.
  - `orderId` = `rastro-<id>-<status>`: o Google trata reenvio como a mesma
    conversão, então marcar o mesmo lead duas vezes não conta duas.
- **Meta CAPI**, `POST /{dataset_id}/events`: `event_name` conforme o estágio, `fbc`
  montado como `fb.1.<timestamp>.<fbclid>`, `fbp`, telefone hasheado, e `event_id`
  para deduplicar com o pixel do navegador.

> Ponto a validar na implementação, não vou afirmar de memória: as restrições atuais do
> Google Ads para upload com `wbraid`/`gbraid` (há limitações históricas sobre enviar
> valor junto). A primeira integração roda com `validate_only` antes de valer.

---

## 5. Modelo de dados (D1)

Decisão importante de capacidade e de LGPD: **não gravamos pageview.** Só existe linha no
banco quando virou lead de verdade. O contexto de navegação vive no cookie do navegador
até esse momento. Isso derruba o consumo de free tier a quase nada e reduz o volume de
dado pessoal guardado.

```sql
destinos         -- slug, rotulo, numero_whatsapp, template_mensagem, ativo
                 --    (reservas, eventos — cada botão do site pode ter o seu)
leads            -- id, codigo, canal, status, telefone, nome, email,
                 --    check_in, check_out, adultos, criancas, tipo_quarto,
                 --    valor_cotado_centavos, valor_reserva_centavos, motivo_perda
                 --    + gclid, wbraid, gbraid, fbclid, fbp
                 --    + utm_source/medium/campaign/term/content
                 --    + keyword, matchtype, campaign_id, adgroup_id, creative_id,
                 --      device, network, placement, landing_url, referrer
lead_eventos     -- id, lead_id, de_status, para_status, operador, em  (auditoria)
conversoes       -- id, lead_id, plataforma, status_alvo, estado, tentativas,
                 --    payload, resposta, enviado_em
                 --    UNIQUE (lead_id, plataforma, status_alvo)
config           -- cache do access token do Google (evita um binding de KV só pra isso)
```

`conversoes` existe separada de propósito: enviar conversão duplicada pro Google Ads
polui a conta e não dá pra desfazer com facilidade. O `UNIQUE` garante que cada
`lead × plataforma × estágio` sobe uma vez só, com retry seguro. Não há tabela
de sessão: o cookie é assinado com HMAC.

---

## 6. Stack

| Camada | Escolha | Porquê |
|---|---|---|
| Runtime | Cloudflare Workers, TypeScript | Já é onde você opera |
| Roteamento | Hono | Leve, bom com Workers, sem peso de framework |
| Banco | D1 + migrations versionadas no repo | Zero custo, SQL de verdade |
| Dashboard | HTML renderizado no servidor + JS vanilla | Sem build de SPA, sem npm gigante. A tela mais usada vai ser no celular do atendimento — precisa carregar rápido |
| Auth | Sessão em cookie assinado (HMAC), senha com hash | Sem Auth0, sem custo, suficiente pra uso interno |
| Segredos | `wrangler secret` | **Nenhum token vai pro repositório, em hipótese alguma** |

---

## 7. Capacidade real no plano gratuito

Com a decisão de não gravar pageview, uma conta de cliente com **300 leads/mês** consome:

- Coletor: ~300 requisições de redirect + carregamento do `rastro.js` (que na verdade vai
  no GTM ou no próprio HTML, não consome Worker). Muito longe dos 100.000/dia.
- Núcleo: 300 escritas/mês contra um teto de 100.000/dia.
- Cron: 24 execuções/dia, 1 dos 5 triggers disponíveis.

**Conclusão honesta: custo zero é real aqui, e com folga de duas ordens de grandeza.** O
que a gente paga é o domínio (que o cliente já tem) e o tempo de build.

O que forçaria a sair do free: rastrear pageview de site com muito tráfego, ou passar de
uns ~50 clientes com volume alto. Nenhum dos dois está no horizonte da v1.

---

## 8. O que a ferramenta NÃO vai fazer (escopo negativo explícito)

Registro aqui pra não haver expectativa errada depois:

- Não lê mensagens do WhatsApp. Não tem robô, não responde lead, não integra com a caixa
  de entrada. A amarração é pelo código no texto.
- Não rastreia ligação telefônica (exige número dinâmico, tem custo de telefonia).
- Não atribui Instagram Direct com precisão — o Meta não entrega identificador de clique
  confiável pra DM.
- Não substitui CRM. É rastreio e atribuição, com o mínimo de gestão de status necessário
  pra alimentar a atribuição.
- Não tem login de cliente na v1.

---

## 9. LGPD

Estamos guardando telefone, nome e eventualmente e-mail de pessoas físicas, e hasheando
telefone pra mandar pro Google e pro Meta. Isso é tratamento de dado pessoal e precisa de
três coisas antes do primeiro cliente real:

1. **Base legal e aviso**: a landing/site do cliente precisa ter política de privacidade
   mencionando o compartilhamento com plataformas de publicidade. É o mesmo aviso que
   qualquer pixel exige — a maioria dos clientes já tem, vale conferir.
2. **Retenção**: leads apagados automaticamente após N meses (sugiro 18). Cron cuida disso.
3. **Minimização**: não guardar IP bruto nem user-agent completo. País e tipo de
   dispositivo bastam pro que a gente precisa analisar.

---

## 10. Fases de entrega

| Fase | Entrega | Você consegue, ao final dela |
|---|---|---|
| **0 — Fundação** ✅ | Repo, wrangler, D1 + migrations, sessão assinada | Pronto |
| **1 — Rastreio** ✅ | `/r.js`, redirect de WhatsApp, captura de formulário, painel de leads com funil e marcação de status | Pronto — testado ponta a ponta local |
| **2 — Google Ads** ✅ | Upload de conversão offline (gclid) + Enhanced Conversions por telefone, cron, tela de auditoria, `DRY_RUN` | Código pronto; falta credencial real e IDs das ações de conversão |
| **3 — Meta** ✅ | CAPI com fbc/fbp + `event_id` para deduplicação | Código pronto; falta dataset e token |
| **4 — Produção** ⏳ | Deploy na conta do cliente, números reais, tag no site, validação com `DRY_RUN` | **É o que falta** |

As fases 0 a 3 estão implementadas e testadas localmente (45 testes, fluxo do
lead percorrido de ponta a ponta com payload de conversão conferido). O que
falta é exclusivamente configuração de produção: credenciais, números reais e
os IDs das ações de conversão.

---

## 11. O que ainda preciso de você

**Hotel Britânico:**
- [ ] Domínio real (o código assume `hotelbritanico.com.br` — ajustar se for outro)
- [ ] Acesso à conta Cloudflare do hotel, com a zona já lá
- [ ] Confirmar o subdomínio `go.` (ou outro de sua preferência)
- [ ] Número de WhatsApp em E.164 (ex: `5548999999999`)
- [ ] Volume aproximado de leads/mês
- [ ] O hotel tem mais de um número (reservas, eventos)? O seed já prevê dois

**Google Ads:**
- [ ] `customer_id` da conta do cliente (e o da MCC)
- [ ] Já existe ação de conversão do tipo "Importar → Outras fontes (cliques)"? Se não, crio.
- [ ] Fuso horário configurado na conta (importa pro formato da data de conversão)

**Credenciais** (vão como `wrangler secret`, nunca no repo — me passe só quando formos usar):
- [ ] `developer_token`, `client_id`, `client_secret`, `refresh_token` do Google Ads
- [ ] Token do Meta e `dataset_id` (só na fase 3)

**Produto:**
- [ ] O nome fica "Rastro" ou você quer outro? (aparece no topo do painel)

---

## 12. Perguntas em aberto

1. **Motivos de perda**: a lista em `src/funil.ts` é um chute informado (preço, datas
   sem disponibilidade, não respondeu, só pesquisando, concorrente, fora do perfil).
   O hotel tem outros que valham virar campo?
2. **Notificação de lead novo**: vale um aviso (e-mail ou Telegram) quando entra lead,
   ou a equipe já vê pelo WhatsApp mesmo? Não foi implementado.
3. **Visão de carteira**: quando o segundo e o terceiro cliente entrarem, você vai
   querer um painel único da agência lendo as instalações? Isso muda o que vale
   construir agora.
