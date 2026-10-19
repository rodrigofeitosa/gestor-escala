import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDemo, generateWeek, validateWeek, coverage, SHIFTS, parseCSV, parseAFD, prepareImport, shiftSpan, csvCell, workedHours, weekMonday } from '../assets/core.mjs';
const employee = { id: 'test', externalId: 'PILOTO', name: 'Pessoa Exemplo', ready: true, storeId: '1', sector: 'Frente de caixa', weeklyHours: 40, offset: 0, shift: 'early', leaves: [] };

test('base fictícia tem 40, 80 e 200 pessoas com identificadores distintos', () => {
  const data = makeDemo();
  assert.deepEqual(data.stores.map(s => data.employees.filter(e => e.storeId === s.id).length), [40, 80, 200]);
  assert.equal(new Set(data.employees.map(e => e.externalId)).size, 320);
  assert.equal(new Set(data.employees.map(e => e.name)).size, 320);
});
test('conflitos iniciais desaparecem com sugestão sem alterar outras lojas', () => {
  const data = makeDemo(), team = data.employees.filter(e => e.storeId === '1');
  const other = JSON.stringify(data.schedule['demo-41']);
  assert.ok(validateWeek(team, data.schedule, '2026-10-19').some(i => i.code === 'rest'));
  assert.ok(validateWeek(team, data.schedule, '2026-10-19').some(i => i.code === 'weekly'));
  generateWeek(team, data.schedule, '2026-10-19');
  assert.deepEqual(validateWeek(team, data.schedule, '2026-10-19'), []);
  assert.equal(JSON.stringify(data.schedule['demo-41']), other);
});
test('descanso considera a saída da semana anterior', () => {
  const schedule = {}; generateWeek([employee], schedule, '2026-10-19');
  schedule.test['2026-10-18'] = { ...SHIFTS.late };
  assert.ok(validateWeek([employee], schedule, '2026-10-19').some(i => i.code === 'rest'));
});
test('descanso considera a entrada da semana seguinte', () => {
  const schedule = {}; generateWeek([employee], schedule, '2026-10-19');
  schedule.test['2026-10-25'] = { ...SHIFTS.late }; schedule.test['2026-10-26'] = { ...SHIFTS.early };
  assert.ok(validateWeek([employee], schedule, '2026-10-19').some(i => i.code === 'rest' && i.date === '2026-10-25'));
});
test('sequência de dias não reinicia na segunda-feira', () => {
  const schedule = {}; generateWeek([employee], schedule, '2026-10-19');
  for (const date of ['2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']) schedule.test[date] = { ...SHIFTS.early };
  assert.ok(validateWeek([employee], schedule, '2026-10-19').some(i => i.code === 'consecutive'));
});
test('intervalo é descontado e excesso diário é sinalizado', () => {
  assert.equal(shiftSpan('2026-10-19', SHIFTS.day).workMinutes, 480);
  const schedule = {}; generateWeek([employee], schedule, '2026-10-19');
  assert.equal(workedHours(schedule.test, '2026-10-19'), 40);
  schedule.test['2026-10-19'] = { ...SHIFTS.day, end: '20:00', breakEnd: '12:15' };
  const issues = validateWeek([employee], schedule, '2026-10-19');
  assert.ok(issues.some(i => i.code === 'daily')); assert.ok(issues.some(i => i.code === 'break'));
});
test('ausências são preservadas na geração e conflitos são detectados', () => {
  const person = { ...employee, leaves: ['2026-10-19'] }, schedule = {}; generateWeek([person], schedule, '2026-10-19');
  assert.equal(schedule.test['2026-10-19'].className, 'leave');
  schedule.test['2026-10-19'] = { ...SHIFTS.day };
  assert.ok(validateWeek([person], schedule, '2026-10-19').some(i => i.code === 'leave'));
});
test('semana sem turnos definidos e cadastro incompleto impedem publicação', () => {
  assert.ok(validateWeek([employee], {}, '2026-10-19').some(i => i.code === 'unassigned'));
  assert.ok(validateWeek([{ ...employee, ready: false }], {}, '2026-10-19').some(i => i.code === 'setup'));
});
test('cobertura desconta intervalo e não compensa setores diferentes', () => {
  const schedule = { test: { '2026-10-19': { ...SHIFTS.day } } };
  const cov = coverage([employee], schedule, '2026-10-19', 'Frente de caixa')[0];
  assert.equal(cov.slots.find(s => s.minute === 11 * 60).actual, 1);
  assert.equal(cov.slots.find(s => s.minute === 12 * 60).actual, 0);
  const other = { ...employee, id: 'other', sector: 'Reposição' };
  const all = coverage([employee, other], { ...schedule, other: schedule.test }, '2026-10-19')[0];
  assert.ok(all.slots.find(s => s.minute === 11 * 60).shortage > 0);
});
test('CSV lê BOM, aspas, acentos, delimitadores e campos ausentes', () => {
  const records = parseCSV('\uFEFFmatricula;nome;setor;horas_semanais\r\nX1;"Pessoa; Exemplo";Reposição;40\r\nX2;Segunda Pessoa;;\r\n');
  assert.equal(records[0].name, 'Pessoa; Exemplo'); assert.equal(records[1].weeklyHours, null);
  assert.equal(parseCSV('matricula,nome\nX1,"Pessoa, Exemplo"')[0].name, 'Pessoa, Exemplo');
  assert.throws(() => parseCSV('matricula;nome\nX1;"aberto'), /aspas/);
  assert.throws(() => parseCSV('qualquer;campo\n1;2'), /colunas/);
});
const afdRow = (nsr, operation, id, name) => `${String(nsr).padStart(9, '0')}5191020260800${operation}${id.padStart(12, '0')}${name.padEnd(52, ' ')}`;
const afdHeader = '0000000001'.padEnd(232, ' ');
test('AFD deduplica eventos pelo NSR, mantém atualização e respeita exclusões', () => {
  const content = [afdHeader, afdRow(1, 'I', '111', 'Primeiro Nome'), afdRow(3, 'A', '111', 'Nome Atualizado'), afdRow(2, 'I', '222', 'Pessoa Excluída'), afdRow(4, 'E', '222', 'Pessoa Excluída')].join('\r\n');
  const records = parseAFD(content); assert.equal(records.length, 1); assert.equal(records[0].name, 'Nome Atualizado'); assert.equal(records[0].weeklyHours, null);
  const outOfOrder = [afdHeader, afdRow(3, 'A', '111', 'Nome Atualizado'), afdRow(1, 'I', '111', 'Primeiro Nome')].join('\n');
  assert.equal(parseAFD(outOfOrder)[0].name, 'Nome Atualizado');
});
test('AFD rejeita formato incompatível sem importar parcialmente', () => {
  assert.throws(() => parseAFD('arquivo comum'), /não reconhecido/);
  assert.throws(() => parseAFD([afdHeader, afdRow(1, 'I', '111', 'Pessoa'), '0000000025invalido'].join('\n')), /linha 3/);
  assert.throws(() => parseAFD(afdHeader), /Não foram encontrados/);
});
test('prévia de importação separa repetidos, conflitos entre lojas e erros', () => {
  const records = [{ externalId: 'PILOTO', name: 'Pessoa', sector: '', weeklyHours: null }, { externalId: 'NOVA', name: 'Nova Pessoa', sector: '', weeklyHours: null }, { externalId: 'NOVA', name: 'Nova Pessoa', sector: '', weeklyHours: null }, { externalId: 'INVALIDO', name: 'Inválida', sector: '', weeklyHours: 44 }];
  assert.deepEqual(prepareImport(records, [employee], '1').map(r => r.status), ['duplicate', 'new', 'duplicate', 'error']);
  assert.equal(prepareImport(records, [employee], '2')[0].status, 'error');
});
test('exportação CSV neutraliza fórmulas e escapa aspas', () => {
  assert.equal(csvCell('=SUM(1)'), '"\'=SUM(1)"'); assert.equal(csvCell('Pessoa "Exemplo"'), '"Pessoa ""Exemplo"""');
  assert.equal(weekMonday('2026-10-25'), '2026-10-19');
});
