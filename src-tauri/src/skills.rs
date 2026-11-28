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

fn parse_list_value(raw: &str) -> Vec<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }
    let inner = if trimmed.starts_with('[') && trimmed.ends_with(']') {
        &trimmed[1..trimmed.len() - 1]
    } else {
        trimmed
    };
    inner
        .split(',')
        .map(|s| s.trim().trim_matches('"').trim_matches('\'').to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

fn parse_priority_value(raw: Option<&str>) -> i32 {
    match raw.map(|s| s.trim().to_lowercase()).as_deref() {
        Some("critical") | Some("highest") => 100,
        Some("high") => 80,
        Some("medium") | Some("normal") => 50,
        Some("low") => 20,
        Some(other) => other.parse::<i32>().unwrap_or(50).clamp(0, 100),
        None => 50,
    }
}

/// Parses YAML frontmatter (`key: value` and multi-line `- item` lists) between two `---` markers.
pub fn parse_skill_md(content: &str) -> Option<(Vec<(String, String)>, String)> {
    let trimmed = content.trim_start();
    let rest = trimmed.strip_prefix("---")?;
    let end = rest.find("\n---")?;
    let frontmatter = &rest[..end];
    let body = rest[end + 4..].trim_start_matches('-').trim_start().to_string();

    let mut fields: Vec<(String, String)> = Vec::new();
    let mut current_list_key: Option<String> = None;
    let mut current_list_items: Vec<String> = Vec::new();

    let flush_list = |fields: &mut Vec<(String, String)>,
                      key_opt: &mut Option<String>,
                      items: &mut Vec<String>| {
        if let Some(k) = key_opt.take() {
            if !items.is_empty() {
                fields.push((k, items.join(", ")));
                items.clear();
            }
        }
    };

    for raw_line in frontmatter.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some(item) = line.strip_prefix("- ").or_else(|| line.strip_prefix("-\t")) {
            let clean_item = item.trim().trim_matches('"').trim_matches('\'').to_string();
            if !clean_item.is_empty() && current_list_key.is_some() {
                current_list_items.push(clean_item);
            }
            continue;
        }
        if let Some(idx) = line.find(':') {
            flush_list(&mut fields, &mut current_list_key, &mut current_list_items);
            let key = line[..idx].trim().to_string();
            let raw_val = line[idx + 1..].trim();
            if raw_val.is_empty() {
                current_list_key = Some(key);
            } else {
                let value = raw_val
                    .trim_matches('"')
                    .trim_matches('\'')
                    .to_string();
                if !key.is_empty() {
                    fields.push((key, value));
                }
            }
        }
    }
    flush_list(&mut fields, &mut current_list_key, &mut current_list_items);

    Some((fields, body))
}

fn load_skill_entry(dir: &Path, scope: &str) -> Option<Value> {
    let skill_path = dir.join("SKILL.md");
    let content = fs::read_to_string(&skill_path).ok()?;
    let (fields, body) = parse_skill_md(&content)?;
    let get = |key: &str| -> Option<String> {
        fields
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(key))
            .map(|(_, v)| v.clone())
            .filter(|v| !v.is_empty())
    };

    let name = get("name")?;
    let description = get("description").unwrap_or_default();
    let when_to_use = get("whenToUse").or_else(|| get("when_to_use"));
    let triggers = get("triggers")
        .map(|s| parse_list_value(&s))
        .unwrap_or_default();
    let globs = get("globs")
        .map(|s| parse_list_value(&s))
        .unwrap_or_default();
    let allowed_tools = get("allowed_tools")
        .or_else(|| get("allowedTools"))
        .map(|s| parse_list_value(&s))
        .unwrap_or_default();
    let tags = get("tags")
        .map(|s| parse_list_value(&s))
        .unwrap_or_default();
    let version = get("version").unwrap_or_else(|| "1.0.0".to_string());
    let author = get("author").unwrap_or_else(|| if scope == "workspace" { "Workspace" } else { "Community" }.to_string());
    let priority = parse_priority_value(get("priority").as_deref());

    let id = dir.file_name()?.to_string_lossy().to_string();
    let state = load_state();
    let enabled = match state.get(&id) {
        Some(Value::Bool(b)) => *b,
        _ => true,
    };
    let source_url = get("sourceUrl")
        .or_else(|| get("source_url"))
        .or_else(|| {
            state
                .get("__sources__")
                .and_then(|v| v.get(&id))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        });

    Some(json!({
        "id": id,
        "name": name,
        "description": description,
        "whenToUse": when_to_use,
        "triggers": triggers,
        "globs": globs,
        "allowedTools": allowed_tools,
        "tags": tags,
        "version": version,
        "author": author,
        "priority": priority,
        "sourceUrl": source_url,
        "scope": scope,
        "enabled": enabled,
        "bodyChars": body.len(),
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
    pub triggers: &'static [&'static str],
    pub globs: &'static [&'static str],
    pub allowed_tools: &'static [&'static str],
    pub priority: i32,
    pub version: &'static str,
    pub tags: &'static [&'static str],
    pub author: &'static str,
    pub body: &'static str,
}

