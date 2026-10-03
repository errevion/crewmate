import { z } from "zod";

export const ModuleIndexEntrySchema = z.object({
  name: z.string().min(1),
  responsibility: z.string().min(1),
  path: z.string().min(1),
  version: z.string().default("1.0.0"),
  public_surface: z.array(z.string()).default([]),
});

export type ModuleIndexEntry = z.infer<typeof ModuleIndexEntrySchema>;

export const IndexManifestSchema = z.object({
  version: z.string().default("1.0.0"),
  modules: z.array(ModuleIndexEntrySchema).default([]),
});

export type IndexManifest = z.infer<typeof IndexManifestSchema>;

export const ModuleArchEntrySchema = z.object({
  responsibility: z.string().optional(),
  allowed_dependencies: z.array(z.string()).default([]),
});

export type ModuleArchEntry = z.infer<typeof ModuleArchEntrySchema>;

export const ArchitectureSchema = z.object({
  version: z.string().default("1.0.0"),
  modules: z.record(z.string(), ModuleArchEntrySchema).default({}),
});

export type Architecture = z.infer<typeof ArchitectureSchema>;

export const StructureNamingSchema = z.object({
  modules: z.string().optional(),
  files: z.string().optional(),
  components: z.string().optional(),
});

export const StructureSchema = z.object({
  version: z.string().default("1.0.0"),
  roots: z.array(z.string()).default(["src"]),
  naming: StructureNamingSchema.default({}),
  forbidden_patterns: z.array(z.string()).default([]),
});

export type Structure = z.infer<typeof StructureSchema>;

export const CapabilityEntrySchema = z.object({
  name: z.string().min(1),
  module: z.string().min(1),
  description: z.string().min(1),
  entrypoint: z.string().optional(),
});

export type CapabilityEntry = z.infer<typeof CapabilityEntrySchema>;

export const CapabilitiesSchema = z.object({
  capabilities: z.array(CapabilityEntrySchema).default([]),
});

export type Capabilities = z.infer<typeof CapabilitiesSchema>;

export const PublicApiExportSchema = z.object({
  export: z.string().min(1),
  signature: z.string().optional(),
  file: z.string().min(1),
  description: z.string().optional(),
});

export type PublicApiExport = z.infer<typeof PublicApiExportSchema>;

export const ModuleContractSchema = z.object({
  module: z.string().min(1),
  status: z.enum(["draft", "final"]).default("final"),
  version: z.string().default("1.0.0"),
  public_api: z.array(PublicApiExportSchema).default([]),
  invariants: z.array(z.string()).default([]),
  declared_consumers: z.array(z.string()).default([]),
});

export type ModuleContract = z.infer<typeof ModuleContractSchema>;
