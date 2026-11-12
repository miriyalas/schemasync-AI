/* Driver-free helpers (safe to import anywhere, including demo mode). */
import type { ColumnMeta } from "../types";

/** Formats a SQL Server type the way you would write it in DDL. */
export function sqlServerType(typ: string, maxLength: number, precision: number, scale: number): string {
  const t = String(typ).toLowerCase();
  if (["varchar", "char", "varbinary", "binary"].includes(t)) return `${t}(${maxLength === -1 ? "max" : maxLength})`;
  if (["nvarchar", "nchar"].includes(t)) return `${t}(${maxLength === -1 ? "max" : maxLength / 2})`;
  if (["decimal", "numeric"].includes(t)) return `${t}(${precision},${scale})`;
  if (["datetime2", "time", "datetimeoffset"].includes(t)) return `${t}(${scale})`;
  if (t === "float") return precision === 53 ? "float" : `float(${precision})`;
  return t;
}

export function columnDef(c: ColumnMeta): string {
  if (c.computed) return `AS ${c.computed}`;
  let d = `${c.dataType} ${c.nullable ? "NULL" : "NOT NULL"}`;
  if (c.identity) d += ` IDENTITY(${c.identity.seed},${c.identity.increment})`;
  if (c.defaultValue) d += ` DEFAULT ${c.defaultValue}`;
  return d;
}
