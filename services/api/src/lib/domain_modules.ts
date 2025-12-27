/**
 * Domain Modules for Ronald-GI
 *
 * Phase 9: Specialized modules for different knowledge domains
 *
 * Each domain module provides:
 * 1. Domain-specific concept extraction
 * 2. Specialized report templates
 * 3. Domain-aware scoring/ranking
 * 4. Entity extraction and linking
 */

import Database from 'better-sqlite3';

// ============================================
// BASE DOMAIN MODULE
// ============================================

export interface DomainEntity {
  id: string;
  type: string;
  name: string;
  attributes: Record<string, any>;
  confidence: number;
}

export interface DomainSignal {
  type: string;
  strength: number;
  evidence: string[];
}

export interface DomainAnalysis {
  domain: string;
  entities: DomainEntity[];
  signals: DomainSignal[];
  relevanceScore: number;
  suggestedReportType: string;
}

export abstract class DomainModule {
  abstract readonly name: string;
  abstract readonly keywords: string[];
  abstract readonly reportTypes: string[];

  constructor(protected db: Database.Database) {}

  /**
   * Check if content belongs to this domain
   */
  matchesDomain(content: string, concepts: string[]): number {
    const lowerContent = content.toLowerCase();
    const lowerConcepts = concepts.map(c => c.toLowerCase());

    let score = 0;
    for (const keyword of this.keywords) {
      if (lowerContent.includes(keyword)) score += 0.1;
      if (lowerConcepts.some(c => c.includes(keyword))) score += 0.15;
    }

    return Math.min(1, score);
  }

  /**
   * Extract domain-specific entities
   */
  abstract extractEntities(content: string): DomainEntity[];

  /**
   * Detect domain-specific signals
   */
  abstract detectSignals(content: string, metadata?: any): DomainSignal[];

  /**
   * Analyze content for this domain
   */
  analyze(content: string, concepts: string[], metadata?: any): DomainAnalysis {
    const relevanceScore = this.matchesDomain(content, concepts);
    const entities = this.extractEntities(content);
    const signals = this.detectSignals(content, metadata);

    // Suggest report type based on signals
    const suggestedReportType = this.suggestReportType(entities, signals);

    return {
      domain: this.name,
      entities,
      signals,
      relevanceScore,
      suggestedReportType,
    };
  }

  protected abstract suggestReportType(entities: DomainEntity[], signals: DomainSignal[]): string;
}

// ============================================
// FINANCE DOMAIN MODULE
// ============================================

export class FinanceDomainModule extends DomainModule {
  readonly name = 'finance';

  readonly keywords = [
    'stock', 'market', 'trading', 'investment', 'portfolio',
    'dividend', 'equity', 'bond', 'yield', 'earnings',
    'revenue', 'profit', 'loss', 'balance sheet', 'cash flow',
    'pe ratio', 'market cap', 'ipo', 'merger', 'acquisition',
    'fintech', 'crypto', 'blockchain', 'defi', 'nft',
    'interest rate', 'inflation', 'gdp', 'fed', 'treasury',
  ];

  readonly reportTypes = [
    'market_analysis',
    'stock_signal',
    'financial_brief',
    'investment_thesis',
    'risk_assessment',
  ];

  extractEntities(content: string): DomainEntity[] {
    const entities: DomainEntity[] = [];

    // Extract ticker symbols ($AAPL, $GOOGL)
    const tickerPattern = /\$([A-Z]{1,5})\b/g;
    let match;
    while ((match = tickerPattern.exec(content)) !== null) {
      entities.push({
        id: `ticker_${match[1]}`,
        type: 'ticker',
        name: match[1],
        attributes: { symbol: match[1] },
        confidence: 0.95,
      });
    }

    // Extract monetary values ($1M, $500K, 1.5 billion)
    const moneyPattern = /\$[\d,.]+\s*(million|billion|M|B|K)?|\d+\.?\d*\s*(million|billion)/gi;
    while ((match = moneyPattern.exec(content)) !== null) {
      entities.push({
        id: `money_${match.index}`,
        type: 'monetary_value',
        name: match[0],
        attributes: { raw: match[0] },
        confidence: 0.8,
      });
    }

    // Extract percentages (important for yields, returns)
    const percentPattern = /[\d.]+%/g;
    while ((match = percentPattern.exec(content)) !== null) {
      entities.push({
        id: `percent_${match.index}`,
        type: 'percentage',
        name: match[0],
        attributes: { value: parseFloat(match[0]) },
        confidence: 0.9,
      });
    }

    // Extract common financial entities
    const financialEntities = [
      { pattern: /SEC|Securities and Exchange/gi, type: 'regulator' },
      { pattern: /NASDAQ|NYSE|S&P 500|Dow Jones/gi, type: 'index_exchange' },
      { pattern: /Fed(eral Reserve)?|Treasury|IMF|World Bank/gi, type: 'institution' },
    ];

    for (const { pattern, type } of financialEntities) {
      while ((match = pattern.exec(content)) !== null) {
        entities.push({
          id: `${type}_${match.index}`,
          type,
          name: match[0],
          attributes: {},
          confidence: 0.85,
        });
      }
    }

    return entities;
  }

