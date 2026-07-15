/**
 * Migration: Add default email notification templates
 *
 * 15 transactional email templates for Rekrut AI:
 * 1. welcome - New user registration
 * 2. password_reset - Password reset request
 * 3. email_verification - Email verification
 * 4. job_application_submitted - Candidate applied to job
 * 5. job_application_received - Recruiter receives application
 * 6. interview_scheduled - Interview is scheduled
 * 7. interview_reminder - Interview reminder (24h before)
 * 8. offer_extended - Job offer sent to candidate
 * 9. offer_accepted - Candidate accepted offer
 * 10. offer_rejected - Candidate rejected offer
 * 11. document_verified - Document verification complete
 * 12. document_flagged - Document flagged for review
 * 13. account_suspended - Account suspended notice
 * 14. payment_failed - Payment failed notification
 * 15. subscription_renewal - Subscription renewal reminder
 */

async function up(client) {
	// Ensure notification_templates table exists with all required columns
	await client.query(`
    CREATE TABLE IF NOT EXISTS notification_templates (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) UNIQUE NOT NULL,
      type VARCHAR(50) NOT NULL DEFAULT 'email',
      subject_template TEXT NOT NULL,
      body_template TEXT NOT NULL,
      html_template TEXT,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

	// Add updated_at trigger if not exists
	await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_notification_templates_timestamp') THEN
        CREATE OR REPLACE FUNCTION update_timestamp()
        RETURNS TRIGGER AS $func$
        BEGIN
          NEW.updated_at = NOW();
          RETURN NEW;
        END;
        $func$ LANGUAGE plpgsql;

        CREATE TRIGGER update_notification_templates_timestamp
          BEFORE UPDATE ON notification_templates
          FOR EACH ROW
          EXECUTE FUNCTION update_timestamp();
      END IF;
    END $$;
  `);

	// Insert default email templates
	const templates = [
		{
			name: 'welcome',
			subject: 'Welcome to Rekrut AI, {{name}}!',
			body: `Hi {{name}},

Welcome to Rekrut AI! We're excited to have you on board.

{{#if is_candidate}}
Your candidate dashboard is ready. You can:
- Upload your resume and documents for verification
- Apply to jobs with your verified credentials
- Practice with AI-powered mock interviews
- Track your application status in real-time

Get started: {{dashboard_link}}
{{/if}}

{{#if is_recruiter}}
Your recruiter dashboard is ready. You can:
- Post jobs and manage applications
- Screen candidates with AI-powered tools
- Schedule interviews and manage your pipeline
- Access analytics and compliance dashboards

Get started: {{dashboard_link}}
{{/if}}

If you have any questions, reply to this email or contact us at support@rekrut.ai.

Best regards,
The Rekrut AI Team`,
			html: null,
		},
		{
			name: 'password_reset',
			subject: 'Password Reset Request - Rekrut AI',
			body: `Hi {{name}},

We received a request to reset your password for your Rekrut AI account.

Click the link below to reset your password:
{{reset_link}}

This link will expire in 1 hour for security reasons.

If you didn't request this, you can safely ignore this email. Your password won't be changed.

Best regards,
The Rekrut AI Team`,
			html: null,
		},
		{
			name: 'email_verification',
			subject: 'Verify Your Email - Rekrut AI',
			body: `Hi {{name}},

Thanks for signing up! Please verify your email address by clicking the link below:

{{verification_link}}

This link will expire in 24 hours.

If you didn't create an account, you can safely ignore this email.

Best regards,
The Rekrut AI Team`,
			html: null,
		},
		{
			name: 'job_application_submitted',
			subject: 'Application Submitted: {{job_title}} at {{company_name}}',
			body: `Hi {{name}},

Your application for {{job_title}} at {{company_name}} has been submitted successfully!

Application Details:
- Position: {{job_title}}
- Company: {{company_name}}
- Location: {{location}}
- Applied on: {{applied_date}}

What happens next:
1. Your application will be reviewed by the hiring team
2. You'll receive updates on your application status
3. If shortlisted, you'll be invited for an interview

Track your application: {{application_link}}

Best regards,
The Rekrut AI Team`,
			html: null,
		},
		{
			name: 'job_application_received',
			subject: 'New Application: {{job_title}} from {{candidate_name}}',
			body: `Hi {{name}},

You have a new application for {{job_title}}.

Candidate Details:
- Name: {{candidate_name}}
- Email: {{candidate_email}}
- Applied on: {{applied_date}}
- OmniScore: {{omniscore}}/100
- Document Verification: {{verification_status}}

{{#if has_resume}}
Resume: {{resume_link}}
{{/if}}

Review application: {{application_link}}

Best regards,
The Rekrut AI Team`,
			html: null,
		},
		{
			name: 'interview_scheduled',
			subject: 'Interview Scheduled: {{job_title}} at {{company_name}}',
			body: `Hi {{name}},

Your interview for {{job_title}} at {{company_name}} has been scheduled.

Interview Details:
- Date: {{interview_date}}
- Time: {{interview_time}}
- Duration: {{duration}} minutes
- Format: {{interview_format}}
- Location: {{location}}

{{#if is_virtual}}
Join link: {{join_link}}
{{/if}}

{{#if preparation_tips}}
Preparation Tips:
{{preparation_tips}}
{{/if}}

Please confirm your attendance by clicking this link:
{{confirmation_link}}

Best regards,
The Rekrut AI Team`,
			html: null,
		},
		{
			name: 'interview_reminder',
			subject: 'Reminder: Interview in 24 Hours - {{job_title}}',
			body: `Hi {{name}},

This is a friendly reminder that your interview for {{job_title}} at {{company_name}} is scheduled for tomorrow.

Interview Details:
- Date: {{interview_date}}
- Time: {{interview_time}}
- Duration: {{duration}} minutes

{{#if is_virtual}}
Join link: {{join_link}}
{{/if}}

If you need to reschedule, please contact us as soon as possible.

Best regards,
The Rekrut AI Team`,
			html: null,
		},
		{
			name: 'offer_extended',
			subject: 'Job Offer: {{job_title}} at {{company_name}}',
			body: `Hi {{name}},

Congratulations! We are pleased to offer you the position of {{job_title}} at {{company_name}}.

Offer Details:
- Position: {{job_title}}
- Start Date: {{start_date}}
- Salary: {{salary}}
- Employment Type: {{employment_type}}
- Location: {{location}}

Please review the full offer details and respond by {{expiry_date}}:
{{offer_link}}

We look forward to having you join the team!

Best regards,
{{sender_name}}
{{company_name}}`,
			html: null,
		},
		{
			name: 'offer_accepted',
			subject: 'Offer Accepted: {{candidate_name}} for {{job_title}}',
			body: `Hi {{name}},

Great news! {{candidate_name}} has accepted the offer for {{job_title}}.

Offer Details:
- Candidate: {{candidate_name}}
- Position: {{job_title}}
- Start Date: {{start_date}}
- Salary: {{salary}}

Next Steps:
1. Send welcome package
2. Prepare onboarding materials
3. Schedule first day orientation

Candidate Profile: {{candidate_link}}

Best regards,
The Rekrut AI Team`,
			html: null,
		},
		{
			name: 'offer_rejected',
			subject: 'Offer Declined: {{candidate_name}} for {{job_title}}',
			body: `Hi {{name}},

{{candidate_name}} has declined the offer for {{job_title}}.

Reason: {{rejection_reason}}

This position is now back open. You can view other candidates:
{{candidates_link}}

Best regards,
The Rekrut AI Team`,
			html: null,
		},
		{
			name: 'document_verified',
			subject: 'Document Verified Successfully',
			body: `Hi {{name}},

Your {{document_type}} has been successfully verified.

Verification Results:
- Authenticity Score: {{authenticity_score}}/100
- Status: {{status}}
- Verified on: {{verified_date}}

Your OmniScore has been updated with this verification.

View your documents: {{documents_link}}

Best regards,
The Rekrut AI Team`,
			html: null,
		},
		{
			name: 'document_flagged',
			subject: 'Document Requires Review',
			body: `Hi {{name}},

Your {{document_type}} has been flagged for manual review.

Reason: {{flag_reason}}

This is a standard security procedure. A member of our team will review your document within 24 hours.

You don't need to take any action at this time. We'll notify you once the review is complete.

Questions? Contact support@rekrut.ai

Best regards,
The Rekrut AI Team`,
			html: null,
		},
		{
			name: 'account_suspended',
			subject: 'Account Suspended - Rekrut AI',
			body: `Hi {{name}},

Your Rekrut AI account has been suspended.

Reason: {{suspension_reason}}

If you believe this is an error, please contact our support team:
support@rekrut.ai

Best regards,
The Rekrut AI Team`,
			html: null,
		},
		{
			name: 'payment_failed',
			subject: 'Payment Failed - Rekrut AI Subscription',
			body: `Hi {{name}},

We were unable to process your payment for your Rekrut AI subscription.

Payment Details:
- Plan: {{plan_name}}
- Amount: {{amount}}
- Date: {{payment_date}}

Please update your payment method to avoid service interruption:
{{payment_link}}

If you need assistance, contact billing@rekrut.ai

Best regards,
The Rekrut AI Team`,
			html: null,
		},
		{
			name: 'subscription_renewal',
			subject: 'Subscription Renewal - {{plan_name}}',
			body: `Hi {{name}},

Your {{plan_name}} subscription will renew on {{renewal_date}}.

Renewal Details:
- Plan: {{plan_name}}
- Amount: {{amount}}
- Renewal Date: {{renewal_date}}

No action is required. Your subscription will renew automatically.

To manage your subscription:
{{billing_link}}

Best regards,
The Rekrut AI Team`,
			html: null,
		},
	];

	for (const template of templates) {
		await client.query(
			`
        INSERT INTO notification_templates (name, type, subject_template, body_template, html_template)
        VALUES ($1, 'email', $2, $3, $4)
        ON CONFLICT (name) DO UPDATE SET
          subject_template = EXCLUDED.subject_template,
          body_template = EXCLUDED.body_template,
          html_template = EXCLUDED.html_template,
          updated_at = NOW()
      `,
			[template.name, template.subject, template.body, template.html],
		);
	}

	console.log(`[migration] Inserted ${templates.length} email templates`);
}

module.exports = { name: 'add-email-templates', up };
