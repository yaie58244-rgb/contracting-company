import { createClient } from "@/lib/supabase/client";

export type EmployeeRecord = {
  id: string;
  full_name: string;
  email: string;
  username: string | null;
  role_id: string;
  is_active: boolean;
  phone_visible: boolean;
  price_visible: boolean;
  can_add_property?: boolean;
  /** null follows the role, true/false overrides it for this person. */
  can_edit_property?: boolean | null;
  created_at: string;
};

export async function fetchEmployees(): Promise<EmployeeRecord[]> {
  const columns = "id,full_name,email,role_id,is_active,phone_visible,price_visible,can_add_property,can_edit_property,created_at";
  const db = createClient();
  let result = await db.from("profiles").select(`${columns},username`).order("full_name");
  // Databases without migration 033 have no username column yet.
  if (result.error && /username/.test(result.error.message)) result = await db.from("profiles").select(columns).order("full_name") as typeof result;
  if (result.error) throw result.error;
  return ((result.data ?? []) as Partial<EmployeeRecord>[]).map(row => ({ ...row, username: row.username ?? null }) as EmployeeRecord);
}

export async function updateEmployee(id: string, patch: {
  roleId?: string; isActive?: boolean; phoneVisible?: boolean; priceVisible?: boolean; canAddProperty?: boolean; canEditProperty?: "role" | "allow" | "deny";
}) {
  const { error } = await createClient().rpc("update_employee_profile", {
    p_profile_id: id,
    p_role_id: patch.roleId ?? null,
    p_is_active: patch.isActive ?? null,
    p_phone_visible: patch.phoneVisible ?? null,
    p_price_visible: patch.priceVisible ?? null,
    p_can_add_property: patch.canAddProperty ?? null,
    p_can_edit_property: patch.canEditProperty ?? null,
  });
  if (error) throw error;
}

/** Calls the server route that uses the service key (username / password changes). */
export async function employeeRequest(method: "POST" | "PATCH", body: Record<string, unknown>) {
  const { data: sessionData } = await createClient().auth.getSession();
  const accessToken = sessionData.session?.access_token;
  const response = await fetch("/api/employees", {
    method,
    headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(result.error ?? "تعذر حفظ بيانات المستخدم.");
}
