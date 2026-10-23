// ==========================================================================
// Orbital X — Intelligent Task Orchestrator (orchestrator.js)
// Enforces Gravitas invariants: Grounded planning, dependency tracking,
// evidence-backed verification, bounded failure recovery, and state isolation.
// ==========================================================================

import { state, notify } from '../state/store.js';

/**
 * Evaluates whether a user request is direct (localized) or complex (multi-step/subsystem).
 * Following Gravitas:
 * - Direct: Localized queries, typos, simple explanations, single inspections.
 * - Complex: Multi-step features, refactoring, building whole subsystems, migrations, explicit /plan.
 */
export function isComplexRequest(prompt) {
  if (!prompt || typeof prompt !== 'string') return false;
  const p = prompt.trim();
  const pLower = p.toLowerCase();

  // Explicit plan command
  if (pLower.startsWith('/plan')) return true;

  // Question/inspection patterns that are strictly simple
  const simpleStarts = [
    'what is', 'what does', 'explain', 'how do i', 'how to',
    'read ', 'view ', 'show ', 'where is', 'find ', 'search ',
    'git status', 'git diff', 'echo ', 'help', 'list '
  ];
  if (simpleStarts.some(prefix => pLower.startsWith(prefix)) && p.length < 90 && !p.includes('\n')) {
    return false;
  }

  // Multi-step complex indicators
  const complexKeywords = [
    'implement', 'refactor', 'orchestrat', 'overhaul', 'build',
    'migrate', 'architecture', 'subsystem', 'full stack', 'end to end',
    'create module', 'add feature', 'upgrade', 'restructure'
  ];
  const hasComplexKeyword = complexKeywords.some(kw => pLower.includes(kw));

  // Multiple requirements / numbered lists / bullet points
  const hasMultipleSteps = (p.match(/\d+[\.\)]\s/g) || []).length >= 2 ||
                           (p.match(/[-*•]\s+/g) || []).length >= 2 ||
                           p.includes(' then ') || p.includes(' and also ');

  // Substantial prompt with action verbs
  const isSubstantial = p.length > 120 && (hasComplexKeyword || hasMultipleSteps);

  return hasComplexKeyword || hasMultipleSteps || isSubstantial;
}

/**
 * Creates a repository-aware structured implementation plan before code mutation.
 */
export async function createPlan(prompt, projectStructure = null, inspectedFiles = []) {
  const cleanPrompt = prompt.replace(/^\/plan\s*/i, '').trim() || 'Workspace Enhancement';
  const planId = 'plan_' + Date.now();

  const configs = projectStructure?.config_files || [];
  const entryPoints = projectStructure?.entry_points || [];
  const targetFiles = inspectedFiles.length > 0 ? inspectedFiles : (entryPoints.slice(0, 3));

  // Determine primary tech stack context
  const hasCargo = configs.includes('Cargo.toml');
  const hasNode = configs.includes('package.json');
  const hasTauri = configs.includes('tauri.conf.json');

  const diagTool = hasCargo ? 'cargo check' : (hasNode ? 'node --check / tsc' : 'compiler diagnostic');

  // Grounded tasks breakdown with explicit dependency graph
  const tasks = [
    {
      id: 'task-1',
      title: 'Reconnaissance & Boundary Audit',
      objective: `Inspect target architecture, interfaces, and dependencies for "${cleanPrompt.substring(0, 40)}"`,
      files: targetFiles.slice(0, 2),
      dependencies: [],
      status: 'pending',
      criteria: 'Key file structures, imports, and IPC/data contracts inspected without assumptions.',
      evidence: null,
      notes: null,
      retries: 0
    },
    {
      id: 'task-2',
      title: 'Core Subsystem Implementation',
      objective: `Implement core logic, tools, or data models requested in "${cleanPrompt.substring(0, 45)}"`,
      files: targetFiles.slice(0, 3),
      dependencies: ['task-1'],
      status: 'pending',
      criteria: 'Code written or patched into target modules adhering to existing project abstractions.',
      evidence: null,
      notes: null,
      retries: 0
    },
    {
      id: 'task-3',
      title: 'Integration & State Synchronization',
      objective: 'Wire updated functionality into application state, chat UI, or Tauri IPC layer',
      files: targetFiles.slice(1, 4),
      dependencies: ['task-2'],
      status: 'pending',
      criteria: 'End-to-end integration verified: state updates trigger appropriate UI reactions.',
      evidence: null,
      notes: null,
      retries: 0
    },
    {
      id: 'task-4',
      title: 'Focused Verification & Diagnostics',
      objective: `Execute ${diagTool} and validate that no regressions or syntax errors were introduced`,
      files: targetFiles,
      dependencies: ['task-3'],
      status: 'pending',
      criteria: `${diagTool} passes with exit code 0; verified changes conform to specification.`,
      evidence: null,
      notes: null,
      retries: 0
    }
  ];

  const plan = {
    id: planId,
    title: cleanPrompt.length > 55 ? cleanPrompt.substring(0, 52) + '...' : cleanPrompt,
    objective: cleanPrompt,
    configs,
    entryPoints,
    inspectedFiles: targetFiles,
    tasks,
    status: 'pending', // 'pending' | 'in_progress' | 'completed' | 'blocked' | 'failed' | 'cancelled'
    currentTaskId: null,
    startedAt: null,
    completedAt: null,
    elapsedSeconds: 0,
    filesModified: new Set(),
  };

  return plan;
}

