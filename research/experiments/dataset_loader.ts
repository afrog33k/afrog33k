/**
 * Dataset Loader for Ronald-GI Research
 *
 * Downloads and processes real benchmark datasets:
 * - PersonaMem-v2: Implicit persona retrieval (HuggingFace)
 * - LoCoMo: Long-term conversational memory (ACL 2024)
 *
 * Sources:
 * - https://huggingface.co/datasets/bowen-upenn/PersonaMem-v2
 * - https://github.com/snap-research/locomo
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// =============================================================================
// DATASET CONFIGURATION
// =============================================================================

interface DatasetConfig {
  name: string;
  source: string;
  huggingface_id?: string;
  github_url?: string;
  description: string;
  metrics: string[];
}

const DATASETS: Record<string, DatasetConfig> = {
  personamem_v2: {
    name: 'PersonaMem-v2',
    source: 'huggingface',
    huggingface_id: 'bowen-upenn/PersonaMem-v2',
    description:
      'Implicit persona retrieval benchmark. 1,000 personas, 26,100 preferences, ' +
      '128k-token contexts. Tests if system can infer preferences from implicit signals.',
    metrics: ['implicit_retrieval_accuracy', 'preference_inference', 'context_utilization'],
  },
  locomo: {
    name: 'LoCoMo',
    source: 'github',
    github_url: 'https://github.com/snap-research/locomo',
    description:
      'Long-term conversational memory benchmark (ACL 2024). ' +
      '600 turns, 16K tokens, 32 sessions per conversation. ' +
      'Tests factual recall, temporal reasoning, causal understanding.',
    metrics: ['factual_recall', 'temporal_reasoning', 'causal_understanding', 'event_summarization'],
  },
  msc: {
    name: 'Multi-Session Chat',
    source: 'huggingface',
    huggingface_id: 'facebook/msc',
    description: 'Facebook multi-session chat dataset. 164k utterances. Persona-grounded conversations.',
    metrics: ['persona_consistency', 'session_coherence'],
  },
};

// =============================================================================
// PERSONAMEM-V2 SAMPLE STRUCTURE
// =============================================================================

interface PersonaMemSample {
  persona_id: string;
  user_profile: {
    demographics: Record<string, string>;
    preferences: Array<{
      category: string;
      preference: string;
      implicit: boolean;
      conversation_context: string;
    }>;
  };
  conversations: Array<{
    topic: string;
    turns: Array<{
      role: 'user' | 'assistant';
      content: string;
      implicit_signals?: string[];
    }>;
  }>;
  qa_pairs: Array<{
    question: string;
    answer: string;
    requires_inference: boolean;
    source_turns: number[];
  }>;
}

// =============================================================================
// LOCOMO SAMPLE STRUCTURE
// =============================================================================

interface LoCoMoSample {
  conversation_id: string;
  sessions: Array<{
    session_id: number;
    date: string;
    turns: Array<{
      speaker: 'A' | 'B';
      text: string;
      timestamp?: string;
      media?: { type: 'image'; url: string };
    }>;
  }>;
  event_graph: {
    events: Array<{
      id: string;
      description: string;
      timestamp: string;
      participants: string[];
    }>;
    temporal_relations: Array<{
      event1: string;
      event2: string;
      relation: 'before' | 'after' | 'during';
    }>;
    causal_relations: Array<{
      cause: string;
      effect: string;
    }>;
  };
  qa_annotations: Array<{
    question: string;
    answer: string;
    type: 'factual' | 'temporal' | 'causal' | 'summary';
    difficulty: 'easy' | 'medium' | 'hard';
    relevant_turns: number[];
  }>;
}

// =============================================================================
// SYNTHETIC DATA GENERATION (for when real datasets aren't available)
// =============================================================================

/**
 * Generate synthetic PersonaMem-v2 style data for testing
 * Based on the paper's description of implicit persona signals
 */
