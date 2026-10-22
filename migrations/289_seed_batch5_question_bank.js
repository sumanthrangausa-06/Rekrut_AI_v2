// =============================================================================
// Migration 289: C5 Batch 5 — OOP question bank from empty (issue #1695;
// parent #1658; EPIC #1603)
// =============================================================================
//
// STOP 1 (issue #1695, build brief): OOP is the one launch topic with NO
// question bank at all. Migration 279 seeded the OOP *subject*
// (assessment_subjects slug 'oop', name 'OOP'), but its default-topic list
// seeded topics for only 16 skills and OOP was not among them — so no
// assessment_topics row carries legacy_skill_name 'OOP', and no migration
// seeds any 'OOP' question rows (verified by grep across migrations/: the
// only 'OOP' hit outside this file is the 279 subject row). The topic
// therefore cannot be served at all: there is nothing to draw questions
// from and no topic for a session to attach to.
//
// This migration creates the whole bank in one step: first the missing
// topic, then exactly 29 approved MCQ at levels L1 x2 / L2 x8 / L3 x9 /
// L4 x8 / L5 x2, so the topic is born AT the design §7 floors — easy
// (L1+L2) 10, medium (L2+L3+L4) 25, hard (L4+L5) 10 (bands overlap by
// design, §5.1). Unlike Batches 1-4 (which topped up a 10-row base), the
// base here is zero, which is why this batch includes L1 and L5 rows and
// why the post-state assertion in up() pins the exact per-level counts.
//
// Topic-creation rationale: the topic insert below clones migration 279's
// own topic insert exactly (subject slug lookup, slug 'general',
// name = subject name || ' — General', legacy_skill_name = the skill
// string, sort_order 0, is_active true, ON CONFLICT (subject_id, slug)
// DO NOTHING), so the row this migration creates is indistinguishable
// from the one 279 would have created. It runs BEFORE the question
// inserts so their topic_id join resolves; if the subject were missing,
// the join would yield NULL topic_ids and the post-state assertion would
// throw rather than record success over an unservable bank.
//
// Content rules (these rows are scored truth):
//   - skill_category spells exactly as SKILL_CATALOG: 'OOP'
//     (generateQuestion matches LOWER(skill_category)).
//   - Language-neutral OOP concepts only: no language-specific syntax
//     claims, and no claim that is true in one mainstream language and
//     false in another. Stems describe behaviour and design situations,
//     not syntax.
//   - correct_answer is character-identical to one of the 4 options —
//     POST /answer scores MCQ by exact string equality. The up()
//     invariant check below throws before any insert on violation.
//   - No bare definition recall at L4/L5: those rows are applied design
//     scenarios (SOLID in use, composition vs inheritance, pattern
//     recognition). L1 rows are basic concepts; L2/L3 rows are applied
//     understanding.
//   - Every correct_answer was self-reviewed for factual correctness
//     (Nova author + Interviewer-persona self-review, per design §9 C5):
//     each row has exactly one defensible answer, and any row where a
//     knowledgeable candidate could defend a distractor was rewritten.
//   - No question duplicates a row already in the bank: no prior 'OOP'
//     rows exist to duplicate, and texts are distinct from the OOP-
//     concept rows carried under language skills (Java/JavaScript) —
//     those are syntax- or language-keyed; these are concept-keyed.
//
// Phase C provenance (design §7 rule 6(d)): every row ships source='seed',
// review_status='approved', format='mcq', topic_id resolved at insert time
// by the §6 join, LOWER(skill_category) = LOWER(legacy_skill_name).
//
// Duplicate guard: INSERT ... SELECT ... WHERE NOT EXISTS on
// (skill_category, difficulty_level, question_text). Additive only: no
// schema change, no existing question row touched. down() deletes exactly
// the rows this migration seeds (skill_category + question_text), then
// deletes the created topic ONLY if no assessment_questions,
// assessment_sessions or assessment_sets row references it — it never
// cascade-deletes user data.
// =============================================================================

