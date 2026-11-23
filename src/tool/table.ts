/** Fixed-width columns, one row per item: the plain-text form of a list. */
export function table(rows: Record<string, unknown>[], columns: string[]): string {
  if (!rows.length) return '(none)\n';
  const cell = (v: unknown) => (v === undefined || v === null ? '-' : Array.isArray(v) ? v.join(',') : String(v)).replace(/\s+/g, ' ');
  const widths = columns.map((c) => Math.min(60, Math.max(c.length, ...rows.map((r) => cell(r[c]).length))));
  const line = (vals: string[]) => vals.map((v, i) => (i === vals.length - 1 ? v : v.slice(0, widths[i]).padEnd(widths[i]))).join('  ').trimEnd();
  return [line(columns.map((c) => c.toUpperCase())), ...rows.map((r) => line(columns.map((c) => cell(r[c]))))].join('\n') + '\n';
}
