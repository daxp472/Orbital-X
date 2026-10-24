// ==========================================================================
// Orbital X — Extensions Manager (extensions.js)
//
// Real, working extension system. Orbital X extensions are declarative packs:
//   • theme       — CSS variable overrides applied at runtime
//   • prompt-pack — guidance appended to the agent system prompt
//   • command-pack— runnable terminal commands surfaced in the panel
// The registry below is BUNDLED with the app (no marketplace claims); packs
// can also be imported from local folders. VS Code .vsix / code-executing
// extensions are explicitly unsupported and rejected with a clear message.
// ==========================================================================

import { invoke, pickFolder } from '../services/tauri.js';
import { showToast } from '../services/notifications.js';

const BUNDLED_REGISTRY = [
  {
    id: 'theme-solar-flare',
    name: 'Solar Flare',
    version: '1.0.0',
    publisher: 'Orbital X',
    description: 'Warm amber-on-coal theme. Adjusts accents, borders, and surfaces for a softer dark mode.',
    type: 'theme',
    defaultEnabled: false,
    colors: {
      '--accent-cyan': '#ffb454',
      '--accent-green': '#c8e087',
      '--accent-purple': '#e0a3b8',
      '--accent-orange': '#ff8f3f',
      '--accent-red': '#ff6b6b',
      '--accent-blue': '#7fb8e8',
      '--border-focus': '#ffb454',
      '--shadow-glow-cyan': '0 0 20px rgba(255, 180, 84, 0.3)',
    },
  },
  {
    id: 'theme-arctic-night',
    name: 'Arctic Night',
    version: '1.0.0',
    publisher: 'Orbital X',
    description: 'Cool blue-grey palette with an ice-blue focus accent. Subtle surfaces, calmer tabs.',
    type: 'theme',
    defaultEnabled: false,
    colors: {
      '--accent-cyan': '#7dd3fc',
      '--accent-blue': '#60a5fa',
      '--border-focus': '#7dd3fc',
      '--bg-surface': '#1a2030',
      '--bg-card': '#1c2333',
      '--shadow-glow-cyan': '0 0 20px rgba(125, 211, 252, 0.3)',
    },
  },
  {
    id: 'prompt-rust-strict',
    name: 'Rust Strict Mode',
    version: '1.0.0',
    publisher: 'Orbital X',
    description: 'Agent guidance for Rust work: clippy-clean code, explicit error handling, cargo check before finishing.',
    type: 'prompt-pack',
    defaultEnabled: false,
    systemPromptAddition: 'RUST STRICT MODE: When writing Rust — handle errors explicitly (no unwrap/expect in production paths), prefer clippy-clean idioms, document public functions with /// comments, and always run cargo check before declaring a task complete. Use anyhow/thiserror patterns consistent with the workspace.',
  },
  {
    id: 'prompt-frontend-craft',
    name: 'Frontend Craft',
    version: '1.0.0',
    publisher: 'Orbital X',
    description: 'Agent guidance for UI work: semantic HTML first, existing design tokens, accessibility basics.',
    type: 'prompt-pack',
    defaultEnabled: false,
    systemPromptAddition: 'FRONTEND CRAFT MODE: When building or modifying UI — use semantic HTML elements, reuse the existing CSS variable tokens (--bg-*, --text-*, --accent-*, --radius-*) instead of hardcoded colors, keep keyboard focus visible, and prefer minimal DOM changes over rewrites.',
  },
  {
    id: 'prompt-test-first',
    name: 'Test Discipline',
    version: '1.0.0',
    publisher: 'Orbital X',
    description: 'Agent guidance: verify changes with the project toolchain before claiming completion, every time.',
    type: 'prompt-pack',
    defaultEnabled: false,
    systemPromptAddition: 'TEST DISCIPLINE: After every code change, run the project validation (validate_changes / get_diagnostics, or the language test command). Report the actual command output in your final answer. Never claim a change works without observed evidence.',
  },
  {
    id: 'cmd-web-dev',
    name: 'Web Dev Commands',
    version: '1.0.0',
    publisher: 'Orbital X',
    description: 'One-click dev workflow commands: dev server, production build, lint, and audit.',
    type: 'command-pack',
    defaultEnabled: true,
    commands: [
      { id: 'dev', title: 'Start dev server', command: 'npm run dev' },
      { id: 'build', title: 'Production build', command: 'npm run build' },
      { id: 'lint', title: 'Run linter', command: 'npm run lint' },
      { id: 'audit', title: 'Audit dependencies', command: 'npm audit' },
    ],
  },
  {
    id: 'cmd-rust-dev',
    name: 'Rust Dev Commands',
    version: '1.0.0',
    publisher: 'Orbital X',
    description: 'Everyday Rust workflow: check, test, build release, and doc.',
    type: 'command-pack',
    defaultEnabled: false,
    commands: [
      { id: 'check', title: 'cargo check', command: 'cargo check' },
      { id: 'test', title: 'cargo test', command: 'cargo test' },
      { id: 'build-release', title: 'Build (release)', command: 'cargo build --release' },
      { id: 'doc', title: 'Build docs', command: 'cargo doc --no-deps --open' },
    ],
  },
  {
    id: 'cmd-git-flow',
    name: 'Git Flow',
    version: '1.0.0',
    publisher: 'Orbital X',
    description: 'Status, recent history, and branch overview without typing.',
    type: 'command-pack',
    defaultEnabled: false,
    commands: [
      { id: 'status', title: 'git status', command: 'git status' },
      { id: 'log', title: 'Recent commits', command: 'git log --oneline -15' },
      { id: 'branches', title: 'List branches', command: 'git branch -a' },
    ],
  },
];

