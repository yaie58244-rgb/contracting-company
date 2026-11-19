"use client";
import { createClient } from "@/lib/supabase/client";

export type ClientAddress={governorate:string;area:string;sector:string;distribution:string;block:string;street:string;avenue:string;building:string;floor:string;apartment:string;postalCode:string;landmark:string};
export const emptyClientAddress:ClientAddress={governorate:"",area:"",sector:"",distribution:"",block:"",street:"",avenue:"",building:"",floor:"",apartment:"",postalCode:"",landmark:""};
export type ClientComment={id:string;body:string;authorName:string;createdAt:string};
export type ClientClaim={employeeId:string;employeeName:string;claimedAt:string};
export type ClientRecord={id:string;name:string;sourceNames?:string[];phones:string[];source:string;notes:string;assignedTo:string;createdAt:string;tags:string[];address?:ClientAddress;claim?:ClientClaim|null;comments?:ClientComment[]};

async function fetchAll<T>(query:(from:number,to:number)=>any,maxRows=Number.POSITIVE_INFINITY,offset=0):Promise<T[]>{const rows:T[]=[];const pageSize=500;for(let base=0;;base+=pageSize*2){const remaining=maxRows-rows.length;if(remaining<=0)return rows;const pageCount=Math.min(2,Math.ceil(remaining/pageSize));const pages=await Promise.all(Array.from({length:pageCount},async(_,i)=>{const from=offset+base+i*pageSize,limit=Math.min(pageSize,maxRows-(rows.length+i*pageSize));let result:any;for(let attempt=0;attempt<3;attempt++){result=await query(from,from+limit-1);if(result.error||(result.data??[]).length===limit||attempt===2)break;await new Promise(resolve=>setTimeout(resolve,250*(attempt+1)))}return result}));for(const result of pages){if(result.error)throw result.error;rows.push(...((result.data??[]) as T[]))}if(rows.length>=maxRows||pages.some(result=>(result.data??[]).length<pageSize))return rows}}

export async function bootstrapCurrentProfile(){
  for(let attempt=0;attempt<3;attempt++){
    const {error}=await createClient().rpc("bootstrap_current_profile");
    if(!error)return;
    if(error.code!=="P0001"||!error.message?.includes("Authentication is required")||attempt===2)throw error;
    await new Promise(resolve=>setTimeout(resolve,300*(attempt+1)));
  }
}

export async function fetchClients(maxRows=50,includeActivity=false,offset=0):Promise<ClientRecord[]>{
  const neon=createClient();
  const rows=await fetchAll<{id:string;name:string;source_names:string[];source:string|null;notes:string|null;tags:string[];address:Partial<ClientAddress>|null;created_at:string;assigned_to:string|null}>((from,to)=>neon.from("clients").select("id,name,source_names,source,notes,tags,address,created_at,assigned_to").is("deleted_at",null).order("created_at",{ascending:false}).order("id",{ascending:true}).range(from,to),maxRows,offset);
  if(!rows.length)return [];
  if(!includeActivity)return rows.map(row=>({id:row.id,name:row.name,sourceNames:row.source_names??[],phones:[],source:row.source??"",notes:row.notes??"",assignedTo:row.assigned_to??"",createdAt:row.created_at,tags:row.tags??[],address:{...emptyClientAddress,...(row.address??{})},claim:null,comments:[]}));
  const {data:activityData,error:activityError}=await neon.rpc("get_client_activity",{p_client_ids:rows.map(row=>row.id)});
  if(activityError)throw activityError;
  const activity=(activityData??[]) as {client_id:string;employee_id:string|null;employee_name:string|null;claimed_at:string|null;comment_id:string|null;comment_body:string|null;comment_author_name:string|null;comment_created_at:string|null}[];
  const claims=activity.filter(x=>x.employee_id&&x.employee_name&&x.claimed_at) as {client_id:string;employee_id:string;employee_name:string;claimed_at:string}[];
  const comments=activity.filter(x=>x.comment_id&&x.comment_body&&x.comment_author_name&&x.comment_created_at).map(x=>({id:x.comment_id!,client_id:x.client_id,body:x.comment_body!,author_name:x.comment_author_name!,created_at:x.comment_created_at!}));
  const claimsByClient=new Map(claims.map(x=>[x.client_id,x]));const commentsByClient=new Map<string,ClientComment[]>();for(const x of comments){const group=commentsByClient.get(x.client_id)??[];group.push({id:x.id,body:x.body,authorName:x.author_name,createdAt:x.created_at});commentsByClient.set(x.client_id,group)}
  return rows.map(row=>{const claim=claimsByClient.get(row.id);return {id:row.id,name:row.name,sourceNames:row.source_names??[],phones:[],source:row.source??"",notes:row.notes??"",assignedTo:row.assigned_to??"",createdAt:row.created_at,tags:row.tags??[],address:{...emptyClientAddress,...(row.address??{})},claim:claim?{employeeId:claim.employee_id,employeeName:claim.employee_name,claimedAt:claim.claimed_at}:null,comments:commentsByClient.get(row.id)??[]}});
}

