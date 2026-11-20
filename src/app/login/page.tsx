"use client";

import { FormEvent, useState } from "react";
import { Building2, Eye, EyeOff, LockKeyhole, ShieldCheck, UserRound } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      const neon = createClient();
      // The server resolves the username to the account and returns a session.
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: username.trim(), password }) });
      const result = await response.json().catch(() => ({})) as { access_token?: string; refresh_token?: string; error?: string };
      if (!response.ok || !result.access_token || !result.refresh_token) throw new Error(result.error ?? "login failed");
      const { error: authError } = await neon.auth.setSession({ access_token: result.access_token, refresh_token: result.refresh_token });
      if (authError) throw authError;
      // The workspace repairs the profile right after the redirect, so a failed
      // bootstrap must not block an otherwise valid sign-in.
      const { error: profileError } = await neon.rpc("bootstrap_current_profile");
      if (profileError) console.warn("profile bootstrap failed", profileError.message);
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.assign(next?.startsWith("/") ? next : "/");
    } catch (e) {
      setError(e instanceof Error && e.message.includes("Supabase is not configured. أضف NEXT_PUBLIC_SUPABASE_URL و NEXT_PUBLIC_SUPABASE_ANON_KEY.") ? "لم يتم إعداد Supabase بعد." : "تعذر تسجيل الدخول. تحقق من اسم المستخدم وكلمة المرور.");
    } finally { setBusy(false); }
  };

  const forgotPassword = async () => {
    setError(""); setMessage("");
    // Username accounts have no mailbox: the admin resets their password.
    if (!username.includes("@")) { setMessage("تواصل مع مدير النظام لإعادة تعيين كلمة المرور من صفحة الموظفين."); return; }
    try {
      const neon = createClient();
      const { error: resetError } = await neon.auth.resetPasswordForEmail(username.trim(), { redirectTo: `${window.location.origin}/login` });
      if (resetError) throw resetError;
      setMessage("إذا كان البريد مسجلاً، فسيصلك رابط إعادة تعيين كلمة المرور.");
    } catch { setError("تعذر إرسال رابط الاستعادة. تحقق من إعداد البريد في Supabase Auth."); }
  };

  return <main className="relative grid min-h-screen place-items-center overflow-hidden px-4 py-10">
    <div className="pointer-events-none absolute -right-24 top-0 h-80 w-80 rounded-full bg-teal-300/20 blur-3xl" />
    <div className="pointer-events-none absolute -bottom-24 -left-20 h-96 w-96 rounded-full bg-violet-300/20 blur-3xl" />
    <section className="glass panel relative grid w-full max-w-4xl overflow-hidden md:grid-cols-2">
      <div className="hidden min-h-[560px] flex-col justify-between bg-gradient-to-br from-[#14273d] via-[#152d42] to-[#245d63] p-10 text-white md:flex">
        <div className="flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-2xl bg-white/10"><Building2 size={23}/></div><div><b className="text-xl">عقار</b><div className="text-[10px] tracking-[.2em] text-white/55">AQAR · KUWAIT</div></div></div>
        <div><div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[10px] text-teal-100"><ShieldCheck size={14}/> مساحة عمل آمنة</div><h1 className="text-3xl font-black leading-[1.55]">كل عقاراتك<br/>وعلاقاتك في مكان واحد.</h1><p className="mt-4 max-w-xs text-sm leading-7 text-white/65">منصة موحدة لفريقك لإدارة العقارات والعملاء والمتابعات بكل سهولة.</p></div>
        <div className="text-xs text-white/45">حلول ذكية لإدارة العقارات في الكويت</div>
      </div>
      <div className="flex flex-col justify-center p-7 sm:p-10">
        <div className="mb-8 md:hidden"><div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-teal-500 text-white"><Building2 size={23}/></div><div className="text-center text-lg font-black">عقار</div></div>
        <div className="mb-7"><div className="mb-2 text-xs font-bold text-teal-600">مرحباً بعودتك</div><h2 className="text-2xl font-black">تسجيل الدخول</h2><p className="mt-2 text-xs text-slate-400">أدخل بيانات حسابك للوصول إلى مساحة العمل.</p></div>
        <form onSubmit={submit} className="space-y-4">
          <label className="block"><span className="mb-1.5 block text-xs font-bold">اسم المستخدم</span><span className="relative block"><UserRound size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"/><input required type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={e=>setUsername(e.target.value)} placeholder="اسم المستخدم" dir="auto" className="focus-ring h-11 w-full rounded-xl border border-slate-200/80 bg-white/50 pr-10 pl-3 text-sm outline-none dark:border-slate-700 dark:bg-slate-900/50"/></span></label>
          <label className="block"><span className="mb-1.5 block text-xs font-bold">كلمة المرور</span><span className="relative block"><LockKeyhole size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"/><input required minLength={6} type={showPassword?"text":"password"} autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••••" dir="ltr" className="focus-ring h-11 w-full rounded-xl border border-slate-200/80 bg-white/50 pr-10 pl-10 text-sm outline-none dark:border-slate-700 dark:bg-slate-900/50"/><button type="button" aria-label={showPassword?"إخفاء كلمة المرور":"إظهار كلمة المرور"} onClick={()=>setShowPassword(!showPassword)} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">{showPassword?<EyeOff size={16}/>:<Eye size={16}/>}</button></span></label>
          {error&&<p role="alert" className="rounded-xl bg-rose-50 px-3 py-2.5 text-xs text-rose-700">{error}</p>}{message&&<p role="status" className="rounded-xl bg-emerald-50 px-3 py-2.5 text-xs text-emerald-700">{message}</p>}
          <button disabled={busy} className="focus-ring h-11 w-full rounded-xl bg-teal-500 text-sm font-bold text-white shadow-lg shadow-teal-500/20 transition hover:bg-teal-600 disabled:opacity-60">{busy?"جارٍ التحقق…":"دخول إلى النظام"}</button>
        </form>
        <button type="button" onClick={forgotPassword} className="mt-4 self-center text-xs font-semibold text-teal-700 hover:underline dark:text-teal-300">نسيت كلمة المرور؟</button>
        <div className="mt-8 border-t border-slate-200/60 pt-5 text-center text-[10px] leading-5 text-slate-400 dark:border-slate-700">الدخول متاح لمستخدمي الشركة المعتمدين فقط.<br/>تواصل مع مدير النظام عند الحاجة إلى مساعدة.</div>
      </div>
    </section>
  </main>;
}
