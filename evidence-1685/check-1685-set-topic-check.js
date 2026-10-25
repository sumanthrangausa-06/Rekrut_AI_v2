#!/usr/bin/env node
/**
 * check-1685-set-topic-check.js — RED/GREEN proof for issue #1685.
 *
 * Defect: scripts/create-assessment-set.js creates a set from question
 * ids but never verifies each question's topic_id equals the set's
 * topic. An off-topic (or NULL-topic / unmapped) question can be put
 * into a set for a different topic and creation succeeds.
 *
 * Method: exercise the real exported createAssessmentSet() with a
 * pg-style fake client (the function's own documented contract: "client
 * is any pg-style client"). No mocks of the function under test — the
 * fake only stands in for Postgres, returning fixture rows for the
 * exact queries the script issues and recording every INSERT so
 * "writing nothing" on abort is observable.
 *
 * Fixtures:
 *   set topic = 20
 *   question 101: topic_id 20,   approved  (on-topic)
 *   question 102: topic_id 99,   approved  (off-topic)
 *   question 103: topic_id NULL, approved  (unmapped)
 *   question 104: topic_id 20,   pending   (on-topic, unapproved)
 *
 * Expectations (GREEN):
 *   1. Off-topic member (102) -> throws, error names question 102 and
 *      both topics (99 and 20), and zero INSERTs were issued.
 *   2. NULL-topic member (103) -> throws, error names question 103,
 *      NULL/unmapped, and set topic 20, and zero INSERTs were issued.
 *   3. On-topic members (101, 104) -> succeeds exactly as before:
 *      { questionCount: 2, approvedCount: 1 }, one set INSERT and two
 *      member INSERTs in serving order (positions 1, 2).
 *
 * Exit 0 = all expectations met (GREEN). Exit 1 = any failed (RED on
 * the unpatched script: cases 1 and 2 fail because creation succeeds).
 */
'use strict';

const { createAssessmentSet } = require('../scripts/create-assessment-set');

const SET_TOPIC = 20;
const FIXTURES = {
	101: { id: 101, topic_id: 20, review_status: 'approved' },
	102: { id: 102, topic_id: 99, review_status: 'approved' },
	103: { id: 103, topic_id: null, review_status: 'approved' },
	104: { id: 104, topic_id: 20, review_status: 'pending' },
};

function makeFakeClient() {
	const inserts = [];
	const queries = [];
	const conn = {
		release() {},
		async query(sql, params) {
			const text = String(sql).replace(/\s+/g, ' ').trim();
			queries.push(text);
			if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(text)) return { rows: [], rowCount: 0 };
			if (text.includes('FROM assessment_topics')) {
				return params[0] === SET_TOPIC ? { rows: [{ id: SET_TOPIC }], rowCount: 1 } : { rows: [], rowCount: 0 };
			}
			if (text.includes('FROM assessment_questions')) {
				const ids = params[0];
				const rows = ids.filter((id) => FIXTURES[id]).map((id) => ({ ...FIXTURES[id] }));
				return { rows, rowCount: rows.length };
			}
			if (text.includes('INSERT INTO assessment_sets')) {
				inserts.push({ kind: 'set', params: [...params] });
				return { rows: [{ id: 999 }], rowCount: 1 };
			}
			if (text.includes('INSERT INTO assessment_set_questions')) {
				inserts.push({ kind: 'member', params: [...params] });
				return { rows: [], rowCount: 1 };
			}
			throw new Error(`fake client: unexpected query: ${text}`);
		},
	};
	return {
		inserts,
		queries,
		async connect() {
			return conn;
		},
	};
}

let failures = 0;
function check(name, cond, extra = '') {
	console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
	if (!cond) failures += 1;
}

async function attempt(questionIds) {
	const client = makeFakeClient();
	try {
		const result = await createAssessmentSet(client, {
			topicId: SET_TOPIC,
			name: 'Check Set',
			format: 'mcq',
			difficultyBand: 'medium',
			questionIds,
		});
		return { client, result, error: null };
	} catch (error) {
		return { client, result: null, error };
	}
}

async function main() {
	console.log('check-1685: createAssessmentSet topic verification');
	console.log(`set topic = ${SET_TOPIC}; fixtures: 101->20/approved, 102->99/approved, 103->NULL/approved, 104->20/pending`);
	console.log('');

	// Case 1: off-topic member must be rejected, naming id + both topics, writing nothing.
	const off = await attempt([101, 102]);
	if (off.error) {
		console.log(`case 1 outcome: rejected with error: ${off.error.message}`);
	} else {
		console.log(`case 1 outcome: CREATED set ${JSON.stringify(off.result)} with inserts=${JSON.stringify(off.client.inserts)}`);
	}
	check('case 1: off-topic question 102 is rejected', off.error !== null);
	check(
		'case 1: error names offending question 102 and both topics (99 and 20)',
		!!off.error && /102/.test(off.error.message) && /99/.test(off.error.message) && /20/.test(off.error.message),
		off.error ? `error="${off.error.message}"` : 'no error thrown',
	);
	check('case 1: nothing written (zero INSERTs)', off.client.inserts.length === 0, `inserts=${off.client.inserts.length}`);

	// Case 2: NULL topic_id (unmapped) must be rejected likewise.
	const nul = await attempt([103]);
	if (nul.error) {
		console.log(`case 2 outcome: rejected with error: ${nul.error.message}`);
	} else {
		console.log(`case 2 outcome: CREATED set ${JSON.stringify(nul.result)} with inserts=${JSON.stringify(nul.client.inserts)}`);
	}
	check('case 2: NULL-topic question 103 is rejected', nul.error !== null);
	check(
		'case 2: error names offending question 103, NULL/unmapped, and set topic 20',
		!!nul.error && /103/.test(nul.error.message) && /null|unmapped/i.test(nul.error.message) && /20/.test(nul.error.message),
		nul.error ? `error="${nul.error.message}"` : 'no error thrown',
	);
	check('case 2: nothing written (zero INSERTs)', nul.client.inserts.length === 0, `inserts=${nul.client.inserts.length}`);

	// Case 3: on-topic creation behaves exactly as before.
	const on = await attempt([101, 104]);
	if (on.error) {
		console.log(`case 3 outcome: rejected with error: ${on.error.message}`);
	} else {
		console.log(`case 3 outcome: CREATED set ${JSON.stringify(on.result)} with inserts=${JSON.stringify(on.client.inserts)}`);
	}
	check('case 3: on-topic creation succeeds', on.error === null, on.error ? on.error.message : '');
	check(
		'case 3: result counts unchanged (questionCount 2, approvedCount 1)',
		!!on.result && on.result.questionCount === 2 && on.result.approvedCount === 1 && on.result.setId === 999,
		JSON.stringify(on.result),
	);
	check(
		'case 3: one set INSERT + two member INSERTs in order (101@1, 104@2)',
		on.client.inserts.length === 3 &&
			on.client.inserts[0].kind === 'set' &&
			on.client.inserts[1].kind === 'member' &&
			on.client.inserts[1].params[1] === 101 &&
			on.client.inserts[1].params[2] === 1 &&
			on.client.inserts[2].kind === 'member' &&
			on.client.inserts[2].params[1] === 104 &&
			on.client.inserts[2].params[2] === 2,
		`inserts=${JSON.stringify(on.client.inserts)}`,
	);

	console.log('');
	console.log(failures === 0 ? 'RESULT: ALL CHECKS PASSED (GREEN)' : `RESULT: ${failures} CHECK(S) FAILED (RED)`);
	process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
	console.error('check-1685 crashed:', err);
	process.exit(2);
});
