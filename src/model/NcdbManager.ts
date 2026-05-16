import { MemUCIS, NcdbReader } from '@covsight/core';
import { SimpleEvent } from './SimpleEvent.js';

/**
 * Async loader used to fetch raw database bytes from disk or another source.
 */
export type ByteLoader = (path: string) => Promise<Uint8Array>;

/**
 * Tracks open NCDB databases and the currently active database selection.
 */
export class NcdbManager {
  readonly onActiveDatabaseChanged = new SimpleEvent<string | null>();
  readonly onDatabaseOpened = new SimpleEvent<string>();
  readonly onDatabaseClosed = new SimpleEvent<string>();

  private readonly databases = new Map<string, MemUCIS>();
  private activeDatabasePath: string | null = null;

  constructor(private loadBytes: ByteLoader) {}

  /**
   * Opens or reopens a database and stores it under its path key.
   *
   * Reopening the same path replaces the cached database instance. If that path
   * is already active, listeners are notified so downstream views refresh.
   */
  async openDatabase(path: string): Promise<MemUCIS> {
    const database = await this.readDatabase(path);
    this.databases.set(path, database);
    this.onDatabaseOpened.fire(path);
    if (this.activeDatabasePath === path) {
      this.onActiveDatabaseChanged.fire(path);
    }
    return database;
  }

  /**
   * Closes one database if it is currently open.
   *
   * Closing the active database clears the active selection and emits both close
   * and active-change events.
   */
  closeDatabase(path: string): void {
    if (!this.databases.delete(path)) {
      return;
    }

    this.onDatabaseClosed.fire(path);
    if (this.activeDatabasePath === path) {
      this.activeDatabasePath = null;
      this.onActiveDatabaseChanged.fire(null);
    }
  }

  /**
   * Closes every open database.
   */
  closeAll(): void {
    for (const path of [...this.databases.keys()]) {
      this.closeDatabase(path);
    }
  }

  /**
   * Reloads an already-open database from the original path.
   *
   * Missing paths are ignored so callers can refresh optimistically.
   */
  async refreshDatabase(path: string): Promise<void> {
    if (!this.databases.has(path)) {
      return;
    }

    const database = await this.readDatabase(path);
    this.databases.set(path, database);
    if (this.activeDatabasePath === path) {
      this.onActiveDatabaseChanged.fire(path);
    }
  }

  /**
   * Selects the active database by path or clears the selection with {@code null}.
   *
   * Attempting to activate a database that is not open throws so callers do not
   * silently point the UI at missing state.
   */
  setActiveDatabase(path: string | null): void {
    if (path !== null && !this.databases.has(path)) {
      throw new Error(`Database is not open: ${path}`);
    }
    if (this.activeDatabasePath === path) {
      return;
    }
    this.activeDatabasePath = path;
    this.onActiveDatabaseChanged.fire(path);
  }

  /**
   * Returns the active database instance, or {@code null} when none is selected.
   */
  getActiveDatabase(): MemUCIS | null {
    if (this.activeDatabasePath === null) {
      return null;
    }
    return this.databases.get(this.activeDatabasePath) ?? null;
  }

  /**
   * Returns the path of the currently active database.
   */
  getActiveDatabasePath(): string | null {
    return this.activeDatabasePath;
  }

  /**
   * Lists open database paths in insertion order.
   */
  getOpenDatabases(): string[] {
    return [...this.databases.keys()];
  }

  /**
   * Checks whether the given path has already been opened.
   */
  isOpen(path: string): boolean {
    return this.databases.has(path);
  }

  private async readDatabase(path: string): Promise<MemUCIS> {
    try {
      const bytes = await this.loadBytes(path);
      return await new NcdbReader().readFromBytes(bytes);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to open database "${path}": ${message}`);
    }
  }
}
