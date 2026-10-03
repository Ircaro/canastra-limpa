export type LixoRule = 'aberto' | 'fechado';
export type WildRule = 'dois' | 'doisEJokers';
export type DuqueRule = 'ate8' | 'sempre';
export type MortosRule = 'dois' | 'um';

export const SINGLE_HAND = 0;
export const TARGETS: readonly number[] = [SINGLE_HAND, 2000, 3000];

export function metaLabel(meta: number): string {
  return meta === SINGLE_HAND ? '1 partida' : `${meta} pontos`;
}

export interface RuleSet {
  lixo: LixoRule;
  coringas: WildRule;
  duque: DuqueRule;
  mortos: MortosRule;
  meta: number;
  vulneravel: boolean;
}

export const VULNERAVEL_PONTOS = 1000;
export const ABERTURA_MINIMA = 75;
export const ABERTURA_PASSO = 15;

export const DEFAULT_RULES: RuleSet = { lixo: 'aberto', coringas: 'dois', duque: 'ate8', mortos: 'dois', meta: 3000, vulneravel: true };

export function sanitizeRules(input: unknown): RuleSet {
  const value = (typeof input === 'object' && input !== null ? input : {}) as Partial<Record<keyof RuleSet, unknown>>;
  return {
    lixo: value.lixo === 'fechado' ? 'fechado' : 'aberto',
    coringas: value.coringas === 'doisEJokers' ? 'doisEJokers' : 'dois',
    duque: value.duque === 'sempre' ? 'sempre' : 'ate8',
    mortos: value.mortos === 'um' ? 'um' : 'dois',
    meta: typeof value.meta === 'number' && TARGETS.includes(value.meta) ? value.meta : DEFAULT_RULES.meta,
    vulneravel: value.vulneravel !== false,
  };
}
