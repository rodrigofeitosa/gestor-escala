import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_KEY } from "./pilot-config.mjs";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "turno-pilot-auth" } });
const tables = ["networks", "units", "memberships", "sectors", "job_roles", "people", "shift_templates", "unit_assignments", "qualifications", "absences", "coverage_requirements", "vacancies", "scenarios"];
async function rpc(name, params) {
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw error;
  return data;
}
async function paged(table, filters = (q) => q) {
  const rows = [];
  for (let offset = 0; ; offset += 1e3) {
    const { data, error } = await filters(supabase.from(table).select("*")).order("id").range(offset, offset + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1e3) return rows;
  }
}
async function loadPilot() {
  await rpc("accept_access", {});
  const results = await Promise.all(tables.map(async (table) => {
    return [table, await paged(table)];
  }));
  return Object.fromEntries(results);
}
async function loadSchedules(data, week) {
  const min = /* @__PURE__ */ new Date(week + "T00:00:00Z");
  min.setUTCDate(min.getUTCDate() - 7);
  const max = /* @__PURE__ */ new Date(week + "T00:00:00Z");
  max.setUTCDate(max.getUTCDate() + 13);
  const since = min.toISOString().slice(0, 10), until = max.toISOString().slice(0, 10);
  const [plans, entries] = await Promise.all([
    paged("schedules", (q) => q.gte("week_start", since).lte("week_start", until)),
    paged("schedule_entries", (q) => q.gte("work_date", since).lte("work_date", until))
  ]);
  data.schedules = plans;
  data.schedule_entries = entries;
  return data;
}
async function mutate(ctx, table, record, remove = false) {
  return rpc("mutate_configuration", { p_unit: ctx.unit.id, p_revision: ctx.unit.revision, p_table: table, p_record: record, p_delete: remove });
}
async function recentHistory(unitId) {
  const { data, error } = await supabase.from("audit_events").select("*").eq("unit_id", unitId).order("created_at", { ascending: false }).limit(40);
  if (error) throw error;
  return data;
}
async function publicationHistory(scheduleId) {
  const { data, error } = await supabase.from("published_schedules").select("*").eq("schedule_id", scheduleId).order("version", { ascending: false });
  if (error) throw error;
  return data;
}
export {
  loadPilot,
  loadSchedules,
  mutate,
  publicationHistory,
  recentHistory,
  rpc,
  supabase
};
