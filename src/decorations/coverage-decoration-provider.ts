import * as path from 'path';
import * as vscode from 'vscode';
import { CoverageSourceModel, ToggleCoverageData } from '../model/index.js';
import { DatabaseManager } from '../providers/database-manager.js';

export class ToggleDecorationProvider implements vscode.Disposable {
    private enabled = false;
    private coverageData: ToggleCoverageData[] = [];
    private readonly subscriptions: vscode.Disposable[] = [];

    private readonly bothCovered: vscode.TextEditorDecorationType;
    private readonly oneCovered: vscode.TextEditorDecorationType;
    private readonly notCovered: vscode.TextEditorDecorationType;

    constructor(private readonly manager: DatabaseManager) {
        this.bothCovered = vscode.window.createTextEditorDecorationType({
            overviewRulerColor: 'green',
            overviewRulerLane: vscode.OverviewRulerLane.Left,
            isWholeLine: true,
            backgroundColor: new vscode.ThemeColor('diffEditor.insertedLineBackground'),
        });
        this.oneCovered = vscode.window.createTextEditorDecorationType({
            overviewRulerColor: 'yellow',
            overviewRulerLane: vscode.OverviewRulerLane.Left,
            isWholeLine: true,
            backgroundColor: 'rgba(255, 215, 0, 0.12)',
        });
        this.notCovered = vscode.window.createTextEditorDecorationType({
            overviewRulerColor: 'red',
            overviewRulerLane: vscode.OverviewRulerLane.Left,
            isWholeLine: true,
            backgroundColor: new vscode.ThemeColor('diffEditor.removedLineBackground'),
        });

        const config = vscode.workspace.getConfiguration('covsight');
        this.enabled = config.get<boolean>('showDecorations', false);

        this.subscriptions.push(
            this.manager.onActiveDatabaseChanged(() => this.refresh()),
            vscode.window.onDidChangeActiveTextEditor((editor) => {
                if (editor) {
                    this.decorate(editor);
                }
            }),
            vscode.workspace.onDidOpenTextDocument(() => this.decorateAll()),
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (event.affectsConfiguration('covsight.showDecorations')) {
                    this.enabled = vscode.workspace.getConfiguration('covsight').get<boolean>('showDecorations', false);
                    this.decorateAll();
                }
                if (event.affectsConfiguration('covsight.pathMappings')) {
                    this.refresh();
                }
            }),
        );

        this.refresh();
    }

    toggle(): void {
        this.enabled = !this.enabled;
        this.decorateAll();
    }

    enable(): void {
        this.enabled = true;
        this.decorateAll();
    }

    disable(): void {
        this.enabled = false;
        this.clearAll();
    }

    isEnabled(): boolean {
        return this.enabled;
    }

    private refresh(): void {
        const ucis = this.manager.getActiveDatabase();
        if (ucis) {
            const sourceModel = new CoverageSourceModel(this.manager.getPathMapper());
            this.coverageData = sourceModel.buildToggleCoverages(ucis);
        } else {
            this.coverageData = [];
        }

        if (this.enabled) {
            this.decorateAll();
        } else {
            this.clearAll();
        }
    }

    private decorateAll(): void {
        for (const editor of vscode.window.visibleTextEditors) {
            this.decorate(editor);
        }
    }

    private clearAll(): void {
        for (const editor of vscode.window.visibleTextEditors) {
            this.clearEditor(editor);
        }
    }

    private clearEditor(editor: vscode.TextEditor): void {
        editor.setDecorations(this.bothCovered, []);
        editor.setDecorations(this.oneCovered, []);
        editor.setDecorations(this.notCovered, []);
    }

    private decorate(editor: vscode.TextEditor): void {
        if (!this.enabled) {
            this.clearEditor(editor);
            return;
        }

        const filePath = path.normalize(editor.document.uri.fsPath);
        const toggleData = this.coverageData.find((data) => path.normalize(data.workspacePath) === filePath);

        if (!toggleData) {
            this.clearEditor(editor);
            return;
        }

        const both: vscode.DecorationOptions[] = [];
        const one: vscode.DecorationOptions[] = [];
        const none: vscode.DecorationOptions[] = [];

        for (const [line, data] of toggleData.toggleLines) {
            const range = new vscode.Range(line - 1, 0, line - 1, 0);
            const hasZeroToOne = data.zeroToOne > 0n;
            const hasOneToZero = data.oneToZero > 0n;
            const hoverMessage = new vscode.MarkdownString(
                `0→1: **${data.zeroToOne.toString()}**  \
1→0: **${data.oneToZero.toString()}**`,
            );
            const decoration: vscode.DecorationOptions = { range, hoverMessage };

            if (hasZeroToOne && hasOneToZero) {
                both.push(decoration);
            } else if (hasZeroToOne || hasOneToZero) {
                one.push(decoration);
            } else {
                none.push(decoration);
            }
        }

        editor.setDecorations(this.bothCovered, both);
        editor.setDecorations(this.oneCovered, one);
        editor.setDecorations(this.notCovered, none);
    }

    dispose(): void {
        this.subscriptions.forEach((subscription) => subscription.dispose());
        this.bothCovered.dispose();
        this.oneCovered.dispose();
        this.notCovered.dispose();
    }
}
