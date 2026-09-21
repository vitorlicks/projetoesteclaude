/**
 * Rastro — rastreio e atribuição de leads.
 *
 * Um Worker só, na conta Cloudflare do cliente: coleta, painel e envio de
 * conversão. O que é público (/r.js, /w/:slug, /api/lead) fica antes da
 * autenticação; todo o resto exige sessão.
 */
import { Hono } from 'hono';
import type { Env } from './types';
import { coleta } from './routes/coleta';
import { auth } from './routes/auth';
import { painel } from './routes/painel';
import { processarFila, aplicarRetencao } from './conversoes';

const app = new Hono<{ Bindings: Env }>();

app.route('/', coleta);
app.route('/', auth);
app.route('/', painel);

app.notFound((c) => c.text('Não encontrado.', 404));

app.onError((erro, c) => {
  console.error('erro não tratado', erro);
  return c.text('Erro interno.', 500);
});

export default {
  fetch: app.fetch,

  async scheduled(evento: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        const relatorio = await processarFila(env);
        console.log('fila de conversões', JSON.stringify(relatorio));

        // Retenção uma vez por dia, de madrugada: não vale gastar um dos 5
        // cron triggers do plano gratuito só para isso.
        if (new Date(evento.scheduledTime).getUTCHours() === 7) {
          const apagados = await aplicarRetencao(env);
          if (apagados) console.log(`retenção: ${apagados} lead(s) apagado(s)`);
        }
      })(),
    );
  },
} satisfies ExportedHandler<Env>;
