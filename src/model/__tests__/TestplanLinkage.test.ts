import { MemUCIS, ScopeTypeT } from '@covsight/core';
import { DEFAULT_FILTER_OPTIONS } from '../CoverageStats';
import {
  buildScopeIndex,
  computeTestpointCoverages,
  findUnboundScopes,
  resolveBindingPath,
} from '../TestplanLinkage';
import { parseTestplan } from '../TestplanModel';
import { buildFullCoverageDb, buildSimpleCovergroup } from './fixtures/builders';

describe('TestplanLinkage', () => {
  describe('buildScopeIndex', () => {
    it('includes top-level and nested scopes, excludes the root, and distinguishes duplicate names at different levels', () => {
      const db = buildSimpleCovergroup();
      const cp = Array.from(Array.from(Array.from(db.scopes(ScopeTypeT.ALL))[0]!.scopes(ScopeTypeT.ALL))[0]!.scopes(ScopeTypeT.ALL))[0]!;
      cp.createCovergroupDef('top');
      const index = buildScopeIndex(db);

      expect(index.has('top')).toBe(true);
      expect(index.has('top.cg1.cp1')).toBe(true);
      expect(index.has('')).toBe(false);
      expect(index.has('top.cg1.cp1.top')).toBe(true);
    });
  });

  describe('resolveBindingPath', () => {
    it('supports exact and glob matching with single-segment wildcards', () => {
      const db = buildSimpleCovergroup();
      const top = Array.from(db.scopes(ScopeTypeT.ALL))[0]!;
      top.createCovergroupDef('cg2').createCoverpoint('cp2');
      const index = buildScopeIndex(db);

      expect(resolveBindingPath('top.cg1.cp1', index).map((scope) => scope.logicalName)).toEqual(['cp1']);
      expect(resolveBindingPath('top.missing', index)).toEqual([]);
      expect(resolveBindingPath('top.*.cp1', index).map((scope) => scope.logicalName)).toEqual(['cp1']);
      expect(resolveBindingPath('top.*', index).map((scope) => scope.logicalName)).toEqual(['cg1', 'cg2']);
      expect(resolveBindingPath('top.*.cp2', index).map((scope) => scope.logicalName)).toEqual(['cp2']);
    });
  });

  describe('computeTestpointCoverages', () => {
    it('computes stats for resolved, unresolved, multiple, empty, and mixed bindings', () => {
      const plan = parseTestplan(`
      testpoints:
        - name: resolved
          status: complete
          coverage:
            - { type: coverpoint, path: top.cg1.cp1 }
        - name: unresolved
          status: planned
          coverage:
            - { type: coverpoint, path: top.missing }
        - name: empty
          status: planned
          coverage: []
      `, '/plans/link.testplan');
      if (!plan.ok) {
        throw new Error('Expected linkage plan to parse');
      }
      const coverages = computeTestpointCoverages(plan.plan, buildSimpleCovergroup(), DEFAULT_FILTER_OPTIONS);
      expect(coverages[0]?.bindings[0]?.matchedScopes).toHaveLength(1);
      expect(coverages[0]?.aggregateStats).toMatchObject({ covered: 1, total: 2, percentage: 50 });
      expect(coverages[1]?.aggregateStats).toMatchObject({ covered: 0, total: 0, percentage: 100 });
      expect(coverages[2]?.aggregateStats).toMatchObject({ covered: 0, total: 0, percentage: 100 });

      const fullDb = buildFullCoverageDb();
      const top = Array.from(fullDb.scopes(ScopeTypeT.ALL))[0]!;
      const cg2 = top.createCovergroupDef('cg2');
      cg2.createCoverpoint('cp2').createBin('miss', 1, 0n, 1n);
      const aggregatePlan = parseTestplan(`
      testpoints:
        - name: aggregate
          status: planned
          coverage:
            - { type: coverpoint, path: top.cg1.cp1 }
            - { type: coverpoint, path: top.cg2.cp2 }
      `, '/plans/aggregate.testplan');
      if (!aggregatePlan.ok) {
        throw new Error('Expected aggregate plan to parse');
      }
      const aggregateCoverage = computeTestpointCoverages(aggregatePlan.plan, fullDb, DEFAULT_FILTER_OPTIONS)[0]!;
      expect(aggregateCoverage.bindings).toHaveLength(2);
      expect(aggregateCoverage.aggregateStats.percentage).toBeLessThan(100);
    });
  });

  describe('findUnboundScopes', () => {
    it('returns only scopes that are not covered by exact or glob bindings and handles empty plans/databases', () => {
      const db = buildSimpleCovergroup();
      const top = Array.from(db.scopes(ScopeTypeT.ALL))[0]!;
      top.createCovergroupDef('cg2').createCoverpoint('cp2');

      const exactPlan = parseTestplan('testpoints: [{ name: tp, status: planned, coverage: [{ type: coverpoint, path: top.cg1.cp1 }] }]', '/plans/exact.testplan');
      if (!exactPlan.ok) {
        throw new Error('Expected exact plan to parse');
      }
      const unbound = findUnboundScopes(db, exactPlan.plan);
      expect(unbound.some((entry) => entry.scopePath === 'top.cg2.cp2')).toBe(true);
      expect(unbound.some((entry) => entry.scopePath === 'top.cg1.cp1')).toBe(false);

      const globPlan = parseTestplan('testpoints: [{ name: tp, status: planned, coverage: [{ type: coverpoint, path: top.*.* }] }]', '/plans/glob.testplan');
      if (!globPlan.ok) {
        throw new Error('Expected glob plan to parse');
      }
      const globUnbound = findUnboundScopes(db, globPlan.plan);
      expect(globUnbound.some((entry) => entry.scopePath === 'top.cg1.cp1')).toBe(false);
      expect(globUnbound.some((entry) => entry.scopePath === 'top.cg2.cp2')).toBe(false);

      const emptyPlan = parseTestplan('testpoints: []', '/plans/empty.testplan');
      if (!emptyPlan.ok) {
        throw new Error('Expected empty plan to parse');
      }
      expect(findUnboundScopes(db, emptyPlan.plan).length).toBe(buildScopeIndex(db).size);
      expect(findUnboundScopes(new MemUCIS(), emptyPlan.plan)).toEqual([]);
    });
  });
});
