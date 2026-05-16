import { ScopeTypeT } from '@covsight/core';
import { DEFAULT_FILTER_OPTIONS, computeAggregateStats } from '../CoverageStats';
import { NcdbManager } from '../NcdbManager';
import { buildCdbBytes } from './fixtures/testplans';
import { buildFullCoverageDb, buildSimpleCovergroup, buildZeroCoverageDb } from './fixtures/builders';

describe('NcdbManager', () => {
  it('openDatabase calls the loader, returns a MemUCIS, and tracks the path as open', async () => {
    const calls: string[] = [];
    const manager = new NcdbManager(async (path) => {
      calls.push(path);
      return buildCdbBytes();
    });

    const db = await manager.openDatabase('/data/a.cdb');

    expect(calls).toEqual(['/data/a.cdb']);
    expect(Array.from(db.scopes(ScopeTypeT.ALL)).length).toBeGreaterThan(0);
    expect(manager.isOpen('/data/a.cdb')).toBe(true);
    expect(manager.getOpenDatabases()).toEqual(['/data/a.cdb']);
  });

  it('openDatabase wraps loader errors with a descriptive message', async () => {
    const manager = new NcdbManager(async () => {
      throw new Error('boom');
    });

    await expect(manager.openDatabase('/data/fail.cdb')).rejects.toThrow('Failed to open database "/data/fail.cdb": boom');
  });

  it('opening the same path twice reloads the database', async () => {
    let callCount = 0;
    const manager = new NcdbManager(async () => {
      callCount += 1;
      return callCount === 1 ? buildCdbBytes(buildZeroCoverageDb()) : buildCdbBytes(buildFullCoverageDb());
    });

    const first = await manager.openDatabase('/data/reload.cdb');
    const second = await manager.openDatabase('/data/reload.cdb');

    expect(callCount).toBe(2);
    expect(first).not.toBe(second);
    expect(computeAggregateStats(second, DEFAULT_FILTER_OPTIONS).percentage).toBe(100);
    expect(manager.getOpenDatabases()).toEqual(['/data/reload.cdb']);
  });

  it('setActiveDatabase returns the active database and supports clearing it', async () => {
    const manager = new NcdbManager(async () => buildCdbBytes(buildSimpleCovergroup()));
    const db = await manager.openDatabase('/data/active.cdb');

    manager.setActiveDatabase('/data/active.cdb');
    expect(manager.getActiveDatabase()).toBe(db);
    expect(manager.getActiveDatabasePath()).toBe('/data/active.cdb');

    manager.setActiveDatabase(null);
    expect(manager.getActiveDatabase()).toBeNull();
    expect(manager.getActiveDatabasePath()).toBeNull();
  });

  it('setActiveDatabase throws for an unopened path', () => {
    const manager = new NcdbManager(async () => buildCdbBytes());
    expect(() => manager.setActiveDatabase('/data/missing.cdb')).toThrow('Database is not open: /data/missing.cdb');
  });

  it('fires onActiveDatabaseChanged when the active database changes and when an active database is closed', async () => {
    const manager = new NcdbManager(async () => buildCdbBytes());
    const events: Array<string | null> = [];
    manager.onActiveDatabaseChanged.subscribe((value) => events.push(value));

    await manager.openDatabase('/data/a.cdb');
    manager.setActiveDatabase('/data/a.cdb');
    manager.setActiveDatabase(null);
    manager.setActiveDatabase('/data/a.cdb');
    manager.closeDatabase('/data/a.cdb');

    expect(events).toEqual(['/data/a.cdb', null, '/data/a.cdb', null]);
  });

  it('closeDatabase removes the database, fires an event, and is idempotent', async () => {
    const manager = new NcdbManager(async () => buildCdbBytes());
    const closed: string[] = [];
    manager.onDatabaseClosed.subscribe((path) => closed.push(path));

    await manager.openDatabase('/data/close.cdb');
    manager.closeDatabase('/data/close.cdb');
    manager.closeDatabase('/data/close.cdb');

    expect(manager.isOpen('/data/close.cdb')).toBe(false);
    expect(manager.getOpenDatabases()).toEqual([]);
    expect(closed).toEqual(['/data/close.cdb']);
  });

  it('closeAll closes all databases and fires onDatabaseClosed for each', async () => {
    const manager = new NcdbManager(async (path) => buildCdbBytes(path.endsWith('a.cdb') ? buildFullCoverageDb() : buildZeroCoverageDb()));
    const closed: string[] = [];
    manager.onDatabaseClosed.subscribe((path) => closed.push(path));

    await manager.openDatabase('/data/a.cdb');
    await manager.openDatabase('/data/b.cdb');
    manager.closeAll();

    expect(manager.getOpenDatabases()).toEqual([]);
    expect(closed).toEqual(['/data/a.cdb', '/data/b.cdb']);
  });

  it('refreshDatabase reloads an open database and updates the active database object', async () => {
    let callCount = 0;
    const manager = new NcdbManager(async () => {
      callCount += 1;
      return callCount === 1 ? buildCdbBytes(buildZeroCoverageDb()) : buildCdbBytes(buildFullCoverageDb());
    });
    const activeEvents: Array<string | null> = [];
    manager.onActiveDatabaseChanged.subscribe((value) => activeEvents.push(value));

    await manager.openDatabase('/data/refresh.cdb');
    manager.setActiveDatabase('/data/refresh.cdb');
    const before = manager.getActiveDatabase();

    await manager.refreshDatabase('/data/refresh.cdb');
    const after = manager.getActiveDatabase();

    expect(callCount).toBe(2);
    expect(before).not.toBe(after);
    expect(after).not.toBeNull();
    expect(computeAggregateStats(after!, DEFAULT_FILTER_OPTIONS).percentage).toBe(100);
    expect(activeEvents).toEqual(['/data/refresh.cdb', '/data/refresh.cdb']);
  });

  it('refreshDatabase is a no-op for a path that is not open', async () => {
    let callCount = 0;
    const manager = new NcdbManager(async () => {
      callCount += 1;
      return buildCdbBytes();
    });

    await manager.refreshDatabase('/data/missing.cdb');

    expect(callCount).toBe(0);
  });

  it('fires onDatabaseOpened for each successful open', async () => {
    const manager = new NcdbManager(async () => buildCdbBytes());
    const opened: string[] = [];
    manager.onDatabaseOpened.subscribe((path) => opened.push(path));

    await manager.openDatabase('/data/a.cdb');
    await manager.openDatabase('/data/a.cdb');

    expect(opened).toEqual(['/data/a.cdb', '/data/a.cdb']);
  });
});
