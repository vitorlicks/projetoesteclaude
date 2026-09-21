/**
 * Normalização e hash dos identificadores que viajam para Google e Meta.
 *
 * As duas plataformas exigem SHA-256 hex minúsculo de valor já normalizado.
 * Normalizar errado é pior que não mandar: o hash não casa com nada e a
 * conversão é descartada em silêncio.
 */

export async function sha256Hex(texto: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Telefone para E.164 sem '+', assumindo Brasil quando não há código de país.
 * Aceita as formas que a equipe digita na prática: (48) 99999-8888,
 * 48999998888, +55 48 99999-8888, 0055...
 */
export function normalizarTelefone(bruto: string | null | undefined, pais = '55'): string | null {
  if (!bruto) return null;
  let d = bruto.replace(/\D/g, '');
  if (!d) return null;

  d = d.replace(/^00+/, '');

  // Já tem código do país.
  if (d.startsWith(pais) && d.length >= 12 && d.length <= 13) return d;

  // Número nacional com DDD: 10 (fixo) ou 11 (celular) dígitos.
  if (d.length === 10 || d.length === 11) return pais + d;

  // Comprimento improvável: devolvemos como está para não inventar dado,
  // mas quem consome deve tratar como suspeito.
  return d.length >= 8 ? d : null;
}

export function normalizarEmail(bruto: string | null | undefined): string | null {
  if (!bruto) return null;
  const e = bruto.trim().toLowerCase();
  return /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(e) ? e : null;
}

export async function hashTelefone(bruto: string | null | undefined): Promise<string | null> {
  const t = normalizarTelefone(bruto);
  return t ? sha256Hex(t) : null;
}

export async function hashEmail(bruto: string | null | undefined): Promise<string | null> {
  const e = normalizarEmail(bruto);
  return e ? sha256Hex(e) : null;
}

/** Nome/sobrenome: minúsculo, sem acento e sem pontuação, como as duas pedem. */
export async function hashNome(bruto: string | null | undefined): Promise<string | null> {
  if (!bruto) return null;
  const n = bruto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  return n ? sha256Hex(n) : null;
}
