// token-radar-01 v6 — model, board, farm plans and ledger.
//
// The model is the v5 model, unchanged for v6 (see DESIGN.md): a blend of a
// grouped log-log curve (weight 0.7) and a ridge median regression (weight
// 0.3), both fit at runtime from the snapshot's own 128 comps. Nothing here
// names a protocol: every fitted number comes out of the snapshot at run
// time. v6 adds only a display ledger (see computeLedger) and the interval
// constants live in the dashboard, not in this model.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  ratio: number;
  curve_usd: number;
  grouped_usd: number;
  ridge_usd: number;
  group: string;
  group_offset_log: number;
  ridge_delta_log: number;
  watchlist: boolean;
}

/** A live-token protocol for the dashboard's reference view. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
}

/** The ledger: every one of the snapshot's 758 protocols, accounted for. */
export interface Ledger {
  token_trades: number;
  token_recorded_no_cap: number;
  ranked_watchlist: number;
  ranked_above_floor: number;
  ranked_below_floor: number;
  out_bridge: number;
  out_liquid_staking: number;
  out_exchange: number;
  out_versioned: number;
  out_wrapped: number;
  total: number;
}

/** Everything the dashboard renders, from the snapshot. */
export interface RadarData {
  meta: {
    as_of: string;
    model: string;
    curve: { intercept: number; slope: number; global_median_residual: number };
    validation: { cv_5fold: number; walk_forward: number; blind_30: number; note: string };
    counts: { rows: number; watchlist: number; comps: number; protocols: number };
  };
  ledger: Ledger;
  rows: BoardRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------- snapshot

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

// ---------------------------------------------------------------- eligibility

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records a token at all (a CoinGecko id or a symbol). */
export function hasToken(p: SnapshotProtocol): boolean {
  return p.gecko_id !== null || p.symbol !== null;
}

/** Whether a protocol's name ends in a version marker. */
export function isVersioned(p: SnapshotProtocol): boolean {
  return VERSIONED.test(p.name);
}

/** Whether a protocol's name marks it a wrapped, staked or bridged product. */
export function isWrappedProduct(p: SnapshotProtocol): boolean {
  const words = p.name.toLowerCase().match(/[a-z]+/g) ?? [];
  return words.some((w) => w === 'wrapped' || w === 'staked' || w === 'bridged' || w === 'staking');
}

const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether a protocol's name begins with an exchange's name. */
export function hasExchangePrefix(p: SnapshotProtocol): boolean {
  return EXCHANGE_PREFIXES.some((e) => p.name.startsWith(e));
}

/**
 * Categories the board never ranks: bridges and exchanges are products of
 * tokens that already trade, and liquid-staking / restaked products are the
 * same. (Staking Pool and Cross Chain Bridge are not in this set: a staking
 * pool with no staking word in its name, and a pre-token bridge, can rank.)
 */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Whether a protocol is one the board may rank: pre-token and none of the exclusions. */
export function isRankable(p: SnapshotProtocol): boolean {
  return !hasToken(p) && !EXCLUDED_CATEGORIES.has(p.category ?? '') && !isVersioned(p) && !isWrappedProduct(p) && !hasExchangePrefix(p);
}

/**
 * The ledger: every protocol in the snapshot, counted once, in this
 * priority — (1) has a token, (2) is ranked, (3) the exclusion that keeps
 * it off the board. Category exclusions are counted before name-based ones,
 * so a staking pool kept off by its name counts under liquid staking.
 */
export function computeLedger(snapshot: Snapshot): { ledger: Ledger; ranked: SnapshotProtocol[] } {
  const ledger: Ledger = {
    token_trades: 0,
    token_recorded_no_cap: 0,
    ranked_watchlist: 0,
    ranked_above_floor: 0,
    ranked_below_floor: 0,
    out_bridge: 0,
    out_liquid_staking: 0,
    out_exchange: 0,
    out_versioned: 0,
    out_wrapped: 0,
    total: snapshot.protocols.length,
  };
  const watchlist = new Set(snapshot.watchlist);
  const ranked: SnapshotProtocol[] = [];
  for (const p of snapshot.protocols) {
    if (hasToken(p) && (p.mcap_usd ?? 0) > 0) ledger.token_trades++;
    else if (hasToken(p)) ledger.token_recorded_no_cap++;
    else if (isRankable(p)) {
      ranked.push(p);
      if (watchlist.has(p.slug)) ledger.ranked_watchlist++;
      else if (p.tvl_usd >= snapshot.floor_usd) ledger.ranked_above_floor++;
      else ledger.ranked_below_floor++;
    } else if (p.category === 'Bridge' || p.category === 'Canonical Bridge') ledger.out_bridge++;
    else if (p.category === 'Liquid Staking' || p.category === 'Liquid Restaking' || p.category === 'Staking Pool' || p.category === 'Restaked BTC') ledger.out_liquid_staking++;
    else if (p.category === 'CEX') ledger.out_exchange++;
    else if (isVersioned(p)) ledger.out_versioned++;
    else if (isWrappedProduct(p)) ledger.out_wrapped++;
    else throw new SnapshotError(`ledger: no group for ${p.slug}`);
  }
  return { ledger, ranked };
}

// ---------------------------------------------------------------- the model

/** Pooling: small categories fold into their family's group (26 groups over the comps). */
const POOLED: Record<string, string> = {
  Bridge: 'Bridge',
  'Canonical Bridge': 'Bridge',
  'Cross Chain Bridge': 'Bridge',
  'Liquid Staking': 'Staking',
  'Staking Pool': 'Staking',
  'Liquid Restaking': 'Staking',
  Restaking: 'Staking',
  Yield: 'Yield',
  'Yield Aggregator': 'Yield',
  'Leveraged Farming': 'Yield',
  Lending: 'Lending',
  'Uncollateralized Lending': 'Lending',
  CDP: 'Lending',
  Dexs: 'Dexs',
};

/** A protocol's pooled group; any other category is its own group. */
export function groupOf(p: SnapshotProtocol): string {
  return POOLED[p.category ?? ''] ?? (p.category ?? 'Unknown');
}

/** The median of a list of numbers. */
function median(values: number[]): number {
  const a = [...values].sort((x, y) => x - y);
  const m = a.length;
  return m % 2 === 1 ? a[m >> 1]! : (a[(m >> 1) - 1]! + a[m >> 1]!) / 2;
}

/** The eight chain flags the ridge regression carries. */
const CHAIN_FLAGS = ['Ethereum', 'Solana', 'Base', 'Arbitrum', 'Optimism', 'Binance', 'Polygon', 'Avalanche'];

/** Seven-day growth as a fraction, clipped to -0.95 .. 5; unreported growth reads as 0. */
function growthOf(p: SnapshotProtocol): number {
  if (p.change_7d === null) return 0;
  return Math.min(5, Math.max(-0.95, p.change_7d / 100));
}

/** Solve a small dense linear system by Gaussian elimination with partial pivoting. */
function solveLinear(matrix: number[][], rhs: number[]): number[] {
  const m = rhs.length;
  const aug = matrix.map((row, i) => [...row, rhs[i]!]);
  for (let col = 0; col < m; col++) {
    let pivot = col;
    for (let r = col + 1; r < m; r++) if (Math.abs(aug[r]![col]!) > Math.abs(aug[pivot]![col]!)) pivot = r;
    if (pivot !== col) {
      const tmp = aug[col]!;
      aug[col] = aug[pivot]!;
      aug[pivot] = tmp;
    }
    const pv = aug[col]![col]!;
    for (let r = col + 1; r < m; r++) {
      const f = aug[r]![col]! / pv;
      if (f !== 0) for (let c = col; c <= m; c++) aug[r]![c]! -= f * aug[col]![c]!;
    }
  }
  const x = new Array<number>(m).fill(0);
  for (let r = m - 1; r >= 0; r--) {
    let acc = aug[r]![m]!;
    for (let c = r + 1; c < m; c++) acc -= aug[r]![c]! * x[c]!;
    x[r] = acc / aug[r]![r]!;
  }
  return x;
}

export interface FittedModel {
  intercept: number;
  slope: number;
  globalMedianResidual: number;
  offsets: Map<string, number>;
  groups: string[];
  ridgeBeta: number[];
  ridgeMeans: number[];
  ridgeSds: number[];
  medianLogAge: number;
}

/**
 * Why the model is built this way — the three choices that are not obvious
 * from the code below.
 *
 * 1. Two estimators, blended 0.7 / 0.3. The grouped curve (A) is the
 *    primary estimate: it sees only ln(TVL) plus one offset per group, so
 *    with 128 comps it is stable — one more comp barely moves it. The
 *    ridge regression (B) sees much more (chain flags, age, 7-day growth,
 *    group one-hots): about 39 coefficients fitted on those same 128
 *    comps. It can correct the curve — a young, fast-growing protocol on
 *    a cheap chain is worth more than TVL alone says — but with that many
 *    coefficients it also fits the comps' noise, so it only gets 0.3 of
 *    the vote. The split is a bias-variance trade, not a round number:
 *    the curve underfits (it ignores chain and age), the ridge overfits
 *    (39 coefficients, 128 points), and the blend's validation errors —
 *    5-fold CV 1.30, walk-forward 1.05, blind-30 1.21 median absolute log
 *    error — sit at the noise floor of about 1.25, so there is little
 *    headroom left for either side on its own.
 *
 * 2. The ridge is a median regression, not least squares, and that is
 *    why it is fitted by IRLS. A median (LAD) fit has no closed form, so
 *    each round reweights every comp by 1/|residual|: a comp whose market
 *    cap sits far from the fit — a fresh launch, a distressed token —
 *    counts for little, instead of dragging the line the way OLS lets a
 *    single outlier do. The weight floor of 1e-3 is the guard rail: a
 *    comp fitted almost exactly would otherwise get a near-infinite
 *    weight and destabilise the next solve. Forty rounds is a fixed
 *    budget rather than a convergence test, so the fit is deterministic:
 *    the same snapshot always yields the same bytes.
 *
 * 3. The ridge penalty (10, added to every coefficient except the
 *    intercept) is what makes 39 coefficients on 128 comps safe at all:
 *    it shrinks the group and chain coefficients toward zero, so a group
 *    with two comps cannot buy itself a large offset. The intercept is
 *    left unpenalised on purpose — penalising it would pull every
 *    prediction toward zero in log space, i.e. toward a $1 market cap.
 */

/** Fit the blended model on the snapshot's comps (mcap_usd > 0). */
export function fitModel(snapshot: Snapshot): FittedModel {
  const comps = snapshot.protocols.filter((p) => (p.mcap_usd ?? 0) > 0);
  const n = comps.length;
  const logTvl = comps.map((p) => Math.log(p.tvl_usd));
  const logMcap = comps.map((p) => Math.log(p.mcap_usd!));

  // A. The global log-log curve, by ordinary least squares (two-pass, centred).
  const meanLogTvl = logTvl.reduce((a, b) => a + b, 0) / n;
  const meanLogMcap = logMcap.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = logTvl[i]! - meanLogTvl;
    sxx += dx * dx;
    sxy += dx * (logMcap[i]! - meanLogMcap);
  }
  const slope = sxy / sxx;
  const intercept = meanLogMcap - slope * meanLogTvl;

