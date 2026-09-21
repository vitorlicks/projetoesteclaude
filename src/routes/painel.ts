/**
 * Painel interno: lista de leads, detalhe, relatório por campanha e auditoria
 * de envio de conversão.
 */
import { Hono } from 'hono';
import type { Env, Lead, Destino } from '../types';
import { FUNIL, ETAPAS, MOTIVOS_PERDA, TIPOS_QUARTO, statusDef, ehStatus, posicao, noites } from '../funil';
import { enfileirar, processarFila } from '../conversoes';
import { agora, diasAtras } from '../lib/tempo';
import { normalizarTelefone } from '../lib/hash';
import * as N from '../lib/normalizar';
import { pagina, esc, selo, barraEtapa, barraPerda, dataCurta, dataEstadia } from '../ui';
import { exigirSessao } from './auth';

export const painel = new Hono<{ Bindings: Env; Variables: { operador: string } }>();

painel.use('*', exigirSessao);

const PERIODOS: Array<[string, number]> = [
  ['7 dias', 7],
  ['30 dias', 30],
  ['90 dias', 90],
  ['365 dias', 365],
];

function diasDoPedido(valor: string | undefined): number {
  const n = Number(valor);
  return PERIODOS.some(([, d]) => d === n) ? n : 30;
}

// ------------------------------------------------------------------- leads

painel.get('/', async (c) => {
  const dias = diasDoPedido(c.req.query('dias'));
  const filtroStatus = c.req.query('status') ?? '';
  const busca = (c.req.query('q') ?? '').trim();
  const desde = diasAtras(dias);

  const condicoes = ['criado_em > ?'];
  const valores: unknown[] = [desde];

  if (ehStatus(filtroStatus)) {
    condicoes.push('status = ?');
    valores.push(filtroStatus);
  }
  if (busca) {
    condicoes.push('(codigo = ? OR nome LIKE ? OR telefone LIKE ?)');
    valores.push(busca.toUpperCase(), `%${busca}%`, `%${busca.replace(/\D/g, '')}%`);
  }

  const onde = condicoes.join(' AND ');

  const { results: leads } = await c.env.DB.prepare(
    `SELECT * FROM leads WHERE ${onde} ORDER BY criado_em DESC LIMIT 300`,
  )
    .bind(...valores)
    .all<Lead>();

  const resumo = await calcularResumo(c.env, desde);

  const corpo = `
<h1>Leads</h1>
<p class="sub">Cada linha é uma conversa que começou num anúncio. Marcar o que aconteceu é o que ensina o Google a buscar mais gente igual.</p>

${placas(resumo)}

<h2>Funil do período</h2>
<div class="cartao"><div class="funil">${funilHtml(resumo)}</div></div>

<h2>Conversas</h2>
<form class="barra-acoes" method="get" action="/">
  <div class="campo">
    <label for="f-dias">Período</label>
    <select id="f-dias" name="dias">
      ${PERIODOS.map(([r, d]) => `<option value="${d}"${d === dias ? ' selected' : ''}>${r}</option>`).join('')}
    </select>
  </div>
  <div class="campo">
    <label for="f-status">Status</label>
    <select id="f-status" name="status">
      <option value="">Todos</option>
      ${FUNIL.map((s) => `<option value="${s.id}"${s.id === filtroStatus ? ' selected' : ''}>${esc(s.rotulo)}</option>`).join('')}
    </select>
  </div>
  <div class="campo" style="flex:1 1 220px">
    <label for="f-q">Código, nome ou telefone</label>
    <input id="f-q" name="q" value="${esc(busca)}" placeholder="K7F2">
  </div>
  <button class="secundario" type="submit">Filtrar</button>
</form>

${leads?.length ? tabelaLeads(leads) : '<div class="cartao vazio">Nenhum lead no filtro escolhido.</div>'}
`;

  return c.html(pagina({ titulo: 'Leads', aba: 'leads', operador: c.get('operador'), corpo }));
});

