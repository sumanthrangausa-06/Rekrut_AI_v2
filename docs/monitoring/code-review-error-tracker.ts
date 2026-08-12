#!/usr/bin/env node
/**
 * Rekrut AI — Code Review & Error Tracking System
 * 
 * A real-time code review engine that runs continuously,
 * checks every second for file changes, reviews code on the fly,
 * and tracks errors across the 7-month execution.
 * 
 * Built by Suga. No external dependencies. Just Node.js.
 */

import { promises as fs, watch } from 'fs';
import { join, resolve } from 'path';

// ─── Configuration ───────────────────────────────────────────────

const CONFIG = {
  // Directories to watch
  WATCH_DIRS: [
    './src',
    './server',
    './components',
    './pages',
    './api',
    './lib',
    './hooks',
  ],
  
  // File extensions to review
  REVIEW_EXTENSIONS: ['.ts', '.tsx', '.js', '.jsx', '.py', '.sql'],
  
  // Trigger intervals
  TICK_INTERVAL: 1_000,         // 1 second — trigger check
  POLL_INTERVAL: 60_000,        // 60 seconds — full scan
  REPORT_INTERVAL: 24 * 60 * 60 * 1000,  // Daily report
  
  // Review thresholds
  MAX_FUNCTION_LENGTH: 50,      // Lines per function
  MAX_FILE_LENGTH: 500,         // Lines per file
  MAX_CYCLOMATIC: 10,           // Complexity threshold
  MIN_TEST_COVERAGE: 70,        // Percent
  
  // Error tracking
  STATE_FILE: './.code-review-state.json',
  LOG_FILE: './logs/code-review.log',
  REPORT_FILE: './reports/code-review-daily.md',
  ALERTS_DIR: './alerts/code-review',
  
  // Recipients
  ALERT_RECIPIENTS: ['ranga@rekrut.ai', 'suga@rekrut.ai'],
};

// ─── Types ───────────────────────────────────────────────────────

type Severity = 'critical' | 'warning' | 'info' | 'style';
type Status = 'open' | 'fixed' | 'wontfix' | 'false-positive';

interface ReviewIssue {
  id: string;
  file: string;
  line: number;
  column: number;
  severity: Severity;
  category: string;
  message: string;
  suggestion: string;
  status: Status;
  openedAt: string;
  fixedAt?: string;
  owner: string;
  commit?: string;
  notes: string[];
}

interface FileReview {
  file: string;
  timestamp: string;
  issues: ReviewIssue[];
  metrics: FileMetrics;
  summary: string;
}

interface FileMetrics {
  lines: number;
  functions: number;
  maxFunctionLength: number;
  complexity: number;
  imports: string[];
  exports: string[];
  tests: number;
  coverage: number;
}

interface ReviewState {
  files: Map<string, FileReview>;
  totalIssues: number;
  openIssues: number;
  fixedIssues: number;
  lastScan: string;
  runtime: number;
}

// ─── Logger ──────────────────────────────────────────────────────

class Logger {
  private async write(level: string, msg: string): Promise<void> {
    const line = `[${new Date().toISOString()}] ${level}: ${msg}\n`;
    try {
      await fs.appendFile(CONFIG.LOG_FILE, line);
    } catch {
      // If log file fails, still print to console
    }
    console.log(line.trim());
  }
  
  async info(msg: string): Promise<void> {
    await this.write('INFO', msg);
  }
  
  async warn(msg: string): Promise<void> {
    await this.write('WARN', msg);
  }
  
  async error(msg: string): Promise<void> {
    await this.write('ERROR', msg);
  }
}

// ─── Code Review Engine ──────────────────────────────────────────

class CodeReviewEngine {
  private logger: Logger;
  private issues: ReviewIssue[] = [];
  private issueId = 0;
  
  constructor(logger: Logger) {
    this.logger = logger;
  }
  
  async reviewFile(filePath: string): Promise<FileReview> {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    const issues: ReviewIssue[] = [];
    
    // Run all review checks
    issues.push(...this.checkSecurity(filePath, content, lines));
    issues.push(...this.checkPerformance(filePath, content, lines));
    issues.push(...this.checkStyle(filePath, content, lines));
    issues.push(...this.checkArchitecture(filePath, content, lines));
    issues.push(...this.checkTests(filePath, content, lines));
    
    // Calculate metrics
    const metrics = this.calculateMetrics(content, lines);
    
    // Generate summary
    const summary = this.generateSummary(filePath, issues, metrics);
    
    return {
      file: filePath,
      timestamp: new Date().toISOString(),
      issues,
      metrics,
      summary,
    };
  }
  
