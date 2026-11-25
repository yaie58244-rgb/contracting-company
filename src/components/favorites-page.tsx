"use client";
import { useEffect, useMemo, useState } from "react";
import { Heart, LoaderCircle, MapPin } from "lucide-react";
import type { Property } from "@/lib/types";
import { searchPropertiesPage } from "@/lib/property-data";

const statusText = { available: "متاح", sold: "مباع", lost: "مفقود" } as const;
const statusTone = { available: "bg-emerald-50 text-emerald-700", sold: "bg-slate-100 text-slate-600", lost: "bg-rose-50 text-rose-700" } as const;

/** Each person's own favourites (the heart in the property file), newest first. */
export function FavoritesPage({ favoriteIds, remote, localProperties, onOpen, onRemove }: { favoriteIds: string[]; remote: boolean; localProperties: Property[]; onOpen: (property: Property, rows: Property[]) => void; onRemove: (id: string) => void }) {
  const [remoteRows, setRemoteRows] = useState<Property[]>([]);
  const [loading, setLoading] = useState(remote);
  const [error, setError] = useState("");
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

  return <section className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><p className="text-xs font-bold text-teal-700">قائمتك الخاصة</p><h1 className="mt-1 flex items-center gap-2 text-2xl font-black"><Heart className="text-rose-500" fill="currentColor" size={22}/>المفضلة</h1><p className="mt-1 text-[13px] text-slate-500">العقارات اللي دوست على القلب جوه ملفها. كل موظف بيشوف المفضلة بتاعته بس.</p></div>
      <span className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-[13px] font-bold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">{rows.length.toLocaleString("ar-KW")} عقار</span>
    </div>
    {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-[13px] text-rose-700">{error}</p>}
    <div className="glass panel overflow-hidden">
      {loading ? <div className="flex items-center justify-center gap-2 p-10 text-[13px] text-slate-500"><LoaderCircle size={16} className="animate-spin"/>جارٍ تحميل المفضلة…</div>
        : !rows.length ? <div className="p-10 text-center"><Heart size={30} className="mx-auto text-slate-300"/><p className="mt-3 text-sm font-bold">مفيش عقارات في المفضلة لسه</p><p className="mt-1 text-[13px] text-slate-500">افتح أي ملف عقار ودوس على القلب اللي فوق عشان يظهر هنا.</p></div>
        : <div className="overflow-x-auto"><table className="w-full min-w-[860px] text-right text-[13px]">
          <thead className="border-b border-slate-300 bg-slate-50 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900"><tr>{["العقار", "المنطقة", "القطاع", "القطعة", "القسيمة", "التوزيعة", "العميل", "السعر", "الحالة", ""].map(h => <th key={h} className="px-4 py-3 font-black">{h}</th>)}</tr></thead>
          <tbody>{rows.map(p => <tr key={p.id} onClick={() => onOpen(p, rows)} className="cursor-pointer border-b border-slate-200 hover:bg-teal-50/60 dark:border-slate-800 dark:hover:bg-slate-900">
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
