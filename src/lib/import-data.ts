"use client";
import { createClient } from "@/lib/supabase/client";
import type { StagedProperty } from "@/lib/import-utils";

export type ImportProgress={phase:"staging"|"processing";done:number;total:number;created:number;skipped:number;failed:number};
export type ImportResult={batchId:string|null;created:number;updated:number;skipped:number;failed:number};
export type DuplicateStrategy="skip"|"update"|"create_anyway";
export async function runPropertyImport(fileName:string,rows:StagedProperty[],strategy:DuplicateStrategy,onProgress:(progress:ImportProgress)=>void){
 const db=createClient();const {data:batchId,error:createError}=await db.rpc("create_import_batch",{p_file_name:fileName,p_target:"properties",p_duplicate_strategy:strategy});if(createError)throw createError;
 const batch=String(batchId);let staged=0;const total=rows.length;
 for(let start=0;start<rows.length;start+=500){const chunk=rows.slice(start,start+500);const {error}=await db.rpc("stage_import_batch_rows",{p_batch_id:batch,p_rows:chunk});if(error)throw error;staged+=chunk.length;onProgress({phase:"staging",done:staged,total,created:0,skipped:0,failed:0});}
 let result={batchId:batch,created:0,updated:0,skipped:0,failed:0};let processed=0;let status="staged";
 while(status==="staged"||status==="processing"){
  const {data,error}=await db.rpc("process_import_batch",{p_batch_id:batch,p_limit:500});if(error)throw error;
  const value=data as {processed:number;status:string;created:number;updated:number;skipped:number;failed:number;total:number};
  status=value.status;processed+=value.processed;result={batchId:batch,created:value.created,updated:value.updated,skipped:value.skipped,failed:value.failed};const done=Math.min(total,value.created+value.updated+value.skipped+value.failed);onProgress({phase:"processing",done, total,created:value.created,skipped:value.skipped,failed:value.failed});
  if(value.processed===0&&status==="processing")throw new Error("Import worker made no progress; resume this batch from import history.");
 }
 return result;
}
