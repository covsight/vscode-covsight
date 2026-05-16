import * as path from 'path';
import * as vscode from 'vscode';

export class TestplanDiscovery implements vscode.Disposable {
    private testplans: Set<string> = new Set();
    private watcher: vscode.FileSystemWatcher | undefined;
    private readonly _onTestplansChanged = new vscode.EventEmitter<void>();
    readonly onTestplansChanged: vscode.Event<void> = this._onTestplansChanged.event;

    constructor(private readonly context: vscode.ExtensionContext) {}

    async activate(): Promise<void> {
        await this.scanWorkspace();
        this.setupWatcher();
    }

    async scanWorkspace(): Promise<void> {
        const patterns = ['**/*.testplan', '**/*testplan*.yaml', '**/*testplan*.yml'];
        const discovered = new Set<string>();

        for (const pattern of patterns) {
            const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**');
            for (const file of files) {
                discovered.add(file.fsPath);
            }
        }

        if (!setsEqual(this.testplans, discovered)) {
            this.testplans = discovered;
            this._onTestplansChanged.fire();
        }
    }

    getTestplans(): string[] {
        return Array.from(this.testplans).sort((lhs, rhs) => lhs.localeCompare(rhs));
    }

    addTestplan(filePath: string): void {
        if (!this.testplans.has(filePath)) {
            this.testplans.add(filePath);
            this._onTestplansChanged.fire();
        }
    }

    removeTestplan(filePath: string): void {
        if (this.testplans.delete(filePath)) {
            this._onTestplansChanged.fire();
        }
    }

    dispose(): void {
        this.watcher?.dispose();
        this.watcher = undefined;
        this._onTestplansChanged.dispose();
    }

    private setupWatcher(): void {
        this.watcher = vscode.workspace.createFileSystemWatcher('**/*');

        this.watcher.onDidCreate((uri) => {
            if (!isTestplanPath(uri.fsPath)) {
                return;
            }
            this.addTestplan(uri.fsPath);
        });

        this.watcher.onDidDelete((uri) => {
            if (!isTestplanPath(uri.fsPath)) {
                return;
            }
            this.removeTestplan(uri.fsPath);
        });

        this.watcher.onDidChange((uri) => {
            if (!isTestplanPath(uri.fsPath)) {
                return;
            }
            this._onTestplansChanged.fire();
        });

        this.context.subscriptions.push(this.watcher);
    }
}

function isTestplanPath(filePath: string): boolean {
    const fileName = path.basename(filePath);
    return fileName.endsWith('.testplan') || /testplan.*\.(ya?ml)$/i.test(fileName);
}

function setsEqual(lhs: Set<string>, rhs: Set<string>): boolean {
    if (lhs.size !== rhs.size) {
        return false;
    }
    for (const value of lhs) {
        if (!rhs.has(value)) {
            return false;
        }
    }
    return true;
}
