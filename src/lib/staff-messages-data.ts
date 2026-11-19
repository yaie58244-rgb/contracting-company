"use client";
import { createClient } from "@/lib/supabase/client";

export type StaffMember={id:string;full_name:string};
export type StaffMessage={id:string;sender_id:string;sender_name:string;recipient_id:string|null;recipient_name:string|null;body:string;attachment_url:string|null;created_at:string};

export async function fetchStaffMembers():Promise<StaffMember[]>{const {data,error}=await createClient().rpc("list_staff_members");if(error)throw error;return (data??[]) as StaffMember[];}
export async function fetchStaffMessages():Promise<StaffMessage[]>{const {data,error}=await createClient().rpc("list_staff_messages");if(error)throw error;return (data??[]) as StaffMessage[];}
export async function sendStaffMessage(recipientId:string|null,body:string,attachmentUrl:string){const {error}=await createClient().rpc("send_staff_message",{p_recipient_id:recipientId,p_body:body,p_attachment_url:attachmentUrl||null});if(error)throw error;}
