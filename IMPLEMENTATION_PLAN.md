# vscode-covsight — Implementation, Test, and Documentation Plan

## Status

Design approved. This document governs implementation order, architectural
decisions, testability, and documentation deliverables. No existing user base —
complete rewrite is allowed.

**Phase 0 — Complete** (`@covsight/core` browser compatibility: `readFromBytes`/`toBytes` added, `node:fs` isolated via dynamic import, `packages/covsight-core` built and wired into `vscode-covsight`)

**Phase 1 — Complete** (Brand rename to CovSight; esbuild bundler; Jest framework; all `pyucis.*` identifiers removed; `sql.js` retained pending Phase 3)

**Phase 2 — Complete** (Model layer: 10 model files in `src/model/`, 53 unit tests passing; Jest ESM config; ESLint architecture rules)

**Phase 3 — Complete** (Presentation layer rewritten to use model layer; `src/db/` deleted; `sql.js` removed; `CoveragePublisher`, `ToggleDecorationProvider`, HTML generators, and all providers use `NcdbManager`/`CoverageTreeModel`/`CoverageSourceModel`)

**Phase 4 — Complete** (Testplan support: `schemas/covsight-testplan.schema.json`; `yamlValidation` in `package.json`; `TestplanDiscovery`, `TestplanManager`, `TestplanTreeProvider`; `testplan-panel.ts` + `html/testplan-detail.ts`; `renderTestplanClosure` in dashboard; testplan commands + YAML extension soft-dependency notice in `extension.ts`)

**Phase 5 — Complete** (Polish: `.cdb` file icon + language registration; Getting Started walkthrough (4 steps); README rewrite; CHANGELOG.md; dashboard history section; JSDoc on all `src/model/` exports)

---

## 1. Core Architectural Principle: Model / Presentation Separation

Every non-trivial piece of logic is divided into two layers:

```
Model layer                    Presentation layer
─────────────────────────────  ─────────────────────────────────────────────
Pure TypeScript                Uses vscode.* API types
No vscode imports              Imports from model layer
No UI state                    Thin wrapper: calls model, renders result
Testable with plain Jest       Tested via vscode integration tests only
```

The model layer contains **all business logic**: coverage statistics, tree
structure, testplan parsing, path mapping, source-line coverage extraction,
and coverage-testplan linkage. These are standalone TypeScript modules with
zero VS Code dependencies.

The presentation layer is a thin shell. It calls model functions, then
converts the results to VS Code constructs (`TreeItem`, `FileCoverage`,
decoration ranges, webview HTML). These conversions are simple and linear;
no conditional logic that belongs in the model layer is permitted here.

This separation is enforced via directory structure:

```
src/
├── model/          ← ALL business logic; zero vscode imports
│   ├── CoverageStats.ts
│   ├── CoverageTreeModel.ts
│   ├── CoverageSourceModel.ts
│   ├── TestplanModel.ts
│   ├── TestplanLinkage.ts
│   ├── PathMapper.ts
│   ├── NcdbManager.ts
│   └── index.ts
├── providers/      ← presentation; wraps model + implements vscode interfaces
├── views/          ← webview HTML generators (model output → HTML string)
├── decorations/    ← toggle decoration provider
└── extension.ts    ← activation; wires everything together
```

A CI lint rule enforces this: `src/model/**` must not `import` anything from
`vscode` (enforced via an ESLint `no-restricted-imports` rule).

---

## 2. Model Layer: Classes, Interfaces, and Responsibilities

### 2.1 `CoverageStats` — coverage calculation

**File:** `src/model/CoverageStats.ts`

The single shared computation kernel for coverage percentages. Used by the
tree view, dashboard, detail panel, and testplan linkage — must not be
duplicated.

```typescript
export interface FilterOptions {
  excludeIgnoredBins: boolean;   // default true
  excludeIllegalBins: boolean;   // default true
  coverageGoal: number;          // default 100
}

export interface ScopeStats {
  covered: number;               // bins with count >= atLeast
  total: number;                 // total bins (after filter applied)
  percentage: number;            // covered/total*100, or 100 if total===0
  isMet: boolean;                // percentage >= filterOptions.coverageGoal
}

// Single scope: total its CoverItems according to filter
export function computeScopeStats(scope: Scope, opts: FilterOptions): ScopeStats

// Aggregate: sum all leaf CoverItems reachable from a scope via DFS
export function computeAggregateStats(scope: Scope, opts: FilterOptions): ScopeStats

// Per-type breakdown for the dashboard
export function computeStatsByType(
  ucis: MemUCIS,
  opts: FilterOptions
): Map<bigint, ScopeStats>    // key = ScopeTypeT value

// Top-N uncovered bins across the whole DB (for hotspots panel)
export interface UncoveredBin {
  scopePath: string;   // dot-joined scope names from root
  binName: string;
  hitCount: bigint;
  atLeast: bigint;
  coverType: number;   // CoverTypeT
}
export function getUncoveredHotspots(
  ucis: MemUCIS,
  opts: FilterOptions,
  limit: number
): UncoveredBin[]

// Scope filter predicate for tree filtering
export type CoverageFilter = 'all' | 'covered' | 'uncovered';
export function scopePassesFilter(
  scope: Scope,
  filter: CoverageFilter,
  opts: FilterOptions
): boolean
```

**Bin filtering rules:**
- A `CoverItem` is excluded when `opts.excludeIgnoredBins` is true and
  `(coverType & CoverTypeT.IGNOREBIN) !== 0`.
- A `CoverItem` is excluded when `opts.excludeIllegalBins` is true and
  `(coverType & CoverTypeT.ILLEGALBIN) !== 0`.
- The `DEFAULT_BIN` is always included.

**Edge cases that must be handled:**
- `total === 0` after filtering → `percentage = 100`, `isMet = true`
- `atLeast === 0n` → bin is treated as automatically covered
- Mixed covered/uncovered bins in same scope
- Deeply nested scopes (instance → module → covergroup → coverpoint → bins)

---

### 2.2 `CoverageTreeModel` — tree structure

**File:** `src/model/CoverageTreeModel.ts`

Builds the data nodes for the Coverage Hierarchy tree view. The tree provider
holds a `CoverageTreeModel` and converts its nodes to `TreeItem` objects.

```typescript
export interface CoverageNode {
  readonly nodeId: string;          // stable ID for tree view (scope path)
  readonly label: string;           // display name
  readonly scopeType: bigint;       // ScopeTypeT bitmask
  readonly stats: ScopeStats;
  readonly scope: Scope;
  readonly children: CoverageNode[];  // empty until expanded (lazy)
}

export class CoverageTreeModel {
  constructor(private ucis: MemUCIS, private opts: FilterOptions) {}

  // Roots of the tree (top-level scopes after filter)
  getRoots(filter: CoverageFilter): CoverageNode[]

  // Children of a node (lazy: computes on demand, caches result)
  getChildren(node: CoverageNode, filter: CoverageFilter): CoverageNode[]

  // Build the full path of a scope (for display, tooltip, and search)
  static getScopePath(scope: Scope): string

  // Label with coverage percentage suffix (used by tree item description)
  static getNodeDescription(node: CoverageNode): string  // e.g. "67%"

  // Icon name for a scope type (VS Code ThemeIcon id)
  static getIconForScopeType(scopeType: bigint): string

  // Tooltip text for a node
  static getTooltip(node: CoverageNode): string
}
```

The model is invalidated and rebuilt whenever `NcdbManager` emits
`onActiveDatabaseChanged`. The tree provider calls `model.getRoots(filter)`
directly; no VS Code types appear in this file.

---

### 2.3 `CoverageSourceModel` — source-file coverage extraction

**File:** `src/model/CoverageSourceModel.ts`

Extracts per-line and per-branch coverage data from a `MemUCIS` instance,
maps database source paths to workspace paths, and produces a plain data
structure that the coverage publisher converts to `FileCoverage` objects.

