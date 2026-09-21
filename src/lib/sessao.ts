/**
 * Sessão sem tabela: cookie assinado com HMAC-SHA256.
 *
 * Por que senha compartilhada e não usuário por pessoa: o plano gratuito dá
 * 10ms de CPU por requisição, e um KDF decente (PBKDF2 com iterações que
 * valham algo) estoura isso. Para ferramenta interna, senha única no secret +
 * nome do operador para a trilha de auditoria resolve — e o nome vai dentro
 * do cookie assinado, então não é digitável por fora.
 */
import type { Sessao } from '../types';

const COOKIE = 'rastro_s';
const VALIDADE_MS = 30 * 86_400_000; // 30 dias

function b64urlEnc(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDec(texto: string): Uint8Array {
  const s = texto.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function chave(segredo: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(segredo),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/** Comparação em tempo constante — evita oráculo de tempo na senha. */
export function igualSeguro(a: string, b: string): boolean {
  const ba = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  // Comprimento diferente já não bate; ainda assim percorremos o maior dos
  // dois para o tempo não vazar o tamanho da senha correta.
  let diff = ba.length ^ bb.length;
  const n = Math.max(ba.length, bb.length);
  for (let i = 0; i < n; i++) diff |= (ba[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

export async function criarSessao(operador: string, segredo: string): Promise<string> {
  const dados: Sessao = { operador: operador.slice(0, 60), expira: Date.now() + VALIDADE_MS };
  const corpo = b64urlEnc(new TextEncoder().encode(JSON.stringify(dados)));
  const assinatura = await crypto.subtle.sign('HMAC', await chave(segredo), new TextEncoder().encode(corpo));
  return `${corpo}.${b64urlEnc(new Uint8Array(assinatura))}`;
}

export async function lerSessao(valor: string | undefined, segredo: string): Promise<Sessao | null> {
  if (!valor) return null;
  const ponto = valor.lastIndexOf('.');
  if (ponto <= 0) return null;

  const corpo = valor.slice(0, ponto);
  const assinatura = valor.slice(ponto + 1);

  let ok = false;
  try {
    ok = await crypto.subtle.verify(
      'HMAC',
      await chave(segredo),
      b64urlDec(assinatura) as unknown as ArrayBuffer,
      new TextEncoder().encode(corpo),
    );
  } catch {
    return null;
  }
  if (!ok) return null;

  try {
    const dados = JSON.parse(new TextDecoder().decode(b64urlDec(corpo))) as Sessao;
    if (typeof dados.expira !== 'number' || dados.expira < Date.now()) return null;
    if (typeof dados.operador !== 'string' || !dados.operador) return null;
    return dados;
  } catch {
    return null;
  }
}

export function cookieSessao(valor: string): string {
  const maxAge = Math.floor(VALIDADE_MS / 1000);
  return `${COOKIE}=${valor}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function cookieLimpo(): string {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export const NOME_COOKIE_SESSAO = COOKIE;