  // Group offsets: shrunk medians of the curve residuals (shrink k = 5).
  const residuals = logMcap.map((y, i) => y - (intercept + slope * logTvl[i]!));
  const globalMedianResidual = median(residuals);
  const byGroup = new Map<string, number[]>();
  comps.forEach((p, i) => {
    const g = groupOf(p);
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g)!.push(residuals[i]!);
  });
  const offsets = new Map<string, number>();
  for (const [g, rs] of byGroup) {
    const w = rs.length / (rs.length + 5);
    offsets.set(g, w * median(rs) + (1 - w) * globalMedianResidual);
  }
  const groups = [...byGroup.keys()].sort();

  // B. The ridge median regression: IRLS (40 rounds, weights 1/max(|r|, 1e-3),
  // ridge penalty 10, intercept unpenalised), started from the unweighted
  // ridge least-squares solution. Design row: intercept; ln(TVL); one-hot
  // pooled group; growth; log age; ln(chain count); eight chain flags.
  // The four continuous features are standardised with the training mean
  // and (population) standard deviation; one-hots and flags stay 0/1.
  const medianLogAge = median(comps.map((p) => (ageDays(snapshot.as_of, p.listed_at) === null ? null : Math.log(ageDays(snapshot.as_of, p.listed_at)! + 1))).filter((v): v is number => v !== null));
  const designRow = (p: SnapshotProtocol): number[] => {
    const g = groupOf(p);
    const row: number[] = [1, Math.log(p.tvl_usd)];
    for (const gg of groups) row.push(g === gg ? 1 : 0);
    const age = ageDays(snapshot.as_of, p.listed_at);
    row.push(growthOf(p), age === null ? medianLogAge : Math.log(age + 1), Math.log(p.chains.length));
    for (const c of CHAIN_FLAGS) row.push(p.chains.includes(c) ? 1 : 0);
    return row;
  };
  const raw = comps.map(designRow);
  const dim = raw[0]!.length;
  const continuous = [1, 1 + groups.length + 1, 1 + groups.length + 2, 1 + groups.length + 3];
  const x = raw.map((r) => [...r]);
  const means = new Array<number>(dim).fill(0);
  const sds = new Array<number>(dim).fill(1);
  for (const j of continuous) {
    let m = 0;
    for (let i = 0; i < n; i++) m += x[i]![j]!;
    m /= n;
    let v = 0;
    for (let i = 0; i < n; i++) {
      const d = x[i]![j]! - m;
      v += d * d;
    }
    const sd = Math.sqrt(v / n);
    means[j] = m;
    sds[j] = sd;
    for (let i = 0; i < n; i++) x[i]![j] = (x[i]![j]! - m) / sd;
  }
  const ridgeSolve = (weights: number[]): number[] => {
    const a = Array.from({ length: dim }, () => new Array<number>(dim).fill(0));
    const b = new Array<number>(dim).fill(0);
    for (let i = 0; i < n; i++) {
      const wi = weights[i]!;
      for (let j = 0; j < dim; j++) {
        b[j]! += wi * x[i]![j]! * logMcap[i]!;
        for (let k = 0; k < dim; k++) a[j]![k]! += wi * x[i]![j]! * x[i]![k]!;
      }
    }
    for (let j = 1; j < dim; j++) a[j]![j]! += 10;
    return solveLinear(a, b);
  };
  let beta = ridgeSolve(new Array<number>(n).fill(1));
  for (let round = 0; round < 40; round++) {
    const w = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      let pred = 0;
      for (let j = 0; j < dim; j++) pred += x[i]![j]! * beta[j]!;
      w[i] = 1 / Math.max(Math.abs(logMcap[i]! - pred), 0.001);
    }
    beta = ridgeSolve(w);
  }

  return { intercept, slope, globalMedianResidual, offsets, groups, ridgeBeta: beta, ridgeMeans: means, ridgeSds: sds, medianLogAge };
}

