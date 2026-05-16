# vscode-covsight — Extension Design

## Status

This document describes the forward design for the CovSight VS Code extension.
It supersedes all prior `pyucis-coverage-explorer` framing. The extension has
not been published or used by anyone, so no backward compatibility is needed.

---

## 1. Overview and Positioning

`vscode-covsight` is the VS Code interface to the CovSight coverage intelligence
platform. It gives hardware verification engineers the ability to:

- Browse functional and code coverage data directly in their editor, with no
  need to open a proprietary EDA GUI.
- Annotate source files with per-line and per-signal coverage status.
- Work with a structured, version-controlled testplan in YAML and track
  per-testpoint coverage closure.
- Understand test contribution and identify uncovered gaps without leaving the
  development workflow.

The extension is one of several CovSight interfaces (CLI, TUI, MCP, Python API).
It is the "IDE face" of the ecosystem and should feel like a peer to GitLens or
the Python extension — a first-class, polished tool that happens to serve a
specialized domain.

---

## 2. Package Identity

All identity fields change from `pyucis`/`fvutils` to the `covsight` brand.

| Field | Old value | New value |
|---|---|---|
| `name` | `pyucis-coverage-explorer` | `vscode-covsight` |
| `displayName` | `PyUCIS Coverage Explorer` | `CovSight – Coverage Analysis` |
| `description` | `Navigate and understand functional and code coverage data stored in pyucis SQLite databases` | `Coverage analysis and visualization for functional verification workflows` |
| `publisher` | `fvutils` | `covsight` |
| `keywords` | `coverage`, `ucis`, `verification`, … | `coverage`, `functional coverage`, `ucis`, `verification`, `SystemVerilog`, `covsight` |
| `repository.url` | github.com/fvutils/… | github.com/covsight/vscode-covsight |
| Command prefix | `pyucis.*` | `covsight.*` |
| View IDs | `pyucis.*` | `covsight.*` |
| Config section | `pyucis.*` | `covsight.*` |

### Icon

Replace the default VSCode icon with the CovSight brand mark available at
`../covsight.github.io/icons/covsight-icon-v2b.png` (128×128 PNG).
Add this file to the repo as `media/covsight-icon.png` and reference it as
`"icon": "media/covsight-icon.png"` in `package.json`.

---

## 3. Data Backend: SQLite → NCDB

### Why

The canonical CovSight format is **NCDB** — a ZIP archive containing binary
encoded members (`scope_tree.bin`, `counts.bin`, `strings.bin`, etc.).
SQLite was the original pyucis internal format and is being deprecated.

NCDB advantages over SQLite:
- 60–73× smaller than equivalent SQLite or XML databases
- LEB128/varint encoding; toggle-pair compression
- ZIP portable — inspectable with any ZIP tool, diffable in CI
- Embeds testplan, waivers, issues, test history in one container
- Already implemented in TypeScript in `covsight-core/ts/`

### Dependency

The extension will depend on `@covsight/core` (the TypeScript package at
`covsight-core/ts/`). The current `packages/covsight-core` symlink/copy
already exists in the workspace — this should be formalised as either:

1. A local path dependency in `package.json`:
   `"@covsight/core": "file:../covsight-core/ts"` (development mode), or
2. A published npm package reference once `@covsight/core` is released.

The `sql.js` npm dependency is removed entirely.

### File type

The `.cdb` extension is **retained** — it is the NCDB container extension.
The custom editor registration and file watcher patterns stay on `*.cdb`.
What changes is the reader: from `sql.js` + `UcisDatabase` / `UcisQueries`
to `NcdbReader` from `@covsight/core`.

---

## 4. Source Layout (Proposed)

