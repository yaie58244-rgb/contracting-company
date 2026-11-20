"use client";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { Archive, ArrowRight, ChevronDown, ChevronLeft, ChevronRight, ExternalLink, Heart, Image as ImageIcon, LoaderCircle, MapPin, MessageCircle, Pencil, Phone, Printer, Save, Send, X } from "lucide-react";
import type { Property } from "@/lib/types";
import { addPropertyComment, fetchPropertyComments, fetchPropertyFile, fetchPropertyImages, type PropertyComment, type PropertyFilePatch } from "@/lib/property-data";
import { codeValues, useCodeLists } from "@/lib/code-lists";
import { CodedInput } from "@/components/coded-input";
import { fetchCompanyProfile, type CompanyProfile } from "@/lib/company-profile-data";
import { dialable } from "@/lib/phone-format";
import { digits } from "@/lib/utils";

// Built-in values, used until the admin codes these fields in Settings.
const fallbackLookups: Record<"property_type" | "offer_type" | "location_type" | "area", string[]> = {
  property_type: ["بيت", "أرض", "شقة", "عمارة", "شاليه", "محل"],
  offer_type: ["للبيع", "للإيجار", "للبدل", "مطلوب شراء"],
  location_type: ["شارع واحد", "شارعين", "ثلاث شوارع", "أربع شوارع", "زاوية شارعين", "بطن وظهر", "ثلاث جهات"],
  area: ["الأندلس", "الروضة", "صباح الأحمد", "السليبخات", "العارضية", "شرق", "السالمية", "حولي", "الفروانية", "الجابرية"],
};

type Form = { client: string; phone1: string; phone2: string; type: string; offer: string; area: string; locationType: string; sector: string; block: string; plot: string; street: string; annexes: string; size: string; price: string; status: Property["status"]; details: string };

const statusLabel = (status: Property["status"]) => status === "available" ? "متاح" : status === "sold" ? "مباع" : "مفقود";
const dateFormat = new Intl.DateTimeFormat("ar-KW-u-nu-latn", { year: "numeric", month: "2-digit", day: "2-digit" });
const timeFormat = new Intl.DateTimeFormat("ar-KW-u-nu-latn", { hour: "2-digit", minute: "2-digit" });

/** Reads "29.3, 47.9" or a Google Maps link (…@lat,lng / ?q=lat,lng / !3dlat!4dlng). */
export function parseMapInput(value: string): { latitude: number; longitude: number } | null {
  const text = digits(value.trim()).replace(/،/g, ",");
  const patterns = [/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/, /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/, /[?&](?:q|query|ll|center)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/, /^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const latitude = Number(match[1]), longitude = Number(match[2]);
    if (Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) return { latitude, longitude };
  }
  return null;
}

function formFrom(property: Property, phones: string[], annexes: string): Form {
  return { client: property.client === "غير مسجل" ? "" : property.client, phone1: phones[0] ?? "", phone2: phones[1] ?? "", type: property.type === "غير محدد" ? "" : property.type, offer: property.offer === "—" ? "" : property.offer, area: property.area === "غير محدد" ? "" : property.area, locationType: property.locationType, sector: property.sector ?? "", block: property.block, plot: property.plot, street: property.street, annexes, size: property.size ? String(property.size) : "", price: property.price === null ? "" : String(property.price), status: property.status, details: property.details };
}

function readLocalComments(id: string): PropertyComment[] {
  try { return JSON.parse(localStorage.getItem(`aqar-property-comments-${id}`) ?? "[]") as PropertyComment[]; } catch { return []; }
}

