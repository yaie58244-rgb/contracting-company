"use client";
import { createClient } from "@/lib/supabase/client";

export type NotificationRecord={id:string;type:string;title:string;body:string|null;link:string|null;read_at:string|null;created_at:string;deleted_at:string|null};
export async function fetchNotifications():Promise<NotificationRecord[]>{const {data,error}=await createClient().rpc("list_my_notifications");if(error)throw error;return (data??[]) as NotificationRecord[];}
export async function setNotificationState(id:string,action:"read"|"archive"|"restore"){const {error}=await createClient().rpc("set_notification_state",{p_id:id,p_action:action});if(error)throw error;}
