import { DEFAULT_FILTER_OPTIONS } from '../CoverageStats';
import { computeTestpointCoverages } from '../TestplanLinkage';
import { parseTestplan } from '../TestplanModel';
import { TestplanTreeModel, type TestplanNode } from '../TestplanTreeModel';
import { MINIMAL_TESTPLAN_YAML, NESTED_GOALS_YAML } from './fixtures/testplans';
import { buildFullCoverageDb, buildSimpleCovergroup } from './fixtures/builders';

describe('TestplanTreeModel', () => {
  describe('getRoots without coverage data', () => {
    it('returns goal nodes, testpoint nodes, mixed roots, and null stats', () => {
      const goalsOnly = parseTestplan(NESTED_GOALS_YAML, '/plans/goals.testplan');
      if (!goalsOnly.ok) {
        throw new Error('Expected goals-only plan to parse');
      }
      const goalRoots = new TestplanTreeModel(goalsOnly.plan, null).getRoots();
      expect(goalRoots.map((node) => node.kind)).toEqual(['goal']);
      expect(goalRoots[0]?.stats).toBeNull();

      const testpointsOnly = parseTestplan(MINIMAL_TESTPLAN_YAML, '/plans/testpoints.testplan');
      if (!testpointsOnly.ok) {
        throw new Error('Expected testpoints-only plan to parse');
      }
      expect(new TestplanTreeModel(testpointsOnly.plan, null).getRoots().map((node) => node.kind)).toEqual(['testpoint']);

      const mixed = parseTestplan(`
      goals:
        - name: goal
          testpoints: []
      testpoints:
        - { name: tp, status: planned, coverage: [] }
      `, '/plans/mixed.testplan');
      if (!mixed.ok) {
        throw new Error('Expected mixed plan to parse');
      }
      expect(new TestplanTreeModel(mixed.plan, null).getRoots().map((node) => node.kind)).toEqual(['goal', 'testpoint']);
    });
  });

  describe('getRoots with coverage data', () => {
    it('populates stats from TestpointCoverage objects', () => {
      const parsed = parseTestplan(`
      testpoints:
        - name: tp_hit
          status: complete
          coverage:
            - { type: coverpoint, path: top.cg1.cp1 }
        - name: tp_miss
          status: planned
          coverage:
            - { type: coverpoint, path: top.missing }
      `, '/plans/coverage.testplan');
      if (!parsed.ok) {
        throw new Error('Expected coverage plan to parse');
      }
      const coverages = computeTestpointCoverages(parsed.plan, buildSimpleCovergroup(), DEFAULT_FILTER_OPTIONS);
      const roots = new TestplanTreeModel(parsed.plan, coverages).getRoots();

      expect(roots[0]?.stats).toMatchObject({ covered: 1, total: 2, percentage: 50 });
      expect(roots[1]?.stats).toMatchObject({ covered: 0, total: 0, percentage: 100 });
    });
  });

  describe('getChildren', () => {
    it('returns children for goals and plan nodes and an empty array for testpoints', () => {
      const parsed = parseTestplan(NESTED_GOALS_YAML, '/plans/tree.testplan');
      if (!parsed.ok) {
        throw new Error('Expected tree plan to parse');
      }
      const model = new TestplanTreeModel(parsed.plan, null);
      const goalNode = model.getRoots()[0]!;
      const goalChildren = model.getChildren(goalNode);
      const planNode: TestplanNode = {
        nodeId: 'plan',
        kind: 'plan',
        label: parsed.plan.name ?? 'plan',
        status: 'planned',
        stats: null,
        detail: parsed.plan,
        children: [],
      };

      expect(goalChildren.map((node) => node.kind)).toEqual(['goal', 'testpoint']);
      expect(model.getChildren(goalChildren[1]!)).toEqual([]);
      expect(model.getChildren(planNode).map((node) => node.kind)).toEqual(['goal']);
    });
  });

  it('maps statuses to icons and formats descriptions/tooltips', () => {
    expect(TestplanTreeModel.getIconForStatus('complete')).toBe('pass');
    expect(TestplanTreeModel.getIconForStatus('in_progress')).toBe('circle-filled');
    expect(TestplanTreeModel.getIconForStatus('planned')).toBe('circle-outline');
    expect(TestplanTreeModel.getIconForStatus('waived')).toBe('circle-slash');

    const parsed = parseTestplan(MINIMAL_TESTPLAN_YAML, '/plans/desc.testplan');
    if (!parsed.ok) {
      throw new Error('Expected description plan to parse');
    }
    const coverages = computeTestpointCoverages(parsed.plan, buildFullCoverageDb(), DEFAULT_FILTER_OPTIONS);
    const model = new TestplanTreeModel(parsed.plan, coverages);
    const testpointNode = model.getRoots()[0]!;
    const goalNode: TestplanNode = {
      nodeId: 'goal:status',
      kind: 'goal',
      label: 'goal',
      status: 'in_progress',
      stats: null,
      detail: { name: 'goal', goals: [], testpoints: [{ name: 'tp', status: 'planned', coverage: [] }] },
      children: [],
    };

    expect(TestplanTreeModel.getNodeDescription(testpointNode)).toBe('100%');
    expect(TestplanTreeModel.getNodeDescription({ ...testpointNode, stats: null })).toBe('planned');
    expect(TestplanTreeModel.getNodeDescription(goalNode)).toBe('in_progress');
    expect(TestplanTreeModel.getTooltip(testpointNode)).toContain('covered: 2/2 (100%)');
  });
});