```typescript
export interface BranchInfo {
  label: string;      // e.g. "true", "false", "0→1", "1→0"
  hitCount: bigint;
  coverType: number;  // CoverTypeT for additional display info
}

export interface LineCoverageData {
  line: number;       // 1-based (matches UCIS SourceInfo.line)
  hitCount: bigint;   // max of all bins on this line
  branches: BranchInfo[];
}

export interface FileCoverageData {
  dbPath: string;           // original path from database
  workspacePath: string;    // after path mapping
  lines: LineCoverageData[];
  totalLines: number;       // unique lines with any coverage data
  coveredLines: number;     // lines with hitCount > 0
}

export interface ToggleCoverageData {
  dbPath: string;
  workspacePath: string;
  // Map: line number → { zeroToOne: bigint, oneToZero: bigint }
  toggleLines: Map<number, { zeroToOne: bigint; oneToZero: bigint }>;
}

export class CoverageSourceModel {
  constructor(private pathMapper: PathMapper) {}

  // Extract all file coverage data from a MemUCIS
  buildFileCoverages(ucis: MemUCIS): FileCoverageData[]

  // Extract toggle coverage data separately
  buildToggleCoverages(ucis: MemUCIS): ToggleCoverageData[]
}
```

**Key logic:**
- Iterates scopes via `dfsScopes(ucis)` from `@covsight/core/ncdb`
- Only scopes with non-null `sourceInfo` contribute to file coverage
- For statement/block bins: `STMTBIN`, `BLOCKBIN` → `LineCoverageData`
- For branch bins: `BRANCHBIN`, `CONDBIN`, `EXPRBIN` → appended to
  `LineCoverageData.branches`
- For FSM: state/transition bins with source info → `LineCoverageData`
- For toggle: `TOGGLEBIN` bins with names `TOGGLE_BIN_0_TO_1` / `TOGGLE_BIN_1_TO_0`
  → `ToggleCoverageData`
- Multiple bins on the same line are aggregated: `hitCount = max(counts)`
- Lines without any bins are not included

---

### 2.4 `PathMapper` — source path translation

**File:** `src/model/PathMapper.ts`

Maps absolute database paths (from simulation environment) to workspace-relative
paths. Updated from existing `src/decorations/path-mapper.ts`.

```typescript
export type PathMappingConfig = Record<string, string>;

export class PathMapper {
  constructor(private mappings: PathMappingConfig) {}

  // Apply mappings; return null if no mapping matches and path doesn't exist
  map(dbPath: string): string | null

  // Apply mappings; return dbPath unchanged if nothing matches
  mapOrPassthrough(dbPath: string): string

  // Reload config (called on configuration change)
  updateMappings(mappings: PathMappingConfig): void

  static fromConfig(config: PathMappingConfig): PathMapper
}
```

Mapping rule: for each entry `{ "prefix": "replacement" }`, if `dbPath` starts
with `prefix`, replace the prefix with `replacement`. Longest-prefix match wins.
If no mapping matches, return `dbPath` unchanged in `mapOrPassthrough`.

---

### 2.5 `NcdbManager` — database lifecycle

**File:** `src/model/NcdbManager.ts`

Wraps `NcdbReader.readFromBytes()` from `@covsight/core`. Manages open
databases and the "active" database concept. Accepts a `ByteLoader` function
at construction time — this is the only I/O contact point, and it carries no
`vscode` import, making the class fully unit-testable by injecting a function
that returns fixture bytes.

```typescript
/** Load raw file bytes from any source. Injected at construction. */
export type ByteLoader = (path: string) => Promise<Uint8Array>;

export class NcdbManager {
  // Events (simple callback lists, not vscode.EventEmitter)
  readonly onActiveDatabaseChanged: SimpleEvent<string | null>;
  readonly onDatabaseOpened: SimpleEvent<string>;
  readonly onDatabaseClosed: SimpleEvent<string>;

  constructor(private loadBytes: ByteLoader) {}

  async openDatabase(path: string): Promise<MemUCIS>
  closeDatabase(path: string): void
  closeAll(): void
  async refreshDatabase(path: string): Promise<void>
  setActiveDatabase(path: string | null): void
  getActiveDatabase(): MemUCIS | null
  getActiveDatabasePath(): string | null
  getOpenDatabases(): string[]
  isOpen(path: string): boolean
}
```

In the extension's `database-manager.ts` (presentation layer), the loader is
wired to VS Code's virtual filesystem:

```typescript
const manager = new NcdbManager(
  async (path) => {
    const data = await vscode.workspace.fs.readFile(vscode.Uri.file(path));
    return new Uint8Array(data);
  }
);
```

In unit tests, the loader is a simple stub:

```typescript
const bytes = await new NcdbWriter().toBytes(buildSimpleCovergroup());
const manager = new NcdbManager(async (_path) => bytes);
```

`SimpleEvent<T>` is a minimal typed event emitter with no VS Code dependency:
```typescript
export class SimpleEvent<T> {
  subscribe(handler: (value: T) => void): () => void  // returns unsubscribe fn
  fire(value: T): void
}
```

The presentation layer wraps `SimpleEvent` in `vscode.EventEmitter` in
`extension.ts` — the model layer never sees `vscode.EventEmitter`.

---

### 2.6 `TestplanModel` — testplan parsing and representation

**File:** `src/model/TestplanModel.ts`

Parses a CovSight testplan YAML/JSON file into a typed in-memory structure.
Uses `js-yaml` for YAML parsing; the parsed JS object is validated against
expected shape with runtime type guards.

```typescript
export type TestpointStatus = 'planned' | 'in_progress' | 'complete' | 'waived';
export type Priority = 'high' | 'medium' | 'low';

export type CoverageBindingType =
  | 'covergroup' | 'coverpoint' | 'cross'
  | 'assertion' | 'toggle' | 'line' | 'branch';

export interface CoverageBinding {
  type: CoverageBindingType;
  path: string;
}

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

export interface Goal {
  name: string;
  description?: string;
  owner?: string;
  status?: TestpointStatus;
  goals: Goal[];         // nested sub-goals
  testpoints: Testpoint[];
}

export interface ParsedTestplan {
  filePath: string;         // absolute path to source file
  name?: string;
  description?: string;
  formatVersion?: string;
  goals: Goal[];
  testpoints: Testpoint[];  // top-level flat list
  importPaths: string[];    // resolved absolute paths of imports
}

export interface TestplanParseError {
  message: string;
  path?: string;  // YAML path where error occurred (e.g., "goals[0].name")
}

export type TestplanParseResult =
  | { ok: true; plan: ParsedTestplan }
  | { ok: false; errors: TestplanParseError[] };

// Parse YAML/JSON string into a ParsedTestplan
export function parseTestplan(
  source: string,
  filePath: string,
): TestplanParseResult

// Resolve imports (caller provides a file-loader function for testability)
export async function resolveImports(
  plan: ParsedTestplan,
  loadFile: (path: string) => Promise<string>,
  maxDepth?: number,     // default 10; prevents runaway recursion
): Promise<TestplanParseResult>

// Flatten the goal hierarchy into all reachable testpoints (for iteration)
export function flattenTestpoints(plan: ParsedTestplan): Testpoint[]

// Compute aggregate status for a goal (from its testpoints and sub-goals)
export function computeGoalStatus(goal: Goal): TestpointStatus
```

The `loadFile` abstraction makes `resolveImports` testable without disk I/O.

**Validation performed:**
- `name` is required on testpoints
- `status` must be a valid enum value
- `coverage[].type` must be a valid enum value
- `coverage[].path` must be a non-empty string
- Circular import detection (tracks visited paths; error on cycle)
- Duplicate testpoint names within a plan → warning (not error)

---

### 2.7 `TestplanLinkage` — binding testpoints to UCIS scopes

