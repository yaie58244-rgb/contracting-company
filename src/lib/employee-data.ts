import { createClient } from "@/lib/supabase/client";

export type EmployeeRecord = {
  id: string;
  full_name: string;
  email: string;
  role_id: string;
  is_active: boolean;
  phone_visible: boolean;
  price_visible: boolean;
  created_at: string;
};

export async function fetchEmployees(): Promise<EmployeeRecord[]> {
  const { data, error } = await createClient().from("profiles")
    .select("id,full_name,email,role_id,is_active,phone_visible,price_visible,created_at")
    .order("full_name");
  if (error) throw error;
  return (data ?? []) as EmployeeRecord[];
}

export async function updateEmployee(id: string, patch: {
  roleId?: string; isActive?: boolean; phoneVisible?: boolean; priceVisible?: boolean;
}) {
  const { error } = await createClient().rpc("update_employee_profile", {
    p_profile_id: id,
    p_role_id: patch.roleId ?? null,
    p_is_active: patch.isActive ?? null,
    p_phone_visible: patch.phoneVisible ?? null,
    p_price_visible: patch.priceVisible ?? null,
  });
  if (error) throw error;
}
