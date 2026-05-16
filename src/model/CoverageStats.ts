import { CoverTypeT, type MemUCIS, Scope, ScopeTypeT, dfsScopes } from '@covsight/core';

/**
 * User-configurable switches that affect aggregate coverage calculations.
 */
export interface FilterOptions {
  excludeIgnoredBins: boolean;
  excludeIllegalBins: boolean;
  coverageGoal: number;
}

/**
 * Default coverage filtering and pass/fail settings used throughout the model layer.
 */
export const DEFAULT_FILTER_OPTIONS: FilterOptions = {
  excludeIgnoredBins: true,
  excludeIllegalBins: true,
  coverageGoal: 100,
};

/**
 * Aggregate coverage counts and derived pass/fail state for a scope or group of scopes.
 */
export interface ScopeStats {
  covered: number;
  total: number;
  percentage: number;
  isMet: boolean;
}

/**
 * Tree filter modes exposed by the coverage hierarchy commands.
 */
export type CoverageFilter = 'all' | 'covered' | 'uncovered';

/**
 * A single uncovered coverage item suitable for hotspot reporting.
 */
export interface UncoveredBin {
  scopePath: string;
  binName: string;
  hitCount: bigint;
  atLeast: bigint;
  coverType: number;
}

/**
 * Computes coverage for items directly owned by one scope.
 *
 * IGNOREBIN and ILLEGALBIN items are skipped when the corresponding filter flag
 * is enabled. Bins with {@code atLeast === 0} are treated as already covered,
 * which matches UCIS semantics for always-satisfied goals.
 *
 * @param scope Scope whose local cover items should be counted.
 * @param opts Filtering rules and coverage goal thresholds.
 */
export function computeScopeStats(scope: Scope, opts: FilterOptions): ScopeStats {
  return buildStats(accumulateScopeItems(scope, opts), opts);
}

/**
 * Computes coverage for a scope and all descendant scopes.
 *
 * Empty aggregates are reported as 100% so container scopes with no applicable
 * bins are considered satisfied instead of failing due to divide-by-zero.
 *
 * @param scope Root scope of the aggregate subtree.
 * @param opts Filtering rules and coverage goal thresholds.
 */
export function computeAggregateStats(scope: Scope, opts: FilterOptions): ScopeStats {
  const aggregate = accumulateAggregate(scope, opts);
  return buildStats(aggregate, opts);
}

/**
 * Groups direct scope statistics by UCIS scope type across an entire database.
 *
 * Each scope contributes only its own cover items; descendants are counted when
 * their own scope type is visited later in the traversal.
 *
 * @param ucis Open NCDB model to traverse.
 * @param opts Filtering rules and coverage goal thresholds.
 */
export function computeStatsByType(ucis: MemUCIS, opts: FilterOptions): Map<bigint, ScopeStats> {
  const totals = new Map<bigint, { covered: number; total: number }>();

  for (const scope of dfsScopes(ucis)) {
    const stats = computeScopeStats(scope, opts);
    const current = totals.get(scope.scopeType) ?? { covered: 0, total: 0 };
    current.covered += stats.covered;
    current.total += stats.total;
    totals.set(scope.scopeType, current);
  }

  return new Map(
    Array.from(totals.entries()).map(([scopeType, value]) => [scopeType, buildStats(value, opts)]),
  );
}

/**
 * Finds the lowest-hit uncovered bins in a database.
 *
 * Filtered bin types are omitted, bins with {@code atLeast === 0} are ignored,
 * and only bins below their goal are returned.
 *
 * @param ucis Open NCDB model to traverse.
 * @param opts Filtering rules and coverage goal thresholds.
 * @param limit Maximum number of hotspots to return after sorting.
 */
export function getUncoveredHotspots(ucis: MemUCIS, opts: FilterOptions, limit: number): UncoveredBin[] {
  const hotspots: UncoveredBin[] = [];

  for (const scope of dfsScopes(ucis)) {
    const scopePath = getScopePath(scope);
    for (const item of scope.coverItems()) {
      if (isFiltered(item.coverType, opts) || item.data.atLeast === 0n || item.data.count >= item.data.atLeast) {
        continue;
      }
      hotspots.push({
        scopePath,
        binName: item.name,
        hitCount: item.data.count,
        atLeast: item.data.atLeast,
        coverType: item.coverType,
      });
    }
  }

  hotspots.sort((lhs, rhs) => {
    if (lhs.hitCount !== rhs.hitCount) {
      return lhs.hitCount < rhs.hitCount ? -1 : 1;
    }
    const scopeCmp = lhs.scopePath.localeCompare(rhs.scopePath);
    return scopeCmp !== 0 ? scopeCmp : lhs.binName.localeCompare(rhs.binName);
  });

  return hotspots.slice(0, limit);
}

/**
 * Checks whether a scope should remain visible under the selected filter mode.
 *
 * Covered/uncovered decisions are based on aggregate subtree statistics so parent
 * nodes stay visible when any descendant keeps the subtree below goal.
 *
 * @param scope Scope to evaluate.
 * @param filter Requested hierarchy filter mode.
 * @param opts Filtering rules and coverage goal thresholds.
 */
export function scopePassesFilter(scope: Scope, filter: CoverageFilter, opts: FilterOptions): boolean {
  if (filter === 'all') {
    return true;
  }

  const stats = computeAggregateStats(scope, opts);
  return filter === 'covered' ? stats.isMet : !stats.isMet;
}

function getScopePath(scope: Scope): string {
  const parts: string[] = [];
  let current: Scope | null = scope;

  while (current !== null && current.parent !== null && (current.scopeType & ScopeTypeT.RESERVEDSCOPE) === 0n) {
    parts.unshift(current.logicalName);
    current = current.parent;
  }

  return parts.join('.');
}

function accumulateAggregate(scope: Scope, opts: FilterOptions): { covered: number; total: number } {
  const current = accumulateScopeItems(scope, opts);

  for (const child of scope.scopes(ScopeTypeT.ALL)) {
    const childStats = accumulateAggregate(child, opts);
    current.covered += childStats.covered;
    current.total += childStats.total;
  }

  return current;
}

function accumulateScopeItems(scope: Scope, opts: FilterOptions): { covered: number; total: number } {
  const result = { covered: 0, total: 0 };

  for (const item of scope.coverItems()) {
    if (isFiltered(item.coverType, opts)) {
      continue;
    }
    result.total += 1;
    if (item.data.atLeast === 0n || item.data.count >= item.data.atLeast) {
      result.covered += 1;
    }
  }

  return result;
}

function buildStats(value: { covered: number; total: number }, opts: FilterOptions): ScopeStats {
  const percentage = value.total === 0 ? 100 : Math.round((value.covered / value.total) * 100);
  return {
    covered: value.covered,
    total: value.total,
    percentage,
    isMet: percentage >= opts.coverageGoal,
  };
}

function isFiltered(coverType: number, opts: FilterOptions): boolean {
  if ((coverType & CoverTypeT.IGNOREBIN) !== 0 && opts.excludeIgnoredBins) {
    return true;
  }
  if ((coverType & CoverTypeT.ILLEGALBIN) !== 0 && opts.excludeIllegalBins) {
    return true;
  }
  return false;
}
