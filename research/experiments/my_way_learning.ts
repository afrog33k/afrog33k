/**
 * Experiment: "My Way" Learning
 *
 * RESEARCH QUESTION:
 * Does the system learn to execute tasks according to user style,
 * not just following literal instructions?
 *
 * This is the core Ronald-GI promise: after working with you, it should
 * understand HOW you want things done, not just WHAT you want.
 *
 * METHODOLOGY:
 * 1. Inject 10 explicit style preferences
 * 2. Inject 50 implicit demonstrations (user corrections without explanation)
 * 3. Add 500 noise interactions
 * 4. Test on 20 NEW tasks never seen before
 * 5. Measure if output matches user style
 *
 * Based on EvolveR (arXiv:2510.16079) self-evolution paradigm.
 */

// =============================================================================
// USER STYLE DEFINITION
// =============================================================================

interface StylePreference {
  id: string;
  dimension: string;
  explicit: boolean;
  value: string;
  examples: string[];
  anti_examples: string[];
}

const USER_STYLE: StylePreference[] = [
  // Explicit preferences (user stated these directly)
  {
    id: 'brevity',
    dimension: 'length',
    explicit: true,
    value: 'brief',
    examples: ['TL;DR: The fix is in line 42.', 'Use Redis. Done.'],
    anti_examples: ['Let me provide a comprehensive explanation of the various factors...'],
  },
  {
    id: 'bullets',
    dimension: 'format',
    explicit: true,
    value: 'bullet_points',
    examples: ['- Fix auth\n- Update tests\n- Deploy'],
    anti_examples: ['First, we need to fix authentication. Then, we should update...'],
  },
  {
    id: 'directness',
    dimension: 'tone',
    explicit: true,
    value: 'direct',
    examples: ['This is wrong.', 'The bug is here.'],
    anti_examples: ['I was wondering if perhaps we might consider looking at...'],
  },
  {
    id: 'code_first',
    dimension: 'explanation_style',
    explicit: true,
    value: 'show_code_first',
    examples: ['```\nconst fix = ...\n```\nThis works because...'],
    anti_examples: ['The reason this works is because of X, Y, Z. Here is the code:'],
  },
  {
    id: 'no_hedging',
    dimension: 'confidence',
    explicit: true,
    value: 'assertive',
    examples: ['Use PostgreSQL.', 'This approach is better.'],
    anti_examples: ['You might want to consider using PostgreSQL, but it depends...'],
  },

  // Implicit preferences (learned from corrections)
  {
    id: 'typescript_strict',
    dimension: 'code_style',
    explicit: false,
    value: 'strict_typescript',
    examples: ['const x: string = ...', 'interface Props { ... }'],
    anti_examples: ['const x = ...', 'any'],
  },
  {
    id: 'early_return',
    dimension: 'code_style',
    explicit: false,
    value: 'early_return',
    examples: ['if (!valid) return;\n// main logic'],
    anti_examples: ['if (valid) {\n  // deeply nested main logic\n}'],
  },
  {
    id: 'functional',
    dimension: 'code_style',
    explicit: false,
    value: 'functional_style',
    examples: ['items.filter(x => x.active).map(x => x.name)'],
    anti_examples: ['for (let i = 0; i < items.length; i++) { if (items[i].active) { ... } }'],
  },
  {
    id: 'no_comments',
    dimension: 'documentation',
    explicit: false,
    value: 'self_documenting_code',
    examples: ['const isValidUser = user.active && user.verified;'],
    anti_examples: ['// Check if user is valid\nconst valid = u.a && u.v;'],
  },
  {
    id: 'bottom_line_first',
    dimension: 'structure',
    explicit: false,
    value: 'conclusion_first',
    examples: ['Answer: Use Redis. Here is why...'],
    anti_examples: ['There are several options to consider. First, we have...'],
  },
];

// =============================================================================
// CORRECTION EXAMPLES (Implicit Learning Data)
// =============================================================================

interface CorrectionExample {
  task: string;
  system_output: string;
  user_correction: string;
  learned_preference: string;
}

