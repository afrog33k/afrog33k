/**
 * BDI (Belief-Desire-Intention) Model Tests for Ronald-GI
 *
 * Based on Satori: Proactive AR Assistant (arxiv:2410.16668)
 *
 * These tests verify that the BDI model:
 * 1. Correctly tracks user beliefs, desires, and intentions
 * 2. Performs Bayesian confidence updates on repeated observations
 * 3. Infers user needs from gaps between desires and intentions
 * 4. Handles ADHD-specific behaviors (scattered attention, cognitive load)
 * 5. Provides personalized recommendations based on mental state
 *
 * Ground truth: Ronald Adonyo profile (INTJ, ADHD, 25+ years experience)
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  getTestDb,
  resetTestDb,
  closeTestDb,
  createTestUserProfile,
  createTestBelief,
  createTestDesire,
  createTestIntention,
  addADHDContext,
  createHighCognitiveLoad,
} from './setup';
import {
  BeliefManager,
  DesireManager,
  IntentionManager,
  BDIReasoner,
  createBDIModel,
} from '../lib/bdi_model';

// Ground truth: Ronald Adonyo's actual profile
const RONALD_PROFILE = {
  id: 'ronald_adonyo',
  name: 'Ronald Adonyo',
  username: 'afrog33k',
  traits: {
    mbti: 'INTJ',
    adhd: true,
    iqRange: '150-167',
  },
  expertise: ['C#', 'C++', 'compilers', 'sales-enablement', 'AI/ML'],
  interests: ['autonomous-ai', 'memory-augmentation', 'adhd-tools'],
  desires: [
    'Build AI that understands and anticipates needs',
    'Reduce cognitive load from scattered attention',
    'Never miss important research',
  ],
};

describe('BDI Model: Belief Manager', () => {
  let db: ReturnType<typeof getTestDb>;
  let beliefs: BeliefManager;

  beforeEach(() => {
    resetTestDb();
    db = getTestDb();
    beliefs = new BeliefManager(db);
    createTestUserProfile(db, { id: 'test_user', name: 'Test User' });
  });

  afterAll(() => {
    closeTestDb();
  });

  describe('Belief CRUD Operations', () => {
    it('should store and retrieve beliefs', () => {
      beliefs.upsertBelief({
        userId: 'test_user',
        type: 'expertise',
        subject: 'test_user',
        predicate: 'is_expert_in',
        object: 'TypeScript',
        confidence: 0.9,
        source: 'observed',
        evidence: { source: 'GitHub activity' },
      });

      const retrieved = beliefs.getBeliefs('test_user');
      expect(retrieved).toHaveLength(1);
      expect(retrieved[0].object).toBe('TypeScript');
      expect(retrieved[0].confidence).toBe(0.9);
    });

    it('should filter beliefs by type', () => {
      beliefs.upsertBelief({
        userId: 'test_user',
        type: 'expertise',
        subject: 'test_user',
        predicate: 'is_expert_in',
        object: 'TypeScript',
        confidence: 0.9,
        source: 'observed',
        evidence: {},
      });

      beliefs.upsertBelief({
        userId: 'test_user',
        type: 'interest',
        subject: 'test_user',
        predicate: 'is_interested_in',
        object: 'AI',
        confidence: 0.8,
        source: 'observed',
        evidence: {},
      });

      const expertiseBeliefs = beliefs.getBeliefs('test_user', 'expertise');
      const interestBeliefs = beliefs.getBeliefs('test_user', 'interest');

      expect(expertiseBeliefs).toHaveLength(1);
      expect(interestBeliefs).toHaveLength(1);
      expect(expertiseBeliefs[0].object).toBe('TypeScript');
      expect(interestBeliefs[0].object).toBe('AI');
    });
  });

  describe('Bayesian Confidence Updates (Satori Pattern)', () => {
    it('should update confidence on repeated observations', () => {
      // First observation
      beliefs.upsertBelief({
        userId: 'test_user',
        type: 'interest',
        subject: 'test_user',
        predicate: 'is_interested_in',
        object: 'compilers',
        confidence: 0.7,
        source: 'observed',
        evidence: { action: 'pin' },
      });

      const initial = beliefs.getBeliefs('test_user')[0];
      expect(initial.confidence).toBe(0.7);

      // Second observation updates using Bayesian formula
      // Formula: existing * 0.7 + new_ * weight * 0.3
      beliefs.upsertBelief({
        userId: 'test_user',
        type: 'interest',
        subject: 'test_user',
        predicate: 'is_interested_in',
        object: 'compilers',
        confidence: 0.9,
        source: 'stated', // Higher weight source (0.9)
        evidence: { action: 'explicit_confirmation' },
      });

      const updated = beliefs.getBeliefs('test_user')[0];

      // Bayesian update: 0.7 * 0.7 + 0.9 * 0.9 * 0.3 = 0.49 + 0.243 = 0.733
      expect(updated.confidence).toBeGreaterThan(initial.confidence);
      expect(updated.confidence).toBeLessThanOrEqual(0.99);
    });

    it('should weight stated beliefs higher than inferred', () => {
      // Inferred belief first
      beliefs.upsertBelief({
        userId: 'test_user',
        type: 'preference',
        subject: 'test_user',
        predicate: 'prefers',
        object: 'dark-mode',
        confidence: 0.6,
        source: 'inferred',
        evidence: {},
      });

      const inferredConfidence = beliefs.getBeliefs('test_user')[0].confidence;

      // Stated belief should have stronger effect
      beliefs.upsertBelief({
        userId: 'test_user',
        type: 'preference',
        subject: 'test_user',
        predicate: 'prefers',
        object: 'dark-mode',
        confidence: 0.9,
        source: 'stated',
        evidence: {},
      });

      const statedConfidence = beliefs.getBeliefs('test_user')[0].confidence;

      // Stated should result in higher confidence
      expect(statedConfidence).toBeGreaterThan(inferredConfidence);
    });
  });

  describe('Behavior-Based Belief Inference', () => {
    it('should infer interest from pin action', () => {
      const inferred = beliefs.inferBeliefsFromBehavior('test_user', {
        action: 'pin',
        target: 'machine-learning',
        context: { reportId: 'r1' },
      });

      expect(inferred).toHaveLength(1);
      expect(inferred[0].type).toBe('interest');
      expect(inferred[0].predicate).toBe('is_interested_in');
      expect(inferred[0].confidence).toBe(0.8);
    });

    it('should infer dislike from dismiss action', () => {
      const inferred = beliefs.inferBeliefsFromBehavior('test_user', {
        action: 'dismiss',
        target: 'cryptocurrency',
        context: { reportId: 'r2' },
      });

      expect(inferred).toHaveLength(1);
      expect(inferred[0].type).toBe('preference');
      expect(inferred[0].predicate).toBe('dislikes');
      expect(inferred[0].confidence).toBe(0.6);
    });

    it('should infer expertise from extended engagement', () => {
      const inferred = beliefs.inferBeliefsFromBehavior('test_user', {
        action: 'extended_engagement',
        target: 'compiler-design',
        context: { duration: 300000 }, // 5 minutes
      });

      expect(inferred).toHaveLength(1);
      expect(inferred[0].type).toBe('expertise');
      expect(inferred[0].predicate).toBe('understands');
    });
  });

  describe('Relevant Belief Retrieval', () => {
    it('should find beliefs related to a topic', () => {
      // Create multiple beliefs
      beliefs.upsertBelief({
        userId: 'test_user',
        type: 'expertise',
        subject: 'test_user',
        predicate: 'is_expert_in',
        object: 'Roslyn compiler',
        confidence: 0.9,
        source: 'observed',
        evidence: {},
      });

      beliefs.upsertBelief({
        userId: 'test_user',
        type: 'interest',
        subject: 'test_user',
        predicate: 'is_interested_in',
        object: 'compiler optimization',
        confidence: 0.8,
        source: 'observed',
        evidence: {},
      });

      beliefs.upsertBelief({
        userId: 'test_user',
        type: 'interest',
        subject: 'test_user',
        predicate: 'is_interested_in',
        object: 'web development',
        confidence: 0.5,
        source: 'observed',
        evidence: {},
      });

      const compilerBeliefs = beliefs.getRelevantBeliefs('test_user', 'compiler');

      expect(compilerBeliefs).toHaveLength(2);
      expect(compilerBeliefs.map(b => b.object)).toContain('Roslyn compiler');
      expect(compilerBeliefs.map(b => b.object)).toContain('compiler optimization');
    });
  });
});

describe('BDI Model: Desire Manager', () => {
  let db: ReturnType<typeof getTestDb>;
  let desires: DesireManager;

  beforeEach(() => {
    resetTestDb();
    db = getTestDb();
    desires = new DesireManager(db);
    createTestUserProfile(db, { id: 'test_user', name: 'Test User' });
  });

  afterAll(() => {
    closeTestDb();
  });

  describe('Desire CRUD Operations', () => {
    it('should store and retrieve desires', () => {
      desires.upsertDesire({
        userId: 'test_user',
        type: 'goal',
        description: 'Build an autonomous AI assistant',
        priority: 9,
        timeframe: 'long-term',
        status: 'active',
        relatedConcepts: ['ai', 'automation', 'personal-assistant'],
      });

      const retrieved = desires.getDesires('test_user');
      expect(retrieved).toHaveLength(1);
      expect(retrieved[0].description).toBe('Build an autonomous AI assistant');
      expect(retrieved[0].priority).toBe(9);
    });

    it('should filter desires by status', () => {
      desires.upsertDesire({
        userId: 'test_user',
        type: 'goal',
        description: 'Active goal',
        priority: 8,
        timeframe: 'short-term',
        status: 'active',
        relatedConcepts: [],
      });

      createTestDesire(db, {
        userId: 'test_user',
        description: 'Achieved goal',
        status: 'achieved',
      });

      const activeDesires = desires.getDesires('test_user', 'active');
      expect(activeDesires).toHaveLength(1);
      expect(activeDesires[0].description).toBe('Active goal');
    });
  });

  describe('Desire Inference from Patterns', () => {
    it('should infer desires from repeated topic engagement', () => {
      // Simulate repeated engagement with a topic
      const recentTopics = [
        'autonomous-agents',
        'autonomous-agents',
        'autonomous-agents', // 3x = threshold
        'memory-augmentation',
        'memory-augmentation',
        'memory-augmentation',
        'random-topic',
      ];

      const inferred = desires.inferDesires('test_user', recentTopics);

      expect(inferred.length).toBeGreaterThanOrEqual(2);
      expect(inferred.map(d => d.relatedConcepts).flat()).toContain('autonomous-agents');
      expect(inferred.map(d => d.relatedConcepts).flat()).toContain('memory-augmentation');
    });

    it('should increase priority with more engagement', () => {
      // Heavy engagement with a topic
      const heavyTopics = Array(8).fill('critical-topic');
      const lightTopics = Array(3).fill('light-topic');

      const inferred = desires.inferDesires('test_user', [...heavyTopics, ...lightTopics]);

      const criticalDesire = inferred.find(d => d.relatedConcepts.includes('critical-topic'));
      const lightDesire = inferred.find(d => d.relatedConcepts.includes('light-topic'));

      expect(criticalDesire?.priority).toBeGreaterThan(lightDesire?.priority || 0);
    });
  });

  describe('Related Desires', () => {
    it('should find desires related to concepts', () => {
      desires.upsertDesire({
        userId: 'test_user',
        type: 'goal',
        description: 'Master ML frameworks',
        priority: 8,
        timeframe: 'long-term',
        status: 'active',
        relatedConcepts: ['machine-learning', 'pytorch', 'tensorflow'],
      });

      desires.upsertDesire({
        userId: 'test_user',
        type: 'need',
        description: 'Understand web dev',
        priority: 5,
        timeframe: 'short-term',
        status: 'active',
        relatedConcepts: ['react', 'javascript'],
      });

      const mlRelated = desires.getRelatedDesires('test_user', ['machine-learning', 'ai']);
      expect(mlRelated).toHaveLength(1);
      expect(mlRelated[0].description).toBe('Master ML frameworks');
    });
  });

  describe('Desire Achievement', () => {
    it('should mark desires as achieved', () => {
      const id = desires.upsertDesire({
        userId: 'test_user',
        type: 'goal',
        description: 'Complete project',
        priority: 8,
        timeframe: 'short-term',
        status: 'active',
        relatedConcepts: [],
      });

      desires.achieveDesire(id);

      const active = desires.getDesires('test_user', 'active');
      expect(active).toHaveLength(0);
    });
  });
});

describe('BDI Model: Intention Manager', () => {
  let db: ReturnType<typeof getTestDb>;
  let intentions: IntentionManager;

  beforeEach(() => {
    resetTestDb();
    db = getTestDb();
    intentions = new IntentionManager(db);
    createTestUserProfile(db, { id: 'test_user', name: 'Test User' });
  });

  afterAll(() => {
    closeTestDb();
  });

  describe('Intention Lifecycle', () => {
    it('should track intention status progression', () => {
      const id = intentions.upsertIntention({
        userId: 'test_user',
        type: 'task',
        description: 'Implement BDI model',
        status: 'planned',
        priority: 8,
        context: { module: 'bdi_model.ts' },
      });

      // Verify initial state
      let all = intentions.getIntentions('test_user');
      expect(all[0].status).toBe('planned');

      // Progress to in_progress
      intentions.updateStatus(id, 'in_progress');
      all = intentions.getIntentions('test_user');
      expect(all[0].status).toBe('in_progress');

      // Complete
      intentions.updateStatus(id, 'completed');
      all = intentions.getIntentions('test_user');
      expect(all[0].status).toBe('completed');
    });

    it('should track blocked intentions', () => {
      const id = intentions.upsertIntention({
        userId: 'test_user',
        type: 'task',
        description: 'Deploy to production',
        status: 'in_progress',
        priority: 9,
        context: {},
      });

      intentions.updateStatus(id, 'blocked');

      const blocked = intentions.getIntentions('test_user', 'blocked');
      expect(blocked).toHaveLength(1);
      expect(blocked[0].description).toBe('Deploy to production');
    });
  });

  describe('Current Intention', () => {
    it('should return highest priority in-progress intention', () => {
      intentions.upsertIntention({
        userId: 'test_user',
        type: 'task',
        description: 'Low priority task',
        status: 'in_progress',
        priority: 5,
        context: {},
      });

      intentions.upsertIntention({
        userId: 'test_user',
        type: 'task',
        description: 'High priority task',
        status: 'in_progress',
        priority: 9,
        context: {},
      });

      const current = intentions.getCurrentIntention('test_user');
      expect(current?.description).toBe('High priority task');
      expect(current?.priority).toBe(9);
    });

    it('should return null when no in-progress intentions', () => {
      intentions.upsertIntention({
        userId: 'test_user',
        type: 'task',
        description: 'Planned task',
        status: 'planned',
        priority: 8,
        context: {},
      });

      const current = intentions.getCurrentIntention('test_user');
      expect(current).toBeNull();
    });
  });

  describe('Intention-Desire Linking', () => {
    it('should link intentions to parent desires', () => {
      const desireId = createTestDesire(db, {
        userId: 'test_user',
        description: 'Master AI/ML',
        priority: 9,
      });

      intentions.upsertIntention({
        userId: 'test_user',
        type: 'task',
        description: 'Complete ML course',
        status: 'planned',
        priority: 7,
        parentDesireId: desireId,
        context: {},
      });

      const all = intentions.getIntentions('test_user');
      expect(all[0].parentDesireId).toBe(desireId);
    });
  });
});

describe('BDI Model: Reasoner Integration', () => {
  let db: ReturnType<typeof getTestDb>;
  let reasoner: BDIReasoner;

  beforeEach(() => {
    resetTestDb();
    db = getTestDb();
    reasoner = createBDIModel(db);
    createTestUserProfile(db, { id: 'test_user', name: 'Test User' });
  });

  afterAll(() => {
    closeTestDb();
  });

  describe('Mental State Inference', () => {
    it('should compute comprehensive mental state', () => {
      // Add beliefs
      createTestBelief(db, {
        userId: 'test_user',
        type: 'expertise',
        object: 'TypeScript',
        confidence: 0.9,
      });

      // Add desires
      createTestDesire(db, {
        userId: 'test_user',
        description: 'Build AI assistant',
        priority: 9,
      });

      // Add intentions
      createTestIntention(db, {
        userId: 'test_user',
        description: 'Implement core features',
        status: 'in_progress',
        priority: 8,
      });

      const state = reasoner.getMentalState('test_user');

      expect(state.beliefs).toHaveLength(1);
      expect(state.desires).toHaveLength(1);
      expect(state.intentions).toHaveLength(1);
      expect(state.currentFocus).toBe('Implement core features');
    });

    it('should detect low cognitive load', () => {
      createTestIntention(db, {
        userId: 'test_user',
        description: 'Simple task',
        status: 'in_progress',
        priority: 5,
      });

      const state = reasoner.getMentalState('test_user');
      expect(state.cognitiveLoad).toBe('low');
    });

    it('should detect high cognitive load', () => {
      createHighCognitiveLoad(db, 'test_user');

      const state = reasoner.getMentalState('test_user');
      expect(state.cognitiveLoad).toBe('high');
    });
  });

  describe('Needs Inference (Core BDI Reasoning)', () => {
    it('should detect desires without supporting intentions', () => {
      // High-priority desire with no intention
      createTestDesire(db, {
        id: 'desire1',
        userId: 'test_user',
        description: 'Learn Rust programming',
        priority: 8,
      });

      const needs = reasoner.inferNeeds('test_user');

      const guidanceNeed = needs.find(n => n.type === 'guidance');
      expect(guidanceNeed).toBeDefined();
      expect(guidanceNeed?.description).toContain('No active plan');
      expect(guidanceNeed?.urgency).toBe('soon');
    });

    it('should detect blocked intentions needing support', () => {
      createTestIntention(db, {
        id: 'int1',
        userId: 'test_user',
        description: 'Deploy application',
        status: 'blocked',
        priority: 9,
      });

      const needs = reasoner.inferNeeds('test_user');

      const supportNeed = needs.find(n => n.type === 'support');
      expect(supportNeed).toBeDefined();
      expect(supportNeed?.description).toContain('Blocked');
      expect(supportNeed?.urgency).toBe('immediate');
    });

    it('should suggest learning for unfamiliar context', () => {
      // No expertise beliefs for the context
      const needs = reasoner.inferNeeds('test_user', 'quantum-computing');

      const infoNeed = needs.find(n => n.type === 'information');
      expect(infoNeed).toBeDefined();
      expect(infoNeed?.description).toContain('quantum-computing');
    });
  });

  describe('ADHD-Specific Behavior', () => {
    it('should detect scattered attention state', () => {
      addADHDContext(db, 'test_user');
      createHighCognitiveLoad(db, 'test_user');

      const state = reasoner.getMentalState('test_user');
      expect(state.emotionalState).toBe('scattered');
    });

    it('should provide reminders when scattered with active task', () => {
      addADHDContext(db, 'test_user');
      createHighCognitiveLoad(db, 'test_user');

      createTestIntention(db, {
        id: 'main_task',
        userId: 'test_user',
        description: 'Write documentation',
        status: 'in_progress',
        priority: 10,
      });

      const needs = reasoner.inferNeeds('test_user');

      const reminder = needs.find(n => n.type === 'reminder');
      expect(reminder).toBeDefined();
      expect(reminder?.description).toContain('You were working on');
      expect(reminder?.urgency).toBe('immediate');
    });

    it('should suggest cognitive load reduction when overloaded', () => {
      createHighCognitiveLoad(db, 'test_user');

      const needs = reasoner.inferNeeds('test_user');

      const loadNeed = needs.find(n =>
        n.type === 'support' && n.description.includes('cognitive load')
      );
      expect(loadNeed).toBeDefined();
      expect(loadNeed?.suggestedAction).toContain('Prioritize');
    });
  });

  describe('Action Processing', () => {
    it('should update beliefs from user actions', () => {
      reasoner.processAction('test_user', 'pin', 'machine-learning', { reportId: 'r1' });

      const beliefs = reasoner.getBeliefManager().getBeliefs('test_user');
      expect(beliefs.some(b => b.object === 'machine-learning')).toBe(true);
    });

    it('should complete intentions matching action targets', () => {
      createTestIntention(db, {
        userId: 'test_user',
        description: 'Review machine-learning report',
        status: 'in_progress',
        priority: 7,
      });

      reasoner.processAction('test_user', 'complete', 'machine-learning', {});

      const intentions = reasoner.getIntentionManager().getIntentions('test_user', 'completed');
      expect(intentions).toHaveLength(1);
    });
  });

  describe('Recommendations', () => {
    it('should provide personalized recommendations', () => {
      // Setup user state
      createTestDesire(db, {
        userId: 'test_user',
        description: 'Master AI/ML',
        priority: 9,
        relatedConcepts: ['ai', 'ml'],
      });

      createTestIntention(db, {
        id: 'blocked_int',
        userId: 'test_user',
        description: 'Complete blocked task',
        status: 'blocked',
        priority: 8,
      });

      const recs = reasoner.getRecommendations('test_user', 5);

      expect(recs.length).toBeGreaterThan(0);
      expect(recs.some(r => r.type === 'goal')).toBe(true);
      expect(recs.some(r => r.type === 'support')).toBe(true);

      // Should be sorted by priority
      for (let i = 1; i < recs.length; i++) {
        expect(recs[i - 1].priority).toBeGreaterThanOrEqual(recs[i].priority);
      }
    });
  });
});

describe('BDI Model: Ronald Adonyo Profile Integration', () => {
  let db: ReturnType<typeof getTestDb>;
  let reasoner: BDIReasoner;

  beforeEach(() => {
    resetTestDb();
    db = getTestDb();
    reasoner = createBDIModel(db);

    // Seed Ronald's profile
    createTestUserProfile(db, {
      id: RONALD_PROFILE.id,
      name: RONALD_PROFILE.name,
      username: RONALD_PROFILE.username,
      profile_json: JSON.stringify(RONALD_PROFILE),
    });
  });

  afterAll(() => {
    closeTestDb();
  });

  it('should model Ronald\'s ADHD context correctly', () => {
    addADHDContext(db, RONALD_PROFILE.id);

    // Add INTJ trait
    createTestBelief(db, {
      userId: RONALD_PROFILE.id,
      type: 'context',
      subject: RONALD_PROFILE.id,
      predicate: 'has',
      object: 'INTJ personality',
      confidence: 0.95,
    });

    const state = reasoner.getMentalState(RONALD_PROFILE.id);

    // Should recognize ADHD context
    const adhdBelief = state.beliefs.find(b => b.object.includes('ADHD'));
    expect(adhdBelief).toBeDefined();
    expect(adhdBelief?.confidence).toBeGreaterThan(0.9);
  });

  it('should model Ronald\'s expertise correctly', () => {
    // Add expertise beliefs matching Ronald's background
    for (const skill of RONALD_PROFILE.expertise) {
      createTestBelief(db, {
        userId: RONALD_PROFILE.id,
        type: 'expertise',
        subject: RONALD_PROFILE.id,
        predicate: 'is_expert_in',
        object: skill,
        confidence: 0.9,
      });
    }

    const state = reasoner.getMentalState(RONALD_PROFILE.id);

    expect(state.beliefs.filter(b => b.type === 'expertise')).toHaveLength(
      RONALD_PROFILE.expertise.length
    );

    // Compiler expertise should be high confidence
    const compilerExpertise = state.beliefs.find(b => b.object === 'compilers');
    expect(compilerExpertise?.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('should model Ronald\'s desires correctly', () => {
    // Add desires matching Ronald's goals
    for (const desire of RONALD_PROFILE.desires) {
      createTestDesire(db, {
        userId: RONALD_PROFILE.id,
        description: desire,
        priority: 9,
        timeframe: 'long-term',
      });
    }

    const state = reasoner.getMentalState(RONALD_PROFILE.id);

    expect(state.desires).toHaveLength(RONALD_PROFILE.desires.length);

    // AI assistant desire should be present
    const aiDesire = state.desires.find(d =>
      d.description.includes('AI') && d.description.includes('anticipates')
    );
    expect(aiDesire).toBeDefined();
    expect(aiDesire?.priority).toBe(9);
  });

  it('should provide ADHD-aware recommendations for Ronald', () => {
    addADHDContext(db, RONALD_PROFILE.id);
    createHighCognitiveLoad(db, RONALD_PROFILE.id);

    // Add a main task he's working on
    createTestIntention(db, {
      userId: RONALD_PROFILE.id,
      description: 'Implement Ronald-GI core features',
      status: 'in_progress',
      priority: 10,
    });

    const needs = reasoner.inferNeeds(RONALD_PROFILE.id);
    const recs = reasoner.getRecommendations(RONALD_PROFILE.id);

    // Should have reminder for scattered attention
    expect(needs.some(n => n.type === 'reminder')).toBe(true);

    // Should suggest cognitive load reduction
    expect(needs.some(n =>
      n.type === 'support' && n.description.includes('cognitive load')
    )).toBe(true);

    // Recommendations should be prioritized
    expect(recs[0].priority).toBe(10);
  });
});

describe('BDI Model: Edge Cases', () => {
  let db: ReturnType<typeof getTestDb>;
  let reasoner: BDIReasoner;

  beforeEach(() => {
    resetTestDb();
    db = getTestDb();
    reasoner = createBDIModel(db);
    createTestUserProfile(db, { id: 'test_user', name: 'Test User' });
  });

  afterAll(() => {
    closeTestDb();
  });

  it('should handle user with no data gracefully', () => {
    const state = reasoner.getMentalState('nonexistent_user');

    expect(state.beliefs).toHaveLength(0);
    expect(state.desires).toHaveLength(0);
    expect(state.intentions).toHaveLength(0);
    expect(state.cognitiveLoad).toBe('low');
    expect(state.emotionalState).toBe('focused');
  });

  it('should handle empty needs inference gracefully', () => {
    const needs = reasoner.inferNeeds('test_user');
    expect(Array.isArray(needs)).toBe(true);
  });

  it('should sort needs by urgency', () => {
    // Create blocked (immediate) and desire gap (soon) needs
    createTestIntention(db, {
      userId: 'test_user',
      description: 'Blocked task',
      status: 'blocked',
      priority: 9,
    });

    createTestDesire(db, {
      userId: 'test_user',
      description: 'Unplanned goal',
      priority: 8,
    });

    const needs = reasoner.inferNeeds('test_user');

    // Immediate needs should come first
    if (needs.length >= 2) {
      expect(needs[0].urgency).toBe('immediate');
    }
  });

  it('should handle concurrent intention updates', () => {
    const intentions = reasoner.getIntentionManager();

    const id1 = intentions.upsertIntention({
      userId: 'test_user',
      type: 'task',
      description: 'Task 1',
      status: 'planned',
      priority: 5,
      context: {},
    });

    const id2 = intentions.upsertIntention({
      userId: 'test_user',
      type: 'task',
      description: 'Task 2',
      status: 'planned',
      priority: 5,
      context: {},
    });

    // Update both
    intentions.updateStatus(id1, 'in_progress');
    intentions.updateStatus(id2, 'in_progress');

    const inProgress = intentions.getIntentions('test_user', 'in_progress');
    expect(inProgress).toHaveLength(2);
  });
});