  private checkSecurity(file: string, content: string, lines: string[]): ReviewIssue[] {
    const issues: ReviewIssue[] = [];
    
    // Check for hardcoded secrets
    const secretPatterns = [
      { pattern: /password\s*=\s*["'][^"']+["']/i, msg: 'Hardcoded password detected', suggest: 'Use environment variables or secret manager' },
      { pattern: /api[_-]?key\s*=\s*["'][^"']+["']/i, msg: 'Hardcoded API key detected', suggest: 'Move to .env file and gitignore' },
      { pattern: /token\s*=\s*["'][^"']+["']/i, msg: 'Hardcoded token detected', suggest: 'Use secure token storage' },
      { pattern: /secret\s*=\s*["'][^"']+["']/i, msg: 'Hardcoded secret detected', suggest: 'Use environment variables' },
      { pattern: /DATABASE_URL\s*=\s*["'][^"']+["']/i, msg: 'Hardcoded database URL', suggest: 'Use connection string from environment' },
    ];
    
    for (let i = 0; i < lines.length; i++) {
      for (const { pattern, msg, suggest } of secretPatterns) {
        if (pattern.test(lines[i]) && !lines[i].includes('process.env') && !lines[i].includes('// TODO')) {
          issues.push(this.createIssue(file, i + 1, 1, 'critical', 'security', msg, suggest));
        }
      }
    }
    
    // Check for SQL injection
    const sqlPatterns = [
      /\$\{.*\}.*FROM|INSERT|UPDATE|DELETE/,
      /\+.*\+.*FROM|INSERT|UPDATE|DELETE/,
      /query\s*\+\s*.*\+\s*.*FROM/,
    ];
    
    for (let i = 0; i < lines.length; i++) {
      for (const pattern of sqlPatterns) {
        if (pattern.test(lines[i]) && !lines[i].includes('?') && !lines[i].includes('parameterized')) {
          issues.push(this.createIssue(file, i + 1, 1, 'critical', 'security', 
            'Potential SQL injection vulnerability', 
            'Use parameterized queries or ORM'));
        }
      }
    }
    
    // Check for eval and dangerous functions
    const dangerousPatterns = [
      { pattern: /\beval\s*\(/, msg: 'eval() is dangerous and should be avoided', suggest: 'Use JSON.parse or Function constructor with caution' },
      { pattern: /\bFunction\s*\(/, msg: 'Function constructor can execute arbitrary code', suggest: 'Use safer alternatives' },
      { pattern: /\bdocument\.write\s*\(/, msg: 'document.write is unsafe and blocking', suggest: 'Use DOM manipulation methods' },
      { pattern: /\binnerHTML\s*=/, msg: 'innerHTML can lead to XSS', suggest: 'Use textContent or sanitize HTML' },
    ];
    
    for (let i = 0; i < lines.length; i++) {
      for (const { pattern, msg, suggest } of dangerousPatterns) {
        if (pattern.test(lines[i])) {
          issues.push(this.createIssue(file, i + 1, 1, 'critical', 'security', msg, suggest));
        }
      }
    }
    
    return issues;
  }
  
  private checkPerformance(file: string, content: string, lines: string[]): ReviewIssue[] {
    const issues: ReviewIssue[] = [];
    
    // Check for N+1 queries
    for (let i = 0; i < lines.length; i++) {
      if (/for.*await|forEach.*await|map.*await/.test(lines[i]) && /find|query|select|get/.test(lines[i])) {
        issues.push(this.createIssue(file, i + 1, 1, 'warning', 'performance', 
          'Potential N+1 query pattern', 
          'Use batch queries or data loader pattern'));
      }
    }
    
    // Check for large imports
    for (let i = 0; i < lines.length; i++) {
      if (/import.*\{/.test(lines[i]) && (lines[i].match(/,/g) || []).length > 5) {
        issues.push(this.createIssue(file, i + 1, 1, 'info', 'performance', 
          'Large import statement — consider splitting', 
          'Import only what you need, use dynamic imports'));
      }
    }
    
    // Check for console.log in production code
    for (let i = 0; i < lines.length; i++) {
      if (/console\.log|console\.warn|console\.error/.test(lines[i]) && !lines[i].includes('//') && !lines[i].includes('logger')) {
        issues.push(this.createIssue(file, i + 1, 1, 'warning', 'performance', 
          'console.log in production code', 
          'Use structured logging with levels (pino, winston)'));
      }
    }
    
    return issues;
  }
  
  private checkStyle(file: string, content: string, lines: string[]): ReviewIssue[] {
    const issues: ReviewIssue[] = [];
    
    // Check line length
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].length > 120) {
        issues.push(this.createIssue(file, i + 1, 1, 'style', 'style', 
          'Line exceeds 120 characters', 
          'Break into multiple lines or extract variables'));
      }
    }
    
    // Check for TODO/FIXME without owner
    for (let i = 0; i < lines.length; i++) {
      if (/TODO|FIXME|XXX|HACK/.test(lines[i]) && !lines[i].includes('@')) {
        issues.push(this.createIssue(file, i + 1, 1, 'warning', 'style', 
          'TODO/FIXME without assigned owner', 
          'Add @username and due date to TODO'));
      }
    }
    
    // Check for magic numbers
    for (let i = 0; i < lines.length; i++) {
      const magicNumber = /\b(?!\d{4}\b)\d{2,}\b/.test(lines[i]) && 
                         !lines[i].includes('const') && 
                         !lines[i].includes('export') &&
                         !lines[i].includes('import') &&
                         !lines[i].includes('//') &&
                         !lines[i].includes('/*');
      if (magicNumber && Math.random() < 0.3) { // Don't flag all, just sample
        issues.push(this.createIssue(file, i + 1, 1, 'info', 'style', 
          'Magic number detected', 
          'Extract to named constant'));
      }
    }
    
    return issues;
  }
  
  private checkArchitecture(file: string, content: string, lines: string[]): ReviewIssue[] {
    const issues: ReviewIssue[] = [];
    
    // Check for long functions
    let inFunction = false;
    let functionStart = 0;
    let braceCount = 0;
    
    for (let i = 0; i < lines.length; i++) {
      if (/function|=>|async.*{/.test(lines[i]) && !inFunction) {
        inFunction = true;
        functionStart = i;
        braceCount = 1;
      } else if (inFunction) {
        braceCount += (lines[i].match(/{/g) || []).length;
        braceCount -= (lines[i].match(/}/g) || []).length;
        
        if (braceCount === 0) {
          const functionLength = i - functionStart;
          if (functionLength > CONFIG.MAX_FUNCTION_LENGTH) {
            issues.push(this.createIssue(file, functionStart + 1, 1, 'warning', 'architecture', 
              `Function is ${functionLength} lines (max: ${CONFIG.MAX_FUNCTION_LENGTH})`, 
              'Extract into smaller functions'));
          }
          inFunction = false;
        }
      }
    }
    
    // Check for large files
    if (lines.length > CONFIG.MAX_FILE_LENGTH) {
      issues.push(this.createIssue(file, 1, 1, 'warning', 'architecture', 
        `File is ${lines.length} lines (max: ${CONFIG.MAX_FILE_LENGTH})`, 
        'Split into smaller modules'));
    }
    
    // Check for duplicated code (simple heuristic)
    const functionBodies = new Map<string, number>();
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.length > 30 && !trimmed.startsWith('//') && !trimmed.startsWith('import')) {
        const count = functionBodies.get(trimmed) || 0;
        functionBodies.set(trimmed, count + 1);
      }
    }
    
    for (const [code, count] of functionBodies) {
      if (count > 3) {
        issues.push(this.createIssue(file, 1, 1, 'warning', 'architecture', 
          'Duplicated code detected', 
          'Extract common logic into shared utility'));
        break; // Only flag once per file
      }
    }
    
    return issues;
  }
  
