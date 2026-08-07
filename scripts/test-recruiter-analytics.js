if (process.env.NODE_ENV === 'production') {
	throw new Error('Test scripts cannot run in production');
}

const http = require('node:http');

const _BASE_URL = 'http://localhost:3000';
const TEST_USER = {
	email: 'analytics-test@rekrutai.co',
	get password() {
		const p = process.env.TEST_LOGIN_PASSWORD;
		if (!p) {
			console.error('TEST_LOGIN_PASSWORD environment variable is required');
			process.exit(1);
		}
		return p;
	},
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
	console.log('🧪 Recruiter Analytics Tests\n');

	// 1. Login
	console.log('1️⃣  Login as recruiter...');
	const login = await request('/api/auth/login', 'POST', {}, TEST_USER);
	if (login.status !== 200 || !login.body.token) {
		console.log('❌ Login failed:', login.body);
		return process.exit(1);
	}
	const token = login.body.token;
	console.log(
		'✅ Logged in as recruiter',
		login.body.user.id,
		'(company:',
		`${login.body.user.company_id})`,
	);

	// 2. Test analytics endpoint
	console.log('\n2️⃣  GET /api/recruiter/analytics...');
	const analytics = await request('/api/recruiter/analytics?days=30', 'GET', {
		Authorization: `Bearer ${token}`,
	});
	if (analytics.status !== 200) {
		console.log('❌ Analytics failed:', analytics.status, analytics.body);
		return process.exit(1);
	}
	console.log('✅ Analytics endpoint returns 200');
	console.log('   Fields:', Object.keys(analytics.body).join(', '));

	// 3. Verify expected fields
	const expected = [
		'job_stats',
		'application_stats',
		'avg_time_to_hire',
		'score_distribution',
		'source_breakdown',
		'overview',
		'pipeline',
		'applications',
		'candidates',
	];
	const missing = expected.filter((f) => !(f in analytics.body));
	if (missing.length > 0) {
		console.log('⚠️  Missing fields:', missing.join(', '));
	} else {
		console.log('✅ All expected fields present');
	}

	// 4. Test dashboard endpoint (for comparison)
	console.log('\n3️⃣  GET /api/recruiter/dashboard (should still work)...');
	const dashboard = await request('/api/recruiter/dashboard?days=30', 'GET', {
		Authorization: `Bearer ${token}`,
	});
	console.log('   Dashboard:', dashboard.status === 200 ? '✅' : '❌', dashboard.status);

	// 5. Test jobs endpoint
	console.log('\n4️⃣  GET /api/recruiter/jobs...');
	const jobs = await request('/api/recruiter/jobs?days=30', 'GET', {
		Authorization: `Bearer ${token}`,
	});
	console.log('   Jobs:', jobs.status === 200 ? '✅' : '❌', jobs.status);

	console.log('\n📊 All tests complete');
	process.exit(0);
}

runTests().catch((err) => {
	console.error('❌ Test error:', err.message);
	process.exit(1);
});
