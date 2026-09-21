/**
 * Funil de cotação de reserva do Hotel Britânico.
 *
 * A ordem importa: é ela que define o funil do relatório e quais transições
 * a tela oferece. Mudar de nicho depois é mexer só neste arquivo.
 */
import type { Lead } from './types';

export type Status =
  | 'novo'
  | 'em_contato'
  | 'cotacao_enviada'
  | 'reserva_confirmada'
  | 'perdido';

export interface StatusDef {
  id: Status;
  rotulo: string;
  ajuda: string;
  /** Nenhuma transição sai daqui. */
  terminal: boolean;
  /** Qual campo de valor a tela deve pedir ao entrar neste status. */
  pedeValor?: 'cotado' | 'reserva';
  pedeMotivo?: boolean;
  /** Vale mandar para Google/Meta como conversão? */
  conversivel: boolean;
}

export const FUNIL: readonly StatusDef[] = [
  {
    id: 'novo',
    rotulo: 'Novo',
    ajuda: 'Pedido de cotação chegou, ninguém respondeu ainda.',
    terminal: false,
    conversivel: false,
  },
  {
    id: 'em_contato',
    rotulo: 'Em contato',
    ajuda: 'Atendimento respondeu e está levantando as datas.',
    terminal: false,
    conversivel: false,
  },
  {
    id: 'cotacao_enviada',
    rotulo: 'Cotação enviada',
    ajuda: 'Proposta com valor foi enviada ao hóspede.',
    terminal: false,
    pedeValor: 'cotado',
    conversivel: true,
  },
  {
    id: 'reserva_confirmada',
    rotulo: 'Reserva confirmada',
    ajuda: 'Hóspede fechou. É esta que o Google precisa aprender a buscar.',
    terminal: true,
    pedeValor: 'reserva',
    conversivel: true,
  },
  {
    id: 'perdido',
    rotulo: 'Perdido',
    ajuda: 'Não fechou. O motivo é o que vira insumo de campanha.',
    terminal: true,
    pedeMotivo: true,
    conversivel: false,
  },
] as const;

export const MOTIVOS_PERDA = [
  'Preço acima do orçamento',
  'Datas sem disponibilidade',
  'Não respondeu mais',
  'Só pesquisando preço',
  'Fechou com concorrente',
  'Fora do perfil do hotel',
  'Outro',
] as const;

export const TIPOS_QUARTO = [
  'Standard casal',
  'Standard twin',
  'Superior',
  'Luxo',
  'Suíte',
  'Família',
  'Não definido',
] as const;

const PorId = new Map<string, StatusDef>(FUNIL.map((s) => [s.id, s]));

export function statusDef(id: string): StatusDef | undefined {
  return PorId.get(id);
}

export function ehStatus(id: string): id is Status {
  return PorId.has(id);
}

/** Etapas do funil de verdade, sem o 'perdido' (que é saída, não avanço). */
export const ETAPAS: readonly Status[] = FUNIL.filter(
  (s) => s.id !== 'perdido',
).map((s) => s.id);

/**
 * Transições oferecidas na tela. Deliberadamente permissivo: o atendimento
 * descobre coisas fora de ordem (o hóspede já chega pedindo valor), e travar
 * o fluxo só faz a pessoa parar de marcar — e aí a ferramenta morre.
 * A única regra é não sair de um status terminal.
 */
export function transicoesPossiveis(atual: string): Status[] {
  const def = PorId.get(atual);
  if (def?.terminal) return [];
  return FUNIL.filter((s) => s.id !== atual).map((s) => s.id);
}

/** Posição no funil, para ordenar e desenhar a barra. -1 se for 'perdido'. */
export function posicao(status: string): number {
  return ETAPAS.indexOf(status as Status);
}

/**
 * Valor em centavos que deve viajar com a conversão daquele estágio.
 * 'reserva_confirmada' usa o valor da reserva e cai para o cotado se ninguém
 * preencheu — mandar conversão sem valor é pior que mandar o valor aproximado.
 */
export function valorDaConversao(lead: Lead, status: string): number | null {
  if (status === 'reserva_confirmada') {
    return lead.valor_reserva_centavos ?? lead.valor_cotado_centavos ?? null;
  }
  if (status === 'cotacao_enviada') return lead.valor_cotado_centavos ?? null;
  return null;
}

/** Noites da estadia, quando as duas datas existem e fazem sentido. */
export function noites(check_in: string | null, check_out: string | null): number | null {
  if (!check_in || !check_out) return null;
  const ini = Date.parse(`${check_in}T00:00:00Z`);
  const fim = Date.parse(`${check_out}T00:00:00Z`);
  if (Number.isNaN(ini) || Number.isNaN(fim)) return null;
  const dias = Math.round((fim - ini) / 86_400_000);
  return dias > 0 ? dias : null;
}
