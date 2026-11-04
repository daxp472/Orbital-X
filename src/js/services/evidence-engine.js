// ==========================================================================
// Orbital X — Reasoning, Evidence & Verification Engine (evidence-engine.js)
//
// Grounded Mathematical Formulation:
//   Scientific Reasoning:  psi = min(omega_logic, omega_evidence)
//   Deductive Reasoning:   psi <= min(omega_logic, omega_evidence)
//
// Principles:
// 1. Logical Consistency: Verify actions and claims are non-contradictory.
// 2. Evidence Validation: Ground conclusions in concrete workspace facts.
// 3. Assumption Detection: Distinguish verified facts from unconfirmed leaps.
// 4. Confidence Calibration: Never express more certainty than psi warrants.
// 5. Result Verification: Verify code & commands before reporting success.
// 6. Honest Reporting: Distinguish verified, partial, uncertain, and failed.
// ==========================================================================

import { state } from '../state/store.js';

export class EvidenceLedger {
  constructor(sessionId = null) {
    this.sessionId = sessionId || `session_${Date.now()}`;
    this.reset();
  }

  reset() {
    this.filesRead = new Set();
    this.filesModified = new Map(); // path -> { type, timestamp, readBeforeWrite: boolean, bytes: number }
    this.commandsExecuted = []; // { command, exitCode, outputSummary, passed, timestamp }
    this.diagnostics = []; // { tool, success, issuesCount, details, timestamp }
    this.externalSources = []; // { url, title, summary, timestamp }
    this.userConstraints = []; // strings
    this.toolCalls = []; // { name, args, result, timestamp }
    this.assumptions = []; // { type, description, severity, impact }
    this.contradictions = []; // { type, description, severity }
    this.lastCalibration = null;
  }

  /**
   * Records a tool invocation and its observable runtime outcome.
   */
  recordToolCall(toolCall, toolResult) {
    const name = toolCall?.name;
    let args = toolCall?.arguments;
    if (typeof args === 'string') {
      try { args = JSON.parse(args); } catch (e) { args = {}; }
    }
    if (!args || typeof args !== 'object') args = {};

    const now = Date.now();
    const entry = { name, args, result: toolResult, timestamp: now };
    this.toolCalls.push(entry);

    // 1. Files read / inspected
    if (['read_file', 'read_file_lines', 'view_file'].includes(name) && args.path) {
      this.filesRead.add(normalizePath(args.path));
    } else if (name === 'read_multiple_files' && Array.isArray(args.paths)) {
      args.paths.forEach(p => this.filesRead.add(normalizePath(p)));
    } else if (['search_files', 'find_symbol', 'get_project_structure', 'list_files', 'workspace_info'].includes(name)) {
      if (args.path) this.filesRead.add(normalizePath(args.path));
      if (toolResult && Array.isArray(toolResult.matches)) {
        toolResult.matches.slice(0, 10).forEach(m => {
          if (m.file || m.path) this.filesRead.add(normalizePath(m.file || m.path));
        });
      }
    }

    // 2. Files modified / written
    if (['write_file', 'patch_file'].includes(name) && args.path) {
      const normPath = normalizePath(args.path);
      const wasReadBefore = this.filesRead.has(normPath);
      this.filesModified.set(normPath, {
        type: name,
        timestamp: now,
        readBeforeWrite: wasReadBefore,
        contentLength: (args.content || args.patch || '').length,
        description: args.description || '',
      });

      if (!wasReadBefore && name === 'patch_file') {
        this.assumptions.push({
          type: 'blind_patch',
          description: `Patching file "${normPath}" without prior inspection or reading.`,
          severity: 'medium',
          impact: 0.15,
        });
      }
    }

    // 3. Commands executed
    if (name === 'run_command' && args.command) {
      const exitCode = typeof toolResult?.exit_code === 'number'
        ? toolResult.exit_code
        : (toolResult?.error ? 1 : 0);
      const passed = exitCode === 0 && !toolResult?.error;
      const outputText = String(toolResult?.stdout || toolResult?.output || toolResult?.error || '');

      this.commandsExecuted.push({
        command: args.command,
        exitCode,
        outputSummary: outputText.slice(0, 300),
        passed,
        timestamp: now,
      });

      if (!passed) {
        this.contradictions.push({
          type: 'command_failed',
          description: `Command "${args.command.slice(0, 50)}" failed with exit code ${exitCode}.`,
          severity: 'high',
        });
      }
    }

    // 4. Validation & diagnostics
    if (name === 'validate_changes') {
      const success = Boolean(toolResult?.success);
      const issuesCount = Array.isArray(toolResult?.issues) ? toolResult.issues.length : (success ? 0 : 1);
      this.diagnostics.push({
        tool: 'validate_changes',
        success,
        issuesCount,
        details: toolResult?.summary || (success ? 'All checks passed' : 'Validation issues reported'),
        timestamp: now,
      });

      if (!success) {
        this.contradictions.push({
          type: 'validation_error',
          description: `validate_changes detected ${issuesCount} diagnostics or compiler issues.`,
          severity: 'high',
        });
      }
    }

    // 5. External sources
    if (name === 'fetch_page' && args.url) {
      this.externalSources.push({
        url: args.url,
        title: toolResult?.title || args.url,
        summary: String(toolResult?.content || '').slice(0, 200),
        timestamp: now,
      });
    }
  }

