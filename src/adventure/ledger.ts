import type { LedgerEntry, NodeId, Wallet } from './types';

/** 10^12 share units per share; price uses 10^6 units per coin and cash uses 100 cents per coin. */
export const SHARE_SCALE = 1_000_000_000_000n;
const CASH_PRICE_SHARE_FACTOR = 10_000_000_000_000_000n;

export function requireCents(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('金额必须是非负整数分。');
}

function asSafeNumber(value: bigint): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error('金额超出安全范围。');
  return result;
}

function roundDivide(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
}

export function sharesForCents(cents: number, price: number): string {
  requireCents(cents);
  if (!Number.isSafeInteger(price) || price <= 0) throw new Error('报价必须是正整数。');
  return (BigInt(cents) * CASH_PRICE_SHARE_FACTOR / BigInt(price)).toString();
}

export function centsForShares(shareUnits: string, price: number): number {
  if (!/^\d+$/.test(shareUnits)) throw new Error('份额无效。');
  if (!Number.isSafeInteger(price) || price <= 0) throw new Error('报价必须是正整数。');
  return asSafeNumber(roundDivide(BigInt(shareUnits) * BigInt(price), CASH_PRICE_SHARE_FACTOR));
}

export function sharesForPercent(shareUnits: string, percent: 0 | 50 | 100): string {
  if (!/^\d+$/.test(shareUnits) || ![0, 50, 100].includes(percent)) throw new Error('回收比例无效。');
  return (BigInt(shareUnits) * BigInt(percent) / 100n).toString();
}

function addEntry(wallet: Wallet, id: string, node: NodeId, kind: LedgerEntry['kind'], delta: number, description: string): void {
  if (!Number.isSafeInteger(delta) || !Number.isSafeInteger(wallet.cashCents + delta) || wallet.cashCents + delta < 0) throw new Error('可用金币不足或金额无效。');
  wallet.cashCents += delta;
  wallet.ledger.push({ id, node, kind, cashDeltaCents: delta, cashAfterCents: wallet.cashCents, description });
}

export function rewardCash(wallet: Wallet, amountCents: number, id: string, node: NodeId, description: string): void {
  requireCents(amountCents);
  addEntry(wallet, id, node, 'battle-reward', amountCents, description);
}

export function spendCash(wallet: Wallet, amountCents: number, id: string, node: NodeId, description: string): void {
  requireCents(amountCents);
  addEntry(wallet, id, node, 'purchase', -amountCents, description);
}

export function reserveEntry(wallet: Wallet, amountCents: number, id: string, node: NodeId): void {
  requireCents(amountCents);
  addEntry(wallet, id, node, 'entry-reserve', -amountCents, '契约参与金额预留，等待下一开盘价执行');
  wallet.reservedCents += amountCents;
}

export function settleEntry(wallet: Wallet, amountCents: number, price: number): string {
  if (wallet.reservedCents < amountCents) throw new Error('预留资金不足。');
  const units = sharesForCents(amountCents, price);
  wallet.reservedCents -= amountCents;
  wallet.shareUnits = (BigInt(wallet.shareUnits) + BigInt(units)).toString();
  wallet.costBasisCents += amountCents;
  wallet.investedCents += amountCents;
  return units;
}

export function settleSale(wallet: Wallet, soldUnits: string, price: number, id: string, node: NodeId): { proceedsCents: number; costCents: number; pnlCents: number } {
  if (!/^\d+$/.test(soldUnits)) throw new Error('回收份额无效。');
  const sold = BigInt(soldUnits);
  const total = BigInt(wallet.shareUnits);
  if (sold > total) throw new Error('不能回收超过已有的份额。');
  const proceedsCents = centsForShares(soldUnits, price);
  const costCents = sold === total ? wallet.costBasisCents : total === 0n ? 0 : asSafeNumber(roundDivide(BigInt(wallet.costBasisCents) * sold, total));
  wallet.shareUnits = (total - sold).toString();
  wallet.costBasisCents -= costCents;
  wallet.proceedsCents += proceedsCents;
  const pnlCents = proceedsCents - costCents;
  wallet.realizedPnlCents += pnlCents;
  addEntry(wallet, id, node, 'redemption', proceedsCents, '契约份额按实际开盘价回收到账');
  return { proceedsCents, costCents, pnlCents };
}
