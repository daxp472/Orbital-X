// ==========================================================================
// Orbital X — Global Find & Replace (search.js)
//
// Sidebar panel backed by the Rust search_files_advanced matcher: regex,
// case sensitivity, whole word, and include/exclude globs. Replace All reads
// each matched file, applies the same matching mode, and saves through the
// normal save_file path (change journal + diffs stay intact).
// ==========================================================================

import { invoke } from '../services/tauri.js';
import { showToast } from '../services/notifications.js';

let searchState = {
  regex: false,
  caseSensitive: false,
  wholeWord: false,
  query: '',
  replaceWith: '',
  include: '',
  exclude: '',
  results: [],
  files: 0,
  total: 0,
};

export function initSearchPanel() {
  renderPanelShell();

  const input = document.getElementById('sf-query');
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); runSearch(); }
  });
  document.getElementById('sf-toggle-regex')?.addEventListener('click', () => toggle('regex', 'sf-toggle-regex'));
  document.getElementById('sf-toggle-case')?.addEventListener('click', () => toggle('caseSensitive', 'sf-toggle-case'));
  document.getElementById('sf-toggle-word')?.addEventListener('click', () => toggle('wholeWord', 'sf-toggle-word'));
  document.getElementById('sf-run')?.addEventListener('click', runSearch);
  document.getElementById('sf-replace-all')?.addEventListener('click', replaceAll);
  document.getElementById('sf-include')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') runSearch(); });
  document.getElementById('sf-exclude')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') runSearch(); });
}

function toggle(key, btnId) {
  searchState[key] = !searchState[key];
  document.getElementById(btnId)?.classList.toggle('active', searchState[key]);
}

function renderPanelShell() {
  const view = document.getElementById('view-search');
  if (!view) return;
  view.innerHTML = `
    <div class="sidebar-header"><span>Search</span></div>
    <div style="padding: 8px; display: flex; flex-direction: column; gap: 6px;">
      <div style="display: flex; gap: 4px;">
        <input type="text" class="input-text" id="sf-query" placeholder="Search in files… (Enter)" style="flex: 1; font-size: 11px;" />
        <button class="btn btn-secondary btn-sm sf-toggle" id="sf-toggle-regex" title="Use regular expression">.*</button>
        <button class="btn btn-secondary btn-sm sf-toggle" id="sf-toggle-case" title="Match case">Aa</button>
        <button class="btn btn-secondary btn-sm sf-toggle" id="sf-toggle-word" title="Match whole word">ab|</button>
        <button class="btn btn-primary btn-sm" id="sf-run" title="Run search" style="padding: 2px 8px;">🔍</button>
      </div>
      <div style="display: flex; gap: 4px;">
        <input type="text" class="input-text" id="sf-replace" placeholder="Replace with…" style="flex: 1; font-size: 11px;" />
        <button class="btn btn-secondary btn-sm" id="sf-replace-all" title="Replace all matches" style="padding: 2px 8px;">Replace All</button>
      </div>
      <div style="display: flex; gap: 4px;">
        <input type="text" class="input-text" id="sf-include" placeholder="Include: src/**/*.rs" style="flex: 1; font-size: 10px;" />
        <input type="text" class="input-text" id="sf-exclude" placeholder="Exclude: *.lock, dist/" style="flex: 1; font-size: 10px;" />
      </div>
    </div>
    <div class="sidebar-content" id="sf-results" style="padding: 0 8px 8px; overflow-y: auto; flex: 1;">
      <div class="pack-empty">Type a query and press Enter to search across all workspace files.</div>
    </div>
  `;
}

