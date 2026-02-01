// Landing Page Verification Script
// Tests that the landing page optimization is working correctly

const https = require('https');
const http = require('http');

const APP_URL = 'https://hireloop-vzvw.polsia.app';

async function fetch(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    protocol.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject);
  });
}

async function verifyLandingPage() {
  console.log('🔍 Verifying landing page optimization...\n');

  try {
    const result = await fetch(APP_URL);

    if (result.status !== 200) {
      console.error(`❌ Page not accessible: HTTP ${result.status}`);
      process.exit(1);
    }
    console.log('✓ Page loads successfully');

    // Check for key optimizations
    const html = result.body;
    const checks = [
      { name: 'Updated hero copy', pattern: /Stop Guessing\. Start.*Hiring Smart/i },
      { name: 'Social proof section', pattern: /Trusted by.*Job Seekers & Employers/i },
      { name: 'Testimonials', pattern: /Sarah M\.|David K\.|Priya R\./i },
      { name: 'Trust indicators', pattern: /12,000\+ Interviews Completed/i },
      { name: 'Updated How It Works', pattern: /How the.*AI Interview.*Works/i },
      { name: 'AI interview explanation', pattern: /Take Your AI Mock Interview/i },
      { name: 'Dual CTAs', pattern: /Practice Free Interview|Hire Verified Talent/i },
      { name: 'Mobile responsive styles', pattern: /@media \(max-width: 768px\)/i },
      { name: 'OmniScore mentioned', pattern: /OmniScore/i },
      { name: 'TrustScore mentioned', pattern: /TrustScore/i },
    ];

    let passed = 0;
    let failed = 0;

    checks.forEach(check => {
      if (check.pattern.test(html)) {
        console.log(`✓ ${check.name}`);
        passed++;
      } else {
        console.log(`✗ ${check.name} - NOT FOUND`);
        failed++;
      }
    });

    console.log(`\n📊 Results: ${passed}/${checks.length} checks passed`);

    if (failed > 0) {
      console.log(`\n⚠️  Warning: ${failed} checks failed. Review the deployment.`);
      process.exit(1);
    }

    console.log('\n✅ Landing page optimization verified!');
    console.log(`🌐 View it at: ${APP_URL}`);
    process.exit(0);

  } catch (error) {
    console.error('❌ Verification failed:', error.message);
    process.exit(1);
  }
}

verifyLandingPage();
