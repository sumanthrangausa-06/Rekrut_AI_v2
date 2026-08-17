#!/usr/bin/env node
/**
 * CI verification script for auto-generated OpenAPI docs.
 * Loads server.js in test mode (no port binding), introspects the Express app,
 * and checks that >90% of endpoints are documented.
 */

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret';

const app = require('../server');
const { generateOpenAPISpec, countEndpoints } = require('../lib/openapi-generator');

const spec = generateOpenAPISpec(app);
const totalRoutes = countEndpoints(app);

let documentedOps = 0;
for (const pathItem of Object.values(spec.paths)) {
	documentedOps += Object.keys(pathItem).length;
}

const pct = totalRoutes > 0 ? Math.round((documentedOps / totalRoutes) * 1000) / 10 : 0;
console.log(`Documented ${documentedOps}/${totalRoutes} endpoints (${pct}%)`);

process.exit(pct > 90 ? 0 : 1);
