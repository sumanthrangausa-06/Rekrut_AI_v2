// =============================================================================
// Migration 287: seed Batch 3 question banks — CSS & HTML, AWS, Docker, Git
// (issue #1693; parent #1658 / #1606)
// =============================================================================
//
// Root cause (#1606, Scout-verified): SKILL_CATALOG (routes/assessments.js)
// lists 16 skills, but the fresh-install bank seeded by migrations 281, 283
// and 284 held only 2 MCQ per difficulty cell 1-5 for the Group B skills
// CSS & HTML, AWS, Docker and Git (migration 283, #1648). STOP 1 on #1658
// approved a Batch 3 top-up for exactly those four skills at the difficulties
// sessions actually adapt through after starting: 19 new MCQ per skill —
// difficulty 2 x6, difficulty 3 x7, difficulty 4 x6 — 76 rows in total, so
// each of those cells gains deep, provider-free supply and an assessment can
// progress without falling through to an AI provider (#1573 honesty fix).
//
// This migration seeds:
//   - CSS & HTML: 19 rows (d2 x6, d3 x7, d4 x6).
//   - AWS: 19 rows (d2 x6, d3 x7, d4 x6).
//   - Docker: 19 rows (d2 x6, d3 x7, d4 x6).
//   - Git: 19 rows (d2 x6, d3 x7, d4 x6).
//   Total candidate rows: 76.
//
// Content rules (these rows are scored truth):
//   - skill_category spells exactly as SKILL_CATALOG: 'CSS & HTML', 'AWS',
//     'Docker', 'Git' (generateQuestion matches LOWER(skill_category)).
//   - correct_answer is character-identical to one of the 4 options —
//     POST /answer scores MCQ by exact string equality. The up()
//     invariant check below throws before any insert on violation.
//   - Every correct_answer was self-reviewed for factual correctness by
//     the author (Nova SME self-review, STOP 1 on #1658); no filler rows.
//     Questions whose correctness would depend on a tool version or an
//     unsettled context were reworded until they did not.
//   - No row duplicates, or re-asks in the same way, a question already
//     seeded for these skills by migrations 281, 283 or 284.
//
// Phase C provenance (design §7 rule 6(d)): this migration runs after
// C0's migrations 279/280, so every row ships explicitly as source='seed',
// review_status='approved', format='mcq' (the §3.4 derivation for
// question_type='multiple_choice'), with topic_id resolved at insert time
// by the §6 join, LOWER(skill_category) = LOWER(legacy_skill_name).
//
// Duplicate guard: each insert is INSERT ... SELECT ... WHERE NOT EXISTS
// on (skill_category, difficulty_level, question_text). Additive only:
// no schema change, no existing row touched. down() deletes exactly the
// rows this migration seeds (skill_category + question_text).
// =============================================================================

