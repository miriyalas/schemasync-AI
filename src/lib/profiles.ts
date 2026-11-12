"use client";

import type { ConnectionInput } from "./types";

/** Saved connection profiles live in the browser only. Passwords are never saved. */
const KEY = "schemasync:profiles";
export type Profile = Omit<ConnectionInput, "password">;

export function loadProfiles(): Profile[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}

export function saveProfile(c: ConnectionInput): Profile[] {
  const { password: _pw, ...p } = c; // eslint-disable-line @typescript-eslint/no-unused-vars
  const list = loadProfiles().filter((x) => x.label !== p.label);
  list.push(p);
  list.sort((a, b) => a.label.localeCompare(b.label));
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
  return list;
}

export function deleteProfile(label: string): Profile[] {
  const list = loadProfiles().filter((x) => x.label !== label);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
  return list;
}
