/**
 * Código curto que vai no texto do WhatsApp.
 *
 * Alfabeto sem 0/O/1/I/L para ninguém ler errado ao ditar por telefone, e sem
 * vogais para não sortear palavra infeliz. 4 caracteres dão ~700 mil
 * combinações — com o UNIQUE do banco e retry, é folgado para o volume de um
 * hotel.
 */
const ALFABETO = '23456789BCDFGHJKMNPQRSTVWXZ';

export function gerarCodigo(tamanho = 4): string {
  const bytes = new Uint8Array(tamanho);
  crypto.getRandomValues(bytes);
  let saida = '';
  for (let i = 0; i < tamanho; i++) {
    saida += ALFABETO[bytes[i]! % ALFABETO.length];
  }
  return saida;
}

export function codigoValido(codigo: string): boolean {
  if (codigo.length < 3 || codigo.length > 8) return false;
  for (const ch of codigo) if (!ALFABETO.includes(ch)) return false;
  return true;
}