interface Resumo {
  total: number;
  porEtapa: number[];
  perdidos: number;
  reservas: number;
  receitaCentavos: number;
  semAtribuicao: number;
}

async function calcularResumo(env: Env, desde: string): Promise<Resumo> {
  const { results: leads } = await env.DB.prepare(
    `SELECT id, status, gclid, wbraid, gbraid, fbclid, utm_source,
            valor_reserva_centavos, valor_cotado_centavos
       FROM leads WHERE criado_em > ?`,
  )
    .bind(desde)
    .all<Partial<Lead>>();

  const lista = leads ?? [];

  // "Chegou na etapa" vem da trilha, não só do status atual: um lead que
  // recebeu cotação e depois foi perdido precisa contar na etapa de cotação,
  // senão o funil mente sobre o trabalho feito.
  const { results: eventos } = await env.DB.prepare(
    `SELECT e.lead_id, e.para_status FROM lead_eventos e
       JOIN leads l ON l.id = e.lead_id
      WHERE l.criado_em > ?`,
  )
    .bind(desde)
    .all<{ lead_id: number; para_status: string }>();

  const maiorEtapa = new Map<number, number>();
  for (const lead of lista) {
    maiorEtapa.set(lead.id as number, posicao(lead.status as string));
  }
  for (const ev of eventos ?? []) {
    const p = posicao(ev.para_status);
    const atual = maiorEtapa.get(ev.lead_id) ?? -1;
    if (p > atual) maiorEtapa.set(ev.lead_id, p);
  }

  const porEtapa = ETAPAS.map(() => 0);
  for (const alcance of maiorEtapa.values()) {
    for (let i = 0; i <= alcance && i < porEtapa.length; i++) porEtapa[i] = (porEtapa[i] ?? 0) + 1;
  }
  // Todo lead existe, então a primeira etapa é o total — inclusive os perdidos
  // logo no começo, cujo alcance é -1.
  porEtapa[0] = lista.length;

  let receita = 0;
  let reservas = 0;
  let perdidos = 0;
  let semAtribuicao = 0;

  for (const lead of lista) {
    if (lead.status === 'reserva_confirmada') {
      reservas++;
      receita += lead.valor_reserva_centavos ?? lead.valor_cotado_centavos ?? 0;
    }
    if (lead.status === 'perdido') perdidos++;
    if (!lead.gclid && !lead.wbraid && !lead.gbraid && !lead.fbclid && !lead.utm_source) {
      semAtribuicao++;
    }
  }

  return { total: lista.length, porEtapa, perdidos, reservas, receitaCentavos: receita, semAtribuicao };
}

function placas(r: Resumo): string {
  const taxa = r.total ? ((r.reservas / r.total) * 100).toFixed(1).replace('.', ',') : '0,0';
  const ticket = r.reservas ? r.receitaCentavos / r.reservas : 0;
  const cegos = r.total ? Math.round((r.semAtribuicao / r.total) * 100) : 0;

  return `<div class="placas">
  <div class="placa"><div class="rotulo">Leads</div><div class="valor">${r.total}</div><div class="nota">no período</div></div>
  <div class="placa"><div class="rotulo">Reservas</div><div class="valor">${r.reservas}</div><div class="nota">${taxa}% dos leads</div></div>
  <div class="placa"><div class="rotulo">Receita</div><div class="valor">${esc(N.moeda(r.receitaCentavos))}</div><div class="nota">confirmada</div></div>
  <div class="placa"><div class="rotulo">Ticket médio</div><div class="valor">${esc(N.moeda(Math.round(ticket)))}</div><div class="nota">por reserva</div></div>
  <div class="placa"><div class="rotulo">Sem origem</div><div class="valor">${cegos}%</div><div class="nota">${r.semAtribuicao} lead(s) sem rastro</div></div>
</div>`;
}

