import { MemUCIS, Scope, ScopeTypeT } from '@covsight/core';
import { CoverageFilter, FilterOptions, ScopeStats, computeAggregateStats, scopePassesFilter } from './CoverageStats.js';

/**
 * View-model node used by the coverage hierarchy tree.
 */
export interface CoverageNode {
  readonly nodeId: string;
  readonly label: string;
  readonly scopeType: bigint;
  readonly stats: ScopeStats;
  readonly scope: Scope;
  readonly children: CoverageNode[];
}

/**
 * Builds filtered tree nodes from the active NCDB scope hierarchy.
 */
export class CoverageTreeModel {
  constructor(private ucis: MemUCIS, private opts: FilterOptions) {}

  /**
   * Returns root-level hierarchy nodes that satisfy the requested filter.
   *
   * Root nodes are direct children of the UCIS database object.
   */
  getRoots(filter: CoverageFilter): CoverageNode[] {
    return Array.from(this.ucis.scopes(ScopeTypeT.ALL))
      .map((scope) => this.buildNode(scope))
      .filter((node) => scopePassesFilter(node.scope, filter, this.opts));
  }

  /**
   * Returns filtered child nodes for an existing hierarchy node.
   */
  getChildren(node: CoverageNode, filter: CoverageFilter): CoverageNode[] {
    return Array.from(node.scope.scopes(ScopeTypeT.ALL))
      .map((scope) => this.buildNode(scope))
      .filter((child) => scopePassesFilter(child.scope, filter, this.opts));
  }

  /**
   * Builds a dotted scope path suitable for tooltips and stable node IDs.
   *
   * The synthetic UCIS root is omitted from the returned path.
   */
  static getScopePath(scope: Scope): string {
    const parts: string[] = [];
    let current: Scope | null = scope;

    while (current !== null && current.parent !== null) {
      parts.unshift(current.logicalName);
      current = current.parent;
    }

    return parts.join('.');
  }

  /**
   * Formats the compact description shown beside a hierarchy node label.
   */
  static getNodeDescription(node: CoverageNode): string {
    return `${node.stats.percentage}%`;
  }

  /**
   * Maps UCIS scope types onto built-in VS Code codicon names.
   */
  static getIconForScopeType(scopeType: bigint): string {
    if (scopeType === ScopeTypeT.INSTANCE) {
      return 'package';
    }
    if (scopeType === ScopeTypeT.COVERGROUP || scopeType === ScopeTypeT.COVERINSTANCE) {
      return 'graph';
    }
    if (scopeType === ScopeTypeT.COVERPOINT) {
      return 'graph-line';
    }
    if (scopeType === ScopeTypeT.CROSS) {
      return 'symbol-structure';
    }
    if (scopeType === ScopeTypeT.TOGGLE) {
      return 'symbol-boolean';
    }
    if (scopeType === ScopeTypeT.BRANCH || scopeType === ScopeTypeT.EXPR || scopeType === ScopeTypeT.COND) {
      return 'git-branch';
    }
    if (scopeType === ScopeTypeT.FSM || scopeType === ScopeTypeT.FSM_STATES || scopeType === ScopeTypeT.FSM_TRANS) {
      return 'symbol-enum';
    }
    return 'circle';
  }

  /**
   * Produces a multiline tooltip showing path and aggregate coverage counts.
   */
  static getTooltip(node: CoverageNode): string {
    const scopePath = CoverageTreeModel.getScopePath(node.scope) || node.label;
    return `path: ${scopePath}
covered: ${node.stats.covered}/${node.stats.total} (${node.stats.percentage}%)`;
  }

  private buildNode(scope: Scope): CoverageNode {
    const nodeId = CoverageTreeModel.getScopePath(scope) || scope.logicalName;
    return {
      nodeId,
      label: scope.logicalName,
      scopeType: scope.scopeType,
      stats: computeAggregateStats(scope, this.opts),
      scope,
      children: [],
    };
  }
}