function generateSyntheticPersonaMemData(count: number = 100): PersonaMemSample[] {
  const personas: PersonaMemSample[] = [];

  const preferenceCategories = [
    'communication_style',
    'work_habits',
    'food_preferences',
    'entertainment',
    'health',
    'technology',
    'social',
    'learning_style',
  ];

  const implicitSignalTemplates = [
    {
      context: "I need to finish this before my morning coffee ritual",
      inferred_preference: "morning person, values routine",
      category: "work_habits"
    },
    {
      context: "Can you make this more concise? I hate long-winded explanations",
      inferred_preference: "prefers brevity",
      category: "communication_style"
    },
    {
      context: "Let me check my standing desk timer...",
      inferred_preference: "health-conscious, uses standing desk",
      category: "health"
    },
    {
      context: "I'll review this after my ADHD meds kick in",
      inferred_preference: "has ADHD, medication-managed",
      category: "health"
    },
    {
      context: "Can you format this as bullet points? My brain works better that way",
      inferred_preference: "visual/structured learner, possibly ADHD",
      category: "learning_style"
    },
    {
      context: "I need to pick up my kids at 3pm so let's wrap this up",
      inferred_preference: "parent, time-constrained afternoons",
      category: "social"
    },
    {
      context: "Send it to my Signal, not email - I never check email",
      inferred_preference: "prefers instant messaging over email",
      category: "communication_style"
    },
    {
      context: "I'm working from my cabin this week, so spotty internet",
      inferred_preference: "remote worker, values nature/retreat",
      category: "work_habits"
    },
  ];

  for (let i = 0; i < count; i++) {
    // Select 3-5 random implicit signals for this persona
    const numPreferences = 3 + Math.floor(Math.random() * 3);
    const selectedSignals = [...implicitSignalTemplates]
      .sort(() => Math.random() - 0.5)
      .slice(0, numPreferences);

    const preferences = selectedSignals.map((signal) => ({
      category: signal.category,
      preference: signal.inferred_preference,
      implicit: true,
      conversation_context: signal.context,
    }));

    // Generate conversations that contain these implicit signals
    const conversations = selectedSignals.map((signal, idx) => ({
      topic: `task_${idx}`,
      turns: [
        {
          role: 'user' as const,
          content: signal.context,
          implicit_signals: [signal.inferred_preference],
        },
        {
          role: 'assistant' as const,
          content: 'I understand. Let me help you with that.',
        },
      ],
    }));

    // Generate QA pairs that test implicit understanding
    const qa_pairs = preferences.map((pref, idx) => ({
      question: `Based on our conversations, what do you know about my ${pref.category.replace('_', ' ')}?`,
      answer: pref.preference,
      requires_inference: true,
      source_turns: [idx * 2], // First turn of each conversation
    }));

    personas.push({
      persona_id: `persona_${i}`,
      user_profile: {
        demographics: {
          generated: 'synthetic',
          index: String(i),
        },
        preferences,
      },
      conversations,
      qa_pairs,
    });
  }

  return personas;
}

/**
 * Generate synthetic LoCoMo style data for testing
 * Based on the paper's 600 turns, 16K tokens, 32 sessions structure
 */
function generateSyntheticLoCoMoData(count: number = 10): LoCoMoSample[] {
  const conversations: LoCoMoSample[] = [];

  const eventTypes = [
    'started new job',
    'went on vacation',
    'had a birthday',
    'moved to new city',
    'adopted a pet',
    'got promoted',
    'attended conference',
    'completed project',
    'met new friend',
    'learned new skill',
  ];

  for (let i = 0; i < count; i++) {
    // Generate 5-10 sessions
    const numSessions = 5 + Math.floor(Math.random() * 6);
    const sessions: LoCoMoSample['sessions'] = [];
    const events: LoCoMoSample['event_graph']['events'] = [];

    let currentDate = new Date('2024-01-01');

    for (let s = 0; s < numSessions; s++) {
      // Each session is 1-7 days after the previous
      currentDate = new Date(currentDate.getTime() + (1 + Math.random() * 6) * 24 * 60 * 60 * 1000);

      // Generate 20-60 turns per session
      const numTurns = 20 + Math.floor(Math.random() * 40);
      const turns: LoCoMoSample['sessions'][0]['turns'] = [];

      // Maybe introduce a new event in this session
      if (Math.random() > 0.5) {
        const eventType = eventTypes[Math.floor(Math.random() * eventTypes.length)];
        events.push({
          id: `event_${i}_${s}`,
          description: eventType,
          timestamp: currentDate.toISOString(),
          participants: ['A'],
        });

        // First turn mentions the event
        turns.push({
          speaker: 'A',
          text: `Guess what? I ${eventType}!`,
          timestamp: currentDate.toISOString(),
        });
        turns.push({
          speaker: 'B',
          text: `That's amazing! Tell me more about it.`,
        });
      }

      // Fill rest of session with general conversation
      for (let t = turns.length; t < numTurns; t++) {
        turns.push({
          speaker: t % 2 === 0 ? 'A' : 'B',
          text: `Turn ${t} of session ${s} in conversation ${i}`,
        });
      }

      sessions.push({
        session_id: s,
        date: currentDate.toISOString().split('T')[0],
        turns,
      });
    }

    // Generate temporal relations between events
    const temporal_relations: LoCoMoSample['event_graph']['temporal_relations'] = [];
    for (let e = 1; e < events.length; e++) {
      temporal_relations.push({
        event1: events[e - 1].id,
        event2: events[e].id,
        relation: 'before',
      });
    }

    // Generate QA annotations
    const qa_annotations: LoCoMoSample['qa_annotations'] = [];

    // Factual recall questions
    for (const event of events) {
      qa_annotations.push({
        question: `What happened to A on ${event.timestamp.split('T')[0]}?`,
        answer: event.description,
        type: 'factual',
        difficulty: 'easy',
        relevant_turns: [0],
      });
    }

    // Temporal reasoning questions
    if (events.length >= 2) {
      qa_annotations.push({
        question: `What happened first: ${events[0].description} or ${events[events.length - 1].description}?`,
        answer: events[0].description,
        type: 'temporal',
        difficulty: 'medium',
        relevant_turns: [0],
      });
    }

    conversations.push({
      conversation_id: `conv_${i}`,
      sessions,
      event_graph: {
        events,
        temporal_relations,
        causal_relations: [],
      },
      qa_annotations,
    });
  }

  return conversations;
}