const QUESTIONS = [
	// ------------------------------------------------------------- OOP (L1 x2)
	{
		skill: 'OOP', difficulty: 1, timeLimit: 60,
		text: 'In object-oriented programming, what is an object?',
		options: [
			'An instance of a class, holding its own state and able to perform the behaviours its class defines',
			'The blueprint or template from which instances are created',
			'A standalone function that is not part of any class',
			'A file in which class definitions are stored',
		],
		correct: 'An instance of a class, holding its own state and able to perform the behaviours its class defines',
		explanation: 'A class is the blueprint; an object is one concrete instance created from it, with its own field values. The blueprint itself is the class, not the object.',
	},
	{
		skill: 'OOP', difficulty: 1, timeLimit: 60,
		text: 'What does encapsulation mean in object-oriented programming?',
		options: [
			'Bundling an object’s data with the operations that work on that data, and controlling access to the internals',
			'Copying an object so that two variables refer to separate duplicates',
			'Deriving a new class from an existing class',
			'Converting an object into a text format for storage',
		],
		correct: 'Bundling an object’s data with the operations that work on that data, and controlling access to the internals',
		explanation: 'Encapsulation groups state and behaviour into one unit and exposes only a controlled interface. Deriving a class is inheritance, and converting to text is serialisation — different concepts.',
	},
	// ------------------------------------------------------------- OOP (L2 x8)
	{
		skill: 'OOP', difficulty: 2, timeLimit: 90,
		text: 'A base class Vehicle holds the fields and behaviour common to all vehicles. Car and Truck each need that common behaviour plus a little of their own. What does inheritance give this design?',
		options: [
			'Car and Truck reuse the common fields and behaviour from Vehicle and add or specialise only what differs',
			'Car and Truck each get a private copy of the Vehicle code that then evolves independently',
			'Vehicle is prevented from being used anywhere else in the system',
			'Car and Truck are forced to have exactly the same behaviour as each other',
		],
		correct: 'Car and Truck reuse the common fields and behaviour from Vehicle and add or specialise only what differs',
		explanation: 'Inheritance shares the common implementation through the base class instead of duplicating it in every subclass; each subclass still adds or specialises its own parts.',
	},
	{
		skill: 'OOP', difficulty: 2, timeLimit: 90,
		text: 'A drawing program keeps a list of different shapes. It calls draw() on each one, and each shape renders itself in its own way — a circle as a circle, a rectangle as a rectangle. Which concept is at work?',
		options: [
			'Polymorphism: the same operation call produces each object’s own implementation of that operation',
			'Encapsulation: the shapes’ data is hidden from the drawing program',
			'Composition: each shape is assembled out of other shapes',
			'Abstraction: the list hides how many shapes it contains',
		],
		correct: 'Polymorphism: the same operation call produces each object’s own implementation of that operation',
		explanation: 'One uniform call, many forms of behaviour — that is polymorphism. The scenario is not about hiding data, assembling objects, or hiding a count.',
	},
	{
		skill: 'OOP', difficulty: 2, timeLimit: 90,
		text: 'A BankAccount must never start life with a negative balance, whatever values the caller passes in. Where does that guarantee belong?',
		options: [
			'In the constructor, which validates the starting values before the new object is used',
			'In every method that reads the balance, each re-checking the value',
			'In the code that prints the account statement at the end of the month',
			'Nowhere — callers can be trusted to pass sensible values',
		],
		correct: 'In the constructor, which validates the starting values before the new object is used',
		explanation: 'The constructor is the one place every new object passes through, so validating there means no BankAccount can ever exist in the invalid starting state. Checking later leaves a window where the broken object already exists.',
	},
	{
		skill: 'OOP', difficulty: 2, timeLimit: 90,
		text: 'A BankAccount keeps its balance in a private field and offers a deposit(amount) operation that rejects non-positive amounts. Why is this better than making the balance public?',
		options: [
			'Every change to the balance must pass through the validating operation, so the balance can never be set to an invalid value from outside',
			'Private fields make the program run faster than public fields',
			'Other code can no longer read the balance at all, even through provided operations',
			'The account no longer needs any operations of its own',
		],
		correct: 'Every change to the balance must pass through the validating operation, so the balance can never be set to an invalid value from outside',
		explanation: 'Access control protects the object’s invariants: outside code can still interact through the offered operations, but it cannot bypass the checks by writing the field directly. Speed is not the reason, and controlled access is not the same as no access.',
	},
	{
		skill: 'OOP', difficulty: 2, timeLimit: 90,
		text: 'A subclass provides its own version of a method it inherits, keeping the same name and parameters, so calls on subclass objects run the new version. What is this called?',
		options: [
			'Method overriding',
			'Method overloading',
			'Encapsulation',
			'Constructor chaining',
		],
		correct: 'Method overriding',
		explanation: 'Overriding replaces an inherited method’s implementation in a subclass with the same signature. Overloading is a different mechanism: several methods sharing a name but with different parameter lists, usually in the same class.',
	},
	{
		skill: 'OOP', difficulty: 2, timeLimit: 90,
		text: 'A program must count how many objects of a class have been created in total, across the whole run. Individual objects come and go. What kind of member should hold that count?',
		options: [
			'A class-level (static) member, shared by the class as a whole rather than held per object',
			'An ordinary instance field, because every object can keep its own count',
			'A local variable inside the constructor, reset on each creation',
			'A constant fixed when the class is written',
		],
		correct: 'A class-level (static) member, shared by the class as a whole rather than held per object',
		explanation: 'The total belongs to the class, not to any one object, so it must live in one shared place that survives individual objects. Per-object fields would each hold a separate partial value, and a constructor local disappears as soon as creation finishes.',
	},
	{
		skill: 'OOP', difficulty: 2, timeLimit: 90,
		text: 'A Car class holds an Engine object in one of its fields and delegates starting work to it, instead of Car extending Engine. What relationship is this?',
		options: [
			'Composition: the car has an engine and reuses its behaviour through that part',
			'Inheritance: the car is a kind of engine',
			'Polymorphism: the engine and the car respond to the same calls',
			'Overriding: the car replaces the engine’s methods with its own',
		],
		correct: 'Composition: the car has an engine and reuses its behaviour through that part',
		explanation: 'A has-a relationship implemented by holding the part as a field and delegating to it is composition. A car is not a kind of engine, so inheritance would model the relationship wrongly.',
	},
	{
		skill: 'OOP', difficulty: 2, timeLimit: 90,
		text: 'Several unrelated classes — Invoice, Photo and Report — must all be usable by a printing component that only cares that they can produce a printable form. What design element expresses that shared promise?',
		options: [
			'An interface (contract) naming the required operation, which each class implements in its own way',
			'A single base class that all three must extend, sharing one implementation',
			'A shared global function that inspects which class it received',
			'A rule that all three classes must use the same field names',
		],
		correct: 'An interface (contract) naming the required operation, which each class implements in its own way',
		explanation: 'An interface states what an object can do without saying how, so unrelated classes can offer the same capability and clients depend only on the contract. Forcing one shared base class couples classes that have nothing else in common.',
	},
	// ------------------------------------------------------------- OOP (L3 x9)
	{
		skill: 'OOP', difficulty: 3, timeLimit: 90,
		text: 'A payment component exposes a single pay(amount) operation. Behind it sit currency conversion, fraud checks, gateway calls and retries, none of which callers ever see. Which concept is primarily at work?',
		options: [
			'Abstraction: a complex reality is presented through a simple, essential interface that omits the implementation detail',
			'Inheritance: the component is derived from a more general payment class',
			'Overloading: several operations share the name pay with different parameters',
			'Composition: the component is assembled from unrelated objects',
		],
		correct: 'Abstraction: a complex reality is presented through a simple, essential interface that omits the implementation detail',
		explanation: 'Abstraction is about what is shown: an essential, simplified view with the complexity behind it. Nothing in the scenario concerns derivation, same-named operations, or assembling parts.',
	},
	{
		skill: 'OOP', difficulty: 3, timeLimit: 90,
		text: 'Which statement expresses the Liskov Substitution Principle?',
		options: [
			'An object of a subclass should be usable anywhere an object of its base class is expected, without breaking the behaviour callers rely on',
			'A class should have only one reason to change',
			'A class should be open for extension but closed for modification',
			'High-level code should depend on abstractions rather than concrete classes',
		],
		correct: 'An object of a subclass should be usable anywhere an object of its base class is expected, without breaking the behaviour callers rely on',
		explanation: 'Substitutability is Liskov. The other statements are the Single Responsibility, Open/Closed and Dependency Inversion principles respectively — related SOLID principles, but different rules.',
	},
	{
		skill: 'OOP', difficulty: 3, timeLimit: 90,
		text: 'One class calculates invoice totals, formats and sends email notifications, and writes records to storage. Reviewers flag it as hard to change and hard to test. What is the core problem?',
		options: [
			'It has low cohesion: it bundles unrelated responsibilities that change for different reasons and belong in separate classes',
			'It has too many objects: each responsibility should be merged into one larger class',
			'It uses encapsulation: its fields should all be made public so tests can reach them',
			'It is an abstract class: it should be made concrete so it can be used',
		],
		correct: 'It has low cohesion: it bundles unrelated responsibilities that change for different reasons and belong in separate classes',
		explanation: 'A cohesive class does one closely related job. Pricing rules, mail delivery and storage change for unrelated reasons, so keeping them together means every change risks the others and tests must set up all three concerns at once.',
	},
	{
		skill: 'OOP', difficulty: 3, timeLimit: 90,
		text: 'An OrderService currently creates a specific concrete database class inside itself wherever it needs storage, and the team wants to swap storage implementations and unit-test the service in isolation. What change reduces this coupling?',
		options: [
			'Have OrderService depend on a storage interface and receive the concrete implementation from outside (injection), instead of constructing it',
			'Copy the storage code into OrderService so it no longer calls another class',
			'Make the storage class’s methods all class-level so no object is needed',
			'Rename the concrete storage class so the dependency is less visible',
		],
		correct: 'Have OrderService depend on a storage interface and receive the concrete implementation from outside (injection), instead of constructing it',
		explanation: 'Depending on an abstraction that is supplied from outside lets the implementation be swapped and a test double substituted. Copying code in increases coupling, and the other options leave the hard dependency exactly as it was.',
	},
	{
		skill: 'OOP', difficulty: 3, timeLimit: 90,
		text: 'A family of related classes (for example different document types) shares common stored state and a common implemented helper behaviour, and must also each provide their own version of one operation. Which mechanism fits best?',
		options: [
			'An abstract class: it can carry the shared state and implemented helper, while subclasses supply the operation that varies',
			'An interface alone: interfaces are the mechanism for sharing stored state and implemented helpers among subclasses',
			'Duplicating the shared state and helper code into each class separately',
			'A single concrete class with a type field and conditional branches for each document type',
		],
		correct: 'An abstract class: it can carry the shared state and implemented helper, while subclasses supply the operation that varies',
		explanation: 'Sharing state and implemented behaviour through a common parent is exactly what an abstract class provides, with the varying operation left to subclasses. An interface defines a contract; it is not the vehicle for shared stored state, and duplication or type-switch branches recreate the maintenance problem.',
	},
	{
		skill: 'OOP', difficulty: 3, timeLimit: 90,
		text: 'A variable declared as type Shape holds a Triangle object. When area() is called through that variable, the Triangle version of area() runs, not the Shape version. Why?',
		options: [
			'The method is selected at run time based on the actual object’s class — dynamic dispatch — not from the variable’s declared type',
			'The method is selected when the code is compiled, from the variable’s declared type',
			'Triangle objects automatically replace every Shape method everywhere',
			'The declared type of a variable is ignored for all purposes once an object is assigned',
		],
		correct: 'The method is selected at run time based on the actual object’s class — dynamic dispatch — not from the variable’s declared type',
		explanation: 'Overridden methods dispatch on the runtime type of the object, which is what makes polymorphism work through base-type references. The declared type still matters elsewhere — for example, it limits which operations the caller may request.',
	},
	{
		skill: 'OOP', difficulty: 3, timeLimit: 90,
		text: 'A Money value object cannot be altered after it is created; operations that “change” the amount return a new Money object instead. What is the main benefit of this immutability?',
		options: [
			'Money objects can be shared and passed around freely, because no holder can change a value another holder is relying on',
			'Money objects use less memory than mutable objects in all cases',
			'Callers no longer need to check the amount before using it',
			'The class no longer needs a constructor',
		],
		correct: 'Money objects can be shared and passed around freely, because no holder can change a value another holder is relying on',
		explanation: 'If state cannot change after creation, aliasing is harmless: no defensive copying and no surprise mutations mid-calculation. Immutability says nothing general about memory use, and values still need validation when created and used.',
	},
	{
		skill: 'OOP', difficulty: 3, timeLimit: 90,
		text: 'A Library is modelled as having Books, but if the library closes, the books still exist and can be moved elsewhere. An Engine, by contrast, is modelled as part of one Car for that car’s whole life. Which pairing is correct?',
		options: [
			'Library–Book is aggregation (a has-a where parts exist independently); Car–Engine here is composition (a has-a where the part’s lifetime is bound to the whole)',
			'Both relationships are inheritance, because both use the words “has a”',
			'Library–Book is composition, because the library contains the books',
			'Car–Engine is aggregation, because engines can be manufactured separately',
		],
		correct: 'Library–Book is aggregation (a has-a where parts exist independently); Car–Engine here is composition (a has-a where the part’s lifetime is bound to the whole)',
		explanation: 'The distinguishing test is lifetime dependence, as the scenario states it: books survive the library (aggregation), while the engine is modelled as living and ending with its car (composition). Both are has-a relationships, not inheritance.',
	},
	{
		skill: 'OOP', difficulty: 3, timeLimit: 90,
		text: 'A base class has a helper that its subclasses legitimately need to use, but code outside the class family must not be able to call it. Which access level is designed for exactly this?',
		options: [
			'Protected: visible to the class itself and its subclasses, but not to unrelated outside code',
			'Public: visible to every caller',
			'Private: visible only inside the class that declares it, not even to subclasses',
			'No access control is possible for helpers; they must always be public',
		],
		correct: 'Protected: visible to the class itself and its subclasses, but not to unrelated outside code',
		explanation: 'Protected sits between private and public for precisely this case: the class family can use the member, the outside world cannot. Private would lock out the subclasses that need it; public would open it to everyone.',
	},
	// ------------------------------------------------------------- OOP (L4 x8)
	{
		skill: 'OOP', difficulty: 4, timeLimit: 120,
		text: 'A team models every new notification kind by adding another level to an inheritance tree. The tree is now five levels deep, a small change in a top-level class keeps breaking distant subclasses, and one new kind needs behaviour from two different branches. What is the best redesign?',
		options: [
			'Favour composition: give the notification class behaviour objects (for formatting, sending, retrying) that can be combined freely, instead of encoding every combination in the class tree',
			'Add a sixth level to the tree so the new kind has somewhere to sit',
			'Copy the needed behaviour from the second branch into the new class',
			'Make the top-level class’s fields public so subclasses can work around the breakage',
		],
		correct: 'Favour composition: give the notification class behaviour objects (for formatting, sending, retrying) that can be combined freely, instead of encoding every combination in the class tree',
		explanation: 'Deep trees couple every subclass to the whole chain above it and cannot express behaviour combined from two branches. Composing pluggable parts gives the combinations without the fragility; the other options deepen the tree, duplicate behaviour, or weaken encapsulation.',
	},
	{
		skill: 'OOP', difficulty: 4, timeLimit: 120,
		text: 'Every time marketing introduces a new discount kind, developers must edit the well-tested PricingEngine class to add another branch, and twice this has broken existing discounts. Which redesign applies the Open/Closed Principle?',
		options: [
			'Define a discount contract, implement each discount kind as its own class, and let PricingEngine work with any of them unchanged when a new kind is added',
			'Keep editing PricingEngine, but add more tests around the branches',
			'Move the branches into one very long method so the class has fewer methods to edit',
			'Let marketing edit the PricingEngine code directly so changes arrive faster',
		],
		correct: 'Define a discount contract, implement each discount kind as its own class, and let PricingEngine work with any of them unchanged when a new kind is added',
		explanation: 'Open for extension, closed for modification: new behaviour arrives as new code behind the existing contract, so the proven engine is not reopened for every change. More tests reduce risk but keep the modify-to-extend design the principle targets.',
	},
	{
		skill: 'OOP', difficulty: 4, timeLimit: 120,
		text: 'A checkout service directly constructs one specific text-message provider class in several places. The provider is being replaced, the service cannot be unit-tested without sending real messages, and pricing logic is tangled with provider details. What is the root design flaw and its fix?',
		options: [
			'The high-level service depends on a concrete low-level provider; fix it by depending on a messaging abstraction and supplying the chosen provider from outside',
			'The service has too few responsibilities; fix it by also handling email and push itself',
			'The provider class is too small; fix it by merging it into the checkout service',
			'The flaw is that messages are sent at all; fix it by logging messages instead of sending them',
		],
		correct: 'The high-level service depends on a concrete low-level provider; fix it by depending on a messaging abstraction and supplying the chosen provider from outside',
		explanation: 'This is the Dependency Inversion pattern of failure: policy (checkout) is welded to detail (one provider), so swapping or faking the provider is impossible. Depending on an abstraction with the implementation injected reverses the dependency; the other options increase the coupling or remove the feature.',
	},
	{
		skill: 'OOP', difficulty: 4, timeLimit: 120,
		text: 'Square is modelled as a subclass of Rectangle, reusing its width and height fields. To stay square, setting its width also changes its height. Client code that sets a rectangle’s width and height independently and then checks the area now computes wrong results for squares. What has gone wrong?',
		options: [
			'The subclass violates substitutability: a Square cannot honour the behaviour contract callers expect from a Rectangle, so it should not inherit from it',
			'Nothing: a square is a rectangle, so the inheritance is correct by definition',
			'The client code is wrong to ever set width and height independently',
			'The area calculation should be removed from Rectangle so the problem disappears',
		],
		correct: 'The subclass violates substitutability: a Square cannot honour the behaviour contract callers expect from a Rectangle, so it should not inherit from it',
		explanation: 'Geometric “is-a” is not the test — behavioural substitutability is. Rectangle callers rely on width and height varying independently; Square breaks that reliance, which is the classic Liskov violation. Modelling the two as separate shapes behind a common abstraction avoids it.',
	},
	{
		skill: 'OOP', difficulty: 4, timeLimit: 120,
		text: 'A single Worker interface declares run(), eat() and attendMeeting(). A robot worker class must implement it, so its eat() and attendMeeting() are empty stubs that do nothing. What is the design problem and the standard remedy?',
		options: [
			'The interface is too fat: it forces implementers to depend on operations they do not use; split it into smaller, role-specific interfaces',
			'The robot class is at fault for not eating; give it a real eat() implementation',
			'The stubs are fine and need no remedy: empty methods are harmless by definition',
			'The interface should be replaced by a base class so the stubs become inherited instead',
		],
		correct: 'The interface is too fat: it forces implementers to depend on operations they do not use; split it into smaller, role-specific interfaces',
		explanation: 'Interface Segregation: clients and implementers should not be forced through operations they do not need. Empty stubs are a real hazard — callers reasonably expect the operation to do something — and splitting the contract by role removes the forced dependency.',
	},
	{
		skill: 'OOP', difficulty: 4, timeLimit: 120,
		text: 'Object creation in an application is scattered across dozens of call sites, each with its own conditional logic choosing which concrete product class to build. Adding a product family means hunting down all of them. Which pattern addresses this?',
		options: [
			'Factory: centralise creation behind a creator that callers use, so the choice of concrete class lives in one place',
			'Observer: have product objects notify callers when they are created',
			'Singleton: restrict every product class to a single instance',
			'Adapter: wrap each product class in a translator object',
		],
		correct: 'Factory: centralise creation behind a creator that callers use, so the choice of concrete class lives in one place',
		explanation: 'The pain is creation logic duplicated and spread out; a factory concentrates it so families can be added or swapped in one place. Observer is about change notification, Singleton about instance count, and Adapter about interface translation — none of them govern creation.',
	},
	{
		skill: 'OOP', difficulty: 4, timeLimit: 120,
		text: 'A weather station measures conditions, and several displays — a phone app, a wall panel and a logging view — must update whenever the readings change. The station should not need editing when a new display type is added. Which pattern fits?',
		options: [
			'Observer: displays subscribe to the station, and the station notifies all subscribers when readings change',
			'Factory: the station creates each display on demand',
			'Strategy: the station selects one display algorithm at run time',
			'Composition: the station holds the displays as parts of itself and calls each one by name',
		],
		correct: 'Observer: displays subscribe to the station, and the station notifies all subscribers when readings change',
		explanation: 'One-to-many change notification with subscribers registering themselves is Observer: the subject knows only the subscriber contract, so new display types arrive without editing it. Holding and naming each display directly is precisely the coupling the requirement rules out.',
	},
	{
		skill: 'OOP', difficulty: 4, timeLimit: 120,
		text: 'Client code repeatedly reaches through chains of objects — order.getCustomer().getAddress().setPostcode(...) — and duplicates the “update the delivery postcode” rule in five places, which have already drifted apart. What is the best refactor?',
		options: [
			'Give Order an operation that performs the update through its own internals, and let clients ask the object that owns the data instead of navigating and manipulating its internals',
			'Make every field in the chain public so the navigation is shorter to write',
			'Copy the rule into a shared helper that still takes the whole chain of objects as arguments',
			'Remove the postcode from Address so clients stop updating it',
		],
		correct: 'Give Order an operation that performs the update through its own internals, and let clients ask the object that owns the data instead of navigating and manipulating its internals',
		explanation: 'Tell, don’t ask: behaviour belongs with the data it acts on. One operation on the owner restores a single copy of the rule and frees clients from depending on the internal structure; a helper over the same chain keeps the structural coupling, and public fields deepen the problem.',
	},
	// ------------------------------------------------------------- OOP (L5 x2)
	{
		skill: 'OOP', difficulty: 5, timeLimit: 120,
		text: 'A new system must use an existing third-party mapping component whose operations take and return types the new system does not use. Neither the component nor the new system’s core may be modified. How should the two be connected?',
		options: [
			'Introduce an adapter object that presents the interface the new system expects and translates each call into the component’s interface',
			'Subclass the third-party component and override every operation to change its types',
			'Copy the component’s code into the new system and edit the copy to match',
			'Have every caller in the new system learn and use the component’s types directly',
		],
		correct: 'Introduce an adapter object that presents the interface the new system expects and translates each call into the component’s interface',
		explanation: 'Adapter exists for exactly this constraint: two incompatible interfaces, neither editable, bridged by a translator object. Subclassing does not change the inherited interface’s types, editing a copy forks the component, and spreading the foreign types everywhere couples the whole system to them.',
	},
	{
		skill: 'OOP', difficulty: 5, timeLimit: 120,
		text: 'A pricing engine must apply different discount algorithms for different customer segments, the choice is made per order at run time, new algorithms arrive regularly, and an earlier attempt using a subclass per segment produced an unmanageable explosion of combined classes. Which design resolves this?',
		options: [
			'Strategy: define a common discount-algorithm contract, implement each algorithm as its own interchangeable object, and let the engine hold and invoke whichever one the order selects',
			'Deeper inheritance: organise the combined subclasses into a taller tree so they are easier to find',
			'One method with a conditional branch for every segment, extended as segments are added',
			'A singleton holding the single current algorithm for the whole application',
		],
		correct: 'Strategy: define a common discount-algorithm contract, implement each algorithm as its own interchangeable object, and let the engine hold and invoke whichever one the order selects',
		explanation: 'Strategy turns a family of interchangeable algorithms into pluggable objects chosen at run time, so combinations and new algorithms cost one new class each rather than a subclass for every combination. A singleton holds one global instance and cannot vary per order, and the conditional method must be edited for every addition.',
	},
];

