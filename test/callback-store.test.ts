import { describe, expect, it } from 'vitest';
import { createCallbackStore } from '../scripts/callback-store.js';

describe('callback store', () => {
  it('returns what was stored, by messageId', () => {
    const s = createCallbackStore();
    s.add('m1', { a: 1 });
    expect(s.get('m1')?.body).toEqual({ a: 1 });
    expect(s.get('nope')).toBeUndefined();
  });

  it('knows the latest one', () => {
    const s = createCallbackStore();
    expect(s.latest()).toBeUndefined();
    s.add('m1', 1);
    s.add('m2', 2);
    expect(s.latest()).toMatchObject({ messageId: 'm2', callback: { body: 2 } });
  });

  it('lists newest first', () => {
    const s = createCallbackStore();
    s.add('m1', 1);
    s.add('m2', 2);
    expect(s.list().map((x) => x.messageId)).toEqual(['m2', 'm1']);
  });

  it('forgets the oldest once it holds more than its limit', () => {
    const s = createCallbackStore(2);
    s.add('m1', 1);
    s.add('m2', 2);
    s.add('m3', 3);
    expect(s.get('m1')).toBeUndefined();
    expect(s.list().map((x) => x.messageId)).toEqual(['m3', 'm2']);
  });

  it('a repeated messageId replaces the old entry and becomes the latest', () => {
    const s = createCallbackStore();
    s.add('m1', 'old');
    s.add('m2', 'x');
    s.add('m1', 'new');
    expect(s.get('m1')?.body).toBe('new');
    expect(s.latest()?.messageId).toBe('m1');
    expect(s.list()).toHaveLength(2);
  });

  it('waitFor resolves as soon as the callback arrives', async () => {
    const s = createCallbackStore();
    setTimeout(() => s.add('m1', 'hello'), 30);
    const got = await s.waitFor('m1', 1000, 10);
    expect(got?.body).toBe('hello');
  });

  it('waitFor gives up with undefined after the time limit', async () => {
    const s = createCallbackStore();
    expect(await s.waitFor('never', 60, 10)).toBeUndefined();
  });

  it('waitFor returns at once when it is already there', async () => {
    const s = createCallbackStore();
    s.add('m1', 1);
    expect((await s.waitFor('m1', 1000))?.body).toBe(1);
  });
});
