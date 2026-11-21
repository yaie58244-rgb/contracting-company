"use client";
import { useEffect, useMemo, useState } from "react";
import { Download, LoaderCircle, UsersRound } from "lucide-react";
import { fetchStaffActivity, type StaffActivityRow } from "@/lib/property-data";

type Range = "today" | "yesterday" | "week" | "month" | "custom";
const rangeLabels: Record<Range, string> = { today: "النهارده", yesterday: "امبارح", week: "الأسبوع ده", month: "الشهر ده", custom: "من تاريخ لتاريخ" };

/** yyyy-mm-dd in Kuwait time, the day boundaries the report uses. */
const kuwaitDay = (date: Date) => date.toLocaleDateString("en-CA", { timeZone: "Asia/Kuwait" });
const shiftDays = (day: string, days: number) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };

function rangeDates(range: Range, custom: { from: string; to: string }) {
  const today = kuwaitDay(new Date());
  if (range === "yesterday") { const y = shiftDays(today, -1); return { from: y, to: y }; }
  // The work week starts on Saturday in Kuwait.
  if (range === "week") { const weekday = new Date(`${today}T12:00:00Z`).getUTCDay(); return { from: shiftDays(today, -((weekday + 1) % 7)), to: today }; }
  if (range === "month") return { from: `${today.slice(0, 8)}01`, to: today };
  if (range === "custom") return custom;
  return { from: today, to: today };
}