const QUESTIONS = [
	// ------------------------------------------------------------ CSS & HTML
	{
		skill: 'CSS & HTML', difficulty: 2, timeLimit: 90,
		text: 'Which HTML element defines the largest heading?',
		options: ['<h1>', '<h6>', '<head>', '<header>'],
		correct: '<h1>',
		explanation: 'Headings run from <h1> (largest, most important) down to <h6> (smallest). <head> holds document metadata and <header> is introductory content, not a heading size.',
	},
	{
		skill: 'CSS & HTML', difficulty: 2, timeLimit: 90,
		text: 'Which HTML attribute provides alternative text for an image, used by screen readers and shown if the image cannot load?',
		options: ['alt', 'title', 'src', 'caption'],
		correct: 'alt',
		explanation: 'The alt attribute supplies the text alternative for an image. src gives the image location, and title gives advisory information, neither of which replaces alt.',
	},
	{
		skill: 'CSS & HTML', difficulty: 2, timeLimit: 90,
		text: 'In CSS, which unit is relative to the font size of the root element?',
		options: ['rem', 'px', 'vh', 'cm'],
		correct: 'rem',
		explanation: 'rem units are multiples of the root element font size. px and cm are absolute units, and vh is relative to the viewport height.',
	},
	{
		skill: 'CSS & HTML', difficulty: 2, timeLimit: 90,
		text: 'A block-level element has a fixed width and both margin-left and margin-right set to auto. What happens?',
		options: [
			'It is centred horizontally within its container',
			'It is pushed to the right edge of its container',
			'It stretches to fill the full width of its container',
			'Its vertical margins are also set to auto',
		],
		correct: 'It is centred horizontally within its container',
		explanation: 'With a fixed width, equal auto left and right margins split the leftover horizontal space evenly between the two sides, which centres the element.',
	},
	{
		skill: 'CSS & HTML', difficulty: 2, timeLimit: 90,
		text: 'Which CSS property controls the amount of space between lines of text?',
		options: ['line-height', 'letter-spacing', 'word-spacing', 'text-indent'],
		correct: 'line-height',
		explanation: 'line-height sets the height of each line box, controlling vertical spacing between lines. letter-spacing and word-spacing control horizontal gaps, and text-indent indents the first line.',
	},
	{
		skill: 'CSS & HTML', difficulty: 2, timeLimit: 90,
		text: 'What does HTML stand for?',
		options: [
			'HyperText Markup Language',
			'HighText Machine Language',
			'Hyperlink Text Mode Language',
			'Home Tool Markup Language',
		],
		correct: 'HyperText Markup Language',
		explanation: 'HTML is the HyperText Markup Language: it marks up content so browsers can structure and present it, with hypertext links between documents.',
	},
	{
		skill: 'CSS & HTML', difficulty: 3, timeLimit: 90,
		text: 'What does the declaration box-sizing: border-box; change about an element size?',
		options: [
			'Padding and border are included in the element stated width and height',
			'Padding and border are added on top of the stated width and height',
			'Margins are included in the element stated width and height',
			'The element width becomes equal to the width of its widest child',
		],
		correct: 'Padding and border are included in the element stated width and height',
		explanation: 'With border-box, the declared width and height cover content, padding and border together, so adding padding no longer grows the box. Margins are never part of the box size.',
	},
	{
		skill: 'CSS & HTML', difficulty: 3, timeLimit: 90,
		text: 'In Flexbox, what does flex-direction: column; do?',
		options: [
			'Makes the main axis vertical, so flex items are laid out from top to bottom',
			'Makes the main axis horizontal, so flex items are laid out from left to right',
			'Reverses the order of the flex items without changing the axis',
			'Stacks the flex items in columns of equal height only',
		],
		correct: 'Makes the main axis vertical, so flex items are laid out from top to bottom',
		explanation: 'flex-direction chooses the main axis: column sets it vertical (top to bottom), while the default row sets it horizontal.',
	},
	{
		skill: 'CSS & HTML', difficulty: 3, timeLimit: 90,
		text: 'Which statement about the class and id attributes in HTML is correct?',
		options: [
			'A class can be applied to many elements, while a given id value should be used only once in a document',
			'An id can be applied to many elements, while a class can be used only once in a document',
			'Class and id values must always be identical on an element',
			'Neither class nor id can be targeted by a CSS selector',
		],
		correct: 'A class can be applied to many elements, while a given id value should be used only once in a document',
		explanation: 'Classes are the reusable hook shared by many elements; an id identifies one unique element in the document. Both can be targeted in CSS.',
	},
	{
		skill: 'CSS & HTML', difficulty: 3, timeLimit: 90,
		text: 'What is the purpose of the HTML <nav> element?',
		options: [
			'To mark up a section that contains major navigation links',
			'To create a single hyperlink to another page',
			'To display a drop-down menu in every browser by default',
			'To hold the metadata of the document head',
		],
		correct: 'To mark up a section that contains major navigation links',
		explanation: '<nav> is the semantic container for a block of primary navigation links. A single link is an <a> element, and <nav> applies no default drop-down behaviour.',
	},
	{
		skill: 'CSS & HTML', difficulty: 3, timeLimit: 90,
		text: 'Which CSS declaration makes an element a flex container?',
		options: ['display: flex', 'position: flex', 'float: flex', 'flex: container'],
		correct: 'display: flex',
		explanation: 'display: flex turns the element into a flex container and its direct children into flex items. The other declarations are not valid CSS for this purpose.',
	},
	{
		skill: 'CSS & HTML', difficulty: 3, timeLimit: 90,
		text: 'What is the purpose of a CSS media query?',
		options: [
			'To apply styles conditionally, based on characteristics such as the viewport width',
			'To load image and video files into a page',
			'To query a database from a stylesheet',
			'To set the playback speed of media elements',
		],
		correct: 'To apply styles conditionally, based on characteristics such as the viewport width',
		explanation: 'A media query tests device or viewport characteristics and applies its rules only when the test passes, which is the basis of responsive design.',
	},
	{
		skill: 'CSS & HTML', difficulty: 3, timeLimit: 90,
		text: 'Which of these HTML elements is an inline element by default?',
		options: ['<span>', '<div>', '<p>', '<section>'],
		correct: '<span>',
		explanation: '<span> is an inline container that takes only the width of its content. <div>, <p> and <section> are block-level by default and start on a new line.',
	},
	{
		skill: 'CSS & HTML', difficulty: 4, timeLimit: 120,
		text: 'Which selector has the higher specificity: div.header or .header?',
		options: [
			'div.header, because it combines a type selector with a class selector',
			'.header, because a class selector alone always beats any combination',
			'They have exactly equal specificity',
			'Neither has any specificity, because both use a class',
		],
		correct: 'div.header, because it combines a type selector with a class selector',
		explanation: 'Specificity adds up across a compound selector: div.header counts one class and one type, while .header counts one class only, so div.header wins.',
	},
	{
		skill: 'CSS & HTML', difficulty: 4, timeLimit: 120,
		text: 'How does an element with position: absolute behave?',
		options: [
			'It is removed from the normal document flow and positioned relative to its nearest positioned ancestor',
			'It stays in the normal flow and is offset relative to its own static position',
			'It is positioned relative to the viewport and never scrolls',
			'It scrolls until it reaches an offset and then sticks within its container',
		],
		correct: 'It is removed from the normal document flow and positioned relative to its nearest positioned ancestor',
		explanation: 'Absolute positioning takes the element out of flow (neighbours act as if it were not there) and offsets it from its nearest ancestor that has a position other than static. Staying in flow with an offset describes relative positioning.',
	},
	{
		skill: 'CSS & HTML', difficulty: 4, timeLimit: 120,
		text: 'A custom property is defined as --brand. Which declaration correctly uses its value as a text color?',
		options: ['color: var(--brand);', 'color: $brand;', 'color: --brand;', 'color: var(brand);'],
		correct: 'color: var(--brand);',
		explanation: 'CSS custom properties are read with the var() function and the full dashed name: var(--brand). The other forms are not valid references to a custom property.',
	},
	{
		skill: 'CSS & HTML', difficulty: 4, timeLimit: 120,
		text: 'Which statement best describes the main difference between CSS Grid and Flexbox?',
		options: [
			'Grid is designed primarily for two-dimensional layouts (rows and columns together), while Flexbox is designed primarily for one-dimensional layouts (a single row or column)',
			'Grid is designed primarily for one-dimensional layouts, while Flexbox is designed primarily for two-dimensional layouts',
			'Grid can only lay out text, while Flexbox can only lay out images',
			'There is no difference; the two are interchangeable names for the same layout system',
		],
		correct: 'Grid is designed primarily for two-dimensional layouts (rows and columns together), while Flexbox is designed primarily for one-dimensional layouts (a single row or column)',
		explanation: 'Grid controls rows and columns at the same time; Flexbox distributes items along one axis at a time. In practice the two are often combined.',
	},
	{
		skill: 'CSS & HTML', difficulty: 4, timeLimit: 120,
		text: 'What does the selector li:nth-child(2n) select?',
		options: [
			'Every even-numbered li child element: the 2nd, 4th, 6th, and so on',
			'Every odd-numbered li child element: the 1st, 3rd, 5th, and so on',
			'Only the second li child element',
			'Every li element that contains exactly two children',
		],
		correct: 'Every even-numbered li child element: the 2nd, 4th, 6th, and so on',
		explanation: 'The 2n formula steps through child positions in increments of two starting at 2, matching all even positions. Matching only the second child would be :nth-child(2).',
	},
	{
		skill: 'CSS & HTML', difficulty: 4, timeLimit: 120,
		text: 'What does the declaration clear: both; do on an element?',
		options: [
			'It moves the element below any preceding floated elements on both sides, so it does not sit beside a float',
			'It removes all floats inside the element',
			'It makes the element itself float to both sides at once',
			'It clears the background and border of the element',
		],
		correct: 'It moves the element below any preceding floated elements on both sides, so it does not sit beside a float',
		explanation: 'clear: both requires the element top border edge to sit below the bottom of any earlier left or right float. It affects placement relative to floats; it does not delete floats or styling.',
	},
	// ------------------------------------------------------------------- AWS
	{
		skill: 'AWS', difficulty: 2, timeLimit: 90,
		text: 'Which AWS service is a managed Domain Name System (DNS) service?',
		options: ['Amazon Route 53', 'Amazon CloudFront', 'AWS Direct Connect', 'Amazon API Gateway'],
		correct: 'Amazon Route 53',
		explanation: 'Route 53 is the AWS DNS service: it translates domain names to IP addresses and can route traffic using several routing policies. The other services deliver content, private connectivity, and APIs.',
	},
	{
		skill: 'AWS', difficulty: 2, timeLimit: 90,
		text: 'What is an Amazon VPC?',
		options: [
			'A logically isolated virtual network in the AWS Cloud where you define subnets, routing and network access rules',
			'A single virtual server that hosts a private website',
			'A physical data centre reserved for one customer',
			'A backup copy of an account stored in another Region',
		],
		correct: 'A logically isolated virtual network in the AWS Cloud where you define subnets, routing and network access rules',
		explanation: 'A Virtual Private Cloud is your own isolated network segment in AWS, with your chosen IP ranges, subnets, route tables and gateways.',
	},
	{
		skill: 'AWS', difficulty: 2, timeLimit: 90,
		text: 'What type of database is Amazon DynamoDB?',
		options: [
			'A managed NoSQL key-value and document database',
			'A managed relational database with SQL tables and joins',
			'A managed in-memory cache only',
			'A managed data warehouse for SQL analytics',
		],
		correct: 'A managed NoSQL key-value and document database',
		explanation: 'DynamoDB stores items addressed by keys and does not offer relational joins. Relational databases are RDS/Aurora, caching is ElastiCache, and warehousing is Redshift.',
	},
	{
		skill: 'AWS', difficulty: 2, timeLimit: 90,
		text: 'What is Amazon CloudWatch primarily used for?',
		options: [
			'Collecting metrics and logs from AWS resources and applications, with alarms on thresholds',
			'Recording every API call made in an AWS account for auditing',
			'Provisioning infrastructure from templates',
			'Managing user sign-in and identity federation',
		],
		correct: 'Collecting metrics and logs from AWS resources and applications, with alarms on thresholds',
		explanation: 'CloudWatch is the observability service: metrics, log collection and threshold alarms. Recording API activity is CloudTrail, and provisioning from templates is CloudFormation.',
	},
	{
		skill: 'AWS', difficulty: 2, timeLimit: 90,
		text: 'In AWS, what is an Availability Zone?',
		options: [
			'One or more discrete data centres with redundant power and networking within an AWS Region',
			'A geographic area that contains several AWS Regions',
			'A copy of a bucket stored in a second account',
			'An edge location used to cache content for viewers',
		],
		correct: 'One or more discrete data centres with redundant power and networking within an AWS Region',
		explanation: 'A Region is a geographic area made up of multiple Availability Zones, each physically separated so a failure in one does not take down the others. Edge locations belong to the CDN network.',
	},
	{
		skill: 'AWS', difficulty: 2, timeLimit: 90,
		text: 'What is an Amazon Machine Image (AMI)?',
		options: [
			'A template containing the software configuration (such as an operating system and applications) used to launch an EC2 instance',
			'A snapshot of a running instance memory, taken for debugging',
			'A network diagram of a VPC generated by AWS',
			'A billing report image exported from the console',
		],
		correct: 'A template containing the software configuration (such as an operating system and applications) used to launch an EC2 instance',
		explanation: 'An AMI is the launch template for an instance: it bundles the root volume contents (OS and any preinstalled software) that a new EC2 instance starts from.',
	},
	{
		skill: 'AWS', difficulty: 3, timeLimit: 90,
		text: 'What does an Amazon S3 presigned URL do?',
		options: [
			'Grants time-limited access to a private S3 object to whoever holds the URL, without making the object public',
			'Makes an S3 object permanently public to everyone',
			'Renames an S3 object without copying it',
			'Encrypts an S3 object with a customer-managed key',
		],
		correct: 'Grants time-limited access to a private S3 object to whoever holds the URL, without making the object public',
		explanation: 'A presigned URL carries a signature and an expiry: it delegates the signer permissions for one object and one action until it expires, while the object itself stays private.',
	},
	{
		skill: 'AWS', difficulty: 3, timeLimit: 90,
		text: 'An application running on EC2 needs to read from an S3 bucket. What is the recommended way to give it access?',
		options: [
			'Attach an IAM role with the needed permissions to the instance, so it receives temporary credentials automatically',
			'Embed a long-term IAM user access key in the application source code',
			'Store the account root password in an environment variable on the instance',
			'Make the bucket public so no credentials are needed',
		],
		correct: 'Attach an IAM role with the needed permissions to the instance, so it receives temporary credentials automatically',
		explanation: 'An instance profile role hands the application short-lived, automatically rotated credentials. Embedding long-term keys or root credentials in code, or making data public, are the anti-patterns this replaces.',
	},
	{
		skill: 'AWS', difficulty: 3, timeLimit: 90,
		text: 'What does an Amazon EC2 Auto Scaling group do?',
		options: [
			'Automatically adjusts the number of running EC2 instances in the group, launching or terminating instances to match desired capacity and demand',
			'Automatically makes each individual EC2 instance more powerful over time',
			'Automatically moves instances between Regions when prices change',
			'Automatically patches the operating system of every instance',
		],
		correct: 'Automatically adjusts the number of running EC2 instances in the group, launching or terminating instances to match desired capacity and demand',
		explanation: 'Auto Scaling manages the count of instances (horizontal scaling) within minimum and maximum bounds, replacing unhealthy instances and responding to scaling policies. It does not resize individual instances.',
	},
	{
		skill: 'AWS', difficulty: 3, timeLimit: 90,
		text: 'What is the main purpose of an Amazon RDS read replica?',
		options: [
			'To serve read queries from a copy of the database, reducing read load on the primary database',
			'To act as a synchronous standby that automatically takes over writes when the primary fails',
			'To encrypt the primary database at rest',
			'To replace database backups with a nightly export',
		],
		correct: 'To serve read queries from a copy of the database, reducing read load on the primary database',
		explanation: 'Read replicas are asynchronously replicated, read-only copies used to scale out reads. Automatic failover to a standby is the separate Multi-AZ deployment feature.',
	},
	{
		skill: 'AWS', difficulty: 3, timeLimit: 90,
		text: 'What does AWS CloudTrail record?',
		options: [
			'API calls made in an AWS account, including who made the call, when, and from where, for auditing and governance',
			'The CPU and memory metrics of EC2 instances',
			'The contents of every object stored in S3',
			'The network packets passing through a VPC',
		],
		correct: 'API calls made in an AWS account, including who made the call, when, and from where, for auditing and governance',
		explanation: 'CloudTrail is the audit log of account activity: management events record the caller identity, time, source IP and request details. Resource metrics are CloudWatch.',
	},
	{
		skill: 'AWS', difficulty: 3, timeLimit: 90,
		text: 'What is Amazon SNS used for?',
		options: [
			'Publish/subscribe messaging: publishers send a message to a topic and it is delivered to all subscribed endpoints',
			'A queue that stores messages until a single consumer polls and deletes each one',
			'A relational database that notifies applications of row changes',
			'A service that sends physical mail to customers',
		],
		correct: 'Publish/subscribe messaging: publishers send a message to a topic and it is delivered to all subscribed endpoints',
		explanation: 'Simple Notification Service fans one published message out to every subscriber of a topic. A store-and-poll queue for one consumer at a time describes SQS instead.',
	},
	{
		skill: 'AWS', difficulty: 3, timeLimit: 90,
		text: 'How does an Elastic Load Balancer use health checks?',
		options: [
			'It periodically checks its registered targets and routes new traffic only to targets that are currently healthy',
			'It restarts any target that fails a check by reinstalling its operating system',
			'It checks the health of the AWS account billing status before routing traffic',
			'It scans targets for malware once a day and deletes infected files',
		],
		correct: 'It periodically checks its registered targets and routes new traffic only to targets that are currently healthy',
		explanation: 'Health checks mark targets in or out of rotation: an unhealthy target receives no new traffic until it passes again. The load balancer does not repair or patch the target.',
	},
	{
		skill: 'AWS', difficulty: 4, timeLimit: 120,
		text: 'In IAM, what does the principle of least privilege require?',
		options: [
			'Granting only the permissions a user or service needs to perform its task, and no more',
			'Granting administrator access first and removing permissions later if there is a problem',
			'Giving every user the same set of permissions for consistency',
			'Granting permissions only to the account root user',
		],
		correct: 'Granting only the permissions a user or service needs to perform its task, and no more',
		explanation: 'Least privilege limits the blast radius of a mistake or a compromised credential: each identity can do its job and nothing beyond it.',
	},
	{
		skill: 'AWS', difficulty: 4, timeLimit: 120,
		text: 'What happens when S3 Versioning is enabled on a bucket and an object is overwritten?',
		options: [
			'The previous version is kept as a noncurrent version and can be retrieved or restored, while the new write becomes the current version',
			'The previous version is permanently erased at the moment of the overwrite',
			'The overwrite is refused until the old object is deleted manually',
			'Both versions are merged into a single object automatically',
		],
		correct: 'The previous version is kept as a noncurrent version and can be retrieved or restored, while the new write becomes the current version',
		explanation: 'Versioning preserves every version of an object under its own version ID, so an accidental overwrite or delete can be undone by restoring an earlier version.',
	},
	{
		skill: 'AWS', difficulty: 4, timeLimit: 120,
		text: 'An IAM identity has one policy that allows an action and another policy that explicitly denies the same action. What is the final result?',
		options: [
			'The action is denied: an explicit Deny overrides any Allow',
			'The action is allowed: an Allow always overrides a Deny',
			'The two policies cancel out and the account root user decides',
			'The result depends on which policy was created first',
		],
		correct: 'The action is denied: an explicit Deny overrides any Allow',
		explanation: 'IAM policy evaluation gives explicit denies the final word: if any applicable policy explicitly denies the action, it is denied regardless of allows elsewhere.',
	},
	{
		skill: 'AWS', difficulty: 4, timeLimit: 120,
		text: 'What does AWS Key Management Service (KMS) provide?',
		options: [
			'A managed service to create and control cryptographic keys used to encrypt data across AWS services and applications',
			'A password manager for end users of a web application',
			'A service that manages SSH logins to EC2 instances',
			'A hardware firewall for VPC traffic',
		],
		correct: 'A managed service to create and control cryptographic keys used to encrypt data across AWS services and applications',
		explanation: 'KMS centralises key creation, rotation policy, usage permissions and audit logging for encryption keys. It is not an end-user password manager or a login service.',
	},
	{
		skill: 'AWS', difficulty: 4, timeLimit: 120,
		text: 'In Amazon DynamoDB, what does a strongly consistent read guarantee?',
		options: [
			'The response reflects all successful writes that completed before the read began, returning the most up-to-date data',
			'The response is always faster than any other kind of read',
			'The response may return stale data, but it costs less',
			'The read is served from a backup taken the previous night',
		],
		correct: 'The response reflects all successful writes that completed before the read began, returning the most up-to-date data',
		explanation: 'Strong consistency means the read sees every write acknowledged before it started. The possibly-stale-but-cheaper description belongs to an eventually consistent read.',
	},
	{
		skill: 'AWS', difficulty: 4, timeLimit: 120,
		text: 'Which statement about VPC peering connections is correct?',
		options: [
			'Peering is non-transitive: a VPC cannot route traffic through a peered VPC to reach that peer\'s own peered VPCs or other destinations',
			'Peering is transitive: routing through one peer automatically reaches all of its other peers',
			'A peering connection merges two VPCs into a single network with one route table',
			'A peering connection can be created between any two VPCs even if their CIDR ranges overlap',
		],
		correct: 'Peering is non-transitive: a VPC cannot route traffic through a peered VPC to reach that peer\'s own peered VPCs or other destinations',
		explanation: 'Each peering connection joins exactly two VPCs, and routes cannot use a peer as a transit hop to a third network. Overlapping CIDR ranges also prevent peering, because routing would be ambiguous.',
	},
	// ---------------------------------------------------------------- Docker
	{
		skill: 'Docker', difficulty: 2, timeLimit: 90,
		text: 'Which command lists the Docker images stored on the local host?',
		options: ['docker images', 'docker ps', 'docker containers', 'docker ls files'],
		correct: 'docker images',
		explanation: 'docker images lists local images with their repository, tag and size. docker ps lists containers, not images.',
	},
	{
		skill: 'Docker', difficulty: 2, timeLimit: 90,
		text: 'In the command docker build -t myapp:1.0 ., what does the -t flag do?',
		options: [
			'It names and tags the image being built (here, myapp with tag 1.0)',
			'It sets a time limit for the build in minutes',
			'It runs the build in a temporary container that is deleted afterwards',
			'It encrypts the image with a transfer key',
		],
		correct: 'It names and tags the image being built (here, myapp with tag 1.0)',
		explanation: 'The -t (tag) option assigns the built image a name and tag so it can be referenced by docker run and docker push.',
	},
	{
		skill: 'Docker', difficulty: 2, timeLimit: 90,
		text: 'What does the RUN instruction in a Dockerfile do?',
		options: [
			'Executes a command during the image build, and the resulting filesystem changes are saved in a new image layer',
			'Starts the application every time a container from the image starts',
			'Runs a command on the Docker host, outside the image build',
			'Reserves a port for the container at runtime',
		],
		correct: 'Executes a command during the image build, and the resulting filesystem changes are saved in a new image layer',
		explanation: 'RUN happens once, at build time, and its result is baked into the image. The command that runs when a container starts is CMD or ENTRYPOINT.',
	},
	{
		skill: 'Docker', difficulty: 2, timeLimit: 90,
		text: 'What is the purpose of a .dockerignore file?',
		options: [
			'It lists files and directories to exclude from the build context sent to the Docker daemon',
			'It lists containers that Docker should never stop',
			'It tells version control which image layers to ignore',
			'It hides environment variables from running containers',
		],
		correct: 'It lists files and directories to exclude from the build context sent to the Docker daemon',
		explanation: 'Excluding unneeded files (such as dependency folders or local artifacts) keeps the build context small and prevents unrelated local files from triggering rebuilds or leaking into images via COPY.',
	},
	{
		skill: 'Docker', difficulty: 2, timeLimit: 90,
		text: 'What does the WORKDIR instruction in a Dockerfile do?',
		options: [
			'Sets the working directory for subsequent Dockerfile instructions and for the container process when it starts',
			'Creates a shared folder on the Docker host',
			'Copies the project files into the image',
			'Changes the directory of the shell that runs docker build',
		],
		correct: 'Sets the working directory for subsequent Dockerfile instructions and for the container process when it starts',
		explanation: 'WORKDIR sets (creating if needed) the directory that later RUN, COPY and CMD instructions are relative to. It does not copy files by itself.',
	},
	{
		skill: 'Docker', difficulty: 2, timeLimit: 90,
		text: 'What is the main difference between docker stop and docker kill?',
		options: [
			'docker stop sends a termination signal that gives the main process a chance to shut down gracefully, while docker kill forces immediate termination',
			'docker stop deletes the container, while docker kill only pauses it',
			'docker stop works only on images, while docker kill works only on containers',
			'There is no difference; both commands send exactly the same signal',
		],
		correct: 'docker stop sends a termination signal that gives the main process a chance to shut down gracefully, while docker kill forces immediate termination',
		explanation: 'docker stop sends SIGTERM and waits for a grace period before forcing a stop, so the process can clean up. docker kill by default sends SIGKILL, which the process cannot catch or handle.',
	},
	{
		skill: 'Docker', difficulty: 3, timeLimit: 90,
		text: 'What is the main difference between a Docker volume and a bind mount?',
		options: [
			'A volume is stored and managed by Docker in its own area of the host filesystem, while a bind mount maps an arbitrary host file or directory into the container',
			'A volume can only be used by one container ever, while a bind mount is shared by all containers',
			'A bind mount is stored inside the image, while a volume is stored in the container writable layer',
			'There is no difference; the two terms are interchangeable',
		],
		correct: 'A volume is stored and managed by Docker in its own area of the host filesystem, while a bind mount maps an arbitrary host file or directory into the container',
		explanation: 'Volumes live under Docker control and are the portable, preferred way to persist data; bind mounts depend on the host directory layout because they point at a specific host path.',
	},
	{
		skill: 'Docker', difficulty: 3, timeLimit: 90,
		text: 'What is the difference between the Dockerfile instructions ARG and ENV?',
		options: [
			'ARG defines a variable available only during the image build, while ENV sets an environment variable that also exists in containers run from the image',
			'ARG sets a variable in running containers, while ENV exists only during the build',
			'ARG and ENV are two spellings of exactly the same behaviour',
			'ARG can only hold numbers, while ENV can only hold text',
		],
		correct: 'ARG defines a variable available only during the image build, while ENV sets an environment variable that also exists in containers run from the image',
		explanation: 'Build arguments are consumed by the build (for example to choose a base version) and are not persisted in the image environment; ENV values are recorded in the image config and passed to container processes.',
	},
	{
		skill: 'Docker', difficulty: 3, timeLimit: 90,
		text: 'Which command runs a command inside a container that is already running?',
		options: ['docker exec', 'docker run', 'docker start', 'docker attach logs'],
		correct: 'docker exec',
		explanation: 'docker exec starts an additional process in a running container, for example a shell for inspection. docker run creates a new container, and docker start restarts a stopped one.',
	},
	{
		skill: 'Docker', difficulty: 3, timeLimit: 90,
		text: 'During a Docker build, a file copied by an early COPY instruction changes. What happens to the build cache?',
		options: [
			'The layer for that COPY and every later layer are rebuilt, because each layer depends on the ones before it',
			'Only the final layer is rebuilt; earlier layers never affect the cache',
			'The build cache is disabled permanently for that image',
			'Nothing: file contents are never part of the cache decision',
		],
		correct: 'The layer for that COPY and every later layer are rebuilt, because each layer depends on the ones before it',
		explanation: 'Layer caching is sequential: a changed input invalidates its own layer and all layers built on top of it. This is why dependency manifests are usually copied before the full source tree.',
	},
	{
		skill: 'Docker', difficulty: 3, timeLimit: 90,
		text: 'What does the restart policy --restart unless-stopped do for a container?',
		options: [
			'It restarts the container if it exits, except when the container was explicitly stopped by a user',
			'It restarts the container only while a user is logged in to the host',
			'It prevents the container from ever being stopped',
			'It restarts the Docker daemon whenever the container uses too much memory',
		],
		correct: 'It restarts the container if it exits, except when the container was explicitly stopped by a user',
		explanation: 'unless-stopped keeps a service coming back after crashes and host reboots, but respects a deliberate manual stop — unlike the always policy, which restarts even manually stopped containers on daemon startup.',
	},
	{
		skill: 'Docker', difficulty: 3, timeLimit: 90,
		text: 'What does the command docker logs <container> show?',
		options: [
			'The standard output and standard error written by the main process of that container',
			'The Dockerfile used to build the container image',
			'A list of every command ever typed inside the container',
			'The host kernel log entries for the whole machine',
		],
		correct: 'The standard output and standard error written by the main process of that container',
		explanation: 'Docker captures what the container main process (PID 1) writes to stdout and stderr and serves it through docker logs. Interactive shell history inside the container is not captured there.',
	},
	{
		skill: 'Docker', difficulty: 3, timeLimit: 90,
		text: 'Data is written to a named Docker volume attached to a container, and the container is then removed. What happens to the data in the volume?',
		options: [
			'It persists in the volume and can be attached to another container',
			'It is deleted automatically together with the container',
			'It is copied into the image the container was started from',
			'It becomes read-only and can never be attached again',
		],
		correct: 'It persists in the volume and can be attached to another container',
		explanation: 'A named volume has a lifecycle independent of any one container: removing the container leaves the volume and its data intact until the volume itself is removed.',
	},
	{
		skill: 'Docker', difficulty: 4, timeLimit: 120,
		text: 'Why does setting a non-root user with the USER instruction in a Dockerfile improve security?',
		options: [
			'The container processes then run with limited privileges, so compromising the application gives an attacker less power than running as root',
			'It encrypts the container filesystem at rest',
			'It prevents the container from using any network ports',
			'It makes the image impossible to copy to another host',
		],
		correct: 'The container processes then run with limited privileges, so compromising the application gives an attacker less power than running as root',
		explanation: 'By default container processes run as root inside the container. Running as an unprivileged user applies least privilege inside the container boundary, limiting what a compromised process can do.',
	},
	{
		skill: 'Docker', difficulty: 4, timeLimit: 120,
		text: 'What is a key advantage of a user-defined bridge network over the default bridge network?',
		options: [
			'Containers on a user-defined bridge can reach each other by container name, because Docker provides automatic DNS name resolution on that network',
			'Containers on a user-defined bridge do not need IP addresses',
			'The default bridge network cannot carry any traffic between containers',
			'A user-defined bridge automatically publishes every container port on the host',
		],
		correct: 'Containers on a user-defined bridge can reach each other by container name, because Docker provides automatic DNS name resolution on that network',
		explanation: 'User-defined bridges include an embedded DNS server that resolves container names on that network. On the default bridge, containers communicate by IP address instead.',
	},
	{
		skill: 'Docker', difficulty: 4, timeLimit: 120,
		text: 'What does the HEALTHCHECK instruction in a Dockerfile define?',
		options: [
			'A test command Docker runs periodically inside the container to determine whether the container is healthy, reflected in the container health status',
			'A command that repairs the application automatically when it crashes',
			'A check of the host hardware that runs before the image is built',
			'A scan of the image for known vulnerabilities',
		],
		correct: 'A test command Docker runs periodically inside the container to determine whether the container is healthy, reflected in the container health status',
		explanation: 'HEALTHCHECK only reports status (starting, healthy, unhealthy) based on the test command exit code. Acting on that status is up to the operator or orchestrator; the check itself repairs nothing.',
	},
	{
		skill: 'Docker', difficulty: 4, timeLimit: 120,
		text: 'What is the practical difference between the exec form CMD ["node", "server.js"] and the shell form CMD node server.js?',
		options: [
			'In exec form the application runs directly as the main process (PID 1) and receives operating system signals itself; in shell form a shell runs as PID 1 and launches the application as its child',
			'In exec form the application cannot receive any network traffic',
			'In shell form the application runs as PID 1 and receives signals directly',
			'There is no difference in how the process is started',
		],
		correct: 'In exec form the application runs directly as the main process (PID 1) and receives operating system signals itself; in shell form a shell runs as PID 1 and launches the application as its child',
		explanation: 'Exec form avoids the intermediate shell, so stop signals reach the application directly and it can shut down cleanly. With shell form the shell is PID 1, which commonly breaks graceful signal handling.',
	},
	{
		skill: 'Docker', difficulty: 4, timeLimit: 120,
		text: 'What does the flag docker run --memory=512m do?',
		options: [
			'It limits the maximum amount of memory the container is allowed to use to 512 megabytes',
			'It guarantees the container a minimum of 512 megabytes of free host disk space',
			'It copies 512 megabytes of the image into RAM before starting',
			'It sets the size of every volume attached to the container',
		],
		correct: 'It limits the maximum amount of memory the container is allowed to use to 512 megabytes',
		explanation: 'The --memory flag is a hard resource ceiling enforced by the kernel control group for that container. It concerns RAM, not disk space or volume size.',
	},
	{
		skill: 'Docker', difficulty: 4, timeLimit: 120,
		text: 'What is the difference between docker save and docker export?',
		options: [
			'docker save exports an image, preserving its layers and history; docker export exports the filesystem of a container as a single tar archive, without its history',
			'docker save exports a container filesystem, while docker export exports an image with all its layers',
			'docker save uploads an image to a registry, while docker export downloads one',
			'There is no difference; both produce identical archives',
		],
		correct: 'docker save exports an image, preserving its layers and history; docker export exports the filesystem of a container as a single tar archive, without its history',
		explanation: 'save/load move images (with layer structure and metadata) between hosts without a registry; export/import move a container flattened filesystem, losing image history and layer separation.',
	},
	// ------------------------------------------------------------------- Git
	{
		skill: 'Git', difficulty: 2, timeLimit: 90,
		text: 'What does the command git clone <url> do?',
		options: [
			'Creates a local copy of a remote repository, including its history, and sets up a connection to that remote',
			'Copies only the latest version of every file, with no history',
			'Creates a new empty repository on the remote server',
			'Uploads the current local repository to the given URL',
		],
		correct: 'Creates a local copy of a remote repository, including its history, and sets up a connection to that remote',
		explanation: 'Cloning downloads the full repository history and configures the source as the remote named origin, so later fetch and push operations know where to go.',
	},
	{
		skill: 'Git', difficulty: 2, timeLimit: 90,
		text: 'What is the purpose of a .gitignore file?',
		options: [
			'It lists patterns for files and directories that Git should not track, such as build output and local configuration',
			'It lists files that are deleted from the repository history',
			'It stores the passwords Git needs for remote access',
			'It prevents other people from cloning the repository',
		],
		correct: 'It lists patterns for files and directories that Git should not track, such as build output and local configuration',
		explanation: '.gitignore patterns keep generated or local-only files out of version control. It does not remove files that are already tracked, and it holds no credentials.',
	},
	{
		skill: 'Git', difficulty: 2, timeLimit: 90,
		text: 'With no arguments, what does the command git diff show?',
		options: [
			'Changes in the working tree that have not yet been staged, compared with the staging area',
			'Changes that are staged and ready to be committed',
			'The differences between the last two commits in history',
			'The differences between the local and remote branches',
		],
		correct: 'Changes in the working tree that have not yet been staged, compared with the staging area',
		explanation: 'Plain git diff is the unstaged view: edits you have made since the last git add. Staged changes are shown by git diff --staged.',
	},
	{
		skill: 'Git', difficulty: 2, timeLimit: 90,
		text: 'What does the option in git log --oneline do?',
		options: [
			'Shows each commit in a compact form, with its short hash and subject on a single line',
			'Shows only commits made by one author',
			'Shows the full diff of every commit on one page',
			'Deletes commits that do not fit on one line',
		],
		correct: 'Shows each commit in a compact form, with its short hash and subject on a single line',
		explanation: '--oneline condenses the history to one line per commit, which makes long histories easy to scan. It changes only the display, not the history.',
	},
	{
		skill: 'Git', difficulty: 2, timeLimit: 90,
		text: 'Which command creates a new branch called feature and switches to it in one step?',
		options: ['git switch -c feature', 'git branch feature', 'git checkout feature', 'git merge feature'],
		correct: 'git switch -c feature',
		explanation: 'git switch -c creates the branch and moves to it. git branch feature creates the branch but stays on the current one, and git checkout feature only works if the branch already exists.',
	},
	{
		skill: 'Git', difficulty: 2, timeLimit: 90,
		text: 'What happens when you run git commit?',
		options: [
			'The currently staged changes are recorded as a new commit in the local repository',
			'The changes are uploaded to the remote repository immediately',
			'All modified files in the working tree are automatically staged and committed',
			'A new branch is created for the changes',
		],
		correct: 'The currently staged changes are recorded as a new commit in the local repository',
		explanation: 'A commit snapshots exactly what is in the staging area into local history. Nothing leaves the machine until git push, and unstaged edits are not included.',
	},
	{
		skill: 'Git', difficulty: 3, timeLimit: 90,
		text: 'In Git, what does it mean to be in a detached HEAD state?',
		options: [
			'HEAD points directly at a specific commit rather than at a branch, so new commits are not on any branch until one is created there',
			'The repository has been disconnected from its remote',
			'The working tree has been deleted and only history remains',
			'HEAD is a special branch that can never receive commits',
		],
		correct: 'HEAD points directly at a specific commit rather than at a branch, so new commits are not on any branch until one is created there',
		explanation: 'Checking out a commit hash (or a tag) detaches HEAD: you can inspect and even commit, but without creating a branch at that point the new commits have no branch keeping them reachable.',
	},
	{
		skill: 'Git', difficulty: 3, timeLimit: 90,
		text: 'What does git revert <commit> do?',
		options: [
			'Creates a new commit that undoes the changes of the named commit, leaving the existing history intact',
			'Erases the named commit and every commit after it from history',
			'Moves the branch pointer back to before the named commit',
			'Checks out the files exactly as they were in the named commit',
		],
		correct: 'Creates a new commit that undoes the changes of the named commit, leaving the existing history intact',
		explanation: 'Revert is the history-preserving undo: because it adds a new commit instead of rewriting old ones, it is the safe way to undo a change that has already been shared.',
	},
	{
		skill: 'Git', difficulty: 3, timeLimit: 90,
		text: 'What is the main difference between a Git tag and a Git branch?',
		options: [
			'A tag is a fixed pointer to a commit that does not move as new commits are made, while a branch pointer moves forward with each new commit on it',
			'A tag moves forward with each new commit, while a branch never moves',
			'A tag can only point at the first commit of a repository',
			'A branch is stored on the remote, while a tag is stored only locally',
		],
		correct: 'A tag is a fixed pointer to a commit that does not move as new commits are made, while a branch pointer moves forward with each new commit on it',
		explanation: 'Tags mark a moment in history, typically a release, and stay put. Branches are working pointers that advance automatically when you commit while on them.',
	},
	{
		skill: 'Git', difficulty: 3, timeLimit: 90,
		text: 'What does running git push -u origin feature accomplish beyond a plain push?',
		options: [
			'It sets origin/feature as the upstream tracking branch for the local feature branch, so later git push and git pull need no branch arguments',
			'It forces the remote branch to match the local branch, discarding remote commits',
			'It makes the feature branch the default branch of the remote repository',
			'It uploads all local branches at once, not just feature',
		],
		correct: 'It sets origin/feature as the upstream tracking branch for the local feature branch, so later git push and git pull need no branch arguments',
		explanation: 'The -u (--set-upstream) flag records the tracking relationship while pushing. It does not force anything; overwriting remote history would require a force option.',
	},
	{
		skill: 'Git', difficulty: 3, timeLimit: 90,
		text: 'What does the command git blame <file> show?',
		options: [
			'For each line of the file, the most recent commit and author that modified that line',
			'A list of every error ever reported in the file',
			'The users who are responsible for reviewing the file',
			'The commits in which the file was deleted and recreated',
		],
		correct: 'For each line of the file, the most recent commit and author that modified that line',
		explanation: 'git blame annotates a file line by line with the commit that last touched each line, which is used to trace when and why a line changed.',
	},
	{
		skill: 'Git', difficulty: 3, timeLimit: 90,
		text: 'When does a merge conflict occur in Git?',
		options: [
			'When two branches change the same part of the same file in different ways, so Git cannot decide automatically which version to keep',
			'Whenever two people clone the same repository',
			'When a branch name is used twice in the same repository',
			'When a commit is made with an empty message',
		],
		correct: 'When two branches change the same part of the same file in different ways, so Git cannot decide automatically which version to keep',
		explanation: 'Git merges automatically when changes touch different areas, but overlapping edits to the same lines need a human decision, which Git marks as a conflict in the affected files.',
	},
	{
		skill: 'Git', difficulty: 3, timeLimit: 90,
		text: 'In a cloned repository, what does the name origin refer to?',
		options: [
			'The default name Git gives to the remote repository the local repository was cloned from',
			'The first commit ever made in the repository',
			'The main branch of the local repository',
			'The user account that owns the repository on the server',
		],
		correct: 'The default name Git gives to the remote repository the local repository was cloned from',
		explanation: 'origin is the conventional shorthand name for the clone source remote; commands like git fetch origin use it to mean that remote URL. It is a name for a remote, not a branch or a commit.',
	},
	{
		skill: 'Git', difficulty: 4, timeLimit: 120,
		text: 'What is the main difference between merging a branch and rebasing a branch onto it?',
		options: [
			'Rebasing replays the branch commits on top of the target, creating new commits and a linear history; merging joins the two histories (creating a merge commit when the branches have diverged) and keeps the original commits unchanged',
			'Merging replays the branch commits with new hashes, while rebasing keeps the original commits unchanged',
			'Rebasing can only be done by the repository owner, while merging is open to everyone',
			'There is no difference in the resulting history; only the command names differ',
		],
		correct: 'Rebasing replays the branch commits on top of the target, creating new commits and a linear history; merging joins the two histories (creating a merge commit when the branches have diverged) and keeps the original commits unchanged',
		explanation: 'Because rebase rewrites the replayed commits (new parents, new hashes), it produces a straight-line history; merge keeps the original commits unchanged and, when the branches have diverged, records their junction as a merge commit (a fast-forward merge simply moves the pointer and creates none).',
	},
	{
		skill: 'Git', difficulty: 4, timeLimit: 120,
		text: 'What is git bisect used for?',
		options: [
			'To find the commit that introduced a bug by repeatedly testing the midpoint commit of the remaining range, narrowing the search by half each step',
			'To split one repository into two repositories at a chosen commit',
			'To divide a large file into two smaller files',
			'To compare two branches side by side in an editor',
		],
		correct: 'To find the commit that introduced a bug by repeatedly testing the midpoint commit of the remaining range, narrowing the search by half each step',
		explanation: 'Bisect is a binary search over history: mark a known good and a known bad commit, test the middle one, and each answer halves the suspects until the introducing commit is found.',
	},
	{
		skill: 'Git', difficulty: 4, timeLimit: 120,
		text: 'What is a fast-forward merge?',
		options: [
			'When the target branch has not diverged from the branch being merged, Git simply moves the target branch pointer forward to the newest commit, creating no merge commit',
			'A merge that skips running any tests in order to finish faster',
			'A merge in which Git discards the older of two conflicting versions automatically',
			'A merge that can only happen on the remote server',
		],
		correct: 'When the target branch has not diverged from the branch being merged, Git simply moves the target branch pointer forward to the newest commit, creating no merge commit',
		explanation: 'If the branch being merged is directly ahead of the target, there is nothing to join: the pointer slides forward along the existing commits, so history stays linear without a merge commit.',
	},
	{
		skill: 'Git', difficulty: 4, timeLimit: 120,
		text: 'What does a Git submodule allow?',
		options: [
			'Including another Git repository as a subdirectory of the main repository, pinned to a specific commit of that repository, while its history stays separate',
			'Merging two repositories permanently into one shared history',
			'Splitting one repository into two independent repositories automatically',
			'Storing a second copy of every file as a backup inside the same repository',
		],
		correct: 'Including another Git repository as a subdirectory of the main repository, pinned to a specific commit of that repository, while its history stays separate',
		explanation: 'A submodule records a pointer to one commit of an external repository at a path in the main project; the external project keeps its own history and is cloned alongside, not merged in.',
	},
	{
		skill: 'Git', difficulty: 4, timeLimit: 120,
		text: 'What does the command git worktree add allow?',
		options: [
			'Creating an additional working directory linked to the same repository, so a different branch can be checked out and worked on at the same time as the main working tree',
			'Adding a second remote server that mirrors the repository',
			'Duplicating the repository into a completely independent clone',
			'Adding a graphical tree view of the commit history to the terminal',
		],
		correct: 'Creating an additional working directory linked to the same repository, so a different branch can be checked out and worked on at the same time as the main working tree',
		explanation: 'Linked worktrees share the one object store and history of the repository, but each has its own checked-out branch and files, so parallel work on two branches needs no second clone.',
	},
	{
		skill: 'Git', difficulty: 4, timeLimit: 120,
		text: 'What does the command git clean do?',
		options: [
			'Removes untracked files (and, with the directory option, untracked directories) from the working tree',
			'Removes the changes from tracked files that have been modified but not committed',
			'Deletes all commits that are not on any branch',
			'Compresses the repository database to save disk space',
		],
		correct: 'Removes untracked files (and, with the directory option, untracked directories) from the working tree',
		explanation: 'git clean targets files Git is not tracking at all, such as build output. Modified tracked files are untouched by clean (discarding those is a checkout/reset operation), which is why clean is run with care.',
	},
];

