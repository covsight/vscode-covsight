## Verification Testplan

A CovSight testplan is a YAML file (`.testplan` extension) that lists verification goals and testpoints, each bound to coverage items in your database.

**Example testplan:**
```yaml
name: My Block Testplan
goals:
  - name: Functional Coverage
    testpoints:
      - name: TP_Reset_Sequence
        status: complete
        coverage:
          - type: covergroup
            path: top.dut.reset_cg
```

When both a `.cdb` and a `.testplan` are open, CovSight shows live coverage percentages for each testpoint in the Testplan panel.

> **Tip:** Install the [YAML extension by Red Hat](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml) for full IntelliSense in testplan files.
