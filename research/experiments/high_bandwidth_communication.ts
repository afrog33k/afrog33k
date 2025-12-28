/**
 * Experiment: High-Bandwidth Communication
 *
 * RESEARCH QUESTION:
 * Can the system correctly interpret minimal feedback (even one word)
 * and confirm understanding?
 *
 * This tests the core Ronald-GI goal: be a colleague you can communicate
 * with efficiently, not a chatbot that needs everything spelled out.
 *
 * METHODOLOGY:
 * 1. Present system with task context + previous response
 * 2. Inject one-word feedback
 * 3. Test if system can:
 *    - Correctly classify the feedback intent
 *    - Propose appropriate action
 *    - Update internal model of user preferences
 *
 * BASELINES:
 * - No context (stateless interpretation)
 * - Keyword matching only
 * - Semantic embedding similarity
 * - BDI-augmented (full Ronald-GI with user model)
 */

import {
  generateOneWordFeedbackCorpus,
  OneWordFeedbackSample,
} from './dataset_loader';

// =============================================================================
// FEEDBACK INTERPRETATION SYSTEMS
// =============================================================================

interface InterpretationResult {
  predicted_category: string;
  predicted_meaning: string;
  predicted_action: string;
  confidence: number;
}

interface FeedbackInterpreter {
  name: string;
  interpret(
    feedback: string,
    taskContext: string,
    systemResponse: string,
    userHistory?: string[]
  ): InterpretationResult;
}

// -----------------------------------------------------------------------------
// Baseline 1: Stateless Keyword Matching
// -----------------------------------------------------------------------------

const KEYWORD_MAPPINGS: Record<string, { category: string; meaning: string; action: string }> = {
  // Approval
  yes: { category: 'approval', meaning: 'Correct, proceed', action: 'Continue' },
  good: { category: 'approval', meaning: 'Acceptable', action: 'Continue' },
  perfect: { category: 'approval', meaning: 'Exactly right', action: 'Finalize' },
  ok: { category: 'approval', meaning: 'Acceptable', action: 'Continue' },
  fine: { category: 'approval', meaning: 'Acceptable', action: 'Continue' },

  // Rejection
  no: { category: 'rejection', meaning: 'Incorrect', action: 'Stop and clarify' },
  wrong: { category: 'rejection', meaning: 'Incorrect approach', action: 'Ask what is wrong' },
  nope: { category: 'rejection', meaning: 'Incorrect', action: 'Abandon approach' },
  bad: { category: 'rejection', meaning: 'Poor quality', action: 'Redo completely' },

  // Refinement
  shorter: { category: 'refinement', meaning: 'Too verbose', action: 'Condense' },
  longer: { category: 'refinement', meaning: 'Too brief', action: 'Expand' },
  simpler: { category: 'refinement', meaning: 'Too complex', action: 'Simplify' },
  deeper: { category: 'refinement', meaning: 'Too shallow', action: 'Add depth' },
  faster: { category: 'refinement', meaning: 'Too slow', action: 'Speed up' },
  bolder: { category: 'refinement', meaning: 'Too timid', action: 'Be assertive' },
  tldr: { category: 'refinement', meaning: 'Too long', action: 'Summarize to 1-2 sentences' },

  // Direction
  pricing: { category: 'direction', meaning: 'Focus on pricing', action: 'Pivot to pricing' },
  security: { category: 'direction', meaning: 'Focus on security', action: 'Security analysis' },
  accessibility: { category: 'direction', meaning: 'Focus on a11y', action: 'A11y audit' },
  focus: { category: 'direction', meaning: 'Stay on topic', action: 'Return to main task' },
  pick: { category: 'direction', meaning: 'Decide for me', action: 'Make recommendation' },

  // Meta
  stop: { category: 'meta', meaning: 'Halt immediately', action: 'Stop all work' },
  wait: { category: 'meta', meaning: 'Pause', action: 'Pause and wait' },
  later: { category: 'meta', meaning: 'Defer', action: 'Save and deprioritize' },
  skip: { category: 'meta', meaning: 'Skip this step', action: 'Move to next' },
};

