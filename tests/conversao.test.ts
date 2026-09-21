import { describe, it, expect } from 'vitest';
import { paraGoogleDateTime, paraEpoch } from '../src/lib/tempo';
import { montarFbc } from '../src/integrations/meta';
import { falhaParcial, versaoNaUrl } from '../src/integrations/google-ads';
import { valorDaConversao, noites, transicoesPossiveis, posicao, statusDef } from '../src/funil';
import type { Lead } from '../src/types';

function leadFalso(p: Partial<Lead> = {}): Lead {
  return {
    id: 1, codigo: 'K7F2', canal: 'whatsapp', destino_slug: 'reservas', status: 'novo',
    nome: null, telefone: null, email: null,
    check_in: null, check_out: null, adultos: null, criancas: null, tipo_quarto: null,
    valor_cotado_centavos: null, valor_reserva_centavos: null, motivo_perda: null, observacoes: null,
    gclid: null, wbraid: null, gbraid: null, fbclid: null, fbp: null,
    utm_source: null, utm_medium: null, utm_campaign: null, utm_term: null, utm_content: null,
    keyword: null, matchtype: null, campaign_id: null, adgroup_id: null, creative_id: null,
    network: null, device: null, placement: null,
    landing_url: null, referrer: null, pais: null, tipo_dispositivo: null,
    primeiro_toque_em: null, criado_em: '2026-09-20T12:00:00.000Z', atualizado_em: '2026-09-20T12:00:00.000Z',
    ...p,
  };
}

describe('data de conversão do Google', () => {
  it('converte UTC para o fuso da conta de anúncios', () => {
    expect(paraGoogleDateTime('2026-09-20T15:30:00.000Z', '-03:00')).toBe(
      '2026-09-20 12:30:00-03:00',
    );
  });

  it('joga para o dia anterior quando o evento é de madrugada', () => {
    // Este é o bug clássico: mandar em UTC faz a conversão da meia-noite
    // aparecer no dia seguinte e desalinhar o relatório com o Google Ads.
    expect(paraGoogleDateTime('2026-09-20T01:00:00.000Z', '-03:00')).toBe(
      '2026-09-19 22:00:00-03:00',
    );
  });

  it('funciona com fuso positivo', () => {
    expect(paraGoogleDateTime('2026-09-20T22:00:00.000Z', '+02:00')).toBe(
      '2026-09-21 00:00:00+02:00',
    );
  });

  it('recusa offset malformado em vez de mandar data errada', () => {
    expect(() => paraGoogleDateTime('2026-09-20T12:00:00Z', 'BRT')).toThrow();
    expect(() => paraGoogleDateTime('não é data', '-03:00')).toThrow();
  });
});

describe('fbc do Meta', () => {
  it('usa o momento do primeiro toque, não o de agora', () => {
    const fbc = montarFbc('IwAR123', '2026-09-20T12:00:00.000Z');
    expect(fbc).toBe(`fb.1.${Date.parse('2026-09-20T12:00:00.000Z')}.IwAR123`);
  });

  it('cai para agora quando não há primeiro toque', () => {
    expect(montarFbc('IwAR123', null)).toMatch(/^fb\.1\.\d+\.IwAR123$/);
  });
});

describe('falha parcial do Google', () => {
  it('enxerga o erro escondido dentro de uma resposta 200', () => {
    const corpo = JSON.stringify({
      partialFailureError: { message: 'gclid inválido na conversão 2' },
    });
    expect(falhaParcial(corpo)).toBe('gclid inválido na conversão 2');
  });

  it('devolve null quando o lote foi aceito inteiro', () => {
    expect(falhaParcial(JSON.stringify({ results: [{}] }))).toBeNull();
    expect(falhaParcial('não é json')).toBeNull();
  });
});

describe('valor que viaja com a conversão', () => {
  it('usa o valor da reserva quando ela fecha', () => {
    const lead = leadFalso({ valor_reserva_centavos: 48_000, valor_cotado_centavos: 52_000 });
    expect(valorDaConversao(lead, 'reserva_confirmada')).toBe(48_000);
  });

  it('cai para o valor cotado se ninguém preencheu a reserva', () => {
    // Mandar conversão sem valor é pior que mandar o valor aproximado: o
    // lance automático fica sem sinal de receita nenhum.
    const lead = leadFalso({ valor_cotado_centavos: 52_000 });
    expect(valorDaConversao(lead, 'reserva_confirmada')).toBe(52_000);
  });

  it('não inventa valor para estágio sem valor', () => {
    expect(valorDaConversao(leadFalso(), 'em_contato')).toBeNull();
    expect(valorDaConversao(leadFalso(), 'cotacao_enviada')).toBeNull();
  });
});

describe('funil de cotação', () => {
  it('conta as noites da estadia', () => {
    expect(noites('2027-03-15', '2027-03-18')).toBe(3);
    expect(noites('2027-03-15', '2027-03-15')).toBeNull();
    expect(noites('2027-03-15', null)).toBeNull();
  });

  it('não deixa sair de um status terminal', () => {
    expect(transicoesPossiveis('reserva_confirmada')).toEqual([]);
    expect(transicoesPossiveis('perdido')).toEqual([]);
    expect(transicoesPossiveis('novo').length).toBeGreaterThan(0);
  });

  it('ordena as etapas e tira o perdido do funil', () => {
    expect(posicao('novo')).toBe(0);
    expect(posicao('reserva_confirmada')).toBe(3);
    expect(posicao('perdido')).toBe(-1);
  });

  it('marca como conversível só o que vale mandar pro Google', () => {
    expect(statusDef('reserva_confirmada')!.conversivel).toBe(true);
    expect(statusDef('cotacao_enviada')!.conversivel).toBe(true);
    expect(statusDef('novo')!.conversivel).toBe(false);
    expect(statusDef('perdido')!.conversivel).toBe(false);
  });
});

describe('epoch do Meta', () => {
  it('converte para segundos', () => {
    expect(paraEpoch('2026-09-20T12:00:00.000Z')).toBe(1789905600);
  });
});

describe('versão da API do Google na URL', () => {
  it('reduz a versão com ponto para a maior, que é o que a URL aceita', () => {
    // A conta do hotel é identificada como v25.1, mas
    // googleads.googleapis.com/v25.1/... devolve 404 em todo upload.
    expect(versaoNaUrl('v25.1')).toBe('v25');
    expect(versaoNaUrl('25.1')).toBe('v25');
    expect(versaoNaUrl('v25')).toBe('v25');
    expect(versaoNaUrl(' V21 ')).toBe('v21');
  });

  it('falha alto em vez de montar uma URL sem versão', () => {
    expect(() => versaoNaUrl('')).toThrow();
    expect(() => versaoNaUrl('vX')).toThrow();
  });
});
