import * as path from 'path';
import * as vscode from 'vscode';
import { MemUCIS } from '@covsight/core';
import { computeAggregateStats, computeStatsByType, getUncoveredHotspots, FilterOptions, TestpointCoverage } from '../model/index.js';
import { DatabaseManager } from '../providers/database-manager.js';
import { renderByTypeTable, renderHotspotsTable, renderSummaryBar, renderTestplanClosure } from './html/dashboard.js';
import { WebviewPanelManager } from './webview-base.js';

export class CoverageDashboard extends WebviewPanelManager {
    private static instance: CoverageDashboard | undefined;

    private constructor(context: vscode.ExtensionContext) {
        super(context, 'covsight.dashboard', 'Coverage Dashboard');
    }

    public static getInstance(context: vscode.ExtensionContext): CoverageDashboard {
        if (!CoverageDashboard.instance) {
            CoverageDashboard.instance = new CoverageDashboard(context);
        }
        return CoverageDashboard.instance;
    }

    showDashboard(
        ucis: MemUCIS,
        dbName: string,
        manager: DatabaseManager,
        testpointCoverages?: TestpointCoverage[],
    ): void {
        const opts = manager.getFilterOptions();
        const html = buildDashboardHtml(ucis, dbName, opts, testpointCoverages ?? []);
        this.showPanel(html, `Coverage: ${dbName}`);
    }

    update(data: unknown): void {
        void data;
    }
}

/**
 * Build a full dashboard HTML document from a MemUCIS.
 * Exported so CdbEditorProvider can render directly into a custom editor webview.
 */
export function buildDashboardHtml(
    ucis: MemUCIS,
    dbName: string,
    opts: FilterOptions,
    testpointCoverages: TestpointCoverage[] = [],
): string {
    const overall = computeAggregateStats(ucis, opts);
    const byType = computeStatsByType(ucis, opts);
    const hotspots = getUncoveredHotspots(ucis, opts, 20);
    const goal = opts.coverageGoal;

    const content = `
<h1>Coverage Dashboard — ${escapeHtml(path.basename(dbName))}</h1>
<div class="metadata">
    <div class="metadata-row"><span class="metadata-label">Database</span><span class="metadata-value">${escapeHtml(dbName)}</span></div>
    <div class="metadata-row"><span class="metadata-label">Goal</span><span class="metadata-value">${goal}%</span></div>
</div>
${renderSummaryBar(overall, goal)}
${renderByTypeTable(byType)}
${renderHotspotsTable(hotspots, 20)}
${renderTestplanClosure(testpointCoverages)}`;

    return wrapHtml(content);
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function wrapHtml(content: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Coverage Dashboard</title>
<style>
body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);background:var(--vscode-editor-background);padding:20px;line-height:1.6}
h1,h2,h3{color:var(--vscode-foreground);margin-top:20px;margin-bottom:10px}
h1{font-size:22px;border-bottom:1px solid var(--vscode-panel-border);padding-bottom:8px}
h2{font-size:17px}
table{width:100%;border-collapse:collapse;margin:12px 0}
th,td{padding:6px 10px;text-align:left;border:1px solid var(--vscode-panel-border)}
th{background:var(--vscode-editor-selectionBackground);font-weight:bold}
tr:hover{background:var(--vscode-list-hoverBackground)}
.section{margin:20px 0}
.summary-bar{width:100%;height:20px;background:var(--vscode-input-background);border:1px solid var(--vscode-panel-border);border-radius:3px;overflow:hidden;margin:8px 0}
.summary-fill{height:100%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:bold;min-width:2px;transition:width 0.3s}
.mini-bar-wrap{width:80px;height:10px;background:var(--vscode-input-background);border:1px solid var(--vscode-panel-border);border-radius:2px;overflow:hidden;display:inline-block;vertical-align:middle;margin-right:6px}
.mini-bar{display:block;height:100%;min-width:0}
.cov-red{background:#e05050}
.cov-yellow{background:#c9a009}
.cov-green{background:#4daa57}
.cov-text-red{color:#e05050;font-weight:bold}
.cov-text-yellow{color:#c9a009;font-weight:bold}
.cov-text-green{color:#4daa57;font-weight:bold}
.metadata{background:var(--vscode-input-background);padding:10px;border-radius:3px;margin:12px 0}
.metadata-row{display:flex;margin:4px 0}
.metadata-label{font-weight:bold;width:120px}
.metadata-value{flex:1}
.pass{color:var(--vscode-testing-iconPassed)}
.warn{color:var(--vscode-testing-iconQueued)}
.fail{color:var(--vscode-testing-iconFailed)}
</style>
</head>
<body>${content}</body>
</html>`;
}