```
src/
├── extension.ts              # activation; wires providers/commands
├── ncdb/
│   └── NcdbManager.ts        # wraps NcdbReader; manages open databases
├── providers/
│   ├── database-discovery.ts # workspace scan + FileSystemWatcher (*.cdb)
│   ├── database-list-provider.ts  # databases tree view data provider
│   ├── coverage-tree-provider.ts  # UCIS scope/bin hierarchy tree
│   ├── testplan-discovery.ts      # NEW: scan for testplan files
│   └── testplan-tree-provider.ts  # NEW: goal/testpoint tree
├── views/
│   ├── coverage-dashboard.ts      # summary webview (rewritten for NCDB)
│   ├── coverage-detail-panel.ts   # scope/bin detail webview
│   ├── testplan-panel.ts          # NEW: testplan detail webview
│   └── webview-base.ts
└── decorations/
    ├── coverage-decoration-provider.ts  # source gutter (updated for UCIS API)
    └── path-mapper.ts
```

The old `src/db/` directory (`database.ts`, `queries.ts`, `schema.ts`) is
deleted. All database access goes through `NcdbManager` which wraps
`NcdbReader` / `MemUCIS` from `@covsight/core`.

---

## 5. NcdbManager

`NcdbManager` replaces `DatabaseManager` + `UcisDatabase` + `UcisQueries`.

```typescript
import { NcdbReader } from '@covsight/core/ncdb';
import type { MemUCIS } from '@covsight/core/mem';

class NcdbManager {
  private openDbs   = new Map<string, MemUCIS>();
  private activeDb: string | null = null;

  async openDatabase(path: string): Promise<MemUCIS>
  closeDatabase(path: string): void
  closeAll(): void
  async refreshDatabase(path: string): Promise<void>
  setActiveDatabase(path: string | null): void
  getActiveDatabase(): MemUCIS | null
  getActiveDatabasePath(): string | null
  getOpenDatabases(): string[]
  isOpen(path: string): boolean

  readonly onActiveDatabaseChanged: vscode.Event<string | null>
}
```

Key difference from the old manager: the loaded object is a `MemUCIS` (the
full in-memory object model from `@covsight/core`), not a raw SQL connection.
All data access is through the typed UCIS API — no SQL strings anywhere in
the extension.

---

## 6. Coverage Tree View

### Mapping old → new data model

| Old (SQLite schema) | New (`@covsight/core` API) |
|---|---|
| `Scope.scope_id` | `Scope` object identity |
| `Scope.scope_type` (integer enum) | `Scope.type` (`ScopeTypeT` bigint) |
| `Scope.scope_name` | `Scope.name` |
| `Scope.parent_id` | Parent reference on `Scope` object |
| `CoverItem.cover_data` / `.at_least` | `CoverItem.data.data` / `.data.atLeast` |
| `CoverItem.cover_type` | `CoverItem.data.type` (`CoverTypeT`) |
| `UcisQueries.getRootScopes()` | `MemUCIS.scope(i)` iteration |
| `UcisQueries.getChildScopes(id)` | `Scope.numScopes()` / `Scope.scope(i)` |
| `UcisQueries.getCoverItems(id)` | `Scope.numCoverItems()` / `Scope.coverItem(i)` |

### Scope type display

The new `ScopeTypeT` uses bigint bitmask values. Map these to human-readable
labels and VS Code theme icons for the tree view. Relevant types:

| ScopeTypeT | Icon | Label |
|---|---|---|
| `INSTANCE` | `package` | Instance |
| `COVERGROUP` / `COVERINSTANCE` | `graph` | Covergroup |
| `COVERPOINT` | `graph-line` | Coverpoint |
| `CROSS` | `symbol-operator` | Cross |
| `TOGGLE` | `symbol-boolean` | Toggle |
| `BRANCH` | `git-branch` | Branch |
| `EXPR` / `COND` | `symbol-numeric` | Expression |
| `FSM` | `symbol-enum` | FSM |
| `ASSERT` / `COVER` | `shield` | Assertion |

### Coverage percentage

Coverage is computed from `CoverItem` children of a scope:
```
covered   = items where item.data.data >= item.data.atLeast
            (and item.data.type not in {IGNOREBIN, ILLEGALBIN} when filtered)
percentage = covered / total * 100
```

This logic should be a shared utility function, not duplicated in tree vs
dashboard vs detail.

---

## 7. Testplan Support (New Feature)

### Motivation

