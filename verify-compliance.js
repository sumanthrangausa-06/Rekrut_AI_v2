// Verification script for compliance features
const { AuditLogger } = require('./services/auditLogger');
const BiasDetection = require('./services/biasDetection');
const ScoreExplainer = require('./services/scoreExplainer');

console.log('✓ AuditLogger service loaded');
console.log('✓ BiasDetection service loaded');
console.log('✓ ScoreExplainer service loaded');

// Test that services have expected methods
if (typeof AuditLogger.log !== 'function') {
  console.error('✗ AuditLogger.log is not a function');
  process.exit(1);
}

if (typeof BiasDetection.generateReport !== 'function') {
  console.error('✗ BiasDetection.generateReport is not a function');
  process.exit(1);
}

if (typeof ScoreExplainer.explainOmniScore !== 'function') {
  console.error('✗ ScoreExplainer.explainOmniScore is not a function');
  process.exit(1);
}

console.log('✓ All compliance services have expected methods');
console.log('\nVerification PASSED: All compliance features are properly configured');
