import type { PricingRule } from '../types';
import { generateId } from '../utils/id';

/**
 * Pre-built pricing rule templates for common AI-era models.
 * These are convenience factories — all decompose into the 8 atomic primitives.
 */
export const PricingTemplates = {

  /**
   * Per-Token LLM pricing (separate input/output rates).
   * Example: GPT-4 at $30/M input, $60/M output tokens.
   */
  perToken(inputRatePerMillion: number, outputRatePerMillion: number): PricingRule {
    return {
      ruleId: generateId('rul'),
      name: 'Per-Token LLM',
      description: `$${inputRatePerMillion}/M input, $${outputRatePerMillion}/M output tokens`,
      primitive: 'CONDITIONAL',
      field: 'direction',
      branches: [
        {
          condition: "direction == 'input'",
          rule: {
            ruleId: generateId('rul'),
            name: 'Input Token Rate',
            primitive: 'UNIT_RATE',
            rate: inputRatePerMillion / 1_000_000,
            unit: 'TOKEN',
          },
        },
        {
          condition: "direction == 'output'",
          rule: {
            ruleId: generateId('rul'),
            name: 'Output Token Rate',
            primitive: 'UNIT_RATE',
            rate: outputRatePerMillion / 1_000_000,
            unit: 'TOKEN',
          },
        },
      ],
    };
  },

  /**
   * Per-Inference pricing with volume tiers.
   * Example: $0.01/call for first 10K, $0.005/call after.
   */
  perInference(tiers: Array<{ upTo: number | null; rate: number }>): PricingRule {
    return {
      ruleId: generateId('rul'),
      name: 'Per-Inference Tiered',
      primitive: 'TIERED',
      mode: 'GRADUATED',
      tiers: tiers.map((t, i) => ({
        from: i === 0 ? 0 : (tiers[i - 1].upTo ?? 0),
        to: t.upTo,
        rate: t.rate,
      })),
    };
  },

  /**
   * Per-Resolution / outcome-based pricing.
   * Charges only on successful outcome + percentage of value.
   */
  perResolution(successFee: number, valuePct: number): PricingRule {
    return {
      ruleId: generateId('rul'),
      name: 'Per-Resolution Outcome',
      primitive: 'CONDITIONAL',
      field: 'outcome',
      branches: [
        {
          condition: "outcome == 'SUCCESS'",
          rule: {
            ruleId: generateId('rul'),
            name: 'Success Composite',
            primitive: 'COMPOSITE',
            operator: 'ADD',
            rules: [
              {
                ruleId: generateId('rul'),
                name: 'Success Fee',
                primitive: 'FIXED',
                amount: successFee,
                period: 'PER_EVENT',
              },
              {
                ruleId: generateId('rul'),
                name: 'Value Share',
                primitive: 'PERCENTAGE',
                percentage: valuePct,
                referenceField: 'value_generated',
              },
            ],
          },
        },
      ],
      fallback: {
        ruleId: generateId('rul'),
        name: 'No charge on failure',
        primitive: 'FIXED',
        amount: 0,
        period: 'PER_EVENT',
      },
    };
  },

  /**
   * Subscription + Usage hybrid.
   * Base monthly fee + per-unit overage above included units.
   */
  subscriptionPlusUsage(
    monthlyBase: number,
    includedUnits: number,
    overageRate: number
  ): PricingRule {
    return {
      ruleId: generateId('rul'),
      name: 'Subscription + Usage',
      primitive: 'COMPOSITE',
      operator: 'ADD',
      rules: [
        {
          ruleId: generateId('rul'),
          name: 'Monthly Base',
          primitive: 'FIXED',
          amount: monthlyBase,
          period: 'MONTHLY',
        },
        {
          ruleId: generateId('rul'),
          name: 'Overage',
          primitive: 'THRESHOLD',
          threshold: includedUnits,
          belowRate: 0,
          aboveRate: overageRate,
        },
      ],
    };
  },

  /**
   * Credit pool with per-unit drawdown.
   */
  creditPool(creditCost: number): PricingRule {
    return {
      ruleId: generateId('rul'),
      name: 'Credit Pool',
      primitive: 'UNIT_RATE',
      rate: creditCost,
      unit: 'CREDIT',
    };
  },

  /**
   * Spot compute pricing with peak/off-peak rates.
   */
  computeSpot(
    peakRate: number,
    offPeakRate: number,
    peakHours: [number, number] = [9, 17]
  ): PricingRule {
    return {
      ruleId: generateId('rul'),
      name: 'Compute Spot',
      primitive: 'TIME_WINDOW',
      windows: [
        {
          startHour: peakHours[0],
          endHour: peakHours[1],
          rate: peakRate,
          label: 'peak',
          dayOfWeek: [1, 2, 3, 4, 5], // weekdays
        },
      ],
      defaultRate: offPeakRate,
      timezone: 'UTC',
    };
  },

  /**
   * Marketplace commission (percentage take rate with floor and cap).
   */
  marketplaceCommission(takeRate: number, minFee: number, maxFee: number): PricingRule {
    return {
      ruleId: generateId('rul'),
      name: 'Marketplace Commission',
      primitive: 'PERCENTAGE',
      percentage: takeRate,
      referenceField: 'transaction_amount',
      min: minFee,
      max: maxFee,
    };
  },

  /**
   * Agent-to-agent task pricing (fixed per-task + outcome bonus).
   */
  agentTask(basePerTask: number, bonusOnSuccess: number): PricingRule {
    return {
      ruleId: generateId('rul'),
      name: 'Agent Task',
      primitive: 'COMPOSITE',
      operator: 'ADD',
      rules: [
        {
          ruleId: generateId('rul'),
          name: 'Base Task Fee',
          primitive: 'FIXED',
          amount: basePerTask,
          period: 'PER_EVENT',
        },
        {
          ruleId: generateId('rul'),
          name: 'Success Bonus',
          primitive: 'CONDITIONAL',
          field: 'outcome',
          branches: [
            {
              condition: "outcome == 'SUCCESS'",
              rule: {
                ruleId: generateId('rul'),
                name: 'Bonus',
                primitive: 'FIXED',
                amount: bonusOnSuccess,
                period: 'PER_EVENT',
              },
            },
          ],
        },
      ],
    };
  },
};