module.exports = {
	name: '287_seed_batch3_question_bank',
	up: async (client) => {
		// Invariant check (scored truth): every row must have exactly 4
		// distinct options and a correct_answer identical to one of them —
		// POST /answer scores by exact string equality. Fail loudly before
		// inserting anything rather than seed an unscoreable row.
		for (const q of QUESTIONS) {
			if (!Array.isArray(q.options) || q.options.length !== 4) {
				throw new Error(`287: question must have exactly 4 options: ${q.text}`);
			}
			if (new Set(q.options).size !== q.options.length) {
				throw new Error(`287: question has duplicate options: ${q.text}`);
			}
			if (!q.options.includes(q.correct)) {
				throw new Error(`287: correct_answer is not one of the options: ${q.text}`);
			}
		}

		for (const q of QUESTIONS) {
			await client.query(
				`
        INSERT INTO assessment_questions
          (skill_category, difficulty_level, question_type, question_text, options, correct_answer, explanation, time_limit_seconds, topic_id, source, review_status, format)
        SELECT $1, $2, 'multiple_choice', $3, $4::jsonb, $5, $6, $7,
          (SELECT t.id FROM assessment_topics t
            WHERE LOWER(t.legacy_skill_name) = LOWER($1)),
          'seed', 'approved', 'mcq'
        WHERE NOT EXISTS (
          SELECT 1 FROM assessment_questions
          WHERE skill_category = $1 AND difficulty_level = $2 AND question_text = $3
        )
      `,
				[
					q.skill,
					q.difficulty,
					q.text,
					JSON.stringify(q.options),
					q.correct,
					q.explanation,
					q.timeLimit,
				],
			);
		}

		console.log(`Batch 3 question bank seeded (${QUESTIONS.length} candidate rows, duplicate-guarded)`);
	},
	down: async (client) => {
		for (const q of QUESTIONS) {
			await client.query(
				'DELETE FROM assessment_questions WHERE skill_category = $1 AND question_text = $2',
				[q.skill, q.text],
			);
		}
	},
};
