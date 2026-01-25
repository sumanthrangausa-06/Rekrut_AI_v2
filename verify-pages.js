// Verification script for recruiter dashboard and profile pages
const fs = require('fs');
const path = require('path');

console.log('🔍 Verifying Recruiter Pages...\n');

const filesToCheck = [
  'public/recruiter-dashboard.html',
  'public/recruiter-profile.html',
  'migrations/003_add_company_profile_fields.js'
];

let allPassed = true;

filesToCheck.forEach(file => {
  const fullPath = path.join(__dirname, file);
  if (fs.existsSync(fullPath)) {
    const content = fs.readFileSync(fullPath, 'utf8');
    const size = (content.length / 1024).toFixed(2);
    console.log(`✅ ${file} exists (${size} KB)`);

    // Check for key features
    if (file === 'public/recruiter-profile.html') {
      const hasProfiles = content.includes('culture_description') &&
                         content.includes('core_values') &&
                         content.includes('benefits') &&
                         content.includes('office_locations');
      if (hasProfiles) {
        console.log('   ✓ Contains culture, values, benefits, and locations fields');
      } else {
        console.log('   ⚠️  Missing some required fields');
        allPassed = false;
      }
    }
  } else {
    console.log(`❌ ${file} NOT FOUND`);
    allPassed = false;
  }
});

console.log('\n' + (allPassed ? '✅ All checks passed!' : '⚠️  Some issues found'));
process.exit(allPassed ? 0 : 1);
