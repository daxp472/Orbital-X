// ==========================================================================
// Orbital X — Skills Panel & Community Hub (skills.js)
//
// Claude Code-style modular instruction packs.
// Supports:
//   1. Discovery of workspace rules (<workspace>/agent.md)
//   2. Workspace skills (<workspace>/.orbital/skills/*/SKILL.md)
//   3. Global skills (~/.orbital/skills/*/SKILL.md)
//   4. Community Skills Hub (1-click install curated packs)
//   5. Custom skill creator (modal + IPC)
//   6. Modular, lightweight Skill Index Digest for local models (Qwen, Llama)
// ==========================================================================

import { invoke, pickFolder } from '../services/tauri.js';
import { showToast } from '../services/notifications.js';

let skillsCache = [];
let communityCache = [];
let activeTab = 'installed'; // 'installed' | 'community'
let searchQuery = '';
let activeFilterTag = '';

export async function initSkills() {
  await refreshSkills();
  wirePanel();
  wireCreateModal();
}

export async function refreshSkills() {
  try {
    skillsCache = await invoke('list_skills');
  } catch (e) {
    skillsCache = [];
  }
}

async function refreshCommunitySkills() {
  try {
    communityCache = await invoke('skills_fetch_community_registry');
  } catch (e) {
    try {
      communityCache = await invoke('list_community_skills');
    } catch (_) {
      communityCache = [];
    }
  }
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function wirePanel() {
  const urlBar = document.getElementById('skills-url-import-bar');
  const tagBar = document.getElementById('skills-tag-filter-bar');
  if (urlBar) urlBar.style.display = activeTab === 'community' ? 'flex' : 'none';
  if (tagBar) tagBar.style.display = activeTab === 'community' ? 'flex' : 'none';

  const importBtn = document.getElementById('btn-import-skill');
  if (importBtn && !importBtn.dataset.wired) {
    importBtn.dataset.wired = '1';
    importBtn.addEventListener('click', importSkill);
  }

  const createBtn = document.getElementById('btn-create-skill');
  if (createBtn && !createBtn.dataset.wired) {
    createBtn.dataset.wired = '1';
    createBtn.addEventListener('click', openCreateSkillModal);
  }

  const tabInstalled = document.getElementById('tab-skills-installed');
  const tabCommunity = document.getElementById('tab-skills-community');

  if (tabInstalled && !tabInstalled.dataset.wired) {
    tabInstalled.dataset.wired = '1';
    tabInstalled.addEventListener('click', () => {
      activeTab = 'installed';
      tabInstalled.classList.add('active');
      tabInstalled.style.background = 'var(--bg-hover)';
      tabInstalled.style.borderColor = 'var(--border-color)';
      tabInstalled.style.color = 'var(--text-primary-bright)';
      tabCommunity.classList.remove('active');
      tabCommunity.style.background = 'transparent';
      tabCommunity.style.borderColor = 'transparent';
      tabCommunity.style.color = 'var(--text-muted)';
      wirePanel();
      renderSkillsPanel();
    });
  }

  if (tabCommunity && !tabCommunity.dataset.wired) {
    tabCommunity.dataset.wired = '1';
    tabCommunity.addEventListener('click', async () => {
      activeTab = 'community';
      tabCommunity.classList.add('active');
      tabCommunity.style.background = 'var(--bg-hover)';
      tabCommunity.style.borderColor = 'var(--border-color)';
      tabCommunity.style.color = 'var(--text-primary-bright)';
      tabInstalled.classList.remove('active');
      tabInstalled.style.background = 'transparent';
      tabInstalled.style.borderColor = 'transparent';
      tabInstalled.style.color = 'var(--text-muted)';
      wirePanel();
      await renderSkillsPanel();
    });
  }

  const searchInput = document.getElementById('skills-search-input');
  if (searchInput && !searchInput.dataset.wired) {
    searchInput.dataset.wired = '1';
    searchInput.addEventListener('input', (e) => {
      searchQuery = (e.target.value || '').trim().toLowerCase();
      renderSkillsPanel();
    });
  }

  // Import from GitHub URL input and button
  const importUrlBtn = document.getElementById('btn-import-skill-url');
  const inputUrl = document.getElementById('input-skill-url');
  if (importUrlBtn && !importUrlBtn.dataset.wired) {
    importUrlBtn.dataset.wired = '1';
    const doImportUrl = async () => {
      const url = (inputUrl?.value || '').trim();
      if (!url) {
        showToast('Enter any GitHub URL, owner/repo, or raw SKILL.md link.', 'warning');
        return;
      }
      importUrlBtn.disabled = true;
      importUrlBtn.textContent = 'Importing…';
      try {
        const res = await invoke('skills_install_from_url', { url });
        if (res && res.success !== false) {
          showToast(`✓ Skill "${res.name || res.id}" installed successfully!`, 'success', 3000);
          if (inputUrl) inputUrl.value = '';
          await refreshSkills();
          await renderSkillsPanel();
          import('../editor/monaco.js').then(m => m.openSkillDocTab(res));
        } else {
          showToast(`Import failed: ${res?.error || 'Unknown error'}`, 'error', 4000);
        }
      } catch (e) {
        showToast(`Import error: ${e}`, 'error', 4000);
      } finally {
        importUrlBtn.disabled = false;
        importUrlBtn.textContent = 'Import URL';
      }
    };
    importUrlBtn.addEventListener('click', doImportUrl);
    inputUrl?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doImportUrl();
    });
  }

  // Tag filter chips
  document.querySelectorAll('.skill-filter-chip').forEach(chip => {
    if (!chip.dataset.wired) {
      chip.dataset.wired = '1';
      chip.addEventListener('click', () => {
        activeFilterTag = chip.dataset.tag || '';
        document.querySelectorAll('.skill-filter-chip').forEach(c => {
          const isActive = (c.dataset.tag || '') === activeFilterTag;
          c.classList.toggle('active', isActive);
          c.style.background = isActive ? 'var(--bg-hover)' : 'transparent';
          c.style.borderColor = isActive ? 'var(--border-subtle)' : 'transparent';
          c.style.color = isActive ? 'var(--text-primary-bright)' : 'var(--text-muted)';
        });
        renderSkillsPanel();
      });
    }
  });
}

