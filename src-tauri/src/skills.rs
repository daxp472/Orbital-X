// ==========================================================================
// Orbital X — Skill Service (skills.rs)
//
// Skills are Claude Code-style instruction packs: a folder containing SKILL.md
// with YAML frontmatter (name, description, whenToUse, tags) and markdown body.
//
// Discovery scans:
//   1. <workspace>/agent.md (or <workspace>/.orbital/agent.md)
//   2. <workspace>/.orbital/skills/*/SKILL.md
//   3. Global ~/.orbital/skills/*/SKILL.md (or portable ./Data/skills/*/SKILL.md)
//
// Skills never execute code directly: they provide guidance the agent discovers
// via a lightweight digest in the system prompt and reads on demand via the
// read_skill tool.
// ==========================================================================

use serde::Serialize;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

pub struct SkillService;

fn base_orbital_dir() -> PathBuf {
    if let Ok(p) = std::env::var("ORBITAL_HOME") {
        if !p.trim().is_empty() {
            return PathBuf::from(p);
        }
    }
    crate::portable::orbital_data_dir()
}

fn skills_dir() -> PathBuf {
    let dir = base_orbital_dir().join("skills");
    let _ = fs::create_dir_all(&dir);
    dir
}

fn state_path() -> PathBuf {
    let dir = base_orbital_dir();
    let _ = fs::create_dir_all(&dir);
    dir.join("skills_state.json")
}

fn load_state() -> serde_json::Map<String, Value> {
    if let Ok(bytes) = fs::read(state_path()) {
        if let Ok(Value::Object(map)) = serde_json::from_slice::<Value>(&bytes) {
            return map;
        }
    }
    serde_json::Map::new()
}

fn save_state(state: &serde_json::Map<String, Value>) {
    if let Ok(serialized) = serde_json::to_string_pretty(state) {
        let _ = fs::write(state_path(), serialized);
    }
}

/// Parses simple `key: value` frontmatter lines between two `---` markers.
pub fn parse_skill_md(content: &str) -> Option<(Vec<(String, String)>, String)> {
    let trimmed = content.trim_start();
    let rest = trimmed.strip_prefix("---")?;
    let end = rest.find("\n---")?;
    let frontmatter = &rest[..end];
    let body = rest[end + 4..].trim_start_matches('-').trim_start().to_string();

    let mut fields = Vec::new();
    for line in frontmatter.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some(idx) = line.find(':') {
            let key = line[..idx].trim().to_string();
            let value = line[idx + 1..].trim().trim_matches('"').trim_matches('\'').to_string();
            if !key.is_empty() {
                fields.push((key, value));
            }
        }
    }
    Some((fields, body))
}

fn load_skill_entry(dir: &Path, scope: &str) -> Option<Value> {
    let skill_path = dir.join("SKILL.md");
    let content = fs::read_to_string(&skill_path).ok()?;
    let (fields, _body) = parse_skill_md(&content)?;
    let get = |key: &str| -> Option<String> {
        fields
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(key))
            .map(|(_, v)| v.clone())
            .filter(|v| !v.is_empty())
    };

    let name = get("name")?;
    let description = get("description").unwrap_or_default();
    let when_to_use = get("whenToUse");
    let tags_str = get("tags").unwrap_or_default();
    let tags: Vec<String> = tags_str
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    let id = dir.file_name()?.to_string_lossy().to_string();
    let state = load_state();
    let enabled = match state.get(&id) {
        Some(Value::Bool(b)) => *b,
        _ => true,
    };

    Some(json!({
        "id": id,
        "name": name,
        "description": description,
        "whenToUse": when_to_use,
        "tags": tags,
        "scope": scope,
        "enabled": enabled,
        "bodyChars": content.len(),
        "path": skill_path.to_string_lossy(),
    }))
}

