"use client";

import type { Property } from "@/lib/types";
import type { ClientRecord } from "@/lib/client-data";
import { createClient } from "@/lib/supabase/client";

type LookupRow = { id:string; type:string; name_ar:string };
type PropertyRow = { id:string; code:string; client_id:string|null; type_id:string|null; offer_type_id:string|null; area_id:string|null; location_type_id:string|null; block:string|null; plot:string|null; street:string|null; avenue:string|null; floor:string|null; building_type:string|null; rooms_details:string|null; source_excel:Record<string,unknown>|null; sector:string|null;distribution:string|null;area_m2:number|null; asking_price_kwd:number|null; assigned_to:string|null; status:Property["status"]; entry_date:string; details:string|null;has_map:boolean;has_contact:boolean;has_location:boolean;last_contact_at:string|null;latitude:number|null;longitude:number|null };
type SearchPropertyRow={id:string;code:string;client:string;phones:string[];type:string;offer:string;area:string;sector:string;distribution:string;block:string;plot:string;street:string;avenue:string;floor:string;building_type:string;rooms_details:string;source_excel:Record<string,unknown>|null;source_search:string;location_type:string;size:number;price:number|null;employee:string;status:Property["status"];date:string;details:string;latitude:number|null;longitude:number|null;has_map:boolean;has_contact:boolean;has_location:boolean;last_contact_at:string|null};

async function fetchAll<T>(query:(from:number,to:number)=>any,maxRows=Number.POSITIVE_INFINITY,offset=0):Promise<T[]>{const rows:T[]=[];const pageSize=500;for(let base=0;;base+=pageSize*2){const remaining=maxRows-rows.length;if(remaining<=0)return rows;const pageCount=Math.min(2,Math.ceil(remaining/pageSize));const pages=await Promise.all(Array.from({length:pageCount},async(_,i)=>{const from=offset+base+i*pageSize,limit=Math.min(pageSize,maxRows-(rows.length+i*pageSize));let result:any;for(let attempt=0;attempt<3;attempt++){result=await query(from,from+limit-1);if(result.error||(result.data??[]).length===limit||attempt===2)break;await new Promise(resolve=>setTimeout(resolve,250*(attempt+1)))}return result}));for(const result of pages){if(result.error)throw result.error;rows.push(...((result.data??[]) as T[]))}if(rows.length>=maxRows||pages.some(result=>(result.data??[]).length<pageSize))return rows}}

export async function fetchProperties(clientRecords?:ClientRecord[],maxRows=50,offset=0): Promise<Property[]> {
  const db=createClient();
  const rows=await fetchAll<PropertyRow>((from,to)=>db.from("properties_safe").select("*").order("entry_date",{ascending:false}).order("id",{ascending:true}).range(from,to),maxRows,offset);
  return hydrateProperties(rows,clientRecords);
}

export async function fetchPropertyById(id:string):Promise<Property|null>{
  const {data,error}=await createClient().from("properties_safe").select("*").eq("id",id).limit(1);
  if(error)throw error;
  return (await hydrateProperties((data??[]) as PropertyRow[]))[0]??null;
}

