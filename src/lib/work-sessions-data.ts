"use client";
import { createClient } from "@/lib/supabase/client";

export type WorkSession={id:string;user_id:string;full_name:string;started_at:string;ended_at:string|null;ended_by_name:string|null};
export async function fetchWorkSessions():Promise<{rows:WorkSession[];userId:string}>{const db=createClient();const [{data,error},{data:{user},error:userError}]=await Promise.all([db.rpc("list_work_sessions"),db.auth.getUser()]);if(error)throw error;if(userError||!user)throw userError??new Error("Not signed in");return {rows:(data??[]) as WorkSession[],userId:user.id};}
export async function startWorkSession(){const {error}=await createClient().rpc("start_work_session");if(error)throw error;}
export async function endWorkSession(){const {error}=await createClient().rpc("end_work_session");if(error)throw error;}
export async function terminateWorkSession(id:string){const {error}=await createClient().rpc("terminate_work_session",{p_session_id:id});if(error)throw error;}
