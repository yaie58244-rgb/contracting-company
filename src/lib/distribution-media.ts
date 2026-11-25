"use client";
import { createClient } from "@/lib/supabase/client";

/** A photo or plan/map shared by every property in one distribution (area + sector + التوزيعة). */
export type DistributionMedia = { id: string; kind: "image" | "map"; image_data: string; sector: string | null; street: string; created_at?: string; created_by_name?: string };
export const distributionKindLabel = { image: "صورة", map: "خريطة" } as const;

export async function fetchDistributionStreets(area: string, sector: string): Promise<{ street: string; properties: number }[]> {
  const { data, error } = await createClient().rpc("distribution_streets", { p_area: area, p_sector: sector });
  if (error) throw error;
  return ((data ?? []) as { street: string; properties: number | string }[]).map(row => ({ street: row.street, properties: Number(row.properties) }));
}

export async function listDistributionMedia(area: string, sector: string, street: string): Promise<DistributionMedia[]> {
  const { data, error } = await createClient().rpc("list_distribution_media", { p_area: area, p_sector: sector, p_street: street });
  if (error) throw error;
  return (data ?? []) as DistributionMedia[];
}

export async function addDistributionMedia(area: string, sector: string, street: string, kind: "image" | "map", imageData: string) {
  const { error } = await createClient().rpc("add_distribution_media", { p_area: area, p_sector: sector, p_street: street, p_kind: kind, p_image_data: imageData });
  if (error) throw error;
}

export async function deleteDistributionMedia(id: string) {
  const { error } = await createClient().rpc("delete_distribution_media", { p_id: id });
  if (error) throw error;
}

export async function fetchPropertyDistributionMedia(propertyId: string): Promise<DistributionMedia[]> {
  const { data, error } = await createClient().rpc("get_property_distribution_media", { p_property_id: propertyId });
  if (error) throw error;
  return (data ?? []) as DistributionMedia[];
}

/** Supabase errors are plain objects; pull the readable text out of any error. */
export const errorText = (cause: unknown, fallback: string) =>
  cause && typeof cause === "object" && "message" in cause && String(cause.message) ? String(cause.message) : fallback;
