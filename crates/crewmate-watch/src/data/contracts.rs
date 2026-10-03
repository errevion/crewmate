#![allow(dead_code)]

use serde::Deserialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

fn default_version() -> String {
    "1.0.0".to_string()
}

fn default_status() -> String {
    "final".to_string()
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct ModuleIndexEntry {
    pub name: String,
    #[serde(default)]
    pub responsibility: String,
    #[serde(default)]
    pub path: String,
    #[serde(default = "default_version")]
    pub version: String,
    #[serde(default)]
    pub public_surface: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct IndexManifest {
    #[serde(default = "default_version")]
    pub version: String,
    #[serde(default)]
    pub modules: Vec<ModuleIndexEntry>,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct ModuleArchEntry {
    #[serde(default)]
    pub responsibility: Option<String>,
    #[serde(default)]
    pub allowed_dependencies: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct ArchitectureDef {
    #[serde(default = "default_version")]
    pub version: String,
    #[serde(default)]
    pub modules: HashMap<String, ModuleArchEntry>,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct CapabilityEntry {
    pub name: String,
    pub module: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub entrypoint: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct CapabilitiesDef {
    #[serde(default)]
    pub capabilities: Vec<CapabilityEntry>,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct PublicApiExport {
    pub export: String,
    #[serde(default)]
    pub file: String,
    #[serde(default)]
    pub signature: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct ModuleContract {
    pub module: String,
    #[serde(default = "default_status")]
    pub status: String,
    #[serde(default = "default_version")]
    pub version: String,
    #[serde(default)]
    pub public_api: Vec<PublicApiExport>,
    #[serde(default)]
    pub invariants: Vec<String>,
    #[serde(default)]
    pub declared_consumers: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ContractsSubView {
    #[default]
    Modules,
    Architecture,
    Capabilities,
}

#[derive(Debug, Clone, Default)]
pub struct ContractsSnapshot {
    pub index: IndexManifest,
    pub architecture: ArchitectureDef,
    pub capabilities: CapabilitiesDef,
    pub module_contracts: HashMap<String, ModuleContract>,
    pub loaded: bool,
}

impl ContractsSnapshot {
    pub fn load_from_root(project_root: &Path) -> Self {
        let mut snapshot = ContractsSnapshot::default();

        // 1. Locate contracts root directory
        let contracts_dir_candidates = [
            project_root.join(".crewmate").join("contracts"),
            project_root.join("contracts"),
        ];

        let contracts_dir = contracts_dir_candidates.into_iter().find(|d| d.is_dir());

        let contracts_dir = match contracts_dir {
            Some(dir) => dir,
            None => return snapshot,
        };

        snapshot.loaded = true;

        // 2. Parse index.yaml / index.yml
        if let Some(index_path) = find_file_in_dir(&contracts_dir, &["index.yaml", "index.yml"]) {
            if let Ok(content) = fs::read_to_string(&index_path) {
                if let Ok(manifest) = serde_yaml::from_str::<IndexManifest>(&content) {
                    snapshot.index = manifest;
                }
            }
        }

        // 3. Parse architecture.yaml / architecture.yml
        if let Some(arch_path) =
            find_file_in_dir(&contracts_dir, &["architecture.yaml", "architecture.yml"])
        {
            if let Ok(content) = fs::read_to_string(&arch_path) {
                if let Ok(arch) = serde_yaml::from_str::<ArchitectureDef>(&content) {
                    snapshot.architecture = arch;
                }
            }
        }

        // 4. Parse capabilities.yaml / capabilities.yml
        if let Some(caps_path) =
            find_file_in_dir(&contracts_dir, &["capabilities.yaml", "capabilities.yml"])
        {
            if let Ok(content) = fs::read_to_string(&caps_path) {
                if let Ok(caps) = serde_yaml::from_str::<CapabilitiesDef>(&content) {
                    snapshot.capabilities = caps;
                }
            }
        }

        // 5. Scan modules directory for *.contract.yaml
        let modules_dir = contracts_dir.join("modules");
        if modules_dir.is_dir() {
            if let Ok(entries) = fs::read_dir(&modules_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_file() {
                        let fname = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                        if fname.ends_with(".contract.yaml") || fname.ends_with(".contract.yml") {
                            if let Ok(content) = fs::read_to_string(&path) {
                                if let Ok(mc) = serde_yaml::from_str::<ModuleContract>(&content) {
                                    snapshot.module_contracts.insert(mc.module.clone(), mc);
                                }
                            }
                        }
                    }
                }
            }
        }

        snapshot
    }
}

fn find_file_in_dir(dir: &Path, filenames: &[&str]) -> Option<PathBuf> {
    for &name in filenames {
        let p = dir.join(name);
        if p.is_file() {
            return Some(p);
        }
    }
    None
}
