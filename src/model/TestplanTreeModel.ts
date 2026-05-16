import { ScopeStats } from './CoverageStats.js';
import { Goal, ParsedTestplan, Testpoint, TestpointStatus, computeGoalStatus } from './TestplanModel.js';
import { TestpointCoverage } from './TestplanLinkage.js';

/**
 * Tree node categories used by the testplan explorer.
 */
export type TestplanNodeKind = 'plan' | 'goal' | 'testpoint';

/**
 * View-model node rendered in the testplan tree.
 */
export interface TestplanNode {
  readonly nodeId: string;
  readonly kind: TestplanNodeKind;
  readonly label: string;
  readonly status: TestpointStatus;
  readonly stats: ScopeStats | null;
  readonly detail: Goal | Testpoint | ParsedTestplan;
  readonly children: TestplanNode[];
}

/**
 * Builds hierarchical nodes for a parsed testplan and optional coverage results.
 */
export class TestplanTreeModel {
  constructor(private plan: ParsedTestplan, private coverages: TestpointCoverage[] | null) {}

  /**
   * Returns the top-level goal and testpoint nodes for the loaded plan.
   */
  getRoots(): TestplanNode[] {
    return this.buildChildren(this.plan, 'plan');
  }

  /**
   * Returns child nodes for a plan or goal node.
   *
   * Testpoint nodes are leaves and therefore always return an empty array.
   */
  getChildren(node: TestplanNode): TestplanNode[] {
    if (node.kind === 'testpoint') {
      return [];
    }
    if (node.kind === 'plan' || node.kind === 'goal') {
      return this.buildChildren(node.detail as Goal | ParsedTestplan, node.nodeId);
    }
    return [];
  }

  /**
   * Maps testpoint status values to built-in VS Code codicon names.
   */
  static getIconForStatus(status: TestpointStatus): string {
    switch (status) {
      case 'complete':
        return 'pass';
      case 'in_progress':
        return 'circle-filled';
      case 'waived':
        return 'circle-slash';
      default:
        return 'circle-outline';
    }
  }

  /**
   * Formats the compact description shown beside each node label.
   */
  static getNodeDescription(node: TestplanNode): string {
    if (node.kind === 'testpoint') {
      return node.stats ? `${node.stats.percentage}%` : node.status;
    }
    return node.status;
  }

  /**
   * Produces a tooltip containing status and optional coverage counts.
   */
  static getTooltip(node: TestplanNode): string {
    if (node.stats === null) {
      return `${node.label}
status: ${node.status}`;
    }
    return `${node.label}
status: ${node.status}
covered: ${node.stats.covered}/${node.stats.total} (${node.stats.percentage}%)`;
  }

  private buildChildren(detail: Goal | ParsedTestplan, parentId: string): TestplanNode[] {
    const goals = detail.goals.map((goal) => this.buildGoalNode(goal, `${parentId}/goal:${goal.name}`));
    const testpoints = detail.testpoints.map((testpoint) => this.buildTestpointNode(testpoint, `${parentId}/testpoint:${testpoint.name}`));
    return [...goals, ...testpoints];
  }

  private buildGoalNode(goal: Goal, nodeId: string): TestplanNode {
    return {
      nodeId,
      kind: 'goal',
      label: goal.name,
      status: computeGoalStatus(goal),
      stats: this.coverages ? this.computeGoalStats(goal) : null,
      detail: goal,
      children: [],
    };
  }

  private buildTestpointNode(testpoint: Testpoint, nodeId: string): TestplanNode {
    return {
      nodeId,
      kind: 'testpoint',
      label: testpoint.name,
      status: testpoint.status,
      stats: this.findCoverage(testpoint)?.aggregateStats ?? null,
      detail: testpoint,
      children: [],
    };
  }

  private computeGoalStats(goal: Goal): ScopeStats {
    const allTestpoints = collectGoalTestpoints(goal);
    const stats = allTestpoints
      .map((testpoint) => this.findCoverage(testpoint)?.aggregateStats)
      .filter((entry): entry is ScopeStats => entry !== undefined && entry !== null);

    const total = stats.reduce((sum, entry) => sum + entry.total, 0);
    const covered = stats.reduce((sum, entry) => sum + entry.covered, 0);
    const percentage = total === 0 ? 100 : Math.round((covered / total) * 100);
    return {
      covered,
      total,
      percentage,
      isMet: percentage >= 100,
    };
  }

  private findCoverage(testpoint: Testpoint): TestpointCoverage | undefined {
    return this.coverages?.find((coverage) => coverage.testpoint === testpoint || coverage.testpoint.name === testpoint.name);
  }
}

function collectGoalTestpoints(goal: Goal): Testpoint[] {
  const result = [...goal.testpoints];
  for (const child of goal.goals) {
    result.push(...collectGoalTestpoints(child));
  }
  return result;
}
