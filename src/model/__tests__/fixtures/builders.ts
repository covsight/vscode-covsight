import { CoverTypeT, MemUCIS, Scope, SourceInfo, TOGGLE_BIN_0_TO_1, TOGGLE_BIN_1_TO_0 } from '@covsight/core';

type BinCapableScope = Scope & {
  createBin(name: string, binType: number, count: bigint, atLeast: bigint): unknown;
};

export function buildSimpleCovergroup(opts?: {
  name?: string;
  bins?: Array<{ name: string; count: bigint; atLeast: bigint }>;
}): MemUCIS {
  const db = new MemUCIS();
  const top = db.createScope(opts?.name ?? 'top');
  const cg = top.createCovergroupDef('cg1');
  const cp = cg.createCoverpoint('cp1');

  for (const bin of opts?.bins ?? [
    { name: 'bin_a', count: 1n, atLeast: 1n },
    { name: 'bin_b', count: 0n, atLeast: 1n },
  ]) {
    cp.createBin(bin.name, CoverTypeT.CVGBIN, bin.count, bin.atLeast);
  }

  return db;
}

export function buildInstanceHierarchy(depth = 3): MemUCIS {
  const db = new MemUCIS();
  const du = db.createScope('dut');
  let current = db.createScope('top', du);

  for (let level = 1; level <= depth; level++) {
    const cg = current.createCovergroupDef(`cg${level}`);
    const cp = cg.createCoverpoint(`cp${level}`);
    cp.createBin(`bin_${level}`, CoverTypeT.CVGBIN, level % 2 === 0 ? 1n : 0n, 1n);
    current = cp;
  }

  return db;
}

export function buildToggleData(opts?: {
  files?: Array<{ path: string; lines: number[] }>;
}): MemUCIS {
  const db = new MemUCIS();
  const files = opts?.files ?? [{ path: '/rtl/top.sv', lines: [10, 20] }];

  files.forEach((file, fileIndex) => {
    const top = db.createScope(`top_${fileIndex}`);
    const fh = db.getFileHandle(file.path);
    file.lines.forEach((line, lineIndex) => {
      const toggle = top.createToggle(`sig_${fileIndex}_${lineIndex}`, fh, new SourceInfo(fh.fileId, line));
      toggle.createToggleBin(TOGGLE_BIN_0_TO_1, BigInt(lineIndex + 1), 0n);
      toggle.createToggleBin(TOGGLE_BIN_1_TO_0, BigInt(lineIndex + 2), 0n);
    });
  });

  return db;
}

export function buildSourceCoverage(opts: {
  files: Array<{
    path: string;
    stmtBins: Array<{ line: number; count: bigint }>;
    branchBins?: Array<{ line: number; label: string; count: bigint }>;
  }>;
}): MemUCIS {
  const db = new MemUCIS();

  opts.files.forEach((file, fileIndex) => {
    const top = db.createScope(`top_${fileIndex}`);
    const fh = db.getFileHandle(file.path);

    file.stmtBins.forEach((bin, binIndex) => {
      const cp = top.createCoverpoint(`stmt_${fileIndex}_${binIndex}`, fh, new SourceInfo(fh.fileId, bin.line));
      cp.createBin(`stmt_bin_${binIndex}`, CoverTypeT.STMTBIN, bin.count, 1n);
    });

    file.branchBins?.forEach((bin, binIndex) => {
      const branch = top.createBranch(`branch_${fileIndex}_${binIndex}`, fh, new SourceInfo(fh.fileId, bin.line)) as BinCapableScope;
      branch.createBin(bin.label, CoverTypeT.BRANCHBIN, bin.count, 1n);
    });
  });

  return db;
}

export function buildZeroCoverageDb(): MemUCIS {
  return buildSimpleCovergroup({
    bins: [
      { name: 'bin_a', count: 0n, atLeast: 1n },
      { name: 'bin_b', count: 0n, atLeast: 1n },
    ],
  });
}

export function buildFullCoverageDb(): MemUCIS {
  return buildSimpleCovergroup({
    bins: [
      { name: 'bin_a', count: 1n, atLeast: 1n },
      { name: 'bin_b', count: 2n, atLeast: 1n },
    ],
  });
}

export function buildDbWithSpecialBins(): MemUCIS {
  const db = new MemUCIS();
  const top = db.createScope('top');
  const cg = top.createCovergroupDef('cg1');
  const cp = cg.createCoverpoint('cp1');
  cp.createBin('ignored', CoverTypeT.CVGBIN | CoverTypeT.IGNOREBIN, 0n, 1n);
  cp.createBin('illegal', CoverTypeT.CVGBIN | CoverTypeT.ILLEGALBIN, 0n, 1n);
  return db;
}

export function buildCrossDb(): MemUCIS {
  const db = new MemUCIS();
  const top = db.createScope('top');
  const cg = top.createCovergroupDef('cg1');
  const cpA = cg.createCoverpoint('cp_a');
  const cpB = cg.createCoverpoint('cp_b');
  const cross = cg.createCross('x_ab', null, null, [cpA, cpB]);
  cross.createBin('cross_bin', CoverTypeT.DEFAULTBIN, 0n, 1n);
  return db;
}

export function buildFsmDb(): MemUCIS {
  const db = new MemUCIS();
  const top = db.createScope('top');
  const fh = db.getFileHandle('/rtl/fsm.sv');
  const fsm = top.createFsm('fsm1', fh, new SourceInfo(fh.fileId, 55)) as BinCapableScope;
  fsm.createBin('state_0', CoverTypeT.FSMBIN, 1n, 1n);
  return db;
}
