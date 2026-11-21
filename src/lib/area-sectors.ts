"use client";
import { useEffect, useState } from "react";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";

/** Area name → its sectors (e.g. جنوب المطلاع → N1…N12), taken from the properties themselves. */
export type AreaSectors = Map<string, string[]>;

let cached: Promise<AreaSectors> | null = null;
const naturalOrder = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });

function loadAreaSectors(): Promise<AreaSectors> {
  cached ??= Promise.resolve(createClient().rpc("area_sectors")).then(({ data, error }) => {
    if (error) throw error;
    const map: AreaSectors = new Map();
    for (const row of (data ?? []) as { area: string; sector: string }[]) map.set(row.area, [...(map.get(row.area) ?? []), row.sector]);
    for (const [area, list] of map) map.set(area, list.sort(naturalOrder));
    return map;
  }).catch(error => { cached = null; throw error; });
  return cached;
}

export function useAreaSectors(): AreaSectors {
  const [map, setMap] = useState<AreaSectors>(new Map());
  useEffect(() => {
    if (!hasSupabaseConfig()) return;
    let active = true;
    loadAreaSectors().then(next => { if (active) setMap(next); }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  return map;
}

/** Same spelling rules as the database search: hamza/alef, ya, ta marbuta and spaces don't matter. */
const normalize = (text: string) => text.replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/[\u064B-\u0652\u0640]/g, "").replace(/\s+/g, "").toLowerCase();

/**
 * The sectors of one area. A partly typed area ("المطلاع") uses every area whose
 * name contains it. An empty list means no area matched, so every sector stays available.
 */
export function sectorsOf(map: AreaSectors, area: string): string[] {
  const exact = map.get(area.trim());
  if (exact) return exact;
  const query = normalize(area);
  if (query.length < 2) return [];
  const merged = new Set<string>();
  for (const [name, list] of map) if (normalize(name).includes(query)) list.forEach(sector => merged.add(sector));
  return [...merged].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
}
