// =============================================================================
// Migration 283: seed Group B question banks — CSS & HTML, AWS, Docker, Git
// (issue #1648; parent context #1606)
// =============================================================================
//
// Root cause (#1606, Scout-verified): SKILL_CATALOG (routes/assessments.js)
// lists 16 skills, but migration 006 seeds the entire fresh-install bank with
// only 6 rows (JavaScript x2, React, Python, Communication, Problem Solving).
// For a skill/difficulty cell with no bank row, generateQuestion() falls
// through to the AI provider; when providers are unavailable it returns null
// (#1573 honesty fix) and /start surfaces QUESTION_UNAVAILABLE — the
// assessment cannot open. Group B (CSS & HTML, AWS, Docker, Git) had zero
// bank rows at every difficulty (Group A was seeded by migration 281, #1647).
//
// This migration seeds 2 multiple-choice questions per difficulty cell
// (difficulties 1-5) for each Group B skill: 40 rows. Sessions start at
// difficulty 2 and adapt across 1-5, so every adaptive step now finds a bank
// row and these assessments open and progress provider-free.
//
// Content rules (these rows are scored truth):
//   - skill_category spells exactly as SKILL_CATALOG: 'CSS & HTML', 'AWS',
//     'Docker', 'Git' (generateQuestion matches LOWER(skill_category)).
//   - correct_answer is character-identical to one of the 4 options —
//     POST /answer scores MCQ by exact string equality
//     (answer === question.correct_answer). The up() invariant check below
//     throws before any insert if a row violates this.
//   - Every correct_answer was self-reviewed for factual correctness by the
//     author (Nova SME self-review, STOP 1 on #1648); no filler rows.
//     Questions whose correctness would depend on a tool version or an
//     unsettled context were reworded until they did not.
//
// Phase C provenance (design §7 rule 6(d), architecture-assessments-phase-c):
// this migration runs after C0's migrations 279/280, which add
// assessment_topics (279) and assessment_questions.topic_id / format /
// source / review_status (280). Curated seed rows are reviewed in their own
// PR — that PR review IS the review — so every row here ships explicitly as
// source='seed', review_status='approved' (without the explicit values the
// 280 defaults would leave them 'legacy'/'pending' and they would not count
// as servable supply under rule 6(a)). format='mcq' is the §3.4 derivation
// for question_type='multiple_choice'. topic_id is resolved at insert time
// by the §6 backfill join, LOWER(skill_category) = LOWER(legacy_skill_name)
// (unambiguous by 279's partial unique index on legacy_skill_name); if the
// C0 topic seed has not run yet the subquery yields NULL, which §3.4
// defines as an unmapped row that the C0 backfill (WHERE topic_id IS NULL)
// picks up later — never a guessed mapping.
//
// Duplicate guard (database-reviewer, STOP 1): each insert is
// INSERT ... SELECT ... WHERE NOT EXISTS on
// (skill_category, difficulty_level, question_text), so applying this
// migration to a database where some of these rows already exist inserts
// only the missing ones. migrate.js additionally records this migration in
// _migrations and runs it in its own transaction, so a failure rolls back
// cleanly and is retried next run.
//
// Additive only: no schema change, no existing row touched.
// down() deletes exactly the rows this migration seeds (matched by
// skill_category + question_text).
// =============================================================================

