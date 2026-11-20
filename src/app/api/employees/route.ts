import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { normalizeUsername, usernameError } from "@/lib/username";

export const dynamic = "force-dynamic";

/** Internal login emails for username accounts; never shown or used for mail. */
const USER_EMAIL_DOMAIN = "users.aqar.local";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

type Context = { admin: SupabaseClient; actorId: string; actorIsSuperAdmin: boolean };

/** Checks the caller's token and that they may manage users. */
async function authorize(request: Request, deniedMessage: string): Promise<Context | Response> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) return jsonError("إعداد Supabase غير مكتمل على هذا النشر.", 503);

  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
  if (!token) return jsonError("سجّل الدخول أولاً.", 401);

  // Validate the caller with their own access token so every permission check
  // runs against the same identity that the database policies see.
  const userClient = createSupabaseClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userResult, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userResult.user) return jsonError("انتهت الجلسة. سجّل الدخول مرة أخرى.", 401);

  const [{ data: canManage, error: permissionError }, { data: role }] = await Promise.all([
    userClient.rpc("can_manage_users"),
    userClient.rpc("current_app_role"),
  ]);
  if (permissionError) throw permissionError;
  if (canManage !== true) return jsonError(deniedMessage, 403);

  // The service role key never leaves the server.
  const admin = createSupabaseClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return { admin, actorId: userResult.user.id, actorIsSuperAdmin: role === "super_admin" };
}

async function usernameTaken(admin: SupabaseClient, username: string, exceptId?: string) {
  let query = admin.from("profiles").select("id").ilike("username", username.replace(/[\\%_]/g, "\\$&"));
  if (exceptId) query = query.neq("id", exceptId);
  const { data, error } = await query.limit(1);
  if (error) throw error;
  return Boolean(data?.length);
}

function audit(admin: SupabaseClient, actorId: string, action: string, entityId: string, after: Record<string, unknown>) {
  return admin.from("audit_logs").insert({ actor_id: actorId, action, entity_type: "profile", entity_id: entityId, after_data: after })
    .then(({ error }) => { if (error) console.warn("audit log failed", error.message); });
}

/** Creates a login from a username and a password. */
export async function POST(request: Request) {
  try {
    const context = await authorize(request, "حسابك لا يملك صلاحية إضافة المستخدمين.");
    if (context instanceof Response) return context;
    const { admin, actorId, actorIsSuperAdmin } = context;

    const input = await request.json() as {
      name?: unknown; username?: unknown; password?: unknown; roleId?: unknown;
      phoneVisible?: unknown; priceVisible?: unknown;
    };
    const name = typeof input.name === "string" ? input.name.replace(/\s+/g, " ").trim() : "";
    const username = normalizeUsername(typeof input.username === "string" ? input.username : "");
    const password = typeof input.password === "string" ? input.password : "";
    const roleId = typeof input.roleId === "string" ? input.roleId : "";
    if (name.length < 2 || name.length > 120) return jsonError("اكتب اسم الموظف (حرفان على الأقل).", 400);
    const invalidUsername = usernameError(username);
    if (invalidUsername) return jsonError(invalidUsername, 400);
    if (password.length < 6 || password.length > 72) return jsonError("كلمة المرور يجب أن تكون ٦ أحرف على الأقل.", 400);
    if (!roleId) return jsonError("اختر الدور الوظيفي.", 400);

    const { data: role, error: roleError } = await admin.from("roles").select("name").eq("id", roleId).maybeSingle();
    if (roleError) throw roleError;
    if (!role) return jsonError("الدور المحدد غير موجود.", 400);
    if (role.name === "super_admin" && !actorIsSuperAdmin) return jsonError("مدير النظام فقط يمكنه إنشاء حساب مدير نظام.", 403);
    if (await usernameTaken(admin, username)) return jsonError("اسم المستخدم مستخدم من قبل. اختر اسمًا آخر.", 409);

    const email = `u-${crypto.randomUUID()}@${USER_EMAIL_DOMAIN}`;
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { name, username },
    });
    if (createError || !created.user) return jsonError(createError?.message ?? "تعذر إنشاء حساب الدخول.", 400);

    const { error: profileError } = await admin.from("profiles").insert({
      id: created.user.id,
      auth_user_id: created.user.id,
      full_name: name,
      email,
      username,
      role_id: roleId,
      manager_id: actorId,
      phone_visible: input.phoneVisible === true,
      price_visible: input.priceVisible === true,
    });
    if (profileError) {
      // Do not leave an orphan login account behind.
      await admin.auth.admin.deleteUser(created.user.id).catch(() => null);
      if (/username/.test(profileError.message)) return jsonError("اسم المستخدم مستخدم من قبل أو غير صالح. إذا استمر الخطأ فطبّق ترحيل قاعدة البيانات 033.", 409);
      throw profileError;
    }

    await audit(admin, actorId, "create", created.user.id, { full_name: name, username, role_id: roleId });
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "تعذر إضافة المستخدم.", 400);
  }
}

/** Changes a user's username and/or sets a new password. */
export async function PATCH(request: Request) {
  try {
    const context = await authorize(request, "حسابك لا يملك صلاحية تعديل بيانات دخول المستخدمين.");
    if (context instanceof Response) return context;
    const { admin, actorId, actorIsSuperAdmin } = context;

    const input = await request.json() as { id?: unknown; username?: unknown; password?: unknown };
    const id = typeof input.id === "string" ? input.id : "";
    const username = typeof input.username === "string" ? normalizeUsername(input.username) : null;
    const password = typeof input.password === "string" && input.password ? input.password : null;
    if (!id) return jsonError("المستخدم غير محدد.", 400);
    if (username === null && password === null) return jsonError("لا يوجد تغيير للحفظ.", 400);
    if (username !== null) { const invalid = usernameError(username); if (invalid) return jsonError(invalid, 400); }
    if (password !== null && (password.length < 6 || password.length > 72)) return jsonError("كلمة المرور يجب أن تكون ٦ أحرف على الأقل.", 400);

    const { data: target, error: targetError } = await admin.from("profiles").select("id,auth_user_id,role_id,roles(name)").eq("id", id).maybeSingle();
    if (targetError) throw targetError;
    if (!target) return jsonError("المستخدم غير موجود.", 404);
    const targetRole = (target.roles as { name?: string } | null)?.name;
    // A manager must not be able to take over the system admin's account.
    if (targetRole === "super_admin" && !actorIsSuperAdmin && id !== actorId) return jsonError("بيانات دخول مدير النظام يغيّرها مدير النظام فقط.", 403);

    if (username !== null) {
      if (await usernameTaken(admin, username, id)) return jsonError("اسم المستخدم مستخدم من قبل. اختر اسمًا آخر.", 409);
      const { error } = await admin.from("profiles").update({ username, updated_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    }
    if (password !== null) {
      const { error } = await admin.auth.admin.updateUserById(String(target.auth_user_id ?? id), { password });
      if (error) throw error;
    }

    await audit(admin, actorId, "update", id, { ...(username !== null ? { username } : {}), ...(password !== null ? { password_reset: true } : {}) });
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "تعذر حفظ بيانات الدخول.", 400);
  }
}
