// =============================================================================
// Migration 285: C5 Batch 1 — coverage floor for JavaScript, Python, React,
// Node.js (issue #1691; parent #1658; EPIC #1603)
// =============================================================================
//
// STOP 1 evidence (#1658 comment 6349488581, fresh-install rig on dev
// 3e8cc8f4a): every one of the 16 catalogue topics holds exactly 10 approved
// MCQ (2 per difficulty level 1-5), so bands are easy 4 / medium 6 / hard 4 —
// 0 of 16 topics meet the design §7 rule-4 launch floor (servable >= 25
// MCQ/Medium) or the rule-2 activation floor (a configuration with servable
// >= 10).
//
// This migration adds +19 approved MCQ per topic for JavaScript, Python,
// React and Node.js — levels L2 x6 / L3 x7 / L4 x6 per topic — taking each
// topic to easy 10, medium 25, hard 10 (bands overlap by design: easy =
// L1+L2, medium = L2+L3+L4, hard = L4+L5). Total candidate rows: 76.
//
// Content rules (these rows are scored truth):
//   - skill_category spells exactly as SKILL_CATALOG: 'JavaScript',
//     'Python', 'React', 'Node.js' (generateQuestion matches
//     LOWER(skill_category)).
//   - correct_answer is character-identical to one of the 4 options —
//     POST /answer scores MCQ by exact string equality. The up()
//     invariant check below throws before any insert on violation.
//   - No question duplicates or near-duplicates a row already in the bank
//     for the same skill (migrations 006/280/281/282/284 texts were
//     extracted and avoided at STOP 1 for this batch).
//   - Every correct_answer was self-reviewed for factual correctness
//     (Nova author + Interviewer-persona review on the batch PR, per
//     design §9 C5); questions whose correctness would depend on a tool
//     version or an unsettled context were reworded until they did not.
//
// Phase C provenance (design §7 rule 6(d)): every row ships source='seed',
// review_status='approved', format='mcq', topic_id resolved at insert time
// by the §6 join, LOWER(skill_category) = LOWER(legacy_skill_name).
//
// Duplicate guard: INSERT ... SELECT ... WHERE NOT EXISTS on
// (skill_category, difficulty_level, question_text). Additive only: no
// schema change, no existing row touched. down() deletes exactly the rows
// this migration seeds (skill_category + question_text).
// =============================================================================

