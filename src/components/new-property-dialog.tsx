"use client";

import { FormEvent, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Building2, Check, X, ImagePlus } from "lucide-react";
import type { Property } from "@/lib/types";
import { CodedInput } from "@/components/coded-input";
import { useCodeLists } from "@/lib/code-lists";

// Built-in values, used until the admin codes these fields in Settings.
const defaults = {
  property_type: ["أرض","بيت","شقة","تجاري","عمارة","شاليه","أخرى"],
  offer_type: ["للبيع","للإيجار","للبدل","مطلوب شراء","مطلوب إيجار","مطلوب بدل"],
  area: ["الأندلس","الروضة","صباح الأحمد","السليبخات","العارضية","شرق","السالمية","حولي","الفروانية","الجابرية"],
  location_type: ["زاوية شارعين","بطن وظهر","ثلاث جهات","شارع واحد"],
};

export function NewPropertyDialog({ onClose, onSave }: { onClose:()=>void; onSave:(property:Property,imageData:string|null)=>void }) {
  const [form,setForm]=useState({code:"",client:"",phone:"",type:"",offer:"",area:"",block:"",plot:"",street:"",avenue:"",floor:"",buildingType:"",roomsDetails:"",locationType:"",size:"",price:"",employee:"",details:""});
  const [error,setError]=useState(""),[imageData,setImageData]=useState<string|null>(null);
  const codes=useCodeLists();
  const update=(key:keyof typeof form,value:string)=>setForm(old=>({...old,[key]:value}));
  const submit=(event:FormEvent)=>{event.preventDefault();setError("");if(!form.code.trim()||!form.client.trim()||!form.phone.trim()){setError("أدخل رمز العقار واسم العميل ورقم هاتف واحد على الأقل.");return}const raw=form.phone.replace(/\D/g,"");const local=raw.startsWith("965")?raw.slice(3):raw;onSave({id:crypto.randomUUID(),code:form.code.trim(),client:form.client.trim(),phones:[`+965 ${local}`],type:form.type,offer:form.offer,area:form.area,block:form.block.trim(),plot:form.plot.trim(),street:form.street.trim(),avenue:form.avenue.trim(),floor:form.floor.trim(),buildingType:form.buildingType.trim(),roomsDetails:form.roomsDetails.trim(),locationType:form.locationType,size:Number(form.size)||0,price:form.price?Number(form.price):null,employee:form.employee.trim()||"غير معيّن",status:"available",date:new Date().toISOString().slice(0,10),details:form.details.trim()},imageData)};
  const selectImage=(file:File|undefined)=>{if(!file)return;if(!["image/jpeg","image/png","image/webp"].includes(file.type)||file.size>1_400_000){setError("اختر صورة JPG أو PNG أو WebP بحجم لا يتجاوز ١٫٤ ميجابايت.");return}const reader=new FileReader();reader.onload=()=>{setImageData(typeof reader.result==="string"?reader.result:null);setError("")};reader.onerror=()=>setError("تعذر قراءة الصورة.");reader.readAsDataURL(file)};
  const input="focus-ring mt-1.5 h-10 w-full rounded-xl border border-slate-200/80 bg-white/55 px-3 text-xs outline-none dark:border-slate-700 dark:bg-slate-900/50";
  const coded=(key:keyof typeof form,field:string,label:string,fallback?:string[])=><label className="text-[11px] font-bold">{label}<CodedInput field={field} lists={codes} fallback={fallback} value={form[key]} onChange={value=>update(key,value)} className={input}/></label>;
  return <AnimatePresence><motion.div className="fixed inset-0 z-[65] grid place-items-center bg-slate-950/45 p-3 backdrop-blur-sm" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onMouseDown={e=>e.target===e.currentTarget&&onClose()}><motion.section initial={{opacity:0,y:14,scale:.98}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0,y:8}} className="glass panel w-full max-w-2xl overflow-hidden"><header className="flex items-center justify-between border-b border-slate-200/60 px-5 py-4 dark:border-slate-700"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-teal-500/10 text-teal-600"><Building2 size={19}/></span><div><h2 className="text-sm font-black">إضافة عقار جديد</h2><p className="mt-1 text-[10px] text-slate-400">أدخل بيانات العقار والعميل</p></div></div><button onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-white/60"><X size={17}/></button></header>
    <form onSubmit={submit}><div className="grid max-h-[68vh] grid-cols-1 gap-3 overflow-y-auto p-5 sm:grid-cols-2">
      <label className="text-[11px] font-bold">رمز العقار *<input required value={form.code} onChange={e=>update("code",e.target.value)} placeholder="مثال: A-2402" className={input} dir="ltr"/></label>
      <label className="text-[11px] font-bold">اسم العميل *<input required value={form.client} onChange={e=>update("client",e.target.value)} className={input}/></label>
      <label className="text-[11px] font-bold">رقم الهاتف *<input required value={form.phone} onChange={e=>update("phone",e.target.value)} placeholder="5XXX XXXX" className={input} dir="ltr"/></label>
      <label className="text-[11px] font-bold">الموظف المسؤول<input value={form.employee} onChange={e=>update("employee",e.target.value)} className={input}/></label>
      {coded("type","property_type","نوع العقار",defaults.property_type)}
      {coded("offer","offer_type","نوع العرض",defaults.offer_type)}
      {coded("area","area","المنطقة",defaults.area)}
      {coded("locationType","location_type","نوع الموقع",defaults.location_type)}
      {coded("block","block","القطعة")}
      {coded("plot","plot","القسيمة")}
      {coded("street","street","التوزيعة")}
      {coded("avenue","avenue","الجادة")}
      {coded("floor","floor","الدور")}
      {coded("buildingType","building_type","نوع المبنى")}
      <label className="text-[11px] font-bold">المساحة (م²)<input type="number" min="0" value={form.size} onChange={e=>update("size",e.target.value)} className={input}/></label>
      <label className="text-[11px] font-bold">السعر (د.ك)<input type="number" min="0" step="0.001" value={form.price} onChange={e=>update("price",e.target.value)} className={input}/></label>
      <label className="text-[11px] font-bold sm:col-span-2">صورة العقار<div className="mt-1.5 flex items-center gap-3 rounded-xl border border-dashed border-slate-300 p-3 dark:border-slate-700"><input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>selectImage(e.target.files?.[0])} className="min-w-0 flex-1 text-[10px]"/><ImagePlus size={17} className="text-teal-600"/>{imageData&&<img src={imageData} alt="معاينة صورة العقار" className="h-14 w-16 rounded-lg object-cover"/>}</div></label>
      <label className="text-[11px] font-bold sm:col-span-2">التفاصيل<textarea value={form.details} onChange={e=>update("details",e.target.value)} rows={3} className="focus-ring mt-1.5 w-full resize-y rounded-xl border border-slate-200/80 bg-white/55 p-3 text-xs outline-none dark:border-slate-700 dark:bg-slate-900/50"/></label>
      <label className="text-[11px] font-bold sm:col-span-2">تفاصيل الغرف<textarea value={form.roomsDetails} onChange={e=>update("roomsDetails",e.target.value)} rows={2} className="focus-ring mt-1.5 w-full resize-y rounded-xl border border-slate-200/80 bg-white/55 p-3 text-xs outline-none dark:border-slate-700 dark:bg-slate-900/50"/></label>
      {error&&<p role="alert" className="text-xs text-rose-600 sm:col-span-2">{error}</p>}
    </div><footer className="flex justify-between border-t border-slate-200/60 px-5 py-4 dark:border-slate-700"><button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-xs text-slate-500 hover:bg-white/60">إلغاء</button><button type="submit" className="flex items-center gap-2 rounded-xl bg-teal-500 px-5 py-2.5 text-xs font-bold text-white"><Check size={15}/> حفظ العقار</button></footer></form>
  </motion.section></motion.div></AnimatePresence>;
}
