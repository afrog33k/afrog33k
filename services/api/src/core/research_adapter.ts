/**
 * Research Adapter - Actual research capabilities for the Living Core
 *
 * This module provides REAL research capabilities:
 * - Web search via SearXNG (no API key needed, uses public instances)
 * - Brave Search (optional, needs BRAVE_API_KEY)
 * - GitHub repo search and analysis
 * - arXiv paper fetching (for academic topics only)
 *
 * This is NOT fake output - it actually fetches and analyzes.
 */

import { EventEmitter } from 'events';
import { fileURLToPath } from 'url';

// ============================================================================
// TYPES
// ============================================================================

export interface SearchResult {
  id: string;
  title: string;
  url: string;
  snippet: string;
  source: string;
  relevanceScore?: number;
}

export interface RepoInfo {
  id: string;
  name: string;
  fullName: string;
  url: string;
  description: string;
  stars: number;
  language: string;
  topics: string[];
  updatedAt: Date;
}

export interface PaperInfo {
  id: string;
  title: string;
  authors: string[];
  abstract: string;
  url: string;
  publishedAt: Date;
  categories: string[];
}

// ============================================================================
// RESEARCH ADAPTER
// ============================================================================

export class ResearchAdapter extends EventEmitter {
  private userAgent = 'Ronald-GI/1.0 (Research Assistant)';
  private braveApiKey: string | null = process.env.BRAVE_API_KEY || null;

  // SearXNG public instances (fallback chain)
  private searxngInstances = [
    'https://searx.be',
    'https://search.sapti.me',
    'https://searx.tiekoetter.com',
    'https://search.ononoki.org',
  ];

  constructor() {
    super();
  }

  // ==========================================================================
  // WEB SEARCH (SearXNG with Brave fallback)
  // ==========================================================================

  async webSearch(query: string, maxResults: number = 5): Promise<SearchResult[]> {
    // Try Brave Search first if API key is available
    if (this.braveApiKey) {
      const braveResults = await this.braveSearch(query, maxResults);
      if (braveResults.length > 0) {
        return braveResults;
      }
    }

    // Fall back to SearXNG
    return this.searxngSearch(query, maxResults);
  }

  /**
   * Search using Brave Search API (requires BRAVE_API_KEY)
   */
  private async braveSearch(query: string, maxResults: number): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    try {
      const encodedQuery = encodeURIComponent(query);
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodedQuery}&count=${maxResults}`;

      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'X-Subscription-Token': this.braveApiKey!,
        },
      });

      if (!response.ok) {
        throw new Error(`Brave search failed: ${response.status}`);
      }

      const data = await response.json();

      for (const result of data.web?.results || []) {
        results.push({
          id: `brave-${Date.now()}-${results.length}`,
          url: result.url,
          title: result.title,
          snippet: result.description || '',
          source: 'brave',
        });
      }

      this.emit('web_search_complete', { query, results, source: 'brave' });

    } catch (error) {
      this.emit('web_search_error', { query, error, source: 'brave' });
    }

    return results;
  }

  /**
   * Search using SearXNG (no API key needed)
   */
  private async searxngSearch(query: string, maxResults: number): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    for (const instance of this.searxngInstances) {
      try {
        const encodedQuery = encodeURIComponent(query);
        const url = `${instance}/search?q=${encodedQuery}&format=json&categories=general`;

        const response = await fetch(url, {
          headers: {
            'User-Agent': this.userAgent,
            'Accept': 'application/json',
          },
        });

        if (!response.ok) {
          continue; // Try next instance
        }

        const data = await response.json();

        for (const result of (data.results || []).slice(0, maxResults)) {
          results.push({
            id: `searxng-${Date.now()}-${results.length}`,
            url: result.url,
            title: result.title,
            snippet: result.content || '',
            source: `searxng:${new URL(instance).host}`,
          });
        }

        if (results.length > 0) {
          this.emit('web_search_complete', { query, results, source: instance });
          break; // Success, don't try other instances
        }

      } catch (error) {
        // Try next instance
        continue;
      }
    }

    if (results.length === 0) {
      this.emit('web_search_error', { query, error: 'All SearXNG instances failed' });
    }

    return results;
  }

  // ==========================================================================
  // GITHUB SEARCH
  // ==========================================================================

  async searchRepos(query: string, maxResults: number = 5): Promise<RepoInfo[]> {
    const results: RepoInfo[] = [];

    try {
      const encodedQuery = encodeURIComponent(query);
      const url = `https://api.github.com/search/repositories?q=${encodedQuery}&sort=stars&order=desc&per_page=${maxResults}`;

