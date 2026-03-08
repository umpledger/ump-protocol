import type {
  PricingRule, FixedRule, UnitRateRule, TieredRule,
  PercentageRule, ThresholdRule, TimeWindowRule,
  ConditionalRule, CompositeRule, UsageEvent, RatedRecord,
} from '../types';
import { generateId, round, hrTimestamp } from '../utils/id';
import { UMPError } from '../utils/errors';

/**
 * Context passed into the rating engine for each usage event.
 * Contains the event data plus any external dimensions needed
 * for conditional evaluation.
 */
export interface RatingContext {
  event: UsageEvent;
  cumulativeQuantity?: number; // for tiered calculations within a period
  referenceAmount?: number;    // for percentage-based calculations
  currentTime?: Date;          // override for time-window testing
  attributes?: Record<string, string | number | boolean>;
}

/**
 * PricingEngine — Layer 2 primitive
 *
 * Evaluates the 8 atomic pricing primitives and their compositions.
 * Takes usage events + pricing rules → rated records (billable amounts).
 */
export class PricingEngine {

  /**
   * Rate a single usage event against a pricing rule.
   * Returns the calculated amount.
   */
  rate(rule: PricingRule, context: RatingContext): RatedRecord {
    const amount = this.evaluate(rule, context);

    return {
      ratedRecordId: generateId('rat'),
      usageEventId: context.event.eventId,
      contractId: context.event.contractId,
      pricingRuleId: rule.ruleId,
      quantity: context.event.quantity,
      rate: context.event.quantity > 0 ? round(amount / context.event.quantity, 6) : 0,
      amount: round(amount),
      currency: 'USD', // default, override via contract
      ratedAt: hrTimestamp(),
    };
  }

  /**
   * Rate multiple usage events against a pricing rule.
   */
  rateBatch(rule: PricingRule, events: UsageEvent[]): RatedRecord[] {
    let cumulative = 0;
    return events.map(event => {
      cumulative += event.quantity;
      const context: RatingContext = {
        event,
        cumulativeQuantity: cumulative,
      };
      return this.rate(rule, context);
    });
  }

  /**
   * Simulate: calculate projected cost without creating rated records.
   */
  simulate(rule: PricingRule, quantity: number, dimensions?: Record<string, string | number>): number {
    const mockEvent: UsageEvent = {
      eventId: 'sim',
      sourceAgentId: 'sim',
      targetAgentId: 'sim',
      contractId: 'sim',
      serviceId: 'sim',
      timestamp: new Date(),
      quantity,
      unit: 'UNIT',
      dimensions: dimensions || {},
    };
    return round(this.evaluate(rule, { event: mockEvent }));
  }

  /**
   * Human-readable breakdown of how a price was calculated.
   */
  explain(rule: PricingRule, context: RatingContext): string {
    return this.buildExplanation(rule, context, 0);
  }

  // ═══════════════════════════════════════════════════════════
  // PRIMITIVE EVALUATORS
  // ═══════════════════════════════════════════════════════════

  private evaluate(rule: PricingRule, ctx: RatingContext): number {
    switch (rule.primitive) {
      case 'FIXED':       return this.evalFixed(rule as FixedRule, ctx);
      case 'UNIT_RATE':   return this.evalUnitRate(rule as UnitRateRule, ctx);
      case 'TIERED':      return this.evalTiered(rule as TieredRule, ctx);
      case 'PERCENTAGE':  return this.evalPercentage(rule as PercentageRule, ctx);
      case 'THRESHOLD':   return this.evalThreshold(rule as ThresholdRule, ctx);
      case 'TIME_WINDOW': return this.evalTimeWindow(rule as TimeWindowRule, ctx);
      case 'CONDITIONAL': return this.evalConditional(rule as ConditionalRule, ctx);
      case 'COMPOSITE':   return this.evalComposite(rule as CompositeRule, ctx);
      default:
        throw new UMPError(`Unknown pricing primitive: ${(rule as PricingRule).primitive}`, 'INVALID_RULE');
    }
  }