const keywordInterpreter: FeedbackInterpreter = {
  name: 'Keyword Matching',
  interpret(feedback: string): InterpretationResult {
    const normalized = feedback.toLowerCase().trim();
    const mapping = KEYWORD_MAPPINGS[normalized];

    if (mapping) {
      return {
        predicted_category: mapping.category,
        predicted_meaning: mapping.meaning,
        predicted_action: mapping.action,
        confidence: 1.0,
      };
    }

    return {
      predicted_category: 'unknown',
      predicted_meaning: 'Could not interpret',
      predicted_action: 'Ask for clarification',
      confidence: 0.0,
    };
  },
};

// -----------------------------------------------------------------------------
// Baseline 2: Semantic Similarity
// -----------------------------------------------------------------------------

// Simulated embeddings for semantic categories
const CATEGORY_EMBEDDINGS: Record<string, string[]> = {
  approval: ['yes', 'good', 'correct', 'right', 'agree', 'accept', 'fine', 'ok', 'perfect', 'great', 'nice', 'works'],
  rejection: ['no', 'wrong', 'incorrect', 'bad', 'fail', 'error', 'mistake', 'nope', 'disagree', 'reject'],
  refinement: ['change', 'modify', 'adjust', 'shorter', 'longer', 'simpler', 'complex', 'faster', 'slower', 'more', 'less', 'deeper', 'shallower'],
  direction: ['focus', 'topic', 'area', 'aspect', 'security', 'pricing', 'performance', 'design', 'pick', 'choose'],
  meta: ['stop', 'wait', 'pause', 'later', 'skip', 'continue', 'restart', 'undo', 'redo'],
};

const REFINEMENT_ACTIONS: Record<string, string> = {
  shorter: 'Condense the response',
  longer: 'Expand with more detail',
  simpler: 'Use simpler language',
  deeper: 'Add technical depth',
  faster: 'Speed up the process',
  bolder: 'Be more assertive',
  tldr: 'Give bottom line only',
  clearer: 'Clarify ambiguous points',
};

const semanticInterpreter: FeedbackInterpreter = {
  name: 'Semantic Similarity',
  interpret(feedback: string): InterpretationResult {
    const normalized = feedback.toLowerCase().trim();

    // Find best matching category
    let bestCategory = 'unknown';
    let bestScore = 0;

    for (const [category, terms] of Object.entries(CATEGORY_EMBEDDINGS)) {
      for (const term of terms) {
        // Simple semantic similarity: exact match or substring
        if (term === normalized || normalized.includes(term) || term.includes(normalized)) {
          const score = term === normalized ? 1.0 : 0.7;
          if (score > bestScore) {
            bestScore = score;
            bestCategory = category;
          }
        }
      }
    }

    // Determine action based on category and specific word
    let action = 'Process feedback';
    let meaning = `Interpreted as ${bestCategory}`;

    if (bestCategory === 'refinement' && REFINEMENT_ACTIONS[normalized]) {
      action = REFINEMENT_ACTIONS[normalized];
      meaning = `Request to modify: ${normalized}`;
    } else if (bestCategory === 'approval') {
      action = 'Continue with current approach';
      meaning = 'User approves';
    } else if (bestCategory === 'rejection') {
      action = 'Stop and ask for clarification';
      meaning = 'User rejects current approach';
    } else if (bestCategory === 'direction') {
      action = `Focus on ${normalized}`;
      meaning = `Redirect to ${normalized} aspect`;
    } else if (bestCategory === 'meta') {
      action = `Execute ${normalized} command`;
      meaning = `Control signal: ${normalized}`;
    }

    return {
      predicted_category: bestCategory,
      predicted_meaning: meaning,
      predicted_action: action,
      confidence: bestScore,
    };
  },
};

// -----------------------------------------------------------------------------
// Baseline 3: Context-Aware Interpreter
// -----------------------------------------------------------------------------