function wireCreateModal() {
  const modal = document.getElementById('modal-create-skill');
  const closeBtn = document.getElementById('btn-close-create-skill');
  const cancelBtn = document.getElementById('btn-cancel-create-skill');
  const submitBtn = document.getElementById('btn-submit-create-skill');

  const closeModal = () => {
    if (modal) modal.style.display = 'none';
  };

  closeBtn?.addEventListener('click', closeModal);
  cancelBtn?.addEventListener('click', closeModal);
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  if (submitBtn && !submitBtn.dataset.wired) {
    submitBtn.dataset.wired = '1';
    submitBtn.addEventListener('click', async () => {
      const id = document.getElementById('skill-create-id')?.value?.trim();
      const name = document.getElementById('skill-create-name')?.value?.trim();
      const trigger = document.getElementById('skill-create-trigger')?.value?.trim();
      const desc = document.getElementById('skill-create-desc')?.value?.trim();
      const scope = document.getElementById('skill-create-scope')?.value || 'global';
      const body = document.getElementById('skill-create-body')?.value?.trim();

      if (!id || !name || !body) {
        showToast('Please provide a Skill Identifier, Name, and Instructions body.', 'warning', 3000);
        return;
      }

      try {
        const res = await invoke('create_custom_skill', {
          id,
          name,
          description: desc || name,
          whenToUse: trigger || 'General engineering tasks',
          body,
          isWorkspace: scope === 'workspace'
        });

        if (res && res.success !== false) {
          showToast(`✓ Skill "${name}" created successfully (${scope})!`, 'success', 2500);
          closeModal();
          await refreshSkills();
          renderSkillsPanel();
        } else {
          showToast(`Failed: ${res?.error || 'Unknown error'}`, 'error', 3500);
        }
      } catch (e) {
        showToast(`Creation error: ${e}`, 'error', 4000);
      }
    });
  }
}

