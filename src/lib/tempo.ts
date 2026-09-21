/** Timestamps. Guardamos sempre ISO UTC; convertemos só na borda da API. */

export function agora(): string {
  return new Date().toISOString();
}

/**
 * Formato que o Google Ads exige em conversion_date_time:
 * 'YYYY-MM-DD HH:MM:SS+|-HH:MM', no fuso configurado na conta de anúncios.
 * Mandar em UTC quando a conta está em -03:00 joga a conversão para o dia
 * errado nos eventos da madrugada.
 */
export function paraGoogleDateTime(iso: string, offset: string): string {
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(offset.trim());
  if (!m) throw new Error(`TIMEZONE_OFFSET inválido: ${offset}`);
  const sinal = m[1] === '-' ? -1 : 1;
  const minutos = sinal * (Number(m[2]) * 60 + Number(m[3]));

  const base = Date.parse(iso);
  if (Number.isNaN(base)) throw new Error(`data inválida: ${iso}`);
  const local = new Date(base + minutos * 60_000);

  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${local.getUTCFullYear()}-${p(local.getUTCMonth() + 1)}-${p(local.getUTCDate())}` +
    ` ${p(local.getUTCHours())}:${p(local.getUTCMinutes())}:${p(local.getUTCSeconds())}` +
    `${m[1]}${m[2]}:${m[3]}`
  );
}

/** Meta CAPI usa epoch em segundos. */
export function paraEpoch(iso: string): number {
  return Math.floor(Date.parse(iso) / 1000);
}

export function diasAtras(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

export function mesesAtras(n: number): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString();
}