const QUESTIONS = [
	// ---------------------------------------------------------- JavaScript (L2 x6)
	{
		skill: 'JavaScript', difficulty: 2, timeLimit: 90,
		text: 'Which expression correctly checks that the variable `value` is an array?',
		options: ['Array.isArray(value)', 'value instanceof ArrayList', 'typeof value === "array"', 'value.isArray()'],
		correct: 'Array.isArray(value)',
		explanation: 'Array.isArray() is the reliable check; typeof an array is "object", and there is no ArrayList or instance isArray() in JavaScript.',
	},
	{
		skill: 'JavaScript', difficulty: 2, timeLimit: 90,
		text: 'What does JSON.parse(\'{"a": 1}\') return?',
		options: ['A JavaScript object with property a equal to 1', 'The string unchanged', 'An array containing 1', 'A Map with key "a"'],
		correct: 'A JavaScript object with property a equal to 1',
		explanation: 'JSON.parse converts a JSON text into the corresponding JavaScript value — here an object { a: 1 }.',
	},
	{
		skill: 'JavaScript', difficulty: 2, timeLimit: 90,
		text: 'Which syntax embeds the variable `name` into a string using a template literal?',
		options: ['`Hello, ${name}`', '"Hello, {name}"', '`Hello, [name]`', '"Hello, " + {name}'],
		correct: '`Hello, ${name}`',
		explanation: 'Template literals use backticks and ${...} placeholders for interpolation.',
	},
	{
		skill: 'JavaScript', difficulty: 2, timeLimit: 90,
		text: 'What does the array method `map` return?',
		options: ['A new array of the same length with each element transformed by the callback', 'The original array, modified in place', 'A single value reduced from the array', 'The first element that satisfies the callback'],
		correct: 'A new array of the same length with each element transformed by the callback',
		explanation: 'map builds a new array by applying the callback to every element; it does not mutate the original.',
	},
	{
		skill: 'JavaScript', difficulty: 2, timeLimit: 90,
		text: 'In `function greet(name = "guest") { ... }`, when is the default value "guest" used?',
		options: ['When the argument is omitted or passed as undefined', 'Only when the argument is an empty string', 'Whenever the argument is falsy, including 0 and ""', 'Never — default parameters are a syntax error'],
		correct: 'When the argument is omitted or passed as undefined',
		explanation: 'Default parameters apply only for missing or undefined arguments; null, 0 and "" are used as given.',
	},
	{
		skill: 'JavaScript', difficulty: 2, timeLimit: 90,
		text: 'What does the expression `[...a, ...b]` produce when a and b are arrays?',
		options: ['A new array containing the elements of a followed by the elements of b', 'An array containing a and b as its two elements', 'A single merged object', 'It mutates a by appending b in place'],
		correct: 'A new array containing the elements of a followed by the elements of b',
		explanation: 'Spread in an array literal copies each element into a brand-new array; neither a nor b is modified.',
	},
	// ---------------------------------------------------------- JavaScript (L3 x7)
	{
		skill: 'JavaScript', difficulty: 3, timeLimit: 90,
		text: 'What is the output of: console.log("start"); setTimeout(() => console.log("timer"), 0); console.log("end");',
		options: ['start, end, timer', 'start, timer, end', 'timer, start, end', 'start, end (the timer callback never runs)'],
		correct: 'start, end, timer',
		explanation: 'setTimeout callbacks are asynchronous: even with a 0 ms delay the callback runs only after the current synchronous code finishes.',
	},
	{
		skill: 'JavaScript', difficulty: 3, timeLimit: 90,
		text: 'A `let` variable is declared later in the same block. What happens if code reads it before the declaration line runs?',
		options: ['A ReferenceError is thrown (temporal dead zone)', 'It evaluates to undefined', 'It evaluates to null', 'The declaration is hoisted and the read returns the later value'],
		correct: 'A ReferenceError is thrown (temporal dead zone)',
		explanation: 'let/const declarations are hoisted but not initialised; accessing them in the temporal dead zone throws a ReferenceError.',
	},
	{
		skill: 'JavaScript', difficulty: 3, timeLimit: 90,
		text: 'What does Object.keys({ a: 1, b: 2 }) return?',
		options: ['["a", "b"]', '["1", "2"]', '[["a", 1], ["b", 2]]', '2'],
		correct: '["a", "b"]',
		explanation: 'Object.keys returns the object\'s own enumerable string keys; values are returned by Object.values and pairs by Object.entries.',
	},
	{
		skill: 'JavaScript', difficulty: 3, timeLimit: 90,
		text: 'In `const { name: userName } = user;`, what is created?',
		options: ['A constant `userName` holding user.name', 'A constant `name` holding user.userName', 'A new property userName on user', 'A renamed property on the user object'],
		correct: 'A constant `userName` holding user.name',
		explanation: 'In destructuring, `property: variable` renames: the value of user.name is bound to the new variable userName; the object is unchanged.',
	},
	{
		skill: 'JavaScript', difficulty: 3, timeLimit: 90,
		text: 'Why pass an initial value as the second argument to Array.prototype.reduce?',
		options: ['It defines the accumulator\'s starting value, so the callback also runs for the first element and empty arrays do not throw', 'It limits how many elements reduce will visit', 'It converts the result to that value\'s type', 'It makes reduce run in parallel'],
		correct: 'It defines the accumulator\'s starting value, so the callback also runs for the first element and empty arrays do not throw',
		explanation: 'Without an initial value the first element becomes the accumulator and reduce throws on an empty array; the initial value removes both hazards.',
	},
	{
		skill: 'JavaScript', difficulty: 3, timeLimit: 90,
		text: 'Which statement about null and undefined is correct?',
		options: ['undefined usually means a variable was declared but never assigned; null is an intentionally assigned "no value"', 'They are two names for exactly the same value', 'null means a variable was never declared', 'undefined can only be produced by a function with no return statement — variables always get null'],
		correct: 'undefined usually means a variable was declared but never assigned; null is an intentionally assigned "no value"',
		explanation: 'undefined is the language\'s "absent" value (unassigned variables, missing properties, no return); null is a value developers assign deliberately to mean "empty".',
	},
	{
		skill: 'JavaScript', difficulty: 3, timeLimit: 90,
		text: 'What does Promise.race([p1, p2]) settle with?',
		options: ['The outcome (fulfilment or rejection) of whichever promise settles first', 'The values of all promises, in input order', 'The outcome of the slowest promise', 'The first fulfilled promise, ignoring rejections'],
		correct: 'The outcome (fulfilment or rejection) of whichever promise settles first',
		explanation: 'Promise.race adopts the first settlement of any input promise, whether it fulfils or rejects; Promise.all waits for all, Promise.any takes the first fulfilment.',
	},
	// ---------------------------------------------------------- JavaScript (L4 x6)
	{
		skill: 'JavaScript', difficulty: 4, timeLimit: 120,
		text: 'Which statement about WeakMap is correct?',
		options: ['Its keys must be objects, are held weakly, and do not prevent garbage collection of the keys', 'Its keys can be any primitive value', 'It is iterable with for...of like a Map', 'Entries keep their key objects alive as long as the WeakMap exists'],
		correct: 'Its keys must be objects, are held weakly, and do not prevent garbage collection of the keys',
		explanation: 'WeakMap keys must be objects and are weakly referenced: once no other reference to a key exists, the entry can be collected. WeakMap is not iterable.',
	},
	{
		skill: 'JavaScript', difficulty: 4, timeLimit: 120,
		text: 'What happens when a generator function\'s body reaches a `yield` expression?',
		options: ['Execution pauses, the yielded value is returned to the caller, and the function later resumes where it stopped', 'The function returns and cannot be resumed', 'The yielded value is pushed onto a global queue', 'The generator restarts from the beginning on the next call'],
		correct: 'Execution pauses, the yielded value is returned to the caller, and the function later resumes where it stopped',
		explanation: 'yield suspends the generator with its local state intact; the next .next() call resumes execution right after the yield.',
	},
	{
		skill: 'JavaScript', difficulty: 4, timeLimit: 120,
		text: 'In a Proxy handler, what does the `get` trap intercept?',
		options: ['Reads of properties on the proxied object', 'Writes of properties on the proxied object', 'Calls of the proxied object as a function', 'Deletion of properties on the proxied object'],
		correct: 'Reads of properties on the proxied object',
		explanation: 'The get trap runs on property reads; writes use set, function calls use apply, and deletions use deleteProperty.',
	},
	{
		skill: 'JavaScript', difficulty: 4, timeLimit: 120,
		text: 'What does structuredClone(value) provide that JSON.parse(JSON.stringify(value)) does not?',
		options: ['A deep clone that also handles values like Date, Map, Set and circular references', 'A faster clone, but only for flat objects', 'A clone that keeps references to the original nested objects', 'A serialised string representation of the value'],
		correct: 'A deep clone that also handles values like Date, Map, Set and circular references',
		explanation: 'structuredClone performs a true deep clone of the structured-cloneable types (including Date, Map, Set, typed arrays and cycles), which the JSON round-trip loses or rejects.',
	},
	{
		skill: 'JavaScript', difficulty: 4, timeLimit: 120,
		text: 'What is the output order of: console.log("a"); setTimeout(() => console.log("b"), 0); Promise.resolve().then(() => console.log("c")); console.log("d");',
		options: ['a, d, c, b', 'a, d, b, c', 'a, c, d, b', 'a, b, c, d'],
		correct: 'a, d, c, b',
		explanation: 'Synchronous code runs first (a, d). The promise callback is a microtask and runs before the setTimeout macrotask (c before b).',
	},
	{
		skill: 'JavaScript', difficulty: 4, timeLimit: 120,
		text: 'Which statement about Symbol values is correct?',
		options: ['Every Symbol() call creates a value guaranteed unique, even from another Symbol() with the same description', 'Two Symbol("id") calls return the same value', 'Symbols are automatically converted to strings when used as object keys', 'A Symbol can be created with the `new` keyword'],
		correct: 'Every Symbol() call creates a value guaranteed unique, even from another Symbol() with the same description',
		explanation: 'Symbol() always mints a fresh unique primitive; the description is only a label. Symbols are not constructed with new.',
	},
	// ---------------------------------------------------------- Python (L2 x6)
	{
		skill: 'Python', difficulty: 2, timeLimit: 90,
		text: 'What does len("python") evaluate to?',
		options: ['6', '5', '7', 'It raises TypeError'],
		correct: '6',
		explanation: 'len() returns the number of characters in the string: p-y-t-h-o-n = 6.',
	},
	{
		skill: 'Python', difficulty: 2, timeLimit: 90,
		text: 'What does scores.get("amy", 0) do when "amy" is not a key in the dictionary scores?',
		options: ['Returns 0 without raising an error', 'Raises KeyError', 'Returns None', 'Adds "amy" to the dictionary'],
		correct: 'Returns 0 without raising an error',
		explanation: 'dict.get(key, default) returns the default when the key is absent, instead of raising KeyError like scores["amy"] would.',
	},
	{
		skill: 'Python', difficulty: 2, timeLimit: 90,
		text: 'What is the value of [10, 20, 30, 40][1:3]?',
		options: ['[20, 30]', '[10, 20]', '[20, 30, 40]', '[10, 20, 30]'],
		correct: '[20, 30]',
		explanation: 'A slice includes the start index and excludes the stop index: indexes 1 and 2 give 20 and 30.',
	},
	{
		skill: 'Python', difficulty: 2, timeLimit: 90,
		text: 'Which values does range(3) produce, in order?',
		options: ['0, 1, 2', '1, 2, 3', '0, 1, 2, 3', '1, 2'],
		correct: '0, 1, 2',
		explanation: 'range(n) starts at 0 and stops before n, so range(3) yields 0, 1, 2.',
	},
	{
		skill: 'Python', difficulty: 2, timeLimit: 90,
		text: 'Given name = "Sam", what does f"Hi {name}" evaluate to?',
		options: ['"Hi Sam"', '"Hi {name}"', '"Hi name"', 'It raises SyntaxError'],
		correct: '"Hi Sam"',
		explanation: 'An f-string evaluates the expressions inside braces and inserts their values into the string.',
	},
	{
		skill: 'Python', difficulty: 2, timeLimit: 90,
		text: 'What is bool([]) in Python?',
		options: ['False', 'True', 'None', 'It raises ValueError'],
		correct: 'False',
		explanation: 'Empty containers are falsy in Python; a non-empty list would be truthy.',
	},
	// ---------------------------------------------------------- Python (L3 x7)
	{
		skill: 'Python', difficulty: 3, timeLimit: 90,
		text: 'Why is `def add(item, bucket=[])` a well-known pitfall?',
		options: ['The default list is created once and shared between calls, so mutations leak across calls', 'Lists cannot be used as default values at all', 'The default is re-created on every call, wasting memory', 'It only accepts one call per program run'],
		correct: 'The default list is created once and shared between calls, so mutations leak across calls',
		explanation: 'Default argument values are evaluated once at function definition time; a mutable default is shared by every call that omits it. The usual fix is bucket=None plus creating the list inside.',
	},
	{
		skill: 'Python', difficulty: 3, timeLimit: 90,
		text: 'What does enumerate(["a", "b"]) yield?',
		options: ['(0, "a") then (1, "b")', '("a", 0) then ("b", 1)', '(1, "a") then (2, "b")', 'Only the indexes 0 and 1'],
		correct: '(0, "a") then (1, "b")',
		explanation: 'enumerate pairs each element with its index, counting from 0 by default.',
	},
	{
		skill: 'Python', difficulty: 3, timeLimit: 90,
		text: 'What does {x: x * x for x in range(3)} evaluate to?',
		options: ['{0: 0, 1: 1, 2: 4}', '{0: 0, 1: 1, 2: 2}', '[0, 1, 4]', '{1: 1, 2: 4, 3: 9}'],
		correct: '{0: 0, 1: 1, 2: 4}',
		explanation: 'This dictionary comprehension maps each x in 0..2 to its square: 0→0, 1→1, 2→4.',
	},
	{
		skill: 'Python', difficulty: 3, timeLimit: 90,
		text: 'Which statement about `is` and `==` is correct?',
		options: ['`is` compares object identity; `==` compares values', '`is` compares values; `==` compares identity', 'They are fully interchangeable', '`==` only works on numbers'],
		correct: '`is` compares object identity; `==` compares values',
		explanation: 'Two distinct objects can be equal by value (==) without being the same object (is). Identity comparison is the right test for singletons like None.',
	},
	{
		skill: 'Python', difficulty: 3, timeLimit: 90,
		text: 'In a try/except/else statement, when does the else block run?',
		options: ['Only when the try block completes without raising an exception', 'Only when an exception was caught', 'Always, after the except block', 'Instead of finally, which it replaces'],
		correct: 'Only when the try block completes without raising an exception',
		explanation: 'The else clause runs when the try suite succeeds; it keeps code that is not part of the risky operation out of the exception handler\'s scope.',
	},
	{
		skill: 'Python', difficulty: 3, timeLimit: 90,
		text: 'What does sorted(words, key=len) do?',
		options: ['Returns a new list of the words ordered by their length', 'Sorts words in place by length and returns None', 'Returns only the longest word', 'Groups the words by length into a dict'],
		correct: 'Returns a new list of the words ordered by their length',
		explanation: 'sorted() builds a new list, using the key function\'s return value (here each word\'s length) as the comparison key; the original list is untouched.',
	},
	{
		skill: 'Python', difficulty: 3, timeLimit: 90,
		text: 'In `def send(**kwargs)`, what type is kwargs inside the function?',
		options: ['A dictionary of the keyword arguments', 'A tuple of the keyword arguments', 'A list of the argument names only', 'A string of the raw call text'],
		correct: 'A dictionary of the keyword arguments',
		explanation: '**kwargs collects the keyword arguments into a dict keyed by argument name; *args collects positionals into a tuple.',
	},
	// ---------------------------------------------------------- Python (L4 x6)
	{
		skill: 'Python', difficulty: 4, timeLimit: 120,
		text: 'What is a decorator in Python?',
		options: ['A callable that takes a function and returns a (possibly different) function, applied with @ syntax', 'A comment that documents a function for the interpreter', 'A keyword that makes a function run asynchronously', 'A built-in that compiles a function to machine code'],
		correct: 'A callable that takes a function and returns a (possibly different) function, applied with @ syntax',
		explanation: '@deco above def f is exactly f = deco(f): the decorator receives the function and its return value replaces it.',
	},
	{
		skill: 'Python', difficulty: 4, timeLimit: 120,
		text: 'Which pair of methods must a class define to be used as a context manager with the `with` statement?',
		options: ['__enter__ and __exit__', '__open__ and __close__', '__start__ and __stop__', '__init__ and __del__'],
		correct: '__enter__ and __exit__',
		explanation: 'The with statement calls __enter__ on entry (its return value is bound by `as`) and __exit__ on exit, including when an exception propagates.',
	},
	{
		skill: 'Python', difficulty: 4, timeLimit: 120,
		text: 'Why do multiple threads in CPython typically fail to speed up a purely CPU-bound computation?',
		options: ['The Global Interpreter Lock lets only one thread execute Python bytecode at a time in a process', 'Threads in Python can only perform I/O', 'CPython creates threads but never schedules them', 'Each thread gets its own copy of the data, doubling the work'],
		correct: 'The Global Interpreter Lock lets only one thread execute Python bytecode at a time in a process',
		explanation: 'The GIL serialises bytecode execution, so CPU-bound threads take turns; threads still help I/O-bound work, and CPU parallelism needs multiple processes or GIL-releasing extensions.',
	},
	{
		skill: 'Python', difficulty: 4, timeLimit: 120,
		text: 'What is the main effect of defining __slots__ in a class?',
		options: ['Instances store the listed attributes in fixed slots instead of a per-instance __dict__, reducing memory and preventing undeclared attributes', 'It makes the class thread-safe', 'It turns the listed attributes into class-level constants', 'It encrypts the listed attributes at rest'],
		correct: 'Instances store the listed attributes in fixed slots instead of a per-instance __dict__, reducing memory and preventing undeclared attributes',
		explanation: '__slots__ reserves fixed storage per instance: lower memory for many small objects, and assigning an attribute not in __slots__ raises AttributeError.',
	},
	{
		skill: 'Python', difficulty: 4, timeLimit: 120,
		text: 'What does a metaclass control in Python?',
		options: ['How classes themselves are created — it is the type of a class', 'How instances copy themselves', 'How modules are imported from disk', 'How exceptions are formatted'],
		correct: 'How classes themselves are created — it is the type of a class',
		explanation: 'A class is an instance of its metaclass (type by default); a custom metaclass can intercept class creation, e.g. to register or validate the new class.',
	},
	{
		skill: 'Python', difficulty: 4, timeLimit: 120,
		text: 'What is the difference between copy.copy(x) and copy.deepcopy(x) for a list containing a nested list?',
		options: ['copy copies only the outer list, so the nested list is still shared; deepcopy recursively copies the nested objects too', 'They behave identically for nested structures', 'copy raises on nested lists; deepcopy flattens them', 'deepcopy copies only the outer list; copy is the recursive one'],
		correct: 'copy copies only the outer list, so the nested list is still shared; deepcopy recursively copies the nested objects too',
		explanation: 'A shallow copy duplicates the container but keeps references to the same contained objects; deepcopy walks the structure and duplicates every reachable object.',
	},
	// ---------------------------------------------------------- React (L2 x6)
	{
		skill: 'React', difficulty: 2, timeLimit: 90,
		text: 'Which statement about props in React is correct?',
		options: ['Props are read-only for the receiving component; a component must never modify its own props', 'A component may freely reassign its props', 'Props are global variables shared by all components', 'Props can only hold strings and numbers'],
		correct: 'Props are read-only for the receiving component; a component must never modify its own props',
		explanation: 'React components must act like pure functions with respect to their props — props are inputs owned by the parent, never mutated by the child.',
	},
	{
		skill: 'React', difficulty: 2, timeLimit: 90,
		text: 'What is the purpose of a fragment (<>...</>) in JSX?',
		options: ['To group multiple elements without adding an extra DOM node', 'To start a background data fetch', 'To mark elements as invisible', 'To create a new component'],
		correct: 'To group multiple elements without adding an extra DOM node',
		explanation: 'A component must return a single element; a fragment groups children without rendering a wrapper element into the DOM.',
	},
	{
		skill: 'React', difficulty: 2, timeLimit: 90,
		text: 'In JSX, what renders when the expression is {isAdmin && <Panel />} and isAdmin is false?',
		options: ['Nothing (false renders as empty)', 'The text "false" as a heading', 'The Panel with all controls disabled', 'A render error is thrown'],
		correct: 'Nothing (false renders as empty)',
		explanation: 'React renders nothing for false, null or undefined, so the && pattern shows the element only when the condition is truthy.',
	},
	{
		skill: 'React', difficulty: 2, timeLimit: 90,
		text: 'What is the most common use of the useRef hook?',
		options: ['To hold a mutable value (often a DOM element) that persists across renders without causing a re-render when changed', 'To store state that re-renders the component when changed', 'To fetch data when the component mounts', 'To memoize an expensive calculation'],
		correct: 'To hold a mutable value (often a DOM element) that persists across renders without causing a re-render when changed',
		explanation: 'A ref is a stable box with a .current property: writing to it does not schedule a render, which makes it right for DOM nodes and render-independent values.',
	},
	{
		skill: 'React', difficulty: 2, timeLimit: 90,
		text: 'A button should call save() only when clicked. Which JSX is correct?',
		options: ['<button onClick={save}>Save</button>', '<button onClick={save()}>Save</button>', '<button onClick="save">Save</button>', '<button click={save}>Save</button>'],
		correct: '<button onClick={save}>Save</button>',
		explanation: 'Event props receive the function itself; onClick={save()} would call save during render and pass its return value as the handler.',
	},
	{
		skill: 'React', difficulty: 2, timeLimit: 90,
		text: 'In a component definition `function Card({ children })`, what does `children` contain?',
		options: ['Whatever JSX was placed between <Card> and </Card> where the component is used', 'The component\'s state values', 'A list of the component\'s child components by name', 'The DOM nodes rendered by the parent page'],
		correct: 'Whatever JSX was placed between <Card> and </Card> where the component is used',
		explanation: 'React passes nested JSX as the special children prop, which is how wrapper/layout components render content they do not know about in advance.',
	},
	// ---------------------------------------------------------- React (L3 x7)
	{
		skill: 'React', difficulty: 3, timeLimit: 90,
		text: 'What does "lifting state up" mean in React?',
		options: ['Moving shared state into the closest common ancestor so sibling components read and update the same value', 'Storing all state in the browser\'s localStorage', 'Moving state declarations to the top of the file', 'Converting local state into module-level variables'],
		correct: 'Moving shared state into the closest common ancestor so sibling components read and update the same value',
		explanation: 'When siblings must stay in sync, the state lives in their common parent and flows down as props; duplicating it in each sibling lets the copies diverge.',
	},
	{
		skill: 'React', difficulty: 3, timeLimit: 90,
		text: 'An effect is declared as useEffect(setup, []). When does setup run?',
		options: ['Once, after the component first renders (mounts)', 'After every render', 'Before the component\'s first render', 'Only when the component unmounts'],
		correct: 'Once, after the component first renders (mounts)',
		explanation: 'An empty dependency array tells React the effect depends on nothing that changes, so it runs after the initial render and its cleanup runs at unmount.',
	},
	{
		skill: 'React', difficulty: 3, timeLimit: 90,
		text: 'A click handler runs setCount(count + 1) twice while count is 5. After the next render, what is count if no other updates occur?',
		options: ['6 — both calls computed 5 + 1 from the same rendered value', '7 — the calls are applied one after another', '5 — duplicate calls are discarded entirely', '10 — React multiplies repeated updates'],
		correct: '6 — both calls computed 5 + 1 from the same rendered value',
		explanation: 'State is a snapshot for the current render: both calls read count = 5 and set 6. To accumulate, use the updater form setCount(c => c + 1) twice.',
	},
	{
		skill: 'React', difficulty: 3, timeLimit: 90,
		text: 'What problem does React Context solve?',
		options: ['Passing values such as theme or the signed-in user to many descendants without threading props through every intermediate component', 'Storing state so it survives a page reload', 'Replacing the need for keys in lists', 'Making state updates synchronous'],
		correct: 'Passing values such as theme or the signed-in user to many descendants without threading props through every intermediate component',
		explanation: 'A provider makes a value available to its subtree; any descendant can consume it with useContext instead of receiving it via "prop drilling".',
	},
	{
		skill: 'React', difficulty: 3, timeLimit: 90,
		text: 'When is useReducer usually a better fit than several useState calls?',
		options: ['When the next state is computed from the previous state through a set of named actions and the update logic is complex or shared', 'When the state is a single string', 'When the value must persist in localStorage', 'When the component renders a list'],
		correct: 'When the next state is computed from the previous state through a set of named actions and the update logic is complex or shared',
		explanation: 'A reducer centralises transitions (action → new state), which keeps complex, multi-field state changes predictable and testable; simple independent values stay clearer as useState.',
	},
	{
		skill: 'React', difficulty: 3, timeLimit: 90,
		text: 'What happens when a component\'s `key` changes between renders at the same position in the tree?',
		options: ['React treats it as a different component instance: the old one unmounts and a new one mounts with fresh state', 'Only the key prop updates; state is fully preserved', 'React throws an error because keys are immutable', 'The component re-renders but keeps its DOM node and state'],
		correct: 'React treats it as a different component instance: the old one unmounts and a new one mounts with fresh state',
		explanation: 'Key is part of an element\'s identity: changing it is the standard way to deliberately reset a component\'s state by remounting it.',
	},
	{
		skill: 'React', difficulty: 3, timeLimit: 90,
		text: 'What does wrapping a component in React.memo do?',
		options: ['It skips re-rendering the component when its new props are shallowly equal to the previous props', 'It caches the component\'s rendered DOM forever', 'It prevents the component from ever receiving new props', 'It makes the component\'s state updates synchronous'],
		correct: 'It skips re-rendering the component when its new props are shallowly equal to the previous props',
		explanation: 'memo is a render optimisation: on parent re-renders, React reuses the last output if props compare shallowly equal. It does not block renders caused by the component\'s own state or context.',
	},
	// ---------------------------------------------------------- React (L4 x6)
	{
		skill: 'React', difficulty: 4, timeLimit: 120,
		text: 'What is the difference between useMemo and useCallback?',
		options: ['useMemo caches a computed value; useCallback caches a function itself', 'They are identical in every respect', 'useMemo caches a function; useCallback caches a computed value', 'useCallback runs its argument after every render'],
		correct: 'useMemo caches a computed value; useCallback caches a function itself',
		explanation: 'useMemo(fn, deps) stores fn\'s result; useCallback(fn, deps) stores fn. useCallback(fn, deps) is equivalent to useMemo(() => fn, deps).',
	},
	{
		skill: 'React', difficulty: 4, timeLimit: 120,
		text: 'An effect with an empty dependency array reads the `userId` prop and fetches that user. Why is this a stale-closure bug?',
		options: ['The effect closure captured the first render\'s userId and never re-runs, so it keeps using the outdated value after the prop changes', 'Empty dependency arrays are a syntax error when props are read', 'The fetch runs before the prop is assigned', 'React re-runs the effect but with the previous props'],
		correct: 'The effect closure captured the first render\'s userId and never re-runs, so it keeps using the outdated value after the prop changes',
		explanation: 'Each render\'s closures see that render\'s props. An effect that runs once closes over the initial userId; the fix is to include userId in the dependency array.',
	},
	{
		skill: 'React', difficulty: 4, timeLimit: 120,
		text: 'In development, what does React StrictMode intentionally do to effects?',
		options: ['It mounts, unmounts and remounts components once extra to surface effects that lack correct cleanup', 'It disables all effects so bugs are easier to see', 'It runs every effect twice concurrently on separate threads', 'It throws an error whenever an effect runs'],
		correct: 'It mounts, unmounts and remounts components once extra to surface effects that lack correct cleanup',
		explanation: 'StrictMode\'s double-invoke cycle (setup → cleanup → setup) exposes effects that are not resilient to remounting, e.g. subscriptions that are never released. It is development-only behaviour.',
	},
	{
		skill: 'React', difficulty: 4, timeLimit: 120,
		text: 'What distinguishes an uncontrolled input from a controlled input in React?',
		options: ['An uncontrolled input keeps its value in the DOM (read via a ref); a controlled input\'s value is driven by React state on every keystroke', 'Uncontrolled inputs cannot be validated', 'Controlled inputs do not trigger re-renders', 'Uncontrolled inputs are only allowed inside class components'],
		correct: 'An uncontrolled input keeps its value in the DOM (read via a ref); a controlled input\'s value is driven by React state on every keystroke',
		explanation: 'Controlled inputs take value + onChange from state, making React the source of truth; uncontrolled inputs let the DOM hold the value, typically read through a ref at submit time.',
	},
	{
		skill: 'React', difficulty: 4, timeLimit: 120,
		text: 'During reconciliation, an element at a position changes from <Profile /> to <Settings /> (different component types). What happens to Profile\'s state?',
		options: ['It is discarded: React unmounts the old tree at that position and mounts a fresh one', 'It is transferred to Settings automatically', 'It is preserved because the position in the tree is the same', 'It is stored in a global cache keyed by position'],
		correct: 'It is discarded: React unmounts the old tree at that position and mounts a fresh one',
		explanation: 'React preserves state only while the element type (and key) at a position stays the same; a different type means teardown and a fresh mount.',
	},
	{
		skill: 'React', difficulty: 4, timeLimit: 120,
		text: 'How does useLayoutEffect differ from useEffect in timing?',
		options: ['useLayoutEffect runs synchronously after DOM mutations but before the browser paints; useEffect runs after paint', 'useLayoutEffect runs before the component function executes', 'useEffect runs synchronously during rendering; useLayoutEffect runs after paint', 'There is no timing difference; the names are interchangeable'],
		correct: 'useLayoutEffect runs synchronously after DOM mutations but before the browser paints; useEffect runs after paint',
		explanation: 'Layout effects block painting until they finish, which suits measuring or adjusting the DOM to avoid visual flicker; passive useEffect work happens after the browser has painted.',
	},
	// ---------------------------------------------------------- Node.js (L2 x6)
	{
		skill: 'Node.js', difficulty: 2, timeLimit: 90,
		text: 'In a CommonJS module, how does a file make a value available to files that require it?',
		options: ['By assigning it to module.exports (or exports)', 'By declaring it with the `public` keyword', 'By returning it from the top level of the file', 'By writing it to a global registry file'],
		correct: 'By assigning it to module.exports (or exports)',
		explanation: 'require() returns exactly what the loaded module assigned to module.exports; top-level declarations otherwise stay private to the module.',
	},
	{
		skill: 'Node.js', difficulty: 2, timeLimit: 90,
		text: 'What is the primary purpose of a project\'s package.json file?',
		options: ['It records the project\'s metadata, its dependency list and its runnable scripts', 'It stores the compiled output of the application', 'It holds the environment\'s secret keys for production', 'It lists the HTTP routes the server exposes'],
		correct: 'It records the project\'s metadata, its dependency list and its runnable scripts',
		explanation: 'package.json is the project manifest: name/version, dependencies installed by npm, and the scripts run via npm run. Secrets belong outside it.',
	},
	{
		skill: 'Node.js', difficulty: 2, timeLimit: 90,
		text: 'How does a Node.js program conventionally read a configuration value supplied through the process environment, e.g. PORT?',
		options: ['process.env.PORT', 'env("PORT")', 'process.config.PORT', 'Node.env.PORT'],
		correct: 'process.env.PORT',
		explanation: 'Environment variables are exposed as strings on the process.env object.',
	},
	{
		skill: 'Node.js', difficulty: 2, timeLimit: 90,
		text: 'Why prefer path.join(__dirname, "data", "f.json") over string concatenation when building a file path?',
		options: ['It inserts the correct path separator for the operating system and normalises the result', 'It reads the file contents automatically', 'It creates the directories if they are missing', 'It makes the path case-insensitive on every system'],
		correct: 'It inserts the correct path separator for the operating system and normalises the result',
		explanation: 'path.join uses the platform separator (\\ on Windows, / elsewhere) and resolves redundant segments; hardcoded "/" concatenation breaks on Windows-style paths.',
	},
	{
		skill: 'Node.js', difficulty: 2, timeLimit: 90,
		text: 'What is a Buffer in Node.js?',
		options: ['An object representing a fixed-size chunk of raw binary data in memory', 'A queue of pending HTTP requests', 'A cache of compiled JavaScript modules', 'A writable log file managed by the runtime'],
		correct: 'An object representing a fixed-size chunk of raw binary data in memory',
		explanation: 'Buffers hold raw bytes outside the JavaScript heap and are how Node handles binary data from files, sockets and streams.',
	},
	{
		skill: 'Node.js', difficulty: 2, timeLimit: 90,
		text: 'In a CommonJS module, what does __dirname contain?',
		options: ['The absolute path of the directory containing the current module file', 'The directory the process was started from', 'The path of the main entry file', 'The user\'s home directory'],
		correct: 'The absolute path of the directory containing the current module file',
		explanation: '__dirname is per-module: the directory of the file in which it appears. The process working directory is process.cwd(), which can differ.',
	},
	// ---------------------------------------------------------- Node.js (L3 x7)
	{
		skill: 'Node.js', difficulty: 3, timeLimit: 90,
		text: 'With an EventEmitter `bus`, what does bus.emit("done", 42) do?',
		options: ['Synchronously calls every listener registered for "done", passing 42 as the argument', 'Queues the event to be delivered on the next tick of the event loop', 'Writes the value 42 to standard output', 'Returns a promise that resolves with 42'],
		correct: 'Synchronously calls every listener registered for "done", passing 42 as the argument',
		explanation: 'emit dispatches immediately and synchronously to the listeners registered with on()/once() for that event name.',
	},
	{
		skill: 'Node.js', difficulty: 3, timeLimit: 90,
		text: 'In Express, what must a middleware function call to let the request continue to the next middleware or route handler?',
		options: ['next()', 'continue()', 'res.next()', 'done()'],
		correct: 'next()',
		explanation: 'A middleware that neither ends the response nor calls next() leaves the request hanging; calling next() passes control down the chain.',
	},
	{
		skill: 'Node.js', difficulty: 3, timeLimit: 90,
		text: 'What does `const text = await fs.promises.readFile(path, "utf8")` give you?',
		options: ['The file\'s contents as a string, read asynchronously without blocking the event loop', 'A Buffer of the file contents', 'A readable stream for the file', 'The file contents read synchronously before the next line runs'],
		correct: 'The file\'s contents as a string, read asynchronously without blocking the event loop',
		explanation: 'The promises API performs the read asynchronously; with the "utf8" encoding argument the resolved value is a string rather than a Buffer.',
	},
	{
		skill: 'Node.js', difficulty: 3, timeLimit: 90,
		text: 'What is the standard error-first callback convention in Node.js?',
		options: ['The callback\'s first argument is the error (null on success) and the result follows, e.g. callback(err, data)', 'The callback receives the result first and the error last', 'Errors are returned as the callback\'s return value', 'The callback is invoked twice: once for errors, once for data'],
		correct: 'The callback\'s first argument is the error (null on success) and the result follows, e.g. callback(err, data)',
		explanation: 'Node-style callbacks reserve the first parameter for the error so callers can check `if (err)` before using the data arguments.',
	},
	{
		skill: 'Node.js', difficulty: 3, timeLimit: 90,
		text: 'What does readable.pipe(writable) do?',
		options: ['Forwards data from the readable stream into the writable stream, managing flow so the writer is not overwhelmed', 'Copies the readable stream\'s source file', 'Merges the two streams into a single duplex stream object', 'Converts the readable stream into a Buffer'],
		correct: 'Forwards data from the readable stream into the writable stream, managing flow so the writer is not overwhelmed',
		explanation: 'pipe connects source to destination and applies backpressure handling: it pauses the readable when the writable\'s internal buffer is full.',
	},
	{
		skill: 'Node.js', difficulty: 3, timeLimit: 90,
		text: 'What is the purpose of the "main" field in a package.json?',
		options: ['It names the entry-point file loaded when the package is required or run as a package', 'It names the primary database table', 'It lists the package\'s main author', 'It sets the default HTTP port'],
		correct: 'It names the entry-point file loaded when the package is required or run as a package',
		explanation: 'When another module requires the package by name, Node loads the file named by "main" (defaulting to index.js).',
	},
	{
		skill: 'Node.js', difficulty: 3, timeLimit: 90,
		text: 'What is the purpose of the child_process module?',
		options: ['To spawn and communicate with separate operating-system processes from a Node.js program', 'To create additional event loops inside the same process', 'To split an array of tasks among CPU cores automatically', 'To render child components of a server-side page'],
		correct: 'To spawn and communicate with separate operating-system processes from a Node.js program',
		explanation: 'child_process (spawn/exec/fork) runs external commands or other Node programs as real OS processes, unlike threads which share the process.',
	},
	// ---------------------------------------------------------- Node.js (L4 x6)
	{
		skill: 'Node.js', difficulty: 4, timeLimit: 120,
		text: 'Inside an I/O callback (for example an fs.readFile callback), both setImmediate(fn) and setTimeout(fn, 0) are scheduled. Which is guaranteed to run first?',
		options: ['setImmediate — it is queued for the check phase that follows the poll phase where I/O callbacks run', 'setTimeout — timers always preempt immediates', 'The order is random on every run', 'Whichever was registered first in the whole program'],
		correct: 'setImmediate — it is queued for the check phase that follows the poll phase where I/O callbacks run',
		explanation: 'From within an I/O callback the event loop proceeds to the check phase before the next timers phase, so setImmediate deterministically wins there (at program top level the order is not guaranteed).',
	},
	{
		skill: 'Node.js', difficulty: 4, timeLimit: 120,
		text: 'What is the practical difference between an uncaughtException and an unhandledRejection?',
		options: ['The first is a synchronous throw that escaped all handlers; the second is a promise that rejected with no rejection handler attached', 'They are two names for the same event', 'unhandledRejection only fires for synchronous code', 'uncaughtException is emitted by promises that time out'],
		correct: 'The first is a synchronous throw that escaped all handlers; the second is a promise that rejected with no rejection handler attached',
		explanation: 'Synchronous throws propagate to the uncaughtException handler; promise rejections without a .catch surface separately as unhandledRejection. Both indicate bugs to fix, not control flow to rely on.',
	},
	{
		skill: 'Node.js', difficulty: 4, timeLimit: 120,
		text: 'A module increments a counter in its top-level code. Two different files require that module. What do they observe?',
		options: ['Both share the single cached module instance, so the top-level code ran once and the counter state is shared', 'Each require re-executes the module, giving each file its own counter', 'The second require throws because the module is already loaded', 'Each file gets a deep copy of the module\'s state'],
		correct: 'Both share the single cached module instance, so the top-level code ran once and the counter state is shared',
		explanation: 'Node caches modules by resolved filename after the first load; subsequent requires return the same exports object.',
	},
	{
		skill: 'Node.js', difficulty: 4, timeLimit: 120,
		text: 'Which operations does libuv run on its thread pool by default in Node.js?',
		options: ['File-system operations, DNS lookups and some CPU-heavy crypto/zlib work', 'All JavaScript execution', 'HTTP request parsing', 'Garbage collection'],
		correct: 'File-system operations, DNS lookups and some CPU-heavy crypto/zlib work',
		explanation: 'libuv\'s pool (default size 4) services fs, dns.lookup, pbkdf2/scrypt and compression, which is why heavy parallel fs/crypto work can queue behind unrelated pool users.',
	},
	{
		skill: 'Node.js', difficulty: 4, timeLimit: 120,
		text: 'Why is setting process.exitCode = 1 generally preferred over calling process.exit(1) at the end of a CLI program?',
		options: ['It lets the process finish pending asynchronous work and flush output before exiting with that code, instead of terminating immediately', 'process.exit(1) deletes the program\'s output files', 'process.exitCode makes the process run forever', 'process.exit(1) always exits with code 0 on Windows'],
		correct: 'It lets the process finish pending asynchronous work and flush output before exiting with that code, instead of terminating immediately',
		explanation: 'process.exit() stops the event loop at once and can truncate buffered stdout; assigning exitCode reports failure while allowing a natural, complete shutdown.',
	},
	{
		skill: 'Node.js', difficulty: 4, timeLimit: 120,
		text: 'What does an HTTP keep-alive agent change about outgoing requests in Node.js?',
		options: ['It reuses existing TCP connections for subsequent requests to the same host instead of opening a new connection each time', 'It retries every failed request indefinitely', 'It encrypts requests before sending them', 'It caches response bodies and serves them without contacting the server'],
		correct: 'It reuses existing TCP connections for subsequent requests to the same host instead of opening a new connection each time',
		explanation: 'A keep-alive agent maintains a pool of open sockets per host, avoiding repeated TCP/TLS handshakes; it does not retry requests or cache responses.',
	},
];

module.exports = {
	name: '285_seed_batch1_question_bank',
	up: async (client) => {
		// Invariant check (scored truth): every row must have exactly 4
		// distinct options and a correct_answer identical to one of them —
		// POST /answer scores by exact string equality. Fail loudly before
		// inserting anything rather than seed an unscoreable row.
		for (const q of QUESTIONS) {
			if (!Array.isArray(q.options) || q.options.length !== 4) {
				throw new Error(`285: question must have exactly 4 options: ${q.text}`);
			}
			if (new Set(q.options).size !== q.options.length) {
				throw new Error(`285: question has duplicate options: ${q.text}`);
			}
			if (!q.options.includes(q.correct)) {
				throw new Error(`285: correct_answer is not one of the options: ${q.text}`);
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

		console.log(`C5 Batch 1 question bank seeded (${QUESTIONS.length} candidate rows, duplicate-guarded)`);
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
