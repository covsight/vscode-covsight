import path from 'node:path';
import yaml from 'js-yaml';

/**
 * Allowed execution states for a testpoint or derived goal status.
 */
export type TestpointStatus = 'planned' | 'in_progress' | 'complete' | 'waived';

/**
 * Supported priority labels for a testpoint.
 */
export type Priority = 'high' | 'medium' | 'low';

/**
 * Coverage object types that a testpoint may bind to.
 */
export type CoverageBindingType = 'covergroup' | 'coverpoint' | 'cross' | 'assertion' | 'toggle' | 'line' | 'branch';

/**
 * A single coverage path binding declared by a testpoint.
 */
export interface CoverageBinding {
  type: CoverageBindingType;
  path: string;
}

/**
 * Leaf verification item defined in a CovSight testplan.
 */
export interface Testpoint {
  name: string;
  description?: string;
  owner?: string;
  status: TestpointStatus;
  priority?: Priority;
  stage?: string;
  tests?: string[];
  coverage: CoverageBinding[];
  requirements?: string[];
  custom?: Record<string, unknown>;
}

/**
 * Hierarchical grouping node for related goals and testpoints.
 */
export interface Goal {
  name: string;
  description?: string;
  owner?: string;
  status?: TestpointStatus;
  goals: Goal[];
  testpoints: Testpoint[];
}

/**
 * Fully parsed testplan file together with metadata needed for import resolution.
 */
export interface ParsedTestplan {
  filePath: string;
  name?: string;
  description?: string;
  formatVersion?: string;
  goals: Goal[];
  testpoints: Testpoint[];
  importPaths: string[];
}

/**
 * Validation or import-resolution error reported to the caller.
 */
export interface TestplanParseError {
  message: string;
  path?: string;
}

/**
 * Result of parsing or resolving a testplan.
 */
export type TestplanParseResult = { ok: true; plan: ParsedTestplan } | { ok: false; errors: TestplanParseError[] };

const VALID_STATUSES = new Set<TestpointStatus>(['planned', 'in_progress', 'complete', 'waived']);
const VALID_PRIORITIES = new Set<Priority>(['high', 'medium', 'low']);
const VALID_BINDING_TYPES = new Set<CoverageBindingType>(['covergroup', 'coverpoint', 'cross', 'assertion', 'toggle', 'line', 'branch']);

/**
 * Parses and validates a YAML testplan file.
 *
 * Empty files, malformed YAML, and type mismatches are reported as structured
 * errors instead of throwing. Relative import paths are resolved immediately
 * against {@link filePath} so later import resolution can load them directly.
 *
 * @param source Raw YAML source text.
 * @param filePath Absolute or workspace-relative path of the source file.
 */
export function parseTestplan(source: string, filePath: string): TestplanParseResult {
  if (source.trim().length === 0) {
    return { ok: false, errors: [{ message: 'Testplan source is empty' }] };
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(source);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, errors: [{ message: `Failed to parse testplan: ${message}` }] };
  }

  if (!isRecord(parsed)) {
    return { ok: false, errors: [{ message: 'Testplan root must be an object' }] };
  }

  const errors: TestplanParseError[] = [];
  const goals = parseGoalArray(parsed.goals, 'goals', errors);
  const testpoints = parseTestpointArray(parsed.testpoints, 'testpoints', errors);
  const importPaths = parseImports(parsed.imports, filePath, errors);
  const name = optionalString(parsed.name, 'name', errors);
  const description = optionalString(parsed.description, 'description', errors);
  const formatVersion = optionalString(parsed.formatVersion ?? parsed.format_version, 'formatVersion', errors);

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    plan: {
      filePath,
      name,
      description,
      formatVersion,
      goals,
      testpoints,
      importPaths,
    },
  };
}

/**
 * Recursively resolves imported testplans and merges their goals and testpoints.
 *
 * Circular imports and excessive nesting are detected and returned as errors.
 * Imported content is appended without de-duplicating by name because multiple
 * files may intentionally contribute distinct goals with the same label.
 *
 * @param plan Parsed root plan whose imports should be resolved.
 * @param loadFile Callback used to load imported files.
 * @param maxDepth Maximum allowed import recursion depth.
 */
export async function resolveImports(
  plan: ParsedTestplan,
  loadFile: (path: string) => Promise<string>,
  maxDepth = 10,
): Promise<TestplanParseResult> {
  return resolveImportsRecursive(plan, loadFile, maxDepth, 0, new Set<string>());
}

/**
 * Flattens top-level and nested testpoints into a single list.
 *
 * Testpoints are de-duplicated by name so a testpoint referenced from multiple
 * places appears once in downstream coverage calculations.
 *
 * @param plan Parsed plan to traverse.
 */
