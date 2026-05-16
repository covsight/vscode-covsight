# VSCode Extension Naming Recommendation for CovSight

## Summary

For a newer/less-known tool, a hybrid naming approach (brand + descriptor) provides the best balance of memorability and marketplace discoverability.

## Recommended Naming

| Field (`package.json`) | Value |
|---|---|
| `name` | `vscode-covsight` |
| `displayName` | `CovSight – Coverage Analysis` |
| `description` | `Coverage analysis and visualization for functional verification workflows` |
| `keywords` | `coverage`, `functional coverage`, `ucis`, `verification`, `SystemVerilog`, `covsight` |

## Rationale

### Brand-only vs. Hybrid
- **Brand-only** (e.g., ESLint, Docker, Python) works well when the tool is already widely known.
- **Hybrid** (e.g., "Prettier – Code Formatter", "GitLens") captures both brand recognition *and* search keywords — better for discoverability when the brand is still growing.

### Repo Name: `vscode-covsight`
- `vscode-covsight` follows the more common open-source convention (e.g., `vscode-python`, `vscode-docker`, `vscode-go`).
- `covsight-vscode` is less standard and harder to discover via GitHub search.

### Keywords Matter
The VSCode Marketplace uses the `keywords` array for search ranking. Even if the display name is short, loading up keywords with relevant terms (`coverage`, `functional coverage`, `ucis`, `verification`, etc.) ensures discoverability for users who don't yet know the CovSight brand.

## Alternatives Considered

| Option | Pros | Cons |
|---|---|---|
| `CovSight` (brand only) | Clean, memorable | Poor keyword discoverability for new users |
| `CovSight – Coverage Analysis` | Brand + searchable, concise | Slightly longer |
| `CovSight – Functional Coverage` | Precise for the target audience | May be too niche/jargon-heavy |

## Official Guidelines Reference
- VSCode docs explicitly advise **against** including "VSCode", "Visual Studio Code", or "Extension" in the display name — the marketplace context makes these redundant.
- Identifiers (`name`) should be lowercase with hyphens.
- Display names should be Title Case.
