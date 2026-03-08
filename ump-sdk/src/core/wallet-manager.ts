import type {
  Wallet, Balance, LedgerEntry, FundWalletOptions, ValueUnitType,
} from '../types';
import { generateId, parseMoney, round, hrTimestamp } from '../utils/id';
import { InsufficientFundsError, WalletFrozenError, UMPError } from '../utils/errors';

/**
 * WalletManager — Layer 1 primitive
 *
 * Manages wallets, balances, reserves, and the immutable spending ledger.
 * Every financial operation is recorded as a LedgerEntry.
 */
export class WalletManager {
  private wallets: Map<string, Wallet> = new Map();
  private ledgers: Map<string, LedgerEntry[]> = new Map(); // walletId -> entries

  /**
   * Create a wallet for an agent.
   */
  create(ownerAgentId: string): Wallet {
    const walletId = generateId('wal');
    const wallet: Wallet = {
      walletId,
      ownerAgentId,
      balances: [{
        valueUnitType: 'FIAT',
        currency: 'USD',
        amount: 0,
        reserved: 0,
        available: 0,
      }],
      frozen: false,
      createdAt: hrTimestamp(),
    };
    this.wallets.set(walletId, wallet);
    this.ledgers.set(walletId, []);
    return wallet;
  }

  /**
   * Get wallet by ID.
   */
  get(walletId: string): Wallet {
    const wallet = this.wallets.get(walletId);
    if (!wallet) throw new UMPError(`Wallet not found: ${walletId}`, 'WALLET_NOT_FOUND');
    return wallet;
  }

  /**
   * Get wallet by owner agent ID.
   */
  getByAgent(agentId: string): Wallet {
    for (const w of this.wallets.values()) {
      if (w.ownerAgentId === agentId) return w;
    }
    throw new UMPError(`No wallet found for agent: ${agentId}`, 'WALLET_NOT_FOUND');
  }

  /**
   * Fund a wallet (add money).
   */
  fund(walletId: string, options: FundWalletOptions): LedgerEntry {
    const wallet = this.get(walletId);
    if (wallet.frozen) throw new WalletFrozenError(walletId);

    const amount = parseMoney(options.amount);
    const vut = options.valueUnitType || 'FIAT';
    const currency = options.currency || 'USD';

    const balance = this.getOrCreateBalance(wallet, vut, currency);
    balance.amount = round(balance.amount + amount);
    balance.available = round(balance.available + amount);

    const entry = this.appendLedger(walletId, {
      type: 'TOPUP',
      amount,
      valueUnitType: vut,
      currency,
      description: `Funded ${amount} ${currency}`,
      balanceAfter: balance.available,
    });

    return entry;
  }

  /**
   * Reserve funds for a pending transaction (escrow pattern).
   */
  reserve(walletId: string, amount: number, counterpartyAgentId: string, transactionId: string): LedgerEntry {
    const wallet = this.get(walletId);
    if (wallet.frozen) throw new WalletFrozenError(walletId);

    const balance = this.getPrimaryBalance(wallet);
    if (balance.available < amount) {
      throw new InsufficientFundsError(balance.available, amount);
    }

    balance.reserved = round(balance.reserved + amount);
    balance.available = round(balance.available - amount);

    return this.appendLedger(walletId, {
      type: 'RESERVE',
      amount,
      valueUnitType: balance.valueUnitType,
      currency: balance.currency,
      counterpartyAgentId,
      transactionId,
      description: `Reserved ${amount} for transaction ${transactionId}`,
      balanceAfter: balance.available,
    });
  }