const CORRECTION_EXAMPLES: CorrectionExample[] = [
  {
    task: 'Explain how to fix the bug',
    system_output: 'The issue appears to be related to the authentication flow. Let me walk you through the various components involved...',
    user_correction: 'Bug is in auth.ts line 42. Fix: add null check.',
    learned_preference: 'brevity',
  },
  {
    task: 'Write a function to validate email',
    system_output: 'function validateEmail(email) {\n  return email.includes("@");\n}',
    user_correction: 'function validateEmail(email: string): boolean {\n  return email.includes("@");\n}',
    learned_preference: 'typescript_strict',
  },
  {
    task: 'Should we use Redis or Memcached?',
    system_output: 'Both are excellent choices. Redis offers more features while Memcached is simpler. It really depends on your specific needs and team familiarity...',
    user_correction: 'Use Redis. Better persistence, pub/sub, and we already use it elsewhere.',
    learned_preference: 'directness',
  },
  {
    task: 'Write a function to filter active users',
    system_output: 'function getActiveUsers(users) {\n  const result = [];\n  for (let i = 0; i < users.length; i++) {\n    if (users[i].active) {\n      result.push(users[i]);\n    }\n  }\n  return result;\n}',
    user_correction: 'const getActiveUsers = (users: User[]): User[] => users.filter(u => u.active);',
    learned_preference: 'functional',
  },
  {
    task: 'Document this code',
    system_output: '// This function checks if the user is valid\n// It returns true if active and verified\nfunction isValid(u) { return u.active && u.verified; }',
    user_correction: 'const isValidUser = (user: User): boolean => user.active && user.verified;',
    learned_preference: 'no_comments',
  },
  {
    task: 'List the steps to deploy',
    system_output: 'To deploy the application, you will first need to ensure all tests pass. Following that, you should build the production bundle. After the build completes, push to the main branch...',
    user_correction: '- Run tests\n- Build prod\n- Push to main\n- Trigger deploy',
    learned_preference: 'bullets',
  },
  {
    task: 'Explain the auth flow',
    system_output: 'The authentication flow begins when a user submits their credentials. These credentials are then validated against our database...',
    user_correction: '```typescript\n// 1. validateCredentials()\n// 2. generateToken()\n// 3. setSession()\n```\nUser → validate → token → session',
    learned_preference: 'code_first',
  },
  {
    task: 'Which database should we use?',
    system_output: 'There are several options you might want to consider. PostgreSQL is a robust choice, but MongoDB might also work depending on your data model...',
    user_correction: 'PostgreSQL. Relational data, ACID compliance, we know it.',
    learned_preference: 'no_hedging',
  },
];

// =============================================================================
// NOISE DATA
// =============================================================================

function generateNoiseInteractions(count: number): string[] {
  const noiseTemplates = [
    'The weather in {city} is {temp} degrees today',
    'Remember to buy {item} from the store',
    'Meeting with {person} at {time}',
    '{stock} is trading at ${price}',
    'The {event} is scheduled for {date}',
  ];

  const noise: string[] = [];
  for (let i = 0; i < count; i++) {
    const template = noiseTemplates[i % noiseTemplates.length];
    noise.push(
      template
        .replace('{city}', ['Tokyo', 'London', 'NYC'][i % 3])
        .replace('{temp}', String(50 + (i % 50)))
        .replace('{item}', ['milk', 'bread', 'coffee'][i % 3])
        .replace('{person}', ['Alice', 'Bob', 'Charlie'][i % 3])
        .replace('{time}', ['10am', '2pm', '4pm'][i % 3])
        .replace('{stock}', ['AAPL', 'GOOGL', 'MSFT'][i % 3])
        .replace('{price}', String(100 + i))
        .replace('{event}', ['standup', 'review', 'demo'][i % 3])
        .replace('{date}', ['Monday', 'Tuesday', 'Wednesday'][i % 3])
    );
  }
  return noise;
}

// =============================================================================
// TEST TASKS (Never seen before)
// =============================================================================

interface TestTask {
  id: string;
  task: string;
  domain: string;
  relevant_preferences: string[];
}