export function openCreateSkillModal() {
  const modal = document.getElementById('modal-create-skill');
  if (!modal) return;
  // Reset form
  const idEl = document.getElementById('skill-create-id');
  const nameEl = document.getElementById('skill-create-name');
  const trigEl = document.getElementById('skill-create-trigger');
  const descEl = document.getElementById('skill-create-desc');
  const bodyEl = document.getElementById('skill-create-body');
  if (idEl) idEl.value = '';
  if (nameEl) nameEl.value = '';
  if (trigEl) trigEl.value = '';
  if (descEl) descEl.value = '';
  if (bodyEl) bodyEl.value = '';
  modal.style.display = 'flex';
}

export async function renderSkillsPanel() {
  wirePanel();

  const container = document.getElementById('skills-list-container');
  if (!container) return;
  container.innerHTML = '';

  if (activeTab === 'community') {
    await refreshCommunitySkills();
    renderCommunityTab(container);
  } else {
    await refreshSkills();
    renderInstalledTab(container);
  }
}

function renderInstalledTab(container) {
  let list = skillsCache || [];
  if (searchQuery) {
    list = list.filter(s => {
      const q = searchQuery;
      return (
        (s.name && s.name.toLowerCase().includes(q)) ||
        (s.description && s.description.toLowerCase().includes(q)) ||
        (s.whenToUse && s.whenToUse.toLowerCase().includes(q)) ||
        (s.id && s.id.toLowerCase().includes(q)) ||
        (Array.isArray(s.tags) && s.tags.some(t => t.toLowerCase().includes(q)))
      );
    });
  }

  if (list.length === 0) {
    container.innerHTML = `<div class="pack-empty">
      ${searchQuery ? `No installed skills match "${esc(searchQuery)}".` : `No skills discovered in active workspace or global store.<br><br>
      • Add an <strong>agent.md</strong> in your workspace root<br>
      • Click <strong>+ New</strong> to author a custom skill<br>
      • Or switch to <strong>Community Hub</strong> to install curated packs.`}
    </div>`;
    return;
  }

  for (const skill of list) {
    const card = document.createElement('div');
    card.className = 'pack-card';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `Open skill ${skill.name || skill.id} documentation`);

    const titleRow = document.createElement('div');
    titleRow.className = 'pack-title-row';

    const nameWrap = document.createElement('div');
    nameWrap.style.cssText = 'display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1;';

    const name = document.createElement('span');
    name.className = 'pack-name';
    name.textContent = skill.name || skill.id;

    // Scope Badge: [Workspace] or [Global]
    const scopeBadge = document.createElement('span');
    scopeBadge.className = `pack-scope-badge ${skill.scope || 'global'}`;
    const isWs = skill.scope === 'workspace';
    scopeBadge.style.cssText = isWs
      ? 'background: rgba(57, 197, 187, 0.15); border: 1px solid rgba(57, 197, 187, 0.35); color: var(--accent-cyan); font-weight: 600; font-size: 9px; border-radius: 4px; padding: 1px 5px; flex-shrink: 0;'
      : 'background: rgba(168, 85, 247, 0.15); border: 1px solid rgba(168, 85, 247, 0.35); color: #c084fc; font-weight: 600; font-size: 9px; border-radius: 4px; padding: 1px 5px; flex-shrink: 0;';
    scopeBadge.textContent = isWs ? 'Workspace' : 'Global';

    nameWrap.append(name, scopeBadge);

    const actions = document.createElement('div');
    actions.className = 'pack-actions';
    actions.style.marginLeft = 'auto';

    // Toggle button
    const toggle = document.createElement('button');
    toggle.className = `pack-toggle ${skill.enabled ? 'on' : ''}`;
    toggle.title = skill.enabled ? 'Disable skill' : 'Enable skill';
    toggle.setAttribute('aria-label', `${skill.enabled ? 'Disable' : 'Enable'} ${skill.name}`);
    toggle.addEventListener('click', async () => {
      try {
        await invoke('set_skill_enabled', { id: skill.id, enabled: !skill.enabled });
        await renderSkillsPanel();
        showToast(`Skill "${skill.name}" ${skill.enabled ? 'enabled' : 'disabled'}`, 'success', 2000);
      } catch (e) {
        showToast(`Toggle failed: ${e}`, 'error');
      }
    });

    const viewBtn = document.createElement('button');
    viewBtn.className = 'btn btn-secondary btn-sm';
    viewBtn.style.cssText = 'padding: 1px 8px; font-size: 10px;';
    viewBtn.textContent = 'View';

    const openDoc = (e) => {
      e?.stopPropagation?.();
      import('../editor/monaco.js').then(m => m.openSkillDocTab(skill));
    };
    viewBtn.addEventListener('click', openDoc);
    card.style.cursor = 'pointer';
    card.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      openDoc(e);
    });
    card.addEventListener('keydown', (e) => {
      if (e.target.closest('button') && e.target !== card) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openDoc(e);
      }
    });

    actions.append(toggle, viewBtn);

    // Delete button (allowed for custom skills, not the permanent agent.md descriptor)
    if (skill.id !== 'workspace-agent-instructions') {
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn btn-danger btn-sm';
      deleteBtn.style.cssText = 'padding: 1px 8px; font-size: 10px;';
      deleteBtn.textContent = 'Delete';
      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const { showConfirmDialog } = await import('../services/dialogs.js');
        if (!await showConfirmDialog('Delete Skill', `Delete skill "${skill.name}"? The agent will no longer see it.`, 'Delete', true)) return;
        try {
          await invoke('delete_skill', { id: skill.id });
          await renderSkillsPanel();
          showToast(`Deleted skill "${skill.name}"`, 'success', 2500);
        } catch (e) {
          showToast(`Delete failed: ${e}`, 'error');
        }
      });
      actions.appendChild(deleteBtn);
    }

    titleRow.append(nameWrap, actions);
    card.appendChild(titleRow);

    const desc = document.createElement('div');
    desc.className = 'pack-desc';
    desc.textContent = skill.description || '(no description)';
    card.appendChild(desc);

    if (skill.whenToUse) {
      const when = document.createElement('div');
      when.className = 'pack-meta';
      when.style.color = 'var(--accent-cyan)';
      when.textContent = `🎯 Trigger: ${skill.whenToUse}`;
      card.appendChild(when);
    }

    if (Array.isArray(skill.tags) && skill.tags.length > 0) {
      const tagRow = document.createElement('div');
      tagRow.style.cssText = 'display: flex; gap: 4px; flex-wrap: wrap; margin-top: 2px;';
      skill.tags.forEach(t => {
        const tag = document.createElement('span');
        tag.style.cssText = 'font-size: 9px; padding: 1px 5px; border-radius: 3px; background: rgba(255,255,255,0.06); color: var(--text-muted);';
        tag.textContent = `#${t}`;
        tagRow.appendChild(tag);
      });
      card.appendChild(tagRow);
    }

    const metaLine = document.createElement('div');
    metaLine.className = 'pack-meta';
    metaLine.textContent = `${skill.enabled ? 'active' : 'disabled'} · ${((skill.bodyChars || 0) / 1000).toFixed(1)} KB instructions`;
    card.appendChild(metaLine);

    container.appendChild(card);
  }
}

