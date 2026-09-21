/**
 * Contexto de atribuição: o que o navegador guarda no cookie e o que o Worker
 * lê de volta na hora do clique.
 *
 * As chaves são curtas de propósito — o cookie tem teto de ~4 KB e viaja em
 * toda requisição ao domínio. A lista é a mesma usada pelo tracker.ts, que a
 * interpola no script servido ao navegador; não edite uma sem a outra.
 */

/** Parâmetro de URL -> chave no cookie. */
export const PARAMS: Readonly<Record<string, string>> = {
  gclid: 'gc',
  wbraid: 'wb',
  gbraid: 'gb',
  fbclid: 'fc',
  utm_source: 'us',
  utm_medium: 'um',
  utm_campaign: 'uc',
  utm_term: 'ut',
  utm_content: 'uo',
  // ValueTrack do Google Ads (quem configura o modelo de URL escolhe os nomes;
  // estes são os que a agência usa por padrão)
  keyword: 'kw',
  matchtype: 'mt',
  campaignid: 'ci',
  adgroupid: 'ai',
  creative: 'cr',
  network: 'nw',
  device: 'dv',
  placement: 'pl',
};

export const COOKIE_CTX = '_rastro';
export const COOKIE_CODE = '_rastro_c';

export interface Contexto {
  gclid?: string;
  wbraid?: string;
  gbraid?: string;
  fbclid?: string;
  fbp?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  keyword?: string;
  matchtype?: string;
  campaign_id?: string;
  adgroup_id?: string;
  creative_id?: string;
  network?: string;
  device?: string;
  placement?: string;
  landing_url?: string;
  referrer?: string;
  primeiro_toque_em?: string;
}

/** Chave curta no cookie -> campo do lead no banco. */
const DE_CURTA: Readonly<Record<string, keyof Contexto>> = {
  gc: 'gclid',
  wb: 'wbraid',
  gb: 'gbraid',
  fc: 'fbclid',
  fbp: 'fbp',
  us: 'utm_source',
  um: 'utm_medium',
  uc: 'utm_campaign',
  ut: 'utm_term',
  uo: 'utm_content',
  kw: 'keyword',
  mt: 'matchtype',
  ci: 'campaign_id',
  ai: 'adgroup_id',
  cr: 'creative_id',
  nw: 'network',
  dv: 'device',
  pl: 'placement',
  lu: 'landing_url',
  rf: 'referrer',
  t0: 'primeiro_toque_em',
};

const LIMITE_VALOR = 512;

function limpar(valor: unknown): string | undefined {
  if (typeof valor !== 'string') return undefined;
  const v = valor.trim();
  if (!v) return undefined;
  // ValueTrack não substituído ('{keyword}') é ruído, não dado.
  if (v.startsWith('{') && v.endsWith('}')) return undefined;
  return v.slice(0, LIMITE_VALOR);
}

/** Lê o cookie `_rastro` (JSON com chaves curtas) e devolve o contexto. */
export function lerContexto(bruto: string | undefined | null): Contexto {
  if (!bruto) return {};
  let obj: unknown;
  try {
    obj = JSON.parse(decodeURIComponent(bruto));
  } catch {
    return {};
  }
  if (typeof obj !== 'object' || obj === null) return {};

  const ctx: Contexto = {};
  for (const [curta, campo] of Object.entries(DE_CURTA)) {
    const v = limpar((obj as Record<string, unknown>)[curta]);
    if (v !== undefined) ctx[campo] = v;
  }
  return ctx;
}

/** Extrai um cookie específico do header Cookie. */
export function cookie(header: string | null, nome: string): string | undefined {
  if (!header) return undefined;
  for (const parte of header.split(';')) {
    const i = parte.indexOf('=');
    if (i === -1) continue;
    if (parte.slice(0, i).trim() === nome) return parte.slice(i + 1).trim();
  }
  return undefined;
}

/**
 * Classificação grossa de dispositivo. De propósito não guardamos o
 * user-agent inteiro: para decidir campanha basta saber se é celular.
 */
export function tipoDispositivo(ua: string | null): string | null {
  if (!ua) return null;
  const s = ua.toLowerCase();
  if (/ipad|tablet|playbook|silk/.test(s)) return 'tablet';
  if (/mobi|iphone|android.*mobile|phone/.test(s)) return 'celular';
  return 'computador';
}

const BOTS =
  /bot|crawl|spider|slurp|preview|monitor|curl|wget|headless|lighthouse|pingdom|facebookexternalhit|whatsapp|telegram|semrush|ahrefs|gtmetrix/i;

/**
 * Filtro de ruído. Sem isso, o pré-carregamento de link do WhatsApp e cada
 * varredura de SEO criariam "lead" no banco e conversão falsa no Google Ads.
 */
export function pareceRobo(ua: string | null): boolean {
  if (!ua) return true;
  return BOTS.test(ua);
}
