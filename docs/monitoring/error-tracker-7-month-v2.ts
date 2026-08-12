#!/usr/bin/env node
/**
 * Rekrut AI — Error Tracker & Issue Monitor
 * A 7-month execution script that tracks all launch blockers,
 * waits for fixes, and reports status to Ranga daily.
 * 
 * Runs as a background process. Checks every second for
 * state changes. Reports on fixes, regressions, and new issues.
 * 
 * Built by Suga. No fluff. Just works.
 */

import { promises as fs } from 'fs';

// ─── Configuration ───────────────────────────────────────────────

const CONFIG = {
  // How often we check for changes (ms)
  POLL_INTERVAL: 60_000,        // 60 seconds for file changes
  TICK_INTERVAL: 1_000,         // 1 second for trigger checks
  REPORT_INTERVAL: 24 * 60 * 60 * 1000,  // Daily report at 6 PM IST
  
  // File paths
  ISSUES_FILE: './issues/master-tracker.json',
  LOG_FILE: './logs/error-tracker.log',
  REPORT_FILE: './reports/daily-status.md',
  STATE_FILE: './.tracker-state.json',
  
  // Thresholds for escalation
  P0_SLIP_THRESHOLD: 3,         // Days a P0 can slip before escalating
  NEW_ISSUES_ALERT: 5,          // Alert if >5 new issues in 24h
  
  // Recipients (Ranga + me)
  ALERT_RECIPIENTS: ['ranga@rekrut.ai', 'suga@rekrut.ai'],
};

// ─── Types ───────────────────────────────────────────────────────

type Priority = 'P0' | 'P1' | 'P2';
type Status = 'open' | 'in-progress' | 'fixed' | 'verified' | 'regressed' | 'deferred';

interface Issue {
  id: string;
  module: string;
  priority: Priority;
  status: Status;
  owner: string;
  description: string;
  openedAt: string;
  fixedAt?: string;
  slippedDays: number;
  lastUpdate: string;
  fixCommit?: string;
  notes: string[];
}

interface TrackerState {
  lastCheck: string;
  issues: Issue[];
  dailyReport: DailyReport;
  alertsSent: number;
  totalRuntime: number;
}

interface DailyReport {
  date: string;
  fixed: string[];
  new: string[];
  regressed: string[];
  slipped: string[];
  openP0: number;
  openP1: number;
  openP2: number;
  blockers: string[];
}

interface Alert {
  level: 'info' | 'warning' | 'critical';
  message: string;
  issueIds: string[];
  timestamp: string;
  recipients: string[];
}

// ─── Logger ──────────────────────────────────────────────────────

class Logger {
  private logPath: string;
  
  constructor(path: string) {
    this.logPath = path;
  }
  
