"use client";
import { createClient } from "@/lib/supabase/client";

export type RolePermission={roleId:string;permissionId:string;allowed:boolean};
export type RoleRecord={id:string;name:string;nameAr:string;system:boolean;permissions:RolePermission[]};
export type PermissionRecord={id:string;module:string;action:string};
export async function fetchRoleMatrix():Promise<{roles:RoleRecord[];permissions:PermissionRecord[]}>{
 const db=createClient();const [r,p,rp]=await Promise.all([db.from("roles").select("id,name,name_ar,is_system").order("is_system",{ascending:false}).order("name_ar"),db.from("permissions").select("id,module,action").order("module").order("action"),db.from("role_permissions").select("role_id,permission_id,allowed")]);
 if(r.error)throw r.error;if(p.error)throw p.error;if(rp.error)throw rp.error;
 const permissionRows=(p.data??[]) as {id:string;module:string;action:string}[];const rolePermissions=(rp.data??[]) as {role_id:string;permission_id:string;allowed:boolean}[];
 return {permissions:permissionRows,roles:((r.data??[]) as {id:string;name:string;name_ar:string;is_system:boolean}[]).map(role=>({id:role.id,name:role.name,nameAr:role.name_ar,system:role.is_system,permissions:rolePermissions.filter(x=>x.role_id===role.id).map(x=>({roleId:x.role_id,permissionId:x.permission_id,allowed:x.allowed}))}))};
}
export async function createCustomRole(name:string,nameAr:string){const db=createClient();const {data,error}=await db.rpc("create_custom_role",{p_name:name,p_name_ar:nameAr});if(error)throw error;return data as string;}
export async function setRolePermission(roleId:string,permissionId:string,allowed:boolean){const db=createClient();const {error}=await db.rpc("set_role_permission",{p_role_id:roleId,p_permission_id:permissionId,p_allowed:allowed});if(error)throw error;}