**File:** `src/model/TestplanLinkage.ts`

Resolves each testpoint's coverage bindings against an open `MemUCIS` database
and computes closure statistics.

```typescript
export interface BindingResolution {
  binding: CoverageBinding;
  matchedScopes: Scope[];   // may be empty (not found) or multiple (glob match)
  stats: ScopeStats;        // aggregate across all matched scopes
}

export interface TestpointCoverage {
  testpoint: Testpoint;
  bindings: BindingResolution[];
  aggregateStats: ScopeStats;   // aggregate across all bindings
}

export interface UnboundScope {
  scope: Scope;
  scopePath: string;
}

// Build a scope index by dotted path for O(1) lookup
export function buildScopeIndex(ucis: MemUCIS): Map<string, Scope>

// Resolve a single binding path (supports * glob in path segments)
export function resolveBindingPath(
  path: string,
  scopeIndex: Map<string, Scope>,
): Scope[]

// Compute coverage for all testpoints in a plan
export function computeTestpointCoverages(
  plan: ParsedTestplan,
  ucis: MemUCIS,
  opts: FilterOptions,
): TestpointCoverage[]

// Find scopes with no testplan binding (coverage gap finder)
export function findUnboundScopes(
  ucis: MemUCIS,
  plan: ParsedTestplan,
): UnboundScope[]
```

Path matching rules:
- Exact match: `"uart.baud.coverpoint_baud_rate"` → one scope or none
- Glob: `"uart.*.coverpoint_*"` → `*` matches a single path segment
- Relative paths beginning with `.` are resolved relative to the testplan file's
  design unit context (future feature; for now require fully-qualified paths)

---

### 2.8 `TestplanTreeModel` — testplan tree structure

**File:** `src/model/TestplanTreeModel.ts`

Builds tree nodes from a `ParsedTestplan` + optional `TestpointCoverage[]`
(when a database is loaded). Mirrors `CoverageTreeModel` in structure.

```typescript
export type TestplanNodeKind = 'plan' | 'goal' | 'testpoint';

export interface TestplanNode {
  readonly nodeId: string;
  readonly kind: TestplanNodeKind;
  readonly label: string;
  readonly status: TestpointStatus;
  readonly stats: ScopeStats | null;   // null when no DB loaded
  readonly detail: Goal | Testpoint | ParsedTestplan;
  readonly children: TestplanNode[];
}

export class TestplanTreeModel {
  constructor(
    private plan: ParsedTestplan,
    private coverages: TestpointCoverage[] | null,
  ) {}

  getRoots(): TestplanNode[]
  getChildren(node: TestplanNode): TestplanNode[]

  static getIconForStatus(status: TestpointStatus): string  // ThemeIcon id
  static getNodeDescription(node: TestplanNode): string
  static getTooltip(node: TestplanNode): string
}
```

---

## 3. Presentation Layer: Classes and Responsibilities

Presentation-layer classes are thin. They hold a reference to the relevant
model object and implement VS Code interfaces. Test coverage here comes from
integration tests that launch a VS Code extension host.

### 3.1 `CoverageTreeProvider`

`vscode.TreeDataProvider<CoverageNode>` wrapper around `CoverageTreeModel`.

- `getChildren(node)` → delegates to `model.getChildren(node, filter)` or
  `model.getRoots(filter)` for root.
- `getTreeItem(node)` → constructs `vscode.TreeItem` with icon, description,
  and context value from node data. **No calculation here** — all data comes
  from `CoverageNode`.
- `onDidChangeTreeData` fires when `NcdbManager.onActiveDatabaseChanged` fires
  or when the filter changes.

### 3.2 `DatabaseListProvider`

`vscode.TreeDataProvider<DatabaseItem>` showing open `.cdb` files.

- Maintained directly in the provider (database list is simple enough).
- Items show basename, active/inactive indicator, and file path tooltip.

### 3.3 `TestplanTreeProvider`

`vscode.TreeDataProvider<TestplanNode>` wrapper around `TestplanTreeModel`.

- Updates when testplan is loaded/closed or active database changes.

### 3.4 `CoveragePublisher`

Wraps the VS Code `TestController` to publish file coverage from a `MemUCIS`.

```typescript
class CoveragePublisher {
  constructor(controller: vscode.TestController) {}

  // Called whenever the active database changes.
  // Converts FileCoverageData[] from CoverageSourceModel to FileCoverage[].
  publish(coverages: FileCoverageData[]): void

  // Provides detailed coverage for a single file (called lazily by VS Code)
  buildDetailedCoverage(
    uri: vscode.Uri,
    data: FileCoverageData
  ): vscode.FileCoverageDetail[]

  dispose(): void
}
```

### 3.5 `ToggleDecorationProvider`

Applies `vscode.TextEditorDecorationType` gutter decorations for toggle
coverage. Consumes `ToggleCoverageData[]` from `CoverageSourceModel`.

Three decoration types (created once):
- `bothCovered`: green gutter icon (both 0→1 and 1→0 hit)
- `oneCovered`: yellow gutter icon (one direction hit)
- `notCovered`: red gutter icon (neither direction hit)

### 3.6 `DashboardView`

Webview panel. Calls model functions to get data, then calls HTML generator
functions (see §3.7) to render. **No logic inside** — only orchestration.

### 3.7 HTML Generator Functions (testable)

Each webview section is a **pure function** from model data to HTML string.
This makes dashboard HTML testable without launching VS Code.

```typescript
// src/views/html/
export function renderSummaryBar(stats: ScopeStats, goal: number): string
export function renderByTypeTable(byType: Map<bigint, ScopeStats>): string
export function renderHotspotsTable(hotspots: UncoveredBin[]): string
export function renderTestplanClosure(coverages: TestpointCoverage[]): string
export function renderHistorySection(historyNodes: HistoryNode[]): string
```

These functions are in `src/views/html/` and import **only model types**, no
`vscode`. They can be unit-tested like any other model function.

### 3.8 `ScopeDetailPanel` and `TestplanPanel`

Webview panels for scope and testpoint detail. Same pattern as dashboard:
delegate data fetching to model, call HTML generator functions to render.

---

## 4. Testing Strategy

### 4.1 Test framework

The extension uses **Jest** (same framework as `@covsight/core`) for model
layer unit tests. Install `jest`, `ts-jest`, `@types/jest` as dev dependencies.
VS Code integration tests use `@vscode/test-electron` (already present).

Two separate test suites:
1. `src/model/__tests__/` — Jest unit tests. Run with `npm test`. Zero VS Code
   dependency. Run in CI without a display.
2. `src/test/` — VS Code integration tests. Run with `npm run test:integration`.
   Require a display (or `Xvfb` in CI).

### 4.2 Test fixtures

**File:** `src/model/__tests__/fixtures/builders.ts`

A library of `MemUCIS` builder functions. Every test that needs a `MemUCIS`
uses these — no inline construction in test files.

```typescript
// Build a minimal MemUCIS with a single covergroup and coverpoint
export function buildSimpleCovergroup(opts?: {
  name?: string;
  bins?: Array<{ name: string; count: bigint; atLeast: bigint }>;
}): MemUCIS

// Build a MemUCIS with nested instance → module → covergroup hierarchy
export function buildInstanceHierarchy(depth?: number): MemUCIS

// Build a MemUCIS with toggle signals (TOGGLE scopes with 0→1 / 1→0 bins)
export function buildToggleData(opts?: {
  files?: Array<{ path: string; lines: number[] }>;
}): MemUCIS

// Build a MemUCIS with source info (for CoverageSourceModel tests)
export function buildSourceCoverage(opts: {
  files: Array<{
    path: string;
    stmtBins: Array<{ line: number; count: bigint }>;
    branchBins?: Array<{ line: number; label: string; count: bigint }>;
  }>;
}): MemUCIS

// Build a MemUCIS with zero coverage (all bins at 0 of their atLeast)
export function buildZeroCoverageDb(): MemUCIS

// Build a MemUCIS with full coverage (all bins covered)
export function buildFullCoverageDb(): MemUCIS

// Build a MemUCIS with IGNOREBIN and ILLEGALBIN for filter tests
export function buildDbWithSpecialBins(): MemUCIS

// Build a MemUCIS with cross coverage
export function buildCrossDb(): MemUCIS

// Build a MemUCIS with FSM coverage
export function buildFsmDb(): MemUCIS
```