function funilHtml(r: Resumo): string {
  const base = r.porEtapa[0] || 1;
  const linhas = ETAPAS.map((id, i) => {
    const def = statusDef(id)!;
    const n = r.porEtapa[i] ?? 0;
    const pct = base ? Math.round((n / base) * 100) : 0;
    return `<div class="etapa">
  <div class="nome">${esc(def.rotulo)}</div>
  ${barraEtapa(i, base ? n / base : 0)}
  <div class="num">${n} <span>${pct}%</span></div>
</div>`;
  });

  linhas.push(`<div class="etapa">
  <div class="nome">${esc(statusDef('perdido')!.rotulo)}</div>
  ${barraPerda(base ? r.perdidos / base : 0)}
  <div class="num">${r.perdidos} <span>${base ? Math.round((r.perdidos / base) * 100) : 0}%</span></div>
</div>`);

  return linhas.join('');
}

function origemCurta(l: Lead): string {
  const partes: string[] = [];
  if (l.keyword) partes.push(l.keyword);
  else if (l.utm_campaign) partes.push(l.utm_campaign);
  else if (l.utm_source) partes.push(l.utm_source);

  const plataforma = l.gclid || l.wbraid || l.gbraid ? 'Google Ads' : l.fbclid ? 'Meta Ads' : null;
  if (plataforma) partes.unshift(plataforma);

  if (!partes.length) return '<span class="fraco">sem rastro</span>';
  return esc(partes.join(' · '));
}

function celulaContato(l: Lead): string {
  const linhas: string[] = [];
  if (l.nome) linhas.push(esc(l.nome));
  if (l.telefone) linhas.push(`<span class="fraco">${esc(l.telefone)}</span>`);
  return linhas.length ? linhas.join('<br>') : '<span class="fraco">—</span>';
}

function tabelaLeads(leads: Lead[]): string {
  const linhas = leads
    .map((l) => {
      const def = statusDef(l.status);
      const estadia =
        l.check_in || l.check_out
          ? `${dataEstadia(l.check_in)}→${dataEstadia(l.check_out)}`
          : '<span class="fraco">—</span>';
      const valor =
        l.valor_reserva_centavos ?? l.valor_cotado_centavos ?? null;
      const contato = celulaContato(l);
      return `<tr>
  <td data-r="Código"><a class="codigo" href="/lead/${esc(l.codigo)}">${esc(l.codigo)}</a></td>
  <td data-r="Quando" class="fraco">${esc(dataCurta(l.criado_em))}</td>
  <td data-r="Contato">${contato}</td>
  <td data-r="Origem" class="quebra">${origemCurta(l)}</td>
  <td data-r="Estadia">${estadia}</td>
  <td data-r="Status">${selo(l.status, def?.rotulo ?? l.status)}</td>
  <td data-r="Valor" class="num">${valor === null ? '<span class="fraco">—</span>' : esc(N.moeda(valor))}</td>
</tr>`;
    })
    .join('');

  return `<div class="rolagem"><table class="lista">
<thead><tr>
  <th>Código</th><th>Quando</th><th>Contato</th><th>Origem</th><th>Estadia</th><th>Status</th><th class="num">Valor</th>
</tr></thead>
<tbody>${linhas}</tbody>
</table></div>`;
}

// ------------------------------------------------------------ detalhe lead

