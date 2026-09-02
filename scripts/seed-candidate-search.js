#!/usr/bin/env node
/**
 * Seed script: Candidate Search Test Data
 * Issue #3 — Populates 25 realistic candidate profiles for search testing
 *
 * Usage: node scripts/seed-candidate-search.js
 * Requires: DATABASE_URL env var set
 */

if (process.env.NODE_ENV === 'production') {
	throw new Error('Seed scripts cannot run in production');
}

require('dotenv').config();

const pool = require('../lib/db');

// ─── Realistic candidate data ────────────────────────────────────

const CANDIDATES = [
	{
		name: 'Sarah Chen',
		email: 'sarah.chen@email.com',
		headline: 'Senior Full-Stack Engineer',
		bio: 'Passionate full-stack developer with 8 years of experience building scalable web applications. Expert in React, Node.js, and cloud infrastructure. Led a team of 5 engineers at a fintech startup.',
		location: 'San Francisco, CA',
		years_experience: 8,
		availability: 'immediately',
		remote_preference: 'hybrid',
		skills: [
			{ name: 'React', level: 5 },
			{ name: 'Node.js', level: 5 },
			{ name: 'TypeScript', level: 5 },
			{ name: 'PostgreSQL', level: 4 },
			{ name: 'AWS', level: 4 },
			{ name: 'Docker', level: 4 },
		],
		experience: [
			{
				company_name: 'Stripe',
				title: 'Senior Full-Stack Engineer',
				location: 'San Francisco, CA',
				start_date: '2021-03-01',
				is_current: true,
				description:
					'Building payment infrastructure APIs used by millions of merchants. Led migration to microservices architecture.',
			},
			{
				company_name: 'Airbnb',
				title: 'Software Engineer',
				location: 'San Francisco, CA',
				start_date: '2018-06-01',
				end_date: '2021-02-28',
				description:
					'Developed search and booking features. Improved page load times by 40% through code splitting and lazy loading.',
			},
		],
		education: [
			{
				institution: 'Stanford University',
				degree: 'MS',
				field_of_study: 'Computer Science',
			},
		],
		omni_score: 850,
		score_tier: 'platinum',
	},
	{
		name: 'Marcus Johnson',
		email: 'marcus.johnson@email.com',
		headline: 'Machine Learning Engineer',
		bio: 'ML engineer specializing in NLP and recommendation systems. Published researcher with 3 papers at NeurIPS and ICML. Previously at Google Brain.',
		location: 'New York, NY',
		years_experience: 6,
		availability: 'two_weeks',
		remote_preference: 'remote',
		skills: [
			{ name: 'Python', level: 5 },
			{ name: 'TensorFlow', level: 5 },
			{ name: 'PyTorch', level: 4 },
			{ name: 'NLP', level: 5 },
			{ name: 'SQL', level: 4 },
			{ name: 'Kubernetes', level: 3 },
		],
		experience: [
			{
				company_name: 'Google',
				title: 'ML Engineer',
				location: 'Mountain View, CA',
				start_date: '2020-01-01',
				is_current: true,
				description:
					'Built recommendation models for Google Search. Reduced inference latency by 30%.',
			},
			{
				company_name: 'OpenAI',
				title: 'Research Engineer',
				location: 'San Francisco, CA',
				start_date: '2018-07-01',
				end_date: '2019-12-31',
				description: 'Contributed to GPT-2 training infrastructure and evaluation benchmarks.',
			},
		],
		education: [
			{
				institution: 'MIT',
				degree: 'PhD',
				field_of_study: 'Machine Learning',
			},
		],
		omni_score: 920,
		score_tier: 'platinum',
	},
	{
		name: 'Priya Patel',
		email: 'priya.patel@email.com',
		headline: 'Product Designer turned Frontend Developer',
		bio: 'Unique blend of design and engineering. 5 years creating beautiful, accessible user interfaces. Advocates for design systems and component-driven development.',
		location: 'Austin, TX',
		years_experience: 5,
		availability: 'one_month',
		remote_preference: 'hybrid',
		skills: [
			{ name: 'React', level: 5 },
			{ name: 'Figma', level: 5 },
			{ name: 'CSS', level: 5 },
			{ name: 'Accessibility', level: 5 },
			{ name: 'Design Systems', level: 4 },
			{ name: 'JavaScript', level: 4 },
		],
		experience: [
			{
				company_name: 'Figma',
				title: 'Design Engineer',
				location: 'San Francisco, CA',
				start_date: '2022-04-01',
				is_current: true,
				description:
					'Bridging design and engineering. Built the design system used across all product teams.',
			},
			{
				company_name: 'Dropbox',
				title: 'Frontend Developer',
				location: 'San Francisco, CA',
				start_date: '2019-08-01',
				end_date: '2022-03-31',
				description:
					'Redesigned the sharing experience. Improved accessibility score from 72 to 98.',
			},
		],
		education: [
			{
				institution: 'Rhode Island School of Design',
				degree: 'BFA',
				field_of_study: 'Graphic Design',
			},
		],
		omni_score: 780,
		score_tier: 'gold',
	},
	{
		name: 'James Wilson',
		email: 'james.wilson@email.com',
		headline: 'DevOps / SRE Engineer',
		bio: 'Infrastructure specialist with deep expertise in Kubernetes, Terraform, and CI/CD pipelines. Reduced cloud costs by 40% at previous company through intelligent resource allocation.',
		location: 'Seattle, WA',
		years_experience: 7,
		availability: 'immediately',
		remote_preference: 'onsite',
		skills: [
			{ name: 'Kubernetes', level: 5 },
			{ name: 'Terraform', level: 5 },
			{ name: 'AWS', level: 5 },
			{ name: 'Docker', level: 5 },
			{ name: 'Go', level: 4 },
			{ name: 'CI/CD', level: 5 },
		],
		experience: [
			{
				company_name: 'Amazon',
				title: 'Senior SRE',
				location: 'Seattle, WA',
				start_date: '2020-02-01',
				is_current: true,
				description:
					'Managing EKS clusters serving 10M+ requests/day. Implemented chaos engineering practices.',
			},
			{
				company_name: 'Netflix',
				title: 'DevOps Engineer',
				location: 'Los Gatos, CA',
				start_date: '2017-05-01',
				end_date: '2020-01-31',
				description: 'Built deployment pipelines for microservices. Achieved 99.99% uptime SLA.',
			},
		],
		education: [
			{
				institution: 'University of Washington',
				degree: 'BS',
				field_of_study: 'Computer Engineering',
			},
		],
		omni_score: 810,
		score_tier: 'gold',
	},
	{
		name: 'Emily Rodriguez',
		email: 'emily.rodriguez@email.com',
		headline: 'Data Scientist | AI/ML',
		bio: 'Data scientist with strong background in statistics and deep learning. Built fraud detection models that saved $2M annually. Experienced in both research and production ML systems.',
		location: 'Chicago, IL',
		years_experience: 4,
		availability: 'two_weeks',
		remote_preference: 'hybrid',
		skills: [
			{ name: 'Python', level: 5 },
			{ name: 'SQL', level: 5 },
			{ name: 'Scikit-learn', level: 5 },
			{ name: 'Pandas', level: 5 },
			{ name: 'Deep Learning', level: 4 },
			{ name: 'Spark', level: 3 },
		],
		experience: [
			{
				company_name: 'JPMorgan Chase',
				title: 'Data Scientist',
				location: 'Chicago, IL',
				start_date: '2021-06-01',
				is_current: true,
				description:
					'Built real-time fraud detection using gradient boosting. Models process $1B+ in transactions daily.',
			},
			{
				company_name: 'McKinsey',
				title: 'Data Analyst',
				location: 'Chicago, IL',
				start_date: '2019-09-01',
				end_date: '2021-05-31',
				description:
					'Analyzed customer churn for telecom clients. Delivered insights that reduced churn by 15%.',
			},
		],
		education: [
			{
				institution: 'University of Chicago',
				degree: 'MS',
				field_of_study: 'Statistics',
			},
		],
		omni_score: 760,
		score_tier: 'gold',
	},
	{
		name: 'David Kim',
		email: 'david.kim@email.com',
		headline: 'Mobile App Developer (iOS & Android)',
		bio: 'Cross-platform mobile developer with apps featured on App Store and Google Play. Strong focus on performance optimization and smooth user experiences.',
		location: 'Los Angeles, CA',
		years_experience: 5,
		availability: 'one_month',
		remote_preference: 'remote',
		skills: [
			{ name: 'Swift', level: 5 },
			{ name: 'Kotlin', level: 5 },
			{ name: 'React Native', level: 4 },
			{ name: 'Flutter', level: 3 },
			{ name: 'Firebase', level: 4 },
			{ name: 'iOS', level: 5 },
		],
		experience: [
			{
				company_name: 'Snap Inc.',
				title: 'iOS Engineer',
				location: 'Santa Monica, CA',
				start_date: '2021-01-01',
				is_current: true,
				description:
					'Core contributor to Snapchat camera features. Improved cold start time by 25%.',
			},
			{
				company_name: 'Tinder',
				title: 'Mobile Developer',
				location: 'Los Angeles, CA',
				start_date: '2018-09-01',
				end_date: '2020-12-31',
				description: 'Built swipe gesture system. App featured in Apple Design Awards 2019.',
			},
		],
		education: [
			{
				institution: 'UCLA',
				degree: 'BS',
				field_of_study: 'Computer Science',
			},
		],
		omni_score: 740,
		score_tier: 'gold',
	},
	{
		name: 'Aisha Mohammed',
		email: 'aisha.mohammed@email.com',
		headline: 'Backend Engineer | Distributed Systems',
		bio: 'Backend engineer passionate about distributed systems and database internals. Contributor to PostgreSQL and Redis. Speaker at QCon and Strange Loop.',
		location: 'Boston, MA',
		years_experience: 9,
		availability: 'immediately',
		remote_preference: 'hybrid',
		skills: [
			{ name: 'Go', level: 5 },
			{ name: 'Rust', level: 4 },
			{ name: 'PostgreSQL', level: 5 },
			{ name: 'Redis', level: 5 },
			{ name: 'Kafka', level: 4 },
			{ name: 'gRPC', level: 4 },
		],
		experience: [
			{
				company_name: 'HubSpot',
				title: 'Principal Backend Engineer',
				location: 'Cambridge, MA',
				start_date: '2019-04-01',
				is_current: true,
				description:
					'Architected CRM data pipeline processing 500M+ events/day. Reduced P99 latency by 60%.',
			},
			{
				company_name: 'Datadog',
				title: 'Senior Backend Engineer',
				location: 'New York, NY',
				start_date: '2016-03-01',
				end_date: '2019-03-31',
				description:
					'Built high-throughput metrics ingestion pipeline. Handled 10M+ metrics/second.',
			},
		],
		education: [
			{
				institution: 'Carnegie Mellon University',
				degree: 'MS',
				field_of_study: 'Computer Science',
			},
		],
		omni_score: 890,
		score_tier: 'platinum',
	},
	{
		name: "Ryan O'Connor",
		email: 'ryan.oconnor@email.com',
		headline: 'Security Engineer | Penetration Testing',
		bio: 'Offensive security specialist with OSCP and OSCE certifications. Discovered critical vulnerabilities in major SaaS platforms. Passionate about secure coding practices.',
		location: 'Denver, CO',
		years_experience: 6,
		availability: 'two_weeks',
		remote_preference: 'remote',
		skills: [
			{ name: 'Penetration Testing', level: 5 },
			{ name: 'Python', level: 4 },
			{ name: 'Burp Suite', level: 5 },
			{ name: 'OWASP', level: 5 },
			{ name: 'Cloud Security', level: 4 },
			{ name: 'Reverse Engineering', level: 3 },
		],
		experience: [
			{
				company_name: 'CrowdStrike',
				title: 'Senior Security Engineer',
				location: 'Denver, CO',
				start_date: '2020-07-01',
				is_current: true,
				description:
					'Led red team exercises. Discovered 15+ critical vulnerabilities in production systems.',
			},
			{
				company_name: 'Bugcrowd',
				title: 'Security Researcher',
				location: 'San Francisco, CA',
				start_date: '2018-02-01',
				end_date: '2020-06-30',
				description: 'Top 1% bounty hunter. Earned $200K+ in bug bounties.',
			},
		],
		education: [
			{
				institution: 'Georgia Tech',
				degree: 'BS',
				field_of_study: 'Cybersecurity',
			},
		],
		omni_score: 820,
		score_tier: 'gold',
	},
	{
		name: 'Lisa Tanaka',
		email: 'lisa.tanaka@email.com',
		headline: 'UX Researcher & Product Strategist',
		bio: 'Mixed-methods UX researcher with experience in both B2B and B2C products. Conducted 200+ user interviews and usability tests. Strong background in data-driven design decisions.',
		location: 'Portland, OR',
		years_experience: 4,
		availability: 'one_month',
		remote_preference: 'hybrid',
		skills: [
			{ name: 'User Research', level: 5 },
			{ name: 'Usability Testing', level: 5 },
			{ name: 'Figma', level: 4 },
			{ name: 'Analytics', level: 4 },
			{ name: 'A/B Testing', level: 4 },
			{ name: 'Design Thinking', level: 5 },
		],
		experience: [
			{
				company_name: 'Nike',
				title: 'UX Researcher',
				location: 'Portland, OR',
				start_date: '2021-09-01',
				is_current: true,
				description:
					'Leading research for digital commerce experience. Influenced $50M+ in product decisions.',
			},
			{
				company_name: 'Intel',
				title: 'UX Designer',
				location: 'Portland, OR',
				start_date: '2019-06-01',
				end_date: '2021-08-31',
				description: 'Redesigned developer portal. Improved task completion rate by 35%.',
			},
		],
		education: [
			{
				institution: 'University of Oregon',
				degree: 'MS',
				field_of_study: 'Human-Computer Interaction',
			},
		],
		omni_score: 720,
		score_tier: 'gold',
	},
	{
		name: 'Ahmed Hassan',
		email: 'ahmed.hassan@email.com',
		headline: 'Blockchain Developer | Smart Contracts',
		bio: 'Blockchain engineer with expertise in Ethereum, Solana, and zero-knowledge proofs. Built DeFi protocols handling $100M+ in TVL. Open source contributor to Foundry and Hardhat.',
		location: 'Dubai, UAE',
		years_experience: 4,
		availability: 'immediately',
		remote_preference: 'remote',
		skills: [
			{ name: 'Solidity', level: 5 },
			{ name: 'Rust', level: 4 },
			{ name: 'Ethereum', level: 5 },
			{ name: 'Zero-Knowledge', level: 4 },
			{ name: 'TypeScript', level: 4 },
			{ name: 'Smart Contracts', level: 5 },
		],
		experience: [
			{
				company_name: 'Uniswap Labs',
				title: 'Protocol Engineer',
				location: 'Remote',
				start_date: '2022-01-01',
				is_current: true,
				description: 'Contributing to Uniswap v4 architecture. Optimized gas costs by 20%.',
			},
			{
				company_name: 'Consensys',
				title: 'Smart Contract Developer',
				location: 'Remote',
				start_date: '2020-05-01',
				end_date: '2021-12-31',
				description: 'Audited 50+ smart contracts. Found $5M+ worth of vulnerabilities.',
			},
		],
		education: [
			{
				institution: 'American University of Sharjah',
				degree: 'BS',
				field_of_study: 'Computer Science',
			},
		],
		omni_score: 790,
		score_tier: 'gold',
	},
	{
		name: 'Olivia Martinez',
		email: 'olivia.martinez@email.com',
		headline: 'Junior Frontend Developer',
		bio: 'Recent bootcamp graduate with strong foundations in React and modern CSS. Built 5 full-stack projects during training. Eager to contribute and grow in a supportive team environment.',
		location: 'Miami, FL',
		years_experience: 1,
		availability: 'immediately',
		remote_preference: 'onsite',
		skills: [
			{ name: 'React', level: 3 },
			{ name: 'JavaScript', level: 3 },
			{ name: 'HTML/CSS', level: 4 },
			{ name: 'Git', level: 3 },
			{ name: 'Node.js', level: 2 },
			{ name: 'Tailwind CSS', level: 4 },
		],
		experience: [
			{
				company_name: 'StartupXYZ',
				title: 'Frontend Intern',
				location: 'Miami, FL',
				start_date: '2023-06-01',
				end_date: '2023-12-31',
				description: 'Built landing pages and dashboard components using React and Tailwind.',
			},
		],
		education: [
			{
				institution: 'University of Miami',
				degree: 'BS',
				field_of_study: 'Information Technology',
			},
		],
		omni_score: 520,
		score_tier: 'silver',
	},
	{
		name: 'Thomas Anderson',
		email: 'thomas.anderson@email.com',
		headline: 'Staff Engineer | Platform Architecture',
		bio: '15+ years of experience building internet-scale systems. Previously CTO at two startups. Expert in system design, technical leadership, and organizational scaling.',
		location: 'Palo Alto, CA',
		years_experience: 15,
		availability: 'negotiable',
		remote_preference: 'hybrid',
		skills: [
			{ name: 'System Design', level: 5 },
			{ name: 'Java', level: 5 },
			{ name: 'Kotlin', level: 4 },
			{ name: 'Microservices', level: 5 },
			{ name: 'Leadership', level: 5 },
			{ name: 'Cloud Architecture', level: 5 },
		],
		experience: [
			{
				company_name: 'Meta',
				title: 'Staff Engineer',
				location: 'Menlo Park, CA',
				start_date: '2018-01-01',
				is_current: true,
				description: 'Led platform migration serving 3B+ users. Managed team of 25 engineers.',
			},
			{
				company_name: 'Self-Employed',
				title: 'CTO',
				location: 'Palo Alto, CA',
				start_date: '2015-01-01',
				end_date: '2017-12-31',
				description: 'Co-founded and scaled startup to Series B. Acquired for $50M.',
			},
			{
				company_name: 'Oracle',
				title: 'Senior Engineer',
				location: 'Redwood City, CA',
				start_date: '2010-06-01',
				end_date: '2014-12-31',
				description: 'Core contributor to Oracle Cloud Infrastructure.',
			},
		],
		education: [
			{
				institution: 'Stanford University',
				degree: 'MS',
				field_of_study: 'Computer Science',
			},
		],
		omni_score: 950,
		score_tier: 'platinum',
	},
	{
		name: 'Nadia Volkov',
		email: 'nadia.volkov@email.com',
		headline: 'Data Engineer | ETL & Data Pipelines',
		bio: 'Data engineer with expertise in building robust ETL pipelines and data warehouses. Optimized pipeline performance reducing runtime from 6 hours to 45 minutes.',
		location: 'Berlin, Germany',
		years_experience: 5,
		availability: 'one_month',
		remote_preference: 'remote',
		skills: [
			{ name: 'Python', level: 5 },
			{ name: 'SQL', level: 5 },
			{ name: 'Airflow', level: 5 },
			{ name: 'dbt', level: 4 },
			{ name: 'Snowflake', level: 4 },
			{ name: 'Spark', level: 4 },
		],
		experience: [
			{
				company_name: 'Zalando',
				title: 'Senior Data Engineer',
				location: 'Berlin, Germany',
				start_date: '2021-02-01',
				is_current: true,
				description:
					'Built real-time analytics platform for fashion recommendations. Processed 1B+ events/day.',
			},
			{
				company_name: 'SoundCloud',
				title: 'Data Engineer',
				location: 'Berlin, Germany',
				start_date: '2019-04-01',
				end_date: '2021-01-31',
				description: 'Migrated data warehouse from Redshift to Snowflake. Saved $300K/year.',
			},
		],
		education: [
			{
				institution: 'TU Berlin',
				degree: 'MS',
				field_of_study: 'Computer Science',
			},
		],
		omni_score: 770,
		score_tier: 'gold',
	},
	{
		name: 'Carlos Mendez',
		email: 'carlos.mendez@email.com',
		headline: 'Game Developer | Unity & Unreal',
		bio: 'Game programmer with shipped titles on PC, console, and mobile. Specialized in gameplay systems and AI behavior. Previously worked on AAA titles at Ubisoft.',
		location: 'Montreal, Canada',
		years_experience: 6,
		availability: 'two_weeks',
		remote_preference: 'hybrid',
		skills: [
			{ name: 'C++', level: 5 },
			{ name: 'Unity', level: 5 },
			{ name: 'Unreal Engine', level: 4 },
			{ name: 'C#', level: 5 },
			{ name: 'Game AI', level: 4 },
			{ name: 'OpenGL', level: 3 },
		],
		experience: [
			{
				company_name: 'Ubisoft',
				title: 'Gameplay Programmer',
				location: 'Montreal, Canada',
				start_date: '2019-09-01',
				is_current: true,
				description:
					'Core gameplay systems for open-world RPG. Implemented dynamic weather system.',
			},
			{
				company_name: 'Indie Studio',
				title: 'Lead Developer',
				location: 'Montreal, Canada',
				start_date: '2018-01-01',
				end_date: '2019-08-31',
				description: 'Solo-developed mobile game with 2M+ downloads. 4.7 star rating.',
			},
		],
		education: [
			{
				institution: 'Concordia University',
				degree: 'BS',
				field_of_study: 'Software Engineering',
			},
		],
		omni_score: 730,
		score_tier: 'gold',
	},
	{
		name: 'Sophie Laurent',
		email: 'sophie.laurent@email.com',
		headline: 'Technical Writer | Developer Advocate',
		bio: 'Technical communicator who bridges the gap between engineers and users. Created documentation used by 100K+ developers. Strong coding background enables accurate technical writing.',
		location: 'Paris, France',
		years_experience: 4,
		availability: 'immediately',
		remote_preference: 'remote',
		skills: [
			{ name: 'Technical Writing', level: 5 },
			{ name: 'API Documentation', level: 5 },
			{ name: 'Python', level: 3 },
			{ name: 'Markdown', level: 5 },
			{ name: 'Developer Relations', level: 4 },
			{ name: 'Video Production', level: 3 },
		],
		experience: [
			{
				company_name: 'Stripe',
				title: 'Developer Advocate',
				location: 'Remote',
				start_date: '2021-05-01',
				is_current: true,
				description:
					'Created API documentation and SDK guides. Organized developer workshops in 10 countries.',
			},
			{
				company_name: 'GitHub',
				title: 'Technical Writer',
				location: 'San Francisco, CA',
				start_date: '2019-08-01',
				end_date: '2021-04-30',
				description: 'Rewrote Actions documentation. Reduced support tickets by 30%.',
			},
		],
		education: [
			{
				institution: 'Sorbonne University',
				degree: 'MA',
				field_of_study: 'Technical Communication',
			},
		],
		omni_score: 680,
		score_tier: 'silver',
	},
	{
		name: 'Kevin Zhang',
		email: 'kevin.zhang@email.com',
		headline: 'QA Engineer | Automation Specialist',
		bio: 'Quality assurance engineer with strong automation skills. Built test frameworks from scratch. Reduced manual testing time by 80% through comprehensive automation.',
		location: 'Toronto, Canada',
		years_experience: 4,
		availability: 'two_weeks',
		remote_preference: 'hybrid',
		skills: [
			{ name: 'Selenium', level: 5 },
			{ name: 'Cypress', level: 5 },
			{ name: 'Python', level: 4 },
			{ name: 'CI/CD', level: 4 },
			{ name: 'API Testing', level: 5 },
			{ name: 'Jest', level: 4 },
		],
		experience: [
			{
				company_name: 'Shopify',
				title: 'Senior QA Engineer',
				location: 'Toronto, Canada',
				start_date: '2021-03-01',
				is_current: true,
				description:
					'Own end-to-end testing strategy for checkout flow. 99.5% automation coverage.',
			},
			{
				company_name: 'IBM',
				title: 'QA Analyst',
				location: 'Toronto, Canada',
				start_date: '2019-07-01',
				end_date: '2021-02-28',
				description: 'Automated regression testing for enterprise software.',
			},
		],
		education: [
			{
				institution: 'University of Toronto',
				degree: 'BS',
				field_of_study: 'Computer Science',
			},
		],
		omni_score: 710,
		score_tier: 'gold',
	},
	{
		name: 'Fatima Al-Rashid',
		email: 'fatima.alrashid@email.com',
		headline: 'Cloud Architect | AWS Solutions Architect',
		bio: 'AWS-certified Solutions Architect with 10 years designing cloud-native systems. Helped 50+ companies migrate to AWS. Expert in serverless and containerized architectures.',
		location: 'London, UK',
		years_experience: 10,
		availability: 'one_month',
		remote_preference: 'remote',
		skills: [
			{ name: 'AWS', level: 5 },
			{ name: 'Serverless', level: 5 },
			{ name: 'Terraform', level: 5 },
			{ name: 'Python', level: 4 },
			{ name: 'Kubernetes', level: 4 },
			{ name: 'Architecture', level: 5 },
		],
		experience: [
			{
				company_name: 'AWS',
				title: 'Solutions Architect',
				location: 'London, UK',
				start_date: '2020-01-01',
				is_current: true,
				description: 'Advising enterprise clients on cloud architecture. $10M+ in contract wins.',
			},
			{
				company_name: 'Capgemini',
				title: 'Cloud Consultant',
				location: 'London, UK',
				start_date: '2015-06-01',
				end_date: '2019-12-31',
				description: 'Led cloud migration for 3 Fortune 500 companies.',
			},
		],
		education: [
			{
				institution: 'Imperial College London',
				degree: 'MS',
				field_of_study: 'Computer Science',
			},
		],
		omni_score: 880,
		score_tier: 'platinum',
	},
	{
		name: 'Benjamin Lee',
		email: 'benjamin.lee@email.com',
		headline: 'Full-Stack Developer | React & Node.js',
		bio: 'Versatile developer comfortable across the entire stack. Built and deployed 20+ web applications. Strong advocate for TypeScript and testing best practices.',
		location: 'Singapore',
		years_experience: 3,
		availability: 'immediately',
		remote_preference: 'hybrid',
		skills: [
			{ name: 'React', level: 4 },
			{ name: 'Node.js', level: 4 },
			{ name: 'TypeScript', level: 4 },
			{ name: 'MongoDB', level: 4 },
			{ name: 'GraphQL', level: 3 },
			{ name: 'Jest', level: 4 },
		],
		experience: [
			{
				company_name: 'Grab',
				title: 'Full-Stack Developer',
				location: 'Singapore',
				start_date: '2022-01-01',
				is_current: true,
				description: 'Building merchant dashboard. Improved load time by 50%.',
			},
			{
				company_name: 'Shopee',
				title: 'Junior Developer',
				location: 'Singapore',
				start_date: '2020-07-01',
				end_date: '2021-12-31',
				description: 'Developed internal tools for operations team.',
			},
		],
		education: [
			{
				institution: 'National University of Singapore',
				degree: 'BS',
				field_of_study: 'Computer Science',
			},
		],
		omni_score: 650,
		score_tier: 'silver',
	},
	{
		name: 'Rachel Green',
		email: 'rachel.green@email.com',
		headline: 'Product Manager | B2B SaaS',
		bio: 'Product manager with track record of launching successful B2B SaaS products. Led cross-functional teams of 15+ people. Data-driven decision maker with strong technical background.',
		location: 'New York, NY',
		years_experience: 7,
		availability: 'negotiable',
		remote_preference: 'hybrid',
		skills: [
			{ name: 'Product Strategy', level: 5 },
			{ name: 'Agile', level: 5 },
			{ name: 'SQL', level: 4 },
			{ name: 'A/B Testing', level: 4 },
			{ name: 'User Research', level: 4 },
			{ name: 'Data Analysis', level: 4 },
		],
		experience: [
			{
				company_name: 'Salesforce',
				title: 'Senior Product Manager',
				location: 'New York, NY',
				start_date: '2020-03-01',
				is_current: true,
				description: 'Leading CRM analytics product. $5M ARR growth in first year.',
			},
			{
				company_name: 'Slack',
				title: 'Product Manager',
				location: 'San Francisco, CA',
				start_date: '2017-05-01',
				end_date: '2020-02-29',
				description: 'Launched workflow automation features. 200K+ active users in 6 months.',
			},
		],
		education: [
			{
				institution: 'Harvard Business School',
				degree: 'MBA',
				field_of_study: 'Business Administration',
			},
		],
		omni_score: 830,
		score_tier: 'gold',
	},
	{
		name: 'Daniel Park',
		email: 'daniel.park@email.com',
		headline: 'Embedded Systems Engineer | IoT',
		bio: 'Embedded systems expert with experience in automotive, medical devices, and IoT. Proficient in C, RTOS, and hardware interfacing. Holds 3 patents in sensor technology.',
		location: 'Detroit, MI',
		years_experience: 8,
		availability: 'two_weeks',
		remote_preference: 'onsite',
		skills: [
			{ name: 'C', level: 5 },
			{ name: 'RTOS', level: 5 },
			{ name: 'IoT', level: 5 },
			{ name: 'ARM', level: 4 },
			{ name: 'Python', level: 3 },
			{ name: 'PCB Design', level: 3 },
		],
		experience: [
			{
				company_name: 'Ford Motor Company',
				title: 'Senior Embedded Engineer',
				location: 'Detroit, MI',
				start_date: '2019-01-01',
				is_current: true,
				description: 'Developing ADAS sensor fusion algorithms. 2 patents filed.',
			},
			{
				company_name: 'Medtronic',
				title: 'Firmware Engineer',
				location: 'Minneapolis, MN',
				start_date: '2016-06-01',
				end_date: '2018-12-31',
				description: 'Developed firmware for insulin pump. FDA Class II device.',
			},
		],
		education: [
			{
				institution: 'University of Michigan',
				degree: 'MS',
				field_of_study: 'Electrical Engineering',
			},
		],
		omni_score: 800,
		score_tier: 'gold',
	},
	{
		name: 'Mia Johansson',
		email: 'mia.johansson@email.com',
		headline: 'Frontend Developer | Vue.js Specialist',
		bio: 'Vue.js expert with deep knowledge of the ecosystem. Created popular open-source Vue component library with 5K+ GitHub stars. Passionate about performance and developer experience.',
		location: 'Stockholm, Sweden',
		years_experience: 5,
		availability: 'one_month',
		remote_preference: 'remote',
		skills: [
			{ name: 'Vue.js', level: 5 },
			{ name: 'JavaScript', level: 5 },
			{ name: 'TypeScript', level: 4 },
			{ name: 'Nuxt.js', level: 5 },
			{ name: 'Vite', level: 4 },
			{ name: 'CSS', level: 5 },
		],
		experience: [
			{
				company_name: 'Spotify',
				title: 'Frontend Engineer',
				location: 'Stockholm, Sweden',
				start_date: '2021-04-01',
				is_current: true,
				description: 'Built artist dashboard using Vue 3. Improved Time to Interactive by 40%.',
			},
			{
				company_name: 'Klarna',
				title: 'Web Developer',
				location: 'Stockholm, Sweden',
				start_date: '2019-02-01',
				end_date: '2021-03-31',
				description: 'Developed checkout experience. Reduced cart abandonment by 12%.',
			},
		],
		education: [
			{
				institution: 'KTH Royal Institute',
				degree: 'BS',
				field_of_study: 'Computer Science',
			},
		],
		omni_score: 750,
		score_tier: 'gold',
	},
	{
		name: 'Alex Rivera',
		email: 'alex.rivera@email.com',
		headline: 'Site Reliability Engineer | Chaos Engineering',
		bio: 'SRE with unique focus on chaos engineering and resilience testing. Built game-day frameworks adopted company-wide. Reduced MTTR from 45 min to 8 min.',
		location: 'Austin, TX',
		years_experience: 5,
		availability: 'immediately',
		remote_preference: 'hybrid',
		skills: [
			{ name: 'SRE', level: 5 },
			{ name: 'Kubernetes', level: 5 },
			{ name: 'Chaos Engineering', level: 5 },
			{ name: 'Go', level: 4 },
			{ name: 'Prometheus', level: 5 },
			{ name: 'Incident Response', level: 5 },
		],
		experience: [
			{
				company_name: 'Netflix',
				title: 'SRE',
				location: 'Los Gatos, CA',
				start_date: '2021-01-01',
				is_current: true,
				description: 'Chaos engineering team. Built automated failure injection system.',
			},
			{
				company_name: 'PagerDuty',
				title: 'Platform Engineer',
				location: 'San Francisco, CA',
				start_date: '2019-03-01',
				end_date: '2020-12-31',
				description: 'Built incident automation playbooks. Reduced MTTR by 60%.',
			},
		],
		education: [
			{
				institution: 'UT Austin',
				degree: 'BS',
				field_of_study: 'Computer Science',
			},
		],
		omni_score: 790,
		score_tier: 'gold',
	},
	{
		name: 'Yuki Tanaka',
		email: 'yuki.tanaka@email.com',
		headline: 'AI/ML Research Engineer',
		bio: 'Research engineer focused on computer vision and multimodal AI. Published at CVPR and ICCV. Experience bringing research prototypes to production at scale.',
		location: 'Tokyo, Japan',
		years_experience: 4,
		availability: 'two_weeks',
		remote_preference: 'remote',
		skills: [
			{ name: 'PyTorch', level: 5 },
			{ name: 'Computer Vision', level: 5 },
			{ name: 'Python', level: 5 },
			{ name: 'CUDA', level: 4 },
			{ name: 'TensorRT', level: 3 },
			{ name: 'MLOps', level: 4 },
		],
		experience: [
			{
				company_name: 'Sony',
				title: 'AI Research Engineer',
				location: 'Tokyo, Japan',
				start_date: '2021-06-01',
				is_current: true,
				description:
					'Developing real-time object detection for camera systems. 30fps on edge devices.',
			},
			{
				company_name: 'Preferred Networks',
				title: 'Research Intern',
				location: 'Tokyo, Japan',
				start_date: '2020-04-01',
				end_date: '2021-05-31',
				description: 'Worked on Chainer framework optimization.',
			},
		],
		education: [
			{
				institution: 'University of Tokyo',
				degree: 'MS',
				field_of_study: 'Information Science',
			},
		],
		omni_score: 840,
		score_tier: 'gold',
	},
	{
		name: 'Jordan Blake',
		email: 'jordan.blake@email.com',
		headline: 'Backend Engineer | API Design',
		bio: 'API-first developer who believes in clean interfaces and developer experience. Designed APIs serving 1M+ requests/day. Contributor to OpenAPI specification.',
		location: 'Denver, CO',
		years_experience: 5,
		availability: 'immediately',
		remote_preference: 'remote',
		skills: [
			{ name: 'Node.js', level: 5 },
			{ name: 'GraphQL', level: 5 },
			{ name: 'REST API Design', level: 5 },
			{ name: 'PostgreSQL', level: 4 },
			{ name: 'Redis', level: 4 },
			{ name: 'Docker', level: 4 },
		],
		experience: [
			{
				company_name: 'Twilio',
				title: 'API Engineer',
				location: 'Denver, CO',
				start_date: '2020-08-01',
				is_current: true,
				description: 'Designed next-gen messaging API. Developer satisfaction score 4.8/5.',
			},
			{
				company_name: 'Postman',
				title: 'Backend Developer',
				location: 'San Francisco, CA',
				start_date: '2019-01-01',
				end_date: '2020-07-31',
				description: 'Built public API monitoring features. 50K+ active monitors.',
			},
		],
		education: [
			{
				institution: 'Colorado School of Mines',
				degree: 'BS',
				field_of_study: 'Computer Science',
			},
		],
		omni_score: 760,
		score_tier: 'gold',
	},
	{
		name: 'Emma White',
		email: 'emma.white@email.com',
		headline: 'Junior Data Analyst',
		bio: 'Detail-oriented data analyst with strong SQL and visualization skills. Completed Google Data Analytics certificate. Passionate about turning data into actionable insights.',
		location: 'Chicago, IL',
		years_experience: 1,
		availability: 'immediately',
		remote_preference: 'onsite',
		skills: [
			{ name: 'SQL', level: 4 },
			{ name: 'Python', level: 3 },
			{ name: 'Tableau', level: 4 },
			{ name: 'Excel', level: 5 },
			{ name: 'Statistics', level: 3 },
			{ name: 'R', level: 2 },
		],
		experience: [
			{
				company_name: 'Walgreens',
				title: 'Data Analyst Intern',
				location: 'Chicago, IL',
				start_date: '2023-06-01',
				end_date: '2023-12-31',
				description: 'Analyzed customer purchase patterns. Identified $200K in cost savings.',
			},
		],
		education: [
			{
				institution: 'DePaul University',
				degree: 'BS',
				field_of_study: 'Data Science',
			},
		],
		omni_score: 480,
		score_tier: 'bronze',
	},
	{
		name: 'Nikolai Petrov',
		email: 'nikolai.petrov@email.com',
		headline: 'Systems Programmer | C++',
		bio: 'Low-level systems programmer with expertise in high-performance computing. Optimized critical paths in financial trading systems. Sub-millisecond latency specialist.',
		location: 'Zurich, Switzerland',
		years_experience: 12,
		availability: 'negotiable',
		remote_preference: 'onsite',
		skills: [
			{ name: 'C++', level: 5 },
			{ name: 'Low Latency', level: 5 },
			{ name: 'Linux Kernel', level: 4 },
			{ name: 'Network Programming', level: 5 },
			{ name: 'Assembly', level: 3 },
			{ name: 'FPGA', level: 3 },
		],
		experience: [
			{
				company_name: 'Credit Suisse',
				title: 'Quantitative Developer',
				location: 'Zurich, Switzerland',
				start_date: '2018-01-01',
				is_current: true,
				description:
					'Built ultra-low-latency trading infrastructure. Average latency <50 microseconds.',
			},
			{
				company_name: 'Two Sigma',
				title: 'Systems Engineer',
				location: 'New York, NY',
				start_date: '2013-06-01',
				end_date: '2017-12-31',
				description: 'Optimized market data feed handlers. 10x throughput improvement.',
			},
		],
		education: [
			{
				institution: 'ETH Zurich',
				degree: 'PhD',
				field_of_study: 'Computer Science',
			},
		],
		omni_score: 930,
		score_tier: 'platinum',
	},
	{
		name: 'Chloe Wang',
		email: 'chloe.wang@email.com',
		headline: 'Growth Engineer | Full-Stack',
		bio: 'Full-stack engineer with growth mindset. Built viral referral systems and A/B testing frameworks. Strong in both frontend UX and backend analytics.',
		location: 'San Francisco, CA',
		years_experience: 4,
		availability: 'two_weeks',
		remote_preference: 'hybrid',
		skills: [
			{ name: 'React', level: 4 },
			{ name: 'Node.js', level: 4 },
			{ name: 'Python', level: 4 },
			{ name: 'A/B Testing', level: 5 },
			{ name: 'Analytics', level: 5 },
			{ name: 'SQL', level: 4 },
		],
		experience: [
			{
				company_name: 'Notion',
				title: 'Growth Engineer',
				location: 'San Francisco, CA',
				start_date: '2021-07-01',
				is_current: true,
				description: 'Built referral program generating 100K+ signups. A/B test win rate 65%.',
			},
			{
				company_name: 'Duolingo',
				title: 'Software Engineer',
				location: 'Pittsburgh, PA',
				start_date: '2020-01-01',
				end_date: '2021-06-30',
				description: 'Developed streak features. Increased DAU by 15%.',
			},
		],
		education: [
			{
				institution: 'UC Berkeley',
				degree: 'BS',
				field_of_study: 'Computer Science',
			},
		],
		omni_score: 720,
		score_tier: 'gold',
	},
	{
		name: 'Hassan Ali',
		email: 'hassan.ali@email.com',
		headline: 'Cybersecurity Analyst',
		bio: 'Security analyst with experience in SOC operations and threat hunting. SIEM expert with Splunk and QRadar. Certified CISSP and GCIH.',
		location: 'Washington, DC',
		years_experience: 3,
		availability: 'immediately',
		remote_preference: 'hybrid',
		skills: [
			{ name: 'SIEM', level: 5 },
			{ name: 'Threat Hunting', level: 4 },
			{ name: 'Splunk', level: 5 },
			{ name: 'Python', level: 3 },
			{ name: 'Incident Response', level: 4 },
			{ name: 'Malware Analysis', level: 3 },
		],
		experience: [
			{
				company_name: 'Booz Allen Hamilton',
				title: 'Cybersecurity Analyst',
				location: 'Washington, DC',
				start_date: '2021-09-01',
				is_current: true,
				description: 'Defending federal agency networks. Responded to 50+ incidents.',
			},
			{
				company_name: 'FireEye',
				title: 'Security Intern',
				location: 'Reston, VA',
				start_date: '2021-01-01',
				end_date: '2021-08-31',
				description: 'Assisted in malware reverse engineering.',
			},
		],
		education: [
			{
				institution: 'George Mason University',
				degree: 'BS',
				field_of_study: 'Cybersecurity',
			},
		],
		omni_score: 620,
		score_tier: 'silver',
	},
	{
		name: 'Isabella Rossi',
		email: 'isabella.rossi@email.com',
		headline: 'UI/UX Designer',
		bio: 'Creative designer with eye for detail and user-centric approach. Redesigned flagship product increasing NPS by 25 points. Expert in Figma, prototyping, and design systems.',
		location: 'Milan, Italy',
		years_experience: 5,
		availability: 'one_month',
		remote_preference: 'remote',
		skills: [
			{ name: 'Figma', level: 5 },
			{ name: 'UI Design', level: 5 },
			{ name: 'Prototyping', level: 5 },
			{ name: 'Design Systems', level: 4 },
			{ name: 'User Research', level: 3 },
			{ name: 'HTML/CSS', level: 3 },
		],
		experience: [
			{
				company_name: 'Prada Group',
				title: 'Senior UX Designer',
				location: 'Milan, Italy',
				start_date: '2020-09-01',
				is_current: true,
				description: 'Leading digital experience for luxury e-commerce. NPS increased by 25.',
			},
			{
				company_name: 'Ferrari',
				title: 'UI Designer',
				location: 'Maranello, Italy',
				start_date: '2019-01-01',
				end_date: '2020-08-31',
				description: 'Designed infotainment interface for new supercar models.',
			},
		],
		education: [
			{
				institution: 'Politecnico di Milano',
				degree: 'MS',
				field_of_study: 'Design',
			},
		],
		omni_score: 700,
		score_tier: 'gold',
	},
];

