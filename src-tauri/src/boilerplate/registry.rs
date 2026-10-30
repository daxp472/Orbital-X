use super::placeholders::replace_placeholders;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RenderedTemplate {
    pub content: String,
    pub cursor_offset: Option<usize>,
}

#[derive(Debug, Clone)]
pub struct ResolvedTemplate {
    pub template: String,
    pub matched_suffix: Option<String>,
    pub key: String,
}

#[derive(Debug, Clone, Default)]
pub struct TemplateRegistry {
    /// Exact file name matching (e.g. "Dockerfile", "Makefile", "package.json", ".gitignore", "Cargo.toml")
    pub exact_templates: HashMap<String, String>,
    /// Pattern matching (e.g. "*.test.js", "*.spec.ts", "*.module.css", "*.controller.js")
    pub pattern_templates: Vec<(String, String)>,
    /// File extension matching (e.g. "jsx", "tsx", "rs", "py", etc.)
    pub extension_templates: HashMap<String, String>,
}

impl TemplateRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Creates a registry pre-loaded with built-in default templates.
    pub fn default_built_in() -> Self {
        let mut reg = Self::new();

        // 1. Exact file names
        reg.register_exact("Dockerfile", include_str!("../../templates/Dockerfile.tmpl"));
        reg.register_exact("Makefile", include_str!("../../templates/Makefile.tmpl"));
        reg.register_exact("package.json", include_str!("../../templates/package.json.tmpl"));
        reg.register_exact(".gitignore", include_str!("../../templates/gitignore.tmpl"));
        reg.register_exact("Cargo.toml", include_str!("../../templates/Cargo.toml.tmpl"));

        // 2. Pattern templates
        reg.register_pattern("*.test.js", include_str!("../../templates/test.js.tmpl"));
        reg.register_pattern("*.spec.ts", include_str!("../../templates/spec.ts.tmpl"));
        reg.register_pattern("*.module.css", include_str!("../../templates/module.css.tmpl"));
        reg.register_pattern("*.controller.js", include_str!("../../templates/controller.js.tmpl"));

        // 3. File extensions
        // Frontend
        reg.register_extension("jsx", include_str!("../../templates/jsx.tmpl"));
        reg.register_extension("tsx", include_str!("../../templates/tsx.tmpl"));
        reg.register_extension("js", include_str!("../../templates/js.tmpl"));
        reg.register_extension("ts", include_str!("../../templates/ts.tmpl"));
        reg.register_extension("html", include_str!("../../templates/html.tmpl"));
        reg.register_extension("css", include_str!("../../templates/css.tmpl"));
        reg.register_extension("scss", include_str!("../../templates/scss.tmpl"));
        reg.register_extension("vue", include_str!("../../templates/vue.tmpl"));
        reg.register_extension("svelte", include_str!("../../templates/svelte.tmpl"));

        // Backend
        reg.register_extension("rs", include_str!("../../templates/rs.tmpl"));
        reg.register_extension("py", include_str!("../../templates/py.tmpl"));
        reg.register_extension("java", include_str!("../../templates/java.tmpl"));
        reg.register_extension("go", include_str!("../../templates/go.tmpl"));
        reg.register_extension("php", include_str!("../../templates/php.tmpl"));
        reg.register_extension("rb", include_str!("../../templates/rb.tmpl"));
        reg.register_extension("cs", include_str!("../../templates/cs.tmpl"));
        reg.register_extension("kt", include_str!("../../templates/kt.tmpl"));

        // Systems
        reg.register_extension("c", include_str!("../../templates/c.tmpl"));
        reg.register_extension("cpp", include_str!("../../templates/cpp.tmpl"));
        reg.register_extension("h", include_str!("../../templates/h.tmpl"));
        reg.register_extension("hpp", include_str!("../../templates/hpp.tmpl"));

        // Config / data
        reg.register_extension("json", include_str!("../../templates/json.tmpl"));
        reg.register_extension("yaml", include_str!("../../templates/yaml.tmpl"));
        reg.register_extension("toml", include_str!("../../templates/toml.tmpl"));
        reg.register_extension("xml", include_str!("../../templates/xml.tmpl"));
        reg.register_extension("sql", include_str!("../../templates/sql.tmpl"));
        reg.register_extension("sh", include_str!("../../templates/sh.tmpl"));
        reg.register_extension("md", include_str!("../../templates/md.tmpl"));

        reg
    }

    pub fn register_exact(&mut self, name: &str, template: &str) {
        self.exact_templates.insert(name.to_string(), template.to_string());
    }

    pub fn register_pattern(&mut self, pattern: &str, template: &str) {
        // If pattern already exists, replace it, else push
        if let Some(pos) = self.pattern_templates.iter().position(|(p, _)| p == pattern) {
            self.pattern_templates[pos] = (pattern.to_string(), template.to_string());
        } else {
            self.pattern_templates.push((pattern.to_string(), template.to_string()));
        }
    }

    pub fn register_extension(&mut self, ext: &str, template: &str) {
        let clean_ext = ext.trim_start_matches('.').to_lowercase();
        self.extension_templates.insert(clean_ext, template.to_string());
    }

    /// Overrides or registers a template with a given key (exact name, pattern, or extension).
    pub fn override_template(&mut self, key: &str, template: &str) {
        if self.exact_templates.contains_key(key) {
            self.register_exact(key, template);
        } else if self.pattern_templates.iter().any(|(p, _)| p == key) || key.contains('*') {
            self.register_pattern(key, template);
        } else if self.extension_templates.contains_key(key) {
            self.register_extension(key, template);
        } else if key.starts_with('.') {
            // e.g. ".gitignore"
            self.register_exact(key, template);
        } else {
            // Default to extension if it looks like an extension, otherwise exact
            if key.contains('.') {
                self.register_exact(key, template);
            } else {
                self.register_extension(key, template);
            }
        }
    }

    /// Loads user override templates from a directory (e.g. `<config_dir>/templates/`).
    /// User templates with the same key override the built-in templates.
    pub fn load_user_overrides(&mut self, dir: &Path) -> Result<usize, String> {
        if !dir.exists() || !dir.is_dir() {
            return Ok(0);
        }

        let entries = fs::read_dir(dir).map_err(|e| format!("Failed to read user templates directory: {}", e))?;
        let mut count = 0;

        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }

            let file_name = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();

            if file_name.is_empty() {
                continue;
            }

            let key = if let Some(stripped) = file_name.strip_suffix(".tmpl") {
                stripped
            } else {
                &file_name
            };

            if let Ok(content) = fs::read_to_string(&path) {
                self.override_template(key, &content);
                count += 1;
            }
        }

        Ok(count)
    }

    /// Resolves a template for a file name using the required lookup order:
    /// 1. Exact file name (Dockerfile, Makefile, package.json, .gitignore, Cargo.toml)
    /// 2. Pattern match (*.test.js, *.spec.ts, *.module.css, *.controller.js)
    /// 3. File extension (jsx, py, rs, ...)
    /// 4. Fallback: None
    pub fn resolve(&self, file_name: &str) -> Option<ResolvedTemplate> {
        let base_file_name = Path::new(file_name)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| file_name.to_string());

        // 1. Exact file name match
        if let Some(tmpl) = self.exact_templates.get(&base_file_name) {
            return Some(ResolvedTemplate {
                template: tmpl.clone(),
                matched_suffix: None,
                key: base_file_name,
            });
        }

        // 2. Pattern match (*.test.js, etc.)
        for (pattern, tmpl) in &self.pattern_templates {
            if pattern.starts_with("*.") {
                let suffix = &pattern[1..]; // e.g. ".test.js"
                if base_file_name.ends_with(suffix) && base_file_name.len() > suffix.len() {
                    return Some(ResolvedTemplate {
                        template: tmpl.clone(),
                        matched_suffix: Some(suffix.to_string()),
                        key: pattern.clone(),
                    });
                }
            } else if let Some(suffix) = pattern.strip_prefix('*')
                && base_file_name.ends_with(suffix)
            {
                return Some(ResolvedTemplate {
                    template: tmpl.clone(),
                    matched_suffix: Some(suffix.to_string()),
                    key: pattern.clone(),
                });
            }
        }

        // 3. File extension match
        let path = Path::new(&base_file_name);
        if let Some(ext) = path.extension() {
            let ext_str = ext.to_string_lossy().to_lowercase();
            if let Some(tmpl) = self.extension_templates.get(&ext_str) {
                // Find suffix including the dot
                let suffix = if base_file_name.ends_with(&format!(".{}", ext_str)) {
                    Some(ext_str.clone())
                } else {
                    None
                };
                let key = self
                    .extension_templates
                    .get_key_value(&ext_str)
                    .map(|(k, _)| k.clone())
                    .unwrap_or_else(|| ext_str.clone());
                return Some(ResolvedTemplate {
                    template: tmpl.clone(),
                    matched_suffix: suffix,
                    key,
                });
            }
        }

        // 4. Fallback: None
        None
    }

    /// Renders the template for `file_name` with custom date and year strings.
    pub fn render_with_date(&self, file_name: &str, date_str: &str, year_str: &str) -> Option<RenderedTemplate> {
        let resolved = self.resolve(file_name)?;
        let suffix_with_dot = resolved.matched_suffix.map(|s| {
            if s.starts_with('.') {
                s
            } else {
                format!(".{}", s)
            }
        });

        let (content, cursor_offset) = replace_placeholders(
            &resolved.template,
            file_name,
            suffix_with_dot.as_deref(),
            date_str,
            year_str,
        );

        Some(RenderedTemplate {
            content,
            cursor_offset,
        })
    }

    /// Pure render function: resolves template and replaces all placeholders using current local date/year.
    pub fn render(&self, file_name: &str) -> Option<RenderedTemplate> {
        let now = chrono::Local::now();
        let date_str = now.format("%Y-%m-%d").to_string();
        let year_str = now.format("%Y").to_string();
        self.render_with_date(file_name, &date_str, &year_str)
    }
}
