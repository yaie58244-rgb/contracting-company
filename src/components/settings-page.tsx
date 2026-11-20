"use client";
import { useEffect, useState, type FormEvent } from "react";
import { AlertCircle, Check, ListTree, LoaderCircle, Pencil, Plus, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { CompanyProfileEditor } from "@/components/company-profile-editor";
import { CODE_FIELDS, LOCAL_CODES_KEY, invalidateCodeLists, readLocalCodes, type CodeRow } from "@/lib/code-lists";

const seed: CodeRow[] = [
  ...["الأندلس", "الروضة", "صباح الأحمد", "السليبخات", "العارضية"].map((name, i) => ({ id: `area-${i}`, type: "area", code: 101 + i, short_code: null, name_ar: name, name_en: null, is_active: true })),
  ...["أرض", "بيت", "شقة"].map((name, i) => ({ id: `type-${i}`, type: "property_type", code: 201 + i, short_code: null, name_ar: name, name_en: null, is_active: true })),
  ...["للبيع", "للإيجار"].map((name, i) => ({ id: `offer-${i}`, type: "offer_type", code: 301 + i, short_code: null, name_ar: name, name_en: null, is_active: true })),
];

type Draft = { id: string | null; shortCode: string; nameAr: string; nameEn: string };
const emptyDraft: Draft = { id: null, shortCode: "", nameAr: "", nameEn: "" };

export function SettingsPage({ remote }: { remote: boolean }) {
  const [items, setItems] = useState<CodeRow[]>(seed);
  const [kind, setKind] = useState<string>("area");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(remote);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [hasShortCodes, setHasShortCodes] = useState(true);

  const refresh = async () => {
    if (!remote) return;
    setLoading(true);
    try {
      const db = createClient();
      let result = await db.from("lookups").select("id,type,code,short_code,name_ar,name_en,is_active").order("type").order("code");
      if (result.error && /short_code/.test(result.error.message)) {
        // Migration 033 not applied yet: lists still work, without text codes.
        setHasShortCodes(false);
        result = await db.from("lookups").select("id,type,code,name_ar,name_en,is_active").order("type").order("code") as typeof result;
      }
      if (result.error) throw result.error;
      setItems(((result.data ?? []) as CodeRow[]).map(row => ({ ...row, short_code: row.short_code ?? null })));
    } catch { setError("تعذر تحميل القوائم. تحقق من اتصال Supabase وصلاحيات الإدارة."); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (remote) void refresh();
    else { const saved = readLocalCodes(); if (saved.length) setItems(saved); }
  }, [remote]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveLocal = (next: CodeRow[]) => {
    setItems(next);
    try { localStorage.setItem(LOCAL_CODES_KEY, JSON.stringify(next)); } catch { /* preview only */ }
    invalidateCodeLists();
  };

  const field = CODE_FIELDS.find(x => x.id === kind);
  const visible = items.filter(x => x.type === kind);
  const nextCode = Math.max(0, ...items.filter(x => x.type === kind).map(x => x.code)) + 1;

  const save = async (event: FormEvent) => {
    event.preventDefault(); if (!draft) return;
    // A code alone (e.g. "N1") is also a valid value.
    const nameAr = draft.nameAr.trim() || draft.shortCode.trim(), shortCode = draft.shortCode.trim() || null, nameEn = draft.nameEn.trim() || null;
    if (!nameAr) return;
    const clash = visible.find(x => x.id !== draft.id && (x.name_ar === nameAr || (shortCode && x.short_code?.toLowerCase() === shortCode.toLowerCase())));
    if (clash) { setError(`«${clash.short_code && shortCode && clash.short_code.toLowerCase() === shortCode.toLowerCase() ? shortCode : nameAr}» موجود في هذه القائمة من قبل.`); return; }
    setSaving(true); setError("");
    try {
      if (remote) {
        const db = createClient();
        const values = { name_ar: nameAr, name_en: nameEn, ...(hasShortCodes ? { short_code: shortCode } : {}) };
        const { error: dbError } = draft.id
          ? await db.from("lookups").update(values).eq("id", draft.id)
          : await db.from("lookups").insert({ type: kind, code: nextCode, ...values });
        if (dbError) throw dbError;
        invalidateCodeLists();
        await refresh();
      } else if (draft.id) {
        saveLocal(items.map(x => x.id === draft.id ? { ...x, name_ar: nameAr, name_en: nameEn, short_code: shortCode } : x));
      } else {
        saveLocal([...items, { id: crypto.randomUUID(), type: kind, code: nextCode, short_code: shortCode, name_ar: nameAr, name_en: nameEn, is_active: true }]);
      }
      setDraft(null);
    } catch { setError("تعذر حفظ الكود. قد يكون الكود أو القيمة مستخدمة، أو لا تملك صلاحية التعديل."); }
    finally { setSaving(false); }
  };

  const toggle = async (item: CodeRow) => {
    if (!remote) { saveLocal(items.map(x => x.id === item.id ? { ...x, is_active: !x.is_active } : x)); return; }
    try {
      const { error: dbError } = await createClient().from("lookups").update({ is_active: !item.is_active }).eq("id", item.id);
      if (dbError) throw dbError;
      invalidateCodeLists();
      await refresh();
    } catch { setError("تعذر تغيير حالة الكود. تحقق من صلاحيات الإدارة."); }
  };

  const input = "focus-ring mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white/60 px-3 outline-none dark:border-slate-700 dark:bg-slate-900";

  return <div className="animate-in space-y-5">
    <div><div className="mb-1 text-xs font-bold text-teal-600">تهيئة مساحة العمل</div><h1 className="text-[26px] font-black tracking-tight">الإعدادات والأكواد</h1><p className="mt-1 text-xs text-slate-400">بيانات الشركة، وأكواد أي خانة لتظهر كقائمة منسدلة في النماذج</p></div>
    <CompanyProfileEditor remote={remote}/>
    <div className="grid gap-4 lg:grid-cols-[235px_1fr]">
      <aside className="glass panel p-3">
        <div className="mb-2 flex items-center gap-2 px-3 py-2 text-xs font-extrabold"><ListTree size={15} className="text-teal-600"/> الخانات</div>
        <div className="grid grid-cols-2 gap-1 lg:grid-cols-1">
          {CODE_FIELDS.map(item => { const count = items.filter(x => x.type === item.id && x.is_active).length; return <button key={item.id} onClick={() => { setKind(item.id); setError(""); }} className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-xs ${kind === item.id ? "bg-teal-500/10 font-bold text-teal-700 dark:text-teal-300" : "text-slate-500 hover:bg-white/60 dark:hover:bg-slate-800/60"}`}><span>{item.label}</span><span className={`text-[10px] ${count ? "font-bold text-teal-600" : "text-slate-300"}`}>{count || "—"}</span></button>; })}
        </div>
      </aside>
      <section className="glass panel overflow-hidden">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/60 p-5 dark:border-slate-700">
          <div><h2 className="text-sm font-extrabold">أكواد «{field?.label}»</h2><p className="mt-1 text-[10px] text-slate-400">{visible.some(x => x.is_active) ? "تظهر هذه القيم كقائمة منسدلة في خانة " + field?.label : "لا توجد أكواد بعد، فالخانة تُكتب يدويًا. أضف أكوادًا لتصبح قائمة منسدلة."}</p></div>
          <button onClick={() => { setError(""); setDraft(emptyDraft); }} className="flex h-9 items-center gap-2 rounded-xl bg-teal-500 px-3 text-[11px] font-bold text-white"><Plus size={15}/> إضافة كود</button>
        </header>
        {error && <div role="alert" className="m-4 flex items-center gap-2 rounded-xl bg-rose-50 p-3 text-xs text-rose-700"><AlertCircle size={15}/>{error}<button onClick={() => setError("")} className="mr-auto"><X size={14}/></button></div>}
        {loading ? <div className="grid h-48 place-items-center"><LoaderCircle className="animate-spin text-teal-500"/></div> : <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-right text-xs">
            <thead className="bg-white/30 text-[10px] text-slate-400 dark:bg-slate-900/25"><tr><th className="px-5 py-3">الكود</th><th className="px-3 py-3">القيمة</th><th className="px-3 py-3">English</th><th className="px-3 py-3">الحالة</th><th className="px-5 py-3"></th></tr></thead>
            <tbody>{visible.map(item => <tr key={item.id} className={`border-t border-slate-100 dark:border-slate-800 ${item.is_active ? "" : "opacity-50"}`}>
              <td className="px-5 py-3">{item.short_code ? <span dir="ltr" className="rounded-md bg-teal-500/10 px-2 py-1 font-mono text-[11px] font-bold text-teal-700 dark:text-teal-300">{item.short_code}</span> : <span className="font-mono text-slate-300">{item.code}</span>}</td>
              <td className="px-3 py-3 font-bold">{item.name_ar}</td>
              <td className="px-3 py-3 text-slate-500" dir="ltr">{item.name_en || "—"}</td>
              <td className="px-3 py-3"><button onClick={() => void toggle(item)} className={`rounded-full px-2.5 py-1 text-[9px] font-bold ${item.is_active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{item.is_active ? "نشط · تعطيل" : "معطّل · تفعيل"}</button></td>
              <td className="px-5 py-3"><button aria-label={`تعديل ${item.name_ar}`} onClick={() => { setError(""); setDraft({ id: item.id, shortCode: item.short_code ?? "", nameAr: item.name_ar, nameEn: item.name_en ?? "" }); }} className="rounded-lg p-1.5 text-slate-400 hover:bg-white/70 hover:text-teal-700 dark:hover:bg-slate-800"><Pencil size={14}/></button></td>
            </tr>)}</tbody>
          </table>
          {!visible.length && <div className="p-12 text-center text-sm text-slate-400">لا توجد أكواد لهذه الخانة بعد.</div>}
        </div>}
      </section>
    </div>
    {!remote && <div className="rounded-xl bg-amber-50/80 p-3 text-[10px] text-amber-800">وضع المعاينة يحفظ الأكواد في هذا المتصفح فقط. لإدارة أكواد الشركة المشتركة، سجّل الدخول بحساب مدير.</div>}
    {draft && <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/40 p-4 backdrop-blur-sm" onMouseDown={e => e.target === e.currentTarget && setDraft(null)}>
      <form onSubmit={save} className="w-full max-w-md space-y-4 rounded-3xl border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
        <div className="flex items-center justify-between"><h2 className="text-base font-black">{draft.id ? "تعديل كود" : "إضافة كود"} · {field?.label}</h2><button type="button" onClick={() => setDraft(null)} className="rounded-lg p-2 text-slate-400"><X size={16}/></button></div>
        {hasShortCodes && <label className="block text-xs font-bold">الكود<input autoFocus value={draft.shortCode} maxLength={20} onChange={e => setDraft({ ...draft, shortCode: e.target.value })} dir="ltr" placeholder="مثال: N1" className={`${input} text-left font-mono`}/><span className="mt-1 block font-normal text-slate-400">اختياري. يظهر بجانب القيمة في القائمة المنسدلة.</span></label>}
        <label className="block text-xs font-bold">القيمة{hasShortCodes ? "" : " *"}<input required={!hasShortCodes || !draft.shortCode.trim()} autoFocus={!hasShortCodes} maxLength={120} value={draft.nameAr} onChange={e => setDraft({ ...draft, nameAr: e.target.value })} placeholder={kind === "area" ? "مثال: الأندلس" : "القيمة التي تُحفظ في الخانة"} className={input}/>{hasShortCodes && <span className="mt-1 block font-normal text-slate-400">إذا تُركت فارغة يُستخدم الكود نفسه كقيمة.</span>}</label>
        <label className="block text-xs font-bold">English<input value={draft.nameEn} maxLength={120} onChange={e => setDraft({ ...draft, nameEn: e.target.value })} dir="ltr" className={`${input} text-left`}/></label>
        <div className="flex justify-between"><button type="button" onClick={() => setDraft(null)} className="px-3 py-2 text-xs text-slate-500">إلغاء</button><button disabled={saving} className="flex items-center gap-2 rounded-xl bg-teal-500 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">{saving ? <LoaderCircle size={14} className="animate-spin"/> : <Check size={14}/>} حفظ</button></div>
      </form>
    </div>}
  </div>;
}
