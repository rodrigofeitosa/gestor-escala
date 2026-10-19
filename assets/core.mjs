export const SECTORS = ['Frente de caixa', 'Reposição', 'Hortifrúti', 'Açougue', 'Padaria', 'Administrativo'];
export const SHIFTS = {
  early: { label: 'Abertura', start: '06:00', end: '15:00', breakStart: '10:00', breakEnd: '11:00', className: 'early' },
  day: { label: 'Intermediário', start: '08:00', end: '17:00', breakStart: '12:00', breakEnd: '13:00', className: 'day' },
  late: { label: 'Fechamento', start: '13:00', end: '22:00', breakStart: '17:00', breakEnd: '18:00', className: 'late' },
  off: { label: 'Folga', className: 'off' }
};
export const POLICY = { weeklyHours: 40, dailyHours: 8, restHours: 11, maxWorkDays: 5, maxConsecutive: 5 };
export const DAY_MS = 86400000;
export const dateISO = d => new Date(d).toISOString().slice(0, 10);
export const addDays = (date, days) => dateISO(Date.parse(date + 'T00:00:00Z') + days * DAY_MS);
export const weekDates = start => Array.from({ length: 7 }, (_, i) => addDays(start, i));
export const weekMonday = date => {
  const d = new Date(date + 'T00:00:00Z');
  return addDays(date, -((d.getUTCDay() + 6) % 7));
};
export const minutes = time => Number(time.split(':')[0]) * 60 + Number(time.split(':')[1]);
export const escapeHTML = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const firstNames = ['Ana', 'Bruno', 'Camila', 'Diego', 'Elisa', 'Felipe', 'Gabriela', 'Henrique', 'Isabela', 'João', 'Karina', 'Lucas', 'Marina', 'Nicolas', 'Olívia', 'Paulo', 'Rafaela', 'Samuel', 'Talita', 'Vinícius'];
const surnames = ['Almeida', 'Barbosa', 'Cardoso', 'Duarte', 'Esteves', 'Ferreira', 'Gomes', 'Henriques', 'Lima', 'Moraes', 'Nascimento', 'Oliveira', 'Pereira', 'Ribeiro', 'Santos', 'Teixeira'];
export function makeDemo() {
  const stores = [{ id: '1', name: 'Loja Centro', subtitle: 'Loja 01', count: 40 }, { id: '2', name: 'Loja Jardim', subtitle: 'Loja 02', count: 80 }, { id: '3', name: 'Loja Parque', subtitle: 'Loja 03', count: 200 }];
  let ordinal = 0;
  const employees = stores.flatMap(store => Array.from({ length: store.count }, (_, i) => {
    const n = ordinal++;
    const sector = SECTORS[i % 10 < 4 ? 0 : i % 10 < 6 ? 1 : i % 10 - 4];
    return { id: `demo-${n + 1}`, externalId: `DEMO-${String(n + 1).padStart(3, '0')}`, name: `${firstNames[n % 20]} ${surnames[Math.floor(n / 20) % 16]}`, storeId: store.id, sector, weeklyHours: 40, source: 'demo', ready: true, offset: Math.floor(i / 3) % 7, shift: ['early', 'day', 'late'][i % 3], leaves: i === 7 ? [addDays('2026-10-19', 2)] : [] };
  }));
  const schedule = {};
  for (let w = -2; w <= 3; w++) generateWeek(employees, schedule, addDays('2026-10-19', w * 7));
  schedule['demo-1']['2026-10-19'] = { ...SHIFTS.late };
  schedule['demo-1']['2026-10-20'] = { ...SHIFTS.early };
  schedule['demo-2']['2026-10-24'] = { ...SHIFTS.day };
  return { stores, employees, schedule, publications: {}, history: [] };
}
export function generateWeek(employees, schedule, start) {
  for (const employee of employees) {
    if (!employee.ready) continue;
    schedule[employee.id] ??= {};
    weekDates(start).forEach((date, day) => {
      schedule[employee.id][date] = employee.leaves?.includes(date)
        ? { label: 'Ausência', className: 'leave' }
        : (day + employee.offset) % 7 < 5 ? { ...SHIFTS[employee.shift] } : { ...SHIFTS.off };
    });
  }
  return schedule;
}
export function shiftSpan(date, shift) {
  if (!shift?.start || !shift?.end) return null;
  const base = Date.parse(date + 'T00:00:00Z') / 60000;
  const start = base + minutes(shift.start);
  let end = base + minutes(shift.end);
  if (end <= start) end += 1440;
  let breakStart = shift.breakStart ? base + minutes(shift.breakStart) : null;
  if (breakStart !== null && breakStart < start) breakStart += 1440;
  let breakEnd = shift.breakEnd ? base + minutes(shift.breakEnd) : null;
  if (breakEnd !== null && breakEnd < (breakStart ?? start)) breakEnd += 1440;
  const breakMinutes = breakStart !== null && breakEnd !== null && breakStart >= start && breakEnd <= end && breakEnd > breakStart ? breakEnd - breakStart : 0;
  return { start, end, breakStart, breakEnd, breakMinutes, workMinutes: end - start - breakMinutes };
}
export function workedHours(shifts, start) {
  return weekDates(start).reduce((sum, date) => sum + (shiftSpan(date, shifts?.[date])?.workMinutes ?? 0), 0) / 60;
}
export function validateEmployee(employee, schedule, start) {
  const issues = [];
  const shifts = schedule[employee.id] ?? {};
  const dates = weekDates(start);
  const issue = (code, date, title, description) => issues.push({ id: `${employee.id}-${code}-${date}`, code, date, employeeId: employee.id, name: employee.name, sector: employee.sector, title, description, level: 'block' });
  if (!employee.ready) { issue('setup', start, 'Cadastro a completar', 'Defina setor e jornada antes de incluir esta pessoa na escala.'); return issues; }
  const hours = workedHours(shifts, start);
  const missingDate = dates.find(date => !shifts[date]);
  if (missingDate) issue('unassigned', missingDate, 'Escala incompleta', 'Há dias sem turno, folga ou ausência definidos nesta semana. Gere uma sugestão ou complete os dias.');
  const limit = Math.min(employee.weeklyHours, POLICY.weeklyHours);
  if (hours > limit) issue('weekly', start, 'Carga semanal excedida', `${hours}h previstas para um limite de ${limit}h no perfil demonstrativo.`);
  const workDays = dates.filter(date => !!shifts[date]?.start).length;
  if (workDays > POLICY.maxWorkDays) issue('days', start, 'Folgas insuficientes', `${workDays} dias de trabalho nesta semana. O perfil do piloto prevê ao menos 2 folgas.`);
  for (const date of dates) {
    const span = shiftSpan(date, shifts[date]);
    if (!span) continue;
    if (employee.leaves?.includes(date)) issue('leave', date, 'Conflito com ausência', 'Há uma ausência cadastrada para este dia.');
    if (span.workMinutes > POLICY.dailyHours * 60) issue('daily', date, 'Jornada diária excedida', `São ${(span.workMinutes / 60).toFixed(1)}h de trabalho. Limite demonstrativo: 8h.`);
    const minimumBreak = span.workMinutes > 360 ? 60 : span.workMinutes > 240 ? 15 : 0;
    if (span.breakMinutes < minimumBreak) issue('break', date, 'Intervalo insuficiente', `O perfil do piloto exige ${minimumBreak} minutos de intervalo para esta jornada.`);
    let consecutive = 1;
    for (let p = 1; p <= 7; p++) { if (shifts[addDays(date, -p)]?.start) consecutive++; else break; }
    if (consecutive > POLICY.maxConsecutive) issue('consecutive', date, 'Sequência de trabalho excedida', `${consecutive} dias seguidos, considerando a semana anterior. Limite do piloto: 5.`);
  }
  const spans = Object.entries(shifts).map(([date, shift]) => ({ date, span: shiftSpan(date, shift) })).filter(x => x.span).sort((a, b) => a.span.start - b.span.start);
  for (let i = 1; i < spans.length; i++) {
    const a = spans[i - 1], b = spans[i];
    if (!dates.includes(a.date) && !dates.includes(b.date)) continue;
    const rest = (b.span.start - a.span.end) / 60;
    if (rest < POLICY.restHours) issue('rest', dates.includes(b.date) ? b.date : a.date, rest < 0 ? 'Jornadas sobrepostas' : 'Descanso entre jornadas insuficiente', `${Math.max(0, rest).toFixed(1)}h entre a saída de ${a.date.split('-').reverse().join('/')} e a próxima entrada. O perfil exige 11h.`);
  }
  return issues;
}
export function validateWeek(employees, schedule, start) {
  return employees.flatMap(employee => validateEmployee(employee, schedule, start));
}
export function coverage(employees, schedule, start, sector = 'all') {
  const team = employees.filter(e => e.ready && (sector === 'all' || e.sector === sector));
  const sectors = sector === 'all' ? SECTORS : [sector];
  return weekDates(start).map(date => {
    const slots = [];
    for (let minute = 8 * 60; minute < 21 * 60; minute += 30) {
      const time = Date.parse(date + 'T00:00:00Z') / 60000 + minute;
      let actual = 0, needed = 0, shortage = 0;
      for (const item of sectors) {
        const sectorTeam = team.filter(e => e.sector === item);
        const minimum = item === SECTORS[5] ? (minute < 17 * 60 && new Date(date + 'T00:00:00Z').getUTCDay() % 6 !== 0 ? 1 : 0) : Math.max(1, Math.floor(sectorTeam.length / 8));
        const present = sectorTeam.filter(e => {
          const span = shiftSpan(date, schedule[e.id]?.[date]);
          return span && span.start <= time && time < span.end && !(span.breakMinutes && time >= span.breakStart && time < span.breakEnd);
        }).length;
        needed += minimum; actual += present; shortage += Math.max(0, minimum - present);
      }
      slots.push({ minute, actual, needed, shortage });
    }
    return { date, slots, shortageSlots: slots.filter(x => x.shortage > 0).length, shortageHours: slots.reduce((s, x) => s + x.shortage * 0.5, 0) };
  });
}
export function parseCSV(text) {
  const delimiter = (text.split(/\r?\n/)[0].match(/;/g)?.length ?? 0) >= (text.split(/\r?\n/)[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; }
    else if (c === delimiter && !quoted) { row.push(field.trim()); field = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field.trim()); if (row.some(Boolean)) rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (quoted) throw new Error('Há aspas sem fechamento no CSV. Confira o arquivo e tente novamente.');
  if (field || row.length) { row.push(field.trim()); if (row.some(Boolean)) rows.push(row); }
  if (rows.length < 2) throw new Error('O arquivo precisa de um cabeçalho e ao menos uma pessoa.');
  const normalize = s => s.replace(/^\uFEFF/, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const headers = rows.shift().map(normalize);
  const nameIndex = headers.findIndex(h => ['nome', 'name', 'funcionario'].includes(h));
  const idIndex = headers.findIndex(h => ['matricula', 'pis', 'identificador', 'id'].includes(h));
  const sectorIndex = headers.indexOf('setor');
  const hoursIndex = headers.findIndex(h => ['jornada', 'horas', 'horas_semanais'].includes(h));
  if (nameIndex < 0 || idIndex < 0) throw new Error('Inclua as colunas nome e matricula (ou pis). Baixe o modelo para conferir.');
  return rows.map((r, i) => ({ name: r[nameIndex] ?? '', externalId: r[idIndex] ?? '', sector: r[sectorIndex] ?? '', weeklyHours: hoursIndex < 0 || !r[hoursIndex] ? null : Number(r[hoursIndex]), line: i + 2, source: 'csv' }));
}
export function parseAFD(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  const header = lines.find(line => line.length === 232 && line[9] === '1');
  if (!header) throw new Error('AFD não reconhecido. Este piloto lê cadastros do leiaute legado com registros de 87 caracteres. Use o modelo CSV para outros formatos.');
  const employees = new Map();
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line[9] !== '5') continue;
    if (line.length !== 87 || !/^\d{9}5\d{12}[IAE]\d{12}/.test(line)) throw new Error(`Registro cadastral incompatível na linha ${i + 1}. Nenhum cadastro foi importado.`);
    count++;
    const externalId = line.slice(23, 35);
    const nsr = Number(line.slice(0, 9));
    const existing = employees.get(externalId);
    if (!existing || nsr > existing.nsr) employees.set(externalId, { externalId, name: line.slice(35, 87).trim(), operation: line[22], nsr, sector: '', weeklyHours: null, line: i + 1, source: 'afd' });
  }
  if (!count) throw new Error('Não foram encontrados cadastros de empregados nesse AFD. Marcações de ponto não são importadas pelo piloto.');
  const records = [...employees.values()].filter(e => e.operation !== 'E');
  if (!records.length) throw new Error('O arquivo contém apenas exclusões cadastrais. Confira a exportação.');
  return records;
}
export function prepareImport(records, employees, storeId) {
  const seen = new Set();
  return records.map(record => {
    const r = { ...record, storeId, status: 'new', reason: '' };
    if (!r.name || r.name.length > 100 || !r.externalId || r.externalId.length > 40) { r.status = 'error'; r.reason = 'Nome ou identificador ausente/inválido.'; }
    else if (seen.has(r.externalId)) { r.status = 'duplicate'; r.reason = 'Identificador repetido no arquivo.'; }
    else if (employees.some(e => e.externalId === r.externalId && e.storeId === storeId)) { r.status = 'duplicate'; r.reason = 'Já cadastrado nesta loja; será ignorado.'; }
    else if (employees.some(e => e.externalId === r.externalId && e.storeId !== storeId)) { r.status = 'error'; r.reason = 'Identificador já vinculado a outra loja. Revise antes de importar.'; }
    else if ((r.sector && !SECTORS.includes(r.sector)) || (r.weeklyHours !== null && r.weeklyHours !== 40)) { r.status = 'error'; r.reason = 'Setor desconhecido ou jornada diferente das 40h usadas neste piloto.'; }
    seen.add(r.externalId);
    return r;
  });
}
export function csvCell(value) {
  let s = String(value ?? '');
  if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