painel.get('/lead/:codigo', async (c) => {
  const lead = await c.env.DB.prepare('SELECT * FROM leads WHERE codigo = ?')
    .bind(c.req.param('codigo').toUpperCase())
    .first<Lead>();
  if (!lead) return c.html(pagina({ titulo: 'Não encontrado', operador: c.get('operador'), corpo: '<div class="cartao vazio">Lead não encontrado.</div>' }), 404);

  const { results: eventos } = await c.env.DB.prepare(
    'SELECT * FROM lead_eventos WHERE lead_id = ? ORDER BY em DESC',
  )
    .bind(lead.id)
    .all<{ de_status: string | null; para_status: string; operador: string | null; nota: string | null; em: string }>();

  const salvo = c.req.query('ok') === '1';
  const n = noites(lead.check_in, lead.check_out);

  const corpo = `
<h1>Lead ${esc(lead.codigo)}</h1>
<p class="sub">${esc(dataCurta(lead.criado_em))} · ${lead.canal === 'whatsapp' ? 'WhatsApp' : 'Formulário'}${lead.destino_slug ? ` · ${esc(lead.destino_slug)}` : ''}</p>
${salvo ? '<div class="aviso">Alterações salvas.</div>' : ''}

<h2>Origem</h2>
<div class="cartao"><div class="rolagem" style="border:0"><table>
${linhaOrigem('Plataforma', lead.gclid || lead.wbraid || lead.gbraid ? 'Google Ads' : lead.fbclid ? 'Meta Ads' : null)}
${linhaOrigem('Palavra-chave', lead.keyword)}
${linhaOrigem('Correspondência', lead.matchtype)}
${linhaOrigem('Campanha', lead.utm_campaign ?? lead.campaign_id)}
${linhaOrigem('Grupo de anúncios', lead.adgroup_id)}
${linhaOrigem('Criativo', lead.creative_id ?? lead.utm_content)}
${linhaOrigem('Origem / mídia', [lead.utm_source, lead.utm_medium].filter(Boolean).join(' / ') || null)}
${linhaOrigem('Identificador de clique', lead.gclid ? `gclid ${lead.gclid.slice(0, 18)}…` : lead.wbraid ? 'wbraid (iOS)' : lead.gbraid ? 'gbraid (iOS)' : lead.fbclid ? 'fbclid' : null)}
${linhaOrigem('Dispositivo', lead.tipo_dispositivo)}
${linhaOrigem('Página de entrada', lead.landing_url)}
${linhaOrigem('Primeiro toque', lead.primeiro_toque_em ? dataCurta(lead.primeiro_toque_em) : null)}
</table></div></div>

<form method="post" action="/lead/${esc(lead.codigo)}">
<h2>Cotação</h2>
<div class="cartao">
  <div class="campos">
    <div class="campo"><label for="nome">Nome</label><input id="nome" name="nome" value="${esc(lead.nome)}"></div>
    <div class="campo"><label for="telefone">Telefone</label><input id="telefone" name="telefone" value="${esc(lead.telefone)}" inputmode="tel"></div>
    <div class="campo"><label for="email">E-mail</label><input id="email" name="email" type="email" value="${esc(lead.email)}"></div>
    <div class="campo"><label for="check_in">Check-in</label><input id="check_in" name="check_in" type="date" value="${esc(lead.check_in)}"></div>
    <div class="campo"><label for="check_out">Check-out</label><input id="check_out" name="check_out" type="date" value="${esc(lead.check_out)}"></div>
    <div class="campo"><label for="adultos">Adultos</label><input id="adultos" name="adultos" type="number" min="0" max="99" value="${esc(lead.adultos)}"></div>
    <div class="campo"><label for="criancas">Crianças</label><input id="criancas" name="criancas" type="number" min="0" max="99" value="${esc(lead.criancas)}"></div>
    <div class="campo"><label for="tipo_quarto">Tipo de quarto</label>
      <select id="tipo_quarto" name="tipo_quarto">
        <option value="">—</option>
        ${TIPOS_QUARTO.map((t) => `<option${t === lead.tipo_quarto ? ' selected' : ''}>${esc(t)}</option>`).join('')}
      </select>
    </div>
    <div class="campo"><label for="valor_cotado">Valor cotado (R$)</label><input id="valor_cotado" name="valor_cotado" inputmode="decimal" value="${lead.valor_cotado_centavos !== null ? (lead.valor_cotado_centavos / 100).toFixed(2) : ''}"></div>
    <div class="campo"><label for="valor_reserva">Valor da reserva (R$)</label><input id="valor_reserva" name="valor_reserva" inputmode="decimal" value="${lead.valor_reserva_centavos !== null ? (lead.valor_reserva_centavos / 100).toFixed(2) : ''}"></div>
  </div>
  ${n ? `<p class="sub" style="margin:12px 0 0">${n} noite(s).</p>` : ''}
  <div style="margin-top:14px">
    <label for="observacoes">Observações</label>
    <textarea id="observacoes" name="observacoes" rows="3">${esc(lead.observacoes)}</textarea>
  </div>
</div>

<h2>Status</h2>
<div class="cartao">
  <div class="campos">
    <div class="campo"><label for="status">Situação</label>
      <select id="status" name="status">
        ${FUNIL.map((s) => `<option value="${s.id}"${s.id === lead.status ? ' selected' : ''}>${esc(s.rotulo)}</option>`).join('')}
      </select>
    </div>
    <div class="campo"><label for="motivo_perda">Motivo (se perdido)</label>
      <select id="motivo_perda" name="motivo_perda">
        <option value="">—</option>
        ${MOTIVOS_PERDA.map((m) => `<option${m === lead.motivo_perda ? ' selected' : ''}>${esc(m)}</option>`).join('')}
      </select>
    </div>
  </div>
  <p class="sub" style="margin:12px 0 0">${esc(statusDef(lead.status)?.ajuda ?? '')}</p>
  <div style="margin-top:14px"><button class="primario" type="submit">Salvar</button></div>
</div>
</form>

<h2>Histórico</h2>
<div class="rolagem"><table>
<thead><tr><th>Quando</th><th>Mudança</th><th>Quem</th></tr></thead>
<tbody>${
    (eventos ?? []).length
      ? (eventos ?? [])
          .map(
            (e) => `<tr><td class="fraco">${esc(dataCurta(e.em))}</td><td>${esc(statusDef(e.de_status ?? '')?.rotulo ?? e.de_status ?? 'criado')} → ${esc(statusDef(e.para_status)?.rotulo ?? e.para_status)}</td><td class="fraco">${esc(e.operador ?? '')}</td></tr>`,
          )
          .join('')
      : '<tr><td colspan="3" class="fraco">Sem mudanças ainda.</td></tr>'
  }</tbody>
</table></div>
`;

  return c.html(pagina({ titulo: `Lead ${lead.codigo}`, aba: 'leads', operador: c.get('operador'), corpo }));
});

