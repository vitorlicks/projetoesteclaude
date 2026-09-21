export interface Env {
  DB: D1Database;

  // vars (wrangler.jsonc)
  COOKIE_DOMAIN: string;
  TRACKER_ORIGIN: string;
  ALLOWED_ORIGINS: string;
  DEFAULT_SLUG: string;
  TIMEZONE_OFFSET: string;
  CURRENCY: string;
  RETENTION_MONTHS: string;
  GOOGLE_ADS_API_VERSION: string;
  META_API_VERSION: string;
  DRY_RUN: string;
  GOOGLE_CONVERSION_ACTIONS: string;
  META_EVENTS: string;

  // secrets (wrangler secret put)
  APP_PASSWORD?: string;
  SESSION_SECRET?: string;
  GOOGLE_ADS_DEVELOPER_TOKEN?: string;
  GOOGLE_ADS_CLIENT_ID?: string;
  GOOGLE_ADS_CLIENT_SECRET?: string;
  GOOGLE_ADS_REFRESH_TOKEN?: string;
  GOOGLE_ADS_CUSTOMER_ID?: string;
  GOOGLE_ADS_LOGIN_CUSTOMER_ID?: string;
  META_DATASET_ID?: string;
  META_ACCESS_TOKEN?: string;
}

export interface Destino {
  slug: string;
  rotulo: string;
  numero_whatsapp: string;
  template_mensagem: string;
  ativo: number;
}

export interface Lead {
  id: number;
  codigo: string;
  canal: 'whatsapp' | 'formulario';
  destino_slug: string | null;
  status: string;

  nome: string | null;
  telefone: string | null;
  email: string | null;

  check_in: string | null;
  check_out: string | null;
  adultos: number | null;
  criancas: number | null;
  tipo_quarto: string | null;
  valor_cotado_centavos: number | null;
  valor_reserva_centavos: number | null;
  motivo_perda: string | null;
  observacoes: string | null;

  gclid: string | null;
  wbraid: string | null;
  gbraid: string | null;
  fbclid: string | null;
  fbp: string | null;

  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;

  keyword: string | null;
  matchtype: string | null;
  campaign_id: string | null;
  adgroup_id: string | null;
  creative_id: string | null;
  network: string | null;
  device: string | null;
  placement: string | null;

  landing_url: string | null;
  referrer: string | null;
  pais: string | null;
  tipo_dispositivo: string | null;

  primeiro_toque_em: string | null;
  criado_em: string;
  atualizado_em: string;
}

export interface Conversao {
  id: number;
  lead_id: number;
  plataforma: 'google' | 'meta';
  status_alvo: string;
  estado: 'pendente' | 'enviado' | 'falhou' | 'ignorado';
  tentativas: number;
  valor_centavos: number | null;
  ocorrido_em: string;
  payload: string | null;
  resposta: string | null;
  enviado_em: string | null;
  criado_em: string;
}

export interface Sessao {
  operador: string;
  expira: number;
}
