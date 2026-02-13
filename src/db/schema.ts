/**
 * UCIS Database Schema Constants
 * Based on pyucis schema v2.1
 */

// Scope Types
export enum ScopeType {
    INSTANCE = 0,
    COVERGROUP = 1,
    COVERPOINT = 2,
    CROSS = 3,
    TOGGLE = 4,
    BRANCH = 5,
    EXPRESSION = 6,
    FSM = 7,
    ASSERTION = 8
}

// Coverage Item Types
export enum CoverType {
    CVGBIN = 0,
    IGNOREBIN = 1,
    ILLEGALBIN = 2,
    DEFAULTBIN = 3
}

// Table Names
export const Tables = {
    SCOPES: 'scopes',
    COVERITEMS: 'coveritems',
    CROSS_COVERPOINTS: 'cross_coverpoints',
    HISTORY_NODES: 'history_nodes',
    COVERITEM_TESTS: 'coveritem_tests',
    FILES: 'files',
    DESIGN_UNITS: 'design_units',
    TAGS: 'tags',
    OBJECT_TAGS: 'object_tags',
    DB_METADATA: 'db_metadata',
    TOGGLE_BITS: 'toggle_bits',
    FSM_STATES: 'fsm_states',
    FSM_TRANSITIONS: 'fsm_transitions'
};

// Scope interface
export interface Scope {
    scope_id: number;
    parent_id: number | null;
    scope_type: ScopeType;
    scope_name: string;
    scope_flags?: number;
    weight: number;
    goal?: number;
    limit_val?: number;
    source_file_id: number | null;
    source_line: number | null;
    source_token?: number | null;
    language_type?: number;
    per_instance?: number;
    merge_instances?: number;
    get_inst_coverage?: number;
    at_least: number;
    auto_bin_max?: number;
    detect_overlap?: number;
    strobe?: number;
}

// CoverItem interface
export interface CoverItem {
    cover_id: number;
    scope_id: number;
    cover_index: number;
    cover_type: CoverType;
    cover_name: string;
    cover_flags?: number;
    cover_data: number;  // hit count
    cover_data_fec?: number;
    at_least: number;    // goal
    weight: number;
    goal?: number;
    limit_val?: number;
    source_file_id?: number | null;
    source_line?: number | null;
    source_token?: number | null;
}

// Database metadata
export interface DbMetadata {
    schema_version: string;
    ucis_version: string;
    created_time?: string;
    tool_name?: string;
}

// History node (test run)
export interface HistoryNode {
    history_id: number;
    parent_id: number | null;
    history_kind: number;
    logical_name: string;
    physical_name?: string;
    test_status?: number;
    sim_time_low?: number;
    sim_time_high?: number;
    time_unit?: number;
    cpu_time?: number;
    seed?: string;
    cmd_line?: string;
    compulsory?: number;
    date?: string;
    user_name?: string;
    cost?: number;
    version?: string;
}

// File reference
export interface FileRef {
    file_id: number;
    file_path: string;
    file_hash?: string;
    file_table_id?: number;
}
