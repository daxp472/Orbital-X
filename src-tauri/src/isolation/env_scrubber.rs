use std::collections::{HashMap, HashSet};

/// Policy for sanitizing environment variables passed to sandboxed child processes.
#[derive(Debug, Clone)]
pub struct EnvironmentScrubber {
    /// Variables that are strictly prohibited and scrubbed under all circumstances.
    blocked_prefixes: Vec<String>,
    blocked_exact: HashSet<String>,
    /// System and toolchain variables safe to inherit from host OS.
    allowed_inherit: HashSet<String>,
    /// Explicit overrides or mocked variables to inject.
    injected_vars: HashMap<String, String>,
}

impl Default for EnvironmentScrubber {
    fn default() -> Self {
        let blocked_prefixes = vec![
            "AWS_".into(),
            "AZURE_".into(),
            "GCP_".into(),
            "GOOGLE_".into(),
            "GITHUB_".into(),
            "GH_".into(),
            "OPENAI_".into(),
            "ANTHROPIC_".into(),
            "GEMINI_".into(),
            "OLLAMA_API_KEY".into(),
            "SSH_".into(),
            "GIT_ASKPASS".into(),
            "GIT_SSH".into(),
            "DOCKER_AUTH".into(),
            "KUBECONFIG".into(),
            "VAULT_".into(),
            "STRIPE_".into(),
        ];

        let mut blocked_exact = HashSet::new();
        for key in [
            "API_KEY",
            "SECRET_KEY",
            "ACCESS_TOKEN",
            "PASSWORD",
            "PRIVATE_KEY",
            "ID_RSA",
            "DB_PASSWORD",
            "DATABASE_URL",
            "HEROKU_API_KEY",
            "NPM_TOKEN",
            "CARGO_REGISTRY_TOKEN",
        ] {
            blocked_exact.insert(key.to_string());
        }

        let mut allowed_inherit = HashSet::new();
        for key in [
            "PATH",
            "PATHEXT",
            "SYSTEMROOT",
            "WINDIR",
            "TEMP",
            "TMP",
            "USERPROFILE",
            "HOME",
            "LANG",
            "LC_ALL",
            "TERM",
            "COLORTERM",
            "CARGO_HOME",
            "RUSTUP_HOME",
            "NODE_PATH",
            "NVM_DIR",
            "PYENV_ROOT",
            "GOPATH",
            "GOROOT",
            "NUMBER_OF_PROCESSORS",
            "PROCESSOR_ARCHITECTURE",
            "OS",
            "COMSPEC",
            "PSModulePath",
        ] {
            allowed_inherit.insert(key.to_string());
        }

        Self {
            blocked_prefixes,
            blocked_exact,
            allowed_inherit,
            injected_vars: HashMap::new(),
        }
    }
}

impl EnvironmentScrubber {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_injected(mut self, key: impl Into<String>, val: impl Into<String>) -> Self {
        self.injected_vars.insert(key.into(), val.into());
        self
    }

    /// Tests whether a specific variable name is permitted to pass into the sandbox.
    pub fn is_variable_allowed(&self, var_name: &str) -> bool {
        let upper = var_name.to_ascii_uppercase();

        // 1. Exact blocklist check
        if self.blocked_exact.contains(&upper) {
            return false;
        }

        // 2. Prefix blocklist check
        for prefix in &self.blocked_prefixes {
            if upper.starts_with(prefix) {
                return false;
            }
        }

        // 3. Generic secret keyword scan (e.g. MY_AWS_SECRET, USER_TOKEN_KEY)
        if upper.contains("SECRET")
            || upper.contains("TOKEN")
            || upper.contains("PASSWORD")
            || upper.contains("CREDENTIAL")
            || upper.contains("PRIVATE_KEY")
        {
            return false;
        }

        // 4. Must match allowed inherit whitelist
        self.allowed_inherit.contains(&upper)
    }

    /// Produces a sanitized environment map suitable for passing to `tokio::process::Command::envs`.
    pub fn sanitize_host_environment(&self) -> HashMap<String, String> {
        let mut clean = HashMap::new();

        for (k, v) in std::env::vars() {
            if self.is_variable_allowed(&k) {
                clean.insert(k, v);
            }
        }

        // Inject sandbox identity flags
        clean.insert("ORBITAL_SANDBOX".into(), "1".into());
        clean.insert("ORBITAL_ISOLATION_LEVEL".into(), "hardened".into());
        clean.insert("CI".into(), "true".into());

        for (k, v) in &self.injected_vars {
            clean.insert(k.clone(), v.clone());
        }

        clean
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_scrubber_blocks_cloud_and_api_keys() {
        let scrubber = EnvironmentScrubber::new();

        assert!(!scrubber.is_variable_allowed("AWS_SECRET_ACCESS_KEY"));
        assert!(!scrubber.is_variable_allowed("GITHUB_TOKEN"));
        assert!(!scrubber.is_variable_allowed("OPENAI_API_KEY"));
        assert!(!scrubber.is_variable_allowed("ANTHROPIC_KEY"));
        assert!(!scrubber.is_variable_allowed("MY_CUSTOM_SECRET_KEY"));
        assert!(!scrubber.is_variable_allowed("DATABASE_URL"));
    }

    #[test]
    fn test_scrubber_permits_safe_toolchains() {
        let scrubber = EnvironmentScrubber::new();

        assert!(scrubber.is_variable_allowed("PATH"));
        assert!(scrubber.is_variable_allowed("TEMP"));
        assert!(scrubber.is_variable_allowed("CARGO_HOME"));
        assert!(scrubber.is_variable_allowed("NODE_PATH"));
    }

    #[test]
    fn test_sanitized_map_injects_sandbox_flags() {
        let scrubber = EnvironmentScrubber::new().with_injected("TEST_KEY", "TEST_VAL");
        let env_map = scrubber.sanitize_host_environment();

        assert_eq!(env_map.get("ORBITAL_SANDBOX").map(|s| s.as_str()), Some("1"));
        assert_eq!(env_map.get("TEST_KEY").map(|s| s.as_str()), Some("TEST_VAL"));
        assert!(!env_map.contains_key("AWS_SECRET_ACCESS_KEY"));
    }
}

