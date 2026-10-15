import type { I18n, Profile, ProfileField, Rule, Scheme } from './types.js';

/**
 * The rules engine ("layer 2" in the PRD): a profile and the schemes in, which schemes match and why out.
 * Pure functions, no network, no I/O.
 *
 * Each rule has three possible outcomes for a profile:
 *   met      the profile answers the question and satisfies the rule
 *   failed   the profile answers the question and does NOT satisfy the rule
 *   unknown  the profile has not answered the question yet
 *
 * A scheme is therefore
 *   eligible   every rule is met
 *   excluded   at least one rule failed
 *   possible   nothing failed, but some answers are still missing
 */
export type RuleOutcome = 'met' | 'failed' | 'unknown';
export type SchemeStatus = 'eligible' | 'possible' | 'excluded';

export interface RuleResult {
  ruleId: string;
  field: ProfileField;
  label: I18n;
  outcome: RuleOutcome;
}

export interface SchemeResult {
  scheme: Scheme;
  status: SchemeStatus;
  rules: RuleResult[];
}

function satisfies(rule: Rule, answer: string | number | boolean): boolean {
  const { operator, value } = rule;
  switch (operator) {
    case '=':
      return answer === value;
    case '!=':
      return answer !== value;
    case '>':
      return typeof answer === 'number' && typeof value === 'number' && answer > value;
    case '>=':
      return typeof answer === 'number' && typeof value === 'number' && answer >= value;
    case '<':
      return typeof answer === 'number' && typeof value === 'number' && answer < value;
    case '<=':
      return typeof answer === 'number' && typeof value === 'number' && answer <= value;
    case 'IN':
      return Array.isArray(value) && (value as (string | number | boolean)[]).includes(answer);
    case 'NOT_IN':
      return Array.isArray(value) && !(value as (string | number | boolean)[]).includes(answer);
  }
}

export function checkRule(rule: Rule, profile: Profile): RuleOutcome {
  const answer = profile[rule.field];
  if (answer === undefined) return 'unknown';
  return satisfies(rule, answer) ? 'met' : 'failed';
}

export function evaluateScheme(scheme: Scheme, profile: Profile): SchemeResult {
  const rules = scheme.eligibility.rules.map((rule) => ({
    ruleId: rule.ruleId,
    field: rule.field,
    label: rule.label,
    outcome: checkRule(rule, profile),
  }));
  const status: SchemeStatus = rules.some((r) => r.outcome === 'failed')
    ? 'excluded'
    : rules.some((r) => r.outcome === 'unknown')
      ? 'possible'
      : 'eligible';
  return { scheme, status, rules };
}

export function evaluate(schemes: readonly Scheme[], profile: Profile): SchemeResult[] {
  return schemes.map((s) => evaluateScheme(s, profile));
}

/** What the network gets back: only the schemes whose every rule is met. */
export function eligibleSchemes(schemes: readonly Scheme[], profile: Profile): SchemeResult[] {
  return evaluate(schemes, profile).filter((r) => r.status === 'eligible');
}

/**
 * Questions still worth asking: unanswered in at least one scheme that has not already been ruled out.
 * A questionnaire that asks only these never asks something that cannot change the result.
 */
export function stillUnknownFields(schemes: readonly Scheme[], profile: Profile): ProfileField[] {
  const need = new Set<ProfileField>();
  for (const result of evaluate(schemes, profile)) {
    if (result.status === 'excluded') continue;
    for (const r of result.rules) if (r.outcome === 'unknown') need.add(r.field);
  }
  return [...need];
}
