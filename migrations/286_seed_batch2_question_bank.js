// =============================================================================
// Migration 286: seed Batch 2 question banks — SQL, TypeScript, Java,
// Data Analysis (issue #1692; STOP 1 on #1658)
// =============================================================================
//
// Root cause (#1606, Scout-verified): SKILL_CATALOG (routes/assessments.js)
// lists 16 skills, but the seeded bank left several difficulty cells too
// thin to serve an assessment provider-free: when generateQuestion() finds
// no bank row for a cell it falls through to the AI provider, and when
// providers are unavailable it returns null (#1573 honesty fix) and /start
// surfaces QUESTION_UNAVAILABLE — the assessment cannot progress.
//
// Batch 1 (migration 285) deepened the first set of skills. This Batch 2
// migration adds exactly 19 new approved MCQ rows for each of SQL,
// TypeScript, Java and Data Analysis — difficulty 2 x6, difficulty 3 x7,
// difficulty 4 x6 per skill, 76 rows total — deepening the d2-d4 cells
// those skills serve most often.
//
// Duplicate guard (authoring): every existing question text for these
// four skills was extracted from migrations 006, 280, 281, 282, 283 and
// 284 before authoring, and no row below duplicates or near-duplicates an
// existing question — same concept asked the same way counted as a
// duplicate and a different concept was chosen instead.
//
// Content rules (these rows are scored truth):
//   - skill_category spells exactly as SKILL_CATALOG: 'SQL', 'TypeScript',
//     'Java', 'Data Analysis' (generateQuestion matches
//     LOWER(skill_category)).
//   - correct_answer is character-identical to one of the 4 options —
//     POST /answer scores MCQ by exact string equality. The up()
//     invariant check below throws before any insert on violation.
//   - Every correct_answer was self-reviewed for factual correctness by
//     the author (Nova SME self-review, STOP 1 on #1658); no filler rows.
//     Questions whose correctness would depend on a tool version or an
//     unsettled context were reworded until they did not.
//
// Provenance: this migration runs after C0's migrations 279/280, so every
// row ships explicitly as source='seed', review_status='approved',
// format='mcq' (the derivation for question_type='multiple_choice'), with
// topic_id resolved at insert time by the join,
// LOWER(skill_category) = LOWER(legacy_skill_name).
//
// Duplicate guard (insert): each insert is INSERT ... SELECT ...
// WHERE NOT EXISTS on (skill_category, difficulty_level, question_text).
// Additive only: no schema change, no existing row touched. down()
// deletes exactly the rows this migration seeds (skill_category +
// question_text).
// =============================================================================