const contextAwareInterpreter: FeedbackInterpreter = {
  name: 'Context-Aware',
  interpret(feedback: string, taskContext: string, systemResponse: string): InterpretationResult {
    const normalized = feedback.toLowerCase().trim();

    // Start with semantic interpretation
    const semanticResult = semanticInterpreter.interpret(feedback, taskContext, systemResponse);

    // Enhance with context
    let enhancedMeaning = semanticResult.predicted_meaning;
    let enhancedAction = semanticResult.predicted_action;
    let confidence = semanticResult.confidence;

    // Context-specific enhancements
    if (taskContext.includes('summarize') && normalized === 'shorter') {
      enhancedMeaning = 'Summary is too long';
      enhancedAction = 'Reduce to key points only';
      confidence = 0.95;
    }

    if (taskContext.includes('email') && normalized === 'bolder') {
      enhancedMeaning = 'Email is too passive';
      enhancedAction = 'Use more direct language, clear calls to action';
      confidence = 0.95;
    }

    if (taskContext.includes('code') && normalized === 'simpler') {
      enhancedMeaning = 'Code is too complex';
      enhancedAction = 'Refactor for readability, reduce nesting';
      confidence = 0.95;
    }

    if (systemResponse.length > 500 && normalized === 'tldr') {
      enhancedMeaning = 'Response is too long for current attention';
      enhancedAction = 'Summarize to 1-2 sentences with key takeaway';
      confidence = 0.98;
    }

    return {
      predicted_category: semanticResult.predicted_category,
      predicted_meaning: enhancedMeaning,
      predicted_action: enhancedAction,
      confidence,
    };
  },
};

// -----------------------------------------------------------------------------
// Full Ronald-GI: BDI-Augmented Interpreter
// -----------------------------------------------------------------------------

interface UserModel {
  communication_preferences: {
    verbosity: 'brief' | 'moderate' | 'detailed';
    formality: 'casual' | 'professional';
    decisiveness: 'autonomous' | 'consultative';
  };
  feedback_history: Array<{
    feedback: string;
    context: string;
    outcome: 'positive' | 'negative';
  }>;
  learned_patterns: Map<string, string>; // feedback -> preferred action
}

function createDefaultUserModel(): UserModel {
  return {
    communication_preferences: {
      verbosity: 'brief', // ADHD default: prefer brevity
      formality: 'casual',
      decisiveness: 'autonomous', // "just pick for me"
    },
    feedback_history: [],
    learned_patterns: new Map(),
  };
}

const bdiAugmentedInterpreter: FeedbackInterpreter = {
  name: 'BDI-Augmented (Ronald-GI)',
  interpret(
    feedback: string,
    taskContext: string,
    systemResponse: string,
    userHistory?: string[]
  ): InterpretationResult {
    const normalized = feedback.toLowerCase().trim();

    // Build user model from history (simplified)
    const userModel = createDefaultUserModel();
    if (userHistory) {
      for (const hist of userHistory) {
        if (hist.includes('shorter') || hist.includes('tldr')) {
          userModel.communication_preferences.verbosity = 'brief';
        }
        if (hist.includes('pick') || hist.includes('decide')) {
          userModel.communication_preferences.decisiveness = 'autonomous';
        }
      }
    }

    // Start with context-aware interpretation
    const contextResult = contextAwareInterpreter.interpret(feedback, taskContext, systemResponse);

    // BDI enhancements based on user model
    let enhancedMeaning = contextResult.predicted_meaning;
    let enhancedAction = contextResult.predicted_action;
    let confidence = contextResult.confidence;

    // ADHD-specific patterns
    if (userModel.communication_preferences.verbosity === 'brief') {
      if (['yes', 'ok', 'good'].includes(normalized)) {
        // Brief acknowledgment means "done, move on"
        enhancedMeaning = 'Approved, ready for next task';
        enhancedAction = 'Finalize and present next priority';
        confidence = 0.95;
      }
    }

    if (userModel.communication_preferences.decisiveness === 'autonomous') {
      if (normalized === 'pick' || normalized === 'decide' || normalized === 'choose') {
        enhancedMeaning = 'User wants autonomous decision';
        enhancedAction = 'Make best recommendation and proceed';
        confidence = 0.98;
      }
    }

    // Learn from this interaction
    if (normalized === 'wrong' && userHistory) {
      // This pattern led to rejection, learn from it
      enhancedAction = 'Stop, apologize briefly, ask: "What should I change?"';
      confidence = 0.95;
    }

    // Proactive understanding: "focus" in ADHD context
    if (normalized === 'focus') {
      enhancedMeaning = 'User is getting distracted, return to main goal';
      enhancedAction = 'Acknowledge distraction, summarize main task, provide next step';
      confidence = 0.98;
    }

    return {
      predicted_category: contextResult.predicted_category,
      predicted_meaning: enhancedMeaning,
      predicted_action: enhancedAction,
      confidence,
    };
  },
};

