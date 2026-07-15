async function up(client) {
	const templates = [
		{
			name: 'hired',
			type: 'offer',
			subject: "Congratulations! You've been hired at {{companyName}}",
			body: 'Dear {{candidateName}},\n\nCongratulations! We are pleased to offer you the position of {{jobTitle}} at {{companyName}}.\n\nWe are excited to have you join our team. Our HR department will reach out shortly with next steps regarding onboarding and start date.\n\nWelcome aboard!\n\nBest regards,\nThe {{companyName}} Team',
			html_body:
				'<p>Dear {{candidateName}},</p><p><strong>Congratulations!</strong> We are pleased to offer you the position of <strong>{{jobTitle}}</strong> at {{companyName}}.</p><p>We are excited to have you join our team. Our HR department will reach out shortly with next steps regarding onboarding and start date.</p><p>Welcome aboard!</p><p>Best regards,<br>The {{companyName}} Team</p>',
		},
		{
			name: 'rejection',
			type: 'status',
			subject: 'Update on your application for {{jobTitle}} at {{companyName}}',
			body: 'Dear {{candidateName}},\n\nThank you for your interest in the {{jobTitle}} position at {{companyName}} and for the time you invested in the application and interview process.\n\nAfter careful consideration, we have decided to move forward with another candidate whose experience more closely aligns with our current needs.\n\nWe truly appreciate your interest in our company and encourage you to apply for future opportunities that match your skills and experience.\n\nWe wish you the very best in your job search and future endeavors.\n\nBest regards,\nThe {{companyName}} Recruitment Team',
			html_body:
				'<p>Dear {{candidateName}},</p><p>Thank you for your interest in the <strong>{{jobTitle}}</strong> position at {{companyName}} and for the time you invested in the application and interview process.</p><p>After careful consideration, we have decided to move forward with another candidate whose experience more closely aligns with our current needs.</p><p>We truly appreciate your interest in our company and encourage you to apply for future opportunities that match your skills and experience.</p><p>We wish you the very best in your job search and future endeavors.</p><p>Best regards,<br>The {{companyName}} Recruitment Team</p>',
		},
		{
			name: 'interview_reminder',
			type: 'interview',
			subject: 'Reminder: Interview for {{jobTitle}} at {{companyName}} in {{reminderType}}',
			body: 'Dear {{candidateName}},\n\nThis is a friendly reminder that your interview for the {{jobTitle}} position at {{companyName}} is scheduled for {{interviewDate}}.\n\nPlease ensure you have tested your video/audio setup if it is a virtual interview, and have any necessary materials ready.\n\nIf you need to reschedule or have any questions, please contact us as soon as possible.\n\nBest regards,\nThe {{companyName}} Recruitment Team',
			html_body:
				'<p>Dear {{candidateName}},</p><p>This is a friendly reminder that your interview for the <strong>{{jobTitle}}</strong> position at {{companyName}} is scheduled for:</p><p><strong>{{interviewDate}}</strong></p><p>Please ensure you have tested your video/audio setup if it is a virtual interview, and have any necessary materials ready.</p><p>If you need to reschedule or have any questions, please contact us as soon as possible.</p><p>Best regards,<br>The {{companyName}} Recruitment Team</p>',
		},
	];

	for (const template of templates) {
		try {
			await client.query(
				`INSERT INTO notification_templates (name, type, subject_template, body_template, html_template, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
         ON CONFLICT (name) DO UPDATE SET
           type = EXCLUDED.type,
           subject_template = EXCLUDED.subject_template,
           body_template = EXCLUDED.body_template,
           html_template = EXCLUDED.html_template,
           updated_at = NOW()`,
				[template.name, template.type, template.subject, template.body, template.html_body],
			);
			console.log(`[migration] Template '${template.name}' created/updated`);
		} catch (err) {
			console.error(`[migration] Failed to create template '${template.name}':`, err.message);
		}
	}

	console.log('[migration] Missing email templates added successfully');
}

async function down(client) {
	// Remove templates
	const templateNames = ['hired', 'rejection', 'interview_reminder'];
	for (const name of templateNames) {
		try {
			await client.query('DELETE FROM notification_templates WHERE name = $1', [name]);
			console.log(`[migration] Template '${name}' removed`);
		} catch (err) {
			console.error(`[migration] Failed to remove template '${name}':`, err.message);
		}
	}
}

module.exports = { up, down };
