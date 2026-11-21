"use client";

import { useEffect, useState } from "react";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";

/**
 * Fields the admin can "code": each one gets a list of values typed in
 * Settings, and every form shows that field as a dropdown once it has values.
 * The first four are linked to properties by id; the rest are stored as text.
 */
export const CODE_FIELDS = [
  { id: "area", label: "المنطقة" },
  { id: "property_type", label: "نوع العقار" },
  { id: "offer_type", label: "نوع العرض" },
  { id: "location_type", label: "نوع الموقع" },
  { id: "governorate", label: "المحافظة" },
  { id: "sector", label: "القطاع" },
  { id: "distribution", label: "التوزيع" },
  { id: "block", label: "القطعة" },
  { id: "plot", label: "القسيمة" },
  { id: "street", label: "التوزيعة" },
  { id: "avenue", label: "الجادة" },
  { id: "floor", label: "الدور" },
  { id: "building_type", label: "نوع المبنى" },
  { id: "annexes", label: "التوابع" },
] as const;

export type CodeFieldId = (typeof CODE_FIELDS)[number]["id"];
export type CodeOption = { value: string; code: string | null };
export type CodeLists = Partial<Record<string, CodeOption[]>>;
export type CodeRow = { id: string; type: string; code: number; short_code: string | null; name_ar: string; name_en: string | null; is_active: boolean };

/** Browser-only copy used in preview mode (no Supabase). */
export const LOCAL_CODES_KEY = "aqar-lookups";
const CHANGED_EVENT = "aqar-codes-changed";

export const optionLabel = (option: CodeOption) =>
  option.code && option.code !== option.value ? `${option.code} · ${option.value}` : option.value;

function toLists(rows: Pick<CodeRow, "type" | "name_ar" | "short_code" | "is_active">[]): CodeLists {
  const lists: CodeLists = {};
  for (const row of rows) {
    if (!row.is_active) continue;
    (lists[row.type] ??= []).push({ value: row.name_ar, code: row.short_code ?? null });
  }
  return lists;
}

export function readLocalCodes(): CodeRow[] {
  try { return JSON.parse(localStorage.getItem(LOCAL_CODES_KEY) ?? "[]") as CodeRow[]; } catch { return []; }
}

let cache: Promise<CodeLists> | null = null;

export function fetchCodeLists(): Promise<CodeLists> {
  cache ??= (async () => {
    if (!hasSupabaseConfig()) return toLists(readLocalCodes());
    // Older databases have no short_code column yet; fall back to names only.
    const db = createClient();
    let result = await db.from("lookups").select("type,name_ar,short_code,is_active,code").eq("is_active", true).order("code");
    if (result.error) result = await db.from("lookups").select("type,name_ar,is_active,code").eq("is_active", true).order("code") as typeof result;
    if (result.error) { cache = null; throw result.error; }
    return toLists((result.data ?? []) as CodeRow[]);
  })();
  return cache;
}

/** Call after adding or editing codes so open forms pick up the new values. */
export function invalidateCodeLists() {
  cache = null;
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGED_EVENT));
}

export function useCodeLists(): CodeLists {
  const [lists, setLists] = useState<CodeLists>({});
  useEffect(() => {
    let active = true;
    const load = () => { fetchCodeLists().then(next => { if (active) setLists(next); }).catch(() => undefined); };
    load();
    window.addEventListener(CHANGED_EVENT, load);
    return () => { active = false; window.removeEventListener(CHANGED_EVENT, load); };
  }, []);
  return lists;
}

/** Values of a field, or the built-in defaults when the admin has not coded it. */
export function codeValues(lists: CodeLists, field: string, fallback: string[] = []): string[] {
  const own = lists[field];
  return own?.length ? own.map(option => option.value) : fallback;
}
