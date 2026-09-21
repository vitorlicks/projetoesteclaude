/** Saneamento do que chega de formulário — texto digitado por humano. */

export function texto(v: unknown, max = 200): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().replace(/\s+/g, ' ');
  return s ? s.slice(0, max) : null;
}

/**
 * Data para YYYY-MM-DD. Aceita o que os formulários brasileiros produzem:
 * 15/03/2027, 15-03-2027, 2027-03-15 (input type=date).
 */
export function data(v: unknown): string | null {
  const s = texto(v, 32);
  if (!s) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return validar(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const br = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/.exec(s);
  if (br) {
    let ano = Number(br[3]);
    if (ano < 100) ano += 2000;
    return validar(ano, Number(br[2]), Number(br[1]));
  }
  return null;
}

function validar(ano: number, mes: number, dia: number): string | null {
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  if (ano < 2000 || ano > 2100) return null;
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${ano}-${p(mes)}-${p(dia)}`;
}

export function inteiro(v: unknown, min = 0, max = 99): number | null {
  const s = typeof v === 'number' ? String(v) : texto(v, 16);
  if (!s) return null;
  const m = /\d+/.exec(s);
  if (!m) return null;
  const n = Number(m[0]);
  return n >= min && n <= max ? n : null;
}

/** "1.250,00" | "1250.00" | "R$ 1.250" -> centavos. */
export function centavos(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v * 100);
  const s = texto(v, 24);
  if (!s) return null;

  let limpo = s.replace(/[^\d,.-]/g, '');
  if (!limpo) return null;

  const virgula = limpo.lastIndexOf(',');
  const ponto = limpo.lastIndexOf('.');

  if (virgula > ponto) {
    // Padrão brasileiro: ponto é milhar, vírgula é decimal.
    limpo = limpo.replace(/\./g, '').replace(',', '.');
  } else if (ponto > virgula) {
    limpo = limpo.replace(/,/g, '');
  } else {
    limpo = limpo.replace(/[,.]/g, '');
  }

  const n = Number(limpo);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function moeda(centavosValor: number | null | undefined): string {
  if (centavosValor === null || centavosValor === undefined) return '—';
  return (centavosValor / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}