async function runSearch() {
  const query = document.getElementById('sf-query')?.value ?? '';
  if (!query.trim()) return;
  searchState.query = query;
  searchState.replaceWith = document.getElementById('sf-replace')?.value ?? '';
  searchState.include = document.getElementById('sf-include')?.value ?? '';
  searchState.exclude = document.getElementById('sf-exclude')?.value ?? '';

  const resultsEl = document.getElementById('sf-results');
  if (resultsEl) resultsEl.innerHTML = '<div class="pack-empty">Searching…</div>';

  try {
    const results = await invoke('search_workspace_advanced', {
      query,
      isRegex: searchState.regex,
      caseSensitive: searchState.caseSensitive,
      wholeWord: searchState.wholeWord,
      include: searchState.include || null,
      exclude: searchState.exclude || null,
      maxResults: 200,
    });
    searchState.results = results || [];
    const byFile = new Map();
    for (const m of searchState.results) {
      if (!byFile.has(m.file)) byFile.set(m.file, []);
      byFile.get(m.file).push(m);
    }
    searchState.files = byFile.size;
    searchState.total = searchState.results.length;
    renderResults(byFile);
  } catch (e) {
    if (resultsEl) resultsEl.innerHTML = `<div class="pack-empty" style="color: var(--accent-red);">${escapeHtml(String(e))}</div>`;
  }
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function highlightSnippet(snippet, query) {
  const safe = escapeHtml(snippet);
  if (!query) return safe;
  try {
    let pattern;
    if (searchState.regex) {
      pattern = query;
    } else {
      pattern = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    if (searchState.wholeWord) pattern = `\\b(?:${pattern})\\b`;
    const flags = searchState.caseSensitive ? 'g' : 'gi';
    const re = new RegExp(pattern, flags);
    return safe.replace(re, (m) => `<mark style="background: var(--diff-add-bg); color: inherit; border-radius: 2px;">${m}</mark>`);
  } catch (e) {
    return safe;
  }
}

function renderResults(byFile) {
  const resultsEl = document.getElementById('sf-results');
  if (!resultsEl) return;
  resultsEl.innerHTML = '';

  if (searchState.total === 0) {
    resultsEl.innerHTML = '<div class="pack-empty">No matches found.</div>';
    return;
  }

  const summary = document.createElement('div');
  summary.style.cssText = 'font-size: 10px; color: var(--text-muted); padding: 2px 0 6px;';
  summary.textContent = `${searchState.files} file${searchState.files === 1 ? '' : 's'}, ${searchState.total} match${searchState.total === 1 ? '' : 'es'}`;
  resultsEl.appendChild(summary);

  for (const [file, matches] of byFile) {
    const group = document.createElement('div');
    group.style.cssText = 'margin-bottom: 6px;';
    const header = document.createElement('div');
    header.style.cssText = 'font-size: 11px; font-weight: 600; color: var(--accent-cyan); padding: 3px 2px; cursor: pointer;';
    header.textContent = file;
    header.title = file;
    header.addEventListener('click', () => openAt(file, matches[0].line));
    group.appendChild(header);

    for (const m of matches) {
      const row = document.createElement('div');
      row.style.cssText = 'font-family: var(--font-mono); font-size: 10px; padding: 2px 6px; cursor: pointer; border-radius: 3px; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
      row.innerHTML = `<span style="color: var(--text-muted); margin-right: 6px;">${m.line}</span>${highlightSnippet(m.snippet, searchState.query)}`;
      row.addEventListener('click', () => openAt(file, m.line));
      group.appendChild(row);
    }
    resultsEl.appendChild(group);
  }
}

async function openAt(file, line) {
  try {
    const m = await import('../editor/monaco.js');
    const fileData = await invoke('read_file', { path: file });
    if (fileData.is_binary) return;
    m.openFileInTab(fileData);
    const ed = m.getActiveEditor();
    if (ed) {
      ed.revealLineInCenter(line);
      ed.setPosition({ lineNumber: line, column: 1 });
      ed.focus();
    }
  } catch (e) {
    showToast(`Could not open ${file}: ${e}`, 'error');
  }
}

async function replaceAll() {
  if (searchState.results.length === 0) { runSearch(); return; }
  const replaceWith = document.getElementById('sf-replace')?.value ?? '';
  const total = searchState.total;
  const confirmed = confirm(`Replace ${total} match${total === 1 ? '' : 'es'} across ${searchState.files} file${searchState.files === 1 ? '' : 's'} with "${replaceWith}"?`);
  if (!confirmed) return;

  // Build the JS matcher with the same semantics as the Rust matcher
  let re;
  try {
    let pattern = searchState.regex ? searchState.query : searchState.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (searchState.wholeWord) pattern = `\\b(?:${pattern})\\b`;
    re = new RegExp(pattern, searchState.caseSensitive ? 'g' : 'gi');
  } catch (e) {
    showToast(`Invalid pattern: ${e}`, 'error');
    return;
  }

  const byFile = new Map();
  for (const m of searchState.results) {
    if (!byFile.has(m.file)) byFile.set(m.file, 0);
    byFile.set(m.file, byFile.get(m.file) + 1);
  }

  let replacedFiles = 0, replacedTotal = 0;
  for (const file of byFile.keys()) {
    try {
      const fileData = await invoke('read_file', { path: file });
      if (fileData.is_binary) continue;
      re.lastIndex = 0;
      const before = fileData.content;
      const after = before.replace(re, () => {
        replacedTotal++;
        return replaceWith;
      });
      if (before !== after) {
        await invoke('save_file', { path: file, content: after, description: 'Search & Replace' });
        replacedFiles++;
        // Refresh the tab if open
        import('../editor/monaco.js').then((m) => {
          for (const panel of ['left', 'right']) {
            const tabs = m.getPanelTabs(panel);
            const tab = tabs.find(t => t.path === file || t.path.endsWith('/' + file) || t.path.endsWith('\\' + file));
            if (tab) {
              tab.content = after;
              tab.originalContent = after;
              tab.isDirty = false;
              m.renderTabs(panel);
            }
          }
        });
      }
    } catch (e) {
      console.warn(`Replace failed in ${file}:`, e);
    }
  }

  showToast(`Replaced ${replacedTotal} match${replacedTotal === 1 ? '' : 'es'} in ${replacedFiles} file${replacedFiles === 1 ? '' : 's'}`, 'success', 3500);
  runSearch(); // refresh results
}