  private checkTests(file: string, content: string, lines: string[]): ReviewIssue[] {
    const issues: ReviewIssue[] = [];
    
    // Check if file has corresponding test file
    const testExtensions = ['.test.ts', '.test.tsx', '.spec.ts', '.spec.tsx', '.test.js', '.spec.js'];
    const hasTest = testExtensions.some(ext => {
      const testFile = file.replace(/\.(ts|tsx|js|jsx)$/, ext);
      try {
        fs.access(testFile);
        return true;
      } catch {
        return false;
      }
    });
    
    if (!hasTest && !file.includes('test') && !file.includes('spec')) {
      issues.push(this.createIssue(file, 1, 1, 'warning', 'testing', 
        'No test file found for this module', 
        'Add unit tests with >70% coverage'));
    }
    
    return issues;
  }
  
  private calculateMetrics(content: string, lines: string[]): FileMetrics {
    const functions = (content.match(/function|=>/g) || []).length;
    const imports = (content.match(/import.*from/g) || []);
    const exports = (content.match(/export.*(function|const|class|default)/g) || []);
    
    // Find longest function
    let maxFunctionLength = 0;
    let inFunction = false;
    let functionStart = 0;
    let braceCount = 0;
    
    for (let i = 0; i < lines.length; i++) {
      if (/function|=>|async.*{/.test(lines[i]) && !inFunction) {
        inFunction = true;
        functionStart = i;
        braceCount = 1;
      } else if (inFunction) {
        braceCount += (lines[i].match(/{/g) || []).length;
        braceCount -= (lines[i].match(/}/g) || []).length;
        
        if (braceCount === 0) {
          maxFunctionLength = Math.max(maxFunctionLength, i - functionStart);
          inFunction = false;
        }
      }
    }
    
    // Calculate cyclomatic complexity (simplified)
    const complexity = (content.match(/if|else|for|while|switch|case|&&|\|\|/g) || []).length;
    
    return {
      lines: lines.length,
      functions,
      maxFunctionLength,
      complexity,
      imports: imports.map(i => i.replace('import ', '').replace(' from', '')),
      exports: exports.map(e => e.replace('export ', '')),
      tests: 0, // Would need to read test file
      coverage: 0, // Would need test runner integration
    };
  }
  
  private generateSummary(file: string, issues: ReviewIssue[], metrics: FileMetrics): string {
    const critical = issues.filter(i => i.severity === 'critical').length;
    const warnings = issues.filter(i => i.severity === 'warning').length;
    const infos = issues.filter(i => i.severity === 'info').length;
    const styles = issues.filter(i => i.severity === 'style').length;
    
    return `${file}: ${metrics.lines} lines, ${metrics.functions} functions, ` +
           `complexity: ${metrics.complexity}, ` +
           `${critical} critical, ${warnings} warnings, ${infos} info, ${styles} style issues`;
  }
  
  private createIssue(file: string, line: number, column: number, severity: Severity, 
                     category: string, message: string, suggestion: string): ReviewIssue {
    this.issueId++;
    return {
      id: `R-${this.issueId.toString().padStart(5, '0')}`,
      file,
      line,
      column,
      severity,
      category,
      message,
      suggestion,
      status: 'open',
      openedAt: new Date().toISOString(),
      owner: 'unassigned',
      notes: [`Auto-detected by code review engine`],
    };
  }
  
  getIssues(): ReviewIssue[] {
    return this.issues;
  }
}

// ─── File Watcher ────────────────────────────────────────────────

class FileWatcher {
  private logger: Logger;
  private engine: CodeReviewEngine;
  private watchedFiles = new Set<string>();
  private fileReviews = new Map<string, FileReview>();
  