      const response = await fetch(url, {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': this.userAgent,
        },
      });

      if (!response.ok) {
        throw new Error(`GitHub search failed: ${response.status}`);
      }

      const data = await response.json();

      for (const repo of data.items || []) {
        results.push({
          id: `repo-${repo.id}`,
          name: repo.name,
          fullName: repo.full_name,
          url: repo.html_url,
          description: repo.description || '',
          stars: repo.stargazers_count,
          language: repo.language || 'Unknown',
          topics: repo.topics || [],
          updatedAt: new Date(repo.updated_at),
        });
      }

      this.emit('repo_search_complete', { query, results });

    } catch (error) {
      this.emit('repo_search_error', { query, error });
    }

    return results;
  }

  /**
   * Fetch README from a GitHub repo
   */
  async fetchReadme(repoFullName: string): Promise<string | null> {
    try {
      const url = `https://api.github.com/repos/${repoFullName}/readme`;

      const response = await fetch(url, {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': this.userAgent,
        },
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();

      // README is base64 encoded
      if (data.content) {
        return Buffer.from(data.content, 'base64').toString('utf-8');
      }

    } catch (error) {
      this.emit('readme_fetch_error', { repoFullName, error });
    }

    return null;
  }

  // ==========================================================================
  // ARXIV SEARCH (for academic topics only)
  // ==========================================================================

  /**
   * Keywords that indicate an academic/research topic suitable for arXiv
   */
  private academicKeywords = [
    'machine learning', 'ml', 'deep learning', 'neural network', 'transformer',
    'llm', 'large language model', 'nlp', 'natural language',
    'computer vision', 'reinforcement learning', 'rl',
    'algorithm', 'optimization', 'theoretical',
    'quantum', 'physics', 'mathematics', 'biology', 'chemistry',
    'research', 'paper', 'study', 'analysis', 'framework',
    'model', 'dataset', 'benchmark', 'evaluation',
    'autonomous', 'agent', 'reasoning', 'cognition', 'cognitive',
    'attention mechanism', 'embedding', 'representation learning',
  ];

  /**
   * Check if a topic is suitable for arXiv search
   */
  isAcademicTopic(query: string): boolean {
    const lower = query.toLowerCase();
    return this.academicKeywords.some(keyword => lower.includes(keyword));
  }

  /**
   * Search arXiv - returns empty if topic is not academic
   */
  async searchArxiv(query: string, maxResults: number = 5): Promise<PaperInfo[]> {
    // Skip arXiv for non-academic topics (like "SDUI", "HMR", etc.)
    if (!this.isAcademicTopic(query)) {
      this.emit('arxiv_search_skipped', { query, reason: 'Not an academic topic' });
      return [];
    }

    const results: PaperInfo[] = [];

    try {
      const encodedQuery = encodeURIComponent(query);
      const url = `https://export.arxiv.org/api/query?search_query=all:${encodedQuery}&start=0&max_results=${maxResults}&sortBy=lastUpdatedDate&sortOrder=descending`;

      const response = await fetch(url, {
        headers: {
          'User-Agent': this.userAgent,
        },
      });

      if (!response.ok) {
        throw new Error(`arXiv search failed: ${response.status}`);
      }

      const xml = await response.text();

      // Parse arXiv Atom feed
      const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
      let match;

      while ((match = entryRegex.exec(xml)) !== null) {
        const entry = match[1];

        const id = this.extractXmlTag(entry, 'id');
        const title = this.extractXmlTag(entry, 'title')?.replace(/\s+/g, ' ').trim();
        const summary = this.extractXmlTag(entry, 'summary')?.replace(/\s+/g, ' ').trim();
        const published = this.extractXmlTag(entry, 'published');

        // Extract authors
        const authorRegex = /<author>[\s\S]*?<name>([^<]+)<\/name>[\s\S]*?<\/author>/g;
        const authors: string[] = [];
        let authorMatch;
        while ((authorMatch = authorRegex.exec(entry)) !== null) {
          authors.push(authorMatch[1]);
        }

        // Extract categories
        const categoryRegex = /<category[^>]*term="([^"]+)"/g;
        const categories: string[] = [];
        let catMatch;
        while ((catMatch = categoryRegex.exec(entry)) !== null) {
          categories.push(catMatch[1]);
        }

        if (id && title) {
          results.push({
            id: `arxiv-${id.split('/').pop()}`,
            title,
            authors,
            abstract: summary || '',
            url: id,
            publishedAt: published ? new Date(published) : new Date(),
            categories,
          });
        }
      }

      this.emit('arxiv_search_complete', { query, results });

    } catch (error) {
      this.emit('arxiv_search_error', { query, error });
    }

    return results;
  }

  // ==========================================================================
  // CONTENT EXTRACTION
  // ==========================================================================

  /**
   * Fetch and extract main content from a URL
   */
  async fetchContent(url: string): Promise<string | null> {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': this.userAgent,
        },
      });

      if (!response.ok) {
        return null;
      }

      const html = await response.text();

      // Simple content extraction (remove scripts, styles, extract text)
      let text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
        .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      // Limit length
      if (text.length > 10000) {
        text = text.substring(0, 10000) + '...';
      }

      return text;

    } catch (error) {
      this.emit('fetch_error', { url, error });
    }

    return null;
  }

  // ==========================================================================
  // INSIGHT EXTRACTION
  // ==========================================================================

  /**
   * Extract key insights from content
   * TODO: Use LLM for better extraction
   */
  extractInsights(content: string, topic: string): string[] {
    const insights: string[] = [];

    // Simple keyword-based extraction
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 20);

    // Look for sentences containing the topic or related keywords
    const topicWords = topic.toLowerCase().split(/\s+/);

    for (const sentence of sentences) {
      const lower = sentence.toLowerCase();

      // Check if sentence contains topic words
      const hasTopicWord = topicWords.some(word => lower.includes(word));

      // Check for insight indicators
      const hasInsightIndicator = /\b(key|important|significant|novel|unique|advantage|benefit|problem|solution|approach)\b/i.test(sentence);

      if (hasTopicWord && hasInsightIndicator) {
        insights.push(sentence.trim());
        if (insights.length >= 5) break;
      }
    }

    return insights;
  }

  // ==========================================================================
  // UTILITIES
  // ==========================================================================

  private decodeHtml(html: string): string {
    return html
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ');
  }

  private extractXmlTag(xml: string, tag: string): string | null {
    const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
    const match = xml.match(regex);
    return match ? match[1] : null;
  }
}

