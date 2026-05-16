import { CoverTypeT, HistoryNode, ScopeTypeT, TestStatusT } from '@covsight/core';
import { ScopeStats, TestpointCoverage, UncoveredBin } from '../../model/index.js';

export function renderSummaryBar(stats: ScopeStats, goal: number): string {
    const percentage = clampPercentage(stats.percentage);
    const cls = coverageClass(stats.percentage);

    return `
<section class="section">
    <h2>Overall Coverage</h2>
    <div class="summary-bar">
        <div class="summary-fill ${cls}" style="width: ${percentage}%"></div>
    </div>
    <p>${stats.covered} / ${stats.total} bins covered (${stats.percentage}%)</p>
</section>`;
}

export function renderByTypeTable(byType: Map<bigint, ScopeStats>): string {
    const rows = Array.from(byType.entries())
        .filter(([, stats]) => stats.total > 0)
        .sort((lhs, rhs) => scopeTypeName(lhs[0]).localeCompare(scopeTypeName(rhs[0])))
        .map(([scopeType, stats]) => {
            const pct = clampPercentage(stats.percentage);
            const cls = coverageClass(stats.percentage);
            const status = stats.isMet ? '✓' : '✗';
            const statusClass = stats.isMet ? 'pass' : 'fail';
            return `
        <tr>
            <td>${escapeHtml(scopeTypeName(scopeType))}</td>
            <td>${stats.covered} / ${stats.total}</td>
            <td><span class="mini-bar-wrap"><span class="mini-bar ${cls}" style="width:${pct}%"></span></span>${stats.percentage}%</td>
            <td class="${statusClass}">${status}</td>
        </tr>`;
        })
        .join('');

    if (rows.length === 0) {
        return '<section class="section"><h2>Coverage by Type</h2><p class="empty-message">No scope data available.</p></section>';
    }

    return `
<section class="section">
    <h2>Coverage by Type</h2>
    <table>
        <thead>
            <tr><th>Scope Type</th><th>Coverage</th><th>Percent</th><th>Status</th></tr>
        </thead>
        <tbody>${rows}
        </tbody>
    </table>
</section>`;
}

export function renderHotspotsTable(hotspots: UncoveredBin[], limit = hotspots.length): string {
    const rows = hotspots
        .slice()
        .sort((lhs, rhs) => {
            if (lhs.hitCount !== rhs.hitCount) {
                return lhs.hitCount < rhs.hitCount ? -1 : 1;
            }
            return lhs.scopePath.localeCompare(rhs.scopePath) || lhs.binName.localeCompare(rhs.binName);
        })
        .slice(0, limit)
        .map((hotspot) => `
        <tr>
            <td>${escapeHtml(hotspot.scopePath)}</td>
            <td>${escapeHtml(hotspot.binName)}</td>
            <td>${hotspot.hitCount.toString()}</td>
            <td>${hotspot.atLeast.toString()}</td>
            <td>${escapeHtml(coverTypeName(hotspot.coverType))}</td>
        </tr>`)
        .join('');

    if (rows.length === 0) {
        return '<section class="section"><h2>Uncovered Hotspots</h2><p class="empty-message">No uncovered bins.</p></section>';
    }

    return `
<section class="section">
    <h2>Uncovered Hotspots</h2>
    <table>
        <thead>
            <tr><th>Scope Path</th><th>Bin Name</th><th>Hit Count</th><th>Goal</th><th>Type</th></tr>
        </thead>
        <tbody>${rows}
        </tbody>
    </table>
</section>`;
}

export function renderTestplanClosure(coverages: TestpointCoverage[]): string {
    if (coverages.length === 0) {
        return '';
    }

    const rows = coverages
        .slice()
        .sort((lhs, rhs) => lhs.testpoint.name.localeCompare(rhs.testpoint.name))
        .map((coverage) => {
            const cls = coverageClass(coverage.aggregateStats.percentage);
            const label = coverage.aggregateStats.isMet ? 'Met'
                : coverage.aggregateStats.percentage > 0 ? 'At Risk' : 'Missing';
            const pct = clampPercentage(coverage.aggregateStats.percentage);
            return `
        <tr>
            <td>${escapeHtml(coverage.testpoint.name)}</td>
            <td>${escapeHtml(coverage.testpoint.status)}</td>
            <td><span class="mini-bar-wrap"><span class="mini-bar ${cls}" style="width:${pct}%"></span></span><span class="${cls.replace('cov-', 'cov-text-')}">${coverage.aggregateStats.percentage}% (${label})</span></td>
            <td>${escapeHtml(coverage.testpoint.description ?? '')}</td>
        </tr>`;
        })
        .join('');

    return `
<section class="section">
    <h2>Testplan Closure</h2>
    <table>
        <thead>
            <tr><th>Testpoint</th><th>Status</th><th>Coverage</th><th>Description</th></tr>
        </thead>
        <tbody>${rows}
        </tbody>
    </table>
</section>`;
}

interface HistoryNodeLike extends HistoryNode {
    logicalName?: string;
    date?: string;
    cpuTime?: number | string;
    testStatus?: number | string;
}

