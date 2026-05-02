/**
 * Test Script for Email Notifications System
 * 
 * This script verifies:
 * 1. Database migration ran successfully
 * 2. Email service configuration
 * 3. Template rendering
 * 4. API endpoints (simulated)
 * 
 * Run: node test-email-notifications.js
 */

require('dotenv').config();
const pool = require('./lib/db');
const emailService = require('./lib/email-service');

const COLORS = {
  GREEN: '\x1b[32m',
  RED: '\x1b[31m',
  YELLOW: '\x1b[33m',
  CYAN: '\x1b[36m',
  RESET: '\x1b[0m'
};

function log(message, color = 'RESET') {
  console.log(`${COLORS[color]}${message}${COLORS.RESET}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(60));
  log(title, 'CYAN');
  console.log('='.repeat(60));
}

async function testDatabaseTables() {
  logSection('1. Testing Database Tables');
  
  const tables = [
    'notification_templates',
    'notification_logs', 
    'notification_preferences',
    'notification_queue'
  ];
  
  let allPassed = true;
  
  for (const table of tables) {
    try {
      const result = await pool.query(
        `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)`,
        [table]
      );
      
      if (result.rows[0].exists) {
        log(`  ✓ Table "${table}" exists`, 'GREEN');
        
        // Get row count
        const countResult = await pool.query(`SELECT COUNT(*) FROM ${table}`);
        log(`    → ${countResult.rows[0].count} rows`, 'YELLOW');
      } else {
        log(`  ✗ Table "${table}" NOT FOUND`, 'RED');
        allPassed = false;
      }
    } catch (err) {
      log(`  ✗ Error checking table "${table}": ${err.message}`, 'RED');
      allPassed = false;
    }
  }
  
  return allPassed;
}

async function testDefaultTemplates() {
  logSection('2. Testing Default Templates');
  
  const expectedTemplates = [
    'application_received',
    'interview_scheduled',
    'offer_extended',
    'application_rejected',
    'assessment_invite',
    'onboarding_welcome',
    'password_reset',
    'weekly_digest'
  ];
  
  let allPassed = true;
  
  try {
    const result = await pool.query(
      'SELECT name FROM notification_templates ORDER BY name'
    );
    
    const foundTemplates = result.rows.map(r => r.name);
    
    for (const expected of expectedTemplates) {
      if (foundTemplates.includes(expected)) {
        log(`  ✓ Template "${expected}" exists`, 'GREEN');
      } else {
        log(`  ✗ Template "${expected}" NOT FOUND`, 'RED');
        allPassed = false;
      }
    }
    
    log(`\n  Total templates in database: ${foundTemplates.length}`, 'YELLOW');
    
  } catch (err) {
    log(`  ✗ Error querying templates: ${err.message}`, 'RED');
    allPassed = false;
  }
  
  return allPassed;
}

async function testTemplateRendering() {
  logSection('3. Testing Template Rendering');
  
  const testCases = [
    {
      name: 'Simple variable substitution',
      template: 'Hello {{name}}, welcome to {{company}}!',
      data: { name: 'John', company: 'Rekrut AI' },
      expected: 'Hello John, welcome to Rekrut AI!'
    },
    {
      name: 'Conditional block (true)',
      template: 'Hello{{#if name}} {{name}}{{/if}}!',
      data: { name: 'Jane' },
      expectedContains: 'Jane'
    },
    {
      name: 'Conditional block (false)',
      template: 'Hello{{#if missing}} World{{/if}}!',
      data: {},
      expected: 'Hello!'
    },
    {
      name: 'Each loop',
      template: '{{#each items}}{{name}}, {{/each}}',
      data: { items: [{ name: 'A' }, { name: 'B' }] },
      expectedContains: 'A'
    }
  ];
  
  let allPassed = true;
  
  for (const test of testCases) {
    const result = emailService.renderTemplate(test.template, test.data);
    
    if (test.expected && result === test.expected) {
      log(`  ✓ ${test.name}`, 'GREEN');
    } else if (test.expectedContains && result.includes(test.expectedContains)) {
      log(`  ✓ ${test.name}`, 'GREEN');
    } else {
      log(`  ✗ ${test.name}`, 'RED');
      log(`    Expected: ${test.expected || test.expectedContains}`, 'YELLOW');
      log(`    Got: ${result}`, 'YELLOW');
      allPassed = false;
    }
  }
  
  return allPassed;
}

async function testEmailServiceConfig() {
  logSection('4. Testing Email Service Configuration');
  
  const status = emailService.getStatus();
  
  log(`  SMTP Host: ${status.host}:${status.port}`, 'YELLOW');
  log(`  Has Credentials: ${status.hasCredentials ? 'Yes' : 'No'}`, 
      status.hasCredentials ? 'GREEN' : 'RED');
  log(`  From Address: ${status.fromAddress}`, 'YELLOW');
  log(`  Rate Limits: ${status.rateLimit.maxPerMinute}/min, ${status.rateLimit.maxPerHour}/hour`, 'YELLOW');
  log(`  Configured: ${status.configured ? 'Yes' : 'No'}`, 
      status.configured ? 'GREEN' : 'YELLOW');
  
  if (!status.hasCredentials) {
    log('\n  ⚠ Email credentials not configured. Set SMTP_USER and SMTP_PASS environment variables.', 'YELLOW');
    log('  The system will work in "log only" mode until credentials are provided.', 'YELLOW');
  }
  
  return true; // Always pass - configuration is optional
}

async function testNotificationPreferences() {
  logSection('5. Testing Notification Preferences');
  
  try {
    // Check if preferences table has default entries
    const result = await pool.query(`
      SELECT notification_type, COUNT(*) as count
      FROM notification_preferences
      GROUP BY notification_type
      ORDER BY notification_type
    `);
    
    if (result.rows.length > 0) {
      log('  ✓ Notification preferences seeded', 'GREEN');
      result.rows.forEach(row => {
        log(`    → ${row.notification_type}: ${row.count} users`, 'YELLOW');
      });
    } else {
      log('  ⚠ No notification preferences found (will be created on-demand)', 'YELLOW');
    }
    
    return true;
  } catch (err) {
    log(`  ✗ Error checking preferences: ${err.message}`, 'RED');
    return false;
  }
}

async function testQueueFunctionality() {
  logSection('6. Testing Queue Functionality');
  
  try {
    // Test queueing an email
    const queueResult = await emailService.queueEmail({
      to: 'test@example.com',
      type: 'test',
      templateName: 'application_received',
      templateData: { 
        candidate_name: 'Test User', 
        job_title: 'Test Job',
        company_name: 'Test Company'
      },
      priority: 10
    });
    
    if (queueResult.success) {
      log(`  ✓ Email queued successfully (ID: ${queueResult.queueId})`, 'GREEN');
      
      // Check queue status
      const queueStatus = await pool.query(
        'SELECT * FROM notification_queue WHERE id = $1',
        [queueResult.queueId]
      );
      
      if (queueStatus.rows.length > 0) {
        const q = queueStatus.rows[0];
        log(`    Status: ${q.status}`, 'YELLOW');
        log(`    Priority: ${q.priority}`, 'YELLOW');
        log(`    Scheduled: ${q.scheduled_for}`, 'YELLOW');
      }
      
      // Clean up test queue entry
      await pool.query('DELETE FROM notification_queue WHERE id = $1', [queueResult.queueId]);
      log('  ✓ Test queue entry cleaned up', 'GREEN');
      
      return true;
    } else {
      log(`  ✗ Failed to queue email: ${queueResult.error}`, 'RED');
      return false;
    }
  } catch (err) {
    log(`  ✗ Queue test error: ${err.message}`, 'RED');
    return false;
  }
}

async function testAPIEndpointsAvailability() {
  logSection('7. Testing API Endpoints Availability');
  
  // This tests that the routes file loads correctly
  try {
    const notificationsRoutes = require('./routes/notifications');
    
    if (notificationsRoutes && typeof notificationsRoutes === 'function') {
      log('  ✓ Notifications routes module loaded', 'GREEN');
      
      // Check that it's an Express router
      if (notificationsRoutes.stack && Array.isArray(notificationsRoutes.stack)) {
        log(`    → ${notificationsRoutes.stack.length} routes registered`, 'YELLOW');
      }
    } else {
      log('  ✗ Notifications routes not properly exported', 'RED');
      return false;
    }
    
    return true;
  } catch (err) {
    log(`  ✗ Failed to load notifications routes: ${err.message}`, 'RED');
    return false;
  }
}

async function runAllTests() {
  console.log('\n');
  log('╔══════════════════════════════════════════════════════════╗', 'CYAN');
  log('║     REKRUT AI - Email Notifications System Test Suite     ║', 'CYAN');
  log('╚══════════════════════════════════════════════════════════╝', 'CYAN');
  
  const results = {
    databaseTables: await testDatabaseTables(),
    defaultTemplates: await testDefaultTemplates(),
    templateRendering: await testTemplateRendering(),
    emailServiceConfig: await testEmailServiceConfig(),
    notificationPreferences: await testNotificationPreferences(),
    queueFunctionality: await testQueueFunctionality(),
    apiEndpoints: await testAPIEndpointsAvailability()
  };
  
  logSection('TEST SUMMARY');
  
  let totalPassed = 0;
  let totalTests = 0;
  
  for (const [test, passed] of Object.entries(results)) {
    totalTests++;
    if (passed) {
      totalPassed++;
      log(`  ✓ ${test}`, 'GREEN');
    } else {
      log(`  ✗ ${test}`, 'RED');
    }
  }
  
  console.log('\n');
  if (totalPassed === totalTests) {
    log(`  ALL TESTS PASSED (${totalPassed}/${totalTests})`, 'GREEN');
  } else {
    log(`  ${totalPassed}/${totalTests} tests passed`, 'YELLOW');
  }
  
  console.log('\n');
  
  // Print setup instructions if needed
  const status = emailService.getStatus();
  if (!status.hasCredentials) {
    log('════════════════════════════════════════════════════════════', 'YELLOW');
    log('  SETUP INSTRUCTIONS FOR EMAIL SENDING:', 'YELLOW');
    log('════════════════════════════════════════════════════════════', 'YELLOW');
    log('  1. Add to your .env file:', 'YELLOW');
    log('     SMTP_HOST=smtp.gmail.com       (or your SMTP server)', 'YELLOW');
    log('     SMTP_PORT=587                  (or 465 for SSL)', 'YELLOW');
    log('     SMTP_USER=your-email@gmail.com', 'YELLOW');
    log('     SMTP_PASS=your-app-password    (use App Password for Gmail)', 'YELLOW');
    log('     EMAIL_FROM_NAME=Rekrut AI', 'YELLOW');
    log('     EMAIL_FROM_ADDRESS=noreply@yourdomain.com', 'YELLOW');
    log('', 'YELLOW');
    log('  2. For Gmail, enable 2FA and generate an App Password:', 'YELLOW');
    log('     https://myaccount.google.com/apppasswords', 'YELLOW');
    log('', 'YELLOW');
    log('  3. For production, consider using:', 'YELLOW');
    log('     - SendGrid (smtp.sendgrid.net)', 'YELLOW');
    log('     - Mailgun (smtp.mailgun.org)', 'YELLOW');
    log('     - Amazon SES (email-smtp.region.amazonaws.com)', 'YELLOW');
    log('════════════════════════════════════════════════════════════', 'YELLOW');
  }
  
  await pool.end();
  process.exit(totalPassed === totalTests ? 0 : 1);
}

runAllTests().catch(err => {
  console.error('Test suite error:', err);
  process.exit(1);
});
