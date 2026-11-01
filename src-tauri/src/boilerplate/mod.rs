pub mod placeholders;
pub mod registry;
pub mod settings;

pub use registry::{RenderedTemplate, TemplateRegistry};
pub use settings::BoilerplateSettings;

use std::path::Path;
use std::sync::{LazyLock, Mutex};

/// Global singleton registry initialized with built-in default templates and user overrides.
pub static GLOBAL_REGISTRY: LazyLock<Mutex<TemplateRegistry>> = LazyLock::new(|| {
    let mut reg = TemplateRegistry::default_built_in();
    let user_dir = settings::user_templates_dir();
    let _ = reg.load_user_overrides(&user_dir);
    Mutex::new(reg)
});

/// Pure function that renders a boilerplate template for `file_name`.
/// Returns `Option<RenderedTemplate>` with content and optional cursor offset.
pub fn render(file_name: &str) -> Option<RenderedTemplate> {
    if let Ok(reg) = GLOBAL_REGISTRY.lock() {
        reg.render(file_name)
    } else {
        None
    }
}

/// Renders boilerplate for a file path while respecting global and per-language settings.
pub fn render_for_path_with_settings(path: &Path, settings: &BoilerplateSettings) -> Option<RenderedTemplate> {
    if !settings.enabled {
        return None;
    }

    let file_name = path.file_name()?.to_str()?;

    // Check language / extension against disabled_languages
    if let Some(ext) = path.extension().and_then(|e| e.to_str())
        && !settings.is_enabled_for(ext)
    {
        return None;
    }
    if !settings.is_enabled_for(file_name) {
        return None;
    }

    render(file_name)
}

