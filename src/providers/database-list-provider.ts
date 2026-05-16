import * as path from 'path';
import * as vscode from 'vscode';
import { DatabaseDiscovery } from './database-discovery.js';
import { DatabaseManager } from './database-manager.js';

export class DatabaseItem extends vscode.TreeItem {
    constructor(
        readonly dbPath: string,
        readonly isOpen: boolean,
        readonly isActive: boolean,
    ) {
        super(path.basename(dbPath), vscode.TreeItemCollapsibleState.None);

        this.contextValue = 'database';
        this.tooltip = dbPath;
        this.description = isActive ? '(active)' : (isOpen ? '(open)' : '');
        this.iconPath = new vscode.ThemeIcon(isActive ? 'database' : (isOpen ? 'circle-filled' : 'circle-outline'));
        this.command = {
            command: 'covsight.activateDatabase',
            title: 'Activate Database',
            arguments: [dbPath],
        };
    }
}

export class DatabaseListProvider implements vscode.TreeDataProvider<DatabaseItem>, vscode.Disposable {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<DatabaseItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    private readonly subscriptions: vscode.Disposable[] = [];

    constructor(
        private readonly discovery: DatabaseDiscovery,
        private readonly manager: DatabaseManager,
    ) {
        this.subscriptions.push(
            this.discovery.onDatabasesChanged(() => this.refresh()),
            this.manager.onActiveDatabaseChanged(() => this.refresh()),
            this.manager.onDatabaseOpened(() => this.refresh()),
            this.manager.onDatabaseClosed(() => this.refresh()),
        );
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: DatabaseItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: DatabaseItem): DatabaseItem[] {
        if (element) {
            return [];
        }

        const discovered = this.discovery.getDatabases();
        const open = this.manager.getOpenDatabases();
        const all = Array.from(new Set([...discovered, ...open])).sort((lhs, rhs) => lhs.localeCompare(rhs));
        const activePath = this.manager.getActiveDatabasePath();

        return all.map((dbPath) => new DatabaseItem(dbPath, this.manager.isOpen(dbPath), dbPath === activePath));
    }

    dispose(): void {
        this.subscriptions.forEach((subscription) => subscription.dispose());
        this._onDidChangeTreeData.dispose();
    }
}
