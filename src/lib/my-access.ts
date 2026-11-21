"use client";
import { createClient } from "@/lib/supabase/client";

/** The signed-in user's role and the module/action pairs that role is allowed. */
export type MyAccess = { role: string; permissions: Set<string> };

export async function fetchMyAccess(): Promise<MyAccess | null> {
  const { data, error } = await createClient().rpc("my_permissions");
  if (error) throw error;
  const rows = (data ?? []) as { role: string; module: string | null; action: string | null }[];
  if (!rows.length) return null;
  return { role: rows[0].role, permissions: new Set(rows.flatMap(row => row.module && row.action ? [`${row.module}:${row.action}`] : [])) };
}
