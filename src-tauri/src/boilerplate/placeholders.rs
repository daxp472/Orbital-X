/// Splits a string (e.g. file stem) into individual words.
/// Handles kebab-case (`user-card`), snake_case (`my_file`), camelCase (`userCard`),
/// PascalCase (`UserCard`), dot-separated, and space-separated names.
pub fn split_into_words(s: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut current_word = String::new();
    let chars: Vec<char> = s.chars().collect();
    let len = chars.len();

    for i in 0..len {
        let c = chars[i];
        if c == '-' || c == '_' || c == '.' || c == ' ' || c == '/' || c == '\\' {
            if !current_word.is_empty() {
                words.push(current_word.clone());
                current_word.clear();
            }
            continue;
        }

        if c.is_uppercase() {
            let prev_is_lower = i > 0 && chars[i - 1].is_lowercase();
            let next_is_lower = i + 1 < len && chars[i + 1].is_lowercase();
            let prev_is_upper = i > 0 && chars[i - 1].is_uppercase();

            if (prev_is_lower || (prev_is_upper && next_is_lower)) && !current_word.is_empty() {
                words.push(current_word.clone());
                current_word.clear();
            }
        }

        current_word.push(c);
    }

    if !current_word.is_empty() {
        words.push(current_word);
    }

    words
}

pub fn to_pascal_case(words: &[String]) -> String {
    words
        .iter()
        .map(|w| {
            let mut chars = w.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>() + &chars.as_str().to_lowercase(),
                None => String::new(),
            }
        })
        .collect()
}

pub fn to_camel_case(words: &[String]) -> String {
    let pascal = to_pascal_case(words);
    let mut chars = pascal.chars();
    match chars.next() {
        Some(first) => first.to_lowercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}

pub fn to_snake_case(words: &[String]) -> String {
    words
        .iter()
        .map(|w| w.to_lowercase())
        .collect::<Vec<_>>()
        .join("_")
}

/// Extracts the base name without extension/matched pattern suffix.
/// E.g.
/// - `user-card.jsx` with suffix `.jsx` -> `user-card`
/// - `user-card.test.js` with suffix `.test.js` -> `user-card`
/// - `Dockerfile` -> `Dockerfile`
/// - `.gitignore` -> `.gitignore`
pub fn extract_base_name(file_name: &str, matched_suffix: Option<&str>) -> String {
    let clean_name = std::path::Path::new(file_name)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| file_name.to_string());

    if let Some(suffix) = matched_suffix
        && let Some(stripped) = clean_name.strip_suffix(suffix)
        && !stripped.is_empty()
    {
        return stripped.to_string();
    }

    // Default to path file_stem or entire file_name
    let path = std::path::Path::new(&clean_name);
    if let Some(stem) = path.file_stem() {
        let stem_str = stem.to_string_lossy();
        if !stem_str.is_empty() {
            return stem_str.to_string();
        }
    }

    clean_name
}

/// Replaces placeholders in the template:
/// - `{{FileName}}`: base name without extension
/// - `{{PascalCase}}`: e.g. user-card.jsx -> UserCard
/// - `{{snake_case}}` and `{{camelCase}}`
/// - `{{Date}}` and `{{Year}}`
/// - `{{cursor}}`: stripped from the text; returns the caret offset
pub fn replace_placeholders(
    template: &str,
    file_name: &str,
    matched_suffix: Option<&str>,
    date_str: &str,
    year_str: &str,
) -> (String, Option<usize>) {
    let base_name = extract_base_name(file_name, matched_suffix);
    let words = split_into_words(&base_name);

    let pascal_case = to_pascal_case(&words);
    let camel_case = to_camel_case(&words);
    let snake_case = to_snake_case(&words);

    let mut rendered = template
        .replace("{{FileName}}", &base_name)
        .replace("{{PascalCase}}", &pascal_case)
        .replace("{{camelCase}}", &camel_case)
        .replace("{{snake_case}}", &snake_case)
        .replace("{{Date}}", date_str)
        .replace("{{Year}}", year_str);

    let cursor_offset = rendered.find("{{cursor}}").inspect(|&idx| {
        rendered.replace_range(idx..idx + "{{cursor}}".len(), "");
    });

    (rendered, cursor_offset)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_split_and_case_conversions() {
        let words = split_into_words("user-card");
        assert_eq!(words, vec!["user", "card"]);
        assert_eq!(to_pascal_case(&words), "UserCard");
        assert_eq!(to_camel_case(&words), "userCard");
        assert_eq!(to_snake_case(&words), "user_card");

        let words2 = split_into_words("my_file");
        assert_eq!(words2, vec!["my", "file"]);
        assert_eq!(to_pascal_case(&words2), "MyFile");
        assert_eq!(to_camel_case(&words2), "myFile");
        assert_eq!(to_snake_case(&words2), "my_file");

        let words3 = split_into_words("UserCard");
        assert_eq!(words3, vec!["User", "Card"]);
        assert_eq!(to_pascal_case(&words3), "UserCard");
        assert_eq!(to_camel_case(&words3), "userCard");
        assert_eq!(to_snake_case(&words3), "user_card");
    }

    #[test]
    fn test_extract_base_name() {
        assert_eq!(extract_base_name("user-card.jsx", Some(".jsx")), "user-card");
        assert_eq!(extract_base_name("user-card.test.js", Some(".test.js")), "user-card");
        assert_eq!(extract_base_name("Dockerfile", None), "Dockerfile");
        assert_eq!(extract_base_name(".gitignore", None), ".gitignore");
    }

    #[test]
    fn test_replace_placeholders_with_cursor() {
        let tmpl = "class {{PascalCase}} {\n  {{cursor}}\n}\n// Date: {{Date}}, Year: {{Year}}, File: {{FileName}}";
        let (rendered, cursor) = replace_placeholders(tmpl, "user-card.js", Some(".js"), "2026-10-30", "2026");

        assert_eq!(cursor, Some("class UserCard {\n  ".len()));
        assert!(!rendered.contains("{{cursor}}"));
        assert!(rendered.contains("class UserCard {\n  \n}"));
        assert!(rendered.contains("// Date: 2026-10-30, Year: 2026, File: user-card"));
    }

    #[test]
    fn test_replace_placeholders_without_cursor() {
        let tmpl = "Hello {{PascalCase}}";
        let (rendered, cursor) = replace_placeholders(tmpl, "world", None, "2026-10-30", "2026");
        assert_eq!(cursor, None);
        assert_eq!(rendered, "Hello World");
    }
}
