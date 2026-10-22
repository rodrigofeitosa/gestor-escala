import { addDays, weekDates, weekMonday, minutes, shiftSpan } from "./core.mjs";
const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const DEFAULT_SETTINGS = {
  opening: Object.fromEntries(WEEKDAYS.map((_, i) => [i, { open: i === 6 ? "08:00" : "07:00", close: i === 6 ? "20:00" : "21:00" }])),
  policy: { weeklyHours: 40, dailyHours: 8, restHours: 11, maxWorkDays: 5, maxConsecutive: 5 },
  operationConfirmed: false,
  policyReviewed: false
};
const dayOf = (date) => ((/* @__PURE__ */ new Date(date + "T12:00:00Z")).getUTCDay() + 6) % 7;
const time = (value) => value?.slice(0, 5) || "";
function normalizedSettings(unit) {
  return { ...DEFAULT_SETTINGS, ...unit.settings, opening: { ...DEFAULT_SETTINGS.opening, ...unit.settings?.opening }, policy: { ...DEFAULT_SETTINGS.policy, ...unit.settings?.policy } };
}
function contextFor(data, unitId) {
  const unit = data.units.find((u) => u.id === unitId);
  const assignments = data.unit_assignments.filter((a) => a.unit_id === unitId).map((a) => ({ ...a, person: data.people.find((p) => p.id === a.person_id) })).filter((a) => a.person);
  return { unit, settings: normalizedSettings(unit), assignments, sectors: data.sectors.filter((s) => s.unit_id === unitId), roles: data.job_roles.filter((r) => r.network_id === unit.network_id), shifts: data.shift_templates.filter((s) => s.unit_id === unitId && s.active), requirements: data.coverage_requirements.filter((r) => r.unit_id === unitId), qualifications: data.qualifications.filter((q) => q.unit_id === unitId), absences: data.absences.filter((a) => a.unit_id === unitId), vacancies: data.vacancies.filter((v) => v.unit_id === unitId && v.status === "open"), otherEntries: data.schedule_entries || [] };
}
const isActive = (a, date) => a.active && a.person?.active && (!a.starts_on || a.starts_on <= date) && (!a.ends_on || a.ends_on >= date);
function isAbsent(ctx, a, date) {
  return ctx.absences.some((x) => x.assignment_id === a.id && x.starts_on <= date && x.ends_on >= date);
}
function eligible(ctx, a, sectorId, roleId, date) {
  return isActive(a, date) && (a.sector_id === sectorId && a.role_id === roleId || ctx.qualifications.some((q) => q.assignment_id === a.id && q.sector_id === sectorId && q.role_id === roleId && (!q.valid_until || q.valid_until >= date)));
}
function applicableRequirements(ctx, date) {
  return ctx.requirements.filter((r) => date >= r.effective_from && (!r.effective_until || date <= r.effective_until) && (r.on_date ? r.on_date === date : r.weekdays.includes(dayOf(date))) && !ctx.requirements.some((x) => x.overrides_id === r.id && x.on_date === date && date >= x.effective_from && (!x.effective_until || date <= x.effective_until)));
}
function workSpan(entry) {
  return entry.kind === "work" ? shiftSpan(entry.work_date, { start: time(entry.start_time), end: time(entry.end_time), breakStart: time(entry.break_start), breakEnd: time(entry.break_end) }) : null;
}
const workHours = (entry) => (workSpan(entry)?.workMinutes || 0) / 60;
function fromTemplate(a, date, template, sectorId = a.sector_id, roleId = a.role_id) {
  return { assignment_id: a.id, person_id: a.person_id, work_date: date, kind: "work", sector_id: sectorId, role_id: roleId, start_time: time(template.start_time), end_time: time(template.end_time), break_start: time(template.break_start), break_end: time(template.break_end), locked: false };
}
function emptyEntry(a, date, kind = "off") {
  return { assignment_id: a.id, person_id: a.person_id, work_date: date, kind, sector_id: a.sector_id, role_id: a.role_id, start_time: null, end_time: null, break_start: null, break_end: null, locked: false };
}
function requirementResult(ctx, rule, date, entries) {
  const candidates = entries.filter((e) => e.work_date === date && e.kind === "work" && e.sector_id === rule.sector_id && (!rule.role_id || e.role_id === rule.role_id));
  if (rule.mode === "daily") {
    const actual2 = new Set(candidates.map((e) => e.person_id)).size;
    return { rule, date, actual: actual2, minimum: rule.minimum, missing: Math.max(0, rule.minimum - actual2), missingHours: 0, slots: [] };
  }
  const slots = [], base = Date.parse(date + "T00:00:00Z") / 6e4;
  const windowStart = base + minutes(time(rule.start_time)), windowEnd = base + minutes(time(rule.end_time));
  const spans = candidates.map((entry) => ({ entry, span: workSpan(entry) })).filter((x) => x.span);
  const points = /* @__PURE__ */ new Set([windowStart, windowEnd]);
  for (const { span } of spans) for (const point of [span.start, span.end, span.breakStart, span.breakEnd]) if (point > windowStart && point < windowEnd) points.add(point);
  const bounds = [...points].sort((a, b) => a - b);
  for (let i = 0; i < bounds.length - 1; i++) {
    const start = bounds[i], end = bounds[i + 1];
    const available = spans.filter(({ entry, span }) => span.start <= start && span.end >= end && !(span.breakMinutes && span.breakStart < end && span.breakEnd > start) && (rule.mode !== "opening" || ctx.assignments.find((a) => a.id === entry.assignment_id)?.can_open));
    slots.push({ minute: start - base, actual: new Set(available.map((x) => x.entry.person_id)).size, minimum: rule.minimum, duration: (end - start) / 60 });
  }
  const actual = slots.length ? Math.min(...slots.map((s) => s.actual)) : 0;
  return { rule, date, actual, minimum: rule.minimum, missing: Math.max(0, rule.minimum - actual), missingHours: slots.reduce((sum, s) => sum + Math.max(0, s.minimum - s.actual) * s.duration, 0), slots };
}
function assessCoverage(ctx, start, entries) {
  return weekDates(start).flatMap((date) => applicableRequirements(ctx, date).map((rule) => requirementResult(ctx, rule, date, entries)));
}
function coverageSummary(results) {
  const needed = results.filter((r) => r.minimum > 0);
  return { total: needed.length, met: needed.filter((r) => !r.missing).length, gaps: needed.filter((r) => r.missing), pending: results.filter((r) => !r.rule.confirmed), missingHours: results.reduce((s, r) => s + r.missingHours, 0) };
}
function validatePlan(ctx, start, entries) {
  const issues = [], dates = weekDates(start), pol = ctx.settings.policy;
  const add = (code, level, message, entry, detail = "") => issues.push({ code, level, message, personId: entry?.person_id, date: entry?.work_date, detail });
  const others = ctx.otherEntries.filter((e) => !(e.unit_id === ctx.unit.id && dates.includes(e.work_date)));
  const all = [...others, ...entries];
  for (const a of ctx.assignments.filter((a2) => a2.active && a2.person.active)) {
    const own = entries.filter((e) => e.assignment_id === a.id);
    if (dates.some((d) => isActive(a, d) && !own.some((e) => e.work_date === d))) add("missing", "block", "Há dias sem turno ou folga definidos", { person_id: a.person_id });
    const total = all.filter((e) => e.person_id === a.person_id && dates.includes(e.work_date)).reduce((s, e) => s + workHours(e), 0);
    if (total > Math.min(a.person.weekly_hours, pol.weeklyHours) + 1e-3) add("weekly", "block", "Carga semanal excedida", { person_id: a.person_id }, `${total.toFixed(1)}h previstas`);
    if (new Set(all.filter((e) => e.person_id === a.person_id && e.kind === "work" && dates.includes(e.work_date)).map((e) => e.work_date)).size > pol.maxWorkDays) add("days", "block", "Dias de trabalho acima do perfil", { person_id: a.person_id });
    if (!a.person.contract_confirmed) add("contract", "warning", "Jornada contratual a confirmar", { person_id: a.person_id });
  }
  for (const e of entries.filter((e2) => e2.kind === "work")) {
    const a = ctx.assignments.find((a2) => a2.id === e.assignment_id), span = workSpan(e);
    if (!a || !isActive(a, e.work_date)) {
      add("inactive", "block", "Pessoa ou vínculo indisponível", e);
      continue;
    }
    if (!a.weekdays.includes(dayOf(e.work_date))) add("availability", "block", "Dia fora da disponibilidade", e);
    if (isAbsent(ctx, a, e.work_date)) add("absence", "block", "Conflito com ausência", e);
    if (!eligible(ctx, a, e.sector_id, e.role_id, e.work_date)) add("skill", "block", "Função não habilitada", e);
    if (!span || span.workMinutes <= 0 || span.workMinutes > pol.dailyHours * 60) add("daily", "block", "Jornada diária acima do perfil", e);
    if (span && span.breakMinutes < (span.workMinutes > 360 ? 60 : span.workMinutes > 240 ? 15 : 0)) add("break", "block", "Intervalo insuficiente", e);
    for (const other of all.filter((x) => x !== e && x.person_id === e.person_id && x.kind === "work")) {
      const b = workSpan(other);
      if (!b || !span) continue;
      if (span.start < b.end && b.start < span.end) add("overlap", "block", "Jornadas sobrepostas", e);
      else if (Math.max(span.start - b.end, b.start - span.end) < pol.restHours * 60) add("rest", "block", "Descanso insuficiente entre jornadas", e);
    }
    let consecutive = 1;
    while (all.some((x) => x.person_id === e.person_id && x.kind === "work" && x.work_date === addDays(e.work_date, -consecutive)) && consecutive < 15) consecutive++;
    let forward = 1;
    while (all.some((x) => x.person_id === e.person_id && x.kind === "work" && x.work_date === addDays(e.work_date, forward)) && forward < 15) forward++;
    if (consecutive + forward - 1 > pol.maxConsecutive) add("sequence", "block", "Sequência de trabalho excedida", e);
  }
  for (const r of assessCoverage(ctx, start, entries).filter((r2) => r2.missing)) add("coverage", r.rule.confirmed && r.rule.blocking ? "block" : "warning", "Cobertura abaixo do mínimo", { work_date: r.date }, `${r.actual}/${r.minimum} · ${ctx.sectors.find((s) => s.id === r.rule.sector_id)?.name || ""} / ${ctx.roles.find((f) => f.id === r.rule.role_id)?.name || "Total do setor"}`);
  if (!ctx.settings.policyReviewed) add("policy_review", "warning", "Perfil de jornada ainda não revisado");
  if (!ctx.settings.operationConfirmed) add("operation_review", "warning", "Horários iniciais da operação a revisar");
  return [...new Map(issues.map((i) => [`${i.code}:${i.personId}:${i.date}:${i.detail}`, i])).values()];
}
function canPlace(ctx, start, a, candidate, entries) {
  if (!isActive(a, candidate.work_date) || !a.weekdays.includes(dayOf(candidate.work_date)) || isAbsent(ctx, a, candidate.work_date)) return false;
  if (entries.some((e) => e.person_id === a.person_id && e.work_date === candidate.work_date && (e.kind === "work" || e.locked))) return false;
  const dates = weekDates(start), pol = ctx.settings.policy, all = [...ctx.otherEntries.filter((e) => !(e.unit_id === ctx.unit.id && dates.includes(e.work_date))), ...entries.filter((e) => e.kind === "work"), candidate];
  const own = all.filter((e) => e.person_id === a.person_id && e.kind === "work");
  if (own.filter((e) => dates.includes(e.work_date)).reduce((s, e) => s + workHours(e), 0) > Math.min(pol.weeklyHours, a.person.weekly_hours) + 1e-3) return false;
  if (new Set(own.filter((e) => dates.includes(e.work_date)).map((e) => e.work_date)).size > pol.maxWorkDays) return false;
  const span = workSpan(candidate);
  if (!span || span.workMinutes > pol.dailyHours * 60) return false;
  for (const e of own.filter((e2) => e2 !== candidate)) {
    const b = workSpan(e);
    if (span.start < b.end && b.start < span.end) return false;
    if (Math.max(span.start - b.end, b.start - span.end) < pol.restHours * 60) return false;
  }
  for (const d of [...dates, ...Array.from({ length: pol.maxConsecutive }, (_, i) => addDays(dates[6], i + 1))]) {
    let sequence = 0;
    for (let p = 0; p <= pol.maxConsecutive; p++) {
      if (own.some((e) => e.work_date === addDays(d, -p))) sequence++;
      else break;
    }
    if (sequence > pol.maxConsecutive) return false;
  }
  return true;
}
const deficit = (result) => result.rule.mode === "daily" ? result.missing : result.missingHours;
function generatePilotSuggestion(ctx, start, existing = []) {
  const dates = weekDates(start), entries = existing.filter((e) => e.locked).map((e) => ({ ...e }));
  const roster = ctx.assignments.filter((a) => a.active && a.person.active);
  for (const a of roster.filter((a2) => a2.scheduling_mode === "fixed")) for (const date of dates) {
    if (entries.some((e) => e.person_id === a.person_id && e.work_date === date)) continue;
    const template = ctx.shifts.find((s) => s.id === a.preferred_shift_id) || ctx.shifts[0];
    if (template) {
      const e = fromTemplate(a, date, template);
      if (canPlace(ctx, start, a, e, entries)) entries.push(e);
    }
  }
  const prioritizedDates = [...dates].sort((a, b) => {
    const total = (d) => applicableRequirements(ctx, d).reduce((s, r) => s + r.minimum, 0);
    return total(b) - total(a) || a.localeCompare(b);
  });
  for (const date of prioritizedDates) {
    const rules = applicableRequirements(ctx, date).sort((a, b) => (a.mode === "opening" ? -10 : 0) - (b.mode === "opening" ? -10 : 0) + (a.role_id ? -1 : 0) - (b.role_id ? -1 : 0));
    for (const rule of rules) {
      for (let safety = 0; safety < roster.length; safety++) {
        const before = requirementResult(ctx, rule, date, entries);
        if (!before.missing) break;
        let best = null, bestScore = -Infinity;
        for (const a of roster) {
          if (rule.mode === "opening" && !a.can_open) continue;
          const role = rule.role_id || (a.sector_id === rule.sector_id ? a.role_id : ctx.qualifications.find((q) => q.assignment_id === a.id && q.sector_id === rule.sector_id)?.role_id);
          if (!role || !eligible(ctx, a, rule.sector_id, role, date)) continue;
          for (const template of ctx.shifts) {
            const entry = fromTemplate(a, date, template, rule.sector_id, role);
            if (!canPlace(ctx, start, a, entry, entries)) continue;
            const after = requirementResult(ctx, rule, date, [...entries, entry]), gain = deficit(before) - deficit(after);
            if (gain <= 0) continue;
            const hours = entries.filter((e) => e.person_id === a.person_id).reduce((s, e) => s + workHours(e), 0), weekends = entries.filter((e) => e.person_id === a.person_id && dayOf(e.work_date) >= 5).length;
            const score = gain * 100 - hours * 0.15 - weekends * 2 + (template.id === a.preferred_shift_id ? 2 : 0) + (a.role_id === role && a.sector_id === rule.sector_id ? 3 : 0);
            if (score > bestScore) {
              bestScore = score;
              best = entry;
            }
          }
        }
        if (!best) break;
        entries.push(best);
      }
    }
  }
  for (const a of roster) {
    const candidateDays = [...dates].sort((x, y) => dayOf(x) - dayOf(y));
    for (const date of candidateDays) {
      if (entries.some((e) => e.person_id === a.person_id && e.work_date === date)) continue;
      const templates = [...ctx.shifts].sort((x, y) => Number(y.id === a.preferred_shift_id) - Number(x.id === a.preferred_shift_id));
      for (const t of templates) {
        const entry = fromTemplate(a, date, t);
        if (canPlace(ctx, start, a, entry, entries)) {
          entries.push(entry);
          break;
        }
      }
    }
  }
  for (const a of roster) for (const date of dates) if (isActive(a, date) && !entries.some((e) => e.person_id === a.person_id && e.work_date === date)) entries.push(emptyEntry(a, date, isAbsent(ctx, a, date) ? "absence" : "off"));
  return entries.sort((a, b) => a.person_id.localeCompare(b.person_id) || a.work_date.localeCompare(b.work_date));
}
function staffInventory(ctx, start) {
  const pairs = /* @__PURE__ */ new Map();
  const ensure = (sector, role) => {
    const key = sector + ":" + role;
    if (!pairs.has(key)) pairs.set(key, { sectorId: sector, roleId: role, sector: ctx.sectors.find((s) => s.id === sector)?.name || "", role: ctx.roles.find((r) => r.id === role)?.name || "Total do setor", primary: 0, qualified: 0, vacancies: 0, weekendAvailable: [0, 0], minimum: [null, null] });
    return pairs.get(key);
  };
  for (const a of ctx.assignments.filter((a2) => a2.active && a2.person.active && (!a2.starts_on || a2.starts_on <= addDays(start, 6)) && (!a2.ends_on || a2.ends_on >= start))) ensure(a.sector_id, a.role_id).primary++;
  for (const q of ctx.qualifications) ensure(q.sector_id, q.role_id);
  for (const v of ctx.vacancies) ensure(v.sector_id, v.role_id).vacancies += v.quantity;
  for (const r of ctx.requirements) if (r.role_id) ensure(r.sector_id, r.role_id);
  for (const row of pairs.values()) {
    row.qualified = ctx.assignments.filter((a) => eligible(ctx, a, row.sectorId, row.roleId, start)).length;
    [5, 6].forEach((day, i) => {
      const date = addDays(start, day);
      row.weekendAvailable[i] = new Set(ctx.assignments.filter((a) => eligible(ctx, a, row.sectorId, row.roleId, date) && a.weekdays.includes(day) && !isAbsent(ctx, a, date)).map((a) => a.person_id)).size;
      const rules = applicableRequirements(ctx, date).filter((r) => r.role_id === row.roleId && r.sector_id === row.sectorId);
      if (rules.length) row.minimum[i] = Math.max(...rules.map((r) => r.minimum));
    });
  }
  return [...pairs.values()].sort((a, b) => a.sector.localeCompare(b.sector) || a.role.localeCompare(b.role));
}
function withScenario(ctx, proposals) {
  const virtual = [], qualifications = [...ctx.qualifications];
  proposals.forEach((p, index) => {
    if (p.type === "qualification") {
      qualifications.push({ ...p, id: `virtual-skill-${index}` });
      return;
    }
    for (let i = 0; i < p.quantity; i++) {
      const id = `virtual-${index}-${i}`;
      virtual.push({ id, person_id: id, unit_id: ctx.unit.id, sector_id: p.sector_id, role_id: p.role_id, weekdays: p.weekdays || [0, 1, 2, 3, 4, 5, 6], preferred_shift_id: p.preferred_shift_id || ctx.shifts[0]?.id, can_open: !!p.can_open, active: true, scheduling_mode: "variable", person: { id, name: `Reforço simulado ${index + 1}.${i + 1}`, active: true, weekly_hours: p.weekly_hours || 40, contract_confirmed: false } });
    }
  });
  return { ...ctx, assignments: [...ctx.assignments, ...virtual], qualifications };
}
export {
  DEFAULT_SETTINGS,
  WEEKDAYS,
  addDays,
  applicableRequirements,
  assessCoverage,
  contextFor,
  coverageSummary,
  dayOf,
  eligible,
  emptyEntry,
  fromTemplate,
  generatePilotSuggestion,
  isAbsent,
  isActive,
  normalizedSettings,
  requirementResult,
  staffInventory,
  time,
  validatePlan,
  weekDates,
  weekMonday,
  withScenario,
  workHours,
  workSpan
};
