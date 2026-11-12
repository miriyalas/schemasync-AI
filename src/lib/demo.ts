import { columnDef } from "./db/format";
import type { ColumnMeta, DbObject, Snapshot } from "./types";

/**
 * Built-in sample DEV and SIT databases so the app can be tried on Vercel without
 * a database connection. Object names follow a typical ROPA schema.
 */

function table(schema: string, name: string, cols: ColumnMeta[], pk?: string[]): DbObject[] {
  const out: DbObject[] = [
    {
      type: "Table",
      schema,
      name,
      def: "",
      meta: { columns: cols, pk: pk ? { name: `PK_${name}`, clustered: true, columns: pk } : null },
    },
    ...cols.map<DbObject>((c) => ({ type: "Column", schema, parent: name, name: c.name, def: columnDef(c), meta: { table: `${schema}.${name}`, ...c } })),
  ];
  if (pk)
    out.push({
      type: "PrimaryKey",
      schema,
      parent: name,
      name: "PK",
      def: `PRIMARY KEY CLUSTERED (${pk.join(", ")})`,
      meta: { table: `${schema}.${name}`, constraintName: `PK_${name}`, clustered: true, columns: pk },
    });
  return out;
}

const col = (name: string, dataType: string, nullable = true, extra: Partial<ColumnMeta> = {}): ColumnMeta => ({
  name,
  dataType,
  nullable,
  identity: null,
  defaultValue: null,
  computed: null,
  ...extra,
});
const id = col("Id", "int", false, { identity: { seed: "1", increment: "1" } });

const code = (type: DbObject["type"], schema: string, name: string, def: string): DbObject => ({ type, schema, name, def, code: true });

function proc(name: string, body: string) {
  return code("StoredProcedure", "ropa", name, `CREATE PROCEDURE ropa.${name}\nAS\nBEGIN\n    SET NOCOUNT ON;\n${body}\nEND`);
}

function tableType(name: string, cols: ColumnMeta[]): DbObject[] {
  return [
    { type: "TableType", schema: "ropa", name, def: cols.map((c) => `${c.name} ${c.dataType} ${c.nullable ? "NULL" : "NOT NULL"}`).join(",\n"), meta: { columns: cols } },
    ...cols.map<DbObject>((c) => ({ type: "TableTypeColumn", schema: "ropa", parent: name, name: c.name, def: `${c.dataType} ${c.nullable ? "NULL" : "NOT NULL"}` })),
  ];
}