// =============================================================================
// EVALUATION
// =============================================================================

interface EvaluationResult {
  interpreter_name: string;
  total_samples: number;
  category_accuracy: number;
  meaning_similarity: number; // How close is predicted meaning to ground truth
  action_appropriateness: number; // Is the action reasonable for the intent
  average_confidence: number;
  by_category: Record<string, { correct: number; total: number }>;
}

function evaluateMeaningSimilarity(predicted: string, expected: string): number {
  const predWords = new Set(predicted.toLowerCase().split(/\s+/));
  const expWords = new Set(expected.toLowerCase().split(/\s+/));

  let overlap = 0;
  for (const word of predWords) {
    if (expWords.has(word)) overlap++;
  }

  const union = new Set([...predWords, ...expWords]).size;
  return union > 0 ? overlap / union : 0;
}

function evaluateActionAppropriateness(predicted: string, expected: string, category: string): number {
  // Check if action is in the right direction
  const predLower = predicted.toLowerCase();
  const expLower = expected.toLowerCase();

  // Direct match
  if (predLower === expLower) return 1.0;

  // Partial match
  const predWords = new Set(predLower.split(/\s+/));
  const expWords = new Set(expLower.split(/\s+/));
  let overlap = 0;
  for (const word of predWords) {
    if (expWords.has(word)) overlap++;
  }

  // Category-appropriate action bonus
  let categoryBonus = 0;
  if (category === 'approval' && (predLower.includes('continue') || predLower.includes('proceed'))) {
    categoryBonus = 0.3;
  }
  if (category === 'rejection' && (predLower.includes('stop') || predLower.includes('clarif'))) {
    categoryBonus = 0.3;
  }
  if (category === 'refinement' && predLower.includes(category)) {
    categoryBonus = 0.2;
  }

  return Math.min(1.0, (overlap / Math.max(predWords.size, expWords.size)) + categoryBonus);
}

function evaluateInterpreter(
  interpreter: FeedbackInterpreter,
  corpus: OneWordFeedbackSample[]
): EvaluationResult {
  let categoryCorrect = 0;
  let meaningSimSum = 0;
  let actionAppSum = 0;
  let confidenceSum = 0;

  const byCategory: Record<string, { correct: number; total: number }> = {};

  for (const sample of corpus) {
    const result = interpreter.interpret(
      sample.user_feedback,
      sample.task_context,
      sample.system_response
    );

    // Category accuracy
    if (result.predicted_category === sample.category) {
      categoryCorrect++;
    }

    // Meaning similarity
    meaningSimSum += evaluateMeaningSimilarity(result.predicted_meaning, sample.intended_meaning);

    // Action appropriateness
    actionAppSum += evaluateActionAppropriateness(result.predicted_action, sample.expected_action, sample.category);

    // Confidence
    confidenceSum += result.confidence;

    // By category breakdown
    if (!byCategory[sample.category]) {
      byCategory[sample.category] = { correct: 0, total: 0 };
    }
    byCategory[sample.category].total++;
    if (result.predicted_category === sample.category) {
      byCategory[sample.category].correct++;
    }
  }

  return {
    interpreter_name: interpreter.name,
    total_samples: corpus.length,
    category_accuracy: categoryCorrect / corpus.length,
    meaning_similarity: meaningSimSum / corpus.length,
    action_appropriateness: actionAppSum / corpus.length,
    average_confidence: confidenceSum / corpus.length,
    by_category: byCategory,
  };
}

