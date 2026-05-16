import * as path from 'path';
import * as vscode from 'vscode';
import { ParsedTestplan, parseTestplan, resolveImports } from '../model/index.js';

const decoder = new TextDecoder('utf-8');

export class TestplanManager implements vscode.Disposable {
    private activePlan: ParsedTestplan | null = null;
    private activePath: string | null = null;
    private readonly _onActivePlanChanged = new vscode.EventEmitter<ParsedTestplan | null>();
    readonly onActivePlanChanged: vscode.Event<ParsedTestplan | null> = this._onActivePlanChanged.event;

    async openTestplan(filePath: string): Promise<boolean> {
        try {
            const source = await readTextFile(filePath);
            const parsed = parseTestplan(source, filePath);
            if (!parsed.ok) {
                vscode.window.showErrorMessage(`Failed to parse testplan ${path.basename(filePath)}: ${formatErrors(parsed.errors)}`);
                return false;
            }

            const resolved = await resolveImports(parsed.plan, async (importPath) => readTextFile(importPath));
            if (!resolved.ok) {
                vscode.window.showErrorMessage(`Failed to resolve testplan imports for ${path.basename(filePath)}: ${formatErrors(resolved.errors)}`);
                return false;
            }

            this.activePath = filePath;
            this.activePlan = resolved.plan;
            this._onActivePlanChanged.fire(this.activePlan);
            return true;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`Failed to open testplan ${path.basename(filePath)}: ${message}`);
            return false;
        }
    }

    closeTestplan(): void {
        this.activePlan = null;
        this.activePath = null;
        this._onActivePlanChanged.fire(null);
    }

    getActivePlan(): ParsedTestplan | null {
        return this.activePlan;
    }

    getActivePath(): string | null {
        return this.activePath;
    }

    dispose(): void {
        this._onActivePlanChanged.dispose();
    }
}

async function readTextFile(filePath: string): Promise<string> {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
    return decoder.decode(bytes);
}

function formatErrors(errors: Array<{ message: string; path?: string }>): string {
    return errors
        .map((error) => error.path ? `${error.path}: ${error.message}` : error.message)
        .join('; ');
}
