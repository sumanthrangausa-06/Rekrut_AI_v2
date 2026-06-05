/**
 * Seed default email notification templates
 * Templates for: application_received, interview_scheduled, offer_extended, status_update, welcome, password_reset
 */
const templates = [
  {
    name: 'application_received',
    type: 'application',
    subject_template: 'Application Received — {{job_title}} at {{company_name}}',
    body_template: `Hi {{candidate_name}},

Thank you for applying to the {{job_title}} position at {{company_name}}. We have received your application and are reviewing it.

{{#if assessment_required}}
Next Steps:
You have been invited to complete a skill assessment. Please complete it by {{assessment_deadline}} to continue in the process.

Assessment link: {{assessment_link}}
{{/if}}

We'll be in touch soon with next steps.

Best regards,
{{company_name}} Hiring Team`,
    html_template: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="text-align: center; padding: 20px 0;">
    <div style="display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; background: #2563eb; color: white; border-radius: 8px; font-weight: bold; font-size: 18px;">R</div>
    <h2 style="margin: 10px 0 0; color: #111;">Rekrut AI</h2>
  </div>
  <div style="background: #f8fafc; border-radius: 12px; padding: 24px; margin: 20px 0;">
    <h2 style="color: #1e293b; margin-top: 0;">Application Received</h2>
    <p>Hi {{candidate_name}},</p>
    <p>Thank you for applying to the <strong>{{job_title}}</strong> position at <strong>{{company_name}}</strong>. We have received your application and are reviewing it.</p>
    {{#if assessment_required}}
    <div style="background: #eff6ff; border-left: 4px solid #2563eb; padding: 16px; margin: 16px 0; border-radius: 8px;">
      <h3 style="margin-top: 0; color: #1e40af;">Next Step: Skill Assessment</h3>
      <p>You have been invited to complete a skill assessment. Please complete it by <strong>{{assessment_deadline}}</strong>.</p>
      <a href="{{assessment_link}}" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 500; margin-top: 8px;">Start Assessment</a>
    </div>
    {{/if}}
    <p>We'll be in touch soon with next steps.</p>
  </div>
  <p style="color: #64748b; font-size: 14px; text-align: center; margin-top: 30px;">
    Best regards,<br>{{company_name}} Hiring Team
  </p>
</body>
</html>`,
    variables: JSON.stringify(['candidate_name', 'job_title', 'company_name', 'assessment_required', 'assessment_deadline', 'assessment_link']),
    is_system: true
  },
  {
    name: 'interview_scheduled',
    type: 'interview',
    subject_template: 'Interview Scheduled — {{job_title}} at {{company_name}}',
    body_template: `Hi {{candidate_name}},

Your interview for the {{job_title}} position at {{company_name}} has been scheduled.

Details:
Date: {{interview_date}}
Time: {{interview_time}}
Location: {{interview_location}}
{{#if interviewer_name}}
Interviewer: {{interviewer_name}}
{{/if}}
{{#if meeting_link}}
Meeting Link: {{meeting_link}}
{{/if}}

Please confirm your attendance: {{confirmation_link}}

If you need to reschedule, please reply to this email as soon as possible.

Best regards,
{{company_name}} Hiring Team`,
    html_template: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="text-align: center; padding: 20px 0;">
    <div style="display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; background: #2563eb; color: white; border-radius: 8px; font-weight: bold; font-size: 18px;">R</div>
    <h2 style="margin: 10px 0 0; color: #111;">Rekrut AI</h2>
  </div>
  <div style="background: #f8fafc; border-radius: 12px; padding: 24px; margin: 20px 0;">
    <h2 style="color: #1e293b; margin-top: 0;">Interview Scheduled</h2>
    <p>Hi {{candidate_name}},</p>
    <p>Your interview for the <strong>{{job_title}}</strong> position at <strong>{{company_name}}</strong> has been scheduled.</p>
    <div style="background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 16px 0;">
      <p style="margin: 8px 0;"><strong>Date:</strong> {{interview_date}}</p>
      <p style="margin: 8px 0;"><strong>Time:</strong> {{interview_time}}</p>
      <p style="margin: 8px 0;"><strong>Location:</strong> {{interview_location}}</p>
      {{#if interviewer_name}}<p style="margin: 8px 0;"><strong>Interviewer:</strong> {{interviewer_name}}</p>{{/if}}
      {{#if meeting_link}}<p style="margin: 8px 0;"><strong>Meeting Link:</strong> <a href="{{meeting_link}}">{{meeting_link}}</a></p>{{/if}}
    </div>
    <a href="{{confirmation_link}}" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 500; margin: 8px 0;">Confirm Attendance</a>
    <p style="color: #64748b; font-size: 14px; margin-top: 16px;">If you need to reschedule, please reply to this email as soon as possible.</p>
  </div>
  <p style="color: #64748b; font-size: 14px; text-align: center; margin-top: 30px;">
    Best regards,<br>{{company_name}} Hiring Team
  </p>
</body>
</html>`,
    variables: JSON.stringify(['candidate_name', 'job_title', 'company_name', 'interview_date', 'interview_time', 'interview_location', 'interviewer_name', 'meeting_link', 'confirmation_link']),
    is_system: true
  },
  {
    name: 'offer_extended',
    type: 'offer',
    subject_template: 'Job Offer — {{job_title}} at {{company_name}}',
    body_template: `Hi {{candidate_name}},

We are pleased to offer you the position of {{job_title}} at {{company_name}}.

Offer Details:
Salary: {{salary}}
Location: {{work_location}}
Start Date: {{start_date}}
{{#if benefits}}
Benefits: {{benefits}}
{{/if}}

Please review the full offer details and respond by {{offer_deadline}}:
{{offer_link}}

We are excited about the possibility of you joining our team!

Best regards,
{{company_name}} Hiring Team`,
    html_template: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="text-align: center; padding: 20px 0;">
    <div style="display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; background: #2563eb; color: white; border-radius: 8px; font-weight: bold; font-size: 18px;">R</div>
    <h2 style="margin: 10px 0 0; color: #111;">Rekrut AI</h2>
  </div>
  <div style="background: #f0fdf4; border-radius: 12px; padding: 24px; margin: 20px 0; border: 1px solid #bbf7d0;">
    <h2 style="color: #166534; margin-top: 0;">🎉 Job Offer</h2>
    <p>Hi {{candidate_name}},</p>
    <p>We are pleased to offer you the position of <strong>{{job_title}}</strong> at <strong>{{company_name}}</strong>.</p>
    <div style="background: white; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; margin: 16px 0;">
      <p style="margin: 8px 0;"><strong>Salary:</strong> {{salary}}</p>
      <p style="margin: 8px 0;"><strong>Location:</strong> {{work_location}}</p>
      <p style="margin: 8px 0;"><strong>Start Date:</strong> {{start_date}}</p>
      {{#if benefits}}<p style="margin: 8px 0;"><strong>Benefits:</strong> {{benefits}}</p>{{/if}}
    </div>
    <p>Please review the full offer details and respond by <strong>{{offer_deadline}}</strong>.</p>
    <a href="{{offer_link}}" style="display: inline-block; background: #16a34a; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 500; margin: 8px 0;">Review Full Offer</a>
  </div>
  <p style="color: #64748b; font-size: 14px; text-align: center; margin-top: 30px;">
    Best regards,<br>{{company_name}} Hiring Team
  </p>
</body>
</html>`,
    variables: JSON.stringify(['candidate_name', 'job_title', 'company_name', 'salary', 'work_location', 'start_date', 'benefits', 'offer_link', 'offer_deadline']),
    is_system: true
  },
  {
    name: 'status_update',
    type: 'status',
    subject_template: 'Application Update — {{job_title}} at {{company_name}}',
    body_template: `Hi {{candidate_name}},

We have an update regarding your application for the {{job_title}} position at {{company_name}}.

Status: {{status}}
{{#if feedback}}
Feedback: {{feedback}}
{{/if}}

{{#if next_steps}}
Next Steps: {{next_steps}}
{{/if}}

Best regards,
{{company_name}} Hiring Team`,
    html_template: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="text-align: center; padding: 20px 0;">
    <div style="display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; background: #2563eb; color: white; border-radius: 8px; font-weight: bold; font-size: 18px;">R</div>
    <h2 style="margin: 10px 0 0; color: #111;">Rekrut AI</h2>
  </div>
  <div style="background: #f8fafc; border-radius: 12px; padding: 24px; margin: 20px 0;">
    <h2 style="color: #1e293b; margin-top: 0;">Application Update</h2>
    <p>Hi {{candidate_name}},</p>
    <p>We have an update regarding your application for the <strong>{{job_title}}</strong> position at <strong>{{company_name}}</strong>.</p>
    <div style="background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 16px 0;">
      <p style="margin: 8px 0;"><strong>Status:</strong> {{status}}</p>
      {{#if feedback}}<p style="margin: 8px 0;"><strong>Feedback:</strong> {{feedback}}</p>{{/if}}
      {{#if next_steps}}<p style="margin: 8px 0;"><strong>Next Steps:</strong> {{next_steps}}</p>{{/if}}
    </div>
  </div>
  <p style="color: #64748b; font-size: 14px; text-align: center; margin-top: 30px;">
    Best regards,<br>{{company_name}} Hiring Team
  </p>
</body>
</html>`,
    variables: JSON.stringify(['candidate_name', 'job_title', 'company_name', 'status', 'feedback', 'next_steps']),
    is_system: true
  },
  {
    name: 'welcome',
    type: 'welcome',
    subject_template: 'Welcome to Rekrut AI!',
    body_template: `Hi {{name}},

Welcome to Rekrut AI — your AI-powered career companion.

Here's what you can do next:
- Complete your profile to boost your OmniScore
- Browse jobs tailored to your skills
- Take skill assessments to stand out
- Practice interviews with AI coaching

Get started: {{dashboard_link}}

If you have any questions, reply to this email.

Best,
The Rekrut AI Team`,
    html_template: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="text-align: center; padding: 20px 0;">
    <div style="display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; background: #2563eb; color: white; border-radius: 8px; font-weight: bold; font-size: 18px;">R</div>
    <h2 style="margin: 10px 0 0; color: #111;">Rekrut AI</h2>
  </div>
  <div style="background: #f8fafc; border-radius: 12px; padding: 24px; margin: 20px 0;">
    <h2 style="color: #1e293b; margin-top: 0;">Welcome to Rekrut AI!</h2>
    <p>Hi {{name}},</p>
    <p>Welcome to Rekrut AI — your AI-powered career companion.</p>
    <div style="background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 16px 0;">
      <p style="margin: 8px 0;"><strong>Here's what you can do next:</strong></p>
      <ul style="padding-left: 20px; margin: 8px 0;">
        <li>Complete your profile to boost your OmniScore</li>
        <li>Browse jobs tailored to your skills</li>
        <li>Take skill assessments to stand out</li>
        <li>Practice interviews with AI coaching</li>
      </ul>
    </div>
    <a href="{{dashboard_link}}" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 500; margin: 8px 0;">Get Started</a>
  </div>
  <p style="color: #64748b; font-size: 14px; text-align: center; margin-top: 30px;">
    Best,<br>The Rekrut AI Team
  </p>
</body>
</html>`,
    variables: JSON.stringify(['name', 'dashboard_link']),
    is_system: true
  },
  {
    name: 'password_reset',
    type: 'security',
    subject_template: 'Password Reset — Rekrut AI',
    body_template: `Hi {{name}},

You requested a password reset for your Rekrut AI account.

Reset your password: {{reset_link}}

This link expires in {{expires_in}}.

If you didn't request this, you can safely ignore this email.

Best,
The Rekrut AI Team`,
    html_template: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="text-align: center; padding: 20px 0;">
    <div style="display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; background: #2563eb; color: white; border-radius: 8px; font-weight: bold; font-size: 18px;">R</div>
    <h2 style="margin: 10px 0 0; color: #111;">Rekrut AI</h2>
  </div>
  <div style="background: #f8fafc; border-radius: 12px; padding: 24px; margin: 20px 0;">
    <h2 style="color: #1e293b; margin-top: 0;">Password Reset</h2>
    <p>Hi {{name}},</p>
    <p>You requested a password reset for your Rekrut AI account.</p>
    <a href="{{reset_link}}" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 500; margin: 16px 0;">Reset Password</a>
    <p style="color: #64748b; font-size: 14px;">This link expires in {{expires_in}}.</p>
    <p style="color: #64748b; font-size: 14px;">If you didn't request this, you can safely ignore this email.</p>
  </div>
  <p style="color: #64748b; font-size: 14px; text-align: center; margin-top: 30px;">
    Best,<br>The Rekrut AI Team
  </p>
</body>
</html>`,
    variables: JSON.stringify(['name', 'reset_link', 'expires_in']),
    is_system: true
  }
];

module.exports = {
  name: 'seed_notification_templates',
  async up(client) {
    // Check if table exists first
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'notification_templates'
      )
    `);

    if (!tableCheck.rows[0].exists) {
      console.log('⚠️ notification_templates table does not exist, skipping template seed');
      return;
    }

    for (const template of templates) {
      // Use ON CONFLICT to avoid duplicates
      await client.query(`
        INSERT INTO notification_templates 
          (name, type, subject_template, body_template, html_template, variables, is_system, is_active, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, true, NOW())
        ON CONFLICT (name) DO UPDATE SET
          type = EXCLUDED.type,
          subject_template = EXCLUDED.subject_template,
          body_template = EXCLUDED.body_template,
          html_template = EXCLUDED.html_template,
          variables = EXCLUDED.variables,
          is_system = EXCLUDED.is_system,
          is_active = true,
          updated_at = NOW()
      `, [
        template.name,
        template.type,
        template.subject_template,
        template.body_template,
        template.html_template,
        template.variables,
        template.is_system
      ]);
    }

    console.log(`✅ Seeded ${templates.length} default notification templates`);
  }
};
