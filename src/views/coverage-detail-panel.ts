import * as vscode from 'vscode';
import { CoverItem, CoverTypeT, Scope, ScopeTypeT } from '@covsight/core';
import { CoverageNode, CoverageTreeModel, FilterOptions } from '../model/index.js';
import { DatabaseManager } from '../providers/database-manager.js';
import { WebviewPanelManager } from './webview-base.js';

export class CoverageDetailPanel extends WebviewPanelManager {
    private static instance: CoverageDetailPanel | undefined;

    private constructor(context: vscode.ExtensionContext) {
        super(context, 'covsight.detail', 'Coverage Detail');
    }

    public static getInstance(context: vscode.ExtensionContext): CoverageDetailPanel {
        if (!CoverageDetailPanel.instance) {
            CoverageDetailPanel.instance = new CoverageDetailPanel(context);
        }
        return CoverageDetailPanel.instance;
    }

    showNode(node: CoverageNode, manager: DatabaseManager): void {
        const opts = manager.getFilterOptions();
        const html = this.buildNodeHtml(node, opts);
        this.showPanel(html, `Detail: ${node.label}`);
    }

    update(data: unknown): void {
        void data;
    }

    private buildNodeHtml(node: CoverageNode, opts: FilterOptions): string {
        const path = CoverageTreeModel.getScopePath(node.scope) || node.label;
        const sourcePath = node.scope.fileHandle?.filePath ?? 'N/A';
        const sourceLine = node.scope.sourceInfo?.line;

        // Collect all leaf sections (scopes that have direct items) from the subtree.
        const sections = collectItemSections(node.scope, opts);

        let itemsHtml: string;
        if (sections.length === 0) {
            itemsHtml = '<p class="empty-message">No cover items in this subtree.</p>';
        } else if (sections.length === 1 && sections[0]!.scopePath === path) {
            // Same scope — skip the redundant sub-heading
            itemsHtml = renderBinTable(sections[0]!.items, opts);
        } else {
            itemsHtml = sections.map((sec) => `
<section class="section">
    <h3>${escapeHtml(sec.scopePath)}</h3>
    ${renderBinTable(sec.items, opts)}
</section>`).join('');
        }

        const content = `
<h1>${escapeHtml(node.label)}</h1>
<div class="metadata">
    <div class="metadata-row"><span class="metadata-label">Scope Type</span><span class="metadata-value">${escapeHtml(scopeTypeName(node.scopeType))}</span></div>
    <div class="metadata-row"><span class="metadata-label">Scope Path</span><span class="metadata-value">${escapeHtml(path)}</span></div>
    <div class="metadata-row"><span class="metadata-label">Source</span><span class="metadata-value">${escapeHtml(sourcePath)}${sourceLine ? `:${sourceLine}` : ''}</span></div>
</div>
<section class="section">
    <h2>Coverage Stats</h2>
    <table>
        <thead>
            <tr><th>Covered</th><th>Total</th><th>Percent</th><th>Goal Status</th></tr>
        </thead>
        <tbody>
            <tr>
                <td>${node.stats.covered}</td>
                <td>${node.stats.total}</td>
                <td>${node.stats.percentage}%</td>
                <td class="${node.stats.isMet ? 'status-covered' : 'status-uncovered'}">${node.stats.isMet ? 'Met' : 'Not Met'}</td>
            </tr>
        </tbody>
    </table>
</section>
<section class="section">
    <h2>Cover Items</h2>
    ${itemsHtml}
</section>`;

        return this.getBaseHtml(content);
    }
}

interface ItemSection {
    scopePath: string;
    items: CoverItem[];
}

/** Recursively collect scopes that have direct cover items. */
function collectItemSections(scope: Scope, opts: FilterOptions): ItemSection[] {
    const sections: ItemSection[] = [];

    const directItems = Array.from(scope.coverItems()).filter((item) => !isFiltered(item, opts));
    if (directItems.length > 0) {
        sections.push({
            scopePath: CoverageTreeModel.getScopePath(scope) || scope.logicalName,
            items: directItems,
        });
    }

    for (let i = 0; i < scope.numCoverChildren(); i++) {
        sections.push(...collectItemSections(scope.coverChild(i), opts));
    }

    return sections;
}

function renderBinTable(items: CoverItem[], _opts: FilterOptions): string {
    const rows = items.map((item) => {
        const covered = isCovered(item);
        return `
        <tr>
            <td>${escapeHtml(item.name)}</td>
            <td>${escapeHtml(coverTypeName(item.coverType))}</td>
            <td>${item.data.count.toString()}</td>
            <td>${item.data.atLeast.toString()}</td>
            <td class="${covered ? 'status-covered' : 'status-uncovered'}">${covered ? 'Covered' : 'Uncovered'}</td>
        </tr>`;
    }).join('');

    return `
    <table>
        <thead>
            <tr><th>Name</th><th>Type</th><th>Count</th><th>Goal</th><th>Status</th></tr>
        </thead>
        <tbody>${rows}
        </tbody>
    </table>`;
}

function isCovered(item: CoverItem): boolean {
    return item.data.atLeast === 0n || item.data.count >= item.data.atLeast;
}

function isFiltered(item: CoverItem, opts: FilterOptions): boolean {
    return ((item.coverType & CoverTypeT.IGNOREBIN) !== 0 && opts.excludeIgnoredBins)
        || ((item.coverType & CoverTypeT.ILLEGALBIN) !== 0 && opts.excludeIllegalBins);
}

function scopeTypeName(scopeType: bigint): string {
    const names: Array<[bigint, string]> = [
        [ScopeTypeT.INSTANCE,      'Instance'],
        [ScopeTypeT.COVERGROUP,    'Covergroup'],
        [ScopeTypeT.COVERINSTANCE, 'Cover Instance'],
        [ScopeTypeT.COVERPOINT,    'Coverpoint'],
        [ScopeTypeT.CROSS,         'Cross'],
        [ScopeTypeT.TOGGLE,        'Toggle'],
        [ScopeTypeT.BRANCH,        'Branch'],
        [ScopeTypeT.EXPR,          'Expression'],
        [ScopeTypeT.COND,          'Condition'],
        [ScopeTypeT.FSM,           'FSM'],
        [ScopeTypeT.FSM_STATES,    'FSM States'],
        [ScopeTypeT.FSM_TRANS,     'FSM Transitions'],
        [ScopeTypeT.DU_MODULE,     'Design Unit (Module)'],
        [ScopeTypeT.DU_INTERFACE,  'Design Unit (Interface)'],
    ];
    return names.find(([value]) => value === scopeType)?.[1] ?? `0x${scopeType.toString(16)}`;
}

function coverTypeName(coverType: number): string {
    const names: Array<[number, string]> = [
        [CoverTypeT.STMTBIN,   'Statement'],
        [CoverTypeT.BLOCKBIN,  'Block'],
        [CoverTypeT.BRANCHBIN, 'Branch'],
        [CoverTypeT.EXPRBIN,   'Expression'],
        [CoverTypeT.CONDBIN,   'Condition'],
        [CoverTypeT.TOGGLEBIN, 'Toggle'],
        [CoverTypeT.FSMBIN,    'FSM'],
        [CoverTypeT.IGNOREBIN, 'Ignored'],
        [CoverTypeT.ILLEGALBIN,'Illegal'],
        [CoverTypeT.CVGBIN,    'Coverage'],
    ];
    const matched = names.filter(([value]) => (coverType & value) !== 0).map(([, name]) => name);
    return matched.length > 0 ? matched.join(', ') : `0x${coverType.toString(16)}`;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
