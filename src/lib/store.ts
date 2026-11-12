"use client";

import { useSyncExternalStore } from "react";
import type { CompareResult } from "./types";

/**
 * Tiny client-side store. The comparison result lives in memory (survives page
 * navigation) and is mirrored to sessionStorage when it fits (survives a reload).
 */
const KEY = "schemasync:last-result";
let result: CompareResult | null = null;
let loaded = false;
let converterInput: { sql: string; from: "sqlserver" | "oracle" } | null = null;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) result = JSON.parse(raw);
  } catch {
    /* ignore */
  }
}

export function setResult(r: CompareResult | null) {
  result = r;
  loaded = true;
  try {
    if (r) sessionStorage.setItem(KEY, JSON.stringify(r));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* too large for sessionStorage: keep in memory only */
  }
  listeners.forEach((l) => l());
}

export function getResult(): CompareResult | null {
  load();
  return result;
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useCompareResult(): CompareResult | null {
  return useSyncExternalStore(subscribe, getResult, () => null);
}

export function setConverterInput(v: typeof converterInput) {
  converterInput = v;
}
export function takeConverterInput() {
  const v = converterInput;
  converterInput = null;
  return v;
}