  detectSignals(content: string, metadata?: any): DomainSignal[] {
    const signals: DomainSignal[] = [];
    const lowerContent = content.toLowerCase();

    // Bull/Bear signals
    const bullPatterns = ['buy', 'long', 'bullish', 'upside', 'growth', 'outperform', 'strong buy'];
    const bearPatterns = ['sell', 'short', 'bearish', 'downside', 'decline', 'underperform', 'avoid'];

    const bullCount = bullPatterns.filter(p => lowerContent.includes(p)).length;
    const bearCount = bearPatterns.filter(p => lowerContent.includes(p)).length;

    if (bullCount > bearCount) {
      signals.push({
        type: 'sentiment',
        strength: Math.min(1, bullCount * 0.2),
        evidence: bullPatterns.filter(p => lowerContent.includes(p)),
      });
    } else if (bearCount > bullCount) {
      signals.push({
        type: 'sentiment',
        strength: -Math.min(1, bearCount * 0.2),
        evidence: bearPatterns.filter(p => lowerContent.includes(p)),
      });
    }

    // Risk signals
    const riskPatterns = ['risk', 'volatile', 'uncertain', 'warning', 'caution'];
    const riskEvidence = riskPatterns.filter(p => lowerContent.includes(p));
    if (riskEvidence.length > 0) {
      signals.push({
        type: 'risk_indicator',
        strength: Math.min(1, riskEvidence.length * 0.25),
        evidence: riskEvidence,
      });
    }

    // Event signals
    const eventPatterns = ['earnings', 'announcement', 'merger', 'acquisition', 'ipo', 'dividend'];
    const eventEvidence = eventPatterns.filter(p => lowerContent.includes(p));
    if (eventEvidence.length > 0) {
      signals.push({
        type: 'corporate_event',
        strength: Math.min(1, eventEvidence.length * 0.3),
        evidence: eventEvidence,
      });
    }

    return signals;
  }

  protected suggestReportType(entities: DomainEntity[], signals: DomainSignal[]): string {
    const hasTickers = entities.some(e => e.type === 'ticker');
    const hasEvents = signals.some(s => s.type === 'corporate_event');
    const hasRisk = signals.some(s => s.type === 'risk_indicator' && s.strength > 0.5);

    if (hasTickers && hasEvents) return 'stock_signal';
    if (hasRisk) return 'risk_assessment';
    if (hasTickers) return 'investment_thesis';
    return 'market_analysis';
  }
}

// ============================================
// PEOPLE/NETWORKING DOMAIN MODULE
// ============================================

export class PeopleDomainModule extends DomainModule {
  readonly name = 'people';

  readonly keywords = [
    'founder', 'ceo', 'cto', 'engineer', 'developer', 'researcher',
    'team', 'hire', 'hiring', 'recruit', 'talent',
    'linkedin', 'twitter', 'github', 'portfolio',
    'network', 'connection', 'introduce', 'referral',
    'speaker', 'author', 'expert', 'advisor', 'investor',
    'conference', 'meetup', 'community', 'open source',
  ];

  readonly reportTypes = [
    'person_brief',
    'network_map',
    'hiring_signal',
    'expert_profile',
    'community_insight',
  ];