export function flattenTestpoints(plan: ParsedTestplan): Testpoint[] {
  const result: Testpoint[] = [];
  const seen = new Set<string>();

  const add = (testpoint: Testpoint): void => {
    if (seen.has(testpoint.name)) {
      return;
    }
    seen.add(testpoint.name);
    result.push(testpoint);
  };

  for (const testpoint of plan.testpoints) {
    add(testpoint);
  }

  const visitGoal = (goal: Goal): void => {
    for (const testpoint of goal.testpoints) {
      add(testpoint);
    }
    for (const child of goal.goals) {
      visitGoal(child);
    }
  };

  for (const goal of plan.goals) {
    visitGoal(goal);
  }

  return result;
}

/**
 * Derives a goal status from all descendant testpoints and child goals.
 *
 * Empty goals default to {@code planned}. A mix of complete and waived children
 * is considered complete, while any in-progress activity keeps the goal marked
 * {@code in_progress}.
 *
 * @param goal Goal whose recursive status should be computed.
 */
export function computeGoalStatus(goal: Goal): TestpointStatus {
  const childStatuses = [...goal.testpoints.map((testpoint) => testpoint.status), ...goal.goals.map((child) => computeGoalStatus(child))];

  if (childStatuses.length === 0) {
    return 'planned';
  }
  if (childStatuses.includes('in_progress')) {
    return 'in_progress';
  }
  if (childStatuses.every((status) => status === 'complete' || status === 'waived')) {
    return 'complete';
  }
  if (childStatuses.some((status) => status === 'complete' || status === 'in_progress')) {
    return 'in_progress';
  }
  return 'planned';
}

async function resolveImportsRecursive(
  plan: ParsedTestplan,
  loadFile: (path: string) => Promise<string>,
  maxDepth: number,
  depth: number,
  stack: Set<string>,
): Promise<TestplanParseResult> {
  if (depth > maxDepth) {
    return { ok: false, errors: [{ message: `Maximum import depth of ${maxDepth} exceeded`, path: plan.filePath }] };
  }
  if (stack.has(plan.filePath)) {
    return { ok: false, errors: [{ message: `Circular import detected for ${plan.filePath}`, path: plan.filePath }] };
  }

  const nextStack = new Set(stack);
  nextStack.add(plan.filePath);

  const merged: ParsedTestplan = {
    ...plan,
    goals: [...plan.goals],
    testpoints: [...plan.testpoints],
    importPaths: [...plan.importPaths],
  };

  for (const importPath of plan.importPaths) {
    if (nextStack.has(importPath)) {
      return { ok: false, errors: [{ message: `Circular import detected for ${importPath}`, path: importPath }] };
    }

    let importedSource: string;
    try {
      importedSource = await loadFile(importPath);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, errors: [{ message: `Failed to load import ${importPath}: ${message}`, path: importPath }] };
    }

    const parsed = parseTestplan(importedSource, importPath);
    if (!parsed.ok) {
      return parsed;
    }

    const resolved = await resolveImportsRecursive(parsed.plan, loadFile, maxDepth, depth + 1, nextStack);
    if (!resolved.ok) {
      return resolved;
    }

    merged.goals.push(...resolved.plan.goals);
    merged.testpoints.push(...resolved.plan.testpoints);
    merged.importPaths = [...new Set([...merged.importPaths, importPath, ...resolved.plan.importPaths])];
  }

  return { ok: true, plan: merged };
}

function parseImports(value: unknown, filePath: string, errors: TestplanParseError[]): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    errors.push({ message: 'imports must be an array of strings', path: 'imports' });
    return [];
  }

  const baseDir = path.dirname(filePath);
  return value.flatMap((entry, index) => {
    if (typeof entry !== 'string' || entry.length === 0) {
      errors.push({ message: 'import path must be a non-empty string', path: `imports[${index}]` });
      return [];
    }
    return [path.resolve(baseDir, entry)];
  });
}

function parseGoalArray(value: unknown, currentPath: string, errors: TestplanParseError[]): Goal[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    errors.push({ message: 'goals must be an array', path: currentPath });
    return [];
  }
  return value.flatMap((entry, index) => {
    const parsed = parseGoal(entry, `${currentPath}[${index}]`, errors);
    return parsed ? [parsed] : [];
  });
}

function parseTestpointArray(value: unknown, currentPath: string, errors: TestplanParseError[]): Testpoint[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    errors.push({ message: 'testpoints must be an array', path: currentPath });
    return [];
  }
  return value.flatMap((entry, index) => {
    const parsed = parseTestpoint(entry, `${currentPath}[${index}]`, errors);
    return parsed ? [parsed] : [];
  });
}

