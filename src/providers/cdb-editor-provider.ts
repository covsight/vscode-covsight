import * as path from 'path';
import * as vscode from 'vscode';
import { DatabaseManager } from './database-manager.js';
import { buildDashboardHtml } from '../views/coverage-dashboard.js';

/**
 * Custom read-only editor for `.cdb` files.
 * When a user opens a `.cdb` in VS Code (click, drag, etc.) this provider
 * intercepts the open, loads the database via DatabaseManager, and renders
 * the coverage dashboard directly in the editor tab.
 */
export class CdbEditorProvider implements vscode.CustomReadonlyEditorProvider<vscode.CustomDocument> {
    static readonly viewType = 'covsight.cdbEditor';

    constructor(private readonly manager: DatabaseManager) {}

    openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
        return { uri, dispose: () => {} };
    }

    async resolveCustomEditor(
        document: vscode.CustomDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken,
    ): Promise<void> {
        webviewPanel.webview.options = { enableScripts: false };
        const dbPath = document.uri.fsPath;
        const dbName = path.basename(dbPath);

        webviewPanel.webview.html = loadingHtml(dbName);

        // openDatabase already sets the active database on success
        const ok = await this.manager.openDatabase(dbPath);
        if (!ok) {
            webviewPanel.webview.html = errorHtml(dbName);
            return;
        }

        const ucis = this.manager.getActiveDatabase();
        if (!ucis) {
            webviewPanel.webview.html = errorHtml(dbName);
            return;
        }

        const opts = this.manager.getFilterOptions();
        webviewPanel.webview.html = buildDashboardHtml(ucis, dbPath, opts);

        // Mirror the Coverage Hierarchy view to whichever .cdb tab is active.
        // When the user switches between open .cdb tabs, this fires and updates
        // the active database so the Coverage Tree, decorations, etc. follow.
        webviewPanel.onDidChangeViewState((e) => {
            if (e.webviewPanel.active) {
                this.manager.setActiveDatabase(dbPath);
            }
        });
    }
}

function loadingHtml(name: string): string {
    return `<!DOCTYPE html><html><body style="font-family:var(--vscode-font-family);padding:20px">
<p>Loading <strong>${escapeHtml(name)}</strong>…</p></body></html>`;
}

function errorHtml(name: string): string {
    return `<!DOCTYPE html><html><body style="font-family:var(--vscode-font-family);padding:20px;color:var(--vscode-errorForeground)">
<p>Failed to open <strong>${escapeHtml(name)}</strong>. Check the Output panel for details.</p></body></html>`;
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
