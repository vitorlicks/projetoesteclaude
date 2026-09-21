import { describe, it, expect } from 'vitest';
import { criarSessao, lerSessao, igualSeguro } from '../src/lib/sessao';

const SEGREDO = 'segredo-de-teste-que-nao-vai-pra-lugar-nenhum';

describe('sessão assinada', () => {
  it('vai e volta preservando o operador', async () => {
    const token = await criarSessao('Vitor', SEGREDO);
    const sessao = await lerSessao(token, SEGREDO);
    expect(sessao?.operador).toBe('Vitor');
  });

  it('rejeita token assinado com outro segredo', async () => {
    const token = await criarSessao('Vitor', SEGREDO);
    expect(await lerSessao(token, 'outro-segredo')).toBeNull();
  });

  it('rejeita operador adulterado', async () => {
    // Sem isso, qualquer um editaria o cookie e assinaria a ação de outra
    // pessoa no histórico do lead.
    const token = await criarSessao('Vitor', SEGREDO);
    const [corpo, assinatura] = token.split('.');
    const falso = btoa(JSON.stringify({ operador: 'Admin', expira: Date.now() + 1000 }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(corpo).not.toBe(falso);
    expect(await lerSessao(`${falso}.${assinatura}`, SEGREDO)).toBeNull();
  });

  it('rejeita lixo e vazio', async () => {
    expect(await lerSessao('', SEGREDO)).toBeNull();
    expect(await lerSessao(undefined, SEGREDO)).toBeNull();
    expect(await lerSessao('semponto', SEGREDO)).toBeNull();
    expect(await lerSessao('a.b', SEGREDO)).toBeNull();
  });
});

describe('comparação de senha', () => {
  it('reconhece senha igual', () => {
    expect(igualSeguro('abc123', 'abc123')).toBe(true);
  });

  it('recusa senha diferente, inclusive de outro tamanho', () => {
    expect(igualSeguro('abc123', 'abc124')).toBe(false);
    expect(igualSeguro('abc', 'abc123')).toBe(false);
    expect(igualSeguro('', 'abc123')).toBe(false);
  });
});
