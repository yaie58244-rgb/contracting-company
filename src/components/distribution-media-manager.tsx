"use client";
import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ImagePlus, LoaderCircle, Map as MapIcon, Trash2, X } from "lucide-react";
import { codeValues, useCodeLists } from "@/lib/code-lists";
import { sectorsOf, useAreaSectors } from "@/lib/area-sectors";
import { fetchMyAccess } from "@/lib/my-access";
import { compressImage } from "@/lib/property-data";
import { ImageViewer } from "@/components/image-viewer";
import { addDistributionMedia, deleteDistributionMedia, distributionKindLabel, errorText, fetchDistributionStreets, listDistributionMedia, type DistributionMedia } from "@/lib/distribution-media";

const field = "focus-ring mt-1.5 h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-[13px] font-bold outline-none dark:border-slate-700 dark:bg-slate-900";

/**
 * Settings → photos and maps for a whole distribution. Choose area, sector and
 * التوزيعة; whatever is added here shows in the file of every property there.
 */
export function DistributionMediaManager({ remote }: { remote: boolean }) {
  const codes = useCodeLists();
  const areaSectors = useAreaSectors();
  const [area, setArea] = useState("");
  const [sector, setSector] = useState("");
  const [street, setStreet] = useState("");
  const [streets, setStreets] = useState<{ street: string; properties: number }[]>([]);
  const [media, setMedia] = useState<DistributionMedia[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [canManage, setCanManage] = useState(false);
  const [viewer, setViewer] = useState<number | null>(null);

  const areas = useMemo(() => [...new Set([...codeValues(codes, "area"), ...areaSectors.keys()])].sort((a, b) => a.localeCompare(b, "ar")), [codes, areaSectors]);
  const sectors = area ? sectorsOf(areaSectors, area) : [];
  const chosen = streets.find(item => item.street === street);

  useEffect(() => {
    if (!remote) return;
    fetchMyAccess().then(access => setCanManage(!!access && ["super_admin", "manager"].includes(access.role))).catch(() => setCanManage(false));
  }, [remote]);

  // The distributions of the chosen area/sector, with how many properties each holds.
  useEffect(() => {
    setStreets([]);
    if (!remote || !area) return;
    let active = true;
    fetchDistributionStreets(area, sector).then(list => { if (active) setStreets(list); }).catch(cause => { if (active) setError(errorText(cause, "تعذر تحميل التوزيعات.")); });
    return () => { active = false; };
  }, [remote, area, sector]);

  const reload = async () => {
    if (!remote || !area || !street.trim()) { setMedia([]); return; }
    setLoading(true);
    try { setMedia(await listDistributionMedia(area, sector, street.trim())); }
    catch (cause) { setError(errorText(cause, "تعذر تحميل صور التوزيعة.")); }
    finally { setLoading(false); }
  };
  useEffect(() => { void reload(); }, [remote, area, sector, street]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = async (kind: "image" | "map", files: File[]) => {
    setBusy(true); setError("");
    try {
      // Plans need detail for zooming: up to 2400px and ~2.9 MB.
      for (const file of files.slice(0, Math.max(0, 12 - media.length))) await addDistributionMedia(area, sector, street.trim(), kind, await compressImage(file, 2400, 3_900_000));
      await reload();
    } catch (cause) { setError(errorText(cause, "تعذر إضافة الصورة.")); await reload(); }
    finally { setBusy(false); }
  };
  const remove = async (item: DistributionMedia) => {
    if (!window.confirm(`حذف ${distributionKindLabel[item.kind]} التوزيعة دي؟ هتختفي من كل عقارات التوزيعة.`)) return;
    setBusy(true); setError("");
    try { await deleteDistributionMedia(item.id); await reload(); }
    catch (cause) { setError(errorText(cause, "تعذر الحذف.")); }
    finally { setBusy(false); }
  };
  // A drawing on a distribution photo is kept as another photo of the same distribution.
  const saveDrawing = async (dataUrl: string) => {
    const kind = viewer !== null ? media[viewer]?.kind ?? "image" : "image";
    await addDistributionMedia(area, sector, street.trim(), kind, dataUrl);
    await reload();
  };

  const ready = !!area && !!street.trim();
  const uploadButton = (kind: "image" | "map") => <label className={`flex cursor-pointer items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-bold text-white ${kind === "map" ? "bg-indigo-600 hover:bg-indigo-500" : "bg-teal-600 hover:bg-teal-500"} ${!ready || busy || media.length >= 12 ? "pointer-events-none opacity-40" : ""}`}>
    {busy ? <LoaderCircle size={15} className="animate-spin"/> : kind === "map" ? <MapIcon size={15}/> : <ImagePlus size={15}/>}إضافة {distributionKindLabel[kind]}
    <input type="file" accept="image/*" multiple className="sr-only" onChange={event => { const files = [...(event.target.files ?? [])]; event.target.value = ""; void add(kind, files); }}/>
  </label>;

  return <section className="glass panel overflow-hidden">
    <header className="border-b border-slate-200/60 p-5 dark:border-slate-700">
      <h2 className="flex items-center gap-2 text-sm font-extrabold"><MapIcon size={16} className="text-teal-600"/>صور وخرائط التوزيعات</h2>
      <p className="mt-1 text-xs text-slate-500">اختار المنطقة والقطاع والتوزيعة، وأي صورة أو خريطة تضيفها هنا هتظهر في ملف كل عقار في التوزيعة دي.</p>
    </header>
    {!remote ? <p className="p-5 text-[13px] text-slate-500">صور التوزيعات بتشتغل بعد تسجيل الدخول على قاعدة البيانات.</p> : <div className="space-y-4 p-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-[13px] font-bold">المنطقة<select value={area} onChange={event => { setArea(event.target.value); setSector(""); setStreet(""); setError(""); }} className={field}><option value="">اختار المنطقة</option>{areas.map(name => <option key={name}>{name}</option>)}</select></label>
        <label className="text-[13px] font-bold">القطاع<select value={sector} disabled={!area} onChange={event => { setSector(event.target.value); setStreet(""); }} className={field}><option value="">كل القطاعات</option>{sectors.map(name => <option key={name}>{name}</option>)}</select></label>
        <label className="text-[13px] font-bold">التوزيعة<input value={street} disabled={!area} onChange={event => setStreet(event.target.value)} list="distribution-streets" placeholder="مثال: 001" dir="ltr" className={`${field} text-right`}/><datalist id="distribution-streets">{streets.map(item => <option key={item.street} value={item.street}>{item.properties.toLocaleString("ar-KW")} عقار</option>)}</datalist></label>
      </div>
      {area && streets.length > 0 && <div className="flex flex-wrap gap-1.5">{streets.map(item => <button key={item.street} type="button" onClick={() => setStreet(item.street)} className={`rounded-lg border px-2.5 py-1 text-xs font-bold ${item.street === street ? "border-teal-500 bg-teal-50 text-teal-700" : "border-slate-300 text-slate-600 hover:border-teal-400 dark:border-slate-700 dark:text-slate-300"}`}><span dir="ltr">{item.street}</span> · {item.properties.toLocaleString("ar-KW")}</button>)}</div>}
      {ready && <div className="rounded-xl border border-teal-200 bg-teal-50/70 p-3 text-[13px] text-teal-800 dark:border-teal-900 dark:bg-teal-950/30 dark:text-teal-200">
        هتظهر في ملف {chosen ? <b>{chosen.properties.toLocaleString("ar-KW")} عقار</b> : "كل العقارات"} في {area}{sector ? ` · ${sector}` : " (كل القطاعات)"} · التوزيعة <b dir="ltr">{street.trim()}</b>.
      </div>}
      {error && <div role="alert" className="flex items-center gap-2 rounded-xl bg-rose-50 p-3 text-[13px] text-rose-700"><AlertCircle size={15}/>{error}<button type="button" onClick={() => setError("")} className="mr-auto"><X size={14}/></button></div>}
      {ready && canManage && <div className="flex flex-wrap gap-2">{uploadButton("image")}{uploadButton("map")}<span className="self-center text-xs text-slate-500">{media.length.toLocaleString("ar-KW")} / ١٢</span></div>}
      {ready && !canManage && <p className="text-xs text-slate-500">إضافة وحذف صور التوزيعات لمدير النظام والمديرين بس.</p>}
      {ready && (loading ? <div className="grid h-32 place-items-center"><LoaderCircle className="animate-spin text-teal-500"/></div>
        : media.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">{media.map((item, index) => <figure key={item.id} className="group relative aspect-square overflow-hidden rounded-xl border border-slate-300 bg-slate-100 dark:border-slate-700 dark:bg-slate-900">
            <button type="button" onClick={() => setViewer(index)} aria-label={`تكبير ${distributionKindLabel[item.kind]}`} className="block h-full w-full"><img src={item.image_data} alt={`${distributionKindLabel[item.kind]} التوزيعة ${item.street}`} className="h-full w-full object-cover transition group-hover:scale-105"/></button>
            <span className={`absolute right-1.5 top-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-bold text-white ${item.kind === "map" ? "bg-indigo-600" : "bg-teal-600"}`}>{distributionKindLabel[item.kind]}</span>
            {canManage && <button type="button" disabled={busy} onClick={() => void remove(item)} aria-label="حذف" className="absolute left-1.5 top-1.5 rounded-md bg-rose-600/90 p-1.5 text-white hover:bg-rose-700 disabled:opacity-50"><Trash2 size={12}/></button>}
          </figure>)}</div>
        : <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-[13px] text-slate-500 dark:border-slate-700">مفيش صور أو خرائط للتوزيعة دي لسه.</div>)}
    </div>}
    {viewer !== null && media[viewer] && <ImageViewer images={media.map(item => ({ src: item.image_data, label: `${distributionKindLabel[item.kind]} التوزيعة ${item.street}` }))} index={viewer} onIndex={setViewer} onClose={() => setViewer(null)} onSaveEdit={canManage ? saveDrawing : undefined}/>}
  </section>;
}
