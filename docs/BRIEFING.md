# Briefing — Ferramenta de atribuição de leads (estilo Tintim)

> Documento vivo. Versão do briefing: 1.0 — 20/09/2026.
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
| Canais rastreados na v1 | WhatsApp + formulário de site | Ligação e Instagram Direct ficam fora (exigem telefonia / não têm identificador confiável) |
| Usuários | Só a equipe da agência | Sem multi-tenant real, sem white-label, sem login de cliente — mas o banco já nasce com `client_id` em tudo |
| Onde o status do lead é marcado | Na própria ferramenta | Precisa de uma tela de leads boa de usar no celular, porque é onde o atendimento vai marcar |
| Amarração WhatsApp | Código curto injetado no texto da mensagem | Determinístico, funciona com WhatsApp comum. Perde ~5% (lead apaga o código) |
| Hospedagem do coletor | Conta Cloudflare **do cliente**, em subdomínio dele | Cookie 100% first-party, zero perda em Safari/iOS. Custo: 2 deploys por onboarding |
| Hospedagem do núcleo | Conta Cloudflare **da agência** | Dashboard e banco unificados, visão de carteira inteira |
| Banco | D1 (SQLite) | KV free só permite 1.000 escritas/dia — inviável |
| Google Ads | API direta (você já tem developer token e MCP próprio) | Upload automático por cron, sem CSV manual |
| Escopo da entrega 1 | Fatia vertical, um cliente piloto | Ponta a ponta funcionando antes de replicar |

---

## 3. Arquitetura

Dois Workers, em contas Cloudflare diferentes, por um motivo específico: **rota de Worker
só funciona em zona da mesma conta**. Como o subdomínio é do cliente, o coletor tem que
morar lá. Mas o dado precisa ser central, senão você não tem visão de carteira.

```
┌─────────────────────────────────┐        ┌──────────────────────────────────┐
│   CONTA CLOUDFLARE DO CLIENTE   │        │   CONTA CLOUDFLARE DA AGÊNCIA    │
│                                 │        │                                  │
│  go.cliente.com.br              │        │  rastro.suaagencia.com.br        │
│  ┌───────────────────────────┐  │  POST  │  ┌────────────────────────────┐  │
│  │  COLETOR (stateless)      │──┼────────┼─▶│  NÚCLEO                    │  │
│  │  • seta cookie 1st-party  │  │ +token │  │  • API de ingestão         │  │
│  │  • gera código curto      │  │        │  │  • dashboard + auth        │  │
│  │  • redireciona p/ wa.me   │  │        │  │  • cron de conversões      │  │
│  │  • serve o rastro.js      │  │        │  └─────────────┬──────────────┘  │
│  └───────────────────────────┘  │        │                │                 │
└─────────────────────────────────┘        │          ┌─────▼─────┐           │
                                           │          │  D1       │           │
                                           │          └───────────┘           │
                                           └────────────────┬─────────────────┘
                                                            │ cron horário
                                                   ┌────────▼────────┐
                                                   │ Google Ads API  │
                                                   │ Meta CAPI       │
                                                   └─────────────────┘
```

**Por que o coletor é burro (stateless):** ele não tem banco. Só empacota o que o
navegador sabe e manda pro núcleo. Isso significa que o onboarding de um cliente novo é
`wrangler deploy` + 2 secrets, sem migração de banco nenhuma.

**Risco assumido e registrado:** se a agência perder acesso à conta Cloudflare do
cliente, o rastreio daquele cliente para. Mitigação: o núcleo continua aceitando dados
de um coletor hospedado na conta da agência como fallback (mesmo código, outro domínio).

---

## 4. O caminho do lead, passo a passo

### 4.1 WhatsApp

1. Pessoa clica no anúncio → cai em `cliente.com.br/?gclid=Cj0KC...&utm_campaign=...`
2. O `rastro.js` (uma tag no GTM ou no `<head>`) lê `gclid`, `wbraid`, `gbraid`,
   `fbclid`, todos os `utm_*`, mais os parâmetros de ValueTrack (`keyword`, `matchtype`,
   `campaignid`, `adgroupid`, `creative`, `device`, `network`, `placement`).
   Guarda num cookie first-party `_rastro` de 90 dias. **Não manda nada pro servidor ainda.**
3. O mesmo script reescreve todo link `wa.me` / `api.whatsapp.com` da página para
   `https://go.cliente.com.br/w/<slug>` — o usuário não vê diferença.
4. Pessoa clica no botão. O coletor recebe a requisição, lê o cookie, gera um código de
   4 caracteres (ex: `K7F2`), manda o pacote pro núcleo (que grava a linha no D1), e
   responde `302` para:
   `https://wa.me/5548999999999?text=Olá, vim pelo site e quero um orçamento [#K7F2]`
5. A mensagem chega no WhatsApp do cliente com o código. O atendente abre a ferramenta,
   busca `K7F2` (ou o lead já está lá no topo, é o mais recente), e vê de onde veio.
6. Ao longo do atendimento, marca: **atendido → qualificado → orçamento → ganho/perdido**,
   com valor quando ganha.