const COMMUNITY_PACKS: &[CommunitySkillPack] = &[
    CommunitySkillPack {
        id: "tdd-workflow",
        name: "Test-Driven Development (TDD)",
        description: "Enforces strict red-green-refactor test-first development cycles and automated verification before completion.",
        when_to_use: "Writing new features, fixing bugs, or refactoring business logic",
        triggers: &["tdd", "test first", "write tests", "unit test", "red green refactor"],
        globs: &["**/*test*", "**/*.spec.*", "**/tests/**"],
        allowed_tools: &["read_file", "write_file", "patch_file", "run_command", "validate_changes"],
        priority: 90,
        version: "2.0.0",
        tags: &["testing", "quality", "tdd", "verification"],
        author: "Orbital X Core",
        body: "# Test-Driven Development (TDD) Workflow\n\n## Objective & Trigger Rules\nEnforce disciplined test-first engineering so every behavior change is backed by a deterministic, failing-then-passing test before completion.\n\n## Step-by-Step Execution Protocol\n1. **Inspect Existing Tests**: Locate existing test harnesses and conventions using `list_files` / `search_files`.\n2. **Write Failing Test (Red)**: Author a focused test covering the new requirement or bug reproduction.\n3. **Verify Failure**: Execute the test runner (`cargo test`, `npm test`, or `pytest`) and confirm it fails for the expected reason.\n4. **Minimal Implementation (Green)**: Implement the cleanest, minimal code to satisfy the test.\n5. **Refactor & Re-Verify**: Clean up duplication and re-run the full suite.\n\n## Strict Constraints & Guardrails\n- NEVER write production implementation before a failing test exists.\n- NEVER weaken assertions or skip tests to force a green build.\n- Keep tests isolated and deterministic with zero network flakiness.\n\n## Output Format & Verification\n- Report exact test command executed, pass/fail counts, and modified file paths.",
    },
    CommunitySkillPack {
        id: "rust-strict-architect",
        name: "Rust Strict Architect",
        description: "Senior Rust systems architect enforcing idiomatic ownership, zero-allocation data paths, concurrency invariants, and strict type safety.",
        when_to_use: "Designing, reviewing, or refactoring Rust crates, async runtimes, or Tauri IPC commands",
        triggers: &["rust", "cargo", "tauri", "borrow checker", "unsafe", "clippy"],
        globs: &["**/*.rs", "**/Cargo.toml"],
        allowed_tools: &["read_file", "write_file", "patch_file", "run_command", "diagnostics"],
        priority: 85,
        version: "2.0.0",
        tags: &["rust", "systems", "architecture", "performance"],
        author: "Orbital X Core",
        body: "# Rust Strict Systems Architecture\n\n## Objective & Trigger Rules\nApply principal-level Rust systems standards to every `.rs` module, Tauri IPC handler, and `Cargo.toml` change.\n\n## Step-by-Step Execution Protocol\n1. **Map Ownership & Concurrency**: Inspect `Arc`, `Mutex`, `RwLock`, and async `Send + Sync` boundaries before editing.\n2. **Prefer Borrowing**: Use `&str`, `&[T]`, and `impl AsRef<Path>` in signatures to eliminate needless allocations.\n3. **Typed Error Propagation**: Return `Result<T, String>` or structured errors with context; never use `.unwrap()` or `.expect()` in production paths.\n4. **Verify**: Run `cargo check` and `cargo test` after every mutation.\n\n## Strict Constraints & Guardrails\n- NEVER introduce `unsafe` without a documented safety invariant.\n- NEVER hold a `std::sync::Mutex` lock across `.await` points.\n- Avoid adding external crates when `std` suffices.\n\n## Output Format & Verification\n- Summarize ownership/concurrency guarantees and attach exact `cargo test` output.",
    },
    CommunitySkillPack {
        id: "react-nextjs-craft",
        name: "React & Next.js Craft",
        description: "Modern production React 19 and Next.js App Router patterns, Server Actions, suspense boundaries, and accessible state management.",
        when_to_use: "Building, refactoring, or optimizing React and Next.js applications",
        triggers: &["react", "nextjs", "next.js", "component", "jsx", "tsx", "hook"],
        globs: &["**/*.tsx", "**/*.jsx", "**/next.config.*"],
        allowed_tools: &["read_file", "write_file", "patch_file", "run_command"],
        priority: 75,
        version: "2.0.0",
        tags: &["react", "nextjs", "frontend", "typescript"],
        author: "Orbital X Core",
        body: "# React & Next.js Craft Guide\n\n## Objective & Trigger Rules\nDeliver accessible, zero-layout-shift React and Next.js components with clean state boundaries.\n\n## Step-by-Step Execution Protocol\n1. **Boundary Audit**: Default to Server Components; add `'use client'` only where browser events or hooks are needed.\n2. **State Minimalism**: Derive computed values during render rather than syncing via `useEffect`.\n3. **Accessibility**: Ensure semantic HTML, keyboard focus handling, and ARIA attributes.\n4. **Verify Build**: Run `npm run build` (and `npx tsc --noEmit` when TypeScript is present).\n\n## Strict Constraints & Guardrails\n- NEVER mutate state directly or omit `useEffect` cleanup for listeners/timers.\n- Avoid `any` types in TypeScript interfaces.\n\n## Output Format & Verification\n- List created/updated components and confirm `npm run build` succeeds with 0 errors.",
    },
    CommunitySkillPack {
        id: "fastapi-pro",
        name: "Python FastAPI Pro",
        description: "High-performance async Python with FastAPI, Pydantic v2 schemas, SQLAlchemy 2.0 ORM, and dependency injection.",
        when_to_use: "Building Python APIs, microservices, or backend services",
        triggers: &["fastapi", "pydantic", "uvicorn", "python api", "endpoint"],
        globs: &["**/*.py", "**/pyproject.toml", "**/requirements.txt"],
        allowed_tools: &["read_file", "write_file", "patch_file", "run_command"],
        priority: 75,
        version: "2.0.0",
        tags: &["python", "fastapi", "backend", "pydantic"],
        author: "Community",
        body: "# Python FastAPI Pro Architecture\n\n## Objective & Trigger Rules\nBuild type-safe, async FastAPI endpoints with strict Pydantic v2 validation and clean dependency injection.\n\n## Step-by-Step Execution Protocol\n1. **Schema First**: Define explicit Pydantic v2 `BaseModel` request/response models with field constraints.\n2. **Async I/O**: Use `async def` handlers for non-blocking DB/HTTP calls and `Depends(...)` for auth/sessions.\n3. **Error Handling**: Raise `HTTPException` with accurate HTTP status codes and structured details.\n4. **Verify**: Run `pytest` with `httpx.AsyncClient`.\n\n## Strict Constraints & Guardrails\n- NEVER block the asyncio event loop with synchronous `requests` or `time.sleep`.\n- NEVER leak raw stack traces or secrets in API responses.\n\n## Output Format & Verification\n- Document endpoint routes, status codes, and `pytest` results.",
    },
    CommunitySkillPack {
        id: "security-auditor",
        name: "Security & Penetration Auditor",
        description: "Rigorous static and dynamic security auditing, OWASP Top 10 prevention, path traversal defense, and safe cryptographic defaults.",
        when_to_use: "Auditing codebases for vulnerabilities, inspecting IPC boundaries, or sanitizing inputs",
        triggers: &["security", "audit", "vulnerability", "owasp", "xss", "injection", "traversal"],
        globs: &["**/*auth*", "**/*ipc*", "**/src-tauri/src/**"],
        allowed_tools: &["read_file", "search_files", "list_files", "patch_file", "run_command"],
        priority: 95,
        version: "2.0.0",
        tags: &["security", "audit", "owasp", "hardening"],
        author: "Orbital X Core",
        body: "# Security & Penetration Audit Guide\n\n## Objective & Trigger Rules\nIdentify and remediate security vulnerabilities across filesystem boundaries, IPC commands, shell execution, and UI rendering.\n\n## Step-by-Step Execution Protocol\n1. **Attack Surface Mapping**: Trace all untrusted inputs (URLs, file paths, IPC args, HTML interpolation).\n2. **Boundary Verification**: Verify path canonicalization, slug sanitization, and HTML escaping.\n3. **Command Safety**: Confirm subprocesses pass direct argument vectors rather than `sh -c` / `eval`.\n4. **Remediation & Regression Test**: Patch vulnerabilities and add boundary tests.\n\n## Strict Constraints & Guardrails\n- NEVER bypass auth, sandbox boundaries, or permission checks.\n- NEVER interpolate unescaped user/remote strings into `innerHTML` or shell commands.\n\n## Output Format & Verification\n- Report findings ordered by severity (Critical/High/Medium/Low) with exact `file:line` references.",
    },
    CommunitySkillPack {
        id: "unit-test-generator",
        name: "Unit Test Generator",
        description: "Automated generation of deterministic, edge-case-focused unit tests with high boundary coverage and zero flaky mocks.",
        when_to_use: "Generating unit tests, improving test coverage, or testing edge cases",
        triggers: &["generate tests", "unit test", "coverage", "edge case"],
        globs: &["**/*.rs", "**/*.ts", "**/*.js", "**/*.py"],
        allowed_tools: &["read_file", "write_file", "patch_file", "run_command"],
        priority: 70,
        version: "2.0.0",
        tags: &["testing", "unit-tests", "coverage", "quality"],
        author: "Community",
        body: "# Unit Test Generation Rules\n\n## Objective & Trigger Rules\nProduce fast, isolated, high-signal unit tests covering happy paths, error returns, and boundary inputs.\n\n## Step-by-Step Execution Protocol\n1. **Read Target Module**: Inspect all public functions, edge conditions, and existing test patterns.\n2. **Design Matrix**: Enumerate normal, empty, null/None, malformed, and boundary inputs.\n3. **Author & Execute**: Write tests using the repo's native framework and run them immediately.\n\n## Strict Constraints & Guardrails\n- NEVER write trivial tautology tests (`assert!(true)`).\n- Clean up any temporary files created during filesystem tests.\n\n## Output Format & Verification\n- List test cases added and paste exact runner summary.",
    },
    CommunitySkillPack {
        id: "rust-expert",
        name: "Rust Systems Expert",
        description: "Modern idiomatic Rust, zero-cost abstractions, lifetime management, clippy guidelines, and concurrency safety.",
        when_to_use: "Writing, auditing, or optimizing Rust code and Cargo manifests",
        triggers: &["rust expert", "lifetime", "optimize rust", "cargo.toml"],
        globs: &["**/*.rs", "**/Cargo.toml"],
        allowed_tools: &["read_file", "write_file", "patch_file", "run_command"],
        priority: 80,
        version: "2.0.0",
        tags: &["rust", "systems", "performance", "cargo"],
        author: "Orbital X Core",
        body: "# Rust Systems Engineering Guidelines\n\n## Objective & Trigger Rules\nWrite clean, idiomatic, warning-free Rust code with optimal memory layout and clear error handling.\n\n## Step-by-Step Execution Protocol\n1. **Check Existing Patterns**: Read neighboring modules to match error types and conventions.\n2. **Implement Cleanly**: Prefer iterators, borrowing (`&str`, `&[T]`), and structured `Result` returns.\n3. **Compile & Test**: Run `cargo check` and `cargo test`.\n\n## Strict Constraints & Guardrails\n- Avoid unnecessary `.clone()` in hot loops and avoid `unsafe` unless required.\n\n## Output Format & Verification\n- Provide a concise summary and verified `cargo test` pass count.",
    },
    CommunitySkillPack {
        id: "typescript-react",
        name: "React & TypeScript Architect",
        description: "Strict TypeScript type systems, modern React 19 functional hooks, state isolation, and UI performance patterns.",
        when_to_use: "Developing or refactoring React, Next.js, or TypeScript frontends",
        triggers: &["typescript", "tsconfig", "react hooks", "type error"],
        globs: &["**/*.ts", "**/*.tsx"],
        allowed_tools: &["read_file", "write_file", "patch_file", "run_command"],
        priority: 75,
        version: "2.0.0",
        tags: &["react", "typescript", "frontend", "hooks"],
        author: "Orbital X Core",
        body: "# React & TypeScript Architecture Guide\n\n## Objective & Trigger Rules\nMaintain strict TypeScript type safety and predictable React component lifecycles.\n\n## Step-by-Step Execution Protocol\n1. **Inspect Types**: Read shared interfaces and `tsconfig.json` strictness flags.\n2. **Author Strongly Typed Code**: Use discriminated unions and explicit return types on exported APIs.\n3. **Verify**: Run `npx tsc --noEmit` or `npm run build`.\n\n## Strict Constraints & Guardrails\n- NEVER silence type errors with `@ts-ignore` or `as any`.\n\n## Output Format & Verification\n- Confirm zero type errors and zero build warnings.",
    },
    CommunitySkillPack {
        id: "apple-design",
        name: "Apple HIG & Clean UI Design",
        description: "Human Interface Guidelines compliance, refined spacing, typography hierarchies, and fluid non-generic aesthetics.",
        when_to_use: "Reviewing UI layouts, designing panels, styling components, or improving visual hierarchy",
        triggers: &["ui", "ux", "css", "apple design", "hig", "layout", "theme", "contrast"],
        globs: &["**/*.css", "**/*.html", "**/*.tsx"],
        allowed_tools: &["read_file", "write_file", "patch_file", "run_command"],
        priority: 85,
        version: "2.0.0",
        tags: &["design", "apple-hig", "css", "ui"],
        author: "Orbital X Core",
        body: "# Apple HIG & Clean UI Design Rules\n\n## Objective & Trigger Rules\nCraft calm, high-craft desktop/web interfaces grounded in Apple Human Interface Guidelines with full Light & Dark theme parity.\n\n## Step-by-Step Execution Protocol\n1. **Token Audit**: Inspect `tokens.css` and `themes.css` and reuse semantic CSS variables.\n2. **Hierarchy & Spacing**: Apply generous padding, crisp `1px` borders, subtle backdrop blur, and clear typographic scale.\n3. **Accessibility**: Ensure WCAG AA contrast (>= 4.5:1) and `:focus-visible` rings in both Light and Dark themes.\n4. **Verify**: Run `npm run build` to confirm valid CSS bundling.\n\n## Strict Constraints & Guardrails\n- NEVER hardcode theme-breaking hex colors that fail in Light or Dark mode.\n- Avoid cluttered badges; keep primary actions obvious.\n\n## Output Format & Verification\n- Detail visual refinements and confirm `npm run build` succeeds.",
    },
    CommunitySkillPack {
        id: "conventional-commits",
        name: "Git & Conventional Commits",
        description: "Clean atomic git commits following the Conventional Commits specification (feat, fix, refactor, chore).",
        when_to_use: "Staging commits, preparing PRs, or managing git branches",
        triggers: &["commit", "git diff", "pull request", "changelog", "release notes"],
        globs: &["**/.git/**", "**/CHANGELOG*"],
        allowed_tools: &["read_file", "run_command"],
        priority: 65,
        version: "2.0.0",
        tags: &["git", "workflow", "productivity", "commits"],
        author: "Orbital X Core",
        body: "# Git & Conventional Commits Guide\n\n## Objective & Trigger Rules\nCreate concise, atomic commit messages and release summaries using the Conventional Commits standard.\n\n## Step-by-Step Execution Protocol\n1. **Inspect Diff**: Run `git status` and `git diff --cached` (or `git diff`).\n2. **Classify Scope**: Choose `<type>` (`feat`, `fix`, `refactor`, `test`, `docs`, `chore`) and optional `(scope)`.\n3. **Draft Message**: Write imperative, present-tense subject <= 72 chars.\n\n## Strict Constraints & Guardrails\n- NEVER run destructive git commands (`reset --hard`, `push --force`) without explicit approval.\n- NEVER commit secrets or `.env` credentials.\n\n## Output Format & Verification\n- Present the formatted commit message ready to apply.",
    },
    CommunitySkillPack {
        id: "systematic-debugging",
        name: "Systematic Debugger",
        description: "Hypothesis-driven root-cause analysis, minimal reproducible cases, and surgical non-breaking fixes.",
        when_to_use: "Investigating runtime errors, test failures, or subtle logic regressions",
        triggers: &["debug", "bug", "error", "crash", "stack trace", "failing test", "broken"],
        globs: &[],
        allowed_tools: &["read_file", "search_files", "patch_file", "run_command", "diagnostics"],
        priority: 95,
        version: "2.0.0",
        tags: &["debugging", "analysis", "reliability", "troubleshooting"],
        author: "Orbital X Core",
        body: "# Systematic Debugging Methodology\n\n## Objective & Trigger Rules\nEliminate guesswork by proving the exact root cause before applying any fix.\n\n## Step-by-Step Execution Protocol\n1. **Reproduce**: Capture the exact error message, stack trace, or failing test.\n2. **Trace & Hypothesize**: Read the failing code path and form a single falsifiable root-cause hypothesis.\n3. **Surgical Fix**: Patch the underlying root cause directly without masking symptoms.\n4. **Verify**: Re-run the reproduction check and full test suite.\n\n## Strict Constraints & Guardrails\n- NEVER apply speculative fixes or swallow exceptions silently.\n- NEVER claim a fix works without running verification after the final edit.\n\n## Output Format & Verification\n- State root cause (`file:line`), surgical fix applied, and post-fix verification output.",
    },
];

