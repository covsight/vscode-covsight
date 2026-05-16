# CovSight for VS Code

**CovSight** is a Visual Studio Code extension for viewing functional and code coverage data from simulation databases. It is part of the [CovSight ecosystem](https://covsight.github.io) — a set of open-source tools for coverage-driven verification.

---

## Features

- 🗄️ **Coverage Hierarchy** — Browse covergroups, coverpoints, crosses, toggle signals, branches, FSMs, and assertion monitors in a tree view
- 📊 **Coverage Dashboard** — Overall summary bar, per-type breakdown table, and uncovered hotspots
- 🖊️ **Inline Source Annotations** — Toggle coverage displayed as gutter decorations; file coverage published to VS Code's Testing panel
- 📋 **Testplan Integration** — Load `.testplan` YAML files; see goal/testpoint status linked to live coverage data
- ✅ **YAML IntelliSense** — Full schema validation and autocomplete for `.testplan` files (requires [YAML by Red Hat](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml))
- 🔍 **Workspace Discovery** — Automatically detects `.cdb` files in the workspace

---

## Requirements

- **VS Code** ≥ 1.88
- **Recommended:** [YAML by Red Hat](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml) for testplan IntelliSense

---

## Getting Started

1. **Open your workspace** containing one or more `.cdb` files. CovSight discovers them automatically.
2. **Click a database** in the *Coverage Databases* panel to activate it — the *Coverage Hierarchy* populates.
3. **Open a testplan** with `CovSight: Open Testplan` to see goal and testpoint coverage in the *Testplan* panel.

> Run the **CovSight: Getting Started** walkthrough (`Help › Walkthroughs`) for a guided introduction.

---

## Coverage Hierarchy

The *Coverage Hierarchy* panel (Explorer sidebar) shows the full scope tree.

### Icon Legend

| Icon | Scope Type |
|------|------------|
| `package` | Instance / Module |
| `graph` | Covergroup / Coverinstance |
| `graph-line` | Coverpoint |
| `symbol-structure` | Cross coverage |
| `symbol-boolean` | Toggle signal |
| `git-branch` | Branch / Condition / Expression |
| `symbol-enum` | FSM states / transitions |

Each node shows a **coverage percentage** (covered bins / total bins). The icon color reflects status: green = met, orange = partial, red = none.

### Filter Commands

| Command | Description |
|---------|-------------|
| `CovSight: Show All Items` | Clear filter — show everything |
| `CovSight: Show Uncovered Items` | Show only scopes below the coverage goal |
| `CovSight: Show Covered Items` | Show only fully-covered scopes |

---

## Source Annotations

CovSight publishes **file coverage** to VS Code's built-in Testing panel. Open any source file that appears in the database — coverage is shown in the editor gutter and summary bar.

For **toggle signals**, CovSight adds gutter decorations color-coded by direction:
- 🟢 Both `0→1` and `1→0` transitions hit
- 🟡 Only one direction hit
- 🔴 Neither direction hit

Toggle decorations are toggled with `CovSight: Toggle Source Decorations` (default off).

---

## Testplan

A CovSight testplan is a YAML file with extension `.testplan` (or `*testplan*.yaml`).

### Structure

```yaml
name: My Block Verification Plan
description: Coverage plan for the AXI controller block

goals:
  - name: Reset Behavior
    description: All reset scenarios exercised
    testpoints:
      - name: TP_POR_Reset
        status: complete
        priority: high
        coverage:
          - type: covergroup
            path: top.dut.reset_cg

testpoints:
  - name: TP_Idle_Timeout
    status: planned
    coverage:
      - type: coverpoint
        path: top.dut.timeout_cp
```

### Coverage Binding Types

| Type | Description |
|------|-------------|
| `covergroup` | Entire covergroup scope |
| `coverpoint` | Specific coverpoint |
| `cross` | Cross coverage point |
| `assertion` | SVA assertion |
| `toggle` | Signal toggle scope |
| `line` | Statement/line coverage |
| `branch` | Branch or condition coverage |

Paths support `*` as a wildcard for a single scope segment (e.g. `top.*.reset_cg`).

### Testpoint Status

| Status | Meaning |
|--------|---------|
| `planned` | Not yet started |
| `in_progress` | Work underway |
| `complete` | Objectives met |
| `waived` | Will not be implemented |

---

## Dashboard

Open the Coverage Dashboard from the *Coverage Hierarchy* toolbar or with `CovSight: Show Coverage Dashboard`.

Sections:
- **Overall Coverage** — progress bar vs. `covsight.coverageGoal`
- **By Type** — coverage percentage per scope type
- **Hotspots** — lowest-hit uncovered bins (most actionable gaps)
- **Testplan Closure** — per-testpoint coverage percentage (when a testplan is loaded)

---

## Configuration

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `covsight.autoDetect` | boolean | `true` | Auto-discover `.cdb` files on workspace open |
| `covsight.filePatterns` | string[] | `["**/*.cdb"]` | Glob patterns for database discovery |
| `covsight.coverageGoal` | number | `100` | Target coverage percentage (0–100) |
| `covsight.warningThreshold` | number | `80` | Percentage below which items show a warning |
| `covsight.excludeIgnoredBins` | boolean | `true` | Exclude `IGNOREBIN` from calculations |
| `covsight.excludeIllegalBins` | boolean | `true` | Exclude `ILLEGALBIN` from calculations |
| `covsight.defaultFilter` | string | `"all"` | Default tree filter: `all`, `covered`, or `uncovered` |
| `covsight.pathMappings` | object | `{}` | Map database source paths to workspace paths |
| `covsight.showDecorations` | boolean | `false` | Enable toggle decorations by default |

---

## Path Mappings

If your `.cdb` file was produced on a different machine or with different absolute paths, use `covsight.pathMappings` to remap them:

```json
"covsight.pathMappings": {
  "/ci/build/rtl/": "/home/me/projects/myblock/rtl/"
}
```

The longest matching prefix wins. Paths that do not match any mapping are passed through unchanged.

---

## Recommended Extensions

- [YAML by Red Hat](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml) — provides IntelliSense, hover documentation, and validation for `.testplan` files using the bundled JSON schema.

---

## Known Limitations

- **Single active database** — only one `.cdb` can be active at a time; multi-database merge is not yet supported.
- **No write support** — CovSight is read-only; it cannot modify coverage data.
- **Toggle decorations require source paths** — the database must contain file path information for inline annotations to work.
