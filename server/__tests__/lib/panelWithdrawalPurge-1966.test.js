/**
 * panelWithdrawalPurge-1966.test.js — #1966 M-1 (follow-up to S-D19/#1956)
 *
 * The §7.1 withdrawal purge must be transactional PER RECORDING and must
 * surface failures beyond a log line:
 *  - happy path: each recording's five purge statements run inside one
 *    BEGIN…COMMIT on a dedicated client, under the per-event advisory
 *    lock; the function returns the purged count;
 *  - a statement failing mid-recording rolls THAT recording back (no
 *    COMMIT), earlier recordings stay committed, and the function throws
 *    an error carrying `failures` (which recordings, why) and `purged`
 *    (how many committed) so the caller can act — retry purges exactly
 *    the remainder because failed recordings keep their runs and stay
 *    selectable.
 *
 * The db pool is a test double; lib/db is mocked so loading the module
 * opens no real pool. The real-DB behaviour is proven separately by the
 * HL-003 E2E script recorded in the #1966 build log.
 */
jest.mock('../../../lib/db', () => ({ query: jest.fn(), connect: jest.fn() }));

const { purgeCompletedDiarizationForEvent } = require('../../../lib/panelWithdrawalPurge');

function fakeClient({ failOn } = {}) {
	const calls = [];
	return {
		calls,
		release: jest.fn(),
		async query(sql, params) {
			calls.push({ sql, params });
			if (failOn && failOn(sql, params)) throw new Error('injected mid-purge failure');
			return { rows: [], rowCount: 1 };
		},
	};
}

function fakePool(clients) {
	let next = 0;
	return {
		query: jest.fn(async (sql) => {
			if (sql.includes('SELECT DISTINCT ir.id')) return { rows: [{ id: 11 }, { id: 22 }] };
			return { rows: [] };
		}),
		connect: jest.fn(async () => clients[next++]),
	};
}

const sqlOf = (client) => client.calls.map((c) => c.sql);

describe('#1966 M-1 — withdrawal purge transactionality', () => {
	it('commits each recording in its own transaction under the advisory lock and returns the count', async () => {
		const c11 = fakeClient();
		const c22 = fakeClient();
		const pool = fakePool([c11, c22]);

		const purged = await purgeCompletedDiarizationForEvent(7, pool);

		expect(purged).toBe(2);
		for (const client of [c11, c22]) {
			const sqls = sqlOf(client);
			expect(sqls[0]).toBe('BEGIN');
			expect(sqls[1]).toContain('pg_advisory_xact_lock');
			expect(client.calls[1].params).toEqual(['panel-event:7']);
			expect(sqls[sqls.length - 1]).toBe('COMMIT');
			expect(sqls.filter((s) => s.startsWith('DELETE') || s.startsWith('UPDATE'))).toHaveLength(5);
			expect(client.release).toHaveBeenCalledTimes(1);
		}
		expect(sqlOf(c11).join(' ')).toContain('WHERE recording_id = $1');
		expect(c11.calls.find((c) => c.sql.startsWith('DELETE FROM diarization_runs')).params).toEqual([
			11,
		]);
		expect(c22.calls.find((c) => c.sql.startsWith('DELETE FROM diarization_runs')).params).toEqual([
			22,
		]);
	});

	it('rolls back the failing recording, keeps earlier commits, and throws a caller-actionable error', async () => {
		const c11 = fakeClient();
		const c22 = fakeClient({
			failOn: (sql, params) =>
				sql.includes('DELETE FROM recording_speaker_mappings') && params?.[0] === 22,
		});
		const pool = fakePool([c11, c22]);

		let thrown = null;
		try {
			await purgeCompletedDiarizationForEvent(7, pool);
		} catch (err) {
			thrown = err;
		}

		expect(thrown).not.toBeNull();
		expect(thrown.message).toContain('22');
		expect(thrown.failures).toEqual([{ recordingId: 22, message: 'injected mid-purge failure' }]);
		expect(thrown.purged).toBe(1);
		// Recording 11 committed; recording 22 rolled back, never committed.
		expect(sqlOf(c11)).toContain('COMMIT');
		expect(sqlOf(c22)).toContain('ROLLBACK');
		expect(sqlOf(c22)).not.toContain('COMMIT');
		expect(c22.release).toHaveBeenCalledTimes(1);
	});

	it('uses a bare client queryable directly (no connect) and does not release it', async () => {
		const client = fakeClient();
		client.query = jest.fn(async (sql, params) => {
			client.calls.push({ sql, params });
			if (sql.includes('SELECT DISTINCT ir.id')) return { rows: [{ id: 11 }] };
			return { rows: [], rowCount: 1 };
		});
		delete client.connect;

		const purged = await purgeCompletedDiarizationForEvent(7, client);

		expect(purged).toBe(1);
		expect(sqlOf(client)[0]).toContain('SELECT DISTINCT');
		expect(sqlOf(client)).toContain('BEGIN');
		expect(sqlOf(client)).toContain('COMMIT');
		expect(client.release).not.toHaveBeenCalled();
	});
});