// ─── Seed function ───────────────────────────────────────────────

async function seedCandidates() {
	const client = await pool.connect();
	let created = 0;
	let skipped = 0;

	try {
		console.log(`🌱 Seeding ${CANDIDATES.length} candidate profiles...\n`);

		for (const c of CANDIDATES) {
			// Check if user already exists
			const existing = await client.query('SELECT id FROM users WHERE email = $1', [c.email]);
			if (existing.rows.length > 0) {
				console.log(`  ⏭️  Skipping ${c.name} — already exists`);
				skipped++;
				continue;
			}

			// Create user
			const userResult = await client.query(
				`INSERT INTO users (name, email, password_hash, role, email_verified, created_at, updated_at)
         VALUES ($1, $2, $3, 'candidate', true, NOW(), NOW())
         RETURNING id`,
				[c.name, c.email, '$2b$10$seed.not.real.hash.for.testing.only'],
			);
			const userId = userResult.rows[0].id;

			// Create candidate profile
			await client.query(
				`INSERT INTO candidate_profiles
         (user_id, headline, bio, location, years_experience, availability, remote_preference, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
				[
					userId,
					c.headline,
					c.bio,
					c.location,
					c.years_experience,
					c.availability,
					c.remote_preference,
				],
			);

			// Create skills
			for (const skill of c.skills) {
				await client.query(
					`INSERT INTO candidate_skills (user_id, skill_name, level, is_verified, created_at)
           VALUES ($1, $2, $3, false, NOW())`,
					[userId, skill.name, skill.level],
				);
			}

			// Create work experience
			for (const exp of c.experience) {
				await client.query(
					`INSERT INTO work_experience
           (user_id, company_name, title, location, start_date, end_date, is_current, description, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
					[
						userId,
						exp.company_name,
						exp.title,
						exp.location,
						exp.start_date,
						exp.end_date || null,
						exp.is_current || false,
						exp.description,
					],
				);
			}

			// Create education
			for (const edu of c.education) {
				await client.query(
					`INSERT INTO education (user_id, institution, degree, field_of_study, created_at)
           VALUES ($1, $2, $3, $4, NOW())`,
					[userId, edu.institution, edu.degree, edu.field_of_study],
				);
			}

			// Create omni score
			await client.query(
				`INSERT INTO omni_scores (user_id, total_score, score_tier, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())
         ON CONFLICT (user_id) DO UPDATE SET
           total_score = EXCLUDED.total_score,
           score_tier = EXCLUDED.score_tier,
           updated_at = NOW()`,
				[userId, c.omni_score, c.score_tier],
			);

			// Sync search index
			await client.query(`SELECT sync_candidate_search_index($1)`, [userId]);

			console.log(`  ✅ Created ${c.name} (ID: ${userId}, OmniScore: ${c.omni_score})`);
			created++;
		}

		console.log(`\n📊 Seeding complete: ${created} created, ${skipped} skipped`);
		console.log(`🔍 Test search at: GET /api/candidates/search`);
	} catch (err) {
		console.error('\n❌ Seed failed:', err.message);
		console.error(err.stack);
		process.exit(1);
	} finally {
		client.release();
		await pool.end();
	}
}

seedCandidates();
