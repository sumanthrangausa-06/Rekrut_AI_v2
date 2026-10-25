// =============================================================================
// Migration 284: seed Group C question banks — Data Analysis, System Design,
// Project Management, Machine Learning — PLUS legacy-cell completion for
// Communication, JavaScript, Python, React (issue #1649; parent #1606)
// =============================================================================
//
// Root cause (#1606, Scout-verified): SKILL_CATALOG (routes/assessments.js)
// lists 16 skills, but migration 006 seeds the entire fresh-install bank with
// only 6 rows. Groups A (migration 281, #1647) and B (migration 283, #1648)
// seeded 2 MCQ per difficulty cell 1-5 for their eight skills. The four
// Group C skills — Data Analysis, System Design, Project Management,
// Machine Learning — still had zero bank rows at every difficulty, and the
// four legacy skills seeded by 006 (JavaScript, Python, React,
// Communication) had only partial cells: on a fresh install JavaScript held
// 1 approved MCQ at d2 and d3, Python 1 at d2, React 1 at d2, and
// Communication 1 approved short_answer at d1 (migration 280's curation pass
// approves exactly those 006 rows). For a cell with no bank row,
// generateQuestion() falls through to the AI provider; when providers are
// unavailable it returns null (#1573 honesty fix) and /start surfaces
// QUESTION_UNAVAILABLE — the assessment cannot progress provider-free.
//
// This migration seeds:
//   - Group C: 2 MCQ per difficulty cell (1-5) x 4 skills = 40 rows.
//   - Legacy completion, counted exactly from the fresh-install state
//     above, topping every cell up to >= 2 servable (approved) rows and
//     no further: JavaScript +8 (d1 +2, d2 +1, d3 +1, d4 +2, d5 +2),
//     Python +9 (d1 +2, d2 +1, d3 +2, d4 +2, d5 +2), React +9 (same shape
//     as Python), Communication +9 (see judgment below). Legacy total 35.
//   Total candidate rows: 75.
//
// Communication judgment (STOP 1 on #1649, recorded in the #1649 build
// log): Communication GAINS MCQ rows; it does not stay short_answer-only.
// MCQ rows are scored by exact string equality with no provider involved,
// while a short_answer-only bank leaves every Communication cell dependent
// on evaluated answers. Under design §4.6 (architecture-assessments-
// phase-c), a mixed session serves format IN ('mcq','short_answer') and
// servable(mixed) = servable(mcq) + servable(short_answer), so the new MCQ
// rows count toward Communication's supply alongside its legacy
// short_answer row, which is untouched and still serves. Serving
// consequence of the alternative, for the record: short_answer-only would
// have met the numeric cell target while keeping Communication the one
// legacy skill with no deterministically-scored row at any difficulty.
// Per-cell Communication result after this migration: d1 mixed = 2
// (1 legacy short_answer + 1 new MCQ); d2-d5 mcq = 2 each.
//
// Content rules (these rows are scored truth):
//   - skill_category spells exactly as SKILL_CATALOG: 'Data Analysis',
//     'System Design', 'Project Management', 'Machine Learning',
//     'JavaScript', 'Python', 'React', 'Communication' (generateQuestion
//     matches LOWER(skill_category)).
//   - correct_answer is character-identical to one of the 4 options —
//     POST /answer scores MCQ by exact string equality. The up()
//     invariant check below throws before any insert on violation.
//   - Every correct_answer was self-reviewed for factual correctness by
//     the author (Nova SME self-review, STOP 1 on #1649); no filler rows.
//     Questions whose correctness would depend on a tool version or an
//     unsettled context were reworded until they did not.
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
	// ---------------------------------------------------------- Data Analysis
	{
		skill: 'Data Analysis', difficulty: 1, timeLimit: 60,
		text: 'What is the mean (average) of the numbers 2, 4, and 6?',
		options: ['4', '3', '6', '12'],
		correct: '4',
		explanation: 'The mean is (2 + 4 + 6) / 3 = 12 / 3 = 4.',
	},
	{
		skill: 'Data Analysis', difficulty: 1, timeLimit: 60,
		text: 'What is the median of the ordered values 3, 7, 9, 12, 15?',
		options: ['9', '7', '12', '9.2'],
		correct: '9',
		explanation: 'The median of an odd number of ordered values is the middle value: 9. (9.2 is the mean, not the median.)',
	},
	{
		skill: 'Data Analysis', difficulty: 2, timeLimit: 90,
		text: 'In a spreadsheet, which formula returns the average of the cells A1 through A10?',
		options: ['=AVERAGE(A1:A10)', '=MEAN(A1:A10)', '=AVG(A1:A10)', '=TOTAL(A1:A10)'],
		correct: '=AVERAGE(A1:A10)',
		explanation: 'AVERAGE is the built-in function for the mean of a range. MEAN, AVG and TOTAL are not spreadsheet function names.',
	},
	{
		skill: 'Data Analysis', difficulty: 2, timeLimit: 90,
		text: 'What does the standard deviation of a dataset measure?',
		options: [
			'How spread out the values are around their mean',
			'The difference between the largest and smallest values',
			'The middle value of the ordered dataset',
			'How many values the dataset contains',
		],
		correct: 'How spread out the values are around their mean',
		explanation: 'Standard deviation measures typical distance from the mean. Largest-minus-smallest is the range, and the middle ordered value is the median.',
	},
	{
		skill: 'Data Analysis', difficulty: 3, timeLimit: 90,
		text: 'Two variables have a correlation coefficient of -0.85. What does this indicate?',
		options: [
			'A strong negative linear relationship: as one variable increases, the other tends to decrease',
			'A weak relationship, because the value is below zero',
			'One variable causes the other to decrease',
			'The variables are unrelated',
		],
		correct: 'A strong negative linear relationship: as one variable increases, the other tends to decrease',
		explanation: 'Values near -1 or +1 indicate a strong linear relationship; the sign gives the direction. Correlation alone never establishes causation.',
	},
	{
		skill: 'Data Analysis', difficulty: 3, timeLimit: 90,
		text: 'Which chart is the best choice for showing the distribution of a single numeric variable, such as the ages of customers?',
		options: ['A histogram', 'A pie chart', 'A line chart with two series', 'A scatter plot'],
		correct: 'A histogram',
		explanation: 'A histogram bins a numeric variable and shows how many observations fall in each bin, which is exactly a distribution view. Pie charts show parts of a whole for categories, and scatter plots need two numeric variables.',
	},
	{
		skill: 'Data Analysis', difficulty: 4, timeLimit: 120,
		text: 'In hypothesis testing, what is a Type I error?',
		options: [
			'Rejecting a null hypothesis that is actually true',
			'Failing to reject a null hypothesis that is actually false',
			'Using a sample that is too small',
			'Recording a measurement incorrectly',
		],
		correct: 'Rejecting a null hypothesis that is actually true',
		explanation: 'A Type I error is a false positive: concluding an effect exists when it does not. Failing to reject a false null is a Type II error.',
	},
	{
		skill: 'Data Analysis', difficulty: 4, timeLimit: 120,
		text: "What is Simpson's paradox?",
		options: [
			'A trend that appears in separate groups of data reverses when the groups are combined',
			'A dataset that contains duplicate rows',
			'A correlation that becomes stronger when outliers are removed',
			'Averages that are equal even though the distributions differ',
		],
		correct: 'A trend that appears in separate groups of data reverses when the groups are combined',
		explanation: "Simpson's paradox is a reversal of a trend between grouped and combined views of the same data, usually caused by a lurking grouping variable with very different group sizes.",
	},
	{
		skill: 'Data Analysis', difficulty: 5, timeLimit: 120,
		text: 'In a multiple regression, what is the main practical problem caused by strong multicollinearity among the predictor variables?',
		options: [
			'Individual coefficient estimates become unstable, with inflated standard errors, so the effect of each predictor is hard to isolate',
			'The regression cannot be computed at all',
			'The predicted values are always too high',
			'The outcome variable stops being numeric',
		],
		correct: 'Individual coefficient estimates become unstable, with inflated standard errors, so the effect of each predictor is hard to isolate',
		explanation: 'When predictors carry largely the same information, the model can still predict, but the split of credit between predictors is unreliable: coefficients swing between samples and their standard errors grow.',
	},
	{
		skill: 'Data Analysis', difficulty: 5, timeLimit: 120,
		text: 'An A/B test reports p = 0.03 for a change that lifts conversion by 0.01 percentage points. What is the correct interpretation?',
		options: [
			'The result is statistically significant at the 0.05 level, but the tiny effect size may make it practically unimportant',
			'The change is guaranteed to matter because the p-value is below 0.05',
			'The result is not significant, because the effect is small',
			'The p-value proves the change caused exactly a 0.01 point lift',
		],
		correct: 'The result is statistically significant at the 0.05 level, but the tiny effect size may make it practically unimportant',
		explanation: 'Statistical significance (could this plausibly be chance?) and practical significance (is the effect big enough to matter?) are different questions; with large samples, trivial effects can be statistically significant.',
	},
	// ---------------------------------------------------------- System Design
	{
		skill: 'System Design', difficulty: 1, timeLimit: 60,
		text: 'What is the main job of a load balancer?',
		options: [
			'To distribute incoming requests across multiple servers so no single server is overwhelmed',
			'To encrypt traffic between the client and the server',
			'To store backup copies of the database',
			'To compile application code before deployment',
		],
		correct: 'To distribute incoming requests across multiple servers so no single server is overwhelmed',
		explanation: 'A load balancer spreads work across a pool of servers, improving capacity and letting failed servers be removed from rotation. Encryption, backups and builds are separate concerns.',
	},
	{
		skill: 'System Design', difficulty: 1, timeLimit: 60,
		text: 'Why do systems use a cache?',
		options: [
			'To serve frequently requested data faster and reduce load on the underlying data store',
			'To permanently archive data that is never read again',
			'To guarantee data is never lost',
			'To replace the database for all writes',
		],
		correct: 'To serve frequently requested data faster and reduce load on the underlying data store',
		explanation: 'A cache keeps copies of hot data in a fast store close to its consumers. Caches are not durable archives and do not replace the source of truth for writes.',
	},
	{
		skill: 'System Design', difficulty: 2, timeLimit: 90,
		text: 'What is the difference between horizontal and vertical scaling?',
		options: [
			'Horizontal scaling adds more machines; vertical scaling adds more power (CPU/RAM) to an existing machine',
			'Horizontal scaling adds more power to one machine; vertical scaling adds more machines',
			'Horizontal scaling applies only to databases; vertical scaling applies only to web servers',
			'There is no difference; the terms are interchangeable',
		],
		correct: 'Horizontal scaling adds more machines; vertical scaling adds more power (CPU/RAM) to an existing machine',
		explanation: 'Scaling out (horizontal) grows the fleet; scaling up (vertical) grows one machine, which eventually hits hardware limits.',
	},
	{
		skill: 'System Design', difficulty: 2, timeLimit: 90,
		text: 'What does a content delivery network (CDN) primarily do?',
		options: [
			'Serves content from copies cached at locations close to users, reducing latency',
			'Translates domain names into IP addresses',
			'Executes application business logic for users',
			'Balances load between two database replicas',
		],
		correct: 'Serves content from copies cached at locations close to users, reducing latency',
		explanation: 'A CDN caches static (and sometimes dynamic) content at edge locations near users. Translating names to addresses is DNS.',
	},
	{
		skill: 'System Design', difficulty: 3, timeLimit: 90,
		text: 'According to the CAP theorem, when a distributed system experiences a network partition, what must it choose between?',
		options: [
			'Consistency and availability',
			'Consistency and durability',
			'Availability and scalability',
			'Latency and throughput',
		],
		correct: 'Consistency and availability',
		explanation: 'During a partition the system cannot both answer every request (availability) and guarantee every answer reflects the latest write (consistency); it must favour one until the partition heals.',
	},
	{
		skill: 'System Design', difficulty: 3, timeLimit: 90,
		text: 'What is the main trade-off of adding a database index on a column?',
		options: [
			'Queries filtering on that column get faster, while writes get slower and storage use grows',
			'Queries get faster and writes also get faster',
			'Queries get slower, but the database uses less storage',
			'Only the storage use changes; query and write speed are unaffected',
		],
		correct: 'Queries filtering on that column get faster, while writes get slower and storage use grows',
		explanation: 'An index is an extra structure that must be maintained on every insert and update and stored on disk, in exchange for much faster lookups on the indexed column.',
	},
	{
		skill: 'System Design', difficulty: 4, timeLimit: 120,
		text: 'What problem does consistent hashing mainly solve in a distributed cache or storage system?',
		options: [
			'When a node joins or leaves, only a small fraction of keys need to move to a different node',
			'It encrypts keys before they are stored',
			'It guarantees every read returns the latest write',
			'It removes the need for any replication',
		],
		correct: 'When a node joins or leaves, only a small fraction of keys need to move to a different node',
		explanation: 'Consistent hashing maps keys and nodes onto the same ring, so adding or removing one node remaps roughly 1/N of the keys instead of nearly all of them, as a plain modulo hash would.',
	},
	{
		skill: 'System Design', difficulty: 4, timeLimit: 120,
		text: 'What is the main benefit of placing a message queue between a producer and a consumer service?',
		options: [
			'The services are decoupled: the producer can keep working and messages wait safely if the consumer is slow or temporarily down',
			'Messages are guaranteed to be processed in the order they were produced, in every queue system',
			'The consumer no longer needs to handle errors',
			'The producer and consumer are forced to run at exactly the same speed',
		],
		correct: 'The services are decoupled: the producer can keep working and messages wait safely if the consumer is slow or temporarily down',
		explanation: 'The queue absorbs bursts and outages between the two sides (temporal decoupling). Ordering guarantees and error handling depend on the queue and the consumer design, not on the queue existing.',
	},
	{
		skill: 'System Design', difficulty: 5, timeLimit: 120,
		text: 'What does it mean for an API operation to be idempotent?',
		options: [
			'Making the same request multiple times has the same effect as making it once',
			'The operation always returns the same response body',
			'The operation can only be called once per user',
			'The operation completes within a fixed time limit',
		],
		correct: 'Making the same request multiple times has the same effect as making it once',
		explanation: 'Idempotency is about effect, not response text: a retried request (for example after a network timeout) must not create a second charge or a duplicate record. It is what makes safe retries possible.',
	},
	{
		skill: 'System Design', difficulty: 5, timeLimit: 120,
		text: 'A database is sharded by user ID across four servers. Which operation becomes hardest compared with a single-server database?',
		options: [
			'Queries and joins that must combine data belonging to many different users across shards',
			'Looking up one user by their ID',
			'Inserting a new user record',
			'Counting the records on a single shard',
		],
		correct: 'Queries and joins that must combine data belonging to many different users across shards',
		explanation: 'The shard key makes single-user lookups and inserts easy to route, but cross-shard aggregations and joins must scatter to every shard and merge results, which is the classic cost of sharding.',
	},
	// ----------------------------------------------------- Project Management
	{
		skill: 'Project Management', difficulty: 1, timeLimit: 60,
		text: 'In project management, what does the term "scope" refer to?',
		options: [
			'The work that must be delivered, and its boundaries — what is and is not included',
			'The total budget approved for the project',
			'The list of people assigned to the project team',
			'The date the project must finish',
		],
		correct: 'The work that must be delivered, and its boundaries — what is and is not included',
		explanation: 'Scope defines the deliverables and the boundary of included work. Budget, team roster and finish date are separate planning elements.',
	},
	{
		skill: 'Project Management', difficulty: 1, timeLimit: 60,
		text: 'In Scrum, who is responsible for ordering (prioritising) the Product Backlog?',
		options: ['The Product Owner', 'The Scrum Master', 'The Development Team as a whole', 'The project sponsor'],
		correct: 'The Product Owner',
		explanation: 'The Product Owner owns the Product Backlog and its ordering, maximising the value of the product. The Scrum Master serves the process; the Developers own how the work is done.',
	},
	{
		skill: 'Project Management', difficulty: 2, timeLimit: 90,
		text: 'What is the critical path of a project plan?',
		options: [
			'The longest sequence of dependent tasks, which determines the shortest possible project duration',
			'The tasks assigned to the most senior team members',
			'The sequence of tasks with the highest cost',
			'The list of tasks that stakeholders consider most important',
		],
		correct: 'The longest sequence of dependent tasks, which determines the shortest possible project duration',
		explanation: 'Because its tasks must run one after another, the longest dependent chain sets the earliest possible finish; delaying a task on it delays the project.',
	},
	{
		skill: 'Project Management', difficulty: 2, timeLimit: 90,
		text: 'In Scrum, what is a Sprint?',
		options: [
			'A fixed-length timebox of one month or less in which a usable increment of work is produced',
			'A period of overtime worked to catch up before a release',
			'The meeting held at the end of a project',
			'An emergency fix deployed outside the normal process',
		],
		correct: 'A fixed-length timebox of one month or less in which a usable increment of work is produced',
		explanation: 'Sprints are the heartbeat of Scrum: fixed-length, one month or less, and each produces a Done, usable increment.',
	},
	{
		skill: 'Project Management', difficulty: 3, timeLimit: 90,
		text: 'In a RACI chart, what does the "A" stand for?',
		options: ['Accountable', 'Assigned', 'Approver of budget only', 'Assistant'],
		correct: 'Accountable',
		explanation: 'RACI = Responsible (does the work), Accountable (owns the decision and the outcome — exactly one per task), Consulted, Informed.',
	},
	{
		skill: 'Project Management', difficulty: 3, timeLimit: 90,
		text: 'What is the difference between a risk and an issue in project management?',
		options: [
			'A risk is a potential future event; an issue is a problem that has already occurred',
			'A risk is a small problem; an issue is a large problem',
			'A risk affects cost; an issue affects schedule',
			'There is no difference; the terms are interchangeable',
		],
		correct: 'A risk is a potential future event; an issue is a problem that has already occurred',
		explanation: 'Risks are managed proactively (probability and impact, mitigation plans) precisely because they have not happened yet; issues need resolution now.',
	},
	{
		skill: 'Project Management', difficulty: 4, timeLimit: 120,
		text: 'In earned value management, a project has Earned Value (EV) of 80,000 and Actual Cost (AC) of 100,000. What is its Cost Performance Index (CPI), and what does it mean?',
		options: [
			'CPI = 0.8; the project is over budget for the work accomplished',
			'CPI = 1.25; the project is under budget for the work accomplished',
			'CPI = 0.8; the project is behind schedule',
			'CPI = 20,000; the project has overspent by that amount in index terms',
		],
		correct: 'CPI = 0.8; the project is over budget for the work accomplished',
		explanation: 'CPI = EV / AC = 80,000 / 100,000 = 0.8. Below 1 means each unit of money spent earned less than a unit of value — over budget. (Schedule performance is SPI = EV / PV.)',
	},
	{
		skill: 'Project Management', difficulty: 4, timeLimit: 120,
		text: 'In a project network diagram, what is "float" (also called slack) for a task?',
		options: [
			'The amount of time the task can be delayed without delaying the project finish date',
			'The extra budget held in reserve for the task',
			'The number of people who can be added to the task',
			'The time a task waits in a review queue',
		],
		correct: 'The amount of time the task can be delayed without delaying the project finish date',
		explanation: 'Float is schedule flexibility: tasks on the critical path have zero float, and off-path tasks can slip by their float before they start to matter to the end date.',
	},
	{
		skill: 'Project Management', difficulty: 5, timeLimit: 120,
		text: 'What is the difference between fast-tracking and crashing a schedule?',
		options: [
			'Fast-tracking performs activities in parallel that were planned in sequence; crashing adds resources to shorten activities',
			'Fast-tracking adds resources; crashing performs activities in parallel',
			'Fast-tracking shortens the schedule; crashing lengthens it',
			'They are two names for the same technique',
		],
		correct: 'Fast-tracking performs activities in parallel that were planned in sequence; crashing adds resources to shorten activities',
		explanation: 'Fast-tracking trades risk (rework from overlapping dependent work) for time; crashing trades cost (more resources) for time.',
	},
	{
		skill: 'Project Management', difficulty: 5, timeLimit: 120,
		text: 'What is a project baseline used for?',
		options: [
			'It is the approved version of the plan (scope, schedule, cost) against which actual progress and performance are measured',
			'It is the first rough estimate made before any planning',
			'It is the list of tasks that were cancelled during the project',
			'It is the minimum team size needed to start the project',
		],
		correct: 'It is the approved version of the plan (scope, schedule, cost) against which actual progress and performance are measured',
		explanation: 'Variances only mean something against an agreed reference: the baseline is that frozen, approved plan. Changes to it go through change control rather than silent edits.',
	},
	// ------------------------------------------------------ Machine Learning
	{
		skill: 'Machine Learning', difficulty: 1, timeLimit: 60,
		text: 'What is supervised learning?',
		options: [
			'Learning from labelled examples, where each training input comes with its correct output',
			'Learning by trial and error guided only by a reward signal',
			'Finding groups in data that has no labels',
			'Training a model with no data at all',
		],
		correct: 'Learning from labelled examples, where each training input comes with its correct output',
		explanation: 'Supervised learning fits a mapping from inputs to known outputs. Trial-and-error with rewards is reinforcement learning, and grouping unlabelled data is clustering (unsupervised).',
	},
	{
		skill: 'Machine Learning', difficulty: 1, timeLimit: 60,
		text: 'Which task is a classification problem?',
		options: [
			'Predicting whether an email is spam or not spam',
			'Predicting the exact price of a house',
			'Predicting tomorrow temperature in degrees',
			'Predicting how many units a store will sell',
		],
		correct: 'Predicting whether an email is spam or not spam',
		explanation: 'Classification predicts a discrete category (spam / not spam). Predicting a continuous number — price, temperature, units — is regression.',
	},
	{
		skill: 'Machine Learning', difficulty: 2, timeLimit: 90,
		text: 'What is overfitting?',
		options: [
			'A model performs very well on its training data but poorly on new, unseen data because it has memorised training details instead of learning general patterns',
			'A model that is too simple to capture the pattern in the data',
			'A model trained for exactly the right number of iterations',
			'A model whose inputs have been normalised',
		],
		correct: 'A model performs very well on its training data but poorly on new, unseen data because it has memorised training details instead of learning general patterns',
		explanation: 'Overfitting is memorisation over generalisation: the training score flatters the model and the unseen-data score exposes it. Too-simple is underfitting.',
	},
	{
		skill: 'Machine Learning', difficulty: 2, timeLimit: 90,
		text: 'Why is a dataset normally split into training and test sets?',
		options: [
			'So the model can be evaluated on data it was not trained on, giving an honest estimate of how it will perform on new data',
			'So the model trains twice as fast',
			'So the test set can be used to tune the model inputs directly',
			'Because algorithms cannot use more than half of a dataset',
		],
		correct: 'So the model can be evaluated on data it was not trained on, giving an honest estimate of how it will perform on new data',
		explanation: 'Evaluating on training data measures memorisation. A held-out test set approximates performance on the unseen data the model will meet in production.',
	},
	{
		skill: 'Machine Learning', difficulty: 3, timeLimit: 90,
		text: 'A spam filter flags 40 emails as spam; 30 of them really are spam and 10 are not. What is its precision on this result?',
		options: ['0.75', '0.30', '0.40', '1.00'],
		correct: '0.75',
		explanation: 'Precision = true positives / all predicted positives = 30 / 40 = 0.75: of everything the filter called spam, three quarters really was spam.',
	},
	{
		skill: 'Machine Learning', difficulty: 3, timeLimit: 90,
		text: 'Why does feature scaling (for example normalising numeric inputs) matter for a k-nearest-neighbours classifier?',
		options: [
			'KNN uses distances between points, so a feature measured in large units would dominate the distance over features measured in small units',
			'KNN cannot accept numbers larger than 1',
			'Scaling changes which neighbours are labelled positive',
			'Scaling removes the need for a training set',
		],
		correct: 'KNN uses distances between points, so a feature measured in large units would dominate the distance over features measured in small units',
		explanation: 'Distance-based methods compare raw numeric differences; without scaling, the largest-unit feature (for example income in dollars) swamps small-unit features (for example age in years).',
	},
	{
		skill: 'Machine Learning', difficulty: 4, timeLimit: 120,
		text: 'In gradient descent, what is the most likely effect of choosing a learning rate that is far too large?',
		options: [
			'The updates overshoot the minimum and the loss may oscillate or diverge instead of decreasing',
			'Training becomes very slow but always reaches the best possible model',
			'The model immediately memorises the training data',
			'The gradient becomes exactly zero at every step',
		],
		correct: 'The updates overshoot the minimum and the loss may oscillate or diverge instead of decreasing',
		explanation: 'Each step jumps by learning rate x gradient; steps that are too big leap past the minimum and can land at ever-worse losses. Too small a rate is the slow-training failure mode instead.',
	},
	{
		skill: 'Machine Learning', difficulty: 4, timeLimit: 120,
		text: 'What does the bias-variance trade-off describe?',
		options: [
			'Total error comes from both systematic error (bias, from too-simple assumptions) and sensitivity to the particular training sample (variance); reducing one typically increases the other',
			'A choice between training on biased data and training on varied data',
			'The trade-off between training speed and prediction speed',
			'A rule that a model can have low bias or low variance, never both changing at once',
		],
		correct: 'Total error comes from both systematic error (bias, from too-simple assumptions) and sensitivity to the particular training sample (variance); reducing one typically increases the other',
		explanation: 'Simple models err consistently (high bias, low variance); very flexible models track each training sample (low bias, high variance — overfitting). Model selection balances the two.',
	},
	{
		skill: 'Machine Learning', difficulty: 5, timeLimit: 120,
		text: 'What is data leakage in machine learning?',
		options: [
			'Information from outside the training data — typically about the target itself — sneaks into the features, so the model looks far better in evaluation than it will be in production',
			'A model that accidentally reveals its weights to users',
			'Training data being deleted before training finishes',
			'A dataset with too many rows for the available memory',
		],
		correct: 'Information from outside the training data — typically about the target itself — sneaks into the features, so the model looks far better in evaluation than it will be in production',
		explanation: 'A leaky feature (for example a field only filled in after the outcome is known) hands the model the answer during training and evaluation, but is absent or different at prediction time.',
	},
	{
		skill: 'Machine Learning', difficulty: 5, timeLimit: 120,
		text: 'A fraud dataset is 99% legitimate transactions and 1% fraud. A model that predicts "legitimate" for every transaction scores 99% accuracy. Why is that accuracy misleading, and what is the better lens?',
		options: [
			'The model catches no fraud at all; accuracy hides failure on the rare class that matters, so precision and recall for the fraud class are the meaningful measures',
			'The accuracy is actually wrong; the true figure is 1%',
			'Accuracy is fine; the model should simply be deployed',
			'The model is overfitting, and more training data of the same mix would fix it',
		],
		correct: 'The model catches no fraud at all; accuracy hides failure on the rare class that matters, so precision and recall for the fraud class are the meaningful measures',
		explanation: 'With heavy class imbalance, the majority-class baseline already scores 99% while being useless. Per-class precision/recall expose that the model detects none of the fraud it exists to catch.',
	},
	// --------------------------------------- Legacy completion: JavaScript
	// Fresh-install state: MCQ d2 x1, d3 x1 (migration 006). Adds d1 +2,
	// d2 +1, d3 +1, d4 +2, d5 +2 = 8, topping every cell up to 2.
	{
		skill: 'JavaScript', difficulty: 1, timeLimit: 60,
		text: 'Which keyword declares a block-scoped variable whose value can be reassigned?',
		options: ['let', 'const', 'function', 'class'],
		correct: 'let',
		explanation: 'let declares a block-scoped, reassignable variable. const is block-scoped but cannot be reassigned; var is the older function-scoped keyword.',
	},
	{
		skill: 'JavaScript', difficulty: 1, timeLimit: 60,
		text: 'Which array method adds an element to the end of an array?',
		options: ['push()', 'pop()', 'shift()', 'slice()'],
		correct: 'push()',
		explanation: 'push() appends to the end and returns the new length. pop() removes from the end, shift() removes from the start, and slice() copies a portion without modifying the array.',
	},
	{
		skill: 'JavaScript', difficulty: 2, timeLimit: 90,
		text: 'What is the difference between == and === in JavaScript?',
		options: [
			'=== compares value and type without type coercion; == converts (coerces) the operands to a common type before comparing',
			'== compares value and type; === ignores the type',
			'=== is only for numbers; == is only for strings',
			'There is no difference; they are interchangeable',
		],
		correct: '=== compares value and type without type coercion; == converts (coerces) the operands to a common type before comparing',
		explanation: 'Strict equality (===) never coerces, so 1 === "1" is false, while 1 == "1" is true because == converts the string to a number first.',
	},
	{
		skill: 'JavaScript', difficulty: 3, timeLimit: 90,
		text: 'What is a closure in JavaScript?',
		options: [
			'A function that retains access to variables from the scope where it was created, even after that outer function has returned',
			'A function that cannot access any variables outside itself',
			'A way to close a browser window from code',
			'An object whose properties cannot be changed',
		],
		correct: 'A function that retains access to variables from the scope where it was created, even after that outer function has returned',
		explanation: 'Functions capture their lexical environment: an inner function returned by an outer one still reads and writes the outer variables — the basis of counters, factories and data privacy patterns.',
	},
	{
		skill: 'JavaScript', difficulty: 4, timeLimit: 120,
		text: 'What happens when one of the promises passed to Promise.all() rejects?',
		options: [
			'Promise.all() rejects immediately with that reason, without waiting for the other promises to settle',
			'Promise.all() resolves with the successful results and silently drops the rejected one',
			'Promise.all() waits for every promise and then resolves with an array of errors',
			'The other promises are cancelled automatically',
		],
		correct: 'Promise.all() rejects immediately with that reason, without waiting for the other promises to settle',
		explanation: 'Promise.all is fail-fast: the first rejection rejects the whole aggregate promise. (Promise.allSettled is the variant that waits for every outcome. The other promises are not cancelled — promises cannot be cancelled.)',
	},
	{
		skill: 'JavaScript', difficulty: 4, timeLimit: 120,
		text: 'How does `this` behave inside an arrow function?',
		options: [
			'It is taken from the enclosing (lexical) scope where the arrow function was defined, not from how the function is called',
			'It always refers to the global object',
			'It always refers to the object that calls the function',
			'Arrow functions have no `this` at all and using it is an error',
		],
		correct: 'It is taken from the enclosing (lexical) scope where the arrow function was defined, not from how the function is called',
		explanation: 'Arrow functions do not bind their own this; they inherit it from the surrounding code at definition time, which is why they are convenient inside callbacks and class fields that need the outer this.',
	},
	{
		skill: 'JavaScript', difficulty: 5, timeLimit: 120,
		text: "Consider: console.log('A'); setTimeout(() => console.log('B'), 0); Promise.resolve().then(() => console.log('C')); console.log('D'); — in what order are the letters printed?",
		options: ['A D C B', 'A D B C', 'A B C D', 'A C D B'],
		correct: 'A D C B',
		explanation: 'Synchronous code runs first (A, D). Microtasks (promise callbacks) then run before the next macrotask, so C prints before the setTimeout callback B.',
	},
	{
		skill: 'JavaScript', difficulty: 5, timeLimit: 120,
		text: 'What does Object.freeze(obj) do?',
		options: [
			'It prevents adding, removing, or changing the properties of obj (a shallow freeze — nested objects are not frozen)',
			'It deletes all properties of obj',
			'It prevents obj from being garbage-collected',
			'It makes a deep copy of obj with all nested objects frozen too',
		],
		correct: 'It prevents adding, removing, or changing the properties of obj (a shallow freeze — nested objects are not frozen)',
		explanation: 'freeze makes the object itself immutable at the top level. It is shallow: objects referenced by its properties remain mutable unless they are frozen separately.',
	},
	// ------------------------------------------- Legacy completion: Python
	// Fresh-install state: MCQ d2 x1 (migration 006). Adds d1 +2, d2 +1,
	// d3 +2, d4 +2, d5 +2 = 9.
	{
		skill: 'Python', difficulty: 1, timeLimit: 60,
		text: 'Which character starts a single-line comment in Python?',
		options: ['#', '//', '<!--', '--'],
		correct: '#',
		explanation: 'In Python, everything after # on a line is a comment. // is integer division in Python (and a comment marker in other languages).',
	},
	{
		skill: 'Python', difficulty: 1, timeLimit: 60,
		text: 'What is the data type of the value 3.5 in Python?',
		options: ['float', 'int', 'str', 'decimal'],
		correct: 'float',
		explanation: 'Numbers written with a decimal point are floats. Integers (int) have no decimal point, and str is text.',
	},
	{
		skill: 'Python', difficulty: 2, timeLimit: 90,
		text: 'Which list method adds an item to the end of a list?',
		options: ['append()', 'add()', 'push()', 'insertEnd()'],
		correct: 'append()',
		explanation: 'list.append(x) adds x as a single new last element. add() is a set method, and Python lists have no push() or insertEnd() method.',
	},
	{
		skill: 'Python', difficulty: 3, timeLimit: 90,
		text: 'What does the expression [x * x for x in range(3)] evaluate to?',
		options: ['[0, 1, 4]', '[1, 4, 9]', '[0, 1, 2]', '[1, 2, 3]'],
		correct: '[0, 1, 4]',
		explanation: 'range(3) yields 0, 1, 2; squaring each gives 0, 1, 4. The list comprehension collects those three results.',
	},
	{
		skill: 'Python', difficulty: 3, timeLimit: 90,
		text: "A dictionary d has no key 'age'. What does d.get('age', 0) return, and why is it used?",
		options: [
			'It returns 0 — get() returns the supplied default instead of raising KeyError when the key is missing',
			'It raises KeyError, like d[\'age\'] does',
			'It returns None in all cases',
			'It adds the key with value 0 and returns nothing',
		],
		correct: 'It returns 0 — get() returns the supplied default instead of raising KeyError when the key is missing',
		explanation: "dict.get(key, default) is the safe lookup: the default comes back for a missing key, while d['age'] would raise KeyError. (get() does not insert the key.)",
	},
	{
		skill: 'Python', difficulty: 4, timeLimit: 120,
		text: 'In a function definition, what does *args collect?',
		options: [
			'Any extra positional arguments, as a tuple',
			'Any extra keyword arguments, as a dictionary',
			'The return values of the function, as a list',
			'All global variables used by the function',
		],
		correct: 'Any extra positional arguments, as a tuple',
		explanation: '*args packs surplus positional arguments into a tuple. The keyword counterpart is **kwargs, which packs them into a dictionary.',
	},
	{
		skill: 'Python', difficulty: 4, timeLimit: 120,
		text: 'What is the key difference between a list and a tuple in Python?',
		options: [
			'A tuple is immutable — its items cannot be changed after creation — while a list is mutable',
			'A tuple can hold only numbers, while a list can hold anything',
			'A list is immutable, while a tuple can be changed freely',
			'There is no difference; the two are interchangeable',
		],
		correct: 'A tuple is immutable — its items cannot be changed after creation — while a list is mutable',
		explanation: 'Both can hold items of any type and preserve order; mutability is the defining difference, which is also why tuples can be used as dictionary keys and lists cannot.',
	},
	{
		skill: 'Python', difficulty: 5, timeLimit: 120,
		text: "In CPython, what does the Global Interpreter Lock (GIL) mean for threads?",
		options: [
			'Only one thread can execute Python bytecode at a time in a process, so threads do not speed up CPU-bound pure-Python work',
			'Threads cannot share any memory with each other',
			'Only one thread may be created per process',
			'Threads run faster than processes for every kind of work',
		],
		correct: 'Only one thread can execute Python bytecode at a time in a process, so threads do not speed up CPU-bound pure-Python work',
		explanation: 'The GIL serialises bytecode execution: threads still help I/O-bound work (the lock is released during I/O), but CPU-bound pure-Python code needs multiple processes to use multiple cores.',
	},
	{
		skill: 'Python', difficulty: 5, timeLimit: 120,
		text: 'What is the main advantage of a generator over a function that builds and returns a full list?',
		options: [
			'It produces values one at a time on demand (lazily), so it does not need memory for the whole sequence at once',
			'It always runs faster than any list-based code',
			'Its values can be indexed like a list',
			'It can be iterated over any number of times',
		],
		correct: 'It produces values one at a time on demand (lazily), so it does not need memory for the whole sequence at once',
		explanation: 'A generator yields each value when asked and pauses between them, so memory stays roughly constant even for huge or unbounded sequences. It is exhausted once consumed and cannot be indexed.',
	},
	// -------------------------------------------- Legacy completion: React
	// Fresh-install state: MCQ d2 x1 (migration 006). Adds d1 +2, d2 +1,
	// d3 +2, d4 +2, d5 +2 = 9.
	{
		skill: 'React', difficulty: 1, timeLimit: 60,
		text: 'What is JSX?',
		options: [
			'A syntax extension for JavaScript that lets you write HTML-like markup inside JavaScript code',
			'A separate templating language that replaces JavaScript',
			'A CSS framework used by React applications',
			'A database query language for React state',
		],
		correct: 'A syntax extension for JavaScript that lets you write HTML-like markup inside JavaScript code',
		explanation: 'JSX is compiled to JavaScript function calls that create React elements; it is not a separate language, a stylesheet tool, or a query language.',
	},
	{
		skill: 'React', difficulty: 1, timeLimit: 60,
		text: 'Why must a React component name start with a capital letter, as in <Profile />?',
		options: [
			'So React (and JSX) treats it as a component rather than as a built-in HTML tag',
			'Capitalised names render faster',
			'Lowercase names are reserved JavaScript keywords',
			'It is only a style convention with no effect on behaviour',
		],
		correct: 'So React (and JSX) treats it as a component rather than as a built-in HTML tag',
		explanation: 'JSX compiles lowercase tags to HTML element strings and capitalised identifiers to component references — <profile /> would render an unknown HTML tag instead of calling a Profile component.',
	},
	{
		skill: 'React', difficulty: 2, timeLimit: 90,
		text: 'What does the useState hook return?',
		options: [
			'An array containing the current state value and a function to update it',
			'A single object holding every state value of the component',
			'The previous value of the state before the last render',
			'A promise that resolves when the state changes',
		],
		correct: 'An array containing the current state value and a function to update it',
		explanation: 'const [value, setValue] = useState(initial) is the standard pair: the current value for this render, and the setter that schedules an update and a re-render.',
	},
	{
		skill: 'React', difficulty: 3, timeLimit: 90,
		text: 'What is the purpose of the key prop when rendering a list of elements?',
		options: [
			'It helps React identify which items have changed, been added, or been removed between renders',
			'It encrypts the data shown in each item',
			'It sets the CSS order in which items are displayed',
			'It makes every item in the list unique in the database',
		],
		correct: 'It helps React identify which items have changed, been added, or been removed between renders',
		explanation: 'Keys give list items a stable identity during reconciliation, so React can match old and new elements correctly and preserve the right component state per item.',
	},
	{
		skill: 'React', difficulty: 3, timeLimit: 90,
		text: 'What makes a form input a "controlled component" in React?',
		options: [
			'Its value is held in React state and changes only through the state update handler',
			'It has a readOnly attribute set',
			'It is validated by a server before every keystroke',
			'It stores its value in the browser local storage',
		],
		correct: 'Its value is held in React state and changes only through the state update handler',
		explanation: 'In a controlled input, React state is the single source of truth: value comes from state and onChange writes back to state. An input the DOM manages itself is uncontrolled.',
	},
	{
		skill: 'React', difficulty: 4, timeLimit: 120,
		text: 'When does the cleanup function returned from a useEffect effect run?',
		options: [
			'Before the effect runs again for changed dependencies, and when the component unmounts',
			'Only once, when the application first loads',
			'Immediately after the effect function returns, every render',
			'Never; cleanup functions are only documentation',
		],
		correct: 'Before the effect runs again for changed dependencies, and when the component unmounts',
		explanation: 'Cleanup tears down the previous effect instance (subscriptions, timers, listeners) before the next run and at unmount, which prevents duplicate subscriptions and leaks.',
	},
	{
		skill: 'React', difficulty: 4, timeLimit: 120,
		text: 'What is useMemo used for?',
		options: [
			'To cache the result of an expensive calculation between renders, recomputing it only when its dependencies change',
			'To store values in the browser memory permanently',
			'To memoise entire components so they never re-render',
			'To fetch data from an API and cache the response',
		],
		correct: 'To cache the result of an expensive calculation between renders, recomputing it only when its dependencies change',
		explanation: 'useMemo memoises a computed value across renders until a dependency changes. (Memoising a component itself is React.memo, and API caching is a data-fetching concern.)',
	},
	{
		skill: 'React', difficulty: 5, timeLimit: 120,
		text: 'Why must hooks never be called inside conditions or loops?',
		options: [
			'React relies on the call order of hooks being identical on every render to match each hook with its stored state',
			'Conditional hooks cause a JavaScript syntax error',
			'Hooks called conditionally are simply slower',
			'Conditions reset the component state to its initial value',
		],
		correct: 'React relies on the call order of hooks being identical on every render to match each hook with its stored state',
		explanation: 'Hooks have no names at runtime: React associates them by position in the call sequence. Skipping or reordering a call on some render shifts every later hook onto the wrong state.',
	},
	{
		skill: 'React', difficulty: 5, timeLimit: 120,
		text: "What happens to a component's state when its key prop changes between renders?",
		options: [
			'React treats it as a different component: the old instance unmounts and a new one mounts, so its state is reset',
			'Nothing; keys never affect component state',
			'The state is copied to the new key and rendering continues unchanged',
			'React throws an error and stops rendering',
		],
		correct: 'React treats it as a different component: the old instance unmounts and a new one mounts, so its state is reset',
		explanation: 'A changed key means a different identity in the tree, so React discards the old instance and its state and mounts a fresh one — a deliberate way to fully reset a component.',
	},
	// ------------------------------------ Legacy completion: Communication
	// Fresh-install state: short_answer d1 x1 (migration 006). Per the
	// judgment in the header, Communication gains MCQ rows: d1 +1 (mixed
	// cell = 1 short_answer + 1 MCQ = 2 servable), d2-d5 +2 MCQ each = 9.
	{
		skill: 'Communication', difficulty: 1, timeLimit: 60,
		text: 'Which behaviour best demonstrates active listening in a conversation?',
		options: [
			'Paraphrasing the speaker’s main point back to them to confirm you understood it correctly',
			'Waiting silently and then changing the subject',
			'Preparing your reply while the other person is still speaking',
			'Interrupting to share a similar experience of your own',
		],
		correct: 'Paraphrasing the speaker’s main point back to them to confirm you understood it correctly',
		explanation: 'Active listening means verifying understanding, and a paraphrase does exactly that while showing the speaker they were heard. Interrupting, rehearsing a reply, or changing the subject all break listening.',
	},
	{
		skill: 'Communication', difficulty: 2, timeLimit: 90,
		text: 'You are writing an update for a non-technical audience. What is the most effective approach?',
		options: [
			'Lead with the main takeaway in plain language, and explain or avoid technical jargon',
			'Use as much technical terminology as possible to sound credible',
			'Put the main conclusion at the very end, after all the background detail',
			'Send the raw technical report unchanged; the audience will adapt',
		],
		correct: 'Lead with the main takeaway in plain language, and explain or avoid technical jargon',
		explanation: 'Non-technical readers need the point first, in words they already know; unexplained jargon and a buried conclusion both lose the audience before the message lands.',
	},
	{
		skill: 'Communication', difficulty: 2, timeLimit: 90,
		text: 'Which is the most constructive way to give a colleague feedback on their work?',
		options: [
			'Describe the specific behaviour you observed and its impact, and discuss what could be done differently',
			'Describe the kind of person they are, so they understand the pattern',
			'Save up several months of concerns and raise them all at once',
			'Share the feedback with other colleagues first so they can back you up',
		],
		correct: 'Describe the specific behaviour you observed and its impact, and discuss what could be done differently',
		explanation: 'Behaviour-focused feedback is specific, fair, and actionable; judging personality invites defensiveness, stockpiling concerns prevents timely correction, and triangulating through colleagues undermines trust.',
	},
	{
		skill: 'Communication', difficulty: 3, timeLimit: 90,
		text: 'A teammate disagrees with your proposal in a meeting. What is the most productive response?',
		options: [
			'Acknowledge their concern, ask what evidence or constraints drive it, and look for the option that satisfies the shared goal',
			'Repeat your proposal more loudly until they give in',
			'Drop the subject and raise the proposal again later without them',
			'Agree immediately, even if you believe the proposal is right',
		],
		correct: 'Acknowledge their concern, ask what evidence or constraints drive it, and look for the option that satisfies the shared goal',
		explanation: 'Disagreement usually carries information — a constraint or risk you had not seen. Surfacing it and re-anchoring on the shared goal turns conflict into a better decision; pressure, avoidance, and capitulation all discard that information.',
	},
	{
		skill: 'Communication', difficulty: 3, timeLimit: 90,
		text: 'What belongs at the very start of a written status update to stakeholders?',
		options: [
			'The headline: overall status and any blocker or decision needed, before the detailed progress notes',
			'A long recap of everything the team did on the first day of the period',
			'The full list of minor tasks completed, in the order they were done',
			'An apology for the length of the update',
		],
		correct: 'The headline: overall status and any blocker or decision needed, before the detailed progress notes',
		explanation: 'Stakeholders read top-down and often stop early: the status, blockers, and asks must come first so a decision is never missed inside detail that only some readers need.',
	},
	{
		skill: 'Communication', difficulty: 4, timeLimit: 120,
		text: 'You must tell a stakeholder that a committed deadline will slip by two weeks. What is the best way to deliver this news?',
		options: [
			'Tell them as soon as the slip is clear, state the impact plainly, and present the options and the mitigation you recommend',
			'Wait until the deadline passes, in case the team recovers the time',
			'Mention it casually inside a long list of minor updates, so it does not stand out',
			'Blame the delay on another team so your team keeps its credibility',
		],
		correct: 'Tell them as soon as the slip is clear, state the impact plainly, and present the options and the mitigation you recommend',
		explanation: 'Early, direct bad news preserves trust and leaves time to act; stakeholders can re-plan around a slip they know about. Hiding, burying, or deflecting the news destroys trust when it surfaces — and it always surfaces.',
	},
	{
		skill: 'Communication', difficulty: 4, timeLimit: 120,
		text: 'You receive a task with instructions you find ambiguous. What is the best first step?',
		options: [
			'Ask specific clarifying questions about the expected outcome, scope, and deadline before starting',
			'Start work on your best guess and hope it matches what was wanted',
			'Wait silently; the requester will clarify if it matters',
			'Ask a colleague to decide what the instructions probably mean',
		],
		correct: 'Ask specific clarifying questions about the expected outcome, scope, and deadline before starting',
		explanation: 'Clarifying up front is cheap; rework after guessing is not. Specific questions (outcome, scope, deadline) resolve the ambiguity that actually changes the work.',
	},
	{
		skill: 'Communication', difficulty: 5, timeLimit: 120,
		text: 'You are presenting a proposal to a sceptical executive audience. Which approach is most persuasive?',
		options: [
			'Lead with the outcome they care about, support it with evidence, and address the strongest objections directly',
			'Present every detail of your analysis in the order you performed it',
			'Avoid mentioning any risks, so the proposal looks flawless',
			'Rely on enthusiasm and confidence instead of evidence',
		],
		correct: 'Lead with the outcome they care about, support it with evidence, and address the strongest objections directly',
		explanation: 'Executives decide on outcomes and risks: framing the benefit first, backing it with evidence, and confronting objections head-on builds the credibility that a detail dump, hidden risks, or enthusiasm alone cannot.',
	},
	{
		skill: 'Communication', difficulty: 5, timeLimit: 120,
		text: 'During your presentation, an audience member asks a hostile question challenging your data. What is the best response?',
		options: [
			'Listen to the full question, acknowledge the concern, answer calmly with the evidence you have, and offer to follow up on anything you cannot resolve on the spot',
			'Challenge the questioner’s expertise in return',
			'Ignore the question and move to the next slide',
			'Apologise for the data and abandon the rest of the presentation',
		],
		correct: 'Listen to the full question, acknowledge the concern, answer calmly with the evidence you have, and offer to follow up on anything you cannot resolve on the spot',
		explanation: 'A composed, evidence-based answer under pressure reassures the whole audience; retaliating or dodging damages credibility far more than the original challenge, and capitulating throws away sound work.',
	},
];

module.exports = {
	name: '284_seed_group_c_question_bank',
	up: async (client) => {
		// Invariant check (scored truth): every row must have exactly 4
		// distinct options and a correct_answer identical to one of them —
		// POST /answer scores by exact string equality. Fail loudly before
		// inserting anything rather than seed an unscoreable row.
		for (const q of QUESTIONS) {
			if (!Array.isArray(q.options) || q.options.length !== 4) {
				throw new Error(`284: question must have exactly 4 options: ${q.text}`);
			}
			if (new Set(q.options).size !== q.options.length) {
				throw new Error(`284: question has duplicate options: ${q.text}`);
			}
			if (!q.options.includes(q.correct)) {
				throw new Error(`284: correct_answer is not one of the options: ${q.text}`);
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

		console.log(`Group C + legacy completion question bank seeded (${QUESTIONS.length} candidate rows, duplicate-guarded)`);
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
