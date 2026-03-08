import { v4 as uuidv4 } from 'uuid';

/**
 * Generate a prefixed UUID for UMP entities.
 * Format: {prefix}_{uuid} e.g. "agt_a1b2c3d4-..."
 */
export function generateId(prefix: string): string {
  return `${prefix}_${uuidv4()}`;
}

/**
 * Parse a monetary string like "$50" or "50.00" into a number.
 */
export function parseMoney(value: number | string): number {
  if (typeof value === 'number') return value;
  const cleaned = value.replace(/[^0-9.-]/g, '');
  const parsed = parseFloat(cleaned);
  if (isNaN(parsed)) throw new Error(`Invalid monetary value: ${value}`);
  return parsed;
}

/**
 * Round to N decimal places (default 2 for currency).
 */
export function round(value: number, decimals = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/**
 * High-resolution timestamp for audit records.
 */
export function hrTimestamp(): Date {
  return new Date();
}