  /**
   * Debit wallet (immediate drawdown).
   */
  debit(walletId: string, amount: number, counterpartyAgentId: string, transactionId: string): LedgerEntry {
    const wallet = this.get(walletId);
    if (wallet.frozen) throw new WalletFrozenError(walletId);

    const balance = this.getPrimaryBalance(wallet);
    if (balance.available < amount) {
      throw new InsufficientFundsError(balance.available, amount);
    }

    balance.amount = round(balance.amount - amount);
    balance.available = round(balance.available - amount);

    return this.appendLedger(walletId, {
      type: 'DEBIT',
      amount,
      valueUnitType: balance.valueUnitType,
      currency: balance.currency,
      counterpartyAgentId,
      transactionId,
      description: `Debited ${amount} to ${counterpartyAgentId}`,
      balanceAfter: balance.available,
    });
  }

  /**
   * Credit wallet (receive payment).
   */
  credit(walletId: string, amount: number, counterpartyAgentId: string, transactionId: string): LedgerEntry {
    const wallet = this.get(walletId);

    const balance = this.getPrimaryBalance(wallet);
    balance.amount = round(balance.amount + amount);
    balance.available = round(balance.available + amount);

    return this.appendLedger(walletId, {
      type: 'CREDIT',
      amount,
      valueUnitType: balance.valueUnitType,
      currency: balance.currency,
      counterpartyAgentId,
      transactionId,
      description: `Credited ${amount} from ${counterpartyAgentId}`,
      balanceAfter: balance.available,
    });
  }

  /**
   * Release reserved funds (escrow release after outcome).
   */
  releaseReservation(walletId: string, amount: number, transactionId: string): LedgerEntry {
    const wallet = this.get(walletId);
    const balance = this.getPrimaryBalance(wallet);

    const releaseAmount = Math.min(amount, balance.reserved);
    balance.reserved = round(balance.reserved - releaseAmount);
    balance.amount = round(balance.amount - releaseAmount);

    return this.appendLedger(walletId, {
      type: 'RELEASE',
      amount: releaseAmount,
      valueUnitType: balance.valueUnitType,
      currency: balance.currency,
      transactionId,
      description: `Released ${releaseAmount} from escrow for ${transactionId}`,
      balanceAfter: balance.available,
    });
  }

  /**
   * Emergency freeze — blocks all transactions.
   */
  freeze(walletId: string): void {
    const wallet = this.get(walletId);
    wallet.frozen = true;
  }

  /**
   * Unfreeze wallet.
   */
  unfreeze(walletId: string): void {
    const wallet = this.get(walletId);
    wallet.frozen = false;
  }

  /**
   * Get immutable ledger entries for a wallet.
   */
  getLedger(walletId: string, limit = 100, offset = 0): LedgerEntry[] {
    const entries = this.ledgers.get(walletId) || [];
    return entries.slice(offset, offset + limit);
  }

  /**
   * Get real-time balance summary.
   */
  getBalance(walletId: string): Balance[] {
    const wallet = this.get(walletId);
    return wallet.balances.map(b => ({ ...b })); // return copies
  }

  // ── Private helpers ──

  private getPrimaryBalance(wallet: Wallet): Balance {
    if (wallet.balances.length === 0) {
      const balance: Balance = {
        valueUnitType: 'FIAT',
        currency: 'USD',
        amount: 0,
        reserved: 0,
        available: 0,
      };
      wallet.balances.push(balance);
      return balance;
    }
    return wallet.balances[0];
  }

  private getOrCreateBalance(wallet: Wallet, vut: ValueUnitType, currency?: string): Balance {
    let balance = wallet.balances.find(
      b => b.valueUnitType === vut && b.currency === currency
    );
    if (!balance) {
      balance = { valueUnitType: vut, currency, amount: 0, reserved: 0, available: 0 };
      wallet.balances.push(balance);
    }
    return balance;
  }

  private appendLedger(
    walletId: string,
    data: Omit<LedgerEntry, 'entryId' | 'timestamp'>
  ): LedgerEntry {
    const entry: LedgerEntry = {
      entryId: generateId('led'),
      timestamp: hrTimestamp(),
      ...data,
    };
    const ledger = this.ledgers.get(walletId);
    if (ledger) ledger.push(entry);
    return entry;
  }
}