  /**
   * FIXED: flat amount per event or period.
   */
  private evalFixed(rule: FixedRule, _ctx: RatingContext): number {
    return rule.amount;
  }

  /**
   * UNIT_RATE: rate × quantity.
   */
  private evalUnitRate(rule: UnitRateRule, ctx: RatingContext): number {
    return rule.rate * ctx.event.quantity;
  }

  /**
   * TIERED: different rates at different consumption levels.
   * Supports GRADUATED (each unit at its tier's rate) and VOLUME (all units at qualifying tier).
   */
  private evalTiered(rule: TieredRule, ctx: RatingContext): number {
    const quantity = ctx.cumulativeQuantity ?? ctx.event.quantity;

    if (rule.mode === 'VOLUME') {
      // All units priced at the tier the total quantity falls into
      const tier = rule.tiers.find(t =>
        quantity >= t.from && (t.to === null || quantity <= t.to)
      );
      return (tier?.rate ?? rule.tiers[rule.tiers.length - 1].rate) * ctx.event.quantity;
    }

    // GRADUATED: each unit priced at its tier's rate
    let total = 0;
    let remaining = ctx.event.quantity;
    // Calculate the starting position based on cumulative minus current event
    let position = (ctx.cumulativeQuantity ?? ctx.event.quantity) - ctx.event.quantity;

    for (const tier of rule.tiers) {
      if (remaining <= 0) break;
      const tierEnd = tier.to ?? Infinity;
      const tierStart = tier.from;

      // How much of this event falls in this tier?
      if (position >= tierEnd) continue; // already past this tier

      const effectiveStart = Math.max(position, tierStart);
      const effectiveEnd = Math.min(position + remaining, tierEnd);
      const unitsInTier = Math.max(0, effectiveEnd - effectiveStart);

      total += unitsInTier * tier.rate;
      remaining -= unitsInTier;
      position += unitsInTier;
    }

    return total;
  }

  /**
   * PERCENTAGE: fraction of a reference amount.
   */
  private evalPercentage(rule: PercentageRule, ctx: RatingContext): number {
    const reference = ctx.referenceAmount ??
      (ctx.event.dimensions[rule.referenceField] as number) ?? 0;

    let amount = reference * rule.percentage;
    if (rule.min !== undefined) amount = Math.max(amount, rule.min);
    if (rule.max !== undefined) amount = Math.min(amount, rule.max);

    return amount;
  }

  /**
   * THRESHOLD: binary trigger — different rates above/below threshold.
   */
  private evalThreshold(rule: ThresholdRule, ctx: RatingContext): number {
    const quantity = ctx.cumulativeQuantity ?? ctx.event.quantity;
    if (quantity <= rule.threshold) {
      return ctx.event.quantity * rule.belowRate;
    }
    return ctx.event.quantity * rule.aboveRate;
  }

  /**
   * TIME_WINDOW: rate varies by when consumption occurs.
   */
  private evalTimeWindow(rule: TimeWindowRule, ctx: RatingContext): number {
    const time = ctx.currentTime ?? ctx.event.timestamp;
    const hour = time.getHours(); // simplified; production would use timezone
    const day = time.getDay();

    for (const window of rule.windows) {
      const dayMatch = !window.dayOfWeek || window.dayOfWeek.includes(day);
      const hourMatch = hour >= window.startHour && hour < window.endHour;
      if (dayMatch && hourMatch) {
        return ctx.event.quantity * window.rate;
      }
    }

    return ctx.event.quantity * rule.defaultRate;
  }

  /**
   * CONDITIONAL: price depends on an attribute or outcome.
   */
  private evalConditional(rule: ConditionalRule, ctx: RatingContext): number {
    const fieldValue = ctx.event.dimensions[rule.field] ??
      ctx.attributes?.[rule.field];

    for (const branch of rule.branches) {
      if (this.evaluateCondition(branch.condition, fieldValue)) {
        return this.evaluate(branch.rule, ctx);
      }
    }

    if (rule.fallback) {
      return this.evaluate(rule.fallback, ctx);
    }

    return 0;
  }