  extractEntities(content: string): DomainEntity[] {
    const entities: DomainEntity[] = [];

    // Extract Twitter handles
    const twitterPattern = /@([a-zA-Z0-9_]{1,15})\b/g;
    let match;
    while ((match = twitterPattern.exec(content)) !== null) {
      entities.push({
        id: `twitter_${match[1]}`,
        type: 'twitter_handle',
        name: `@${match[1]}`,
        attributes: { handle: match[1] },
        confidence: 0.9,
      });
    }

    // Extract GitHub usernames/repos
    const githubPattern = /github\.com\/([a-zA-Z0-9_-]+)(?:\/([a-zA-Z0-9_-]+))?/gi;
    while ((match = githubPattern.exec(content)) !== null) {
      entities.push({
        id: `github_${match[1]}`,
        type: match[2] ? 'github_repo' : 'github_user',
        name: match[2] ? `${match[1]}/${match[2]}` : match[1],
        attributes: { user: match[1], repo: match[2] },
        confidence: 0.95,
      });
    }

    // Extract LinkedIn URLs
    const linkedinPattern = /linkedin\.com\/in\/([a-zA-Z0-9_-]+)/gi;
    while ((match = linkedinPattern.exec(content)) !== null) {
      entities.push({
        id: `linkedin_${match[1]}`,
        type: 'linkedin_profile',
        name: match[1],
        attributes: { profile: match[1] },
        confidence: 0.95,
      });
    }

    // Extract email addresses
    const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    while ((match = emailPattern.exec(content)) !== null) {
      entities.push({
        id: `email_${match.index}`,
        type: 'email',
        name: match[0],
        attributes: { email: match[0] },
        confidence: 0.9,
      });
    }

    // Extract role titles
    const rolePatterns = [
      { pattern: /\b(CEO|CTO|CFO|COO|VP|Director|Manager|Lead|Senior|Principal|Staff)\b/gi, type: 'role_title' },
      { pattern: /\b(Founder|Co-founder|Partner|Advisor|Investor)\b/gi, type: 'leadership_role' },
      { pattern: /\b(Engineer|Developer|Designer|Researcher|Scientist)\b/gi, type: 'technical_role' },
    ];

    for (const { pattern, type } of rolePatterns) {
      while ((match = pattern.exec(content)) !== null) {
        entities.push({
          id: `${type}_${match.index}`,
          type,
          name: match[0],
          attributes: {},
          confidence: 0.75,
        });
      }
    }

    return entities;
  }

  detectSignals(content: string, metadata?: any): DomainSignal[] {
    const signals: DomainSignal[] = [];
    const lowerContent = content.toLowerCase();

    // Hiring signals
    const hiringPatterns = ['hiring', 'looking for', 'join us', 'open position', 'job opening', 'apply'];
    const hiringEvidence = hiringPatterns.filter(p => lowerContent.includes(p));
    if (hiringEvidence.length > 0) {
      signals.push({
        type: 'hiring_activity',
        strength: Math.min(1, hiringEvidence.length * 0.3),
        evidence: hiringEvidence,
      });
    }

    // Expertise signals
    const expertisePatterns = ['expert', 'author of', 'creator of', 'speaker at', 'published', 'patent'];
    const expertiseEvidence = expertisePatterns.filter(p => lowerContent.includes(p));
    if (expertiseEvidence.length > 0) {
      signals.push({
        type: 'expertise_indicator',
        strength: Math.min(1, expertiseEvidence.length * 0.25),
        evidence: expertiseEvidence,
      });
    }

    // Connection signals
    const connectionPatterns = ['introduction', 'introduced by', 'referred', 'connection', 'know from'];
    const connectionEvidence = connectionPatterns.filter(p => lowerContent.includes(p));
    if (connectionEvidence.length > 0) {
      signals.push({
        type: 'network_connection',
        strength: Math.min(1, connectionEvidence.length * 0.25),
        evidence: connectionEvidence,
      });
    }

    // Community involvement
    const communityPatterns = ['open source', 'contributor', 'maintainer', 'community', 'conference'];
    const communityEvidence = communityPatterns.filter(p => lowerContent.includes(p));
    if (communityEvidence.length > 0) {
      signals.push({
        type: 'community_involvement',
        strength: Math.min(1, communityEvidence.length * 0.25),
        evidence: communityEvidence,
      });
    }

    return signals;
  }

