/** All amounts ending in Cents are integer hundredths of one in-game coin. */
export type CardId = `C${'01' | '02' | '03' | '04' | '05' | '06' | '07' | '08' | '09' | '10' | '11' | '12' | '13' | '14'}`;
export type EnemyId = 'gatekeeper' | 'pursuer' | 'moss' | 'clock' | 'keeper';
export type NodeId = 'N1' | 'N2' | 'N3' | 'N4' | 'N5' | 'N6' | 'N7' | 'N8';
export type RunPhase = 'battle' | 'reward' | 'camp' | 'route' | 'market' | 'ended';
export type RunStatus = 'active' | 'cleared' | 'returned' | 'defeated';
export type RunSource = 'real' | 'demo' | 'fork';
export type MarketStage = 'entry' | 't1' | 't1-exec' | 't2' | 't2-exec' | 't3' | 'final-exec' | 'exit-after-entry' | 'exit-after-t1-exec' | 'exit-after-t2-exec';

export interface CardDefinition {
  id: CardId;
  name: string;
  cost: number;
  upgradedCost: number;
  description: string;
  upgradedDescription: string;
  overload: number;
  exhaust: boolean;
  retain: boolean;
  attack: boolean;
}

export interface CardInstance { instanceId: string; cardId: CardId; upgraded: boolean }
export interface Intent { kind: 'attack' | 'shield'; amount: number }
export interface EnemyDefinition { id: EnemyId; name: string; maxHp: number; cycle: Intent[]; rewardCents: number; blurb: string }
export interface EnemyState { id: EnemyId; hp: number; maxHp: number; shield: number; intent: Intent; attackBonus: number }

export interface BattleState {
  enemy: EnemyState;
  turn: number;
  energy: number;
  capacity: number;
  overloadNext: number;
  shield: number;
  attackBonus: number;
  hand: string[];
  drawPile: string[];
  discardPile: string[];
  exhaustPile: string[];
  /** Card instance IDs given one-turn retain by C14. */
  retainedOnce: string[];
  rngState: number;
  log: string[];
}

/** Price is a positive integer fixed point number, with T0 close normalized to 1,000,000. */
export interface MarketQuote { caseId: string; step: MarketStage; date: string; price: number }
export interface MarketRequest { caseId: string; stage: MarketStage; unlocked: true }
export type Order =
  | { id: string; kind: 'entry'; amountCents: number }
  | { id: string; kind: 'sell'; shareUnits: string; automatic: boolean };
export interface LedgerEntry {
  id: string;
  node: NodeId;
  kind: 'opening' | 'battle-reward' | 'purchase' | 'entry-reserve' | 'redemption';
  cashDeltaCents: number;
  cashAfterCents: number;
  description: string;
}
export interface Wallet {
  cashCents: number;
  reservedCents: number;
  /** One share = 1,000,000,000,000 shareUnits; string avoids JSON BigInt loss. */
  shareUnits: string;
  costBasisCents: number;
  investedCents: number;
  proceedsCents: number;
  realizedPnlCents: number;
  ledger: LedgerEntry[];
}
export interface MarketState {
  pending: MarketRequest | null;
  order: Order | null;
  lastQuote: MarketQuote | null;
  entryCommitted: boolean;
  /** A reference value is informative only; it is never spendable cash. */
  referenceValueCents: number | null;
}
export interface CampState {
  node: 'N2' | 'N4' | 'N6';
  stock: CardId[];
  purchased: CardId[];
  freeChoiceUsed: boolean;
  decision: 'not-submitted' | 'awaiting-execution' | 'settled';
}
export interface RewardState { choices: CardId[]; coinsCents: number }
export interface RouteOption { enemyId: EnemyId; name: string; description: string; rewardCents: number }
export interface ActionAvailability { type: RunAction['type']; enabled: boolean; reason?: string }

export interface DecisionSnapshot {
  node: NodeId;
  phase: RunPhase;
  hp: number;
  maxHp: number;
  shield: number;
  cashCents: number;
  reservedCents: number;
  shareUnits: string;
  costBasisCents: number;
  referenceValueCents: number | null;
  deck: CardInstance[];
  shop: CardId[];
  rewardChoices: CardId[];
  prices: { healCents: number; upgradeCents: number; cardCents: number; archiveCents: number };
  routes: RouteOption[];
  archiveOwned: boolean;
  lastQuote: MarketQuote | null;
  order: Order | null;
  available: ActionAvailability[];
  supplyPlanCents: number | null;
}
export interface GameEvent {
  id: string;
  node: NodeId;
  type: 'battle' | 'choice' | 'market' | 'system';
  action: string;
  message: string;
  data: Record<string, string | number | boolean | null>;
  snapshot?: DecisionSnapshot;
}

export interface Run {
  version: '0.4.1';
  id: string;
  seed: number;
  source: RunSource;
  observationEnabled: boolean;
  caseId: string;
  node: NodeId;
  phase: RunPhase;
  status: RunStatus;
  hp: number;
  maxHp: number;
  deck: CardInstance[];
  wallet: Wallet;
  market: MarketState;
  battle: BattleState | null;
  reward: RewardState | null;
  camp: CampState | null;
  archiveOwned: boolean;
  supplyPlanCents: number | null;
  nextCardNumber: number;
  history: GameEvent[];
  /** State immediately before each choice, allowing legal forks with later actions discarded. */
  checkpoints: DecisionCheckpoint[];
  processedActionIds: string[];
}
export type RunSnapshot = Omit<Run, 'checkpoints'>;
export interface DecisionCheckpoint { id: string; action: string; snapshot: RunSnapshot }
export interface CreateRunOptions { seed?: number; caseId?: string; source?: RunSource; observationEnabled?: boolean }

type ActionIdentity = { actionId?: string };
export type RunAction = ActionIdentity & (
  | { type: 'play-card'; cardInstanceId: string; retainCardId?: string }
  | { type: 'end-turn' }
  | { type: 'choose-reward'; cardId: CardId | null }
  | { type: 'buy-card'; cardId: CardId }
  | { type: 'heal' }
  | { type: 'upgrade-card'; cardInstanceId: string }
  | { type: 'free-rest' }
  | { type: 'free-upgrade'; cardInstanceId: string }
  | { type: 'buy-archive' }
  | { type: 'open-archive' }
  | { type: 'purchase-attempted'; purchase: 'heal' | 'upgrade-card' | 'buy-card' | 'buy-archive'; cardId?: CardId; cardInstanceId?: string }
  | { type: 'set-supply-plan'; amountCents: number | null }
  | { type: 'submit-entry'; amountCents: number }
  | { type: 'submit-redemption'; percent: 0 | 50 | 100 }
  | { type: 'continue' }
  | { type: 'choose-route'; enemyId: EnemyId }
  | { type: 'return-home' }
  | { type: 'apply-quote'; quote: MarketQuote }
);
