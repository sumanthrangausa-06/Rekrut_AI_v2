const express = require('express');
const swaggerUi = require('swagger-ui-express');
const { authMiddleware } = require('../lib/auth');
const { generateOpenAPISpec } = require('../lib/openapi-generator');

const router = express.Router();

let specCache = null;

function getSpec(app) {
	if (!specCache) {
		specCache = generateOpenAPISpec(app);
	}
	return specCache;
}

// Protect the docs page itself — must be logged in to view
router.use(authMiddleware);

// Serve Swagger UI assets and HTML
router.use('/', swaggerUi.serve, (req, res, next) => {
	const spec = getSpec(req.app);
	swaggerUi.setup(spec, { explorer: true })(req, res, next);
});

module.exports = router;
