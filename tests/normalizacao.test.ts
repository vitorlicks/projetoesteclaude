import { describe, it, expect } from 'vitest';
import * as N from '../src/lib/normalizar';
import { normalizarTelefone, normalizarEmail } from '../src/lib/hash';

describe('datas de formulário', () => {
  it('aceita o formato brasileiro', () => {
    expect(N.data('15/03/2027')).toBe('2027-03-15');
    expect(N.data('5/3/2027')).toBe('2027-03-05');
    expect(N.data('15-03-2027')).toBe('2027-03-15');
  });

  it('aceita o formato do input type=date', () => {
    expect(N.data('2027-03-15')).toBe('2027-03-15');
  });

  it('recusa data impossível em vez de inventar', () => {
    expect(N.data('31/02/2027')).toBeNull();
    expect(N.data('qualquer coisa')).toBeNull();
    expect(N.data('')).toBeNull();
  });
});

describe('valores em dinheiro', () => {
  it('entende o padrão brasileiro', () => {
    expect(N.centavos('1.250,00')).toBe(125_000);
    expect(N.centavos('R$ 1.250,50')).toBe(125_050);
    expect(N.centavos('480')).toBe(48_000);
  });

  it('entende o padrão com ponto decimal', () => {
    expect(N.centavos('1250.50')).toBe(125_050);
    expect(N.centavos(1250.5)).toBe(125_050);
  });

  it('não aceita valor negativo nem lixo', () => {
    expect(N.centavos('-10')).toBeNull();
    expect(N.centavos('abc')).toBeNull();
  });

  it('formata de volta em reais', () => {
    expect(N.moeda(125_000)).toContain('1.250,00');
    expect(N.moeda(null)).toBe('—');
  });
});

describe('telefone para E.164', () => {
  it('completa o código do país quando falta', () => {
    expect(normalizarTelefone('(48) 99999-8888')).toBe('5548999998888');
    expect(normalizarTelefone('48999998888')).toBe('5548999998888');
    expect(normalizarTelefone('4833334444')).toBe('554833334444');
  });

  it('preserva o número que já veio completo', () => {
    expect(normalizarTelefone('+55 48 99999-8888')).toBe('5548999998888');
    expect(normalizarTelefone('005548999998888')).toBe('5548999998888');
  });

  it('descarta o que não é telefone', () => {
    expect(normalizarTelefone('')).toBeNull();
    expect(normalizarTelefone('123')).toBeNull();
    expect(normalizarTelefone(null)).toBeNull();
  });
});

describe('e-mail', () => {
  it('normaliza para minúsculo', () => {
    expect(normalizarEmail('  Joao@Hotel.COM.BR ')).toBe('joao@hotel.com.br');
  });
  it('recusa endereço malformado', () => {
    expect(normalizarEmail('joao@')).toBeNull();
    expect(normalizarEmail('joao')).toBeNull();
  });
});
