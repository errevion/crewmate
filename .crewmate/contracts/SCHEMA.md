# Crewmate Contract System Specification (`SCHEMA.md`)

This document is the authoritative schema reference for Crewmate architectural contracts.
All subagents (Scout, Planner, Builder, Contractor, Verifier) and Matte (Orchestrator) must adhere to these schemas and conventions when discovering, authoring, implementing, or reconciling contracts.

---

## 1. Directory Structure

All contract definitions are stored in `.crewmate/contracts/`:

```
.crewmate/contracts/
├── index.yaml                  # System Module Manifest (Tier 0)
├── architecture.yaml           # Module Dependency & Boundary Rules (Tier 2)
├── structure.yaml              # Repository Structure & Forbidden Paths (Tier 2)
├── capabilities.yaml           # High-Level Feature Catalog (Tier 0)
├── SCHEMA.md                   # This Schema Reference Specification
└── modules/                    # Per-Module Scoped Contracts (Tier 1)
    └── <module>.contract.yaml  # e.g. auth.contract.yaml, users.contract.yaml
```

---

## 2. Module Contract (`modules/<module>.contract.yaml`)

Each module declared in `index.yaml` must have a corresponding contract file at `.crewmate/contracts/modules/<module>.contract.yaml`.

### Fields

- **`module`** (`string`, required): Unique module name. Must match an entry `name` in `index.yaml`.
- **`status`** (`"draft" | "final"`, optional, default: `"final"`):
  - `draft`: Authored during the **Plan** phase by the **Planner** subagent. Draft contracts specify planned future APIs, invariants, and consumer permissions before code is written.
  - `final`: Reconciled during the **Contract** phase by the **Contractor** subagent. Final contracts reflect actual, verified source code exports and signatures.
- **`version`** (`string`, optional, default: `"1.0.0"`): Semantic version of the module contract.
- **`public_api`** (`array`, optional, default: `[]`): Exhaustive list of public symbols exported by this module.
  - `export` (`string`, required): Name of the exported function, class, type, interface, or constant.
  - `signature` (`string`, optional): Type signature (e.g. `(id: string) => Promise<User>`).
  - `file` (`string`, required): Relative source path declaring the export (e.g. `src/auth/service.ts`).
  - `description` (`string`, optional): Plain-language summary of what the export does.
- **`invariants`** (`string[]`, optional, default: `[]`): Domain rules, safety constraints, or behavioral guarantees that must never be broken.
- **`declared_consumers`** (`string[]`, optional, default: `[]`): Names of other modules permitted to import from this module.

### Example Contract (`modules/auth.contract.yaml`)

```yaml
module: auth
status: final
version: "1.0.0"
public_api:
  - export: authenticateUser
    signature: "(creds: Credentials) => Promise<SessionToken>"
    file: src/auth/service.ts
    description: Authenticates credentials and returns a signed session token.
  - export: verifyToken
    signature: "(token: string) => Promise<UserIdentity>"
    file: src/auth/tokens.ts
    description: Cryptographically verifies a session token.
invariants:
  - "Passwords must never be stored in plain text."
  - "Session tokens expire after 24 hours."
declared_consumers:
  - api-gateway
  - billing
```

---

## 3. Module Index Manifest (`index.yaml`)

Defines the system-wide catalog of all architectural modules.

### Fields

- **`version`** (`string`, optional, default: `"1.0.0"`): Schema version.
- **`modules`** (`array`, default: `[]`):
  - `name` (`string`, required): Module identifier (must match contract file name: `<name>.contract.yaml`).
  - `responsibility` (`string`, required): High-level summary of module domain and scope.
  - `path` (`string`, required): Relative filesystem path to the module directory (e.g. `src/auth`).
  - `version` (`string`, optional, default: `"1.0.0"`): Semantic version.
  - `public_surface` (`string[]`, optional, default: `[]`): File paths defining the public entrypoints (e.g. `["src/auth/index.ts"]`).

### Example (`index.yaml`)

```yaml
version: "1.0.0"
modules:
  - name: auth
    responsibility: User authentication, sessions, and credential verification
    path: src/auth
    version: "1.0.0"
    public_surface:
      - src/auth/index.ts
```

---

## 4. Architecture Rules (`architecture.yaml`)

Defines allowed inter-module dependencies and boundaries. Enforced via AST scanner (`crewmate_scan_arch`).

### Fields

- **`version`** (`string`, optional, default: `"1.0.0"`): Schema version.
- **`modules`** (`record<string, object>`, default: `{}`):
  - `<module-name>`:
    - `responsibility` (`string`, optional): Summary of responsibility.
    - `allowed_dependencies` (`string[]`, default: `[]`): List of modules that this module is permitted to import.

### Boundary Rules
- A module may **only** import from modules explicitly listed in its `allowed_dependencies`.
- Any undeclared cross-module import is flagged as an architectural boundary violation.

### Example (`architecture.yaml`)

```yaml
version: "1.0.0"
modules:
  auth:
    responsibility: Authentication
    allowed_dependencies: []
  billing:
    responsibility: Billing
    allowed_dependencies:
      - auth
```

---

## 5. Structure Rules (`structure.yaml`)

Enforces repository conventions and directory boundaries.

### Fields

- **`version`** (`string`, optional, default: `"1.0.0"`): Schema version.
- **`roots`** (`string[]`, default: `["src"]`): Root source code directories.
- **`naming`** (`object`):
  - `modules` (`string`, optional): Directory naming style (e.g. `"kebab-case"`).
  - `files` (`string`, optional): File naming style (e.g. `"kebab-case"`).
- **`forbidden_patterns`** (`string[]`, default: `[]`): Glob patterns where file modifications are blocked by plugin guardrails.

---

## 6. Capabilities Catalog (`capabilities.yaml`)

Declares user-facing system capabilities and maps them to modules and entrypoints.

### Fields

- **`capabilities`** (`array`, default: `[]`):
  - `name` (`string`, required): Unique capability identifier (e.g. `user-authentication`).
  - `module` (`string`, required): Module providing this capability.
  - `description` (`string`, required): Plain-language summary of what the capability provides.
  - `entrypoint` (`string`, optional): Entrypoint reference (e.g. `src/auth/index.ts:authenticateUser`).

---

## 7. Workflow Phase Responsibilities

| Role | Phase | Scope | Contract Responsibilities |
|---|---|---|---|
| **Scout** | `scout` | `read-only` | Read contracts in `.crewmate/contracts/` (referencing `SCHEMA.md`) to understand existing modules, boundaries, and dependencies. |
| **Clarifier (Matte)** | `clarify` | `read-only` | Review scout discovery findings, ask the user targeted clarifying questions informed by codebase context, synthesize a structured requirements summary. |
| **Planner** | `plan` | `contracts-write` | Author future contracts (`status: draft`) conforming to `SCHEMA.md` for new modules, update `index.yaml` and `architecture.yaml`, break work into atomic tasks referencing contracts. |
| **Builder** | `execute` | `implementation` | Claim atomic file locks (`crewmate_task_start`), implement code conforming strictly to module contracts and public APIs. |
| **Contractor** | `contract` | `contracts-write` | Reconcile draft contracts with actual implementation, update signatures, add new exports, flip `status: draft` → `status: final` conforming to `SCHEMA.md`. |
| **Verifier** | `verify` | `read-only` | Run test suites, scan architecture boundaries (`crewmate_scan_arch`), and scan dead code (`crewmate_scan_dead_code`). |