// =============================================================================
// ONE-WORD FEEDBACK CORPUS
// =============================================================================

interface OneWordFeedbackSample {
  task_context: string;
  system_response: string;
  user_feedback: string; // One word only
  intended_meaning: string;
  expected_action: string;
  category: 'approval' | 'rejection' | 'refinement' | 'direction' | 'meta';
}

/**
 * Generate corpus for testing high-bandwidth communication
 * Can the system understand one-word feedback correctly?
 */
function generateOneWordFeedbackCorpus(): OneWordFeedbackSample[] {
  return [
    // Approval signals
    {
      task_context: "Summarize this research paper for me",
      system_response: "The paper proposes a novel attention mechanism...",
      user_feedback: "yes",
      intended_meaning: "This is correct, proceed",
      expected_action: "Continue with current approach",
      category: "approval"
    },
    {
      task_context: "Write an email to the team",
      system_response: "Dear team, I wanted to share some updates...",
      user_feedback: "perfect",
      intended_meaning: "This is exactly what I wanted",
      expected_action: "Finalize and send",
      category: "approval"
    },
    {
      task_context: "Explain this code snippet",
      system_response: "This function iterates through the array...",
      user_feedback: "good",
      intended_meaning: "Acceptable quality, can proceed",
      expected_action: "Continue, no changes needed",
      category: "approval"
    },

    // Rejection signals
    {
      task_context: "Draft a proposal for the client",
      system_response: "We propose to implement a microservices architecture...",
      user_feedback: "wrong",
      intended_meaning: "This is not what I asked for",
      expected_action: "Stop and ask for clarification",
      category: "rejection"
    },
    {
      task_context: "Create a meeting agenda",
      system_response: "1. Welcome and introductions (15 min)...",
      user_feedback: "no",
      intended_meaning: "This approach is incorrect",
      expected_action: "Abandon current approach, ask what's wrong",
      category: "rejection"
    },
    {
      task_context: "Analyze the sales data",
      system_response: "Sales have increased by 15% this quarter...",
      user_feedback: "nope",
      intended_meaning: "Analysis is incorrect or irrelevant",
      expected_action: "Re-analyze with different approach",
      category: "rejection"
    },

    // Refinement signals
    {
      task_context: "Write documentation for the API",
      system_response: "The API provides endpoints for user management...",
      user_feedback: "shorter",
      intended_meaning: "Reduce verbosity",
      expected_action: "Condense to essential information",
      category: "refinement"
    },
    {
      task_context: "Explain the architecture",
      system_response: "The system uses a layered architecture...",
      user_feedback: "deeper",
      intended_meaning: "Need more detail and depth",
      expected_action: "Expand with technical details",
      category: "refinement"
    },
    {
      task_context: "Summarize the meeting notes",
      system_response: "We discussed three main topics...",
      user_feedback: "simpler",
      intended_meaning: "Too complex, simplify language",
      expected_action: "Rewrite with simpler terms",
      category: "refinement"
    },
    {
      task_context: "Draft the project plan",
      system_response: "Phase 1: Requirements gathering...",
      user_feedback: "faster",
      intended_meaning: "Timeline is too slow",
      expected_action: "Compress timeline, parallelize tasks",
      category: "refinement"
    },
    {
      task_context: "Write the introduction",
      system_response: "This paper presents...",
      user_feedback: "bolder",
      intended_meaning: "Be more assertive/confident",
      expected_action: "Use stronger language, make claims",
      category: "refinement"
    },

    // Direction signals
    {
      task_context: "Research competitors",
      system_response: "I found 5 main competitors in the market...",
      user_feedback: "pricing",
      intended_meaning: "Focus on pricing specifically",
      expected_action: "Pivot to pricing analysis",
      category: "direction"
    },
    {
      task_context: "Analyze the codebase",
      system_response: "The codebase has 50,000 lines...",
      user_feedback: "security",
      intended_meaning: "Focus on security aspects",
      expected_action: "Analyze for security vulnerabilities",
      category: "direction"
    },
    {
      task_context: "Review the design",
      system_response: "The design follows material guidelines...",
      user_feedback: "accessibility",
      intended_meaning: "Evaluate accessibility compliance",
      expected_action: "Check WCAG compliance, contrast, etc.",
      category: "direction"
    },

    // Meta signals
    {
      task_context: "Any task",
      system_response: "Any response",
      user_feedback: "stop",
      intended_meaning: "Halt current action",
      expected_action: "Immediately stop, await instructions",
      category: "meta"
    },
    {
      task_context: "Any task",
      system_response: "Any response",
      user_feedback: "wait",
      intended_meaning: "Pause, I need to think",
      expected_action: "Pause and wait for continuation",
      category: "meta"
    },
    {
      task_context: "Any task",
      system_response: "Any response",
      user_feedback: "later",
      intended_meaning: "Defer this task",
      expected_action: "Save state, deprioritize task",
      category: "meta"
    },
    {
      task_context: "Complex task in progress",
      system_response: "Working on step 3 of 5...",
      user_feedback: "skip",
      intended_meaning: "Skip current step",
      expected_action: "Move to next step",
      category: "meta"
    },

    // ADHD-specific signals
    {
      task_context: "Long explanation requested",
      system_response: "First, let me explain the background...",
      user_feedback: "tldr",
      intended_meaning: "Give me the bottom line only",
      expected_action: "Summarize to 1-2 sentences",
      category: "refinement"
    },
    {
      task_context: "Task with many options",
      system_response: "You have 10 options to consider...",
      user_feedback: "pick",
      intended_meaning: "Just choose one for me",
      expected_action: "Make the decision, explain briefly",
      category: "direction"
    },
    {
      task_context: "Research task",
      system_response: "I found interesting tangential information...",
      user_feedback: "focus",
      intended_meaning: "I'm getting distracted, stay on topic",
      expected_action: "Return to original task, ignore tangents",
      category: "meta"
    },
  ];
}