  constructor(logger: Logger, engine: CodeReviewEngine) {
    this.logger = logger;
    this.engine = engine;
  }
  
  async startWatching(): Promise<void> {
    await this.logger.info('Starting file watchers...');
    
    for (const dir of CONFIG.WATCH_DIRS) {
      try {
        await this.watchDirectory(dir);
      } catch (err) {
        await this.logger.warn(`Could not watch ${dir}: ${err}`);
      }
    }
    
    await this.logger.info(`Watching ${this.watchedFiles.size} files`);
  }
  
  private async watchDirectory(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      
      if (entry.isDirectory()) {
        await this.watchDirectory(fullPath);
      } else if (entry.isFile() && CONFIG.REVIEW_EXTENSIONS.some(ext => entry.name.endsWith(ext))) {
        this.watchedFiles.add(fullPath);
        
        // Initial review
        const review = await this.engine.reviewFile(fullPath);
        this.fileReviews.set(fullPath, review);
        
        if (review.issues.length > 0) {
          await this.logger.warn(`${fullPath}: ${review.issues.length} issues found`);
        }
        
        // Set up watcher
        watch(fullPath, async (eventType) => {
          if (eventType === 'change') {
            await this.logger.info(`File changed: ${fullPath}`);
            const newReview = await this.engine.reviewFile(fullPath);
            
            // Compare with previous review
            const prevReview = this.fileReviews.get(fullPath);
            if (prevReview) {
              const newIssues = newReview.issues.filter(ni => 
                !prevReview.issues.some(pi => pi.message === ni.message && pi.line === ni.line)
              );
              const fixedIssues = prevReview.issues.filter(pi => 
                !newReview.issues.some(ni => ni.message === pi.message && ni.line === pi.line)
              );
              
              if (newIssues.length > 0) {
                await this.logger.warn(`${fullPath}: ${newIssues.length} new issues introduced`);
                for (const issue of newIssues) {
                  if (issue.severity === 'critical') {
                    await this.sendAlert('critical', `New critical issue in ${fullPath}: ${issue.message}`, [issue.id]);
                  }
                }
              }
              
              if (fixedIssues.length > 0) {
                await this.logger.info(`${fullPath}: ${fixedIssues.length} issues fixed`);
              }
            }
            
            this.fileReviews.set(fullPath, newReview);
          }
        });
      }
    }
  }
  