export interface ScoredProtocol {
  protocol: SnapshotProtocol;
  implied: number;
  curveLog: number;
  groupedLog: number;
  ridgeLog: number;
  group: string;
  offset: number;
}

/** Score one protocol: 0.7 grouped curve + 0.3 ridge median, exponentiated. */
export function scoreProtocol(snapshot: Snapshot, model: FittedModel, p: SnapshotProtocol): ScoredProtocol {
  const group = groupOf(p);
  const offset = model.offsets.get(group) ?? model.globalMedianResidual;
  const curveLog = model.intercept + model.slope * Math.log(p.tvl_usd);
  const groupedLog = curveLog + offset;
  const raw: number[] = [1, Math.log(p.tvl_usd)];
  for (const gg of model.groups) raw.push(group === gg ? 1 : 0);
  const age = ageDays(snapshot.as_of, p.listed_at);
  raw.push(growthOf(p), age === null ? model.medianLogAge : Math.log(age + 1), Math.log(p.chains.length));
  for (const c of CHAIN_FLAGS) raw.push(p.chains.includes(c) ? 1 : 0);
  let ridgeLog = 0;
  for (let j = 0; j < raw.length; j++) ridgeLog += ((raw[j]! - model.ridgeMeans[j]!) / model.ridgeSds[j]!) * model.ridgeBeta[j]!;
  const implied = Math.round(Math.exp(0.7 * groupedLog + 0.3 * ridgeLog));
  return { protocol: p, implied, curveLog, groupedLog, ridgeLog, group, offset };
}

