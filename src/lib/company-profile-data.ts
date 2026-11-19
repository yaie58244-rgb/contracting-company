"use client";
import { createClient } from "@/lib/supabase/client";

export type CompanyProfile={name_ar:string;name_en:string|null;phone:string|null;fax:string|null;address:string|null;logo_url:string|null};
export async function fetchCompanyProfile():Promise<CompanyProfile>{const {data,error}=await createClient().from("company_profile").select("name_ar,name_en,phone,fax,address,logo_url").eq("id",1).single();if(error)throw error;return data as CompanyProfile;}
export async function saveCompanyProfile(value:CompanyProfile){const {error}=await createClient().rpc("save_company_profile",{p_name_ar:value.name_ar,p_name_en:value.name_en,p_phone:value.phone,p_fax:value.fax,p_address:value.address,p_logo_url:value.logo_url});if(error)throw error;}
