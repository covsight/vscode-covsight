import * as vscode from 'vscode';
import { TestplanNode, TestpointCoverage, computeTestpointCoverages } from '../model/index.js';
import { DatabaseManager } from '../providers/database-manager.js';
import { TestplanManager } from '../providers/testplan-manager.js';
import { renderGoalDetail, renderTestpointDetail } from './html/testplan-detail.js';
import { WebviewPanelManager } from './webview-base.js';

export class TestplanPanel extends WebviewPanelManager {
    private static instance: TestplanPanel | undefined;

    private constructor(context: vscode.ExtensionContext) {
        super(context, 'covsight.testplanDetail', 'Testplan Detail');
    }

    public static getInstance(context: vscode.ExtensionContext): TestplanPanel {
        if (!TestplanPanel.instance) {
            TestplanPanel.instance = new TestplanPanel(context);
        }
        return TestplanPanel.instance;
    }

    showNode(node: TestplanNode, dbManager: DatabaseManager, testplanManager: TestplanManager): void {
        const plan = testplanManager.getActivePlan();
        const ucis = dbManager.getActiveDatabase();
        let coverage: TestpointCoverage | null = null;

        if (plan && ucis && node.kind === 'testpoint') {
            const coverages = computeTestpointCoverages(plan, ucis, dbManager.getFilterOptions());
            coverage = coverages.find((entry) => entry.testpoint.name === node.label) ?? null;
        }

        const html = node.kind === 'testpoint'
            ? renderTestpointDetail(node, coverage)
            : renderGoalDetail(node);

        this.showPanel(html, `${node.kind === 'testpoint' ? 'Testpoint' : 'Goal'}: ${node.label}`);
    }

    update(data: unknown): void {
        void data;
    }
}