// ---------------------------------------------------------------- farm plans

/** Gas cost of one transaction on a chain, in dollars, as the plan states it. */
const GAS: Record<string, string> = {
  Ethereum: '$8',
  Solana: '$0.01',
  Base: '$0.50',
  Arbitrum: '$0.50',
  Optimism: '$0.50',
  Binance: '$0.30',
  Polygon: '$0.10',
  Avalanche: '$0.30',
};

function gasFor(chain: string): string {
  return GAS[chain] ?? '$2';
}

type Plan = (name: string, chain: string, gas: string) => string[];

const PLANS: Record<string, Plan> = {
  generic: (nm, ch, g) => [
    `Bridge $500 of USDC to ${ch} for about ${g} gas (10 minutes), then open ${nm}.`,
    `Deposit $500 into the main ${nm} position on ${ch}, about ${g} gas (5 minutes).`,
    `Hold the position for 4 weeks and check it weekly for rate or risk changes.`,
    `Add a second $250 deposit after 2 weeks if the position performs, about ${g} gas.`,
    `Claim any rewards weekly for 4 weeks, about ${g} per claim on ${ch}.`,
    `Exit or rebalance after 8 weeks for about ${g} gas and record the outcome.`,
  ],
  curator: (nm, ch, g) => [
    `Bridge $500 of USDC to ${ch} for about ${g} gas (10 minutes), then open ${nm}.`,
    `Deposit $500 into a curated vault on ${nm} on ${ch}, about ${g} gas (5 minutes).`,
    `Read the curator's allocation and risk limits before depositing more on ${ch}.`,
    `Hold the vault position for 8 weeks and check the curator's reports monthly.`,
    `Add $250 more after 4 weeks if the vault's risk stays within its stated limits.`,
    `Withdraw after 8 weeks for about ${g} gas and compare the return with the vault's target.`,
  ],
  prediction: (nm, ch, g) => [
    `Bridge $100 of USDC to ${ch} for about ${g} gas (10 minutes), then open ${nm}.`,
    `Place a $50 position on a high-volume market on ${nm} on ${ch}, about ${g} gas.`,
    `Provide $50 of liquidity to a market on ${nm} on ${ch} for about ${g} gas.`,
    `Hold both positions until the market resolves, usually 1 to 4 weeks.`,
    `Claim any winnings after resolution for about ${g} gas on ${ch} (5 minutes).`,
    `Repeat with a new market each month and keep a record of wins and losses.`,
  ],
  allocator: (nm, ch, g) => [
    `Bridge $500 of USDC to ${ch} for about ${g} gas (10 minutes), then open ${nm}.`,
    `Allocate $500 through ${nm} on ${ch} for about ${g} gas (5 minutes).`,
    `Hold the allocation for 8 weeks and read the allocator's monthly reports.`,
    `Claim any distributions weekly for 8 weeks, about ${g} per claim on ${ch}.`,
    `Rebalance after 4 weeks if the allocation drifts from its stated strategy.`,
    `Exit the allocation after 8 weeks for about ${g} gas on ${ch} (10 minutes).`,
  ],
  rwa: (nm, ch, g) => [
    `Complete the onboarding for ${nm} and bridge $500 of USDC to ${ch}, about ${g} gas.`,
    `Buy $500 of the tokenised asset on ${nm} on ${ch} for about ${g} gas (10 minutes).`,
    `Hold the asset for 4 weeks and collect the yield it pays, about ${g} per claim.`,
    `Add a second $250 purchase after 2 weeks if the asset performs, about ${g} gas.`,
    `Check the underlying asset and issuer reports monthly while holding.`,
    `Sell or redeem after 8 weeks for about ${g} gas on ${ch} (10 minutes).`,
  ],
  lend: (nm, ch, g) => [
    `Bridge $1,000 of USDC to ${ch} for about ${g} gas (10 minutes), then open ${nm}.`,
    `Supply $1,000 of USDC as collateral on ${nm} on ${ch}, about ${g} gas (5 minutes).`,
    `Borrow $400 of a stable asset against the collateral on ${nm} on ${ch}, about ${g} gas.`,
    `Hold the borrow for 4 weeks, keep the health factor above 2, and top up collateral if it slips.`,
    `Repay the $400 borrow on ${nm} on ${ch} after 4 weeks for about ${g} gas (5 minutes).`,
    `Withdraw the $1,000 collateral after repaying, and check the position weekly while it is open.`,
  ],
  dex: (nm, ch, g) => [
    `Bridge $500 of USDC to ${ch} for about ${g} in gas (10 minutes), then open ${nm}.`,
    `Swap $250 of USDC for the other token of the main pool on ${nm} on ${ch}, about ${g} gas (5 minutes).`,
    `Add $500 of liquidity to the main ${nm} pool on ${ch} for about ${g} gas (10 minutes).`,
    `Hold the LP position for 4 weeks and collect trading fees, about ${g} per claim on ${ch}.`,
    `Swap another $100 through ${nm} each week for 4 weeks to build swap volume on ${ch}.`,
    `Review the LP position weekly and withdraw or re-add liquidity if the pool's TVL moves sharply.`,
  ],
  perps: (nm, ch, g) => [
    `Bridge $500 of USDC to ${ch} for about ${g} gas (10 minutes), then open ${nm}.`,
    `Deposit $500 as margin on ${nm} on ${ch}, about ${g} gas (5 minutes).`,
    `Open a small 2x long position on ${nm} on ${ch} for about ${g} gas.`,
    `Set a stop loss and hold the position for 1 to 2 weeks on ${ch}.`,
    `Close the position and take profit or cut the loss, about ${g} gas on ${ch}.`,
    `Withdraw the margin after closing and review the trade before opening another.`,
  ],
  vault: (nm, ch, g) => [
    `Bridge $1,000 of USDC to ${ch} for about ${g} gas (10 minutes), then open the ${nm} vault.`,
    `Deposit $1,000 into the main ${nm} vault on ${ch}, about ${g} gas (5 minutes).`,
    `Stake the vault receipt token if ${nm} offers staking, about ${g} gas on ${ch}.`,
    `Compound the yield weekly for 8 weeks, about ${g} per claim on ${ch}.`,
    `Hold the position for at least 8 weeks to cover deposit and exit fees on ${ch}.`,
    `Withdraw the deposit and rewards after 8 weeks for about ${g} gas (10 minutes).`,
  ],
  stake: (nm, ch, g) => [
    `Buy $1,000 of the base asset on ${ch} for about ${g} gas (10 minutes).`,
    `Stake $1,000 with ${nm} on ${ch} for about ${g} gas (5 minutes).`,
    `Hold the liquid receipt token for 4 weeks and use it in a lending market on ${ch}.`,
    `Restake the staking rewards weekly for 8 weeks, about ${g} per claim on ${ch}.`,
    `Check the validator or operator set monthly and move stake if performance drops.`,
    `Unstake after 8 weeks, allowing for the queue period, for about ${g} gas on ${ch}.`,
  ],
};

