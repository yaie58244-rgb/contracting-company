"use client";
import { createClient } from "@/lib/supabase/client";

const BUCKET = "client-images";
const MAX_BYTES = 8 * 1024 * 1024;

export type ClientImage = {
  id: string;
  path: string;
  caption: string;
  createdAt: string;
  url: string | null;
};

export async function canManageClientImages(): Promise<boolean> {
  const { data, error } = await createClient().rpc("can_manage_client_images");
  return !error && data === true;
}

async function signedUrlMap(paths: string[]): Promise<Map<string, string>> {
  if (!paths.length) return new Map();
  const { data, error } = await createClient().storage.from(BUCKET).createSignedUrls(paths, 60 * 60);
  if (error) return new Map();
  const map = new Map<string, string>();
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) map.set(item.path, item.signedUrl);
  }
  return map;
}

export async function fetchClientImages(clientId: string): Promise<ClientImage[]> {
  const { data, error } = await createClient().from("client_images")
    .select("id,storage_path,caption,created_at")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as { id: string; storage_path: string; caption: string | null; created_at: string }[];
  const urls = await signedUrlMap(rows.map(row => row.storage_path));
  return rows.map(row => ({
    id: row.id,
    path: row.storage_path,
    caption: row.caption ?? "",
    createdAt: row.created_at,
    url: urls.get(row.storage_path) ?? null,
  }));
}

function extensionOf(file: File) {
  const match = /\.([a-z0-9]+)$/i.exec(file.name);
  if (match) return match[1].toLowerCase();
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  if (file.type === "image/gif") return "gif";
  return "jpg";
}

export async function uploadClientImage(clientId: string, file: File) {
  if (!file.type.startsWith("image/")) throw new Error("اختر ملف صورة فقط.");
  if (file.size > MAX_BYTES) throw new Error("حجم الصورة يجب أن يكون أقل من ٨ ميجابايت.");
  const db = createClient();
  const path = `${clientId}/${crypto.randomUUID()}.${extensionOf(file)}`;
  const { error: uploadError } = await db.storage.from(BUCKET).upload(path, file, {
    contentType: file.type,
    cacheControl: "3600",
    upsert: false,
  });
  if (uploadError) throw uploadError;
  const { error: rowError } = await db.from("client_images").insert({ client_id: clientId, storage_path: path });
  if (rowError) {
    // Never keep an orphan object when the metadata row failed.
    await db.storage.from(BUCKET).remove([path]).catch(() => null);
    throw rowError;
  }
}

export async function replaceClientImage(image: Pick<ClientImage, "id" | "path">, clientId: string, file: File) {
  if (!file.type.startsWith("image/")) throw new Error("اختر ملف صورة فقط.");
  if (file.size > MAX_BYTES) throw new Error("حجم الصورة يجب أن يكون أقل من ٨ ميجابايت.");
  const db = createClient();
  const newPath = `${clientId}/${crypto.randomUUID()}.${extensionOf(file)}`;
  const { error: uploadError } = await db.storage.from(BUCKET).upload(newPath, file, {
    contentType: file.type,
    cacheControl: "3600",
    upsert: false,
  });
  if (uploadError) throw uploadError;
  const { data: updated, error: updateError } = await db.from("client_images")
    .update({ storage_path: newPath }).eq("id", image.id).select("id").maybeSingle();
  if (updateError || !updated) {
    await db.storage.from(BUCKET).remove([newPath]).catch(() => null);
    throw updateError ?? new Error("تعذر العثور على الصورة لتعديلها.");
  }
  // The metadata now points at the new object, so the old one can be cleaned up.
  await db.storage.from(BUCKET).remove([image.path]).catch(() => null);
}

export async function deleteClientImage(image: Pick<ClientImage, "id" | "path">) {
  const db = createClient();
  const { error } = await db.from("client_images").delete().eq("id", image.id);
  if (error) throw error;
  await db.storage.from(BUCKET).remove([image.path]).catch(() => null);
}