module.exports = {
	name: '289_seed_batch5_question_bank',
	up: async (client) => {
		// Invariant check (scored truth): every row must have exactly 4
		// distinct options and a correct_answer identical to one of them —
		// POST /answer scores by exact string equality. Fail loudly before
		// inserting anything rather than seed an unscoreable row.
		for (const q of QUESTIONS) {
			if (!Array.isArray(q.options) || q.options.length !== 4) {
				throw new Error(`289: question must have exactly 4 options: ${q.text}`);
			}
			if (new Set(q.options).size !== q.options.length) {
				throw new Error(`289: question has duplicate options: ${q.text}`);
			}
			if (!q.options.includes(q.correct)) {
				throw new Error(`289: correct_answer is not one of the options: ${q.text}`);
			}
		}

		// Topic creation (see header): migration 279 seeded the 'oop'
		// subject but no default topic for it. Create the topic exactly
		// as 279 created the other 16 — idempotently.
		await client.query(
			`
        INSERT INTO assessment_topics (subject_id, slug, name, legacy_skill_name, sort_order, is_active)
        SELECT s.id, 'general', s.name || ' — General', 'OOP', 0, true
        FROM assessment_subjects s
        WHERE s.slug = 'oop'
        ON CONFLICT (subject_id, slug) DO NOTHING
      `,
		);

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

		// Post-state assertion: the OOP topic must now hold EXACTLY the
		// bank this migration specifies — L1=2, L2=8, L3=9, L4=8, L5=2
		// approved MCQ. The topic starts empty and inserts are
		// duplicate-guarded, so this holds on a first run and on every
		// re-run; if it does not hold, the surrounding state is not what
		// this migration promises, so fail loudly inside the transaction
		// rather than record success over it (279 precedent).
		const counts = await client.query(
			`
        SELECT difficulty_level, COUNT(*)::int AS n
        FROM assessment_questions
        WHERE topic_id = (SELECT t.id FROM assessment_topics t
          WHERE LOWER(t.legacy_skill_name) = LOWER('OOP'))
          AND review_status = 'approved'
          AND format = 'mcq'
        GROUP BY difficulty_level
      `,
		);
		const byLevel = {};
		for (const row of counts.rows) byLevel[row.difficulty_level] = row.n;
		const expected = { 1: 2, 2: 8, 3: 9, 4: 8, 5: 2 };
		for (const [level, want] of Object.entries(expected)) {
			if (byLevel[level] !== want) {
				throw new Error(
					`289 post-state: OOP approved MCQ at L${level} = ${byLevel[level] ?? 0}, expected ${want}`,
				);
			}
		}
		if (Object.keys(byLevel).length !== Object.keys(expected).length) {
			throw new Error(
				`289 post-state: OOP approved MCQ has unexpected difficulty levels: ${JSON.stringify(byLevel)}`,
			);
		}

		console.log(`Batch 5 question bank seeded (${QUESTIONS.length} candidate rows, duplicate-guarded)`);
	},
	down: async (client) => {
		for (const q of QUESTIONS) {
			await client.query(
				'DELETE FROM assessment_questions WHERE skill_category = $1 AND question_text = $2',
				[q.skill, q.text],
			);
		}

		// Delete the topic this migration created ONLY if nothing
		// references it any more. assessment_questions.topic_id,
		// assessment_sessions.topic_id (migration 280) and
		// assessment_sets.topic_id all point at assessment_topics; if
		// any reference survives, the topic stays and user data is never
		// cascade-deleted.
		const topic = await client.query(
			`SELECT t.id FROM assessment_topics t WHERE LOWER(t.legacy_skill_name) = LOWER('OOP')`,
		);
		if (topic.rows.length === 0) {
			console.log('289 down: OOP topic not present; nothing to remove');
			return;
		}
		const topicId = topic.rows[0].id;
		const refs = await client.query(
			`
        SELECT
          (SELECT COUNT(*)::int FROM assessment_questions WHERE topic_id = $1) AS questions,
          (SELECT COUNT(*)::int FROM assessment_sessions WHERE topic_id = $1) AS sessions,
          (SELECT COUNT(*)::int FROM assessment_sets WHERE topic_id = $1) AS sets
      `,
			[topicId],
		);
		const r = refs.rows[0];
		if (r.questions > 0 || r.sessions > 0 || r.sets > 0) {
			console.log(
				`289 down: OOP topic ${topicId} left in place — still referenced (questions=${r.questions}, sessions=${r.sessions}, sets=${r.sets})`,
			);
			return;
		}
		await client.query('DELETE FROM assessment_topics WHERE id = $1', [topicId]);
		console.log(`289 down: OOP topic ${topicId} removed (no references)`);
	},
};
