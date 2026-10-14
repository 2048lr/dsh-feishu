/**
 * A bounded, in-memory record of what the Feishu tools did.
 *
 * This exists for the browser panel: the model can describe a call, but the
 * person watching wants a durable list of "what did it create in my drive".
 * The ring is deliberately memory-only and small - it is a view, not an audit
 * log, and the session transcript remains the record of authority.
 *
 * @module dsh-feishu/activity
 */

/**
 * Create the activity ring.
 * @param limit - the maximum number of entries retained.
 * @returns the ring.
 */
export function createActivityLog(limit) {
  const entries = [];
  const cap = limit !== undefined && limit > 0 ? limit : 50;
  let sequence = 0;

  return {
    /**
     * Append one entry, evicting the oldest beyond the cap.
     * @param entry - the entry facts.
     * @returns the stored entry.
     */
    record(entry) {
      sequence += 1;
      const stored = { seq: sequence, ...entry };
      entries.push(stored);
      while (entries.length > cap) entries.shift();
      return stored;
    },
    /**
     * List the retained entries, oldest first.
     * @returns the entries.
     */
    list() {
      return entries.map((entry) => ({ ...entry }));
    },
    /** Drop every retained entry. */
    clear() {
      entries.length = 0;
    },
  };
}