  /**
   * COMPOSITE: combines multiple rules with an operator.
   */
  private evalComposite(rule: CompositeRule, ctx: RatingContext): number {
    const amounts = rule.rules.map(r => this.evaluate(r, ctx));

    switch (rule.operator) {
      case 'ADD':
        return amounts.reduce((sum, a) => sum + a, 0);
      case 'MAX':
        return Math.max(...amounts);
      case 'MIN':
        return Math.min(...amounts);
      case 'FIRST_MATCH':
        // Return first non-zero amount
        return amounts.find(a => a > 0) ?? 0;
      default:
        throw new UMPError(`Unknown composite operator: ${rule.operator}`, 'INVALID_RULE');
    }
  }

  // ── Condition evaluator (simplified expression engine) ──

  private evaluateCondition(condition: string, value: unknown): boolean {
    // Simple equality/comparison: "outcome == 'SUCCESS'"
    const eqMatch = condition.match(/^(\w+)\s*==\s*'([^']+)'$/);
    if (eqMatch) return String(value) === eqMatch[2];

    const neqMatch = condition.match(/^(\w+)\s*!=\s*'([^']+)'$/);
    if (neqMatch) return String(value) !== neqMatch[2];

    const gtMatch = condition.match(/^(\w+)\s*>\s*(\d+(?:\.\d+)?)$/);
    if (gtMatch) return Number(value) > Number(gtMatch[2]);

    const ltMatch = condition.match(/^(\w+)\s*<\s*(\d+(?:\.\d+)?)$/);
    if (ltMatch) return Number(value) < Number(ltMatch[2]);

    const gteMatch = condition.match(/^(\w+)\s*>=\s*(\d+(?:\.\d+)?)$/);
    if (gteMatch) return Number(value) >= Number(gteMatch[2]);

    // Simple truthy check
    if (condition === String(value)) return true;

    return false;
  }

  // ── Explanation builder ──

  private buildExplanation(rule: PricingRule, ctx: RatingContext, depth: number): string {
    const indent = '  '.repeat(depth);
    const amount = round(this.evaluate(rule, ctx));

    switch (rule.primitive) {
      case 'FIXED':
        return `${indent}FIXED: $${(rule as FixedRule).amount} flat = $${amount}`;
      case 'UNIT_RATE':
        return `${indent}UNIT_RATE: ${ctx.event.quantity} × $${(rule as UnitRateRule).rate}/${(rule as UnitRateRule).unit} = $${amount}`;
      case 'TIERED':
        return `${indent}TIERED (${(rule as TieredRule).mode}): ${ctx.event.quantity} units across ${(rule as TieredRule).tiers.length} tiers = $${amount}`;
      case 'PERCENTAGE':
        return `${indent}PERCENTAGE: ${((rule as PercentageRule).percentage * 100).toFixed(1)}% of reference = $${amount}`;
      case 'THRESHOLD':
        return `${indent}THRESHOLD: ${ctx.event.quantity > (rule as ThresholdRule).threshold ? 'above' : 'below'} ${(rule as ThresholdRule).threshold} → $${amount}`;
      case 'TIME_WINDOW':
        return `${indent}TIME_WINDOW: rate at ${ctx.event.timestamp.toISOString()} = $${amount}`;
      case 'CONDITIONAL': {
        const lines = [`${indent}CONDITIONAL on "${(rule as ConditionalRule).field}":`];
        lines.push(`${indent}  → result = $${amount}`);
        return lines.join('\n');
      }
      case 'COMPOSITE': {
        const comp = rule as CompositeRule;
        const lines = [`${indent}COMPOSITE (${comp.operator}):`];
        for (const sub of comp.rules) {
          lines.push(this.buildExplanation(sub, ctx, depth + 1));
        }
        lines.push(`${indent}  = $${amount}`);
        return lines.join('\n');
      }
      default:
        return `${indent}UNKNOWN: $${amount}`;
    }
  }
}