export function PropertyDetails({ property, favorite, remote, navigationIds = [property.id], backLabel, onClose, onNavigate, onFavorite, onArchive, onSave }: { property: Property; favorite: boolean; remote: boolean; navigationIds?: string[]; backLabel?: string; onClose: () => void; onNavigate?: (id: string) => void; onFavorite: () => void; onArchive: (comment: string) => void; onSave: (patch: PropertyFilePatch) => Promise<void> }) {
  const [phones, setPhones] = useState<string[]>(property.phones);
  const [phonesVisible, setPhonesVisible] = useState(!remote);
  const [annexes, setAnnexes] = useState(property.annexes ?? "");
  const [canEdit, setCanEdit] = useState(!remote);
  const [fileLoading, setFileLoading] = useState(remote);
  const codes = useCodeLists();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Form>(() => formFrom(property, property.phones, property.annexes ?? ""));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [mapInput, setMapInput] = useState("");
  const [comments, setComments] = useState<PropertyComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(remote);
  const [newComment, setNewComment] = useState("");
  const [commentError, setCommentError] = useState("");
  const [postingComment, setPostingComment] = useState(false);
  const [allComments, setAllComments] = useState(false);
  const [images, setImages] = useState<{ storage_path: string; caption: string | null }[]>([]);
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveComment, setArchiveComment] = useState("");

  const loadFile = useCallback(async () => {
    if (!remote) return;
    setFileLoading(true);
    try {
      const file = await fetchPropertyFile(property.id);
      setPhones(file.phones); setPhonesVisible(file.phonesVisible); setAnnexes(file.annexes); setCanEdit(file.canEdit);
    } catch (cause) {
      setError(cause instanceof Error ? `تعذر تحميل بيانات الملف: ${cause.message}` : "تعذر تحميل بيانات الملف.");
    } finally { setFileLoading(false); }
  }, [remote, property.id]);

  const loadComments = useCallback(async () => {
    if (!remote) { setComments(readLocalComments(property.id)); return; }
    setCommentsLoading(true);
    try { setComments(await fetchPropertyComments(property.id)); }
    catch (cause) { setCommentError(cause instanceof Error ? cause.message : "تعذر تحميل التعليقات."); }
    finally { setCommentsLoading(false); }
  }, [remote, property.id]);

  useEffect(() => { void loadFile(); void loadComments(); }, [loadFile, loadComments]);
  useEffect(() => { if (!editing) setForm(formFrom(property, phones, annexes)); }, [property, phones, annexes, editing]);
  useEffect(() => {
    if (!remote) { setImages(property.imageData ? [{ storage_path: property.imageData, caption: "صورة العقار" }] : []); return; }
    let active = true;
    void Promise.allSettled([fetchCompanyProfile(), fetchPropertyImages(property.id)]).then(([profile, photos]) => {
      if (!active) return;
      if (profile.status === "fulfilled") setCompany(profile.value);
      if (photos.status === "fulfilled") setImages(photos.value);
    });
    return () => { active = false; };
  }, [remote, property.id, property.imageData]);

  // Esc closes the file, like the back button.
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !editing) onClose(); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [onClose, editing]);

  const save = async (patch: PropertyFilePatch) => {
    setSaving(true); setError("");
    try { await onSave(patch); await loadFile(); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر حفظ التعديلات. تحقق من صلاحية تعديل العقار."); return false; }
    finally { setSaving(false); }
  };

  const saveForm = async () => {
    const size = digits(form.size).trim(), price = digits(form.price).trim();
    if (size && !Number.isFinite(Number(size))) { setError("المساحة يجب أن تكون رقمًا."); return; }
    if (price && !Number.isFinite(Number(price))) { setError("السعر يجب أن يكون رقمًا."); return; }
    const patch: PropertyFilePatch = { client: form.client.trim(), type: form.type, offer: form.offer, area: form.area, locationType: form.locationType, sector: form.sector, block: form.block, plot: form.plot, street: form.street, annexes: form.annexes, size, status: form.status, details: form.details };
    if (property.price !== null || price) patch.price = price;
    if (phonesVisible) patch.phones = [form.phone1, form.phone2, ...phones.slice(2)].map(value => digits(value).trim()).filter(Boolean);
    if (await save(patch)) setEditing(false);
  };

  const quickSave = (patch: PropertyFilePatch) => { if (canEdit) void save(patch); };

  const saveMap = async () => {
    if (!mapInput.trim()) { await save({ latitude: "", longitude: "" }); return; }
    const point = parseMapInput(mapInput);
    if (!point) { setError("الصق رابط Google Maps الكامل أو اكتب الإحداثيات مثل 29.3375, 47.9744. الروابط المختصرة (maps.app.goo.gl) افتحها أولًا ثم انسخ الرابط الكامل."); return; }
    if (await save({ latitude: String(point.latitude), longitude: String(point.longitude) })) setMapInput("");
  };

  const postComment = async () => {
    const body = newComment.trim();
    if (body.length < 2) { setCommentError("اكتب التعليق أولًا."); return; }
    setPostingComment(true); setCommentError("");
    try {
      if (remote) { await addPropertyComment(property.id, body); await loadComments(); }
      else { const next = [{ id: crypto.randomUUID(), body, authorName: "أنت", createdAt: new Date().toISOString() }, ...comments]; setComments(next); try { localStorage.setItem(`aqar-property-comments-${property.id}`, JSON.stringify(next)); } catch { /* preview only */ } }
      setNewComment("");
    } catch (cause) { setCommentError(cause instanceof Error ? cause.message : "تعذر إضافة التعليق."); }
    finally { setPostingComment(false); }
  };

  const hasMap = property.latitude !== null && property.latitude !== undefined && property.longitude !== null && property.longitude !== undefined;
  const navigationIndex = Math.max(0, navigationIds.indexOf(property.id));
  const sourceFields = useMemo(() => Object.entries(property.sourceExcel ?? {}).filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== ""), [property.sourceExcel]);
  const options = (list: string[], current: string) => current && !list.includes(current) ? [current, ...list] : list;
  const set = (key: keyof Form) => (value: string) => setForm(old => ({ ...old, [key]: value }));

  const text = (key: keyof Form, label: string, value: string, extra?: { dir?: "ltr"; inputMode?: "numeric" | "decimal" | "tel"; field?: string }) =>
    <Field label={label}>{editing ? (extra?.field
      ? <CodedInput field={extra.field} lists={codes} value={form[key]} onChange={set(key)} className={inputClass} inputProps={{ dir: extra.dir, inputMode: extra.inputMode }}/>
      : <input value={form[key]} onChange={e => set(key)(e.target.value)} dir={extra?.dir} inputMode={extra?.inputMode} className={inputClass}/>) : <Value>{value || "—"}</Value>}</Field>;
  const select = (key: keyof Form, label: string, list: string[], value: string) =>
    <Field label={label}>{editing ? <select value={form[key]} onChange={e => set(key)(e.target.value)} className={inputClass}><option value="">—</option>{options(list, form[key]).map(x => <option key={x}>{x}</option>)}</select> : <Value>{value || "—"}</Value>}</Field>;

  return <motion.div className="fixed inset-0 z-[62] grid place-items-center bg-slate-950/45 p-2 backdrop-blur-[2px] sm:p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={e => e.target === e.currentTarget && !editing && onClose()}>
    <motion.section dir="rtl" initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 10, opacity: 0 }} transition={{ duration: .2 }} className="flex max-h-[96vh] w-full max-w-5xl flex-col overflow-hidden rounded-[24px] border border-slate-200 bg-white text-slate-900 shadow-2xl dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
      <header className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-700 sm:px-5">
        <button onClick={onClose} disabled={editing} className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900"><ArrowRight size={15}/>{backLabel ?? "رجوع"}</button>
        <div className="min-w-0 flex-1 px-2"><div className="text-[10px] font-bold text-slate-400">ملف العقار</div><div className="truncate text-sm font-black">{property.code} · {property.type} {property.offer !== "—" ? `· ${property.offer}` : ""}</div></div>
        {fileLoading && <LoaderCircle size={16} className="animate-spin text-teal-500"/>}
        {canEdit && !editing && <button onClick={() => { setError(""); setEditing(true); }} className="flex items-center gap-1.5 rounded-xl bg-teal-600 px-3 py-2 text-xs font-bold text-white"><Pencil size={14}/>تعديل البيانات</button>}
        {editing && <><button onClick={() => { setEditing(false); setError(""); }} className="rounded-xl px-3 py-2 text-xs font-bold text-slate-500">إلغاء</button><button disabled={saving} onClick={() => void saveForm()} className="flex items-center gap-1.5 rounded-xl bg-teal-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">{saving ? <LoaderCircle size={14} className="animate-spin"/> : <Save size={14}/>}حفظ التعديلات</button></>}
        <button onClick={() => window.print()} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="طباعة ملف العقار"><Printer size={17}/></button>
        <button onClick={onFavorite} className={`rounded-lg p-2 ${favorite ? "text-rose-500" : "text-slate-400"}`} aria-label="إضافة للمفضلة"><Heart size={18} fill={favorite ? "currentColor" : "none"}/></button>
        <button onClick={onClose} disabled={editing} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-slate-800" aria-label="إغلاق"><X size={18}/></button>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
        {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{error}</p>}

        {/* Top: client name (right) · phone numbers (left) */}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-4">
            <Box title="اسم العميل">{editing ? <input value={form.client} onChange={e => set("client")(e.target.value)} className={inputClass}/> : <div className="text-lg font-black">{property.client}</div>}</Box>
            <Box title="نوع الموقع">
              <select value={editing ? form.locationType : property.locationType} disabled={!canEdit || saving} onChange={e => editing ? set("locationType")(e.target.value) : quickSave({ locationType: e.target.value })} className={inputClass}>
                <option value="">اختر نوع الموقع</option>{options(codeValues(codes, "location_type", fallbackLookups.location_type), editing ? form.locationType : property.locationType).map(x => <option key={x}>{x}</option>)}
              </select>
              {!canEdit && <p className="mt-1.5 text-[10px] text-slate-400">التعديل متاح لمن لديه صلاحية تعديل العقارات.</p>}
            </Box>
          </div>
          <div className="space-y-4">
            <Box title="رقم التليفون"><PhoneRow value={editing ? form.phone1 : phones[0]} editing={editing && phonesVisible} onChange={set("phone1")} hidden={!phonesVisible} loading={fileLoading}/></Box>
            <Box title="رقم ٢"><PhoneRow value={editing ? form.phone2 : phones[1]} editing={editing && phonesVisible} onChange={set("phone2")} hidden={!phonesVisible} loading={fileLoading}/></Box>
            {phones.length > 2 && !editing && <div className="text-[10px] text-slate-500">أرقام إضافية: <span dir="ltr">{phones.slice(2).join(" · ")}</span></div>}
          </div>
        </div>

        {/* Map */}
        <Box title="الخريطة" action={hasMap ? <a href={`https://www.google.com/maps?q=${property.latitude},${property.longitude}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[10px] font-bold text-teal-700 dark:text-teal-400"><ExternalLink size={12}/>فتح في Google Maps</a> : undefined}>
          {hasMap ? <iframe title="موقع العقار على الخريطة" src={`https://maps.google.com/maps?q=${property.latitude},${property.longitude}&z=17&output=embed`} loading="lazy" className="h-64 w-full rounded-xl border-0 sm:h-72"/> : <div className="grid h-40 place-items-center rounded-xl border border-dashed border-slate-300 text-center text-xs text-slate-400 dark:border-slate-700"><div><MapPin className="mx-auto mb-2 text-slate-300" size={26}/>لم يُحدد موقع العقار على الخريطة بعد</div></div>}
          {canEdit && <div className="mt-3 flex flex-wrap gap-2"><input value={mapInput} onChange={e => setMapInput(e.target.value)} dir="ltr" placeholder="الصق رابط Google Maps أو 29.3375, 47.9744" className={`${inputClass} mt-0 min-w-0 flex-1`}/><button disabled={saving || (!mapInput.trim() && !hasMap)} onClick={() => void saveMap()} className="rounded-xl bg-slate-900 px-3 py-2 text-[11px] font-bold text-white disabled:opacity-40 dark:bg-white dark:text-slate-900">{mapInput.trim() ? "حفظ الموقع" : hasMap ? "حذف الموقع" : "حفظ الموقع"}</button></div>}
        </Box>

        {/* Grid from the sketch */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {select("offer", "نوع العرض", codeValues(codes, "offer_type", fallbackLookups.offer_type), property.offer === "—" ? "" : property.offer)}
          {select("area", "المنطقة", codeValues(codes, "area", fallbackLookups.area), property.area === "غير محدد" ? "" : property.area)}
          {text("sector", "القطاع", property.sector ?? "", { field: "sector" })}
          {text("block", "القطعة", property.block, { field: "block" })}
          {text("street", "الشارع", property.street, { field: "street" })}
          {text("plot", "القسيمة", property.plot, { field: "plot" })}
          {text("annexes", "التوابع", annexes, { field: "annexes" })}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {select("type", "نوع العقار", codeValues(codes, "property_type", fallbackLookups.property_type), property.type === "غير محدد" ? "" : property.type)}
          {text("size", "المساحة م²", property.size ? property.size.toLocaleString("en-US") : "", { inputMode: "decimal" })}
          {text("price", "السعر د.ك", property.price === null ? "مخفي" : property.price.toLocaleString("en-US"), { inputMode: "decimal" })}
          <Field label="الحالة"><select value={editing ? form.status : property.status} disabled={!canEdit || saving} onChange={e => editing ? set("status")(e.target.value) : quickSave({ status: e.target.value as Property["status"] })} className={inputClass}><option value="available">متاح</option><option value="sold">مباع</option><option value="lost">مفقود</option></select></Field>
        </div>
        <Field label="التفاصيل">{editing ? <textarea value={form.details} onChange={e => set("details")(e.target.value)} rows={3} className={`${inputClass} h-auto py-2`}/> : <Value><span className="whitespace-pre-wrap font-medium leading-6">{property.details || "—"}</span></Value>}</Field>

        {/* Comments with date and marketer name */}
        <section className="rounded-2xl border border-slate-200 dark:border-slate-700">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700"><div className="flex items-center gap-2 text-sm font-black"><MessageCircle size={16} className="text-teal-600"/>التعليقات</div><span className="text-[10px] text-slate-400">{comments.length.toLocaleString("ar-KW")} تعليق</span></div>
          {/* The two newest comments stay visible; the rest open from the arrow under them. */}
          <div className={allComments ? "max-h-96 overflow-y-auto" : ""}>
            <table className="w-full text-right text-xs">
              <thead className="sticky top-0 bg-slate-50 text-[10px] text-slate-500 dark:bg-slate-900"><tr><th className="w-36 px-4 py-2.5 font-bold">اسم المسوق</th><th className="w-32 px-4 py-2.5 font-bold">التاريخ</th><th className="px-4 py-2.5 font-bold">التعليق</th></tr></thead>
              <tbody>
                {(allComments ? comments : comments.slice(0, VISIBLE_COMMENTS)).map(comment => <tr key={comment.id} className="border-t border-slate-100 align-top dark:border-slate-800"><td className="px-4 py-2.5 font-bold">{comment.authorName}</td><td className="px-4 py-2.5 tabular-nums text-slate-500"><div>{dateFormat.format(new Date(comment.createdAt))}</div><div className="text-[10px] text-slate-400">{timeFormat.format(new Date(comment.createdAt))}</div></td><td className="whitespace-pre-wrap px-4 py-2.5 leading-6">{comment.body}</td></tr>)}
                {!comments.length && <tr><td colSpan={3} className="px-4 py-8 text-center text-slate-400">{commentsLoading ? "جارٍ تحميل التعليقات…" : "لا توجد تعليقات على هذا العقار بعد."}</td></tr>}
              </tbody>
            </table>
          </div>
          {comments.length > VISIBLE_COMMENTS && <button type="button" onClick={() => setAllComments(value => !value)} aria-expanded={allComments} className="flex w-full items-center justify-center gap-1.5 border-t border-slate-200 bg-slate-50/70 px-4 py-2.5 text-[11px] font-bold text-teal-700 hover:bg-teal-50 dark:border-slate-700 dark:bg-slate-900/50 dark:text-teal-300 dark:hover:bg-slate-900">
            {allComments ? "إخفاء التعليقات الأقدم" : `عرض كل التعليقات (${comments.length.toLocaleString("ar-KW")})`}
            <ChevronDown size={15} className={`transition-transform ${allComments ? "rotate-180" : ""}`}/>
          </button>}
          <div className="flex gap-2 border-t border-slate-200 p-3 dark:border-slate-700"><textarea value={newComment} onChange={e => setNewComment(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void postComment(); }} rows={2} maxLength={2000} placeholder="اكتب تعليقًا… سيُحفظ باسمك وتاريخ اليوم" className={`${inputClass} mt-0 h-auto flex-1 py-2`}/><button disabled={postingComment || newComment.trim().length < 2} onClick={() => void postComment()} className="flex items-center gap-1.5 self-end rounded-xl bg-teal-600 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-40">{postingComment ? <LoaderCircle size={14} className="animate-spin"/> : <Send size={14}/>}إضافة</button></div>
          {commentError && <p role="alert" className="px-4 pb-3 text-[11px] text-rose-600">{commentError}</p>}
        </section>

        <div className="grid gap-3 text-[11px] text-slate-500 sm:grid-cols-3"><div>الموظف المسؤول: <b className="text-slate-700 dark:text-slate-200">{property.employee}</b></div><div>تاريخ الإضافة: <b className="tabular-nums text-slate-700 dark:text-slate-200">{dateFormat.format(new Date(property.date))}</b></div><div>{[property.distribution && `التوزيع ${property.distribution}`, property.avenue && `الجادة ${property.avenue}`].filter(Boolean).join(" · ")}</div></div>

        <details className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700"><summary className="flex cursor-pointer items-center gap-2 text-xs font-extrabold"><ImageIcon size={15} className="text-teal-600"/>صور العقار ({images.length})</summary>{images.length ? <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">{images.map((image, index) => <figure key={`${index}-${image.caption}`} className="overflow-hidden rounded-xl"><img src={image.storage_path} alt={image.caption || `صورة العقار ${index + 1}`} className="aspect-video w-full object-cover"/></figure>)}</div> : <p className="mt-3 text-[11px] text-slate-400">لا توجد صور مرفقة.</p>}</details>
        {sourceFields.length > 0 && <details className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700"><summary className="cursor-pointer text-xs font-extrabold">الحقول الأصلية من ملف Excel ({sourceFields.length})</summary><dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">{sourceFields.map(([key, value]) => <div key={key} className="rounded-lg bg-slate-50 p-2 dark:bg-slate-900"><dt className="text-[9px] text-slate-400">{key}</dt><dd className="mt-1 break-words text-[10px] font-semibold">{String(value)}</dd></div>)}</dl></details>}
        <div className="rounded-2xl border border-rose-100 p-4 dark:border-rose-900/50"><button onClick={() => setArchiveOpen(value => !value)} className="flex items-center gap-1.5 text-[11px] font-bold text-rose-600"><Archive size={14}/>أرشفة العقار</button>{archiveOpen && <div className="mt-3 space-y-2"><label className="block text-[10px] font-bold">سبب الأرشفة سيظهر في سجل المحذوفات<textarea value={archiveComment} onChange={e => setArchiveComment(e.target.value)} rows={2} maxLength={500} className={`${inputClass} h-auto py-2`}/></label><button disabled={archiveComment.trim().length < 3} onClick={() => onArchive(archiveComment.trim())} className="rounded-lg bg-rose-600 px-3 py-2 text-[10px] font-bold text-white disabled:opacity-40">تأكيد الأرشفة</button></div>}</div>
      </div>

      {navigationIds.length > 1 && <footer className="flex items-center justify-between border-t border-slate-200 px-5 py-3 dark:border-slate-700"><button type="button" onClick={() => onNavigate?.(navigationIds[navigationIndex - 1])} disabled={navigationIndex <= 0 || editing} aria-label="العقار السابق" className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 text-slate-600 disabled:opacity-30 dark:border-slate-700 dark:text-slate-300"><ChevronRight size={19}/></button><span className="text-[11px] text-slate-500">العقار {(navigationIndex + 1).toLocaleString("ar-KW")} من {navigationIds.length.toLocaleString("ar-KW")} في النتائج</span><button type="button" onClick={() => onNavigate?.(navigationIds[navigationIndex + 1])} disabled={navigationIndex >= navigationIds.length - 1 || editing} aria-label="العقار التالي" className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 text-slate-600 disabled:opacity-30 dark:border-slate-700 dark:text-slate-300"><ChevronLeft size={19}/></button></footer>}

      <div className="print-sheet hidden" dir="rtl"><header className="mb-8 flex items-center justify-between border-b-2 border-slate-800 pb-5"><img src={company?.logo_url || "/brand/albatoul-logo.png"} alt="شعار الشركة" className="h-20 max-w-40 object-contain"/><div><h1 className="text-2xl font-black">{company?.name_ar || "ملف العقار"}</h1>{company?.name_en && <div className="mt-1 text-sm" dir="ltr">{company.name_en}</div>}<p className="mt-2 text-xs">{[company?.phone && `هاتف: ${company.phone}`, company?.fax && `فاكس: ${company.fax}`, company?.address].filter(Boolean).join(" · ")}</p></div><div className="text-left text-sm"><b>{property.code}</b><div className="mt-1">{dateFormat.format(new Date(property.date))}</div></div></header><h2 className="mb-4 text-xl font-bold">{property.type} · {property.offer}</h2><div className="grid grid-cols-3 gap-4 text-sm"><PrintField label="اسم العميل" value={property.client}/><PrintField label="رقم التليفون" value={phones[0] ?? "—"}/><PrintField label="رقم ٢" value={phones[1] ?? "—"}/><PrintField label="نوع الموقع" value={property.locationType || "—"}/><PrintField label="نوع العرض" value={property.offer}/><PrintField label="المنطقة" value={property.area}/><PrintField label="القطاع" value={property.sector || "—"}/><PrintField label="القطعة" value={property.block || "—"}/><PrintField label="الشارع" value={property.street || "—"}/><PrintField label="القسيمة" value={property.plot || "—"}/><PrintField label="التوابع" value={annexes || "—"}/><PrintField label="المساحة" value={`${property.size} م²`}/><PrintField label="السعر" value={property.price === null ? "مخفي" : `${property.price.toLocaleString("en-KW")} د.ك`}/><PrintField label="الحالة" value={statusLabel(property.status)}/></div><div className="mt-6 border-t pt-4"><b className="text-sm">التفاصيل</b><p className="mt-2 whitespace-pre-wrap text-sm leading-7">{property.details || "—"}</p></div>{comments.length > 0 && <table className="mt-6 w-full border text-right text-xs"><thead><tr><th className="border p-2">اسم المسوق</th><th className="border p-2">التاريخ</th><th className="border p-2">التعليق</th></tr></thead><tbody>{comments.slice(0, 20).map(comment => <tr key={comment.id}><td className="border p-2">{comment.authorName}</td><td className="border p-2">{dateFormat.format(new Date(comment.createdAt))}</td><td className="border p-2">{comment.body}</td></tr>)}</tbody></table>}<footer className="mt-12 border-t pt-3 text-center text-[10px] text-slate-500">نسخة مطبوعة من نظام إدارة العقارات</footer></div>
    </motion.section>
  </motion.div>;
}

/** Comments shown before the "show all" arrow. */
const VISIBLE_COMMENTS = 2;
const inputClass = "focus-ring mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs outline-none disabled:opacity-70 dark:border-slate-700 dark:bg-slate-900";

function Box({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return <section className="rounded-2xl border-2 border-slate-200 p-4 dark:border-slate-700"><div className="mb-2 flex items-center justify-between"><div className="text-[11px] font-black text-slate-500 dark:text-slate-400">{title}</div>{action}</div>{children}</section>;
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="rounded-2xl border-2 border-slate-200 p-3 dark:border-slate-700"><div className="text-[10px] font-black text-slate-500 dark:text-slate-400">{label}</div>{children}</div>;
}
function Value({ children }: { children: ReactNode }) { return <div className="mt-1 min-h-6 break-words text-sm font-bold">{children}</div>; }
function PhoneRow({ value, editing, hidden, loading, onChange }: { value?: string; editing: boolean; hidden: boolean; loading: boolean; onChange: (value: string) => void }) {
  if (editing) return <input value={value ?? ""} onChange={e => onChange(e.target.value)} dir="ltr" inputMode="tel" placeholder="مثال: 99999999" className={inputClass}/>;
  if (hidden) return <div className="text-[11px] text-slate-400">{loading ? "جارٍ التحميل…" : "عرض الأرقام غير مفعّل لحسابك"}</div>;
  if (!value) return <div className="text-sm font-bold text-slate-300">—</div>;
  const number = dialable(value);
  return <div className="flex items-center gap-2"><Phone size={15} className="text-teal-600"/><a href={`tel:+${number}`} dir="ltr" className="flex-1 text-left text-base font-black tabular-nums">{value}</a><a href={`https://wa.me/${number}`} target="_blank" rel="noreferrer" className="rounded-lg bg-emerald-500/10 px-2.5 py-1.5 text-[10px] font-bold text-emerald-700">واتساب</a><a href={`tel:+${number}`} className="rounded-lg bg-teal-500/10 px-2.5 py-1.5 text-[10px] font-bold text-teal-700">اتصال</a></div>;
}
function PrintField({ label, value }: { label: string; value: string }) { return <div className="border-b border-slate-200 pb-2"><div className="text-[10px] text-slate-500">{label}</div><div className="mt-1 font-bold">{value}</div></div>; }
