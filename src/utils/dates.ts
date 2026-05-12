/**
 * SQLite's CURRENT_TIMESTAMP stores values in UTC but emits them without a
 * timezone designator ("2026-05-13 03:21:00"). Both Node's Date and Flutter's
 * DateTime.parse default to local-time interpretation for strings without a
 * timezone, which causes display to be off by the local tz offset.
 *
 * These helpers turn any naive timestamp into a strict ISO-8601 string with
 * an explicit `Z` so consumers parse it as UTC unambiguously.
 */

const NAIVE_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/;
const HAS_TZ_RE = /[Zz]$|[+-]\d{2}:?\d{2}$/;

/** Returns the string as a UTC ISO-8601 (always ending in 'Z'). */
export function toIsoUtc(value: unknown): string | null {
    if (value == null) return null;
    const s = String(value);
    if (HAS_TZ_RE.test(s)) {
        // Already has a timezone designator; trust it.
        return s.replace(' ', 'T');
    }
    if (NAIVE_RE.test(s)) {
        return s.replace(' ', 'T') + 'Z';
    }
    // Anything else: try parsing as a date and re-emit ISO.
    const d = new Date(s);
    return isNaN(d.getTime()) ? s : d.toISOString();
}

/** Parse a naive UTC string (or ISO) into a Date that's correct in UTC. */
export function parseUtcDate(value: unknown): Date | null {
    const iso = toIsoUtc(value);
    if (!iso) return null;
    const d = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
}

/** A list of column names whose values are timestamps. */
const TIMESTAMP_FIELDS = new Set([
    'scheduled_at', 'created_at', 'accepted_at', 'started_at',
    'completed_at', 'changed_at', 'paid_at', 'period_start',
    'period_end', 'read_at', 'deleted_at', 'last_restocked',
]);

/**
 * Walks a row (or array of rows) and normalises any field whose key matches a
 * known timestamp column. Leaves non-timestamp fields untouched.
 */
export function normaliseTimestamps<T>(row: T): T {
    if (row == null) return row;
    if (Array.isArray(row)) {
        return row.map((r) => normaliseTimestamps(r)) as any;
    }
    if (typeof row !== 'object') return row;
    const out: any = { ...row };
    for (const key of Object.keys(out)) {
        if (TIMESTAMP_FIELDS.has(key) && out[key]) {
            out[key] = toIsoUtc(out[key]);
        }
    }
    return out;
}