  protected suggestReportType(entities: DomainEntity[], signals: DomainSignal[]): string {
    const hasProfiles = entities.some(e => ['twitter_handle', 'github_user', 'linkedin_profile'].includes(e.type));
    const hasHiring = signals.some(s => s.type === 'hiring_activity');
    const hasExpertise = signals.some(s => s.type === 'expertise_indicator' && s.strength > 0.5);
    const hasCommunity = signals.some(s => s.type === 'community_involvement');

    if (hasHiring) return 'hiring_signal';
    if (hasExpertise) return 'expert_profile';
    if (hasCommunity) return 'community_insight';
    if (hasProfiles) return 'person_brief';
    return 'network_map';
  }
}

// ============================================
// OPERATIONS DOMAIN MODULE
// ============================================

export class OperationsDomainModule extends DomainModule {
  readonly name = 'operations';

  readonly keywords = [
    'deploy', 'deployment', 'infrastructure', 'devops', 'sre',
    'kubernetes', 'docker', 'aws', 'gcp', 'azure', 'cloud',
    'ci/cd', 'pipeline', 'automation', 'monitoring', 'alerting',
    'incident', 'outage', 'postmortem', 'reliability', 'uptime',
    'scale', 'scaling', 'performance', 'latency', 'throughput',
    'security', 'compliance', 'audit', 'backup', 'disaster recovery',
    'cost', 'optimization', 'efficiency', 'resource', 'capacity',
  ];

  readonly reportTypes = [
    'ops_brief',
    'incident_report',
    'infrastructure_signal',
    'cost_analysis',
    'reliability_assessment',
  ];

  extractEntities(content: string): DomainEntity[] {
    const entities: DomainEntity[] = [];
    let match;

    // Extract cloud services
    const cloudPatterns = [
      { pattern: /\b(AWS|Amazon Web Services|EC2|S3|Lambda|RDS|EKS)\b/gi, provider: 'aws' },
      { pattern: /\b(GCP|Google Cloud|GKE|BigQuery|Cloud Run)\b/gi, provider: 'gcp' },
      { pattern: /\b(Azure|AKS|Cosmos DB|Azure Functions)\b/gi, provider: 'azure' },
    ];

    for (const { pattern, provider } of cloudPatterns) {
      while ((match = pattern.exec(content)) !== null) {
        entities.push({
          id: `cloud_${provider}_${match.index}`,
          type: 'cloud_service',
          name: match[0],
          attributes: { provider },
          confidence: 0.9,
        });
      }
    }

    // Extract infrastructure tools
    const toolPatterns = /\b(Kubernetes|Docker|Terraform|Ansible|Helm|Prometheus|Grafana|Datadog|PagerDuty|Jenkins|GitHub Actions)\b/gi;
    while ((match = toolPatterns.exec(content)) !== null) {
      entities.push({
        id: `tool_${match.index}`,
        type: 'infrastructure_tool',
        name: match[0],
        attributes: {},
        confidence: 0.85,
      });
    }

    // Extract metrics/SLIs
    const metricPatterns = /\b(\d+\.?\d*)\s*(ms|seconds|%|req\/s|requests per second|QPS|TPS)\b/gi;
    while ((match = metricPatterns.exec(content)) !== null) {
      entities.push({
        id: `metric_${match.index}`,
        type: 'performance_metric',
        name: match[0],
        attributes: { value: parseFloat(match[1]), unit: match[2] },
        confidence: 0.8,
      });
    }

    // Extract version/release info
    const versionPattern = /v?\d+\.\d+(?:\.\d+)?(?:-[a-zA-Z0-9]+)?/g;
    while ((match = versionPattern.exec(content)) !== null) {
      entities.push({
        id: `version_${match.index}`,
        type: 'version',
        name: match[0],
        attributes: {},
        confidence: 0.7,
      });
    }

    return entities;
  }