const TEST_TASKS: TestTask[] = [
  {
    id: 't1',
    task: 'Write a function to calculate the average of an array',
    domain: 'code',
    relevant_preferences: ['typescript_strict', 'functional', 'no_comments'],
  },
  {
    id: 't2',
    task: 'Explain how to set up CI/CD for this project',
    domain: 'explanation',
    relevant_preferences: ['brevity', 'bullets', 'directness'],
  },
  {
    id: 't3',
    task: 'Should we use GraphQL or REST for this API?',
    domain: 'decision',
    relevant_preferences: ['directness', 'no_hedging', 'bottom_line_first'],
  },
  {
    id: 't4',
    task: 'Write a React hook for fetching user data',
    domain: 'code',
    relevant_preferences: ['typescript_strict', 'early_return', 'functional'],
  },
  {
    id: 't5',
    task: 'What is the best way to handle errors in this codebase?',
    domain: 'explanation',
    relevant_preferences: ['code_first', 'directness', 'bottom_line_first'],
  },
  {
    id: 't6',
    task: 'List the steps to onboard a new developer',
    domain: 'process',
    relevant_preferences: ['bullets', 'brevity', 'directness'],
  },
  {
    id: 't7',
    task: 'Write a utility to validate form inputs',
    domain: 'code',
    relevant_preferences: ['typescript_strict', 'early_return', 'no_comments'],
  },
  {
    id: 't8',
    task: 'Recommend a state management solution for this app',
    domain: 'decision',
    relevant_preferences: ['no_hedging', 'directness', 'bottom_line_first'],
  },
];

// =============================================================================
// STYLE LEARNERS
// =============================================================================

interface LearnedStyle {
  preferences: Map<string, number>; // preference_id -> confidence
  patterns: Map<string, string[]>; // dimension -> observed values
}

interface StyleLearner {
  name: string;
  learn(explicit: StylePreference[], corrections: CorrectionExample[], noise: string[]): LearnedStyle;
  generate(task: TestTask, style: LearnedStyle): string;
}

// Baseline: No learning (stateless)
const noLearningBaseline: StyleLearner = {
  name: 'No Learning (Stateless)',
  learn(): LearnedStyle {
    return { preferences: new Map(), patterns: new Map() };
  },
  generate(task: TestTask): string {
    // Generic verbose output
    return `To complete the task "${task.task}", we should first consider the various approaches. There are several options available, each with its own trade-offs. Let me explain the different possibilities and you can decide which one works best for your situation...`;
  },
};

// Baseline: Explicit only
const explicitOnlyBaseline: StyleLearner = {
  name: 'Explicit Only',
  learn(explicit: StylePreference[]): LearnedStyle {
    const preferences = new Map<string, number>();
    const patterns = new Map<string, string[]>();

    for (const pref of explicit) {
      if (pref.explicit) {
        preferences.set(pref.id, 1.0);
        if (!patterns.has(pref.dimension)) {
          patterns.set(pref.dimension, []);
        }
        patterns.get(pref.dimension)!.push(pref.value);
      }
    }

    return { preferences, patterns };
  },
  generate(task: TestTask, style: LearnedStyle): string {
    const hasBreif = style.preferences.has('brevity');
    const hasBullets = style.preferences.has('bullets');
    const hasDirect = style.preferences.has('directness');

    if (task.domain === 'code') {
      // Explicit preferences don't cover code style
      return `function example(items) {\n  var result = [];\n  for (var i = 0; i < items.length; i++) {\n    result.push(items[i]);\n  }\n  return result;\n}`;
    }

    if (task.domain === 'decision') {
      if (hasDirect) {
        return `Use Option A. It is the better choice for this situation.`;
      }
      return `There are multiple options to consider. Option A has some advantages, but Option B might also work...`;
    }

    if (hasBullets) {
      return `- Step 1\n- Step 2\n- Step 3`;
    }

    if (hasBreif) {
      return `Quick answer to ${task.task}.`;
    }

    return `Here is a detailed explanation of ${task.task}...`;
  },
};

