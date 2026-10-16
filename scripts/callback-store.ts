/** Keeps the most recent callbacks the test buyer received, so a tool that cannot receive them (Postman) can fetch them. */
export interface StoredCallback {
  receivedAt: string;
  body: unknown;
}

export interface CallbackStore {
  add(messageId: string, body: unknown): void;
  get(messageId: string): StoredCallback | undefined;
  latest(): { messageId: string; callback: StoredCallback } | undefined;
  list(): { messageId: string; receivedAt: string }[];
  /** Resolves with the callback once it arrives, or undefined after `ms`. */
  waitFor(messageId: string, ms: number, pollMs?: number): Promise<StoredCallback | undefined>;
}

export function createCallbackStore(
  limit = 100,
  now: () => Date = () => new Date(),
): CallbackStore {
  // A Map keeps insertion order, so the oldest entry is the first key.
  const items = new Map<string, StoredCallback>();
  return {
    add(messageId, body) {
      items.delete(messageId);
      items.set(messageId, { receivedAt: now().toISOString(), body });
      while (items.size > limit) {
        const oldest = items.keys().next().value;
        if (oldest === undefined) break;
        items.delete(oldest);
      }
    },
    get: (messageId) => items.get(messageId),
    latest() {
      const last = [...items.entries()].at(-1);
      return last ? { messageId: last[0], callback: last[1] } : undefined;
    },
    list: () =>
      [...items.entries()]
        .map(([messageId, c]) => ({ messageId, receivedAt: c.receivedAt }))
        .reverse(),
    async waitFor(messageId, ms, pollMs = 50) {
      const deadline = Date.now() + ms;
      for (;;) {
        const found = items.get(messageId);
        if (found) return found;
        if (Date.now() >= deadline) return undefined;
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
    },
  };
}
