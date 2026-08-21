/**
 * @jest-environment node
 *
 * The stale-queue sweep in /api/cron/process-calls.
 *
 * The first live run of this endpoint returned a bare 500 where the dry run of
 * the same work had returned 200. The only difference between the two is the
 * writes, and there were fifty of them awaited one after another. These cover
 * the shape of that write path: one round trip, not fifty, and a limit that a
 * repeat run can be made smaller with.
 */

import { POST } from '../src/pages/api/cron/process-calls';

const SECRET = 'test-cron-secret';

/** Enough D1 to see how the endpoint talks to it. */
function fakeDb(staleRows: any[]) {
  const calls = { batches: [] as any[][], singleRuns: [] as string[], selects: [] as string[] };
  const stmt = (sql: string) => ({
    sql,
    binds: [] as any[],
    bind(...b: any[]) { this.binds = b; return this; },
    async all() {
      calls.selects.push(sql);
      if (sql.includes('NOT (1 = 1')) {
        const limit = Number(this.binds[0]);
        return { results: staleRows.slice(0, limit) };
      }
      return { results: [] };
    },
    async run() { calls.singleRuns.push(sql); return { meta: { last_row_id: 1 } }; },
    async first() { return null; },
  });
  return {
    calls,
    prepare: (sql: string) => stmt(sql),
    async batch(stmts: any[]) { calls.batches.push(stmts); return stmts.map(() => ({ success: true })); },
  };
}

const staleRow = (id: number) => ({ id, booking_id: null, check_in_date: null, booking_status: null });

function ctx(db: any) {
  return {
    runtime: {
      env: {
        DB: db,
        CRON_SECRET: SECRET,
        TWILIO_ACCOUNT_SID: 'AC', TWILIO_AUTH_TOKEN: 't', TWILIO_FROM_NUMBER: '+1',
      },
    },
  };
}

const call = (db: any, qs = '') =>
  (POST as any)({
    request: new Request(`https://daydreamhub.com/api/cron/process-calls${qs}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SECRET}` },
    }),
    locals: ctx(db),
  });

describe('process-calls', () => {
  it('closes the whole sweep in one round trip, not one per row', async () => {
    const db = fakeDb(Array.from({ length: 50 }, (_, i) => staleRow(i + 1)));
    const body = await (await call(db)).json();

    expect(body.stood_down).toBe(50);
    expect(db.calls.batches).toHaveLength(1);
    expect(db.calls.batches[0]).toHaveLength(50);
    // Nothing else may sneak an UPDATE out on its own.
    expect(db.calls.singleRuns).toHaveLength(0);
  });

  it('writes nothing on a dry run', async () => {
    const db = fakeDb(Array.from({ length: 50 }, (_, i) => staleRow(i + 1)));
    const body = await (await call(db, '?dry_run=1')).json();

    expect(body.dry_run).toBe(true);
    expect(body.stood_down).toBe(50);
    expect(db.calls.batches).toHaveLength(0);
    expect(db.calls.singleRuns).toHaveLength(0);
  });

  it('honours ?limit so a failing run can be repeated smaller', async () => {
    const db = fakeDb(Array.from({ length: 50 }, (_, i) => staleRow(i + 1)));
    const body = await (await call(db, '?limit=10')).json();

    expect(body.stood_down).toBe(10);
    expect(db.calls.batches[0]).toHaveLength(10);
  });

  it('reports the reason when something throws, instead of a bare 500', async () => {
    const db = fakeDb([staleRow(1)]);
    db.batch = async () => { throw new Error('too many API requests by single worker invocation'); };

    const res = await call(db);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.message).toContain('too many API requests');
  });

  it('still refuses an unauthenticated caller', async () => {
    const db = fakeDb([staleRow(1)]);
    const res = await (POST as any)({
      request: new Request('https://daydreamhub.com/api/cron/process-calls', { method: 'POST' }),
      locals: ctx(db),
    });
    expect(res.status).toBe(401);
    expect(db.calls.batches).toHaveLength(0);
  });
});
