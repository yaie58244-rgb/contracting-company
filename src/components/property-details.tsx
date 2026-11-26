"use client";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { ArrowDownUp, ArrowRight, ChevronDown, ChevronLeft, ChevronRight, Heart, Image as ImageIcon, LoaderCircle, MessageCircle, Pencil, Phone, Printer, Save, Send, X } from "lucide-react";
import type { Property } from "@/lib/types";
import { PROPERTY_EDIT_SCOPES, addPropertyComment, fetchPropertyComments, fetchPropertyFile, type PropertyComment, type PropertyEditScope, type PropertyFilePatch } from "@/lib/property-data";
import { codeValues, useCodeLists } from "@/lib/code-lists";
import { CodedInput } from "@/components/coded-input";
import { sectorsOf, useAreaSectors } from "@/lib/area-sectors";
import { fetchCompanyProfile, type CompanyProfile } from "@/lib/company-profile-data";
import { dialable } from "@/lib/phone-format";
import { ImageViewer, type ViewerImage } from "@/components/image-viewer";
import { distributionKindLabel, fetchPropertyDistributionMedia, type DistributionMedia } from "@/lib/distribution-media";
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

export function PropertyDetails({ property, favorite, remote, navigationIds = [property.id], backLabel, reversed = false, onClose, onNavigate, onReverse, onFavorite, onSave }: { property: Property; favorite: boolean; remote: boolean; navigationIds?: string[]; backLabel?: string; reversed?: boolean; onClose: () => void; onNavigate?: (id: string) => void; onReverse?: () => void; onFavorite: () => void; onSave: (patch: PropertyFilePatch) => Promise<void> }) {
  const [phones, setPhones] = useState<string[]>(property.phones);
  const [phonesVisible, setPhonesVisible] = useState(!remote);
  const [annexes, setAnnexes] = useState(property.annexes ?? "");
  const [fileSource, setFileSource] = useState<{ id: string; enteredBy: string } | null>(null);
  const [scopes, setScopes] = useState<string[]>(remote ? [] : [...PROPERTY_EDIT_SCOPES]);
  const may = (scope: PropertyEditScope) => scopes.includes(scope);
  const canEdit = scopes.length > 0;
  // Status and site type save on their own; the rest needs the edit mode.
  const usesEditMode = may("info") || may("price") || may("phones");
  const [fileLoading, setFileLoading] = useState(remote);
  const codes = useCodeLists();
  const areaSectors = useAreaSectors();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Form>(() => formFrom(property, property.phones, property.annexes ?? ""));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [comments, setComments] = useState<PropertyComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(remote);
  const [newComment, setNewComment] = useState("");
  const [commentError, setCommentError] = useState("");
  const [postingComment, setPostingComment] = useState(false);
  const [allComments, setAllComments] = useState(false);
  const [viewer, setViewer] = useState<number | null>(null);
  const [distributionMedia, setDistributionMedia] = useState<DistributionMedia[]>([]);
  const [company, setCompany] = useState<CompanyProfile | null>(null);

  const loadFile = useCallback(async () => {
    if (!remote) return;
    setFileLoading(true);
    try {
      const file = await fetchPropertyFile(property.id);
      setPhones(file.phones); setPhonesVisible(file.phonesVisible); setAnnexes(file.annexes); setScopes(file.editScopes); setFileSource({ id: property.id, enteredBy: file.enteredByName });
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
    if (!editing) return;
    const list = sectorsOf(areaSectors, form.area);
    if (list.length && form.sector && !list.includes(form.sector)) setForm(old => ({ ...old, sector: "" }));
  }, [editing, form.area, form.sector, areaSectors]);
  useEffect(() => {
    if (!remote) return;
    let active = true;
    void Promise.allSettled([fetchCompanyProfile(), fetchPropertyDistributionMedia(property.id)]).then(([profile, shared]) => {
      if (!active) return;
      if (profile.status === "fulfilled") setCompany(profile.value);
      setDistributionMedia(shared.status === "fulfilled" ? shared.value : []);
    });
    return () => { active = false; };
  }, [remote, property.id]);

  // Esc closes the file, like the back button.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // While a photo is enlarged, Esc and the arrows belong to the photo viewer.
      if (viewer !== null) return;
      if (event.key === "Escape" && !editing) onClose();
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [onClose, editing, viewer]);
  useEffect(() => { setViewer(null); }, [property.id]);

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
    const patch: PropertyFilePatch = may("info") ? { client: form.client.trim(), type: form.type, offer: form.offer, area: form.area, sector: form.sector, block: form.block, plot: form.plot, street: form.street, annexes: form.annexes, size, details: form.details } : {};
    if (may("location_type")) patch.locationType = form.locationType;
    if (may("status")) patch.status = form.status;
    if (may("price") && (property.price !== null || price)) patch.price = price;
    if (may("phones") && phonesVisible) patch.phones = [form.phone1, form.phone2, ...phones.slice(2)].map(value => digits(value).trim()).filter(Boolean);
    if (!Object.keys(patch).length) { setEditing(false); return; }
    if (await save(patch)) setEditing(false);
  };

  const quickSave = (patch: PropertyFilePatch) => { void save(patch); };

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

  const gallery: ViewerImage[] = distributionMedia.map(item => ({ src: item.image_data, label: `${distributionKindLabel[item.kind]} التوزيعة ${item.street}${item.sector ? ` · ${item.sector}` : ""}` }));

  const navigationIndex = Math.max(0, navigationIds.indexOf(property.id));
  const enteredBy = fileSource?.id === property.id ? fileSource.enteredBy : "";
  const options = (list: string[], current: string) => current && !list.includes(current) ? [current, ...list] : list;
  const set = (key: keyof Form) => (value: string) => setForm(old => ({ ...old, [key]: value }));

  // Only the chosen area's sectors (جنوب المطلاع → N1…N12); a sector from another area is cleared when the area changes.
  const areaSectorList = sectorsOf(areaSectors, editing ? form.area : property.area);
  const text = (key: keyof Form, label: string, value: string, extra?: { dir?: "ltr"; inputMode?: "numeric" | "decimal" | "tel"; field?: string; only?: string[]; scope?: PropertyEditScope }) =>
    <Field label={label}>{editing && may(extra?.scope ?? "info") ? (extra?.field
      ? <CodedInput field={extra.field} lists={codes} only={extra.only} value={form[key]} onChange={set(key)} className={inputClass} inputProps={{ dir: extra.dir, inputMode: extra.inputMode }}/>
      : <input value={form[key]} onChange={e => set(key)(e.target.value)} dir={extra?.dir} inputMode={extra?.inputMode} className={inputClass}/>) : <Value>{value || "—"}</Value>}</Field>;
  const select = (key: keyof Form, label: string, list: string[], value: string) =>
    <Field label={label}>{editing && may("info") ? <select value={form[key]} onChange={e => set(key)(e.target.value)} className={inputClass}><option value="">—</option>{options(list, form[key]).map(x => <option key={x}>{x}</option>)}</select> : <Value>{value || "—"}</Value>}</Field>;

  return <motion.div className="fixed inset-0 z-[62] grid place-items-center bg-slate-950/45 p-1 backdrop-blur-[2px] sm:p-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={e => e.target === e.currentTarget && !editing && onClose()}>
    <motion.section dir="rtl" initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 10, opacity: 0 }} transition={{ duration: .2 }} className="flex max-h-[98vh] w-full max-w-[1400px] flex-col overflow-hidden rounded-[20px] border border-slate-200 bg-white text-slate-900 shadow-2xl dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
      <header className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-700 sm:px-5">
        <button onClick={onClose} disabled={editing} className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-[13px] font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900"><ArrowRight size={15}/>{backLabel ?? "رجوع"}</button>
        <div className="min-w-0 flex-1 px-2"><div className="text-xs font-bold text-slate-500">ملف العقار</div><div className="truncate text-sm font-black">{property.code} · {property.type} {property.offer !== "—" ? `· ${property.offer}` : ""}</div></div>
        {fileLoading && <LoaderCircle size={16} className="animate-spin text-teal-500"/>}
        {usesEditMode && !editing && <button onClick={() => { setError(""); setEditing(true); }} className="flex items-center gap-1.5 rounded-xl bg-teal-600 px-3 py-2 text-[13px] font-bold text-white"><Pencil size={14}/>تعديل البيانات</button>}
        {editing && <><button onClick={() => { setEditing(false); setError(""); }} className="rounded-xl px-3 py-2 text-[13px] font-bold text-slate-500">إلغاء</button><button disabled={saving} onClick={() => void saveForm()} className="flex items-center gap-1.5 rounded-xl bg-teal-600 px-4 py-2 text-[13px] font-bold text-white disabled:opacity-50">{saving ? <LoaderCircle size={14} className="animate-spin"/> : <Save size={14}/>}حفظ التعديلات</button></>}
        <button onClick={() => window.print()} className="rounded-lg border border-slate-300 p-2 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800" aria-label="طباعة ملف العقار"><Printer size={17}/></button>
        <button onClick={onFavorite} title={favorite ? "شيله من المفضلة" : "ضيفه للمفضلة"} className={`rounded-lg border p-2 ${favorite ? "border-rose-300 bg-rose-50 text-rose-600 dark:border-rose-900 dark:bg-rose-950/40" : "border-slate-300 text-slate-700 dark:border-slate-700 dark:text-slate-300"}`} aria-label="إضافة للمفضلة"><Heart size={18} fill={favorite ? "currentColor" : "none"}/></button>
        <button onClick={onClose} disabled={editing} className="rounded-lg border border-slate-300 p-2 text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800" aria-label="إغلاق"><X size={18}/></button>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 sm:p-4">
        {error && <p role="alert" className="rounded-xl bg-rose-50 p-2.5 text-[13px] text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{error}</p>}

        {/* Client, phones and site type in one row */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="اسم العميل">{editing && may("info") ? <input value={form.client} onChange={e => set("client")(e.target.value)} className={inputClass}/> : <Value>{property.client}</Value>}</Field>
          <Field label="رقم التليفون"><PhoneRow value={editing && may("phones") ? form.phone1 : phones[0]} editing={editing && may("phones") && phonesVisible} onChange={set("phone1")} hidden={!phonesVisible} loading={fileLoading}/></Field>
          <Field label="رقم ٢"><PhoneRow value={editing && may("phones") ? form.phone2 : phones[1]} editing={editing && may("phones") && phonesVisible} onChange={set("phone2")} hidden={!phonesVisible} loading={fileLoading}/>{phones.length > 2 && !editing && <div className="mt-1 text-xs text-slate-500">أرقام إضافية: <span dir="ltr">{phones.slice(2).join(" · ")}</span></div>}</Field>
          <Field label="نوع الموقع">
            <select value={editing ? form.locationType : property.locationType} disabled={!may("location_type") || saving} onChange={e => editing ? set("locationType")(e.target.value) : quickSave({ locationType: e.target.value })} className={inputClass}>
              <option value="">اختر نوع الموقع</option>{options(codeValues(codes, "location_type", fallbackLookups.location_type), editing ? form.locationType : property.locationType).map(x => <option key={x}>{x}</option>)}
            </select>
          </Field>
        </div>

        {/* Property data */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {select("offer", "نوع العرض", codeValues(codes, "offer_type", fallbackLookups.offer_type), property.offer === "—" ? "" : property.offer)}
          {select("area", "المنطقة", codeValues(codes, "area", fallbackLookups.area), property.area === "غير محدد" ? "" : property.area)}
          {text("sector", "القطاع", property.sector ?? "", { field: "sector", only: areaSectorList })}
          {text("block", "القطعة", property.block, { field: "block" })}
          {text("street", "التوزيعة", property.street, { field: "street" })}
          {text("plot", "القسيمة", property.plot, { field: "plot" })}
          {select("type", "نوع العقار", codeValues(codes, "property_type", fallbackLookups.property_type), property.type === "غير محدد" ? "" : property.type)}
          {text("size", "المساحة م²", property.size ? property.size.toLocaleString("en-US") : "", { inputMode: "decimal" })}
          {text("price", "السعر د.ك", property.price === null ? "مخفي" : property.price.toLocaleString("en-US"), { inputMode: "decimal", scope: "price" })}
          <Field label="الحالة"><select value={editing ? form.status : property.status} disabled={!may("status") || saving} onChange={e => editing ? set("status")(e.target.value) : quickSave({ status: e.target.value as Property["status"] })} className={inputClass}><option value="available">متاح</option><option value="sold">مباع</option><option value="lost">مفقود</option></select></Field>
        </div>
        {!canEdit && remote && !fileLoading && <p className="text-xs text-slate-400">التعديل في ملف العقار مش مفعّل لحسابك.</p>}

        <div className="flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-slate-500"><div>الموظف المسؤول: <b className="text-slate-700 dark:text-slate-200">{property.employee}</b></div>{enteredBy && <div>أضاف العرض: <b className="text-teal-700 dark:text-teal-300">{enteredBy}</b></div>}<div>تاريخ الإضافة: <b className="tabular-nums text-slate-700 dark:text-slate-200">{dateFormat.format(new Date(property.date))}</b></div><div>{[property.distribution && `التوزيع ${property.distribution}`, property.avenue && `الجادة ${property.avenue}`].filter(Boolean).join(" · ")}</div></div>

        <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_16rem]">
        {/* Comments with date and marketer name */}
        <section className="flex min-w-0 flex-col rounded-xl border border-slate-300 dark:border-slate-700">
          <div className="flex items-center justify-between border-b border-slate-300 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/60"><div className="flex items-center gap-2 text-sm font-black"><MessageCircle size={16} className="text-teal-600"/>التعليقات</div><span className="text-xs text-slate-400">{comments.length.toLocaleString("ar-KW")} تعليق</span></div>
          {/* The two newest comments stay visible; the rest open from the arrow under them. */}
          <div className={allComments ? "max-h-96 overflow-y-auto" : ""}>
            <table className="w-full text-right text-[13px]">
              <thead className="sticky top-0 bg-slate-50 text-xs text-slate-500 dark:bg-slate-900"><tr><th className="w-36 px-4 py-2.5 font-bold">اسم المسوق</th><th className="w-32 px-4 py-2.5 font-bold">التاريخ</th><th className="px-4 py-2.5 font-bold">التعليق</th></tr></thead>
              <tbody>
                {(allComments ? comments : comments.slice(0, VISIBLE_COMMENTS)).map(comment => <tr key={comment.id} className="border-t border-slate-100 align-top dark:border-slate-800"><td className="px-4 py-2.5 font-bold">{comment.authorName}</td><td className="px-4 py-2.5 tabular-nums text-slate-500"><div>{dateFormat.format(new Date(comment.createdAt))}</div><div className="text-xs text-slate-400">{timeFormat.format(new Date(comment.createdAt))}</div></td><td className="whitespace-pre-wrap px-4 py-2.5 leading-6">{comment.body}</td></tr>)}
                {!comments.length && <tr><td colSpan={3} className="px-4 py-8 text-center text-slate-400">{commentsLoading ? "جارٍ تحميل التعليقات…" : "لا توجد تعليقات على هذا العقار بعد."}</td></tr>}
              </tbody>
            </table>
          </div>
          {comments.length > VISIBLE_COMMENTS && <button type="button" onClick={() => setAllComments(value => !value)} aria-expanded={allComments} className="flex w-full items-center justify-center gap-1.5 border-t border-slate-200 bg-slate-50/70 px-4 py-2.5 text-[13px] font-bold text-teal-700 hover:bg-teal-50 dark:border-slate-700 dark:bg-slate-900/50 dark:text-teal-300 dark:hover:bg-slate-900">
            {allComments ? "إخفاء التعليقات الأقدم" : `عرض كل التعليقات (${comments.length.toLocaleString("ar-KW")})`}
            <ChevronDown size={15} className={`transition-transform ${allComments ? "rotate-180" : ""}`}/>
          </button>}
          <div className="flex gap-2 border-t border-slate-200 p-3 dark:border-slate-700"><textarea value={newComment} onChange={e => setNewComment(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void postComment(); }} rows={2} maxLength={2000} placeholder="اكتب تعليقًا… سيُحفظ باسمك وتاريخ اليوم" className={`${inputClass} mt-0 h-auto flex-1 py-2`}/><button disabled={postingComment || newComment.trim().length < 2} onClick={() => void postComment()} className="flex items-center gap-1.5 self-end rounded-xl bg-teal-600 px-4 py-2.5 text-[13px] font-bold text-white disabled:opacity-40">{postingComment ? <LoaderCircle size={14} className="animate-spin"/> : <Send size={14}/>}إضافة</button></div>
          {commentError && <p role="alert" className="px-4 pb-3 text-[13px] text-rose-600">{commentError}</p>}
        </section>

        {/* The distribution's photos and maps (added in Settings), beside the comments; a click enlarges one */}
        <section className="flex min-w-0 flex-col self-start rounded-xl border border-slate-300 dark:border-slate-700">
          <div className="flex items-center justify-between gap-2 border-b border-slate-300 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/60"><div className="flex min-w-0 items-center gap-2 text-sm font-black"><ImageIcon size={16} className="shrink-0 text-teal-600"/><span className="truncate">صور وخرائط التوزيعة {property.street}</span></div><span className="shrink-0 text-xs text-slate-400">{distributionMedia.length.toLocaleString("ar-KW")}</span></div>
          <div className="p-2.5">
            {distributionMedia.length ? <div className="grid grid-cols-2 gap-2">{distributionMedia.map((item, index) => <button key={item.id} type="button" onClick={() => setViewer(index)} aria-label={`تكبير ${distributionKindLabel[item.kind]} التوزيعة`} className="group relative aspect-square overflow-hidden rounded-lg border border-slate-300 bg-slate-100 dark:border-slate-700 dark:bg-slate-900"><img src={item.image_data} alt={`${distributionKindLabel[item.kind]} التوزيعة ${item.street}`} className="h-full w-full object-cover transition group-hover:scale-105"/><span className={`absolute right-1.5 top-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-bold text-white shadow ${item.kind === "map" ? "bg-indigo-600" : "bg-teal-600"}`}>{distributionKindLabel[item.kind]}</span></button>)}</div>
              : <div className="grid aspect-[2/1] place-items-center rounded-lg border border-dashed border-slate-300 px-3 text-center text-[13px] text-slate-400 dark:border-slate-700">مفيش صور للتوزيعة دي لسه.<br/>بتتضاف من الإعدادات ← صور وخرائط التوزيعات.</div>}
          </div>
        </section>
        </div>
      </div>

      {navigationIds.length > 1 && <footer className="flex items-center justify-between gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-700"><div className="flex items-center gap-2"><button type="button" onClick={() => onNavigate?.(navigationIds[navigationIndex <= 0 ? navigationIds.length - 1 : navigationIndex - 1])} disabled={editing} aria-label="العقار السابق" title={navigationIndex <= 0 ? "روح لآخر عقار في النتائج" : "العقار السابق"} className="grid h-10 w-10 place-items-center rounded-xl border border-slate-300 text-slate-800 hover:bg-slate-100 disabled:opacity-30 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"><ChevronRight size={19}/></button>{onReverse && <button type="button" onClick={onReverse} disabled={editing} title="اعكس الترتيب وابدأ من الطرف التاني" className="flex h-10 items-center gap-1.5 rounded-xl border border-teal-300 bg-teal-50 px-3 text-[13px] font-bold text-teal-700 disabled:opacity-30 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-300"><ArrowDownUp size={15}/>{reversed ? "من الآخر للأول" : "من الأول للآخر"}</button>}</div><span className="text-[13px] text-slate-500">العقار {(navigationIndex + 1).toLocaleString("ar-KW")} من {navigationIds.length.toLocaleString("ar-KW")} في النتائج</span><button type="button" onClick={() => onNavigate?.(navigationIds[navigationIndex >= navigationIds.length - 1 ? 0 : navigationIndex + 1])} disabled={editing} aria-label="العقار التالي" title={navigationIndex >= navigationIds.length - 1 ? "ارجع لأول عقار في النتائج" : "العقار التالي"} className="grid h-10 w-10 place-items-center rounded-xl border border-slate-300 text-slate-800 hover:bg-slate-100 disabled:opacity-30 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"><ChevronLeft size={19}/></button></footer>}

      {viewer !== null && gallery[viewer] && <ImageViewer images={gallery} index={viewer} onIndex={setViewer} onClose={() => setViewer(null)}/>}

      <div className="print-sheet hidden" dir="rtl"><header className="mb-8 flex items-center justify-between border-b-2 border-slate-800 pb-5"><img src={company?.logo_url || "/brand/albatoul-logo.png"} alt="شعار الشركة" className="h-20 max-w-40 object-contain"/><div><h1 className="text-2xl font-black">{company?.name_ar || "ملف العقار"}</h1>{company?.name_en && <div className="mt-1 text-sm" dir="ltr">{company.name_en}</div>}<p className="mt-2 text-[13px]">{[company?.phone && `هاتف: ${company.phone}`, company?.fax && `فاكس: ${company.fax}`, company?.address].filter(Boolean).join(" · ")}</p></div><div className="text-left text-sm"><b>{property.code}</b><div className="mt-1">{dateFormat.format(new Date(property.date))}</div></div></header><h2 className="mb-4 text-xl font-bold">{property.type} · {property.offer}</h2><div className="grid grid-cols-3 gap-4 text-sm"><PrintField label="اسم العميل" value={property.client}/><PrintField label="رقم التليفون" value={phones[0] ?? "—"}/><PrintField label="رقم ٢" value={phones[1] ?? "—"}/><PrintField label="نوع الموقع" value={property.locationType || "—"}/><PrintField label="نوع العرض" value={property.offer}/><PrintField label="المنطقة" value={property.area}/><PrintField label="القطاع" value={property.sector || "—"}/><PrintField label="القطعة" value={property.block || "—"}/><PrintField label="التوزيعة" value={property.street || "—"}/><PrintField label="القسيمة" value={property.plot || "—"}/><PrintField label="المساحة" value={`${property.size} م²`}/><PrintField label="السعر" value={property.price === null ? "مخفي" : `${property.price.toLocaleString("en-KW")} د.ك`}/><PrintField label="الحالة" value={statusLabel(property.status)}/></div>{comments.length > 0 && <table className="mt-6 w-full border text-right text-[13px]"><thead><tr><th className="border p-2">اسم المسوق</th><th className="border p-2">التاريخ</th><th className="border p-2">التعليق</th></tr></thead><tbody>{comments.slice(0, 20).map(comment => <tr key={comment.id}><td className="border p-2">{comment.authorName}</td><td className="border p-2">{dateFormat.format(new Date(comment.createdAt))}</td><td className="border p-2">{comment.body}</td></tr>)}</tbody></table>}<footer className="mt-12 border-t pt-3 text-center text-xs text-slate-500">نسخة مطبوعة من نظام إدارة العقارات</footer></div>
    </motion.section>
  </motion.div>;
}

/** Comments shown before the "show all" arrow. */
const VISIBLE_COMMENTS = 2;
const inputClass = "focus-ring mt-0.5 h-8 w-full rounded-lg border border-slate-300 bg-white px-2 text-[13px] font-bold text-slate-900 outline-none disabled:cursor-not-allowed disabled:opacity-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0 rounded-xl border border-slate-300 bg-slate-50/80 px-2.5 py-1.5 dark:border-slate-700 dark:bg-transparent"><div className="text-xs font-black text-slate-600 dark:text-slate-400">{label}</div>{children}</div>;
}
function Value({ children }: { children: ReactNode }) { return <div className="mt-0.5 min-h-5 break-words text-sm font-bold">{children}</div>; }
function PhoneRow({ value, editing, hidden, loading, onChange }: { value?: string; editing: boolean; hidden: boolean; loading: boolean; onChange: (value: string) => void }) {
  if (editing) return <input value={value ?? ""} onChange={e => onChange(e.target.value)} dir="ltr" inputMode="tel" placeholder="مثال: 99999999" className={inputClass}/>;
  if (hidden) return <div className="text-[13px] text-slate-400">{loading ? "جارٍ التحميل…" : "عرض الأرقام غير مفعّل لحسابك"}</div>;
  if (!value) return <div className="text-sm font-bold text-slate-300">—</div>;
  const number = dialable(value);
  return <div className="mt-0.5 flex items-center gap-1.5"><Phone size={14} className="shrink-0 text-teal-600"/><a href={`tel:+${number}`} dir="ltr" className="min-w-0 flex-1 truncate text-left text-sm font-black tabular-nums">{value}</a><a href={`https://wa.me/${number}`} target="_blank" rel="noreferrer" className="rounded-md bg-emerald-500/10 px-2 py-1 text-xs font-bold text-emerald-700">واتساب</a><a href={`tel:+${number}`} className="rounded-md bg-teal-500/10 px-2 py-1 text-xs font-bold text-teal-700">اتصال</a></div>;
}
function PrintField({ label, value }: { label: string; value: string }) { return <div className="border-b border-slate-200 pb-2"><div className="text-xs text-slate-500">{label}</div><div className="mt-1 font-bold">{value}</div></div>; }
