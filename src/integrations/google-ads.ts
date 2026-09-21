/**
 * Importação de conversão offline no Google Ads.
 *
 * Duas estratégias, nesta ordem de preferência:
 *  1. GCLID — casamento determinístico, é o ideal.
 *  2. Enhanced Conversions for Leads — casa pelo telefone com hash. É o que
 *     salva o tráfego de iOS (que chega com wbraid/gbraid) e quem voltou ao
 *     site por outro caminho. No nosso caso é forte: numa cotação por
 *     WhatsApp a gente sempre tem o telefone.
 */
import type { Env, Lead } from '../types';
import { paraGoogleDateTime } from '../lib/tempo';
import { hashTelefone, hashEmail, hashNome } from '../lib/hash';

export interface ConversaoGoogle {
  lead: Lead;
  status: string;
  valorCentavos: number | null;
  ocorridoEm: string;
}

interface TokenCache {
  valor: string;
  expira_em: string;
}

/** Access token via refresh token, com cache em D1 (o KV grátis só dá 1.000 escritas/dia). */
async function obterAccessToken(env: Env): Promise<string> {
  const cache = await env.DB.prepare(
    "SELECT valor, expira_em FROM config WHERE chave = 'google_access_token'",
  ).first<TokenCache>();

  if (cache?.valor && cache.expira_em && Date.parse(cache.expira_em) > Date.now() + 60_000) {
    return cache.valor;
  }

  const faltando = (['GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_REFRESH_TOKEN'] as const)
    .filter((k) => !env[k]);
  if (faltando.length) {
    throw new Error(`secrets do Google Ads ausentes: ${faltando.join(', ')}`);
  }

  const resposta = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_ADS_CLIENT_ID!,
      client_secret: env.GOOGLE_ADS_CLIENT_SECRET!,
      refresh_token: env.GOOGLE_ADS_REFRESH_TOKEN!,
      grant_type: 'refresh_token',
    }),
  });

  const corpo = (await resposta.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!resposta.ok || !corpo.access_token) {
    throw new Error(`falha ao renovar token do Google: ${resposta.status} ${corpo.error ?? ''}`);
  }

  const expira = new Date(Date.now() + (corpo.expires_in ?? 3600) * 1000).toISOString();
  await env.DB.prepare(
    `INSERT INTO config (chave, valor, expira_em) VALUES ('google_access_token', ?, ?)
       ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, expira_em = excluded.expira_em`,
  )
    .bind(corpo.access_token, expira)
    .run();

  return corpo.access_token;
}

/**
 * Converte a versão declarada no painel do Google Ads ("v25.1", "25.1") no
 * segmento que vai na URL REST, que usa só a versão maior: "v25".
 *
 * Existe porque a conta é identificada por uma versão com ponto, mas
 * `googleads.googleapis.com/v25.1/...` não é um caminho válido — e o erro
 * disso é um 404 em todo upload, que passa despercebido até alguém abrir a
 * tela de conversões. Se um dia o Google passar a exigir a menor no caminho,
 * é esta função que muda.
 */
export function versaoNaUrl(declarada: string): string {
  const limpa = (declarada || '').trim().replace(/^v/i, '');
  const maior = limpa.split('.')[0]?.replace(/\D/g, '');
  if (!maior) throw new Error(`GOOGLE_ADS_API_VERSION inválida: ${declarada}`);
  return `v${maior}`;
}

export function acoesConfiguradas(env: Env): Record<string, string> {
  try {
    const mapa = JSON.parse(env.GOOGLE_CONVERSION_ACTIONS || '{}') as Record<string, unknown>;
    const saida: Record<string, string> = {};
    for (const [k, v] of Object.entries(mapa)) {
      if (typeof v === 'string' && v.trim()) saida[k] = v.trim();
    }
    return saida;
  } catch {
    return {};
  }
}

