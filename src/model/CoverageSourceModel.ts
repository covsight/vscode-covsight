import { CoverTypeT, MemUCIS, TOGGLE_BIN_0_TO_1, TOGGLE_BIN_1_TO_0, dfsScopes } from '@covsight/core';
import { PathMapper } from './PathMapper.js';

/**
 * Branch-like coverage detail attached to a source line.
 */
export interface BranchInfo {
  label: string;
  hitCount: bigint;
  coverType: number;
}

/**
 * Coverage collected for a single source line.
 *
 * Statement-style metrics are folded into {@link hitCount}; branch, condition,
 * and expression metrics remain split out in {@link branches}.
 */
export interface LineCoverageData {
  line: number;
  hitCount: bigint;
  branches: BranchInfo[];
}

/**
 * Line coverage summary for a mapped source file.
 */
export interface FileCoverageData {
  dbPath: string;
  workspacePath: string;
  lines: LineCoverageData[];
  totalLines: number;
  coveredLines: number;
}

/**
 * Toggle transition counts aggregated by source line.
 */
export interface ToggleCoverageData {
  dbPath: string;
  workspacePath: string;
  toggleLines: Map<number, { zeroToOne: bigint; oneToZero: bigint }>;
}

interface FileLineAccumulator {
  dbPath: string;
  workspacePath: string;
  lines: Map<number, LineCoverageData>;
}

interface ToggleAccumulator {
  dbPath: string;
  workspacePath: string;
  toggleLines: Map<number, { zeroToOne: bigint; oneToZero: bigint }>;
}

/**
 * Extracts source-oriented coverage views from the NCDB scope graph.
 */
export class CoverageSourceModel {
  constructor(private pathMapper: PathMapper) {}

  /**
   * Builds per-file line coverage for statement, block, FSM, branch, condition,
   * and expression metrics.
   *
   * Toggle bins are intentionally excluded because they are rendered separately.
   * Multiple scopes can contribute to the same source line, so counts are merged
   * into a single line entry.
   */
  buildFileCoverages(ucis: MemUCIS): FileCoverageData[] {
    const files = new Map<string, FileLineAccumulator>();

    for (const scope of dfsScopes(ucis)) {
      if (scope.sourceInfo === null || scope.fileHandle === null) {
        continue;
      }

      const line = scope.sourceInfo.line;
      let hasCoverageData = false;
      let lineData: LineCoverageData | null = null;

      for (const item of scope.coverItems()) {
        if ((item.coverType & CoverTypeT.TOGGLEBIN) !== 0) {
          continue;
        }
        lineData ??= getOrCreateFile(files, scope.fileHandle.filePath, this.pathMapper).lines.get(line) ?? { line, hitCount: 0n, branches: [] };
        if ((item.coverType & (CoverTypeT.STMTBIN | CoverTypeT.BLOCKBIN | CoverTypeT.FSMBIN)) !== 0) {
          lineData.hitCount = lineData.hitCount > item.data.count ? lineData.hitCount : item.data.count;
          hasCoverageData = true;
          continue;
        }
        if ((item.coverType & (CoverTypeT.BRANCHBIN | CoverTypeT.CONDBIN | CoverTypeT.EXPRBIN)) !== 0) {
          lineData.branches.push({
            label: item.name,
            hitCount: item.data.count,
            coverType: item.coverType,
          });
          hasCoverageData = true;
        }
      }

      if (hasCoverageData && lineData !== null) {
        getOrCreateFile(files, scope.fileHandle.filePath, this.pathMapper).lines.set(line, lineData);
      }
    }

    return Array.from(files.values())
      .sort((lhs, rhs) => lhs.dbPath.localeCompare(rhs.dbPath))
      .map((file) => {
        const lines = Array.from(file.lines.values()).sort((lhs, rhs) => lhs.line - rhs.line);
        return {
          dbPath: file.dbPath,
          workspacePath: file.workspacePath,
          lines,
          totalLines: lines.length,
          coveredLines: lines.filter((line) => line.hitCount > 0n).length,
        };
      });
  }

  /**
   * Builds per-file toggle transition coverage.
   *
   * Each line accumulates both 0→1 and 1→0 transitions across all scopes mapped
   * to that source location.
   */
  buildToggleCoverages(ucis: MemUCIS): ToggleCoverageData[] {
    const files = new Map<string, ToggleAccumulator>();

    for (const scope of dfsScopes(ucis)) {
      if (scope.sourceInfo === null || scope.fileHandle === null) {
        continue;
      }

      let zeroToOne = 0n;
      let oneToZero = 0n;
      let hasToggle = false;

      for (const item of scope.coverItems()) {
        if ((item.coverType & CoverTypeT.TOGGLEBIN) === 0) {
          continue;
        }
        if (item.name === TOGGLE_BIN_0_TO_1) {
          zeroToOne += item.data.count;
          hasToggle = true;
        } else if (item.name === TOGGLE_BIN_1_TO_0) {
          oneToZero += item.data.count;
          hasToggle = true;
        }
      }

      if (!hasToggle) {
        continue;
      }

      const file = getOrCreateToggleFile(files, scope.fileHandle.filePath, this.pathMapper);
      const current = file.toggleLines.get(scope.sourceInfo.line) ?? { zeroToOne: 0n, oneToZero: 0n };
      current.zeroToOne += zeroToOne;
      current.oneToZero += oneToZero;
      file.toggleLines.set(scope.sourceInfo.line, current);
    }

    return Array.from(files.values())
      .sort((lhs, rhs) => lhs.dbPath.localeCompare(rhs.dbPath))
      .map((file) => ({
        dbPath: file.dbPath,
        workspacePath: file.workspacePath,
        toggleLines: new Map(Array.from(file.toggleLines.entries()).sort((lhs, rhs) => lhs[0] - rhs[0])),
      }));
  }
}

function getOrCreateFile(
  files: Map<string, FileLineAccumulator>,
  dbPath: string,
  pathMapper: PathMapper,
): FileLineAccumulator {
  const existing = files.get(dbPath);
  if (existing) {
    return existing;
  }
  const created: FileLineAccumulator = {
    dbPath,
    workspacePath: pathMapper.mapOrPassthrough(dbPath),
    lines: new Map<number, LineCoverageData>(),
  };
  files.set(dbPath, created);
  return created;
}

function getOrCreateToggleFile(
  files: Map<string, ToggleAccumulator>,
  dbPath: string,
  pathMapper: PathMapper,
): ToggleAccumulator {
  const existing = files.get(dbPath);
  if (existing) {
    return existing;
  }
  const created: ToggleAccumulator = {
    dbPath,
    workspacePath: pathMapper.mapOrPassthrough(dbPath),
    toggleLines: new Map<number, { zeroToOne: bigint; oneToZero: bigint }>(),
  };
  files.set(dbPath, created);
  return created;
}