function renderCommunityTab(container) {
  let list = communityCache || [];
  if (activeFilterTag) {
    list = list.filter(p => Array.isArray(p.tags) && p.tags.some(t => t.toLowerCase().includes(activeFilterTag.toLowerCase())));
  }
  if (searchQuery) {
    list = list.filter(p => {
      const q = searchQuery;
      return (
        (p.name && p.name.toLowerCase().includes(q)) ||
        (p.description && p.description.toLowerCase().includes(q)) ||
        (p.whenToUse && p.whenToUse.toLowerCase().includes(q)) ||
        (Array.isArray(p.tags) && p.tags.some(t => t.toLowerCase().includes(q)))
      );
    });
  }

  if (list.length === 0) {
    container.innerHTML = `<div class="pack-empty">No community skill packs found matching "${esc(searchQuery || activeFilterTag)}".</div>`;
    return;
  }

  for (const pack of list) {
    const card = document.createElement('div');
    card.className = 'pack-card';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `View community pack ${pack.name || pack.id}`);
    card.style.cursor = 'pointer';

    const titleRow = document.createElement('div');
    titleRow.className = 'pack-title-row';

    const nameWrap = document.createElement('div');
    nameWrap.style.cssText = 'display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1;';

    const name = document.createElement('span');
    name.className = 'pack-name';
    name.textContent = pack.name || pack.id;

    const author = document.createElement('span');
    author.style.cssText = 'font-size: 9px; padding: 1px 5px; border-radius: 4px; background: rgba(59, 130, 246, 0.15); border: 1px solid rgba(59, 130, 246, 0.35); color: #60a5fa;';
    author.textContent = pack.author || 'Community';

    nameWrap.append(name, author);

    const actions = document.createElement('div');
    actions.className = 'pack-actions';
    actions.style.marginLeft = 'auto';

    const isInstalled = Boolean(pack.installed);

    const installBtn = document.createElement('button');
    installBtn.className = isInstalled ? 'btn btn-secondary btn-sm' : 'btn btn-primary btn-sm';
    installBtn.style.cssText = 'padding: 2px 9px; font-size: 10px; font-weight: 600;';
    installBtn.textContent = isInstalled ? 'Installed ✓' : 'Install';
    if (isInstalled) {
      installBtn.disabled = true;
      installBtn.style.opacity = '0.7';
    } else {
      installBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        installBtn.disabled = true;
        installBtn.textContent = 'Installing…';
        try {
          const res = await invoke('install_community_skill', { packId: pack.id });
          if (res && res.success !== false) {
            showToast(`✓ Skill "${pack.name}" installed globally!`, 'success', 2500);
            await refreshSkills();
            await renderSkillsPanel();
          } else {
            showToast(`Installation failed: ${res?.error || 'Unknown error'}`, 'error', 3500);
            installBtn.disabled = false;
            installBtn.textContent = 'Install';
          }
        } catch (e) {
          showToast(`Install error: ${e}`, 'error', 4000);
          installBtn.disabled = false;
          installBtn.textContent = 'Install';
        }
      });
    }

    const viewBtn = document.createElement('button');
    viewBtn.className = 'btn btn-secondary btn-sm';
    viewBtn.style.cssText = 'padding: 2px 7px; font-size: 10px;';
    viewBtn.textContent = 'Preview';

    const openDoc = (e) => {
      e?.stopPropagation?.();
      import('../editor/monaco.js').then(m => m.openSkillDocTab(pack));
    };
    viewBtn.addEventListener('click', openDoc);
    card.style.cursor = 'pointer';
    card.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      openDoc(e);
    });
    card.addEventListener('keydown', (e) => {
      if (e.target.closest('button') && e.target !== card) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openDoc(e);
      }
    });

    actions.append(installBtn, viewBtn);
    titleRow.append(nameWrap, actions);
    card.appendChild(titleRow);

    const desc = document.createElement('div');
    desc.className = 'pack-desc';
    desc.textContent = pack.description || '';
    card.appendChild(desc);

    if (pack.whenToUse) {
      const when = document.createElement('div');
      when.className = 'pack-meta';
      when.style.color = 'var(--accent-cyan)';
      when.textContent = `🎯 Trigger: ${pack.whenToUse}`;
      card.appendChild(when);
    }

    if (Array.isArray(pack.tags) && pack.tags.length > 0) {
      const tagRow = document.createElement('div');
      tagRow.style.cssText = 'display: flex; gap: 4px; flex-wrap: wrap; margin-top: 2px;';
      pack.tags.forEach(t => {
        const tag = document.createElement('span');
        tag.style.cssText = 'font-size: 9px; padding: 1px 5px; border-radius: 3px; background: rgba(255,255,255,0.06); color: var(--text-muted);';
        tag.textContent = `#${t}`;
        tagRow.appendChild(tag);
      });
      card.appendChild(tagRow);
    }

    container.appendChild(card);
  }
}

