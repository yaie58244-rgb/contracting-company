export type ImportField="code"|"client"|"phone"|"type"|"offer"|"area"|"block"|"plot"|"street"|"locationType"|"size"|"price"|"employee"|"status"|"details";
export const importFields:{key:ImportField;label:string;aliases:string[]}[]=[
 {key:"code",label:"رمز العقار",aliases:["رمز العقار","الكود","رقم العقار","property code","code","رقم"]},{key:"client",label:"اسم العميل",aliases:["اسم العميل","العميل","صاحب العقار","اسم المالك","client name","client","owner"]},{key:"phone",label:"رقم الهاتف",aliases:["الهاتف","رقم الهاتف","تليفون","موبايل","هاتف العميل","phone","mobile","tel"]},{key:"type",label:"نوع العقار",aliases:["نوع العقار","النوع","تصنيف العقار","property type","type"]},{key:"offer",label:"نوع العرض",aliases:["نوع العرض","العرض","مطلوب / معروض","offer type","offer"]},{key:"area",label:"المنطقة",aliases:["المنطقة","المنطقه","اسم المنطقة","area","district"]},{key:"block",label:"القطعة",aliases:["القطعة","قطعة","البلوك","block","qitaa"]},{key:"plot",label:"القسيمة",aliases:["القسيمة","قسيمة","رقم القسيمة","plot","plot number"]},{key:"street",label:"التوزيعة",aliases:["التوزيعة","توزيعة","الشارع","شارع","street"]},{key:"locationType",label:"نوع الموقع",aliases:["نوع الموقع","الموقع","واجهة","location type"]},{key:"size",label:"المساحة (م²)",aliases:["المساحة","المساحه","المساحة م2","مساحة العقار","size","area m2","sqm"]},{key:"price",label:"السعر (د.ك)",aliases:["السعر","المبلغ","القيمة","سعر العقار","price","amount"]},{key:"employee",label:"الموظف المسؤول",aliases:["الموظف","المسؤول","المندوب","الموظف المسؤول","employee","agent"]},{key:"status",label:"الحالة",aliases:["الحالة","حالة العقار","status"]},{key:"details",label:"التفاصيل",aliases:["التفاصيل","ملاحظات","الوصف","details","notes"]}
];
export function digits(value:string){return value.replace(/[٠-٩]/g,d=>String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))}
export function clean(value:unknown,trimValue=true){const text=digits(String(value??""));return trimValue?text.trim():text}
export function normalizeHeader(value:unknown){return String(value??"").toLowerCase().replace(/[أإآ]/g,"ا").replace(/ى/g,"ي").replace(/ة/g,"ه").replace(/[\s_\-./()]/g,"")}
function score(a:string,b:string){if(a===b)return 1;if(a.includes(b)||b.includes(a))return Math.min(a.length,b.length)/Math.max(a.length,b.length);let same=0;for(const ch of a)if(b.includes(ch))same++;return same/Math.max(a.length,b.length,1)}
export function autoMap(headers:unknown[]){const result:Record<string,number>={};for(const field of importFields){let best={index:-1,value:0};for(let i=0;i<headers.length;i++){const header=normalizeHeader(headers[i]);for(const alias of field.aliases){const value=score(header,normalizeHeader(alias));if(value>best.value)best={index:i,value}}}if(best.value>=.55)result[field.key]=best.index}return result}
export function parseNumber(value:unknown){const number=digits(String(value??"")).replace(/[٬,،]/g,"").replace(/[^\d.\-]/g,"");return Number(number)||0}
export function normalizePhone(value:unknown){let number=digits(String(value??"")).replace(/\D/g,"");if(!number)return "";if(number.startsWith("965"))number=number.slice(3);if(number.startsWith("00965"))number=number.slice(5);return `+965 ${number}`}
export function splitPhones(value:unknown){
 const chunks=digits(String(value??"")).split(/[\/،,;|\n]+/).map(x=>x.trim()).filter(Boolean);
 const parts=chunks.flatMap(chunk=>{
  const number=chunk.replace(/\D/g,"");if(!number)return [];
  if(number.length===11&&number.startsWith("965"))return [number];
  if(number.length===13&&number.startsWith("00965"))return [number.slice(2)];
  if(number.length>13&&number.length%13===0){const group=[];for(let i=0;i<number.length;i+=13){const candidate=number.slice(i,i+13);if(!candidate.startsWith("00965"))return [number];group.push(candidate.slice(2))}return group}
  if(number.length>8&&number.length%11===0){const group=[];for(let i=0;i<number.length;i+=11){const candidate=number.slice(i,i+11);if(!candidate.startsWith("965"))return [number];group.push(candidate)}return group}
  if(number.length>8&&number.length%8===0){const group=[];for(let i=0;i<number.length;i+=8)group.push(number.slice(i,i+8));return group}
  return [number];
 });
 return parts.map(normalizePhone).filter(Boolean);
}

export type StagedProperty={index:number;errors:string[];warnings:string[];property:import("@/lib/types").Property};
export async function validatePropertyRows(rows:unknown[][],mapping:Record<string,number>,options:{trim:boolean;cleanPhones:boolean;date:string},onProgress?:(count:number,total:number)=>void):Promise<StagedProperty[]>{
 const seenCodes=new Set<string>(),seenPhones=new Set<string>();const result:StagedProperty[]=[];const total=Math.max(0,rows.length-1);
 for(let rowIndex=1;rowIndex<rows.length;rowIndex++){
  const row=rows[rowIndex];const get=(key:ImportField)=>mapping[key]===undefined?"":row[mapping[key]];const value=(key:ImportField)=>clean(get(key),options.trim);
  const phones=options.cleanPhones?splitPhones(value("phone")):[normalizePhone(value("phone"))].filter(Boolean);const code=value("code")||`IMP-${String(rowIndex).padStart(5,"0")}`;const client=value("client");const price=parseNumber(get("price"));const size=parseNumber(get("size"));const errors:string[]=[];const warnings:string[]=[];
  if(!client)errors.push("اسم العميل غير موجود");if(!phones.length)errors.push("رقم الهاتف غير موجود");if(get("price")&&!price)errors.push("السعر غير صالح");if(get("size")&&!size)errors.push("المساحة غير صالحة");
  if(seenCodes.has(code))warnings.push("رمز العقار مكرر داخل الملف");seenCodes.add(code);
  if(phones.some(phone=>seenPhones.has(phone)))warnings.push("رقم الهاتف مكرر داخل الملف");for(const phone of phones)seenPhones.add(phone);
  const statusValue=value("status").toLowerCase();const status:import("@/lib/types").PropertyStatus=statusValue.includes("مباع")||statusValue.includes("sold")?"sold":statusValue.includes("مفقود")||statusValue.includes("lost")?"lost":"available";
  result.push({index:rowIndex-1,errors,warnings,property:{id:`imp-${rowIndex}-${code}`,code,client,phones,type:value("type")||"غير محدد",offer:value("offer")||"للبيع",area:value("area")||"غير محدد",block:value("block"),plot:value("plot"),street:value("street"),locationType:value("locationType"),size,price,employee:value("employee")||"غير معيّن",status,date:options.date,details:value("details")}});
  if(rowIndex%5000===0){onProgress?.(rowIndex,total);await new Promise(resolve=>setTimeout(resolve,0))}
 }
 onProgress?.(total,total);return result;
}