// ============================================================================
// CLI TEST
// ============================================================================

// CLI test - run with: npx tsx src/core/research_adapter.ts "query"
const isMainModule = process.argv[1] && (
  process.argv[1] === fileURLToPath(import.meta.url) ||
  process.argv[1].includes('research_adapter')
);
if (isMainModule) {
  const adapter = new ResearchAdapter();

  adapter.on('web_search_complete', ({ query, results }) => {
    console.log(`\n🔍 Web search for "${query}":`);
    results.forEach((r: SearchResult) => {
      console.log(`  - ${r.title}`);
      console.log(`    ${r.url}`);
    });
  });

  adapter.on('repo_search_complete', ({ query, results }) => {
    console.log(`\n📦 GitHub search for "${query}":`);
    results.forEach((r: RepoInfo) => {
      console.log(`  - ${r.fullName} (⭐ ${r.stars})`);
      console.log(`    ${r.description}`);
    });
  });

  adapter.on('arxiv_search_complete', ({ query, results }) => {
    console.log(`\n📄 arXiv search for "${query}":`);
    results.forEach((r: PaperInfo) => {
      console.log(`  - ${r.title}`);
      console.log(`    ${r.authors.slice(0, 3).join(', ')}`);
    });
  });

  adapter.on('arxiv_search_skipped', ({ query, reason }) => {
    console.log(`\n📄 arXiv search skipped for "${query}": ${reason}`);
  });

  adapter.on('web_search_error', ({ error }) => {
    console.log(`\n❌ Web search error: ${error}`);
  });

  // Test searches
  const query = process.argv[2] || 'SDUI server driven UI';
  const academicQuery = 'machine learning autonomous agents';

  console.log(`Testing research adapter with query: "${query}"`);
  console.log(`Is academic topic: ${adapter.isAcademicTopic(query)}\n`);

  Promise.all([
    adapter.webSearch(query),
    adapter.searchRepos(query),
    adapter.searchArxiv(query),
  ]).then(([webResults, repoResults, arxivResults]) => {
    console.log(`\nSummary for "${query}":`);
    console.log(`  Web results: ${webResults.length}`);
    console.log(`  Repo results: ${repoResults.length}`);
    console.log(`  arXiv results: ${arxivResults.length}`);

    // Also test academic query
    console.log(`\n\n--- Testing academic query: "${academicQuery}" ---`);
    console.log(`Is academic topic: ${adapter.isAcademicTopic(academicQuery)}`);
    return adapter.searchArxiv(academicQuery, 3);
  }).then((academicResults) => {
    console.log(`arXiv results for academic query: ${academicResults.length}`);
  }).then(() => {
    console.log('\n✅ Research complete');
  }).catch(console.error);
}