/// Discovers workspace-level `agent.md` (or `.orbital/agent.md`) instructions.
fn load_agent_md_entry(workspace_root: &Path) -> Option<Value> {
    let candidates = [
        workspace_root.join("agent.md"),
        workspace_root.join(".orbital").join("agent.md"),
    ];

    for candidate in candidates {
        if candidate.is_file() {
            if let Ok(content) = fs::read_to_string(&candidate) {
                if !content.trim().is_empty() {
                    let mut name = "Workspace Rules (agent.md)".to_string();
                    let mut description = "Project-specific rules and instructions defined in agent.md".to_string();
                    let mut when_to_use = Some("Always active in this workspace".to_string());
                    let mut tags = vec!["workspace".into(), "rules".into(), "guidelines".into()];

                    if let Some((fields, _)) = parse_skill_md(&content) {
                        for (k, v) in fields {
                            match k.to_lowercase().as_str() {
                                "name" if !v.is_empty() => name = v,
                                "description" if !v.is_empty() => description = v,
                                "whentouse" if !v.is_empty() => when_to_use = Some(v),
                                "tags" if !v.is_empty() => {
                                    tags = v.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
                                }
                                _ => {}
                            }
                        }
                    }

                    return Some(json!({
                        "id": "workspace-agent-instructions",
                        "name": name,
                        "description": description,
                        "whenToUse": when_to_use,
                        "tags": tags,
                        "scope": "workspace",
                        "enabled": true,
                        "bodyChars": content.len(),
                        "path": candidate.to_string_lossy(),
                    }));
                }
            }
        }
    }
    None
}

#[derive(Debug, Clone, Serialize)]
pub struct CommunitySkillPack {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub when_to_use: &'static str,
    pub tags: &'static [&'static str],
    pub author: &'static str,
    pub body: &'static str,
}