**File:** `src/model/__tests__/fixtures/testplans.ts`

```typescript
// Minimal valid testplan YAML string
export const MINIMAL_TESTPLAN_YAML: string

// Testplan with nested goals (3 levels deep)
export const NESTED_GOALS_YAML: string

// Testplan with all testpoint fields populated
export const FULL_TESTPOINT_YAML: string

// Testplan with imports (two files; loader function included)
export function buildImportedTestplans(): {
  mainYaml: string;
  importedYaml: string;
  mockLoader: (path: string) => Promise<string>;
}

// Testplan with circular import (for error case tests)
export function buildCircularImportTestplans(): {
  yaml: string;
  mockLoader: (path: string) => Promise<string>;
}

// Invalid testplan (missing required fields)
export const INVALID_TESTPLAN_YAML: string

// Pre-built .cdb bytes (generated from buildSimpleCovergroup())
// Used to inject into NcdbManager tests without touching the filesystem
export async function buildCdbBytes(ucis?: MemUCIS): Promise<Uint8Array>
```

---

### 4.3 Unit tests: `NcdbManager`

**File:** `src/model/__tests__/NcdbManager.test.ts`

```
openDatabase
  ✓ calls ByteLoader with the given path
  ✓ returns populated MemUCIS
  ✓ isOpen returns true after open
  ✓ getOpenDatabases includes the path
  ✓ loader error → openDatabase rejects with descriptive message
  ✓ opening same path twice → reloads (refreshes) the database

setActiveDatabase / getActiveDatabase
  ✓ setActiveDatabase after open → getActiveDatabase returns that MemUCIS
  ✓ setActiveDatabase with null → getActiveDatabase returns null
  ✓ setActiveDatabase with unknown path → throws or ignores (document behaviour)
  ✓ onActiveDatabaseChanged fires when active changes
  ✓ onActiveDatabaseChanged fires with null when active closed

closeDatabase
  ✓ isOpen returns false after close
  ✓ getOpenDatabases excludes closed path
  ✓ onDatabaseClosed fires
  ✓ closing active database sets active to null; onActiveDatabaseChanged fires
  ✓ closing non-open path → no error (idempotent)

closeAll
  ✓ all databases closed; getOpenDatabases returns []
  ✓ onDatabaseClosed fires for each

refreshDatabase
  ✓ calls ByteLoader again for the path
  ✓ MemUCIS in getActiveDatabase is updated
  ✓ refresh non-open path → no-op (or throws — document behaviour)
```

---

### 4.4 Unit tests: `CoverageStats`

**File:** `src/model/__tests__/CoverageStats.test.ts`

Coverage requirements: **100%** of all exported functions.

Test scenarios:

```
computeScopeStats
  ✓ single covered bin (count >= atLeast) → percentage 100
  ✓ single uncovered bin → percentage 0
  ✓ mixed bins (3 covered, 1 uncovered) → percentage 75
  ✓ IGNOREBIN excluded when excludeIgnoredBins=true
  ✓ IGNOREBIN included when excludeIgnoredBins=false
  ✓ ILLEGALBIN excluded when excludeIllegalBins=true
  ✓ total=0 after filtering → percentage 100
  ✓ atLeast=0n → bin always covered regardless of count
  ✓ count=0n, atLeast=1n → bin not covered
  ✓ coverageGoal applied to isMet

computeAggregateStats
  ✓ leaf scope with no children → same as computeScopeStats
  ✓ scope with child scopes → aggregates all bins
  ✓ deeply nested (5+ levels)
  ✓ empty ucis (no scopes) → 0/0 → percentage 100
  ✓ only ignored bins → 0/0 → percentage 100
  ✓ cross coverage → bins counted from CoverItem children

computeStatsByType
  ✓ single covergroup type present
  ✓ multiple types → map has entry per type
  ✓ empty DB → empty map
  ✓ toggles counted separately from branches

getUncoveredHotspots
  ✓ returns at most `limit` results
  ✓ sorted by hitCount ascending (0 first)
  ✓ only includes bins where count < atLeast
  ✓ includes correct scopePath (dot-joined from root)
  ✓ empty DB → empty array
  ✓ all covered → empty array

scopePassesFilter
  ✓ 'all' → all scopes pass
  ✓ 'covered' → only scopes with 100% coverage pass
  ✓ 'uncovered' → only scopes < 100% pass
  ✓ scope with no bins → passes 'all' and 'covered' (0/0 = 100%)
```

---

### 4.5 Unit tests: `CoverageTreeModel`

**File:** `src/model/__tests__/CoverageTreeModel.test.ts`

```
getRoots
  ✓ returns one node per top-level scope in MemUCIS
  ✓ filter='covered' → excludes uncovered root scopes
  ✓ filter='uncovered' → excludes covered root scopes
  ✓ empty MemUCIS → empty array
  ✓ nodes carry correct stats from CoverageStats

getChildren
  ✓ returns child scopes as nodes
  ✓ leaf scopes (no children) → empty array
  ✓ filter applied to children
  ✓ CoverItems (bins) are not children (scopes only)

getScopePath
  ✓ root-level scope → "scopeName"
  ✓ nested scope → "grandparent.parent.child"
  ✓ UCIS root is not included in path

getNodeDescription
  ✓ 100% covered → "100%"
  ✓ partial coverage → correct percentage string
  ✓ 0/0 → "100%"

getIconForScopeType
  ✓ each ScopeTypeT value maps to a valid ThemeIcon id (string)
  ✓ INSTANCE → 'package'
  ✓ COVERGROUP / COVERINSTANCE → 'graph'
  ✓ COVERPOINT → 'graph-line'
  ✓ TOGGLE → 'symbol-boolean'
  ✓ BRANCH → 'git-branch'
  ✓ FSM → 'symbol-enum'
  ✓ unknown type → 'circle' fallback

nodeId stability
  ✓ same scope always produces same nodeId
  ✓ different scopes produce different nodeIds
```

---

### 4.6 Unit tests: `CoverageSourceModel`

**File:** `src/model/__tests__/CoverageSourceModel.test.ts`

```
buildFileCoverages
  ✓ scope with STMTBIN and sourceInfo → produces LineCoverageData
  ✓ scope with BRANCHBIN → added to branches of the line
  ✓ scope without sourceInfo → not included
  ✓ multiple bins on same line → hitCount = max of all
  ✓ branch bins on same line as statement → merged into same LineCoverageData
  ✓ toggle bins not included in statement coverage
  ✓ path mapping applied to dbPath
  ✓ path without mapping → passthrough
  ✓ two scopes referencing same file → merged into one FileCoverageData
  ✓ empty MemUCIS → empty array

buildToggleCoverages
  ✓ toggle scope with 0→1 and 1→0 bins → ToggleCoverageData entry
  ✓ hit counts preserved correctly
  ✓ toggle scope with missing one direction → still produces entry
  ✓ non-toggle scopes not included
  ✓ path mapping applied
```

---

### 4.7 Unit tests: `PathMapper`

**File:** `src/model/__tests__/PathMapper.test.ts`

```
  ✓ exact prefix match → replaced
  ✓ longer prefix wins over shorter prefix (longest-prefix)
  ✓ no match → passthrough in mapOrPassthrough
  ✓ no match → null in map
  ✓ empty mappings → always passthrough
  ✓ trailing slash handling (with and without)
  ✓ updateMappings → new config takes effect immediately
  ✓ fromConfig static factory
```