/** Monta o ClickConversion de um lead. Devolve null quando não há como casar. */
export async function montarConversao(
  env: Env,
  item: ConversaoGoogle,
): Promise<Record<string, unknown> | null> {
  const acoes = acoesConfiguradas(env);
  const acaoId = acoes[item.status];
  const customerId = (env.GOOGLE_ADS_CUSTOMER_ID ?? '').replace(/\D/g, '');
  if (!acaoId || !customerId) return null;

  const conversao: Record<string, unknown> = {
    conversionAction: `customers/${customerId}/conversionActions/${acaoId}`,
    conversionDateTime: paraGoogleDateTime(item.ocorridoEm, env.TIMEZONE_OFFSET),
    // Idempotência do lado do Google: se o mesmo orderId subir duas vezes,
    // ele trata como a mesma conversão em vez de contar duas.
    orderId: `rastro-${item.lead.id}-${item.status}`,
  };

  if (item.valorCentavos !== null) {
    conversao.conversionValue = item.valorCentavos / 100;
    conversao.currencyCode = env.CURRENCY;
  }

  if (item.lead.gclid) {
    conversao.gclid = item.lead.gclid;
  } else if (item.lead.wbraid) {
    conversao.wbraid = item.lead.wbraid;
  } else if (item.lead.gbraid) {
    conversao.gbraid = item.lead.gbraid;
  }

  // Enhanced Conversions: acompanha o identificador de clique quando existe e
  // é o único caminho quando não existe.
  const identificadores: Array<Record<string, unknown>> = [];
  const tel = await hashTelefone(item.lead.telefone);
  if (tel) identificadores.push({ hashedPhoneNumber: tel });
  const email = await hashEmail(item.lead.email);
  if (email) identificadores.push({ hashedEmail: email });
  if (!tel && !email && item.lead.nome) {
    const nome = await hashNome(item.lead.nome.split(' ')[0] ?? null);
    if (nome) identificadores.push({ addressInfo: { hashedFirstName: nome } });
  }

  if (identificadores.length) {
    conversao.userIdentifiers = identificadores;
    conversao.userIdentifierSource = 'FIRST_PARTY';
  }

  // Sem gclid, sem braid e sem identificador não há o que casar.
  const temChave =
    conversao.gclid || conversao.wbraid || conversao.gbraid || identificadores.length > 0;
  return temChave ? conversao : null;
}

export interface ResultadoEnvio {
  ok: boolean;
  status: number;
  corpo: string;
}

/**
 * Sobe o lote. `validateOnly` vem de DRY_RUN: com ele ligado o Google valida
 * o payload e não grava nada — é assim que o primeiro envio real deve ser
 * testado, porque conversão importada não dá pra apagar depois.
 */
export async function enviarLote(
  env: Env,
  conversoes: Array<Record<string, unknown>>,
  validateOnly: boolean,
): Promise<ResultadoEnvio> {
  const customerId = (env.GOOGLE_ADS_CUSTOMER_ID ?? '').replace(/\D/g, '');
  const loginCustomerId = (env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ?? '').replace(/\D/g, '');
  if (!customerId) throw new Error('GOOGLE_ADS_CUSTOMER_ID não configurado');
  if (!env.GOOGLE_ADS_DEVELOPER_TOKEN) throw new Error('GOOGLE_ADS_DEVELOPER_TOKEN não configurado');

  const token = await obterAccessToken(env);
  const versao = versaoNaUrl(env.GOOGLE_ADS_API_VERSION || 'v25');
  const url = `https://googleads.googleapis.com/${versao}/customers/${customerId}:uploadClickConversions`;

  const cabecalhos: Record<string, string> = {
    authorization: `Bearer ${token}`,
    'developer-token': env.GOOGLE_ADS_DEVELOPER_TOKEN,
    'content-type': 'application/json',
  };
  if (loginCustomerId) cabecalhos['login-customer-id'] = loginCustomerId;

  const resposta = await fetch(url, {
    method: 'POST',
    headers: cabecalhos,
    body: JSON.stringify({
      conversions: conversoes,
      // Um lead com problema não pode derrubar o lote inteiro.
      partialFailureError: undefined,
      partialFailure: true,
      validateOnly,
    }),
  });

  const corpo = await resposta.text();
  return { ok: resposta.ok, status: resposta.status, corpo: corpo.slice(0, 4000) };
}

/**
 * O Google devolve 200 mesmo quando parte do lote falhou, detalhando em
 * partialFailureError. Ignorar isso é a forma clássica de achar que está
 * tudo certo enquanto nenhuma conversão entra.
 */
export function falhaParcial(corpo: string): string | null {
  try {
    const json = JSON.parse(corpo) as { partialFailureError?: { message?: string } };
    return json.partialFailureError?.message ?? null;
  } catch {
    return null;
  }
}