function linhaOrigem(rotulo: string, valor: string | null | undefined): string {
  return `<tr><th style="width:190px">${esc(rotulo)}</th><td class="quebra">${valor ? esc(valor) : '<span class="fraco">—</span>'}</td></tr>`;
}

painel.post('/lead/:codigo', async (c) => {
  const codigo = c.req.param('codigo').toUpperCase();
  const lead = await c.env.DB.prepare('SELECT * FROM leads WHERE codigo = ?').bind(codigo).first<Lead>();
  if (!lead) return c.notFound();

  const form = await c.req.parseBody();
  const novoStatus = String(form.status ?? lead.status);
  const status = ehStatus(novoStatus) ? novoStatus : lead.status;

  const atualizado: Lead = {
    ...lead,
    nome: N.texto(form.nome, 120),
    telefone: normalizarTelefone(N.texto(form.telefone, 40)),
    email: N.texto(form.email, 160),
    check_in: N.data(form.check_in),
    check_out: N.data(form.check_out),
    adultos: N.inteiro(form.adultos),
    criancas: N.inteiro(form.criancas),
    tipo_quarto: N.texto(form.tipo_quarto, 60),
    valor_cotado_centavos: N.centavos(form.valor_cotado),
    valor_reserva_centavos: N.centavos(form.valor_reserva),
    motivo_perda: N.texto(form.motivo_perda, 80),
    observacoes: N.texto(form.observacoes, 1000),
    status,
  };

  await c.env.DB.prepare(
    `UPDATE leads SET nome=?, telefone=?, email=?, check_in=?, check_out=?, adultos=?,
       criancas=?, tipo_quarto=?, valor_cotado_centavos=?, valor_reserva_centavos=?,
       motivo_perda=?, observacoes=?, status=?, atualizado_em=?
     WHERE id=?`,
  )
    .bind(
      atualizado.nome,
      atualizado.telefone,
      atualizado.email,
      atualizado.check_in,
      atualizado.check_out,
      atualizado.adultos,
      atualizado.criancas,
      atualizado.tipo_quarto,
      atualizado.valor_cotado_centavos,
      atualizado.valor_reserva_centavos,
      atualizado.motivo_perda,
      atualizado.observacoes,
      atualizado.status,
      agora(),
      lead.id,
    )
    .run();

  if (status !== lead.status) {
    await c.env.DB.prepare(
      'INSERT INTO lead_eventos (lead_id, de_status, para_status, operador, em) VALUES (?,?,?,?,?)',
    )
      .bind(lead.id, lead.status, status, c.get('operador'), agora())
      .run();

    // A fila despacha no cron; aqui só registramos a intenção.
    await enfileirar(c.env, atualizado, status);
  }

  return c.redirect(`/lead/${codigo}?ok=1`, 303);
});

