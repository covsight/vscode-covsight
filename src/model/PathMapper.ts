/**
 * Prefix-to-prefix path remapping configuration keyed by database path prefix.
 */
export type PathMappingConfig = Record<string, string>;

type MappingEntry = readonly [string, string];

/**
 * Applies workspace path mappings to source paths stored in a coverage database.
 *
 * Mappings are sorted longest-prefix-first so the most specific configured prefix
 * wins when several entries overlap.
 */
export class PathMapper {
  private sortedMappings: MappingEntry[];

  constructor(private mappings: PathMappingConfig) {
    this.sortedMappings = PathMapper.sortMappings(mappings);
  }

  /**
   * Maps a database path to a workspace path.
   *
   * Returns {@code null} when no configured prefix matches the incoming path.
   */
  map(dbPath: string): string | null {
    for (const [prefix, replacement] of this.sortedMappings) {
      if (dbPath.startsWith(prefix)) {
        return `${replacement}${dbPath.slice(prefix.length)}`;
      }
    }
    return null;
  }

  /**
   * Maps a database path, falling back to the original path when no mapping exists.
   */
  mapOrPassthrough(dbPath: string): string {
    return this.map(dbPath) ?? dbPath;
  }

  /**
   * Replaces the active mapping table.
   *
   * The sorted cache is rebuilt immediately so subsequent lookups use the new
   * longest-prefix ordering.
   */
  updateMappings(mappings: PathMappingConfig): void {
    this.mappings = mappings;
    this.sortedMappings = PathMapper.sortMappings(mappings);
  }

  /**
   * Creates a mapper from raw configuration data.
   */
  static fromConfig(config: PathMappingConfig): PathMapper {
    return new PathMapper(config);
  }

  private static sortMappings(mappings: PathMappingConfig): MappingEntry[] {
    return Object.entries(mappings).sort((lhs, rhs) => rhs[0].length - lhs[0].length);
  }
}