  /**
   * Pre-tool safety verification: checks whether proposed action violates invariants
   * or introduces ungrounded blind mutations.
   */
  evaluatePreToolSafety(toolName, args) {
    if (['write_file', 'patch_file'].includes(toolName) && args?.path) {
      const normPath = normalizePath(args.path);
      const wasRead = this.filesRead.has(normPath);
      if (!wasRead) {
        return {
          advisory: `Target "${normPath}" has not been read in this session. Grounding check recommended.`,
          grounded: false,
        };
      }
    }
    return { advisory: null, grounded: true };
  }

  /**
   * Calculates logic consistency score omega_logic in [0.0, 1.0].
   */
  calculateLogicScore(finalText = '', initialUserPrompt = '') {
    let score = 1.0;
    const textLower = (finalText || '').toLowerCase();
    const promptLower = (initialUserPrompt || '').toLowerCase();

    // Check for success claims contradicted by actual failures
    const claimsSuccess = /\b(all done|successfully (fixed|resolved|implemented|completed)|tests? (passed|passing)|build (succeeded|passed)|no (errors|issues))\b/i.test(textLower);

    const hasFailedCommand = this.commandsExecuted.some(c => !c.passed);
    const hasFailedDiagnostic = this.diagnostics.some(d => !d.success);

    if (claimsSuccess && (hasFailedCommand || hasFailedDiagnostic)) {
      score -= 0.50; // Major logical contradiction: claiming victory amidst failing commands
      this.contradictions.push({
        type: 'unsubstantiated_claim',
        description: 'Agent claimed success or tests passing while runtime commands or diagnostics failed.',
        severity: 'critical',
      });
    }

    // Check if prompt required validation / test and none was executed
    const askedForTest = /\b(test|validate|verify|check|lint|typecheck|build)\b/i.test(promptLower);
    const ranValidation = this.diagnostics.length > 0 || this.commandsExecuted.some(c =>
      /(test|cargo check|npm test|vitest|jest|tsc|pytest|check)/i.test(c.command)
    );

    if (askedForTest && this.filesModified.size > 0 && !ranValidation) {
      score -= 0.20; // Requested validation was skipped
      this.assumptions.push({
        type: 'skipped_requested_test',
        description: 'User requested testing/verification, but no test or validation tool was run after modifying code.',
        severity: 'medium',
        impact: 0.15,
      });
    }

    // Check dependency satisfaction for completed tools
    if (this.filesModified.size > 0) {
      let unreadModifications = 0;
      for (const [p, mod] of this.filesModified.entries()) {
        if (!mod.readBeforeWrite) unreadModifications++;
      }
      if (unreadModifications > 0) {
        const ratio = unreadModifications / this.filesModified.size;
        score -= (ratio * 0.25);
      }
    }

    // Contradiction penalties
    const severeContradictions = this.contradictions.filter(c => c.severity === 'critical' || c.severity === 'high');
    if (severeContradictions.length > 0) {
      score -= Math.min(0.40, severeContradictions.length * 0.20);
    }

    return Math.max(0.05, Math.min(1.0, Number(score.toFixed(3))));
  }