// =============================================================================
// EXPERIMENT RUNNER
// =============================================================================

async function runExperiment() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('      EXPERIMENT: HIGH-BANDWIDTH COMMUNICATION');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('RESEARCH QUESTION:');
  console.log('Can the system correctly interpret minimal feedback (one word)?');
  console.log('This is critical for Ronald-GI as a proactive colleague.\n');

  const corpus = generateOneWordFeedbackCorpus();
  console.log(`Corpus: ${corpus.length} one-word feedback samples`);
  console.log(`Categories: ${[...new Set(corpus.map(s => s.category))].join(', ')}\n`);

  const interpreters: FeedbackInterpreter[] = [
    keywordInterpreter,
    semanticInterpreter,
    contextAwareInterpreter,
    bdiAugmentedInterpreter,
  ];

  console.log('─────────────────────────────────────────────────────────────────');
  console.log('                         RESULTS');
  console.log('─────────────────────────────────────────────────────────────────\n');

  const results: EvaluationResult[] = [];

  for (const interpreter of interpreters) {
    const result = evaluateInterpreter(interpreter, corpus);
    results.push(result);

    const passCategory = result.category_accuracy >= 0.8 ? '✅' : '❌';
    const passMeaning = result.meaning_similarity >= 0.5 ? '✅' : '❌';
    const passAction = result.action_appropriateness >= 0.6 ? '✅' : '❌';

    console.log(`[${interpreter.name}]`);
    console.log(`  ${passCategory} Category Accuracy:     ${(result.category_accuracy * 100).toFixed(1)}%`);
    console.log(`  ${passMeaning} Meaning Similarity:    ${(result.meaning_similarity * 100).toFixed(1)}%`);
    console.log(`  ${passAction} Action Appropriateness: ${(result.action_appropriateness * 100).toFixed(1)}%`);
    console.log(`     Confidence:            ${(result.average_confidence * 100).toFixed(1)}%`);
    console.log();
  }

  // Summary comparison
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                    COMPARISON SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('┌────────────────────────┬──────────┬──────────┬──────────┐');
  console.log('│ Method                 │ Category │ Meaning  │ Action   │');
  console.log('├────────────────────────┼──────────┼──────────┼──────────┤');
  for (const result of results) {
    const name = result.interpreter_name.padEnd(22);
    const cat = `${(result.category_accuracy * 100).toFixed(0)}%`.padStart(6);
    const mean = `${(result.meaning_similarity * 100).toFixed(0)}%`.padStart(6);
    const act = `${(result.action_appropriateness * 100).toFixed(0)}%`.padStart(6);
    console.log(`│ ${name} │ ${cat}   │ ${mean}   │ ${act}   │`);
  }
  console.log('└────────────────────────┴──────────┴──────────┴──────────┘');

  // Find best performer
  const best = results.reduce((a, b) =>
    (a.category_accuracy + a.meaning_similarity + a.action_appropriateness) >
    (b.category_accuracy + b.meaning_similarity + b.action_appropriateness) ? a : b
  );

  console.log(`\nBest Performer: ${best.interpreter_name}`);
  console.log(`Combined Score: ${((best.category_accuracy + best.meaning_similarity + best.action_appropriateness) / 3 * 100).toFixed(1)}%`);

  // Success criteria check
  const ronaldGI = results.find(r => r.interpreter_name.includes('Ronald-GI'));
  const passThreshold = ronaldGI && ronaldGI.category_accuracy >= 0.8;

  console.log('\n═══════════════════════════════════════════════════════════════');
  if (passThreshold) {
    console.log('✅ EXPERIMENT PASSED: Ronald-GI achieves 80%+ intent recognition');
  } else {
    console.log('❌ EXPERIMENT FAILED: Intent recognition below 80% threshold');
  }
  console.log('═══════════════════════════════════════════════════════════════');

  return { results, passed: passThreshold };
}

export { runExperiment, evaluateInterpreter, generateOneWordFeedbackCorpus };

runExperiment().catch(console.error);