const QUESTIONS = [
	// ------------------------------------------------------------------ SQL
	{
		skill: 'SQL', difficulty: 2, timeLimit: 90,
		text: 'Which clause sorts the rows returned by a SELECT statement, and which keyword sorts from highest to lowest?',
		options: [
			'ORDER BY with DESC',
			'GROUP BY with DESC',
			'ORDER BY with ASC',
			'SORT BY with HIGH',
		],
		correct: 'ORDER BY with DESC',
		explanation: 'ORDER BY sorts the result set; DESC gives descending order (largest/highest first), while ASC — the default — gives ascending order. GROUP BY groups rows for aggregation and does not by itself sort.',
	},
	{
		skill: 'SQL', difficulty: 2, timeLimit: 90,
		text: 'What does SELECT DISTINCT city FROM customers return?',
		options: [
			'Each city value once, with duplicate cities removed',
			'Only the cities that appear more than once',
			'All rows, sorted alphabetically by city',
			'The number of different cities',
		],
		correct: 'Each city value once, with duplicate cities removed',
		explanation: 'DISTINCT removes duplicate rows from the result, so each city appears a single time. It does not count them (that would be COUNT(DISTINCT city)) and it does not sort.',
	},
	{
		skill: 'SQL', difficulty: 2, timeLimit: 90,
		text: 'Which statement correctly adds a new row to a table named products with columns name and price?',
		options: [
			"INSERT INTO products (name, price) VALUES ('Widget', 9.99)",
			"ADD ROW TO products (name, price) VALUES ('Widget', 9.99)",
			"INSERT products SET name = 'Widget', price = 9.99 INTO TABLE",
			"UPDATE products ADD ('Widget', 9.99)",
		],
		correct: "INSERT INTO products (name, price) VALUES ('Widget', 9.99)",
		explanation: 'INSERT INTO ... (columns) VALUES (...) is the standard way to add a row, pairing each listed column with its value in order. UPDATE changes existing rows; it does not add new ones.',
	},
	{
		skill: 'SQL', difficulty: 2, timeLimit: 90,
		text: "In a LIKE pattern, what does the condition name LIKE 'A%' match?",
		options: [
			"Names that start with 'A', followed by any sequence of characters (including none)",
			"Names that contain the letter 'A' anywhere",
			"Names that are exactly 'A%'",
			"Names with exactly one character after 'A'",
		],
		correct: "Names that start with 'A', followed by any sequence of characters (including none)",
		explanation: "In LIKE patterns, % matches any sequence of zero or more characters, so 'A%' anchors the start of the name at A. Matching 'A' anywhere would need '%A%', and a single arbitrary character is matched by _ (underscore), not %.",
	},
	{
		skill: 'SQL', difficulty: 2, timeLimit: 90,
		text: 'What is the purpose of the GROUP BY clause?',
		options: [
			'It gathers rows that share the same values in the grouped columns into one summary row per group, so aggregate functions can be computed per group',
			'It sorts the final result rows alphabetically',
			'It removes duplicate rows from the result',
			'It limits the result to a fixed number of rows',
		],
		correct: 'It gathers rows that share the same values in the grouped columns into one summary row per group, so aggregate functions can be computed per group',
		explanation: 'GROUP BY defines the groups over which aggregates such as COUNT, SUM and AVG are calculated — one output row per group. Sorting is ORDER BY, duplicates are handled by DISTINCT, and row caps by LIMIT.',
	},
	{
		skill: 'SQL', difficulty: 2, timeLimit: 90,
		text: 'In PostgreSQL, in the query SELECT * FROM orders LIMIT 10, what does LIMIT 10 do?',
		options: [
			'It caps the result at 10 rows',
			'It returns only rows where the value 10 appears',
			'It skips the first 10 rows',
			'It limits the query to 10 columns',
		],
		correct: 'It caps the result at 10 rows',
		explanation: 'LIMIT restricts how many rows the query returns. Skipping rows is the job of OFFSET, and filtering on a value belongs in the WHERE clause.',
	},
	{
		skill: 'SQL', difficulty: 3, timeLimit: 90,
		text: 'A LEFT JOIN between customers and orders returns a customer who has never placed an order. What appears in the order columns for that customer?',
		options: [
			'NULL values, because the customer row is kept even though no order row matched',
			'The row is omitted from the result entirely',
			'Zero values in every order column, whatever its type',
			'The values from the most recent order of another customer',
		],
		correct: 'NULL values, because the customer row is kept even though no order row matched',
		explanation: 'A LEFT JOIN keeps every row of the left table; where the right table has no match, its columns are filled with NULL. Omitting the unmatched row entirely is what an INNER JOIN does.',
	},
	{
		skill: 'SQL', difficulty: 3, timeLimit: 90,
		text: 'What does the query SELECT name FROM employees WHERE department_id IN (SELECT id FROM departments WHERE budget > 100000) return?',
		options: [
			'The names of employees whose department is one of the departments with a budget over 100000',
			'The names of all employees, together with their department budgets',
			'The names of departments with a budget over 100000',
			'The names of employees who earn more than 100000',
		],
		correct: 'The names of employees whose department is one of the departments with a budget over 100000',
		explanation: 'The inner query produces the set of high-budget department ids, and IN tests each employee\'s department_id for membership in that set. The budget condition applies to departments, not to employee salaries.',
	},
	{
		skill: 'SQL', difficulty: 3, timeLimit: 90,
		text: 'Which statement about a PRIMARY KEY is correct?',
		options: [
			'It uniquely identifies each row in its table and cannot contain NULL values',
			'A table may have any number of primary keys',
			'Its values may repeat as long as they are not NULL',
			'It is only a performance hint and does not enforce anything',
		],
		correct: 'It uniquely identifies each row in its table and cannot contain NULL values',
		explanation: 'A table has at most one primary key; its values must be unique and NOT NULL, and the database enforces both rules on every write.',
	},
	{
		skill: 'SQL', difficulty: 3, timeLimit: 90,
		text: 'What is the difference between UNION and UNION ALL?',
		options: [
			'UNION removes duplicate rows from the combined result; UNION ALL keeps every row, including duplicates',
			'UNION ALL removes duplicate rows; UNION keeps them',
			'UNION works on columns; UNION ALL works on rows',
			'There is no difference; the names are interchangeable',
		],
		correct: 'UNION removes duplicate rows from the combined result; UNION ALL keeps every row, including duplicates',
		explanation: 'Both stack the rows of two compatible result sets. UNION pays the cost of deduplicating them; UNION ALL simply concatenates, which is why it is faster when duplicates are acceptable or impossible.',
	},
	{
		skill: 'SQL', difficulty: 3, timeLimit: 90,
		text: 'Why does the condition WHERE email = NULL never match any row, even rows whose email is NULL?',
		options: [
			'Comparisons with NULL evaluate to UNKNOWN rather than TRUE, and WHERE keeps only rows whose condition is TRUE — NULL must be tested with IS NULL',
			'NULL is stored as an empty string, so the comparison is a type mismatch',
			'The = operator cannot be used on text columns',
			'Rows with a NULL email are hidden from all queries',
		],
		correct: 'Comparisons with NULL evaluate to UNKNOWN rather than TRUE, and WHERE keeps only rows whose condition is TRUE — NULL must be tested with IS NULL',
		explanation: 'SQL uses three-valued logic: anything compared with NULL — even NULL itself — yields UNKNOWN, which WHERE treats as not matching. IS NULL and IS NOT NULL are the correct tests.',
	},
	{
		skill: 'SQL', difficulty: 3, timeLimit: 90,
		text: 'What is the purpose of a FOREIGN KEY constraint?',
		options: [
			'It requires each value in the column to match a value in the referenced table (or be NULL), so rows cannot point at records that do not exist',
			'It encrypts the column so other tables cannot read it',
			'It copies the referenced table into the current table',
			'It speeds up every query on the table automatically',
		],
		correct: 'It requires each value in the column to match a value in the referenced table (or be NULL), so rows cannot point at records that do not exist',
		explanation: 'A foreign key enforces referential integrity between two tables: an order cannot name a customer id that is not present in the customers table.',
	},
	{
		skill: 'SQL', difficulty: 3, timeLimit: 90,
		text: "What does the expression CASE WHEN score >= 50 THEN 'pass' ELSE 'fail' END produce?",
		options: [
			"The value 'pass' for rows where score is 50 or more, and 'fail' for the other rows",
			'An error, because SQL cannot express conditional logic',
			'Two new columns, one holding passes and one holding failures',
			"The value 'pass' only for rows where score is exactly 50",
		],
		correct: "The value 'pass' for rows where score is 50 or more, and 'fail' for the other rows",
		explanation: 'CASE is SQL\'s conditional expression: it tests each WHEN in order and returns the matching THEN value (or the ELSE value), producing one value per row — here a pass/fail label computed inside the query.',
	},
	{
		skill: 'SQL', difficulty: 4, timeLimit: 120,
		text: 'What does a common table expression (the WITH clause) provide?',
		options: [
			'A named temporary result set that the main query can reference like a table, defined just for that one statement',
			'A permanent new table stored in the database',
			'A way to grant other users permission to read a table',
			'A cache that persists between separate queries',
		],
		correct: 'A named temporary result set that the main query can reference like a table, defined just for that one statement',
		explanation: 'A CTE names a subquery at the top of a statement so the rest of the statement can read it by name — mainly for readability and for building a query in steps. It exists only for that statement and stores nothing.',
	},
	{
		skill: 'SQL', difficulty: 4, timeLimit: 120,
		text: 'In SELECT sale_date, SUM(amount) OVER (ORDER BY sale_date ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running FROM sales, what does the OVER clause make the SUM compute?',
		options: [
			'A running total: each row keeps its own row in the result and shows the sum of amount from the first row up to that row',
			'One single total row for the whole table',
			'The sum of each individual row only, with no accumulation',
			'An error, because SUM cannot be used without GROUP BY',
		],
		correct: 'A running total: each row keeps its own row in the result and shows the sum of amount from the first row up to that row',
		explanation: 'Used with OVER, an aggregate becomes a window function: it computes over a frame of related rows without collapsing them, so every input row survives in the output carrying its cumulative value. Without OVER, SUM with no GROUP BY collapses the table to one row.',
	},
	{
		skill: 'SQL', difficulty: 4, timeLimit: 120,
		text: 'What is a dirty read in transaction processing?',
		options: [
			'One transaction reads data written by another transaction that has not committed yet — data that may later be rolled back and never truly exist',
			'A transaction reads a row that contains a typing error',
			'A read that bypasses the database index and scans the table',
			'A read performed without the required permissions',
		],
		correct: 'One transaction reads data written by another transaction that has not committed yet — data that may later be rolled back and never truly exist',
		explanation: 'A dirty read trusts uncommitted work: if the writing transaction rolls back, the reader acted on data that, as far as the committed record is concerned, never existed. Stricter isolation levels prevent it.',
	},
	{
		skill: 'SQL', difficulty: 4, timeLimit: 120,
		text: 'What is a self-join?',
		options: [
			'A join of a table to itself, typically using two aliases — for example joining an employees table to itself to pair each employee with their manager',
			'A join that requires no join condition',
			'A join between a table and its backup copy',
			'A join that only returns rows identical in every column',
		],
		correct: 'A join of a table to itself, typically using two aliases — for example joining an employees table to itself to pair each employee with their manager',
		explanation: 'When a relationship lives inside one table (employee.manager_id points at employee.id), the table is joined to a second alias of itself so the two roles — employee and manager — can be read side by side.',
	},
	{
		skill: 'SQL', difficulty: 4, timeLimit: 120,
		text: 'Three employees tie for the highest salary. Using RANK() they all get rank 1. What rank does the next employee get, and how does DENSE_RANK() differ?',
		options: [
			'RANK() gives 4, because it skips the positions taken by the tied rows; DENSE_RANK() gives 2, because it does not skip',
			'RANK() gives 2, and DENSE_RANK() also gives 2; they never differ',
			'RANK() gives 4, and DENSE_RANK() also gives 4',
			'RANK() cannot rank tied rows at all',
		],
		correct: 'RANK() gives 4, because it skips the positions taken by the tied rows; DENSE_RANK() gives 2, because it does not skip',
		explanation: 'RANK counts positions, so three rows at rank 1 consume positions 1-3 and the next distinct value is 4. DENSE_RANK counts distinct values, so the next value is 2. Both give tied rows the same rank.',
	},
	{
		skill: 'SQL', difficulty: 4, timeLimit: 120,
		text: 'What does first normal form (1NF) require of a table?',
		options: [
			'Each cell holds a single atomic value, and there are no repeating groups of columns',
			'Every non-key column depends on the whole primary key',
			'The table contains no foreign keys',
			'All columns are of the same data type',
		],
		correct: 'Each cell holds a single atomic value, and there are no repeating groups of columns',
		explanation: '1NF bans multi-valued cells (such as a comma-separated list in one column) and repeating column groups (phone1, phone2, phone3). Depending on the whole key is second normal form, a step beyond 1NF.',
	},
	// ----------------------------------------------------------- TypeScript
	{
		skill: 'TypeScript', difficulty: 2, timeLimit: 90,
		text: 'Which annotation declares an array that holds only numbers?',
		options: ['number[]', 'array<number>', '[number]', 'list<number>'],
		correct: 'number[]',
		explanation: 'number[] (equivalently the generic spelling Array<number>) is the type of an array of numbers. [number] is a one-element tuple type, and array<number> and list<number> are not TypeScript syntax.',
	},
	{
		skill: 'TypeScript', difficulty: 2, timeLimit: 90,
		text: 'What does a TypeScript enum define?',
		options: [
			'A named set of related constant values that code can refer to by name',
			'A loop that runs once per element of an array',
			'A type that can hold a value of any type',
			'A runtime check that validates network data',
		],
		correct: 'A named set of related constant values that code can refer to by name',
		explanation: 'An enum gives meaningful names to a fixed set of values (for example Direction.Up), which is clearer and safer than scattering bare numbers or strings through the code.',
	},
	{
		skill: 'TypeScript', difficulty: 2, timeLimit: 90,
		text: 'What is the practical effect of annotating a variable with the type any?',
		options: [
			'Type checking is effectively switched off for that variable: any operation on it is allowed without a type error',
			'The variable can hold values, but they are still fully type-checked',
			'The variable becomes read-only',
			'The variable must be assigned a value of every type at least once',
		],
		correct: 'Type checking is effectively switched off for that variable: any operation on it is allowed without a type error',
		explanation: 'any opts out of the type system for that value — property access, calls and assignments all pass unchecked, which removes the safety TypeScript exists to provide. unknown is the safer alternative that forces a check before use.',
	},
	{
		skill: 'TypeScript', difficulty: 2, timeLimit: 90,
		text: 'What does the tuple type [string, number] describe?',
		options: [
			'An array of exactly two elements: a string first, then a number',
			'An array of any length holding strings and numbers in any order',
			'An object with two properties named string and number',
			'A value that is either a string or a number',
		],
		correct: 'An array of exactly two elements: a string first, then a number',
		explanation: 'A tuple fixes both the length and the type at each position: element 0 is a string and element 1 is a number. A mixed array of any length would be (string | number)[], and either/or alone is the union string | number.',
	},
	{
		skill: 'TypeScript', difficulty: 2, timeLimit: 90,
		text: 'What does it mean when a function is annotated with the return type void?',
		options: [
			'The function does not return a meaningful value for callers to use',
			'The function returns the number 0',
			'The function returns an empty string',
			'The function can never be called',
		],
		correct: 'The function does not return a meaningful value for callers to use',
		explanation: 'void marks a function whose result is not meant to be used — it may run for its side effects (logging, updating state) but callers get nothing meaningful back. It is not the number 0 or an empty string.',
	},
	{
		skill: 'TypeScript', difficulty: 2, timeLimit: 90,
		text: 'In an interface, what does the readonly modifier on a property do?',
		options: [
			'The property can be assigned when the object is created but not reassigned afterwards — assigning to it later is a compile-time error',
			'The property is hidden from code outside the class',
			'The property value is encrypted at runtime',
			'The property may be omitted when the object is created',
		],
		correct: 'The property can be assigned when the object is created but not reassigned afterwards — assigning to it later is a compile-time error',
		explanation: 'readonly is a compile-time guarantee against reassignment after initialisation. Visibility is controlled by access modifiers in classes, and being allowed to omit a property is the ? (optional) modifier.',
	},
	{
		skill: 'TypeScript', difficulty: 3, timeLimit: 90,
		text: 'What does the utility type Partial<T> produce?',
		options: [
			'A type with the same properties as T, but with every property made optional',
			'A type containing only the first property of T',
			'A deep copy of T in which nested objects are also partial',
			'A union of all the property value types of T',
		],
		correct: 'A type with the same properties as T, but with every property made optional',
		explanation: 'Partial<T> maps over T and adds ? to every property — the standard way to type a patch/update object. The change is shallow: nested objects keep their own required properties.',
	},
	{
		skill: 'TypeScript', difficulty: 3, timeLimit: 90,
		text: 'What does the type Record<string, number> describe?',
		options: [
			'An object whose keys are strings and whose values are all numbers',
			'An array of strings followed by an array of numbers',
			'A database record with exactly two fields',
			'A function that takes a string and returns a number',
		],
		correct: 'An object whose keys are strings and whose values are all numbers',
		explanation: 'Record<K, V> is the dictionary/map-object type: every key of type K maps to a value of type V — here, string keys to number values, as in a word-count map.',
	},
	{
		skill: 'TypeScript', difficulty: 3, timeLimit: 90,
		text: 'Inside the block if (typeof value === \'string\') { ... }, what does TypeScript know about value, if its declared type is string | number?',
		options: [
			'It narrows value to string inside the block, so string methods can be used without an error',
			'It permanently changes the declared type of value to string everywhere',
			'It converts the value to a string at runtime',
			'It knows nothing; typeof checks are ignored by the compiler',
		],
		correct: 'It narrows value to string inside the block, so string methods can be used without an error',
		explanation: 'This is type narrowing: control-flow analysis refines a union type inside a guarded block. The narrowing applies only within that block, and typeof is a runtime check the compiler also understands — it does not convert anything.',
	},
	{
		skill: 'TypeScript', difficulty: 3, timeLimit: 90,
		text: 'What does the never type represent?',
		options: [
			'A value that never occurs — used for functions that always throw or never return, and for branches that should be unreachable',
			'A value that has not been assigned yet',
			'A value that is always null',
			'A type that disables type checking like any does',
		],
		correct: 'A value that never occurs — used for functions that always throw or never return, and for branches that should be unreachable',
		explanation: 'never is the empty type: no value inhabits it. A function that always throws has return type never, and exhaustiveness checks rely on a leftover case being assignable to never only when every case was handled. Unassigned is undefined; disabling checks is any.',
	},
	{
		skill: 'TypeScript', difficulty: 3, timeLimit: 90,
		text: 'A type is declared as type Shape = { kind: \'circle\'; radius: number } | { kind: \'square\'; side: number }. What makes this a discriminated union, and what does it enable?',
		options: [
			'Each member carries the literal kind tag with a different value, so checking shape.kind narrows the value to the matching member and exposes its specific properties',
			'The two members are merged into one type having all three properties',
			'The kind property is ignored by the compiler',
			'It enables converting a circle into a square at runtime',
		],
		correct: 'Each member carries the literal kind tag with a different value, so checking shape.kind narrows the value to the matching member and exposes its specific properties',
		explanation: 'The shared literal-typed property is the discriminant: once kind is checked, TypeScript knows which member it is dealing with, so radius is available exactly in the circle branch and side in the square branch — with no optional properties or unsafe casts.',
	},
	{
		skill: 'TypeScript', difficulty: 3, timeLimit: 90,
		text: 'What does Omit<User, \'passwordHash\'> produce, given an interface User with several properties including passwordHash?',
		options: [
			'A type with all of User\'s properties except passwordHash',
			'A type containing only the passwordHash property',
			'A User value with the passwordHash field deleted at runtime',
			'A type in which passwordHash becomes optional',
		],
		correct: 'A type with all of User\'s properties except passwordHash',
		explanation: 'Omit<T, K> builds a new type from T minus the named keys — the standard way to type a public view of a record. Keeping only the named keys is Pick, and like all types, Omit exists only at compile time and changes nothing at runtime.',
	},
	{
		skill: 'TypeScript', difficulty: 3, timeLimit: 90,
		text: 'What is the effect of writing const roles = [\'admin\', \'editor\'] as const?',
		options: [
			'The array is inferred as a readonly tuple of the literal values, so its elements cannot be reassigned and the inferred type is not widened to string[]',
			'The variable roles cannot be declared again in another file',
			'The array elements become mutable strings of type string',
			'as const has no effect; it is only a comment-like annotation',
		],
		correct: 'The array is inferred as a readonly tuple of the literal values, so its elements cannot be reassigned and the inferred type is not widened to string[]',
		explanation: 'as const applies the narrowest possible inference: literal types for the values and readonly structure, so roles has type readonly [\'admin\', \'editor\'] rather than string[]. Without it, the same literal widens to a mutable string array.',
	},
	{
		skill: 'TypeScript', difficulty: 4, timeLimit: 120,
		text: 'What does the mapped type type Flags<T> = { [K in keyof T]: boolean } produce?',
		options: [
			'A new object type with the same keys as T, where every property value type is boolean',
			'A type that converts T itself into a boolean',
			'An array of the key names of T',
			'A copy of T with its exact original property types',
		],
		correct: 'A new object type with the same keys as T, where every property value type is boolean',
		explanation: 'A mapped type iterates over the keys of T (K in keyof T) and builds a fresh property for each — here retyping every value to boolean, as in a feature-flags object derived from a model type.',
	},
	{
		skill: 'TypeScript', difficulty: 4, timeLimit: 120,
		text: 'In the conditional type type ElementType<T> = T extends (infer U)[] ? U : T, what does infer U do?',
		options: [
			'It captures the element type of the array being matched into a new type variable U, which the true branch can then use',
			'It reads the type of the first element at runtime',
			'It converts the array into a set of unique values',
			'It declares that U must be supplied by the caller',
		],
		correct: 'It captures the element type of the array being matched into a new type variable U, which the true branch can then use',
		explanation: 'infer declares a type variable inside the extends pattern itself: when T matches an array type, U is bound to whatever element type makes the match true, so ElementType<string[]> is string. It is purely a compile-time capture.',
	},
	{
		skill: 'TypeScript', difficulty: 4, timeLimit: 120,
		text: 'Given type T = \'a\' | \'b\' | \'c\', what is Exclude<T, \'a\'>?',
		options: [
			'\'b\' | \'c\'',
			'\'a\'',
			'\'a\' | \'b\' | \'c\'',
			'never',
		],
		correct: '\'b\' | \'c\'',
		explanation: 'Exclude removes from a union every member assignable to the second argument: \'a\' is removed and the remaining members \'b\' and \'c\' form the result. Keeping only the matching members would be Extract.',
	},
	{
		skill: 'TypeScript', difficulty: 4, timeLimit: 120,
		text: 'With strict null checks enabled, what happens when code assigns null to a variable declared as let name: string?',
		options: [
			'It is a compile-time error: null is not part of the string type, and the variable must be declared string | null to accept it',
			'It compiles, but throws an error when the program runs',
			'It compiles and the variable\'s type silently becomes any',
			'It is allowed, because null is a member of every object type',
		],
		correct: 'It is a compile-time error: null is not part of the string type, and the variable must be declared string | null to accept it',
		explanation: 'Under strictNullChecks, null and undefined are their own types rather than members of every type, so possible-null values must be declared explicitly in a union and checked before use — catching a whole class of errors at compile time.',
	},
	{
		skill: 'TypeScript', difficulty: 4, timeLimit: 120,
		text: 'Two declarations in the same scope both declare interface Config, one with a host property and one with a port property. What does TypeScript do?',
		options: [
			'It merges them (declaration merging): Config has both host and port',
			'It reports a duplicate identifier error',
			'The second declaration silently replaces the first',
			'Only the first declaration is used and the second is ignored',
		],
		correct: 'It merges them (declaration merging): Config has both host and port',
		explanation: 'Interfaces support declaration merging: repeated declarations in one scope combine into a single interface with all members. This is how libraries let users augment shared types — a behaviour interfaces have and type aliases do not.',
	},
	{
		skill: 'TypeScript', difficulty: 4, timeLimit: 120,
		text: 'In function first<T extends { length: number }>(items: T): T, what does the constraint T extends { length: number } guarantee?',
		options: [
			'Whatever type is inferred for T, it must have a length property of type number, so the function body can safely use items.length',
			'T must be exactly the type { length: number } and nothing else',
			'T is restricted to strings only',
			'The function may only be called with arrays created in the same file',
		],
		correct: 'Whatever type is inferred for T, it must have a length property of type number, so the function body can safely use items.length',
		explanation: 'A generic constraint sets the minimum shape a type argument must satisfy. Strings, arrays and array-like objects all qualify; a plain number is rejected at compile time because it has no length. The constraint is a floor, not an exact match.',
	},
	// ----------------------------------------------------------------- Java
	{
		skill: 'Java', difficulty: 2, timeLimit: 90,
		text: 'How does an ArrayList differ from a plain Java array?',
		options: [
			'An ArrayList grows and shrinks dynamically as elements are added and removed, while an array has a fixed length once created',
			'An array can hold objects, but an ArrayList can hold only primitives',
			'An ArrayList has a fixed length, while an array grows automatically',
			'There is no practical difference between them',
		],
		correct: 'An ArrayList grows and shrinks dynamically as elements are added and removed, while an array has a fixed length once created',
		explanation: 'Arrays are fixed-size containers created with a length; ArrayList wraps an internal array and resizes it behind the scenes, offering add, remove and contains without manual copying.',
	},
	{
		skill: 'Java', difficulty: 2, timeLimit: 90,
		text: 'Why does calling a method such as replace() on a Java String not change the original string?',
		options: [
			'Strings are immutable: the method returns a new String with the change, and the original is untouched',
			'String methods only work on a copy made with clone()',
			'The original changes, but only after garbage collection runs',
			'Methods on String are not allowed to return values',
		],
		correct: 'Strings are immutable: the method returns a new String with the change, and the original is untouched',
		explanation: 'A String\'s characters can never be modified after creation; operations that appear to edit a string build and return a new one. Code that ignores the return value keeps the unchanged original.',
	},
	{
		skill: 'Java', difficulty: 2, timeLimit: 90,
		text: 'A class declares an instance field int count; with no initialiser and no assignment before it is read. What value does count hold?',
		options: [
			'0 — numeric instance fields are given a default value automatically',
			'It cannot be read; the code does not compile',
			'A random leftover value from memory',
			'null',
		],
		correct: '0 — numeric instance fields are given a default value automatically',
		explanation: 'Fields of a class receive defaults (0 for numeric types, false for boolean, null for references). Local variables inside a method are the opposite: they have no default and must be assigned before use.',
	},
	{
		skill: 'Java', difficulty: 2, timeLimit: 90,
		text: 'What does the private access modifier mean for a class member?',
		options: [
			'The member is accessible only from code inside the same class',
			'The member is accessible from anywhere in the program',
			'The member can be read but never written',
			'The member is shared by all instances of the class',
		],
		correct: 'The member is accessible only from code inside the same class',
		explanation: 'private is the most restrictive modifier: even subclasses cannot access the member directly. Being shared across instances is static, and read-only behaviour is achieved with a private field plus a getter rather than by the modifier alone.',
	},
	{
		skill: 'Java', difficulty: 2, timeLimit: 90,
		text: 'Inside an instance method, what does the keyword this refer to?',
		options: [
			'The object on which the method was invoked — the current instance',
			'The class itself, rather than any instance',
			'The object passed as the first argument to the method',
			'A copy of the object created for the method call',
		],
		correct: 'The object on which the method was invoked — the current instance',
		explanation: 'this is a reference to the current object, commonly used to distinguish a field from a same-named parameter (this.name = name). It is the live object, not a copy, and static methods have no this because they are not invoked on an instance.',
	},
	{
		skill: 'Java', difficulty: 2, timeLimit: 90,
		text: 'What is method overloading in Java?',
		options: [
			'Two or more methods in the same class share a name but differ in their parameter lists (types, number, or order)',
			'A subclass provides its own implementation of a method inherited from its parent',
			'A method calls itself recursively',
			'A method is declared in an interface and implemented in a class',
		],
		correct: 'Two or more methods in the same class share a name but differ in their parameter lists (types, number, or order)',
		explanation: 'Overloading is resolved at compile time from the argument types; the return type alone cannot distinguish overloads. A subclass redefining an inherited method with the same signature is overriding, resolved at runtime.',
	},
	{
		skill: 'Java', difficulty: 3, timeLimit: 90,
		text: 'What does it mean when a method is declared static?',
		options: [
			'It belongs to the class rather than to any instance, so it can be called without creating an object and cannot use instance fields directly',
			'Its return value never changes between calls',
			'It can only be called once during the program run',
			'It is automatically thread-safe',
		],
		correct: 'It belongs to the class rather than to any instance, so it can be called without creating an object and cannot use instance fields directly',
		explanation: 'A static member is shared at class level: it is invoked as ClassName.method(), has no this, and reaches instance state only through an explicit object reference. Static says nothing about thread safety or constant results.',
	},
	{
		skill: 'Java', difficulty: 3, timeLimit: 90,
		text: 'Which statement about constructors in Java is correct?',
		options: [
			'A constructor has the same name as its class and no return type, and it runs when an object is created to initialise its state',
			'A constructor must declare the return type void',
			'A class can have at most one constructor',
			'A constructor is inherited by every subclass unchanged',
		],
		correct: 'A constructor has the same name as its class and no return type, and it runs when an object is created to initialise its state',
		explanation: 'Constructors initialise new objects; a class may declare several overloaded constructors, and if none is declared the compiler supplies a no-argument one. Constructors are not inherited, though a subclass constructor invokes a superclass constructor as its first step.',
	},
	{
		skill: 'Java', difficulty: 3, timeLimit: 90,
		text: 'How many null keys can a java.util.HashMap hold?',
		options: [
			'At most one: a second put with a null key replaces the value stored under the first',
			'Any number, like any other key',
			'None: putting a null key throws an exception',
			'Exactly two, one per internal bucket array',
		],
		correct: 'At most one: a second put with a null key replaces the value stored under the first',
		explanation: 'HashMap permits a single null key (it is placed in a fixed bucket) and any number of null values. Map implementations differ here — Hashtable, for instance, rejects null keys and values entirely.',
	},
	{
		skill: 'Java', difficulty: 3, timeLimit: 90,
		text: 'What distinguishes a checked exception from an unchecked exception in Java?',
		options: [
			'A checked exception must be caught or declared in a throws clause — the compiler enforces it — while an unchecked exception (a RuntimeException) carries no such requirement',
			'Checked exceptions happen at compile time; unchecked exceptions happen at runtime',
			'Unchecked exceptions cannot be caught at all',
			'Checked exceptions are always more severe than unchecked ones',
		],
		correct: 'A checked exception must be caught or declared in a throws clause — the compiler enforces it — while an unchecked exception (a RuntimeException) carries no such requirement',
		explanation: 'Both occur at runtime when thrown; the difference is the compile-time contract. Checked exceptions (such as IOException) force the caller to handle or declare them, which is meant for conditions a program can reasonably anticipate and recover from.',
	},
	{
		skill: 'Java', difficulty: 3, timeLimit: 90,
		text: 'Why is StringBuilder preferred over repeated String concatenation with + inside a long loop?',
		options: [
			'Each + on immutable Strings creates a new String and copies the accumulated text, while StringBuilder appends into a mutable buffer and produces the final String once',
			'StringBuilder produces strings that use a different character encoding',
			'The + operator is not allowed inside loops',
			'StringBuilder results are automatically thread-safe',
		],
		correct: 'Each + on immutable Strings creates a new String and copies the accumulated text, while StringBuilder appends into a mutable buffer and produces the final String once',
		explanation: 'Because Strings are immutable, a loop of concatenations copies the growing text on every iteration. StringBuilder mutates one buffer and converts it once at the end. (StringBuilder is not thread-safe; that is StringBuffer, at a performance cost.)',
	},
	{
		skill: 'Java', difficulty: 3, timeLimit: 90,
		text: 'What does declaring a local variable as final guarantee?',
		options: [
			'The variable cannot be assigned a second value after its initial assignment',
			'The object it refers to cannot be modified in any way',
			'The variable is shared across all method calls',
			'The variable is stored permanently and survives the program',
		],
		correct: 'The variable cannot be assigned a second value after its initial assignment',
		explanation: 'final fixes the binding, not the object: a final reference cannot be repointed, but the referenced object\'s own mutable fields can still change. Sharing across calls is static, not final.',
	},
	{
		skill: 'Java', difficulty: 3, timeLimit: 90,
		text: 'A class Dog extends Animal and overrides the makeSound() method. Through a reference declared as Animal a = new Dog(), which makeSound() implementation runs?',
		options: [
			'Dog\'s implementation — method overriding is resolved at runtime from the actual object (dynamic dispatch)',
			'Animal\'s implementation, because the reference type is Animal',
			'Both implementations run, parent first',
			'Neither; the code does not compile',
		],
		correct: 'Dog\'s implementation — method overriding is resolved at runtime from the actual object (dynamic dispatch)',
		explanation: 'The declared type controls which methods may be called; the object\'s actual class controls which overridden implementation executes. That runtime selection is the core of polymorphism in Java.',
	},
	{
		skill: 'Java', difficulty: 4, timeLimit: 120,
		text: 'What does the volatile keyword guarantee for a variable shared between threads?',
		options: [
			'Visibility: a write by one thread becomes visible to other threads when they read the variable, instead of possibly being seen only from a stale cached copy',
			'Mutual exclusion: only one thread can read or write the variable at a time',
			'Compound actions on the variable, such as count++, become atomic',
			'The variable is stored in a CPU register for speed',
		],
		correct: 'Visibility: a write by one thread becomes visible to other threads when they read the variable, instead of possibly being seen only from a stale cached copy',
		explanation: 'volatile establishes a happens-before relationship between writes and subsequent reads, solving the visibility problem. It does not lock, and it does not make read-modify-write sequences such as count++ atomic — those still need synchronisation or atomic classes.',
	},
	{
		skill: 'Java', difficulty: 4, timeLimit: 120,
		text: 'What is the difference between Comparable and Comparator?',
		options: [
			'Comparable is implemented by the class itself to define its one natural ordering (compareTo); Comparator is a separate object that defines an ordering from outside the class, so several different orderings can exist',
			'Comparable is used for numbers and Comparator for strings',
			'Comparator is implemented inside the class; Comparable is supplied from outside',
			'They are two names for the same interface',
		],
		correct: 'Comparable is implemented by the class itself to define its one natural ordering (compareTo); Comparator is a separate object that defines an ordering from outside the class, so several different orderings can exist',
		explanation: 'A class gets exactly one natural ordering via Comparable. Comparators are external and plural — the same objects can be sorted by date in one place and by name in another without changing the class.',
	},
	{
		skill: 'Java', difficulty: 4, timeLimit: 120,
		text: 'What contract links equals() and hashCode() for objects used as keys in a HashMap?',
		options: [
			'If two objects are equal according to equals(), they must return the same hashCode(); otherwise the map may fail to find an equal key it already holds',
			'Objects with the same hashCode() must be equal according to equals()',
			'hashCode() must return a different value for every object',
			'equals() is implemented by calling hashCode() and comparing the results',
		],
		correct: 'If two objects are equal according to equals(), they must return the same hashCode(); otherwise the map may fail to find an equal key it already holds',
		explanation: 'HashMap first locates a bucket by hashCode, then checks equals within it. Equal objects with different hash codes land in different buckets, so a lookup can miss a key that is present. The reverse implication does not hold: unequal objects may share a hash code (a collision).',
	},
	{
		skill: 'Java', difficulty: 4, timeLimit: 120,
		text: 'What does the try-with-resources statement guarantee?',
		options: [
			'Each resource declared in the try header that implements AutoCloseable has its close() method called automatically when the block ends, whether it ends normally or by exception',
			'Exceptions thrown inside the block are ignored',
			'The block retries automatically until it succeeds',
			'Resources are shared safely between threads without synchronisation',
		],
		correct: 'Each resource declared in the try header that implements AutoCloseable has its close() method called automatically when the block ends, whether it ends normally or by exception',
		explanation: 'try-with-resources removes the error-prone manual close-in-finally pattern for files, streams and connections: closing is automatic and happens even when the block throws, so resources are not leaked on the failure path.',
	},
	{
		skill: 'Java', difficulty: 4, timeLimit: 120,
		text: 'In the standard JVM execution model, where are Java objects allocated, and where do local primitive variables live?',
		options: [
			'Objects are allocated on the heap and shared through references; local primitive variables and references themselves are stored in the stack frame of the method call',
			'Both objects and local primitives are allocated on the heap',
			'Objects are allocated on the stack; local primitives are stored on the heap',
			'Both are stored in static memory for the whole program run',
		],
		correct: 'Objects are allocated on the heap and shared through references; local primitive variables and references themselves are stored in the stack frame of the method call',
		explanation: 'new creates objects on the heap, where they can outlive the method that created them and be reached through references; each method call gets a stack frame holding its local primitives and the references it uses, discarded when the method returns.',
	},
	{
		skill: 'Java', difficulty: 4, timeLimit: 120,
		text: 'What problem is java.util.Optional designed to address?',
		options: [
			'It makes "there may be no result" explicit in the API, so callers are pushed to handle the empty case instead of receiving a null that can cause a NullPointerException',
			'It stores optional command-line arguments for the program',
			'It guarantees a method never returns without a value',
			'It replaces exceptions for all error handling',
		],
		correct: 'It makes "there may be no result" explicit in the API, so callers are pushed to handle the empty case instead of receiving a null that can cause a NullPointerException',
		explanation: 'An Optional return type advertises in the signature that the result may be absent, and its API (isPresent, orElse, map) forces that possibility to be confronted — rather than a null surfacing later as a NullPointerException far from its source.',
	},
	// --------------------------------------------------------- Data Analysis
	{
		skill: 'Data Analysis', difficulty: 2, timeLimit: 90,
		text: 'What is the mode of a dataset?',
		options: [
			'The value that appears most frequently',
			'The middle value when the data is ordered',
			'The sum of all values divided by how many there are',
			'The difference between the highest and lowest values',
		],
		correct: 'The value that appears most frequently',
		explanation: 'The mode is the most common value. The middle ordered value is the median, sum divided by count is the mean, and highest minus lowest is the range.',
	},
	{
		skill: 'Data Analysis', difficulty: 2, timeLimit: 90,
		text: 'Which chart is the best choice for comparing total sales across five product categories?',
		options: [
			'A bar chart',
			'A line chart',
			'A histogram',
			'A scatter plot',
		],
		correct: 'A bar chart',
		explanation: 'Bar charts compare a numeric total across distinct categories side by side. Line charts emphasise change over time, histograms show the distribution of one numeric variable, and scatter plots show the relationship between two numeric variables.',
	},
	{
		skill: 'Data Analysis', difficulty: 2, timeLimit: 90,
		text: 'A price rises from 50 to 60. What is the percentage increase?',
		options: ['20%', '10%', '16.7%', '60%'],
		correct: '20%',
		explanation: 'Percentage change is measured against the starting value: (60 - 50) / 50 = 10 / 50 = 0.20 = 20%. Dividing by the new value (10 / 60) would give the incorrect 16.7%.',
	},
	{
		skill: 'Data Analysis', difficulty: 2, timeLimit: 90,
		text: 'A single extreme outlier is added to a dataset. Which summary statistic is affected the least?',
		options: [
			'The median, because it depends on position rather than on the size of the values',
			'The mean, because it uses every value',
			'The range, because it uses only the two extremes',
			'The standard deviation, because it uses squared differences',
		],
		correct: 'The median, because it depends on position rather than on the size of the values',
		explanation: 'The median moves at most to a neighbouring ordered position when one value is added, however extreme it is. The mean, range and standard deviation all incorporate the outlier\'s size directly and shift substantially.',
	},
	{
		skill: 'Data Analysis', difficulty: 2, timeLimit: 90,
		text: 'Which of these variables is categorical rather than numeric?',
		options: [
			'Payment method used for an order (card, cash, or transfer)',
			'Delivery time in minutes',
			'Weight of a parcel in kilograms',
			'Temperature recorded each hour',
		],
		correct: 'Payment method used for an order (card, cash, or transfer)',
		explanation: 'A categorical variable places observations into groups with no meaningful numeric ordering or arithmetic. Delivery time, weight and temperature are measured on numeric scales where averages make sense.',
	},
	{
		skill: 'Data Analysis', difficulty: 2, timeLimit: 90,
		text: 'What does a pivot table do with raw transaction data?',
		options: [
			'It summarises the data by grouping rows into categories and computing aggregates such as sums or counts for each combination',
			'It sorts the raw rows alphabetically without changing them',
			'It deletes duplicate transactions automatically',
			'It converts every numeric column into percentages',
		],
		correct: 'It summarises the data by grouping rows into categories and computing aggregates such as sums or counts for each combination',
		explanation: 'A pivot table cross-tabulates: choose row and column groupings (for example region by month) and an aggregation (total sales), and it produces the summary grid from the underlying rows.',
	},
	{
		skill: 'Data Analysis', difficulty: 3, timeLimit: 90,
		text: 'For a dataset, the first quartile (Q1) is 20 and the third quartile (Q3) is 44. What is the interquartile range (IQR)?',
		options: ['24', '64', '32', '12'],
		correct: '24',
		explanation: 'IQR = Q3 - Q1 = 44 - 20 = 24: the spread of the middle 50% of the data, which is why it is used to flag outliers beyond Q1 - 1.5 x IQR and Q3 + 1.5 x IQR.',
	},
	{
		skill: 'Data Analysis', difficulty: 3, timeLimit: 90,
		text: 'A survey about a city\'s transport habits is handed out only at a luxury car dealership. Why are its results unreliable for describing the whole city?',
		options: [
			'Sampling bias: the people sampled are systematically unrepresentative of the population the survey claims to describe',
			'The sample answers will all be identical',
			'Surveys can never describe a population',
			'The questions must have been written incorrectly',
		],
		correct: 'Sampling bias: the people sampled are systematically unrepresentative of the population the survey claims to describe',
		explanation: 'When the chance of being sampled depends on traits related to what is being measured — here, car ownership and wealth — the sample skews in a fixed direction, and a bigger sample of the same kind only measures the wrong group more precisely.',
	},
	{
		skill: 'Data Analysis', difficulty: 3, timeLimit: 90,
		text: 'What does a p-value of 0.02 mean in a hypothesis test?',
		options: [
			'If the null hypothesis were true, results at least as extreme as the observed ones would occur with probability 0.02',
			'There is a 2% probability that the null hypothesis is true',
			'There is a 98% probability that the alternative hypothesis is true',
			'The observed effect is 2% larger than expected',
		],
		correct: 'If the null hypothesis were true, results at least as extreme as the observed ones would occur with probability 0.02',
		explanation: 'The p-value is a probability about the data given the null hypothesis, not a probability about the hypothesis itself: it measures how surprising the data would be in a world where the null is true.',
	},
	{
		skill: 'Data Analysis', difficulty: 3, timeLimit: 90,
		text: 'A study reports a 95% confidence interval for average delivery time of 28 to 34 minutes. What is the correct interpretation?',
		options: [
			'The interval was built by a procedure that, over many repeated samples, would capture the true population average in 95% of samples; the data are consistent with a true average between 28 and 34 minutes',
			'95% of all deliveries take between 28 and 34 minutes',
			'There is a 95% probability that the next single delivery takes 28 to 34 minutes',
			'The average delivery time is exactly 31 minutes',
		],
		correct: 'The interval was built by a procedure that, over many repeated samples, would capture the true population average in 95% of samples; the data are consistent with a true average between 28 and 34 minutes',
		explanation: 'A confidence interval quantifies sampling uncertainty about a population parameter: the 95% describes the long-run success rate of the method, not the spread of individual deliveries, which is much wider than the interval for the mean.',
	},
	{
		skill: 'Data Analysis', difficulty: 3, timeLimit: 90,
		text: 'Which chart is the best choice for showing how a website\'s daily visitor count changes over the course of a year?',
		options: [
			'A line chart',
			'A pie chart',
			'A histogram',
			'A bar chart of totals per month',
		],
		correct: 'A line chart',
		explanation: 'A line chart connects measurements in time order, making trends, seasonality and turning points visible at daily resolution. Monthly bars would hide the within-month pattern, a pie chart cannot show change, and a histogram shows a distribution rather than a sequence.',
	},
	{
		skill: 'Data Analysis', difficulty: 3, timeLimit: 90,
		text: 'An exam score has a z-score of -1.5. What does that tell you?',
		options: [
			'The score is 1.5 standard deviations below the mean',
			'The score is 1.5 points below the mean',
			'The score is in the bottom 1.5% of scores',
			'The score is negative',
		],
		correct: 'The score is 1.5 standard deviations below the mean',
		explanation: 'A z-score expresses distance from the mean in standard-deviation units: z = (value - mean) / standard deviation. The sign gives direction, not a negative raw score, and the value is in spread units rather than raw points or percentiles.',
	},
	{
		skill: 'Data Analysis', difficulty: 3, timeLimit: 90,
		text: 'A study finds that neighbourhoods with more coffee shops also have higher house prices. Why does this alone not show that coffee shops raise house prices?',
		options: [
			'A third factor — for example neighbourhood wealth — could drive both, so association alone cannot separate cause from a shared cause',
			'The study would need at least a thousand neighbourhoods before any conclusion',
			'House prices cannot be measured accurately enough for such a study',
			'Coffee shops are businesses, so they cannot affect house prices at all',
		],
		correct: 'A third factor — for example neighbourhood wealth — could drive both, so association alone cannot separate cause from a shared cause',
		explanation: 'This is confounding: an unmeasured variable related to both sides of the association can create it without any direct effect in either direction. Untangling it requires controlling for the confounder or a design such as randomisation, not merely more of the same data.',
	},
	{
		skill: 'Data Analysis', difficulty: 4, timeLimit: 120,
		text: 'A rare condition affects 1 person in 1,000. A test for it correctly flags 99% of people who have it, and incorrectly flags 1% of people who do not. Someone tests positive. Roughly how likely is it that they actually have the condition?',
		options: [
			'About 9% — most positives are false alarms, because the condition is so rare that the 1% false-positive rate on the huge healthy group produces far more positives',
			'About 99% — the test is 99% accurate',
			'About 50%',
			'About 1%',
		],
		correct: 'About 9% — most positives are false alarms, because the condition is so rare that the 1% false-positive rate on the huge healthy group produces far more positives',
		explanation: 'Per 100,000 people: about 100 have the condition and roughly 99 of them test positive; about 99,900 do not, and 1% of them — roughly 999 — also test positive. So a positive is a true case in about 99 / (99 + 999), roughly 9% of cases. Ignoring the base rate is the classic error here.',
	},
	{
		skill: 'Data Analysis', difficulty: 4, timeLimit: 120,
		text: 'A regression model reports an R-squared of 0.81. What does that mean?',
		options: [
			'About 81% of the variation in the outcome variable is accounted for by the model\'s predictors',
			'The model\'s predictions are exactly right 81% of the time',
			'81% of the data points lie exactly on the regression line',
			'The correlation between the predictors is 0.81',
		],
		correct: 'About 81% of the variation in the outcome variable is accounted for by the model\'s predictors',
		explanation: 'R-squared is the proportion of the outcome\'s variance the model explains, leaving about 19% to everything the model does not capture. It is not an accuracy rate, a count of points on the line, or a correlation between predictors.',
	},
	{
		skill: 'Data Analysis', difficulty: 4, timeLimit: 120,
		text: 'What does the central limit theorem say?',
		options: [
			'The distribution of the sample mean approaches a normal distribution as the sample size grows, whatever the shape of the population distribution (provided the variance is finite)',
			'Every dataset becomes normally distributed once it is large enough',
			'The sample mean always equals the population mean',
			'Samples of any size give normally distributed means',
		],
		correct: 'The distribution of the sample mean approaches a normal distribution as the sample size grows, whatever the shape of the population distribution (provided the variance is finite)',
		explanation: 'The theorem is about the statistic, not the data: individual values keep their original distribution, but averages of larger and larger samples pile up into an approximately normal shape centred on the population mean — which is what makes standard confidence intervals work.',
	},
	{
		skill: 'Data Analysis', difficulty: 4, timeLimit: 120,
		text: 'How do variance and standard deviation differ?',
		options: [
			'Population variance is the average of the squared differences from the mean, so it is measured in squared units; the standard deviation is its square root, measured in the original units of the data',
			'Variance is always larger than the standard deviation',
			'Variance is used for samples and standard deviation only for populations',
			'They are identical measures with two names',
		],
		correct: 'Population variance is the average of the squared differences from the mean, so it is measured in squared units; the standard deviation is its square root, measured in the original units of the data',
		explanation: 'Squaring the differences makes variance hard to read directly (squared minutes, squared dollars), so the standard deviation converts the spread back to the data\'s own units. Neither is always larger — for values below 1 the variance is smaller than the standard deviation.',
	},
	{
		skill: 'Data Analysis', difficulty: 4, timeLimit: 120,
		text: 'A researcher tests 100 independent effects, none of which is real (the null hypothesis is true in every case), each at the 0.05 significance level. About how many significant results should be expected purely by chance, and what is the lesson?',
		options: [
			'About 5 significant results purely by chance — testing many hypotheses at once manufactures false positives unless the analysis accounts for the multiplicity',
			'None, because the significance level prevents false positives',
			'About 50, because each test is a coin flip',
			'About 95, because 0.05 is a small probability',
		],
		correct: 'About 5 significant results purely by chance — testing many hypotheses at once manufactures false positives unless the analysis accounts for the multiplicity',
		explanation: 'A 0.05 threshold accepts a 5% false-positive rate per test; across 100 true nulls that is about 5 expected false discoveries. This multiple-comparisons problem is why large-scale testing needs corrections or false-discovery-rate control.',
	},
	{
		skill: 'Data Analysis', difficulty: 4, timeLimit: 120,
		text: 'In a regression predicting house price from size, the coefficient for size (in square metres) is 2,000, and price is measured in dollars. What does the coefficient mean?',
		options: [
			'Holding the other predictors fixed, each additional square metre is associated with a predicted price about $2,000 higher',
			'Every house gains exactly $2,000 in real value when a square metre is added',
			'The average house price is $2,000',
			'Size explains 2,000% of the price variation',
		],
		correct: 'Holding the other predictors fixed, each additional square metre is associated with a predicted price about $2,000 higher',
		explanation: 'A regression coefficient is the change in the predicted outcome for a one-unit change in that predictor, with the other predictors held fixed. It is a model association in the units of both variables — not a guarantee about any individual house and not a percentage of variation.',
	},
];

module.exports = {
	name: '286_seed_batch2_question_bank',
	up: async (client) => {
		// Invariant check (scored truth): every row must have exactly 4
		// distinct options and a correct_answer identical to one of them —
		// POST /answer scores by exact string equality. Fail loudly before
		// inserting anything rather than seed an unscoreable row.
		for (const q of QUESTIONS) {
			if (!Array.isArray(q.options) || q.options.length !== 4) {
				throw new Error(`286: question must have exactly 4 options: ${q.text}`);
			}
			if (new Set(q.options).size !== q.options.length) {
				throw new Error(`286: question has duplicate options: ${q.text}`);
			}
			if (!q.options.includes(q.correct)) {
				throw new Error(`286: correct_answer is not one of the options: ${q.text}`);
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

		console.log(`Batch 2 question bank seeded (${QUESTIONS.length} candidate rows, duplicate-guarded)`);
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
