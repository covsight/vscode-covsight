# CovSight Example Databases

Three example `.cdb` coverage databases for exploring the CovSight extension:

| File | Design | Coverage | Simulated by |
|------|--------|----------|-------------|
| `uart_ctrl.cdb` | UART controller — baud rate, parity, FSM, and toggle coverage | ~79% | vcs |
| `alu_coverage.cdb` | Arithmetic logic unit — opcodes, overflow, zero-flag, and toggle coverage | 100% | xcelium |
| `soc_top.cdb` | Multi-block SoC (CPU + memory controller + DMA) — early bring-up, many bins not yet exercised | ~43% | modelsim |

## Opening examples

Drag any `.cdb` file onto VS Code, or double-click it in the Explorer panel.
CovSight will open a coverage dashboard directly in the editor tab.

## Regenerating

```sh
node examples/gen-examples.mjs
```