---

### 4.8 Unit tests: `TestplanModel`

**File:** `src/model/__tests__/TestplanModel.test.ts`

```
parseTestplan — valid inputs
  ✓ minimal YAML with one testpoint → ok=true
  ✓ full YAML with all fields → all fields parsed correctly
  ✓ JSON input also accepted
  ✓ goals array → Goal objects with children
  ✓ nested goals (3 levels) → correctly nested Goal tree
  ✓ testpoint with all coverage binding types
  ✓ status enum values: planned, in_progress, complete, waived
  ✓ priority enum values: high, medium, low
  ✓ missing optional fields → undefined (not null)
  ✓ custom dict preserved as-is

parseTestplan — invalid inputs
  ✓ empty string → ok=false, errors contain message
  ✓ invalid YAML syntax → ok=false
  ✓ testpoint missing name → ok=false with path
  ✓ invalid status value → ok=false with path
  ✓ invalid coverage type → ok=false with path
  ✓ coverage missing path → ok=false
  ✓ not an object at root → ok=false

resolveImports
  ✓ plan with no imports → same plan returned
  ✓ plan with one import → imported testpoints merged
  ✓ plan with two imports → both merged
  ✓ imported goals merged into plan goals
  ✓ circular import detected → ok=false with error
  ✓ maxDepth exceeded → ok=false with error
  ✓ loader throws → ok=false with error message
  ✓ import path resolved relative to plan filePath

flattenTestpoints
  ✓ top-level testpoints returned
  ✓ testpoints in goals returned
  ✓ testpoints in nested goals (3 levels) returned
  ✓ no duplicates when testpoint appears in both goals and testpoints list

computeGoalStatus
  ✓ all sub-testpoints complete → complete
  ✓ any waived, rest complete → complete
  ✓ any in_progress → in_progress
  ✓ all planned → planned
  ✓ mix of planned and complete → in_progress
  ✓ empty goal (no testpoints, no sub-goals) → planned
  ✓ sub-goals affect parent status (recursive)
```

---

### 4.9 Unit tests: `TestplanLinkage`

**File:** `src/model/__tests__/TestplanLinkage.test.ts`

```
buildScopeIndex
  ✓ top-level scope included
  ✓ nested scope path joined with dots
  ✓ MemUCIS root not included as a path entry
  ✓ scope with same name at different levels → different keys

resolveBindingPath
  ✓ exact path matches one scope
  ✓ path not in index → empty array
  ✓ glob * matches single segment: "a.*.c" matches "a.b.c", not "a.b.d.c"
  ✓ glob at end: "uart.*" matches all direct children of uart scope
  ✓ glob in middle matches correctly
  ✓ multiple scopes match glob → all returned

computeTestpointCoverages
  ✓ testpoint with one binding that resolves → stats populated
  ✓ testpoint with binding that doesn't resolve → stats empty (0/0)
  ✓ multiple bindings → aggregated
  ✓ testpoint with empty coverage[] → aggregateStats is 0/0 → percentage 100
  ✓ testpoint with two bindings, one covered, one not → aggregate < 100%

findUnboundScopes
  ✓ scope with no matching testplan binding → included
  ✓ scope covered by binding → excluded
  ✓ glob binding covers multiple scopes → all excluded
  ✓ empty plan → all scopes returned
  ✓ empty ucis → empty array
```

---

### 4.10 Unit tests: `TestplanTreeModel`

**File:** `src/model/__tests__/TestplanTreeModel.test.ts`

```
getRoots — no database loaded
  ✓ plan with top-level goals → one node per goal
  ✓ plan with top-level testpoints → one node per testpoint
  ✓ mixed goals and testpoints
  ✓ stats are null when no coverages provided

getRoots — with database loaded
  ✓ stats populated from TestpointCoverage[]
  ✓ correct stats per testpoint

getChildren
  ✓ goal node → returns sub-goals and testpoints as children
  ✓ testpoint node → always empty (leaf)
  ✓ plan node → returns goals and testpoints

getIconForStatus
  ✓ complete → 'pass' or 'check' icon
  ✓ in_progress → 'circle-filled' (partial)
  ✓ planned → 'circle-outline'
  ✓ waived → 'circle-slash'

getNodeDescription
  ✓ testpoint with stats → percentage string
  ✓ testpoint without stats → status string
  ✓ goal node → aggregate status
```

---

### 4.11 Unit tests: HTML generators

**File:** `src/model/__tests__/html.test.ts`

```
renderSummaryBar
  ✓ 100% → green bar, shows "100%"
  ✓ 0% → red bar, shows "0%"
  ✓ partial → correct width percentage in style attribute
  ✓ goal threshold affects coloring

renderByTypeTable
  ✓ empty map → empty table or "No data" message
  ✓ single type → one row
  ✓ multiple types → multiple rows, sorted consistently
  ✓ each row shows covered/total/percentage

renderHotspotsTable
  ✓ empty list → empty state message
  ✓ items rendered with scopePath, binName, hitCount, atLeast
  ✓ correct number of rows

renderTestplanClosure
  ✓ testpoints by status counts correct
  ✓ goal rows with correct percentages
  ✓ empty plan → empty state message

renderHistorySection
  ✓ renders with history nodes
  ✓ empty → not rendered / empty state
```

---

### 4.12 Integration tests

**File:** `src/test/suite/extension.test.ts`

These run inside a VS Code extension host (`@vscode/test-electron`). They test
full activation and basic command invocation. Keep them minimal — integration
tests are expensive and the model tests provide the bulk of coverage.

```
Extension activation
  ✓ activates when workspace contains *.cdb file
  ✓ registers all covsight.* commands
  ✓ registers covsight.databases, covsight.coverage, covsight.testplan views

Command registration
  ✓ covsight.openDatabase command is registered
  ✓ covsight.showDashboard command is registered
  ✓ covsight.openTestplan command is registered

Tree views
  ✓ databases view shows "No coverage databases found" welcome content
    initially
  ✓ opening a real .cdb file causes it to appear in the databases view

CoveragePublisher
  ✓ loading a .cdb file triggers coverage data published to TestController
  ✓ Test Coverage panel receives at least one FileCoverage entry
```

**Test fixtures for integration tests:**
`src/test/fixtures/` contains a small, real `.cdb` file generated by
`covsight-core`'s test suite. This file is committed to the repo and used
as a known-good test artifact.

---

### 4.13 Test runner configuration

```json5
// jest.config.cjs
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/src/model/__tests__/**/*.test.ts', '**/src/views/html/**/*.test.ts'],
  moduleNameMapper: {
    '^@covsight/core(.*)$': '<rootDir>/../covsight-core/ts/dist$1'
  }
}
```

```json5
// package.json scripts
"test":             "jest",
"test:watch":       "jest --watch",
"test:coverage":    "jest --coverage",
"test:integration": "node ./dist/test/runTest.js"
```

Coverage threshold enforced in CI:
```json5
// jest.config.cjs (add)
"coverageThreshold": {
  "global": { "lines": 90, "functions": 90, "branches": 85 }
}
```

---

## 5. Implementation Phases

Each phase ends with a passing build, all tests green, and documentation
updated. No phase introduces broken code.

---

### Phase 0 — `@covsight/core` Browser Compatibility

**Repo:** `covsight-core/ts/`  
**Goal:** Make `@covsight/core` usable from any environment — Node.js, VS Code
extension (bundled), and browser. This is a prerequisite for Phase 1 of
`vscode-covsight`, and benefits every other planned consumer (CLI, TUI, MCP,
future web UI).

#### Background

The current `NcdbReader` and `NcdbWriter` use `import { readFile, writeFile }
from 'node:fs/promises'` as static top-level imports. Any bundler that includes
these modules in a browser build will fail or bloat the bundle with polyfills.
The fix is to separate the pure data-processing logic (browser-safe) from the
Node.js file I/O (Node-only), so that bundlers can tree-shake the I/O layer
entirely when it is not used.

