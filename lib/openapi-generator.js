/**
 * Runtime OpenAPI 3.0 spec generator from Express router stack.
 * # ponytail: Introspects Express internals (app._router, layer.route, layer.regexp).
 *   Breaks if Express changes internal representation.
 */

const METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'head', 'options']);

function getMountPath(layer) {
	if (!layer.regexp) return '';
	if (layer.regexp.fast_slash) return '';

	const src = layer.regexp.source;
	// # ponytail: only handles static string mount paths (e.g. '/api/jobs').
	// Express 4.x compiles '/api/jobs' into '^\\/api\\/jobs(?:\\/|$)'.
	// Parameterized mount paths fall through to empty string.
	const m = src.match(/^\^\\\/(.+?)(?:\(\?:\\\/\|\$\)|\(\?=\\\/\|\$\))/);
	if (!m) return '';
	// Strip optional trailing slash marker Express embeds (e.g. 'admin/?' -> 'admin')
	return '/' + m[1].replace(/\\\//g, '/').replace(/\/\?$/, '');
}

function isRouter(layer) {
	return layer.handle && typeof layer.handle === 'function' && Array.isArray(layer.handle.stack);
}

function traverse(stack, prefix, out) {
	for (const layer of stack) {
		if (layer.route) {
			const route = layer.route;
			const fullPath = prefix + route.path;
			for (const method of Object.keys(route.methods)) {
				if (route.methods[method]) {
					out.push({
						method: method.toUpperCase(),
						path: fullPath,
						mountPrefix: prefix,
					});
				}
			}
		} else if (isRouter(layer)) {
			const mountPath = getMountPath(layer);
			traverse(layer.handle.stack, prefix + mountPath, out);
		}
	}
}

function deriveTag(mountPrefix, fullPath) {
	const prefixParts = mountPrefix.split('/').filter(Boolean);
	if (prefixParts.length >= 2 && prefixParts[0] === 'api') {
		const last = prefixParts[prefixParts.length - 1];
		return last.charAt(0).toUpperCase() + last.slice(1).replace(/-/g, ' ');
	}
	const pathParts = fullPath.split('/').filter(Boolean);
	const tagBase = pathParts[1] || pathParts[0] || 'api';
	return tagBase.charAt(0).toUpperCase() + tagBase.slice(1).replace(/-/g, ' ');
}

function deriveOperationId(method, path) {
	const segments = path.split('/').filter(Boolean);
	const parts = segments.map((s) => s.replace(/^:(.+?)(\?)?$/, 'By$1'));
	return method.toLowerCase() + parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
}

function generateOpenAPISpec(app) {
	const endpoints = [];
	if (app._router && app._router.stack) {
		traverse(app._router.stack, '', endpoints);
	}

	const paths = {};
	for (const ep of endpoints) {
		// Skip catch-all wildcard routes — they are not real API endpoints
		if (ep.path === '*' || ep.path.includes('*')) continue;

		if (!paths[ep.path]) paths[ep.path] = {};
		paths[ep.path][ep.method.toLowerCase()] = {
			operationId: deriveOperationId(ep.method, ep.path),
			summary: `${ep.method} ${ep.path}`,
			tags: [deriveTag(ep.mountPrefix, ep.path)],
			security: [{ bearerAuth: [] }],
			responses: {
				200: { description: 'Success' },
			},
		};
	}

	return {
		openapi: '3.0.0',
		info: {
			title: 'Rekrut AI API',
			version: '1.0.0',
			description: 'Auto-generated from Express router stack introspection',
		},
		paths,
		components: {
			securitySchemes: {
				bearerAuth: {
					type: 'http',
					scheme: 'bearer',
					bearerFormat: 'JWT',
					description: 'JWT access token. Use the login endpoint to obtain one.',
				},
			},
		},
	};
}

function countEndpoints(app) {
	const endpoints = [];
	if (app._router && app._router.stack) {
		traverse(app._router.stack, '', endpoints);
	}
	// Count everything except wildcards so the baseline matches the spec filter
	return endpoints.filter((ep) => ep.path !== '*' && !ep.path.includes('*')).length;
}

module.exports = { generateOpenAPISpec, countEndpoints };
