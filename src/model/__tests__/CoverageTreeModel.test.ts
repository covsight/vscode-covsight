import { MemUCIS, ScopeTypeT } from '@covsight/core';
import { DEFAULT_FILTER_OPTIONS } from '../CoverageStats';
import { CoverageTreeModel } from '../CoverageTreeModel';
import { buildFullCoverageDb, buildInstanceHierarchy, buildSimpleCovergroup, buildZeroCoverageDb } from './fixtures/builders';

function getRoots(model: CoverageTreeModel, filter: 'all' | 'covered' | 'uncovered' = 'all') {
  return model.getRoots(filter);
}

describe('CoverageTreeModel', () => {
  describe('getRoots', () => {
    it('returns one node per top-level scope and carries aggregate stats', () => {
      const db = buildInstanceHierarchy(2);
      const roots = getRoots(new CoverageTreeModel(db, DEFAULT_FILTER_OPTIONS));
      expect(roots).toHaveLength(2);
      expect(roots[1]?.stats).toMatchObject({ covered: 1, total: 2, percentage: 50 });
    });

    it('applies covered and uncovered filters and handles an empty database', () => {
      const db = buildFullCoverageDb();
      const uncoveredTop = db.createScope('other');
      const cg = uncoveredTop.createCovergroupDef('cg2');
      const cp = cg.createCoverpoint('cp2');
      cp.createBin('miss', 1, 0n, 1n);
      const model = new CoverageTreeModel(db, DEFAULT_FILTER_OPTIONS);

      expect(model.getRoots('covered').map((node) => node.label)).toEqual(['top']);
      expect(model.getRoots('uncovered').map((node) => node.label)).toEqual(['other']);
      expect(new CoverageTreeModel(new MemUCIS(), DEFAULT_FILTER_OPTIONS).getRoots('all')).toEqual([]);
    });
  });

  describe('getChildren', () => {
    it('returns scope children, excludes bins, handles leaves, and applies filters', () => {
      const db = buildSimpleCovergroup();
      const top = Array.from(db.scopes(ScopeTypeT.ALL))[0]!;
      const cgCovered = top.createCovergroupDef('cg_covered');
      cgCovered.createCoverpoint('cp_ok').createBin('hit', 1, 1n, 1n);
      const cgMiss = top.createCovergroupDef('cg_miss');
      cgMiss.createCoverpoint('cp_miss').createBin('miss', 1, 0n, 1n);
      const model = new CoverageTreeModel(db, DEFAULT_FILTER_OPTIONS);
      const rootNode = model.getRoots('all')[0]!;
      const cpNode = model.getChildren(rootNode, 'all').find((node) => node.label === 'cg1');

      expect(model.getChildren(rootNode, 'all').map((node) => node.label)).toEqual(['cg1', 'cg_covered', 'cg_miss']);
      expect(model.getChildren(rootNode, 'covered').map((node) => node.label)).toEqual(['cg_covered']);
      expect(model.getChildren(rootNode, 'uncovered').map((node) => node.label)).toEqual(['cg1', 'cg_miss']);
      expect(model.getChildren(model.getChildren(cpNode!, 'all')[0]!, 'all')).toEqual([]);
    });
  });

  it('builds stable scope paths and node ids', () => {
    const db = buildSimpleCovergroup();
    const top = Array.from(db.scopes(ScopeTypeT.ALL))[0]!;
    const cg = Array.from(top.scopes(ScopeTypeT.ALL))[0]!;
    const cp = Array.from(cg.scopes(ScopeTypeT.ALL))[0]!;
    const model = new CoverageTreeModel(db, DEFAULT_FILTER_OPTIONS);
    const rootNode = model.getRoots('all')[0]!;
    const childNode = model.getChildren(rootNode, 'all')[0]!;

    expect(CoverageTreeModel.getScopePath(top)).toBe('top');
    expect(CoverageTreeModel.getScopePath(cp)).toBe('top.cg1.cp1');
    expect(CoverageTreeModel.getNodeDescription(rootNode)).toBe('50%');
    expect(CoverageTreeModel.getNodeDescription({ ...rootNode, stats: { covered: 0, total: 0, percentage: 100, isMet: true } })).toBe('100%');
    expect(rootNode.nodeId).toBe(CoverageTreeModel.getScopePath(top));
    expect(rootNode.nodeId).not.toBe(childNode.nodeId);
    expect(model.getRoots('all')[0]?.nodeId).toBe(rootNode.nodeId);
  });

  it('maps scope types to icon ids and formats tooltips', () => {
    expect(CoverageTreeModel.getIconForScopeType(ScopeTypeT.INSTANCE)).toBe('package');
    expect(CoverageTreeModel.getIconForScopeType(ScopeTypeT.COVERGROUP)).toBe('graph');
    expect(CoverageTreeModel.getIconForScopeType(ScopeTypeT.COVERINSTANCE)).toBe('graph');
    expect(CoverageTreeModel.getIconForScopeType(ScopeTypeT.COVERPOINT)).toBe('graph-line');
    expect(CoverageTreeModel.getIconForScopeType(ScopeTypeT.CROSS)).toBe('symbol-structure');
    expect(CoverageTreeModel.getIconForScopeType(ScopeTypeT.TOGGLE)).toBe('symbol-boolean');
    expect(CoverageTreeModel.getIconForScopeType(ScopeTypeT.BRANCH)).toBe('git-branch');
    expect(CoverageTreeModel.getIconForScopeType(ScopeTypeT.EXPR)).toBe('git-branch');
    expect(CoverageTreeModel.getIconForScopeType(ScopeTypeT.COND)).toBe('git-branch');
    expect(CoverageTreeModel.getIconForScopeType(ScopeTypeT.FSM)).toBe('symbol-enum');
    expect(CoverageTreeModel.getIconForScopeType(0x123456n)).toBe('circle');

    const node = new CoverageTreeModel(buildZeroCoverageDb(), DEFAULT_FILTER_OPTIONS).getRoots('all')[0]!;
    expect(CoverageTreeModel.getTooltip(node)).toContain('path: top');
    expect(CoverageTreeModel.getTooltip(node)).toContain('covered: 0/2 (0%)');
  });
});