const TYPE_META = {
  'theme': { icon: '🎨', label: 'Theme' },
  'prompt-pack': { icon: '🧠', label: 'Prompt pack' },
  'command-pack': { icon: '⚡', label: 'Command pack' },
};

let installedCache = [];
let activeTab = 'installed';

// ---------------------------------------------------------------------------
// Runtime application
// ---------------------------------------------------------------------------

function applyExtensionThemes() {
  const themes = installedCache.filter(x => x.enabled && x.type === 'theme' && x.colors);
  let tag = document.getElementById('ext-theme-overrides');
  if (themes.length === 0) {
    tag?.remove();
    return;
  }
  if (!tag) {
    tag = document.createElement('style');
    tag.id = 'ext-theme-overrides';
    document.head.appendChild(tag);
  }
  const css = themes.map(t => {
    const decls = Object.entries(t.colors || {})
      .filter(([k, v]) => k.startsWith('--') && typeof v === 'string')
      .map(([k, v]) => `${k}: ${v};`)
      .join('\n  ');
    return `:root, body.theme-dark, body.theme-light, body.theme-hc {\n  ${decls}\n}`;
  }).join('\n');
  tag.textContent = css;
}

/** Prompt additions from enabled prompt packs (used by the agent loop). */
export function getEnabledPromptAdditions() {
  return installedCache
    .filter(x => x.enabled && x.type === 'prompt-pack' && x.systemPromptAddition)
    .slice(0, 3)
    .map(x => x.systemPromptAddition);
}

/** Commands from enabled command packs (used by the panel quick-run list). */
export function getExtensionCommands() {
  return installedCache
    .filter(x => x.enabled && x.type === 'command-pack' && Array.isArray(x.commands))
    .flatMap(x => x.commands.map(c => ({ ...c, pack: x.name })));
}

async function refreshRuntime() {
  try {
    installedCache = await invoke('list_installed_extensions');
  } catch (e) {
    installedCache = [];
  }
  applyExtensionThemes();
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

export async function initExtensions() {
  await refreshRuntime();
  wireStaticHandlers();
  renderPanel();
}

function wireStaticHandlers() {
  const searchInput = document.getElementById('extensions-search-input');
  if (searchInput && !searchInput.dataset.wired) {
    searchInput.dataset.wired = '1';
    searchInput.placeholder = 'Search extensions…';
    searchInput.addEventListener('input', () => renderPanel(searchInput.value.toLowerCase()));
  }
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function renderPanel(query = '') {
  const container = document.getElementById('extensions-list-container');
  if (!container) return;

  const matches = (x) =>
    !query ||
    x.name.toLowerCase().includes(query) ||
    (x.description || '').toLowerCase().includes(query) ||
    (x.publisher || '').toLowerCase().includes(query);

  const installed = installedCache.filter(matches);
  const registry = BUNDLED_REGISTRY.filter(matches).filter(r => !installed.some(i => i.id === r.id));

  container.innerHTML = `
    <div style="display: flex; gap: 4px; margin-bottom: 8px;">
      <button class="btn btn-sm ${activeTab === 'installed' ? 'btn-primary' : 'btn-secondary'}" data-ext-tab="installed" style="flex: 1; font-size: 10px;">
        Installed (${installedCache.length})
      </button>
      <button class="btn btn-sm ${activeTab === 'browse' ? 'btn-primary' : 'btn-secondary'}" data-ext-tab="browse" style="flex: 1; font-size: 10px;">
        Browse registry (${BUNDLED_REGISTRY.length})
      </button>
    </div>
    <button class="btn btn-secondary btn-sm" id="btn-import-extension" style="width: 100%; font-size: 10px; margin-bottom: 8px;">
      📁 Import extension from folder…
    </button>
    <div id="extensions-tab-content" style="display: flex; flex-direction: column; gap: 8px;"></div>
    <div style="font-size: 9px; color: var(--text-muted); margin-top: 10px; line-height: 1.5;">
      Orbital X supports declarative packs (themes, prompt packs, command packs) — bundled here and importable from folders.
      VS Code .vsix packages and code-executing extensions are not supported.
    </div>
  `;

  container.querySelectorAll('[data-ext-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.extTab;
      renderPanel(query);
    });
  });
  container.querySelector('#btn-import-extension')?.addEventListener('click', importFromFolder);

  const tabContent = container.querySelector('#extensions-tab-content');
  if (activeTab === 'installed') {
    renderInstalled(tabContent, installed, query);
  } else {
    renderRegistry(tabContent, registry);
  }
}