  /**
   * Calculates evidence grounding score omega_evidence in [0.0, 1.0].
   */
  calculateEvidenceScore(finalText = '', initialUserPrompt = '') {
    const textLower = (finalText || '').toLowerCase();
    let evidenceComponents = [];

    // Component 1: File inspection grounding
    if (this.filesModified.size > 0) {
      let verifiedReadCount = 0;
      for (const [p, mod] of this.filesModified.entries()) {
        if (mod.readBeforeWrite) verifiedReadCount++;
      }
      const inspectRatio = verifiedReadCount / this.filesModified.size;
      evidenceComponents.push({ weight: 0.35, score: inspectRatio, label: 'Files inspected before edit' });
    } else if (this.filesRead.size > 0) {
      evidenceComponents.push({ weight: 0.35, score: 0.95, label: 'Workspace context read' });
    } else {
      // Pure conversation without file access
      const isPurelyConversational = !/\b(code|file|function|error|bug|test|build|workspace)\b/i.test(initialUserPrompt);
      evidenceComponents.push({ weight: 0.35, score: isPurelyConversational ? 0.90 : 0.40, label: 'Workspace grounding' });
    }

    // Component 2: Verification / Diagnostics Grounding
    if (this.diagnostics.length > 0) {
      const allPassed = this.diagnostics.every(d => d.success);
      evidenceComponents.push({ weight: 0.40, score: allPassed ? 1.0 : 0.20, label: 'Diagnostics results' });
    } else if (this.filesModified.size > 0) {
      // Modified files without running diagnostics
      evidenceComponents.push({ weight: 0.40, score: 0.40, label: 'Post-edit verification missing' });
      this.assumptions.push({
        type: 'unverified_code_changes',
        description: 'Code was modified but no diagnostics or tests were run to verify correctness.',
        severity: 'medium',
        impact: 0.15,
      });
    } else {
      evidenceComponents.push({ weight: 0.40, score: 0.85, label: 'No file modifications requiring diagnostics' });
    }

    // Component 3: Command execution evidence
    if (this.commandsExecuted.length > 0) {
      const passedCount = this.commandsExecuted.filter(c => c.passed).length;
      const cmdScore = passedCount / this.commandsExecuted.length;
      evidenceComponents.push({ weight: 0.25, score: cmdScore, label: 'Command exit status' });
    } else {
      evidenceComponents.push({ weight: 0.25, score: 0.80, label: 'Terminal command grounding' });
    }

    // Weighted average
    let totalWeight = 0;
    let weightedSum = 0;
    for (const comp of evidenceComponents) {
      totalWeight += comp.weight;
      weightedSum += comp.weight * comp.score;
    }

    let score = totalWeight > 0 ? weightedSum / totalWeight : 0.50;

    // Deduct for ungrounded external sources used as authoritative workspace facts
    if (this.externalSources.length > 0 && /\b(internal|orbital|local)\b/i.test(textLower)) {
      score = Math.max(0.10, score - 0.10);
    }

    return Math.max(0.05, Math.min(1.0, Number(score.toFixed(3))));
  }