  detectSignals(content: string, metadata?: any): DomainSignal[] {
    const signals: DomainSignal[] = [];
    const lowerContent = content.toLowerCase();

    // Incident signals
    const incidentPatterns = ['incident', 'outage', 'downtime', 'failure', 'error', 'crashed', 'unavailable'];
    const incidentEvidence = incidentPatterns.filter(p => lowerContent.includes(p));
    if (incidentEvidence.length > 0) {
      signals.push({
        type: 'incident_indicator',
        strength: Math.min(1, incidentEvidence.length * 0.2),
        evidence: incidentEvidence,
      });
    }

    // Scaling signals
    const scalingPatterns = ['scale up', 'scale out', 'auto-scaling', 'capacity', 'traffic spike', 'load'];
    const scalingEvidence = scalingPatterns.filter(p => lowerContent.includes(p));
    if (scalingEvidence.length > 0) {
      signals.push({
        type: 'scaling_activity',
        strength: Math.min(1, scalingEvidence.length * 0.25),
        evidence: scalingEvidence,
      });
    }

    // Cost signals
    const costPatterns = ['cost', 'spend', 'budget', 'expensive', 'saving', 'optimize', 'reduce'];
    const costEvidence = costPatterns.filter(p => lowerContent.includes(p));
    if (costEvidence.length > 0) {
      signals.push({
        type: 'cost_consideration',
        strength: Math.min(1, costEvidence.length * 0.2),
        evidence: costEvidence,
      });
    }

    // Security signals
    const securityPatterns = ['security', 'vulnerability', 'patch', 'cve', 'breach', 'compliance', 'audit'];
    const securityEvidence = securityPatterns.filter(p => lowerContent.includes(p));
    if (securityEvidence.length > 0) {
      signals.push({
        type: 'security_concern',
        strength: Math.min(1, securityEvidence.length * 0.25),
        evidence: securityEvidence,
      });
    }

    // Deployment signals
    const deployPatterns = ['deploy', 'release', 'rollout', 'rollback', 'canary', 'blue-green'];
    const deployEvidence = deployPatterns.filter(p => lowerContent.includes(p));
    if (deployEvidence.length > 0) {
      signals.push({
        type: 'deployment_activity',
        strength: Math.min(1, deployEvidence.length * 0.25),
        evidence: deployEvidence,
      });
    }

    return signals;
  }

  protected suggestReportType(entities: DomainEntity[], signals: DomainSignal[]): string {
    const hasIncident = signals.some(s => s.type === 'incident_indicator' && s.strength > 0.3);
    const hasCost = signals.some(s => s.type === 'cost_consideration' && s.strength > 0.3);
    const hasSecurity = signals.some(s => s.type === 'security_concern' && s.strength > 0.5);
    const hasInfra = entities.some(e => ['cloud_service', 'infrastructure_tool'].includes(e.type));

    if (hasIncident) return 'incident_report';
    if (hasCost) return 'cost_analysis';
    if (hasSecurity) return 'reliability_assessment';
    if (hasInfra) return 'infrastructure_signal';
    return 'ops_brief';
  }
}

// ============================================
// DOMAIN ROUTER
// ============================================

export class DomainRouter {
  private modules: DomainModule[];

  constructor(db: Database.Database) {
    this.modules = [
      new FinanceDomainModule(db),
      new PeopleDomainModule(db),
      new OperationsDomainModule(db),
    ];
  }

  /**
   * Analyze content and route to appropriate domain(s)
   */
  analyzeContent(content: string, concepts: string[], metadata?: any): DomainAnalysis[] {
    const analyses = this.modules
      .map(m => m.analyze(content, concepts, metadata))
      .filter(a => a.relevanceScore > 0.2)
      .sort((a, b) => b.relevanceScore - a.relevanceScore);

    return analyses;
  }

  /**
   * Get the primary domain for content
   */
  getPrimaryDomain(content: string, concepts: string[]): DomainAnalysis | null {
    const analyses = this.analyzeContent(content, concepts);
    return analyses.length > 0 ? analyses[0] : null;
  }

  /**
   * Get domain-specific report type suggestion
   */
  suggestReportType(content: string, concepts: string[]): string {
    const primary = this.getPrimaryDomain(content, concepts);
    if (primary && primary.relevanceScore > 0.4) {
      return primary.suggestedReportType;
    }
    return 'research_brief'; // Default
  }

  /**
   * Get all available domains
   */
  getAvailableDomains(): string[] {
    return this.modules.map(m => m.name);
  }

  /**
   * Get domain-specific keywords for search enhancement
   */
  getDomainKeywords(domainName: string): string[] {
    const module = this.modules.find(m => m.name === domainName);
    return module?.keywords || [];
  }
}

// ============================================
// EXPORTS
// ============================================

export function createDomainSystem(db: Database.Database) {
  return {
    router: new DomainRouter(db),
    finance: new FinanceDomainModule(db),
    people: new PeopleDomainModule(db),
    operations: new OperationsDomainModule(db),
  };
}
