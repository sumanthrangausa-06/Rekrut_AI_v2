#!/usr/bin/env node
/**
 * Rekrut AI — Error Tracking & Issue Monitor
 * 
 * A 7-month execution script that tracks all launch blockers,
 * waits for fixes, and reports status to Ranga daily.
 * 
 * Runs as a background process. Checks every 60 seconds for
 * state changes. Reports on fix, regressions, and new issues.
 * 
 * Built by Suga. No fluff. Just works.
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { createWriteStream } from 'fs';

// ─── Configuration ───────────────────────────────────────────────

const CONFIG = {
  // How often we check for changes (ms)
  POLL_INTERVAL: 60_000,        // 60 seconds — don't hammer the system
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
  openedAt: string;           // ISO date
  fixedAt?: string;            // ISO date
  slippedDays: number;         // How many days past deadline
  blockerFor?: string[];        // IDs of issues this blocks
  blockedBy?: string[];        // IDs of issues blocking this
  lastUpdate: string;           // ISO date
  fixCommit?: string;          // Git commit that fixed it
  notes: string[];              // Chronological notes
}

interface TrackerState {
  lastCheck: string;
  issues: Issue[];
  dailyReport: DailyReport;
  alertsSent: number;
  totalRuntime: number;         // milliseconds
}

interface DailyReport {
  date: string;
  fixed: string[];               // Issue IDs fixed today
  new: string[];                 // Issue IDs opened today
  regressed: string[];           // Issue IDs that broke again
  slipped: string[];             // Issue IDs that slipped deadline
  openP0: number;
  openP1: number;
  openP2: number;
  blockers: string[];            // Issues blocking launch
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
  private stream: ReturnType<typeof createWriteStream>;
  
  constructor(path: string) {
    this.stream = createWriteStream(path, { flags: 'a' });
  }
  
  private timestamp(): string {
    return new Date().toISOString();
  }
  
  info(msg: string): void {
    const line = `[${this.timestamp()}] INFO: ${msg}\n`;
    this.stream.write(line);
    console.log(line.trim());
  }
  
  warn(msg: string): void {
    const line = `[${this.timestamp()}] WARN: ${msg}\n`;
    this.stream.write(line);
    console.warn(line.trim());
  }
  
  error(msg: string): void {
    const line = `[${this.timestamp()}] ERROR: ${msg}\n`;
    this.stream.write(line);
    console.error(line.trim());
  }
  
  close(): void {
    this.stream.end();
  }
}

// ─── Issue Tracker ───────────────────────────────────────────────

class IssueTracker {
  private state: TrackerState;
  private logger: Logger;
  private timer: NodeJS.Timeout | null = null;
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
    this.logger.info('Tracker initializing...');
    
    try {
      // Load existing state
      const stateRaw = await fs.readFile(CONFIG.STATE_FILE, 'utf-8');
      this.state = JSON.parse(stateRaw);
      this.logger.info(`Loaded ${this.state.issues.length} issues from state file`);
    } catch {
      this.logger.info('No state file found. Starting fresh.');
      await this.loadIssuesFromTracker();
    }
    
    // Verify all P0s have owners
    const orphanedP0 = this.state.issues.filter(
      i => i.priority === 'P0' && !i.owner
    );
    if (orphanedP0.length > 0) {
      this.logger.warn(`${orphanedP0.length} P0 issues have no owner assigned`);
    }
    
    this.logger.info('Tracker ready. Starting poll loop...');
  }
  
  async loadIssuesFromTracker(): Promise<void> {
    // Load from the master bug tracker JSON
    try {
      const trackerRaw = await fs.readFile(CONFIG.ISSUES_FILE, 'utf-8');
      const tracker = JSON.parse(trackerRaw);
      
      this.state.issues = tracker.issues.map((t: any) => ({
        id: t.id,
        module: t.module,
        priority: t.priority,
        status: t.status === 'In Progress' ? 'in-progress' : 
                t.status === 'Placeholder' ? 'open' : 
                t.status === 'Needs Polish' ? 'in-progress' : 
                t.status === 'Done' ? 'fixed' : 'open',
        owner: t.owner,
        description: t.description,
        openedAt: new Date().toISOString(),
        slippedDays: 0,
        lastUpdate: new Date().toISOString(),
        notes: [`Imported from master tracker on ${new Date().toISOString()}`],
      }));
      
      this.logger.info(`Loaded ${this.state.issues.length} issues from master tracker`);
    } catch (err) {
      this.logger.error(`Failed to load master tracker: ${err}`);
      // Seed with default issues if file missing
      this.seedDefaultIssues();
    }
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
        status: 'open',
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
    
    this.logger.info('Seeded 7 default issues');
  }
  
  // ─── Poll Loop ─────────────────────────────────────────────────
  
  start(): void {
    this.logger.info(`Tracker started. Runtime: 7 months (~${Math.floor(7 * 30.44)} days)`);
    
    // Check every 60 seconds
    this.timer = setInterval(() => this.check(), CONFIG.POLL_INTERVAL);
    
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
    
    this.logger.info(`First report scheduled for ${target.toISOString()}`);
  }
  
  private async check(): Promise<void> {
    this.state.totalRuntime = Date.now() - this.startTime;
    
    // Check for external file updates (Suga or others might have updated)
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
      
      for (const externalIssue of tracker.issues) {
        const existing = this.state.issues.find(i => i.id === externalIssue.id);
        
        if (!existing) {
          // New issue found
          const newIssue: Issue = {
            id: externalIssue.id,
            module: externalIssue.module,
            priority: externalIssue.priority,
            status: 'open',
            owner: externalIssue.owner,
            description: externalIssue.description,
            openedAt: new Date().toISOString(),
            slippedDays: 0,
            lastUpdate: new Date().toISOString(),
            notes: [`Discovered by tracker on ${new Date().toISOString()}`],
          };
          this.state.issues.push(newIssue);
          this.state.dailyReport.new.push(newIssue.id);
          this.logger.warn(`NEW ISSUE: ${newIssue.id} — ${newIssue.module} (${newIssue.priority})`);
          
          if (newIssue.priority === 'P0') {
            this.sendAlert('critical', `New P0 blocker: ${newIssue.module}`, [newIssue.id]);
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
        
        // P0s should be fixed in 3 days max
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
    // In real implementation, this would check git commits, CI status, etc.
    // For now, we check if the issue file has a "fixed" flag
    
    for (const issue of this.state.issues) {
      if (issue.status === 'open' || issue.status === 'in-progress') {
        // Check if a fix commit is referenced
        if (issue.fixCommit) {
          issue.status = 'fixed';
          issue.fixedAt = new Date().toISOString();
          issue.lastUpdate = new Date().toISOString();
          issue.notes.push(`Marked as fixed by commit ${issue.fixCommit} on ${new Date().toISOString()}`);
          this.state.dailyReport.fixed.push(issue.id);
          this.logger.info(`FIXED: ${issue.id} — ${issue.module}`);
        }
      }
    }
  }
  
  // ─── Reporting ─────────────────────────────────────────────────
  
  private async generateDailyReport(): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    this.logger.info(`Generating daily report for ${today}...`);
    
    const report = this.buildReport();
    
    // Write to file
    await fs.writeFile(CONFIG.REPORT_FILE, report);
    this.logger.info(`Report written to ${CONFIG.REPORT_FILE}`);
    
    // Reset daily counters
    this.state.dailyReport = {
      date: today,
      fixed: [],
      new: [],
      regressed: [],
      slipped: [],
      openP0: this.state.issues.filter(i => i.priority === 'P0' && i.status !== 'fixed').length,
      openP1: this.state.issues.filter(i => i.priority === 'P1' && i.status !== 'fixed').length,
      openP2: this.state.issues.filter(i => i.priority === 'P2' && i.status !== 'fixed').length,
      blockers: this.state.issues
        .filter(i => i.priority === 'P0' && i.status !== 'fixed')
        .map(i => i.id),
    };
    
    // If P0s exist, send alert
    if (this.state.dailyReport.openP0 > 0) {
      this.sendAlert('warning', 
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
    
    const report = `# Rekrut AI — Daily Status Report\n\n` +
      `> **Date:** ${today}\n` +
      `> **Generated by:** Error Tracker (7-month execution)\n` +
      `> **Runtime:** ${Math.floor(this.state.totalRuntime / 1000 / 60 / 60)} hours\n` +
      `> **Total Issues:** ${this.state.issues.length}\n` +
      `> **Open:** ${openIssues.length} | **Fixed:** ${fixedIssues.length} | **Slipped:** ${slippedIssues.length}\n\n` +
      `---\n\n` +
      `## Launch Readiness\n\n` +
      `| Metric | Count | Status |\n` +
      `|--------|-------|--------|\n` +
      `| P0 Blockers (Open) | ${p0Open.length} | ${p0Open.length === 0 ? '✅ CLEAR' : '🔴 BLOCKED'} |\n` +
      `| P1 Critical (Open) | ${p1Open.length} | ${p1Open.length <= 3 ? '🟡 WATCH' : '🔴 RISK'} |\n` +
      `| P2 Important (Open) | ${p2Open.length} | ${p2Open.length <= 5 ? '🟢 OK' : '🟡 WATCH'} |\n` +
      `| Issues Slipped | ${slippedIssues.length} | ${slippedIssues.length === 0 ? '✅ NONE' : '⚠️ ACTION'} |\n\n` +
      `### Ready to Launch?\n\n` +
      `${p0Open.length === 0 && p1Open.length <= 2 ? '**YES** — All P0s cleared. Go for launch.' : 
        p0Open.length === 0 ? '**CONDITIONAL** — P0s clear but P1 backlog needs watching.' : 
        '**NO** — P0 blockers remain. Do not launch.'}\n\n` +
      `---\n\n` +
      `## Today's Changes\n\n` +
      `| Type | Count | Issues |\n` +
      `|------|-------|--------|\n` +
      `| Fixed | ${this.state.dailyReport.fixed.length} | ${this.state.dailyReport.fixed.join(', ') || 'None'} |\n` +
      `| New | ${this.state.dailyReport.new.length} | ${this.state.dailyReport.new.join(', ') || 'None'} |\n` +
      `| Regressed | ${this.state.dailyReport.regressed.length} | ${this.state.dailyReport.regressed.join(', ') || 'None'} |\n` +
      `| Slipped | ${this.state.dailyReport.slipped.length} | ${this.state.dailyReport.slipped.join(', ') || 'None'} |\n\n` +
      `---\n\n` +
      `## P0 Blockers — Detail\n\n` +
      p0Open.map(i => 
        `### ${i.id}: ${i.module}\n\n` +
        `- **Owner:** ${i.owner}\n` +
        `- **Status:** ${i.status}\n` +
        `- **Days Open:** ${Math.floor((Date.now() - new Date(i.openedAt).getTime()) / (1000 * 60 * 60 * 24))}\n` +
        `- **Slipped:** ${i.slippedDays} days\n` +
        `- **Description:** ${i.description}\n` +
        `- **Last Note:** ${i.notes[i.notes.length - 1] || 'No notes'}\n`
      ).join('\n') || '**No P0 blockers. Launch is clear.**\n\n' +
      `---\n\n` +
      `## Next 7 Days — Action Items\n\n` +
      this.getNextActions().map(a => `- [ ] ${a}`).join('\n') || '- No pending actions\n' +
      `\n---\n\n` +
      `*Report generated at ${new Date().toISOString()}*\n` +
      `*Tracker runtime: ${Math.floor(this.state.totalRuntime / 1000 / 60 / 60)} hours*\n`;
    
    return report;
  }
  
  private getNextActions(): string[] {
    const actions: string[] = [];
    
    const p0Slipped = this.state.issues.filter(
      i => i.priority === 'P0' && i.slippedDays > 0 && i.status !== 'fixed'
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
      i => i.priority === 'P1' && i.slippedDays > 3 && i.status !== 'fixed'
    );
    
    for (const issue of p1Slipped) {
      actions.push(`${issue.id} — ${issue.module}: P1 slipped 3+ days. Consider escalating to P0.`);
    }
    
    return actions;
  }
  
  // ─── Alerts ────────────────────────────────────────────────────
  
  private sendAlert(level: Alert['level'], message: string, issueIds: string[]): void {
    const alert: Alert = {
      level,
      message,
      issueIds,
      timestamp: new Date().toISOString(),
      recipients: CONFIG.ALERT_RECIPIENTS,
    };
    
    this.state.alertsSent++;
    
    // In production, this would send email/Slack/SMS
    // For now, log it
    const prefix = level === 'critical' ? '🔴 CRITICAL' : level === 'warning' ? '🟡 WARNING' : '🟢 INFO';
    this.logger.warn(`${prefix} ALERT #${this.state.alertsSent}: ${message}`);
    this.logger.warn(`  Issues: ${issueIds.join(', ')}`);
    this.logger.warn(`  Recipients: ${alert.recipients.join(', ')}`);
    
    // Write alert to file for external consumption
    this.writeAlertFile(alert);
  }
  
  private async writeAlertFile(alert: Alert): Promise<void> {
    const alertPath = `./alerts/alert-${alert.timestamp.replace(/[:.]/g, '-')}.json`;
    try {
      await fs.mkdir('./alerts', { recursive: true });
      await fs.writeFile(alertPath, JSON.stringify(alert, null, 2));
    } catch (err) {
      this.logger.error(`Failed to write alert file: ${err}`);
    }
  }
  
  // ─── State Management ──────────────────────────────────────────
  
  private async saveState(): Promise<void> {
    this.state.lastCheck = new Date().toISOString();
    try {
      await fs.writeFile(CONFIG.STATE_FILE, JSON.stringify(this.state, null, 2));
    } catch (err) {
      this.logger.error(`Failed to save state: ${err}`);
    }
  }
  
  // ─── Shutdown ────────────────────────────────────────────────────
  
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.reportTimer) clearInterval(this.reportTimer);
    this.saveState();
    this.logger.info('Tracker stopped.');
    this.logger.close();
  }
  
  // ─── Public API ──────────────────────────────────────────────────
  
  getStatus(): { open: number; fixed: number; slipped: number; p0Open: number } {
    const open = this.state.issues.filter(i => i.status !== 'fixed' && i.status !== 'verified').length;
    const fixed = this.state.issues.filter(i => i.status === 'fixed' || i.status === 'verified').length;
    const slipped = this.state.issues.filter(i => i.slippedDays > 0).length;
    const p0Open = this.state.issues.filter(i => i.priority === 'P0' && i.status !== 'fixed').length;
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
}

// ─── Trigger System ──────────────────────────────────────────────

class TriggerSystem {
  private tracker: IssueTracker;
  private logger: Logger;
  
  constructor(tracker: IssueTracker, logger: Logger) {
    this.tracker = tracker;
    this.logger = logger;
  }
  
  // Trigger: Run on file change (git hook or file watcher)
  async onFileChange(filePath: string): Promise<void> {
    this.logger.info(`Trigger: File changed — ${filePath}`);
    
    // Check if this file is related to any open issue
    const relatedIssues = this.findRelatedIssues(filePath);
    
    for (const issue of relatedIssues) {
      this.tracker.addNote(issue.id, `File modified: ${filePath}`);
      
      // If file is in a P0 module, check if it resolves the issue
      if (issue.priority === 'P0') {
        this.logger.warn(`P0 module ${issue.module} has activity. Checking if resolved...`);
      }
    }
  }
  
  // Trigger: Run on git commit
  async onGitCommit(commitHash: string, message: string, files: string[]): Promise<void> {
    this.logger.info(`Trigger: Git commit — ${commitHash.substring(0, 7)}: ${message}`);
    
    // Check for fix keywords in commit message
    const fixKeywords = ['fix', 'fixes', 'fixed', 'resolve', 'resolves', 'resolved', 'close', 'closes', 'closed'];
    const isFix = fixKeywords.some(kw => message.toLowerCase().includes(kw));
    
    if (isFix) {
      // Extract issue IDs from commit message (e.g., "Fix B-001: candidate search")
      const issueIdMatch = message.match(/[B]-\d{3}/);
      if (issueIdMatch) {
        const issueId = issueIdMatch[0];
        this.tracker.updateIssue(issueId, { 
          status: 'fixed',
          fixCommit: commitHash 
        });
        this.logger.info(`Auto-marked ${issueId} as fixed by commit ${commitHash.substring(0, 7)}`);
      }
    }
    
    // Check all modified files for related issues
    for (const file of files) {
      await this.onFileChange(file);
    }
  }
  
  // Trigger: Run on CI/CD completion
  async onCICDCompletion(status: 'success' | 'failure' | 'cancelled', buildId: string): Promise<void> {
    this.logger.info(`Trigger: CI/CD ${status} — build ${buildId}`);
    
    if (status === 'failure') {
      // Check if any P0 issues are related to this build
      const p0Issues = this.tracker['state'].issues.filter(
        i => i.priority === 'P0' && i.status !== 'fixed'
      );
      
      if (p0Issues.length > 0) {
        this.logger.error(`CI/CD failed with ${p0Issues.length} P0 issues open. Launch blocked.`);
      }
    }
  }
  
  // Trigger: Run on schedule (every second for real-time checks)
  async onTick(): Promise<void> {
    // This is called every second by the main loop
    // Lightweight checks only
    const status = this.tracker.getStatus();
    
    // Critical: If P0 count increases, alert immediately
    if (status.p0Open > 0) {
      // Already handled by the tracker check() method
    }
  }
  
  private findRelatedIssues(filePath: string): Issue[] {
    // Map file paths to modules
    const moduleMap: Record<string, string[]> = {
      'candidate-search': ['B-001'],
      'recruiter-analytics': ['B-002'],
      'stripe': ['B-003'],
      'legacy-html': ['B-004'],
      'e2e': ['B-005'],
      'cicd': ['B-006'],
      'monitoring': ['B-007'],
    };
    
    const related: Issue[] = [];
    for (const [module, issueIds] of Object.entries(moduleMap)) {
      if (filePath.toLowerCase().includes(module)) {
        for (const id of issueIds) {
          const issue = this.tracker.getIssue(id);
          if (issue) related.push(issue);
        }
      }
    }
    
    return related;
  }
}

// ─── Main Entry Point ────────────────────────────────────────────

async function main() {
  const logger = new Logger(CONFIG.LOG_FILE);
  const tracker = new IssueTracker(logger);
  const triggers = new TriggerSystem(tracker, logger);
  
  // Initialize
  await tracker.init();
  
  // Start the tracker
  tracker.start();
  
  // Set up real-time trigger (every second)
  const tickInterval = setInterval(() => {
    triggers.onTick();
  }, 1000);
  
  // Graceful shutdown
  process.on('SIGINT', () => {
    logger.info('SIGINT received. Shutting down...');
    clearInterval(tickInterval);
    tracker.stop();
    process.exit(0);
  });
  
  process.on('SIGTERM', () => {
    logger.info('SIGTERM received. Shutting down...');
    clearInterval(tickInterval);
    tracker.stop();
    process.exit(0);
  });
  
  logger.info('Tracker running. Press Ctrl+C to stop.');
}

// Run
main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

// Export for testing
export { IssueTracker, TriggerSystem, Logger };
