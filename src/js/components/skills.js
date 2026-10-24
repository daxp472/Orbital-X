// ==========================================================================
// Orbital X — Skills Panel (skills.js)
//
// Claude Code-style instruction packs. Skills never execute code: they are
// guidance the agent discovers (system-prompt digest) and reads on demand
// via the list_skills / read_skill tools, gated by the existing permission
// system. This panel handles browsing, importing, enable/disable, and review.
// ==========================================================================

import { invoke, pickFolder } from '../services/tauri.js';
import { showToast } from '../services/notifications.js';

let skillsCache = [];

export async function initSkills() {
  await refreshSkills();
  wirePanel();
}

async function refreshSkills() {
  try {
    skillsCache = await invoke('list_skills');
  } catch (e) {
    skillsCache = [];
  }
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function wirePanel() {
  const importBtn = document.getElementById('btn-import-skill');
  if (importBtn && !importBtn.dataset.wired) {
    importBtn.dataset.wired = '1';
    importBtn.addEventListener('click', importSkill);
  }
}

export async function renderSkillsPanel() {
  await refreshSkills();
  wirePanel();

  const container = document.getElementById('skills-list-container');
  if (!container) return;
  container.innerHTML = '';

  if (!skillsCache || skillsCache.length === 0) {
    container.innerHTML = `<div class="pack-empty">
      No skills installed yet.<br>
      Skills are reusable instruction packs (a folder with a <strong>SKILL.md</strong>) the agent
      discovers and reads when a task matches.<br>
      Import one from a folder to get started.
    </div>`;
    return;
  }

  for (const skill of skillsCache) {
    const card = document.createElement('div');
    card.className = 'pack-card';

    const titleRow = document.createElement('div');
    titleRow.className = 'pack-title-row';

    const name = document.createElement('span');
    name.className = 'pack-name';
    name.textContent = skill.name || skill.id;

    const actions = document.createElement('div');
    actions.className = 'pack-actions';
    actions.style.marginLeft = 'auto';

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

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-danger btn-sm';
    deleteBtn.style.cssText = 'padding: 1px 8px; font-size: 10px;';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', async () => {
      if (!confirm(`Delete skill "${skill.name}"? The agent will no longer see it.`)) return;
      try {
        await invoke('delete_skill', { id: skill.id });
        await renderSkillsPanel();
        showToast(`Deleted skill "${skill.name}"`, 'success', 2500);
      } catch (e) {
        showToast(`Delete failed: ${e}`, 'error');
      }
    });

    actions.append(toggle, viewBtn, deleteBtn);
    titleRow.append(name, actions);
    card.appendChild(titleRow);

    const desc = document.createElement('div');
    desc.className = 'pack-desc';
    desc.textContent = skill.description || '(no description)';
    card.appendChild(desc);

    if (skill.whenToUse) {
      const when = document.createElement('div');
      when.className = 'pack-meta';
      when.textContent = `When to use: ${skill.whenToUse}`;
      card.appendChild(when);
    }

    const metaLine = document.createElement('div');
    metaLine.className = 'pack-meta';
    metaLine.textContent = `${skill.enabled ? 'enabled' : 'disabled'} · ${((skill.bodyChars || 0) / 1000).toFixed(1)} KB of instructions`;
    card.appendChild(metaLine);

    // Expandable full body review
    const body = document.createElement('div');
    body.className = 'pack-detail';
    body.style.display = 'none';
    body.textContent = 'Loading…';
    viewBtn.addEventListener('click', async () => {
      if (body.style.display !== 'none') {
        body.style.display = 'none';
        viewBtn.textContent = 'View';
        return;
      }
      body.style.display = 'block';
      viewBtn.textContent = 'Hide';
      try {
        const res = await invoke('read_skill', { id: skill.id });
        body.textContent = res.content || '(empty)';
      } catch (e) {
        body.textContent = `Could not read skill: ${e}`;
      }
    });
    card.appendChild(body);

    container.appendChild(card);
  }
}

async function importSkill() {
  const path = await pickFolder();
  if (!path) return;
  try {
    const res = await invoke('install_skill_from_folder', { path });
    if (res && res.success !== false) {
      await renderSkillsPanel();
      showToast('Skill imported — the agent can discover it now', 'success', 3000);
    } else {
      showToast(`Import failed: ${res?.error || 'unknown error'}`, 'error', 4000);
    }
  } catch (e) {
    showToast(`${e}`, 'error', 6000);
  }
}

/** Enabled-skill digest for the agent system prompt (called by agent.js). */
export function getSkillsDigest() {
  const enabled = (skillsCache || []).filter(s => s.enabled).slice(0, 10);
  if (enabled.length === 0) return '';
  const lines = enabled.map(s =>
    `• ${s.name}${s.whenToUse ? ` — use when: ${s.whenToUse}` : ''}: ${String(s.description || '').slice(0, 140)}`
  );
  return `\n\n## Installed skills (instruction packs):\n${lines.join('\n')}\nWhen a task matches a skill, call read_skill(name) first and follow its guidance.`;
}
