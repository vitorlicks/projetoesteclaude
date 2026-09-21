/**
 * Conversions API do Meta.
 *
 * O que faz o evento casar com o anúncio, em ordem de força:
 *  - fbc  (montado a partir do fbclid que o tracker guardou)
 *  - fbp  (cookie do pixel, identifica o navegador)
 *  - telefone/email com hash
 *
 * event_id existe para deduplicar com o pixel do navegador: se o site já
 * dispara 'Lead' no clique do botão, sem event_id o Meta contaria dois.
 */
import type { Env, Lead } from '../types';
import { paraEpoch } from '../lib/tempo';
import { hashTelefone, hashEmail, hashNome } from '../lib/hash';

export interface ConversaoMeta {
  lead: Lead;
  status: string;
  valorCentavos: number | null;
  ocorridoEm: string;
}

export function eventosConfigurados(env: Env): Record<string, string> {
  try {
    const mapa = JSON.parse(env.META_EVENTS || '{}') as Record<string, unknown>;
    const saida: Record<string, string> = {};
    for (const [k, v] of Object.entries(mapa)) {
      if (typeof v === 'string' && v.trim()) saida[k] = v.trim();
    }
    return saida;
  } catch {
    return {};
  }
}

/**
 * fbc no formato exigido: fb.<subdomínios>.<timestamp ms>.<fbclid>.
 * O timestamp deve ser o do clique — usamos o primeiro toque, que é quando o
 * tracker viu o fbclid pela primeira vez.
 */
export function montarFbc(fbclid: string, primeiroToque: string | null): string {
  const ts = primeiroToque ? Date.parse(primeiroToque) : Date.now();
  return `fb.1.${Number.isNaN(ts) ? Date.now() : ts}.${fbclid}`;
}

export async function montarEvento(
  env: Env,
  item: ConversaoMeta,
): Promise<Record<string, unknown> | null> {
  const eventos = eventosConfigurados(env);
  const nome = eventos[item.status];
  if (!nome) return null;

  const dadosUsuario: Record<string, unknown> = {};

  if (item.lead.fbclid) dadosUsuario.fbc = montarFbc(item.lead.fbclid, item.lead.primeiro_toque_em);
  if (item.lead.fbp) dadosUsuario.fbp = item.lead.fbp;

  const tel = await hashTelefone(item.lead.telefone);
  if (tel) dadosUsuario.ph = [tel];
  const email = await hashEmail(item.lead.email);
  if (email) dadosUsuario.em = [email];
  if (item.lead.nome) {
    const primeiro = await hashNome(item.lead.nome.split(' ')[0] ?? null);
    if (primeiro) dadosUsuario.fn = [primeiro];
  }
  if (item.lead.pais) dadosUsuario.country = [item.lead.pais.toLowerCase()];

  // Sem nenhum identificador o Meta descarta o evento — melhor nem gastar a
  // chamada e deixar isso explícito no log.
  if (Object.keys(dadosUsuario).length === 0) return null;

  const evento: Record<string, unknown> = {
    event_name: nome,
    event_time: paraEpoch(item.ocorridoEm),
    event_id: `rastro-${item.lead.id}-${item.status}`,
    // A conversa começou no site; é de lá que vem o fbc.
    action_source: item.lead.fbclid || item.lead.fbp ? 'website' : 'chat',
    user_data: dadosUsuario,
  };

  if (item.lead.landing_url) evento.event_source_url = item.lead.landing_url;

  if (item.valorCentavos !== null) {
    evento.custom_data = {
      value: item.valorCentavos / 100,
      currency: env.CURRENCY,
      content_category: 'reserva',
    };
  }

  return evento;
}

export interface ResultadoEnvio {
  ok: boolean;
  status: number;
  corpo: string;
}

export async function enviarLote(
  env: Env,
  eventos: Array<Record<string, unknown>>,
  testMode: boolean,
): Promise<ResultadoEnvio> {
  if (!env.META_DATASET_ID || !env.META_ACCESS_TOKEN) {
    throw new Error('META_DATASET_ID ou META_ACCESS_TOKEN não configurados');
  }

  const versao = env.META_API_VERSION || 'v21.0';
  const url = `https://graph.facebook.com/${versao}/${env.META_DATASET_ID}/events`;

  const corpo: Record<string, unknown> = {
    data: eventos,
    access_token: env.META_ACCESS_TOKEN,
  };
  // Em modo de teste o evento aparece no Gerenciador de Eventos mas não entra
  // na otimização — é o equivalente ao validateOnly do Google.
  if (testMode) corpo.test_event_code = 'TEST_RASTRO';

  const resposta = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  });

  const texto = await resposta.text();
  return { ok: resposta.ok, status: resposta.status, corpo: texto.slice(0, 4000) };
}
