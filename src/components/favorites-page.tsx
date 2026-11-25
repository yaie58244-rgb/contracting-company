"use client";
import { useEffect, useMemo, useState } from "react";
import { Heart, LoaderCircle, MapPin, Search, X } from "lucide-react";
import type { Property } from "@/lib/types";
import { searchPropertiesPage } from "@/lib/property-data";

const statusText = { available: "متاح", sold: "مباع", lost: "مفقود" } as const;
type Filters = { text: string; area: string; sector: string; block: string; plot: string; street: string };
const noFilters: Filters = { text: "", area: "", sector: "", block: "", plot: "", street: "" };
/** Same spelling rules as the main search: hamza, ya, ta marbuta, Arabic digits and spaces don't matter. */
const norm = (value: string | null | undefined) => (value ?? "").replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/\s+/g, "").toLowerCase();
/** "003" and "3" are the same number. */
const numberKey = (value: string | null | undefined) => { const text = norm(value); return /^\d+$/.test(text) ? String(Number(text)) : text; };
const filterField = "focus-ring mt-1 h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-[13px] font-bold outline-none dark:border-slate-700 dark:bg-slate-900";

const statusTone = { available: "bg-emerald-50 text-emerald-700", sold: "bg-slate-100 text-slate-600", lost: "bg-rose-50 text-rose-700" } as const;