`jszip` already has a `browser` field in its `package.json` that bundlers
(esbuild, webpack, Rollup) honour automatically — no changes needed there.
The one `jszip` code change is `type: 'nodebuffer'` → `type: 'uint8array'` in
the writer, since `nodebuffer` is a Node.js-only output type while `uint8array`
works everywhere and is accepted by `fs.writeFile` on Node.js.

#### API changes

**`NcdbReader`** gains two new browser-safe methods; existing Node.js-path
methods are preserved for backward compatibility:

```typescript
export class NcdbReader {
  // NEW — browser-safe: accepts raw ZIP bytes
  async readFromBytes(data: Uint8Array): Promise<MemUCIS>
  async readIntoFromBytes(data: Uint8Array, db: MemUCIS): Promise<void>

  // KEEP — Node.js convenience (now delegates to readFromBytes)
  async read(path: string): Promise<MemUCIS>
  async readInto(path: string, db: MemUCIS): Promise<void>
}
```

**`NcdbWriter`** gains a browser-safe `toBytes` method:

```typescript
export class NcdbWriter {
  // NEW — browser-safe: returns ZIP as Uint8Array
  async toBytes(db: MemUCIS): Promise<Uint8Array>

  // KEEP — Node.js convenience (now delegates to toBytes)
  async write(path: string, db: MemUCIS): Promise<void>
}
```

**`MemUCIS.read(path)` / `MemUCIS.write(path)`** — these are Node.js-only
convenience wrappers and stay as-is. They are documented as Node.js-only.

#### How the `node:fs` import is isolated

The `readFile` / `writeFile` calls move to dynamic imports inside the
Node.js-path methods:

```typescript
// In NcdbReader.read():
async read(path: string): Promise<MemUCIS> {
  const { readFile } = await import('node:fs/promises');
  return this.readFromBytes(await readFile(path));
}
```

A dynamic import means the static module graph for `ncdbReader.ts` no longer
references `node:fs/promises` at all. Bundlers that never call `read(path)` will
never include the Node.js I/O module.

#### Tasks

| # | Task | Notes |
|---|------|-------|
| 0.1 | Add `readFromBytes` / `readIntoFromBytes` to `NcdbReader` | Core read logic extracted from `readInto`; no `node:fs` import |
| 0.2 | Make `read(path)` / `readInto(path, db)` dynamic-import `node:fs/promises` | Isolates Node.js I/O from static module graph |
| 0.3 | Add `toBytes` to `NcdbWriter` | Core write logic extracted; returns `Uint8Array`; change `generateAsync` type to `'uint8array'` |
| 0.4 | Make `write(path, db)` dynamic-import `node:fs/promises` | Same isolation pattern |
| 0.5 | Update `MemUCIS.read` / `MemUCIS.write` JSDoc | Document as Node.js-only convenience |
| 0.6 | Verify existing `covsight-core` tests pass unchanged | `npm test` in `covsight-core/ts/` |
| 0.7 | Add tests in `covsight-core` for `readFromBytes` / `toBytes` round-trip | `NcdbReader.readFromBytes(await new NcdbWriter().toBytes(db))` produces equivalent MemUCIS |
| 0.8 | Add `"browser"` export condition to `package.json` (optional) | Points to same ESM dist; signals browser support to bundlers |
| 0.9 | Add ESLint `no-restricted-imports` rule to `covsight-core/.eslintrc.cjs` | Blocks any future `import ... from 'vscode'` — covsight-core must never depend on VS Code |

#### Impact on `vscode-covsight`

`NcdbManager.openDatabase()` should use `vscode.workspace.fs.readFile(uri)`
(which returns `Uint8Array`) and call `NcdbReader.readFromBytes()`, rather than
passing a file-system path. This respects VS Code's virtual filesystem
abstraction and avoids the Node.js I/O layer entirely in the extension.

```typescript
// In NcdbManager (src/model/NcdbManager.ts):
// The manager is given a loader function at construction time — no vscode import
type ByteLoader = (path: string) => Promise<Uint8Array>;

class NcdbManager {
  constructor(private loadBytes: ByteLoader) {}
  async openDatabase(path: string): Promise<MemUCIS> {
    const bytes = await this.loadBytes(path);
    return new NcdbReader().readFromBytes(bytes);
  }
}

// In extension.ts (presentation layer):
const manager = new NcdbManager(
  (path) => vscode.workspace.fs.readFile(vscode.Uri.file(path))
    .then(b => new Uint8Array(b))
);
```

This pattern also makes `NcdbManager` unit-testable without touching the
filesystem — tests inject a `ByteLoader` that returns pre-built fixture bytes.

#### Acceptance criteria

- `@covsight/core`: `npm test` exits 0; round-trip test passes
- Static module graph of `ncdbReader.ts` contains no `node:fs` import
  (verify with `node --input-type=module -e "import './dist/ncdb/ncdbReader.js'"` in a
  browser-like environment, or inspect esbuild metafile)
- `vscode-covsight` Phase 1 `jest.config.cjs` `moduleNameMapper` continues to
  work with the updated dist
- ESLint in `covsight-core` reports an error if any source file contains
  `import ... from 'vscode'` — confirmed by adding a temporary import and
  running `npm run lint`

The ESLint rule to add to `covsight-core/ts/.eslintrc.cjs`:

```js
'no-restricted-imports': ['error', {
  patterns: [{
    group: ['vscode'],
    message: '@covsight/core must not depend on VS Code. ' +
             'Put any VS Code-specific code in vscode-covsight.'
  }]
}],
```

---

### Phase 1 — Rename and Reidentify

**Goal:** Complete brand rename; no new features; build passes; esbuild bundler
in place so that the ESM `@covsight/core` dependency works correctly.

**Tasks:**

| # | Task | Notes |
|---|------|-------|
| 1.1 | Update `package.json` identity fields | name, displayName, publisher, description, keywords, repository, icon, engines ≥ 1.88.0 |
| 1.2 | Copy brand icon | `../covsight.github.io/icons/covsight-icon-v2b.png` → `media/covsight-icon.png` |
| 1.3 | Rename all `pyucis.*` command IDs | `extension.ts` + `package.json` |
| 1.4 | Rename all `pyucis.*` view IDs | `package.json`, providers |
| 1.5 | Rename all `pyucis.*` config keys | `package.json`, all config reads |
| 1.6 | Update activation events | Remove `onLanguage:*`, `onCustomEditor:pyucis.*`; add testplan patterns |
| 1.7 | Remove custom editor registration | `package.json` contributes.customEditors; delete `database-editor-provider.ts` |
| 1.8 | Add `.testplan` language association | `package.json` contributes.languages |
| 1.9 | Replace `tsc` build with esbuild | See esbuild config below; update `vscode:prepublish` and `compile` scripts |
| 1.10 | Update `tsconfig.json` | `module: NodeNext`, `moduleResolution: NodeNext`; used for type-checking only |
| 1.11 | Verify `npm run compile` passes | Fix any type errors arising from tsconfig change |
| 1.12 | Install Jest + ts-jest | Dev deps; add `jest.config.cjs`; add npm scripts |
| 1.13 | Verify `npm test` passes | Zero tests initially; confirm framework works |

**esbuild configuration:**

```javascript
// esbuild.js (added to repo root)
const esbuild = require('esbuild');
const production = process.argv.includes('--production');

esbuild.build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],      // injected by the VS Code host; never bundle
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: !production,
  minify: production,
  // esbuild resolves @covsight/core's ESM automatically — no extra config needed
}).catch(() => process.exit(1));
```

```json5
// package.json scripts (updated)
"vscode:prepublish": "node esbuild.js --production",
"compile":           "node esbuild.js",
"watch":             "node esbuild.js --watch",
```

