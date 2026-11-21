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

/** The sectors of one area; an empty list means the area has none recorded, so every sector stays available. */
export const sectorsOf = (map: AreaSectors, area: string) => map.get(area.trim()) ?? [];