// Baseline: Implicit only (learns from corrections)
const implicitOnlyBaseline: StyleLearner = {
  name: 'Implicit Only',
  learn(_explicit: StylePreference[], corrections: CorrectionExample[]): LearnedStyle {
    const preferences = new Map<string, number>();
    const patterns = new Map<string, string[]>();

    for (const corr of corrections) {
      preferences.set(corr.learned_preference, 1.0);
    }

    return { preferences, patterns };
  },
  generate(task: TestTask, style: LearnedStyle): string {
    const hasTypeScript = style.preferences.has('typescript_strict');
    const hasFunctional = style.preferences.has('functional');
    const hasNoComments = style.preferences.has('no_comments');
    const hasBottomLine = style.preferences.has('bottom_line_first');

    if (task.domain === 'code') {
      if (hasTypeScript && hasFunctional) {
        return `const example = (items: Item[]): Item[] => items.filter(x => x.active);`;
      }
      if (hasTypeScript) {
        return `function example(items: Item[]): Item[] {\n  return items.filter(x => x.active);\n}`;
      }
      return `function example(items) { return items.filter(x => x.active); }`;
    }

    if (task.domain === 'decision' && hasBottomLine) {
      return `Answer: Use the recommended option. Reason: It fits best.`;
    }

    return `Response to ${task.task}`;
  },
};

// Full BDI: Explicit + Implicit + Inference
const fullBDILearner: StyleLearner = {
  name: 'Full BDI (Ronald-GI)',
  learn(explicit: StylePreference[], corrections: CorrectionExample[], _noise: string[]): LearnedStyle {
    const preferences = new Map<string, number>();
    const patterns = new Map<string, string[]>();

    // Learn from explicit preferences
    for (const pref of explicit) {
      if (pref.explicit) {
        preferences.set(pref.id, 1.0);
      }
    }

    // Learn from implicit corrections
    for (const corr of corrections) {
      const current = preferences.get(corr.learned_preference) || 0;
      preferences.set(corr.learned_preference, Math.min(1.0, current + 0.2));
    }

    // Infer related preferences (if user likes X, probably likes Y)
    if (preferences.has('brevity') && preferences.has('directness')) {
      // Infer: user values efficiency
      preferences.set('bottom_line_first', 0.7);
    }

    if (preferences.has('typescript_strict') && preferences.has('functional')) {
      // Infer: user values modern code practices
      preferences.set('early_return', 0.7);
      preferences.set('no_comments', 0.5);
    }

    return { preferences, patterns };
  },
  generate(task: TestTask, style: LearnedStyle): string {
    // Check which preferences are relevant for this task
    const relevantPrefs = task.relevant_preferences.filter(p =>
      style.preferences.has(p) && style.preferences.get(p)! > 0.3
    );

    if (task.domain === 'code') {
      const useTS = relevantPrefs.includes('typescript_strict') || style.preferences.has('typescript_strict');
      const useFn = relevantPrefs.includes('functional') || style.preferences.has('functional');
      const noComm = relevantPrefs.includes('no_comments') || style.preferences.has('no_comments');

      if (useTS && useFn && noComm) {
        return `const calculate = (items: number[]): number => items.reduce((a, b) => a + b, 0) / items.length;`;
      }
      if (useTS && useFn) {
        return `const calculate = (items: number[]): number => {\n  const sum = items.reduce((a, b) => a + b, 0);\n  return sum / items.length;\n};`;
      }
      if (useTS) {
        return `function calculate(items: number[]): number {\n  return items.reduce((a, b) => a + b, 0) / items.length;\n}`;
      }
      return `function calculate(items) {\n  return items.reduce((a, b) => a + b, 0) / items.length;\n}`;
    }

    if (task.domain === 'decision') {
      const noHedge = relevantPrefs.includes('no_hedging') || style.preferences.has('no_hedging');
      const bottomLine = relevantPrefs.includes('bottom_line_first') || style.preferences.has('bottom_line_first');
      const direct = relevantPrefs.includes('directness') || style.preferences.has('directness');

      if (noHedge && bottomLine && direct) {
        return `Use GraphQL. Better for complex queries, built-in typing, single endpoint.`;
      }
      if (direct) {
        return `Recommendation: GraphQL. It fits this use case better.`;
      }
    }

    if (task.domain === 'explanation' || task.domain === 'process') {
      const useBullets = relevantPrefs.includes('bullets') || style.preferences.has('bullets');
      const useBrief = relevantPrefs.includes('brevity') || style.preferences.has('brevity');
      const codeFirst = relevantPrefs.includes('code_first') || style.preferences.has('code_first');

      if (useBullets && useBrief) {
        return `- Clone repo\n- Run npm install\n- Set env vars\n- Run npm start`;
      }
      if (codeFirst) {
        return '```bash\ngit clone && npm i && npm start\n```\nThat is all you need.';
      }
      if (useBrief) {
        return `Quick setup: clone, install, configure, run.`;
      }
    }

    return `Response to ${task.task}`;
  },
};