function common(): DbObject[] {
  return [
    ...table("ropa", "Claims", [id, col("ClaimType", "nvarchar(100)", false), col("ClaimValue", "nvarchar(400)"), col("BusinessGroupId", "int"), col("IsActive", "bit", false, { defaultValue: "((1))" })], ["Id"]),
    ...table("ropa", "UserClaims", [id, col("UserId", "int", false), col("ClaimId", "int", false)], ["Id"]),
    ...table("ropa", "Records", [id, col("Name", "nvarchar(200)"), col("Code", "varchar(50)", false), col("RegistrationNo", "varchar(50)"), col("CreatedOn", "datetime2(7)", false, { defaultValue: "(sysdatetime())" })], ["Id"]),
    {
      type: "ForeignKey",
      schema: "ropa",
      parent: "UserClaims",
      name: "FK_UserClaims_Claims",
      def: "(ClaimId) REFERENCES ropa.Claims (Id) ON DELETE NO ACTION ON UPDATE NO ACTION",
      meta: { table: "ropa.UserClaims", constraintName: "FK_UserClaims_Claims", columns: ["ClaimId"], refTable: "ropa.Claims", refColumns: ["Id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
    },
    code(
      "Function",
      "ropa",
      "fn_GetJURRecordIdsBasedOnRegRecordId",
      "CREATE FUNCTION ropa.fn_GetJURRecordIdsBasedOnRegRecordId (@RegRecordId INT)\nRETURNS TABLE\nAS\nRETURN\n(\n    SELECT r.Id FROM ropa.Records r WHERE r.RegistrationNo = CAST(@RegRecordId AS varchar(50))\n);"
    ),
    proc("GetallActivitiesNames_Shared", "    SELECT DISTINCT Name FROM ropa.Records ORDER BY Name;"),
  ];
}

function devOnly(): DbObject[] {
  return [
    // functions that differ
    code(
      "Function",
      "ropa",
      "fn_GetClaimsByUserInfo",
      `CREATE FUNCTION ropa.fn_GetClaimsByUserInfo
(
    @UserId INT,
    @RoleId INT
)
RETURNS TABLE
AS
RETURN
(
    SELECT c.Id AS ClaimId, c.ClaimType, c.ClaimValue,
           bg.BusinessGroupId
    FROM ropa.Claims c
    JOIN ropa.UserClaims uc ON uc.ClaimId = c.Id
    JOIN ropa.fn_GetBusinessGroupIDsBasedOnRole(@RoleId) bg
         ON bg.BusinessGroupId = c.BusinessGroupId
    WHERE uc.UserId = @UserId
      AND c.IsActive = 1
);`
    ),
    code(
      "Function",
      "ropa",
      "fn_GetBusinessGroupIDsBasedOnRole",
      `CREATE FUNCTION ropa.fn_GetBusinessGroupIDsBasedOnRole (@RoleId INT)
RETURNS TABLE
AS
RETURN
(
    SELECT DISTINCT c.BusinessGroupId
    FROM ropa.Claims c
    WHERE c.ClaimType = 'Role'
      AND c.ClaimValue = CAST(@RoleId AS nvarchar(20))
      AND c.IsActive = 1
);`
    ),
    code(
      "Function",
      "ropa",
      "Fn_GetConfigurationDetails",
      `CREATE FUNCTION ropa.Fn_GetConfigurationDetails ()
RETURNS TABLE
AS
RETURN
(
    SELECT r.Id, r.Name, r.Code,
           r.RegistrationNo
    FROM ropa.Records r
);`
    ),
    // new procedures (some are noise)
    proc("GetallActivitiesNames", "    SELECT Id, Name FROM ropa.Records ORDER BY Name;"),
    proc("sp_Ropa_ActiveAits", "    SELECT r.Id, r.Name, r.Code\n    FROM ropa.Records r\n    WHERE r.Code LIKE 'AIT%';"),
    proc("sp_Ropa_ActiveApp_Concatenated", "    SELECT r.Id, ISNULL(r.Name, '') + ' - ' + r.Code AS Label\n    FROM ropa.Records r;"),
    proc("sp_Ropa_ActiveGlobalValues_3rdMarch2026", "    SELECT * FROM ropa.Records;"),
    proc("sp_Ropa_ActivePDC_Concatenated_Copilot", "    SELECT r.Id, CONCAT(r.Name, ' / ', r.Code) AS Label FROM ropa.Records r;"),
    proc("sp_Ropa_ActivePOPs_3rdMarch2026", "    SELECT TOP 100 * FROM ropa.Records;"),
    proc(
      "sp_Ropa_SaveScopedPops",
      "    -- uses the table type ropa.SaveScopedPops\n    SELECT 1;"
    ),
    code(
      "StoredProcedure",
      "ropa",
      "sp_Ropa_SaveActivityAlignment",
      `CREATE PROCEDURE ropa.sp_Ropa_SaveActivityAlignment
    @Items ropa.SaveActivityAlignExternalTransfer_V1 READONLY
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO ropa.ActivityAlignment (RecordId, IsAligned, IsAutoAligned, RegistrationNo)
    SELECT i.Id, i.IsAligned, i.IsAutoAligned, i.RegistrationNo
    FROM @Items i;
END`
    ),
    // new table types
    ...tableType("SaveActivityAlignExternalTransfer_V1", [col("Id", "int", false), col("IsAligned", "bit"), col("IsAutoAligned", "bit"), col("RegistrationNo", "varchar(50)")]),
    ...tableType("SaveScopedPops", [col("IsScoped", "bit"), col("POPID", "int", false)]),
    // new table
    ...table("ropa", "ActivityAlignment", [id, col("RecordId", "int", false), col("IsAligned", "bit", false, { defaultValue: "((0))" }), col("IsAutoAligned", "bit", false, { defaultValue: "((0))" }), col("RegistrationNo", "varchar(50)")], ["Id"]),
    {
      type: "ForeignKey",
      schema: "ropa",
      parent: "ActivityAlignment",
      name: "FK_ActivityAlignment_Records",
      def: "(RecordId) REFERENCES ropa.Records (Id) ON DELETE NO ACTION ON UPDATE NO ACTION",
      meta: { table: "ropa.ActivityAlignment", constraintName: "FK_ActivityAlignment_Records", columns: ["RecordId"], refTable: "ropa.Records", refColumns: ["Id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
    },
    {
      type: "Index",
      schema: "ropa",
      parent: "Records",
      name: "IX_Records_Code",
      def: "NONCLUSTERED (Code) INCLUDE (Name)",
      meta: { table: "ropa.Records", unique: false, kind: "NONCLUSTERED", columns: ["Code"], include: ["Name"], filter: null },
    },
    // view
    code(
      "View",
      "srd",
      "ROPA_DTR_EXTRACT_ALL",
      `CREATE VIEW srd.ROPA_DTR_EXTRACT_ALL
AS
SELECT r.Id, r.Name, r.Code, r.RegistrationNo,
       a.IsAligned, a.IsAutoAligned
FROM ropa.Records r
LEFT JOIN ropa.ActivityAlignment a ON a.RecordId = r.Id;`
    ),
  ];
}

function sitOnly(): DbObject[] {
  return [
    code(
      "Function",
      "ropa",
      "fn_GetClaimsByUserInfo",
      `CREATE FUNCTION ropa.fn_GetClaimsByUserInfo
(
    @UserId INT
)
RETURNS TABLE
AS
RETURN
(
    SELECT c.Id AS ClaimId, c.ClaimType, c.ClaimValue
    FROM ropa.Claims c
    JOIN ropa.UserClaims uc ON uc.ClaimId = c.Id
    WHERE uc.UserId = @UserId
);`
    ),
    code(
      "Function",
      "ropa",
      "fn_GetBusinessGroupIDsBasedOnRole",
      `CREATE FUNCTION ropa.fn_GetBusinessGroupIDsBasedOnRole (@RoleId INT)
RETURNS TABLE
AS
RETURN
(
    SELECT DISTINCT c.BusinessGroupId
    FROM ropa.Claims c
    WHERE c.ClaimType = 'Role'
      AND c.ClaimValue = CAST(@RoleId AS nvarchar(20))
);`
    ),
    // formatting-only difference: ignored when "Ignore whitespace" is on
    code(
      "Function",
      "ropa",
      "Fn_GetConfigurationDetails",
      `CREATE   FUNCTION [ropa].[Fn_GetConfigurationDetails] ()
RETURNS TABLE
AS
RETURN
(
    -- configuration list
    SELECT r.Id, r.Name, r.Code FROM ropa.Records r
);`
    ),
    code(
      "View",
      "srd",
      "ROPA_DTR_EXTRACT_ALL",
      `CREATE VIEW srd.ROPA_DTR_EXTRACT_ALL
AS
SELECT r.Id, r.Name, r.Code, r.RegistrationNo
FROM ropa.Records r;`
    ),
    // only in SIT
    proc("sp_Ropa_Records_old", "    SELECT Id, Name FROM ropa.Records;"),
  ];
}

function withChanges(base: DbObject[], env: "DEV" | "SIT"): DbObject[] {
  const out = base.map((o) => ({ ...o }));
  if (env === "DEV") {
    // a staging table where DEV has extra geo columns
    out.push(
      ...table("ropa", "ISSUINGAUTHORITY_REGULATORS_TEMPSRCTABLE", [
        col("RegulatorId", "int", false),
        col("RegulatorName", "nvarchar(200)"),
        col("geo_alias", "nvarchar(100)"),
        col("geo_code", "varchar(10)"),
        col("geo_cor_is_active", "bit"),
        col("geo_country_id", "int"),
      ])
    );
    // DEV made Records.Name NOT NULL and widened Code
    const name = out.find((o) => o.type === "Column" && o.parent === "Records" && o.name === "Name")!;
    const nameMeta = { ...(name.meta as unknown as ColumnMeta), nullable: false, defaultValue: "('')" };
    name.def = columnDef(nameMeta);
    name.meta = { table: "ropa.Records", ...nameMeta };
    const codeCol = out.find((o) => o.type === "Column" && o.parent === "Records" && o.name === "Code")!;
    const codeMeta = { ...(codeCol.meta as unknown as ColumnMeta), dataType: "varchar(100)" };
    codeCol.def = columnDef(codeMeta);
    codeCol.meta = { table: "ropa.Records", ...codeMeta };
    // new NOT NULL column without default (high risk)
    out.push({
      type: "Column",
      schema: "ropa",
      parent: "Claims",
      name: "ScopeType",
      def: "varchar(20) NOT NULL",
      meta: { table: "ropa.Claims", name: "ScopeType", dataType: "varchar(20)", nullable: false },
    });
  } else {
    out.push(
      ...table("ropa", "ISSUINGAUTHORITY_REGULATORS_TEMPSRCTABLE", [col("RegulatorId", "int", false), col("RegulatorName", "nvarchar(200)")])
    );
    // only in SIT: a legacy column
    out.push({
      type: "Column",
      schema: "ropa",
      parent: "Records",
      name: "LegacyCode",
      def: "varchar(20) NULL",
      meta: { table: "ropa.Records", name: "LegacyCode", dataType: "varchar(20)", nullable: true },
    });
  }
  return out;
}

export function demoSnapshots(): { source: Snapshot; target: Snapshot } {
  const now = new Date().toISOString();
  return {
    source: { engine: "sqlserver", label: "DEV (demo)", objects: withChanges([...common(), ...devOnly()], "DEV"), warnings: [], extractedAt: now },
    target: { engine: "sqlserver", label: "SIT (demo)", objects: withChanges([...common(), ...sitOnly()], "SIT"), warnings: [], extractedAt: now },
  };
}