The `tsc` invocation moves to a type-check-only script:
```json5
"type-check": "tsc --noEmit"
```

ESLint continues to use `tsconfig.json` for type-aware rules.

**Jest `moduleNameMapper`** handles the ESM-to-CJS resolution for tests:
```json5
"^@covsight/core(.*)$": "<rootDir>/../covsight-core/ts/dist$1/index.js"
```

**Acceptance criteria:**
- `npm run compile` exits 0 (esbuild bundles cleanly)
- `npm test` exits 0 (no test failures; 0 tests is OK at this stage)
- `npm run type-check` exits 0
- Extension loads in VS Code without errors (manual check)
- All `pyucis` identifiers gone from source (verify with `grep -r pyucis src/`)

---

### Phase 2 — Model Layer Foundation

**Goal:** Write and fully test the model layer. No presentation changes yet —
the old providers still work with the old SQL backend (or are temporarily
stubbed out).

**Tasks:**

| # | Task | Notes |
|---|------|-------|
| 2.1 | Add `@covsight/core` dependency | `file:../covsight-core/ts`; run `npm install` |
| 2.2 | Verify `@covsight/core` dist is built | `cd ../covsight-core/ts && npm run build` |
| 2.3 | Create `src/model/` directory | |
| 2.4 | Write `src/model/SimpleEvent.ts` | Typed event emitter, no vscode |
| 2.5 | Write `src/model/PathMapper.ts` | Port from `src/decorations/path-mapper.ts` |
| 2.6 | Write `src/model/CoverageStats.ts` | |
| 2.7 | Write `src/model/CoverageTreeModel.ts` | |
| 2.8 | Write `src/model/CoverageSourceModel.ts` | |
| 2.9 | Write `src/model/NcdbManager.ts` | Uses `NcdbReader.readFromBytes()`; accepts `ByteLoader` injected at construction — no vscode import, fully testable |
| 2.10 | Write `src/model/TestplanModel.ts` | Add `js-yaml` dev + runtime dep |
| 2.11 | Write `src/model/TestplanLinkage.ts` | |
| 2.12 | Write `src/model/TestplanTreeModel.ts` | |
| 2.13 | Write `src/model/index.ts` | Re-exports all model types |
| 2.14 | Write test fixture builders | `src/model/__tests__/fixtures/builders.ts` |
| 2.15 | Write test fixture testplans | `src/model/__tests__/fixtures/testplans.ts` |
| 2.16 | Write all unit tests (§4.3–§4.10) | All 120+ test cases |
| 2.17 | Add ESLint rule `no-restricted-imports` for vscode in `src/model/` | Enforces layer boundary |
| 2.18 | `npm run compile` and `npm test` pass | 90%+ line coverage on model layer |

**Note on HTML generators:**
Write the HTML generator functions (`src/views/html/*.ts`) in this phase
alongside their tests. They import only model types and produce HTML strings.

**Acceptance criteria:**
- `npm test` exits 0 with 90%+ line coverage on `src/model/`
- No `import * from 'vscode'` anywhere in `src/model/`
- `npm run compile` exits 0

---

### Phase 3 — Replace SQLite Backend with NCDB

**Goal:** Wire the model layer into providers; delete `src/db/`.

**Tasks:**

| # | Task | Notes |
|---|------|-------|
| 3.1 | Rewrite `src/providers/database-manager.ts` | Constructs `NcdbManager` with `ByteLoader` using `vscode.workspace.fs.readFile`; wraps `SimpleEvent` in `vscode.EventEmitter` |
| 3.2 | Rewrite `src/providers/coverage-tree-provider.ts` | Delegates to `CoverageTreeModel`; implements `vscode.TreeDataProvider<CoverageNode>` |
| 3.3 | Rewrite `src/providers/database-list-provider.ts` | Updated for new database events |
| 3.4 | Rewrite `src/views/coverage-dashboard.ts` | Uses HTML generators; triggers `computeStatsByType`, `getUncoveredHotspots` |
| 3.5 | Rewrite `src/views/coverage-detail-panel.ts` | Uses HTML generator for scope/bin detail |
| 3.6 | Write `src/providers/coverage-publisher.ts` | VS Code `TestController` wrapper |
| 3.7 | Rewrite `src/decorations/coverage-decoration-provider.ts` | Becomes `ToggleDecorationProvider`; consumes `ToggleCoverageData` from `CoverageSourceModel` |
| 3.8 | Remove `sql.js` dependency | `npm uninstall sql.js @types/sql.js` |
| 3.9 | Delete `src/db/` | Remove `database.ts`, `queries.ts`, `schema.ts` |
| 3.10 | Rewrite `src/extension.ts` | Wire all new providers; connect `NcdbManager` events |
| 3.11 | Add integration test fixture `.cdb` file | Generate via `covsight-core` test utilities |
| 3.12 | Write integration tests (§4.11) | |
| 3.13 | End-to-end manual verification | Open real `.cdb`; confirm tree, dashboard, decorations work |

**Acceptance criteria:**
- `npm run compile` exits 0
- `npm test` exits 0 (unit tests still pass)
- `npm run test:integration` exits 0
- Loading a `.cdb` file in VS Code shows coverage hierarchy, dashboard, and
  inline coverage via the Testing panel
- `src/db/` does not exist

---

### Phase 4 — Testplan Support

**Goal:** Add the testplan tree view, YAML schema, and coverage linkage.

**Tasks:**

| # | Task | Notes |
|---|------|-------|
| 4.1 | Author `schemas/covsight-testplan.schema.json` | Derived from `covsight-core/docs/testplan-schema.md`; all fields with descriptions |
| 4.2 | Add `yamlValidation` contribution to `package.json` | Patterns: `*.testplan`, `*testplan*.yaml`, `*testplan*.yml` |
| 4.3 | Register `.testplan` extension as YAML for syntax highlighting | Already done in Phase 1 |
| 4.4 | Write `src/providers/testplan-discovery.ts` | Workspace scan; `FileSystemWatcher` |
| 4.5 | Write `src/providers/testplan-tree-provider.ts` | Wraps `TestplanTreeModel` |
| 4.6 | Write `src/views/testplan-panel.ts` | Testpoint detail webview |
| 4.7 | Write `src/views/html/testplan-detail.ts` | HTML generator for testplan panel |
| 4.8 | Add testplan commands to `extension.ts` | `openTestplan`, `closeTestplan`, `rescanTestplans`, `showUnboundCoverage` |
| 4.9 | Register `covsight.testplan` view in `package.json` | Explorer panel |
| 4.10 | Implement coverage↔testplan linkage | Annotate coverage tree nodes with "Bound to: X" tooltip |
| 4.11 | Add testplan closure to dashboard | `renderTestplanClosure` HTML section |
| 4.12 | Add soft-dependency notice for `redhat.vscode-yaml` | Show once when testplan file opens and YAML ext absent |
| 4.13 | Write integration tests for testplan tree | Load testplan YAML; verify tree nodes |

**Acceptance criteria:**
- `npm run compile` exits 0
- `npm test` exits 0
- Opening a `.testplan` file shows goal/testpoint tree in Explorer panel
- With a `.cdb` also open, testpoints show coverage percentages
- `yamlValidation` triggers IntelliSense in testplan files (manual check with YAML ext)
- `showUnboundCoverage` command produces correct list

---

### Phase 5 — Polish

**Goal:** Dashboard enhancements, file icons, walkthrough, README.

| # | Task | Notes |
|---|------|-------|
| 5.1 | Dashboard: issues panel | When NCDB `issues.bin` present |
| 5.2 | Dashboard: test history section | When NCDB `history.json` present |
| 5.3 | File icon: `.cdb` | Add media icon for NCDB files in Explorer |
| 5.4 | VS Code Walkthrough | "Getting Started" with CovSight — open a .cdb, view coverage, open testplan |
| 5.5 | README rewrite | Brand-aligned, with screenshots; remove all pyucis references |
| 5.6 | CHANGELOG.md | Document v0.2.0 changes |
| 5.7 | Programmatic YAML API | `registerContributor` for dynamic path autocomplete (optional, low priority) |