/** The plan family a category uses; anything unlisted uses the generic plan. */
const PLAN_FAMILY: Record<string, string> = {
  'Risk Curators': 'curator',
  'Prediction Market': 'prediction',
  'Onchain Capital Allocator': 'allocator',
  RWA: 'rwa',
  CDP: 'lend',
  Lending: 'lend',
  'Uncollateralized Lending': 'lend',
  Dexs: 'dex',
  'Basis Trading': 'perps',
  Derivatives: 'perps',
  'Interest Rate Derivatives': 'perps',
  Yield: 'vault',
  'Yield Aggregator': 'vault',
  'Leveraged Farming': 'vault',
  Restaking: 'stake',
  'Staking Pool': 'stake',
};

/** A protocol's farm plan: six steps, each an action with a cost and a time. */
export function farmSteps(p: SnapshotProtocol): string[] {
  const chain = p.chains[0] ?? 'its main chain';
  const gas = gasFor(chain);
  if (p.category === 'Cross Chain Bridge') {
    const dest = p.chains[1] ?? 'Arc';
    const destGas = gasFor(dest);
    return [
      `Bridge $500 of USDC from ${chain} to ${dest} on ${p.name} for about ${gas} gas (15 minutes).`,
      `Bridge $250 back from ${dest} to ${chain} to complete a round trip, about ${destGas} gas.`,
      `Use the bridged asset in a ${dest} app for 2 weeks to leave a usage trail.`,
      `Bridge a second $500 from ${chain} to another supported chain after 2 weeks.`,
      `Repeat one bridge a month for 3 months, about ${gas} gas each time on ${chain}.`,
      `Keep the receipt of each bridge and check finality times before bridging larger amounts.`,
    ];
  }
  const plan = PLANS[PLAN_FAMILY[p.category ?? ''] ?? 'generic']!;
  return plan(p.name, chain, gas);
}