async function importSkill() {
  const path = await pickFolder();
  if (!path) return;
  try {
    let res;
    try {
      res = await invoke('skills_import_local_folder', { path });
    } catch (_) {
      res = await invoke('install_skill_from_folder', { path });
    }
    if (res && res.success !== false) {
      await refreshSkills();
      await renderSkillsPanel();
      showToast('✓ Skill imported — opened in documentation view', 'success', 3000);
      import('../editor/monaco.js').then(m => m.openSkillDocTab(res));
    } else {
      showToast(`Import failed: ${res?.error || 'unknown error'}`, 'error', 4000);
    }
  } catch (e) {
    showToast(`${e}`, 'error', 6000);
  }
}

export function getInstalledSkills() {
  return skillsCache || [];
}

/**
 * Strips YAML frontmatter (`--- ... ---`) from SKILL.md content and returns
 * `{ frontmatter, body }` so viewers and directives never leak raw `---` clutter.
 */
export function parseSkillMarkdown(rawContent = '') {
  const text = String(rawContent || '');
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('---')) {
    return { frontmatter: {}, body: text };
  }
  const rest = trimmed.slice(3);
  const endIdx = rest.indexOf('\n---');
  if (endIdx === -1) {
    return { frontmatter: {}, body: text };
  }
  const fmBlock = rest.slice(0, endIdx);
  const body = rest.slice(endIdx + 4).replace(/^-+\s*/, '').trimStart();

  const frontmatter = {};
  let activeListKey = null;
  let activeList = [];

  const flushList = () => {
    if (activeListKey) {
      frontmatter[activeListKey] = activeList.slice();
      activeListKey = null;
      activeList = [];
    }
  };

  for (const rawLine of fmBlock.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('- ') || line.startsWith('-\t')) {
      const val = line.slice(2).trim().replace(/^["']|["']$/g, '');
      if (val && activeListKey) activeList.push(val);
      continue;
    }
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      flushList();
      const key = line.slice(0, colonIdx).trim();
      const rawVal = line.slice(colonIdx + 1).trim();
      if (!rawVal) {
        activeListKey = key;
      } else if (rawVal.startsWith('[') && rawVal.endsWith(']')) {
        frontmatter[key] = rawVal
          .slice(1, -1)
          .split(',')
          .map(s => s.trim().replace(/^["']|["']$/g, ''))
          .filter(Boolean);
      } else {
        frontmatter[key] = rawVal.replace(/^["']|["']$/g, '');
      }
    }
  }
  flushList();

  return { frontmatter, body };
}

function globMatchesPath(globPattern, filePath) {
  if (!globPattern || !filePath) return false;
  const normPath = String(filePath).replace(/\\/g, '/');
  const normGlob = String(globPattern).trim().replace(/\\/g, '/');
  if (!normGlob) return false;
  const regexStr = normGlob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '(?:.*/)?')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '.');
  try {
    return new RegExp(`^${regexStr}$`, 'i').test(normPath) || new RegExp(`${regexStr}$`, 'i').test(normPath);
  } catch {
    return false;
  }
}

/**
 * Resolves triggered, glob-matched, or explicitly invoked skills and returns
 * high-priority `[ACTIVE SKILL DIRECTIVE]` blocks for the LLM system prompt.
 */
export async function resolveActiveSkillDirectives(promptText = '', activeFilePath = '', explicitSkillIds = []) {
  if (!skillsCache || skillsCache.length === 0) {
    await refreshSkills();
  }
  const enabled = (skillsCache || []).filter(s => s.enabled);
  if (enabled.length === 0) return '';

  const lowerPrompt = String(promptText || '').toLowerCase();
  const explicitSet = new Set((explicitSkillIds || []).map(id => String(id).toLowerCase()));

  // Also detect inline @skill:<id> mentions
  const inlineMatches = String(promptText || '').match(/@skill:([a-zA-Z0-9_-]+)/gi) || [];
  for (const m of inlineMatches) {
    explicitSet.add(m.slice(7).toLowerCase());
  }

  const scored = [];
  for (const skill of enabled) {
    const idLower = String(skill.id || '').toLowerCase();
    const nameLower = String(skill.name || '').toLowerCase();
    const isExplicit = explicitSet.has(idLower) || explicitSet.has(nameLower);

    const triggers = Array.isArray(skill.triggers) ? skill.triggers : [];
    const triggerHit = triggers.some(t => t && lowerPrompt.includes(String(t).toLowerCase()));

    const globs = Array.isArray(skill.globs) ? skill.globs : [];
    const globHit = activeFilePath ? globs.some(g => globMatchesPath(g, activeFilePath)) : false;

    if (isExplicit || triggerHit || globHit) {
      const priority = Number(skill.priority) || 50;
      scored.push({
        skill,
        isExplicit,
        score: (isExplicit ? 1000 : 0) + (triggerHit ? 200 : 0) + (globHit ? 100 : 0) + priority,
      });
    }
  }

  if (scored.length === 0) return '';
  scored.sort((a, b) => b.score - a.score);

  // Keep all explicit skills + up to 2 auto-matched skills to avoid context bloat
  const selected = [];
  let autoCount = 0;
  for (const entry of scored) {
    if (entry.isExplicit) {
      selected.push(entry.skill);
    } else if (autoCount < 2) {
      selected.push(entry.skill);
      autoCount++;
    }
  }

  const blocks = [];
  for (const skill of selected) {
    try {
      const res = await invoke('read_skill', { id: skill.id });
      const rawContent = res?.content || '';
      const { body } = parseSkillMarkdown(rawContent);
      if (!body.trim()) continue;
      const toolsList = Array.isArray(skill.allowedTools) && skill.allowedTools.length > 0
        ? skill.allowedTools.join(', ')
        : 'All workspace tools';
      blocks.push(
        `\n\n## [ACTIVE SKILL DIRECTIVE: ${skill.name} (v${skill.version || '1.0.0'})]\n` +
        `- Scope: ${skill.scope || 'global'} | Priority: ${skill.priority || 50} | Allowed Tools: ${toolsList}\n` +
        `- STRICT EXECUTION REQUIREMENT: Follow every step, constraint, and verification rule below before concluding.\n\n` +
        body.trim()
      );
    } catch (e) {
      console.warn(`[resolveActiveSkillDirectives] Failed to read skill ${skill.id}:`, e);
    }
  }

  return blocks.join('\n');
}

/**
 * Enabled-skill digest for local-model system prompts (called by agent.js).
 * Formats a lightweight index digest (< 300 tokens) so models like Qwen or Llama
 * know which skills exist without context bloat or compaction thrashing.
 */
export function getSkillsDigest() {
  const enabled = (skillsCache || []).filter(s => s.enabled);
  if (enabled.length === 0) return '';

  const lines = enabled.map(s => {
    const scopeTag = s.scope === 'workspace' ? '[workspace]' : '[global]';
    const trig = s.whenToUse ? ` — trigger: ${s.whenToUse}` : '';
    const desc = String(s.description || '').slice(0, 120);
    return `• ${scopeTag} ${s.name} (${s.id})${trig}: ${desc}`;
  });

  return `\n\n## MODULAR SKILLS & AGENT RULES INDEX:
${lines.join('\n')}
DEEP MODULAR EXECUTION DIRECTIVE:
When the user's task matches any skill domain above, YOU MUST CALL \`read_skill(name="<skill-name>")\` first to fetch its exact instructions, tool constraints, and output format before making mutations.`;
}

