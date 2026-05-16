import { Goal, TestplanNode, Testpoint, TestpointCoverage } from '../../model/index.js';

export function renderTestpointDetail(node: TestplanNode, coverage: TestpointCoverage | null): string {
    const testpoint = node.detail as Testpoint;
    const requirements = renderStringList(testpoint.requirements, 'No requirements linked.');
    const tests = renderStringList(testpoint.tests, 'No tests listed.');
    const coverageRows = coverage
        ? coverage.bindings.map((binding) => `
            <tr>
                <td>${escapeHtml(binding.binding.type)}</td>
                <td>${escapeHtml(binding.binding.path)}</td>
                <td>${binding.matchedScopes.length}</td>
                <td>${binding.stats.covered}</td>
                <td>${binding.stats.total}</td>
                <td>${binding.stats.percentage}%</td>
                <td class="${binding.stats.isMet ? 'pass-text' : (binding.stats.percentage > 0 ? 'warn-text' : 'fail-text')}">${binding.stats.isMet ? 'Met' : (binding.stats.percentage > 0 ? 'Partial' : 'Missing')}</td>
            </tr>`).join('')
        : testpoint.coverage.map((binding) => `
            <tr>
                <td>${escapeHtml(binding.type)}</td>
                <td>${escapeHtml(binding.path)}</td>
                <td colspan="5">Coverage database not loaded.</td>
            </tr>`).join('');
    const customRows = testpoint.custom && Object.keys(testpoint.custom).length > 0
        ? Object.entries(testpoint.custom).map(([key, value]) => `
            <tr>
                <td>${escapeHtml(key)}</td>
                <td><code>${escapeHtml(formatValue(value))}</code></td>
            </tr>`).join('')
        : '<tr><td colspan="2" class="empty-message">No custom fields.</td></tr>';

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Testpoint: ${escapeHtml(node.label)}</title>
    <style>${baseStyles}</style>
</head>
<body>
    <h1>${escapeHtml(testpoint.name)}</h1>
    <div class="metadata">
        <div class="metadata-row"><span class="metadata-label">Status</span><span class="metadata-value">${escapeHtml(testpoint.status)}</span></div>
        <div class="metadata-row"><span class="metadata-label">Owner</span><span class="metadata-value">${escapeHtml(testpoint.owner ?? 'Unassigned')}</span></div>
        <div class="metadata-row"><span class="metadata-label">Priority</span><span class="metadata-value">${escapeHtml(testpoint.priority ?? 'Not set')}</span></div>
        <div class="metadata-row"><span class="metadata-label">Stage</span><span class="metadata-value">${escapeHtml(testpoint.stage ?? 'Not set')}</span></div>
    </div>
    <section class="section">
        <h2>Description</h2>
        <p>${escapeHtml(testpoint.description ?? 'No description provided.')}</p>
    </section>
    <section class="section">
        <h2>Requirements</h2>
        ${requirements}
    </section>
    <section class="section">
        <h2>Tests</h2>
        ${tests}
    </section>
    <section class="section">
        <h2>Coverage Bindings</h2>
        <table>
            <thead>
                <tr><th>Type</th><th>Path</th><th>Matches</th><th>Covered</th><th>Total</th><th>Percent</th><th>Status</th></tr>
            </thead>
            <tbody>${coverageRows || '<tr><td colspan="7" class="empty-message">No coverage bindings.</td></tr>'}
            </tbody>
        </table>
    </section>
    <section class="section">
        <h2>Custom Fields</h2>
        <table>
            <thead>
                <tr><th>Field</th><th>Value</th></tr>
            </thead>
            <tbody>${customRows}
            </tbody>
        </table>
    </section>
</body>
</html>`;
}

export function renderGoalDetail(node: TestplanNode): string {
    const goal = node.detail as Goal;
    const testpoints = collectGoalTestpoints(goal);
    const rows = testpoints.length > 0
        ? testpoints.map((testpoint) => `
            <tr>
                <td>${escapeHtml(testpoint.name)}</td>
                <td>${escapeHtml(testpoint.status)}</td>
                <td>${escapeHtml(testpoint.owner ?? 'Unassigned')}</td>
                <td>${escapeHtml(testpoint.description ?? '')}</td>
            </tr>`).join('')
        : '<tr><td colspan="4" class="empty-message">No child testpoints.</td></tr>';

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Goal: ${escapeHtml(node.label)}</title>
    <style>${baseStyles}</style>
</head>
<body>
    <h1>${escapeHtml(goal.name)}</h1>
    <div class="metadata">
        <div class="metadata-row"><span class="metadata-label">Status</span><span class="metadata-value">${escapeHtml(node.status)}</span></div>
        <div class="metadata-row"><span class="metadata-label">Owner</span><span class="metadata-value">${escapeHtml(goal.owner ?? 'Unassigned')}</span></div>
        <div class="metadata-row"><span class="metadata-label">Sub-goals</span><span class="metadata-value">${goal.goals.length}</span></div>
        <div class="metadata-row"><span class="metadata-label">Testpoints</span><span class="metadata-value">${testpoints.length}</span></div>
    </div>
    <section class="section">
        <h2>Description</h2>
        <p>${escapeHtml(goal.description ?? 'No description provided.')}</p>
    </section>
    <section class="section">
        <h2>Child Testpoints</h2>
        <table>
            <thead>
                <tr><th>Name</th><th>Status</th><th>Owner</th><th>Description</th></tr>
            </thead>
            <tbody>${rows}
            </tbody>
        </table>
    </section>
</body>
</html>`;
}