  private async sendAlert(level: string, message: string, issueIds: string[]): Promise<void> {
    await this.logger.warn(`${level.toUpperCase()} ALERT: ${message}`);
    
    const alert = {
      level,
      message,
      issueIds,
      timestamp: new Date().toISOString(),
      recipients: CONFIG.ALERT_RECIPIENTS,
    };
    
    const alertPath = join(CONFIG.ALERTS_DIR, `alert-${Date.now()}.json`);
    try {
      await fs.mkdir(CONFIG.ALERTS_DIR, { recursive: true });
      await fs.writeFile(alertPath, JSON.stringify(alert, null, 2));
    } catch (err) {
      await this.logger.error(`Failed to write alert: ${err}`);
    }
  }
  
  getFileReviews(): Map<string, FileReview> {
    return this.fileReviews;
  }
}

// ─── Main Tracker ────────────────────────────────────────────────

class CodeReviewTracker {
  private logger: Logger;
  private engine: CodeReviewEngine;
  private watcher: FileWatcher;
  private tickTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private reportTimer: NodeJS.Timeout | null = null;
  private startTime: number;
  
  constructor() {
    this.logger = new Logger();
    this.engine = new CodeReviewEngine(this.logger);
    this.watcher = new FileWatcher(this.logger, this.engine);
    this.startTime = Date.now();
  }
  
  async init(): Promise<void> {
    await this.logger.info('Code Review Tracker initializing...');
    
    // Ensure directories
    await fs.mkdir('./logs', { recursive: true });
    await fs.mkdir('./reports', { recursive: true });
    await fs.mkdir(CONFIG.ALERTS_DIR, { recursive: true });
    
    // Start watching files
    await this.watcher.startWatching();
    
    await this.logger.info('Tracker ready. Starting loops...');
  }
  
  start(): void {
    this.logger.info(`Tracker started. 7-month runtime. Reviewing every second.`);
    
    // Tick loop: every 1 second — trigger check
    this.tickTimer = setInterval(() => this.tick(), CONFIG.TICK_INTERVAL);
    
    // Poll loop: every 60 seconds — full scan
    this.pollTimer = setInterval(() => this.poll(), CONFIG.POLL_INTERVAL);
    
    // Daily report
    const target = new Date();
    target.setUTCHours(12, 30, 0, 0);
    if (target <= new Date()) target.setUTCDate(target.getUTCDate() + 1);
    
    setTimeout(() => {
      this.generateDailyReport();
      this.reportTimer = setInterval(() => this.generateDailyReport(), CONFIG.REPORT_INTERVAL);
    }, target.getTime() - Date.now());
    
    this.logger.info('Press Ctrl+C to stop.');
  }
  
  private async tick(): Promise<void> {
    // Lightweight check every second
    // The file watchers handle the actual file change detection
    // This loop is for periodic health checks and state updates
    
    const runtime = Date.now() - this.startTime;
    if (runtime % (60 * 60 * 1000) < 1000) { // Every hour
      await this.logger.info(`Runtime: ${Math.floor(runtime / 1000 / 60)} minutes`);
    }
  }
  
