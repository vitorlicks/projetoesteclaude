/**
 * Entrada no painel: senha compartilhada + nome do operador.
 *
 * O nome não é identidade verificada — é a trilha de auditoria ("quem marcou
 * essa reserva como perdida"). Vai assinado dentro do cookie, então ninguém
 * troca pelo devtools.
 */
import { Hono, type MiddlewareHandler } from 'hono';
import type { Env } from '../types';
import {
  criarSessao,
  lerSessao,
  cookieSessao,
  cookieLimpo,
  igualSeguro,
  NOME_COOKIE_SESSAO,
} from '../lib/sessao';
import { cookie } from '../lib/atribuicao';
import { pagina, esc } from '../ui';

export const auth = new Hono<{ Bindings: Env }>();

export const exigirSessao: MiddlewareHandler<{
  Bindings: Env;
  Variables: { operador: string };
}> = async (c, next) => {
  const segredo = c.env.SESSION_SECRET;
  if (!segredo) {
    return c.html(
      pagina({
        titulo: 'Configuração incompleta',
        corpo:
          '<div class="aviso erro"><strong>SESSION_SECRET não configurado.</strong> Rode <code>wrangler secret put SESSION_SECRET</code> com um valor aleatório antes de usar o painel.</div>',
      }),
      500,
    );
  }

  const sessao = await lerSessao(
    cookie(c.req.header('cookie') ?? null, NOME_COOKIE_SESSAO),
    segredo,
  );
  if (!sessao) {
    const destino = new URL(c.req.url).pathname;
    return c.redirect(`/entrar?de=${encodeURIComponent(destino)}`, 302);
  }

  c.set('operador', sessao.operador);
  await next();
};

auth.get('/entrar', (c) => {
  const de = c.req.query('de') ?? '/';
  return c.html(telaLogin(de, null));
});

auth.post('/entrar', async (c) => {
  const form = await c.req.parseBody();
  const de = typeof form.de === 'string' && form.de.startsWith('/') ? form.de : '/';
  const senha = String(form.senha ?? '');
  const operador = String(form.operador ?? '').trim();

  if (!c.env.APP_PASSWORD || !c.env.SESSION_SECRET) {
    return c.html(telaLogin(de, 'Servidor sem APP_PASSWORD/SESSION_SECRET configurados.'), 500);
  }
  if (!operador) {
    return c.html(telaLogin(de, 'Diga seu nome — é o que fica no histórico do lead.'), 400);
  }
  if (!igualSeguro(senha, c.env.APP_PASSWORD)) {
    return c.html(telaLogin(de, 'Senha incorreta.'), 401);
  }

  const valor = await criarSessao(operador, c.env.SESSION_SECRET);
  const resposta = c.redirect(de, 303);
  resposta.headers.append('set-cookie', cookieSessao(valor));
  return resposta;
});

auth.post('/sair', (c) => {
  const resposta = c.redirect('/entrar', 303);
  resposta.headers.append('set-cookie', cookieLimpo());
  return resposta;
});

function telaLogin(de: string, erro: string | null): string {
  return pagina({
    titulo: 'Entrar',
    corpo: `
<div style="max-width:380px;margin:48px auto 0">
  <h1>Entrar</h1>
  <p class="sub">Painel interno da agência.</p>
  ${erro ? `<div class="aviso erro">${esc(erro)}</div>` : ''}
  <form method="post" action="/entrar" class="cartao">
    <input type="hidden" name="de" value="${esc(de)}">
    <div style="margin-bottom:14px">
      <label for="operador">Seu nome</label>
      <input id="operador" name="operador" autocomplete="name" required autofocus>
    </div>
    <div style="margin-bottom:18px">
      <label for="senha">Senha</label>
      <input id="senha" name="senha" type="password" autocomplete="current-password" required>
    </div>
    <button class="primario" type="submit" style="width:100%">Entrar</button>
  </form>
</div>`,
  });
}
