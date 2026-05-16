import { CoverTypeT, MemUCIS, ScopeTypeT, SourceInfo } from '@covsight/core';
import {
  DEFAULT_FILTER_OPTIONS,
  computeAggregateStats,
  computeScopeStats,
  computeStatsByType,
  getUncoveredHotspots,
  scopePassesFilter,
} from '../CoverageStats';
import {
  buildCrossDb,
  buildDbWithSpecialBins,
  buildFsmDb,
  buildFullCoverageDb,
  buildInstanceHierarchy,
  buildSimpleCovergroup,
  buildToggleData,
  buildZeroCoverageDb,
} from './fixtures/builders';

type BinCapableScope = {
  createBin(name: string, binType: number, count: bigint, atLeast: bigint): unknown;
};

function getTopScope(db: MemUCIS) {
  return Array.from(db.scopes(ScopeTypeT.ALL))[0]!;
}

function getCoverpoint(db: MemUCIS) {
  const top = getTopScope(db);
  const cg = Array.from(top.scopes(ScopeTypeT.ALL))[0]!;
  return Array.from(cg.scopes(ScopeTypeT.ALL))[0]!;
}

describe('CoverageStats', () => {
  describe('computeScopeStats', () => {
    it('handles covered, uncovered, mixed, atLeast=0, count=0, and coverageGoal', () => {
      expect(computeScopeStats(getCoverpoint(buildSimpleCovergroup({ bins: [{ name: 'a', count: 1n, atLeast: 1n }] })), DEFAULT_FILTER_OPTIONS)).toMatchObject({ covered: 1, total: 1, percentage: 100, isMet: true });
      expect(computeScopeStats(getCoverpoint(buildSimpleCovergroup({ bins: [{ name: 'a', count: 0n, atLeast: 1n }] })), DEFAULT_FILTER_OPTIONS)).toMatchObject({ covered: 0, total: 1, percentage: 0, isMet: false });
      expect(computeScopeStats(getCoverpoint(buildSimpleCovergroup({ bins: [
        { name: 'a', count: 1n, atLeast: 1n },
        { name: 'b', count: 2n, atLeast: 1n },
        { name: 'c', count: 3n, atLeast: 1n },
        { name: 'd', count: 0n, atLeast: 1n },
      ] })), DEFAULT_FILTER_OPTIONS)).toMatchObject({ covered: 3, total: 4, percentage: 75, isMet: false });
      expect(computeScopeStats(getCoverpoint(buildSimpleCovergroup({ bins: [{ name: 'a', count: 0n, atLeast: 0n }] })), DEFAULT_FILTER_OPTIONS)).toMatchObject({ covered: 1, total: 1, percentage: 100, isMet: true });
      expect(computeScopeStats(getCoverpoint(buildSimpleCovergroup({ bins: [{ name: 'a', count: 0n, atLeast: 1n }] })), { ...DEFAULT_FILTER_OPTIONS, coverageGoal: 0 })).toMatchObject({ covered: 0, total: 1, percentage: 0, isMet: true });
      expect(computeScopeStats(getCoverpoint(buildSimpleCovergroup({ bins: [
        { name: 'a', count: 1n, atLeast: 1n },
        { name: 'b', count: 0n, atLeast: 1n },
      ] })), { ...DEFAULT_FILTER_OPTIONS, coverageGoal: 75 })).toMatchObject({ covered: 1, total: 2, percentage: 50, isMet: false });
    });

    it('filters IGNOREBIN and ILLEGALBIN according to the options', () => {
      const cp = getCoverpoint(buildDbWithSpecialBins());
      expect(computeScopeStats(cp, DEFAULT_FILTER_OPTIONS)).toMatchObject({ covered: 0, total: 0, percentage: 100 });
      expect(computeScopeStats(cp, { ...DEFAULT_FILTER_OPTIONS, excludeIgnoredBins: false })).toMatchObject({ covered: 0, total: 1, percentage: 0 });
      expect(computeScopeStats(cp, { ...DEFAULT_FILTER_OPTIONS, excludeIllegalBins: false })).toMatchObject({ covered: 0, total: 1, percentage: 0 });
      expect(computeScopeStats(cp, { ...DEFAULT_FILTER_OPTIONS, excludeIgnoredBins: false, excludeIllegalBins: false })).toMatchObject({ covered: 0, total: 2, percentage: 0 });
    });
  });

  describe('computeAggregateStats', () => {
    it('matches direct scope stats for leaf scopes', () => {
      const cp = getCoverpoint(buildSimpleCovergroup());
      expect(computeAggregateStats(cp, DEFAULT_FILTER_OPTIONS)).toEqual(computeScopeStats(cp, DEFAULT_FILTER_OPTIONS));
    });

    it('aggregates child scopes including deep hierarchies, empty databases, ignored bins, crosses, and FSM bins', () => {
      expect(computeAggregateStats(getTopScope(buildSimpleCovergroup()), DEFAULT_FILTER_OPTIONS)).toMatchObject({ covered: 1, total: 2, percentage: 50 });
      expect(computeAggregateStats(Array.from(buildInstanceHierarchy(6).scopes(ScopeTypeT.ALL))[1]!, DEFAULT_FILTER_OPTIONS)).toMatchObject({ covered: 3, total: 6, percentage: 50 });
      expect(computeAggregateStats(new MemUCIS(), DEFAULT_FILTER_OPTIONS)).toMatchObject({ covered: 0, total: 0, percentage: 100 });
      expect(computeAggregateStats(buildDbWithSpecialBins(), DEFAULT_FILTER_OPTIONS)).toMatchObject({ covered: 0, total: 0, percentage: 100 });
      expect(computeAggregateStats(getTopScope(buildCrossDb()), DEFAULT_FILTER_OPTIONS)).toMatchObject({ covered: 0, total: 1, percentage: 0 });
      expect(computeAggregateStats(getTopScope(buildFsmDb()), DEFAULT_FILTER_OPTIONS)).toMatchObject({ covered: 1, total: 1, percentage: 100 });
    });
  });

  describe('computeStatsByType', () => {
    it('groups direct stats by scope type, returns an empty map for an empty database, and keeps toggles separate from branches', () => {
      const simpleMap = computeStatsByType(buildSimpleCovergroup(), DEFAULT_FILTER_OPTIONS);
      expect(simpleMap.get(ScopeTypeT.COVERPOINT)).toMatchObject({ covered: 1, total: 2, percentage: 50 });

      const fsmMap = computeStatsByType(buildFsmDb(), DEFAULT_FILTER_OPTIONS);
      expect(fsmMap.has(ScopeTypeT.FSM)).toBe(true);
      expect(fsmMap.has(ScopeTypeT.DU_MODULE)).toBe(true);

      expect(computeStatsByType(new MemUCIS(), DEFAULT_FILTER_OPTIONS).size).toBe(0);

      const toggleDb = buildToggleData();
      const top = Array.from(toggleDb.scopes(ScopeTypeT.ALL))[0]!;
      const fh = toggleDb.getFileHandle('/rtl/top.sv');
      const branch = top.createBranch('branch_cov', fh, new SourceInfo(fh.fileId, 99)) as typeof top & BinCapableScope;
      branch.createBin('taken', CoverTypeT.BRANCHBIN, 1n, 1n);
      const mixedMap = computeStatsByType(toggleDb, DEFAULT_FILTER_OPTIONS);
      expect(mixedMap.get(ScopeTypeT.TOGGLE)?.total).toBe(4);
      expect(mixedMap.get(ScopeTypeT.BRANCH)?.total).toBe(1);
    });
  });

  describe('getUncoveredHotspots', () => {
    it('returns uncovered bins only, sorted by hit count ascending, limited, and with the correct scope path', () => {
      const db = buildSimpleCovergroup({
        bins: [
          { name: 'hot', count: 2n, atLeast: 3n },
          { name: 'cold', count: 0n, atLeast: 1n },
          { name: 'warm', count: 1n, atLeast: 2n },
          { name: 'auto', count: 0n, atLeast: 0n },
        ],
      });

      const hotspots = getUncoveredHotspots(db, DEFAULT_FILTER_OPTIONS, 2);

      expect(hotspots).toHaveLength(2);
      expect(hotspots.map((item) => item.binName)).toEqual(['cold', 'warm']);
      expect(hotspots[0]?.scopePath).toBe('top.cg1.cp1');
    });

    it('returns an empty array for empty and fully covered databases', () => {
      expect(getUncoveredHotspots(new MemUCIS(), DEFAULT_FILTER_OPTIONS, 10)).toEqual([]);
      expect(getUncoveredHotspots(buildFullCoverageDb(), DEFAULT_FILTER_OPTIONS, 10)).toEqual([]);
    });
  });

  describe('scopePassesFilter', () => {
    it('supports all/covered/uncovered filters, including empty scopes', () => {
      const covered = getTopScope(buildFullCoverageDb());
      const uncovered = getTopScope(buildZeroCoverageDb());
      const emptyDb = new MemUCIS();
      const emptyScope = emptyDb.createScope('empty');

      expect(scopePassesFilter(covered, 'all', DEFAULT_FILTER_OPTIONS)).toBe(true);
      expect(scopePassesFilter(uncovered, 'all', DEFAULT_FILTER_OPTIONS)).toBe(true);
      expect(scopePassesFilter(covered, 'covered', DEFAULT_FILTER_OPTIONS)).toBe(true);
      expect(scopePassesFilter(uncovered, 'covered', DEFAULT_FILTER_OPTIONS)).toBe(false);
      expect(scopePassesFilter(covered, 'uncovered', DEFAULT_FILTER_OPTIONS)).toBe(false);
      expect(scopePassesFilter(uncovered, 'uncovered', DEFAULT_FILTER_OPTIONS)).toBe(true);
      expect(scopePassesFilter(emptyScope, 'covered', DEFAULT_FILTER_OPTIONS)).toBe(true);
    });
  });
});