fn collect_companion_index(skill_dir: &Path) -> String {
    let mut entries = Vec::new();
    for sub in ["references", "resources", "agents", "scripts", "examples"] {
        let sub_dir = skill_dir.join(sub);
        if let Ok(read_dir) = fs::read_dir(&sub_dir) {
            for entry in read_dir.filter_map(|e| e.ok()).take(16) {
                if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
                    entries.push(format!(
                        "- `{}/{}` ({})",
                        sub,
                        entry.file_name().to_string_lossy(),
                        entry.path().to_string_lossy()
                    ));
                }
            }
        }
    }
    if entries.is_empty() {
        String::new()
    } else {
        format!(
            "\n\n## Companion Skill Resources & Scripts (Local Model Index)\nUse `read_file` on any path below when deeper reference or verification scripts are needed:\n{}\n",
            entries.join("\n")
        )
    }
}

fn read_skill_with_companions(skill_dir: &Path) -> Result<String, String> {
    let mut content = fs::read_to_string(skill_dir.join("SKILL.md")).map_err(|e| e.to_string())?;
    content.push_str(&collect_companion_index(skill_dir));
    Ok(content)
}

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
            let skill_dir = ws_skills.join(ident);
            if let Some(skill) = load_skill_entry(&skill_dir, "workspace") {
                let content = read_skill_with_companions(&skill_dir)?;
                return Ok(json!({
                    "skill": skill["name"],
                    "content": content,
                    "chars": content.len(),
                    "scope": "workspace"
                }));
            }
        }

        // 3. Check global skills by folder id
        let global_dir = skills_dir().join(ident);
        if let Some(skill) = load_skill_entry(&global_dir, "global") {
            let content = read_skill_with_companions(&global_dir)?;
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
                    let p_path = Path::new(p);
                    if let Ok(mut content) = fs::read_to_string(p_path) {
                        if let Some(parent) = p_path.parent() {
                            if p_path.file_name().and_then(|n| n.to_str()) == Some("SKILL.md") {
                                content.push_str(&collect_companion_index(parent));
                            }
                        }
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
                    "triggers": pack.triggers,
                    "globs": pack.globs,
                    "allowedTools": pack.allowed_tools,
                    "priority": pack.priority,
                    "version": pack.version,
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
        let triggers_joined = pack.triggers.join(", ");
        let globs_joined = pack.globs.join(", ");
        let tools_joined = pack.allowed_tools.join(", ");
        let content = format!(
            "---\nname: {}\ndescription: \"{}\"\nwhenToUse: \"{}\"\nversion: {}\nauthor: {}\npriority: {}\ntriggers: [{}]\nglobs: [{}]\nallowed_tools: [{}]\ntags: [{}]\n---\n\n{}\n",
            pack.name,
            pack.description,
            pack.when_to_use,
            pack.version,
            pack.author,
            pack.priority,
            triggers_joined,
            globs_joined,
            tools_joined,
            tags_joined,
            pack.body
        );

        fs::write(dest.join("SKILL.md"), content).map_err(|e| e.to_string())?;

        let mut state = load_state();
        state.insert(pack.id.to_string(), Value::Bool(true));
        save_state(&state);

        Ok(json!({
            "success": true,
            "id": pack.id,
            "name": pack.name,
            "version": pack.version,
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

    /// Parses CLI commands (`npx skills add owner/repo --skill name`) as well as URLs or `owner/repo`.
    pub fn parse_skill_source_input(raw_input: &str) -> (String, Option<String>) {
        let trimmed = raw_input.trim();
        let tokens: Vec<&str> = trimmed.split_whitespace().collect();
        if tokens.is_empty() {
            return (String::new(), None);
        }

        // Handle `npx skills add <target> [--skill <name>]` or `skills add <target> ...`
        let is_cli = (tokens.len() >= 3 && tokens[0].eq_ignore_ascii_case("npx") && tokens[1].eq_ignore_ascii_case("skills"))
            || (tokens.len() >= 2 && tokens[0].eq_ignore_ascii_case("skills") && tokens[1].eq_ignore_ascii_case("add"));

        if is_cli {
            let mut target: Option<String> = None;
            let mut skill_filter: Option<String> = None;
            let mut i = 0;
            while i < tokens.len() {
                let tok = tokens[i];
                if tok == "--skill" || tok == "-s" {
                    if i + 1 < tokens.len() {
                        skill_filter = Some(tokens[i + 1].trim_matches('"').trim_matches('\'').to_string());
                        i += 2;
                        continue;
                    }
                } else if let Some(val) = tok.strip_prefix("--skill=") {
                    skill_filter = Some(val.trim_matches('"').trim_matches('\'').to_string());
                } else if (tok == "--agent" || tok == "-a") && i + 1 < tokens.len() {
                    i += 2;
                    continue;
                } else if !tok.starts_with('-')
                    && !tok.eq_ignore_ascii_case("npx")
                    && !tok.eq_ignore_ascii_case("skills")
                    && !tok.eq_ignore_ascii_case("add")
                    && target.is_none()
                {
                    target = Some(tok.trim_matches('"').trim_matches('\'').to_string());
                }
                i += 1;
            }
            return (target.unwrap_or_else(|| trimmed.to_string()), skill_filter);
        }

        (trimmed.to_string(), None)
    }

    /// Normalizes any GitHub URL or `owner/repo` shorthand into candidate raw `SKILL.md` URLs
    /// plus optional repo metadata `(owner, repo, branch, subpath)`.
    pub fn normalize_github_skill_urls(raw_input: &str) -> (Vec<String>, Option<(String, String, String, String)>) {
        let (parsed_source, _) = Self::parse_skill_source_input(raw_input);
        let trimmed = parsed_source.trim().trim_end_matches('/');
        if trimmed.is_empty() {
            return (Vec::new(), None);
        }

        // 1. Direct raw.githubusercontent.com URL
        if trimmed.contains("raw.githubusercontent.com") {
            let mut candidates = vec![trimmed.to_string()];
            if !trimmed.to_lowercase().ends_with(".md") {
                candidates.insert(0, format!("{}/SKILL.md", trimmed));
            }
            return (candidates, None);
        }

        // 2. Full github.com URL
        if let Some(after_gh) = trimmed
            .strip_prefix("https://github.com/")
            .or_else(|| trimmed.strip_prefix("http://github.com/"))
        {
            let parts: Vec<&str> = after_gh.split('/').filter(|p| !p.is_empty()).collect();
            if parts.len() >= 2 {
                let owner = parts[0].to_string();
                let repo = parts[1].trim_end_matches(".git").to_string();
                if parts.len() >= 4 && (parts[2] == "blob" || parts[2] == "tree") {
                    let branch = parts[3].to_string();
                    let subpath = parts[4..].join("/");
                    let raw = if subpath.to_lowercase().ends_with(".md") {
                        format!("https://raw.githubusercontent.com/{}/{}/{}/{}", owner, repo, branch, subpath)
                    } else if subpath.is_empty() {
                        format!("https://raw.githubusercontent.com/{}/{}/{}/SKILL.md", owner, repo, branch)
                    } else {
                        format!("https://raw.githubusercontent.com/{}/{}/{}/{}/SKILL.md", owner, repo, branch, subpath)
                    };
                    let folder_subpath = if subpath.to_lowercase().ends_with(".md") {
                        subpath.rsplit_once('/').map(|(dir, _)| dir.to_string()).unwrap_or_default()
                    } else {
                        subpath
                    };
                    return (vec![raw], Some((owner, repo, branch, folder_subpath)));
                }
                let candidates = vec![
                    format!("https://raw.githubusercontent.com/{}/{}/main/SKILL.md", owner, repo),
                    format!("https://raw.githubusercontent.com/{}/{}/master/SKILL.md", owner, repo),
                ];
                return (candidates, Some((owner, repo, "main".to_string(), String::new())));
            }
        }

        // 3. owner/repo shorthand (e.g., "udaysharmadev/Gravitas" or "owner/repo/subpath")
        if !trimmed.contains("://") && trimmed.contains('/') {
            let parts: Vec<&str> = trimmed.split('/').filter(|p| !p.is_empty()).collect();
            if parts.len() >= 2 && parts.iter().all(|p| !p.contains(' ')) {
                let owner = parts[0].to_string();
                let repo = parts[1].trim_end_matches(".git").to_string();
                let subpath = parts[2..].join("/");
                let candidates = if subpath.is_empty() {
                    vec![
                        format!("https://raw.githubusercontent.com/{}/{}/main/SKILL.md", owner, repo),
                        format!("https://raw.githubusercontent.com/{}/{}/master/SKILL.md", owner, repo),
                    ]
                } else {
                    vec![
                        format!("https://raw.githubusercontent.com/{}/{}/main/{}/SKILL.md", owner, repo, subpath),
                        format!("https://raw.githubusercontent.com/{}/{}/master/{}/SKILL.md", owner, repo, subpath),
                    ]
                };
                return (candidates, Some((owner, repo, "main".to_string(), subpath)));
            }
        }

        // 4. Generic HTTP/HTTPS URL
        (vec![trimmed.to_string()], None)
    }

    /// Synthesizes valid YAML frontmatter if an imported `SKILL.md` / `AGENTS.md` / `CLAUDE.md` omits it.
    fn ensure_skill_frontmatter(raw: &str, fallback_name: &str, fallback_author: &str) -> String {
        if parse_skill_md(raw).is_some() {
            return raw.to_string();
        }
        let heading = raw
            .lines()
            .find(|l| l.trim().starts_with('#'))
            .map(|l| l.trim().trim_start_matches('#').trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| fallback_name.to_string());
        let desc = raw
            .lines()
            .map(|l| l.trim())
            .find(|l| !l.is_empty() && !l.starts_with('#') && !l.starts_with("```"))
            .unwrap_or("Imported GitHub skill instruction pack")
            .chars()
            .take(180)
            .collect::<String>()
            .replace('"', "'");

        format!(
            "---\nname: \"{}\"\ndescription: \"{}\"\nauthor: \"{}\"\nversion: \"1.0.0\"\n---\n\n{}",
            heading.replace('"', "'"),
            desc,
            fallback_author.replace('"', "'"),
            raw
        )
    }

    /// Inspects the full recursive GitHub tree for any `SKILL.md` (or root `AGENTS.md`/`CLAUDE.md`/`GEMINI.md`),
    /// selects the best match (or `--skill <name>`), and returns `(selected_path, resolved_branch, companion_paths, other_skills)`.
    async fn discover_github_repo_skill(
        client: &reqwest::Client,
        owner: &str,
        repo: &str,
        branch_hint: &str,
        subpath_hint: &str,
        skill_filter: Option<&str>,
    ) -> Option<(String, String, Vec<String>, Vec<Value>)> {
        // 1. Resolve default branch via repo API
        let mut branch = branch_hint.to_string();
        if branch.is_empty() || branch == "main" {
            let repo_api = format!("https://api.github.com/repos/{}/{}", owner, repo);
            if let Ok(resp) = client.get(&repo_api).send().await {
                if resp.status().is_success() {
                    if let Ok(info) = resp.json::<Value>().await {
                        if let Some(def) = info.get("default_branch").and_then(|v| v.as_str()) {
                            branch = def.to_string();
                        }
                    }
                }
            }
        }

        // 2. Fetch recursive git tree
        let mut tree_items: Vec<String> = Vec::new();
        let candidate_branches = [branch.clone(), "main".to_string(), "master".to_string()];
        for br in &candidate_branches {
            let tree_url = format!(
                "https://api.github.com/repos/{}/{}/git/trees/{}?recursive=1",
                owner, repo, br
            );
            if let Ok(resp) = client.get(&tree_url).send().await {
                if resp.status().is_success() {
                    if let Ok(json_val) = resp.json::<Value>().await {
                        if let Some(arr) = json_val.get("tree").and_then(|v| v.as_array()) {
                            branch = br.to_string();
                            tree_items = arr
                                .iter()
                                .filter(|item| item.get("type").and_then(|v| v.as_str()) == Some("blob"))
                                .filter_map(|item| item.get("path").and_then(|v| v.as_str()).map(|s| s.to_string()))
                                .collect();
                            break;
                        }
                    }
                }
            }
        }

        if tree_items.is_empty() {
            return None;
        }

        // 3. Find all SKILL.md files across any convention:
        //    SKILL.md, skills/*/SKILL.md, .agents/skills/*/SKILL.md, .claude/skills/*/SKILL.md, plugins/*/SKILL.md, etc.
        let mut skill_md_paths: Vec<String> = tree_items
            .iter()
            .filter(|p| {
                let lower = p.to_lowercase();
                lower == "skill.md" || lower.ends_with("/skill.md")
            })
            .cloned()
            .collect();

        // Fallback to standard root agent instruction files if no SKILL.md exists anywhere
        if skill_md_paths.is_empty() {
            for fallback_name in ["AGENTS.md", "CLAUDE.md", "GEMINI.md", ".cursorrules", "README.md"] {
                if let Some(found) = tree_items.iter().find(|p| p.eq_ignore_ascii_case(fallback_name)) {
                    skill_md_paths.push(found.clone());
                    break;
                }
            }
        }

        if skill_md_paths.is_empty() {
            return None;
        }

        // 4. Score & select target SKILL.md
        let filter_lower = skill_filter.map(|s| s.trim().to_lowercase());
        let subpath_lower = subpath_hint.trim().to_lowercase();
        let repo_lower = repo.to_lowercase();

        skill_md_paths.sort_by_key(|p| {
            let p_lower = p.to_lowercase();
            let dir_name = p.rsplit_once('/').map(|(d, _)| d).unwrap_or("");
            let leaf_dir = dir_name.rsplit_once('/').map(|(_, l)| l).unwrap_or(dir_name).to_lowercase();

            let mut score: i32 = 100;
            if let Some(ref f) = filter_lower {
                if leaf_dir == *f {
                    score -= 1000;
                } else if p_lower.contains(f.as_str()) {
                    score -= 500;
                }
            }
            if !subpath_lower.is_empty() && p_lower.starts_with(&subpath_lower) {
                score -= 800;
            }
            if leaf_dir == repo_lower || p_lower == format!("skills/{}/skill.md", repo_lower) {
                score -= 300;
            }
            if p_lower.starts_with("skills/") || p_lower.starts_with(".agents/skills/") || p_lower.starts_with(".claude/skills/") {
                score -= 100;
            }
            if p_lower == "skill.md" {
                score -= 50;
            }
            (score, p.len() as i32)
        });

        let selected = skill_md_paths[0].clone();
        let selected_dir = selected.rsplit_once('/').map(|(d, _)| d).unwrap_or("");

        // 5. Collect companion files under selected skill folder (references/, resources/, agents/, scripts/, examples/)
        let companion_paths: Vec<String> = if !selected_dir.is_empty() {
            let prefix = format!("{}/", selected_dir);
            tree_items
                .iter()
                .filter(|p| {
                    if !p.starts_with(&prefix) || *p == &selected {
                        return false;
                    }
                    let rel = &p[prefix.len()..];
                    let lower = rel.to_lowercase();
                    let in_known_dir = ["references/", "resources/", "agents/", "scripts/", "examples/"]
                        .iter()
                        .any(|d| lower.starts_with(d));
                    let safe_ext = [".md", ".txt", ".json", ".py", ".sh", ".ps1", ".js", ".ts", ".rs"]
                        .iter()
                        .any(|ext| lower.ends_with(ext));
                    in_known_dir && safe_ext
                })
                .take(24)
                .cloned()
                .collect()
        } else {
            Vec::new()
        };

        // 6. List other discovered skills in the same repo so UI can offer 1-click install
        let other_skills: Vec<Value> = skill_md_paths
            .iter()
            .skip(1)
            .take(10)
            .map(|p| {
                let dir = p.rsplit_once('/').map(|(d, _)| d).unwrap_or(repo);
                let leaf = dir.rsplit_once('/').map(|(_, l)| l).unwrap_or(dir);
                json!({
                    "id": leaf,
                    "path": p,
                    "url": format!("https://github.com/{}/{}/blob/{}/{}", owner, repo, branch, p),
                })
            })
            .collect();

        Some((selected, branch, companion_paths, other_skills))
    }

    /// Downloads discovered companion files into `~/.orbital/skills/<slug>/<relative_path>`.
    async fn download_companion_tree_files(
        client: &reqwest::Client,
        owner: &str,
        repo: &str,
        branch: &str,
        skill_dir_in_repo: &str,
        companion_paths: &[String],
        dest: &Path,
    ) -> usize {
        let prefix = if skill_dir_in_repo.is_empty() {
            String::new()
        } else {
            format!("{}/", skill_dir_in_repo)
        };
        let mut count = 0usize;
        for repo_path in companion_paths {
            let rel = if !prefix.is_empty() && repo_path.starts_with(&prefix) {
                &repo_path[prefix.len()..]
            } else {
                repo_path.as_str()
            };
            if rel.contains("..") || rel.starts_with('/') || rel.starts_with('\\') {
                continue;
            }
            let raw_url = format!(
                "https://raw.githubusercontent.com/{}/{}/{}/{}",
                owner, repo, branch, repo_path
            );
            if let Ok(resp) = client.get(&raw_url).send().await {
                if resp.status().is_success() {
                    if let Ok(bytes) = resp.bytes().await {
                        if bytes.len() <= 150_000 {
                            let target = dest.join(rel);
                            if let Some(parent) = target.parent() {
                                let _ = fs::create_dir_all(parent);
                            }
                            if fs::write(&target, &bytes).is_ok() {
                                count += 1;
                            }
                        }
                    }
                }
            }
        }
        count
    }

    /// Installs a skill from any GitHub URL, `owner/repo` shorthand, `npx skills add ...`, or direct `SKILL.md` URL.
    pub async fn install_from_url(url: &str) -> Result<Value, String> {
        let raw_input = url.trim();
        if raw_input.is_empty() {
            return Err("URL cannot be empty.".into());
        }

        let (clean_url, skill_filter) = Self::parse_skill_source_input(raw_input);
        let (mut candidates, gh_meta) = Self::normalize_github_skill_urls(&clean_url);
        if candidates.is_empty() {
            return Err("Could not resolve a valid skill URL.".into());
        }

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(12))
            .user_agent("OrbitalX-IDE/2.4.8")
            .build()
            .map_err(|e| e.to_string())?;

        // If this is a GitHub repository/folder (or `--skill` filter is specified),
        // inspect the full recursive GitHub tree first so multi-skill repos like
        // `udaysharmadev/Gravitas` (`skills/gravitas/SKILL.md`) resolve cleanly.
        let mut discovered_other_skills: Vec<Value> = Vec::new();
        let mut companion_tree_paths: Vec<String> = Vec::new();
        let mut resolved_gh_meta = gh_meta.clone();

        let needs_tree_discovery = gh_meta.as_ref().map(|(_, _, _, subpath)| {
            subpath.is_empty() || !subpath.to_lowercase().ends_with(".md") || skill_filter.is_some()
        }).unwrap_or(false);

        if needs_tree_discovery {
            if let Some((owner, repo, branch_hint, subpath_hint)) = &gh_meta {
                if let Some((selected_path, resolved_branch, companions, others)) =
                    Self::discover_github_repo_skill(
                        &client,
                        owner,
                        repo,
                        branch_hint,
                        subpath_hint,
                        skill_filter.as_deref(),
                    )
                    .await
                {
                    let selected_raw = format!(
                        "https://raw.githubusercontent.com/{}/{}/{}/{}",
                        owner, repo, resolved_branch, selected_path
                    );
                    candidates.insert(0, selected_raw);
                    let selected_dir = selected_path
                        .rsplit_once('/')
                        .map(|(d, _)| d.to_string())
                        .unwrap_or_default();
                    resolved_gh_meta = Some((
                        owner.clone(),
                        repo.clone(),
                        resolved_branch,
                        selected_dir,
                    ));
                    companion_tree_paths = companions;
                    discovered_other_skills = others;
                }
            }
        }

        let mut fetched_content: Option<String> = None;
        let mut resolved_url = String::new();
        let mut last_status = String::new();

        for candidate in &candidates {
            match client.get(candidate).send().await {
                Ok(resp) if resp.status().is_success() => {
                    let text = resp.text().await.map_err(|e| format!("Failed to read response body: {}", e))?;
                    fetched_content = Some(text);
                    resolved_url = candidate.clone();
                    break;
                }
                Ok(resp) => {
                    last_status = format!("HTTP {}", resp.status());
                }
                Err(e) => {
                    last_status = e.to_string();
                }
            }
        }

        let raw_content = fetched_content.ok_or_else(|| {
            format!("Failed to fetch SKILL.md ({}). Verify the URL points to a valid SKILL.md or GitHub repository.", last_status)
        })?;

        if raw_content.len() > 300_000 {
            return Err("Remote skill file exceeds 300 KB limit.".into());
        }

        let fallback_name = resolved_gh_meta
            .as_ref()
            .map(|(_, repo, _, dir)| {
                if dir.is_empty() {
                    repo.clone()
                } else {
                    dir.rsplit_once('/').map(|(_, l)| l).unwrap_or(dir).to_string()
                }
            })
            .unwrap_or_else(|| "imported-skill".to_string());
        let fallback_author = resolved_gh_meta
            .as_ref()
            .map(|(owner, _, _, _)| owner.clone())
            .unwrap_or_else(|| "GitHub".to_string());

        let content = Self::ensure_skill_frontmatter(&raw_content, &fallback_name, &fallback_author);
        let (fields, body) = parse_skill_md(&content)
            .ok_or("Could not parse skill frontmatter.")?;

        let get = |k: &str| -> Option<String> {
            fields.iter().find(|(key, _)| key.eq_ignore_ascii_case(k)).map(|(_, v)| v.clone())
        };

        let name = get("name").unwrap_or_else(|| fallback_name.clone());
        let description = get("description").unwrap_or_default();
        let when_to_use = get("whenToUse").or_else(|| get("when_to_use")).unwrap_or_default();
        let version = get("version").unwrap_or_else(|| "1.0.0".to_string());
        let author = get("author").unwrap_or_else(|| fallback_author.clone());
        let triggers = get("triggers").map(|s| parse_list_value(&s)).unwrap_or_default();
        let globs = get("globs").map(|s| parse_list_value(&s)).unwrap_or_default();
        let allowed_tools = get("allowed_tools")
            .or_else(|| get("allowedTools"))
            .map(|s| parse_list_value(&s))
            .unwrap_or_default();
        let tags = get("tags").map(|s| parse_list_value(&s)).unwrap_or_default();

        // Derive safe slug from frontmatter id/name
        let candidate_slug = get("id").unwrap_or_else(|| name.to_lowercase().replace(' ', "-"));
        let safe_id = Self::validate_skill_slug(&candidate_slug)?;

        let dest = skills_dir().join(&safe_id);
        fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
        fs::write(dest.join("SKILL.md"), &content).map_err(|e| e.to_string())?;

        let mut companion_count = 0usize;
        if let Some((owner, repo, branch, subpath)) = &resolved_gh_meta {
            if !companion_tree_paths.is_empty() {
                companion_count = Self::download_companion_tree_files(
                    &client,
                    owner,
                    repo,
                    branch,
                    subpath,
                    &companion_tree_paths,
                    &dest,
                )
                .await;
            }
        }

        let mut state = load_state();
        state.insert(safe_id.clone(), Value::Bool(true));
        let sources_entry = state
            .entry("__sources__".to_string())
            .or_insert_with(|| Value::Object(serde_json::Map::new()));
        if let Some(map) = sources_entry.as_object_mut() {
            map.insert(safe_id.clone(), Value::String(resolved_url.clone()));
        }
        save_state(&state);

        Ok(json!({
            "success": true,
            "id": safe_id,
            "name": name,
            "description": description,
            "whenToUse": when_to_use,
            "version": version,
            "author": author,
            "triggers": triggers,
            "globs": globs,
            "allowedTools": allowed_tools,
            "tags": tags,
            "scope": "global",
            "enabled": true,
            "installed": true,
            "sourceUrl": resolved_url,
            "resolvedUrl": resolved_url,
            "companionFilesCount": companion_count,
            "discoveredSkills": discovered_other_skills,
            "body": body,
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

    #[test]
    fn test_parse_rich_yaml_frontmatter_lists() {
        let md = "---\nname: Deep Skill\ndescription: \"Rich schema test\"\nversion: 2.1.0\nauthor: Dax\npriority: high\ntriggers:\n  - \"audit code\"\n  - \"security scan\"\nglobs: [\"**/*.rs\", \"src/**/*.ts\"]\nallowed_tools: read_file, patch_file\n---\n\n## Objective & Trigger Rules\nCheck invariants.";
        let (fields, body) = parse_skill_md(md).unwrap();
        let get = |k: &str| fields.iter().find(|(key, _)| key == k).map(|(_, v)| v.as_str());
        assert_eq!(get("version"), Some("2.1.0"));
        assert_eq!(get("priority"), Some("high"));
        assert_eq!(get("triggers"), Some("audit code, security scan"));
        assert_eq!(get("globs"), Some("[\"**/*.rs\", \"src/**/*.ts\"]"));
        assert_eq!(get("allowed_tools"), Some("read_file, patch_file"));
        assert!(body.contains("## Objective & Trigger Rules"));
    }

    #[test]
    fn test_normalize_github_skill_urls() {
        let (blob, _) = SkillService::normalize_github_skill_urls(
            "https://github.com/daxp472/Orbital-X/blob/main/.agents/skills/rust/SKILL.md",
        );
        assert_eq!(
            blob[0],
            "https://raw.githubusercontent.com/daxp472/Orbital-X/main/.agents/skills/rust/SKILL.md"
        );

        let (tree, meta) = SkillService::normalize_github_skill_urls(
            "https://github.com/daxp472/Orbital-X/tree/main/.agents/skills/rust",
        );
        assert_eq!(
            tree[0],
            "https://raw.githubusercontent.com/daxp472/Orbital-X/main/.agents/skills/rust/SKILL.md"
        );
        assert!(meta.is_some());

        let (shorthand, _) = SkillService::normalize_github_skill_urls("daxp472/my-skill");
        assert_eq!(
            shorthand[0],
            "https://raw.githubusercontent.com/daxp472/my-skill/main/SKILL.md"
        );
        assert_eq!(
            shorthand[1],
            "https://raw.githubusercontent.com/daxp472/my-skill/master/SKILL.md"
        );
    }

    #[test]
    fn test_parse_npx_skills_add_cli_input() {
        let (target, filter) = SkillService::parse_skill_source_input(
            "npx skills add udaysharmadev/Gravitas --skill gravitas --agent antigravity --yes",
        );
        assert_eq!(target, "udaysharmadev/Gravitas");
        assert_eq!(filter.as_deref(), Some("gravitas"));

        let synthesized = SkillService::ensure_skill_frontmatter(
            "# Gravitas\nReliability framework for coding agents.",
            "gravitas",
            "udaysharmadev",
        );
        let (fields, body) = parse_skill_md(&synthesized).unwrap();
        assert!(fields.iter().any(|(k, v)| k == "name" && v == "Gravitas"));
        assert!(body.contains("Reliability framework"));
    }
}

