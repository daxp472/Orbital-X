// ==========================================================================
// Orbital X — Extensions Manager Component (extensions.js)
// ==========================================================================

const EXTENSIONS_CATALOG = [
  {
    id: 'rust-analyzer',
    name: 'Rust Analyzer',
    author: 'rust-lang',
    desc: 'Rust language support, type hints, syntax checking and navigation.',
    installed: true,
    version: 'v0.4.21',
  },
  {
    id: 'python-tools',
    name: 'Python IntelliSense',
    author: 'Orbital Team',
    desc: 'Rich support for Python, syntax highlighting, pylint, and pytest runner.',
    installed: true,
    version: 'v2026.1',
  },
  {
    id: 'prettier-formatter',
    name: 'Prettier — Code Formatter',
    author: 'Prettier',
    desc: 'Opinionated code formatter for JS, TS, HTML, CSS, JSON, and Markdown.',
    installed: true,
    version: 'v3.4.0',
  },
  {
    id: 'gitlens',
    name: 'GitLens — Git Supercharged',
    author: 'GitKraken',
    desc: 'Supercharge Git within Orbital X. Visualize code authorship and history.',
    installed: false,
    version: 'v15.2.0',
  },
  {
    id: 'tailwind-css',
    name: 'Tailwind CSS IntelliSense',
    author: 'Tailwind Labs',
    desc: 'Intelligent Tailwind CSS tooling including autocomplete and linting.',
    installed: false,
    version: 'v0.11.3',
  },
  {
    id: 'docker-tools',
    name: 'Docker Tools',
    author: 'Docker Inc',
    desc: 'Easily build, manage, and deploy containerized applications from the IDE.',
    installed: false,
    version: 'v1.29.0',
  },
];

export function initExtensions() {
  const container = document.getElementById('extensions-list-container');
  const searchInput = document.getElementById('extensions-search-input');

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      renderExtensionsList(e.target.value.toLowerCase());
    });
  }

  renderExtensionsList('');
}

export function renderExtensionsList(query = '') {
  const container = document.getElementById('extensions-list-container');
  if (!container) return;

  container.innerHTML = '';

  const filtered = EXTENSIONS_CATALOG.filter(ext =>
    ext.name.toLowerCase().includes(query) || ext.desc.toLowerCase().includes(query)
  );

  if (filtered.length === 0) {
    container.innerHTML = '<div style="color: var(--text-muted); font-size: 11px; padding: 12px; text-align: center;">No extensions found.</div>';
    return;
  }

  filtered.forEach(ext => {
    const card = document.createElement('div');
    card.style.cssText = `
      padding: 8px 10px;
      border-radius: 6px;
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      display: flex;
      flex-direction: column;
      gap: 4px;
    `;

    card.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: flex-start;">
        <div>
          <strong style="color: var(--text-primary-bright); font-size: 12px;">${ext.name}</strong>
          <div style="font-size: 10px; color: var(--text-muted);">${ext.author} • ${ext.version}</div>
        </div>
        <button class="btn btn-sm ${ext.installed ? 'btn-secondary' : 'btn-primary'}" id="btn-ext-${ext.id}" style="font-size: 10px; padding: 2px 6px;">
          ${ext.installed ? 'Installed' : 'Install'}
        </button>
      </div>
      <div style="font-size: 11px; color: var(--text-secondary); line-height: 1.3;">${ext.desc}</div>
    `;

    card.querySelector(`#btn-ext-${ext.id}`)?.addEventListener('click', (e) => {
      const btn = e.target;
      ext.installed = !ext.installed;
      if (ext.installed) {
        btn.className = 'btn btn-sm btn-secondary';
        btn.textContent = 'Installed';
        alert(`Extension "${ext.name}" is now enabled.`);
      } else {
        btn.className = 'btn btn-sm btn-primary';
        btn.textContent = 'Install';
      }
    });

    container.appendChild(card);
  });
}