// -------------------------------------------------------------- campanhas

painel.get('/campanhas', async (c) => {
  const dias = diasDoPedido(c.req.query('dias'));
  const desde = diasAtras(dias);

  const agregado = (dimensao: string) => `
    SELECT ${dimensao} AS chave,
           COUNT(*) AS leads,
           SUM(CASE WHEN l.status IN ('cotacao_enviada','reserva_confirmada')
                      OR EXISTS (SELECT 1 FROM lead_eventos e
                                  WHERE e.lead_id = l.id AND e.para_status = 'cotacao_enviada')
                    THEN 1 ELSE 0 END) AS cotacoes,
           SUM(CASE WHEN l.status = 'reserva_confirmada' THEN 1 ELSE 0 END) AS reservas,
           SUM(CASE WHEN l.status = 'reserva_confirmada'
                    THEN COALESCE(l.valor_reserva_centavos, l.valor_cotado_centavos, 0)
                    ELSE 0 END) AS receita
      FROM leads l
     WHERE l.criado_em > ?
     GROUP BY chave
     ORDER BY leads DESC
     LIMIT 60`;

  const porCampanha = await c.env.DB.prepare(
    agregado(`COALESCE(NULLIF(l.utm_campaign,''), NULLIF(l.campaign_id,''), '(sem campanha)')`),
  )
    .bind(desde)
    .all<LinhaAgregada>();

  const porPalavra = await c.env.DB.prepare(
    agregado(`COALESCE(NULLIF(l.keyword,''), '(sem palavra-chave)')`),
  )
    .bind(desde)
    .all<LinhaAgregada>();

  const corpo = `
<h1>Campanhas</h1>
<p class="sub">O que cada origem realmente produziu — não clique, reserva.</p>

<form class="barra-acoes" method="get" action="/campanhas">
  <div class="campo"><label for="c-dias">Período</label>
    <select id="c-dias" name="dias" onchange="this.form.submit()">
      ${PERIODOS.map(([r, d]) => `<option value="${d}"${d === dias ? ' selected' : ''}>${r}</option>`).join('')}
    </select>
  </div>
  <noscript><button class="secundario" type="submit">Aplicar</button></noscript>
</form>

<h2>Por campanha</h2>
${tabelaAgregada(porCampanha.results ?? [])}

<h2>Por palavra-chave</h2>
${tabelaAgregada(porPalavra.results ?? [])}
`;

  return c.html(pagina({ titulo: 'Campanhas', aba: 'campanhas', operador: c.get('operador'), corpo }));
});

interface LinhaAgregada {
  chave: string;
  leads: number;
  cotacoes: number;
  reservas: number;
  receita: number;
}