CovSight's testplan format (YAML/JSON, schema at
`covsight-core/docs/testplan-schema.md`) is a first-class citizen. Users who
have a `.yaml`/`.yml`/`.json`/`.testplan` file following the CovSight testplan
schema should be able to open it in VS Code and see:

- The goal hierarchy as a tree
- Testpoints with their status (planned / in_progress / complete / waived)
- Coverage bindings and their closure status when a `.cdb` is also open
- Navigation from a testpoint to the matching coverage scope in the tree

### Discovery

`TestplanDiscovery` scans for files matching:
- `**/*.testplan`
- `**/testplan.yaml` / `**/testplan.yml`
- Any `.yaml` or `.json` with `$schema: "https://schema.covsight.io/testplan/v1"`
  at the top (lazy detection: check only files named `*testplan*` or
  `*plan*` to avoid reading every YAML in the repo)

### Tree View: `covsight.testplan`

The testplan tree shows:

```
▾ uart (testplan)
  ▾ functional (goal)
    ▾ reset (goal)
      ✓ uart_reset (testpoint — complete, 100%)
    ▾ baud (goal)
      ◎ uart_baud_rate (testpoint — in_progress, 67%)
  ▾ csr (goal)  [from import]
      ○ csr_rw (testpoint — planned)
```

Icon semantics:
- `✓` (check) = complete / all bindings covered
- `◎` (partial) = in_progress / partially covered
- `○` (empty) = planned / no coverage yet
- `⊘` (slash) = waived

Coverage percentage (when a `.cdb` is loaded and bindings resolve) appears as
the tree item description.

### Testpoint detail webview

Clicking a testpoint opens a side panel showing:
- Name, stage, description, owner
- Test list (with wildcard expansion shown)
- Coverage bindings table: path, type, hit/total bins, %
- Requirements links (clickable if URL present)
- `custom` dict (rendered as a collapsible key/value table)

### Coverage ↔ testplan linkage

