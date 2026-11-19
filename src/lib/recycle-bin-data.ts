"use client";
import { createClient } from "@/lib/supabase/client";

export type RecycleBinItem={item_type:"property"|"client";item_id:string;label:string;deleted_at:string;deleted_by:string|null;deletion_comment:string|null};

export async function fetchRecycleBin():Promise<RecycleBinItem[]>{
  const {data,error}=await createClient().rpc("get_recycle_bin");
  if(error)throw error;
  return (data??[]) as RecycleBinItem[];
}

export async function restoreRecycleItem(itemType:RecycleBinItem["item_type"],itemId:string){
  const {error}=await createClient().rpc("restore_recycle_item",{p_item_type:itemType,p_item_id:itemId});
  if(error)throw error;
}