// =============================================================================
// EXPORT AND CLI
// =============================================================================

export {
  DATASETS,
  PersonaMemSample,
  LoCoMoSample,
  OneWordFeedbackSample,
  generateSyntheticPersonaMemData,
  generateSyntheticLoCoMoData,
  generateOneWordFeedbackCorpus,
};

// CLI for generating synthetic data
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('              RONALD-GI RESEARCH DATASET LOADER');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('Available Datasets:');
  for (const [key, config] of Object.entries(DATASETS)) {
    console.log(`\n[${key}] ${config.name}`);
    console.log(`  Source: ${config.source}`);
    console.log(`  Description: ${config.description}`);
    console.log(`  Metrics: ${config.metrics.join(', ')}`);
  }

  console.log('\n─────────────────────────────────────────────────────────────────');
  console.log('Generating Synthetic Data...\n');

  const personaMemData = generateSyntheticPersonaMemData(100);
  console.log(`PersonaMem-v2 synthetic: ${personaMemData.length} personas generated`);
  console.log(`  Total preferences: ${personaMemData.reduce((sum, p) => sum + p.user_profile.preferences.length, 0)}`);
  console.log(`  Total QA pairs: ${personaMemData.reduce((sum, p) => sum + p.qa_pairs.length, 0)}`);

  const locomoData = generateSyntheticLoCoMoData(10);
  console.log(`\nLoCoMo synthetic: ${locomoData.length} conversations generated`);
  console.log(`  Total sessions: ${locomoData.reduce((sum, c) => sum + c.sessions.length, 0)}`);
  console.log(`  Total events: ${locomoData.reduce((sum, c) => sum + c.event_graph.events.length, 0)}`);
  console.log(`  Total QA pairs: ${locomoData.reduce((sum, c) => sum + c.qa_annotations.length, 0)}`);

  const feedbackCorpus = generateOneWordFeedbackCorpus();
  console.log(`\nOne-word feedback corpus: ${feedbackCorpus.length} samples`);
  const byCategory: Record<string, number> = {};
  for (const sample of feedbackCorpus) {
    byCategory[sample.category] = (byCategory[sample.category] || 0) + 1;
  }
  console.log(`  By category: ${JSON.stringify(byCategory)}`);

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('Synthetic data ready for experiments.');
  console.log('For real data, download from HuggingFace/GitHub:');
  console.log('  - PersonaMem-v2: huggingface.co/datasets/bowen-upenn/PersonaMem-v2');
  console.log('  - LoCoMo: github.com/snap-research/locomo');
  console.log('═══════════════════════════════════════════════════════════════');
}
