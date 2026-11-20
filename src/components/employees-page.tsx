"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, KeyRound, LoaderCircle, Plus, UserRound, Users, X } from "lucide-react";
import { isMarketerEmail } from "@/lib/marketer-auth";
import { employeeRequest, fetchEmployees, updateEmployee, type EmployeeRecord } from "@/lib/employee-data";
import { fetchRoleMatrix, type RoleRecord } from "@/lib/role-data";
import { usernameError } from "@/lib/username";

const blank = { name: "", username: "", password: "", roleId: "", phoneVisible: false, priceVisible: false };

export function EmployeesPage({ remote }: { remote: boolean }) {
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [form, setForm] = useState(blank);
  const [loading, setLoading] = useState(remote);
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [login, setLogin] = useState<{ person: EmployeeRecord; username: string; password: string } | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    if (!remote) return;
    setLoading(true); setError("");
    try {
      const [people, matrix] = await Promise.all([fetchEmployees(), fetchRoleMatrix()]);
      setEmployees(people); setRoles(matrix.roles);
      setForm(current => ({ ...current, roleId: current.roleId || matrix.roles.find(role => role.name === "sales_agent")?.id || matrix.roles[0]?.id || "" }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تحميل الموظفين. تحقق من صلاحيات المستخدم وترحيل قاعدة البيانات.");
    } finally { setLoading(false); }
  }, [remote]);

  useEffect(() => { void refresh(); }, [refresh]);

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(""); setMessage("");
    const invalid = usernameError(form.username.trim());
    if (invalid) { setError(invalid); return; }
    setSaving(true);
    try {
      await employeeRequest("POST", { ...form, username: form.username.trim() });
      setShowCreate(false); setForm({ ...blank, roleId: roles.find(role => role.name === "sales_agent")?.id || roles[0]?.id || "" });
      setMessage(`تم إنشاء المستخدم «${form.username.trim()}». يدخل إلى النظام باسم المستخدم وكلمة المرور.`);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر إضافة المستخدم."); }
    finally { setSaving(false); }
  };

  const saveLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!login) return;
    setError(""); setMessage("");
    const username = login.username.trim();
    const usernameChanged = username !== (login.person.username ?? "");
    if (usernameChanged) { const invalid = usernameError(username); if (invalid) { setError(invalid); return; } }
    if (!usernameChanged && !login.password) { setLogin(null); return; }
    setSaving(true);
    try {
      await employeeRequest("PATCH", { id: login.person.id, ...(usernameChanged ? { username } : {}), ...(login.password ? { password: login.password } : {}) });
      setMessage(`تم حفظ بيانات دخول ${login.person.full_name}.`);
      setLogin(null);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر حفظ بيانات الدخول."); }
    finally { setSaving(false); }
  };

  /** Marketers see phones and prices by default, like before. */
  const pickRole = (roleId: string) => {
    const marketer = roles.find(role => role.name === "marketer")?.id === roleId;
    setForm(current => ({ ...current, roleId, ...(marketer ? { phoneVisible: true, priceVisible: true } : {}) }));
  };

  const changeRole = async (person: EmployeeRecord, roleId: string) => {
    try { await updateEmployee(person.id, { roleId }); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر حفظ الدور."); }
  };

  const changeActive = async (person: EmployeeRecord) => {
    try { await updateEmployee(person.id, { isActive: !person.is_active }); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر تغيير حالة الحساب."); }
  };

  return <div className="animate-in space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><div className="mb-1 text-xs font-bold text-teal-600">إدارة الوصول</div><h1 className="text-[26px] font-black tracking-tight">الموظفون والمستخدمون</h1><p className="mt-1 text-xs text-slate-400">إنشاء حسابات دخول باسم مستخدم وكلمة مرور، وتحديد الأدوار وحالة الحساب</p></div>
      <button onClick={() => { setError(""); setShowCreate(true); }} disabled={!remote} className="flex h-10 items-center gap-2 rounded-xl bg-teal-500 px-4 text-xs font-bold text-white outline-none transition focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"><Plus size={16}/> إضافة مستخدم</button>
    </div>
    {!remote && <div className="flex items-center gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-800"><AlertTriangle size={15}/> اربط Supabase لعرض الموظفين وحفظ حساباتهم بشكل فعلي.</div>}
    {error && <div role="alert" className="flex items-center gap-2 rounded-xl bg-rose-50 p-3 text-xs text-rose-700"><AlertTriangle size={15}/><span>{error}</span></div>}
    {message && <div className="rounded-xl bg-emerald-50 p-3 text-xs text-emerald-800">{message}</div>}
    <section className="glass panel overflow-hidden"><div className="flex items-center justify-between border-b border-slate-200/60 p-5 dark:border-slate-700"><div><h2 className="text-sm font-extrabold">حسابات فريق العمل</h2><p className="mt-1 text-[10px] text-slate-400">{employees.length} موظف</p></div><Users size={20} className="text-teal-600"/></div>
      {loading ? <div className="grid h-44 place-items-center"><LoaderCircle className="animate-spin text-teal-500"/></div> : <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-right text-xs"><thead className="bg-white/30 text-[10px] text-slate-400"><tr>{["الموظف","اسم المستخدم","الدور","الحالة","تاريخ الإضافة",""].map(x => <th key={x} className="px-5 py-3 font-medium">{x}</th>)}</tr></thead><tbody>{employees.map(person => <tr key={person.id} className="border-t border-slate-100/70 dark:border-slate-800"><td className="px-5 py-3"><div className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-xl bg-teal-500/10 text-teal-700"><UserRound size={15}/></span><span className="font-bold">{person.full_name}</span></div></td><td className="px-5 py-3">{person.username ? <span dir="ltr" className="rounded-lg bg-slate-100 px-2 py-1 font-mono text-[11px] font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200">{person.username}</span> : isMarketerEmail(person.email) ? <span className="rounded-full bg-violet-50 px-2 py-1 text-[10px] font-bold text-violet-700">يدخل باسمه</span> : <span className="text-[10px] text-amber-600">لم يُحدد · يدخل بالبريد</span>}</td><td className="px-5 py-3"><select aria-label={`دور ${person.full_name}`} value={person.role_id} onChange={event => void changeRole(person, event.target.value)} className="focus-ring rounded-lg border border-slate-200 bg-white/70 px-2 py-1.5 text-[10px] dark:border-slate-700 dark:bg-slate-900">{roles.map(role => <option key={role.id} value={role.id}>{role.nameAr}</option>)}</select></td><td className="px-5 py-3"><button onClick={() => void changeActive(person)} className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${person.is_active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{person.is_active ? "نشط" : "موقوف"}</button></td><td className="px-5 py-3 text-slate-400">{new Date(person.created_at).toLocaleDateString("ar-KW")}</td><td className="px-5 py-3"><button onClick={() => { setError(""); setLogin({ person, username: person.username ?? "", password: "" }); }} className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 px-2.5 py-1.5 text-[10px] font-bold text-slate-600 hover:border-teal-400 hover:text-teal-700 dark:border-slate-700 dark:text-slate-300"><KeyRound size={13}/> بيانات الدخول</button></td></tr>)}</tbody></table>{!employees.length && <div className="p-12 text-center text-sm text-slate-400">لا توجد حسابات موظفين مسجلة بعد.</div>}</div>}
    </section>
    {showCreate && typeof document !== "undefined" && createPortal(<div onMouseDown={event=>event.target===event.currentTarget&&setShowCreate(false)} className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-slate-950/45 p-4 backdrop-blur-sm"><form onSubmit={create} className="my-auto w-full max-w-lg space-y-4 rounded-3xl border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
      <div className="flex items-center justify-between"><h2 className="text-lg font-black">إضافة مستخدم</h2><button type="button" aria-label="إغلاق" onClick={() => setShowCreate(false)} className="rounded-lg p-2 text-slate-400 hover:bg-white/60"><X size={17}/></button></div>
      <label className="block text-xs font-bold">اسم الموظف<input required minLength={2} maxLength={120} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="focus-ring mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white/60 px-3 outline-none"/></label>
      <label className="block text-xs font-bold">اسم المستخدم<input required minLength={2} maxLength={40} autoComplete="off" autoCapitalize="none" spellCheck={false} dir="ltr" value={form.username} onChange={e => setForm({ ...form, username: e.target.value.replace(/\s/g, "") })} placeholder="ahmed" className="focus-ring mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white/60 px-3 text-left outline-none dark:border-slate-700 dark:bg-slate-900"/><span className="mt-1 block font-normal text-slate-400">يكتبه الموظف في شاشة الدخول. بدون مسافات.</span></label>
      <label className="block text-xs font-bold">كلمة المرور<input required minLength={6} maxLength={72} type="text" autoComplete="new-password" dir="ltr" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} className="focus-ring mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white/60 px-3 text-left outline-none dark:border-slate-700 dark:bg-slate-900"/><span className="mt-1 block font-normal text-slate-400">٦ أحرف على الأقل. سلّمها للموظف.</span></label>
      <label className="block text-xs font-bold">الدور الوظيفي<select required value={form.roleId} onChange={e => pickRole(e.target.value)} className="focus-ring mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white/60 px-3 outline-none">{roles.map(role => <option key={role.id} value={role.id}>{role.nameAr}</option>)}</select></label>
      <div className="flex flex-wrap gap-4 text-xs"><label className="flex items-center gap-2"><input type="checkbox" checked={form.phoneVisible} onChange={e => setForm({ ...form, phoneVisible: e.target.checked })} className="accent-teal-500"/> السماح بعرض أرقام الهواتف</label><label className="flex items-center gap-2"><input type="checkbox" checked={form.priceVisible} onChange={e => setForm({ ...form, priceVisible: e.target.checked })} className="accent-teal-500"/> السماح بعرض الأسعار</label></div>
      <div className="flex justify-between pt-1"><button type="button" onClick={() => setShowCreate(false)} className="px-3 py-2 text-xs text-slate-500">إلغاء</button><button disabled={saving || !roles.length} className="flex items-center gap-2 rounded-xl bg-teal-500 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50">{saving && <LoaderCircle size={14} className="animate-spin"/>}{saving ? "جارٍ الإنشاء" : "إنشاء المستخدم"}</button></div>
    </form></div>, document.body)}
    {login && typeof document !== "undefined" && createPortal(<div onMouseDown={event=>event.target===event.currentTarget&&setLogin(null)} className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-slate-950/45 p-4 backdrop-blur-sm"><form onSubmit={saveLogin} className="my-auto w-full max-w-md space-y-4 rounded-3xl border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
      <div className="flex items-center justify-between"><div><h2 className="text-lg font-black">بيانات الدخول</h2><p className="mt-1 text-[11px] text-slate-500">{login.person.full_name}</p></div><button type="button" aria-label="إغلاق" onClick={() => setLogin(null)} className="rounded-lg p-2 text-slate-400"><X size={17}/></button></div>
      <label className="block text-xs font-bold">اسم المستخدم<input required minLength={2} maxLength={40} autoFocus autoComplete="off" autoCapitalize="none" spellCheck={false} dir="ltr" value={login.username} onChange={e => setLogin({ ...login, username: e.target.value.replace(/\s/g, "") })} className="focus-ring mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white/60 px-3 text-left outline-none dark:border-slate-700 dark:bg-slate-900"/></label>
      <label className="block text-xs font-bold">كلمة مرور جديدة<input minLength={6} maxLength={72} type="text" autoComplete="new-password" dir="ltr" value={login.password} onChange={e => setLogin({ ...login, password: e.target.value })} placeholder="اتركها فارغة لعدم التغيير" className="focus-ring mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white/60 px-3 text-left outline-none dark:border-slate-700 dark:bg-slate-900"/><span className="mt-1 block font-normal text-slate-400">٦ أحرف على الأقل. سلّمها للمستخدم.</span></label>
      <div className="flex justify-between pt-1"><button type="button" onClick={() => setLogin(null)} className="px-3 py-2 text-xs text-slate-500">إلغاء</button><button disabled={saving} className="flex items-center gap-2 rounded-xl bg-teal-500 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50">{saving && <LoaderCircle size={14} className="animate-spin"/>}{saving ? "جارٍ الحفظ" : "حفظ بيانات الدخول"}</button></div>
    </form></div>, document.body)}
  </div>;
}
