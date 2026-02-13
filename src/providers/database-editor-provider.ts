import * as vscode from 'vscode';
import { DatabaseManager } from './database-manager';
import { DatabaseDiscovery } from './database-discovery';
import * as path from 'path';

/**
 * Custom editor provider for .cdb files
 * Opens the database in the coverage explorer instead of binary editor
 */
export class DatabaseEditorProvider implements vscode.CustomReadonlyEditorProvider {
    constructor(
        private readonly manager: DatabaseManager,
        private readonly discovery: DatabaseDiscovery
    ) {}

    async openCustomDocument(
        uri: vscode.Uri,
        _openContext: vscode.CustomDocumentOpenContext,
        _token: vscode.CancellationToken
    ): Promise<vscode.CustomDocument> {
        // Open the database in the manager
        const dbPath = uri.fsPath;
        const success = await this.manager.openDatabase(dbPath);
        
        if (success) {
            // Make sure discovery knows about this database
            this.discovery.addDatabase(dbPath);
            
            // Show info message
            const dbName = path.basename(dbPath);
            vscode.window.showInformationMessage(
                `Opened database: ${dbName}`,
                'Show Dashboard'
            ).then(selection => {
                if (selection === 'Show Dashboard') {
                    vscode.commands.executeCommand('pyucis.showDashboard');
                }
            });
        } else {
            vscode.window.showErrorMessage(`Failed to open database: ${path.basename(dbPath)}`);
        }

        // Return a minimal document object
        return {
            uri,
            dispose: () => {
                // Optional: close database when document is disposed
                // this.manager.closeDatabase(dbPath);
            }
        };
    }

    async resolveCustomEditor(
        document: vscode.CustomDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        const dbPath = document.uri.fsPath;
        const dbName = path.basename(dbPath);
        
        // Get database info
        const db = this.manager.getDatabase(dbPath);
        const queries = this.manager.getQueries(dbPath);
        
        let coverageSummary = 'Loading...';
        if (db && queries) {
            try {
                const rootScopes = queries.getRootScopes();
                const scopeCount = rootScopes.length;
                coverageSummary = `${scopeCount} root scope(s)`;
            } catch (error) {
                coverageSummary = 'Error loading database';
            }
        }

        // Set webview content showing database info
        webviewPanel.webview.html = this.getHtmlContent(dbName, dbPath, coverageSummary);

        // Handle messages from webview
        webviewPanel.webview.onDidReceiveMessage(message => {
            switch (message.command) {
                case 'showDashboard':
                    vscode.commands.executeCommand('pyucis.showDashboard');
                    break;
                case 'showCoverage':
                    // Focus on the coverage tree view
                    vscode.commands.executeCommand('pyucis.coverage.focus');
                    break;
            }
        });
    }

    private getHtmlContent(dbName: string, dbPath: string, summary: string): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>UCIS Database</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            padding: 20px;
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
        }
        .header {
            margin-bottom: 30px;
        }
        h1 {
            margin: 0 0 10px 0;
            font-size: 24px;
        }
        .subtitle {
            color: var(--vscode-descriptionForeground);
            font-size: 14px;
            margin-bottom: 5px;
        }
        .info-section {
            background: var(--vscode-editor-inactiveSelectionBackground);
            padding: 15px;
            border-radius: 4px;
            margin-bottom: 20px;
        }
        .info-row {
            display: flex;
            margin-bottom: 8px;
        }
        .info-label {
            font-weight: bold;
            width: 120px;
        }
        .info-value {
            flex: 1;
            font-family: var(--vscode-editor-font-family);
        }
        .actions {
            display: flex;
            gap: 10px;
            margin-top: 20px;
        }
        button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            cursor: pointer;
            border-radius: 2px;
            font-size: 13px;
        }
        button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        .icon {
            margin-right: 6px;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>📊 ${dbName}</h1>
        <div class="subtitle">UCIS Coverage Database</div>
    </div>

    <div class="info-section">
        <div class="info-row">
            <span class="info-label">File Path:</span>
            <span class="info-value">${dbPath}</span>
        </div>
        <div class="info-row">
            <span class="info-label">Contents:</span>
            <span class="info-value">${summary}</span>
        </div>
    </div>

    <p>Use the PyUCIS views in the Explorer sidebar to navigate the coverage data.</p>

    <div class="actions">
        <button onclick="showDashboard()">
            <span class="icon">📈</span>
            Show Dashboard
        </button>
        <button onclick="showCoverage()">
            <span class="icon">📂</span>
            Show Coverage Tree
        </button>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        function showDashboard() {
            vscode.postMessage({ command: 'showDashboard' });
        }
        
        function showCoverage() {
            vscode.postMessage({ command: 'showCoverage' });
        }
    </script>
</body>
</html>`;
    }
}