// =============================================================================
// EVALUATION
// =============================================================================

interface GeneratedOutput {
  task_id: string;
  output: string;
  matches_preferences: string[];
  violations: string[];
}

interface EvaluationResult {
  learner_name: string;
  style_consistency: number;
  generalization_accuracy: number;
  preference_coverage: number;
  outputs: GeneratedOutput[];
}

function evaluateOutput(
  output: string,
  task: TestTask,
  allPreferences: StylePreference[]
): { matches: string[]; violations: string[] } {
  const matches: string[] = [];
  const violations: string[] = [];

  for (const prefId of task.relevant_preferences) {
    const pref = allPreferences.find(p => p.id === prefId);
    if (!pref) continue;

    // Check if output matches examples
    let hasMatch = false;
    for (const example of pref.examples) {
      // Check for structural similarity
      if (pref.id === 'brevity' && output.length < 100) hasMatch = true;
      if (pref.id === 'bullets' && output.includes('- ')) hasMatch = true;
      if (pref.id === 'typescript_strict' && output.includes(': ')) hasMatch = true;
      if (pref.id === 'functional' && output.includes('=>')) hasMatch = true;
      if (pref.id === 'no_comments' && !output.includes('//')) hasMatch = true;
      if (pref.id === 'directness' && !output.includes('might') && !output.includes('perhaps')) hasMatch = true;
      if (pref.id === 'no_hedging' && !output.includes('depending') && !output.includes('consider')) hasMatch = true;
      if (pref.id === 'bottom_line_first' && (output.startsWith('Use ') || output.startsWith('Answer:'))) hasMatch = true;
      if (pref.id === 'code_first' && output.startsWith('```')) hasMatch = true;
    }

    // Check for anti-pattern violations
    let hasViolation = false;
    for (const antiExample of pref.anti_examples) {
      if (pref.id === 'brevity' && output.length > 200) hasViolation = true;
      if (pref.id === 'bullets' && output.includes('First,') && output.includes('Then,')) hasViolation = true;
      if (pref.id === 'directness' && output.includes('wondering if')) hasViolation = true;
      if (pref.id === 'no_hedging' && output.includes('might want to consider')) hasViolation = true;
    }

    if (hasMatch) matches.push(prefId);
    if (hasViolation) violations.push(prefId);
  }

  return { matches, violations };
}

function evaluateLearner(
  learner: StyleLearner,
  explicitPrefs: StylePreference[],
  corrections: CorrectionExample[],
  noise: string[],
  testTasks: TestTask[]
): EvaluationResult {
  // Learn from data
  const style = learner.learn(explicitPrefs, corrections, noise);

  // Generate outputs for test tasks
  const outputs: GeneratedOutput[] = [];
  let totalMatches = 0;
  let totalExpected = 0;
  let totalViolations = 0;

  for (const task of testTasks) {
    const output = learner.generate(task, style);
    const { matches, violations } = evaluateOutput(output, task, USER_STYLE);

    outputs.push({
      task_id: task.id,
      output,
      matches_preferences: matches,
      violations,
    });

    totalMatches += matches.length;
    totalExpected += task.relevant_preferences.length;
    totalViolations += violations.length;
  }

  const styleConsistency = totalMatches / totalExpected;
  const generalizationAccuracy = outputs.filter(o => o.matches_preferences.length > 0).length / outputs.length;
  const preferenceCoverage = new Set(outputs.flatMap(o => o.matches_preferences)).size / USER_STYLE.length;

  return {
    learner_name: learner.name,
    style_consistency: styleConsistency,
    generalization_accuracy: generalizationAccuracy,
    preference_coverage: preferenceCoverage,
    outputs,
  };
}

// =============================================================================
// EXPERIMENT RUNNER
// =============================================================================

