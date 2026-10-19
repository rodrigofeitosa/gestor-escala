import { SECTORS, SHIFTS, POLICY, makeDemo, addDays, weekDates, generateWeek, validateWeek, coverage, workedHours, parseAFD, parseCSV, prepareImport, escapeHTML as h, csvCell } from './core.mjs';

const icons = {
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M16 3v4M8 3v4M3 11h18m-13 4h2m4 0h2"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/><circle cx="9" cy="7" r="4"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M3 15v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4"/>',
  shield: '<path d="M12 22s9-4 9-11V5l-9-3-9 3v6c0 7 9 11 9 11Z"/><path d="m8 12 3 3 5-6"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/>',
  warning: '<path d="m10.3 3.9-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3.1l-8-14a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4m0 4h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M3 16v3a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3"/>',
  store: '<path d="m3 9 2-6h14l2 6M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M4 12v9h16v-9M9 21v-7h6v7"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 8a2.5 2.5 0 1 1 4 2c-1.5 1-1.5 1.5-1.5 3m0 3h.01"/>',
  search: '<circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 5 5"/>',
  print: '<path d="M6 9V3h12v6M6 18H3v-7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v7h-3M6 14h12v7H6z"/>',
  reset: '<path d="M3 11a9 9 0 1 1 2.5 7M3 4v7h7"/>'
};
const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.calendar}</svg>`;
const app = document.querySelector('#app');
const modal = document.querySelector('#modal');
let data = makeDemo();
let state = { view: 'schedule', storeId: '1', week: '2026-10-19', sector: 'all', search: '', page: 0, preview: null, importName: '', importError: '', importStoreId: '1', tourSeen: false };
let focusBeforeModal;
const formatDate = (date, options = { day: '2-digit', month: 'short' }) => new Intl.DateTimeFormat('pt-BR', { ...options, timeZone: 'UTC' }).format(new Date(date + 'T12:00:00Z'));
const currentStore = () => data.stores.find(s => s.id === state.storeId);
const team = () => data.employees.filter(e => e.storeId === state.storeId);
const publicationKey = () => `${state.storeId}:${state.week}`;
const publication = () => data.publications[publicationKey()];
const locked = () => !!publication() && !publication().editing;
const allIssues = () => validateWeek(team(), data.schedule, state.week);
const filteredTeam = () => team().filter(e => (state.sector === 'all' || e.sector === state.sector) && e.name.toLocaleLowerCase('pt-BR').includes(state.search.toLocaleLowerCase('pt-BR')));
const initials = name => name.split(' ').map(s => s[0]).slice(0, 2).join('');
function toast(message) {
  const target = document.querySelector('#toast'); target.textContent = message; target.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => target.classList.remove('show'), 4500);
}
function setView(view) { state.view = view; state.search = ''; state.page = 0; render(); document.querySelector('#main').focus(); }
function history(text) { data.history.unshift({ storeId: state.storeId, date: new Date().toISOString(), text }); }
function openModal(content, wide = false) {
  focusBeforeModal = document.activeElement;
  modal.className = wide ? 'wide' : ''; modal.innerHTML = content;
  if (!modal.open) modal.showModal();
  modal.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => modal.close()));
}
modal.addEventListener('close', () => { if (focusBeforeModal?.isConnected) focusBeforeModal.focus(); });
modal.addEventListener('click', event => { if (event.target === modal) { const rect = modal.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) modal.close(); } });
const modalHeader = (eyebrow, title) => `<div class="modal-header"><div><div class="eyebrow">${eyebrow}</div><h2 id="modal-title">${title}</h2></div><button class="icon-button" data-close aria-label="Fechar janela">${icon('close')}</button></div>`;
function shell() {
  const navs = [['overview', 'grid', 'Visão geral'], ['schedule', 'calendar', 'Escalas'], ['employees', 'users', 'Equipe'], ['import', 'upload', 'Importar equipe'], ['rules', 'shield', 'Regras do piloto']];
  return `<aside class="sidebar"><a href="#" class="brand" data-view="schedule"><span class="brand-mark">t<span>·</span></span><span>turno<span class="brand-dot">.</span></span></a><div class="workspace"><span class="workspace-icon">${icon('store')}</span><div><strong>Rede demonstração</strong><small>3 lojas · 320 pessoas na base inicial</small></div></div><div class="nav-caption">ESPAÇO DE TRABALHO</div><nav aria-label="Navegação principal">${navs.map(([view, glyph, title]) => `<button data-view="${view}" class="nav-item ${state.view === view ? 'active' : ''}" ${state.view === view ? 'aria-current="page"' : ''}>${icon(glyph)}<span>${title}</span>${view === 'schedule' ? '<span class="nav-dot"></span>' : ''}</button>`).join('')}</nav><div class="sidebar-bottom"><div class="pilot-card"><span class="pilot-orbit">${icon('spark')}</span><strong>Vamos testar o fluxo?</strong><p>Um roteiro simples para apresentar ao cliente.</p><button data-action="tour">Abrir roteiro ${icon('arrow')}</button></div><button class="sidebar-reset" data-action="reset">${icon('reset')} Reiniciar demonstração</button><div class="profile"><span class="avatar">DG</span><div><strong>Demo de gestão</strong><small>Visão do gerente</small></div><span class="profile-dot"></span></div></div></aside><div class="workspace-main"><header class="topbar"><div class="breadcrumb">OPERAÇÃO <span>/</span> ${state.view === 'schedule' ? 'PLANEJAMENTO' : navs.find(n => n[0] === state.view)?.[2].toUpperCase()}</div><div class="topbar-right"><span class="demo-badge"><span></span> AMBIENTE DEMO</span><button class="icon-button help-button" data-action="tour" aria-label="Abrir roteiro da demonstração">${icon('help')}</button></div></header><main id="main" tabindex="-1"></main><footer class="app-footer"><span>Turno · Piloto de experiência</span><span>Dados desta aba · Recarregar reinicia a demo</span></footer></div>`;
}
function render() {
  app.innerHTML = shell();
  const main = document.querySelector('#main');
  main.innerHTML = ({ schedule: scheduleView, overview: overviewView, employees: employeesView, import: importView, rules: rulesView }[state.view])();
  bindCommon();
  ({ schedule: bindSchedule, overview: bindOverview, employees: bindEmployees, import: bindImport, rules: () => {} }[state.view])();
}
function bindCommon() {
  app.querySelectorAll('[data-view]').forEach(el => el.addEventListener('click', e => { e.preventDefault(); setView(el.dataset.view); }));
  app.querySelectorAll('[data-action="tour"]').forEach(el => el.addEventListener('click', tour));
  document.querySelector('[data-action="reset"]')?.addEventListener('click', () => {
    openModal(`${modalHeader('COMEÇAR DE NOVO', 'Reiniciar a demonstração?')}<p>As alterações e os cadastros importados nesta aba serão descartados. A equipe fictícia e os conflitos de exemplo serão restaurados.</p><div class="modal-actions"><button class="button secondary" data-close>Voltar</button><button class="button primary" id="confirm-reset">Reiniciar demo</button></div>`);
    document.querySelector('#confirm-reset').onclick = () => { data = makeDemo(); state = { ...state, view: 'schedule', storeId: '1', week: '2026-10-19', sector: 'all', page: 0, search: '', preview: null, importError: '', importName: '' }; modal.close(); render(); toast('Demonstração reiniciada.'); };
  });
  document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => modal.close());
}
const storeSelect = () => `<label class="store-select">${icon('store')}<span class="sr-only">Loja</span><select id="store-select" aria-label="Loja">${data.stores.map(s => `<option value="${s.id}" ${s.id === state.storeId ? 'selected' : ''}>${s.subtitle} · ${s.name.replace('Loja ', '')}</option>`).join('')}</select></label>`;
const sectorOptions = () => `<option value="all">Todos os setores</option>${SECTORS.map(s => `<option ${state.sector === s ? 'selected' : ''}>${s}</option>`).join('')}`;
function bindFilters() {
  document.querySelector('#store-select')?.addEventListener('change', e => { state.storeId = e.target.value; state.page = 0; state.sector = 'all'; state.search = ''; render(); });
  document.querySelector('#sector-filter')?.addEventListener('change', e => { state.sector = e.target.value; state.page = 0; render(); });
  document.querySelector('#team-search')?.addEventListener('input', e => {
    state.search = e.target.value; state.page = 0;
    const position = e.target.selectionStart; render(); const input = document.querySelector('#team-search'); input.focus(); input.setSelectionRange(position, position);
  });
}
function scheduleView() {
  const employees = filteredTeam(), issues = allIssues(), dates = weekDates(state.week), days = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB', 'DOM'];
  const cov = coverage(team(), data.schedule, state.week, state.sector), uncovered = cov.reduce((sum, d) => sum + d.shortageHours, 0);
  const ready = team().filter(e => e.ready).length, plannedHours = team().reduce((sum, e) => sum + workedHours(data.schedule[e.id], state.week), 0);
  const pageSize = 8, pageCount = Math.max(1, Math.ceil(employees.length / pageSize)); state.page = Math.min(state.page, pageCount - 1);
  const rows = employees.slice(state.page * pageSize, (state.page + 1) * pageSize);
  return `<section class="page-heading"><div><div class="eyebrow">CADA PESSOA, NO SEU TEMPO</div><h1>Planeje uma boa semana<span>.</span></h1><p>Organize a equipe, equilibre as folgas e antecipe os conflitos.</p></div><div class="heading-actions"><button class="button secondary" data-view="import">${icon('upload')} Importar equipe</button><button class="button primary" id="generate" ${locked() ? 'disabled' : ''}>${icon('spark')} Gerar sugestão</button></div></section>
  <div class="flow-strip" aria-label="Etapas do planejamento"><span class="complete"><b>${icon('check')}</b>Preparar equipe</span><i></i><span class="${locked() ? 'complete' : 'current'}"><b>2</b>Montar escala</span><i></i><span><b>3</b>Revisar pendências</span><i></i><span class="${locked() ? 'complete' : ''}"><b>4</b>Publicar</span><button data-action="tour">Ver roteiro ${icon('arrow')}</button></div>
  <div class="metric-grid"><article class="metric"><span class="metric-icon green">${icon('users')}</span><div><span>Equipe da loja</span><strong>${team().length}<small> pessoas</small></strong><p>${ready} com cadastro pronto</p></div></article><article class="metric"><span class="metric-icon blue">${icon('clock')}</span><div><span>Horas planejadas</span><strong>${plannedHours.toLocaleString('pt-BR')}<small> h</small></strong><p>Somente trabalho, sem intervalos</p></div></article><article class="metric"><span class="metric-icon ${issues.length ? 'orange' : 'green'}">${icon(issues.length ? 'warning' : 'shield')}</span><div><span>Revisão do perfil demo</span><strong>${issues.length}<small> impedimento${issues.length === 1 ? '' : 's'}</small></strong><p>${issues.length ? 'Revise antes de publicar' : 'Checagens do piloto atendidas'}</p></div></article><article class="metric"><span class="metric-icon purple">${icon('calendar')}</span><div><span>Cobertura a completar</span><strong>${uncovered.toLocaleString('pt-BR')}<small> h-pessoa</small></strong><p>Mínimos fictícios por setor</p></div></article></div>
  <section class="planning-layout"><div class="schedule-card"><div class="schedule-header"><div class="schedule-title"><h2>Escala semanal</h2><span class="status-pill ${locked() ? 'published' : ''}"><span></span>${locked() ? 'Publicação simulada' : publication() ? 'Em revisão' : 'Rascunho'}</span></div>${storeSelect()}</div><div class="schedule-toolbar"><div class="date-nav"><button class="icon-button" id="prev-week" aria-label="Semana anterior">${icon('chevron', 'flip')}</button><strong>${formatDate(dates[0])} — ${formatDate(dates[6])}<small> ${state.week.slice(0, 4)}</small></strong><button class="icon-button" id="next-week" aria-label="Próxima semana">${icon('chevron')}</button></div><div class="filters"><label class="sr-only" for="sector-filter">Setor</label><select id="sector-filter">${sectorOptions()}</select><label class="search-field">${icon('search')}<input id="team-search" placeholder="Buscar pessoa" aria-label="Buscar pessoa" value="${h(state.search)}"></label></div></div>
  <div class="table-scroll"><table class="schedule-table"><caption class="sr-only">Escala de ${h(currentStore().name)}, semana de ${formatDate(dates[0])}. Selecione um dia para editar.</caption><thead><tr><th scope="col" class="person-col">PESSOA / SETOR</th>${dates.map((d, i) => `<th scope="col" class="${i > 4 ? 'weekend' : ''}"><span>${days[i]}</span><strong>${d.slice(8)}</strong></th>`).join('')}<th scope="col" class="hours-col">TOTAL</th></tr></thead><tbody>${rows.length ? rows.map((e, index) => `<tr><th scope="row"><div class="person"><span class="avatar color-${index % 5}">${h(initials(e.name))}</span><span><strong>${h(e.name)}</strong><small>${h(e.sector || 'Setor a definir')}</small></span></div></th>${dates.map(date => {
    const shift = data.schedule[e.id]?.[date], bad = issues.some(i => i.employeeId === e.id && i.date === date), isLeave = e.leaves?.includes(date);
    return `<td><button class="shift ${shift?.className || 'empty'} ${bad ? 'conflict' : ''}" data-employee="${h(e.id)}" data-date="${date}" ${locked() || !e.ready ? 'disabled' : ''} aria-label="${h(e.name)}, ${formatDate(date)}, ${shift?.start ? shift.start + ' às ' + shift.end : shift?.label || 'Sem turno'}${bad ? ', contém pendência' : ''}">${shift?.start ? `<strong>${shift.start.slice(0, 5)}<span>–</span>${shift.end.slice(0, 5)}</strong><small>${shift.breakStart ? `${shift.breakStart}–${shift.breakEnd} intervalo` : 'Sem intervalo'}</small>` : `<strong>${isLeave ? 'Ausência' : shift?.label || 'Definir'}</strong>${isLeave ? '<small>Indisponível</small>' : ''}`}${bad ? '<span class="conflict-dot" title="Contém pendência">!</span>' : ''}</button></td>`;
  }).join('')}<td class="hours-cell ${workedHours(data.schedule[e.id], state.week) > Math.min(e.weeklyHours || 40, 40) ? 'over' : ''}"><strong>${workedHours(data.schedule[e.id], state.week)}h</strong><small>/ ${e.weeklyHours ?? '—'}h</small></td></tr>`).join('') : '<tr><td colspan="9" class="empty-state">Nenhuma pessoa encontrada para estes filtros.</td></tr>'}</tbody></table></div>
  <div class="table-footer"><div class="legend"><span><i class="early"></i>Abertura</span><span><i class="day"></i>Intermediário</span><span><i class="late"></i>Fechamento</span><span><i class="off"></i>Folga</span></div><div class="pagination"><span>${employees.length ? state.page * pageSize + 1 : 0}–${Math.min((state.page + 1) * pageSize, employees.length)} de ${employees.length}</span><button class="icon-button" id="prev-page" aria-label="Página anterior" ${state.page ? '' : 'disabled'}>${icon('chevron', 'flip')}</button><button class="icon-button" id="next-page" aria-label="Próxima página" ${state.page < pageCount - 1 ? '' : 'disabled'}>${icon('chevron')}</button></div></div>
  <div class="coverage-section"><div class="section-caption"><h3>${icon('users')} Cobertura da operação</h3><button class="text-button" id="coverage-details">Ver horários ${icon('arrow')}</button></div><div class="coverage-days">${cov.map((day, i) => `<button class="coverage-day ${day.shortageSlots ? 'shortage' : 'covered'}" data-coverage="${day.date}"><span>${days[i]}</span><div class="coverage-bars">${day.slots.map(slot => `<i class="${slot.shortage ? 'gap' : ''}" title="${String(Math.floor(slot.minute / 60)).padStart(2, '0')}:${slot.minute % 60 ? '30' : '00'} · ${slot.actual}/${slot.needed}"></i>`).join('')}</div><small>${day.shortageSlots ? `${day.shortageSlots / 2}h com lacunas` : 'Mínimos atendidos'}</small></button>`).join('')}</div><p class="fine-print">Das 8h às 21h · blocos de 30 minutos · intervalos descontados · ${state.sector === 'all' ? 'todos os setores' : h(state.sector)}</p></div></div>
  <aside class="review-panel"><div class="review-panel-heading"><span class="review-symbol">${icon('shield')}</span><span class="tag">REVISÃO ASSISTIDA</span></div><h2>${issues.length ? 'Vamos ajustar<br>os detalhes?' : 'Pronta para<br>a próxima etapa.'}</h2><p>${issues.length ? 'Os conflitos aparecem aqui, com o motivo e um caminho para corrigir.' : 'As checagens demonstrativas foram atendidas. Revise também a cobertura da operação.'}</p><div class="issue-list">${issues.slice(0, 3).map(issue => `<article class="issue"><div class="issue-top"><span class="issue-label">IMPEDIMENTO</span><span>${formatDate(issue.date)}</span></div><strong>${h(issue.title)}</strong><small>${h(issue.name)}</small><p>${h(issue.description)}</p><button class="text-button issue-fix" data-issue="${h(issue.id)}">${issue.code === 'setup' ? 'Completar cadastro' : 'Ajustar turno'} ${icon('arrow')}</button></article>`).join('') || `<div class="success-note">${icon('check')} Sem impedimentos do perfil demo.</div>`}</div>${issues.length > 3 ? `<button class="text-button" id="all-issues">Ver todos os ${issues.length} impedimentos ${icon('arrow')}</button>` : ''}<div class="review-bottom"><span class="fine-print">Perfil de teste: 40h / 2 folgas.<br>Regras coletivas e locais ainda não configuradas.</span><button class="button primary full" id="review-publish">${icon(locked() ? 'plus' : 'arrow')}${locked() ? 'Criar revisão' : 'Revisar e publicar'}</button><button class="text-button full" id="export-schedule">${icon('download')} Exportar escala CSV</button></div></aside></section>
  <div class="session-note">${icon('help')} Esta é uma demonstração de experiência. Publicação e aprovações são simuladas nesta aba; nenhuma mensagem é enviada.</div>`;
}
function bindSchedule() {
  bindFilters();
  document.querySelector('#prev-week').disabled = state.week <= '2026-10-12';
  document.querySelector('#next-week').disabled = state.week >= '2026-11-02';
  document.querySelector('#prev-week').onclick = () => { state.week = addDays(state.week, -7); state.page = 0; render(); };
  document.querySelector('#next-week').onclick = () => { state.week = addDays(state.week, 7); state.page = 0; render(); };
  document.querySelector('#prev-page').onclick = () => { state.page--; render(); };
  document.querySelector('#next-page').onclick = () => { state.page++; render(); };
  document.querySelector('#generate').onclick = confirmGenerate;
  document.querySelectorAll('.shift').forEach(el => el.onclick = () => editShift(el.dataset.employee, el.dataset.date));
  document.querySelectorAll('[data-issue]').forEach(el => el.onclick = () => { const issue = allIssues().find(i => i.id === el.dataset.issue); if (issue) issue.code === 'setup' ? editEmployee(issue.employeeId) : editShift(issue.employeeId, issue.date); });
  document.querySelector('#all-issues')?.addEventListener('click', issueModal);
  document.querySelector('#review-publish').onclick = () => {
    if (locked()) { publication().editing = true; history('Revisão da escala iniciada.'); render(); toast('Revisão aberta. A versão publicada permanece no histórico.'); }
    else publishModal();
  };
  document.querySelector('#export-schedule').onclick = exportSchedule;
  document.querySelector('#coverage-details').onclick = () => coverageModal(state.week);
  document.querySelectorAll('[data-coverage]').forEach(el => el.onclick = () => coverageModal(el.dataset.coverage));
}
function confirmGenerate() {
  openModal(`${modalHeader('SUGESTÃO DE ESCALA', 'Gerar uma nova sugestão?')}<p>A sugestão substituirá os turnos desta semana para as pessoas com cadastro pronto em <strong>${h(currentStore().name)}</strong>. Ausências serão preservadas.</p><div class="info-box">O piloto usa uma distribuição simples de 5 dias e 2 folgas. Ele valida o perfil de teste e mostra eventuais lacunas; não é uma otimização completa.</div><div class="modal-actions"><button class="button secondary" data-close>Voltar</button><button class="button primary" id="confirm-generate">${icon('spark')} Gerar semana</button></div>`);
  document.querySelector('#confirm-generate').onclick = () => {
    generateWeek(team(), data.schedule, state.week); history(`Sugestão gerada para a semana de ${formatDate(state.week)}.`); modal.close(); render();
    const count = allIssues().length; toast(count ? `Sugestão gerada. Revise ${count} impedimento(s), inclusive nas semanas vizinhas.` : 'Sugestão gerada. Confira a cobertura antes de publicar.');
  };
}
function editShift(employeeId, date) {
  if (locked()) return toast('Crie uma revisão antes de alterar uma escala publicada.');
  const employee = data.employees.find(e => e.id === employeeId), current = data.schedule[employeeId]?.[date] || SHIFTS.off;
  if (!employee?.ready) return editEmployee(employeeId);
  const issues = allIssues().filter(i => i.employeeId === employeeId && i.date === date);
  openModal(`${modalHeader(formatDate(date, { weekday: 'long', day: '2-digit', month: 'long' }).toUpperCase(), 'Ajustar turno')}<div class="edit-person"><span class="avatar">${h(initials(employee.name))}</span><div><strong>${h(employee.name)}</strong><small>${h(employee.sector)}</small></div></div>${issues.map(i => `<div class="inline-alert">${icon('warning')}<div><strong>${h(i.title)}</strong><p>${h(i.description)}</p></div></div>`).join('')}<form id="shift-form"><label>Modelo de turno<select name="template" id="shift-template">${Object.entries(SHIFTS).map(([key, value]) => `<option value="${key}" ${current.label === value.label ? 'selected' : ''}>${value.label}${value.start ? ` · ${value.start}–${value.end}` : ''}</option>`).join('')}<option value="custom" ${!Object.values(SHIFTS).some(s => s.label === current.label) ? 'selected' : ''}>Personalizado</option></select></label><div class="form-grid"><label>Entrada<input type="time" name="start" value="${current.start || '08:00'}"></label><label>Saída<input type="time" name="end" value="${current.end || '17:00'}"></label><label>Início do intervalo<input type="time" name="breakStart" value="${current.breakStart || '12:00'}"></label><label>Fim do intervalo<input type="time" name="breakEnd" value="${current.breakEnd || '13:00'}"></label></div><label>Motivo da alteração${publication() ? ' *' : ' (opcional)'}<input name="reason" maxlength="160" ${publication() ? 'required' : ''} placeholder="Ex.: ajuste da abertura da loja"></label><p class="fine-print">As checagens serão recalculadas ao salvar. Conflitos podem ficar no rascunho e impedem a publicação simulada.</p><div class="form-error" id="shift-error" role="alert"></div><div class="modal-actions"><button type="button" class="button secondary" data-close>Cancelar</button><button class="button primary" type="submit">Salvar ajuste</button></div></form>`);
  const form = document.querySelector('#shift-form'), selector = document.querySelector('#shift-template');
  const updateTemplate = () => {
    const shift = SHIFTS[selector.value];
    for (const key of ['start', 'end', 'breakStart', 'breakEnd']) { form.elements[key].disabled = selector.value === 'off'; if (shift?.start) form.elements[key].value = shift[key]; }
  }; selector.onchange = updateTemplate; updateTemplate();
  form.onsubmit = event => {
    event.preventDefault(); const values = Object.fromEntries(new FormData(form)); let shift;
    if (values.template === 'off') shift = { ...SHIFTS.off };
    else {
      if (![values.start, values.end, values.breakStart, values.breakEnd].every(Boolean)) { document.querySelector('#shift-error').textContent = 'Preencha os quatro horários.'; return; }
      if (values.start >= values.end || values.breakStart < values.start || values.breakEnd > values.end || values.breakEnd <= values.breakStart) { document.querySelector('#shift-error').textContent = 'Neste piloto, use um turno no mesmo dia e intervalo inteiramente dentro da jornada.'; return; }
      shift = { label: 'Personalizado', className: SHIFTS[values.template]?.className || 'day', start: values.start, end: values.end, breakStart: values.breakStart, breakEnd: values.breakEnd };
    }
    data.schedule[employeeId] ??= {}; data.schedule[employeeId][date] = shift;
    history(`Turno de ${employee.source === 'demo' ? employee.name : 'pessoa importada'} ajustado em ${formatDate(date)}${values.reason ? ': ' + values.reason : '.'}`); modal.close(); render(); toast('Turno salvo. Pendências e cobertura atualizadas.');
  };
}
function issueModal() {
  openModal(`${modalHeader('REVISÃO DA SEMANA', 'Impedimentos do perfil demo')}<div class="all-issues">${allIssues().map(i => `<article class="issue"><strong>${h(i.name)} · ${formatDate(i.date)}</strong><h3>${h(i.title)}</h3><p>${h(i.description)}</p></article>`).join('') || '<p>Nenhum impedimento encontrado nas checagens do piloto.</p>'}</div>`, true);
}
function coverageModal(date) {
  const day = coverage(team(), data.schedule, state.week, state.sector).find(d => d.date === date);
  openModal(`${modalHeader('COBERTURA POR HORÁRIO', formatDate(date, { weekday: 'long', day: '2-digit', month: 'long' }))}<p>O mínimo é conferido por setor. Um excedente em outro setor não compensa uma lacuna. Intervalos já estão descontados.</p><div class="coverage-table-wrap"><table class="simple-table"><thead><tr><th>Faixa</th><th>Disponíveis</th><th>Mínimo total</th><th>Lacuna por setor</th></tr></thead><tbody>${day.slots.map(s => `<tr><td>${String(Math.floor(s.minute / 60)).padStart(2, '0')}:${s.minute % 60 ? '30' : '00'}</td><td>${s.actual}</td><td>${s.needed}</td><td><span class="status-pill ${s.shortage ? 'warning' : 'published'}">${s.shortage ? s.shortage + ' pessoa(s)' : 'Atendido'}</span></td></tr>`).join('')}</tbody></table></div><p class="fine-print">Horário e mínimos fictícios para discussão com o cliente. O piloto não permite alterar esses parâmetros.</p>`, true);
}
function publishModal() {
  const issues = allIssues();
  const uncovered = coverage(team(), data.schedule, state.week).reduce((s, d) => s + d.shortageHours, 0);
  openModal(`${modalHeader('ÚLTIMA CONFERÊNCIA', 'Revisar e publicar')}<div class="publication-summary"><div><span>Loja</span><strong>${h(currentStore().name)}</strong></div><div><span>Período</span><strong>${formatDate(state.week)} a ${formatDate(addDays(state.week, 6))}</strong></div></div><div class="${issues.length ? 'inline-alert' : 'success-note'}">${icon(issues.length ? 'warning' : 'shield')}<div><strong>${issues.length ? `${issues.length} impedimento(s) a corrigir` : 'Checagens demonstrativas atendidas'}</strong><p>${issues.length ? 'Corrija os conflitos ou gere uma nova sugestão antes de publicar.' : 'Nenhum impedimento encontrado no perfil simplificado de teste.'}</p></div></div>${uncovered ? `<div class="inline-alert soft">${icon('users')}<div><strong>${uncovered.toLocaleString('pt-BR')} horas-pessoa de cobertura a completar</strong><p>Na demo, essa é uma decisão operacional que precisa de ciência explícita.</p></div></div>` : ''}<form id="publish-form">${uncovered ? '<label class="checkbox-label"><input type="checkbox" name="coverage" required>Revisei as lacunas operacionais para esta simulação.</label>' : ''}<label class="checkbox-label"><input type="checkbox" name="demo" required>Entendo que o perfil é demonstrativo, sem validação da convenção coletiva e das regras locais.</label><p class="fine-print">Esta ação salva uma versão nesta aba. Nenhum funcionário será notificado.</p><div class="modal-actions"><button type="button" class="button secondary" data-close>Voltar à escala</button><button class="button primary" type="submit" ${issues.length ? 'disabled' : ''}>Simular publicação</button></div></form>`);
  document.querySelector('#publish-form').onsubmit = event => {
    event.preventDefault();
    if (allIssues().length) return toast('Ainda há impedimentos a corrigir.');
    const previous = publication(); const version = (previous?.version || 0) + 1;
    const snapshots = previous?.snapshots || [];
    snapshots.push({ version, at: new Date().toISOString(), schedule: structuredClone(Object.fromEntries(team().map(e => [e.id, Object.fromEntries(weekDates(state.week).map(d => [d, data.schedule[e.id]?.[d]]))]))) });
    data.publications[publicationKey()] = { version, at: new Date().toISOString(), editing: false, snapshots };
    history(`Publicação simulada da semana de ${formatDate(state.week)}, versão ${version}.`); modal.close(); render(); toast(`Versão ${version} publicada na demonstração. Nenhuma notificação foi enviada.`);
  };
}
function overviewView() {
  return `<section class="page-heading"><div><div class="eyebrow">UMA VISÃO DA REDE</div><h1>Três lojas. Um só ritmo<span>.</span></h1><p>Acompanhe o planejamento da semana de ${formatDate(state.week)}.</p></div><button class="button primary" data-view="schedule">Abrir planejamento ${icon('arrow')}</button></section><div class="store-grid">${data.stores.map(store => { const employees = data.employees.filter(e => e.storeId === store.id), issues = validateWeek(employees, data.schedule, state.week), pub = data.publications[`${store.id}:${state.week}`]; return `<article class="store-card"><div class="store-card-top"><span class="metric-icon green">${icon('store')}</span><span class="tag">${store.subtitle}</span></div><h2>${store.name}</h2><div class="store-count">${employees.length}<span>pessoas na equipe</span></div><div class="store-stat"><span>Cadastros prontos</span><strong>${employees.filter(e => e.ready).length}</strong></div><div class="store-stat"><span>Impedimentos do perfil</span><strong class="${issues.length ? 'text-orange' : ''}">${issues.length}</strong></div><div class="store-stat"><span>Semana</span><strong>${pub && !pub.editing ? 'Publicação simulada' : 'Em planejamento'}</strong></div><button class="button secondary full" data-open-store="${store.id}">Planejar esta loja ${icon('arrow')}</button></article>`; }).join('')}</div><section class="content-card activity-card"><div class="section-caption"><h2>Atividade nesta sessão</h2><span class="tag">HISTÓRICO LOCAL</span></div>${data.history.length ? `<ul class="activity-list">${data.history.slice(0, 12).map(item => `<li><span class="activity-dot"></span><div><strong>${h(item.text)}</strong><small>${h(data.stores.find(s => s.id === item.storeId)?.name)} · ${new Date(item.date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</small></div></li>`).join('')}</ul>` : `<div class="empty-state">${icon('clock')}<h3>A próxima boa semana começa aqui.</h3><p>Ajuste um turno ou gere uma sugestão para acompanhar as atividades.</p></div>`}</section><div class="session-note">${icon('help')} As três lojas e todos os nomes da base inicial são fictícios.</div>`;
}
function bindOverview() { document.querySelectorAll('[data-open-store]').forEach(el => el.onclick = () => { state.storeId = el.dataset.openStore; setView('schedule'); }); }
function employeesView() {
  const employees = filteredTeam(), pageSize = 15, pageCount = Math.max(1, Math.ceil(employees.length / pageSize)); state.page = Math.min(state.page, pageCount - 1);
  return `<section class="page-heading"><div><div class="eyebrow">A BASE DE UMA BOA ESCALA</div><h1>Conheça sua equipe<span>.</span></h1><p>Confira setores e jornadas antes de começar o planejamento.</p></div><button class="button primary" data-view="import">${icon('upload')} Importar pessoas</button></section><section class="content-card"><div class="schedule-header"><div><h2>${team().length} pessoas na loja</h2><p class="fine-print">${team().filter(e => !e.ready).length} cadastro(s) a completar</p></div>${storeSelect()}</div><div class="schedule-toolbar"><label class="search-field">${icon('search')}<input id="team-search" placeholder="Buscar pessoa" aria-label="Buscar pessoa" value="${h(state.search)}"></label><select id="sector-filter" aria-label="Filtrar setor">${sectorOptions()}</select></div><div class="table-scroll"><table class="simple-table"><thead><tr><th>Pessoa</th><th>Setor</th><th>Jornada</th><th>Origem</th><th>Situação</th><th><span class="sr-only">Ações</span></th></tr></thead><tbody>${employees.slice(state.page * pageSize, (state.page + 1) * pageSize).map((e, i) => `<tr><th scope="row"><div class="person"><span class="avatar color-${i % 5}">${h(initials(e.name))}</span><span><strong>${h(e.name)}</strong><small>${e.source === 'demo' ? h(e.externalId) : 'Identificador importado ·•••' + h(e.externalId.slice(-4))}</small></span></div></th><td>${h(e.sector || 'A definir')}</td><td>${e.weeklyHours ? e.weeklyHours + 'h / semana' : 'A definir'}</td><td><span class="tag">${e.source === 'demo' ? 'Fictício' : e.source.toUpperCase()}</span></td><td><span class="status-pill ${e.ready ? 'published' : 'warning'}">${e.ready ? 'Pronto para escalar' : 'Completar cadastro'}</span></td><td><button class="text-button" data-edit-person="${h(e.id)}">Editar</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty-state">Nenhuma pessoa encontrada.</td></tr>'}</tbody></table></div><div class="table-footer"><span class="fine-print">Importar não define automaticamente contrato, setor ou disponibilidade.</span><div class="pagination"><span>Página ${state.page + 1} de ${pageCount}</span><button class="icon-button" id="prev-page" aria-label="Página anterior" ${state.page ? '' : 'disabled'}>${icon('chevron', 'flip')}</button><button class="icon-button" id="next-page" aria-label="Próxima página" ${state.page < pageCount - 1 ? '' : 'disabled'}>${icon('chevron')}</button></div></div></section>`;
}
function bindEmployees() {
  bindFilters();
  document.querySelector('#prev-page').onclick = () => { state.page--; render(); };
  document.querySelector('#next-page').onclick = () => { state.page++; render(); };
  document.querySelectorAll('[data-edit-person]').forEach(el => el.onclick = () => editEmployee(el.dataset.editPerson));
}
function editEmployee(employeeId) {
  const employee = data.employees.find(e => e.id === employeeId);
  if (!employee) return;
  if (Object.entries(data.publications).some(([key, pub]) => key.startsWith(employee.storeId + ':') && !pub.editing)) { toast('Abra uma revisão das semanas publicadas desta loja antes de alterar o cadastro.'); return; }
  openModal(`${modalHeader('CADASTRO DA EQUIPE', 'Completar dados para a escala')}<p><strong>${h(employee.name)}</strong></p><form id="person-form"><label>Setor<select name="sector" required><option value="">Selecione</option>${SECTORS.map(s => `<option ${employee.sector === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label><label>Jornada semanal demonstrativa<select name="hours" required><option value="">Selecione</option><option value="40" ${employee.weeklyHours === 40 ? 'selected' : ''}>40h / semana</option></select></label><div class="info-box">Para manter o teste simples, a sugestão automática deste piloto usa contratos de 40h. Outros contratos e habilidades serão configurados na próxima etapa.</div><div class="modal-actions"><button type="button" class="button secondary" data-close>Cancelar</button><button class="button primary">Salvar cadastro</button></div></form>`);
  document.querySelector('#person-form').onsubmit = event => { event.preventDefault(); const values = new FormData(event.target); employee.sector = values.get('sector'); employee.weeklyHours = Number(values.get('hours')); employee.ready = true; employee.offset ??= 0; employee.shift ??= 'day'; history('Dados de planejamento de uma pessoa atualizados.'); modal.close(); render(); toast('Cadastro pronto. Gere a sugestão para incluir esta pessoa.'); };
}
function importView() {
  const preview = state.preview, valid = preview?.filter(r => r.status === 'new') || [], duplicates = preview?.filter(r => r.status === 'duplicate') || [], errors = preview?.filter(r => r.status === 'error') || [];
  return `<section class="page-heading"><div><div class="eyebrow">MENOS DIGITAÇÃO, MAIS TEMPO</div><h1>Traga sua equipe<span>.</span></h1><p>Confira os cadastros antes de incluir as pessoas na loja.</p></div><button class="button secondary" id="download-template">${icon('download')} Baixar modelo CSV</button></section><div class="import-layout"><section class="content-card import-card"><div class="import-steps"><span class="${preview ? 'complete' : 'current'}">1 <b>Selecionar arquivo</b></span><i></i><span class="${preview ? 'current' : ''}">2 <b>Conferir e importar</b></span></div><label class="field-label">Loja de destino<select id="import-store">${data.stores.map(s => `<option value="${s.id}" ${s.id === state.importStoreId ? 'selected' : ''}>${s.subtitle} · ${s.name}</option>`).join('')}</select></label><label class="dropzone" id="dropzone"><span class="upload-orbit">${icon('upload')}</span><strong>Selecione ou arraste um arquivo</strong><span>CSV ou AFD legado (.txt) · até 5 MB</span><span class="button secondary">Escolher arquivo</span><input type="file" id="import-file" accept=".csv,.txt,.rb1,.RB1" aria-label="Selecionar arquivo de funcionários"></label><button class="text-button sample-import" id="sample-import">${icon('spark')} Experimentar com arquivo fictício</button>${state.importError ? `<div class="inline-alert" role="alert">${icon('warning')}<div><strong>Não foi possível ler este arquivo</strong><p>${h(state.importError)}</p></div></div>` : ''}${preview ? `<div class="import-preview"><div class="section-caption"><h2>Confira a importação</h2><span class="tag">${h(state.importName)}</span></div><div class="import-counts"><span><strong>${valid.length}</strong> novos</span><span><strong>${duplicates.length}</strong> repetidos</span><span><strong>${errors.length}</strong> com erro</span></div><div class="preview-table-wrap"><table class="simple-table"><thead><tr><th>Pessoa</th><th>Setor / jornada</th><th>Resultado</th></tr></thead><tbody>${preview.map(r => `<tr><th scope="row">${h(r.name || 'Sem nome')}</th><td>${h(r.sector || 'A completar')} · ${r.weeklyHours ? r.weeklyHours + 'h' : 'jornada a definir'}</td><td><span class="status-pill ${r.status === 'new' ? 'published' : 'warning'}">${r.status === 'new' ? 'Novo cadastro' : r.status === 'duplicate' ? 'Ignorar repetido' : 'Não importar'}</span>${r.reason ? `<small class="cell-note">${h(r.reason)}</small>` : ''}</td></tr>`).join('')}</tbody></table></div><p class="fine-print">Repetidos e registros com erro serão ignorados. Cadastros sem setor ou jornada ficarão pendentes de complementação.</p><button class="button primary" id="confirm-import" ${valid.length ? '' : 'disabled'}>Importar ${valid.length} pessoa${valid.length === 1 ? '' : 's'} ${icon('arrow')}</button></div>` : ''}</section><aside class="import-aside"><div class="content-card"><span class="metric-icon green">${icon('shield')}</span><h2>Você confere.<br>Depois, importa.</h2><p>O arquivo é lido nesta aba e não é enviado a um servidor. Ao recarregar, os cadastros importados são removidos.</p><div class="import-feature">${icon('check')} Prévia antes de confirmar</div><div class="import-feature">${icon('check')} Verificação de identificadores repetidos</div><div class="import-feature">${icon('check')} Complementação de setor e jornada</div></div><div class="compatibility-note"><span class="tag">COMPATIBILIDADE</span><h3>Seu arquivo é .RB1?</h3><p>A leitura direta desse formato da Topdata ainda não está disponível. Não o renomeie para CSV.</p><p>Neste piloto, use uma exportação CSV ou um AFD legado com cadastros. O suporte ao RB1 depende de validação do formato com o fabricante.</p></div></aside></div>`;
}
function download(name, content, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type })), anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const sampleCSV = 'matricula;nome;setor;horas_semanais\nPILOTO-001;Aline Exemplo;Frente de caixa;40\nPILOTO-002;Caio Exemplo;Reposição;40\nPILOTO-003;Lia Exemplo;;\nPILOTO-001;Aline Exemplo;Frente de caixa;40\n';
async function readFile(file) {
  state.preview = null; state.importError = ''; state.importName = file.name;
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error('O tamanho máximo para o piloto é 5 MB.');
    if (/\.rb1$/i.test(file.name)) throw new Error('RB1 é um formato binário sem leitor validado neste piloto. Use a exportação CSV ou AFD legado com cadastros. Não houve importação.');
    if (!/\.(csv|txt)$/i.test(file.name)) throw new Error('Escolha CSV ou AFD legado em TXT.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.some(b => b === 0)) throw new Error('O conteúdo parece binário. Use um arquivo de texto CSV ou AFD compatível.');
    let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { text = new TextDecoder('windows-1252').decode(bytes); }
    const records = /\.csv$/i.test(file.name) ? parseCSV(text) : parseAFD(text);
    state.preview = prepareImport(records, data.employees, state.importStoreId);
  } catch (error) { state.importError = error.message; }
  render();
}
function bindImport() {
  document.querySelector('#download-template').onclick = () => download('modelo-equipe-demo.csv', '\uFEFF' + sampleCSV);
  document.querySelector('#sample-import').onclick = () => { state.preview = prepareImport(parseCSV(sampleCSV), data.employees, state.importStoreId); state.importName = 'equipe-ficticia.csv'; state.importError = ''; render(); };
  document.querySelector('#import-file').onchange = event => { if (event.target.files[0]) readFile(event.target.files[0]); };
  document.querySelector('#import-store').onchange = event => { state.importStoreId = event.target.value; state.preview = null; state.importError = ''; render(); };
  const zone = document.querySelector('#dropzone');
  zone.ondragover = event => { event.preventDefault(); zone.classList.add('dragover'); };
  zone.ondragleave = () => zone.classList.remove('dragover');
  zone.ondrop = event => { event.preventDefault(); if (event.dataTransfer.files[0]) readFile(event.dataTransfer.files[0]); };
  document.querySelector('#confirm-import')?.addEventListener('click', () => {
    const rows = state.preview.filter(r => r.status === 'new');
    if (!rows.length) return;
    for (const row of rows) data.employees.push({ id: `import-${Date.now()}-${data.employees.length}`, name: row.name, externalId: row.externalId, sector: row.sector, weeklyHours: row.weeklyHours, ready: !!row.sector && row.weeklyHours === 40, storeId: state.importStoreId, source: row.source, offset: data.employees.length % 7, shift: 'day', leaves: [] });
    state.storeId = state.importStoreId; history(`${rows.length} cadastro(s) importado(s), após conferência.`); state.preview = null; setView('employees'); toast(`${rows.length} pessoa(s) importada(s). Confira os cadastros pendentes.`);
  });
}
function rulesView() {
  const cards = [
    ['clock', 'Jornada de referência', '40h por semana e até 8h de trabalho por dia. Intervalos não entram no total.'],
    ['calendar', 'Distribuição de folgas', 'Ao menos 2 dias sem trabalho por semana e até 5 dias consecutivos no perfil de teste.'],
    ['shield', 'Descanso entre jornadas', 'Ao menos 11h entre saída e próxima entrada, incluindo as semanas vizinhas carregadas na demo.'],
    ['users', 'Intervalos e ausências', 'Intervalo de 1h acima de 6h de trabalho, 15 minutos acima de 4h, e bloqueio de turnos em ausências cadastradas.']
  ];
  return `<section class="page-heading"><div><div class="eyebrow">CRITÉRIOS TRANSPARENTES</div><h1>Regras claras. Decisões melhores<span>.</span></h1><p>Saiba o que a demonstração verifica e o que precisa ser definido com o cliente.</p></div></section><div class="rule-banner">${icon('help')}<div><strong>Perfil demonstrativo · parâmetros de teste</strong><p>Este perfil foi simplificado para avaliar o fluxo. Não representa homologação trabalhista nem aplicação completa da legislação e dos instrumentos coletivos.</p></div></div><div class="rule-grid">${cards.map(([glyph, title, description]) => `<article class="content-card rule-card"><span class="metric-icon green">${icon(glyph)}</span><h2>${title}</h2><p>${description}</p><span class="status-pill published">Verificado no piloto</span></article>`).join('')}</div><section class="content-card rules-scope"><h2>O que será configurado depois do teste do fluxo</h2><div class="scope-grid"><div><h3>Enquadramento de cada loja</h3><p>Município, sindicato, convenção e acordos coletivos, vigências e transição das jornadas.</p></div><div><h3>Condições de cada vínculo</h3><p>Jornadas diferentes, aprendizes, trabalho noturno, habilidades e restrições específicas.</p></div><div><h3>Domingos e feriados</h3><p>Revezamentos aplicáveis, permissões, compensações e regras locais.</p></div><div><h3>Operação real</h3><p>Mínimos por setor, horários da loja, preferências e critérios para aprovação.</p></div></div><div class="info-box">A sugestão automática é uma distribuição simples. As checagens determinam os impedimentos do perfil; as lacunas de cobertura ficam explícitas para revisão.</div></section>`;
}
function tour() {
  openModal(`${modalHeader('ROTEIRO PARA A REUNIÃO', 'Da equipe à semana pronta.')}<p>Apresente o fluxo em quatro passos. Os dados iniciais são fictícios e você pode reiniciar a demonstração a qualquer momento.</p><div class="tour-steps">${[['1', 'Conhecer a equipe', 'Confira as lojas de 40, 80 e 200 pessoas, os setores e as jornadas.', 'employees', 'Ver equipe'], ['2', 'Experimentar a importação', 'Use o arquivo fictício para conferir prévia, repetidos e cadastros a completar.', 'import', 'Importar exemplo'], ['3', 'Montar e ajustar a semana', 'A escala inicial tem conflitos de exemplo. Edite um turno ou gere uma nova sugestão.', 'schedule', 'Abrir escala'], ['4', 'Revisar e simular a publicação', 'Confira impedimentos e cobertura. A simulação não envia notificações.', 'publish', 'Revisar semana']].map(([n, title, description, view, action]) => `<article><span>${n}</span><div><h3>${title}</h3><p>${description}</p><button class="text-button" data-tour="${view}">${action} ${icon('arrow')}</button></div></article>`).join('')}</div><div class="info-box">As alterações existem nesta aba. Não há login, armazenamento compartilhado ou conexão com o relógio nesta versão.</div>`, true);
  document.querySelectorAll('[data-tour]').forEach(el => el.onclick = () => { modal.close(); if (el.dataset.tour === 'publish') { state.view = 'schedule'; render(); publishModal(); } else { setView(el.dataset.tour); if (el.dataset.tour === 'import') { state.preview = prepareImport(parseCSV(sampleCSV), data.employees, state.importStoreId); state.importName = 'equipe-ficticia.csv'; render(); } } });
}
function exportSchedule() {
  const rows = [['loja', 'pessoa', 'setor', 'data', 'entrada', 'saida', 'intervalo_inicio', 'intervalo_fim', 'situacao']];
  for (const employee of filteredTeam()) for (const date of weekDates(state.week)) { const shift = data.schedule[employee.id]?.[date]; rows.push([currentStore().name, employee.name, employee.sector, date, shift?.start, shift?.end, shift?.breakStart, shift?.breakEnd, shift?.label || 'Não definido']); }
  download(`escala-demo-loja-${state.storeId}-${state.week}.csv`, '\uFEFF' + rows.map(row => row.map(csvCell).join(';')).join('\r\n'));
  toast('CSV gerado com as pessoas dos filtros atuais.');
}
render();