const QUESTIONS = [
	// ------------------------------------------------------------ CSS & HTML
	{
		skill: 'CSS & HTML', difficulty: 1, timeLimit: 60,
		text: 'Which HTML element creates a hyperlink to another page?',
		options: ['<a>', '<link>', '<href>', '<url>'],
		correct: '<a>',
		explanation: 'The anchor element <a>, used with its href attribute, creates a hyperlink. <link> connects external resources such as stylesheets and is not a clickable hyperlink.',
	},
	{
		skill: 'CSS & HTML', difficulty: 1, timeLimit: 60,
		text: 'Which CSS property sets the color of text?',
		options: ['color', 'text-color', 'font-color', 'text-style'],
		correct: 'color',
		explanation: 'The color property sets the foreground color of text. text-color and font-color are not CSS properties, and text-style does not exist either.',
	},
	{
		skill: 'CSS & HTML', difficulty: 2, timeLimit: 90,
		text: 'In CSS Flexbox, which property aligns flex items along the main axis?',
		options: ['justify-content', 'align-items', 'align-content', 'vertical-align'],
		correct: 'justify-content',
		explanation: 'justify-content distributes and aligns items along the main axis. align-items aligns along the cross axis, and align-content aligns multiple flex lines.',
	},
	{
		skill: 'CSS & HTML', difficulty: 2, timeLimit: 90,
		text: 'Which HTML element is the semantic choice for a self-contained piece of content, such as a blog post, that could be distributed on its own?',
		options: ['<article>', '<div>', '<b>', '<span>'],
		correct: '<article>',
		explanation: '<article> represents a self-contained composition that is independently distributable. <div> and <span> carry no semantics, and <b> is a presentational inline element.',
	},
	{
		skill: 'CSS & HTML', difficulty: 3, timeLimit: 90,
		text: 'Which of these selectors has the highest specificity?',
		options: [
			'#header (an ID selector)',
			'.header (a class selector)',
			'header (a type selector)',
			'* (the universal selector)',
		],
		correct: '#header (an ID selector)',
		explanation: 'Specificity ranks ID selectors above class selectors, which rank above type selectors. The universal selector contributes no specificity at all.',
	},
	{
		skill: 'CSS & HTML', difficulty: 3, timeLimit: 90,
		text: 'In the standard CSS box model, what is the order of the box areas from innermost to outermost?',
		options: [
			'Content, padding, border, margin',
			'Content, border, padding, margin',
			'Content, margin, border, padding',
			'Padding, content, border, margin',
		],
		correct: 'Content, padding, border, margin',
		explanation: 'From the inside out: the content box, then padding, then the border, then the margin that separates the element from its neighbours.',
	},
	{
		skill: 'CSS & HTML', difficulty: 4, timeLimit: 120,
		text: 'What does the declaration grid-template-columns: repeat(3, 1fr); create?',
		options: [
			'Three columns that share the available width equally',
			'Three columns each 1 pixel wide',
			'One column repeated across three rows',
			'Three columns each 1% of the grid container width',
		],
		correct: 'Three columns that share the available width equally',
		explanation: 'repeat(3, 1fr) defines three column tracks of 1fr each; fr units divide the free space proportionally, so the three columns are equal width.',
	},
	{
		skill: 'CSS & HTML', difficulty: 4, timeLimit: 120,
		text: 'How does an element with position: sticky behave while its containing block scrolls?',
		options: [
			'It scrolls with the page until it reaches the offset given by top, then stays in place while its container remains in view',
			'It is fixed relative to the viewport for the entire page, like position: fixed',
			'It is removed from the document flow and positioned relative to its nearest positioned ancestor',
			'It never moves, because sticky elements are always rendered at their static position',
		],
		correct: 'It scrolls with the page until it reaches the offset given by top, then stays in place while its container remains in view',
		explanation: 'A sticky element behaves like a relatively positioned element until scrolling would move it past the given threshold (for example top: 0), after which it sticks — but only within its containing block, unlike fixed positioning.',
	},
	{
		skill: 'CSS & HTML', difficulty: 5, timeLimit: 120,
		text: 'An element has a normal (non-important) inline style for a property, and an author stylesheet rule for the same property is flagged !important. Which declaration wins?',
		options: [
			'The author stylesheet rule flagged !important',
			'The inline style, because inline styles always win',
			'Neither; the browser discards both declarations',
			'Whichever declaration appears later in the document',
		],
		correct: 'The author stylesheet rule flagged !important',
		explanation: 'In the cascade, important author declarations outrank normal inline styles. A normal inline style beats normal stylesheet rules, but adding !important reverses that outcome.',
	},
	{
		skill: 'CSS & HTML', difficulty: 5, timeLimit: 120,
		text: 'What does setting aria-hidden="true" on an element do?',
		options: [
			'The element and its descendants are removed from the accessibility tree, so assistive technologies do not expose them',
			'The element is hidden visually but remains fully available to screen readers',
			'The element is deleted from the DOM after the page loads',
			'Keyboard focus is moved to the element when the page loads',
		],
		correct: 'The element and its descendants are removed from the accessibility tree, so assistive technologies do not expose them',
		explanation: 'aria-hidden="true" removes the element and its subtree from the accessibility tree. It does not change visual rendering (the element can remain visible) and does not remove anything from the DOM.',
	},
	// ------------------------------------------------------------------- AWS
	{
		skill: 'AWS', difficulty: 1, timeLimit: 60,
		text: 'What type of storage does Amazon S3 provide?',
		options: ['Object storage', 'Block storage', 'Relational database storage', 'In-memory caching'],
		correct: 'Object storage',
		explanation: 'S3 stores data as objects in buckets. Block storage is provided by EBS, relational databases by RDS, and in-memory caching by ElastiCache.',
	},
	{
		skill: 'AWS', difficulty: 1, timeLimit: 60,
		text: 'What does Amazon EC2 provide?',
		options: [
			'Rescalable virtual servers (instances) in the cloud',
			'A managed relational database service',
			'A serverless function runtime',
			'A content delivery network',
		],
		correct: 'Rescalable virtual servers (instances) in the cloud',
		explanation: 'EC2 provides virtual servers called instances. RDS is the managed relational database service, Lambda is the serverless function runtime, and CloudFront is the CDN.',
	},
	{
		skill: 'AWS', difficulty: 2, timeLimit: 90,
		text: 'In AWS IAM, what is a policy?',
		options: [
			'A JSON document that defines permissions',
			'A user account with administrator access',
			'A network firewall rule set',
			'An encryption key used to sign requests',
		],
		correct: 'A JSON document that defines permissions',
		explanation: 'An IAM policy is a JSON document listing allowed or denied actions on resources. Policies are attached to users, groups, or roles to grant those permissions.',
	},
	{
		skill: 'AWS', difficulty: 2, timeLimit: 90,
		text: 'Which AWS service runs code in response to events without provisioning or managing servers?',
		options: ['AWS Lambda', 'Amazon EC2', 'Amazon EBS', 'Amazon VPC'],
		correct: 'AWS Lambda',
		explanation: 'Lambda is the serverless compute service: it runs functions in response to events and manages the underlying infrastructure. EC2, EBS and VPC all involve provisioned resources.',
	},
	{
		skill: 'AWS', difficulty: 3, timeLimit: 90,
		text: 'Which statement about Amazon S3 bucket names is correct?',
		options: [
			'They must be unique across all AWS accounts, because the S3 namespace is global',
			'They only need to be unique within a single AWS account',
			'They only need to be unique within an AWS Region',
			'They do not need to be unique at all',
		],
		correct: 'They must be unique across all AWS accounts, because the S3 namespace is global',
		explanation: 'S3 bucket names live in a single global namespace: a name taken by any AWS account cannot be reused by another account, even in a different Region.',
	},
	{
		skill: 'AWS', difficulty: 3, timeLimit: 90,
		text: 'Which statement about security groups in a VPC is correct?',
		options: [
			'They are stateful: return traffic for an allowed connection is automatically allowed',
			'They are stateless: return traffic must be explicitly allowed by a separate rule',
			'They can only contain deny rules',
			'They apply to an entire VPC rather than to instances or network interfaces',
		],
		correct: 'They are stateful: return traffic for an allowed connection is automatically allowed',
		explanation: 'Security groups track connections: if an inbound rule allows a request, the response traffic is allowed back out without an explicit outbound rule. Network ACLs are the stateless VPC control.',
	},
	{
		skill: 'AWS', difficulty: 4, timeLimit: 120,
		text: 'What does an Amazon RDS Multi-AZ deployment provide?',
		options: [
			'A synchronous standby replica in a different Availability Zone, with automatic failover if the primary fails',
			'A read-only replica that serves reporting queries in another Region',
			'An asynchronous copy of the database used only for nightly backups',
			'Two primary databases that both accept writes in different Availability Zones',
		],
		correct: 'A synchronous standby replica in a different Availability Zone, with automatic failover if the primary fails',
		explanation: 'Multi-AZ keeps a synchronously replicated standby in another AZ purely for availability; RDS fails over to it automatically. The standby does not serve reads (that is what read replicas are for) and is not a second writable primary.',
	},
	{
		skill: 'AWS', difficulty: 4, timeLimit: 120,
		text: 'In Amazon CloudFront, what is an origin?',
		options: [
			'The source server (such as an S3 bucket or an HTTP server) that CloudFront fetches content from',
			'The edge location geographically closest to the viewer',
			'The viewer device that first requested the content',
			'A DNS record that points a domain name at a distribution',
		],
		correct: 'The source server (such as an S3 bucket or an HTTP server) that CloudFront fetches content from',
		explanation: 'The origin is the authoritative source for the content. Edge locations cache copies fetched from the origin and serve them to viewers.',
	},
	{
		skill: 'AWS', difficulty: 5, timeLimit: 120,
		text: 'An SQS consumer receives a message but crashes before deleting it, and the visibility timeout expires. What happens to the message?',
		options: [
			'It becomes visible again and can be received and processed by another consumer',
			'It is permanently deleted because it was already received once',
			'It is moved to a dead-letter queue immediately, regardless of configuration',
			'It stays invisible forever so no other consumer can receive a duplicate',
		],
		correct: 'It becomes visible again and can be received and processed by another consumer',
		explanation: 'Visibility timeout only hides a message temporarily. If it is not deleted in time it reappears for other consumers — which is why SQS standard queues provide at-least-once delivery and consumers should be idempotent.',
	},
	{
		skill: 'AWS', difficulty: 5, timeLimit: 120,
		text: 'Under the AWS shared responsibility model, who is responsible for patching the guest operating system of an Amazon EC2 instance?',
		options: [
			'The customer',
			'AWS',
			'The operating system vendor, via AWS',
			'Responsibility is shared equally for guest OS patching',
		],
		correct: 'The customer',
		explanation: 'AWS secures the infrastructure the cloud runs on; the customer secures what they run in the cloud, including the EC2 guest operating system, its patches, and their applications.',
	},
	// ---------------------------------------------------------------- Docker
	{
		skill: 'Docker', difficulty: 1, timeLimit: 60,
		text: 'Which Dockerfile instruction specifies the base image a build starts from?',
		options: ['FROM', 'BASE', 'START', 'IMAGE'],
		correct: 'FROM',
		explanation: 'FROM declares the base image (for example FROM node:20) and is normally the first instruction in a Dockerfile. BASE, START and IMAGE are not Dockerfile instructions.',
	},
	{
		skill: 'Docker', difficulty: 1, timeLimit: 60,
		text: 'What does the -d flag do in the command docker run -d nginx?',
		options: [
			'Runs the container in detached mode, in the background',
			'Deletes the container when it stops',
			'Downloads the image without running it',
			'Runs the container with debug logging enabled',
		],
		correct: 'Runs the container in detached mode, in the background',
		explanation: 'Detached mode runs the container in the background and returns control of the terminal, printing the container ID. Automatic deletion on stop is the separate --rm flag.',
	},
	{
		skill: 'Docker', difficulty: 2, timeLimit: 90,
		text: 'Which Dockerfile instruction copies files from the build context into the image?',
		options: ['COPY', 'MOVE', 'IMPORT', 'ADDHOST'],
		correct: 'COPY',
		explanation: 'COPY copies files or directories from the build context into the image filesystem. MOVE and IMPORT are not Dockerfile instructions for this, and ADDHOST does not exist.',
	},
	{
		skill: 'Docker', difficulty: 2, timeLimit: 90,
		text: 'What does the command docker ps list by default?',
		options: [
			'Only the containers that are currently running',
			'Every container ever created, including stopped ones',
			'All images stored on the host',
			'All Docker networks on the host',
		],
		correct: 'Only the containers that are currently running',
		explanation: 'docker ps shows running containers. Adding -a also shows stopped containers; images and networks are listed by docker images and docker network ls.',
	},
	{
		skill: 'Docker', difficulty: 3, timeLimit: 90,
		text: 'A container writes data to its own writable layer (no volume or bind mount is used) and the container is then removed. What happens to that data?',
		options: [
			'It is deleted together with the container',
			'It is automatically copied into the image',
			'It persists in a default volume Docker creates for every container',
			'It is moved to the host home directory',
		],
		correct: 'It is deleted together with the container',
		explanation: 'The writable layer belongs to the container; removing the container removes the layer. Data that must outlive a container belongs in a volume or bind mount.',
	},
	{
		skill: 'Docker', difficulty: 3, timeLimit: 90,
		text: 'What does the EXPOSE instruction in a Dockerfile actually do?',
		options: [
			'It documents the ports the container listens on; it does not by itself publish a port to the host',
			'It publishes the listed ports on the host for every container run from the image',
			'It opens the listed ports in the host firewall',
			'It restricts the container to listening only on the listed ports',
		],
		correct: 'It documents the ports the container listens on; it does not by itself publish a port to the host',
		explanation: 'EXPOSE is documentation/metadata about listening ports. A port becomes reachable on the host only when it is published, for example with docker run -p 8080:80.',
	},
	{
		skill: 'Docker', difficulty: 4, timeLimit: 120,
		text: 'What is the main benefit of a multi-stage build in a Dockerfile?',
		options: [
			'The final image contains only the runtime artifacts, not the build tools and intermediate files, so it is smaller',
			'The final image automatically includes the full build toolchain for debugging',
			'Each stage produces a separate container that runs in parallel',
			'Multi-stage builds remove the need for a base image',
		],
		correct: 'The final image contains only the runtime artifacts, not the build tools and intermediate files, so it is smaller',
		explanation: 'Later stages copy selected artifacts (for example a compiled binary) out of earlier build stages into a clean final image, leaving compilers and intermediate files behind.',
	},
	{
		skill: 'Docker', difficulty: 4, timeLimit: 120,
		text: 'Two services, web and db, are defined in the same Docker Compose project. How can the web container reach the db container?',
		options: [
			'By using the service name db as a hostname, resolved by the DNS of the shared Compose network',
			'Only by first looking up the db container IP address with docker inspect',
			'Containers in Compose can never communicate with each other',
			'By connecting to the host public IP address on a random port',
		],
		correct: 'By using the service name db as a hostname, resolved by the DNS of the shared Compose network',
		explanation: 'Compose places the project services on a shared network with built-in DNS, so each service name resolves to the corresponding container.',
	},
	{
		skill: 'Docker', difficulty: 5, timeLimit: 120,
		text: 'Which statement correctly describes the relationship between a Docker image and a container?',
		options: [
			'A container is a running instance of an image, adding its own writable layer on top of the image read-only layers',
			'An image is a running instance of a container',
			'Images and containers are the same thing with different names',
			'A container is rebuilt from source code every time it starts',
		],
		correct: 'A container is a running instance of an image, adding its own writable layer on top of the image read-only layers',
		explanation: 'An image is a read-only template of stacked layers. Starting a container instantiates it with a thin writable layer that captures the changes the running container makes.',
	},
	{
		skill: 'Docker', difficulty: 5, timeLimit: 120,
		text: 'An image defines both ENTRYPOINT ["./server"] and CMD ["--port", "8080"]. The container is started with docker run myimage --port 9090. What command actually runs?',
		options: [
			'./server --port 9090, because arguments given to docker run replace CMD but are appended to ENTRYPOINT',
			'./server --port 8080, because CMD always overrides runtime arguments',
			'--port 9090 on its own, because runtime arguments replace ENTRYPOINT',
			'./server with no arguments, because specifying arguments cancels CMD',
		],
		correct: './server --port 9090, because arguments given to docker run replace CMD but are appended to ENTRYPOINT',
		explanation: 'CMD supplies default arguments to ENTRYPOINT. Arguments on the docker run command line replace the CMD defaults entirely, while ENTRYPOINT itself stays in place.',
	},
	// ------------------------------------------------------------------- Git
	{
		skill: 'Git', difficulty: 1, timeLimit: 60,
		text: 'Which command turns an ordinary directory into a Git repository?',
		options: ['git init', 'git create', 'git start', 'git new'],
		correct: 'git init',
		explanation: 'git init creates a new Git repository in the current directory (adding the .git directory). git create, git start and git new are not Git commands.',
	},
	{
		skill: 'Git', difficulty: 1, timeLimit: 60,
		text: 'What does the git status command show?',
		options: [
			'The state of the working tree and staging area, including modified, staged and untracked files',
			'The full history of commits on the current branch',
			'A list of all remote repositories',
			'The differences between the last two commits',
		],
		correct: 'The state of the working tree and staging area, including modified, staged and untracked files',
		explanation: 'git status reports which changes are staged, which are modified but unstaged, and which files are untracked. Commit history is shown by git log.',
	},
	{
		skill: 'Git', difficulty: 2, timeLimit: 90,
		text: 'What does running git add file.txt do?',
		options: [
			'Stages the current contents of file.txt so they will be included in the next commit',
			'Commits file.txt immediately with an automatic message',
			'Uploads file.txt to the remote repository',
			'Creates a new branch containing only file.txt',
		],
		correct: 'Stages the current contents of file.txt so they will be included in the next commit',
		explanation: 'git add copies the file current content into the staging area (index). The change is only recorded in history when git commit runs.',
	},
	{
		skill: 'Git', difficulty: 2, timeLimit: 90,
		text: 'In Git, what is a branch?',
		options: [
			'A lightweight, movable pointer to a commit',
			'A complete independent copy of the repository',
			'A backup archive stored on the remote server',
			'A tag that can never be moved',
		],
		correct: 'A lightweight, movable pointer to a commit',
		explanation: 'A branch is simply a reference pointing at one commit; creating a branch copies no files, and the pointer advances as new commits are made on it.',
	},
	{
		skill: 'Git', difficulty: 3, timeLimit: 90,
		text: 'What does git fetch do?',
		options: [
			'Downloads new objects and refs from a remote and updates remote-tracking branches, without merging anything into the current branch',
			'Downloads remote changes and immediately merges them into the current branch',
			'Uploads local commits to the remote repository',
			'Deletes remote branches that have been merged',
		],
		correct: 'Downloads new objects and refs from a remote and updates remote-tracking branches, without merging anything into the current branch',
		explanation: 'fetch is the safe download step: it updates remote-tracking branches such as origin/main but leaves your current branch untouched. git pull is fetch followed by an integration step such as merge.',
	},
	{
		skill: 'Git', difficulty: 3, timeLimit: 90,
		text: 'What does git stash do?',
		options: [
			'Shelves uncommitted changes and restores a clean working tree, so the changes can be reapplied later',
			'Permanently deletes all uncommitted changes',
			'Commits the changes to a hidden remote branch',
			'Publishes the changes to all collaborators',
		],
		correct: 'Shelves uncommitted changes and restores a clean working tree, so the changes can be reapplied later',
		explanation: 'git stash records the state of the working tree and index, then resets both to match HEAD. git stash pop reapplies the shelved changes later.',
	},
	{
		skill: 'Git', difficulty: 4, timeLimit: 120,
		text: 'For a merge commit, what does the revision HEAD^2 refer to?',
		options: [
			'The second parent of the merge commit — the branch that was merged in',
			'The grandparent commit two steps back in a straight line',
			'The second file changed by the merge commit',
			'A backup copy of HEAD kept by Git',
		],
		correct: 'The second parent of the merge commit — the branch that was merged in',
		explanation: 'The ^N suffix selects the Nth parent of a commit. A merge commit has two or more parents: ^1 is the branch you were on, ^2 is the branch that was merged in. (The two-steps-back ancestor is written HEAD~2.)',
	},
	{
		skill: 'Git', difficulty: 4, timeLimit: 120,
		text: 'After running git reset --soft HEAD~1, where are the changes from the undone commit?',
		options: [
			'They are still present in the working tree and staged in the index',
			'They are permanently deleted from the working tree',
			'They exist only in the reflog and not in the working tree',
			'They are automatically pushed to the remote',
		],
		correct: 'They are still present in the working tree and staged in the index',
		explanation: '--soft moves only the branch pointer: the index and working tree are untouched, so the undone commit changes remain staged and ready to recommit. (--hard would discard them from the working tree.)',
	},
	{
		skill: 'Git', difficulty: 5, timeLimit: 120,
		text: 'What does git cherry-pick <commit> do?',
		options: [
			'Applies the changes of the named commit onto the current branch as a new commit with a new hash',
			'Moves the named commit itself, with its original hash, onto the current branch',
			'Deletes the named commit from every branch',
			'Tags the named commit so it can never be rebased',
		],
		correct: 'Applies the changes of the named commit onto the current branch as a new commit with a new hash',
		explanation: 'Cherry-picking replays the named commit diff on top of HEAD, creating a distinct commit — same changes, different parent and therefore a different hash. The original commit stays where it was.',
	},
	{
		skill: 'Git', difficulty: 5, timeLimit: 120,
		text: 'What is the purpose of the Git reflog?',
		options: [
			'It records where HEAD and branch tips have pointed over time, so commits no longer reachable from any branch can be found and recovered',
			'It is the log of everything pushed to the remote server',
			'It lists the differences introduced by every commit',
			'It stores a copy of every file version ever committed',
		],
		correct: 'It records where HEAD and branch tips have pointed over time, so commits no longer reachable from any branch can be found and recovered',
		explanation: 'The reflog is a local record of reference updates (commits, resets, rebases, checkouts). A commit orphaned by a reset or rebase usually remains findable through the reflog until the entries expire.',
	},
];

module.exports = {
	name: '283_seed_group_b_question_bank',
	up: async (client) => {
		// Invariant check (scored truth): every row must have exactly 4
		// distinct options and a correct_answer identical to one of them —
		// POST /answer scores by exact string equality. Fail loudly before
		// inserting anything rather than seed an unscoreable row.
		for (const q of QUESTIONS) {
			if (!Array.isArray(q.options) || q.options.length !== 4) {
				throw new Error(`283: question must have exactly 4 options: ${q.text}`);
			}
			if (new Set(q.options).size !== q.options.length) {
				throw new Error(`283: question has duplicate options: ${q.text}`);
			}
			if (!q.options.includes(q.correct)) {
				throw new Error(`283: correct_answer is not one of the options: ${q.text}`);
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

		console.log(`Group B question bank seeded (${QUESTIONS.length} candidate rows, duplicate-guarded)`);
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