When a `.cdb` database is open and a testplan with coverage bindings is loaded,
the coverage tree should optionally annotate scopes that are bound to a
testpoint. This can be an icon overlay or a tooltip addition ("Bound to:
uart_baud_rate").

This linkage enables: "show me all coverpoints not bound to any testpoint"
— a useful gap-finding command.

---

## 8. Commands

All command IDs change from `pyucis.*` to `covsight.*`.

### Database commands

| Command ID | Title | Description |
|---|---|---|
| `covsight.openDatabase` | CovSight: Open Coverage Database | File picker for `.cdb` |
| `covsight.activateDatabase` | CovSight: Activate Database | Switch active DB |
| `covsight.closeDatabase` | CovSight: Close Database | Close selected/active DB |
| `covsight.refreshDatabase` | CovSight: Refresh Database | Reload active DB from disk |
| `covsight.rescanWorkspace` | CovSight: Rescan Workspace | Re-discover `.cdb` files |
| `covsight.showDashboard` | CovSight: Show Coverage Dashboard | Open dashboard webview |

### Filtering commands (coverage tree)

| Command ID | Title |
|---|---|
| `covsight.showUncovered` | CovSight: Show Uncovered Items |
| `covsight.showCovered` | CovSight: Show Covered Items |
| `covsight.showAll` | CovSight: Show All Items |
| `covsight.refreshCoverage` | CovSight: Refresh Coverage View |

### Navigation commands

| Command ID | Title |
|---|---|
| `covsight.searchScopes` | CovSight: Search Scopes |
| `covsight.showScopeDetail` | (internal) Show Scope Detail |
| `covsight.showBinDetail` | (internal) Show Bin Detail |

### Source decoration commands

| Command ID | Title |
|---|---|
| `covsight.toggleDecorations` | CovSight: Toggle Source Decorations |
| `covsight.enableDecorations` | CovSight: Enable Source Decorations |
| `covsight.disableDecorations` | CovSight: Disable Source Decorations |

### Testplan commands (new)

| Command ID | Title | Description |
|---|---|---|
| `covsight.openTestplan` | CovSight: Open Testplan | File picker for testplan |
| `covsight.closeTestplan` | CovSight: Close Testplan | Close loaded testplan |
| `covsight.rescanTestplans` | CovSight: Rescan Workspace for Testplans | Re-discover |
| `covsight.showUnboundCoverage` | CovSight: Show Unbound Coverage | Coverage items with no testplan binding |

---

## 9. Views

### Explorer panel views

| View ID | Name | Description |
|---|---|---|
| `covsight.databases` | Coverage Databases | List of open `.cdb` files |
| `covsight.coverage` | Coverage Hierarchy | UCIS scope/bin tree |
| `covsight.testplan` | Testplan | Goal/testpoint hierarchy (new) |

All three views live in the Explorer panel by default.
Consider grouping them under a dedicated `covsight` activity bar icon in a
future iteration — for now, Explorer is the right home.

### Custom editor

The `.cdb` custom editor (`covsight.databaseEditor`) can be simplified or
deferred. Opening a `.cdb` in the editor triggers the database load and focuses
the Coverage Hierarchy view; it does not necessarily need a full custom editor
panel. Remove the custom editor registration unless a dedicated in-editor view
is planned.

---

## 10. Configuration

Rename all keys from `pyucis.*` to `covsight.*`.

| Key | Type | Default | Description |
|---|---|---|---|
| `covsight.autoDetect` | boolean | `true` | Auto-discover `.cdb` files |
| `covsight.filePatterns` | string[] | `["**/*.cdb"]` | Glob patterns for DB discovery |
| `covsight.coverageGoal` | number | `100` | Target coverage % |
| `covsight.warningThreshold` | number | `80` | Coverage % below which items show warning color |
| `covsight.pathMappings` | object | `{}` | Map DB source paths to workspace paths |
| `covsight.showDecorations` | boolean | `false` | Enable source gutter decorations by default |
| `covsight.excludeIgnoredBins` | boolean | `true` | Exclude IGNOREBIN from calculations |
| `covsight.excludeIllegalBins` | boolean | `true` | Exclude ILLEGALBIN from calculations |
| `covsight.defaultFilter` | enum | `"all"` | Default status filter (all/uncovered/covered) |
| `covsight.testplan.autoDetect` | boolean | `true` | Auto-discover testplan files |
| `covsight.testplan.filePatterns` | string[] | `["**/*.testplan","**/testplan.yaml","**/testplan.yml"]` | Testplan glob patterns |

---

## 11. Activation Events

```json
"activationEvents": [
  "workspaceContains:**/*.cdb",
  "workspaceContains:**/*.testplan",
  "workspaceContains:**/*testplan*.yaml",
  "workspaceContains:**/*testplan*.yml"
]
```

Remove `onLanguage:systemverilog` and `onLanguage:verilog` as activation
triggers — the extension is not a language server and should not activate on
every SV file open. Activation should be driven by presence of coverage or
testplan files.

Remove `onCustomEditor:pyucis.databaseEditor` (custom editor removed per §9).

---

## 12. Dashboard Webview

The dashboard is rewritten to use the NCDB data model. Planned sections:

### Summary bar
- Overall coverage % (large, colored)
- Progress bar
- Covered / Total bins

### By type breakdown
- Table: scope type → covered bins / total bins / %
- Cover types: Covergroup, Coverpoint, Cross, Toggle, Branch, Expression, FSM, Assertion

### Test history (if NCDB `history.json` member present)
- Recent test runs with status icons
- Pass/fail counts
- Timestamps

### Issues (if NCDB `issues.bin` member present)
- Summary counts by severity (info / low / medium / high / critical)
- Table of open issues with kind, title, state

### Testplan closure (if testplan loaded)
- Table of goals with % closed
- Testpoints by status (planned / in_progress / complete / waived)

### Uncovered hotspots
- Top N uncovered bins (scope path + bin name + hit count)
- Clicking navigates to scope in coverage tree

---

## 13. Source Decorations

The decoration provider needs updating to use the UCIS object model instead of
SQL queries. The logic for finding line-level coverage data:

1. Iterate all scopes in the active `MemUCIS` via DFS (using `dfsScopes` from
   `@covsight/core/ncdb`).
2. For scopes with a `sourceInfo` (file + line), collect line → hit-count
   mapping.
3. Map DB file paths to workspace paths via `pathMappings` config.
4. Apply `coveredDecorationType` / `uncoveredDecorationType` per line.

For toggle coverage: toggle bins with `0 -> 1` and `1 -> 0` are separate;
a line is fully covered only if both transition bins are hit.

---

## 14. File Association

Register `.cdb` as a binary file with a friendly display name in the language
configuration:

```json
"languages": [
  {
    "id": "ncdb",
    "aliases": ["NCDB Coverage Database"],
    "extensions": [".cdb"],
    "icon": { "light": "./media/covsight-icon.png", "dark": "./media/covsight-icon.png" }
  }
]
```

Register `.testplan` as YAML for syntax highlighting:
```json
{
  "id": "yaml",
  "extensions": [".testplan"]
}
```

---

## 15. Dependency Changes

### Remove
- `sql.js` (runtime dependency)
- `@types/sql.js` (dev dependency)

### Add
- `@covsight/core` — local path dep to `covsight-core/ts/` during development;
  published package reference post-release
- `jszip` — already used by `@covsight/core` for NCDB ZIP reading (may be
  transitive)
- `js-yaml` (or equivalent) — for parsing testplan YAML files in the extension

### Upgrade
- `@types/vscode` → `^1.85.0` (or latest stable at implementation time)
- `@types/node` → `^20.x`
- TypeScript → `^5.4`

---

## 16. Code Coverage Display in the Editor

Hardware verification generates *code coverage* (statement, branch, toggle,
FSM, expression) tied to source files and line numbers. This data lives in the
NCDB database alongside functional coverage. Users want to see it as gutter
indicators on their SystemVerilog/Verilog/C source without opening an EDA GUI.

### Two available mechanisms

#### A. Native VS Code Test Coverage API (VS Code ≥ 1.88, March 2024)

VS Code 1.88 shipped a finalised coverage API integrated with the Testing
panel. Key types in `vscode.d.ts`:

```typescript
// Summary per file (add to a TestRun)
class FileCoverage {
    uri: Uri;
    statementCoverage: TestCoverageCount;   // also used for line coverage
    branchCoverage?:   TestCoverageCount;
    declarationCoverage?: TestCoverageCount;
    static fromDetails(uri: Uri, details: FileCoverageDetail[]): FileCoverage;
}
// Detail: per-line / per-branch (loaded lazily when user opens a file)
class StatementCoverage { executed: number | boolean; location: Position | Range; branches: BranchCoverage[]; }
class BranchCoverage     { executed: number | boolean; location?: Position | Range; label?: string; }
class DeclarationCoverage { name: string; executed: number | boolean; location: Position | Range; }
```

What VS Code provides for free when this API is used:
- A **Test Coverage** panel in the Testing sidebar listing files with %
- **Per-line execution-count overlays** on line numbers in the editor
- A **"Toggle Inline Coverage"** command (editor toolbar button)
- No custom rendering code needed for basic statement/branch display

#### B. `TextEditorDecorationType` (any VS Code version)

Custom gutter icons and line background colours applied via
`editor.setDecorations()`. The Coverage Gutters extension uses this approach.
Gives full visual control but provides no Testing-panel integration.

### Recommended approach for vscode-covsight

**Use both, for different purposes.**

#### Native API — statement and branch coverage (primary)

UCIS code coverage (statement/branch/expression/FSM bins) maps naturally to
`StatementCoverage` and `BranchCoverage`. Use the **publish-only controller**
pattern — a `TestController` that loads pre-existing coverage from the open
NCDB database without running any tests:

```typescript
const controller = vscode.tests.createTestController(
    'covsight.coverage', 'CovSight Coverage');

// Create a dummy "Coverage" profile so loadDetailedCoverage is available
const profile = controller.createRunProfile(
    'Show Coverage', vscode.TestRunProfileKind.Coverage,
    async (req, token) => { /* no-op run handler */ });

profile.loadDetailedCoverage = async (run, fileCoverage, token) => {
    return buildDetailFromNcdb(fileCoverage.uri);   // returns StatementCoverage[]
};

// Call this whenever the active database changes:
async function publishCoverageFromNcdb(db: MemUCIS) {
    const run = controller.createTestRun(
        new vscode.TestRunRequest(), 'CovSight', false);
    for (const fc of buildFileCoverages(db)) {      // iterate UCIS scopes with sourceInfo
        run.addCoverage(fc);
    }
    run.end();
}
```

When a new database is loaded or the active database changes,
`publishCoverageFromNcdb()` is called to refresh the Testing panel.

**Mapping UCIS → native API:**

| UCIS element | Native coverage type |
|---|---|
| Statement/block bins (`BRANCH`, `BLOCK`) | `StatementCoverage` at the line |
| Condition/expression bins | `BranchCoverage` within a `StatementCoverage` |
| FSM state/transition bins | `StatementCoverage` at the state/transition line |
| Declaration coverage (function hit count) | `DeclarationCoverage` |

Branch coverage populates `StatementCoverage.branches` so VS Code renders
"partially covered" lines automatically (yellow highlight instead of red).

#### `TextEditorDecorationType` — toggle coverage (supplemental)

Toggle coverage is unique to hardware: each signal has two transition bins
(`0→1` and `1→0`). The native API has no concept of "signal direction". Use
custom decorations for toggle:

- Three states per line: both transitions covered (green), one covered (yellow),
  neither covered (red) — same three-state logic as Coverage Gutters uses.
- Gutter icon: a small SVG arrow (up, down, or both) with appropriate colour.
- Applied via a separate `CoverageDecorationProvider` that runs **only** for
  files with toggle coverage data and **only** when toggle scopes are found.

The existing `coverage-decoration-provider.ts` can be repurposed for this.

#### Version guard

If `vscode.tests` is unavailable (VS Code < 1.88), fall back to decoration-only
mode for all coverage types with a workspace notification suggesting an upgrade.
Target `"engines": { "vscode": "^1.88.0" }` in `package.json` so users on
older VS Code are warned at install time.

#### Source path mapping

UCIS source paths in the database are typically absolute paths from the
simulation environment. They must be mapped to workspace paths before the
`FileCoverage.uri` is constructed. Reuse the existing `PathMapper` /
`covsight.pathMappings` config for this.

---

## 17. Testplan YAML Integration with Red Hat YAML Extension

### What the Red Hat YAML extension provides

`redhat.vscode-yaml` is the de-facto YAML language server for VS Code. When a
schema is registered for a file pattern, users of that file get:
- **Real-time validation** with red squiggles for schema violations
- **IntelliSense / autocomplete** on all defined fields
- **Hover documentation** showing field descriptions from the schema
- **Go-to-definition** within the YAML structure

This is the same experience engineers already have for Kubernetes manifests and
GitHub Actions workflows — both of which use this exact mechanism.

### Integration mechanism: `yamlValidation` contribution point

The simplest and most reliable approach. Add to `package.json`:

```json
"contributes": {
  "yamlValidation": [
    {
      "fileMatch": ["*.testplan", "*testplan*.yaml", "*testplan*.yml"],
      "url": "./schemas/covsight-testplan.schema.json"
    }
  ]
}
```

The YAML extension scans all installed extensions for `yamlValidation` entries
at startup and registers them with the language server automatically — no code
required. The `url` is resolved relative to the extension install directory.

**What to ship:** a JSON Schema file `schemas/covsight-testplan.schema.json`
bundled with the extension, derived from the testplan schema defined in
`covsight-core/docs/testplan-schema.md`. This is a one-time authoring task;
the schema can be updated with each release.

### Soft dependency on `redhat.vscode-yaml`

Do NOT list `redhat.vscode-yaml` in `extensionDependencies` (hard dependency —
blocks install if YAML ext is absent). Instead:

1. `yamlValidation` silently does nothing if the YAML extension is not present.
2. Optionally, show a one-time information message:
   ```
   "Install 'YAML Support by Red Hat' for testplan schema validation and
    autocompletion. [Install] [Don't show again]"
   ```
   Triggered when a testplan file is opened and `redhat.vscode-yaml` is not
   installed. Use a workspace state key to suppress after dismissal.

List it in `extensionPack` or the README "Recommended extensions" section.

### In-file schema override

The `# yaml-language-server: $schema=...` modeline also works without any
extension integration. Add this to documentation and generated testplan
templates so users who prefer explicit per-file schemas can use:

```yaml
# yaml-language-server: $schema=https://schema.covsight.io/testplan/v1
```

This requires the schema to be served at that URL. Until it is, the extension-
bundled schema via `yamlValidation` is the primary path.

### Programmatic API (future option)

The YAML extension also exposes a `registerContributor` API obtained via:
```typescript
const yamlExt = vscode.extensions.getExtension('redhat.vscode-yaml');
const yamlApi = await yamlExt.activate();
yamlApi.registerContributor('covsight', requestSchema, requestSchemaContent);
```

This allows **dynamic, context-sensitive schemas** (e.g., showing different
autocompletion based on `format_version` or imported testplans). This is the
pattern used by the Kubernetes and Tekton extensions. Reserve this for a future
phase when dynamic schema features are needed; the static `yamlValidation`
approach covers Phase 3 fully.

### JSON Schema design notes

The `covsight-testplan.schema.json` should cover:

- Top-level fields: `$schema`, `format_version`, `name`, `description`, `owner`,
  `tags`, `imports`, `substitutions`, `goals`, `testpoints`, `covergroups`,
  `custom`
- `goals[]`: recursive `$ref` to the goal schema (self-referential for nesting)
- `testpoints[]`: all fields from the testplan schema doc including `coverage[]`
  with an enum for `type` (covergroup, coverpoint, cross, assertion, etc.)
- `coverage[].type`: string enum with descriptions for each coverage binding type
- `status` fields: enum `["planned","in_progress","complete","waived"]`
- `priority` fields: enum `["high","medium","low"]`
- `custom`: `additionalProperties: true` (opaque user dict — do not validate)
- `"$schema"` field: const `"https://schema.covsight.io/testplan/v1"` with
  a description pointing to docs

Descriptions on every property become hover text in the editor — invest time
here as it directly impacts the authoring UX.

---

## 19. Implementation Phases

### Phase 1 — Rename and reidentify (no new features)
1. Update `package.json`: name, displayName, description, publisher, keywords,
   repository, icon reference. Set `"engines": { "vscode": "^1.88.0" }`.
2. Rename all `pyucis.*` command IDs, view IDs, config keys throughout source.
3. Copy brand icon into `media/`.
4. Update activation events.
5. Verify build compiles.

### Phase 2 — Replace SQLite backend with NCDB
1. Add `@covsight/core` dependency.
2. Write `src/ncdb/NcdbManager.ts`.
3. Rewrite `src/providers/database-manager.ts` to delegate to `NcdbManager`.
4. Delete `src/db/` entirely.
5. Update `coverage-tree-provider.ts` to walk `MemUCIS` object tree.
6. Update `coverage-dashboard.ts` to use UCIS API.
7. Update `coverage-detail-panel.ts` to use UCIS API.
8. Replace `coverage-decoration-provider.ts` with:
   - Native Test Coverage API publisher (statement/branch via `TestController`)
   - Toggle decoration provider (custom `TextEditorDecorationType` for 0→1 / 1→0)
9. Update discovery to use `covsight.*` config keys.
10. Remove custom editor.
11. Verify end-to-end with a real `.cdb` file.

### Phase 3 — Testplan support
1. Author `schemas/covsight-testplan.schema.json` (all fields with descriptions).
2. Add `yamlValidation` contribution to `package.json`.
3. Register `.testplan` as YAML language so it gets syntax highlighting.
4. Add soft-dependency notice for `redhat.vscode-yaml` when testplan file opens.
5. Write `src/providers/testplan-discovery.ts`.
6. Write `src/providers/testplan-tree-provider.ts` (goal/testpoint tree).
7. Write `src/views/testplan-panel.ts` (testpoint detail webview).
8. Wire new commands: `covsight.openTestplan`, `covsight.closeTestplan`,
   `covsight.rescanTestplans`, `covsight.showUnboundCoverage`.
9. Register `covsight.testplan` view in Explorer.
10. Implement coverage-testplan linkage in coverage tree (scope tooltip
    annotation showing bound testpoint name).
11. Add testplan closure section to dashboard.

### Phase 4 — Polish
1. Dashboard: add issues panel (if `issues.bin` present in NCDB).
2. Dashboard: add test history section (if `history.json` present).
3. File icons: `.cdb` icon, `.testplan` YAML icon.
4. Walkthrough / welcome content for first-time users.
5. README rewrite aligned with CovSight brand and covsight.github.io positioning.
6. Programmatic YAML API (`registerContributor`) for dynamic schema features
   (e.g. auto-complete of coverage paths that exist in the open `.cdb`).

---

## 20. Design Decisions

### Native Test Coverage API for code coverage
The native API (VS Code 1.88+) is used for statement/branch/FSM coverage. This
gives the Testing panel integration (file list, % summaries, inline count
overlays, "Toggle Inline Coverage" button) entirely for free. Toggle coverage
uses supplemental `TextEditorDecorationType` because the 0→1 / 1→0 signal
direction concept has no equivalent in the native API.

### No custom editor for `.cdb`
Opening a `.cdb` in the editor pane is awkward for a binary format — there is
nothing meaningful to show as text. Instead, the extension activates on
workspace detection and populates the sidebar tree views. The custom editor
registration is removed.

### In-memory model vs streaming
`NcdbReader.read()` loads the full `MemUCIS` into memory. For typical NCDB
files (which are already 60–73× compressed vs SQLite) this is acceptable.
Very large databases could be addressed in a future phase with lazy loading,
but this is not a Phase 1–3 concern.

### Single active database
The current model of one "active" database driving both the tree and decorations
is retained. Multi-database comparison (merge view) is a future feature aligned
with the covsight CLI's `merge` command.

### Testplan parser in extension vs in covsight-core
The testplan YAML schema is defined in `covsight-core`, but the TypeScript
parser is not yet available as a public `@covsight/core` export. For Phase 3,
the extension will implement a lightweight YAML parser using `js-yaml` that
covers the core schema fields (goals, testpoints, coverage bindings, imports).
When `@covsight/core` ships a testplan reader, the extension parser will be
replaced.

### YAML extension: declarative over programmatic (Phase 3)
The static `yamlValidation` contribution point in `package.json` covers all
Phase 3 needs with zero runtime code. The programmatic `registerContributor`
API is reserved for Phase 4 dynamic features (e.g., autocompleting coverage
paths that actually exist in the currently open `.cdb`).

### `covsight.*` vs `covsight-core/*` imports
The extension imports only from `@covsight/core` (the TypeScript package).
It does not import Python packages or call the CLI. All data access is in-process
via the TypeScript UCIS API.

---

## 21. Open Questions

1. **Publisher ID**: The VSCode Marketplace publisher must be registered.
   `covsight` is the preferred publisher name. Confirm this is available and
   registered before Phase 1 packaging.

2. **`@covsight/core` npm publication**: Until the package is published on npm,
   the extension uses a `file:` path dependency. The extension VSIX must bundle
   the compiled `@covsight/core` dist. Verify `vsce package` handles this
   correctly (it should via `npm pack` bundling).

3. **Testplan imports**: The testplan schema supports `imports` (transitive
   YAML includes). The Phase 3 parser should resolve imports relative to the
   testplan file location. Circular-import detection is required.

4. **Activity bar**: Should `covsight.databases`, `covsight.coverage`, and
   `covsight.testplan` live in the Explorer panel or get a dedicated CovSight
   activity bar icon? Dedicated icon is better UX but requires more work.
   Revisit after Phase 2.

6. **JSON Schema hosting**: The testplan schema `$schema` URL
   (`https://schema.covsight.io/testplan/v1`) should eventually be served
   publicly so the in-file modeline works without the extension. Until then,
   the `yamlValidation` bundled-schema path is the only route.

7. **`TestController` lifecycle**: The publish-only `TestController` for code
   coverage must be refreshed whenever the active database changes or is closed.
   Decide whether the old `TestRun` should be explicitly ended before creating
   a new one, or if VS Code handles replacement automatically.
