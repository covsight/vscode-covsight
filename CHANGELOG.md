# Changelog

All notable changes to CovSight for VS Code are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [0.2.0] — Unreleased

### Complete rewrite — CovSight NCDB backend

This release replaces the legacy `pyucis` SQLite backend with the `@covsight/core`
NCDB engine. It is a breaking change: `.cdb` files must be in NCDB format.

#### Added
- **Coverage Hierarchy** tree view using `@covsight/core` scope model
- **Coverage Dashboard** with summary bar, per-type table, and uncovered hotspots
- **Testplan support** — load `.testplan` / YAML files; view goal/testpoint tree with live coverage percentages
- **Testplan JSON Schema** — full IntelliSense for `.testplan` files when YAML by Red Hat is installed
- **File coverage** published to VS Code Testing panel (statement + branch)
- **Toggle decorations** — gutter color coding for signal toggle coverage
- **Path Mappings** — remap database source paths to workspace paths
- **Coverage filter** commands: show all / covered / uncovered
- **`CovSight: Show Unbound Coverage Scopes`** command
- **Getting Started walkthrough**
- `.cdb` file language registration with custom icon

#### Changed
- Extension renamed from `pyucis-view` to `covsight`
- Publisher changed from `pyucis` to `covsight`
- All command IDs updated: `pyucis.*` → `covsight.*`
- Build system migrated from `tsc` to `esbuild`
- Test framework: Jest (model layer unit tests)
- Minimum VS Code version: 1.88

#### Removed
- SQLite (`sql.js`) backend — replaced by `@covsight/core` NCDB reader
- Custom editor for `.cdb` files — replaced by tree + dashboard views

---

## [0.1.0] — Internal prototype

Initial prototype using `pyucis` SQLite schema. Never published to the Marketplace.
