import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization");
  return authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
}

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) return jsonError("إعداد Supabase غير مكتمل على هذا النشر.", 503);

  const token = bearerToken(request);
  if (!token) return jsonError("سجّل الدخول أولاً.", 401);

  try {
    // Validate the caller with their own access token so every permission check
    // runs against the same identity that the database policies see.
    const userClient = createSupabaseClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userResult, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userResult.user) return jsonError("انتهت الجلسة. سجّل الدخول مرة أخرى.", 401);

    const { data: canManage, error: permissionError } = await userClient.rpc("can_manage_users");
    if (permissionError) throw permissionError;
    if (canManage !== true) return jsonError("حسابك لا يملك صلاحية إضافة الموظفين.", 403);

    const input = await request.json() as {
      name?: unknown; email?: unknown; password?: unknown; roleId?: unknown;
      phoneVisible?: unknown; priceVisible?: unknown;
    };
    const name = typeof input.name === "string" ? input.name.trim() : "";
    const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
    const password = typeof input.password === "string" ? input.password : "";
    const roleId = typeof input.roleId === "string" ? input.roleId : "";
    if (name.length < 2 || name.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 10 || !roleId) {
      return jsonError("راجع الاسم والبريد وكلمة المرور (10 أحرف على الأقل) والدور.", 400);
    }

    // The service role key never leaves the server; it is only used to create the
    // login account and to write the profile row that links it to a role.
    const admin = createSupabaseClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name },
    });
    if (createError || !created.user) {
      return jsonError(createError?.message ?? "تعذر إنشاء حساب الدخول.", 400);
    }

    const { error: profileError } = await admin.from("profiles").insert({
      id: created.user.id,
      auth_user_id: created.user.id,
      full_name: name,
      email,
      role_id: roleId,
      manager_id: userResult.user.id,
      phone_visible: input.phoneVisible === true,
      price_visible: input.priceVisible === true,
    });

    if (profileError) {
      // Do not leave an orphan login account behind.
      await admin.auth.admin.deleteUser(created.user.id).catch(() => null);
      throw profileError;
    }

    await admin.from("audit_logs").insert({
      actor_id: userResult.user.id,
      action: "create",
      entity_type: "profile",
      entity_id: created.user.id,
      after_data: { full_name: name, email, role_id: roleId },
    }).then(({ error }) => { if (error) console.warn("audit log failed", error.message); });

    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "تعذر إضافة الموظف.";
    return jsonError(message, 400);
  }
}