const baseStyles = `
    body {
        font-family: var(--vscode-font-family, sans-serif);
        font-size: var(--vscode-font-size, 13px);
        color: var(--vscode-foreground);
        background-color: var(--vscode-editor-background);
        padding: 20px;
        line-height: 1.5;
    }
    h1, h2 {
        color: var(--vscode-foreground);
    }
    h1 {
        border-bottom: 1px solid var(--vscode-panel-border);
        padding-bottom: 8px;
    }
    .metadata {
        background-color: var(--vscode-input-background);
        padding: 12px;
        border-radius: 4px;
        margin: 15px 0;
    }
    .metadata-row {
        display: flex;
        gap: 12px;
        margin: 4px 0;
    }
    .metadata-label {
        font-weight: bold;
        min-width: 110px;
    }
    .metadata-value {
        flex: 1;
    }
    .section {
        margin: 24px 0;
    }
    table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 12px;
    }
    th, td {
        border: 1px solid var(--vscode-panel-border);
        padding: 8px 10px;
        text-align: left;
        vertical-align: top;
    }
    th {
        background-color: var(--vscode-editor-selectionBackground);
    }
    ul {
        margin: 12px 0;
        padding-left: 20px;
    }
    code {
        white-space: pre-wrap;
    }
    .empty-message {
        color: var(--vscode-descriptionForeground);
        font-style: italic;
    }
    .pass-text {
        color: var(--vscode-testing-iconPassed);
        font-weight: bold;
    }
    .warn-text {
        color: var(--vscode-testing-iconQueued);
        font-weight: bold;
    }
    .fail-text {
        color: var(--vscode-testing-iconFailed);
        font-weight: bold;
    }
`;

function collectGoalTestpoints(goal: Goal): Testpoint[] {
    const result = [...goal.testpoints];
    for (const child of goal.goals) {
        result.push(...collectGoalTestpoints(child));
    }
    return result;
}

function renderStringList(values: string[] | undefined, emptyText: string): string {
    if (!values || values.length === 0) {
        return `<p class="empty-message">${escapeHtml(emptyText)}</p>`;
    }
    return `<ul>${values.map((value) => `<li>${escapeHtml(value)}</li>`).join('')}</ul>`;
}

function formatValue(value: unknown): string {
    return typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? String(value);
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