---

## 6. Documentation Plan

### 6.1 In-code documentation

**Rule:** Every exported function, class, and interface in `src/model/` has a
JSDoc comment that explains:
- What the function computes
- Any non-obvious edge cases (e.g., `total=0 → percentage=100`)
- What the parameters represent

The threshold is "a developer unfamiliar with UCIS can understand this without
reading `covsight-core` source." Presentation-layer classes need only brief
comments (they're thin wrappers).

**Format:**
```typescript
/**
 * Compute aggregate coverage statistics for a scope and all its descendants.
 *
 * Bins are counted recursively via depth-first traversal. Filtering options
 * control whether IGNOREBIN and ILLEGALBIN bins are excluded from totals.
 *
 * Edge cases:
 * - If total bins = 0 after filtering, percentage = 100 and isMet = true.
 * - If atLeast = 0 on a bin, that bin is counted as covered regardless of count.
 */
export function computeAggregateStats(scope: Scope, opts: FilterOptions): ScopeStats
```

### 6.2 `README.md`

Full rewrite in Phase 5. Sections:

1. **What is CovSight?** — 2-sentence ecosystem intro; link to covsight.github.io
2. **Features** — bulleted list (coverage hierarchy, inline annotation, testplan,
   dashboard, YAML validation)
3. **Requirements** — VS Code ≥ 1.88; recommended: YAML extension by Red Hat
4. **Getting Started** — 3-step quick start (open .cdb, view tree, open testplan)
5. **Coverage Hierarchy** — how to read the tree; icon legend; filter commands
6. **Source Annotations** — how inline coverage works; toggle coverage
7. **Testplan** — what a testplan file looks like; how to bind coverage; linkage
8. **Dashboard** — what's in each section
9. **Configuration** — table of all `covsight.*` settings
10. **Path Mappings** — how to configure when DB paths differ from workspace paths
11. **Recommended Extensions** — `redhat.vscode-yaml`
12. **Known Limitations** — single active database; no merge view yet

Include a screenshot in §4 and §5 (placeholders until Extension is functional).

### 6.3 `CHANGELOG.md`

Follows Keep a Changelog format. The first entry is `v0.2.0` (the complete
rewrite), with a note that v0.1.0 was an internal prototype never published.

### 6.4 JSON Schema documentation

`schemas/covsight-testplan.schema.json` is self-documenting via `description`
fields on every property. These descriptions appear as hover text in VS Code
when the YAML extension is installed. Invest effort here — this is the primary
testplan authoring UX.

Required descriptions:
- Every top-level property
- Every property in `goals[]`
- Every property in `testpoints[]`
- Every value in `coverage[].type` enum (explain what each type covers)
- Every value in `status` enum
- The `$schema` property (points to schema docs URL)

### 6.5 `DESIGN.md` updates

After each phase is complete, update the relevant sections of `DESIGN.md` to
reflect any decisions made during implementation that differ from the original
design. `DESIGN.md` is a living document, not a historical artifact.

---

## 7. ESLint Configuration

Add these rules to enforce architecture boundaries and quality:

```json5
// .eslintrc.json (new rules)
{
  "overrides": [
    {
      // Enforce: model layer must not import vscode
      "files": ["src/model/**/*.ts"],
      "rules": {
        "no-restricted-imports": ["error", {
          "patterns": ["vscode"]
        }]
      }
    },
    {
      // Presentation layer: must not import from src/db (deleted)
      "files": ["src/providers/**/*.ts", "src/views/**/*.ts", "src/decorations/**/*.ts"],
      "rules": {
        "no-restricted-imports": ["error", {
          "patterns": ["../db/*", "./db/*"]
        }]
      }
    }
  ]
}
```

---

## 8. CI / Build Verification

For each phase merge, CI must pass:

```
npm run lint
npm run compile
npm test --coverage
```

Coverage gate: 90% lines, 90% functions, 85% branches on `src/model/**`.

Integration tests (`npm run test:integration`) run in CI using GitHub Actions
with `Xvfb` for display. Use the `@vscode/test-electron` `runTests()` setup
already present.

---

## 9. File Layout After All Phases

```
vscode-covsight/
├── media/
│   └── covsight-icon.png
├── schemas/
│   └── covsight-testplan.schema.json
├── src/
│   ├── model/
│   │   ├── __tests__/
│   │   │   ├── fixtures/
│   │   │   │   ├── builders.ts
│   │   │   │   └── testplans.ts
│   │   │   ├── CoverageStats.test.ts
│   │   │   ├── CoverageTreeModel.test.ts
│   │   │   ├── CoverageSourceModel.test.ts
│   │   │   ├── PathMapper.test.ts
│   │   │   ├── TestplanModel.test.ts
│   │   │   ├── TestplanLinkage.test.ts
│   │   │   ├── TestplanTreeModel.test.ts
│   │   │   └── html.test.ts
│   │   ├── CoverageStats.ts
│   │   ├── CoverageTreeModel.ts
│   │   ├── CoverageSourceModel.ts
│   │   ├── PathMapper.ts
│   │   ├── SimpleEvent.ts
│   │   ├── NcdbManager.ts
│   │   ├── TestplanModel.ts
│   │   ├── TestplanLinkage.ts
│   │   ├── TestplanTreeModel.ts
│   │   └── index.ts
│   ├── providers/
│   │   ├── database-manager.ts
│   │   ├── database-discovery.ts
│   │   ├── database-list-provider.ts
│   │   ├── coverage-tree-provider.ts
│   │   ├── coverage-publisher.ts
│   │   ├── testplan-discovery.ts
│   │   └── testplan-tree-provider.ts
│   ├── views/
│   │   ├── html/
│   │   │   ├── summary-bar.ts
│   │   │   ├── by-type-table.ts
│   │   │   ├── hotspots-table.ts
│   │   │   ├── testplan-closure.ts
│   │   │   ├── history-section.ts
│   │   │   └── testplan-detail.ts
│   │   ├── coverage-dashboard.ts
│   │   ├── coverage-detail-panel.ts
│   │   ├── testplan-panel.ts
│   │   └── webview-base.ts
│   ├── decorations/
│   │   ├── toggle-decoration-provider.ts
│   │   └── path-mapper.ts          ← shim that re-exports from model/PathMapper
│   └── extension.ts
├── src/test/
│   ├── fixtures/
│   │   └── sample.cdb              ← generated test fixture
│   └── suite/
│       └── extension.test.ts
├── CHANGELOG.md
├── DESIGN.md
├── esbuild.js
├── IMPLEMENTATION_PLAN.md
├── README.md
├── jest.config.cjs
├── package.json
└── tsconfig.json
```

---

## 10. Resolved Decisions

1. **`@covsight/core` module format** — Pure ESM is correct and stays. Browser
   compatibility is achieved by abstracting file I/O behind `readFromBytes` /
   `toBytes` (Phase 0). The VS Code extension uses esbuild to bundle ESM into a
   CJS output (Phase 1). No change to `"type": "module"` or the `exports` map.

2. **`NcdbManager` I/O abstraction** — `ByteLoader` injection pattern (Phase 0
   / Phase 2) means `NcdbManager` has zero Node.js or vscode dependency and is
   fully unit-testable.

## 11. Open Decisions to Confirm Before Phase 3

1. **Activity bar vs Explorer panel**: Three views in Explorer panel for now
   (Phase 3/4). Revisit dedicated activity bar icon in Phase 5 based on user
   feedback.

2. **`TestController` refresh**: When active database changes, explicitly call
   `run.end()` on the previous run before creating a new one to avoid stale
   coverage data showing in the Testing panel.