/** Each person's own favourites (the heart in the property file), newest first. */
export function FavoritesPage({ favoriteIds, remote, localProperties, onOpen, onRemove }: { favoriteIds: string[]; remote: boolean; localProperties: Property[]; onOpen: (property: Property, rows: Property[]) => void; onRemove: (id: string) => void }) {
  const [remoteRows, setRemoteRows] = useState<Property[]>([]);
  const [loading, setLoading] = useState(remote);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState<Filters>(noFilters);
  const idsKey = favoriteIds.join(",");

  useEffect(() => {
    if (!remote) return;
    if (!favoriteIds.length) { setRemoteRows([]); setLoading(false); return; }
    let active = true;
    setLoading(true); setError("");
    searchPropertiesPage({ matchingPropertyIds: favoriteIds }, 0, 5000)
      .then(result => { if (active) setRemoteRows(result.rows); })
      .catch(cause => { if (active) setError(cause && typeof cause === "object" && "message" in cause ? `تعذر تحميل المفضلة: ${String(cause.message)}` : "تعذر تحميل المفضلة."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [remote, idsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the order the hearts were pressed (newest first); a removed heart drops out at once.
  const rows = useMemo(() => {
    const source = remote ? remoteRows : localProperties;
    const byId = new Map(source.map(row => [row.id, row]));
    return favoriteIds.flatMap(id => byId.get(id) ?? []);
  }, [remote, remoteRows, localProperties, favoriteIds]);

  // Search inside the favourites: area/sector are picked from what is there, numbers match exactly.
  const areas = useMemo(() => [...new Set(rows.map(p => p.area).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ar")), [rows]);
  const sectors = useMemo(() => [...new Set(rows.filter(p => !filters.area || p.area === filters.area).map(p => p.sector ?? "").filter(Boolean))].sort((a, b) => a.localeCompare(b, "en", { numeric: true })), [rows, filters.area]);
  const shown = useMemo(() => rows.filter(p =>
    (!filters.area || p.area === filters.area)
    && (!filters.sector || p.sector === filters.sector)
    && (!filters.block.trim() || numberKey(p.block) === numberKey(filters.block))
    && (!filters.plot.trim() || numberKey(p.plot) === numberKey(filters.plot))
    && (!filters.street.trim() || numberKey(p.street) === numberKey(filters.street))
    && (!filters.text.trim() || [p.code, p.client, p.type, p.offer, p.area, p.sector, p.block, p.plot, p.street, ...p.phones].some(value => norm(value).includes(norm(filters.text))))
  ), [rows, filters]);
  const filtering = Object.values(filters).some(value => value.trim());
  const put = (key: keyof Filters, value: string) => setFilters(old => ({ ...old, [key]: value, ...(key === "area" ? { sector: "" } : {}) }));

  return <section className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><p className="text-xs font-bold text-teal-700">قائمتك الخاصة</p><h1 className="mt-1 flex items-center gap-2 text-2xl font-black"><Heart className="text-rose-500" fill="currentColor" size={22}/>المفضلة</h1><p className="mt-1 text-[13px] text-slate-500">العقارات اللي دوست على القلب جوه ملفها. كل موظف بيشوف المفضلة بتاعته بس.</p></div>
      <span className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-[13px] font-bold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">{filtering ? `${shown.length.toLocaleString("ar-KW")} من ` : ""}{rows.length.toLocaleString("ar-KW")} عقار</span>
    </div>
    {rows.length > 0 && <div className="glass panel grid gap-3 p-4 sm:grid-cols-3 lg:grid-cols-6">
      <label className="text-xs font-bold text-slate-600 sm:col-span-3 lg:col-span-2">بحث في المفضلة<span className="relative block"><Search size={15} className="absolute right-3 top-1/2 mt-0.5 -translate-y-1/2 text-slate-400"/><input value={filters.text} onChange={e => put("text", e.target.value)} placeholder="اسم العميل، الرقم، الكود…" className={`${filterField} pr-9`}/></span></label>
      <label className="text-xs font-bold text-slate-600">المنطقة<select value={filters.area} onChange={e => put("area", e.target.value)} className={filterField}><option value="">الكل</option>{areas.map(a => <option key={a}>{a}</option>)}</select></label>
      <label className="text-xs font-bold text-slate-600">القطاع<select value={filters.sector} onChange={e => put("sector", e.target.value)} className={filterField}><option value="">الكل</option>{sectors.map(a => <option key={a}>{a}</option>)}</select></label>
      <label className="text-xs font-bold text-slate-600">القطعة<input value={filters.block} onChange={e => put("block", e.target.value)} inputMode="numeric" placeholder="مثال: 1" className={filterField}/></label>
      <label className="text-xs font-bold text-slate-600">القسيمة<input value={filters.plot} onChange={e => put("plot", e.target.value)} inputMode="numeric" placeholder="مثال: 273" className={filterField}/></label>
      <label className="text-xs font-bold text-slate-600">التوزيعة<input value={filters.street} onChange={e => put("street", e.target.value)} inputMode="numeric" placeholder="مثال: 003" className={filterField}/></label>
      {filtering && <button type="button" onClick={() => setFilters(noFilters)} className="flex items-center justify-center gap-1.5 self-end rounded-xl border border-slate-300 px-3 py-2.5 text-[13px] font-bold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"><X size={14}/>مسح البحث</button>}
    </div>}
    {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-[13px] text-rose-700">{error}</p>}
    <div className="glass panel overflow-hidden">
      {loading ? <div className="flex items-center justify-center gap-2 p-10 text-[13px] text-slate-500"><LoaderCircle size={16} className="animate-spin"/>جارٍ تحميل المفضلة…</div>
        : filtering && !shown.length ? <div className="p-10 text-center text-[13px] text-slate-500">مفيش عقار في المفضلة بالبيانات دي.</div>
        : !rows.length ? <div className="p-10 text-center"><Heart size={30} className="mx-auto text-slate-300"/><p className="mt-3 text-sm font-bold">مفيش عقارات في المفضلة لسه</p><p className="mt-1 text-[13px] text-slate-500">افتح أي ملف عقار ودوس على القلب اللي فوق عشان يظهر هنا.</p></div>
        : <div className="overflow-x-auto"><table className="w-full min-w-[860px] text-right text-[13px]">
          <thead className="border-b border-slate-300 bg-slate-50 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900"><tr>{["العقار", "المنطقة", "القطاع", "القطعة", "القسيمة", "التوزيعة", "العميل", "السعر", "الحالة", ""].map(h => <th key={h} className="px-4 py-3 font-black">{h}</th>)}</tr></thead>
          <tbody>{shown.map(p => <tr key={p.id} onClick={() => onOpen(p, shown)} className="cursor-pointer border-b border-slate-200 hover:bg-teal-50/60 dark:border-slate-800 dark:hover:bg-slate-900">
            <td className="px-4 py-3"><b className="block">{p.code}</b><span className="text-xs text-slate-500">{p.type} · {p.offer}</span></td>
            <td className="px-4 py-3"><span className="flex items-center gap-1"><MapPin size={13} className="text-teal-600"/>{p.area}</span></td>
            <td className="px-4 py-3">{p.sector || "—"}</td>
            <td className="px-4 py-3">{p.block || "—"}</td>
            <td className="px-4 py-3">{p.plot || "—"}</td>
            <td className="px-4 py-3">{p.street || "—"}</td>
            <td className="px-4 py-3 font-bold">{p.client}</td>
            <td className="px-4 py-3 tabular-nums">{p.price === null ? "مخفي" : `${p.price.toLocaleString("en-US")} د.ك`}</td>
            <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusTone[p.status]}`}>{statusText[p.status]}</span></td>
            <td className="px-4 py-3"><button type="button" onClick={event => { event.stopPropagation(); onRemove(p.id); }} title="شيله من المفضلة" aria-label={`شيل ${p.code} من المفضلة`} className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-rose-600 hover:bg-rose-100"><Heart size={15} fill="currentColor"/></button></td>
          </tr>)}</tbody>
        </table></div>}
    </div>
  </section>;
}
