import {
  computeGoalStatus,
  flattenTestpoints,
  parseTestplan,
  resolveImports,
  type Goal,
} from '../TestplanModel';
import {
  FULL_TESTPOINT_YAML,
  INVALID_TESTPLAN_YAML,
  MINIMAL_TESTPLAN_YAML,
  NESTED_GOALS_YAML,
  buildCircularImportTestplans,
  buildImportedTestplans,
} from './fixtures/testplans';

describe('TestplanModel', () => {
  describe('parseTestplan valid inputs', () => {
    it('parses minimal YAML, full YAML, JSON input, nested goals, enums, and preserves custom data', () => {
      const minimal = parseTestplan(MINIMAL_TESTPLAN_YAML, '/plans/minimal.testplan');
      expect(minimal.ok).toBe(true);
      if (!minimal.ok) {
        throw new Error('Expected minimal plan to parse');
      }
      expect(minimal.plan.testpoints).toHaveLength(1);
      expect(minimal.plan.testpoints[0]?.description).toBeUndefined();
      expect(minimal.plan.importPaths).toEqual([]);

      const full = parseTestplan(FULL_TESTPOINT_YAML, '/plans/full.testplan');
      expect(full.ok).toBe(true);
      if (!full.ok) {
        throw new Error('Expected full plan to parse');
      }
      expect(full.plan.name).toBe('Full Plan');
      expect(full.plan.description).toBe('Full coverage plan');
      expect(full.plan.formatVersion).toBe('1.0');
      expect(full.plan.testpoints[0]?.coverage.map((binding) => binding.type)).toEqual([
        'covergroup', 'coverpoint', 'cross', 'assertion', 'toggle', 'line', 'branch',
      ]);
      expect(full.plan.testpoints[0]?.custom).toEqual({ tag: 'nightly', enabled: true });
      expect(full.plan.testpoints[0]?.priority).toBe('high');
      expect(full.plan.testpoints[0]?.status).toBe('complete');

      const json = parseTestplan(JSON.stringify({ testpoints: [{ name: 'json_tp', status: 'waived', coverage: [] }] }), '/plans/json.testplan');
      expect(json.ok).toBe(true);
      if (!json.ok) {
        throw new Error('Expected JSON plan to parse');
      }
      expect(json.plan.testpoints[0]?.status).toBe('waived');

      const nested = parseTestplan(NESTED_GOALS_YAML, '/plans/nested.testplan');
      expect(nested.ok).toBe(true);
      if (!nested.ok) {
        throw new Error('Expected nested plan to parse');
      }
      expect(nested.plan.goals).toHaveLength(1);
      expect(nested.plan.goals[0]?.goals[0]?.goals[0]?.name).toBe('level3');

      const enumPlan = parseTestplan(`
      testpoints:
        - { name: tp1, status: planned, priority: high, coverage: [] }
        - { name: tp2, status: in_progress, priority: medium, coverage: [] }
        - { name: tp3, status: complete, priority: low, coverage: [] }
        - { name: tp4, status: waived, coverage: [] }
      `, '/plans/enums.testplan');
      expect(enumPlan.ok).toBe(true);
      if (!enumPlan.ok) {
        throw new Error('Expected enum plan to parse');
      }
      expect(enumPlan.plan.testpoints.map((testpoint) => testpoint.status)).toEqual(['planned', 'in_progress', 'complete', 'waived']);
      expect(enumPlan.plan.testpoints.slice(0, 3).map((testpoint) => testpoint.priority)).toEqual(['high', 'medium', 'low']);
    });
  });

  describe('parseTestplan invalid inputs', () => {
    it('rejects empty input, invalid YAML, invalid root values, and invalid field values with paths', () => {
      expect(parseTestplan('', '/plans/empty.testplan')).toEqual({ ok: false, errors: [{ message: 'Testplan source is empty' }] });
      expect(parseTestplan('name: [', '/plans/bad.testplan').ok).toBe(false);
      expect(parseTestplan('- item', '/plans/root.testplan')).toEqual({ ok: false, errors: [{ message: 'Testplan root must be an object' }] });

      const missingName = parseTestplan(INVALID_TESTPLAN_YAML, '/plans/invalid.testplan');
      expect(missingName.ok).toBe(false);
      if (missingName.ok) {
        throw new Error('Expected invalid plan to fail');
      }
      expect(missingName.errors.some((error) => error.path === 'testpoints[0].name')).toBe(true);

      const badStatus = parseTestplan('testpoints: [{ name: tp, status: nope, coverage: [] }]', '/plans/status.testplan');
      expect(badStatus.ok).toBe(false);
      if (badStatus.ok) {
        throw new Error('Expected bad status to fail');
      }
      expect(badStatus.errors.some((error) => error.path === 'testpoints[0].status')).toBe(true);

      const badType = parseTestplan('testpoints: [{ name: tp, status: planned, coverage: [{ type: bad, path: a.b }] }]', '/plans/type.testplan');
      expect(badType.ok).toBe(false);
      if (badType.ok) {
        throw new Error('Expected bad type to fail');
      }
      expect(badType.errors.some((error) => error.path === 'testpoints[0].coverage[0].type')).toBe(true);

      const missingCoveragePath = parseTestplan('testpoints: [{ name: tp, status: planned, coverage: [{ type: coverpoint }] }]', '/plans/path.testplan');
      expect(missingCoveragePath.ok).toBe(false);
      if (missingCoveragePath.ok) {
        throw new Error('Expected missing coverage path to fail');
      }
      expect(missingCoveragePath.errors.some((error) => error.path === 'testpoints[0].coverage[0].path')).toBe(true);
    });
  });

  describe('resolveImports', () => {
    it('returns the same plan when no imports exist', async () => {
      const parsed = parseTestplan(MINIMAL_TESTPLAN_YAML, '/plans/minimal.testplan');
      if (!parsed.ok) {
        throw new Error('Expected minimal plan to parse');
      }
      await expect(resolveImports(parsed.plan, async () => {
        throw new Error('should not load');
      })).resolves.toEqual({ ok: true, plan: parsed.plan });
    });

    it('merges imported testpoints and goals, supports multiple imports, resolves relative paths, and reports loader failures', async () => {
      const { mainYaml, importedYaml, mockLoader } = buildImportedTestplans();
      const parsed = parseTestplan(mainYaml, '/plans/main.testplan');
      if (!parsed.ok) {
        throw new Error('Expected main plan to parse');
      }
      expect(parsed.plan.importPaths).toEqual(['/plans/imported.testplan']);

      const resolved = await resolveImports(parsed.plan, mockLoader);
      expect(resolved.ok).toBe(true);
      if (!resolved.ok) {
        throw new Error('Expected imports to resolve');
      }
      expect(resolved.plan.testpoints.map((testpoint) => testpoint.name)).toEqual(['tp_main', 'tp_imported']);
      expect(resolved.plan.goals.map((goal) => goal.name)).toEqual(['imported_goal']);

      const twoImportMain = parseTestplan(`
      imports:
        - ./imported.testplan
        - ./second.testplan
      `, '/plans/main.testplan');
      if (!twoImportMain.ok) {
        throw new Error('Expected two-import plan to parse');
      }
      const twoImportResolved = await resolveImports(twoImportMain.plan, async (filePath) => {
        if (filePath === '/plans/imported.testplan') {
          return importedYaml;
        }
        if (filePath === '/plans/second.testplan') {
          return 'testpoints: [{ name: tp_second, status: complete, coverage: [] }]';
        }
        throw new Error(`Unexpected path: ${filePath}`);
      });
      expect(twoImportResolved.ok).toBe(true);
      if (!twoImportResolved.ok) {
        throw new Error('Expected two imports to resolve');
      }
      expect(twoImportResolved.plan.testpoints.map((testpoint) => testpoint.name)).toEqual(['tp_imported', 'tp_second']);

      const loadFailure = await resolveImports(parsed.plan, async () => {
        throw new Error('missing');
      });
      expect(loadFailure.ok).toBe(false);
      if (loadFailure.ok) {
        throw new Error('Expected load failure');
      }
      expect(loadFailure.errors[0]?.message).toContain('missing');
    });

    it('detects circular imports and max-depth violations', async () => {
      const circular = buildCircularImportTestplans();
      const parsedCircular = parseTestplan(circular.yaml, '/plans/root.testplan');
      if (!parsedCircular.ok) {
        throw new Error('Expected circular test fixture to parse');
      }
      const circularResult = await resolveImports(parsedCircular.plan, circular.mockLoader);
      expect(circularResult.ok).toBe(false);
      if (circularResult.ok) {
        throw new Error('Expected circular imports to fail');
      }
      expect(circularResult.errors[0]?.message).toContain('Circular import');

      const imported = buildImportedTestplans();
      const parsed = parseTestplan(imported.mainYaml, '/plans/main.testplan');
      if (!parsed.ok) {
        throw new Error('Expected imported plan to parse');
      }
      const depthResult = await resolveImports(parsed.plan, imported.mockLoader, 0);
      expect(depthResult.ok).toBe(false);
      if (depthResult.ok) {
        throw new Error('Expected max depth failure');
      }
      expect(depthResult.errors[0]?.message).toContain('Maximum import depth');
    });
  });

  describe('flattenTestpoints', () => {
    it('returns top-level, goal-contained, nested, and deduplicated testpoints', () => {
      const parsed = parseTestplan(`
      testpoints:
        - { name: tp_top, status: planned, coverage: [] }
      goals:
        - name: goal1
          testpoints:
            - { name: tp_goal, status: complete, coverage: [] }
          goals:
            - name: goal2
              testpoints:
                - { name: tp_nested, status: planned, coverage: [] }
                - { name: tp_top, status: planned, coverage: [] }
      `, '/plans/flat.testplan');
      if (!parsed.ok) {
        throw new Error('Expected flatten fixture to parse');
      }

      expect(flattenTestpoints(parsed.plan).map((testpoint) => testpoint.name)).toEqual(['tp_top', 'tp_goal', 'tp_nested']);
    });
  });

  describe('computeGoalStatus', () => {
    const goalWith = (statuses: string[], childGoals: Goal[] = []): Goal => ({
      name: 'goal',
      goals: childGoals,
      testpoints: statuses.map((status, index) => ({ name: `tp${index}`, status: status as never, coverage: [] })),
    });

    it('aggregates status recursively', () => {
      expect(computeGoalStatus(goalWith(['complete', 'complete']))).toBe('complete');
      expect(computeGoalStatus(goalWith(['complete', 'waived']))).toBe('complete');
      expect(computeGoalStatus(goalWith(['planned', 'in_progress']))).toBe('in_progress');
      expect(computeGoalStatus(goalWith(['planned', 'planned']))).toBe('planned');
      expect(computeGoalStatus(goalWith(['planned', 'complete']))).toBe('in_progress');
      expect(computeGoalStatus(goalWith([]))).toBe('planned');
      expect(computeGoalStatus(goalWith([], [goalWith(['complete'])]))).toBe('complete');
    });
  });
});
