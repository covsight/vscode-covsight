import { MemUCIS, NcdbWriter } from '@covsight/core';
import { buildSimpleCovergroup } from './builders';

export const MINIMAL_TESTPLAN_YAML = `
name: Minimal Plan
testpoints:
  - name: smoke
    status: planned
    coverage:
      - type: coverpoint
        path: top.cg1.cp1
`;

export const NESTED_GOALS_YAML = `
name: Nested Plan
goals:
  - name: level1
    goals:
      - name: level2
        goals:
          - name: level3
            testpoints:
              - name: tp_nested
                status: complete
                coverage:
                  - type: coverpoint
                    path: top.cg1.cp1
        testpoints:
          - name: tp_mid
            status: planned
            coverage: []
    testpoints:
      - name: tp_top
        status: in_progress
        coverage: []
`;

export const FULL_TESTPOINT_YAML = `
name: Full Plan
description: Full coverage plan
formatVersion: '1.0'
testpoints:
  - name: full_tp
    description: Detailed testpoint
    owner: alice
    status: complete
    priority: high
    stage: regression
    tests: [smoke, nightly]
    coverage:
      - { type: covergroup, path: top.cg1 }
      - { type: coverpoint, path: top.cg1.cp1 }
      - { type: cross, path: top.cg1.x_ab }
      - { type: assertion, path: top.assert1 }
      - { type: toggle, path: top.sig_valid }
      - { type: line, path: top.line42 }
      - { type: branch, path: top.branch1 }
    requirements: [REQ-1, REQ-2]
    custom:
      tag: nightly
      enabled: true
`;

export function buildImportedTestplans(): {
  mainYaml: string;
  importedYaml: string;
  mockLoader: (path: string) => Promise<string>;
} {
  const mainYaml = `
name: Main Plan
imports:
  - ./imported.testplan
testpoints:
  - name: tp_main
    status: planned
    coverage: []
`;

  const importedYaml = `
goals:
  - name: imported_goal
    testpoints:
      - name: tp_imported_goal
        status: complete
        coverage: []
testpoints:
  - name: tp_imported
    status: complete
    coverage: []
`;

  const mockLoader = async (filePath: string): Promise<string> => {
    if (filePath === '/plans/imported.testplan') {
      return importedYaml;
    }
    throw new Error(`Unexpected path: ${filePath}`);
  };

  return { mainYaml, importedYaml, mockLoader };
}

export function buildCircularImportTestplans(): {
  yaml: string;
  mockLoader: (path: string) => Promise<string>;
} {
  const yaml = `
name: Root Plan
imports:
  - ./other.testplan
testpoints:
  - name: root_tp
    status: planned
    coverage: []
`;

  const mockLoader = async (filePath: string): Promise<string> => {
    if (filePath === '/plans/other.testplan') {
      return `
imports:
  - ./root.testplan
testpoints:
  - name: other_tp
    status: planned
    coverage: []
`;
    }
    if (filePath === '/plans/root.testplan') {
      return yaml;
    }
    throw new Error(`Unexpected path: ${filePath}`);
  };

  return { yaml, mockLoader };
}

export const INVALID_TESTPLAN_YAML = `
testpoints:
  - status: nope
    coverage:
      - type: invalid
`;

export async function buildCdbBytes(ucis?: MemUCIS): Promise<Uint8Array> {
  return new NcdbWriter().toBytes(ucis ?? buildSimpleCovergroup());
}
