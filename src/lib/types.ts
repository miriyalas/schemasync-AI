export type Engine = "sqlserver" | "oracle";

export interface ConnectionInput {
  engine: Engine;
  /** Display name, e.g. "DEV" or "SIT". */
  label: string;
  host: string;
  port?: number;
  /** SQL Server database name. */
  database?: string;
  /** Oracle service name (e.g. ORCLPDB1). */
  serviceName?: string;
  /** Oracle schema (owner) to compare. Defaults to the login user. */
  schema?: string;
  user: string;
  password: string;
  /** SQL Server: encrypt the connection (default true). */
  encrypt?: boolean;
  /** SQL Server: accept self-signed certificates (default true). */
  trustServerCertificate?: boolean;
}

export type ObjectType =
  | "Table"
  | "Column"
  | "PrimaryKey"
  | "UniqueConstraint"
  | "ForeignKey"
  | "CheckConstraint"
  | "Index"
  | "View"
  | "StoredProcedure"
  | "Function"
  | "Trigger"
  | "TableType"
  | "TableTypeColumn"
  | "Sequence"
  | "Synonym"
  | "Package"
  | "PackageBody";

export const TYPE_LABELS: Record<ObjectType, string> = {
  Table: "Table",
  Column: "Column",
  PrimaryKey: "Primary key",
  UniqueConstraint: "Unique constraint",
  ForeignKey: "Foreign key",
  CheckConstraint: "Check constraint",
  Index: "Index",
  View: "View",
  StoredProcedure: "Stored procedure",
  Function: "Function",
  Trigger: "Trigger",
  TableType: "Table type",
  TableTypeColumn: "Table type column",
  Sequence: "Sequence",
  Synonym: "Synonym",
  Package: "Package",
  PackageBody: "Package body",
};

/** Order used for sorting results and for the deployment script. */
export const TYPE_ORDER: ObjectType[] = [
  "TableType",
  "TableTypeColumn",
  "Sequence",
  "Table",
  "Column",
  "PrimaryKey",
  "UniqueConstraint",
  "CheckConstraint",
  "Index",
  "Function",
  "View",
  "StoredProcedure",
  "Trigger",
  "Package",
  "PackageBody",
  "ForeignKey",
  "Synonym",
];

export const CODE_TYPES: ObjectType[] = ["View", "StoredProcedure", "Function", "Trigger", "Package", "PackageBody"];

/** Checkbox groups shown on the New comparison screen. */
export const TYPE_GROUPS: { id: string; label: string; types: ObjectType[] }[] = [
  { id: "tables", label: "Tables & columns", types: ["Table", "Column"] },
  { id: "keys", label: "Primary & unique keys", types: ["PrimaryKey", "UniqueConstraint"] },
  { id: "foreignKeys", label: "Foreign keys", types: ["ForeignKey"] },
  { id: "checks", label: "Check constraints", types: ["CheckConstraint"] },
  { id: "indexes", label: "Indexes", types: ["Index"] },
  { id: "views", label: "Views", types: ["View"] },
  { id: "procedures", label: "Stored procedures", types: ["StoredProcedure"] },
  { id: "functions", label: "Functions", types: ["Function"] },
  { id: "triggers", label: "Triggers", types: ["Trigger"] },
  { id: "tableTypes", label: "Table types", types: ["TableType", "TableTypeColumn"] },
  { id: "sequences", label: "Sequences & synonyms", types: ["Sequence", "Synonym"] },
  { id: "packages", label: "Packages (Oracle)", types: ["Package", "PackageBody"] },
];

export interface DbObject {
  type: ObjectType;
  schema: string;
  name: string;
  /** Owning table / table type for child objects (columns, keys, indexes). */
  parent?: string;
  /** Comparable definition (columns, keys, indexes…). For code objects this is the raw SQL. */
  def: string;
  /** True for views / procedures / functions / triggers / packages. */
  code?: boolean;
  meta?: Record<string, unknown>;
}

export interface Snapshot {
  engine: Engine;
  label: string;
  objects: DbObject[];
  warnings: string[];
  extractedAt: string;
}

export interface CompareOptions {
  /** Selected TYPE_GROUPS ids. */
  groups: string[];
  ignoreWhitespace: boolean;
  ignoreCase: boolean;
}

export type DiffStatus = "MISSING" | "EXTRA" | "DIFF";
export type Risk = "High" | "Medium" | "Low" | "Noise";

export interface DiffItem {
  id: string;
  type: ObjectType;
  schema: string;
  name: string;
  parent?: string;
  fullName: string;
  status: DiffStatus;
  /** Definition in the source (reference) environment. */
  sourceDef?: string;
  /** Definition in the target environment. */
  targetDef?: string;
  added: number;
  removed: number;
  risk: Risk;
  noise: boolean;
  note: string;
  aiReviewed?: boolean;
  /** Source metadata (or target metadata for EXTRA items), used for the deploy script. */
  meta?: Record<string, unknown>;
}

export interface CompareResult {
  source: { label: string; engine: Engine };
  target: { label: string; engine: Engine };
  generatedAt: string;
  options: CompareOptions;
  summary: {
    total: number;
    missing: number;
    extra: number;
    diff: number;
    noise: number;
    byType: Record<string, { missing: number; extra: number; diff: number }>;
    byRisk: Record<Risk, number>;
  };
  items: DiffItem[];
  warnings: string[];
}

export interface ColumnMeta {
  name: string;
  dataType: string;
  nullable: boolean;
  identity?: { seed: string; increment: string } | null;
  defaultValue?: string | null;
  computed?: string | null;
}

export interface ConvertChange {
  from: string;
  to: string;
  by: "Rule" | "AI";
}

export interface ConvertResult {
  sql: string;
  from: Engine;
  to: Engine;
  changes: ConvertChange[];
  warnings: string[];
  confidence: "High" | "Medium" | "Low";
  usedAI: boolean;
  procedural: boolean;
  validation: { ok: boolean; messages: string[] };
}
