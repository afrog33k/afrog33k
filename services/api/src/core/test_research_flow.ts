/**
 * Test script for the full research flow
 * Tests: observation -> concept extraction -> rabbit hole -> deep research -> artifacts
 */

import { LivingCore } from './living_core';
import { unlink } from 'fs/promises';

async function testResearchFlow() {
  // Clean start
  try {
    await unlink('./test_ronald.db');
  } catch (e) {}

  console.log('=== TESTING FULL RESEARCH FLOW ===\n');

  const core = new LivingCore({
    dbPath: './test_ronald.db',
    heartbeatIntervalMs: 1000,
    maxConcurrentResearch: 1,
  });

  // Track artifacts
  const artifacts = {
    concepts: 0,
    beliefs: 0,
    rabbitHoles: 0,
    findings: 0,
    cards: 0,
  };

  // Set up event handlers
  core.on('concept_extracted', () => artifacts.concepts++);
  core.on('deep_research_finding', () => artifacts.findings++);
  core.on('cards_generated', ({ cards }) => artifacts.cards += cards.length);
  core.on('research_synthesis', (data) => {
    console.log('\n📊 RESEARCH SYNTHESIS:');
    console.log(`   Topic: ${data.rabbitHole.topic}`);
    console.log(`   Settled: ${(data.settledScore * 100).toFixed(0)}%`);
    console.log(`   Curiosity: ${(data.curiosityScore * 100).toFixed(0)}%`);
    console.log(`   New concepts: ${data.newConcepts.slice(0, 5).join(', ')}`);
    console.log(`   Recommendations: ${data.recommendations.length}`);
  });

  core.on('heartbeat_complete', (data) => {
    console.log(`\n💓 Heartbeat: ${data.observationsProcessed} obs, ${data.researchCompleted} research, ${data.cardsGenerated} cards`);
  });

  core.on('research_start', ({ rabbitHole }) => {
    console.log(`\n🐰 Starting research: ${rabbitHole.topic}`);
    artifacts.rabbitHoles++;
  });

  core.on('research_complete', ({ rabbitHole, results }) => {
    console.log(`✅ Research complete: ${rabbitHole.topic} (${results.length} results)`);
  });

  // Start the core
  await core.start();

  // Submit test observation that should trigger research
  console.log('\n📝 Submitting observation...\n');
  core.observe(
    'thought',
    'I want to learn about Server Driven UI (SDUI) patterns and how companies like Airbnb implement them for mobile apps. Also interested in comparing with microfrontends.',
    { priority: 'high', trigger_research: true }
  );

  // Wait for processing
  console.log('Waiting for research to complete (60s max)...');
  await new Promise(resolve => setTimeout(resolve, 60000));

  // Stop and get final state
  await core.stop();

  // Query database for artifacts
  const db = (core as any).db;
  const concepts = db.prepare('SELECT * FROM concepts').all();
  const beliefs = db.prepare('SELECT * FROM beliefs').all();
  const rabbitHoles = db.prepare('SELECT * FROM rabbit_holes').all();
  const results = db.prepare('SELECT * FROM research_results').all();
  const cards = db.prepare('SELECT * FROM cards').all();

  console.log('\n\n=== ARTIFACTS GENERATED ===\n');
  console.log(`Concepts: ${concepts.length}`);
  concepts.slice(0, 10).forEach((c: any) => console.log(`  - ${c.name} (${c.type})`));

  console.log(`\nBeliefs: ${beliefs.length}`);
  beliefs.slice(0, 5).forEach((b: any) => console.log(`  - ${b.content.substring(0, 80)}...`));

  console.log(`\nRabbit Holes: ${rabbitHoles.length}`);
  rabbitHoles.forEach((rh: any) => {
    console.log(`  - ${rh.topic}`);
    console.log(`    Status: ${rh.status} | Settled: ${((rh.settled_score || 0) * 100).toFixed(0)}%`);
    if (rh.synthesis) {
      console.log(`    Synthesis: ${rh.synthesis.substring(0, 100)}...`);
    }
  });

  console.log(`\nResearch Results: ${results.length}`);
  results.slice(0, 5).forEach((r: any) => console.log(`  - ${r.source.substring(0, 60)}...`));

  console.log(`\nCards: ${cards.length}`);
  cards.forEach((c: any) => {
    console.log(`  - ${c.title}`);
    console.log(`    ${c.content.substring(0, 100)}...`);
  });

  console.log('\n=== TEST COMPLETE ===');
}

testResearchFlow().catch(console.error);
