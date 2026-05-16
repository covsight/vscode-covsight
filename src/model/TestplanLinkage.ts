import { MemUCIS, Scope, ScopeTypeT, dfsScopes } from '@covsight/core';
import { FilterOptions, ScopeStats, computeAggregateStats } from './CoverageStats.js';
import { CoverageBinding, ParsedTestplan, Testpoint, flattenTestpoints } from './TestplanModel.js';

/**
 * Resolution details for one testpoint coverage binding.
 */
export interface BindingResolution {
  binding: CoverageBinding;
  matchedScopes: Scope[];
  stats: ScopeStats;
}

/**
 * Coverage summary for a single flattened testpoint.
 */
export interface TestpointCoverage {
  testpoint: Testpoint;
  bindings: BindingResolution[];
  aggregateStats: ScopeStats;
}

/**
 * Scope that exists in the database but is not referenced by any testpoint binding.
 */
export interface UnboundScope {
  scope: Scope;
  scopePath: string;
}

/**
 * Indexes scopes by their dotted logical path.
 *
 * Later scopes with the same path overwrite earlier entries, which matches the
 * current assumption that scope paths are unique within one database.
 *
 * @param ucis Open NCDB model to traverse.
 */
export function buildScopeIndex(ucis: MemUCIS): Map<string, Scope> {
  const index = new Map<string, Scope>();
  for (const scope of dfsScopes(ucis)) {
    index.set(getScopePath(scope), scope);
  }
  return index;
}

/**
 * Resolves an exact or single-segment-wildcard binding path against the scope index.
 *
 * Wildcards only match one dotted path segment, so `top.*.cg` matches
 * `top.u0.cg` but not `top.u0.sub.cg`.
 *
 * @param path Binding path from the testplan.
 * @param scopeIndex Index produced by {@link buildScopeIndex}.
 */
export function resolveBindingPath(path: string, scopeIndex: Map<string, Scope>): Scope[] {
  const exact = scopeIndex.get(path);
  if (!path.includes('*')) {
    return exact ? [exact] : [];
  }

  const patternSegments = path.split('.');
  return Array.from(scopeIndex.entries())
    .filter(([scopePath]) => matchesPath(patternSegments, scopePath.split('.')))
    .sort((lhs, rhs) => lhs[0].localeCompare(rhs[0]))
    .map(([, scope]) => scope);
}

/**
 * Computes per-testpoint coverage by matching every binding to database scopes.
 *
 * When a binding matches no scopes its contribution is an empty 100% aggregate,
 * which keeps the UI consistent with other zero-total calculations.
 *
 * @param plan Parsed testplan to evaluate.
 * @param ucis Open NCDB model to match against.
 * @param opts Filtering rules and coverage goal thresholds.
 */
export function computeTestpointCoverages(plan: ParsedTestplan, ucis: MemUCIS, opts: FilterOptions): TestpointCoverage[] {
  const scopeIndex = buildScopeIndex(ucis);

  return flattenTestpoints(plan).map((testpoint) => {
    const bindings = testpoint.coverage.map((binding) => {
      const matchedScopes = resolveBindingPath(binding.path, scopeIndex);
      const stats = mergeStats(matchedScopes.map((scope) => computeAggregateStats(scope, opts)), opts.coverageGoal);
      return { binding, matchedScopes, stats };
    });

    return {
      testpoint,
      bindings,
      aggregateStats: mergeStats(bindings.map((binding) => binding.stats), opts.coverageGoal),
    };
  });
}

/**
 * Finds database scopes that are not covered by any testplan binding.
 *
 * Wildcard bindings mark every matched scope as bound before the final database
 * traversal computes the remaining unbound list.
 *
 * @param ucis Open NCDB model to scan.
 * @param plan Parsed testplan whose bindings should be applied.
 */
export function findUnboundScopes(ucis: MemUCIS, plan: ParsedTestplan): UnboundScope[] {
  const scopeIndex = buildScopeIndex(ucis);
  const matched = new Set<Scope>();

  for (const testpoint of flattenTestpoints(plan)) {
    for (const binding of testpoint.coverage) {
      for (const scope of resolveBindingPath(binding.path, scopeIndex)) {
        matched.add(scope);
      }
    }
  }

  return dfsScopes(ucis)
    .filter((scope) => !matched.has(scope))
    .map((scope) => ({ scope, scopePath: getScopePath(scope) }))
    .sort((lhs, rhs) => lhs.scopePath.localeCompare(rhs.scopePath));
}

function mergeStats(stats: ScopeStats[], coverageGoal: number): ScopeStats {
  const total = stats.reduce((sum, entry) => sum + entry.total, 0);
  const covered = stats.reduce((sum, entry) => sum + entry.covered, 0);
  const percentage = total === 0 ? 100 : Math.round((covered / total) * 100);
  return {
    covered,
    total,
    percentage,
    isMet: percentage >= coverageGoal,
  };
}

function matchesPath(patternSegments: string[], pathSegments: string[]): boolean {
  if (patternSegments.length !== pathSegments.length) {
    return false;
  }
  return patternSegments.every((segment, index) => segment === '*' || segment === pathSegments[index]);
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
