/**
 * Fila de conversões: enfileirar na mudança de status, despachar no cron.
 *
 * O envio não acontece no clique do atendente de propósito. Se a API do
 * Google estiver fora do ar, quem marcou o status não pode ver um erro na
 * tela nem esperar — e o dado não pode se perder. A fila resolve os dois.
 */
import type { Env, Lead, Conversao } from './types';
import { statusDef, valorDaConversao } from './funil';
import { agora, mesesAtras } from './lib/tempo';
import * as google from './integrations/google-ads';
import * as meta from './integrations/meta';

/** Quantas conversões por execução. O teto real é o de subrequests (50). */
const LOTE = 150;
const MAX_TENTATIVAS = 5;

/**
 * Cria as linhas pendentes para um lead que chegou num status conversível.
 * O UNIQUE (lead, plataforma, status) faz disto uma operação idempotente:
 * marcar 'reserva_confirmada' três vezes não gera três conversões.
 */
export async function enfileirar(env: Env, lead: Lead, status: string): Promise<void> {
  const def = statusDef(status);
  if (!def?.conversivel) return;

  const valor = valorDaConversao(lead, status);
  const ts = agora();
  const plataformas: Array<'google' | 'meta'> = [];

  if (google.acoesConfiguradas(env)[status]) plataformas.push('google');
  if (meta.eventosConfigurados(env)[status] && env.META_DATASET_ID) plataformas.push('meta');

  for (const plataforma of plataformas) {
    await env.DB.prepare(
      `INSERT INTO conversoes (lead_id, plataforma, status_alvo, valor_centavos, ocorrido_em, criado_em)
         VALUES (?,?,?,?,?,?)
       ON CONFLICT(lead_id, plataforma, status_alvo) DO UPDATE SET
         valor_centavos = excluded.valor_centavos
       WHERE conversoes.estado = 'pendente'`,
    )
      .bind(lead.id, plataforma, status, valor, ts, ts)
      .run();
  }
}

interface LinhaFila extends Conversao {
  lead: Lead;
}

async function pendentes(env: Env): Promise<LinhaFila[]> {
  const { results } = await env.DB.prepare(
    `SELECT c.*, l.* , c.id AS conversao_id, c.valor_centavos AS c_valor, c.ocorrido_em AS c_ocorrido
       FROM conversoes c
       JOIN leads l ON l.id = c.lead_id
      WHERE c.estado = 'pendente' AND c.tentativas < ?
      ORDER BY c.id
      LIMIT ?`,
  )
    .bind(MAX_TENTATIVAS, LOTE)
    .all<Record<string, unknown>>();

  return (results ?? []).map((linha) => ({
    id: linha.conversao_id as number,
    lead_id: linha.lead_id as number,
    plataforma: linha.plataforma as 'google' | 'meta',
    status_alvo: linha.status_alvo as string,
    estado: 'pendente',
    tentativas: linha.tentativas as number,
    valor_centavos: (linha.c_valor as number | null) ?? null,
    ocorrido_em: linha.c_ocorrido as string,
    payload: null,
    resposta: null,
    enviado_em: null,
    criado_em: linha.criado_em as string,
    lead: linha as unknown as Lead,
  }));
}

export interface Relatorio {
  google: { montadas: number; enviadas: number; ignoradas: number; erro?: string };
  meta: { montadas: number; enviadas: number; ignoradas: number; erro?: string };
  dryRun: boolean;
}

export async function processarFila(env: Env): Promise<Relatorio> {
  const dryRun = env.DRY_RUN !== 'false';
  const fila = await pendentes(env);
  const relatorio: Relatorio = {
    google: { montadas: 0, enviadas: 0, ignoradas: 0 },
    meta: { montadas: 0, enviadas: 0, ignoradas: 0 },
    dryRun,
  };
  if (!fila.length) return relatorio;

  const lotes = {
    google: [] as Array<{ id: number; payload: Record<string, unknown> }>,
    meta: [] as Array<{ id: number; payload: Record<string, unknown> }>,
  };

  for (const item of fila) {
    const comum = {
      lead: item.lead,
      status: item.status_alvo,
      valorCentavos: item.valor_centavos,
      ocorridoEm: item.ocorrido_em,
    };

    const payload =
      item.plataforma === 'google'
        ? await google.montarConversao(env, comum)
        : await meta.montarEvento(env, comum);

    if (!payload) {
      // Nada que case com o anúncio: sem gclid, sem braid, sem telefone.
      // Marcamos como ignorado para não ficar tentando eternamente, mas fica
      // visível na tela de auditoria — é assim que se descobre tag quebrada.
      await env.DB.prepare(
        `UPDATE conversoes SET estado = 'ignorado', resposta = ?, enviado_em = ? WHERE id = ?`,
      )
        .bind('sem identificador para casar (gclid/braid/telefone ausentes)', agora(), item.id)
        .run();
      relatorio[item.plataforma].ignoradas++;
      continue;
    }

    lotes[item.plataforma].push({ id: item.id, payload });
    relatorio[item.plataforma].montadas++;
  }

  await despachar(env, 'google', lotes.google, dryRun, relatorio);
  await despachar(env, 'meta', lotes.meta, dryRun, relatorio);

  return relatorio;
}