function renderInstalled(root, list, query = '') {
  if (list.length === 0) {
    root.innerHTML = `<div class="pack-empty">
      ${installedCache.length === 0
        ? 'No extensions installed yet.<br>Open the <strong>Browse registry</strong> tab to install bundled packs,<br>or import one from a folder.'
        : 'No installed extensions match your search.'}
    </div>`;
    return;
  }
  for (const ext of list) {
    root.appendChild(packCard(ext, { installed: true }));
  }
  // Command quick-run section (hidden while filtering)
  const cmds = getExtensionCommands();
  if (cmds.length > 0 && !query) {
    const section = document.createElement('div');
    section.style.cssText = 'border-top: 1px solid var(--border-subtle); margin-top: 4px; padding-top: 8px;';
    section.innerHTML = `<div style="font-size: 10px; font-weight: 600; color: var(--text-secondary); margin-bottom: 6px;">Commands from enabled packs</div>`;
    for (const c of cmds.slice(0, 12)) {
      const row = document.createElement('div');
      row.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 3px 0; font-size: 10px;';
      row.innerHTML = `
        <span style="min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${esc(c.command)}">${esc(c.title)} <span style="color: var(--text-muted);">· ${esc(c.pack)}</span></span>
        <button class="btn btn-secondary btn-sm ext-run-cmd" style="padding: 1px 8px; font-size: 10px; flex-shrink: 0;">Run</button>`;
      row.querySelector('.ext-run-cmd')?.addEventListener('click', async () => {
        const { executeTerminalCommand } = await import('./terminal.js');
        const bottom = document.getElementById('bottom-panel');
        bottom?.classList.remove('collapsed');
        executeTerminalCommand(c.command);
      });
      section.appendChild(row);
    }
    root.appendChild(section);
  }
}

function renderRegistry(root, list) {
  if (list.length === 0) {
    root.innerHTML = `<div class="pack-empty">Every bundled pack matching your search is already installed. 🎉</div>`;
    return;
  }
  for (const ext of list) {
    root.appendChild(packCard(ext, { installed: false }));
  }
}