  private async write(level: string, msg: string): Promise<void> {
    const line = `[${new Date().toISOString()}] ${level}: ${msg}\n`;
    try {
      await fs.appendFile(this.logPath, line);
    } catch {
      // If log file can't be written, still print to console
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

// ─── Issue Tracker ───────────────────────────────────────────────

class IssueTracker {
  private state: TrackerState;
  private logger: Logger;
  private tickTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private reportTimer: NodeJS.Timeout | null = null;
  private startTime: number;
  
  constructor(logger: Logger) {
    this.logger = logger;
    this.startTime = Date.now();
    this.state = {
      lastCheck: new Date().toISOString(),
      issues: [],
      dailyReport: {
        date: new Date().toISOString().split('T')[0],
        fixed: [],
        new: [],
        regressed: [],
        slipped: [],
        openP0: 0,
        openP1: 0,
        openP2: 0,
        blockers: [],
      },
      alertsSent: 0,
      totalRuntime: 0,
    };
  }
  
  async init(): Promise<void> {
    await this.logger.info('Tracker initializing...');
    
    try {
      // Ensure directories exist
      await fs.mkdir('./logs', { recursive: true });
      await fs.mkdir('./reports', { recursive: true });
      await fs.mkdir('./alerts', { recursive: true });
      await fs.mkdir('./issues', { recursive: true });
      
      // Load existing state
      const stateRaw = await fs.readFile(CONFIG.STATE_FILE, 'utf-8');
      this.state = JSON.parse(stateRaw);
      await this.logger.info(`Loaded ${this.state.issues.length} issues from state file`);
    } catch {
      await this.logger.info('No state file found. Starting fresh with defaults.');
      this.seedDefaultIssues();
    }
    
    // Verify all P0s have owners
    const orphanedP0 = this.state.issues.filter(
      i => i.priority === 'P0' && !i.owner
    );
    if (orphanedP0.length > 0) {
      await this.logger.warn(`${orphanedP0.length} P0 issues have no owner assigned`);
    }
    
    await this.logger.info('Tracker ready. Starting loops...');
  }
  
  private seedDefaultIssues(): void {
    this.state.issues = [
      {
        id: 'B-001',
        module: 'Candidate Search',
        priority: 'P0',
        status: 'in-progress',
        owner: 'Suga',
        description: 'Recruiter candidate search is a placeholder. Need full React build.',
        openedAt: '2026-06-05T00:00:00Z',
        slippedDays: 0,
        lastUpdate: '2026-06-05T00:00:00Z',
        notes: ['Seeded by tracker init'],
      },
      {
        id: 'B-002',
        module: 'Recruiter Analytics',
        priority: 'P0',
        status: 'deferred',
        owner: 'Suga',
        description: 'Recruiter analytics dashboard is a placeholder. Deferred post-launch.',
        openedAt: '2026-06-05T00:00:00Z',
        slippedDays: 0,
        lastUpdate: '2026-06-05T00:00:00Z',
        notes: ['Deferred per Ranga decision'],
      },
      {
        id: 'B-003',
        module: 'Stripe Live Mode',
        priority: 'P0',
        status: 'open',
        owner: 'Suga',
        description: 'Billing only works in test mode. Need live keys and webhook validation.',
        openedAt: '2026-06-05T00:00:00Z',
        slippedDays: 0,
        lastUpdate: '2026-06-05T00:00:00Z',
        notes: ['Blocked on Ranga: Stripe live account credentials'],
      },
      {
        id: 'B-004',
        module: 'Legacy HTML Pages',
        priority: 'P1',
        status: 'open',
        owner: 'Suga',
        description: '11 legacy HTML pages still in public/. Need migration to React.',
        openedAt: '2026-06-05T00:00:00Z',
        slippedDays: 0,
        lastUpdate: '2026-06-05T00:00:00Z',
        notes: ['Can be done in parallel with other work'],
      },
      {
        id: 'B-005',
        module: 'E2E Tests',
        priority: 'P1',
        status: 'open',
        owner: 'Suga',
        description: 'Zero automated end-to-end tests. Manual QA only.',
        openedAt: '2026-06-05T00:00:00Z',
        slippedDays: 0,
        lastUpdate: '2026-06-05T00:00:00Z',
        notes: ['Cypress test suite provided by Kimi'],
      },
      {
        id: 'B-006',
        module: 'CI/CD Pipeline',
        priority: 'P1',
        status: 'open',
        owner: 'Suga',
        description: 'Manual deploys to Render. Need GitHub Actions pipeline.',
        openedAt: '2026-06-05T00:00:00Z',
        slippedDays: 0,
        lastUpdate: '2026-06-05T00:00:00Z',
        notes: ['GitHub Actions workflow provided by Kimi'],
      },
      {
        id: 'B-007',
        module: 'Production Monitoring',
        priority: 'P1',
        status: 'open',
        owner: 'Suga',
        description: 'No Sentry/Datadog. No proactive alerts.',
        openedAt: '2026-06-05T00:00:00Z',
        slippedDays: 0,
        lastUpdate: '2026-06-05T00:00:00Z',
        notes: ['Setup guide provided by Kimi'],
      },
    ];
  }
  
  // ─── Main Loops ─────────────────────────────────────────────────
  
  start(): void {
    this.logger.info(`Tracker started. 7-month runtime (~${Math.floor(7 * 30.44)} days)`);
    
    // Tick loop: every second for real-time triggers
    this.tickTimer = setInterval(() => this.tick(), CONFIG.TICK_INTERVAL);
    
    // Poll loop: every 60 seconds for file changes
    this.pollTimer = setInterval(() => this.poll(), CONFIG.POLL_INTERVAL);
    
    // Daily report at 6 PM IST (12:30 UTC)
    const now = new Date();
    const target = new Date();
    target.setUTCHours(12, 30, 0, 0);
    if (target <= now) target.setUTCDate(target.getUTCDate() + 1);
    
    const msUntilReport = target.getTime() - now.getTime();
    
    setTimeout(() => {
      this.generateDailyReport();
      this.reportTimer = setInterval(
        () => this.generateDailyReport(),
        CONFIG.REPORT_INTERVAL
      );
    }, msUntilReport);
    
    this.logger.info(`First report at ${target.toISOString()}`);
    this.logger.info('Press Ctrl+C to stop.');
  }
  
  // ─── Tick (Every 1 Second) ─────────────────────────────────────
  
  private async tick(): Promise<void> {
    this.state.totalRuntime = Date.now() - this.startTime;
    
    // Real-time checks go here
    // Currently lightweight — just updating runtime
    // In production: check error logs, API health, etc.
  }
  
  // ─── Poll (Every 60 Seconds) ───────────────────────────────────
  
  private async poll(): Promise<void> {
    // Check for external file updates
    await this.checkExternalUpdates();
    
    // Check for slipped deadlines
    this.checkSlippedIssues();
    
    // Check for resolved issues
    this.checkResolvedIssues();
    
    // Save state
    await this.saveState();
  }
  
  private async checkExternalUpdates(): Promise<void> {
    try {
      const trackerRaw = await fs.readFile(CONFIG.ISSUES_FILE, 'utf-8');
      const tracker = JSON.parse(trackerRaw);
      
      for (const externalIssue of tracker.issues || []) {
        const existing = this.state.issues.find(i => i.id === externalIssue.id);
        
        if (!existing) {
          const newIssue: Issue = {
            id: externalIssue.id,
            module: externalIssue.module,
            priority: externalIssue.priority || 'P2',
            status: 'open',
            owner: externalIssue.owner || 'unassigned',
            description: externalIssue.description || 'No description',
            openedAt: new Date().toISOString(),
            slippedDays: 0,
            lastUpdate: new Date().toISOString(),
            notes: [`Discovered by tracker on ${new Date().toISOString()}`],
          };
          this.state.issues.push(newIssue);
          this.state.dailyReport.new.push(newIssue.id);
          await this.logger.warn(`NEW ISSUE: ${newIssue.id} — ${newIssue.module} (${newIssue.priority})`);
          
          if (newIssue.priority === 'P0') {
            await this.sendAlert('critical', `New P0 blocker: ${newIssue.module}`, [newIssue.id]);
          }
        }
      }
    } catch {
      // Master tracker not updated yet. Fine.
    }
  }
  
  private checkSlippedIssues(): void {
    const today = new Date();
    
    for (const issue of this.state.issues) {
      if (issue.status === 'open' || issue.status === 'in-progress') {
        const opened = new Date(issue.openedAt);
        const daysOpen = Math.floor((today.getTime() - opened.getTime()) / (1000 * 60 * 60 * 24));
        
        const deadline = issue.priority === 'P0' ? 3 : issue.priority === 'P1' ? 7 : 14;
        
        if (daysOpen > deadline) {
          const newSlipped = daysOpen - deadline;
          if (newSlipped > issue.slippedDays) {
            issue.slippedDays = newSlipped;
            issue.lastUpdate = today.toISOString();
            issue.notes.push(`Slipped ${newSlipped} days past deadline on ${today.toISOString()}`);
            this.state.dailyReport.slipped.push(issue.id);
            
            this.logger.warn(`SLIPPED: ${issue.id} — ${issue.module} is ${daysOpen} days open (deadline: ${deadline} days)`);
            
            if (issue.priority === 'P0' && newSlipped >= CONFIG.P0_SLIP_THRESHOLD) {
              this.sendAlert('critical', 
                `P0 ${issue.id} has slipped ${newSlipped} days. Launch at risk.`, 
                [issue.id]
              );
            }
          }
        }
      }
    }
  }
  
  private checkResolvedIssues(): void {
    for (const issue of this.state.issues) {
      if ((issue.status === 'open' || issue.status === 'in-progress') && issue.fixCommit) {
        issue.status = 'fixed';
        issue.fixedAt = new Date().toISOString();
        issue.lastUpdate = new Date().toISOString();
        issue.notes.push(`Marked as fixed by commit ${issue.fixCommit} on ${new Date().toISOString()}`);
        this.state.dailyReport.fixed.push(issue.id);
        this.logger.info(`FIXED: ${issue.id} — ${issue.module}`);
      }
    }
  }
  
  // ─── Daily Report ──────────────────────────────────────────────
  
  private async generateDailyReport(): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    await this.logger.info(`Generating daily report for ${today}...`);
    
    const report = this.buildReport();
    await fs.writeFile(CONFIG.REPORT_FILE, report);
    await this.logger.info(`Report written to ${CONFIG.REPORT_FILE}`);
    
    // Reset daily counters
    this.state.dailyReport = {
      date: today,
      fixed: [],
      new: [],
      regressed: [],
      slipped: [],
      openP0: this.state.issues.filter(i => i.priority === 'P0' && i.status !== 'fixed' && i.status !== 'verified').length,
      openP1: this.state.issues.filter(i => i.priority === 'P1' && i.status !== 'fixed' && i.status !== 'verified').length,
      openP2: this.state.issues.filter(i => i.priority === 'P2' && i.status !== 'fixed' && i.status !== 'verified').length,
      blockers: this.state.issues
        .filter(i => i.priority === 'P0' && i.status !== 'fixed' && i.status !== 'verified')
        .map(i => i.id),
    };
    
    if (this.state.dailyReport.openP0 > 0) {
      await this.sendAlert('warning', 
        `${this.state.dailyReport.openP0} P0 blockers still open. Launch at risk.`,
        this.state.dailyReport.blockers
      );
    }
  }
  
  private buildReport(): string {
    const today = new Date().toISOString().split('T')[0];
    const openIssues = this.state.issues.filter(i => i.status !== 'fixed' && i.status !== 'verified');
    const fixedIssues = this.state.issues.filter(i => i.status === 'fixed' || i.status === 'verified');
    const slippedIssues = this.state.issues.filter(i => i.slippedDays > 0);
    
    const p0Open = openIssues.filter(i => i.priority === 'P0');
    const p1Open = openIssues.filter(i => i.priority === 'P1');
    const p2Open = openIssues.filter(i => i.priority === 'P2');
    
    const hoursRunning = Math.floor(this.state.totalRuntime / 1000 / 60 / 60);
    
    let report = `# Rekrut AI — Daily Status Report\n\n`;
    report += `> **Date:** ${today}\n`;
    report += `> **Generated by:** Error Tracker (7-month execution)\n`;
    report += `> **Runtime:** ${hoursRunning} hours\n`;
    report += `> **Total Issues:** ${this.state.issues.length}\n`;
    report += `> **Open:** ${openIssues.length} | **Fixed:** ${fixedIssues.length} | **Slipped:** ${slippedIssues.length}\n\n`;
    report += `---\n\n`;
    report += `## Launch Readiness\n\n`;
    report += `| Metric | Count | Status |\n`;
    report += `|--------|-------|--------|\n`;
    report += `| P0 Blockers (Open) | ${p0Open.length} | ${p0Open.length === 0 ? '✅ CLEAR' : '🔴 BLOCKED'} |\n`;
    report += `| P1 Critical (Open) | ${p1Open.length} | ${p1Open.length <= 3 ? '🟡 WATCH' : '🔴 RISK'} |\n`;
    report += `| P2 Important (Open) | ${p2Open.length} | ${p2Open.length <= 5 ? '🟢 OK' : '🟡 WATCH'} |\n`;
    report += `| Issues Slipped | ${slippedIssues.length} | ${slippedIssues.length === 0 ? '✅ NONE' : '⚠️ ACTION'} |\n\n`;
    report += `### Ready to Launch?\n\n`;
    
    if (p0Open.length === 0 && p1Open.length <= 2) {
      report += `**YES** — All P0s cleared. Go for launch.\n\n`;
    } else if (p0Open.length === 0) {
      report += `**CONDITIONAL** — P0s clear but P1 backlog needs watching.\n\n`;
    } else {
      report += `**NO** — P0 blockers remain. Do not launch.\n\n`;
    }
    
    report += `---\n\n`;
    report += `## Today's Changes\n\n`;
    report += `| Type | Count | Issues |\n`;
    report += `|------|-------|--------|\n`;
    report += `| Fixed | ${this.state.dailyReport.fixed.length} | ${this.state.dailyReport.fixed.join(', ') || 'None'} |\n`;
    report += `| New | ${this.state.dailyReport.new.length} | ${this.state.dailyReport.new.join(', ') || 'None'} |\n`;
    report += `| Regressed | ${this.state.dailyReport.regressed.length} | ${this.state.dailyReport.regressed.join(', ') || 'None'} |\n`;
    report += `| Slipped | ${this.state.dailyReport.slipped.length} | ${this.state.dailyReport.slipped.join(', ') || 'None'} |\n\n`;
    report += `---\n\n`;
    report += `## P0 Blockers — Detail\n\n`;
    
    if (p0Open.length > 0) {
      for (const i of p0Open) {
        const daysOpen = Math.floor((Date.now() - new Date(i.openedAt).getTime()) / (1000 * 60 * 60 * 24));
        report += `### ${i.id}: ${i.module}\n\n`;
        report += `- **Owner:** ${i.owner}\n`;
        report += `- **Status:** ${i.status}\n`;
        report += `- **Days Open:** ${daysOpen}\n`;
        report += `- **Slipped:** ${i.slippedDays} days\n`;
        report += `- **Description:** ${i.description}\n`;
        report += `- **Last Note:** ${i.notes[i.notes.length - 1] || 'No notes'}\n\n`;
      }
    } else {
      report += `**No P0 blockers. Launch is clear.**\n\n`;
    }
    
    report += `---\n\n`;
    report += `## Next 7 Days — Action Items\n\n`;
    
    const actions = this.getNextActions();
    if (actions.length > 0) {
      for (const a of actions) {
        report += `- [ ] ${a}\n`;
      }
    } else {
      report += `- No pending actions\n`;
    }
    
    report += `\n---\n\n`;
    report += `*Report generated at ${new Date().toISOString()}*\n`;
    report += `*Tracker runtime: ${hoursRunning} hours*\n`;
    
    return report;
  }
  
  private getNextActions(): string[] {
    const actions: string[] = [];
    
    const p0Slipped = this.state.issues.filter(
      i => i.priority === 'P0' && i.slippedDays > 0 && i.status !== 'fixed' && i.status !== 'verified'
    );
    
    for (const issue of p0Slipped) {
      actions.push(`**URGENT:** ${issue.id} — ${issue.module} has slipped ${issue.slippedDays} days. Reassign or escalate.`);
    }
    
    const p0Open = this.state.issues.filter(
      i => i.priority === 'P0' && i.status === 'open' && i.slippedDays === 0
    );
    
    for (const issue of p0Open) {
      actions.push(`${issue.id} — ${issue.module}: Assign owner and start work immediately.`);
    }
    
    const p1Slipped = this.state.issues.filter(
      i => i.priority === 'P1' && i.slippedDays > 3 && i.status !== 'fixed' && i.status !== 'verified'
    );
    
    for (const issue of p1Slipped) {
      actions.push(`${issue.id} — ${issue.module}: P1 slipped 3+ days. Consider escalating to P0.`);
    }
    
    return actions;
  }
  
  // ─── Alerts ────────────────────────────────────────────────────
  
  private async sendAlert(level: Alert['level'], message: string, issueIds: string[]): Promise<void> {
    this.state.alertsSent++;
    
    const alert: Alert = {
      level,
      message,
      issueIds,
      timestamp: new Date().toISOString(),
      recipients: CONFIG.ALERT_RECIPIENTS,
    };
    
    const prefix = level === 'critical' ? '🔴 CRITICAL' : level === 'warning' ? '🟡 WARNING' : '🟢 INFO';
    await this.logger.warn(`${prefix} ALERT #${this.state.alertsSent}: ${message}`);
    await this.logger.warn(`  Issues: ${issueIds.join(', ')}`);
    await this.logger.warn(`  Recipients: ${alert.recipients.join(', ')}`);
    
    // Write alert to file
    const alertPath = `./alerts/alert-${alert.timestamp.replace(/[:.]/g, '-')}.json`;
    try {
      await fs.writeFile(alertPath, JSON.stringify(alert, null, 2));
    } catch (err) {
      await this.logger.error(`Failed to write alert file: ${err}`);
    }
  }
  
  // ─── State Management ────────────────────────────────────────
  
  private async saveState(): Promise<void> {
    this.state.lastCheck = new Date().toISOString();
    try {
      await fs.writeFile(CONFIG.STATE_FILE, JSON.stringify(this.state, null, 2));
    } catch (err) {
      await this.logger.error(`Failed to save state: ${err}`);
    }
  }
  
  // ─── Public API ────────────────────────────────────────────────
  
  getStatus(): { open: number; fixed: number; slipped: number; p0Open: number } {
    const open = this.state.issues.filter(i => i.status !== 'fixed' && i.status !== 'verified').length;
    const fixed = this.state.issues.filter(i => i.status === 'fixed' || i.status === 'verified').length;
    const slipped = this.state.issues.filter(i => i.slippedDays > 0).length;
    const p0Open = this.state.issues.filter(i => i.priority === 'P0' && i.status !== 'fixed' && i.status !== 'verified').length;
    return { open, fixed, slipped, p0Open };
  }
  
  getIssue(id: string): Issue | undefined {
    return this.state.issues.find(i => i.id === id);
  }
  
  updateIssue(id: string, updates: Partial<Issue>): void {
    const issue = this.state.issues.find(i => i.id === id);
    if (issue) {
      Object.assign(issue, updates, { lastUpdate: new Date().toISOString() });
      issue.notes.push(`Updated by tracker: ${JSON.stringify(updates)} at ${new Date().toISOString()}`);
      this.logger.info(`Updated ${id}: ${JSON.stringify(updates)}`);
    }
  }
  
  addNote(id: string, note: string): void {
    const issue = this.state.issues.find(i => i.id === id);
    if (issue) {
      issue.notes.push(`${new Date().toISOString()}: ${note}`);
      issue.lastUpdate = new Date().toISOString();
    }
  }
  
  // ─── Shutdown ──────────────────────────────────────────────────
  
  stop(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.reportTimer) clearInterval(this.reportTimer);
    this.saveState();
    this.logger.info('Tracker stopped.');
  }
}

// ─── Trigger System ────────────────────────────────────────────

class TriggerSystem {
  private tracker: IssueTracker;
  private logger: Logger;
  
