/**
 * Casca visual do painel.
 *
 * Renderizado no servidor, sem build e sem framework de front: a tela mais
 * usada é a lista de leads no celular do atendimento, e cada quilobyte de JS
 * ali é atrito na hora de marcar um status.
 *
 * Cores: rampa ordinal de azul para as etapas do funil (validada nos dois
 * modos) e a paleta de status reservada para ganho/perda — sempre com ponto
 * colorido + rótulo, nunca cor sozinha.
 */

export function esc(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const CSS = `
*, *::before, *::after { box-sizing: border-box; }

:root {
  color-scheme: light;
  --surface-0: #f5f4f1;
  --surface-1: #fcfcfb;
  --surface-2: #eceae5;
  --line:      #dedbd4;
  --text-1:    #0b0b0b;
  --text-2:    #52514e;
  --text-3:    #7c7a73;

  --etapa-1: #86b6ef;
  --etapa-2: #3987e5;
  --etapa-3: #256abf;
  --etapa-4: #104281;

  --bom:      #0ca30c;
  --atencao:  #fab219;
  --critico:  #d03b3b;
  --acento:   #2a78d6;
}

@media (prefers-color-scheme: dark) {
  :root:where(:not([data-theme="light"])) {
    color-scheme: dark;
    --surface-0: #121211;
    --surface-1: #1a1a19;
    --surface-2: #242423;
    --line:      #383835;
    --text-1:    #ffffff;
    --text-2:    #c3c2b7;
    --text-3:    #8f8e85;

    --etapa-1: #b7d3f6;
    --etapa-2: #6da7ec;
    --etapa-3: #2a78d6;
    --etapa-4: #184f95;

    --acento: #3987e5;
  }
}

:root[data-theme="dark"] {
  color-scheme: dark;
  --surface-0: #121211;
  --surface-1: #1a1a19;
  --surface-2: #242423;
  --line:      #383835;
  --text-1:    #ffffff;
  --text-2:    #c3c2b7;
  --text-3:    #8f8e85;
  --etapa-1: #b7d3f6;
  --etapa-2: #6da7ec;
  --etapa-3: #2a78d6;
  --etapa-4: #184f95;
  --acento: #3987e5;
}

body {
  margin: 0;
  background: var(--surface-0);
  color: var(--text-1);
  font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  -webkit-text-size-adjust: 100%;
}

.env { max-width: 1120px; margin: 0 auto; padding: 0 16px 64px; }

header.topo {
  position: sticky; top: 0; z-index: 10;
  background: var(--surface-1);
  border-bottom: 1px solid var(--line);
  margin-bottom: 24px;
}
header.topo .env { display: flex; align-items: center; gap: 16px; padding: 12px 16px; }
.marca { font-weight: 650; letter-spacing: -0.01em; margin-right: auto; }
.marca small { display: block; font-weight: 400; font-size: 12px; color: var(--text-3); }

nav.abas { display: flex; gap: 4px; overflow-x: auto; }
nav.abas a {
  padding: 6px 12px; border-radius: 8px; text-decoration: none;
  color: var(--text-2); font-size: 14px; white-space: nowrap;
}
nav.abas a:hover { background: var(--surface-2); color: var(--text-1); }
nav.abas a[aria-current="page"] { background: var(--surface-2); color: var(--text-1); font-weight: 600; }

h1 { font-size: 22px; letter-spacing: -0.02em; margin: 0 0 4px; }
h2 { font-size: 15px; letter-spacing: -0.01em; margin: 32px 0 12px; color: var(--text-2); font-weight: 600; }
.sub { color: var(--text-3); font-size: 14px; margin: 0 0 24px; }

.cartao {
  background: var(--surface-1);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 16px;
}

/* --- placas de número ---------------------------------------------------- */
.placas { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
.placa { background: var(--surface-1); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; }
.placa .rotulo { font-size: 12px; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.04em; }
.placa .valor {
  font-size: clamp(19px, 5vw, 26px); font-weight: 650; letter-spacing: -0.02em;
  margin-top: 4px; font-variant-numeric: tabular-nums; overflow-wrap: anywhere;
}
.placa .nota { font-size: 12px; color: var(--text-3); margin-top: 2px; }

/* --- funil --------------------------------------------------------------- */
.funil { display: flex; flex-direction: column; gap: 10px; }
.etapa { display: grid; grid-template-columns: 140px 1fr auto; gap: 12px; align-items: center; }
.etapa .nome { font-size: 13px; color: var(--text-2); }
.etapa .trilho { background: var(--surface-2); border-radius: 4px; height: 22px; overflow: hidden; }
.etapa .barra { height: 100%; border-radius: 0 4px 4px 0; min-width: 2px; }
.etapa .num { font-size: 13px; font-variant-numeric: tabular-nums; color: var(--text-1); font-weight: 600; min-width: 56px; text-align: right; }
.etapa .num span { color: var(--text-3); font-weight: 400; }

/* --- tabela -------------------------------------------------------------- */
.rolagem { overflow-x: auto; border: 1px solid var(--line); border-radius: 12px; background: var(--surface-1); }
table { border-collapse: collapse; width: 100%; font-size: 14px; }
th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-3); font-weight: 600; white-space: nowrap; }
tr:last-child td { border-bottom: 0; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
tbody tr:hover { background: var(--surface-2); }
a.codigo { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 650; color: var(--acento); text-decoration: none; }
a.codigo:hover { text-decoration: underline; }
.fraco { color: var(--text-3); }
.quebra { max-width: 260px; overflow-wrap: anywhere; }

/* --- selo de status ------------------------------------------------------ */
.selo { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; white-space: nowrap; }
.selo::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--cor, var(--text-3)); flex: none; }
.s-novo { --cor: var(--etapa-1); }
.s-em_contato { --cor: var(--etapa-2); }
.s-cotacao_enviada { --cor: var(--etapa-3); }
.s-reserva_confirmada { --cor: var(--bom); }
.s-perdido { --cor: var(--critico); }

/* --- formulários --------------------------------------------------------- */
label { display: block; font-size: 13px; color: var(--text-2); margin-bottom: 4px; }
input, select, textarea, button {
  font: inherit; color: inherit;
  background: var(--surface-1);
  border: 1px solid var(--line); border-radius: 8px;
  padding: 9px 11px; width: 100%;
}
input:focus-visible, select:focus-visible, textarea:focus-visible, button:focus-visible {
  outline: 2px solid var(--acento); outline-offset: 1px;
}
.campos { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 14px; }
.campo { min-width: 0; }
button.primario, a.primario {
  background: var(--acento); border-color: var(--acento); color: #fff;
  font-weight: 600; cursor: pointer; text-align: center; text-decoration: none;
  display: inline-block; width: auto; padding: 10px 18px;
}
button.primario:hover { filter: brightness(1.08); }
button.secundario { width: auto; cursor: pointer; padding: 8px 14px; }
.barra-acoes { display: flex; flex-wrap: wrap; gap: 8px; align-items: end; margin-bottom: 20px; }
.barra-acoes .campo { flex: 0 1 180px; }

.aviso { border-left: 3px solid var(--atencao); background: var(--surface-1); padding: 12px 14px; border-radius: 0 8px 8px 0; font-size: 14px; color: var(--text-2); margin-bottom: 20px; }
.erro  { border-left-color: var(--critico); }
.vazio { text-align: center; padding: 48px 16px; color: var(--text-3); }

pre.snippet {
  background: var(--surface-2); border: 1px solid var(--line); border-radius: 8px;
  padding: 12px; overflow-x: auto; font-size: 12.5px; line-height: 1.6;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--text-1);
}

/* No celular a tabela de leads vira cartão: é a tela que o atendimento usa
   com uma mão, e rolagem horizontal ali faz a pessoa desistir de marcar. */
@media (max-width: 720px) {
  .rolagem:has(.lista) { border: 0; background: none; overflow: visible; }
  .lista thead { display: none; }
  .lista, .lista tbody, .lista tr, .lista td { display: block; width: 100%; }
  .lista tr {
    background: var(--surface-1); border: 1px solid var(--line);
    border-radius: 12px; padding: 12px 14px; margin-bottom: 10px;
  }
  .lista tr:hover { background: var(--surface-1); }
  .lista td {
    border: 0; padding: 3px 0; display: flex; gap: 12px;
    align-items: baseline; justify-content: space-between; text-align: right;
  }
  .lista td::before {
    content: attr(data-r); color: var(--text-3); font-size: 11px;
    text-transform: uppercase; letter-spacing: 0.04em; flex: none; text-align: left;
  }
  .lista td.num { text-align: right; }
  .lista td.quebra { max-width: none; }
  .lista td:first-child { border-bottom: 1px solid var(--line); padding-bottom: 8px; margin-bottom: 6px; }
}

@media (max-width: 640px) {
  .etapa { grid-template-columns: 96px 1fr auto; }
  .etapa .nome { font-size: 12px; }
  header.topo .env { flex-wrap: wrap; gap: 8px; }
  .marca { width: 100%; margin-right: 0; }
}
`;

export interface OpcoesPagina {
  titulo: string;
  aba?: string;
  operador?: string | undefined;
  corpo: string;
}

export function pagina(o: OpcoesPagina): string {
  const abas: Array<[string, string, string]> = [
    ['leads', '/', 'Leads'],
    ['campanhas', '/campanhas', 'Campanhas'],
    ['conversoes', '/conversoes', 'Conversões'],
    ['instalacao', '/instalacao', 'Instalação'],
  ];

  const nav = abas
    .map(
      ([id, href, rotulo]) =>
        `<a href="${href}"${o.aba === id ? ' aria-current="page"' : ''}>${rotulo}</a>`,
    )
    .join('');

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(o.titulo)} · Rastro</title>
<style>${CSS}</style>
</head>
<body>
<header class="topo">
  <div class="env">
    <div class="marca">Rastro <small>Hotel Britânico · cotação de reserva</small></div>
    <nav class="abas">${nav}</nav>
    ${o.operador ? `<form method="post" action="/sair" style="width:auto"><button class="secundario" title="Sair">${esc(o.operador)} ·  sair</button></form>` : ''}
  </div>
</header>
<main class="env">
${o.corpo}
</main>
</body>
</html>`;
}

/** Barra do funil com a rampa ordinal. O índice escolhe a etapa da rampa. */
export function barraEtapa(indice: number, proporcao: number): string {
  const cor = `var(--etapa-${Math.min(indice + 1, 4)})`;
  // Zero não desenha marca nenhuma: com min-width no CSS, uma barra de 0%
  // viraria um risco colorido e faria "nenhum" parecer "quase nada".
  if (proporcao <= 0) return '<div class="trilho"></div>';
  const largura = Math.max(proporcao * 100, 1.5);
  return `<div class="trilho"><div class="barra" style="width:${largura.toFixed(1)}%;background:${cor}"></div></div>`;
}

/** Barra de saída (perdidos), na cor de status crítico. */
export function barraPerda(proporcao: number): string {
  if (proporcao <= 0) return '<div class="trilho"></div>';
  const largura = Math.max(proporcao * 100, 1.5);
  return `<div class="trilho"><div class="barra" style="width:${largura.toFixed(1)}%;background:var(--critico)"></div></div>`;
}

export function selo(status: string, rotulo: string): string {
  return `<span class="selo s-${esc(status)}">${esc(rotulo)}</span>`;
}

export function dataCurta(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });
}

export function dataEstadia(iso: string | null): string {
  if (!iso) return '—';
  const [a, m, d] = iso.split('-');
  return a && m && d ? `${d}/${m}` : '—';
}