### 4.2 Formulário

Mais simples e sem perda nenhuma: o `rastro.js` injeta um campo oculto `rastro_ctx` no
form com o contexto do cookie. O submit vai pro núcleo junto com nome/telefone/email.
Atribuição 100% determinística.

### 4.3 Devolução pra plataforma

Um cron horário pega os leads com status mudado desde o último envio e manda:

- **Google Ads**, `ConversionUploadService.uploadClickConversions`:
  - Se tem `gclid` → upload direto, com `conversion_action`, `conversion_date_time`
    (no fuso da conta, formato `yyyy-mm-dd hh:mm:ss+|-hh:mm`), `conversion_value`, `order_id`.
  - Se não tem `gclid` (tráfego iOS/`wbraid`, ou a pessoa entrou direto) → **Enhanced
    Conversions for Leads**, casando pelo telefone do lead com SHA-256 em formato E.164.
    Isso é uma vantagem grande do nosso caso: **no WhatsApp a gente sempre tem o telefone.**
  - Cada status vira uma ação de conversão diferente no Google Ads. A campanha passa a
    otimizar por "Lead Qualificado", não por clique no botão.
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
clients          -- id, nome, slug, fuso, google_customer_id, meta_dataset_id, ativo
destinations     -- id, client_id, slug, numero_whatsapp, template_mensagem, rotulo
leads            -- id, client_id, codigo, canal, status, valor_centavos, telefone,
                 --    nome, email, criado_em, atualizado_em
                 --    + gclid, wbraid, gbraid, fbclid, fbp
                 --    + utm_source/medium/campaign/term/content
                 --    + keyword, matchtype, campaign_id, adgroup_id, creative_id,
                 --      device, network, placement, landing_url, referrer
lead_events      -- id, lead_id, de_status, para_status, em, usuario  (trilha de auditoria)
conversion_jobs  -- id, lead_id, plataforma, status_alvo, estado, tentativas,
                 --    resposta, enviado_em   (idempotente: uma linha por par lead+estágio)
users            -- id, email, senha_hash, papel
sessions         -- cookie assinado, sem dependência externa
```

`conversion_jobs` existe separado de propósito: enviar conversão duplicada pro Google Ads
polui a conta e não dá pra desfazer com facilidade. A tabela garante que cada
`lead × estágio` sobe uma vez só, com retry seguro.

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
| **0 — Fundação** | Repo, wrangler, D1 + migrations, auth, deploy dos dois Workers | Logar numa tela vazia em produção |
| **1 — Rastreio** | `rastro.js`, redirect de WhatsApp, captura de form, tela de leads com marcação de status | **Ver de qual palavra-chave veio cada conversa e marcar o que aconteceu** |
| **2 — Google Ads** | Upload de conversão offline (gclid) + Enhanced Conversions por telefone, cron, tela de auditoria de envio | Campanha otimizando por lead qualificado e por venda |
| **3 — Meta** | CAPI com fbc/fbp + deduplicação | Mesmo ganho no Meta Ads |
| **4 — Escala** | Onboarding roteirizado, cliente nº 2 e 3, relatório por campanha | Replicar em 10 minutos por cliente |

A fase 1 já entrega valor sozinha: é diagnóstico, dá pra mostrar pro cliente na reunião.
A fase 2 é onde a conta de anúncio melhora de verdade.

---

## 11. O que eu preciso de você pra começar a fase 0

**Cliente piloto:**
- [ ] Nome e domínio
- [ ] O DNS dele está na Cloudflare? Você tem acesso à conta?
- [ ] Subdomínio a usar (sugiro `go.dominio.com.br`)
- [ ] Número de WhatsApp em E.164 (ex: `5548999999999`)
- [ ] Volume aproximado de leads/mês (pra dimensionar e pra validar a folga)

**Google Ads:**
- [ ] `customer_id` da conta do cliente (e o da MCC)
- [ ] Já existe ação de conversão do tipo "Importar → Outras fontes (cliques)"? Se não, crio.
- [ ] Fuso horário configurado na conta (importa pro formato da data de conversão)

**Credenciais** (vão como `wrangler secret`, nunca no repo — me passe só quando formos usar):
- [ ] `developer_token`, `client_id`, `client_secret`, `refresh_token` do Google Ads
- [ ] Token do Meta e `dataset_id` (só na fase 3)

**Produto:**
- [ ] O nome fica "Rastro" ou você quer outro?

---

## 12. Perguntas em aberto

1. **Status do funil**: os cinco que propus (novo / atendido / qualificado / orçamento /
   ganho-perdido) servem pra maioria da sua carteira, ou tem cliente com etapa diferente
   que justifique deixar configurável já na v1?
2. **Quem marca o status na prática** — alguém da agência olhando o WhatsApp do cliente,
   ou o próprio cliente? Isso muda o quanto a tela precisa ser à prova de bala.
3. **Notificação**: vale um aviso (e-mail ou Telegram) quando entra lead novo, ou a
   equipe já vê pelo WhatsApp mesmo?