const dayFormat = new Intl.DateTimeFormat("ar-KW", { day: "numeric", month: "short", year: "numeric" });
const timeFormat = new Intl.DateTimeFormat("ar-KW", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kuwait" });

/** Per-employee comments and the offers they commented on: an offer counts only once it has a comment, once per day. */
export function StaffActivityReport({ remote }: { remote: boolean }) {
  const today = kuwaitDay(new Date());
  const [range, setRange] = useState<Range>("today");
  const [custom, setCustom] = useState({ from: shiftDays(today, -6), to: today });
  const [rows, setRows] = useState<StaffActivityRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const dates = useMemo(() => rangeDates(range, custom), [range, custom]);

  useEffect(() => {
    if (!remote || !dates.from || !dates.to || dates.to < dates.from) return;
    let active = true;
    setLoading(true); setError("");
    fetchStaffActivity(dates.from, dates.to)
      .then(result => { if (active) setRows(result); })
      .catch(cause => { if (active) setError(cause && typeof cause === "object" && "message" in cause ? `تعذر تحميل تقرير الموظفين: ${String(cause.message)}` : "تعذر تحميل تقرير الموظفين."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [remote, dates]);

  const totals = useMemo(() => rows.reduce((t, r) => ({ comments: t.comments + r.comments, offersWorked: t.offersWorked + r.offersWorked, offersAdded: t.offersAdded + r.offersAdded }), { comments: 0, offersWorked: 0, offersAdded: 0 }), [rows]);
  const period = dates.from === dates.to ? dayFormat.format(new Date(`${dates.from}T12:00:00Z`)) : `${dayFormat.format(new Date(`${dates.from}T12:00:00Z`))} – ${dayFormat.format(new Date(`${dates.to}T12:00:00Z`))}`;

  const exportCsv = () => {
    const lines = [`تقرير نشاط الموظفين,${period}`, "الموظف,الدور,العروض اللي اشتغل عليها,التعليقات,العروض اللي ضافها,أيام النشاط,آخر تعليق",
      ...rows.map(r => [r.name, r.role, r.offersWorked, r.comments, r.offersAdded, r.activeDays, r.lastCommentAt ? timeFormat.format(new Date(r.lastCommentAt)) : ""].map(v => `"${String(v).replace(/"/g, '""')}"`).join(","))];
    const url = URL.createObjectURL(new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `نشاط-الموظفين-${dates.from}_${dates.to}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  if (!remote) return null;
  const n = (value: number) => value.toLocaleString("ar-KW");
  return <section className="glass panel overflow-hidden">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/60 p-5 dark:border-slate-700">
      <div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-teal-500/10 text-teal-600"><UsersRound size={17}/></span><div><h2 className="text-sm font-extrabold">نشاط الموظفين</h2><p className="mt-1 text-[10px] text-slate-400">العرض يتحسب للموظف لما يكتب عليه تعليق بس، مرة واحدة في اليوم · {period}</p></div></div>
      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(rangeLabels) as Range[]).map(key => <button key={key} type="button" onClick={() => setRange(key)} aria-pressed={range === key} className={`rounded-lg px-3 py-1.5 text-[11px] font-bold ${range === key ? "bg-teal-600 text-white" : "border border-slate-200 text-slate-600 hover:border-teal-400 dark:border-slate-700 dark:text-slate-300"}`}>{rangeLabels[key]}</button>)}
        <button type="button" onClick={exportCsv} disabled={!rows.length} className="flex items-center gap-1.5 rounded-lg border border-teal-500 px-3 py-1.5 text-[11px] font-bold text-teal-700 disabled:opacity-40 dark:text-teal-300"><Download size={13}/>Excel</button>
      </div>
      {range === "custom" && <div className="flex w-full flex-wrap items-center gap-2 text-[11px] text-slate-500"><label>من <input type="date" value={custom.from} max={custom.to} onChange={e => setCustom(c => ({ ...c, from: e.target.value }))} className="mr-1 rounded-lg border border-slate-200 bg-white/70 px-2 py-1 dark:border-slate-700 dark:bg-slate-900"/></label><label>إلى <input type="date" value={custom.to} min={custom.from} max={today} onChange={e => setCustom(c => ({ ...c, to: e.target.value }))} className="mr-1 rounded-lg border border-slate-200 bg-white/70 px-2 py-1 dark:border-slate-700 dark:bg-slate-900"/></label></div>}
    </header>
    {error ? <div role="alert" className="p-5 text-xs text-rose-600">{error}</div> : <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-right text-xs">
      <thead className="bg-white/25 text-[10px] text-slate-400 dark:bg-slate-900/30"><tr><th className="px-5 py-3">الموظف</th><th className="px-3 py-3">الدور</th><th className="px-3 py-3">العروض اللي اشتغل عليها</th><th className="px-3 py-3">التعليقات</th><th className="px-3 py-3">العروض اللي ضافها</th><th className="px-3 py-3">أيام النشاط</th><th className="px-5 py-3">آخر تعليق</th></tr></thead>
      <tbody>
        {rows.map(r => <tr key={r.employeeId} className="border-t border-slate-100 dark:border-slate-800"><td className="px-5 py-3 font-bold">{r.name}</td><td className="px-3 py-3 text-slate-500">{r.role}</td><td className="px-3 py-3"><b className={`tabular-nums text-sm ${r.offersWorked ? "text-teal-700 dark:text-teal-300" : "text-slate-400"}`}>{n(r.offersWorked)}</b></td><td className="px-3 py-3 tabular-nums">{n(r.comments)}</td><td className="px-3 py-3 tabular-nums">{n(r.offersAdded)}</td><td className="px-3 py-3 tabular-nums">{n(r.activeDays)}</td><td className="px-5 py-3 text-slate-500">{r.lastCommentAt ? timeFormat.format(new Date(r.lastCommentAt)) : "—"}</td></tr>)}
        {!rows.length && <tr><td colSpan={7} className="px-5 py-8 text-center text-slate-400">{loading ? "جارٍ تحميل التقرير…" : "مفيش نشاط في الفترة دي."}</td></tr>}
      </tbody>
      {rows.length > 0 && <tfoot className="border-t-2 border-slate-200 font-black dark:border-slate-700"><tr><td className="px-5 py-3">الإجمالي</td><td/><td className="px-3 py-3 tabular-nums">{n(totals.offersWorked)}</td><td className="px-3 py-3 tabular-nums">{n(totals.comments)}</td><td className="px-3 py-3 tabular-nums">{n(totals.offersAdded)}</td><td/><td className="px-5 py-3">{loading && <LoaderCircle size={14} className="animate-spin text-teal-500"/>}</td></tr></tfoot>}
    </table></div>}
  </section>;
}