async function hydrateProperties(rows:PropertyRow[],clientRecords?:ClientRecord[]):Promise<Property[]>{
  const db=createClient();
  if(!rows.length) return [];
  const knownClients=new Map((clientRecords??[]).map(({id,name})=>[id,name]));
  const missingClientIds=[...new Set(rows.flatMap(row=>row.client_id&&!knownClients.has(row.client_id)?[row.client_id]:[]))];
  const employeeIds=[...new Set(rows.flatMap(row=>row.assigned_to?[row.assigned_to]:[]))];
  const [lookupsResult,clientRows,employeesResult]=await Promise.all([
    db.from("lookups").select("id,type,name_ar"),
    missingClientIds.length?db.from("clients").select("id,name").is("deleted_at",null).in("id",missingClientIds):Promise.resolve({data:[],error:null}),
    employeeIds.length?db.from("profiles").select("id,full_name").in("id",employeeIds):Promise.resolve({data:[],error:null}),
  ]);
  if(lookupsResult.error) throw lookupsResult.error;
  if(employeesResult.error) throw employeesResult.error;
  const lookups=new Map(((lookupsResult.data??[]) as LookupRow[]).map(x=>[x.id,x.name_ar]));
  const clients=new Map([...knownClients,...(clientRows.data??[] as {id:string;name:string}[]).map(x=>[x.id,x.name] as const)]);
  const employees=new Map(((employeesResult.data??[]) as {id:string;full_name:string}[]).map(x=>[x.id,x.full_name]));
  return rows.map(row=>{const sourceExcel=row.source_excel??{};const sourceSearch=Object.values(sourceExcel).filter(value=>value!==null&&value!==undefined&&!String(value).startsWith("محفوظ ضمن بيانات التواصل")).join(" ");return {id:row.id,code:row.code,client:row.client_id?(clients.get(row.client_id)??"عميل غير معروف"):"غير مسجل",phones:[],type:row.type_id?(lookups.get(row.type_id)??"غير محدد"):"غير محدد",offer:row.offer_type_id?(lookups.get(row.offer_type_id)??"—"):"—",area:row.area_id?(lookups.get(row.area_id)??"غير محدد"):"غير محدد",sector:row.sector??"",distribution:row.distribution??"",block:row.block??"",plot:row.plot??"",street:row.street??"",avenue:row.avenue??"",floor:row.floor??"",buildingType:row.building_type??"",roomsDetails:row.rooms_details??"",sourceExcel,sourceSearch,locationType:row.location_type_id?(lookups.get(row.location_type_id)??""):"",size:Number(row.area_m2??0),price:row.asking_price_kwd===null?null:Number(row.asking_price_kwd),employee:row.assigned_to?(employees.get(row.assigned_to)??"غير معيّن"):"غير معيّن",status:row.status,date:row.entry_date,details:row.details??"",hasMap:row.has_map,hasContact:row.has_contact,hasLocation:row.has_location,lastContactAt:row.last_contact_at,latitude:row.latitude===null?null:Number(row.latitude),longitude:row.longitude===null?null:Number(row.longitude)}});
}

function mapSearchRow(row:SearchPropertyRow):Property{
  return {
    id:row.id,code:row.code,client:row.client,phones:row.phones??[],type:row.type,offer:row.offer,
    area:row.area,sector:row.sector,distribution:row.distribution,block:row.block,plot:row.plot,
    street:row.street,avenue:row.avenue,floor:row.floor,buildingType:row.building_type,
    roomsDetails:row.rooms_details,sourceExcel:row.source_excel??{},sourceSearch:row.source_search,
    locationType:row.location_type,size:Number(row.size??0),price:row.price===null?null:Number(row.price),
    employee:row.employee,status:row.status,date:row.date,details:row.details,
    latitude:row.latitude===null?null:Number(row.latitude),longitude:row.longitude===null?null:Number(row.longitude),
    hasMap:row.has_map,hasContact:row.has_contact,hasLocation:row.has_location,lastContactAt:row.last_contact_at,
  };
}

export async function searchProperties(filters:Record<string,unknown>):Promise<Property[]> {
  const {data,error}=await createClient().rpc("search_properties",{p_filters:filters});
  if(error)throw error;
  return ((data??[]) as SearchPropertyRow[]).map(mapSearchRow);
}

/** Every match, a page at a time; `total` is the full number of matching properties. */
export async function searchPropertiesPage(filters:Record<string,unknown>,offset=0,limit=200):Promise<{rows:Property[];total:number}>{
  const {data,error}=await createClient().rpc("search_properties_page",{p_filters:filters,p_offset:offset,p_limit:limit});
  if(error)throw error;
  const rows=(data??[]) as (SearchPropertyRow&{total_count:number|string})[];
  return {rows:rows.map(mapSearchRow),total:rows.length?Number(rows[0].total_count):0};
}

export async function revealPropertyContact(id:string,comment:string):Promise<string[]> {
  const {data,error}=await createClient().rpc("reveal_property_contact",{p_property_id:id,p_comment:comment});
  if(error) throw error;
  return ((data??[]) as {phone:string}[]).map(row=>row.phone);
}

export async function createProperty(property:Property,imageData:string|null=null) {
  const db=createClient();
  const {error}=await db.rpc("create_property_with_image",{payload:{code:property.code,client:property.client,phones:property.phones,type:property.type,offer:property.offer,area:property.area,block:property.block,plot:property.plot,street:property.street,avenue:property.avenue,floor:property.floor,building_type:property.buildingType,rooms_details:property.roomsDetails,location_type:property.locationType,size:property.size,price:property.price,employee:property.employee,details:property.details},image_data:imageData});
  if(error) throw error;
}

export async function fetchPropertyImages(id:string):Promise<{storage_path:string;caption:string|null}[]>{const {data,error}=await createClient().rpc("get_property_images",{p_property_id:id});if(error)throw error;return (data??[]) as {storage_path:string;caption:string|null}[];}

