/** How many distinct paths to remember segments for. Far past the few hundred any filter set uses;
 *  a cap only matters because a path can come from outside the app (a saved or pasted filter). */
const PATH_SEGMENTS_LIMIT = 5_000;
const PATH_SEGMENTS = new Map<string, string[]>();

/**
 * Read a dotted `origData` path (e.g. "details.growth") off a row object.
 * Returns `undefined` when any segment is missing or a non-object is hit.
 *
 * Handy for writing a `FilterValueOf` when rows are nested objects.
 */
export function getValueByPath(obj: unknown, path: string): unknown {
  // Split once per path, not once per row: a filter reads the same few paths for every row, and
  // the segments never change. Bounded by the number of distinct paths in use, not by rows.
  let segments = PATH_SEGMENTS.get(path);
  if (!segments) {
    segments = path.split(".");
    if (PATH_SEGMENTS.size < PATH_SEGMENTS_LIMIT)
      PATH_SEGMENTS.set(path, segments);
  }
  let current: unknown = obj;
  for (const segment of segments) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}