  /**
   * Identifies ungrounded assumptions in response and actions.
   */
  detectAssumptions(finalText = '', initialUserPrompt = '') {
    const textLower = (finalText || '').toLowerCase();
    const discovered = [...this.assumptions];

    // Assumption: Claiming something was tested without any execution
    if (/\b(i tested|verified working|working properly|checked for regressions|confirmed working)\b/i.test(textLower)) {
      const ranCheck = this.diagnostics.length > 0 || this.commandsExecuted.length > 0;
      if (!ranCheck) {
        discovered.push({
          type: 'untested_assertion',
          description: 'Response claims changes were tested or confirmed working, but no test/command was executed.',
          severity: 'high',
          impact: 0.20,
        });
      }
    }

    // Assumption: Claiming a file exists or was created without tool record
    if (/\b(created file|written to|saved in)\s+[`"']?([a-zA-Z0-9_\-\./\\]+\.[a-zA-Z0-9]+)[`"']?/i.test(textLower)) {
      const match = textLower.match(/\b(created file|written to|saved in)\s+[`"']?([a-zA-Z0-9_\-\./\\]+\.[a-zA-Z0-9]+)[`"']?/i);
      if (match && match[2]) {
        const file = normalizePath(match[2]);
        if (!this.filesModified.has(file)) {
          discovered.push({
            type: 'phantom_file_claim',
            description: `Agent claimed writing to "${file}" but no file mutation tool succeeded for that path.`,
            severity: 'critical',
            impact: 0.30,
          });
        }
      }
    }

    return discovered;
  }

  /**
   * Scientific & Deductive Calibration:
   *   Scientific: psi = min(omega_logic, omega_evidence)
   *   Deductive:  psi <= min(omega_logic, omega_evidence) * (1 - sum(assumption_penalties))
   */
  computeCalibration(finalText = '', initialUserPrompt = '') {
    const omegaLogic = this.calculateLogicScore(finalText, initialUserPrompt);
    const omegaEvidence = this.calculateEvidenceScore(finalText, initialUserPrompt);
    const assumptions = this.detectAssumptions(finalText, initialUserPrompt);

    // Baseline scientific calibration: psi = min(omega_logic, omega_evidence)
    let psi = Math.min(omegaLogic, omegaEvidence);

    // Deductive refinement: penalize for ungrounded assumptions
    let assumptionPenalty = 0;
    for (const a of assumptions) {
      assumptionPenalty += (a.impact || 0.10);
    }
    assumptionPenalty = Math.min(0.50, assumptionPenalty);

    // Enforce deductive bound: psi <= min(omega_logic, omega_evidence)
    psi = Math.max(0.05, Math.min(psi, (psi * (1.0 - assumptionPenalty))));
    psi = Number(psi.toFixed(3));

    // Determine status tier
    let status = 'verified';
    let label = 'Verified';
    let icon = '✓';
    let theme = 'success'; // for css

    if (this.contradictions.some(c => c.severity === 'critical') || psi < 0.20) {
      status = 'failed';
      label = 'Contradicted / Failed';
      icon = '✗';
      theme = 'danger';
    } else if (psi < 0.50 || assumptions.some(a => a.severity === 'critical')) {
      status = 'uncertain';
      label = 'Uncertain';
      icon = '?';
      theme = 'warning';
    } else if (psi < 0.80 || assumptions.length > 0) {
      status = 'partially_verified';
      label = 'Partially Grounded';
      icon = '⚡';
      theme = 'info';
    }

    const calibration = {
      psi,
      omegaLogic,
      omegaEvidence,
      status,
      label,
      icon,
      theme,
      assumptions,
      contradictions: this.contradictions,
      summary: {
        filesReadCount: this.filesRead.size,
        filesModifiedCount: this.filesModified.size,
        commandsCount: this.commandsExecuted.length,
        diagnosticsCount: this.diagnostics.length,
        externalSourcesCount: this.externalSources.length,
      },
      timestamp: Date.now(),
    };

    this.lastCalibration = calibration;
    return calibration;
  }
}

// Global active ledger instance
let activeLedger = new EvidenceLedger();

export function getActiveEvidenceLedger() {
  if (!activeLedger) {
    activeLedger = new EvidenceLedger();
  }
  return activeLedger;
}

export function resetActiveEvidenceLedger() {
  activeLedger = new EvidenceLedger();
  return activeLedger;
}

/**
 * Normalizes relative workspace path.
 */
function normalizePath(p) {
  if (!p || typeof p !== 'string') return '';
  return p.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

/**
 * Generates an Apple-grade, lightweight, glassmorphic verification pill HTML
 * for injection into assistant timeline cards.
 */
export function renderEvidenceBadge(calibration) {
  if (!calibration) return '';

  const { psi, omegaLogic, omegaEvidence, label, icon, theme, assumptions, contradictions } = calibration;
  const psiPercent = Math.round(psi * 100);
  const logicPercent = Math.round(omegaLogic * 100);
  const evPercent = Math.round(omegaEvidence * 100);

  // Colors aligned with Orbital X dark glass theme
  let badgeStyle = '';
  let dotColor = '#10b981';

  if (theme === 'success') {
    badgeStyle = 'background: rgba(16, 185, 129, 0.12); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3);';
    dotColor = '#10b981';
  } else if (theme === 'info') {
    badgeStyle = 'background: rgba(56, 189, 248, 0.12); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3);';
    dotColor = '#38bdf8';
  } else if (theme === 'warning') {
    badgeStyle = 'background: rgba(245, 158, 11, 0.12); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3);';
    dotColor = '#f59e0b';
  } else {
    badgeStyle = 'background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.35);';
    dotColor = '#ef4444';
  }

  const tooltipLines = [
    `Reasoning & Evidence Calibration:`,
    `• Calibrated Confidence (ψ): ${psiPercent}%  [min(ω_logic, ω_evidence)]`,
    `• Logical Consistency (ω_logic): ${logicPercent}%`,
    `• Empirical Evidence (ω_evidence): ${evPercent}%`,
  ];

  if (assumptions.length > 0) {
    tooltipLines.push(`• Flagged Assumptions (${assumptions.length}):`);
    assumptions.slice(0, 3).forEach(a => tooltipLines.push(`  - ${a.description}`));
  }

  if (contradictions.length > 0) {
    tooltipLines.push(`• Discrepancies (${contradictions.length}):`);
    contradictions.slice(0, 2).forEach(c => tooltipLines.push(`  - ${c.description}`));
  }

  const tooltipAttr = tooltipLines.map(l => escapeHtml(l)).join('&#10;');

  return `
    <span class="evidence-pill evidence-${theme}" title="${tooltipAttr}" style="display: inline-flex; align-items: center; gap: 4px; padding: 2px 7px; border-radius: 9999px; font-size: 10px; font-weight: 500; font-family: var(--font-code, monospace); cursor: help; user-select: none; transition: all 0.15s ease; ${badgeStyle}">
      <span style="font-weight: 700; font-size: 10px;">${icon}</span>
      <span>${label}</span>
      <span style="opacity: 0.85; font-size: 9px; padding-left: 2px;">ψ=${psi.toFixed(2)}</span>
    </span>
  `.trim();
}

/**
 * Renders an honest reporting breakdown card into timeline if needed.
 */
export function renderHonestReportingCard(calibration) {
  if (!calibration) return null;

  const card = document.createElement('div');
  card.className = `evidence-reporting-card evidence-${calibration.theme}`;
  card.style.cssText = 'margin: 6px 0 10px 0; padding: 8px 12px; border-radius: 8px; font-size: 11px; display: flex; flex-direction: column; gap: 4px; background: var(--bg-surface); border: 1px solid var(--border-subtle);';

  const { psi, omegaLogic, omegaEvidence, assumptions, contradictions, summary } = calibration;

  card.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: space-between;">
      <div style="display: flex; align-items: center; gap: 6px;">
        <span style="font-weight: 600; color: var(--text-primary);">Verification & Evidence Report</span>
        ${renderEvidenceBadge(calibration)}
      </div>
      <div style="font-size: 10px; color: var(--text-muted); font-family: monospace;">
        ω_logic: ${(omegaLogic * 100).toFixed(0)}% · ω_ev: ${(omegaEvidence * 100).toFixed(0)}% · ψ: ${(psi * 100).toFixed(0)}%
      </div>
    </div>
    <div style="display: flex; gap: 12px; color: var(--text-secondary); font-size: 10px; margin-top: 2px;">
      <span>📖 Files read: ${summary.filesReadCount}</span>
      <span>✏️ Files modified: ${summary.filesModifiedCount}</span>
      <span>💻 Commands: ${summary.commandsCount}</span>
      <span>🩺 Diagnostics: ${summary.diagnosticsCount}</span>
    </div>
    ${assumptions.length > 0 ? `
      <div style="margin-top: 4px; padding-top: 4px; border-top: 1px solid var(--border-subtle); color: var(--accent-orange); font-size: 10px;">
        ⚠️ <strong>Assumptions:</strong> ${assumptions.map(a => escapeHtml(a.description)).join(' · ')}
      </div>
    ` : ''}
    ${contradictions.length > 0 ? `
      <div style="margin-top: 4px; padding-top: 4px; border-top: 1px solid var(--border-subtle); color: #ef4444; font-size: 10px;">
        🛑 <strong>Discrepancies:</strong> ${contradictions.map(c => escapeHtml(c.description)).join(' · ')}
      </div>
    ` : ''}
  `;

  return card;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