export async function updatePropertyStatus(id:string,status:Property["status"]){const db=createClient();const {error}=await db.rpc("update_property_status",{property_id:id,new_status:status});if(error)throw error;}

export async function archiveProperty(id:string,comment:string){const db=createClient();const {error}=await db.rpc("archive_property",{p_property_id:id,p_comment:comment});if(error)throw error;}

export async function updatePropertyMap(id:string,latitude:number|null,longitude:number|null){const {error}=await createClient().rpc("update_property_map",{p_property_id:id,p_latitude:latitude,p_longitude:longitude});if(error)throw error;}

export async function updatePropertyLocation(id:string,location:{area:string;sector:string;distribution:string;block:string;plot:string;street:string;locationType:string}){const {error}=await createClient().rpc("update_property_location",{p_property_id:id,p_area:location.area,p_sector:location.sector,p_distribution:location.distribution,p_block:location.block,p_plot:location.plot,p_street:location.street,p_location_type:location.locationType});if(error)throw error;}

export async function fetchFavoriteIds():Promise<string[]>{const db=createClient();const {data:{user},error:userError}=await db.auth.getUser();if(userError||!user)throw userError??new Error("Not signed in");const {data,error}=await db.from("favorites").select("property_id").eq("user_id",user.id);if(error)throw error;return ((data??[]) as {property_id:string}[]).map(row=>row.property_id);}

export async function setFavorite(id:string,shouldFavorite:boolean){const db=createClient();const {data:{user},error:userError}=await db.auth.getUser();if(userError||!user)throw userError??new Error("Not signed in");const result=shouldFavorite?await db.from("favorites").insert({user_id:user.id,property_id:id}):await db.from("favorites").delete().eq("user_id",user.id).eq("property_id",id);if(result.error)throw result.error;}

export type PropertyFileExtras={phones:string[];phonesVisible:boolean;annexes:string;canEdit:boolean};
export async function fetchPropertyFile(id:string):Promise<PropertyFileExtras>{
  const {data,error}=await createClient().rpc("get_property_file",{p_property_id:id});
  if(error)throw error;
  const row=((data??[]) as {phones:string[]|null;phones_visible:boolean;annexes:string|null;can_edit:boolean}[])[0];
  return {phones:row?.phones??[],phonesVisible:Boolean(row?.phones_visible),annexes:row?.annexes??"",canEdit:Boolean(row?.can_edit)};
}

export type PropertyFilePatch={client?:string;phones?:string[];type?:string;offer?:string;area?:string;locationType?:string;block?:string;plot?:string;street?:string;avenue?:string;sector?:string;distribution?:string;annexes?:string;details?:string;size?:string;price?:string;status?:Property["status"];latitude?:string;longitude?:string};
export async function updatePropertyFile(id:string,patch:PropertyFilePatch){
  const {error}=await createClient().rpc("update_property_file",{p_property_id:id,p_data:patch});
  if(error)throw error;
}

export type PropertyComment={id:string;body:string;authorName:string;createdAt:string};
export async function fetchPropertyComments(id:string):Promise<PropertyComment[]>{
  const {data,error}=await createClient().rpc("list_property_comments",{p_property_id:id});
  if(error)throw error;
  return ((data??[]) as {id:string;body:string;author_name:string;created_at:string}[]).map(row=>({id:row.id,body:row.body,authorName:row.author_name,createdAt:row.created_at}));
}
export async function addPropertyComment(id:string,body:string){
  const {error}=await createClient().rpc("add_property_comment",{p_property_id:id,p_body:body});
  if(error)throw error;
}

export type ExportRow={code:string;client:string;phone_1:string|null;phone_2:string|null;phone_3:string|null;type:string;offer:string;area:string;sector:string;distribution:string;block:string;plot:string;street:string;avenue:string;location_type:string;annexes:string;size:number|null;price:number|null;status:string;employee:string;entry_date:string;details:string;latitude:number|null;longitude:number|null};
export async function fetchExportRows(onProgress?:(loaded:number)=>void):Promise<ExportRow[]>{
  const db=createClient();const rows:ExportRow[]=[];const pageSize=1000;
  for(let offset=0;;offset+=pageSize){
    const {data,error}=await db.rpc("export_properties",{p_offset:offset,p_limit:pageSize});
    if(error)throw error;
    const page=(data??[]) as ExportRow[];rows.push(...page);onProgress?.(rows.length);
    if(page.length<pageSize)return rows;
  }
}
