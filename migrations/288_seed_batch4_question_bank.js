// =============================================================================
// Migration 288: C5 Batch 4 — coverage floor for Communication, Machine
// Learning, Project Management, System Design (issue #1694; parent #1658;
// EPIC #1603)
// =============================================================================
//
// STOP 1 evidence (#1658, fresh-install rig): every one of the 16 catalogue
// topics holds exactly 10 approved MCQ (2 per difficulty level 1-5), so bands
// are easy 4 / medium 6 / hard 4 — 0 of 16 topics meet the design §7 rule-4
// launch floor (servable >= 25 MCQ/Medium) or the rule-2 activation floor
// (a configuration with servable >= 10).
//
// This migration adds +19 approved MCQ per topic for Communication, Machine
// Learning, Project Management and System Design — levels L2 x6 / L3 x7 /
// L4 x6 per topic — taking each topic to easy 10, medium 25, hard 10 (bands
// overlap by design: easy = L1+L2, medium = L2+L3+L4, hard = L4+L5). Total
// candidate rows: 77 — Communication carries ONE extra L2 row (+20 for that
// topic): its pre-batch MCQ base at L1 is 1, not 2 (its second d1 row is the
// legacy short_answer), so +19 alone left its easy band at 9 on the
// fresh-install rig; the extra row restores easy 10 without touching any
// other band (medium and hard were already at floor).
//
// Content rules (these rows are scored truth):
//   - skill_category spells exactly as SKILL_CATALOG: 'Communication',
//     'Machine Learning', 'Project Management', 'System Design'
//     (generateQuestion matches LOWER(skill_category)).
//   - correct_answer is character-identical to one of the 4 options —
//     POST /answer scores MCQ by exact string equality. The up()
//     invariant check below throws before any insert on violation.
//   - No question duplicates or near-duplicates a row already in the bank
//     for the same skill (every existing question text for these four
//     skills was extracted from migrations 006/280/282/284 and avoided;
//     Batches 1-3 cover other skills and hold no rows for these four).
//   - Every correct_answer was self-reviewed for factual correctness
//     (Nova author + Interviewer-persona self-review, per design §9 C5);
//     Communication scenario questions key the professionally standard
//     answer a communication-skills rubric would score correct, with
//     distractors that are clearly inferior practice. Questions whose
//     correctness would depend on a tool version or an unsettled context
//     were reworded until they did not.
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
	// ---------------------------------------------------- Communication (L2 x7 — +1 easy-band correction, see header)
	{
		skill: 'Communication', difficulty: 2, timeLimit: 90,
		text: 'What makes an email subject line effective?',
		options: [
			'It states the topic and, where relevant, the action needed, so the reader can prioritise the message',
			'It is kept completely blank so the reader stays curious',
			'It repeats the entire body of the email word for word',
			'It uses capital letters for every word to demand attention',
		],
		correct: 'It states the topic and, where relevant, the action needed, so the reader can prioritise the message',
		explanation: 'A clear, specific subject lets the reader judge urgency and find the message again later. Blank, copied-body, or all-caps subjects hide the purpose or read as shouting.',
	},
	{
		skill: 'Communication', difficulty: 2, timeLimit: 90,
		text: 'A colleague asks you to take on an extra task, but your current workload genuinely leaves you no capacity for it. What is the most professional response?',
		options: [
			'Explain your current commitments honestly, and offer an alternative — a later start, a smaller part you can do, or help finding another owner',
			'Accept the task and quietly let some of your existing work slip',
			'Refuse without giving any reason',
			'Accept, then complain to other colleagues about being overloaded',
		],
		correct: 'Explain your current commitments honestly, and offer an alternative — a later start, a smaller part you can do, or help finding another owner',
		explanation: 'A clear, reasoned no that still helps solve the requester’s problem protects both the existing commitments and the working relationship. Silent overcommitment fails everyone later; a bare refusal or public complaint solves nothing.',
	},
	{
		skill: 'Communication', difficulty: 2, timeLimit: 90,
		text: 'Which phrasing expresses a concern about missed deadlines without blaming the other person?',
		options: [
			'“I get worried when reports arrive late, because the review that follows them gets squeezed. Can we agree a time that works for both of us?”',
			'“You always deliver late because you do not care about this team.”',
			'“Everyone agrees you are the reason this project is behind.”',
			'“If you were any good at your job, this would not keep happening.”',
		],
		correct: '“I get worried when reports arrive late, because the review that follows them gets squeezed. Can we agree a time that works for both of us?”',
		explanation: 'An I-statement describes the behaviour, its effect on the speaker, and invites a joint fix — without attacking character or motives, which is what the other three options do.',
	},
	{
		skill: 'Communication', difficulty: 2, timeLimit: 90,
		text: 'Which set of behaviours signals that you are paying attention while someone is speaking to you?',
		options: [
			'Facing the speaker, keeping an open posture, and nodding occasionally to show you are following',
			'Checking your phone whenever a notification arrives',
			'Turning away and continuing to type while they talk',
			'Crossing your arms and avoiding eye contact throughout',
		],
		correct: 'Facing the speaker, keeping an open posture, and nodding occasionally to show you are following',
		explanation: 'Attentive body language — orientation, open posture, small acknowledgements — tells the speaker they are being heard. Phone use, typing, and closed posture all signal the opposite, whatever the listener intends.',
	},
	{
		skill: 'Communication', difficulty: 2, timeLimit: 90,
		text: 'A disagreement about a design decision has gone back and forth over many long emails without resolution. What is the most effective next step?',
		options: [
			'Arrange a short call or meeting to discuss it directly, then confirm the outcome in writing',
			'Send an even longer email restating every earlier message',
			'Copy senior managers onto the thread to add pressure',
			'Stop replying and let the disagreement settle itself',
		],
		correct: 'Arrange a short call or meeting to discuss it directly, then confirm the outcome in writing',
		explanation: 'A rich, two-way channel resolves misunderstandings that text threads keep regenerating, and a written confirmation afterwards fixes the outcome. More email repeats the failure, escalation adds pressure rather than clarity, and silence abandons the decision.',
	},
	{
		skill: 'Communication', difficulty: 2, timeLimit: 90,
		text: 'You receive an email that makes you angry and you want to reply immediately. What is the wisest course of action?',
		options: [
			'Draft your reply, pause before sending, and re-read it for tone and accuracy once you are calmer',
			'Send the reply at once while your feelings are strongest',
			'Forward the email to colleagues with your angry reaction attached',
			'Reply only with sarcasm so the sender feels the same way',
		],
		correct: 'Draft your reply, pause before sending, and re-read it for tone and accuracy once you are calmer',
		explanation: 'A pause separates the useful content of a reply from the heat of the moment; written words cannot be unsent. Immediate, broadcast, or sarcastic replies escalate the conflict and damage the sender’s credibility.',
	},
	{
		skill: 'Communication', difficulty: 2, timeLimit: 90,
		text: 'You need one specific piece of information from a busy colleague before you can finish your own work. What is the most effective way to ask for it?',
		options: [
			'Send one concise message stating exactly what you need, why you need it, and by when — in a form they can answer quickly, asynchronously',
			'Send the same request separately by email, chat and in person so it cannot be missed',
			'Ask a vague question and hope they work out what you need',
			'Escalate to their manager first so the request carries more weight',
		],
		correct: 'Send one concise message stating exactly what you need, why you need it, and by when — in a form they can answer quickly, asynchronously',
		explanation: 'A precise, self-contained request minimises the other person’s effort to help: they know the what, the why and the deadline, and can answer when their own work allows. Multi-channel duplication and vagueness both raise their cost, and escalation spends goodwill the request does not need.',
	},
	// ---------------------------------------------------- Communication (L3 x7)
	{
		skill: 'Communication', difficulty: 3, timeLimit: 90,
		text: 'You are running a meeting and the discussion keeps drifting to topics that are not on the agenda. What is the best way to handle it?',
		options: [
			'Acknowledge the topic, note it visibly as a parked item for later, and steer the group back to the agenda item',
			'Let the discussion run, since any conversation in a meeting is productive',
			'End the meeting immediately without covering the remaining agenda items',
			'Allow only the most senior person present to change the agenda at will',
		],
		correct: 'Acknowledge the topic, note it visibly as a parked item for later, and steer the group back to the agenda item',
		explanation: 'Parking respects the raised topic without letting it consume the meeting’s purpose, and the visible record means it is genuinely followed up. Drifting wastes everyone’s time, ending early abandons the agenda, and seniority is not a relevance test.',
	},
	{
		skill: 'Communication', difficulty: 3, timeLimit: 90,
		text: 'Your team reaches an important decision in a verbal discussion. What should you do next to make sure everyone acts on the same understanding?',
		options: [
			'Record the decision, the owner, and the deadline in writing and share it with everyone affected',
			'Rely on each person’s memory of the conversation',
			'Repeat the decision aloud once more and move on',
			'Ask the newest team member to tell the others what was decided',
		],
		correct: 'Record the decision, the owner, and the deadline in writing and share it with everyone affected',
		explanation: 'People leave the same conversation with different memories of it; a written record with an owner and a date is the shared reference that prevents drift. Repetition aloud fades the same way, and memory or hearsay are not records.',
	},
	{
		skill: 'Communication', difficulty: 3, timeLimit: 90,
		text: 'You are explaining a new process to a group with very different levels of experience. What approach works best?',
		options: [
			'Explain the core idea in plain terms first, define any specialist terms when you first use them, and invite questions',
			'Aim every explanation at the most expert person in the room',
			'Use specialist terms throughout without defining them, to save time',
			'Give the whole explanation at maximum detail and skip questions to stay on schedule',
		],
		correct: 'Explain the core idea in plain terms first, define any specialist terms when you first use them, and invite questions',
		explanation: 'A plain-terms core with terms defined on first use lets novices follow while experts lose nothing, and questions surface confusion early. Pitching only to experts or skipping definition and questions leaves part of the audience behind.',
	},
	{
		skill: 'Communication', difficulty: 3, timeLimit: 90,
		text: 'A listener has clearly misunderstood the message you just delivered. What is the best way to respond?',
		options: [
			'Restate the message in different words, give a concrete example, and check what the listener now understands',
			'Repeat the exact same sentence more slowly and loudly',
			'Blame the listener for not paying attention',
			'Move on, since explaining twice looks unprofessional',
		],
		correct: 'Restate the message in different words, give a concrete example, and check what the listener now understands',
		explanation: 'The same words failed once, so a different formulation plus an example gives the listener a new route to the meaning, and checking confirms it landed. Volume, blame, and moving on all leave the misunderstanding in place.',
	},
	{
		skill: 'Communication', difficulty: 3, timeLimit: 90,
		text: 'Which slide design best supports a spoken presentation?',
		options: [
			'A few key points or a visual per slide, with the detail carried by what you say',
			'Paragraphs of full text that you read aloud word for word',
			'As many different fonts and colours as possible on every slide',
			'Slides with no headings, so the audience concentrates only on you',
		],
		correct: 'A few key points or a visual per slide, with the detail carried by what you say',
		explanation: 'Slides are a backdrop for the spoken message: key points and visuals reinforce it. Walls of text make the audience read instead of listen, visual clutter distracts, and missing headings remove the structure that helps people follow.',
	},
	{
		skill: 'Communication', difficulty: 3, timeLimit: 90,
		text: 'A manager criticises your work in a one-to-one meeting. What response is most likely to lead to improvement?',
		options: [
			'Listen fully without interrupting, ask for specific examples, and agree on what you will do differently',
			'Interrupt each point to explain why it is wrong',
			'Agree with everything immediately just to end the conversation',
			'Say nothing in the meeting and complain to colleagues afterwards',
		],
		correct: 'Listen fully without interrupting, ask for specific examples, and agree on what you will do differently',
		explanation: 'Listening and asking for specifics turns criticism into usable information and a concrete change. Interrupting defends rather than learns, blanket agreement changes nothing, and complaining elsewhere resolves nothing.',
	},
	{
		skill: 'Communication', difficulty: 3, timeLimit: 90,
		text: 'You are writing an email asking a colleague to complete a task. What ending makes action most likely?',
		options: [
			'A clear closing line naming the specific action, who owns it, and the date it is needed by',
			'“Let me know your thoughts” with no action or date mentioned',
			'Several different requests repeated in different words',
			'A long summary of background the reader already knows',
		],
		correct: 'A clear closing line naming the specific action, who owns it, and the date it is needed by',
		explanation: 'Action follows clarity: a named action, owner, and date leave nothing to guess. A vague closing invites delay, repeated reworded requests create confusion about what is actually asked, and known background adds length without direction.',
	},
	// ---------------------------------------------------- Communication (L4 x6)
	{
		skill: 'Communication', difficulty: 4, timeLimit: 120,
		text: 'During a service outage, leadership asks you for an update before the cause is known. What is the best communication?',
		options: [
			'State what is known, what is not yet known, what is being done, and when the next update will come',
			'Say nothing until every fact is confirmed, however long that takes',
			'Give a confident guess about the cause so the update sounds complete',
			'Blame a supplier in the update, before their involvement is confirmed',
		],
		correct: 'State what is known, what is not yet known, what is being done, and when the next update will come',
		explanation: 'In a crisis, honest partial information with a committed next update preserves trust and stops rumour filling the gap. Silence breeds speculation, a guess presented as fact misleads decisions, and unconfirmed blame is unfair and often wrong.',
	},
	{
		skill: 'Communication', difficulty: 4, timeLimit: 120,
		text: 'You must decline a colleague’s request because your team has no capacity. Which response is most professional?',
		options: [
			'Decline clearly, briefly explain the constraint, and offer an alternative such as a later date or a different route',
			'Say yes and hope the work somehow fits in',
			'Decline with no explanation and ignore follow-up messages',
			'Agree to a small part in person, then quietly drop it later',
		],
		correct: 'Decline clearly, briefly explain the constraint, and offer an alternative such as a later date or a different route',
		explanation: 'A clear no with a reason and an alternative respects the requester’s planning and keeps the relationship intact. A false yes, a silent brush-off, and a quiet drop all create a bigger failure later, when the work does not appear.',
	},
	{
		skill: 'Communication', difficulty: 4, timeLimit: 120,
		text: 'You need to escalate a blocked problem to senior leadership. Which message structure is most effective?',
		options: [
			'The problem and its business impact, what has already been tried, and the specific decision or help you need from them',
			'A full chronological dump of every message exchanged about the problem',
			'The names of the people you believe caused the problem',
			'A request for a long meeting with no summary in advance',
		],
		correct: 'The problem and its business impact, what has already been tried, and the specific decision or help you need from them',
		explanation: 'Leaders can act on impact, attempted remedies, and a specific ask; that structure is what makes escalation fast. Raw message dumps bury the decision, blame directs attention away from the fix, and an unexplained meeting request gives them nothing to prepare.',
	},
	{
		skill: 'Communication', difficulty: 4, timeLimit: 120,
		text: 'You discover that figures you shared with stakeholders last week were wrong. What should you do?',
		options: [
			'Tell the same audience promptly, identify the error clearly, and provide the corrected figures',
			'Quietly use the correct figures next time without mentioning the error',
			'Mention the correction only if someone asks about the original figures',
			'Remove the original message and deny it was ever sent',
		],
		correct: 'Tell the same audience promptly, identify the error clearly, and provide the corrected figures',
		explanation: 'Stakeholders may already have acted on the wrong figures, so the correction must reach everyone the error reached, clearly labelled as a correction. Quiet fixes leave wrong decisions standing, and denial destroys trust when the original surfaces.',
	},
	{
		skill: 'Communication', difficulty: 4, timeLimit: 120,
		text: 'Two stakeholders hold firmly opposed positions on a project decision. Which technique is most likely to unlock agreement?',
		options: [
			'Explore the interests and constraints behind each position, and look for an option that addresses both sets of interests',
			'Insist that the more senior stakeholder’s position automatically wins',
			'Split every difference exactly in half, regardless of the consequences',
			'Postpone the decision indefinitely until one side gives up',
		],
		correct: 'Explore the interests and constraints behind each position, and look for an option that addresses both sets of interests',
		explanation: 'Positions are often rigid while the interests beneath them are compatible; negotiating on interests creates options neither side had proposed. Rank settles by authority rather than merit, mechanical splitting can satisfy neither interest, and indefinite delay is itself a costly decision.',
	},
	{
		skill: 'Communication', difficulty: 4, timeLimit: 120,
		text: 'In a meeting, someone asks you about confidential information you are not authorised to share. What is the best response?',
		options: [
			'Explain that you cannot discuss that topic, without confirming or denying any details, and point them to the proper channel',
			'Invent a harmless-sounding answer so the conversation can move on',
			'Share a small part of the information, since the audience is internal',
			'Confirm the information but ask everyone to keep it off the record',
		],
		correct: 'Explain that you cannot discuss that topic, without confirming or denying any details, and point them to the proper channel',
		explanation: 'Neither confirming nor denying protects the information — even confirming what does not exist leaks by contrast — and the proper channel gives the asker a legitimate route. Invented answers are deception, and partial or off-the-record sharing is still disclosure.',
	},
	// -------------------------------------------------- Machine Learning (L2 x6)
	{
		skill: 'Machine Learning', difficulty: 2, timeLimit: 90,
		text: 'In a machine learning dataset, what is a feature?',
		options: [
			'An input variable the model uses to make a prediction',
			'The output the model is trying to predict',
			'The score the model receives after testing',
			'A row that has been deleted from the dataset',
		],
		correct: 'An input variable the model uses to make a prediction',
		explanation: 'Features are the measured inputs (for example, a house’s size and location). The output being predicted is the target or label, and a post-test score is an evaluation metric.',
	},
	{
		skill: 'Machine Learning', difficulty: 2, timeLimit: 90,
		text: 'Which of these is an unsupervised learning task?',
		options: [
			'Grouping customers into segments based on their behaviour, without predefined labels',
			'Predicting whether a loan application should be approved, from labelled past applications',
			'Estimating a house price from labelled past sales',
			'Classifying images as cats or dogs using labelled images',
		],
		correct: 'Grouping customers into segments based on their behaviour, without predefined labels',
		explanation: 'Unsupervised learning finds structure in unlabelled data, such as clusters of similar customers. The other three learn from labelled examples, so they are supervised tasks.',
	},
	{
		skill: 'Machine Learning', difficulty: 2, timeLimit: 90,
		text: 'A classifier makes 200 predictions and 170 of them are correct. What is its accuracy?',
		options: ['0.85', '0.17', '0.30', '1.70'],
		correct: '0.85',
		explanation: 'Accuracy = correct predictions / all predictions = 170 / 200 = 0.85.',
	},
	{
		skill: 'Machine Learning', difficulty: 2, timeLimit: 90,
		text: 'What distinguishes reinforcement learning from supervised learning?',
		options: [
			'An agent learns by taking actions and receiving rewards or penalties, rather than from labelled examples',
			'It uses labelled examples exactly like supervised learning, but with more data',
			'It requires no feedback signal of any kind',
			'It can only be used for grouping unlabelled data',
		],
		correct: 'An agent learns by taking actions and receiving rewards or penalties, rather than from labelled examples',
		explanation: 'Reinforcement learning has no correct-answer labels; the agent explores actions and the reward signal shapes its policy. Rewards are themselves a feedback signal, and grouping unlabelled data is clustering.',
	},
	{
		skill: 'Machine Learning', difficulty: 2, timeLimit: 90,
		text: 'In neural network training, what is an epoch?',
		options: [
			'One complete pass through the entire training dataset',
			'A single training example',
			'The final score of the trained model',
			'One layer of the network',
		],
		correct: 'One complete pass through the entire training dataset',
		explanation: 'Training runs for many epochs: each epoch shows the model every training example once, usually in batches, and updates the weights along the way.',
	},
	{
		skill: 'Machine Learning', difficulty: 2, timeLimit: 90,
		text: 'How does a decision tree make a prediction?',
		options: [
			'It follows a series of tests on feature values from the root down to a leaf, whose value is the prediction',
			'It averages the predictions of hundreds of unrelated models',
			'It finds the training example closest to the input and copies its label',
			'It draws a single straight line through the data points',
		],
		correct: 'It follows a series of tests on feature values from the root down to a leaf, whose value is the prediction',
		explanation: 'Each internal node tests one feature (for example, age > 30), branches route the input downward, and the leaf it lands in supplies the prediction. Averaging many models is ensembling, and copying the nearest example is nearest-neighbour classification.',
	},
	// -------------------------------------------------- Machine Learning (L3 x7)
	{
		skill: 'Machine Learning', difficulty: 3, timeLimit: 90,
		text: 'A medical screening model correctly identifies 80 of the 100 patients who actually have a condition. What is its recall for that condition?',
		options: ['0.80', '0.20', '1.25', '0.08'],
		correct: '0.80',
		explanation: 'Recall = true positives / all actual positives = 80 / 100 = 0.80: of everyone who truly has the condition, the model found four fifths.',
	},
	{
		skill: 'Machine Learning', difficulty: 3, timeLimit: 90,
		text: 'What is the main purpose of k-fold cross-validation?',
		options: [
			'To estimate model performance more reliably by training and validating repeatedly on different splits of the data',
			'To increase the size of the dataset by duplicating rows',
			'To select the single best training example for the model',
			'To convert categorical variables into numbers',
		],
		correct: 'To estimate model performance more reliably by training and validating repeatedly on different splits of the data',
		explanation: 'Each fold takes a turn as the validation set, so the averaged score depends far less on one lucky or unlucky split. No rows are duplicated, and encoding categories is a separate preprocessing step.',
	},
	{
		skill: 'Machine Learning', difficulty: 3, timeLimit: 90,
		text: 'In a confusion matrix for a disease test, what is a false negative?',
		options: [
			'A patient who has the disease but is predicted not to have it',
			'A patient who does not have the disease but is predicted to have it',
			'A patient correctly predicted to have the disease',
			'A patient correctly predicted not to have the disease',
		],
		correct: 'A patient who has the disease but is predicted not to have it',
		explanation: 'A false negative is a missed positive: the condition is present but the prediction says absent. Predicted-present-but-absent is a false positive; the other two are correct predictions.',
	},
	{
		skill: 'Machine Learning', difficulty: 3, timeLimit: 90,
		text: 'What is the purpose of regularisation during model training?',
		options: [
			'To penalise model complexity so the model is less likely to overfit the training data',
			'To add more features so the model can fit the training data more closely',
			'To guarantee the model reaches zero training error',
			'To remove the need for a validation set',
		],
		correct: 'To penalise model complexity so the model is less likely to overfit the training data',
		explanation: 'Regularisation adds a cost for large weights or complexity to the training objective, trading a little training fit for better generalisation. Chasing zero training error is the overfitting failure it works against.',
	},
	{
		skill: 'Machine Learning', difficulty: 3, timeLimit: 90,
		text: 'Why is one-hot encoding used for a categorical feature such as colour (red, green, blue)?',
		options: [
			'It represents categories as separate binary columns, so the model does not treat the categories as ordered numbers with meaningful gaps',
			'It sorts the categories by how often they occur',
			'It reduces every category to a single number between 0 and 1 based on importance',
			'It deletes categories that appear rarely',
		],
		correct: 'It represents categories as separate binary columns, so the model does not treat the categories as ordered numbers with meaningful gaps',
		explanation: 'Coding red=1, green=2, blue=3 would falsely claim blue is three times red and closer to green. One binary column per category carries identity without inventing order or distance.',
	},
	{
		skill: 'Machine Learning', difficulty: 3, timeLimit: 90,
		text: 'During model development, what is the validation set used for?',
		options: [
			'Comparing model variants and tuning hyperparameters, while the test set is reserved for a final unbiased evaluation',
			'Training the model on additional data after testing',
			'Replacing the training set when it is too small',
			'Labelling unlabelled examples automatically',
		],
		correct: 'Comparing model variants and tuning hyperparameters, while the test set is reserved for a final unbiased evaluation',
		explanation: 'Repeated tuning against the test set would leak selection into it and inflate the final estimate, so development decisions use the validation set and the test set is touched once, at the end.',
	},
	{
		skill: 'Machine Learning', difficulty: 3, timeLimit: 90,
		text: 'A classifier has an ROC AUC of 0.5. What does that tell you?',
		options: [
			'It discriminates no better than random guessing',
			'It is perfectly accurate on every class',
			'It has 50% precision and 50% recall',
			'Half of its features are useless',
		],
		correct: 'It discriminates no better than random guessing',
		explanation: 'AUC measures ranking quality: 1.0 ranks every positive above every negative, and 0.5 is the coin-flip level — the model’s scores carry no information about the class. AUC is not a precision, recall, or feature-usefulness figure.',
	},
	// -------------------------------------------------- Machine Learning (L4 x6)
	{
		skill: 'Machine Learning', difficulty: 4, timeLimit: 120,
		text: 'A classification threshold is lowered so more cases are predicted positive. What typically happens to precision and recall?',
		options: [
			'Recall rises, because more real positives are caught, while precision typically falls, because more false positives are admitted',
			'Both precision and recall always rise',
			'Precision rises and recall falls',
			'Neither metric is affected by the threshold',
		],
		correct: 'Recall rises, because more real positives are caught, while precision typically falls, because more false positives are admitted',
		explanation: 'A lower threshold flags more cases: fewer positives are missed (recall up), but a larger share of the flagged cases are wrong (precision down). This trade-off is why the threshold is chosen from the cost of each error type.',
	},
	{
		skill: 'Machine Learning', difficulty: 4, timeLimit: 120,
		text: 'Why does a random forest usually generalise better than a single deep decision tree?',
		options: [
			'It averages many trees trained on different bootstrap samples with random feature subsets, which cancels out much of each individual tree’s variance',
			'Each tree in the forest is trained to memorise the full dataset perfectly',
			'The forest uses no training data after the first tree',
			'Averaging removes the need to measure performance on held-out data',
		],
		correct: 'It averages many trees trained on different bootstrap samples with random feature subsets, which cancels out much of each individual tree’s variance',
		explanation: 'A single deep tree is high-variance: a small data change reshapes it. Decorrelating many trees and averaging their votes keeps the flexible fit while cancelling much of that instability — and held-out evaluation is still required.',
	},
	{
		skill: 'Machine Learning', difficulty: 4, timeLimit: 120,
		text: 'A dataset for predicting rare equipment failures is heavily imbalanced. Which training change directly addresses the imbalance?',
		options: [
			'Give the rare failure class a higher weight in the loss, so its errors cost the model more',
			'Train only on the majority class until accuracy is high',
			'Remove the failure examples because they look like outliers',
			'Measure only overall accuracy and ignore the rare class',
		],
		correct: 'Give the rare failure class a higher weight in the loss, so its errors cost the model more',
		explanation: 'Class weighting forces the optimiser to care about the rare class instead of earning an easy low loss by ignoring it. Training on the majority only, deleting the rare examples, or watching accuracy alone all make the model blind to exactly the events it exists to predict.',
	},
	{
		skill: 'Machine Learning', difficulty: 4, timeLimit: 120,
		text: 'A demand-forecasting model that performed well last year has steadily become less accurate, although its code and features have not changed. What is the most likely explanation?',
		options: [
			'Concept drift: the real-world relationship between the inputs and the outcome has changed over time',
			'The model has memorised this year’s data in advance',
			'The training data has become too large to use',
			'The model needs its predictions rounded to whole numbers',
		],
		correct: 'Concept drift: the real-world relationship between the inputs and the outcome has changed over time',
		explanation: 'When customer behaviour, markets, or conditions shift, the pattern the model learned stops matching reality even though nothing in the code changed. Monitoring for drift and retraining on recent data is the standard response.',
	},
	{
		skill: 'Machine Learning', difficulty: 4, timeLimit: 120,
		text: 'A team has only 400 labelled X-ray images to train a pneumonia classifier — far too few to train a deep network from scratch. Which approach makes the best use of transfer learning?',
		options: [
			'Start from a network pre-trained on a large general image dataset, keep its early feature layers, and fine-tune the later layers on the 400 images',
			'Train a very deep network from scratch on the 400 images for many more epochs to compensate for the small dataset',
			'Add the held-out test images to the training set to enlarge it, then evaluate on the same images',
			'Copy the pre-trained model’s final predictions onto the X-rays without any further training',
		],
		correct: 'Start from a network pre-trained on a large general image dataset, keep its early feature layers, and fine-tune the later layers on the 400 images',
		explanation: 'Early layers learn general features (edges, textures) that transfer across image tasks, so fine-tuning mainly the task-specific later layers reaches good performance with little data. More epochs on 400 images from scratch overfits; training on the test images corrupts evaluation; the source model’s outputs are for a different task.',
	},
	{
		skill: 'Machine Learning', difficulty: 4, timeLimit: 120,
		text: 'What is the vanishing gradient problem in very deep neural networks?',
		options: [
			'Gradients shrink as they propagate back through many layers, so early layers learn extremely slowly',
			'The training data gradually disappears from memory',
			'Predictions become more confident the deeper the network gets',
			'The loss function returns exactly zero for every example',
		],
		correct: 'Gradients shrink as they propagate back through many layers, so early layers learn extremely slowly',
		explanation: 'Backpropagation multiplies many small derivatives layer by layer; in deep networks the product can approach zero, leaving the earliest layers with almost no learning signal. It is a training-dynamics problem, not a data or loss-value problem.',
	},
	// ----------------------------------------------- Project Management (L2 x6)
	{
		skill: 'Project Management', difficulty: 2, timeLimit: 90,
		text: 'What is a milestone in a project schedule?',
		options: [
			'A significant point in the project, such as the completion of a major deliverable, that marks progress but has no duration of its own',
			'A task that takes exactly one week to complete',
			'The meeting held every week to review project status',
			'A payment made to a supplier at the end of a phase',
		],
		correct: 'A significant point in the project, such as the completion of a major deliverable, that marks progress but has no duration of its own',
		explanation: 'A milestone is a zero-duration marker for a significant event or achievement, used to track progress at a glance. It is not a task, a recurring meeting, or a payment.',
	},
	{
		skill: 'Project Management', difficulty: 2, timeLimit: 90,
		text: 'Which of the following best defines a project stakeholder?',
		options: [
			'Anyone who can affect the project or is affected by its outcome, including users, sponsors, and the project team',
			'Only the person who signs the project budget',
			'Only members of the project team',
			'Only customers who buy the final product',
		],
		correct: 'Anyone who can affect the project or is affected by its outcome, including users, sponsors, and the project team',
		explanation: 'Stakeholdership follows influence and impact, not job title: regulators, users, suppliers, and internal teams can all be stakeholders. The other options each name only one narrow group.',
	},
	{
		skill: 'Project Management', difficulty: 2, timeLimit: 90,
		text: 'What does a Gantt chart primarily show?',
		options: [
			'Project tasks plotted as bars against a timeline, showing start dates, durations, and finish dates',
			'The project budget broken down by department',
			'The hierarchy of the organisation delivering the project',
			'A list of risks ranked by probability',
		],
		correct: 'Project tasks plotted as bars against a timeline, showing start dates, durations, and finish dates',
		explanation: 'A Gantt chart is a schedule view: each bar’s position and length encode when work starts, how long it runs, and when it ends. Budgets, org charts, and risk registers are different artefacts.',
	},
	{
		skill: 'Project Management', difficulty: 2, timeLimit: 90,
		text: 'What is the purpose of a work breakdown structure (WBS)?',
		options: [
			'To decompose the project deliverables into smaller, more manageable components of work',
			'To assign salaries to every member of the project team',
			'To record every meeting held during the project',
			'To rank stakeholders by their influence',
		],
		correct: 'To decompose the project deliverables into smaller, more manageable components of work',
		explanation: 'The WBS breaks the total scope down level by level until each piece is small enough to estimate, assign, and track. Pay, meeting records, and stakeholder analysis live in other documents.',
	},
	{
		skill: 'Project Management', difficulty: 2, timeLimit: 90,
		text: 'A client asks for an extra feature after the project scope has been agreed. What is the correct first handling?',
		options: [
			'Raise a formal change request and assess its impact on cost, schedule, and scope before deciding whether to approve it',
			'Add the feature immediately so the client stays happy',
			'Refuse all changes automatically once planning has finished',
			'Do the extra work without recording it, to keep the plan unchanged',
		],
		correct: 'Raise a formal change request and assess its impact on cost, schedule, and scope before deciding whether to approve it',
		explanation: 'Change control exists so the consequences of a change are visible before anyone commits to it. Accepting instantly invites scope creep, blanket refusal ignores legitimate needs, and unrecorded work corrupts the plan and the baseline.',
	},
	{
		skill: 'Project Management', difficulty: 2, timeLimit: 90,
		text: 'What is the main purpose of a project kickoff meeting?',
		options: [
			'To align the team and stakeholders on the project’s goals, scope, roles, and way of working before delivery begins',
			'To present the final results of the completed project',
			'To negotiate contracts with suppliers',
			'To carry out the first round of user acceptance testing',
		],
		correct: 'To align the team and stakeholders on the project’s goals, scope, roles, and way of working before delivery begins',
		explanation: 'Kickoff creates a shared starting picture — why the project exists, what it will deliver, who does what — before work begins. Final results, contract negotiation, and acceptance testing all belong to later stages.',
	},
	// ----------------------------------------------- Project Management (L3 x7)
	{
		skill: 'Project Management', difficulty: 3, timeLimit: 90,
		text: 'A project has Earned Value (EV) of 90,000 and Planned Value (PV) of 100,000. What is its Schedule Performance Index (SPI), and what does it mean?',
		options: [
			'SPI = 0.9; the project is behind schedule for the work accomplished',
			'SPI = 1.11; the project is ahead of schedule',
			'SPI = 0.9; the project is over budget',
			'SPI = 10,000; the project is late by that amount',
		],
		correct: 'SPI = 0.9; the project is behind schedule for the work accomplished',
		explanation: 'SPI = EV / PV = 90,000 / 100,000 = 0.9. Below 1 means less work has been accomplished than was planned by now — behind schedule. (Budget performance is CPI = EV / AC, a different index.)',
	},
	{
		skill: 'Project Management', difficulty: 3, timeLimit: 90,
		text: 'Using the three-point (PERT) formula, what is the expected duration of a task with an optimistic estimate of 4 days, a most likely estimate of 7 days, and a pessimistic estimate of 16 days?',
		options: ['8 days', '9 days', '7 days', '6.75 days'],
		correct: '8 days',
		explanation: 'PERT expected duration = (optimistic + 4 × most likely + pessimistic) / 6 = (4 + 28 + 16) / 6 = 48 / 6 = 8 days.',
	},
	{
		skill: 'Project Management', difficulty: 3, timeLimit: 90,
		text: 'What is resource levelling in schedule management?',
		options: [
			'Adjusting start and finish dates to resolve overallocation of resources, which can extend the project duration',
			'Assigning every task to the most senior available person',
			'Removing resources from a project to cut its cost',
			'Levelling the salaries of team members across the project',
		],
		correct: 'Adjusting start and finish dates to resolve overallocation of resources, which can extend the project duration',
		explanation: 'When people or equipment are booked beyond their capacity, levelling moves work until demand fits capacity — and because work moves later, the finish date can slip. It is about allocation over time, not seniority, headcount cuts, or pay.',
	},
	{
		skill: 'Project Management', difficulty: 3, timeLimit: 90,
		text: 'In MoSCoW prioritisation, what does the “Won’t have” category mean?',
		options: [
			'Requirements that are explicitly out of scope for this delivery, recorded so they are not expected or quietly added later',
			'Requirements that the team refuses to estimate',
			'Requirements that failed testing and must be fixed',
			'Requirements owned by a different supplier',
		],
		correct: 'Requirements that are explicitly out of scope for this delivery, recorded so they are not expected or quietly added later',
		explanation: 'MoSCoW sorts requirements into Must, Should, Could, and Won’t have (this time). Naming the Won’t set explicitly is what stops out-of-scope items being assumed or smuggled in; it says nothing about estimation, test failures, or ownership.',
	},
	{
		skill: 'Project Management', difficulty: 3, timeLimit: 90,
		text: 'What is the main value of recording lessons learned during a project?',
		options: [
			'Future projects can reuse what worked and avoid repeating the mistakes this project identified',
			'Management can use the record to punish the people responsible for problems',
			'The project plan no longer needs to be updated',
			'Stakeholders stop asking for status reports',
		],
		correct: 'Future projects can reuse what worked and avoid repeating the mistakes this project identified',
		explanation: 'Lessons learned are organisational memory: they convert one project’s experience into better estimates and fewer repeated errors on the next. Used as a punishment record they stop being honest, and they replace neither plan updates nor reporting.',
	},
	{
		skill: 'Project Management', difficulty: 3, timeLimit: 90,
		text: 'In a Kanban system, what is the purpose of a work-in-progress (WIP) limit?',
		options: [
			'To cap how many items can be in a workflow stage at once, exposing bottlenecks and keeping work flowing',
			'To limit the total number of staff who may join the project',
			'To stop new requirements from ever being raised',
			'To guarantee every item finishes on the same day it starts',
		],
		correct: 'To cap how many items can be in a workflow stage at once, exposing bottlenecks and keeping work flowing',
		explanation: 'Limiting items in progress forces finishing over starting and makes the constraining stage visible when work piles up against its limit. It governs items in a stage, not headcount, intake, or same-day completion.',
	},
	{
		skill: 'Project Management', difficulty: 3, timeLimit: 90,
		text: 'A problem arises that is beyond your authority as project manager and threatens the delivery date. What is the most appropriate action?',
		options: [
			'Escalate it to the sponsor promptly, with the impact, the options, and your recommendation',
			'Wait until the next monthly report and mention it then',
			'Solve it by quietly cutting agreed scope items yourself',
			'Hide it from the sponsor until it resolves itself',
		],
		correct: 'Escalate it to the sponsor promptly, with the impact, the options, and your recommendation',
		explanation: 'Escalation is the designed route for decisions above the project manager’s authority, and impact-plus-options lets the sponsor decide fast. Waiting wastes the time the escalation could save, and cutting scope or hiding the problem exceeds authority while removing the sponsor’s chance to act.',
	},
	// ----------------------------------------------- Project Management (L4 x6)
	{
		skill: 'Project Management', difficulty: 4, timeLimit: 120,
		text: 'What does a Monte Carlo simulation add to schedule analysis?',
		options: [
			'It runs many simulated versions of the schedule with varied task durations to give a probability distribution of possible finish dates',
			'It calculates the single exact date the project will finish',
			'It removes all uncertainty from task estimates',
			'It assigns tasks to team members automatically',
		],
		correct: 'It runs many simulated versions of the schedule with varied task durations to give a probability distribution of possible finish dates',
		explanation: 'Instead of one deterministic date, Monte Carlo samples each task’s duration from its estimate range thousands of times, producing statements like “80% likely to finish by June”. The uncertainty is quantified, not removed, and resourcing is a separate activity.',
	},
	{
		skill: 'Project Management', difficulty: 4, timeLimit: 120,
		text: 'What is the difference between contingency reserve and management reserve?',
		options: [
			'Contingency reserve covers identified risks (known unknowns) and is controlled by the project manager; management reserve covers unforeseeable work (unknown unknowns) and needs management approval to use',
			'Contingency reserve is for schedule delays; management reserve is for cost overruns only',
			'Management reserve is controlled by the project manager; contingency reserve needs board approval',
			'They are the same fund under two names',
		],
		correct: 'Contingency reserve covers identified risks (known unknowns) and is controlled by the project manager; management reserve covers unforeseeable work (unknown unknowns) and needs management approval to use',
		explanation: 'Contingency is sized from the risk register and sits inside the cost baseline under the project manager’s control. Management reserve sits outside the baseline for work nobody foresaw, and releasing it is a management decision.',
	},
	{
		skill: 'Project Management', difficulty: 4, timeLimit: 120,
		text: 'In a finish-to-start dependency between two tasks, what does applying a lead allow?',
		options: [
			'The successor task to start before the predecessor task has finished, overlapping the two tasks',
			'The project to start before it has been approved',
			'Extra waiting time to be inserted between the predecessor finishing and the successor starting',
			'The predecessor task to be skipped entirely',
		],
		correct: 'The successor task to start before the predecessor task has finished, overlapping the two tasks',
		explanation: 'A lead is negative lag: it pulls the successor’s start earlier so the tasks overlap. Inserting a wait is a lag, the opposite adjustment, and neither approval nor skipping a task is involved.',
	},
	{
		skill: 'Project Management', difficulty: 4, timeLimit: 120,
		text: 'Under a firm fixed-price contract, who bears most of the cost risk if the work costs more than expected?',
		options: [
			'The seller, who must deliver the agreed scope for the agreed price',
			'The buyer, who pays whatever the work actually costs',
			'Both parties equally, by definition of the contract type',
			'The project sponsor personally',
		],
		correct: 'The seller, who must deliver the agreed scope for the agreed price',
		explanation: 'A firm fixed price transfers cost risk to the seller: overruns come out of the seller’s margin, while the buyer pays the agreed price for the agreed scope. Paying actual costs describes a cost-reimbursable contract, the opposite arrangement.',
	},
	{
		skill: 'Project Management', difficulty: 4, timeLimit: 120,
		text: 'On a quality control chart, what does a data point falling outside the control limits indicate?',
		options: [
			'The process shows variation beyond its expected common-cause range and should be investigated for a special cause',
			'The product automatically passes inspection',
			'The control limits were drawn incorrectly in every case',
			'The process is performing better than specification requires',
		],
		correct: 'The process shows variation beyond its expected common-cause range and should be investigated for a special cause',
		explanation: 'Control limits are calculated from the process’s own variation; a point beyond them is a signal that something unusual (a special cause) is acting and worth investigating. It is a signal to investigate, not a pass mark or proof the chart is wrong.',
	},
	{
		skill: 'Project Management', difficulty: 4, timeLimit: 120,
		text: 'According to the power/interest grid, how should a stakeholder with high power but low interest be managed?',
		options: [
			'Keep them satisfied: meet their needs and keep them adequately informed, without overloading them with detail',
			'Manage them closely as a key player in day-to-day decisions',
			'Monitor them with minimal effort only',
			'Ignore them until they show interest',
		],
		correct: 'Keep them satisfied: meet their needs and keep them adequately informed, without overloading them with detail',
		explanation: 'The grid’s four strategies are manage closely (high power, high interest), keep satisfied (high power, low interest), keep informed (low power, high interest), and monitor (low power, low interest). A powerful stakeholder left unsatisfied can block the project, so minimal effort or ignoring them is unsafe.',
	},
	// --------------------------------------------------- System Design (L2 x6)
	{
		skill: 'System Design', difficulty: 2, timeLimit: 90,
		text: 'Why does keeping a service stateless (not storing session state in the server’s own memory) make scaling easier?',
		options: [
			'Any instance can handle any request, so instances can be added or removed freely behind a load balancer',
			'Stateless services never need a database for anything',
			'Each request automatically becomes faster than the previous one',
			'Users no longer need to sign in',
		],
		correct: 'Any instance can handle any request, so instances can be added or removed freely behind a load balancer',
		explanation: 'If session state lives outside the instance (for example in a shared store), no request is tied to one machine, so the fleet can grow, shrink, or lose a member without losing sessions. State still exists — it is stored elsewhere — and authentication is unaffected.',
	},
	{
		skill: 'System Design', difficulty: 2, timeLimit: 90,
		text: 'What is the role of DNS in a web system?',
		options: [
			'It translates human-readable domain names into the IP addresses needed to connect to servers',
			'It encrypts traffic between the browser and the server',
			'It stores the website’s files close to users',
			'It checks user passwords at sign-in',
		],
		correct: 'It translates human-readable domain names into the IP addresses needed to connect to servers',
		explanation: 'DNS is the naming layer: browsers resolve a name like example.com to an address before connecting. Encryption is TLS, edge file storage is a CDN, and password checks belong to the application.',
	},
	{
		skill: 'System Design', difficulty: 2, timeLimit: 90,
		text: 'What is the main reason for adding a read replica to a database setup?',
		options: [
			'To handle read traffic on copies of the data, reducing load on the primary database that handles writes',
			'To store a backup that is never used for queries',
			'To let two primaries accept conflicting writes at the same time',
			'To replace the need for database indexes',
		],
		correct: 'To handle read traffic on copies of the data, reducing load on the primary database that handles writes',
		explanation: 'Most workloads read far more than they write, so serving reads from replicas scales the read side while the single primary stays the write authority. A replica is a live queryable copy, not an idle backup, and indexes are still needed on every node.',
	},
	{
		skill: 'System Design', difficulty: 2, timeLimit: 90,
		text: 'Why do APIs use rate limiting?',
		options: [
			'To cap how many requests a client may make in a period, protecting the service from overload and abuse',
			'To make responses arrive in a guaranteed order',
			'To compress responses so they use less bandwidth',
			'To store frequently requested responses for reuse',
		],
		correct: 'To cap how many requests a client may make in a period, protecting the service from overload and abuse',
		explanation: 'Rate limits bound the load any one client can impose, keeping capacity available for others and blunting runaway scripts and abuse. Ordering, compression, and response reuse (caching) are separate mechanisms.',
	},
	{
		skill: 'System Design', difficulty: 2, timeLimit: 90,
		text: 'What data model does a document database use?',
		options: [
			'It stores data as self-contained documents, typically JSON-like structures, often with nested fields',
			'It stores data only in rows and columns joined by foreign keys',
			'It stores data as a graph of nodes and edges',
			'It stores data only as plain unformatted text files',
		],
		correct: 'It stores data as self-contained documents, typically JSON-like structures, often with nested fields',
		explanation: 'A document store keeps each record as one structured document that can carry its nested data with it. Rows-and-foreign-keys is the relational model, and nodes-and-edges is the graph model.',
	},
	{
		skill: 'System Design', difficulty: 2, timeLimit: 90,
		text: 'Why do load balancers perform health checks on the servers behind them?',
		options: [
			'To detect servers that are failing or unreachable and stop sending them traffic',
			'To measure how much each server costs to run',
			'To restart every server on a fixed schedule',
			'To copy data from healthy servers to new servers',
		],
		correct: 'To detect servers that are failing or unreachable and stop sending them traffic',
		explanation: 'Periodic health checks let the balancer route around a sick instance automatically, so users are not sent to a server that cannot answer. Cost measurement, restarts, and data copying are separate operational concerns.',
	},
	// --------------------------------------------------- System Design (L3 x7)
	{
		skill: 'System Design', difficulty: 3, timeLimit: 90,
		text: 'What does eventual consistency mean in a distributed data store?',
		options: [
			'If no new updates are made, all copies of the data will converge to the same value over time, though a read just after a write may see an older value',
			'Every read always returns the most recent write immediately',
			'Data is written to only one copy and never replicated',
			'Inconsistencies between copies are permanent once they appear',
		],
		correct: 'If no new updates are made, all copies of the data will converge to the same value over time, though a read just after a write may see an older value',
		explanation: 'Eventual consistency trades immediate agreement for availability and speed: replicas may briefly disagree, but with updates stopped they converge. Always-latest reads describe strong consistency, and replicas do converge — that is the point of the guarantee.',
	},
	{
		skill: 'System Design', difficulty: 3, timeLimit: 90,
		text: 'What problem can replication lag cause in a primary-replica database setup?',
		options: [
			'A user may read from a replica and see stale data shortly after making a write on the primary',
			'Writes to the primary become impossible while replicas exist',
			'Replicas delete data that the primary still holds',
			'Every query must be run on every replica before returning',
		],
		correct: 'A user may read from a replica and see stale data shortly after making a write on the primary',
		explanation: 'Changes reach replicas asynchronously, so a read-your-own-write routed to a replica can miss the just-committed change until the replica catches up. Writes still work, replicas do not delete primary data, and a query runs on one replica, not all of them.',
	},
	{
		skill: 'System Design', difficulty: 3, timeLimit: 90,
		text: 'What role does an API gateway play in a microservices system?',
		options: [
			'It is a single entry point that routes client requests to the right service and can centralise concerns such as authentication and rate limiting',
			'It is the database shared by all the services',
			'It compiles the services before deployment',
			'It replaces the need for the services themselves',
		],
		correct: 'It is a single entry point that routes client requests to the right service and can centralise concerns such as authentication and rate limiting',
		explanation: 'Clients talk to one gateway instead of tracking every service, and cross-cutting checks are enforced once at the edge. The services, their data stores, and their build pipelines all still exist behind it.',
	},
	{
		skill: 'System Design', difficulty: 3, timeLimit: 90,
		text: 'Why do applications use a database connection pool?',
		options: [
			'Opening a connection is expensive, so a pool reuses a set of open connections across requests instead of creating one per request',
			'A pool guarantees that queries always return correct results',
			'A pool stores query results so the database is never queried twice',
			'A pool lets the application skip authentication with the database',
		],
		correct: 'Opening a connection is expensive, so a pool reuses a set of open connections across requests instead of creating one per request',
		explanation: 'Establishing a connection involves network setup and authentication each time; pooling amortises that cost and bounds how many connections the database must sustain. Result correctness and result caching are unrelated, and pooled connections are still authenticated.',
	},
	{
		skill: 'System Design', difficulty: 3, timeLimit: 90,
		text: 'A client retries a failed request using exponential backoff. What does that mean?',
		options: [
			'It waits increasing intervals between retries (for example 1s, 2s, 4s), giving the failing service time to recover instead of hammering it',
			'It retries immediately as many times as possible in the first second',
			'Each retry sends a larger request than the one before',
			'It gives up after the first failure and reports an error',
		],
		correct: 'It waits increasing intervals between retries (for example 1s, 2s, 4s), giving the failing service time to recover instead of hammering it',
		explanation: 'Growing delays space retries out so a struggling service is not hit by a synchronized retry storm, while the client still eventually succeeds when the service recovers. Immediate mass retries make outages worse, and backoff does keep retrying.',
	},
	{
		skill: 'System Design', difficulty: 3, timeLimit: 90,
		text: 'What problem does the circuit breaker pattern solve when one service calls another?',
		options: [
			'When the downstream service is failing, the breaker stops calls to it for a period, so callers fail fast and the failing service gets room to recover',
			'It guarantees the downstream service will never fail',
			'It retries every failed call forever until it succeeds',
			'It encrypts calls between the two services',
		],
		correct: 'When the downstream service is failing, the breaker stops calls to it for a period, so callers fail fast and the failing service gets room to recover',
		explanation: 'Like an electrical breaker, the pattern trips after repeated failures: callers get an immediate error instead of waiting on timeouts and piling up, and trial calls later test whether the downstream has recovered. Retrying forever is the behaviour it exists to prevent.',
	},
	{
		skill: 'System Design', difficulty: 3, timeLimit: 90,
		text: 'In a leader-based (single-leader) replication setup, how are writes handled?',
		options: [
			'All writes go to the leader, which orders them and propagates the changes to follower replicas',
			'Every replica accepts writes independently and conflicts are ignored',
			'Writes are split randomly among replicas with no ordering',
			'Followers accept writes and the leader only serves reads',
		],
		correct: 'All writes go to the leader, which orders them and propagates the changes to follower replicas',
		explanation: 'A single write path gives every change a total order, which followers apply in that same order — that is what keeps replicas consistent copies. Independent writes on every replica describe multi-leader replication, with its conflict problem.',
	},
	// --------------------------------------------------- System Design (L4 x6)
	{
		skill: 'System Design', difficulty: 4, timeLimit: 120,
		text: 'What is a hot partition (hot spot) problem in a sharded system?',
		options: [
			'Traffic or data concentrates on one shard — for example a single extremely popular key — overloading it while other shards sit idle',
			'All shards stop responding at the same time',
			'A shard contains data that is read but never written',
			'Two shards hold identical copies of every key',
		],
		correct: 'Traffic or data concentrates on one shard — for example a single extremely popular key — overloading it while other shards sit idle',
		explanation: 'Sharding spreads load only if keys spread evenly; a celebrity key or skewed key range funnels disproportionate traffic onto one shard, which becomes the bottleneck while the fleet’s spare capacity goes unused.',
	},
	{
		skill: 'System Design', difficulty: 4, timeLimit: 120,
		text: 'What is the main drawback of two-phase commit for transactions spanning multiple services?',
		options: [
			'It is blocking: if the coordinator fails after participants have prepared, they can be left holding locks and unable to proceed',
			'It never guarantees that the transaction commits atomically',
			'It can only be used with a single database',
			'It requires every participant to use the same programming language',
		],
		correct: 'It is blocking: if the coordinator fails after participants have prepared, they can be left holding locks and unable to proceed',
		explanation: 'Two-phase commit does deliver atomicity — that is its purpose — but prepared participants must wait for the coordinator’s decision, so a coordinator failure at the wrong moment wedges them. It works across separate databases and says nothing about implementation languages.',
	},
	{
		skill: 'System Design', difficulty: 4, timeLimit: 120,
		text: 'What is the difference between write-through and write-back caching?',
		options: [
			'Write-through writes to the cache and the underlying store at the same time; write-back writes to the cache first and updates the underlying store later',
			'Write-through is used only for reads; write-back is used only for deletes',
			'Write-back writes to the underlying store first and never uses the cache',
			'There is no difference; the terms describe the same policy',
		],
		correct: 'Write-through writes to the cache and the underlying store at the same time; write-back writes to the cache first and updates the underlying store later',
		explanation: 'Write-through keeps the store always current at the cost of write latency; write-back is faster but the store temporarily lags the cache, so a cache failure can lose recent writes. Both are write policies for cached data.',
	},
	{
		skill: 'System Design', difficulty: 4, timeLimit: 120,
		text: 'How does the saga pattern handle a business transaction that spans several services?',
		options: [
			'As a sequence of local transactions, each with a compensating action that undoes its effects if a later step fails',
			'As one database transaction that locks every service’s data until completion',
			'By retrying the whole transaction until every service succeeds at the same moment',
			'By storing all services’ data in one shared database table',
		],
		correct: 'As a sequence of local transactions, each with a compensating action that undoes its effects if a later step fails',
		explanation: 'A saga avoids cross-service locks: each step commits locally, and failure triggers compensations (for example, refunding a payment) that semantically reverse the completed steps. The services keep separate data and never share one atomic transaction.',
	},
	{
		skill: 'System Design', difficulty: 4, timeLimit: 120,
		text: 'What is backpressure in a data-processing system?',
		options: [
			'A mechanism by which a slow consumer signals the producer to slow down, so work does not pile up faster than it can be processed',
			'Pressure applied to compress data before storage',
			'A backup process that runs when the primary system fails',
			'The delay added by encrypting data in transit',
		],
		correct: 'A mechanism by which a slow consumer signals the producer to slow down, so work does not pile up faster than it can be processed',
		explanation: 'Without backpressure, a faster producer fills queues and memory until something breaks; with it, the consumer’s capacity governs the production rate. It concerns flow control between components, not compression, backups, or encryption.',
	},
	{
		skill: 'System Design', difficulty: 4, timeLimit: 120,
		text: 'A replicated store has N = 5 copies of each item, write quorum W = 3, and read quorum R = 3. Why does this configuration help reads see the latest write?',
		options: [
			'Because R + W > N, every read set and write set overlap in at least one copy, so a read always touches at least one node that holds the latest acknowledged write',
			'Because five copies guarantee no node can ever fail',
			'Because reads are always sent to all five copies',
			'Because writes are stored in memory only',
		],
		correct: 'Because R + W > N, every read set and write set overlap in at least one copy, so a read always touches at least one node that holds the latest acknowledged write',
		explanation: 'A write is acknowledged once 3 of 5 nodes hold it, and a read consults 3 of 5; any two 3-node subsets of a 5-node set share at least one node, so the reader can pick the newest value among its responses. Copies reduce failure risk but guarantee nothing, and reads consult R nodes, not all N.',
	},
];

module.exports = {
	name: '288_seed_batch4_question_bank',
	up: async (client) => {
		// Invariant check (scored truth): every row must have exactly 4
		// distinct options and a correct_answer identical to one of them —
		// POST /answer scores by exact string equality. Fail loudly before
		// inserting anything rather than seed an unscoreable row.
		for (const q of QUESTIONS) {
			if (!Array.isArray(q.options) || q.options.length !== 4) {
				throw new Error(`288: question must have exactly 4 options: ${q.text}`);
			}
			if (new Set(q.options).size !== q.options.length) {
				throw new Error(`288: question has duplicate options: ${q.text}`);
			}
			if (!q.options.includes(q.correct)) {
				throw new Error(`288: correct_answer is not one of the options: ${q.text}`);
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

		console.log(`Batch 4 question bank seeded (${QUESTIONS.length} candidate rows, duplicate-guarded)`);
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
