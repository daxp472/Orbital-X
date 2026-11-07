use super::types::ProjectToolchain;
use std::path::Path;

pub struct ToolchainDetector;

pub struct ToolchainCommand {
    pub toolchain: ProjectToolchain,
    pub executable: &'static str,
    pub args: Vec<&'static str>,
}

impl ToolchainDetector {
    /// Inspects the workspace root and detects the appropriate compiler/linter check command.
    pub fn detect_toolchain(workspace_root: &Path) -> ToolchainCommand {
        if workspace_root.join("Cargo.toml").exists() {
            return ToolchainCommand {
                toolchain: ProjectToolchain::RustCargo,
                executable: "cargo",
                args: vec!["check", "--message-format=json"],
            };
        }

        if workspace_root.join("tsconfig.json").exists() {
            return ToolchainCommand {
                toolchain: ProjectToolchain::NodeTypeScript,
                #[cfg(target_os = "windows")]
                executable: "npx.cmd",
                #[cfg(not(target_os = "windows"))]
                executable: "npx",
                args: vec!["tsc", "--noEmit", "--pretty", "false"],
            };
        }

        if workspace_root.join("package.json").exists() {
            return ToolchainCommand {
                toolchain: ProjectToolchain::NodeJavaScript,
                #[cfg(target_os = "windows")]
                executable: "npm.cmd",
                #[cfg(not(target_os = "windows"))]
                executable: "npm",
                args: vec!["run", "build", "--if-present"],
            };
        }

        if workspace_root.join("pyproject.toml").exists()
            || workspace_root.join("requirements.txt").exists()
            || workspace_root.join("setup.py").exists()
        {
            return ToolchainCommand {
                toolchain: ProjectToolchain::Python,
                executable: "python",
                args: vec!["-m", "py_compile"],
            };
        }

        if workspace_root.join("go.mod").exists() {
            return ToolchainCommand {
                toolchain: ProjectToolchain::Go,
                executable: "go",
                args: vec!["vet", "./..."],
            };
        }

        ToolchainCommand {
            toolchain: ProjectToolchain::Generic,
            executable: "echo",
            args: vec!["No specific compiler check configured"],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detector_identifies_rust_cargo() {
        let temp_dir = std::env::temp_dir().join(format!("orbital_detect_rust_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        std::fs::write(temp_dir.join("Cargo.toml"), "[package]\nname = \"test\"\n").unwrap();

        let cmd = ToolchainDetector::detect_toolchain(&temp_dir);
        assert_eq!(cmd.toolchain, ProjectToolchain::RustCargo);
        assert_eq!(cmd.executable, "cargo");

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_detector_identifies_typescript() {
        let temp_dir = std::env::temp_dir().join(format!("orbital_detect_ts_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        std::fs::write(temp_dir.join("tsconfig.json"), "{}\n").unwrap();

        let cmd = ToolchainDetector::detect_toolchain(&temp_dir);
        assert_eq!(cmd.toolchain, ProjectToolchain::NodeTypeScript);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}