/**
 * Checks if a task is eligible to run (dependencies completed and task is pending).
 */
export function canStartTask(task, plan) {
  if (!task || task.status !== 'pending') return false;
  if (!task.dependencies || task.dependencies.length === 0) return true;

  return task.dependencies.every(depId => {
    const depTask = plan.tasks.find(t => t.id === depId);
    return depTask && depTask.status === 'completed';
  });
}

/**
 * Returns the next eligible task in the plan.
 */
export function getNextTask(plan) {
  if (!plan || !plan.tasks) return null;
  return plan.tasks.find(t => canStartTask(t, plan)) || null;
}

/**
 * Validates and updates a task state in the active plan.
 * Enforces Gravitas Invariant 3: Cannot mark completed without evidence!
 */
export function updateTaskState(plan, taskId, newStatus, evidence = '', notes = '') {
  if (!plan || !plan.tasks) return { success: false, error: 'No active plan' };

  const task = plan.tasks.find(t => t.id === taskId);
  if (!task) return { success: false, error: `Task not found: ${taskId}` };

  const validStatuses = ['pending', 'in_progress', 'completed', 'blocked', 'failed', 'skipped', 'cancelled'];
  if (!validStatuses.includes(newStatus)) {
    return { success: false, error: `Invalid task status: ${newStatus}` };
  }

  // Invariant 3 enforcement
  if (newStatus === 'completed') {
    const cleanEv = (evidence || '').trim();
    if (cleanEv.length < 5) {
      return {
        success: false,
        error: 'Cannot mark task complete without verification evidence (Gravitas Invariant 3).'
      };
    }
    task.evidence = cleanEv;
  }

  task.status = newStatus;
  if (notes) task.notes = notes;

  // Update plan overall status
  const allCompleted = plan.tasks.every(t => t.status === 'completed' || t.status === 'skipped');
  const hasFailed = plan.tasks.some(t => t.status === 'failed');
  const hasBlocked = plan.tasks.some(t => t.status === 'blocked');

  if (allCompleted) {
    plan.status = 'completed';
    plan.completedAt = Date.now();
  } else if (hasFailed) {
    plan.status = 'failed';
  } else if (hasBlocked) {
    plan.status = 'blocked';
  } else if (plan.tasks.some(t => t.status === 'in_progress')) {
    plan.status = 'in_progress';
  }

  persistPlanState(plan);
  notify('orchestrator:task-updated', { plan, task });

  return { success: true, task, plan };
}

/**
 * Derives task completion progress fraction and percentage.
 */
export function calculateProgress(plan) {
  if (!plan || !plan.tasks || plan.tasks.length === 0) {
    return { completedCount: 0, totalCount: 0, percentage: 0 };
  }
  const totalCount = plan.tasks.length;
  const completedCount = plan.tasks.filter(t => t.status === 'completed' || t.status === 'skipped').length;
  const percentage = Math.round((completedCount / totalCount) * 100);

  return { completedCount, totalCount, percentage };
}

/**
 * Persists active plan to localStorage for workspace isolation.
 */
export function persistPlanState(plan) {
  try {
    const wsRoot = state.workspace.rootPath || 'default';
    const key = `orbital_active_plan_${encodeURIComponent(wsRoot)}`;

    if (!plan || plan.status === 'completed' || plan.status === 'cancelled') {
      localStorage.removeItem(key);
      state.orchestrator.activePlan = plan;
      return;
    }

    // Convert Set of filesModified to array for JSON serialization
    const serializablePlan = {
      ...plan,
      filesModified: Array.from(plan.filesModified || []),
    };

    localStorage.setItem(key, JSON.stringify(serializablePlan));
    state.orchestrator.activePlan = plan;
  } catch (err) {
    console.warn('Could not persist orchestrator plan:', err);
  }
}

/**
 * Restores persisted plan for the current workspace.
 */
export function restorePlanState() {
  try {
    const wsRoot = state.workspace.rootPath || 'default';
    const key = `orbital_active_plan_${encodeURIComponent(wsRoot)}`;
    const saved = localStorage.getItem(key);
    if (!saved) return null;

    const parsed = JSON.parse(saved);
    parsed.filesModified = new Set(parsed.filesModified || []);
    state.orchestrator.activePlan = parsed;
    return parsed;
  } catch (err) {
    console.warn('Could not restore orchestrator plan:', err);
    return null;
  }
}