async function despachar(
  env: Env,
  plataforma: 'google' | 'meta',
  lote: Array<{ id: number; payload: Record<string, unknown> }>,
  dryRun: boolean,
  relatorio: Relatorio,
): Promise<void> {
  if (!lote.length) return;

  // Guarda o payload sempre — inclusive em dry run. É o que permite conferir
  // na tela antes de virar a chave.
  for (const item of lote) {
    await env.DB.prepare('UPDATE conversoes SET payload = ? WHERE id = ?')
      .bind(JSON.stringify(item.payload), item.id)
      .run();
  }

  let resultado: { ok: boolean; status: number; corpo: string };
  try {
    resultado =
      plataforma === 'google'
        ? await google.enviarLote(env, lote.map((i) => i.payload), dryRun)
        : await meta.enviarLote(env, lote.map((i) => i.payload), dryRun);
  } catch (erro) {
    const msg = String(erro).slice(0, 1000);
    relatorio[plataforma].erro = msg;
    await marcarFalha(env, lote.map((i) => i.id), msg);
    return;
  }

  const parcial = plataforma === 'google' ? google.falhaParcial(resultado.corpo) : null;

  if (!resultado.ok || parcial) {
    const msg = parcial
      ? `falha parcial: ${parcial}`
      : `HTTP ${resultado.status}: ${resultado.corpo.slice(0, 500)}`;
    relatorio[plataforma].erro = msg;
    await marcarFalha(env, lote.map((i) => i.id), msg);
    return;
  }

  // Em dry run o payload foi validado mas nada entrou na conta. Deixamos
  // pendente de propósito: quando DRY_RUN virar false, sobe de verdade.
  if (dryRun) {
    await env.DB.prepare(
      `UPDATE conversoes SET tentativas = tentativas, resposta = ?
         WHERE id IN (${lote.map(() => '?').join(',')})`,
    )
      .bind(`dry run ok (HTTP ${resultado.status})`, ...lote.map((i) => i.id))
      .run();
    return;
  }

  await env.DB.prepare(
    `UPDATE conversoes SET estado = 'enviado', enviado_em = ?, resposta = ?,
       tentativas = tentativas + 1
       WHERE id IN (${lote.map(() => '?').join(',')})`,
  )
    .bind(agora(), `HTTP ${resultado.status}`, ...lote.map((i) => i.id))
    .run();

  relatorio[plataforma].enviadas += lote.length;
}

async function marcarFalha(env: Env, ids: number[], mensagem: string): Promise<void> {
  if (!ids.length) return;
  await env.DB.prepare(
    `UPDATE conversoes
        SET tentativas = tentativas + 1,
            resposta = ?,
            estado = CASE WHEN tentativas + 1 >= ? THEN 'falhou' ELSE 'pendente' END
      WHERE id IN (${ids.map(() => '?').join(',')})`,
  )
    .bind(mensagem, MAX_TENTATIVAS, ...ids)
    .run();
}

/**
 * Retenção: some com lead antigo. Está aqui e não num cron próprio porque o
 * plano gratuito dá 5 triggers e não vale gastar um com isso.
 */
export async function aplicarRetencao(env: Env): Promise<number> {
  const meses = Number(env.RETENTION_MONTHS || '18');
  if (!Number.isFinite(meses) || meses <= 0) return 0;

  const limite = mesesAtras(meses);
  const resultado = await env.DB.prepare('DELETE FROM leads WHERE criado_em < ?')
    .bind(limite)
    .run();
  return resultado.meta.changes ?? 0;
}