function packCard(ext, { installed }) {
  const meta = TYPE_META[ext.type] || { icon: '📦', label: ext.type || 'Pack' };
  const card = document.createElement('div');
  card.className = 'pack-card';

  const titleRow = document.createElement('div');
  titleRow.className = 'pack-title-row';
  titleRow.innerHTML = `
    <span class="pack-name" title="${esc(ext.name)}">${meta.icon} ${esc(ext.name)}</span>
    <span class="pack-type-badge">${meta.label}</span>
  `;

  const actions = document.createElement('div');
  actions.className = 'pack-actions';
  actions.style.marginLeft = 'auto';

  if (installed) {
    const toggle = document.createElement('button');
    toggle.className = `pack-toggle ${ext.enabled ? 'on' : ''}`;
    toggle.title = ext.enabled ? 'Disable' : 'Enable';
    toggle.setAttribute('aria-label', `${ext.enabled ? 'Disable' : 'Enable'} ${ext.name}`);
    toggle.addEventListener('click', async () => {
      try {
        await invoke('set_extension_enabled', { id: ext.id, enabled: !ext.enabled });
        await refreshRuntime();
        renderPanel(document.getElementById('extensions-search-input')?.value.toLowerCase() || '');
        showToast(`${ext.name} ${ext.enabled ? 'enabled' : 'disabled'}`, 'success', 2000);
      } catch (e) {
        showToast(`Toggle failed: ${e}`, 'error');
      }
    });

    const uninstallBtn = document.createElement('button');
    uninstallBtn.className = 'btn btn-danger btn-sm';
    uninstallBtn.style.cssText = 'padding: 1px 8px; font-size: 10px;';
    uninstallBtn.textContent = 'Uninstall';
    uninstallBtn.addEventListener('click', async () => {
      if (!confirm(`Uninstall "${ext.name}"? You can reinstall it from the registry or re-import the folder.`)) return;
      try {
        await invoke('uninstall_extension', { id: ext.id });
        await refreshRuntime();
        renderPanel(document.getElementById('extensions-search-input')?.value.toLowerCase() || '');
        showToast(`Uninstalled ${ext.name}`, 'success', 2500);
      } catch (e) {
        showToast(`Uninstall failed: ${e}`, 'error');
      }
    });
    actions.append(toggle, uninstallBtn);
  } else {
    const installBtn = document.createElement('button');
    installBtn.className = 'btn btn-primary btn-sm';
    installBtn.style.cssText = 'padding: 1px 10px; font-size: 10px;';
    installBtn.textContent = 'Install';
    installBtn.addEventListener('click', async () => {
      installBtn.disabled = true;
      installBtn.textContent = '…';
      try {
        await invoke('install_extension_from_manifest', { manifest: ext });
        await refreshRuntime();
        renderPanel(document.getElementById('extensions-search-input')?.value.toLowerCase() || '');
        showToast(`Installed ${ext.name}`, 'success', 2500);
      } catch (e) {
        showToast(`Install failed: ${e}`, 'error');
        installBtn.disabled = false;
        installBtn.textContent = 'Install';
      }
    });
    actions.append(installBtn);
  }

  titleRow.appendChild(actions);
  card.appendChild(titleRow);

  const metaLine = document.createElement('div');
  metaLine.className = 'pack-meta';
  metaLine.textContent = `${ext.publisher || 'unknown'} · v${ext.version || '0.0.0'}${installed ? (ext.enabled ? ' · enabled' : ' · disabled') : ''}`;
  card.appendChild(metaLine);

  const desc = document.createElement('div');
  desc.className = 'pack-desc';
  desc.textContent = ext.description || '';
  card.appendChild(desc);

  // Details toggle — type-specific, honest about scope
  const detailsBtn = document.createElement('button');
  detailsBtn.className = 'btn btn-secondary btn-sm';
  detailsBtn.style.cssText = 'align-self: flex-start; padding: 1px 8px; font-size: 10px;';
  detailsBtn.textContent = 'Details';
  const detail = document.createElement('div');
  detail.className = 'pack-detail';
  detail.style.display = 'none';
  detailsBtn.addEventListener('click', () => {
    detail.style.display = detail.style.display === 'none' ? 'block' : 'none';
    detailsBtn.textContent = detail.style.display === 'none' ? 'Details' : 'Hide';
  });
  detail.textContent = detailText(ext);
  card.append(detailsBtn, detail);

  return card;
}

function detailText(ext) {
  switch (ext.type) {
    case 'theme':
      const vars = Object.keys(ext.colors || {}).length;
      return `Overrides ${vars} CSS variables (accents, focus, surfaces) at runtime. Does not change layout or Monaco editor syntax colors. Combineable — later enabled packs apply on top.`;
    case 'prompt-pack':
      return `Appends this guidance to the agent's system prompt when enabled:\n\n"${ext.systemPromptAddition}"\n\nApplies to every agent turn, all providers.`;
    case 'command-pack':
      return `Adds ${(ext.commands || []).length} one-click commands to this panel. Running a command executes it in the integrated terminal — the same as typing it yourself:\n\n${(ext.commands || []).map(c => `• ${c.title}: ${c.command}`).join('\n')}`;
    default:
      return ext.description || '';
  }
}

async function importFromFolder() {
  const path = await pickFolder();
  if (!path) return;
  try {
    const res = await invoke('install_extension_from_folder', { path });
    if (res && res.success !== false) {
      await refreshRuntime();
      activeTab = 'installed';
      renderPanel('');
      showToast(`Imported extension successfully`, 'success', 2500);
    } else {
      showToast(`Import failed: ${res?.error || 'unknown error'}`, 'error', 4000);
    }
  } catch (e) {
    showToast(`${e}`, 'error', 6000);
  }
}