export async function fetchWorkspaceCounts(){
  const neon=createClient();
  const {data,error}=await neon.rpc("workspace_counts");
  if(!error){
    const row=(Array.isArray(data)?data[0]:data) as {properties?:number;availableProperties?:number;clients?:number}|null;
    return {properties:Number(row?.properties??0),availableProperties:Number(row?.availableProperties??0),clients:Number(row?.clients??0)};
  }
  // Fall back to plain counts when the Data API has not reloaded the new RPC.
  const [propertyResult,availableResult,clientResult]=await Promise.all([
    neon.from("properties").select("id",{count:"exact",head:true}).is("deleted_at",null),
    neon.from("properties").select("id",{count:"exact",head:true}).is("deleted_at",null).eq("status","available"),
    neon.from("clients").select("id",{count:"exact",head:true}).is("deleted_at",null),
  ]);
  if(propertyResult.error)throw propertyResult.error;
  if(availableResult.error)throw availableResult.error;
  if(clientResult.error)throw clientResult.error;
  return {properties:propertyResult.count??0,availableProperties:availableResult.count??0,clients:clientResult.count??0};
}

export async function searchClients(filters:Record<string,string>):Promise<ClientRecord[]>{
  const {data,error}=await createClient().rpc("search_clients",{p_filters:filters});
  if(error)throw error;
  return ((data??[]) as {id:string;name:string;source_names:string[];source:string|null;notes:string|null;tags:string[];address:Partial<ClientAddress>|null;created_at:string;assigned_to:string|null;claim_employee_id:string|null;claim_employee_name:string|null;claim_claimed_at:string|null}[]).map(row=>({id:row.id,name:row.name,sourceNames:row.source_names??[],phones:[],source:row.source??"",notes:row.notes??"",assignedTo:row.assigned_to??"",createdAt:row.created_at,tags:row.tags??[],address:{...emptyClientAddress,...(row.address??{})},claim:row.claim_employee_id&&row.claim_employee_name&&row.claim_claimed_at?{employeeId:row.claim_employee_id,employeeName:row.claim_employee_name,claimedAt:row.claim_claimed_at}:null,comments:[]}));
}

export async function fetchClientPhones(clientIds:string[]):Promise<Record<string,string[]>>{
  if(!clientIds.length)return {};
  const {data,error}=await createClient().from("client_phones").select("client_id,phone").in("client_id",clientIds);
  if(error)throw error;
  const result:Record<string,string[]>={};
  for(const row of (data??[]) as {client_id:string;phone:string}[])(result[row.client_id]??=[]).push(row.phone);
  return result;
}

export async function canViewClientPhones():Promise<boolean>{
  const db=createClient();const {data:{user},error:userError}=await db.auth.getUser();
  if(userError||!user)return false;
  const {data,error}=await db.from("profiles").select("phone_visible").eq("id",user.id).maybeSingle();
  return !error&&Boolean((data as {phone_visible?:boolean}|null)?.phone_visible);
}

export async function claimClient(id:string){const {error}=await createClient().rpc("claim_client",{p_client_id:id});if(error)throw error;}
export async function releaseClient(id:string){const {error}=await createClient().rpc("release_client_claim",{p_client_id:id});if(error)throw error;}
export async function addClientComment(id:string,body:string){const {error}=await createClient().rpc("add_client_comment",{p_client_id:id,p_body:body});if(error)throw error;}

export async function revealClientContact(id:string,comment:string):Promise<string[]> {
  const {data,error}=await createClient().rpc("reveal_client_contact",{p_client_id:id,p_comment:comment});
  if(error) throw error;
  return ((data??[]) as {phone:string}[]).map(row=>row.phone);
}

export async function archiveClient(id:string,comment:string){
  const {error}=await createClient().rpc("archive_client",{p_client_id:id,p_comment:comment});
  if(error)throw error;
}

export async function createClientRecord(client:Pick<ClientRecord,"name"|"phones"|"source"|"notes"|"tags"|"address">){
  const neon=createClient();
  const {data,error}=await neon.rpc("create_client_with_address",{payload:client});
  if(error)throw error;
  return data as string;
}
