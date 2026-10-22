// =============================================================================
// Migration 281: seed Group A question banks — Node.js, SQL, TypeScript, Java
// (issue #1647; parent context #1606)
// =============================================================================
//
// Root cause (#1606, Scout-verified): SKILL_CATALOG (routes/assessments.js)
// lists 16 skills, but migration 006 seeds the entire fresh-install bank with
// only 6 rows (JavaScript x2, React, Python, Communication, Problem Solving).
// For a skill/difficulty cell with no bank row, generateQuestion() falls
// through to the AI provider; when providers are unavailable it returns null
// (#1573 honesty fix) and /start surfaces QUESTION_UNAVAILABLE — the
// assessment cannot open. Group A (Node.js, SQL, TypeScript, Java) had zero
// bank rows at every difficulty.
//
// This migration seeds 2 multiple-choice questions per difficulty cell
// (difficulties 1-5) for each Group A skill: 40 rows. Sessions start at
// difficulty 2 and adapt across 1-5, so every adaptive step now finds a bank
// row and these assessments open and progress provider-free.
//
// Content rules (these rows are scored truth):
//   - skill_category spells exactly as SKILL_CATALOG: 'Node.js', 'SQL',
//     'TypeScript', 'Java' (generateQuestion matches LOWER(skill_category)).
//   - correct_answer is character-identical to one of the 4 options —
//     POST /answer scores MCQ by exact string equality
//     (answer === question.correct_answer). The up() invariant check below
//     throws before any insert if a row violates this.
//   - Every correct_answer was self-reviewed for factual correctness by the
//     author (Nova SME self-review, STOP 1 on #1647); no filler rows.
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
	// ---------------------------------------------------------------- Node.js
	{
		skill: 'Node.js', difficulty: 1, timeLimit: 60,
		text: 'Which command runs a JavaScript file named app.js with Node.js?',
		options: ['node app.js', 'npm app.js', 'node run app.js', 'start app.js'],
		correct: 'node app.js',
		explanation: 'The node executable runs a JavaScript file directly. npm is the package manager and does not run files this way.',
	},
	{
		skill: 'Node.js', difficulty: 1, timeLimit: 60,
		text: 'Which Node.js core module is used to create an HTTP server?',
		options: ['http', 'fs', 'path', 'os'],
		correct: 'http',
		explanation: 'The http core module provides http.createServer(). fs is for files, path for file paths, and os for operating-system information.',
	},
	{
		skill: 'Node.js', difficulty: 2, timeLimit: 90,
		text: 'Which fs method reads a file asynchronously without blocking the event loop?',
		options: ['fs.readFile', 'fs.readFileSync', 'fs.openSync', 'fs.existsSync'],
		correct: 'fs.readFile',
		explanation: 'fs.readFile is the asynchronous form (callback or, via fs/promises, a promise). The Sync methods block the event loop until the read completes.',
	},
	{
		skill: 'Node.js', difficulty: 2, timeLimit: 90,
		text: 'Which object holds the command-line arguments passed to a Node.js process?',
		options: ['process.argv', 'process.args', 'node.argv', 'console.argv'],
		correct: 'process.argv',
		explanation: 'process.argv is an array whose first entries are the node executable path and the script path, followed by the user-supplied arguments.',
	},
	{
		skill: 'Node.js', difficulty: 3, timeLimit: 90,
		text: "What is the output of: console.log('A'); setTimeout(() => console.log('B'), 0); console.log('C'); ?",
		options: ['A C B', 'A B C', 'B A C', 'C A B'],
		correct: 'A C B',
		explanation: 'Synchronous code runs to completion first (A, then C). The setTimeout callback is queued and runs only after the current synchronous execution finishes.',
	},
	{
		skill: 'Node.js', difficulty: 3, timeLimit: 90,
		text: 'What does process.nextTick() do?',
		options: [
			'Schedules a callback to run before the event loop continues to the next phase',
			'Schedules a callback to run after exactly one second',
			'Pauses the process until the next operating-system tick',
			'Starts a new worker thread for the callback',
		],
		correct: 'Schedules a callback to run before the event loop continues to the next phase',
		explanation: 'Callbacks queued with process.nextTick() run as soon as the current operation completes, before the event loop moves on to its next phase.',
	},
	{
		skill: 'Node.js', difficulty: 4, timeLimit: 120,
		text: 'Why does a long-running synchronous loop inside a request handler delay every other request in Node.js?',
		options: [
			'JavaScript runs on a single main thread, so the loop prevents the event loop from processing other work',
			'Node.js creates one operating-system thread per request and the loop exhausts them',
			'The HTTP server serializes all requests through a single socket queue',
			'The garbage collector pauses all requests while any loop is running',
		],
		correct: 'JavaScript runs on a single main thread, so the loop prevents the event loop from processing other work',
		explanation: 'Node.js executes JavaScript on one main thread. A blocking synchronous loop stops the event loop from running callbacks for other requests until it finishes.',
	},
	{
		skill: 'Node.js', difficulty: 4, timeLimit: 120,
		text: 'In Express 4, an async route handler throws an error. What must the handler do for the error-handling middleware to receive it?',
		options: [
			'Catch the error and pass it to next(err), because Express 4 does not automatically forward rejected promises',
			'Nothing, because Express 4 automatically forwards rejected promises to error handlers',
			'Throw the error a second time outside the handler',
			'Call res.throw(err) to hand the error to Express',
		],
		correct: 'Catch the error and pass it to next(err), because Express 4 does not automatically forward rejected promises',
		explanation: 'Express 4 only catches synchronous throws in handlers. Errors from async handlers must be forwarded explicitly with next(err) (Express 5 changed this behaviour).',
	},
	{
		skill: 'Node.js', difficulty: 5, timeLimit: 120,
		text: 'Which Node.js feature runs JavaScript in separate threads that can share memory through SharedArrayBuffer?',
		options: ['Worker Threads', 'Child Processes', 'Cluster', 'Domains'],
		correct: 'Worker Threads',
		explanation: 'The worker_threads module runs JavaScript in parallel threads within the same process, and those threads can share memory via SharedArrayBuffer. Child processes have separate memory spaces.',
	},
	{
		skill: 'Node.js', difficulty: 5, timeLimit: 120,
		text: 'A readable stream produces data faster than a writable stream can consume it. Which signal indicates backpressure?',
		options: [
			"write() returns false when the internal buffer is full, and the writer should wait for the 'drain' event",
			'write() returns null when the internal buffer is full',
			"end() returns false and the writer should wait for the 'ready' event",
			'pipe() throws a BackpressureError that the writer must catch',
		],
		correct: "write() returns false when the internal buffer is full, and the writer should wait for the 'drain' event",
		explanation: "When writable.write() returns false, the buffered data exceeds the highWaterMark; the writer should pause until the writable emits 'drain'. Ignoring this lets memory grow without bound.",
	},
	// -------------------------------------------------------------------- SQL
	{
		skill: 'SQL', difficulty: 1, timeLimit: 60,
		text: 'Which SQL statement retrieves rows from a table?',
		options: ['SELECT', 'GET', 'RETRIEVE', 'SHOW ROWS'],
		correct: 'SELECT',
		explanation: 'SELECT is the standard SQL statement for querying and retrieving rows from a table.',
	},
	{
		skill: 'SQL', difficulty: 1, timeLimit: 60,
		text: 'Which clause filters the rows returned by a SELECT statement?',
		options: ['WHERE', 'ORDER BY', 'GROUP BY', 'LIMIT'],
		correct: 'WHERE',
		explanation: 'WHERE filters individual rows. ORDER BY sorts, GROUP BY groups rows for aggregation, and LIMIT caps how many rows are returned.',
	},
	{
		skill: 'SQL', difficulty: 2, timeLimit: 90,
		text: 'Which JOIN returns only the rows that have matching values in both tables?',
		options: ['INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL OUTER JOIN'],
		correct: 'INNER JOIN',
		explanation: 'INNER JOIN keeps only matched rows from both sides. The outer joins also keep unmatched rows from one or both sides, filling the other side with NULLs.',
	},
	{
		skill: 'SQL', difficulty: 2, timeLimit: 90,
		text: 'What does COUNT(*) return for a group of rows?',
		options: [
			'The number of all rows in the group, including rows containing NULL values',
			'The number of rows in the group where no column is NULL',
			'The number of distinct values in the group',
			'The number of columns in the group',
		],
		correct: 'The number of all rows in the group, including rows containing NULL values',
		explanation: 'COUNT(*) counts rows regardless of NULLs. COUNT(column) is the form that skips rows where that column is NULL.',
	},
	{
		skill: 'SQL', difficulty: 3, timeLimit: 90,
		text: 'Which query finds the departments in an employees table whose average salary is greater than 50000?',
		options: [
			'SELECT department FROM employees GROUP BY department HAVING AVG(salary) > 50000',
			'SELECT department FROM employees WHERE AVG(salary) > 50000 GROUP BY department',
			'SELECT department FROM employees GROUP BY department WHERE AVG(salary) > 50000',
			'SELECT department, AVG(salary) > 50000 FROM employees',
		],
		correct: 'SELECT department FROM employees GROUP BY department HAVING AVG(salary) > 50000',
		explanation: 'Aggregate conditions are evaluated after grouping, so they belong in HAVING. WHERE is evaluated before grouping and cannot reference aggregate results.',
	},
	{
		skill: 'SQL', difficulty: 3, timeLimit: 90,
		text: 'What is the difference between the WHERE and HAVING clauses?',
		options: [
			'WHERE filters rows before grouping; HAVING filters groups after grouping',
			'HAVING filters rows before grouping; WHERE filters groups after grouping',
			'HAVING can only be used in queries without GROUP BY',
			'There is no difference; they are interchangeable',
		],
		correct: 'WHERE filters rows before grouping; HAVING filters groups after grouping',
		explanation: 'WHERE applies to individual rows before aggregation. HAVING applies to the groups produced by GROUP BY and can use aggregate values.',
	},
	{
		skill: 'SQL', difficulty: 4, timeLimit: 120,
		text: 'A transaction must either complete entirely or have no effect at all. Which ACID property describes this?',
		options: ['Atomicity', 'Consistency', 'Isolation', 'Durability'],
		correct: 'Atomicity',
		explanation: 'Atomicity guarantees all-or-nothing execution of a transaction. Consistency, isolation and durability describe valid states, concurrent behaviour and persistence after commit.',
	},
	{
		skill: 'SQL', difficulty: 4, timeLimit: 120,
		text: 'A table has a composite index on columns (a, b). Which statement about using that index is correct?',
		options: [
			'It can also serve a query that filters only on a, because a is the leftmost column of the index',
			'It cannot be used at all by a query that filters only on a',
			'An index on (b, a) would serve a filter on a alone equally well',
			'Composite indexes only help queries that return every column of the index',
		],
		correct: 'It can also serve a query that filters only on a, because a is the leftmost column of the index',
		explanation: 'A composite index is ordered by its leftmost column first, so the leftmost-prefix rule lets it serve filters on a alone (and on a plus b), but not efficiently on b alone.',
	},
	{
		skill: 'SQL', difficulty: 5, timeLimit: 120,
		text: 'What does ROW_NUMBER() OVER (PARTITION BY dept ORDER BY salary DESC) assign to each row?',
		options: [
			'A sequential number restarting at 1 for each department, ordered by salary descending within the department',
			'A sequential number across the whole result set with no restart per department',
			'A rank that leaves gaps after tied salaries, shared by rows in every department',
			'The count of rows in each department repeated on every row',
		],
		correct: 'A sequential number restarting at 1 for each department, ordered by salary descending within the department',
		explanation: 'PARTITION BY restarts the window per department, ORDER BY inside OVER defines the ordering, and ROW_NUMBER assigns consecutive integers (unlike RANK, it leaves no gaps and never shares a value).',
	},
	{
		skill: 'SQL', difficulty: 5, timeLimit: 120,
		text: 'In PostgreSQL, what does SELECT ... FOR UPDATE do?',
		options: [
			'Locks the selected rows so that other transactions cannot update or delete them until this transaction ends',
			'Updates the selected rows immediately without taking any lock',
			'Makes the selected rows permanently read-only for all future transactions',
			'Disables transaction isolation checks for the selected rows',
		],
		correct: 'Locks the selected rows so that other transactions cannot update or delete them until this transaction ends',
		explanation: 'SELECT ... FOR UPDATE takes row-level locks held until the transaction commits or rolls back, preventing concurrent modification of those rows in the meantime.',
	},
	// ------------------------------------------------------------- TypeScript
	{
		skill: 'TypeScript', difficulty: 1, timeLimit: 60,
		text: 'Which declaration correctly annotates a variable as a string in TypeScript?',
		options: ['let name: string', 'let name = string', 'let name: StringType', 'string name'],
		correct: 'let name: string',
		explanation: 'TypeScript annotations follow the variable name after a colon: let name: string.',
	},
	{
		skill: 'TypeScript', difficulty: 1, timeLimit: 60,
		text: 'Which file extension is used for a TypeScript source file that does not contain JSX?',
		options: ['.ts', '.jsx', '.mts.xml', '.tss'],
		correct: '.ts',
		explanation: 'Plain TypeScript files use .ts. Files containing JSX use .tsx.',
	},
	{
		skill: 'TypeScript', difficulty: 2, timeLimit: 90,
		text: 'In an interface, what does the declaration age?: number mean?',
		options: [
			'age is optional and, if present, must be a number',
			'age may hold a value of any type',
			'age is required but may only be set to null',
			'age defaults to 0 when omitted',
		],
		correct: 'age is optional and, if present, must be a number',
		explanation: 'The ? marker makes a property optional. An optional property may be absent, but when present it must match the declared type.',
	},
	{
		skill: 'TypeScript', difficulty: 2, timeLimit: 90,
		text: 'Which type represents a value that can be either a string or a number?',
		options: ['string | number', 'string & number', 'string + number', 'string, number'],
		correct: 'string | number',
		explanation: 'The | operator forms a union type: the value may be any one of the listed types. The & operator forms an intersection instead.',
	},
	{
		skill: 'TypeScript', difficulty: 3, timeLimit: 90,
		text: 'What does the <T> in function identity<T>(value: T): T do?',
		options: [
			'Declares a type parameter so the function preserves the type of the argument the caller passes',
			'Forces the argument to always be a string',
			'Creates a new runtime class named T',
			'Converts the argument to type T when the code runs',
		],
		correct: 'Declares a type parameter so the function preserves the type of the argument the caller passes',
		explanation: 'Generics are compile-time only. <T> lets the signature relate the argument and return types without knowing the concrete type in advance, and nothing named T exists at runtime.',
	},
	{
		skill: 'TypeScript', difficulty: 3, timeLimit: 90,
		text: 'A function declared as function isString(x: unknown): x is string is an example of what?',
		options: [
			'A user-defined type guard (a type predicate)',
			'A generic class declaration',
			'An enum member',
			'A property decorator',
		],
		correct: 'A user-defined type guard (a type predicate)',
		explanation: 'A return type of the form "parameter is Type" is a type predicate. When the function returns true, TypeScript narrows the argument to that type in the calling code.',
	},
	{
		skill: 'TypeScript', difficulty: 4, timeLimit: 120,
		text: 'For interface Person { name: string; age: number }, what is the type keyof Person?',
		options: ['"name" | "age"', '"Person"', 'string', 'string[]'],
		correct: '"name" | "age"',
		explanation: 'keyof produces a union of the property names of the type as string literal types: "name" | "age".',
	},
	{
		skill: 'TypeScript', difficulty: 4, timeLimit: 120,
		text: 'Which statement correctly describes TypeScript structural typing?',
		options: [
			'Type compatibility is based on the shape of the types, not on their names',
			'Two types are compatible only if they have the same declared name',
			'Only class instances can be checked for compatibility',
			'Compatibility is verified at runtime before each assignment',
		],
		correct: 'Type compatibility is based on the shape of the types, not on their names',
		explanation: 'TypeScript uses structural typing: a type with at least the required members is compatible wherever that shape is expected, regardless of its declared name. All checking happens at compile time.',
	},
	{
		skill: 'TypeScript', difficulty: 5, timeLimit: 120,
		text: 'Given type Wrap<T> = T extends string ? string[] : number[], what is Wrap<boolean>?',
		options: ['number[]', 'string[]', 'boolean[]', 'never'],
		correct: 'number[]',
		explanation: 'boolean does not extend string, so the conditional type takes the false branch: number[].',
	},
	{
		skill: 'TypeScript', difficulty: 5, timeLimit: 120,
		text: 'What does the satisfies operator do?',
		options: [
			'Checks that an expression matches a type without widening the inferred type of the expression to that type',
			'Asserts the type of a value at runtime and throws if it differs',
			'Converts a value from one type to another',
			'Makes every property of an object readonly',
		],
		correct: 'Checks that an expression matches a type without widening the inferred type of the expression to that type',
		explanation: 'satisfies validates an expression against a type while keeping the narrower inferred type of the literal, so precise literal types remain available afterwards. It is compile-time only.',
	},
	// ------------------------------------------------------------------- Java
	{
		skill: 'Java', difficulty: 1, timeLimit: 60,
		text: 'Which method signature is the entry point of a Java application?',
		options: [
			'public static void main(String[] args)',
			'public void main()',
			'static main(String args)',
			'public static int main()',
		],
		correct: 'public static void main(String[] args)',
		explanation: 'The JVM looks for public static void main(String[] args). It must be public, static, return void, and take a String array.',
	},
	{
		skill: 'Java', difficulty: 1, timeLimit: 60,
		text: 'Which keyword creates a new object in Java?',
		options: ['new', 'create', 'make', 'alloc'],
		correct: 'new',
		explanation: 'The new keyword allocates an object and invokes its constructor, for example: Object o = new Object();',
	},
	{
		skill: 'Java', difficulty: 2, timeLimit: 90,
		text: 'Which of these collections does not allow duplicate elements?',
		options: ['Set', 'List', 'ArrayList', 'LinkedList'],
		correct: 'Set',
		explanation: 'The Set interface models a collection with no duplicate elements. List and its implementations ArrayList and LinkedList all permit duplicates.',
	},
	{
		skill: 'Java', difficulty: 2, timeLimit: 90,
		text: 'For objects, what is the difference between == and the equals() method?',
		options: [
			'== compares references, while equals() compares contents as defined by the class',
			'== compares contents, while equals() compares references',
			'There is no difference for objects',
			'equals() can only be used with primitive values',
		],
		correct: '== compares references, while equals() compares contents as defined by the class',
		explanation: '== on references is true only when both point to the same object. equals() is defined by each class to compare logical contents, as String does for character sequences.',
	},
	{
		skill: 'Java', difficulty: 3, timeLimit: 90,
		text: 'Which statement about abstract classes and interfaces in Java is correct?',
		options: [
			'A class can extend only one abstract class but can implement multiple interfaces',
			'A class can extend multiple abstract classes',
			'Interfaces cannot declare any methods',
			'Abstract classes cannot declare constructors',
		],
		correct: 'A class can extend only one abstract class but can implement multiple interfaces',
		explanation: 'Java has single class inheritance but multiple interface implementation. Interfaces may declare methods (including default methods), and abstract classes may declare constructors.',
	},
	{
		skill: 'Java', difficulty: 3, timeLimit: 90,
		text: 'In a try-catch statement, which block runs whether or not an exception was thrown?',
		options: ['finally', 'catch', 'try', 'throw'],
		correct: 'finally',
		explanation: 'The finally block runs after try/catch completes in all normal and exceptional paths (barring JVM termination such as System.exit), which is why it is used for cleanup.',
	},
	{
		skill: 'Java', difficulty: 4, timeLimit: 120,
		text: 'What does declaring an instance method as synchronized guarantee?',
		options: [
			'Only one thread at a time can execute that method on the same object instance',
			'All threads calling the method run it in parallel without contention',
			'The method can never throw an exception',
			'The object becomes immutable while the method runs',
		],
		correct: 'Only one thread at a time can execute that method on the same object instance',
		explanation: 'A synchronized instance method acquires the intrinsic lock of its object, so concurrent calls on the same instance are serialised. Calls on different instances use different locks.',
	},
	{
		skill: 'Java', difficulty: 4, timeLimit: 120,
		text: 'Which statement about Java generics is correct?',
		options: [
			'Generic type arguments are erased at runtime, a mechanism known as type erasure',
			'List<String> and List<Integer> are two different classes at runtime',
			'Generic type checks happen only at runtime, never at compile time',
			'Primitive types such as int can be used directly as type arguments',
		],
		correct: 'Generic type arguments are erased at runtime, a mechanism known as type erasure',
		explanation: 'Generics are a compile-time safety feature: after compilation the type arguments are erased, so List<String> and List<Integer> share the same runtime class, and type arguments must be reference types (Integer, not int).',
	},
	{
		skill: 'Java', difficulty: 5, timeLimit: 120,
		text: 'Which statement correctly contrasts ConcurrentHashMap with HashMap?',
		options: [
			'ConcurrentHashMap is designed for safe concurrent access by many threads; HashMap is not thread-safe',
			'HashMap is thread-safe for concurrent writes; ConcurrentHashMap is not',
			'ConcurrentHashMap allows null keys and null values, unlike HashMap',
			'HashMap guarantees atomic putIfAbsent operations; ConcurrentHashMap does not',
		],
		correct: 'ConcurrentHashMap is designed for safe concurrent access by many threads; HashMap is not thread-safe',
		explanation: 'ConcurrentHashMap supports concurrent reads and writes without external synchronisation and forbids null keys/values, while HashMap permits one null key and null values but corrupts under unsynchronised concurrent writes.',
	},
	{
		skill: 'Java', difficulty: 5, timeLimit: 120,
		text: 'Which statement about Java stream operations is correct?',
		options: [
			'Intermediate operations are lazy and do not run until a terminal operation is invoked',
			'Intermediate operations run immediately on each element as they are called',
			'A stream can be reused freely after a terminal operation completes',
			'forEach is an intermediate operation',
		],
		correct: 'Intermediate operations are lazy and do not run until a terminal operation is invoked',
		explanation: 'map, filter and other intermediate operations only build the pipeline; execution starts when a terminal operation such as collect or forEach runs, and a stream cannot be reused afterwards.',
	},
];

module.exports = {
	name: '281_seed_group_a_question_bank',
	up: async (client) => {
		// Invariant check (scored truth): every row must have exactly 4
		// distinct options and a correct_answer identical to one of them —
		// POST /answer scores by exact string equality. Fail loudly before
		// inserting anything rather than seed an unscoreable row.
		for (const q of QUESTIONS) {
			if (!Array.isArray(q.options) || q.options.length !== 4) {
				throw new Error(`281: question must have exactly 4 options: ${q.text}`);
			}
			if (new Set(q.options).size !== q.options.length) {
				throw new Error(`281: question has duplicate options: ${q.text}`);
			}
			if (!q.options.includes(q.correct)) {
				throw new Error(`281: correct_answer is not one of the options: ${q.text}`);
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

		console.log(`Group A question bank seeded (${QUESTIONS.length} candidate rows, duplicate-guarded)`);
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