/// Renders boilerplate for a file path using saved boilerplate settings.
pub fn render_for_path(path: &Path) -> Option<RenderedTemplate> {
    let settings = settings::load_settings_from_disk();
    render_for_path_with_settings(path, &settings)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_extension_lookup() {
        let reg = TemplateRegistry::default_built_in();

        // jsx
        let rendered_jsx = reg.render("user-card.jsx").expect("Should find jsx template");
        assert!(rendered_jsx.content.contains("export default function UserCard()"));
        assert!(rendered_jsx.cursor_offset.is_some());

        // py
        let rendered_py = reg.render("script.py").expect("Should find py template");
        assert!(rendered_py.content.contains("def main():"));
        assert!(rendered_py.cursor_offset.is_some());

        // rs
        let rendered_rs = reg.render("my_tool.rs").expect("Should find rs template");
        assert!(rendered_rs.content.contains("pub fn my_tool()"));
        assert!(rendered_rs.content.contains("fn test_my_tool()"));
        assert!(rendered_rs.cursor_offset.is_some());

        // ts
        let rendered_ts = reg.render("helper.ts").expect("Should find ts template");
        assert!(rendered_ts.content.contains("helper"));

        // html
        let rendered_html = reg.render("index.html").expect("Should find html template");
        assert!(rendered_html.content.contains("<!DOCTYPE html>"));
        assert!(rendered_html.content.contains("<title>index</title>"));

        // c & cpp
        let rendered_c = reg.render("main.c").expect("Should find c template");
        assert!(rendered_c.content.contains("#include <stdio.h>"));

        let rendered_cpp = reg.render("main.cpp").expect("Should find cpp template");
        assert!(rendered_cpp.content.contains("#include <iostream>"));

        // go
        let rendered_go = reg.render("server.go").expect("Should find go template");
        assert!(rendered_go.content.contains("package main"));

        // json
        let rendered_json = reg.render("config.json").expect("Should find json template");
        assert!(rendered_json.content.contains('{'));

        // md
        let rendered_md = reg.render("README.md").expect("Should find md template");
        assert!(rendered_md.content.contains("# README"));

        // sh
        let rendered_sh = reg.render("deploy.sh").expect("Should find sh template");
        assert!(rendered_sh.content.contains("#!/usr/bin/env bash"));
    }

    #[test]
    fn test_exact_name_lookup() {
        let reg = TemplateRegistry::default_built_in();

        // Dockerfile
        let dockerfile = reg.render("Dockerfile").expect("Should find Dockerfile");
        assert!(dockerfile.content.contains("FROM alpine:latest"));

        // Makefile
        let makefile = reg.render("Makefile").expect("Should find Makefile");
        assert!(makefile.content.contains(".PHONY: all clean"));

        // package.json
        let pkg = reg.render("package.json").expect("Should find package.json");
        assert!(pkg.content.contains("\"version\": \"1.0.0\""));

        // .gitignore
        let gitignore = reg.render(".gitignore").expect("Should find .gitignore");
        assert!(gitignore.content.contains("node_modules/"));

        // Cargo.toml
        let cargo = reg.render("Cargo.toml").expect("Should find Cargo.toml");
        assert!(cargo.content.contains("[package]"));
    }

    #[test]
    fn test_pattern_lookup() {
        let reg = TemplateRegistry::default_built_in();

        // *.test.js
        let test_js = reg.render("user-card.test.js").expect("Should find *.test.js");
        assert!(test_js.content.contains("describe('UserCard'"));

        // *.spec.ts
        let spec_ts = reg.render("auth-service.spec.ts").expect("Should find *.spec.ts");
        assert!(spec_ts.content.contains("describe('AuthService'"));

        // *.module.css
        let module_css = reg.render("header.module.css").expect("Should find *.module.css");
        assert!(module_css.content.contains(".container"));

        // *.controller.js
        let controller_js = reg.render("user.controller.js").expect("Should find *.controller.js");
        assert!(controller_js.content.contains("export class UserController {"));
    }

    #[test]
    fn test_placeholder_replacement_cases() {
        let reg = TemplateRegistry::default_built_in();

        // kebab-case -> PascalCase
        let jsx1 = reg.render("user-card.jsx").unwrap();
        assert!(jsx1.content.contains("export default function UserCard()"));

        // snake_case -> PascalCase
        let jsx2 = reg.render("my_file.jsx").unwrap();
        assert!(jsx2.content.contains("export default function MyFile()"));

        // camelCase -> PascalCase
        let jsx3 = reg.render("userProfile.jsx").unwrap();
        assert!(jsx3.content.contains("export default function UserProfile()"));

        // Rust snake_case conversion for kebab-case filename
        let rs1 = reg.render("user-service.rs").unwrap();
        assert!(rs1.content.contains("pub fn user_service()"));
        assert!(rs1.content.contains("fn test_user_service()"));
    }

    #[test]
    fn test_unknown_extensions_fallback_empty() {
        let reg = TemplateRegistry::default_built_in();
        // Unknown file types get None (which translates to empty file without error)
        assert_eq!(reg.render("archive.xyz123"), None);
        assert_eq!(reg.render("unknown_binary.bin"), None);
        assert_eq!(reg.render("foo.unknownext"), None);
    }

    #[test]
    fn test_user_override_priority() {
        let mut reg = TemplateRegistry::default_built_in();

        // Built-in jsx
        let built_in = reg.render("Button.jsx").unwrap();
        assert!(built_in.content.contains("export default function Button()"));

        // Create temporary config dir with user override
        let temp = std::env::temp_dir().join(format!("orbital_tmpl_test_{}", std::process::id()));
        let _ = fs::create_dir_all(&temp);
        let user_jsx = temp.join("jsx.tmpl");
        fs::write(&user_jsx, "// Custom User JSX\nconst {{PascalCase}} = () => <{{cursor}}/>;\nexport default {{PascalCase}};").unwrap();

        let count = reg.load_user_overrides(&temp).unwrap();
        assert_eq!(count, 1);

        // Verify override took priority
        let overridden = reg.render("Button.jsx").unwrap();
        assert!(overridden.content.contains("// Custom User JSX"));
        assert!(overridden.content.contains("const Button = () => <"));
        assert!(overridden.cursor_offset.is_some());

        let _ = fs::remove_dir_all(&temp);
    }

    #[test]
    fn test_cursor_offset() {
        let mut reg = TemplateRegistry::new();
        reg.register_extension("custom", "prefix {{cursor}} suffix");

        let rendered = reg.render("test.custom").unwrap();
        assert_eq!(rendered.content, "prefix  suffix");
        assert_eq!(rendered.cursor_offset, Some(7));
    }

    #[test]
    fn test_lookup_order_priority() {
        let mut reg = TemplateRegistry::new();
        // Exact name takes precedence over pattern and extension
        reg.register_extension("js", "// extension js");
        reg.register_pattern("*.controller.js", "// pattern controller");
        reg.register_exact("special.controller.js", "// exact special");

        assert_eq!(reg.render("special.controller.js").unwrap().content, "// exact special");
        assert_eq!(reg.render("other.controller.js").unwrap().content, "// pattern controller");
        assert_eq!(reg.render("normal.js").unwrap().content, "// extension js");
    }
}
