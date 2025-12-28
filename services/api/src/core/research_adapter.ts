/**
 * Research Adapter - Actual research capabilities for the Living Core
 *
 * This module provides REAL research capabilities:
 * - Web search via DuckDuckGo (no API key needed)
 * - GitHub repo search and analysis
 * - arXiv paper fetching
 *
 * This is NOT fake output - it actually fetches and analyzes.
 */

import { EventEmitter } from 'events';

// ============================================================================
// TYPES
// ============================================================================

export interface SearchResult {
  id: string;
  title: string;
  url: string;
  snippet: string;
  source: string;
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

  constructor() {
    super();
  }

  // ==========================================================================
  // WEB SEARCH (DuckDuckGo HTML scraping - no API needed)
  // ==========================================================================

  async webSearch(query: string, maxResults: number = 5): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    try {
      // Use DuckDuckGo HTML search (no API key needed)
      const encodedQuery = encodeURIComponent(query);
      const url = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;

      const response = await fetch(url, {
        headers: {
          'User-Agent': this.userAgent,
        },
      });

      if (!response.ok) {
        throw new Error(`Search failed: ${response.status}`);
      }

      const html = await response.text();

      // Parse results from HTML
      const resultRegex = /<a class="result__a" href="([^"]+)"[^>]*>([^<]+)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([^<]+)<\/a>/g;
      let match;
      let count = 0;

      while ((match = resultRegex.exec(html)) !== null && count < maxResults) {
        results.push({
          id: `web-${Date.now()}-${count}`,
          url: match[1],
          title: this.decodeHtml(match[2]),
          snippet: this.decodeHtml(match[3]),
          source: 'duckduckgo',
        });
        count++;
      }

      // Alternative parsing if regex didn't work
      if (results.length === 0) {
        // Try simpler pattern
        const simpleRegex = /class="result__url"[^>]*>([^<]+)<[\s\S]*?class="result__title"[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([^<]+)</g;
        while ((match = simpleRegex.exec(html)) !== null && count < maxResults) {
          results.push({
            id: `web-${Date.now()}-${count}`,
            url: match[2],
            title: this.decodeHtml(match[3]),
            snippet: '',
            source: 'duckduckgo',
          });
          count++;
        }
      }

      this.emit('web_search_complete', { query, results });

    } catch (error) {
      this.emit('web_search_error', { query, error });
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
  // ARXIV SEARCH
  // ==========================================================================

  async searchArxiv(query: string, maxResults: number = 5): Promise<PaperInfo[]> {
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
const isMainModule = typeof require !== 'undefined' && require.main === module;
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

  // Test searches
  const query = process.argv[2] || 'SDUI server driven UI';

  console.log(`Testing research adapter with query: "${query}"\n`);

  Promise.all([
    adapter.webSearch(query),
    adapter.searchRepos(query),
    adapter.searchArxiv(query),
  ]).then(() => {
    console.log('\n✅ Research complete');
  }).catch(console.error);
}
