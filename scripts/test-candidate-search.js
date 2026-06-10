if (process.env.NODE_ENV === 'production') {
  throw new Error('Test scripts cannot run in production');
}

const http = require('node:http');

const TEST_USER = {
	email: 'analytics-test@rekrutai.co',
	password: 'Test1234!',
};

function request(path, method, headers, body) {
	return new Promise((resolve, reject) => {
		const options = {
			hostname: 'localhost',
			port: 3000,
			path,
			method,
			headers: { 'Content-Type': 'application/json', ...headers },
		};

		const req = http.request(options, (res) => {
			let data = '';
			res.on('data', (chunk) => (data += chunk));
			res.on('end', () => {
				try {
					resolve({ status: res.statusCode, body: JSON.parse(data) });
				} catch {
					resolve({ status: res.statusCode, body: data });
				}
			});
		});

		req.on('error', reject);
		if (body) req.write(JSON.stringify(body));
		req.end();
	});
}

async function runTests() {
	console.log('🧪 Candidate Search Tests\n');

	// 1. Login
	console.log('1️⃣  Login as recruiter...');
	const login = await request('/api/auth/login', 'POST', {}, TEST_USER);
	if (login.status !== 200 || !login.body.token) {
		console.log('❌ Login failed:', login.body);
		return process.exit(1);
	}
	const token = login.body.token;
	console.log('✅ Logged in as recruiter', login.body.user.id);

	// 2. Test candidates endpoint without filters
	console.log('\n2️⃣  GET /api/recruiter/candidates (simple list)...');
	const candidates = await request('/api/recruiter/candidates', 'GET', {
		Authorization: `Bearer ${token}`,
	});
	console.log('   Status:', candidates.status === 200 ? '✅' : '❌', candidates.status);

	// 3. Test candidates/full endpoint without filters
	console.log('\n3️⃣  GET /api/recruiter/candidates/full (no filters)...');
	const fullNoFilter = await request('/api/recruiter/candidates/full?page=1&limit=10', 'GET', {
		Authorization: `Bearer ${token}`,
	});
	if (fullNoFilter.status !== 200) {
		console.log('❌ Full candidates failed:', fullNoFilter.status, fullNoFilter.body);
	} else {
		console.log('✅ Full candidates returns 200');
		console.log(
			'   Total:',
			fullNoFilter.body.pagination?.total,
			'| Candidates:',
			fullNoFilter.body.candidates?.length,
		);
	}

	// 4. Test with search filter
	console.log('\n4️⃣  GET /api/recruiter/candidates/full?search=engineer...');
	const search = await request(
		'/api/recruiter/candidates/full?search=engineer&page=1&limit=10',
		'GET',
		{ Authorization: `Bearer ${token}` },
	);
	console.log('   Search:', search.status === 200 ? '✅' : '❌', search.status);
	if (search.status === 200) {
		console.log('   Total:', search.body.pagination?.total);
	} else {
		console.log('   Error:', search.body?.message || search.body);
	}

	// 5. Test with multiple filters
	console.log('\n5️⃣  GET /api/recruiter/candidates/full?search=senior&location=remote...');
	const multiFilter = await request(
		'/api/recruiter/candidates/full?search=senior&location=remote&minScore=70&page=1&limit=10',
		'GET',
		{ Authorization: `Bearer ${token}` },
	);
	console.log('   Multi-filter:', multiFilter.status === 200 ? '✅' : '❌', multiFilter.status);
	if (multiFilter.status !== 200) {
		console.log('   Error:', multiFilter.body?.message || multiFilter.body);
	}

	// 6. Test with skills filter
	console.log('\n6️⃣  GET /api/recruiter/candidates/full?skills=javascript,react...');
	const skillsFilter = await request(
		'/api/recruiter/candidates/full?skills=javascript,react&page=1&limit=10',
		'GET',
		{ Authorization: `Bearer ${token}` },
	);
	console.log('   Skills filter:', skillsFilter.status === 200 ? '✅' : '❌', skillsFilter.status);
	if (skillsFilter.status !== 200) {
		console.log('   Error:', skillsFilter.body?.message || skillsFilter.body);
	}

	// 7. Test with status filter
	console.log('\n7️⃣  GET /api/recruiter/candidates/full?status=applied...');
	const statusFilter = await request(
		'/api/recruiter/candidates/full?status=applied&page=1&limit=10',
		'GET',
		{ Authorization: `Bearer ${token}` },
	);
	console.log('   Status filter:', statusFilter.status === 200 ? '✅' : '❌', statusFilter.status);
	if (statusFilter.status !== 200) {
		console.log('   Error:', statusFilter.body?.message || statusFilter.body);
	}

	// 8. Test with sorting
	console.log('\n8️⃣  GET /api/recruiter/candidates/full?sortBy=omniscore&sortOrder=DESC...');
	const sorted = await request(
		'/api/recruiter/candidates/full?sortBy=omniscore&sortOrder=DESC&page=1&limit=10',
		'GET',
		{ Authorization: `Bearer ${token}` },
	);
	console.log('   Sorted:', sorted.status === 200 ? '✅' : '❌', sorted.status);
	if (sorted.status !== 200) {
		console.log('   Error:', sorted.body?.message || sorted.body);
	}

	// 9. Test ranked candidates endpoint
	console.log('\n9️⃣  GET /api/recruiter/jobs/1/ranked-candidates...');
	const ranked = await request('/api/recruiter/jobs/1/ranked-candidates', 'GET', {
		Authorization: `Bearer ${token}`,
	});
	console.log('   Ranked:', ranked.status === 200 ? '✅' : '❌', ranked.status);
	if (ranked.status !== 200) {
		console.log('   Error:', ranked.body?.message || ranked.body);
	}

	// 10. Test AI compare endpoint
	console.log('\n🔟  POST /api/recruiter/ai/compare-candidates...');
	const compare = await request(
		'/api/recruiter/ai/compare-candidates',
		'POST',
		{ Authorization: `Bearer ${token}` },
		{
			candidate_ids: [1, 2],
			job_id: 1,
		},
	);
	console.log('   Compare:', compare.status, '(expected 400 or 200)');
	if (compare.status === 400) {
		console.log('   ✅ Correctly returns 400 for <2 valid candidates');
	} else if (compare.status === 200) {
		console.log('   ✅ Returns 200 with comparison');
	} else {
		console.log('   ⚠️ Unexpected:', compare.body?.message || compare.body);
	}

	console.log('\n📊 All candidate search tests complete');
	process.exit(0);
}

runTests().catch((err) => {
	console.error('❌ Test error:', err.message);
	process.exit(1);
});
