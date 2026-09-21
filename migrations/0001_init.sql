-- Rastro — esquema inicial.
--
-- Decisão de capacidade e de LGPD: não existe tabela de pageview. O contexto
-- de origem vive no cookie do navegador e só chega ao banco quando virou lead.
--
-- Timestamps são sempre ISO-8601 UTC ('YYYY-MM-DDTHH:MM:SS.sssZ'), gravados
-- pela aplicação. Os DEFAULTs usam o mesmo formato para não misturar padrões.

CREATE TABLE destinos (
  slug              TEXT PRIMARY KEY,
  rotulo            TEXT NOT NULL,
  numero_whatsapp   TEXT NOT NULL,              -- E.164 sem o '+', ex: 5548999998888
  template_mensagem TEXT NOT NULL,              -- usa o marcador {codigo}
  ativo             INTEGER NOT NULL DEFAULT 1,
  criado_em         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Permite casar um link wa.me já existente no site (pelo número) com o destino
-- certo, sem precisar editar cada botão na mão.
CREATE INDEX idx_destinos_numero ON destinos(numero_whatsapp);

CREATE TABLE leads (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo                TEXT NOT NULL UNIQUE,   -- o [#K7F2] que vai no WhatsApp
  canal                 TEXT NOT NULL CHECK (canal IN ('whatsapp','formulario')),
  destino_slug          TEXT REFERENCES destinos(slug),
  status                TEXT NOT NULL DEFAULT 'novo',

  -- contato
  nome                  TEXT,
  telefone              TEXT,                   -- E.164 normalizado
  email                 TEXT,

  -- cotação de reserva (funil do hotel)
  check_in              TEXT,                   -- YYYY-MM-DD
  check_out             TEXT,                   -- YYYY-MM-DD
  adultos               INTEGER,
  criancas              INTEGER,
  tipo_quarto           TEXT,
  valor_cotado_centavos INTEGER,                -- proposta enviada
  valor_reserva_centavos INTEGER,               -- reserva fechada
  motivo_perda          TEXT,
  observacoes           TEXT,

  -- atribuição: identificadores de clique
  gclid                 TEXT,
  wbraid                TEXT,
  gbraid                TEXT,
  fbclid                TEXT,
  fbp                   TEXT,

  -- atribuição: utm
  utm_source            TEXT,
  utm_medium            TEXT,
  utm_campaign          TEXT,
  utm_term              TEXT,
  utm_content           TEXT,

  -- atribuição: ValueTrack do Google Ads
  keyword               TEXT,
  matchtype             TEXT,
  campaign_id           TEXT,
  adgroup_id            TEXT,
  creative_id           TEXT,
  network               TEXT,
  device                TEXT,
  placement             TEXT,

  -- contexto mínimo (sem IP bruto, sem user-agent completo: minimização)
  landing_url           TEXT,
  referrer              TEXT,
  pais                  TEXT,
  tipo_dispositivo      TEXT,

  primeiro_toque_em     TEXT,                   -- quando o cookie nasceu
  criado_em             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  atualizado_em         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_leads_criado  ON leads(criado_em DESC);
CREATE INDEX idx_leads_status  ON leads(status);
CREATE INDEX idx_leads_tel     ON leads(telefone);
CREATE INDEX idx_leads_campaign ON leads(campaign_id);

-- Trilha de auditoria: quem mudou o quê e quando.
CREATE TABLE lead_eventos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id     INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  de_status   TEXT,
  para_status TEXT NOT NULL,
  operador    TEXT,
  nota        TEXT,
  em          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_eventos_lead ON lead_eventos(lead_id, em);

-- Fila de envio de conversão. Existe separada de propósito: conversão
-- duplicada no Google Ads polui a conta e não dá pra desfazer. O UNIQUE
-- garante um envio por (lead, plataforma, estágio), com retry seguro.
CREATE TABLE conversoes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id        INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  plataforma     TEXT NOT NULL CHECK (plataforma IN ('google','meta')),
  status_alvo    TEXT NOT NULL,
  estado         TEXT NOT NULL DEFAULT 'pendente'
                   CHECK (estado IN ('pendente','enviado','falhou','ignorado')),
  tentativas     INTEGER NOT NULL DEFAULT 0,
  valor_centavos INTEGER,
  ocorrido_em    TEXT NOT NULL,                 -- momento do evento de negócio
  payload        TEXT,                          -- o que foi (ou seria) enviado
  resposta       TEXT,
  enviado_em     TEXT,
  criado_em      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (lead_id, plataforma, status_alvo)
);

CREATE INDEX idx_conversoes_pendentes ON conversoes(estado, tentativas);

-- Cache de token OAuth e outros pares chave/valor. Evita precisar de um
-- binding de KV só para isso (e o KV gratuito só permite 1.000 escritas/dia).
CREATE TABLE config (
  chave     TEXT PRIMARY KEY,
  valor     TEXT NOT NULL,
  expira_em TEXT
);
