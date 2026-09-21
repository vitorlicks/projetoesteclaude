import { describe, it, expect } from 'vitest';
import { montarTracker } from '../src/tracker';

const base = {
  cookieDomain: '.britanico.com',
  origem: 'https://go.britanico.com',
  slugPadrao: 'reservas',
  numerosPermitidos: ['5554996861751', '555496861751'],
};

describe('script servido em /r.js', () => {
  it('interpola a configuração do deploy', () => {
    const js = montarTracker(base);
    expect(js).toContain('var DOMINIO = ".britanico.com"');
    expect(js).toContain('var ORIGEM = "https://go.britanico.com"');
    expect(js).toContain('var SLUG_PADRAO = "reservas"');
  });

  it('leva a lista de números do cliente', () => {
    // Esta lista é o que impede o tracker de sequestrar o WhatsApp de
    // terceiros na página — o crédito do desenvolvedor no rodapé, por exemplo.
    const js = montarTracker(base);
    expect(js).toContain('var NUMEROS = ["5554996861751","555496861751"]');
    expect(js).toContain('if (numero && NUMEROS.indexOf(numero) === -1) return;');
  });

  it('não quebra o script quando não há número cadastrado', () => {
    const js = montarTracker({ ...base, numerosPermitidos: [] });
    expect(js).toContain('var NUMEROS = []');
  });

  it('escapa aspas do domínio em vez de encerrar a string', () => {
    const js = montarTracker({ ...base, cookieDomain: '.ex"ample.com' });
    expect(js).toContain('var DOMINIO = ".ex\\"ample.com"');
  });

  it('não deixa o marcador de template escapar para o script', () => {
    const js = montarTracker(base);
    expect(js).not.toContain('${');
  });
});