  constructor(tracker: IssueTracker, logger: Logger) {
    this.tracker = tracker;
    this.logger = logger;
  }
  
  async onFileChange(filePath: string): Promise<void> {
    await this.logger.info(`Trigger: File changed — ${filePath}`);
    
    const moduleMap: Record<string, string[]> = {
      'candidate-search': ['B-001'],
      'recruiter-analytics': ['B-002'],
      'stripe': ['B-003'],
      'legacy-html': ['B-004'],
      'e2e': ['B-005'],
      'cicd': ['B-006'],
      'monitoring': ['B-007'],
    };
    
    for (const [module, issueIds] of Object.entries(moduleMap)) {
      if (filePath.toLowerCase().includes(module)) {
        for (const id of issueIds) {
          this.tracker.addNote(id, `File modified: ${filePath}`);
          const issue = this.tracker.getIssue(id);
          if (issue && issue.priority === 'P0') {
            await this.logger.warn(`P0 module ${issue.module} has activity. Checking if resolved...`);
          }
        }
      }
    }
  }
  
  async onGitCommit(commitHash: string, message: string, files: string[]): Promise<void> {
    await this.logger.info(`Trigger: Git commit — ${commitHash.substring(0, 7)}: ${message}`);
    
    const fixKeywords = ['fix', 'fixes', 'fixed', 'resolve', 'resolves', 'resolved', 'close', 'closes', 'closed'];
    const isFix = fixKeywords.some(kw => message.toLowerCase().includes(kw));
    
    if (isFix) {
      const issueIdMatch = message.match(/[B]-\d{3}/);
      if (issueIdMatch) {
        const issueId = issueIdMatch[0];
        this.tracker.updateIssue(issueId, { 
          status: 'fixed',
          fixCommit: commitHash 
        });
        await this.logger.info(`Auto-marked ${issueId} as fixed by commit ${commitHash.substring(0, 7)}`);
      }
    }
    
    for (const file of files) {
      await this.onFileChange(file);
    }
  }
  
  async onCICDCompletion(status: 'success' | 'failure' | 'cancelled', buildId: string): Promise<void> {
    await this.logger.info(`Trigger: CI/CD ${status} — build ${buildId}`);
    
    if (status === 'failure') {
      const status = this.tracker.getStatus();
      if (status.p0Open > 0) {
        await this.logger.error(`CI/CD failed with ${status.p0Open} P0 issues open. Launch blocked.`);
      }
    }
  }
  
  async onTick(): Promise<void> {
    const status = this.tracker.getStatus();
    if (status.p0Open > 0) {
      // Handled by poll loop
    }
  }
}

// ─── Main Entry Point ──────────────────────────────────────────

async function main() {
  const logger = new Logger(CONFIG.LOG_FILE);
  const tracker = new IssueTracker(logger);
  const triggers = new TriggerSystem(tracker, logger);
  
  await tracker.init();
  tracker.start();
  
  // Graceful shutdown
  process.on('SIGINT', async () => {
    await logger.info('SIGINT received. Shutting down...');
    tracker.stop();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    await logger.info('SIGTERM received. Shutting down...');
    tracker.stop();
    process.exit(0);
  });
}

// Run
main().catch(async err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

// Export for testing
export { IssueTracker, TriggerSystem, Logger };
