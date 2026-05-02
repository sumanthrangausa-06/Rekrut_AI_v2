module.exports = {
  name: '035_email_notifications',
  async up(client) {
    // ─── Notification Templates ───────────────────────────────────────────
    // Reusable email templates with variable interpolation
    await client.query(`
      CREATE TABLE IF NOT EXISTS notification_templates (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        type VARCHAR(50) NOT NULL,
        subject_template TEXT NOT NULL,
        body_template TEXT NOT NULL,
        html_template TEXT,
        variables JSONB DEFAULT '[]',
        is_system BOOLEAN DEFAULT false,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(name)
      )
    `);

    // ─── Notification Logs ─────────────────────────────────────────────────
    // Track all sent notifications for auditing and analytics
    await client.query(`
      CREATE TABLE IF NOT EXISTS notification_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        email VARCHAR(255) NOT NULL,
        template_id INTEGER REFERENCES notification_templates(id) ON DELETE SET NULL,
        type VARCHAR(50) NOT NULL,
        subject TEXT NOT NULL,
        body TEXT,
        html_body TEXT,
        status VARCHAR(20) DEFAULT 'pending',
        error_message TEXT,
        provider_message_id VARCHAR(255),
        metadata JSONB DEFAULT '{}',
        retry_count INTEGER DEFAULT 0,
        sent_at TIMESTAMP WITH TIME ZONE,
        delivered_at TIMESTAMP WITH TIME ZONE,
        opened_at TIMESTAMP WITH TIME ZONE,
        clicked_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    // ─── Notification Preferences ─────────────────────────────────────────
    // User-level notification preferences
    await client.query(`
      CREATE TABLE IF NOT EXISTS notification_preferences (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        notification_type VARCHAR(50) NOT NULL,
        email_enabled BOOLEAN DEFAULT true,
        in_app_enabled BOOLEAN DEFAULT true,
        sms_enabled BOOLEAN DEFAULT false,
        digest_enabled BOOLEAN DEFAULT false,
        digest_frequency VARCHAR(20) DEFAULT 'immediate',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(user_id, notification_type)
      )
    `);

    // ─── Notification Queue ───────────────────────────────────────────────
    // Queue for async processing of notifications
    await client.query(`
      CREATE TABLE IF NOT EXISTS notification_queue (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        email VARCHAR(255) NOT NULL,
        type VARCHAR(50) NOT NULL,
        template_id INTEGER REFERENCES notification_templates(id) ON DELETE SET NULL,
        template_data JSONB DEFAULT '{}',
        priority INTEGER DEFAULT 5,
        status VARCHAR(20) DEFAULT 'pending',
        scheduled_for TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        attempts INTEGER DEFAULT 0,
        max_attempts INTEGER DEFAULT 3,
        last_error TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        processed_at TIMESTAMP WITH TIME ZONE
      )
    `);

    // ─── Indexes ───────────────────────────────────────────────────────────
    await client.query(`CREATE INDEX IF NOT EXISTS idx_notification_logs_user_id ON notification_logs (user_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_notification_logs_email ON notification_logs (email)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_notification_logs_type ON notification_logs (type)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_notification_logs_status ON notification_logs (status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_notification_logs_created_at ON notification_logs (created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_notification_queue_status ON notification_queue (status, scheduled_for)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_notification_preferences_user_id ON notification_preferences (user_id)`);

    // ─── Seed Default Templates ───────────────────────────────────────────
    const defaultTemplates = [
      {
        name: 'application_received',
        type: 'application',
        subject_template: 'Application Received for {{job_title}} at {{company_name}}',
        body_template: `Hi {{candidate_name}},

Thank you for applying to the {{job_title}} position at {{company_name}}!

We've received your application and our team will review it shortly. You can track your application status anytime in your dashboard.

{{#if assessment_required}}
As part of our hiring process, you'll receive an assessment invite shortly. Please complete it within {{assessment_deadline}}.
{{/if}}

Best regards,
{{company_name}} Recruiting Team`,
        variables: ['candidate_name', 'job_title', 'company_name', 'assessment_required', 'assessment_deadline'],
        is_system: true
      },
      {
        name: 'interview_scheduled',
        type: 'interview',
        subject_template: 'Interview Scheduled: {{job_title}} at {{company_name}}',
        body_template: `Hi {{candidate_name}},

Great news! Your interview for the {{job_title}} position has been scheduled.

📅 Date: {{interview_date}}
🕐 Time: {{interview_time}}
📍 Location: {{interview_location}}
{{#if interviewer_name}}
👤 Interviewer: {{interviewer_name}}
{{/if}}
{{#if meeting_link}}
🔗 Meeting Link: {{meeting_link}}
{{/if}}

Please confirm your attendance by clicking the link below:
{{confirmation_link}}

If you need to reschedule, please let us know at least 24 hours in advance.

Best regards,
{{company_name}} Recruiting Team`,
        variables: ['candidate_name', 'job_title', 'company_name', 'interview_date', 'interview_time', 'interview_location', 'interviewer_name', 'meeting_link', 'confirmation_link'],
        is_system: true
      },
      {
        name: 'offer_extended',
        type: 'offer',
        subject_template: 'Job Offer: {{job_title}} at {{company_name}}',
        body_template: `Dear {{candidate_name}},

Congratulations! We're thrilled to extend you an offer for the {{job_title}} position at {{company_name}}!

Here's a summary of your offer:
💼 Position: {{job_title}}
💰 Salary: {{salary}}
📍 Location: {{work_location}}
📅 Start Date: {{start_date}}
{{#if benefits}}
🎁 Benefits: {{benefits}}
{{/if}}

Please review the full offer details in your dashboard:
{{offer_link}}

To accept this offer, please sign and return by {{offer_deadline}}.

We're excited about the possibility of you joining our team!

Best regards,
{{company_name}} Recruiting Team`,
        variables: ['candidate_name', 'job_title', 'company_name', 'salary', 'work_location', 'start_date', 'benefits', 'offer_link', 'offer_deadline'],
        is_system: true
      },
      {
        name: 'application_rejected',
        type: 'rejection',
        subject_template: 'Update on your application for {{job_title}}',
        body_template: `Hi {{candidate_name}},

Thank you for your interest in the {{job_title}} position at {{company_name}}.

After careful consideration, we've decided to move forward with other candidates whose qualifications more closely match our current needs.

{{#if feedback}}
We wanted to share some feedback: {{feedback}}
{{/if}}

We encourage you to apply for future openings that match your skills. We'll keep your profile on file for relevant opportunities.

Best regards,
{{company_name}} Recruiting Team`,
        variables: ['candidate_name', 'job_title', 'company_name', 'feedback'],
        is_system: true
      },
      {
        name: 'assessment_invite',
        type: 'assessment',
        subject_template: 'Assessment Invitation: {{assessment_name}} for {{job_title}}',
        body_template: `Hi {{candidate_name}},

You've been invited to complete an assessment for the {{job_title}} position at {{company_name}}.

📋 Assessment: {{assessment_name}}
⏱️ Duration: {{duration}}
📅 Deadline: {{deadline}}

To begin your assessment, click the link below:
{{assessment_link}}

Make sure you have a stable internet connection and a quiet environment before starting. Good luck!

Best regards,
{{company_name}} Recruiting Team`,
        variables: ['candidate_name', 'job_title', 'company_name', 'assessment_name', 'duration', 'deadline', 'assessment_link'],
        is_system: true
      },
      {
        name: 'onboarding_welcome',
        type: 'onboarding',
        subject_template: 'Welcome to {{company_name}}! Your Onboarding Journey Begins',
        body_template: `Hi {{candidate_name}},

Welcome to {{company_name}}! 🎉

We're excited to have you join the team as {{job_title}}.

Your onboarding journey begins on {{start_date}}. Here's what you need to do:

1. Complete your onboarding paperwork: {{onboarding_link}}
2. Set up your company accounts
3. Review the employee handbook

If you have any questions before your start date, don't hesitate to reach out.

We can't wait to meet you!

Best regards,
{{company_name}} HR Team`,
        variables: ['candidate_name', 'job_title', 'company_name', 'start_date', 'onboarding_link'],
        is_system: true
      },
      {
        name: 'password_reset',
        type: 'security',
        subject_template: 'Reset Your Rekrut AI Password',
        body_template: `Hi {{user_name}},

We received a request to reset your password for your Rekrut AI account.

Click the link below to reset your password:
{{reset_link}}

This link will expire in {{expiration_hours}} hours.

If you didn't request this reset, please ignore this email or contact support if you have concerns.

Best regards,
Rekrut AI Team`,
        variables: ['user_name', 'reset_link', 'expiration_hours'],
        is_system: true
      },
      {
        name: 'weekly_digest',
        type: 'digest',
        subject_template: 'Your Weekly Job Search Summary',
        body_template: `Hi {{candidate_name}},

Here's your weekly job search summary:

📊 Applications: {{applications_count}}
👀 Profile Views: {{profile_views}}
📬 Messages: {{messages_count}}
⭐ New Job Matches: {{new_matches_count}}

{{#if recommended_jobs}}
Top Recommended Jobs This Week:
{{#each recommended_jobs}}
• {{title}} at {{company}} - {{location}}
{{/each}}
{{/if}}

Keep up the great work!

Best regards,
Rekrut AI Team`,
        variables: ['candidate_name', 'applications_count', 'profile_views', 'messages_count', 'new_matches_count', 'recommended_jobs'],
        is_system: true
      }
    ];

    for (const template of defaultTemplates) {
      await client.query(`
        INSERT INTO notification_templates (name, type, subject_template, body_template, variables, is_system)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (name) DO NOTHING
      `, [template.name, template.type, template.subject_template, template.body_template, JSON.stringify(template.variables), template.is_system]);
    }

    // ─── Seed Default Preferences for Existing Users ───────────────────────
    // This creates default notification preferences for existing users
    const notificationTypes = ['application', 'interview', 'offer', 'rejection', 'assessment', 'onboarding', 'security', 'digest'];
    
    await client.query(`
      INSERT INTO notification_preferences (user_id, notification_type, email_enabled, in_app_enabled)
      SELECT u.id, nt.type, true, true
      FROM users u
      CROSS JOIN (SELECT unnest($1::text[]) as type) nt
      ON CONFLICT (user_id, notification_type) DO NOTHING
    `, [notificationTypes]);
  },

  async down(client) {
    await client.query('DROP TABLE IF EXISTS notification_queue');
    await client.query('DROP TABLE IF EXISTS notification_preferences');
    await client.query('DROP TABLE IF EXISTS notification_logs');
    await client.query('DROP TABLE IF EXISTS notification_templates');
  }
};
