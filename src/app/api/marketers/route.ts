import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { marketerEmail, normalizeMarketerName } from "@/lib/marketer-auth";

export const dynamic = "force-dynamic";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

/** Creates a marketer login from a name and a password only. */
export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) return jsonError("إعداد Supabase غير مكتمل على هذا النشر.", 503);

  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
  if (!token) return jsonError("سجّل الدخول أولاً.", 401);

  try {
    const userClient = createSupabaseClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userResult, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userResult.user) return jsonError("انتهت الجلسة. سجّل الدخول مرة أخرى.", 401);

    const { data: canManage, error: permissionError } = await userClient.rpc("can_manage_users");
    if (permissionError) throw permissionError;
    if (canManage !== true) return jsonError("حسابك لا يملك صلاحية إضافة المسوقين.", 403);

    const input = await request.json() as { name?: unknown; password?: unknown };
    const name = typeof input.name === "string" ? input.name.replace(/\s+/g, " ").trim() : "";
    const password = typeof input.password === "string" ? input.password : "";
    if (normalizeMarketerName(name).length < 2 || name.length > 80) return jsonError("اكتب اسم المسوق (حرفان على الأقل).", 400);
    if (password.length < 6 || password.length > 72) return jsonError("كلمة المرور يجب أن تكون ٦ أحرف على الأقل.", 400);

    const admin = createSupabaseClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: role, error: roleError } = await admin.from("roles").select("id").eq("name", "marketer").maybeSingle();
    if (roleError) throw roleError;
    if (!role) return jsonError("دور «مسوق» غير موجود. طبّق ترحيل قاعدة البيانات 029 أولاً.", 409);

    const email = await marketerEmail(name);
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, marketer: true },
    });
    if (createError || !created.user) {
      const taken = /already|registered|exists/i.test(createError?.message ?? "");
      return jsonError(taken ? "يوجد مسوق بنفس الاسم. اختر اسمًا مختلفًا (مثل إضافة اسم العائلة)." : createError?.message ?? "تعذر إنشاء حساب المسوق.", 400);
    }

    const { error: profileError } = await admin.from("profiles").insert({
      id: created.user.id,
      auth_user_id: created.user.id,
      full_name: name,
      email,
      role_id: role.id,
      manager_id: userResult.user.id,
      phone_visible: true,
      price_visible: true,
    });
    if (profileError) {
      await admin.auth.admin.deleteUser(created.user.id).catch(() => null);
      throw profileError;
    }

    await admin.from("audit_logs").insert({
      actor_id: userResult.user.id,
      action: "create",
      entity_type: "profile",
      entity_id: created.user.id,
      after_data: { full_name: name, role: "marketer" },
    }).then(({ error }) => { if (error) console.warn("audit log failed", error.message); });

    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "تعذر إضافة المسوق.", 400);
  }
}