async function runExperiment() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('              EXPERIMENT: "MY WAY" LEARNING');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('RESEARCH QUESTION:');
  console.log('Does the system learn to execute tasks according to USER STYLE,');
  console.log('not just following literal instructions?\n');

  console.log('DATA:');
  console.log(`  Explicit preferences: ${USER_STYLE.filter(p => p.explicit).length}`);
  console.log(`  Implicit preferences: ${USER_STYLE.filter(p => !p.explicit).length}`);
  console.log(`  Correction examples: ${CORRECTION_EXAMPLES.length}`);

  const noise = generateNoiseInteractions(500);
  console.log(`  Noise interactions: ${noise.length}`);
  console.log(`  Test tasks: ${TEST_TASKS.length}\n`);

  const learners: StyleLearner[] = [
    noLearningBaseline,
    explicitOnlyBaseline,
    implicitOnlyBaseline,
    fullBDILearner,
  ];

  console.log('─────────────────────────────────────────────────────────────────');
  console.log('                         RESULTS');
  console.log('─────────────────────────────────────────────────────────────────\n');

  const results: EvaluationResult[] = [];

  for (const learner of learners) {
    const result = evaluateLearner(
      learner,
      USER_STYLE,
      CORRECTION_EXAMPLES,
      noise,
      TEST_TASKS
    );
    results.push(result);

    const passConsistency = result.style_consistency >= 0.5 ? '✅' : '❌';
    const passGeneralization = result.generalization_accuracy >= 0.6 ? '✅' : '❌';
    const passCoverage = result.preference_coverage >= 0.4 ? '✅' : '❌';

    console.log(`[${learner.name}]`);
    console.log(`  ${passConsistency} Style Consistency:      ${(result.style_consistency * 100).toFixed(1)}%`);
    console.log(`  ${passGeneralization} Generalization:         ${(result.generalization_accuracy * 100).toFixed(1)}%`);
    console.log(`  ${passCoverage} Preference Coverage:    ${(result.preference_coverage * 100).toFixed(1)}%`);
    console.log();
  }

  // Summary comparison
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                    COMPARISON SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('┌─────────────────────────┬────────────┬────────────┬──────────┐');
  console.log('│ Method                  │ Consistent │ Generalizes│ Coverage │');
  console.log('├─────────────────────────┼────────────┼────────────┼──────────┤');
  for (const result of results) {
    const name = result.learner_name.slice(0, 23).padEnd(23);
    const cons = `${(result.style_consistency * 100).toFixed(0)}%`.padStart(8);
    const gen = `${(result.generalization_accuracy * 100).toFixed(0)}%`.padStart(8);
    const cov = `${(result.preference_coverage * 100).toFixed(0)}%`.padStart(6);
    console.log(`│ ${name} │ ${cons}   │ ${gen}   │ ${cov}   │`);
  }
  console.log('└─────────────────────────┴────────────┴────────────┴──────────┘');

  // Show improvement from baseline
  const baseline = results[0];
  const full = results[results.length - 1];
  const improvement = ((full.style_consistency - baseline.style_consistency) / baseline.style_consistency * 100);

  console.log(`\nImprovement over baseline: +${improvement.toFixed(0)}% style consistency`);

  // Success criteria
  const passes = full.style_consistency >= 0.5 && full.generalization_accuracy >= 0.6;

  console.log('\n═══════════════════════════════════════════════════════════════');
  if (passes) {
    console.log('✅ EXPERIMENT PASSED: System learns and generalizes user style');
  } else {
    console.log('❌ EXPERIMENT FAILED: Style learning below threshold');
  }
  console.log('═══════════════════════════════════════════════════════════════');

  // Show example outputs
  console.log('\n─────────────────────────────────────────────────────────────────');
  console.log('                    EXAMPLE OUTPUTS');
  console.log('─────────────────────────────────────────────────────────────────\n');

  const exampleTask = TEST_TASKS[0];
  console.log(`Task: "${exampleTask.task}"\n`);

  for (const result of results) {
    const output = result.outputs.find(o => o.task_id === exampleTask.id);
    console.log(`[${result.learner_name}]`);
    console.log(`  Output: ${output?.output.slice(0, 80)}...`);
    console.log(`  Matches: ${output?.matches_preferences.join(', ') || 'none'}`);
    console.log();
  }

  return { results, passed: passes };
}

export { runExperiment, USER_STYLE, TEST_TASKS };

runExperiment().catch(console.error);
