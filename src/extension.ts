import * as path from 'path';
import * as vscode from 'vscode';
import {
    computeTestpointCoverages,
    CoverageNode,
    CoverageSourceModel,
    findUnboundScopes,
    TestplanNode,
} from './model/index.js';
import { ToggleDecorationProvider } from './decorations/coverage-decoration-provider.js';
import { CoverageTreeProvider } from './providers/coverage-tree-provider.js';
import { CoveragePublisher } from './providers/coverage-publisher.js';
import { DatabaseDiscovery } from './providers/database-discovery.js';
import { DatabaseListProvider, DatabaseItem } from './providers/database-list-provider.js';
import { DatabaseManager } from './providers/database-manager.js';
import { TestplanDiscovery } from './providers/testplan-discovery.js';
import { TestplanManager } from './providers/testplan-manager.js';
import { TestplanTreeProvider } from './providers/testplan-tree-provider.js';
import { CdbEditorProvider } from './providers/cdb-editor-provider.js';
import { CoverageDashboard } from './views/coverage-dashboard.js';
import { CoverageDetailPanel } from './views/coverage-detail-panel.js';
import { TestplanPanel } from './views/testplan-panel.js';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    console.log('CovSight Explorer is now active');

    const discovery = new DatabaseDiscovery(context);
    const manager = new DatabaseManager();
    const databaseListProvider = new DatabaseListProvider(discovery, manager);
    const coverageTreeProvider = new CoverageTreeProvider(manager);
    const publisher = new CoveragePublisher(manager);
    const decorationProvider = new ToggleDecorationProvider(manager);
    const dashboard = CoverageDashboard.getInstance(context);
    const detailPanel = CoverageDetailPanel.getInstance(context);
    const testplanDiscovery = new TestplanDiscovery(context);
    const testplanManager = new TestplanManager();
    const testplanTreeProvider = new TestplanTreeProvider(testplanManager, manager);
    const testplanPanel = TestplanPanel.getInstance(context);

    const publishActiveCoverage = (): void => {
        const ucis = manager.getActiveDatabase();
        if (!ucis) {
            publisher.publish([]);
            return;
        }

        const sourceModel = new CoverageSourceModel(manager.getPathMapper());
        publisher.publish(sourceModel.buildFileCoverages(ucis));
    };

    manager.onActiveDatabaseChanged(() => publishActiveCoverage());

    const databaseTreeView = vscode.window.createTreeView('covsight.databases', {
        treeDataProvider: databaseListProvider,
        showCollapseAll: false,
    });
    const coverageTreeView = vscode.window.createTreeView('covsight.coverage', {
        treeDataProvider: coverageTreeProvider,
        showCollapseAll: true,
    });
    const testplanTreeView = vscode.window.createTreeView('covsight.testplan', {
        treeDataProvider: testplanTreeProvider,
        showCollapseAll: true,
    });

    context.subscriptions.push(
        databaseTreeView,
        coverageTreeView,
        testplanTreeView,
        manager,
        databaseListProvider,
        coverageTreeProvider,
        publisher,
        decorationProvider,
        testplanDiscovery,
        testplanManager,
        testplanTreeProvider,
        { dispose: () => discovery.deactivate() },
        vscode.window.registerCustomEditorProvider(
            CdbEditorProvider.viewType,
            new CdbEditorProvider(manager),
            { webviewOptions: { retainContextWhenHidden: true } },
        ),
    );

    await discovery.activate();
    await testplanDiscovery.activate();

    const defaultFilter = vscode.workspace.getConfiguration('covsight').get<'all' | 'covered' | 'uncovered'>('defaultFilter', 'all');
    coverageTreeProvider.setFilter(defaultFilter);

    const openDatabaseCmd = vscode.commands.registerCommand('covsight.openDatabase', async () => {
        const fileUris = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: {
                'UCIS Database': ['cdb'],
                'All Files': ['*'],
            },
            title: 'Open UCIS Coverage Database',
        });

        const fileUri = fileUris?.[0];
        if (!fileUri) {
            return;
        }

        const dbPath = fileUri.fsPath;
        const success = await manager.openDatabase(dbPath);
        if (success) {
            discovery.addDatabase(dbPath);
        }
    });

    const activateDatabaseCmd = vscode.commands.registerCommand('covsight.activateDatabase', async (arg?: string | DatabaseItem) => {
        const dbPath = extractDbPath(arg);
        if (!dbPath) {
            return;
        }

        if (manager.isOpen(dbPath)) {
            manager.setActiveDatabase(dbPath);
        } else {
            const success = await manager.openDatabase(dbPath);
            if (success) {
                discovery.addDatabase(dbPath);
            }
        }
    });

    const refreshDatabaseCmd = vscode.commands.registerCommand('covsight.refreshDatabase', async (arg?: string | DatabaseItem) => {
        const dbPath = extractDbPath(arg) ?? manager.getActiveDatabasePath();
        if (!dbPath) {
            vscode.window.showWarningMessage('No active database to refresh.');
            return;
        }

        await manager.refreshDatabase(dbPath);
        if (manager.getActiveDatabasePath() === dbPath) {
            publishActiveCoverage();
            testplanTreeProvider.refresh();
        }
        vscode.window.showInformationMessage(`Refreshed database: ${path.basename(dbPath)}`);
    });

    const rescanWorkspaceCmd = vscode.commands.registerCommand('covsight.rescanWorkspace', async () => {
        await discovery.scanWorkspace();
        vscode.window.showInformationMessage('Workspace scanned for databases');
    });

    const closeDatabaseCmd = vscode.commands.registerCommand('covsight.closeDatabase', async (arg?: string | DatabaseItem) => {
        const dbPath = extractDbPath(arg) ?? manager.getActiveDatabasePath();
        if (!dbPath) {
            vscode.window.showWarningMessage('No database selected to close.');
            return;
        }

        manager.closeDatabase(dbPath);
        vscode.window.showInformationMessage(`Closed database: ${path.basename(dbPath)}`);
    });

    const showDashboardCmd = vscode.commands.registerCommand('covsight.showDashboard', async () => {
        const ucis = manager.getActiveDatabase();
        const dbPath = manager.getActiveDatabasePath();
        if (!ucis || !dbPath) {
            vscode.window.showWarningMessage('No active database. Please open a database first.');
            return;
        }

        const plan = testplanManager.getActivePlan();
        const testpointCoverages = plan
            ? computeTestpointCoverages(plan, ucis, manager.getFilterOptions())
            : undefined;
        dashboard.showDashboard(ucis, path.basename(dbPath), manager, testpointCoverages);
    });

    const showUncoveredCmd = vscode.commands.registerCommand('covsight.showUncovered', async () => {
        if (!manager.getActiveDatabase()) {
            vscode.window.showWarningMessage('No active database. Please open a database first.');
            return;
        }
        coverageTreeProvider.setFilter('uncovered');
    });

    const showAllCmd = vscode.commands.registerCommand('covsight.showAll', async () => {
        coverageTreeProvider.setFilter('all');
    });

    const showCoveredCmd = vscode.commands.registerCommand('covsight.showCovered', async () => {
        if (!manager.getActiveDatabase()) {
            vscode.window.showWarningMessage('No active database. Please open a database first.');
            return;
        }
        coverageTreeProvider.setFilter('covered');
    });

    const refreshCoverageCmd = vscode.commands.registerCommand('covsight.refreshCoverage', async () => {
        coverageTreeProvider.refresh();
        testplanTreeProvider.refresh();
        publishActiveCoverage();
    });

    const showScopeDetailCmd = vscode.commands.registerCommand('covsight.showScopeDetail', async (node: CoverageNode | undefined) => {
        if (!node) {
            return;
        }
        detailPanel.showNode(node, manager);
    });

    const toggleDecorationsCmd = vscode.commands.registerCommand('covsight.toggleDecorations', async () => {
        decorationProvider.toggle();
        vscode.window.showInformationMessage(`Source decorations ${decorationProvider.isEnabled() ? 'enabled' : 'disabled'}`);
    });

    const enableDecorationsCmd = vscode.commands.registerCommand('covsight.enableDecorations', async () => {
        decorationProvider.enable();
        vscode.window.showInformationMessage('Source decorations enabled');
    });

    const disableDecorationsCmd = vscode.commands.registerCommand('covsight.disableDecorations', async () => {
        decorationProvider.disable();
        vscode.window.showInformationMessage('Source decorations disabled');
    });

    const openTestplanCmd = vscode.commands.registerCommand('covsight.openTestplan', async (uri?: vscode.Uri) => {
        const fileUri = uri ?? (await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectMany: false,
            filters: {
                'CovSight Testplan': ['testplan', 'yaml', 'yml'],
                'All Files': ['*'],
            },
            title: 'Open CovSight Testplan',
        }))?.[0];

        if (!fileUri) {
            return;
        }

        const success = await testplanManager.openTestplan(fileUri.fsPath);
        if (success) {
            testplanDiscovery.addTestplan(fileUri.fsPath);
        }
    });

    const closeTestplanCmd = vscode.commands.registerCommand('covsight.closeTestplan', async () => {
        testplanManager.closeTestplan();
    });

    const rescanTestplansCmd = vscode.commands.registerCommand('covsight.rescanTestplans', async () => {
        await testplanDiscovery.scanWorkspace();
        vscode.window.showInformationMessage('Workspace scanned for testplans');
    });

    const showUnboundCoverageCmd = vscode.commands.registerCommand('covsight.showUnboundCoverage', async () => {
        const ucis = manager.getActiveDatabase();
        const plan = testplanManager.getActivePlan();
        if (!ucis) {
            vscode.window.showWarningMessage('No active database.');
            return;
        }
        if (!plan) {
            vscode.window.showWarningMessage('No active testplan.');
            return;
        }

        const unbound = findUnboundScopes(ucis, plan);
        if (unbound.length === 0) {
            vscode.window.showInformationMessage('All coverage scopes are bound to testpoints.');
            return;
        }

        const items = unbound.map((entry) => ({
            label: entry.scopePath,
            description: entry.scope.logicalName,
        }));
        await vscode.window.showQuickPick(items, {
            placeHolder: `${unbound.length} unbound scope(s)`,
            canPickMany: false,
        });
    });

    const showTestpointDetailCmd = vscode.commands.registerCommand('covsight.showTestpointDetail', async (node?: TestplanNode) => {
        if (!node) {
            return;
        }
        testplanPanel.showNode(node, manager, testplanManager);
    });

    const configListener = vscode.workspace.onDidChangeConfiguration((event) => {
        if (
            event.affectsConfiguration('covsight.pathMappings') ||
            event.affectsConfiguration('covsight.excludeIgnoredBins') ||
            event.affectsConfiguration('covsight.excludeIllegalBins') ||
            event.affectsConfiguration('covsight.coverageGoal')
        ) {
            coverageTreeProvider.refresh();
            testplanTreeProvider.refresh();
            publishActiveCoverage();
        }
        if (event.affectsConfiguration('covsight.defaultFilter')) {
            const nextFilter = vscode.workspace.getConfiguration('covsight').get<'all' | 'covered' | 'uncovered'>('defaultFilter', 'all');
            coverageTreeProvider.setFilter(nextFilter);
        }
    });

    const yamlNoticeKey = 'covsight.yamlNoticeShown';
    const openDocListener = vscode.workspace.onDidOpenTextDocument(async (doc) => {
        if (doc.uri.scheme !== 'file') {
            return;
        }

        const name = path.basename(doc.fileName);
        const isTestplan = name.endsWith('.testplan') || /testplan.*\.(ya?ml)$/i.test(name);
        if (!isTestplan) {
            return;
        }

        const shown = context.workspaceState.get<boolean>(yamlNoticeKey, false);
        if (!shown) {
            const yamlExt = vscode.extensions.getExtension('redhat.vscode-yaml');
            if (!yamlExt) {
                await context.workspaceState.update(yamlNoticeKey, true);
                const choice = await vscode.window.showInformationMessage(
                    'Install the YAML extension by Red Hat for IntelliSense in CovSight testplan files.',
                    'Install',
                    'Dismiss',
                );
                if (choice === 'Install') {
                    void vscode.commands.executeCommand('workbench.extensions.installExtension', 'redhat.vscode-yaml');
                }
            }
        }

        if (testplanManager.getActivePath() === doc.fileName) {
            return;
        }

        const choice = await vscode.window.showInformationMessage(
            `Load CovSight testplan ${name}?`,
            'Load',
            'Dismiss',
        );
        if (choice === 'Load') {
            const success = await testplanManager.openTestplan(doc.fileName);
            if (success) {
                testplanDiscovery.addTestplan(doc.fileName);
            }
        }
    });

    context.subscriptions.push(
        openDatabaseCmd,
        activateDatabaseCmd,
        refreshDatabaseCmd,
        rescanWorkspaceCmd,
        closeDatabaseCmd,
        showDashboardCmd,
        showUncoveredCmd,
        showAllCmd,
        showCoveredCmd,
        refreshCoverageCmd,
        showScopeDetailCmd,
        toggleDecorationsCmd,
        enableDecorationsCmd,
        disableDecorationsCmd,
        openTestplanCmd,
        closeTestplanCmd,
        rescanTestplansCmd,
        showUnboundCoverageCmd,
        showTestpointDetailCmd,
        configListener,
        openDocListener,
    );

    console.log('CovSight Explorer ready!');
}

export function deactivate(): void {
    console.log('CovSight Explorer is now deactivated');
}

function extractDbPath(arg?: string | DatabaseItem): string | undefined {
    if (typeof arg === 'string') {
        return arg;
    }
    return arg?.dbPath;
}
