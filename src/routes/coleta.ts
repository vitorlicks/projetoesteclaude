/**
 * Coleta: as três rotas públicas. Tudo que é rastreio passa por aqui.
 *
 *   GET  /r.js        -> o tracker
 *   GET  /w/:slug     -> redirect do WhatsApp (cria o lead, injeta o código)
 *   POST /api/lead    -> formulário do site
 */
import { Hono } from 'hono';
import type { Env, Destino } from '../types';
import { montarTracker } from '../tracker';
import {
  COOKIE_CTX,
  COOKIE_CODE,
  cookie,
  lerContexto,
  pareceRobo,
  tipoDispositivo,
  type Contexto,
} from '../lib/atribuicao';
import { gerarCodigo } from '../lib/codigo';
import { normalizarTelefone, normalizarEmail } from '../lib/hash';
import { agora } from '../lib/tempo';
import * as N from '../lib/normalizar';

export const coleta = new Hono<{ Bindings: Env }>();

/** Janela em que um novo clique do mesmo navegador reaproveita o lead. */
const JANELA_DEDUPE_MIN = 30;

// ---------------------------------------------------------------- tracker

coleta.get('/r.js', (c) => {
  const js = montarTracker({
    cookieDomain: c.env.COOKIE_DOMAIN,
    origem: c.env.TRACKER_ORIGIN,
    slugPadrao: c.env.DEFAULT_SLUG,
  });
  return new Response(js, {
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      // Curto de propósito: um ajuste no tracker precisa chegar no site do
      // cliente no mesmo dia, sem esperar cache de uma semana.
      'cache-control': 'public, max-age=900',
      'access-control-allow-origin': '*',
    },
  });
});

// ------------------------------------------------------- redirect WhatsApp

coleta.get('/w/:slug', async (c) => {
  const ua = c.req.header('user-agent') ?? null;
  const slug = c.req.param('slug');
  const numeroDoLink = c.req.query('n');

  const destino = await acharDestino(c.env, slug, numeroDoLink);
  if (!destino) return c.text('Destino não configurado.', 404);

  // Pré-visualização de link e varredura de SEO não são gente querendo quarto.
  // Sem este corte, cada compartilhamento no WhatsApp viraria lead e, pior,
  // conversão falsa no Google Ads.
  if (pareceRobo(ua)) {
    return c.redirect(montarUrlWhatsApp(destino, null), 302);
  }

  const ctx = lerContexto(cookie(c.req.header('cookie') ?? null, COOKIE_CTX));

  // Mesma pessoa clicando de novo em poucos minutos é a mesma conversa.
  const codigoAnterior = cookie(c.req.header('cookie') ?? null, COOKIE_CODE);
  let codigo = await reaproveitar(c.env, codigoAnterior);

  if (!codigo) {
    codigo = await inserirLead(c.env, {
      canal: 'whatsapp',
      destino_slug: destino.slug,
      ctx,
      pais: c.req.raw.cf?.country as string | undefined,
      dispositivo: tipoDispositivo(ua),
    });
  }

  const resposta = c.redirect(montarUrlWhatsApp(destino, codigo), 302);
  resposta.headers.append(
    'set-cookie',
    `${COOKIE_CODE}=${codigo}; Path=/; Secure; SameSite=Lax; Max-Age=${JANELA_DEDUPE_MIN * 60}`,
  );
  // O redirect nunca pode ficar em cache: cada clique gera código próprio.
  resposta.headers.set('cache-control', 'no-store');
  return resposta;
});

async function acharDestino(
  env: Env,
  slug: string,
  numero: string | undefined,
): Promise<Destino | null> {
  const porSlug = await env.DB.prepare(
    'SELECT * FROM destinos WHERE slug = ? AND ativo = 1',
  )
    .bind(slug)
    .first<Destino>();
  if (porSlug) return porSlug;

  // O site pode ter um botão com número cravado que ninguém mapeou ainda.
  if (numero) {
    const porNumero = await env.DB.prepare(
      'SELECT * FROM destinos WHERE numero_whatsapp = ? AND ativo = 1',
    )
      .bind(numero.replace(/\D/g, ''))
      .first<Destino>();
    if (porNumero) return porNumero;
  }

  return env.DB.prepare('SELECT * FROM destinos WHERE ativo = 1 ORDER BY rowid LIMIT 1').first<Destino>();
}