const COMMUNITY_PACKS: &[CommunitySkillPack] = &[
    CommunitySkillPack {
        id: "tdd-workflow",
        name: "Test-Driven Development (TDD)",
        description: "Enforces strict test-first development cycles, red-green-refactor steps, and automated verification before completion.",
        when_to_use: "Writing new features, fixing bugs, or refactoring business logic",
        tags: &["testing", "quality", "tdd", "verification"],
        author: "Orbital X Core",
        body: "# Test-Driven Development (TDD) Workflow\n\n## Core Invariants\n1. Write failing tests before any implementation code.\n2. Confirm the test fails for the expected reason.\n3. Write the minimal code necessary to make the test pass.\n4. Run the full test suite and confirm 100% green.\n5. Refactor with tests as your safety net.\n\n## Verification Commands\n- Rust: `cargo test`\n- Node: `npm test`\n- Python: `pytest`\nNever mark a task complete without passing test evidence.",
    },
    CommunitySkillPack {
        id: "rust-strict-architect",
        name: "Rust Strict Architect",
        description: "Senior Rust systems architect enforcing idiomatic ownership, zero-allocation data paths, concurrency invariants, and strict type safety.",
        when_to_use: "Designing, reviewing, or refactoring Rust crates, async runtimes, or low-level systems",
        tags: &["rust", "systems", "architecture", "performance"],
        author: "Community",
        body: "# Rust Strict Systems Architecture\n\n## Directives\n1. Enforce zero-allocation idioms in hot loops (borrow slices `&[T]` / `&str`).\n2. Avoid unwraps; propagate errors using `Result<T, E>` with context.\n3. Check clippy lints and test thread-safety with Send + Sync invariants.\n4. Minimize external crate dependencies to avoid bloat.",
    },
    CommunitySkillPack {
        id: "react-nextjs-craft",
        name: "React & Next.js Craft",
        description: "Modern production React 19 and Next.js App Router patterns, Server Actions, suspense boundaries, and accessible state management.",
        when_to_use: "Building, refactoring, or optimizing React and Next.js applications",
        tags: &["react", "nextjs", "frontend", "typescript"],
        author: "Community",
        body: "# React & Next.js Craft Guide\n\n## Key Architectural Rules\n1. Prefer React Server Components for data fetching; use `'use client'` only where interactivity is required.\n2. Co-locate state with consuming components; avoid premature global stores.\n3. Design responsive interfaces with zero layout shift.\n4. Verify build with `npm run build`.",
    },
    CommunitySkillPack {
        id: "fastapi-pro",
        name: "Python FastAPI Pro",
        description: "High-performance async Python with FastAPI, Pydantic v2 schemas, SQLAlchemy 2.0 ORM, and dependency injection.",
        when_to_use: "Building Python APIs, microservices, or backend services",
        tags: &["python", "fastapi", "backend", "pydantic"],
        author: "Community",
        body: "# Python FastAPI Pro Architecture\n\n## Principles\n1. Use async handlers for I/O-bound database or HTTP calls.\n2. Define strict Pydantic v2 schemas for all requests and responses.\n3. Leverage FastAPI dependencies for authentication and database sessions.\n4. Test endpoints with `pytest` and `httpx.AsyncClient`.",
    },
    CommunitySkillPack {
        id: "security-auditor",
        name: "Security & Penetration Auditor",
        description: "Rigorous static and dynamic security auditing, OWASP Top 10 prevention, path traversal defense, and safe cryptographic defaults.",
        when_to_use: "Auditing codebases for vulnerabilities, inspecting IPC boundaries, or sanitizing inputs",
        tags: &["security", "audit", "owasp", "hardening"],
        author: "Community",
        body: "# Security & Penetration Audit Guide\n\n## Invariants\n1. Never allow path traversal: sanitize slugs and validate filesystem boundaries.\n2. Reject shell injection: execute processes with direct argument vectors, never `sh -c` / `eval`.\n3. Verify all IPC boundaries require explicit permission checks.",
    },
    CommunitySkillPack {
        id: "unit-test-generator",
        name: "Unit Test Generator",
        description: "Automated generation of deterministic, edge-case-focused unit tests with high boundary coverage and zero flaky mocks.",
        when_to_use: "Generating unit tests, improving test coverage, or testing edge cases",
        tags: &["testing", "unit-tests", "coverage", "quality"],
        author: "Community",
        body: "# Unit Test Generation Rules\n\n## Directives\n1. Cover normal paths, error cases, and edge boundary conditions.\n2. Keep tests deterministic, fast, and isolated.\n3. Assert on specific values and invariants rather than vague truths.",
    },
    CommunitySkillPack {
        id: "rust-expert",
        name: "Rust Systems Expert",
        description: "Modern idiomatic Rust, zero-cost abstractions, lifetime management, clippy guidelines, and concurrency safety.",
        when_to_use: "Writing, auditing, or optimizing Rust code and Cargo manifests",
        tags: &["rust", "systems", "performance", "cargo"],
        author: "Orbital X Core",
        body: "# Rust Systems Engineering Guidelines\n\n## Key Directives\n1. Use standard error handling: `Result<T, String>` or `anyhow::Result`.\n2. Prefer borrowing `&str` and `&[T]` over `String` or `Vec<T>` in function signatures.\n3. Always run `cargo check` and `cargo test` after mutations.\n4. Resolve any clippy warnings and avoid unnecessary `unsafe` blocks.\n5. Keep dependencies lean and prioritize `std` where feasible.",
    },
    CommunitySkillPack {
        id: "typescript-react",
        name: "React & TypeScript Architect",
        description: "Strict TypeScript type systems, modern React 19 functional hooks, state isolation, and UI performance patterns.",
        when_to_use: "Developing or refactoring React, Next.js, or TypeScript frontends",
        tags: &["react", "typescript", "frontend", "hooks"],
        author: "Orbital X Core",
        body: "# React & TypeScript Architecture Guide\n\n## Best Practices\n1. Use strict TypeScript interfaces and avoid `any`.\n2. Keep state local and minimal; derive values during render instead of syncing in useEffect.\n3. Use functional components with hooks exclusively.\n4. Ensure cleanup in effects that subscribe to listeners or timers.\n5. Verify build with `npm run build` or `npx tsc --noEmit`.",
    },
    CommunitySkillPack {
        id: "apple-design",
        name: "Apple HIG & Clean UI Design",
        description: "Human Interface Guidelines compliance, refined spacing, typography hierarchies, and fluid non-generic aesthetics.",
        when_to_use: "Reviewing UI layouts, designing panels, styling components, or improving visual hierarchy",
        tags: &["design", "apple-hig", "css", "ui"],
        author: "Orbital X Core",
        body: "# Apple HIG & Clean UI Design Rules\n\n## Design Craft Lens\n1. Generous padding, crisp micro-borders (`1px solid rgba(255,255,255,0.08)`), and subtle blur effects.\n2. Typography: SF Pro / Inter fonts with deliberate hierarchy (title, headline, subhead, caption).\n3. Avoid clutter: hide secondary pills on narrow widths and keep primary actions prominent.\n4. High contrast interactive states with smooth hover and active transitions.\n5. Dark and light theme parity across all cards and controls.",
    },
    CommunitySkillPack {
        id: "conventional-commits",
        name: "Git & Conventional Commits",
        description: "Clean atomic git commits following the Conventional Commits specification (feat, fix, refactor, chore).",
        when_to_use: "Staging commits, preparing PRs, or managing git branches",
        tags: &["git", "workflow", "productivity", "commits"],
        author: "Orbital X Core",
        body: "# Git & Conventional Commits Guide\n\n## Format\n`<type>(<scope>): <short description in present tense>`\n\n## Types\n- `feat`: A new feature\n- `fix`: A bug fix\n- `refactor`: Code change that neither fixes a bug nor adds a feature\n- `test`: Adding or modifying tests\n- `docs`: Documentation changes\n- `chore`: Build system or dependency updates\n\nKeep commits atomic: one logical change per commit.",
    },
    CommunitySkillPack {
        id: "systematic-debugging",
        name: "Systematic Debugger",
        description: "Hypothesis-driven root-cause analysis, minimal reproducible cases, and surgical non-breaking fixes.",
        when_to_use: "Investigating runtime errors, test failures, or subtle logic regressions",
        tags: &["debugging", "analysis", "reliability", "troubleshooting"],
        author: "Orbital X Core",
        body: "# Systematic Debugging Methodology\n\n## 4-Step Root Cause Investigation\n1. **Reproduce**: Capture exact error output, stack trace, and reproduction steps.\n2. **Isolate**: Formulate a falsifiable hypothesis and verify the minimal failing condition.\n3. **Surgically Fix**: Address the underlying fault directly without superficial workarounds.\n4. **Verify**: Re-run the reproduction test and the entire test suite to guarantee zero regression.",
    },
];

