import { supabase, rpc, loadPilot, loadSchedules, mutate, recentHistory, publicationHistory } from "./pilot-api.mjs";
import { escapeHTML as h, parseCSV, parseAFD, csvCell } from "./core.mjs";
import { WEEKDAYS, DEFAULT_SETTINGS, addDays, weekDates, weekMonday, dayOf, time, contextFor, workHours, workSpan, emptyEntry, fromTemplate, eligible, applicableRequirements, assessCoverage, coverageSummary, validatePlan, generatePilotSuggestion, staffInventory, withScenario, validateOpeningHours } from "./pilot-model.mjs";
const app = document.querySelector("#app"), modal = document.querySelector("#modal");
let data = null, user = null, state = { view: "coverage", unitId: null, week: weekMonday(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(/* @__PURE__ */ new Date())), entries: [], schedule: null, publication: null, dirty: false, sector: "all", search: "", page: 0, proposals: [], forecastCache: null, authMode: "login", busy: false };
let previousFocus = null, authSerial = 0;
const symbols = { grid: "▦", calendar: "▤", users: "♙", shield: "◇", settings: "⚙", arrow: "→", check: "✓", plus: "+", close: "×", warning: "!", clock: "◷", download: "↓", refresh: "↻", store: "▥", help: "?" };
const ico = (name) => `<span class="pilot-symbol" aria-hidden="true">${symbols[name] || symbols.grid}</span>`;
const dateLabel = (date, opts = { day: "2-digit", month: "short" }) => new Intl.DateTimeFormat("pt-BR", { ...opts, timeZone: "UTC" }).format(/* @__PURE__ */ new Date(date + "T12:00:00Z"));
const ctx = () => contextFor(data, state.unitId);
const owner = () => data?.memberships.some((m) => m.user_id === user?.id && m.network_id === ctx().unit.network_id && m.role === "owner" && m.active);
const manager = () => owner() || data?.memberships.some((m) => m.user_id === user?.id && m.unit_id === state.unitId && m.role === "manager" && m.active);
const locked = () => state.schedule?.status === "published";
const field = (label, name, value = "", type = "text", extra = "") => `<label>${label}<input name="${name}" type="${type}" value="${h(value)}" ${extra}></label>`;
const options = (items, selected, label = "name", empty = null) => `${empty !== null ? `<option value="">${empty}</option>` : ""}${items.map((item) => `<option value="${h(item.id)}" ${item.id === selected ? "selected" : ""}>${h(typeof label === "function" ? label(item) : item[label])}</option>`).join("")}`;
const select = (label, name, opts, extra = "") => `<label>${label}<select name="${name}" ${extra}>${opts}</select></label>`;
const checkbox = (label, name, checked = false) => `<label class="checkbox-label"><input type="checkbox" name="${name}" ${checked ? "checked" : ""}>${label}</label>`;
function notify(message) {
  const el = document.querySelector("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => el.classList.remove("show"), 5500);
}
function niceError(error) {
  if (error.code === "40001") return "Outra pessoa alterou os dados. Recarregue e confira as diferenças antes de salvar.";
  if (error.code === "23505") return "Já existe um cadastro com esse identificador ou nome. Confira antes de repetir.";
  if (error.code === "23503") return "Este registro está ligado a outros dados. Prefira desativar para preservar o histórico.";
  if (error.code === "23514") return "Confira os campos, os dias e a ordem dos horários informados.";
  if (/Invalid login credentials/i.test(error.message)) return "E-mail ou senha incorretos. Confira seus dados.";
  if (/Email not confirmed/i.test(error.message)) return "Confirme seu e-mail antes de entrar.";
  if (/rate limit|email.*limit/i.test(error.message)) return "O serviço de e-mail atingiu o limite temporário. Aguarde e tente novamente.";
  if (/fetch|network|Failed to fetch/i.test(error.message)) return "Sem conexão com a base. Suas alterações ainda não foram salvas.";
  if (error.code === "P0001" || /^(Informe|Confirme|Revise|Não |Sem |Apenas |Entre |Abra |Confira|Recarregue|Limite|Cadastre|Pessoa|Setor|Outra |A configuração|A escala|Dados|Existem|Nenhum|Registro|Use |Identificador|Vínculo|Horários|Este |Uma )/u.test(error.message || "")) return error.message;
  return "Não foi possível concluir. Confira os dados ou recarregue a página e tente novamente.";
}
function showModal(eyebrow, title, body, wide = false) {
  previousFocus = document.activeElement;
  modal.className = wide ? "wide" : "";
  modal.innerHTML = `<div class="modal-header"><div><div class="eyebrow">${eyebrow}</div><h2 id="modal-title">${title}</h2></div><button class="icon-button" data-close aria-label="Fechar janela">×</button></div>${body}`;
  modal.querySelectorAll("[data-close]").forEach((b) => b.onclick = () => modal.close());
  if (!modal.open) modal.showModal();
}
modal.addEventListener("close", () => {
  if (previousFocus?.isConnected) previousFocus.focus();
});
const actions = (label = "Salvar") => `<div id="form-error" class="form-error" role="alert"></div><div class="modal-actions"><button type="button" class="button secondary" data-close>Cancelar</button><button class="button primary" type="submit">${label}</button></div>`;
function bindForm(id, handler) {
  const f = document.querySelector("#" + id);
  f.onsubmit = async (event) => {
    event.preventDefault();
    const submit = f.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      await handler(Object.fromEntries(new FormData(f)), f);
    } catch (error) {
      const target = f.querySelector(".form-error") || document.querySelector("#form-error");
      if (target) target.textContent = niceError(error);
      else notify(niceError(error));
    } finally {
      if (submit.isConnected) submit.disabled = false;
    }
  };
}
window.addEventListener("beforeunload", (e) => {
  if (state.dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});
async function task(action) {
  if (state.busy) return;
  state.busy = true;
  try {
    await action();
  } catch (error) {
    notify(niceError(error));
  } finally {
    state.busy = false;
  }
}
function permissionMessage() {
  notify("Seu perfil permite consultar esta unidade. Peça ao administrador permissão de manutenção.");
}
function mayChange() {
  if (!manager()) {
    permissionMessage();
    return false;
  }
  return true;
}
async function navigate(next) {
  if (!state.dirty) return next();
  showModal("ALTERAÇÕES NÃO SALVAS", "Salvar antes de continuar?", `<p>Há alterações no rascunho desta semana. Salve para continuar de outro dispositivo.</p><div id="form-error" class="form-error" role="alert"></div><div class="modal-actions"><button class="button secondary" id="discard">Descartar e continuar</button><button class="button primary" id="save-continue">Salvar e continuar</button></div>`);
  document.querySelector("#discard").onclick = () => {
    state.dirty = false;
    modal.close();
    next();
  };
  document.querySelector("#save-continue").onclick = async () => {
    try {
      await savePlan();
      modal.close();
      await next();
    } catch (e) {
      document.querySelector("#form-error").textContent = niceError(e);
    }
  };
}
async function refresh(keepWeek = true) {
  data = await loadPilot();
  const accessible = data.units.filter((u) => u.active);
  if (!accessible.length) {
    renderNoAccess();
    return;
  }
  state.unitId = accessible.some((u) => u.id === state.unitId) ? state.unitId : accessible[0].id;
  await loadWeek();
  render();
}
async function loadWeek() {
  await loadSchedules(data, state.week);
  state.schedule = data.schedules.find((s) => s.unit_id === state.unitId && s.week_start === state.week) || null;
  state.entries = data.schedule_entries.filter((e) => e.unit_id === state.unitId && weekDates(state.week).includes(e.work_date)).map((e) => ({ ...e }));
  state.publication = null;
  if (state.schedule?.published_version) {
    const versions = await publicationHistory(state.schedule.id);
    state.publication = versions[0] || null;
  }
  state.dirty = false;
  state.forecastCache = null;
}
function forecast() {
  if (!state.forecastCache) {
    const c = ctx(), plan = state.entries.length ? state.entries : generatePilotSuggestion(c, state.week);
    const results = assessCoverage(c, state.week, plan);
    state.forecastCache = { plan, results, summary: coverageSummary(results), inventory: staffInventory(c, state.week) };
  }
  return state.forecastCache;
}
function scheduleContext() {
  const snapshot = locked() ? state.publication?.snapshot : null;
  if (!snapshot) return ctx();
  const c = ctx();
  return { ...c, unit: snapshot.unit, settings: snapshot.unit.settings, requirements: snapshot.requirements, sectors: snapshot.sectors, roles: snapshot.roles, assignments: snapshot.assignments || c.assignments, qualifications: snapshot.qualifications || [], absences: snapshot.absences || [] };
}
const roleName = (id) => ctx().roles.find((r) => r.id === id)?.name || "Total do setor";
const sectorName = (id) => ctx().sectors.find((s) => s.id === id)?.name || "Setor";
const personName = (id) => data.people.find((p) => p.id === id)?.name || "Pessoa";
const requirementName = (r) => `${sectorName(r.sector_id)} · ${roleName(r.role_id)}`;
function render() {
  if (!data || !state.unitId) return;
  const c = ctx(), nav = [["coverage", "grid", "Cobertura e quadro"], ["schedule", "calendar", "Escalas"], ["team", "users", "Equipe"], ["requirements", "shield", "Mínimos de cobertura"], ["settings", "settings", "Operação e cadastros"], ...owner() ? [["access", "users", "Acessos"]] : [], ["history", "clock", "Histórico"]];
  app.innerHTML = `<aside class="sidebar"><a class="brand" href="#" data-nav="coverage"><span class="brand-mark">t<span>·</span></span><span>turno<span class="brand-dot">.</span></span></a><div class="workspace"><span class="workspace-icon">${ico("store")}</span><div><strong>${h(data.networks.find((n) => n.id === c.unit.network_id)?.name || "Rede do piloto")}</strong><small>Piloto com dados da operação</small></div></div><div class="nav-caption">PLANEJAMENTO DA EQUIPE</div><nav aria-label="Navegação principal">${nav.map(([key, symbol, label]) => `<button class="nav-item ${state.view === key ? "active" : ""}" data-nav="${key}" ${state.view === key ? 'aria-current="page"' : ""}>${ico(symbol)}<span>${label}</span></button>`).join("")}</nav><div class="sidebar-bottom"><div class="pilot-card"><strong>Antes de planejar</strong><p>Confira os horários, as funções e os mínimos ainda provisórios.</p><button data-nav="settings">Revisar operação →</button></div><a class="sidebar-reset" href="./demo.html" target="_blank" rel="noopener">Abrir demo fictícia ↗</a><div class="profile"><span class="avatar">${h(user?.email?.slice(0, 2).toUpperCase() || "TU")}</span><div><strong>${owner() ? "Administrador" : manager() ? "Gerente" : "Consulta"}</strong><small>${h(user?.email || "")}</small></div></div></div></aside><div class="workspace-main"><header class="topbar"><div class="breadcrumb">PILOTO <span>/</span>${nav.find((n) => n[0] === state.view)?.[2].toUpperCase()}</div><div class="topbar-right"><label class="store-select"><span class="sr-only">Unidade</span><select id="unit-select" aria-label="Unidade">${options(data.units.filter((u) => u.active), state.unitId)}</select></label><button class="icon-button" id="reload" aria-label="Recarregar dados">↻</button><button class="text-button" id="logout">Sair</button></div></header><main id="main" tabindex="-1"></main><footer class="app-footer"><span>Turno · Piloto operacional</span><span id="save-indicator">${state.dirty ? "Alterações ainda não salvas" : "Dados carregados do Supabase"} · ${h(c.unit.timezone)}</span></footer></div>`;
  document.querySelector("#main").innerHTML = { coverage: coverageView, schedule: scheduleView, team: teamView, requirements: requirementsView, settings: settingsView, access: accessView, history: historyView }[state.view]();
  document.querySelectorAll("[data-nav]").forEach((b) => b.onclick = (e) => {
    e.preventDefault();
    navigate(async () => {
      state.view = b.dataset.nav;
      state.search = "";
      state.page = 0;
      state.sector = "all";
      render();
      document.querySelector("#main").focus();
    });
  });
  document.querySelector("#unit-select").onchange = (e) => {
    const id = e.target.value;
    navigate(async () => {
      state.unitId = id;
      state.proposals = [];
      state.sector = "all";
      await loadWeek();
      render();
    });
  };
  document.querySelector("#reload").onclick = () => navigate(() => task(() => refresh()));
  document.querySelector("#logout").onclick = () => navigate(async () => {
    await supabase.auth.signOut();
    data = null;
    user = null;
    state.entries = [];
    state.proposals = [];
    renderAuth();
  });
  ({ coverage: bindCoverage, schedule: bindSchedule, team: bindTeam, requirements: bindRequirements, settings: bindSettings, access: bindAccess, history: () => {
    void fillHistory();
  } })[state.view]();
}
function pageHeading(eyebrow, title, description, buttons = "") {
  return `<section class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}<span>.</span></h1><p>${description}</p></div><div class="heading-actions">${buttons}</div></section>`;
}
function weekToolbar() {
  return `<div class="pilot-week-toolbar"><div class="date-nav"><button class="icon-button" id="week-prev" aria-label="Semana anterior">‹</button><strong>${dateLabel(state.week)} — ${dateLabel(addDays(state.week, 6))} <small>${state.week.slice(0, 4)}</small></strong><button class="icon-button" id="week-next" aria-label="Próxima semana">›</button></div><label class="week-input">Ir para a semana de <input type="date" id="week-picker" value="${state.week}" aria-label="Escolher semana"></label></div>`;
}
function bindWeek() {
  for (const [id, days] of [["week-prev", -7], ["week-next", 7]]) document.querySelector("#" + id)?.addEventListener("click", () => navigate(() => task(async () => {
    state.week = addDays(state.week, days);
    await loadWeek();
    render();
  })));
  document.querySelector("#week-picker")?.addEventListener("change", (e) => {
    if (e.target.value) navigate(() => task(async () => {
      state.week = weekMonday(e.target.value);
      await loadWeek();
      render();
    }));
  });
}
const pill = (text, kind = "") => `<span class="status-pill ${kind}">${h(text)}</span>`;
function metric(label, value, note, symbol = "grid") {
  return `<article class="metric"><span class="metric-icon green">${ico(symbol)}</span><div><span>${label}</span><strong>${value}</strong><p>${note}</p></div></article>`;
}
function coverageView() {
  const c = ctx(), f = forecast(), s = f.summary, active = c.assignments.filter((a) => a.active && a.person.active && (!a.starts_on || a.starts_on <= addDays(state.week, 6)) && (!a.ends_on || a.ends_on >= state.week));
  const results = f.results.filter((r) => state.sector === "all" || r.rule.sector_id === state.sector);
  const simulation = state.proposals.length ? withScenario(c, state.proposals) : null;
  const baselineSuggestion = simulation ? coverageSummary(assessCoverage(c, state.week, generatePilotSuggestion(c, state.week, state.entries))) : null;
  const simulated = simulation ? coverageSummary(assessCoverage(simulation, state.week, generatePilotSuggestion(simulation, state.week, state.entries))) : null;
  return pageHeading("PREVISIBILIDADE PARA DECIDIR", "Veja onde sua equipe faz falta", "Compare os mínimos cadastrados, o quadro disponível e a cobertura planejada.", `<button class="button secondary" id="open-scenario">${ico("plus")} Simular contratação ou habilitação</button><button class="button primary" id="go-schedule">Planejar semana →</button>`) + weekToolbar() + `<div class="metric-grid">${metric("Quadro ativo", active.length, "Pessoas com vínculo nesta unidade", "users")}${metric("Mínimos atendidos", `${s.met}<small> / ${s.total}</small>`, state.entries.length ? "Conforme a escala carregada" : "Previsão com sugestão ainda não salva", "shield")}${metric("Mínimos a revisar", new Set(s.pending.map((x) => x.rule.id)).size, "Interpretações e condições provisórias", "warning")}${metric("Vagas abertas", c.vacancies.reduce((n, v) => n + v.quantity, 0), "Não entram na capacidade disponível", "plus")}</div>
 ${!c.settings.operationConfirmed || !c.settings.policyReviewed ? `<div class="rule-banner">${ico("warning")}<div><strong>Premissas iniciais para o teste</strong><p>Os horários e o perfil de jornada precisam de revisão do gerente. A previsão considera somente os mínimos cadastrados; dias sem mínimo não significam demanda zero.</p></div><button class="text-button" id="review-operation">Revisar →</button></div>` : ""}
 ${!state.entries.length ? '<p class="pilot-caption">Previsão baseada em uma sugestão calculada para esta semana. Abra Escalas para ajustar e salvar o rascunho.</p>' : ""}
 <section class="content-card pilot-section"><div class="section-caption"><div><h2>Capacidade por setor e função</h2><p class="fine-print">Habilitados podem aparecer em mais de uma função; não some essas colunas como pessoas diferentes.</p></div><select id="sector-filter" aria-label="Filtrar setor"><option value="all">Todos os setores</option>${options(c.sectors, state.sector)}</select></div><div class="table-scroll"><table class="simple-table inventory-table"><thead><tr><th>Setor / função</th><th>Função principal</th><th>Habilitados</th><th>Sábado disponível / mínimo</th><th>Domingo disponível / mínimo</th><th>Leitura do quadro</th></tr></thead><tbody>${f.inventory.filter((r) => state.sector === "all" || r.sectorId === state.sector).map((r) => {
    const critical = r.minimum.some((min, i) => min !== null && r.weekendAvailable[i] <= min);
    return `<tr><th><strong>${h(r.sector)}</strong><small class="cell-note">${h(r.role)}</small></th><td>${r.primary}${r.vacancies ? `<small class="cell-note">+ ${r.vacancies} vaga(s) aberta(s)</small>` : ""}</td><td>${r.qualified}</td>${[0, 1].map((i) => `<td>${r.weekendAvailable[i]} / ${r.minimum[i] ?? "a definir"}</td>`).join("")}<td>${pill(critical ? "Pouca ou nenhuma reserva" : "Conferir distribuição", critical ? "warning" : "")}<small class="cell-note">Disponibilidade cadastral, antes dos turnos.</small></td></tr>`;
  }).join("") || '<tr><td colspan="6" class="empty-state">Cadastre a equipe e as necessidades desta unidade.</td></tr>'}</tbody></table></div></section>
 <section class="content-card pilot-section"><div class="section-caption"><div><h2>Cobertura dos mínimos cadastrados</h2><p class="fine-print">Quantidade diária conta pessoas distintas no dia. A cobertura por faixa desconta os intervalos dos funcionários e desconsidera o fechamento da unidade durante o dia.</p></div><button class="text-button" id="requirements-link">Manter mínimos →</button></div><div class="table-scroll"><table class="simple-table"><thead><tr><th>Dia</th><th>Setor / função</th><th>Critério</th><th>Previsto / mínimo</th><th>Situação</th></tr></thead><tbody>${results.map((r) => `<tr><td>${WEEKDAYS[dayOf(r.date)]}<small class="cell-note">${dateLabel(r.date)}</small></td><th>${h(requirementName(r.rule))}</th><td>${r.rule.mode === "daily" ? "Pessoas no dia" : r.rule.mode === "opening" ? "Responsável na abertura" : "Presença simultânea"}${r.rule.mode !== "daily" ? `<small class="cell-note">${time(r.rule.start_time)}–${time(r.rule.end_time)}</small>` : ""}</td><td><strong>${r.suspended ? "—" : r.actual} / ${r.minimum}</strong>${r.missingHours ? `<small class="cell-note">${r.missingHours.toLocaleString("pt-BR")} h-pessoa descobertas</small>` : ""}</td><td>${pill(r.suspended ? "Unidade fechada nesta faixa" : r.missing ? `Faltam ${r.missing}` : "Mínimo atendido", r.suspended ? "" : r.missing ? "warning" : "published")}${r.closureHours && !r.suspended ? '<small class="cell-note">Fechamento durante o dia desconsiderado</small>' : ""}${!r.rule.confirmed ? '<small class="cell-note">Regra provisória</small>' : ""}</td></tr>`).join("") || '<tr><td colspan="5" class="empty-state">Nenhum mínimo configurado para este período.</td></tr>'}</tbody></table></div></section>
 <section class="content-card pilot-section scenario-section"><div class="section-caption"><div><h2>Simular antes de contratar</h2><p class="fine-print">Comparamos duas sugestões preservando os mesmos turnos fixados. A simulação não altera o cadastro nem a escala; habilitações exigem confirmação antes do uso real.</p></div><button class="button secondary" id="add-scenario">Adicionar hipótese +</button></div>${state.proposals.length ? `<div class="scenario-comparison"><div><span>Sugestão com quadro atual</span><strong>${baselineSuggestion.met} / ${baselineSuggestion.total}</strong><small>Mínimos atendidos</small></div><span>→</span><div><span>Com a hipótese</span><strong>${simulated.met} / ${simulated.total}</strong><small>Mínimos atendidos na sugestão</small></div></div><ul class="scenario-list">${state.proposals.map((p, i) => `<li><span>${p.type === "qualification" ? `Habilitar ${h(c.assignments.find((a) => a.id === p.assignment_id)?.person.name || "pessoa")}` : `${p.quantity} reforço(s) de ${p.weekly_hours}h`} · ${h(sectorName(p.sector_id))} / ${h(roleName(p.role_id))}</span><button class="text-button" data-remove-scenario="${i}">Remover</button></li>`).join("")}</ul><div class="pilot-inline-actions"><button class="button primary" id="save-scenario" ${manager() ? "" : "disabled"}>Salvar cenário</button><button class="button secondary" id="clear-scenario">Limpar hipóteses</button></div>` : '<p class="empty-state">Experimente adicionar um reforço no açougue ou avaliar uma habilitação em outra função.</p>'}<div class="saved-scenarios">${data.scenarios.filter((s2) => s2.unit_id === state.unitId).map((s2) => `<button class="button secondary" data-load-scenario="${s2.id}">${h(s2.name)}</button>`).join("")}</div></section>`;
}
function bindCoverage() {
  bindWeek();
  document.querySelector("#sector-filter").onchange = (e) => {
    state.sector = e.target.value;
    render();
  };
  document.querySelector("#go-schedule").onclick = () => {
    state.view = "schedule";
    render();
  };
  document.querySelector("#requirements-link").onclick = () => {
    state.view = "requirements";
    render();
  };
  document.querySelector("#review-operation")?.addEventListener("click", () => {
    state.view = "settings";
    render();
  });
  for (const id of ["open-scenario", "add-scenario"]) document.querySelector("#" + id).onclick = scenarioModal;
  document.querySelectorAll("[data-remove-scenario]").forEach((b) => b.onclick = () => {
    state.proposals.splice(Number(b.dataset.removeScenario), 1);
    render();
  });
  document.querySelector("#clear-scenario")?.addEventListener("click", () => {
    state.proposals = [];
    render();
  });
  document.querySelectorAll("[data-load-scenario]").forEach((b) => b.onclick = () => {
    state.proposals = structuredClone(data.scenarios.find((s) => s.id === b.dataset.loadScenario).proposal);
    render();
  });
  document.querySelector("#save-scenario")?.addEventListener("click", () => {
    if (!mayChange()) return;
    showModal("CENÁRIO DE QUADRO", "Salvar hipótese", `<form id="scenario-save">${field("Nome do cenário", "name", "", "text", 'required maxlength="100"')}${actions("Salvar cenário")}</form>`);
    bindForm("scenario-save", async (values) => {
      await mutate(ctx(), "scenarios", { name: values.name, proposal: state.proposals });
      modal.close();
      await refresh();
      notify("Cenário salvo sem alterar o quadro real.");
    });
  });
}
function scenarioModal() {
  const c = ctx();
  showModal("PREVISÃO DO QUADRO", "Adicionar hipótese", `<form id="scenario-form">${select("Tipo de hipótese", "type", '<option value="hire">Contratar reforço</option><option value="qualification">Habilitar pessoa em outra função</option>')}<div class="form-grid">${select("Setor", "sector_id", options(c.sectors))}${select("Função", "role_id", options(c.roles))}</div><div id="hire-fields" class="form-grid">${field("Quantidade de pessoas", "quantity", 1, "number", 'min="1" max="10" required')}${field("Horas semanais por pessoa", "weekly_hours", 40, "number", 'min="1" max="44" required')}</div><div id="qualification-fields" hidden>${select("Pessoa a habilitar", "assignment_id", options(c.assignments.filter((a) => a.active && a.person.active), null, (a) => a.person.name))}</div>${select("Turno preferencial do reforço", "preferred_shift_id", options(c.shifts, null, (s) => `${s.name} · ${time(s.start_time)}–${time(s.end_time)}`))}<p class="fine-print">A previsão considera as demais restrições cadastradas. Um cenário favorável não substitui a validação da habilidade ou da necessidade de contratação.</p>${actions("Comparar hipótese")}</form>`);
  document.querySelector('[name="type"]').onchange = (e) => {
    document.querySelector("#hire-fields").hidden = e.target.value !== "hire";
    document.querySelector("#qualification-fields").hidden = e.target.value !== "qualification";
  };
  bindForm("scenario-form", async (values) => {
    state.proposals.push({ ...values, quantity: Number(values.quantity), weekly_hours: Number(values.weekly_hours) });
    modal.close();
    render();
  });
}
function scheduleView() {
  const c = scheduleContext(), personName2 = (id) => c.assignments.find((a) => a.person_id === id)?.person?.name || "Pessoa", roleName2 = (id) => c.roles.find((r) => r.id === id)?.name || "Função", dates = weekDates(state.week), people = c.assignments.filter((a) => a.active && a.person?.active !== false && (!a.starts_on || a.starts_on <= addDays(state.week, 6)) && (!a.ends_on || a.ends_on >= state.week) && (state.sector === "all" || a.sector_id === state.sector) && personName2(a.person_id).toLowerCase().includes(state.search.toLowerCase()));
  const visible = people.slice(state.page * 10, state.page * 10 + 10);
  const entries = locked() ? state.publication?.snapshot.entries || state.entries : state.entries;
  const issues = locked() ? state.publication?.snapshot.issues || [] : validatePlan(ctx(), state.week, entries);
  const blocks = issues.filter((i) => i.level === "block");
  return pageHeading("DA PREVISÃO À ESCALA", "Organize a semana da equipe", "Ajuste turnos e funções. Salve o rascunho antes da revisão final.", `${locked() ? `<button class="button secondary" id="revise-plan" ${manager() ? "" : "disabled"}>Criar revisão</button>` : `<button class="button secondary" id="generate-plan" ${manager() ? "" : "disabled"}>Gerar sugestão</button><button class="button primary" id="save-plan" ${manager() ? "" : "disabled"}>${state.dirty ? "Salvar alterações" : "Salvar rascunho"}</button>`}`) + weekToolbar() + `<div class="pilot-plan-status">${pill(locked() ? `Publicada · versão ${state.schedule.published_version}` : state.dirty ? "Rascunho com alterações não salvas" : state.schedule ? "Rascunho salvo" : "Semana ainda não salva", locked() ? "published" : "")}<span>${blocks.length} impedimento(s) no perfil configurado</span><button class="text-button" id="export-plan">Exportar CSV ↓</button></div>${locked() ? '<div class="success-note">Esta tela apresenta os turnos da versão publicada. Uma revisão preserva a cópia anterior no histórico.</div>' : ""}<section class="content-card"><div class="schedule-toolbar pilot-table-tools"><label class="search-field"><span>⌕</span><input id="person-search" aria-label="Buscar pessoa" value="${h(state.search)}" placeholder="Buscar pessoa"></label><select id="plan-sector" aria-label="Setor da escala"><option value="all">Todos os setores</option>${options(c.sectors, state.sector)}</select></div><div class="table-scroll"><table class="schedule-table pilot-schedule"><thead><tr><th class="person-col">PESSOA / FUNÇÃO</th>${dates.map((d) => `<th><span>${WEEKDAYS[dayOf(d)].toUpperCase()}</span><strong>${d.slice(8)}</strong></th>`).join("")}<th class="hours-col">TOTAL</th></tr></thead><tbody>${visible.map((a) => `<tr><th><div class="person"><span><strong>${h(personName2(a.person_id))}</strong><small>${h(roleName2(a.role_id))}</small></span></div></th>${dates.map((d) => {
    const e = entries.find((e2) => e2.assignment_id === a.id && e2.work_date === d), bad = issues.some((i) => i.personId === a.person_id && i.date === d && i.level === "block");
    return `<td><button class="shift ${e?.kind === "work" ? "day" : e?.kind === "absence" ? "leave" : "off"} ${bad ? "conflict" : ""}" data-edit-entry="${a.id}:${d}" ${locked() || !manager() ? "disabled" : ""} aria-label="${h(personName2(a.person_id))}, ${dateLabel(d)}, ${e?.kind === "work" ? time(e.start_time) + " às " + time(e.end_time) : e?.kind === "off" ? "Folga" : e?.kind === "absence" ? "Ausência" : "Definir turno"}"><strong>${e?.kind === "work" ? `${time(e.start_time)}–${time(e.end_time)}` : e?.kind === "off" ? "Folga" : e?.kind === "absence" ? "Ausência" : "Definir"}</strong>${e?.kind === "work" ? `<small>${time(e.break_start)}–${time(e.break_end)} intervalo</small><small>${h(roleName2(e.role_id))}${e.locked ? " · fixado" : ""}</small>` : ""}</button></td>`;
  }).join("")}<td class="hours-cell"><strong>${entries.filter((e) => e.assignment_id === a.id).reduce((s, e) => s + workHours(e), 0).toLocaleString("pt-BR")}h</strong><small>/ ${a.person?.weekly_hours || 40}h</small></td></tr>`).join("") || '<tr><td colspan="9" class="empty-state">Nenhuma pessoa para estes filtros.</td></tr>'}</tbody></table></div><div class="table-footer"><span class="fine-print">Turnos fixados são preservados ao gerar outra sugestão.</span><div class="pagination"><span>${people.length} pessoas · página ${state.page + 1}</span><button class="icon-button" id="person-prev" ${state.page ? "" : "disabled"} aria-label="Página anterior">‹</button><button class="icon-button" id="person-next" ${(state.page + 1) * 10 < people.length ? "" : "disabled"} aria-label="Próxima página">›</button></div></div></section><section class="content-card pilot-section"><div class="section-caption"><h2>Revisão da semana</h2><button class="button primary" id="publish-plan" ${locked() || !manager() ? "disabled" : ""}>Revisar e publicar →</button></div><div class="pilot-issues">${issues.slice(0, 12).map((i) => `<article class="issue"><span class="issue-label">${i.level === "block" ? "IMPEDIMENTO" : "AVISO"}</span><strong>${h(i.message)}</strong><small>${i.personId ? h(personName2(i.personId)) : ""}${i.date ? " · " + dateLabel(i.date) : ""}</small>${i.detail ? `<p>${h(i.detail)}</p>` : ""}</article>`).join("") || '<div class="success-note">Nenhum impedimento encontrado nas checagens configuradas.</div>'}</div>${issues.length > 12 ? `<p class="fine-print">Mostrando 12 de ${issues.length} ocorrências. A revisão final verifica todas no servidor.</p>` : ""}<p class="fine-print">As regras contratuais, legais e coletivas precisam de validação do responsável. O sistema verifica o perfil configurado e não certifica conformidade jurídica.</p></section>`;
}
function bindSchedule() {
  bindWeek();
  document.querySelector("#plan-sector").onchange = (e) => {
    state.sector = e.target.value;
    state.page = 0;
    render();
  };
  document.querySelector("#person-search").oninput = (e) => {
    const v = e.target.value, pos = e.target.selectionStart;
    state.search = v;
    state.page = 0;
    render();
    const input = document.querySelector("#person-search");
    input.focus();
    input.setSelectionRange(pos, pos);
  };
  document.querySelector("#person-prev").onclick = () => {
    state.page--;
    render();
  };
  document.querySelector("#person-next").onclick = () => {
    state.page++;
    render();
  };
  document.querySelectorAll("[data-edit-entry]").forEach((b) => b.onclick = () => {
    const [assignment, date] = b.dataset.editEntry.split(":");
    entryModal(assignment, date);
  });
  document.querySelector("#generate-plan")?.addEventListener("click", () => {
    if (!mayChange()) return;
    showModal("SUGESTÃO ASSISTIDA", "Recalcular esta semana?", `<p>A sugestão considera funções habilitadas, ausências, disponibilidades e o perfil de jornada. Turnos fixados serão preservados. Revise as lacunas que permanecerem.</p><div class="modal-actions"><button class="button secondary" data-close>Voltar</button><button class="button primary" id="confirm-generation">Gerar sugestão</button></div>`);
    document.querySelector("#confirm-generation").onclick = () => {
      state.entries = generatePilotSuggestion(ctx(), state.week, state.entries);
      state.dirty = true;
      state.forecastCache = null;
      modal.close();
      render();
      notify("Sugestão calculada. Confira os turnos e salve o rascunho.");
    };
  });
  document.querySelector("#save-plan")?.addEventListener("click", () => task(async () => {
    await savePlan();
    notify("Rascunho salvo no Supabase.");
  }));
  document.querySelector("#publish-plan").onclick = () => task(publicationModal);
  document.querySelector("#revise-plan")?.addEventListener("click", () => {
    showModal("HISTÓRICO PRESERVADO", "Abrir revisão", `<form id="revision-form">${field("Motivo da revisão", "reason", "", "text", 'required minlength="3" maxlength="500"')}${actions("Criar revisão")}</form>`);
    bindForm("revision-form", async (v) => {
      await rpc("revise_schedule", { p_schedule: state.schedule.id, p_revision: state.schedule.revision, p_reason: v.reason });
      modal.close();
      await loadWeek();
      render();
      notify("Revisão aberta. A versão anterior está preservada.");
    });
  });
  document.querySelector("#export-plan").onclick = exportPlan;
}
async function savePlan() {
  if (!mayChange()) throw new Error("Sem permissão para salvar.");
  if (locked()) throw new Error("Abra uma revisão antes de salvar.");
  const result = await rpc("save_schedule", { p_unit: state.unitId, p_week: state.week, p_revision: state.schedule?.revision || 0, p_unit_revision: ctx().unit.revision, p_entries: state.entries, p_reason: "" });
  state.schedule = Array.isArray(result) ? result[0] : result;
  state.dirty = false;
  await loadWeek();
  render();
}
function entryModal(assignmentId, date) {
  if (!mayChange() || locked()) return;
  const c = ctx(), a = c.assignments.find((a2) => a2.id === assignmentId), entry = state.entries.find((e) => e.assignment_id === assignmentId && e.work_date === date) || emptyEntry(a, date);
  const bindings = [{ sector_id: a.sector_id, role_id: a.role_id }, ...c.qualifications.filter((q) => q.assignment_id === a.id && (!q.valid_until || q.valid_until >= date))];
  showModal(dateLabel(date, { weekday: "long", day: "2-digit", month: "long" }).toUpperCase(), "Ajustar turno", `<p><strong>${h(a.person.name)}</strong></p><form id="entry-form">${select("Situação do dia", "kind", `<option value="work" ${entry.kind === "work" ? "selected" : ""}>Trabalho</option><option value="off" ${entry.kind === "off" ? "selected" : ""}>Folga</option><option value="absence" ${entry.kind === "absence" ? "selected" : ""}>Ausência</option>`)}${select("Função exercida no turno", "binding", bindings.map((b) => `<option value="${b.sector_id}:${b.role_id}" ${entry.sector_id === b.sector_id && entry.role_id === b.role_id ? "selected" : ""}>${h(sectorName(b.sector_id))} · ${h(roleName(b.role_id))}</option>`).join(""))}${select("Preencher pelo modelo", "template", `<option value="">Personalizado</option>${options(c.shifts, null, (s) => `${s.name} · ${time(s.start_time)}–${time(s.end_time)}`)}`)}<div class="form-grid">${field("Entrada", "start_time", time(entry.start_time) || "07:00", "time", "required")}${field("Saída", "end_time", time(entry.end_time) || "16:00", "time", "required")}${field("Início do intervalo", "break_start", time(entry.break_start) || "11:00", "time", "required")}${field("Fim do intervalo", "break_end", time(entry.break_end) || "12:00", "time", "required")}</div>${checkbox("Fixar este dia para preservar ao gerar uma nova sugestão", "locked", entry.locked)}<p class="fine-print">Uma ausência registrada no cadastro continua bloqueando trabalho, mesmo que este turno seja alterado.</p>${actions("Aplicar no rascunho")}</form>`);
  document.querySelector('[name="template"]').onchange = (e) => {
    const s = c.shifts.find((s2) => s2.id === e.target.value);
    if (s) for (const key of ["start_time", "end_time", "break_start", "break_end"]) document.querySelector(`[name="${key}"]`).value = time(s[key]);
  };
  const f = document.querySelector("#entry-form");
  const toggle = () => {
    for (const name of ["start_time", "end_time", "break_start", "break_end"]) f.elements[name].disabled = f.elements.kind.value !== "work";
  };
  f.elements.kind.onchange = toggle;
  toggle();
  bindForm("entry-form", async (values) => {
    const [sector_id, role_id] = values.binding.split(":");
    const e = { ...entry, assignment_id: a.id, person_id: a.person_id, work_date: date, kind: values.kind, sector_id, role_id, locked: !!values.locked, start_time: null, end_time: null, break_start: null, break_end: null };
    if (values.kind === "work") {
      if (!(values.start_time < values.break_start && values.break_start < values.break_end && values.break_end < values.end_time)) throw new Error("Informe horários válidos, com o intervalo dentro do turno.");
      Object.assign(e, { start_time: values.start_time, end_time: values.end_time, break_start: values.break_start, break_end: values.break_end });
    }
    state.entries = state.entries.filter((x) => !(x.assignment_id === a.id && x.work_date === date));
    state.entries.push(e);
    state.dirty = true;
    state.forecastCache = null;
    modal.close();
    render();
  });
}
async function publicationModal() {
  if (!mayChange()) return;
  if (state.dirty || !state.schedule) await savePlan();
  const issues = await rpc("schedule_issues", { p_schedule: state.schedule.id }), blocks = issues.filter((i) => i.level === "block");
  showModal("VALIDAÇÃO NO SERVIDOR", "Revisar e publicar", `<p>Publicação da semana de ${dateLabel(state.week)} em <strong>${h(ctx().unit.name)}</strong>.</p><div class="${blocks.length ? "inline-alert" : "success-note"}">${blocks.length ? `${blocks.length} impedimento(s) precisam de correção.` : "Nenhum impedimento encontrado no perfil configurado."}</div><div class="all-issues">${issues.map((i) => `<article class="issue"><strong>${h(i.message)}</strong><small>${i.personId ? h(personName(i.personId)) : ""}${i.date ? " · " + dateLabel(i.date) : ""}</small>${i.detail ? `<p>${h(i.detail)}</p>` : ""}</article>`).join("")}</div><form id="publish-form">${checkbox("Revisei os avisos operacionais, as premissas provisórias e a cobertura desta versão.", "ack")}<p class="fine-print">O histórico registra esta publicação do piloto. Nenhuma mensagem será enviada aos funcionários. A validação não substitui a revisão das regras legais e coletivas.</p><div class="form-error" role="alert"></div><div class="modal-actions"><button type="button" class="button secondary" data-close>Voltar</button><button class="button primary" ${blocks.length ? "disabled" : ""} type="submit">Publicar versão</button></div></form>`, true);
  bindForm("publish-form", async (v) => {
    if (!v.ack) throw new Error("Revise e confirme os avisos antes de publicar.");
    await rpc("publish_schedule", { p_schedule: state.schedule.id, p_revision: state.schedule.revision, p_unit_revision: ctx().unit.revision, p_ack_warnings: true });
    modal.close();
    await loadWeek();
    render();
    notify("Versão publicada e preservada no histórico.");
  });
}
function teamView() {
  const c = ctx(), rows = c.assignments.filter((a) => (state.sector === "all" || a.sector_id === state.sector) && a.person.name.toLowerCase().includes(state.search.toLowerCase()));
  return pageHeading("BASE REAL DA UNIDADE", "Pessoas, funções e disponibilidades", "Mantenha o quadro atual e as habilidades que podem apoiar outras funções.", `<button class="button secondary" id="import-people" ${manager() ? "" : "disabled"}>Importar CSV / AFD</button><button class="button primary" id="add-person" ${manager() ? "" : "disabled"}>Cadastrar pessoa +</button>`) + `<section class="content-card"><div class="schedule-toolbar pilot-table-tools"><label class="search-field"><input id="team-search" placeholder="Buscar pessoa" aria-label="Buscar pessoa" value="${h(state.search)}"></label><select id="team-sector" aria-label="Filtrar setor"><option value="all">Todos os setores</option>${options(c.sectors, state.sector)}</select></div><div class="table-scroll"><table class="simple-table"><thead><tr><th>Pessoa</th><th>Setor / função principal</th><th>Jornada</th><th>Disponibilidade</th><th>Situação</th><th>Ações</th></tr></thead><tbody>${rows.slice(state.page * 15, state.page * 15 + 15).map((a) => `<tr><th>${h(a.person.name)}<small class="cell-note">${a.person.external_id ? "Identificador ·•••" + h(a.person.external_id.slice(-4)) : "Identificador a conciliar"}</small></th><td>${h(sectorName(a.sector_id))}<small class="cell-note">${h(roleName(a.role_id))}${a.can_open ? " · abertura" : ""}</small></td><td>${a.person.weekly_hours}h${!a.person.contract_confirmed ? '<small class="cell-note">A confirmar</small>' : ""}</td><td>${a.weekdays.map((d) => WEEKDAYS[d]).join(", ")}<small class="cell-note">${a.scheduling_mode === "fixed" ? "Horário fixo" : "Escala variável"}</small></td><td>${pill(a.active && a.person.active ? "Ativo" : "Inativo", a.active && a.person.active ? "published" : "")}</td><td><button class="text-button" data-person="${a.id}">Ver / editar</button></td></tr>`).join("") || '<tr><td colspan="6" class="empty-state">Nenhuma pessoa encontrada.</td></tr>'}</tbody></table></div><div class="table-footer"><span class="fine-print">${c.assignments.filter((a) => a.active && a.person.active).length} pessoas ativas · vagas abertas são mantidas separadamente.</span><div class="pagination"><button class="icon-button" id="team-prev" ${state.page ? "" : "disabled"} aria-label="Página anterior">‹</button><span>Página ${state.page + 1}</span><button class="icon-button" id="team-next" ${(state.page + 1) * 15 < rows.length ? "" : "disabled"} aria-label="Próxima página">›</button></div></div></section>`;
}
function bindTeam() {
  document.querySelector("#team-search").oninput = (e) => {
    const position = e.target.selectionStart;
    state.search = e.target.value;
    state.page = 0;
    render();
    const field2 = document.querySelector("#team-search");
    field2.focus();
    field2.setSelectionRange(position, position);
  };
  document.querySelector("#team-sector").onchange = (e) => {
    state.sector = e.target.value;
    state.page = 0;
    render();
  };
  document.querySelector("#team-prev").onclick = () => {
    state.page--;
    render();
  };
  document.querySelector("#team-next").onclick = () => {
    state.page++;
    render();
  };
  document.querySelectorAll("[data-person]").forEach((b) => b.onclick = () => personModal(b.dataset.person));
  document.querySelector("#add-person").onclick = () => personModal();
  document.querySelector("#import-people").onclick = importModal;
}
function dayChecks(selected) {
  return `<fieldset class="day-checks"><legend>Dias disponíveis</legend>${WEEKDAYS.map((name, i) => `<label><input type="checkbox" name="day-${i}" ${selected.includes(i) ? "checked" : ""}>${name}</label>`).join("")}</fieldset>`;
}
function personModal(assignmentId) {
  const c = ctx(), a = c.assignments.find((a2) => a2.id === assignmentId), p = a?.person, disabled = !manager();
  if (!c.sectors.length || !c.roles.length) {
    notify("Cadastre ao menos um setor e uma função em Operação e cadastros.");
    return;
  }
  showModal("CADASTRO DA EQUIPE", a ? "Dados e habilitações" : "Cadastrar pessoa", `<form id="person-form"><fieldset ${disabled ? "disabled" : ""}>${field("Nome", "name", p?.name || "", "text", 'required maxlength="100"')}${field("Matrícula ou identificador a conciliar", "external_id", p?.external_id || "", "text", 'maxlength="40"')}<div class="form-grid">${select("Setor principal", "sector_id", options(c.sectors, a?.sector_id))}${select("Função principal", "role_id", options(c.roles, a?.role_id))}${field("Horas semanais contratuais", "weekly_hours", p?.weekly_hours || 40, "number", 'min="1" max="44" step="0.5" required')}${select("Modo de planejamento", "scheduling_mode", `<option value="variable" ${a?.scheduling_mode !== "fixed" ? "selected" : ""}>Escala variável</option><option value="fixed" ${a?.scheduling_mode === "fixed" ? "selected" : ""}>Horário fixo</option>`)}</div>${select("Turno preferencial", "preferred_shift_id", options(c.shifts, a?.preferred_shift_id, (s) => `${s.name} · ${time(s.start_time)}–${time(s.end_time)}`, "Sem preferência"))}${dayChecks(a?.weekdays || [0, 1, 2, 3, 4, 5, 6])}<div class="form-grid">${field("Início do vínculo na unidade", "starts_on", a?.starts_on || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10), "date", "required")}${field("Fim do vínculo (opcional)", "ends_on", a?.ends_on || "", "date")}</div>${checkbox("Pode assumir a abertura da loja", "can_open", a?.can_open)}${checkbox("Jornada contratual conferida com o responsável", "contract_confirmed", p?.contract_confirmed)}${checkbox("Vínculo ativo nesta unidade", "active", a ? a.active : true)}<label>Observações da operação<textarea name="notes" maxlength="1500">${h(a?.notes || "")}</textarea></label></fieldset>${disabled ? '<p class="fine-print">Seu perfil permite somente consulta.</p>' : actions(a ? "Salvar dados" : "Cadastrar pessoa")}</form>${a ? `<section class="modal-subsection"><h3>Habilitações adicionais</h3>${c.qualifications.filter((q) => q.assignment_id === a.id).map((q) => `<p>${h(sectorName(q.sector_id))} · ${h(roleName(q.role_id))}${q.valid_until ? " · até " + dateLabel(q.valid_until) : ""} ${manager() ? `<button class="text-button" data-remove-skill="${q.id}">Remover</button>` : ""}</p>`).join("") || '<p class="fine-print">Nenhuma habilitação adicional cadastrada.</p>'}${manager() ? `<button class="button secondary" id="add-skill">Adicionar habilitação</button><button class="button secondary" id="add-absence">Registrar ausência</button>` : ""}<h3>Ausências registradas</h3>${c.absences.filter((x) => x.assignment_id === a.id).map((x) => `<p>${h(x.kind)} · ${dateLabel(x.starts_on)} a ${dateLabel(x.ends_on)} ${manager() ? `<button class="text-button" data-remove-absence="${x.id}">Remover</button>` : ""}</p>`).join("") || '<p class="fine-print">Nenhuma ausência registrada.</p>'}</section>` : ""}`, true);
  if (!disabled) bindForm("person-form", async (v) => {
    const weekdays = WEEKDAYS.map((_, i) => i).filter((i) => v["day-" + i]);
    if (!weekdays.length) throw new Error("Informe ao menos um dia disponível.");
    await rpc("save_employee", { p_unit: state.unitId, p_revision: ctx().unit.revision, p_assignment: a?.id || null, p_person: { name: v.name, external_id: v.external_id || null, weekly_hours: Number(v.weekly_hours), contract_confirmed: !!v.contract_confirmed }, p_details: { sector_id: v.sector_id, role_id: v.role_id, preferred_shift_id: v.preferred_shift_id || null, weekdays, scheduling_mode: v.scheduling_mode, can_open: !!v.can_open, active: !!v.active, notes: v.notes, starts_on: v.starts_on, ends_on: v.ends_on || null } });
    modal.close();
    await refresh();
    notify("Cadastro salvo. Recalcule a previsão e revise as escalas afetadas.");
  });
  document.querySelector("#add-skill")?.addEventListener("click", () => qualificationModal(a));
  document.querySelector("#add-absence")?.addEventListener("click", () => absenceModal(a));
  document.querySelectorAll("[data-remove-skill]").forEach((b) => b.onclick = () => task(async () => {
    await mutate(ctx(), "qualifications", { id: b.dataset.removeSkill }, true);
    await refresh();
    personModal(a.id);
  }));
  document.querySelectorAll("[data-remove-absence]").forEach((b) => b.onclick = () => task(async () => {
    await mutate(ctx(), "absences", { id: b.dataset.removeAbsence }, true);
    await refresh();
    personModal(a.id);
  }));
}
function qualificationModal(a) {
  showModal("HABILITAÇÃO CONFIRMADA", "Adicionar função habilitada", `<p>${h(a.person.name)}</p><form id="skill-form"><div class="form-grid">${select("Setor", "sector_id", options(ctx().sectors))}${select("Função", "role_id", options(ctx().roles))}</div>${field("Validade (opcional)", "valid_until", "", "date")}${checkbox("Confirmei que a pessoa está apta e autorizada para esta função.", "confirmed")}${actions("Salvar habilitação")}</form>`);
  bindForm("skill-form", async (v) => {
    if (!v.confirmed) throw new Error("Confirme a habilitação antes de salvar.");
    await mutate(ctx(), "qualifications", { assignment_id: a.id, sector_id: v.sector_id, role_id: v.role_id, valid_until: v.valid_until || null });
    await refresh();
    personModal(a.id);
  });
}
function absenceModal(a) {
  showModal("DISPONIBILIDADE DA EQUIPE", "Registrar ausência", `<p>${h(a.person.name)}</p><form id="absence-form">${field("Descrição operacional", "kind", "Indisponibilidade", "text", 'required maxlength="100"')}<div class="form-grid">${field("Primeiro dia", "starts_on", state.week, "date", "required")}${field("Último dia", "ends_on", state.week, "date", "required")}</div><p class="fine-print">Registre somente a informação necessária ao planejamento, sem diagnóstico ou documentos médicos.</p>${actions("Salvar ausência")}</form>`);
  bindForm("absence-form", async (v) => {
    await mutate(ctx(), "absences", { assignment_id: a.id, ...v });
    await refresh();
    personModal(a.id);
  });
}
function requirementsView() {
  const c = ctx();
  return pageHeading("NECESSIDADE DA OPERAÇÃO", "Mínimos por função e setor", "Configure pessoas por dia, presença simultânea e responsabilidade de abertura.", `<button class="button primary" id="add-requirement" ${manager() ? "" : "disabled"}>Adicionar mínimo +</button>`) + `<section class="content-card"><div class="table-scroll"><table class="simple-table"><thead><tr><th>Setor / função</th><th>Dias / vigência</th><th>Critério</th><th>Mínimo</th><th>Revisão</th><th>Ações</th></tr></thead><tbody>${c.requirements.map((r) => `<tr><th>${h(requirementName(r))}<small class="cell-note">${h(r.review_note || r.source_note)}</small></th><td>${r.on_date ? dateLabel(r.on_date) : r.weekdays.map((d) => WEEKDAYS[d]).join(", ")}<small class="cell-note">Desde ${dateLabel(r.effective_from)}${r.effective_until ? " até " + dateLabel(r.effective_until) : ""}</small></td><td>${r.mode === "daily" ? "Pessoas no dia" : r.mode === "opening" ? "Abertura" : "Simultâneo"}${r.mode !== "daily" ? `<small class="cell-note">${time(r.start_time)}–${time(r.end_time)}</small>` : ""}</td><td>${r.minimum}</td><td>${pill(r.confirmed ? "Confirmado" : "Provisório", r.confirmed ? "published" : "warning")}<small class="cell-note">${r.blocking && r.confirmed ? "Impede publicação se descoberto" : "Exige revisão se descoberto"}</small></td><td><button class="text-button" data-requirement="${r.id}">Ver / editar</button></td></tr>`).join("") || '<tr><td colspan="6" class="empty-state">Nenhum mínimo cadastrado. Dias sem informação permanecem a definir.</td></tr>'}</tbody></table></div></section><div class="session-note">Exceções por data podem substituir uma regra recorrente. Mínimos de setor e função são avaliados separadamente, sem somar duas vezes a mesma exigência.</div>`;
}
function bindRequirements() {
  document.querySelector("#add-requirement").onclick = () => requirementModal();
  document.querySelectorAll("[data-requirement]").forEach((b) => b.onclick = () => requirementModal(b.dataset.requirement));
}
function requirementModal(id) {
  const c = ctx(), r = c.requirements.find((r2) => r2.id === id);
  if (!mayChange()) return;
  showModal("COBERTURA DA OPERAÇÃO", r ? "Revisar mínimo" : "Novo mínimo", `<form id="requirement-form"><div class="form-grid">${select("Setor", "sector_id", options(c.sectors, r?.sector_id))}${select("Função", "role_id", options(c.roles, r?.role_id, "name", "Total de pessoas do setor"))}${select("Tipo de cobertura", "mode", `<option value="daily" ${r?.mode === "daily" ? "selected" : ""}>Pessoas distintas no dia</option><option value="simultaneous" ${r?.mode === "simultaneous" ? "selected" : ""}>Pessoas disponíveis simultaneamente</option><option value="opening" ${r?.mode === "opening" ? "selected" : ""}>Responsável habilitado para abertura</option>`)}${field("Quantidade mínima", "minimum", r?.minimum ?? 1, "number", 'required min="0" max="100"')}</div>${dayChecks(r?.weekdays || [5, 6])}<div class="form-grid">${field("Início da faixa (simultâneo / abertura)", "start_time", time(r?.start_time) || "07:00", "time")}${field("Fim da faixa", "end_time", time(r?.end_time) || "07:30", "time")}${field("Vigência a partir de", "effective_from", r?.effective_from || state.week, "date", "required")}${field("Vigência até (opcional)", "effective_until", r?.effective_until || "", "date")}${field("Somente nesta data (opcional)", "on_date", r?.on_date || "", "date")}${select("Substitui a regra nesta data", "overrides_id", options(c.requirements.filter((x) => !x.on_date && x.id !== r?.id), r?.overrides_id, (x) => `${requirementName(x)} · ${x.minimum}`, "Não substitui outra regra"))}</div><label>Origem / orientação do gestor<textarea name="source_note" maxlength="1500">${h(r?.source_note || "Orientação do gerente")}</textarea></label><label>O que ainda precisa ser conferido<textarea name="review_note" maxlength="1500">${h(r?.review_note || "")}</textarea></label>${checkbox("Quantidade, composição e interpretação confirmadas com o responsável.", "confirmed", r?.confirmed)}${checkbox("Bloquear publicação quando este mínimo confirmado não for atendido.", "blocking", r?.blocking)}<p class="fine-print">Uma regra provisória sempre aparece como informação a revisar. Para preservar histórico, prefira encerrar a vigência de uma regra antiga.</p>${actions("Salvar mínimo")}</form>`, true);
  bindForm("requirement-form", async (v) => {
    const weekdays = WEEKDAYS.map((_, i) => i).filter((i) => v["day-" + i]);
    if (!v.on_date && !weekdays.length) throw new Error("Informe os dias da regra.");
    if (v.mode !== "daily" && !(v.start_time < v.end_time)) throw new Error("Informe uma faixa de horário válida.");
    if (v.overrides_id && !v.on_date) throw new Error("Informe a data da exceção.");
    await mutate(ctx(), "coverage_requirements", { ...id ? { id } : {}, sector_id: v.sector_id, role_id: v.role_id || null, weekdays, on_date: v.on_date || null, overrides_id: v.overrides_id || null, mode: v.mode, minimum: Number(v.minimum), start_time: v.mode === "daily" ? null : v.start_time, end_time: v.mode === "daily" ? null : v.end_time, confirmed: !!v.confirmed, blocking: !!v.blocking, effective_from: v.effective_from, effective_until: v.effective_until || null, source_note: v.source_note, review_note: v.review_note });
    modal.close();
    await refresh();
    notify("Mínimo salvo. Confira a cobertura e as escalas afetadas.");
  });
}
function operationDay(day, i, hours) {
  return `<div role="group" aria-label="Funcionamento de ${day}"><strong>${day}</strong>${field("Abertura", "open-" + i, hours.open, "time", "required")}${field("Fechamento do dia", "close-" + i, hours.close, "time", "required")}${checkbox("Fecha durante o dia", "closure-" + i, !!hours.closure)}<div class="day-closure-fields" data-closure-fields="${i}" ${hours.closure ? "" : "hidden"}>${field("Fecha às", "closure-start-" + i, hours.closure?.start || "12:00", "time")}${field("Reabre às", "closure-end-" + i, hours.closure?.end || "13:30", "time")}</div></div>`;
}
function syncClosureFields() {
  const form = document.querySelector("#operation-form");
  for (let i = 0; i < 7; i++) {
    const enabled = form.elements["closure-" + i].checked;
    form.querySelector(`[data-closure-fields="${i}"]`).hidden = !enabled;
    for (const prefix of ["closure-start-", "closure-end-"]) {
      form.elements[prefix + i].disabled = !enabled;
      form.elements[prefix + i].required = enabled;
    }
  }
}
function settingsView() {
  const c = ctx();
  return pageHeading("PARÂMETROS EDITÁVEIS PELO GERENTE", "Operação e cadastros", "Os valores iniciais são premissas do piloto e podem ser ajustados aqui.", `${owner() ? '<button class="button secondary" id="add-unit">Adicionar unidade +</button>' : ""}`) + `<section class="content-card pilot-section"><h2>Identificação e funcionamento</h2><p class="fine-print">Ative “Fecha durante o dia” somente nos dias com interrupção do atendimento. Nas unidades com funcionamento contínuo, deixe a opção desmarcada. O fechamento da loja não define o intervalo de cada funcionário.</p><form id="operation-form"><fieldset ${manager() ? "" : "disabled"}>${field("Nome da unidade", "name", c.unit.name, "text", 'required maxlength="120"')}<div class="opening-grid">${WEEKDAYS.map((day, i) => operationDay(day, i, c.settings.opening[i])).join("")}</div>${checkbox("Horários de funcionamento conferidos com a operação.", "operationConfirmed", c.settings.operationConfirmed)}<div class="section-caption"><h2>Perfil de jornada para o planejamento</h2></div><div class="form-grid policy-grid">${field("Limite semanal de referência (h)", "weeklyHours", c.settings.policy.weeklyHours, "number", 'required min="1" max="44" step="0.5"')}${field("Limite diário de trabalho (h)", "dailyHours", c.settings.policy.dailyHours, "number", 'required min="1" max="12" step="0.5"')}${field("Descanso entre jornadas (h)", "restHours", c.settings.policy.restHours, "number", 'required min="11" max="48"')}${field("Máximo de dias de trabalho por semana", "maxWorkDays", c.settings.policy.maxWorkDays, "number", 'required min="1" max="6"')}${field("Máximo de dias consecutivos", "maxConsecutive", c.settings.policy.maxConsecutive, "number", 'required min="1" max="6"')}</div>${checkbox("Perfil revisado com o responsável, considerando contratos e instrumentos coletivos aplicáveis.", "policyReviewed", c.settings.policyReviewed)}<p class="fine-print">O piloto ainda não calcula todas as particularidades de domingos, feriados, trabalho noturno e regimes especiais. Esta confirmação registra a revisão do perfil, sem certificar conformidade jurídica.</p></fieldset>${manager() ? actions("Salvar operação") : ""}</form></section>
 <div class="pilot-two-columns"><section class="content-card pilot-section"><div class="section-caption"><h2>Turnos de referência</h2><button class="text-button" id="add-shift" ${manager() ? "" : "disabled"}>Adicionar +</button></div>${c.shifts.map((s) => `<div class="catalog-row"><span><strong>${h(s.name)}</strong><small>${time(s.start_time)}–${time(s.end_time)} · intervalo ${time(s.break_start)}–${time(s.break_end)}</small></span><button class="text-button" data-shift="${s.id}">Editar</button></div>`).join("") || '<p class="fine-print">Cadastre ao menos um turno para gerar sugestões.</p>'}</section><section class="content-card pilot-section"><div class="section-caption"><h2>Setores da unidade</h2><button class="text-button" id="add-sector" ${manager() ? "" : "disabled"}>Adicionar +</button></div>${c.sectors.map((s) => `<div class="catalog-row"><strong>${h(s.name)}${s.active ? "" : " · inativo"}</strong><button class="text-button" data-sector="${s.id}">Editar</button></div>`).join("")}</section><section class="content-card pilot-section"><div class="section-caption"><h2>Catálogo de funções da rede</h2><button class="text-button" id="add-role" ${manager() ? "" : "disabled"}>Adicionar +</button></div>${c.roles.map((r) => `<div class="catalog-row"><strong>${h(r.name)}</strong>${owner() ? `<button class="text-button" data-role="${r.id}">Editar</button>` : ""}</div>`).join("")}</section><section class="content-card pilot-section"><div class="section-caption"><h2>Vagas abertas</h2><button class="text-button" id="add-vacancy" ${manager() ? "" : "disabled"}>Adicionar +</button></div>${data.vacancies.filter((v) => v.unit_id === state.unitId).map((v) => `<div class="catalog-row"><span><strong>${v.quantity} · ${h(roleName(v.role_id))}</strong><small>${h(sectorName(v.sector_id))} · ${v.status === "open" ? "Aberta" : v.status === "filled" ? "Preenchida" : "Cancelada"}</small></span><button class="text-button" data-vacancy="${v.id}">Editar</button></div>`).join("") || '<p class="fine-print">Nenhuma vaga cadastrada.</p>'}</section></div>`;
}
function bindSettings() {
  syncClosureFields();
  document.querySelectorAll('#operation-form input[name^="closure-"][type="checkbox"]').forEach((input) => input.addEventListener("change", syncClosureFields));
  document.querySelector("#operation-form [data-close]")?.addEventListener("click", () => {
    document.querySelector("#operation-form").reset();
    syncClosureFields();
  });
  if (manager()) bindForm("operation-form", async (v) => {
    const opening = Object.fromEntries(WEEKDAYS.map((_, i) => [i, { open: v["open-" + i], close: v["close-" + i], closure: v["closure-" + i] ? { start: v["closure-start-" + i], end: v["closure-end-" + i] } : null }]));
    validateOpeningHours(opening);
    const policy = {};
    for (const key of ["weeklyHours", "dailyHours", "restHours", "maxWorkDays", "maxConsecutive"]) policy[key] = Number(v[key]);
    await mutate(ctx(), "units", { id: state.unitId, name: v.name, settings: { ...ctx().settings, opening, policy, operationConfirmed: !!v.operationConfirmed, policyReviewed: !!v.policyReviewed } });
    await refresh();
    notify("Horários e perfil de planejamento salvos.");
  });
  document.querySelector("#add-unit")?.addEventListener("click", unitModal);
  document.querySelector("#add-shift").onclick = () => shiftModal();
  document.querySelectorAll("[data-shift]").forEach((b) => b.onclick = () => shiftModal(b.dataset.shift));
  document.querySelector("#add-sector").onclick = () => catalogModal("sectors");
  document.querySelector("#add-role").onclick = () => catalogModal("job_roles");
  document.querySelectorAll("[data-sector]").forEach((b) => b.onclick = () => catalogModal("sectors", b.dataset.sector));
  document.querySelectorAll("[data-role]").forEach((b) => b.onclick = () => catalogModal("job_roles", b.dataset.role));
  document.querySelector("#add-vacancy").onclick = () => vacancyModal();
  document.querySelectorAll("[data-vacancy]").forEach((b) => b.onclick = () => vacancyModal(b.dataset.vacancy));
}
function shiftModal(id) {
  if (!mayChange()) return;
  const s = data.shift_templates.find((s2) => s2.id === id);
  showModal("HORÁRIOS DE REFERÊNCIA", s ? "Editar turno" : "Novo turno", `<form id="shift-template-form">${field("Nome do turno", "name", s?.name || "", "text", 'required maxlength="100"')}<div class="form-grid">${field("Entrada", "start_time", time(s?.start_time) || "07:00", "time", "required")}${field("Saída", "end_time", time(s?.end_time) || "16:00", "time", "required")}${field("Início do intervalo", "break_start", time(s?.break_start) || "11:00", "time", "required")}${field("Fim do intervalo", "break_end", time(s?.break_end) || "12:00", "time", "required")}</div>${checkbox("Turno disponível para novas sugestões", "active", s ? s.active : true)}<p class="fine-print">Alterar este modelo afeta novas sugestões. Turnos já salvos ou publicados preservam seus horários.</p>${actions("Salvar turno")}</form>`);
  bindForm("shift-template-form", async (v) => {
    if (!(v.start_time < v.break_start && v.break_start < v.break_end && v.break_end < v.end_time)) throw new Error("Informe horários válidos, com o intervalo dentro do turno.");
    await mutate(ctx(), "shift_templates", { ...id ? { id } : {}, name: v.name, start_time: v.start_time, end_time: v.end_time, break_start: v.break_start, break_end: v.break_end, active: !!v.active });
    modal.close();
    await refresh();
    notify("Modelo de turno salvo.");
  });
}
function catalogModal(table, id) {
  if (!mayChange()) return;
  const r = data[table].find((x) => x.id === id);
  showModal("CADASTRO DA OPERAÇÃO", table === "sectors" ? "Setor da unidade" : "Função da rede", `<form id="catalog-form">${field("Nome", "name", r?.name || "", "text", 'required maxlength="100"')}${table === "sectors" ? checkbox("Setor ativo", "active", r ? r.active : true) : '<p class="fine-print">O catálogo é compartilhado entre as unidades da mesma rede.</p>'}${actions()}</form>`);
  bindForm("catalog-form", async (v) => {
    await mutate(ctx(), table, { ...id ? { id } : {}, name: v.name, ...table === "sectors" ? { active: !!v.active } : {} });
    modal.close();
    await refresh();
    notify("Cadastro salvo.");
  });
}
function vacancyModal(id) {
  if (!mayChange()) return;
  const v = data.vacancies.find((v2) => v2.id === id);
  showModal("PLANEJAMENTO DO QUADRO", v ? "Editar vaga" : "Registrar vaga", `<form id="vacancy-form"><div class="form-grid">${select("Setor", "sector_id", options(ctx().sectors, v?.sector_id))}${select("Função", "role_id", options(ctx().roles, v?.role_id))}${field("Quantidade", "quantity", v?.quantity || 1, "number", 'required min="1" max="100"')}${select("Situação", "status", `<option value="open" ${v?.status === "open" ? "selected" : ""}>Aberta</option><option value="filled" ${v?.status === "filled" ? "selected" : ""}>Preenchida</option><option value="cancelled" ${v?.status === "cancelled" ? "selected" : ""}>Cancelada</option>`)}</div><label>Observações<textarea name="notes" maxlength="1500">${h(v?.notes || "")}</textarea></label><p class="fine-print">Uma vaga preenchida não cria funcionário automaticamente. Cadastre ou vincule a pessoa real na equipe.</p>${actions("Salvar vaga")}</form>`);
  bindForm("vacancy-form", async (values) => {
    await mutate(ctx(), "vacancies", { ...id ? { id } : {}, ...values, quantity: Number(values.quantity) });
    modal.close();
    await refresh();
  });
}
function unitModal() {
  showModal("EXPANSÃO DA REDE", "Adicionar unidade", `<form id="unit-form">${field("Nome da unidade", "name", "", "text", 'required maxlength="120"')}${field("Código na rede", "code", "", "text", 'required maxlength="30"')}<p class="fine-print">A nova unidade começa com horários iniciais editáveis, sem copiar funcionários, mínimos ou regras da unidade piloto.</p>${actions("Criar unidade")}</form>`);
  bindForm("unit-form", async (v) => {
    const id = await rpc("create_unit", { p_network: ctx().unit.network_id, p_name: v.name, p_code: v.code });
    state.unitId = id;
    modal.close();
    await refresh();
    notify("Unidade criada. Cadastre setores, turnos e mínimos próprios.");
  });
}
function accessView() {
  return pageHeading("ACESSO POR REDE E UNIDADE", "Quem pode planejar e consultar", "Libere o e-mail do gerente e compartilhe o link do piloto. Cada pessoa define sua própria senha.", `<button class="button primary" id="grant-access">Liberar acesso +</button>`) + `<section class="content-card pilot-section"><p class="fine-print">O acesso exige conta com e-mail confirmado. Liberar um e-mail aqui não envia convite automaticamente. O envio de confirmação para usuários externos depende do provedor de e-mail configurado no Supabase.</p><div id="access-list" class="access-list">Carregando acessos…</div></section>`;
}
function bindAccess() {
  document.querySelector("#grant-access").onclick = () => accessModal();
  (async () => {
    try {
      const { data: rows, error } = await supabase.from("access_invites").select("*").eq("network_id", ctx().unit.network_id).order("created_at");
      if (error) throw error;
      const target = document.querySelector("#access-list");
      if (!target) return;
      target.innerHTML = `<table class="simple-table"><thead><tr><th>E-mail</th><th>Unidade</th><th>Perfil</th><th>Situação</th><th>Ações</th></tr></thead><tbody>${rows.map((r) => `<tr><th>${h(r.email)}</th><td>${r.unit_id ? h(data.units.find((u) => u.id === r.unit_id)?.name || "Unidade") : "Toda a rede"}</td><td>${r.role === "owner" ? "Administrador" : r.role === "manager" ? "Gerente" : "Consulta"}</td><td>${r.revoked ? "Revogado" : r.accepted_at ? "Ativado" : "Aguardando primeiro acesso"}</td><td><button class="text-button" data-edit-access="${r.id}">Editar</button></td></tr>`).join("")}</tbody></table>`;
      target.querySelectorAll("[data-edit-access]").forEach((b) => b.onclick = () => accessModal(rows.find((r) => r.id === b.dataset.editAccess)));
    } catch (e) {
      notify(niceError(e));
    }
  })();
}
function accessModal(r) {
  showModal("PERMISSÕES DO PILOTO", r ? "Editar acesso" : "Liberar acesso", `<form id="access-form">${field("E-mail", "email", r?.email || "", "email", `required maxlength="200" ${r ? "readonly" : ""}`)}${select("Perfil", "role", `${r?.role === "owner" ? "" : `<option value="manager" ${r?.role === "manager" ? "selected" : ""}>Gerente da unidade</option><option value="viewer" ${r?.role === "viewer" ? "selected" : ""}>Consulta da unidade</option>`}${!r || r.role === "owner" ? `<option value="owner" ${r?.role === "owner" ? "selected" : ""}>Administrador da rede</option>` : ""}`)}${select("Unidade (gerente ou consulta)", "unit_id", options(data.units, r?.unit_id || state.unitId), " " + (r ? "disabled" : ""))}${checkbox("Revogar este acesso", "revoked", r?.revoked)}<p class="fine-print">A liberação é registrada na base. Compartilhe o link por seu canal habitual; nenhum e-mail é enviado por esta ação.</p>${actions("Salvar acesso")}</form>`);
  bindForm("access-form", async (v) => {
    await rpc("set_access", { p_network: ctx().unit.network_id, p_unit: v.role === "owner" ? null : r?.unit_id || v.unit_id, p_email: r?.email || v.email, p_role: v.role, p_revoke: !!v.revoked });
    modal.close();
    await refresh();
    notify("Permissões atualizadas.");
  });
}
function historyView() {
  return pageHeading("DECISÕES RASTREÁVEIS", "Histórico da unidade", "Confira alterações e versões publicadas. Os nomes dos responsáveis ficam vinculados aos seus acessos.") + `<section class="content-card pilot-section"><div class="section-caption"><h2>Versões da semana de ${dateLabel(state.week)}</h2></div><div id="versions-list">Carregando versões…</div></section><section class="content-card pilot-section"><h2>Atividade recente</h2><div id="events-list">Carregando atividade…</div></section>`;
}
async function fillHistory() {
  try {
    const [events, versions] = await Promise.all([recentHistory(state.unitId), state.schedule ? publicationHistory(state.schedule.id) : []]);
    if (state.view !== "history") return;
    document.querySelector("#versions-list").innerHTML = versions.map((v) => `<div class="catalog-row"><span><strong>Versão ${v.version}</strong><small>${new Date(v.published_at).toLocaleString("pt-BR", { timeZone: ctx().unit.timezone })}</small></span><button class="text-button" data-export-version="${v.id}">Baixar CSV</button></div>`).join("") || '<p class="empty-state">Ainda não há publicação nesta semana.</p>';
    document.querySelectorAll("[data-export-version]").forEach((b) => b.onclick = () => exportSnapshot(versions.find((v) => v.id === b.dataset.exportVersion)));
    const entities = { people: "Pessoa", unit_assignments: "Vínculo", coverage_requirements: "Mínimo de cobertura", units: "Operação", shift_templates: "Turno", absences: "Ausência", qualifications: "Habilitação", schedules: "Escala", vacancies: "Vaga", memberships: "Permissão", access_invites: "Liberação de acesso", scenarios: "Cenário" };
    const action = { INSERT: "cadastrado", UPDATE: "atualizado", DELETE: "removido", save: "rascunho salvo", publish: "versão publicada", revise: "revisão aberta" };
    document.querySelector("#events-list").innerHTML = `<ul class="activity-list">${events.map((e) => `<li><span class="activity-dot"></span><div><strong>${entities[e.entity] || h(e.entity)} · ${action[e.action] || h(e.action)}</strong><small>${new Date(e.created_at).toLocaleString("pt-BR", { timeZone: ctx().unit.timezone })} · ${e.actor_id === user?.id ? "Você" : e.actor_id ? "Usuário autorizado" : "Carga inicial"}</small>${e.details.reason ? `<small>${h(e.details.reason)}</small>` : ""}</div></li>`).join("")}</ul>`;
  } catch (e) {
    notify(niceError(e));
  }
}
function download(name, content) {
  const url = URL.createObjectURL(new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8" })), a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1e3);
}
function rowsCSV(entries, lookupPerson = personName, lookupRole = roleName, lookupSector = sectorName) {
  const rows = [["pessoa", "data", "setor", "funcao", "situacao", "entrada", "saida", "intervalo_inicio", "intervalo_fim"], ...entries.map((e) => [lookupPerson(e.person_id), e.work_date, lookupSector(e.sector_id), lookupRole(e.role_id), e.kind, time(e.start_time), time(e.end_time), time(e.break_start), time(e.break_end)])];
  return rows.map((r) => r.map(csvCell).join(";")).join("\r\n");
}
function exportPlan() {
  if (locked() && state.publication) return exportSnapshot(state.publication);
  const e = locked() ? state.publication?.snapshot.entries || state.entries : state.entries;
  download(`escala-${ctx().unit.code}-${state.week}.csv`, rowsCSV(e));
}
function exportSnapshot(version) {
  const s = version.snapshot;
  download(`escala-${state.week}-versao-${version.version}.csv`, rowsCSV(s.entries, (id) => s.people.find((p) => p.id === id)?.name || "Pessoa", (id) => s.roles.find((p) => p.id === id)?.name || "Função", (id) => s.sectors.find((p) => p.id === id)?.name || "Setor"));
}
function importModal() {
  if (!mayChange()) return;
  showModal("CADASTROS DO RELÓGIO", "Importar funcionários", `<p>CSV ou AFD legado com cadastros. O RB1 ainda exige conversão compatível. O arquivo é lido nesta aba; somente os registros confirmados são gravados na base.</p><form id="import-form">${select("Setor inicial dos registros", "sector_id", options(ctx().sectors))}${select("Função inicial dos registros", "role_id", options(ctx().roles))}<label>Arquivo CSV ou AFD TXT<input type="file" id="pilot-import-file" accept=".csv,.txt,.rb1" required></label><p class="fine-print">Use importações por grupo ou ajuste as funções após importar. A jornada entra provisoriamente como 40h quando ausente. Registros já existentes na rede são ignorados; nomes iguais não são unidos automaticamente.</p><div id="import-preview"></div><div class="form-error" role="alert"></div><div class="modal-actions"><button type="button" class="button secondary" data-close>Cancelar</button><button class="button primary" type="submit" id="import-submit" disabled>Confirmar importação</button></div></form>`, true);
  let records = [];
  document.querySelector("#pilot-import-file").onchange = async (event) => {
    const f = event.target.files[0], error = document.querySelector("#import-form .form-error"), preview = document.querySelector("#import-preview"), submit = document.querySelector("#import-submit");
    records = [];
    submit.disabled = true;
    error.textContent = "";
    try {
      if (!f) return;
      if (f.size > 5 * 1024 * 1024) throw new Error("Não é permitido arquivo maior que 5 MB.");
      if (/\.rb1$/i.test(f.name)) throw new Error("Não há leitor RB1 validado. Use CSV ou AFD legado; nenhum cadastro foi importado.");
      const bytes = new Uint8Array(await f.arrayBuffer());
      if (bytes.includes(0)) throw new Error("Informe arquivo de texto, sem conteúdo binário.");
      let text;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        text = new TextDecoder("windows-1252").decode(bytes);
      }
      const parsed = /\.csv$/i.test(f.name) ? parseCSV(text) : parseAFD(text);
      if (parsed.length > 500) throw new Error("Informe até 500 cadastros por arquivo.");
      const seen = /* @__PURE__ */ new Set();
      let skipped = 0;
      for (const r of parsed) {
        if (!r.name || !r.externalId || r.name.length > 100 || r.externalId.length > 40) throw new Error("Informe nome e identificador válidos em todos os registros.");
        if (seen.has(r.externalId) || data.people.some((p) => p.external_id === r.externalId)) {
          skipped++;
          continue;
        }
        if (r.weeklyHours !== null && (!Number.isFinite(r.weeklyHours) || r.weeklyHours <= 0 || r.weeklyHours > 44)) throw new Error("Informe jornada entre 1 e 44 horas ou deixe a jornada a confirmar.");
        seen.add(r.externalId);
        records.push(r);
      }
      preview.innerHTML = `<div class="import-counts"><span><strong>${records.length}</strong> novos</span><span><strong>${skipped}</strong> ignorados</span></div><div class="preview-table-wrap"><table class="simple-table"><thead><tr><th>Pessoa</th><th>Jornada inicial</th></tr></thead><tbody>${records.map((r) => `<tr><th>${h(r.name)}</th><td>${r.weeklyHours || 40}h · a confirmar</td></tr>`).join("")}</tbody></table></div>`;
      submit.disabled = !records.length;
    } catch (e) {
      error.textContent = niceError(e);
    }
  };
  bindForm("import-form", async (values, form) => {
    if (!records.length) return;
    const result = await rpc("import_people", { p_unit: state.unitId, p_file: form.querySelector('input[type="file"]').files[0].name, p_rows: records.map((r) => ({ name: r.name, external_id: r.externalId, weekly_hours: r.weeklyHours || 40, sector_id: values.sector_id, role_id: values.role_id })) });
    modal.close();
    await refresh();
    notify(`${result.imported} cadastro(s) importado(s); ${result.skipped} ignorado(s). Confira os dados da equipe.`);
  });
}
function renderNoAccess() {
  app.innerHTML = `<div class="pilot-auth"><section class="auth-story"><a class="brand" href="./index.html"><span class="brand-mark">t<span>·</span></span><span>turno.</span></a><h1>Planejamento com acesso responsável.</h1><p>O cadastro da operação fica disponível somente para as pessoas autorizadas pela rede.</p></section><section class="auth-panel" id="main"><span class="tag">ACESSO AO PILOTO</span><h2>Acesso ainda não liberado</h2><p>A conta ${h(user?.email || "")} está conectada, mas não possui unidade autorizada. Peça ao administrador para liberar esse e-mail.</p><button class="button primary" id="retry-access">Verificar novamente</button><button class="button secondary" id="leave-access">Sair da conta</button><a class="text-button" href="./demo.html">Conhecer a demo fictícia →</a></section></div>`;
  document.querySelector("#retry-access").onclick = () => task(() => refresh());
  document.querySelector("#leave-access").onclick = async () => {
    await supabase.auth.signOut();
    user = null;
    data = null;
    renderAuth();
  };
}
function renderAuth(message = "") {
  const mode = state.authMode;
  app.innerHTML = `<div class="pilot-auth"><section class="auth-story"><a class="brand" href="./index.html"><span class="brand-mark">t<span>·</span></span><span>turno<span class="brand-dot">.</span></span></a><div class="auth-story-body"><span class="tag">PLANEJAMENTO DA OPERAÇÃO</span><h1>Entenda seu quadro.<br>Prepare a próxima semana.</h1><p>Veja a cobertura por setor e função, compare hipóteses de reforço e monte escalas com critérios claros.</p><div class="auth-highlights"><span>✓ Cobertura por função</span><span>✓ Horários editáveis</span><span>✓ Histórico de decisões</span></div></div><small>Piloto com dados protegidos · Rede e unidades com acesso definido</small></section><section class="auth-panel" id="main"><span class="tag">BEM-VINDO AO PILOTO</span><h2>${mode === "signup" ? "Ative seu primeiro acesso" : mode === "reset" ? "Recupere seu acesso" : mode === "recovery" ? "Defina uma nova senha" : "Entre para planejar"}</h2><p>${mode === "signup" ? "Use o e-mail liberado pelo administrador. A confirmação do e-mail é necessária para acessar os dados." : mode === "reset" ? "Enviaremos um link de recuperação para o e-mail da conta." : mode === "recovery" ? "Escolha uma senha exclusiva para esta conta." : "Acesse a unidade autorizada e continue seu planejamento."}</p><form id="auth-form">${mode !== "recovery" ? field("E-mail", "email", "", "email", 'required autocomplete="email" maxlength="200"') : ""}${mode !== "reset" ? field(mode === "recovery" ? "Nova senha" : "Senha", "password", "", "password", `required ${mode === "signup" || mode === "recovery" ? 'minlength="12"' : ""} autocomplete="${mode === "signup" || mode === "recovery" ? "new-password" : "current-password"}"`) : ""}<div class="form-error" role="alert">${h(message)}</div><button class="button primary full" type="submit">${mode === "signup" ? "Criar meu acesso" : mode === "reset" ? "Enviar recuperação" : mode === "recovery" ? "Salvar nova senha" : "Entrar"}</button></form>${mode === "login" ? '<div class="auth-links"><button class="text-button" data-auth="signup">Primeiro acesso</button><button class="text-button" data-auth="reset">Esqueci minha senha</button></div>' : '<div class="auth-links"><button class="text-button" data-auth="login">Voltar para entrar</button></div>'}<div class="auth-demo"><strong>Quer conhecer o fluxo?</strong><p>A demo usa dados fictícios e pode ser aberta sem conta.</p><a class="button secondary full" href="./demo.html">Abrir demonstração →</a></div></section></div>`;
  document.querySelectorAll("[data-auth]").forEach((b) => b.onclick = () => {
    state.authMode = b.dataset.auth;
    renderAuth();
  });
  bindForm("auth-form", async (v) => {
    const redirect = new URL("./index.html", location.href).href;
    let result;
    if (mode === "signup") {
      result = await supabase.auth.signUp({ email: v.email, password: v.password, options: { emailRedirectTo: redirect } });
      if (result.error) throw result.error;
      renderAuth("Solicitação recebida. Confira seu e-mail para confirmar a conta e depois entre.");
    } else if (mode === "reset") {
      result = await supabase.auth.resetPasswordForEmail(v.email, { redirectTo: redirect });
      if (result.error) throw result.error;
      renderAuth("Se houver uma conta elegível, você receberá o link de recuperação.");
    } else if (mode === "recovery") {
      result = await supabase.auth.updateUser({ password: v.password });
      if (result.error) throw result.error;
      state.authMode = "login";
      notify("Senha atualizada.");
      await initializeSession();
    } else {
      result = await supabase.auth.signInWithPassword({ email: v.email, password: v.password });
      if (result.error) throw result.error;
      await initializeSession();
    }
  });
}
async function initializeSession() {
  const serial = ++authSerial;
  try {
    const { data: session, error } = await supabase.auth.getSession();
    if (error) throw error;
    user = session.session?.user || null;
    if (!user) {
      data = null;
      renderAuth();
      return;
    }
    if (state.authMode === "recovery") {
      renderAuth();
      return;
    }
    app.innerHTML = '<div class="pilot-loading"><span class="brand-mark">t·</span><p>Carregando sua unidade…</p></div>';
    const loaded = await loadPilot();
    if (serial !== authSerial) return;
    data = loaded;
    const units = data.units.filter((u) => u.active);
    if (!units.length) {
      renderNoAccess();
      return;
    }
    state.unitId = units.some((u) => u.id === state.unitId) ? state.unitId : units[0].id;
    await loadWeek();
    if (serial === authSerial) render();
  } catch (error) {
    app.innerHTML = `<div class="pilot-loading"><h2>Não foi possível carregar o piloto</h2><p>${h(niceError(error))}</p><button class="button primary" id="retry-load">Tentar novamente</button><button class="button secondary" id="retry-logout">Sair da conta</button></div>`;
    document.querySelector("#retry-load").onclick = initializeSession;
    document.querySelector("#retry-logout").onclick = async () => {
      await supabase.auth.signOut();
      user = null;
      data = null;
      renderAuth();
    };
  }
}
supabase.auth.onAuthStateChange((event) => {
  if (event === "PASSWORD_RECOVERY") {
    state.authMode = "recovery";
    setTimeout(() => renderAuth(), 0);
  }
  if (event === "SIGNED_OUT") {
    authSerial++;
    user = null;
    data = null;
    state.entries = [];
    state.proposals = [];
    state.dirty = false;
    renderAuth();
  }
});
await initializeSession();