function parseGoal(value: unknown, currentPath: string, errors: TestplanParseError[]): Goal | null {
  if (!isRecord(value)) {
    errors.push({ message: 'goal must be an object', path: currentPath });
    return null;
  }

  const name = requiredString(value.name, `${currentPath}.name`, errors);
  const description = optionalString(value.description, `${currentPath}.description`, errors);
  const owner = optionalString(value.owner, `${currentPath}.owner`, errors);
  const status = optionalStatus(value.status, `${currentPath}.status`, errors);
  const goals = parseGoalArray(value.goals, `${currentPath}.goals`, errors);
  const testpoints = parseTestpointArray(value.testpoints, `${currentPath}.testpoints`, errors);

  if (name === null) {
    return null;
  }

  return { name, description, owner, status, goals, testpoints };
}

function parseTestpoint(value: unknown, currentPath: string, errors: TestplanParseError[]): Testpoint | null {
  if (!isRecord(value)) {
    errors.push({ message: 'testpoint must be an object', path: currentPath });
    return null;
  }

  const name = requiredString(value.name, `${currentPath}.name`, errors);
  const description = optionalString(value.description, `${currentPath}.description`, errors);
  const owner = optionalString(value.owner, `${currentPath}.owner`, errors);
  const status = optionalStatus(value.status, `${currentPath}.status`, errors) ?? 'planned';
  const priority = optionalPriority(value.priority, `${currentPath}.priority`, errors);
  const stage = optionalString(value.stage, `${currentPath}.stage`, errors);
  const tests = optionalStringArray(value.tests, `${currentPath}.tests`, errors);
  const coverage = parseCoverageArray(value.coverage, `${currentPath}.coverage`, errors);
  const requirements = optionalStringArray(value.requirements, `${currentPath}.requirements`, errors);
  const custom = optionalRecord(value.custom, `${currentPath}.custom`, errors);

  if (name === null) {
    return null;
  }

  return {
    name,
    description,
    owner,
    status,
    priority,
    stage,
    tests,
    coverage,
    requirements,
    custom,
  };
}

function parseCoverageArray(value: unknown, currentPath: string, errors: TestplanParseError[]): CoverageBinding[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    errors.push({ message: 'coverage must be an array', path: currentPath });
    return [];
  }
  return value.flatMap((entry, index) => {
    const parsed = parseCoverageBinding(entry, `${currentPath}[${index}]`, errors);
    return parsed ? [parsed] : [];
  });
}

function parseCoverageBinding(value: unknown, currentPath: string, errors: TestplanParseError[]): CoverageBinding | null {
  if (!isRecord(value)) {
    errors.push({ message: 'coverage binding must be an object', path: currentPath });
    return null;
  }

  const type = value.type;
  if (typeof type !== 'string' || !VALID_BINDING_TYPES.has(type as CoverageBindingType)) {
    errors.push({ message: 'coverage type must be a valid binding type', path: `${currentPath}.type` });
    return null;
  }

  const bindingPath = value.path;
  if (typeof bindingPath !== 'string' || bindingPath.length === 0) {
    errors.push({ message: 'coverage path must be a non-empty string', path: `${currentPath}.path` });
    return null;
  }

  return { type: type as CoverageBindingType, path: bindingPath };
}

function requiredString(value: unknown, currentPath: string, errors: TestplanParseError[]): string | null {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  errors.push({ message: 'value must be a non-empty string', path: currentPath });
  return null;
}

function optionalString(value: unknown, currentPath: string, errors: TestplanParseError[]): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === 'string') {
    return value;
  }
  errors.push({ message: 'value must be a string', path: currentPath });
  return undefined;
}

function optionalStringArray(value: unknown, currentPath: string, errors: TestplanParseError[]): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    errors.push({ message: 'value must be an array of strings', path: currentPath });
    return undefined;
  }

  const items: string[] = [];
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== 'string') {
      errors.push({ message: 'value must be a string', path: `${currentPath}[${index}]` });
      continue;
    }
    items.push(entry);
  }
  return items;
}

function optionalRecord(value: unknown, currentPath: string, errors: TestplanParseError[]): Record<string, unknown> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (isRecord(value)) {
    return value;
  }
  errors.push({ message: 'value must be an object', path: currentPath });
  return undefined;
}

function optionalStatus(value: unknown, currentPath: string, errors: TestplanParseError[]): TestpointStatus | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === 'string' && VALID_STATUSES.has(value as TestpointStatus)) {
    return value as TestpointStatus;
  }
  errors.push({ message: 'status must be a valid testpoint status', path: currentPath });
  return undefined;
}

function optionalPriority(value: unknown, currentPath: string, errors: TestplanParseError[]): Priority | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === 'string' && VALID_PRIORITIES.has(value as Priority)) {
    return value as Priority;
  }
  errors.push({ message: 'priority must be a valid priority', path: currentPath });
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
