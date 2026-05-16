import * as vscode from 'vscode';
import { TestplanNode, TestplanTreeModel, computeTestpointCoverages } from '../model/index.js';
import { DatabaseManager } from './database-manager.js';
import { TestplanManager } from './testplan-manager.js';

export class TestplanTreeProvider implements vscode.TreeDataProvider<TestplanNode>, vscode.Disposable {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<TestplanNode | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    private model: TestplanTreeModel | null = null;
    private readonly subscriptions: vscode.Disposable[] = [];

    constructor(
        private readonly testplanManager: TestplanManager,
        private readonly dbManager: DatabaseManager,
    ) {
        this.subscriptions.push(
            testplanManager.onActivePlanChanged(() => this.rebuild()),
            dbManager.onActiveDatabaseChanged(() => this.rebuild()),
        );
    }

    refresh(): void {
        this.rebuild();
    }

    getTreeItem(node: TestplanNode): vscode.TreeItem {
        const item = new vscode.TreeItem(
            node.label,
            node.children.length > 0 || node.kind === 'plan' || node.kind === 'goal'
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None,
        );
        item.id = node.nodeId;
        item.contextValue = node.kind;
        item.description = TestplanTreeModel.getNodeDescription(node);
        item.tooltip = TestplanTreeModel.getTooltip(node);
        item.iconPath = new vscode.ThemeIcon(TestplanTreeModel.getIconForStatus(node.status));
        if (node.kind !== 'plan') {
            item.command = {
                command: 'covsight.showTestpointDetail',
                title: 'Show Detail',
                arguments: [node],
            };
        }
        return item;
    }

    getChildren(node?: TestplanNode): TestplanNode[] {
        if (!this.model) {
            return [];
        }
        if (!node) {
            return this.model.getRoots();
        }
        return this.model.getChildren(node);
    }

    dispose(): void {
        this.subscriptions.forEach((subscription) => subscription.dispose());
        this._onDidChangeTreeData.dispose();
    }

    private rebuild(): void {
        const plan = this.testplanManager.getActivePlan();
        if (!plan) {
            this.model = null;
            this._onDidChangeTreeData.fire();
            return;
        }

        const ucis = this.dbManager.getActiveDatabase();
        const coverages = ucis
            ? computeTestpointCoverages(plan, ucis, this.dbManager.getFilterOptions())
            : null;

        this.model = new TestplanTreeModel(plan, coverages);
        this._onDidChangeTreeData.fire();
    }
}
