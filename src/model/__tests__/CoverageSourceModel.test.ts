import { MemUCIS, ScopeTypeT, SourceInfo, TOGGLE_BIN_0_TO_1 } from '@covsight/core';
import { CoverageSourceModel } from '../CoverageSourceModel';
import { PathMapper } from '../PathMapper';
import { buildSourceCoverage, buildToggleData } from './fixtures/builders';

describe('CoverageSourceModel', () => {
  describe('buildFileCoverages', () => {
    it('extracts statement and branch coverage, merges lines, and applies path mapping', () => {
      const db = buildSourceCoverage({
        files: [{
          path: '/db/top.sv',
          stmtBins: [{ line: 10, count: 1n }, { line: 10, count: 3n }, { line: 12, count: 0n }],
          branchBins: [{ line: 10, label: 'true', count: 1n }, { line: 14, label: 'false', count: 0n }],
        }],
      });
      const model = new CoverageSourceModel(new PathMapper({ '/db': '/workspace' }));
      const [file] = model.buildFileCoverages(db);

      expect(file).toBeDefined();
      expect(file?.dbPath).toBe('/db/top.sv');
      expect(file?.workspacePath).toBe('/workspace/top.sv');
      expect(file?.totalLines).toBe(3);
      expect(file?.coveredLines).toBe(1);
      expect(file?.lines.find((line) => line.line === 10)).toEqual({
        line: 10,
        hitCount: 3n,
        branches: [{ label: 'true', hitCount: 1n, coverType: 0x40 }],
      });
      expect(file?.lines.find((line) => line.line === 14)?.branches).toHaveLength(1);
    });

    it('skips scopes without source info and ignores toggle-only data', () => {
      const db = buildSourceCoverage({ files: [{ path: '/db/top.sv', stmtBins: [{ line: 5, count: 1n }] }] });
      const top = Array.from(db.scopes(ScopeTypeT.ALL))[0]!;
      top.createCoverpoint('no_source').createBin('ignored', 0x20, 1n, 1n);

      const fileCoverages = new CoverageSourceModel(new PathMapper({})).buildFileCoverages(db);
      expect(fileCoverages[0]?.lines).toHaveLength(1);
      expect(new CoverageSourceModel(new PathMapper({})).buildFileCoverages(buildToggleData())).toEqual([]);
    });

    it('passes through unmapped paths, merges scopes for the same file, and handles empty databases', () => {
      const db = buildSourceCoverage({
        files: [
          { path: '/db/a.sv', stmtBins: [{ line: 1, count: 1n }], branchBins: [{ line: 1, label: 'taken', count: 1n }] },
          { path: '/db/a.sv', stmtBins: [{ line: 2, count: 0n }] },
        ],
      });
      const files = new CoverageSourceModel(new PathMapper({ '/other': '/workspace' })).buildFileCoverages(db);

      expect(files).toHaveLength(1);
      expect(files[0]?.workspacePath).toBe('/db/a.sv');
      expect(files[0]?.lines.map((line) => line.line)).toEqual([1, 2]);
      expect(new CoverageSourceModel(new PathMapper({})).buildFileCoverages(new MemUCIS())).toEqual([]);
    });
  });

  describe('buildToggleCoverages', () => {
    it('builds toggle coverage entries, preserves counts, and applies path mapping', () => {
      const db = buildToggleData({ files: [{ path: '/db/top.sv', lines: [7, 9] }] });
      const [file] = new CoverageSourceModel(new PathMapper({ '/db': '/workspace' })).buildToggleCoverages(db);

      expect(file?.dbPath).toBe('/db/top.sv');
      expect(file?.workspacePath).toBe('/workspace/top.sv');
      expect(file?.toggleLines.get(7)).toEqual({ zeroToOne: 1n, oneToZero: 2n });
      expect(file?.toggleLines.get(9)).toEqual({ zeroToOne: 2n, oneToZero: 3n });
    });

    it('includes entries with only one toggle direction and ignores non-toggle scopes', () => {
      const db = buildToggleData({ files: [{ path: '/db/top.sv', lines: [7] }] });
      const top = Array.from(db.scopes(ScopeTypeT.ALL))[0]!;
      const fh = db.getFileHandle('/db/top.sv');
      const partial = top.createToggle('partial', fh, new SourceInfo(fh.fileId, 11));
      partial.createToggleBin(TOGGLE_BIN_0_TO_1, 5n, 0n);
      top.createCoverpoint('stmt', fh, new SourceInfo(fh.fileId, 20)).createBin('stmt', 0x20, 1n, 1n);

      const [file] = new CoverageSourceModel(new PathMapper({})).buildToggleCoverages(db);

      expect(file?.toggleLines.get(11)).toEqual({ zeroToOne: 5n, oneToZero: 0n });
      expect(file?.toggleLines.has(20)).toBe(false);
    });
  });
});
