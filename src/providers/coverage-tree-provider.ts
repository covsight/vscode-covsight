import * as vscode from 'vscode';
import { CoverageFilter, CoverageNode, CoverageTreeModel } from '../model/index.js';
import { DatabaseManager } from './database-manager.js';

export class CoverageTreeProvider implements vscode.TreeDataProvider<CoverageNode>, vscode.Disposable {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<CoverageNode | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private currentFilter: CoverageFilter = 'all';
    private model: CoverageTreeModel | null = null;
    private readonly subscriptions: vscode.Disposable[] = [];

    constructor(private readonly manager: DatabaseManager) {
        this.subscriptions.push(
            manager.onActiveDatabaseChanged(() => this.rebuildModel()),
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (
                    event.affectsConfiguration('covsight.excludeIgnoredBins') ||
                    event.affectsConfiguration('covsight.excludeIllegalBins') ||
                    event.affectsConfiguration('covsight.coverageGoal')
                ) {
                    this.rebuildModel();
                }
            }),
        );
    }

    private rebuildModel(): void {
        const ucis = this.manager.getActiveDatabase();
        this.model = ucis ? new CoverageTreeModel(ucis, this.manager.getFilterOptions()) : null;
        this._onDidChangeTreeData.fire();
    }

    refresh(): void {
        this.rebuildModel();
    }

    setFilter(filter: CoverageFilter): void {
        this.currentFilter = filter;
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(node: CoverageNode): vscode.TreeItem {
        const item = new vscode.TreeItem(
            node.label,
            node.scope.numCoverChildren() > 0
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None,
        );

        item.id = node.nodeId;
        item.description = CoverageTreeModel.getNodeDescription(node);
        item.tooltip = CoverageTreeModel.getTooltip(node);
        item.iconPath = new vscode.ThemeIcon(
            CoverageTreeModel.getIconForScopeType(node.scopeType),
            node.stats.isMet
                ? new vscode.ThemeColor('testing.iconPassed')
                : node.stats.percentage > 0
                    ? new vscode.ThemeColor('testing.iconFailed')
                    : new vscode.ThemeColor('testing.iconErrored'),
        );
        item.contextValue = 'coverageNode';
        item.command = {
            command: 'covsight.showScopeDetail',
            title: 'Show Detail',
            arguments: [node],
        };

        return item;
    }

    getChildren(node?: CoverageNode): CoverageNode[] {
        if (!this.model) {
            return [];
        }

        return node ? this.model.getChildren(node, this.currentFilter) : this.model.getRoots(this.currentFilter);
    }

    dispose(): void {
        this.subscriptions.forEach((subscription) => subscription.dispose());
        this._onDidChangeTreeData.dispose();
    }
}