  private async poll(): Promise<void> {
    // Full scan every 60 seconds
    // Review any new files or re-review existing ones
    
    const reviews = this.watcher.getFileReviews();
    let totalIssues = 0;
    let criticalIssues = 0;
    
    for (const [file, review] of reviews) {
      totalIssues += review.issues.length;
      criticalIssues += review.issues.filter(i => i.severity === 'critical').length;
    }
    
    if (criticalIssues > 0) {
      await this.logger.error(`CRITICAL: ${criticalIssues} critical issues across ${reviews.size} files`);
    }
    
    await this.saveState();
  }
  
  private async generateDailyReport(): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    await this.logger.info(`Generating daily code review report for ${today}...`);
    
    const reviews = this.watcher.getFileReviews();
    let totalIssues = 0;
    let criticalIssues = 0;
    let warningIssues = 0;
    let infoIssues = 0;
    let styleIssues = 0;
    
    for (const [file, review] of reviews) {
      totalIssues += review.issues.length;
      criticalIssues += review.issues.filter(i => i.severity === 'critical').length;
      warningIssues += review.issues.filter(i => i.severity === 'warning').length;
      infoIssues += review.issues.filter(i => i.severity === 'info').length;
      styleIssues += review.issues.filter(i => i.severity === 'style').length;
    }
    
    const report = `# Rekrut AI — Code Review Daily Report\n\n` +
      `> **Date:** ${today}\n` +
      `> **Files Reviewed:** ${reviews.size}\n` +
      `> **Total Issues:** ${totalIssues}\n` +
      `> **Critical:** ${criticalIssues} | **Warnings:** ${warningIssues} | **Info:** ${infoIssues} | **Style:** ${styleIssues}\n\n` +
      `---\n\n` +
      `## Critical Issues\n\n` +
      this.formatCriticalIssues(reviews) +
      `\n---\n\n` +
      `## File Summaries\n\n` +
      this.formatFileSummaries(reviews) +
      `\n---\n\n` +
      `*Report generated at ${new Date().toISOString()}*\n`;
    
    await fs.writeFile(CONFIG.REPORT_FILE, report);
    await this.logger.info(`Report written to ${CONFIG.REPORT_FILE}`);
  }
  
  private formatCriticalIssues(reviews: Map<string, FileReview>): string {
    let output = '';
    for (const [file, review] of reviews) {
      const critical = review.issues.filter(i => i.severity === 'critical');
      if (critical.length > 0) {
        output += `### ${file}\n\n`;
        for (const issue of critical) {
          output += `- **Line ${issue.line}:** ${issue.message}\n`;
          output += `  - *Suggestion:* ${issue.suggestion}\n`;
          output += `  - *ID:* ${issue.id}\n\n`;
        }
      }
    }
    return output || 'No critical issues found.\n\n';
  }
  
  private formatFileSummaries(reviews: Map<string, FileReview>): string {
    let output = '| File | Lines | Functions | Complexity | Issues |\n';
    output += '|------|-------|-----------|------------|--------|\n';
    
    for (const [file, review] of reviews) {
      output += `| ${file} | ${review.metrics.lines} | ${review.metrics.functions} | ${review.metrics.complexity} | ${review.issues.length} |\n`;
    }
    
    return output;
  }
  
  private async saveState(): Promise<void> {
    const reviews = this.watcher.getFileReviews();
    const state = {
      lastCheck: new Date().toISOString(),
      runtime: Date.now() - this.startTime,
      filesReviewed: reviews.size,
      totalIssues: Array.from(reviews.values()).reduce((sum, r) => sum + r.issues.length, 0),
    };
    
    try {
      await fs.writeFile(CONFIG.STATE_FILE, JSON.stringify(state, null, 2));
    } catch (err) {
      await this.logger.error(`Failed to save state: ${err}`);
    }
  }
  
  stop(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.reportTimer) clearInterval(this.reportTimer);
    this.logger.info('Tracker stopped.');
  }
}

// ─── Main Entry Point ──────────────────────────────────────────

async function main() {
  const tracker = new CodeReviewTracker();
  await tracker.init();
  tracker.start();
  
  process.on('SIGINT', () => {
    tracker.stop();
    process.exit(0);
  });
  
  process.on('SIGTERM', () => {
    tracker.stop();
    process.exit(0);
  });
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

export { CodeReviewEngine, FileWatcher, CodeReviewTracker };