export function renderHistorySection(historyNodes: HistoryNode[]): string {
    if (historyNodes.length === 0) {
        return '';
    }

    const rows = historyNodes
        .map((node) => {
            const historyNode = node as HistoryNodeLike;
            return `
        <tr>
            <td>${escapeHtml(getHistoryName(historyNode))}</td>
            <td>${escapeHtml(getHistoryStatus(historyNode))}</td>
            <td>${escapeHtml(getHistoryDate(historyNode))}</td>
            <td>${escapeHtml(getHistoryCpuTime(historyNode))}</td>
        </tr>`;
        })
        .join('');

    return `
<section class="section">
    <h2>History</h2>
    <table>
        <thead>
            <tr><th>Name</th><th>Status</th><th>Date</th><th>CPU Time</th></tr>
        </thead>
        <tbody>${rows}
        </tbody>
    </table>
</section>`;
}

function getHistoryName(node: HistoryNodeLike): string {
    return node.logicalName ?? node.testName ?? '—';
}

function getHistoryStatus(node: HistoryNodeLike): string {
    if (typeof node.testStatus === 'string' && node.testStatus.length > 0) {
        return node.testStatus;
    }
    if (typeof node.testStatus === 'number') {
        return testStatusName(node.testStatus);
    }
    return '—';
}

function getHistoryDate(node: HistoryNodeLike): string {
    if (typeof node.date === 'string' && node.date.length > 0) {
        return node.date;
    }
    if (node.testData?.date) {
        return node.testData.date;
    }
    return '—';
}

function getHistoryCpuTime(node: HistoryNodeLike): string {
    if (typeof node.cpuTime === 'number') {
        return node.cpuTime.toString();
    }
    if (typeof node.cpuTime === 'string' && node.cpuTime.length > 0) {
        return node.cpuTime;
    }
    if (node.testData?.simElapsed) {
        return node.testData.simElapsed;
    }
    return '—';
}

function testStatusName(testStatus: number): string {
    switch (testStatus) {
        case TestStatusT.OK:
            return 'OK';
        case TestStatusT.FAILED:
            return 'FAILED';
        case TestStatusT.ERROR:
            return 'ERROR';
        case TestStatusT.FATAL:
            return 'FATAL';
        case TestStatusT.COMPILE:
            return 'COMPILE';
        default:
            return `0x${testStatus.toString(16)}`;
    }
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
        [ScopeTypeT.DU_ARCH,       'Design Unit (Arch)'],
        [ScopeTypeT.DU_PACKAGE,    'Design Unit (Package)'],
        [ScopeTypeT.DU_PROGRAM,    'Design Unit (Program)'],
        [ScopeTypeT.DU_INTERFACE,  'Design Unit (Interface)'],
        [ScopeTypeT.PROCESS,       'Process'],
        [ScopeTypeT.BLOCK,         'Block'],
        [ScopeTypeT.FUNCTION,      'Function'],
        [ScopeTypeT.TASK,          'Task'],
        [ScopeTypeT.CLASS,         'Class'],
        [ScopeTypeT.INTERFACE,     'Interface'],
        [ScopeTypeT.PACKAGE,       'Package'],
        [ScopeTypeT.PROGRAM,       'Program'],
        [ScopeTypeT.ASSERT,        'Assertion'],
        [ScopeTypeT.COVER,         'Cover'],
        [ScopeTypeT.GENERATE,      'Generate'],
        [ScopeTypeT.GENERIC,       'Generic'],
        [ScopeTypeT.COVBLOCK,      'Cover Block'],
        [ScopeTypeT.CVGBINSCOPE,   'Coverage Bin Scope'],
    ];

    return names.find(([value]) => value === scopeType)?.[1] ?? `Unknown (0x${scopeType.toString(16)})`;
}

function coverTypeName(coverType: number): string {
    const names: Array<[number, string]> = [
        [CoverTypeT.STMTBIN, 'Statement'],
        [CoverTypeT.BLOCKBIN, 'Block'],
        [CoverTypeT.BRANCHBIN, 'Branch'],
        [CoverTypeT.EXPRBIN, 'Expression'],
        [CoverTypeT.CONDBIN, 'Condition'],
        [CoverTypeT.TOGGLEBIN, 'Toggle'],
        [CoverTypeT.FSMBIN, 'FSM'],
        [CoverTypeT.IGNOREBIN, 'Ignored'],
        [CoverTypeT.ILLEGALBIN, 'Illegal'],
    ];

    const matched = names.filter(([value]) => (coverType & value) !== 0).map(([, name]) => name);
    return matched.length > 0 ? matched.join(', ') : `0x${coverType.toString(16)}`;
}

function clampPercentage(percentage: number): number {
    return Math.max(0, Math.min(100, percentage));
}

/** Returns a CSS class for a coverage percentage using red/yellow/green thresholds. */
function coverageClass(percentage: number): string {
    if (percentage >= 60) { return 'cov-green'; }
    if (percentage >= 30) { return 'cov-yellow'; }
    return 'cov-red';
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
