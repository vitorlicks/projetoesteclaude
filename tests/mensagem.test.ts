import { describe, it, expect } from 'vitest';
import { renderizarMensagem } from '../src/lib/mensagem';

const PROTOCOLO = 'Olá! Quero uma cotação de reserva.[[ Atendimento {codigo}]]';

describe('renderizarMensagem', () => {
  it('escreve o protocolo com cara de atendimento, sem colchete', () => {
    expect(renderizarMensagem(PROTOCOLO, 'K7F2')).toBe(
      'Olá! Quero uma cotação de reserva. Atendimento K7F2',
    );
  });

  it('sem código, some o bloco inteiro e a frase fecha sozinha', () => {
    expect(renderizarMensagem(PROTOCOLO, null)).toBe('Olá! Quero uma cotação de reserva.');
  });

  it('ainda entende o formato antigo com [#{codigo}]', () => {
    const antigo = 'Olá! Gostaria de uma cotação. [#{codigo}]';
    expect(renderizarMensagem(antigo, 'A1B2')).toBe('Olá! Gostaria de uma cotação. [#A1B2]');
    expect(renderizarMensagem(antigo, null)).toBe('Olá! Gostaria de uma cotação.');
  });

  it('não deixa espaço dobrado quando o bloco está no meio da frase', () => {
    const meio = 'Oi![[ Protocolo {codigo}.]] Quero reservar.';
    expect(renderizarMensagem(meio, null)).toBe('Oi! Quero reservar.');
  });
});
