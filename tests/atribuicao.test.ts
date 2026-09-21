import { describe, it, expect } from 'vitest';
import { lerContexto, cookie, pareceRobo, tipoDispositivo } from '../src/lib/atribuicao';
import { gerarCodigo, codigoValido } from '../src/lib/codigo';

function cookieDe(obj: Record<string, unknown>): string {
  return encodeURIComponent(JSON.stringify(obj));
}

describe('contexto de atribuição', () => {
  it('expande as chaves curtas para os campos do lead', () => {
    const ctx = lerContexto(
      cookieDe({ gc: 'Cj0KCQ', kw: 'hotel em florianopolis', uc: 'marca', ci: '123' }),
    );
    expect(ctx.gclid).toBe('Cj0KCQ');
    expect(ctx.keyword).toBe('hotel em florianopolis');
    expect(ctx.utm_campaign).toBe('marca');
    expect(ctx.campaign_id).toBe('123');
  });

  it('descarta ValueTrack que não foi substituído', () => {
    // '{keyword}' cru significa modelo de URL mal configurado. Gravar isso
    // como palavra-chave polui o relatório inteiro.
    const ctx = lerContexto(cookieDe({ kw: '{keyword}', gc: 'ok' }));
    expect(ctx.keyword).toBeUndefined();
    expect(ctx.gclid).toBe('ok');
  });

  it('não quebra com cookie corrompido', () => {
    expect(lerContexto('nao-e-json')).toEqual({});
    expect(lerContexto(undefined)).toEqual({});
    expect(lerContexto('')).toEqual({});
  });

  it('corta valor absurdamente longo', () => {
    const ctx = lerContexto(cookieDe({ gc: 'x'.repeat(5000) }));
    expect(ctx.gclid!.length).toBe(512);
  });
});

describe('leitura de cookie', () => {
  it('acha o cookie certo entre vários', () => {
    const header = '_ga=GA1.1; _rastro=abc; _fbp=fb.1.2.3';
    expect(cookie(header, '_rastro')).toBe('abc');
    expect(cookie(header, '_fbp')).toBe('fb.1.2.3');
    expect(cookie(header, 'inexistente')).toBeUndefined();
  });

  it('não confunde cookie com nome parecido', () => {
    expect(cookie('_rastro_c=K7F2; _rastro=ctx', '_rastro')).toBe('ctx');
  });
});

describe('filtro de robô', () => {
  it('barra o que criaria lead falso', () => {
    // A pré-visualização do próprio WhatsApp é a causa nº 1 de lead fantasma.
    expect(pareceRobo('WhatsApp/2.23')).toBe(true);
    expect(pareceRobo('facebookexternalhit/1.1')).toBe(true);
    expect(pareceRobo('Googlebot/2.1')).toBe(true);
    expect(pareceRobo(null)).toBe(true);
  });

  it('deixa passar navegador de verdade', () => {
    expect(
      pareceRobo('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 Safari/604.1'),
    ).toBe(false);
  });
});

describe('tipo de dispositivo', () => {
  it('classifica sem guardar o user-agent inteiro', () => {
    expect(tipoDispositivo('Mozilla/5.0 (iPhone) Mobile Safari')).toBe('celular');
    expect(tipoDispositivo('Mozilla/5.0 (iPad) Safari')).toBe('tablet');
    expect(tipoDispositivo('Mozilla/5.0 (Windows NT 10.0) Chrome')).toBe('computador');
  });
});

describe('código curto', () => {
  it('evita caracteres que se confundem ao ditar', () => {
    for (let i = 0; i < 300; i++) {
      const c = gerarCodigo();
      expect(c).toHaveLength(4);
      expect(c).not.toMatch(/[0O1IL]/);
      expect(codigoValido(c)).toBe(true);
    }
  });

  it('rejeita código inválido', () => {
    expect(codigoValido('K0F2')).toBe(false);
    expect(codigoValido('AB')).toBe(false);
  });
});