function montarUrlWhatsApp(destino: Destino, codigo: string | null): string {
  const texto = codigo
    ? destino.template_mensagem.replace('{codigo}', codigo)
    : destino.template_mensagem.replace(/\s*\[#\{codigo\}\]\s*/, '').trim();
  return `https://wa.me/${destino.numero_whatsapp}?text=${encodeURIComponent(texto)}`;
}

async function reaproveitar(env: Env, codigo: string | undefined): Promise<string | null> {
  if (!codigo) return null;
  const limite = new Date(Date.now() - JANELA_DEDUPE_MIN * 60_000).toISOString();
  const achado = await env.DB.prepare(
    "SELECT codigo FROM leads WHERE codigo = ? AND criado_em > ? AND status = 'novo'",
  )
    .bind(codigo, limite)
    .first<{ codigo: string }>();
  return achado?.codigo ?? null;
}

// --------------------------------------------------------------- formulário

coleta.options('/api/lead', (c) => {
  return new Response(null, { status: 204, headers: cors(c.env, c.req.header('origin')) });
});

coleta.post('/api/lead', async (c) => {
  const origem = c.req.header('origin');
  const cabecalhos = cors(c.env, origem);

  // sendBeacon manda text/plain; origem de fora da lista é descartada.
  if (origem && !origensPermitidas(c.env).includes(origem)) {
    return new Response(null, { status: 204, headers: cabecalhos });
  }
  if (pareceRobo(c.req.header('user-agent') ?? null)) {
    return new Response(null, { status: 204, headers: cabecalhos });
  }

  let corpo: Record<string, unknown>;
  try {
    corpo = JSON.parse(await c.req.text()) as Record<string, unknown>;
  } catch {
    return new Response(null, { status: 204, headers: cabecalhos });
  }

  const telefone = normalizarTelefone(N.texto(corpo.telefone, 40));
  const email = normalizarEmail(N.texto(corpo.email, 160));
  // Sem nenhuma forma de contato não há lead — só ruído de formulário de busca.
  if (!telefone && !email) {
    return new Response(null, { status: 204, headers: cabecalhos });
  }

  const ctx = lerContexto(
    typeof corpo.ctx === 'string' ? corpo.ctx : encodeURIComponent(JSON.stringify(corpo.ctx ?? {})),
  );
  if (!ctx.landing_url && typeof corpo.pagina === 'string') {
    ctx.landing_url = corpo.pagina.slice(0, 512);
  }

  // Duplo submit e formulário em duas etapas geram a mesma pessoa duas vezes.
  const duplicado = await acharDuplicado(c.env, telefone, email);
  if (duplicado) {
    await c.env.DB.prepare(
      `UPDATE leads SET nome = COALESCE(?, nome), email = COALESCE(?, email),
         check_in = COALESCE(?, check_in), check_out = COALESCE(?, check_out),
         adultos = COALESCE(?, adultos), criancas = COALESCE(?, criancas),
         observacoes = COALESCE(?, observacoes), atualizado_em = ?
       WHERE id = ?`,
    )
      .bind(
        N.texto(corpo.nome, 120),
        email,
        N.data(corpo.check_in),
        N.data(corpo.check_out),
        N.inteiro(corpo.adultos),
        N.inteiro(corpo.criancas),
        N.texto(corpo.observacoes, 1000),
        agora(),
        duplicado,
      )
      .run();
    return new Response(null, { status: 204, headers: cabecalhos });
  }

  await inserirLead(c.env, {
    canal: 'formulario',
    destino_slug: null,
    ctx,
    pais: c.req.raw.cf?.country as string | undefined,
    dispositivo: tipoDispositivo(c.req.header('user-agent') ?? null),
    contato: {
      nome: N.texto(corpo.nome, 120),
      telefone,
      email,
      check_in: N.data(corpo.check_in),
      check_out: N.data(corpo.check_out),
      adultos: N.inteiro(corpo.adultos),
      criancas: N.inteiro(corpo.criancas),
      observacoes: N.texto(corpo.observacoes, 1000),
    },
  });

  return new Response(null, { status: 204, headers: cabecalhos });
});

async function acharDuplicado(
  env: Env,
  telefone: string | null,
  email: string | null,
): Promise<number | null> {
  const limite = new Date(Date.now() - 30 * 60_000).toISOString();
  const achado = await env.DB.prepare(
    `SELECT id FROM leads
      WHERE criado_em > ?
        AND ((? IS NOT NULL AND telefone = ?) OR (? IS NOT NULL AND email = ?))
      ORDER BY id DESC LIMIT 1`,
  )
    .bind(limite, telefone, telefone, email, email)
    .first<{ id: number }>();
  return achado?.id ?? null;
}

function origensPermitidas(env: Env): string[] {
  return env.ALLOWED_ORIGINS.split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

function cors(env: Env, origem: string | undefined): Record<string, string> {
  const permitidas = origensPermitidas(env);
  const alvo = origem && permitidas.includes(origem) ? origem : (permitidas[0] ?? '*');
  return {
    'access-control-allow-origin': alvo,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
  };
}

// ------------------------------------------------------------- persistência

interface NovoLead {
  canal: 'whatsapp' | 'formulario';
  destino_slug: string | null;
  ctx: Contexto;
  pais?: string | undefined;
  dispositivo: string | null;
  contato?: {
    nome: string | null;
    telefone: string | null;
    email: string | null;
    check_in: string | null;
    check_out: string | null;
    adultos: number | null;
    criancas: number | null;
    observacoes: string | null;
  };
}

/**
 * Insere o lead e devolve o código. Tenta de novo em colisão de código —
 * são ~700 mil combinações, mas o UNIQUE é quem manda.
 */
async function inserirLead(env: Env, dados: NovoLead): Promise<string> {
  const { ctx } = dados;
  const ts = agora();

  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const codigo = gerarCodigo();
    try {
      await env.DB.prepare(
        `INSERT INTO leads (
           codigo, canal, destino_slug, status,
           nome, telefone, email, check_in, check_out, adultos, criancas, observacoes,
           gclid, wbraid, gbraid, fbclid, fbp,
           utm_source, utm_medium, utm_campaign, utm_term, utm_content,
           keyword, matchtype, campaign_id, adgroup_id, creative_id, network, device, placement,
           landing_url, referrer, pais, tipo_dispositivo,
           primeiro_toque_em, criado_em, atualizado_em
         ) VALUES (?,?,?,'novo', ?,?,?,?,?,?,?,?, ?,?,?,?,?, ?,?,?,?,?, ?,?,?,?,?,?,?,?, ?,?,?,?, ?,?,?)`,
      )
        .bind(
          codigo,
          dados.canal,
          dados.destino_slug,
          dados.contato?.nome ?? null,
          dados.contato?.telefone ?? null,
          dados.contato?.email ?? null,
          dados.contato?.check_in ?? null,
          dados.contato?.check_out ?? null,
          dados.contato?.adultos ?? null,
          dados.contato?.criancas ?? null,
          dados.contato?.observacoes ?? null,
          ctx.gclid ?? null,
          ctx.wbraid ?? null,
          ctx.gbraid ?? null,
          ctx.fbclid ?? null,
          ctx.fbp ?? null,
          ctx.utm_source ?? null,
          ctx.utm_medium ?? null,
          ctx.utm_campaign ?? null,
          ctx.utm_term ?? null,
          ctx.utm_content ?? null,
          ctx.keyword ?? null,
          ctx.matchtype ?? null,
          ctx.campaign_id ?? null,
          ctx.adgroup_id ?? null,
          ctx.creative_id ?? null,
          ctx.network ?? null,
          ctx.device ?? null,
          ctx.placement ?? null,
          ctx.landing_url ?? null,
          ctx.referrer ?? null,
          dados.pais ?? null,
          dados.dispositivo,
          ctx.primeiro_toque_em ?? null,
          ts,
          ts,
        )
        .run();
      return codigo;
    } catch (erro) {
      const msg = String(erro);
      if (!/UNIQUE|constraint/i.test(msg) || tentativa === 4) throw erro;
    }
  }
  throw new Error('não foi possível gerar código único');
}