function tabelaAgregada(linhas: LinhaAgregada[]): string {
  if (!linhas.length) return '<div class="cartao vazio">Sem dados no período.</div>';
  const maior = Math.max(...linhas.map((l) => l.leads), 1);

  const corpo = linhas
    .map((l) => {
      const taxa = l.leads ? ((l.reservas / l.leads) * 100).toFixed(1).replace('.', ',') : '0,0';
      return `<tr>
  <td class="quebra">${esc(l.chave)}</td>
  <td class="num">${l.leads}</td>
  <td style="width:120px">${barraEtapa(1, l.leads / maior)}</td>
  <td class="num">${l.cotacoes}</td>
  <td class="num">${l.reservas}</td>
  <td class="num">${taxa}%</td>
  <td class="num">${esc(N.moeda(l.receita))}</td>
</tr>`;
    })
    .join('');

  return `<div class="rolagem"><table>
<thead><tr><th>Origem</th><th class="num">Leads</th><th></th><th class="num">Cotações</th><th class="num">Reservas</th><th class="num">Conversão</th><th class="num">Receita</th></tr></thead>
<tbody>${corpo}</tbody></table></div>`;
}

// ------------------------------------------------------------- conversões

painel.get('/conversoes', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT cv.*, l.codigo, l.nome FROM conversoes cv
       JOIN leads l ON l.id = cv.lead_id
      ORDER BY cv.id DESC LIMIT 200`,
  ).all<{
    id: number; codigo: string; nome: string | null; plataforma: string; status_alvo: string;
    estado: string; tentativas: number; valor_centavos: number | null; resposta: string | null;
    enviado_em: string | null; criado_em: string; payload: string | null;
  }>();

  const dryRun = c.env.DRY_RUN !== 'false';
  const rodou = c.req.query('rodou');

  const linhas = (results ?? [])
    .map(
      (r) => `<tr>
  <td><a class="codigo" href="/lead/${esc(r.codigo)}">${esc(r.codigo)}</a></td>
  <td>${r.plataforma === 'google' ? 'Google Ads' : 'Meta'}</td>
  <td>${esc(statusDef(r.status_alvo)?.rotulo ?? r.status_alvo)}</td>
  <td class="num">${r.valor_centavos === null ? '<span class="fraco">—</span>' : esc(N.moeda(r.valor_centavos))}</td>
  <td>${estadoSelo(r.estado)}</td>
  <td class="num">${r.tentativas}</td>
  <td class="quebra fraco">${esc((r.resposta ?? '').slice(0, 220))}</td>
  <td class="fraco">${esc(dataCurta(r.enviado_em ?? r.criado_em))}</td>
</tr>`,
    )
    .join('');

  const corpo = `
<h1>Conversões</h1>
<p class="sub">O que foi devolvido para as plataformas. É aqui que se descobre tag quebrada antes do cliente descobrir.</p>

${
    dryRun
      ? `<div class="aviso"><strong>DRY_RUN ligado.</strong> O sistema monta e valida o payload mas <strong>não</strong> grava conversão nas contas. Confira algumas linhas abaixo e só então mude <code>DRY_RUN</code> para <code>"false"</code> no wrangler.jsonc e faça o deploy. Conversão importada não pode ser apagada.</div>`
      : `<div class="aviso"><strong>Envio real ativo.</strong> As conversões abaixo entraram nas contas de anúncio.</div>`
  }
${rodou ? `<div class="aviso">Fila processada: ${esc(rodou)}</div>` : ''}

<form method="post" action="/conversoes/rodar" style="margin-bottom:20px">
  <button class="secundario" type="submit">Processar fila agora</button>
</form>

${(results ?? []).length ? `<div class="rolagem"><table>
<thead><tr><th>Lead</th><th>Plataforma</th><th>Estágio</th><th class="num">Valor</th><th>Estado</th><th class="num">Tent.</th><th>Resposta</th><th>Quando</th></tr></thead>
<tbody>${linhas}</tbody></table></div>` : '<div class="cartao vazio">Nada na fila ainda. Marque um lead como “Cotação enviada” ou “Reserva confirmada”.</div>'}
`;

  return c.html(pagina({ titulo: 'Conversões', aba: 'conversoes', operador: c.get('operador'), corpo }));
});

function estadoSelo(estado: string): string {
  const cor =
    estado === 'enviado' ? 'var(--bom)'
    : estado === 'falhou' ? 'var(--critico)'
    : estado === 'ignorado' ? 'var(--atencao)'
    : 'var(--text-3)';
  return `<span class="selo" style="--cor:${cor}">${esc(estado)}</span>`;
}

painel.post('/conversoes/rodar', async (c) => {
  const r = await processarFila(c.env);
  const resumo = `Google ${r.google.enviadas}/${r.google.montadas} enviadas, ${r.google.ignoradas} ignoradas` +
    (r.google.erro ? ` — ${r.google.erro}` : '') +
    `. Meta ${r.meta.enviadas}/${r.meta.montadas}` +
    (r.meta.erro ? ` — ${r.meta.erro}` : '') +
    (r.dryRun ? '. (dry run)' : '.');
  return c.redirect(`/conversoes?rodou=${encodeURIComponent(resumo)}`, 303);
});

// ------------------------------------------------------------- instalação

painel.get('/instalacao', async (c) => {
  const { results: destinos } = await c.env.DB.prepare(
    'SELECT * FROM destinos ORDER BY rowid',
  ).all<Destino>();

  const snippet = `<script async src="${c.env.TRACKER_ORIGIN}/r.js"></script>`;

  const corpo = `
<h1>Instalação</h1>
<p class="sub">Uma linha no site do hotel. O script reescreve sozinho os botões de WhatsApp que já existem na página.</p>

<h2>1. Tag no site</h2>
<div class="cartao">
  <p class="sub" style="margin-bottom:8px">Cole antes de <code>&lt;/head&gt;</code>, ou crie uma tag de HTML personalizado no GTM disparando em todas as páginas.</p>
  <pre class="snippet">${esc(snippet)}</pre>
  <p class="sub" style="margin:12px 0 0">Cookie gravado em <code>${esc(c.env.COOKIE_DOMAIN)}</code>. Se o site roda em outro domínio, ajuste <code>COOKIE_DOMAIN</code> no wrangler.jsonc — senão o redirect não enxerga a origem e todo lead vira “sem rastro”.</p>
</div>

<h2>2. Destinos de WhatsApp</h2>
<div class="rolagem"><table>
<thead><tr><th>Slug</th><th>Rótulo</th><th>Número</th><th>Mensagem</th><th>Link direto</th></tr></thead>
<tbody>${
    (destinos ?? [])
      .map(
        (d) => `<tr>
  <td><code>${esc(d.slug)}</code></td>
  <td>${esc(d.rotulo)}</td>
  <td>${esc(d.numero_whatsapp)}</td>
  <td class="quebra fraco">${esc(d.template_mensagem)}</td>
  <td class="quebra"><code>${esc(c.env.TRACKER_ORIGIN)}/w/${esc(d.slug)}</code></td>
</tr>`,
      )
      .join('') || '<tr><td colspan="5" class="fraco">Nenhum destino cadastrado.</td></tr>'
  }</tbody></table></div>
<p class="sub" style="margin-top:12px">Para um botão específico, use <code>data-rastro-slug="eventos"</code> no link. Para excluir um link do rastreio, <code>data-rastro-ignorar</code>.</p>

<h2>3. Conferência</h2>
<div class="cartao">
  <p class="sub" style="margin:0">Abra o site com <code>?gclid=TESTE123</code> no fim da URL, clique no botão de WhatsApp e confira se o lead apareceu na lista com o código no texto da mensagem. Se aparecer “sem rastro”, o problema é o <code>COOKIE_DOMAIN</code> ou a tag não carregou.</p>
</div>
`;

  return c.html(pagina({ titulo: 'Instalação', aba: 'instalacao', operador: c.get('operador'), corpo }));
});
