// ==========================================================================
// Orbital X — Professional Git Panel (source-control.js)
//
// F1 Status grouped into Staged / Unstaged / Merge Conflicts / Untracked
//    with status badges, icons, checkboxes, per-file discard
// F2 Selective staging: Stage Selected / Stage All / Unstage per file
// F3 Rich commit UI: type prefix, subject counter, amend, co-author,
//    Commit & Push
// F4 Branch management: switcher, new branch, ahead/behind, publish,
//    pull / push / fetch
// F5 History tab: commits with hash/author/time, diff preview, copy hash,
//    load more
// F6 Graph tab: `git log --graph --all` with ANSI colors rendered
// F7 Conflict resolution: ours/theirs view, Accept Current / Incoming /
//    Both, stage on resolve
// F8 Git blame: inline gutter annotations in Monaco with hover details
// F9 Stash management: named stash, list, pop/apply/drop
//
// All git operations run through the Rust arg-array gate (run_git_command)
// — no shell string interpolation anywhere.
// ==========================================================================

import * as monaco from 'monaco-editor';
import { state } from '../state/store.js';
import { invoke } from '../services/tauri.js';
import { showToast } from '../services/notifications.js';

let panelState = {
  tab: 'changes', // 'changes' | 'history' | 'graph'
  branch: '',
  upstream: '',
  ahead: 0,
  behind: 0,
  groups: { staged: [], unstaged: [], conflicts: [], untracked: [] },
  selected: new Set(), // paths checked for staging
  commitMessage: '',
  commitType: 'feat',
  amend: false,
  coAuthor: '',
  log: [],
  logSkip: 0,
  graphCache: '',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function git(args, timeoutSecs) {
  return invoke('run_git_command', { args, timeoutSeconds: timeoutSecs || 60 });
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const STATUS_META = {
  M: { label: 'M', color: 'var(--accent-orange)', title: 'Modified' },
  A: { label: 'A', color: 'var(--accent-green)', title: 'Added' },
  D: { label: 'D', color: 'var(--accent-red)', title: 'Deleted' },
  R: { label: 'R', color: 'var(--accent-purple)', title: 'Renamed' },
  C: { label: 'C', color: 'var(--accent-cyan)', title: 'Copied / Conflict' },
  U: { label: 'U', color: 'var(--text-muted)', title: 'Untracked' },
  '?': { label: 'U', color: 'var(--text-muted)', title: 'Untracked' },
};

function fileExtIcon(path) {
  const ext = path.split('.').pop().toLowerCase();
  const map = { rs: '🦀', js: '🟨', ts: '🔷', json: '🧾', md: '📝', html: '🌐', css: '🎨', py: '🐍', toml: '⚙️', yml: '⚙️', yaml: '⚙️', lock: '🔒' };
  return map[ext] || '📄';
}

function fileName(path) { return path.split('/').pop().split('\\').pop(); }

function dirOf(path) {
  const parts = path.replace(/\\/g, '/');
  const idx = parts.lastIndexOf('/');
  return idx === -1 ? '' : parts.slice(0, idx);
}

// ---------------------------------------------------------------------------
// Init + refresh
// ---------------------------------------------------------------------------

export function initSourceControl() {
  document.getElementById('btn-git-refresh')?.addEventListener('click', refreshGitStatus);
  renderPanel();
  refreshGitStatus();
}

export async function refreshGitStatus() {
  try {
    const res = await invoke('get_git_status');
    if (!res || !res.is_repo) {
      panelState.branch = res?.branch || 'Not a git repository';
      panelState.groups = { staged: [], unstaged: [], conflicts: [], untracked: [] };
      renderPanel();
      return;
    }
    parseRawStatus(res.raw || '');
    renderPanel();
  } catch (e) {
    console.warn('Git status refresh failed:', e);
  }
}

/**
 * Parses `git status --porcelain=v1 -b` raw output into groups using the
 * two-char XY codes (X = index, Y = worktree).
 */
function parseRawStatus(raw) {
  const groups = { staged: [], unstaged: [], conflicts: [], untracked: [] };
  let branch = '';
  let ahead = 0, behind = 0, upstream = '';

  for (const line of raw.split('\n')) {
    if (line.startsWith('##')) {
      const info = line.slice(2).trim();
      const m = info.match(/^(\S+?)(?:\.\.\.(\S+?))?(?:\s+\[(?:ahead (\d+))?(?:, )?(?:behind (\d+))?\])?\s*$/);
      if (m) {
        branch = m[1];
        upstream = m[2] || '';
        ahead = parseInt(m[3] || '0', 10) || 0;
        behind = parseInt(m[4] || '0', 10) || 0;
      }
      continue;
    }
    if (line.length < 4) continue;
    const x = line[0];
    const y = line[1];
    let path = line.slice(3).trim();
    let origPath = null;
    const arrow = path.indexOf(' -> ');
    if (arrow !== -1) {
      origPath = path.slice(arrow + 4);
      path = path.slice(0, arrow);
    }
    if (path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1);

    const entry = { path, origPath, x, y };
    const conflictCodes = ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'];
    if (conflictCodes.includes(x + y)) {
      groups.conflicts.push(entry);
      continue;
    }
    if (x === '?' && y === '?') { groups.untracked.push(entry); continue; }
    if (x !== ' ') groups.staged.push(entry);
    if (y !== ' ' && y !== '?') groups.unstaged.push(entry);
  }

  panelState.branch = branch || panelState.branch;
  panelState.upstream = upstream;
  panelState.ahead = ahead;
  panelState.behind = behind;
  panelState.groups = groups;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderPanel() {
  const container = document.getElementById('source-control-content');
  if (!container) return;
  container.innerHTML = '';

  container.appendChild(renderBranchHeader());

  const tabs = document.createElement('div');
  tabs.className = 'git-tabbar';
  tabs.innerHTML = `
    <button class="git-tab ${panelState.tab === 'changes' ? 'active' : ''}" data-gtab="changes">Changes${countBadge()}</button>
    <button class="git-tab ${panelState.tab === 'history' ? 'active' : ''}" data-gtab="history">History</button>
    <button class="git-tab ${panelState.tab === 'graph' ? 'active' : ''}" data-gtab="graph">Graph</button>
  `;
  tabs.querySelectorAll('.git-tab').forEach(btn => {
    btn.addEventListener('click', async () => {
      panelState.tab = btn.dataset.gtab;
      if (panelState.tab === 'history' && panelState.log.length === 0) await loadLog();
      if (panelState.tab === 'graph') await renderGraph();
      renderPanel();
    });
  });
  container.appendChild(tabs);

  const body = document.createElement('div');
  body.className = 'git-panel-body';
  if (panelState.tab === 'changes') body.appendChild(renderChangesTab());
  else if (panelState.tab === 'history') body.appendChild(renderHistoryTab());
  else body.appendChild(renderGraphTab());
  container.appendChild(body);
}

function countBadge() {
  const g = panelState.groups;
  const n = g.staged.length + g.unstaged.length + g.conflicts.length + g.untracked.length;
  return n > 0 ? ` <span class="git-count">${n}</span>` : '';
}

function renderBranchHeader() {
  const header = document.createElement('div');
  header.className = 'git-branch-header';
  const abInfo = (panelState.ahead || panelState.behind)
    ? `<span class="git-ab" title="Ahead ${panelState.ahead}, behind ${panelState.behind} of ${esc(panelState.upstream) || 'upstream'}">↑${panelState.ahead} ↓${panelState.behind}</span>`
    : '';
  const noUpstream = panelState.branch && !panelState.upstream && panelState.branch !== 'Not a git repository';

  header.innerHTML = `
    <div class="git-branch-row">
      <button class="git-branch-btn" id="git-branch-btn" title="Switch or create branch">
        <span class="git-branch-icon">⑂</span>
        <strong>${esc(panelState.branch || '—')}</strong>
        ${abInfo}
      </button>
      <div class="git-sync-actions">
        ${noUpstream ? '<button class="btn btn-secondary btn-sm" id="git-publish" title="Publish branch to origin">Publish</button>' : ''}
        <button class="btn btn-secondary btn-sm" id="git-fetch" title="git fetch --all">Fetch</button>
        <button class="btn btn-secondary btn-sm" id="git-pull" title="git pull">Pull</button>
        <button class="btn btn-secondary btn-sm" id="git-push" title="git push">Push</button>
        <button class="btn btn-secondary btn-sm" id="git-stash-btn" title="Stash operations">Stash</button>
      </div>
    </div>
  `;

  header.querySelector('#git-branch-btn')?.addEventListener('click', openBranchSwitcher);
  header.querySelector('#git-publish')?.addEventListener('click', () => gitAction(['push', '-u', 'origin', panelState.branch], `Published ${panelState.branch}`, 120));
  header.querySelector('#git-fetch')?.addEventListener('click', () => gitAction(['fetch', '--all'], 'Fetched'));
  header.querySelector('#git-pull')?.addEventListener('click', () => gitAction(['pull'], 'Pulled', 120));
  header.querySelector('#git-push')?.addEventListener('click', () => gitAction(['push'], 'Pushed', 120));
  header.querySelector('#git-stash-btn')?.addEventListener('click', (e) => openStashMenu(e));
  return header;
}

// ---------------------------------------------------------------------------
// F1 + F2 + F3: Changes tab
// ---------------------------------------------------------------------------

function renderChangesTab() {
  const wrap = document.createElement('div');
  wrap.className = 'git-changes-wrap';

  wrap.appendChild(renderCommitBox());
  wrap.appendChild(renderFileSection('Merge Conflicts', panelState.groups.conflicts, { conflictSection: true }));
  wrap.appendChild(renderFileSection('Staged Changes', panelState.groups.staged, { stagedSection: true }));
  wrap.appendChild(renderFileSection('Changes', panelState.groups.unstaged, { checkboxes: true, discard: true }));
  wrap.appendChild(renderFileSection('Untracked Files', panelState.groups.untracked, { checkboxes: true, untracked: true, discard: true }));

  const all = panelState.groups;
  if (all.staged.length + all.unstaged.length + all.conflicts.length + all.untracked.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'pack-empty';
    empty.textContent = 'Working tree clean — no changes.';
    wrap.appendChild(empty);
  }

  // Bulk staging toolbar when anything is checkable
  const checkable = all.unstaged.length + all.untracked.length;
  if (checkable > 0) {
    const bulk = document.createElement('div');
    bulk.className = 'git-bulk-bar';
    bulk.innerHTML = `
      <button class="btn btn-primary btn-sm" id="git-stage-selected" style="flex:1;">Stage Selected (0)</button>
      <button class="btn btn-secondary btn-sm" id="git-stage-all" style="flex:1;">Stage All</button>
      <button class="btn btn-secondary btn-sm" id="git-unstage-all" title="Unstage everything">Unstage All</button>
    `;
    bulk.querySelector('#git-stage-selected').addEventListener('click', async () => {
      const targets = [...panelState.selected];
      if (targets.length === 0) { showToast('Check files first (checkboxes in Changes / Untracked)', 'info', 2600); return; }
      await gitAction(['add', '--', ...targets], `Staged ${targets.length} file(s)`);
      panelState.selected.clear();
    });
    bulk.querySelector('#git-stage-all').addEventListener('click', () => gitAction(['add', '.'], 'Staged all changes'));
    bulk.querySelector('#git-unstage-all').addEventListener('click', () => gitAction(['restore', '--staged', '.'], 'Unstaged all'));
    wrap.appendChild(bulk);
  }
  return wrap;
}

function renderCommitBox() {
  const box = document.createElement('div');
  box.className = 'git-commit-box';
  const msg = panelState.commitMessage || '';
  const subjectLen = msg.split('\n')[0].length;
  const types = ['feat', 'fix', 'docs', 'style', 'refactor', 'test', 'chore'];

  box.innerHTML = `
    <div style="display:flex; gap:6px; margin-bottom:6px;">
      <select class="select-input" id="git-commit-type" style="width:96px; font-size:11px;" title="Conventional commit type">
        ${types.map(t => `<option value="${t}" ${panelState.commitType === t ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
      <textarea id="git-commit-msg" class="input-text" rows="2" placeholder="Commit message… (subject ≤ 50 chars, Ctrl+Enter commits)" style="flex:1; font-size:11px; resize:vertical;">${esc(msg)}</textarea>
    </div>
    <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
      <span id="git-char-count" class="git-char-count ${subjectLen > 50 ? 'over' : ''}">${subjectLen}/50</span>
      <label style="font-size:11px; display:flex; align-items:center; gap:4px; cursor:pointer;" title="Amend the previous commit instead of creating a new one">
        <input type="checkbox" id="git-amend" ${panelState.amend ? 'checked' : ''}> Amend
      </label>
      <input type="text" id="git-coauthor" class="input-text" placeholder="Co-author: Name <email>" value="${esc(panelState.coAuthor)}" style="flex:1; font-size:10px; padding:2px 6px;" />
    </div>
    <div style="display:flex; gap:6px;">
      <button class="btn btn-primary btn-sm" id="git-commit-btn" style="flex:1;">${panelState.amend ? 'Amend Commit' : 'Commit'}</button>
      <button class="btn btn-secondary btn-sm" id="git-commit-push-btn" style="flex:1;" title="Commit, then push">Commit & Push</button>
    </div>
  `;

  const msgEl = box.querySelector('#git-commit-msg');
  const countEl = box.querySelector('#git-char-count');
  msgEl?.addEventListener('input', () => {
    panelState.commitMessage = msgEl.value;
    const len = msgEl.value.split('\n')[0].length;
    countEl.textContent = `${len}/50`;
    countEl.classList.toggle('over', len > 50);
  });
  msgEl?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      doCommit(false);
    }
  });
  box.querySelector('#git-commit-type')?.addEventListener('change', (e) => { panelState.commitType = e.target.value; });
  box.querySelector('#git-amend')?.addEventListener('change', (e) => {
    panelState.amend = e.target.checked;
    box.querySelector('#git-commit-btn').textContent = panelState.amend ? 'Amend Commit' : 'Commit';
  });
  box.querySelector('#git-coauthor')?.addEventListener('input', (e) => { panelState.coAuthor = e.target.value; });
  box.querySelector('#git-commit-btn')?.addEventListener('click', () => doCommit(false));
  box.querySelector('#git-commit-push-btn')?.addEventListener('click', () => doCommit(true));
  return box;
}

function renderFileSection(title, files, opts = {}) {
  const section = document.createElement('div');
  section.className = 'git-section';
  if (!files || files.length === 0) return section;

  const header = document.createElement('div');
  header.className = 'git-section-header';
  header.innerHTML = `<span class="git-section-title">${title} <span class="git-count">${files.length}</span></span>`;
  section.appendChild(header);

  for (const entry of files) {
    const row = document.createElement('div');
    row.className = 'git-file-row' + (opts.conflictSection ? ' conflict' : '');
    const statusChar = entry.x === '?' ? '?' : (opts.stagedSection ? entry.x : (entry.y !== ' ' ? entry.y : entry.x));
    const meta = STATUS_META[statusChar] || STATUS_META.M;

    row.innerHTML = `
      ${opts.checkboxes ? `<input type="checkbox" class="git-stage-check" data-path="${esc(entry.path)}" ${panelState.selected.has(entry.path) ? 'checked' : ''} title="Include in next Stage Selected">` : ''}
      <span class="git-file-icon">${fileExtIcon(entry.path)}</span>
      <span class="git-file-name" title="${esc(entry.path)}">${esc(fileName(entry.path))}${entry.origPath ? ` <span class="git-renamed-from">(from ${esc(fileName(entry.origPath))})</span>` : ''}</span>
      <span class="git-file-dir" title="${esc(entry.path)}">${esc(dirOf(entry.path))}</span>
      <span class="git-status-badge" style="color:${meta.color};" title="${meta.title}">${opts.conflictSection ? 'CONFLICT' : meta.label}</span>
      <span class="git-row-actions">
        ${opts.stagedSection ? `<button class="git-icon-btn" data-op="unstage" title="Unstage (git restore --staged)">−</button>` : ''}
        ${opts.discard && !opts.conflictSection ? `<button class="git-icon-btn danger" data-op="discard" title="Discard changes">↺</button>` : ''}
        ${opts.conflictSection ? `<button class="git-icon-btn" data-op="resolve" title="Resolve conflict">⚖</button>` : ''}
      </span>
    `;
    row.querySelector('.git-file-name')?.addEventListener('click', () => previewDiff(entry));
    row.querySelectorAll('.git-icon-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const op = btn.dataset.op;
        if (op === 'unstage') unstageFile(entry.path);
        else if (op === 'discard') discardFile(entry);
        else if (op === 'resolve') openConflictResolver(entry);
      });
    });
    row.querySelector('.git-stage-check')?.addEventListener('change', (e) => {
      if (e.target.checked) panelState.selected.add(entry.path);
      else panelState.selected.delete(entry.path);
      const bulkBtn = document.getElementById('git-stage-selected');
      if (bulkBtn) bulkBtn.textContent = `Stage Selected (${panelState.selected.size})`;
    });
    section.appendChild(row);
  }
  return section;
}

async function unstageFile(path) {
  await gitAction(['restore', '--staged', '--', path], `Unstaged ${fileName(path)}`);
}

async function discardFile(entry) {
  const name = fileName(entry.path);
  if (entry.x === '?') {
    if (!confirm(`Delete untracked file "${name}" permanently?`)) return;
    await gitAction(['clean', '-f', '--', entry.path], `Removed ${name}`);
  } else {
    if (!confirm(`Discard all changes in "${name}"? This cannot be undone.`)) return;
    await gitAction(['restore', '--', entry.path], `Discarded changes in ${name}`);
  }
}

async function gitAction(args, successMsg, timeout) {
  try {
    const res = await git(args, timeout);
    if (res.success === false) {
      showToast(`Git: ${(res.stderr || res.stdout || 'failed').slice(0, 180)}`, 'error', 4500);
    } else if (successMsg) {
      showToast(successMsg, 'success', 2200);
    }
  } catch (e) {
    showToast(`Git error: ${e}`, 'error', 4500);
  } finally {
    refreshGitStatus();
  }
}

async function doCommit(andPush) {
  const isAmend = panelState.amend;
  const raw = (panelState.commitMessage || '').trim();
  if (!raw && !isAmend) {
    showToast('Write a commit message first', 'error', 2500);
    return;
  }
  let message = raw;
  // Type prefix only when the subject doesn't already carry one
  if (raw && !/^(feat|fix|docs|style|refactor|test|chore)[(:]/.test(raw.split('\n')[0])) {
    message = `${panelState.commitType}: ${raw}`;
  }
  if (panelState.coAuthor.trim()) {
    const co = panelState.coAuthor.trim();
    const coLine = /<.+>/.test(co) ? `Co-authored-by: ${co}` : `Co-authored-by: ${co} <co-author@example.com>`;
    message += `\n\n${coLine}`;
  }

  const args = isAmend
    ? ['commit', '--amend', '-m', message]
    : ['commit', '-m', message];

  const res = await git(args);
  if (res.success === false) {
    showToast(`Commit failed: ${(res.stderr || '').slice(0, 220)}`, 'error', 5000);
    return;
  }
  panelState.commitMessage = '';
  panelState.amend = false;
  showToast(isAmend ? 'Amended' : 'Committed', 'success', 2200);
  if (andPush) {
    const push = await git(['push'], 120);
    if (push.success === false) {
      showToast(`Push failed: ${(push.stderr || '').slice(0, 220)}`, 'error', 5000);
    } else {
      showToast('Committed & pushed', 'success', 2500);
    }
  }
  refreshGitStatus();
}

// ---------------------------------------------------------------------------
// Diff preview
// ---------------------------------------------------------------------------

async function previewDiff(entry) {
  const diffHost = ensureDiffHost();
  diffHost.style.display = 'block';
  diffHost.innerHTML = `<div class="pack-empty">Loading diff…</div>`;
  try {
    let text = '';
    if (entry.x === '?' || entry.y === '?') {
      text = '(untracked file — no diff)';
    } else {
      const work = await git(['diff', '--', entry.path]);
      const staged = await git(['diff', '--cached', '--', entry.path]);
      text = `${staged.stdout || ''}\n${work.stdout || ''}`.trim() || '(no textual diff — possibly binary)';
    }
    diffHost.innerHTML = `
      <div class="git-diff-header">
        <span class="git-file-icon">${fileExtIcon(entry.path)}</span>
        <strong>${esc(entry.path)}</strong>
        <button class="btn btn-secondary btn-sm" id="git-diff-close" style="margin-left:auto;">Close</button>
      </div>
      <pre class="git-diff-pre">${esc(text)}</pre>
    `;
    diffHost.querySelector('#git-diff-close')?.addEventListener('click', () => { diffHost.style.display = 'none'; });
  } catch (e) {
    diffHost.innerHTML = `<div class="pack-empty" style="color: var(--accent-red);">${esc(String(e))}</div>`;
  }
}

function ensureDiffHost() {
  let host = document.getElementById('git-diff-preview');
  if (!host) {
    host = document.createElement('div');
    host.id = 'git-diff-preview';
    host.className = 'git-diff-preview';
    host.style.display = 'none';
    const view = document.getElementById('view-source-control');
    view?.appendChild(host);
  }
  return host;
}

// ---------------------------------------------------------------------------
// F4: branch management
// ---------------------------------------------------------------------------

async function openBranchSwitcher() {
  document.getElementById('git-branch-popover')?.remove();
  const pop = document.createElement('div');
  pop.className = 'command-palette';
  pop.id = 'git-branch-popover';
  pop.style.cssText = 'position: fixed; width: 360px; max-width: 94vw; z-index: 2900;';
  pop.innerHTML = `
    <input type="text" id="git-new-branch-input" placeholder="New branch name — type and press Enter…" />
    <div class="command-palette-list" id="git-branch-list"><div class="command-palette-empty">Loading branches…</div></div>
  `;
  document.body.appendChild(pop);
  const anchor = document.getElementById('git-branch-btn')?.getBoundingClientRect();
  if (anchor) {
    pop.style.left = `${Math.min(anchor.left, window.innerWidth - 376)}px`;
    pop.style.top = `${Math.min(anchor.bottom + 6, window.innerHeight - 320)}px`;
  }

  const input = pop.querySelector('#git-new-branch-input');
  const list = pop.querySelector('#git-branch-list');
  input.focus();

  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && input.value.trim()) {
      e.preventDefault();
      const name = input.value.trim();
      pop.remove();
      await gitAction(['checkout', '-b', name], `Created & switched to ${name}`);
    } else if (e.key === 'Escape') {
      pop.remove();
    }
  });

  try {
    const res = await git(['branch', '--list', '-v', '--no-color']);
    const branches = (res.stdout || '')
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .map(l => ({ current: l.startsWith('*'), name: l.replace(/^\*?\s+/, '').split(/\s+/)[0] }));
    list.innerHTML = '';
    for (const b of branches) {
      const item = document.createElement('div');
      item.className = 'command-palette-item';
      item.innerHTML = `<span class="cp-icon">${b.current ? '●' : '⑂'}</span><span class="cp-title">${esc(b.name)}</span>${b.current ? '<span class="cp-group">current</span>' : ''}`;
      item.addEventListener('click', async () => {
        pop.remove();
        if (!b.current) await gitAction(['checkout', b.name], `Switched to ${b.name}`);
      });
      list.appendChild(item);
    }
  } catch (e) {
    list.innerHTML = `<div class="command-palette-empty">${esc(String(e))}</div>`;
  }

  setTimeout(() => {
    const onDown = (e) => {
      if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('mousedown', onDown); }
    };
    document.addEventListener('mousedown', onDown);
  }, 0);
}

// ---------------------------------------------------------------------------
// F5: history
// ---------------------------------------------------------------------------

async function loadLog(more = false) {
  if (!more) { panelState.logSkip = 0; panelState.log = []; }
  try {
    const res = await git(['log', `--skip=${panelState.logSkip}`, '-50', '--no-color', '--pretty=format:%h|%an|%ar|%s']);
    const commits = (res.stdout || '').split('\n').filter(Boolean).map(line => {
      const [hash, author, when, ...rest] = line.split('|');
      return { hash, author, when, subject: rest.join('|') };
    });
    panelState.log.push(...commits);
    panelState.logSkip += commits.length;
  } catch (e) {
    console.warn('git log failed', e);
  }
}

function renderHistoryTab() {
  const wrap = document.createElement('div');
  wrap.className = 'git-history-wrap';
  if (panelState.log.length === 0) {
    wrap.innerHTML = '<div class="pack-empty">No history loaded.</div>';
    return wrap;
  }
  for (const c of panelState.log) {
    const row = document.createElement('div');
    row.className = 'git-commit-row';
    row.innerHTML = `
      <span class="git-hash" title="Click row for diff">${esc(c.hash)}</span>
      <span class="git-subject">${esc(c.subject)}</span>
      <span class="git-meta">${esc(c.author)} · ${esc(c.when)}</span>
      <span class="git-row-actions">
        <button class="git-icon-btn" data-op="copy" title="Copy full hash">📋</button>
      </span>
    `;
    row.addEventListener('click', () => showCommitDiff(c.hash));
    row.querySelector('[data-op="copy"]')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const full = await git(['rev-parse', c.hash]);
      navigator.clipboard.writeText((full.stdout || c.hash).trim());
      showToast('Hash copied', 'success', 1500);
    });
    wrap.appendChild(row);
  }
  const moreBtn = document.createElement('button');
  moreBtn.className = 'btn btn-secondary btn-sm';
  moreBtn.style.cssText = 'margin: 8px auto; display: block;';
  moreBtn.textContent = 'Load 50 more';
  moreBtn.addEventListener('click', async () => {
    await loadLog(true);
    renderPanel();
  });
  wrap.appendChild(moreBtn);
  return wrap;
}

async function showCommitDiff(hash) {
  const diffHost = ensureDiffHost();
  diffHost.style.display = 'block';
  diffHost.innerHTML = `<div class="pack-empty">Loading commit ${esc(hash)}…</div>`;
  const res = await git(['show', '--no-color', '--stat', '-p', hash]);
  diffHost.innerHTML = `
    <div class="git-diff-header">
      <strong>Commit ${esc(hash)}</strong>
      <button class="btn btn-secondary btn-sm" id="git-diff-close" style="margin-left:auto;">Close</button>
    </div>
    <pre class="git-diff-pre">${esc(res.stdout || res.stderr || 'No output')}</pre>
  `;
  diffHost.querySelector('#git-diff-close')?.addEventListener('click', () => { diffHost.style.display = 'none'; });
}

// ---------------------------------------------------------------------------
// F6: graph
// ---------------------------------------------------------------------------

async function renderGraph() {
  try {
    const res = await git(['-c', 'color.ui=always', 'log', '--oneline', '--graph', '--all', '-30']);
    panelState.graphCache = res.stdout || '(no output)';
  } catch (e) {
    panelState.graphCache = `graph failed: ${e}`;
  }
}

function renderGraphTab() {
  const wrap = document.createElement('div');
  const pre = document.createElement('pre');
  pre.className = 'git-graph-pre';
  import('./terminal.js')
    .then(m => { pre.innerHTML = m.parseAnsiToHtml(panelState.graphCache || '').replace(/\n/g, '<br>'); })
    .catch(() => { pre.textContent = panelState.graphCache || ''; });
  const refresh = document.createElement('button');
  refresh.className = 'btn btn-secondary btn-sm';
  refresh.textContent = '↻ Refresh graph';
  refresh.style.cssText = 'margin: 8px;';
  refresh.addEventListener('click', async () => { await renderGraph(); renderPanel(); });
  wrap.append(refresh, pre);
  return wrap;
}

// ---------------------------------------------------------------------------
// F7: conflict resolution
// ---------------------------------------------------------------------------

const CONFLICT_RE = /<<<<<<<[^\n]*\n([\s\S]*?)\n?=======\n([\s\S]*?)\n?>>>>>>>[^\n]*/;

function splitConflict(text) {
  const m = text.match(CONFLICT_RE);
  if (!m) return null;
  return { ours: m[1], theirs: m[2] };
}

async function openConflictResolver(entry) {
  let content = '';
  try {
    const fileData = await invoke('read_file', { path: entry.path });
    content = fileData.content || '';
  } catch (e) {
    showToast(`Could not read ${entry.path}: ${e}`, 'error');
    return;
  }
  const parts = splitConflict(content);
  if (!parts) {
    showToast('No conflict markers found — the file may already be resolved', 'info', 3200);
    return;
  }

  document.getElementById('git-conflict-modal')?.remove();
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.id = 'git-conflict-modal';
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="modal-container" style="width: 860px; max-width: 95vw; height: 78vh; display: flex; flex-direction: column; padding: 12px;">
      <div style="display:flex; align-items:center; gap:10px; margin-bottom:8px;">
        <strong style="font-size: 13px;">Resolve conflict: ${esc(fileName(entry.path))}</strong>
        <span style="font-size: 11px; color: var(--text-muted);">${esc(entry.path)}</span>
        <button class="btn btn-secondary btn-sm" id="conflict-cancel" style="margin-left:auto;">Cancel</button>
      </div>
      <div style="display:flex; gap:8px; margin-bottom:8px;">
        <button class="btn btn-primary btn-sm" id="conflict-ours">Accept Current (ours)</button>
        <button class="btn btn-primary btn-sm" id="conflict-theirs">Accept Incoming (theirs)</button>
        <button class="btn btn-secondary btn-sm" id="conflict-both">Accept Both</button>
      </div>
      <div style="flex:1; display:flex; gap:8px; min-height:0;">
        <div style="flex:1; min-width:0; display:flex; flex-direction:column;">
          <div style="font-size:11px; font-weight:600; color: var(--accent-cyan); margin-bottom:4px;">Current (HEAD)</div>
          <pre id="conflict-ours-pre" class="git-conflict-pre"></pre>
        </div>
        <div style="flex:1; min-width:0; display:flex; flex-direction:column;">
          <div style="font-size:11px; font-weight:600; color: var(--accent-purple); margin-bottom:4px;">Incoming</div>
          <pre id="conflict-theirs-pre" class="git-conflict-pre"></pre>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('#conflict-ours-pre').textContent = parts.ours;
  modal.querySelector('#conflict-theirs-pre').textContent = parts.theirs;

  const resolve = async (choice) => {
    const replacement = choice === 'ours'
      ? parts.ours
      : choice === 'theirs'
        ? parts.theirs
        : `${parts.ours}\n${parts.theirs}`;
    const resolved = content.replace(CONFLICT_RE, replacement);
    try {
      await invoke('save_file', { path: entry.path, content: resolved, description: 'Conflict resolution' });
      await git(['add', '--', entry.path]);
      showToast(`Resolved ${fileName(entry.path)} — staged`, 'success', 2500);
      modal.remove();
      refreshGitStatus();
      import('../editor/monaco.js').then(m => {
        for (const panel of ['left', 'right']) {
          for (const t of m.getPanelTabs(panel)) {
            if (t.path === entry.path) { t.isDirty = false; m.renderTabs(panel); }
          }
        }
      });
    } catch (e) {
      showToast(`Resolution failed: ${e}`, 'error', 4000);
    }
  };

  modal.querySelector('#conflict-ours').addEventListener('click', () => resolve('ours'));
  modal.querySelector('#conflict-theirs').addEventListener('click', () => resolve('theirs'));
  modal.querySelector('#conflict-both').addEventListener('click', () => resolve('both'));
  modal.querySelector('#conflict-cancel').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}

// ---------------------------------------------------------------------------
// F8: git blame
// ---------------------------------------------------------------------------

let blameDecorations = [];
let blameActive = false;

export async function toggleGitBlame() {
  const m = await import('../editor/monaco.js');
  const ed = m.getActiveEditor();
  const model = ed?.getModel();
  if (!ed || !model) {
    showToast('Open a file first', 'info', 2000);
    return;
  }
  blameActive = !blameActive;

  if (!blameActive) {
    blameDecorations = ed.deltaDecorations(blameDecorations, []);
    showToast('Blame annotations hidden', 'info', 1600);
    return;
  }

  const panel = m.getActivePanel();
  const tabs = m.getPanelTabs(panel);
  const activeId = panel === 'left' ? state.editor.activeTabId : state.editor.rightActiveTabId;
  const tab = tabs.find(t => t.id === activeId);
  if (!tab) return;
  const rel = tab.relativePath || tab.path;

  try {
    const res = await git(['blame', '--line-porcelain', '--', rel]);
    const lines = (res.stdout || '').split('\n');
    const blames = [];
    let cur = {};
    for (const line of lines) {
      if (line.startsWith('\t')) {
        blames.push(cur);
        cur = {};
      } else if (line.startsWith('author ')) cur.author = line.slice(7);
      else if (line.startsWith('summary ')) cur.summary = line.slice(8);
      else if (line.startsWith('committer-time ')) {
        cur.date = new Date(parseInt(line.slice(15), 10) * 1000).toLocaleDateString();
      } else if (/^[0-9a-f]{40} \d+ \d+/.test(line)) {
        cur.hash = line.slice(0, 7);
      }
    }

    const decorations = blames.slice(0, model.getLineCount()).map((b, i) => ({
      range: new monaco.Range(i + 1, 1, i + 1, 1),
      options: {
        isWholeLine: true,
        after: {
          content: `  ${b.author || '?'} · ${b.date || ''} · ${b.hash || ''}`,
          inlineClassName: 'blame-ghost',
        },
        hoverMessage: { value: `**${b.hash || ''}** — ${b.author || ''} · ${b.date || ''}\n\n${b.summary || ''}` },
      },
    }));
    blameDecorations = ed.deltaDecorations(blameDecorations, decorations);
    showToast(`Blame: ${blames.length} lines annotated (hover for commit info)`, 'success', 2800);
  } catch (e) {
    blameActive = false;
    showToast(`Blame failed: ${e}`, 'error', 3500);
  }
}

// ---------------------------------------------------------------------------
// F9: stash
// ---------------------------------------------------------------------------

async function openStashMenu(anchorOrEvent) {
  document.getElementById('git-stash-popover')?.remove();
  const pop = document.createElement('div');
  pop.className = 'command-palette';
  pop.id = 'git-stash-popover';
  pop.style.cssText = 'position: fixed; width: 380px; max-width: 94vw; z-index: 2900;';
  pop.innerHTML = `
    <div style="padding: 10px 14px; border-bottom: 1px solid var(--border-subtle); display:flex; gap:6px;">
      <input type="text" id="git-stash-name" placeholder="Stash name (optional)…" style="flex:1; background: var(--bg-input); border:1px solid var(--border-color); border-radius:4px; color: var(--text-primary); font-size:12px; padding:4px 8px;" />
      <button class="btn btn-primary btn-sm" id="git-stash-push">Stash</button>
    </div>
    <div class="command-palette-list" id="git-stash-list"><div class="command-palette-empty">Loading stashes…</div></div>
  `;
  document.body.appendChild(pop);
  const anchorEl = document.getElementById('git-stash-btn')?.getBoundingClientRect();
  const x = anchorOrEvent?.clientX ?? anchorEl?.left ?? 40;
  const y = anchorOrEvent?.clientY ?? anchorEl?.bottom ?? 40;
  pop.style.left = `${Math.min(x, window.innerWidth - 396)}px`;
  pop.style.top = `${Math.min(y + 6, window.innerHeight - 300)}px`;

  pop.querySelector('#git-stash-push')?.addEventListener('click', async () => {
    const name = pop.querySelector('#git-stash-name').value.trim();
    const args = name ? ['stash', 'push', '-m', name] : ['stash', 'push'];
    pop.remove();
    await gitAction(args, 'Stashed changes');
  });

  const list = pop.querySelector('#git-stash-list');
  try {
    const res = await git(['stash', 'list']);
    const stashes = (res.stdout || '').split('\n').filter(Boolean);
    list.innerHTML = '';
    if (stashes.length === 0) {
      list.innerHTML = '<div class="command-palette-empty">No stashes.</div>';
    }
    for (const line of stashes) {
      const idx = line.split(':')[0];
      const label = line.slice(idx.length + 1).trim();
      const item = document.createElement('div');
      item.className = 'command-palette-item';
      item.innerHTML = `<span class="cp-icon">📦</span><span class="cp-title" style="font-size:11px;">${esc(label)}</span>
        <span class="git-row-actions" style="margin-left:auto; display:flex; gap:4px;">
          <button class="btn btn-secondary btn-sm" data-op="pop" title="Apply and remove the stash">Pop</button>
          <button class="btn btn-secondary btn-sm" data-op="apply" title="Apply but keep the stash">Apply</button>
          <button class="btn btn-danger btn-sm" data-op="drop" title="Delete the stash">Drop</button>
        </span>`;
      item.querySelectorAll('[data-op]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const op = btn.dataset.op;
          if (op === 'pop') await gitAction(['stash', 'pop', idx], `Popped ${idx}`);
          else if (op === 'apply') await gitAction(['stash', 'apply', idx], `Applied ${idx}`);
          else if (op === 'drop') {
            if (!confirm(`Drop stash ${idx}? This cannot be undone.`)) return;
            await gitAction(['stash', 'drop', idx], `Dropped ${idx}`);
          }
          pop.remove();
        });
      });
      list.appendChild(item);
    }
  } catch (e) {
    list.innerHTML = `<div class="command-palette-empty">${esc(String(e))}</div>`;
  }

  setTimeout(() => {
    const onDown = (e) => {
      if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('mousedown', onDown); }
    };
    document.addEventListener('mousedown', onDown);
  }, 0);
}