// ---------------------------------------------------------------- the board

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: FittedModel, ranked: SnapshotProtocol[]): BoardRow[] {
  const watchlist = new Set(snapshot.watchlist);
  const scored = ranked.map((p) => scoreProtocol(snapshot, model, p));
  scored.sort((a, b) => b.implied - a.implied || (a.protocol.slug < b.protocol.slug ? -1 : a.protocol.slug > b.protocol.slug ? 1 : 0));
  return scored.map((s, i) => {
    const p = s.protocol;
    return {
      slug: p.slug,
      name: p.name,
      rank: i + 1,
      implied_value_usd: s.implied,
      farm_steps: farmSteps(p),
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      age_days: ageDays(snapshot.as_of, p.listed_at),
      ratio: s.implied / p.tvl_usd,
      curve_usd: Math.round(Math.exp(s.curveLog)),
      grouped_usd: Math.round(Math.exp(s.groupedLog)),
      ridge_usd: Math.round(Math.exp(s.ridgeLog)),
      group: s.group,
      group_offset_log: s.offset,
      ridge_delta_log: s.ridgeLog - s.groupedLog,
      watchlist: watchlist.has(p.slug),
    };
  });
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => (p.mcap_usd ?? 0) > 0)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      change_7d: p.change_7d,
    }));
}

/** Everything the dashboard needs: the board, the live set, the ledger and the model it runs. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const model = fitModel(snapshot);
  const { ledger, ranked } = computeLedger(snapshot);
  const board = buildBoard(snapshot, model, ranked);
  const radar: RadarData = {
    meta: {
      as_of: snapshot.as_of,
      model: 'grouped comps curve 0.7 + ridge median 0.3, fit at runtime',
      curve: { intercept: model.intercept, slope: model.slope, global_median_residual: model.globalMedianResidual },
      validation: { cv_5fold: 1.3, walk_forward: 1.05, blind_30: 1.21, note: 'median absolute log error of ln(market cap); noise floor about 1.25' },
      counts: { rows: board.length, watchlist: snapshot.watchlist.length, comps: snapshot.protocols.filter((p) => (p.mcap_usd ?? 0) > 0).length, protocols: snapshot.protocols.length },
    },
    ledger,
    rows: board,
    live: liveRows(snapshot),
  };
  return { board, radar };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR_DATA=${JSON.stringify(radar)};\n`;
}
