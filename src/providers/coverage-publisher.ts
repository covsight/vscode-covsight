import * as vscode from 'vscode';
import { FileCoverageData } from '../model/index.js';
import { DatabaseManager } from './database-manager.js';

export class CoveragePublisher implements vscode.Disposable {
    private readonly controller: vscode.TestController;
    private readonly profile: vscode.TestRunProfile;
    private readonly coverageMap = new Map<string, FileCoverageData>();
    private run: vscode.TestRun | null = null;

    constructor(manager: DatabaseManager) {
        void manager;
        this.controller = vscode.tests.createTestController('covsight', 'CovSight Coverage');
        this.profile = this.controller.createRunProfile(
            'Coverage',
            vscode.TestRunProfileKind.Coverage,
            () => {},
            true,
        );
        this.profile.loadDetailedCoverage = async (
            _testRun: vscode.TestRun,
            fileCoverage: vscode.FileCoverage,
            token: vscode.CancellationToken,
        ): Promise<vscode.FileCoverageDetail[]> => this.buildDetailedCoverage(fileCoverage.uri, token);
    }

    publish(coverages: FileCoverageData[]): void {
        if (this.run) {
            this.run.end();
        }

        this.coverageMap.clear();
        const request = new vscode.TestRunRequest();
        this.run = this.controller.createTestRun(request, 'Coverage', false);

        for (const cov of coverages) {
            const uri = vscode.Uri.file(cov.workspacePath);
            this.coverageMap.set(cov.workspacePath, cov);

            const coveredStatements = cov.lines.filter((line) => line.hitCount > 0n || line.branches.some((branch) => branch.hitCount > 0n)).length;
            const totalBranches = cov.lines.reduce((sum, line) => sum + line.branches.length, 0);
            const coveredBranches = cov.lines.reduce(
                (sum, line) => sum + line.branches.filter((branch) => branch.hitCount > 0n).length,
                0,
            );

            const fileCoverage = new vscode.FileCoverage(
                uri,
                new vscode.TestCoverageCount(coveredStatements, cov.totalLines),
                totalBranches > 0 ? new vscode.TestCoverageCount(coveredBranches, totalBranches) : undefined,
            );
            this.run.addCoverage(fileCoverage);
        }
    }

    buildDetailedCoverage(uri: vscode.Uri, token: vscode.CancellationToken): vscode.FileCoverageDetail[] {
        if (token.isCancellationRequested) {
            return [];
        }

        const data = this.coverageMap.get(uri.fsPath);
        if (!data) {
            return [];
        }

        return data.lines.map((lineData) => {
            const position = new vscode.Position(lineData.line - 1, 0);
            const range = new vscode.Range(position, position);
            const branches = lineData.branches.map(
                (branch) => new vscode.BranchCoverage(Number(branch.hitCount), range, branch.label),
            );
            const executed = lineData.hitCount > 0n ? Number(lineData.hitCount) : branches.some((branch) => Boolean(branch.executed));
            return new vscode.StatementCoverage(executed, range, branches);
        });
    }

    dispose(): void {
        if (this.run) {
            this.run.end();
        }
        this.profile.dispose();
        this.controller.dispose();
    }
}