impl SkillService {
    /// Lists all skills discovered across:
    ///   - Workspace agent.md (if workspace_root is provided)
    ///   - Workspace .orbital/skills/*/SKILL.md
    ///   - Global ~/.orbital/skills/*/SKILL.md
    pub fn list(workspace_root: Option<&Path>) -> Vec<Value> {
        let mut out = Vec::new();

        // 1. Scan workspace agent.md
        if let Some(root) = workspace_root {
            if let Some(agent_entry) = load_agent_md_entry(root) {
                out.push(agent_entry);
            }

            // 2. Scan workspace .orbital/skills/*/SKILL.md
            let ws_skills_dir = root.join(".orbital").join("skills");
            if let Ok(entries) = fs::read_dir(&ws_skills_dir) {
                for entry in entries.filter_map(|e| e.ok()) {
                    if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                        if let Some(skill) = load_skill_entry(&entry.path(), "workspace") {
                            out.push(skill);
                        }
                    }
                }
            }
        }

        // 3. Scan global skills
        if let Ok(entries) = fs::read_dir(skills_dir()) {
            for entry in entries.filter_map(|e| e.ok()) {
                if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    if let Some(skill) = load_skill_entry(&entry.path(), "global") {
                        // Prevent duplicates if workspace overrides a global skill
                        let skill_id = skill["id"].as_str().unwrap_or_default();
                        if !out.iter().any(|s| s["id"] == skill_id) {
                            out.push(skill);
                        }
                    }
                }
            }
        }

        // Sort: workspace skills first, then alphabetical by name
        out.sort_by(|a, b| {
            let a_scope = a.get("scope").and_then(|v| v.as_str()).unwrap_or("global");
            let b_scope = b.get("scope").and_then(|v| v.as_str()).unwrap_or("global");
            if a_scope != b_scope {
                if a_scope == "workspace" {
                    return std::cmp::Ordering::Less;
                } else {
                    return std::cmp::Ordering::Greater;
                }
            }
            let a_name = a.get("name").and_then(|v| v.as_str()).unwrap_or_default().to_lowercase();
            let b_name = b.get("name").and_then(|v| v.as_str()).unwrap_or_default().to_lowercase();
            a_name.cmp(&b_name)
        });

        out
    }

    /// Returns the full SKILL.md or agent.md body for the agent to read.
    pub fn read(identifier: &str, workspace_root: Option<&Path>) -> Result<Value, String> {
        let ident = identifier.trim();
        if ident.is_empty() {
            return Err("read_skill requires a skill name or id".into());
        }

        // 1. Check if reading workspace agent.md
        if ident.eq_ignore_ascii_case("agent.md")
            || ident.eq_ignore_ascii_case("workspace-agent-instructions")
            || ident.eq_ignore_ascii_case("Workspace Rules (agent.md)")
        {
            if let Some(root) = workspace_root {
                let candidates = [
                    root.join("agent.md"),
                    root.join(".orbital").join("agent.md"),
                ];
                for candidate in candidates {
                    if candidate.is_file() {
                        let content = fs::read_to_string(&candidate).map_err(|e| e.to_string())?;
                        return Ok(json!({
                            "skill": "Workspace Rules (agent.md)",
                            "content": content,
                            "chars": content.len(),
                            "scope": "workspace"
                        }));
                    }
                }
            }
        }

        // 2. Check workspace-level skills
        if let Some(root) = workspace_root {
            let ws_skills = root.join(".orbital").join("skills");
            if let Some(skill) = load_skill_entry(&ws_skills.join(ident), "workspace") {
                let content = fs::read_to_string(ws_skills.join(ident).join("SKILL.md"))
                    .map_err(|e| e.to_string())?;
                return Ok(json!({
                    "skill": skill["name"],
                    "content": content,
                    "chars": content.len(),
                    "scope": "workspace"
                }));
            }
        }

        // 3. Check global skills by folder id
        if let Some(skill) = load_skill_entry(&skills_dir().join(ident), "global") {
            let content = fs::read_to_string(skills_dir().join(ident).join("SKILL.md"))
                .map_err(|e| e.to_string())?;
            return Ok(json!({
                "skill": skill["name"],
                "content": content,
                "chars": content.len(),
                "scope": "global"
            }));
        }

        // 4. Name-based lookup across all listed skills
        for skill in Self::list(workspace_root) {
            let skill_name = skill.get("name").and_then(|v| v.as_str()).unwrap_or_default();
            let skill_id = skill.get("id").and_then(|v| v.as_str()).unwrap_or_default();
            let skill_path_str = skill.get("path").and_then(|v| v.as_str());

            if skill_name.eq_ignore_ascii_case(ident) || skill_id.eq_ignore_ascii_case(ident) {
                if let Some(p) = skill_path_str {
                    if let Ok(content) = fs::read_to_string(p) {
                        return Ok(json!({
                            "skill": skill_name,
                            "content": content,
                            "chars": content.len(),
                            "scope": skill.get("scope").and_then(|v| v.as_str()).unwrap_or("global")
                        }));
                    }
                }
            }
        }

        Err(format!("Skill '{}' not found. Call list_skills to see installed skills.", ident))
    }

    /// Returns curated Community Skills Catalog.
    pub fn community_catalog() -> Vec<Value> {
        let state = load_state();
        COMMUNITY_PACKS
            .iter()
            .map(|pack| {
                let is_installed = skills_dir().join(pack.id).exists();
                let enabled = match state.get(pack.id) {
                    Some(Value::Bool(b)) => *b,
                    _ => true,
                };
                json!({
                    "id": pack.id,
                    "name": pack.name,
                    "description": pack.description,
                    "whenToUse": pack.when_to_use,
                    "tags": pack.tags,
                    "author": pack.author,
                    "body": pack.body,
                    "installed": is_installed,
                    "enabled": enabled,
                })
            })
            .collect()
    }

    /// 1-click installs a community skill pack into global ~/.orbital/skills/.
    pub fn install_community_pack(pack_id: &str) -> Result<Value, String> {
        let clean_id = pack_id.trim();
        let pack = COMMUNITY_PACKS
            .iter()
            .find(|p| p.id.eq_ignore_ascii_case(clean_id))
            .ok_or_else(|| format!("Community skill pack '{}' not found in catalog", clean_id))?;

        let dest = skills_dir().join(pack.id);
        fs::create_dir_all(&dest).map_err(|e| e.to_string())?;

        let tags_joined = pack.tags.join(", ");
        let content = format!(
            "---\nname: {}\ndescription: \"{}\"\nwhenToUse: \"{}\"\ntags: {}\nauthor: {}\n---\n\n{}\n",
            pack.name, pack.description, pack.when_to_use, tags_joined, pack.author, pack.body
        );

        fs::write(dest.join("SKILL.md"), content).map_err(|e| e.to_string())?;

        let mut state = load_state();
        state.insert(pack.id.to_string(), Value::Bool(true));
        save_state(&state);

        Ok(json!({
            "success": true,
            "id": pack.id,
            "name": pack.name,
            "installed": true
        }))
    }

    /// Creates a custom skill in either global ~/.orbital/skills/ or workspace .orbital/skills/.
    pub fn create_custom_skill(
        id: &str,
        name: &str,
        description: &str,
        when_to_use: &str,
        body: &str,
        is_workspace: bool,
        workspace_root: Option<&Path>,
    ) -> Result<Value, String> {
        let clean_id: String = id
            .trim()
            .to_lowercase()
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
            .collect();

        if clean_id.is_empty() {
            return Err("Skill ID must contain valid alphanumeric characters, dashes, or underscores.".into());
        }
        if name.trim().is_empty() {
            return Err("Skill Name cannot be empty.".into());
        }

        let target_dir = if is_workspace {
            let root = workspace_root.ok_or("No workspace is currently open to save a workspace skill.")?;
            root.join(".orbital").join("skills").join(&clean_id)
        } else {
            skills_dir().join(&clean_id)
        };

        fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;

        let content = format!(
            "---\nname: {}\ndescription: \"{}\"\nwhenToUse: \"{}\"\n---\n\n{}\n",
            name.trim(),
            description.trim().replace('"', "\\\""),
            when_to_use.trim().replace('"', "\\\""),
            body.trim()
        );

        fs::write(target_dir.join("SKILL.md"), content).map_err(|e| e.to_string())?;

        let mut state = load_state();
        state.insert(clean_id.clone(), Value::Bool(true));
        save_state(&state);

        Ok(json!({
            "success": true,
            "id": clean_id,
            "name": name.trim(),
            "scope": if is_workspace { "workspace" } else { "global" }
        }))
    }

    /// Installs a skill from an existing folder containing SKILL.md.
    pub fn install_from_folder(folder: &str) -> Result<Value, String> {
        let src = PathBuf::from(folder.trim());
        if !src.is_dir() {
            return Err(format!("'{}' is not a folder. Import expects a directory containing SKILL.md.", folder));
        }
        let content = fs::read_to_string(src.join("SKILL.md"))
            .map_err(|_| "No SKILL.md found in the selected folder.".to_string())?;
        let (fields, _) = parse_skill_md(&content)
            .ok_or("SKILL.md is missing frontmatter: start the file with a '---' block containing at least 'name:' and 'description:'")?;
        let has_name = fields.iter().any(|(k, v)| k.eq_ignore_ascii_case("name") && !v.is_empty());
        let has_desc = fields.iter().any(|(k, v)| k.eq_ignore_ascii_case("description") && !v.is_empty());
        if !has_name || !has_desc {
            return Err("SKILL.md frontmatter requires non-empty 'name:' and 'description:'".into());
        }
        if content.len() > 200_000 {
            return Err("SKILL.md exceeds the 200 KB limit".into());
        }

        let id = src.file_name().map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "imported-skill".into());
        let safe_id: String = id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_' || *c == '.').collect();
        if safe_id.is_empty() {
            return Err("Folder name cannot be converted to a valid skill id".into());
        }

        let dest = skills_dir().join(&safe_id);
        if dest.exists() {
            let _ = fs::remove_dir_all(&dest);
        }
        fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
        fs::copy(src.join("SKILL.md"), dest.join("SKILL.md")).map_err(|e| e.to_string())?;
        for entry in fs::read_dir(&src).map_err(|e| e.to_string())?.filter_map(|e| e.ok()) {
            let name = entry.file_name().to_string_lossy().to_lowercase();
            if entry.file_type().map(|t| t.is_file()).unwrap_or(false)
                && (name.ends_with(".md") || name.ends_with(".txt") || name.ends_with(".json"))
                && entry.metadata().map(|m| m.len() < 500_000).unwrap_or(false)
            {
                let _ = fs::copy(entry.path(), dest.join(entry.file_name()));
            }
        }
        Ok(json!({ "success": true, "id": safe_id }))
    }

    pub fn delete(id: &str) -> Result<Value, String> {
        let dir = skills_dir().join(id.trim());
        if !dir.exists() {
            return Ok(json!({ "success": false, "error": format!("Skill '{}' is not installed", id) }));
        }
        fs::remove_dir_all(&dir).map_err(|e| format!("Failed to delete skill: {}", e))?;
        let mut state = load_state();
        state.remove(id.trim());
        save_state(&state);
        Ok(json!({ "success": true, "id": id }))
    }

    pub fn set_enabled(id: &str, enabled: bool) -> Result<Value, String> {
        let dir = skills_dir().join(id.trim());
        if !dir.exists() {
            return Ok(json!({ "success": false, "error": format!("Skill '{}' is not installed", id) }));
        }
        let mut state = load_state();
        state.insert(id.trim().to_string(), Value::Bool(enabled));
        save_state(&state);
        Ok(json!({ "success": true, "id": id, "enabled": enabled }))
    }

    /// Validates a skill slug to prevent directory traversal or unsafe characters.
    pub fn validate_skill_slug(slug: &str) -> Result<String, String> {
        let s = slug.trim().to_lowercase();
        if s.is_empty() {
            return Err("Skill slug cannot be empty.".into());
        }
        if s.contains("..") || s.contains('/') || s.contains('\\') {
            return Err("Path traversal characters not allowed in skill slug.".into());
        }
        let clean: String = s
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
            .collect();
        if clean.is_empty() || clean.len() > 64 {
            return Err("Skill slug must be 1-64 alphanumeric characters, hyphens, or underscores.".into());
        }
        Ok(clean)
    }

    /// Fetches a remote community JSON registry (or defaults to GitHub raw index),
    /// falling back gracefully to the rich offline catalog if offline or on network error.
    pub async fn fetch_community_registry(custom_url: Option<&str>) -> Vec<Value> {
        let registry_url = custom_url
            .filter(|u| !u.trim().is_empty())
            .unwrap_or("https://raw.githubusercontent.com/daxp472/Orbital-X/main/community-skills.json");

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(4))
            .user_agent("OrbitalX-IDE/2.4.5")
            .build();

        if let Ok(client) = client {
            if let Ok(resp) = client.get(registry_url).send().await {
                if resp.status().is_success() {
                    if let Ok(json_arr) = resp.json::<Vec<Value>>().await {
                        if !json_arr.is_empty() {
                            let state = load_state();
                            return json_arr
                                .into_iter()
                                .map(|mut item| {
                                    if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
                                        let is_installed = skills_dir().join(id).exists();
                                        let enabled = match state.get(id) {
                                            Some(Value::Bool(b)) => *b,
                                            _ => true,
                                        };
                                        if let Some(obj) = item.as_object_mut() {
                                            obj.insert("installed".into(), json!(is_installed));
                                            obj.insert("enabled".into(), json!(enabled));
                                        }
                                    }
                                    item
                                })
                                .collect();
                        }
                    }
                }
            }
        }

        // Offline / sandbox fallback: Return the rich built-in catalog
        Self::community_catalog()
    }

    /// Installs a skill from an external URL (e.g. GitHub raw or direct URL to SKILL.md).
    pub async fn install_from_url(url: &str) -> Result<Value, String> {
        let clean_url = url.trim();
        if clean_url.is_empty() {
            return Err("URL cannot be empty.".into());
        }

        // Support github.com/.../blob/... -> raw.githubusercontent.com/.../...
        let fetch_url = if clean_url.contains("github.com") && clean_url.contains("/blob/") {
            clean_url.replace("github.com", "raw.githubusercontent.com").replace("/blob/", "/")
        } else {
            clean_url.to_string()
        };

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(8))
            .user_agent("OrbitalX-IDE/2.4.5")
            .build()
            .map_err(|e| e.to_string())?;

        let resp = client.get(&fetch_url).send().await.map_err(|e| format!("Failed to fetch skill from URL: {}", e))?;
        if !resp.status().is_success() {
            return Err(format!("Server returned HTTP {} when fetching skill.", resp.status()));
        }

        let content = resp.text().await.map_err(|e| format!("Failed to read response body: {}", e))?;
        if content.len() > 300_000 {
            return Err("Remote skill file exceeds 300 KB limit.".into());
        }

        let (fields, _) = parse_skill_md(&content)
            .ok_or("The fetched file has no valid YAML frontmatter (needs '---' block with 'name:' and 'description:').")?;

        let get = |k: &str| -> Option<String> {
            fields.iter().find(|(key, _)| key.eq_ignore_ascii_case(k)).map(|(_, v)| v.clone())
        };

        let name = get("name").ok_or("Frontmatter missing 'name:' field.")?;
        let description = get("description").unwrap_or_default();
        let when_to_use = get("whenToUse").unwrap_or_default();

        // Derive safe slug from frontmatter name or URL
        let candidate_slug = get("id").unwrap_or_else(|| {
            name.to_lowercase().replace(' ', "-")
        });
        let safe_id = Self::validate_skill_slug(&candidate_slug)?;

        let dest = skills_dir().join(&safe_id);
        fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
        fs::write(dest.join("SKILL.md"), &content).map_err(|e| e.to_string())?;

        let mut state = load_state();
        state.insert(safe_id.clone(), Value::Bool(true));
        save_state(&state);

        Ok(json!({
            "success": true,
            "id": safe_id,
            "name": name,
            "description": description,
            "whenToUse": when_to_use,
            "installed": true
        }))
    }

    /// Imports a skill from an existing local folder.
    pub fn import_local_folder(path: &str) -> Result<Value, String> {
        Self::install_from_folder(path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_frontmatter() {
        let md = "---\nname: Rust Expert\ndescription: \"Rust best practices\"\nwhenToUse: writing Rust\n---\n\nAlways run clippy.";
        let (fields, body) = parse_skill_md(md).unwrap();
        assert!(fields.iter().any(|(k, v)| k == "name" && v == "Rust Expert"));
        assert!(fields.iter().any(|(k, v)| k == "description" && v == "Rust best practices"));
        assert!(body.contains("Always run clippy."));
    }

    #[test]
    fn test_missing_frontmatter_rejected_by_install() {
        let tmp = std::env::temp_dir().join(format!("orbital_skill_bad_{}", std::process::id()));
        let _ = fs::create_dir_all(&tmp);
        let _ = fs::write(tmp.join("SKILL.md"), "no frontmatter here");
        let err = SkillService::install_from_folder(tmp.to_string_lossy().as_ref()).unwrap_err();
        assert!(err.contains("frontmatter"));
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_workspace_agent_md_discovery_and_read() {
        let unique_id = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let tmp_ws = std::env::temp_dir().join(format!("orbital_agent_test_{}_{}", std::process::id(), unique_id));
        let _ = fs::create_dir_all(&tmp_ws);
        let agent_md = tmp_ws.join("agent.md");
        let _ = fs::write(
            &agent_md,
            "---\nname: Custom Hospital Rules\ndescription: \"Strict rules for hospital repo\"\nwhenToUse: medical backend tasks\n---\nNever delete patient records.",
        );

        let listed = SkillService::list(Some(&tmp_ws));
        let found = listed.iter().find(|s| s["id"] == "workspace-agent-instructions");
        assert!(found.is_some(), "agent.md should be discovered as a workspace skill");
        let entry = found.unwrap();
        assert_eq!(entry["name"], "Custom Hospital Rules");
        assert_eq!(entry["scope"], "workspace");

        let read = SkillService::read("agent.md", Some(&tmp_ws)).unwrap();
        assert!(read["content"].as_str().unwrap().contains("Never delete patient records."));
        assert_eq!(read["scope"], "workspace");

        let _ = fs::remove_dir_all(&tmp_ws);
    }

    #[test]
    fn test_community_catalog_and_install() {
        let catalog = SkillService::community_catalog();
        assert!(!catalog.is_empty(), "Community catalog should have skill packs");
        assert!(catalog.iter().any(|p| p["id"] == "tdd-workflow"));

        let install_res = SkillService::install_community_pack("tdd-workflow").unwrap();
        assert_eq!(install_res["installed"], true);

        let listed = SkillService::list(None);
        assert!(listed.iter().any(|s| s["id"] == "tdd-workflow"));
    }

    #[test]
    fn test_install_list_read_toggle_delete_roundtrip() {
        let unique_id = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let tmp = std::env::temp_dir().join(format!("orbital_skill_ok_{}_{}", std::process::id(), unique_id));
        let _ = fs::create_dir_all(&tmp);
        let _ = fs::write(
            tmp.join("SKILL.md"),
            "---\nname: Test Skill\ndescription: roundtrip test\n---\nBody instructions here.",
        );

        let res = SkillService::install_from_folder(tmp.to_string_lossy().as_ref()).unwrap();
        let id = res["id"].as_str().unwrap().to_string();

        let listed = SkillService::list(None);
        assert!(listed.iter().any(|s| s["id"] == id.as_str() && s["name"] == "Test Skill"));

        let read = SkillService::read(&id, None).unwrap();
        assert!(read["content"].as_str().unwrap().contains("Body instructions here."));

        SkillService::set_enabled(&id, false).unwrap();
        let listed = SkillService::list(None);
        assert_eq!(
            listed.iter().find(|s| s["id"] == id.as_str()).unwrap()["enabled"],
            serde_json::Value::Bool(false)
        );

        SkillService::delete(&id).unwrap();
        assert!(!SkillService::list(None).iter().any(|s| s["id"] == id.as_str()));

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_validate_skill_slug() {
        assert_eq!(SkillService::validate_skill_slug("rust-expert").unwrap(), "rust-expert");
        assert_eq!(SkillService::validate_skill_slug("FastAPI_Pro!").unwrap(), "fastapi_pro");
        assert!(SkillService::validate_skill_slug("../escape").is_err());
        assert!(SkillService::validate_skill_slug("foo/bar").is_err());
        assert!(SkillService::validate_skill_slug("").is_err());
    }

    #[test]
    fn test_new_community_packs_in_catalog() {
        let catalog = SkillService::community_catalog();
        let ids: Vec<&str> = catalog.iter().filter_map(|p| p["id"].as_str()).collect();
        assert!(ids.contains(&"rust-strict-architect"), "Missing rust-strict-architect");
        assert!(ids.contains(&"react-nextjs-craft"), "Missing react-nextjs-craft");
        assert!(ids.contains(&"fastapi-pro"), "Missing fastapi-pro");
        assert!(ids.contains(&"security-auditor"), "Missing security-auditor");
        assert!(ids.contains(&"unit-test-generator"), "Missing unit-test-generator");
    }

    #[tokio::test]
    async fn test_fetch_community_registry_fallback() {
        let list = SkillService::fetch_community_registry(None).await;
        assert!(!list.is_empty(), "Fallback should return built-in catalog");
        assert!(list.iter().any(|p| p["id"] == "rust-strict-architect"));
    }
}

