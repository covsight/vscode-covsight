import * as path from 'path';
import * as vscode from 'vscode';
import { MemUCIS } from '@covsight/core';
import { DEFAULT_FILTER_OPTIONS, FilterOptions, NcdbManager, PathMapper } from '../model/index.js';

export class DatabaseManager implements vscode.Disposable {
    private readonly ncdbManager: NcdbManager;
    private readonly _onActiveDatabaseChanged = new vscode.EventEmitter<string | null>();
    private readonly _onDatabaseOpened = new vscode.EventEmitter<string>();
    private readonly _onDatabaseClosed = new vscode.EventEmitter<string>();
    private readonly unsubscribers: Array<() => void> = [];

    readonly onActiveDatabaseChanged: vscode.Event<string | null> = this._onActiveDatabaseChanged.event;
    readonly onDatabaseOpened: vscode.Event<string> = this._onDatabaseOpened.event;
    readonly onDatabaseClosed: vscode.Event<string> = this._onDatabaseClosed.event;

    constructor() {
        const loader = async (filePath: string): Promise<Uint8Array> => {
            const uri = vscode.Uri.file(filePath);
            return vscode.workspace.fs.readFile(uri);
        };

        this.ncdbManager = new NcdbManager(loader);
        this.unsubscribers.push(
            this.ncdbManager.onActiveDatabaseChanged.subscribe((dbPath) => this._onActiveDatabaseChanged.fire(dbPath)),
            this.ncdbManager.onDatabaseOpened.subscribe((dbPath) => this._onDatabaseOpened.fire(dbPath)),
            this.ncdbManager.onDatabaseClosed.subscribe((dbPath) => this._onDatabaseClosed.fire(dbPath)),
        );
    }

    async openDatabase(dbPath: string): Promise<boolean> {
        try {
            if (this.ncdbManager.isOpen(dbPath)) {
                this.ncdbManager.setActiveDatabase(dbPath);
                vscode.window.showInformationMessage(`Database already open: ${path.basename(dbPath)}`);
                return true;
            }

            await this.ncdbManager.openDatabase(dbPath);
            this.ncdbManager.setActiveDatabase(dbPath);
            vscode.window.showInformationMessage(`Opened database: ${path.basename(dbPath)}`);
            return true;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(message);
            return false;
        }
    }

    closeDatabase(dbPath: string): void {
        this.ncdbManager.closeDatabase(dbPath);
    }

    async refreshDatabase(dbPath: string): Promise<void> {
        try {
            await this.ncdbManager.refreshDatabase(dbPath);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(message);
            throw err;
        }
    }

    setActiveDatabase(dbPath: string | null): void {
        try {
            this.ncdbManager.setActiveDatabase(dbPath);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(message);
        }
    }

    getActiveDatabase(): MemUCIS | null {
        return this.ncdbManager.getActiveDatabase();
    }

    getActiveDatabasePath(): string | null {
        return this.ncdbManager.getActiveDatabasePath();
    }

    getOpenDatabases(): string[] {
        return this.ncdbManager.getOpenDatabases();
    }

    isOpen(dbPath: string): boolean {
        return this.ncdbManager.isOpen(dbPath);
    }

    closeAll(): void {
        this.ncdbManager.closeAll();
    }

    getFilterOptions(): FilterOptions {
        const config = vscode.workspace.getConfiguration('covsight');
        return {
            excludeIgnoredBins: config.get<boolean>('excludeIgnoredBins', DEFAULT_FILTER_OPTIONS.excludeIgnoredBins),
            excludeIllegalBins: config.get<boolean>('excludeIllegalBins', DEFAULT_FILTER_OPTIONS.excludeIllegalBins),
            coverageGoal: config.get<number>('coverageGoal', DEFAULT_FILTER_OPTIONS.coverageGoal),
        };
    }

    getPathMapper(): PathMapper {
        const config = vscode.workspace.getConfiguration('covsight');
        const mappings = config.get<Record<string, string>>('pathMappings', {});
        return PathMapper.fromConfig(mappings);
    }

    dispose(): void {
        this.ncdbManager.closeAll();
        for (const unsubscribe of this.unsubscribers) {
            unsubscribe();
        }
        this._onActiveDatabaseChanged.dispose();
        this._onDatabaseOpened.dispose();
        this._onDatabaseClosed.dispose();
    }
}
