const defaultState = {
  user: {
    email: '',
    name: 'Usuário'
  },
  settings: {
    salarioMensal: 3500,
    jornadaDiaria: 8,
    extraDiaUtil: 50,
    extraFimSemana: 100,
    diaFechamentoMes: 30,
    diaPagamento: 5
  },
  registrations: [],
  feedbacks: [],
  schedule: {
    monday: { entrada: '08:00', saida: '17:00', almocoInicio: '12:00', almocoFim: '12:45' },
    tuesday: { entrada: '08:00', saida: '17:00', almocoInicio: '12:00', almocoFim: '12:45' },
    wednesday: { entrada: '08:30', saida: '17:30', almocoInicio: '12:15', almocoFim: '13:00' },
    thursday: { entrada: '08:00', saida: '17:00', almocoInicio: '12:00', almocoFim: '12:45' },
    friday: { entrada: '08:00', saida: '16:00', almocoInicio: '12:00', almocoFim: '12:30' },
    saturday: { entrada: '', saida: '', almocoInicio: '', almocoFim: '' },
    sunday: { entrada: '', saida: '', almocoInicio: '', almocoFim: '' }
  }
};

const loginView = document.getElementById('loginView');
const registerView = document.getElementById('registerView');
const appView = document.getElementById('appView');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const showRegisterBtn = document.getElementById('showRegisterBtn');
const showLoginBtn = document.getElementById('showLoginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const tabButtons = document.querySelectorAll('.tab');
const panels = document.querySelectorAll('.panel');
const registroForm = document.getElementById('registroForm');
const horarioForm = document.getElementById('horarioForm');
const configForm = document.getElementById('configForm');
const feedbackForm = document.getElementById('feedbackForm');
const scheduleTableBody = document.getElementById('scheduleTableBody');
const toggleFinanceVisibilityButton = document.getElementById('toggleFinanceVisibility');
const deleteAccountButton = document.getElementById('deleteAccountBtn');
let financesHidden = false;

function loadState() {
  return structuredClone(defaultState);
}

let state = loadState();

function saveState() {
  const { user, ...persistedState } = state;
  if (!user.email) return;

  fetch('/api/state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: persistedState })
  }).catch(() => {});
}

function formatMinutes(totalMinutes) {
  const hours = Math.floor(Math.abs(totalMinutes) / 60);
  const minutes = Math.abs(totalMinutes) % 60;
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}

function formatBankHours(totalMinutes) {
  const hours = Math.floor(Math.abs(totalMinutes) / 60);
  const minutes = Math.abs(totalMinutes) % 60;
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}

function getMinutesFromTime(value) {
  if (!value) return 0;
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function computeDuration(start, end) {
  const startMinutes = getMinutesFromTime(start);
  const endMinutes = getMinutesFromTime(end);
  return Math.max(0, endMinutes - startMinutes);
}

function getDayKeyForDate(dateString) {
  if (!dateString) return null;

  const date = new Date(`${dateString}T12:00:00`);
  if (Number.isNaN(date.getTime())) return null;

  const weekdayMap = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  return weekdayMap[date.getDay()];
}

function calculateExtraMinutes(dateString, start, end, lunchStart, lunchEnd) {
  const actualMinutes = computeDuration(start, end);
  const lunchBreakMinutes = computeDuration(lunchStart, lunchEnd);
  const actualWorkedMinutes = Math.max(0, actualMinutes - lunchBreakMinutes);

  const schedule = getDayKeyForDate(dateString)
    ? state.schedule?.[getDayKeyForDate(dateString)]
    : null;

  if (!schedule || (!schedule.entrada && !schedule.saida)) {
    return actualWorkedMinutes;
  }

  const scheduledStart = getMinutesFromTime(schedule.entrada);
  const scheduledEnd = getMinutesFromTime(schedule.saida);
  const scheduledLunchStart = getMinutesFromTime(schedule.almocoInicio);
  const scheduledLunchEnd = getMinutesFromTime(schedule.almocoFim);

  const actualStart = getMinutesFromTime(start);
  const actualEnd = getMinutesFromTime(end);

  if (scheduledStart === 0 && scheduledEnd === 0) {
    return actualWorkedMinutes;
  }

  const isOutsideSchedule = actualEnd <= scheduledStart || actualStart >= scheduledEnd;
  if (isOutsideSchedule) {
    return actualWorkedMinutes;
  }

  const scheduledMinutes = computeDuration(schedule.entrada, schedule.saida);
  const scheduledLunchMinutes = computeDuration(schedule.almocoInicio, schedule.almocoFim);
  const standardWorkMinutes = Math.max(0, scheduledMinutes - scheduledLunchMinutes);

  return Math.max(0, actualWorkedMinutes - standardWorkMinutes);
}

function currency(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(value || 0);
}

function getExtraPercent(dateString) {
  const day = new Date(`${dateString}T12:00:00`).getDay();
  if (day === 0 || day === 6) return Number(state.settings.extraFimSemana || 0);
  return Number(state.settings.extraDiaUtil || 0);
}

function calculateExtraValue(minutes, dateString) {
  const salarioMensal = Number(state.settings.salarioMensal || 0);
  const jornadaDiaria = Number(state.settings.jornadaDiaria || 8);
  const percent = getExtraPercent(dateString);
  const valorHora = salarioMensal / (30 * jornadaDiaria);
  const percentual = percent / 100;
  return (minutes / 60) * valorHora * (1 + percentual);
}

function calculateSummary() {
  const totalExtras = state.registrations.reduce((sum, item) => sum + calculateExtraMinutes(item.date, item.start, item.end, item.lunchStart, item.lunchEnd), 0);
  const totalBancoMinutes = state.registrations
    .filter((item) => item.type === 'banco')
    .reduce((sum, item) => sum + calculateExtraMinutes(item.date, item.start, item.end, item.lunchStart, item.lunchEnd), 0);
  const totalPago = state.registrations
    .filter((item) => item.type === 'final_mes')
    .reduce((sum, item) => sum + calculateExtraValue(calculateExtraMinutes(item.date, item.start, item.end, item.lunchStart, item.lunchEnd), item.date), 0);
  const totalBanco = state.registrations
    .filter((item) => item.type === 'banco')
    .reduce((sum, item) => sum + calculateExtraValue(calculateExtraMinutes(item.date, item.start, item.end, item.lunchStart, item.lunchEnd), item.date), 0);

  return { totalExtras, totalPago, totalBanco, totalBancoMinutes };
}

function applyFinanceVisibility() {
  const cards = document.querySelectorAll('.finance-card');
  cards.forEach((card) => {
    const value = card.classList.contains('month-summary-card')
      ? card.querySelector('span')
      : card.querySelector('strong');

    if (!value) return;

    if (financesHidden) {
      value.dataset.originalText = value.textContent;
      value.textContent = '••••';
      value.classList.add('is-hidden-value');
    } else {
      value.textContent = value.dataset.originalText || value.textContent;
      value.classList.remove('is-hidden-value');
    }

    card.classList.toggle('is-hidden', financesHidden);
  });

  if (toggleFinanceVisibilityButton) {
    toggleFinanceVisibilityButton.textContent = financesHidden ? '👁️ Mostrar finanças' : '🙈 Ocultar finanças';
    toggleFinanceVisibilityButton.setAttribute('aria-label', financesHidden ? 'Mostrar finanças' : 'Ocultar finanças');
  }
}

function renderDashboard() {
  const { totalExtras, totalPago, totalBanco, totalBancoMinutes } = calculateSummary();

  const userName = state.user.name || 'Usuário';
  document.getElementById('userGreeting').textContent = `Olá, ${userName}`;
  document.getElementById('salarioBase').textContent = currency(Number(state.settings.salarioMensal || 0));
  document.getElementById('totalExtras').textContent = formatMinutes(totalExtras);
  document.getElementById('saldoBanco').textContent = formatBankHours(totalBancoMinutes);
  document.getElementById('receberFinalMes').textContent = currency(totalPago + totalBanco);
  document.getElementById('horaPaga').textContent = currency(totalPago);
  document.getElementById('statusEmpresa').textContent = totalBanco > 0 ? 'Banco de horas' : 'Pagamento mensal';

  const historyList = document.getElementById('historicoList');
  historyList.innerHTML = '';

  if (state.registrations.length === 0) {
    historyList.innerHTML = '<li><div class="history-meta"><strong>Nenhum registro</strong><small>Cadastre sua primeira hora extra.</small></div></li>';
  } else {
    [...state.registrations]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .forEach((item) => {
        const extraMinutes = calculateExtraMinutes(item.date, item.start, item.end, item.lunchStart, item.lunchEnd);
        const li = document.createElement('li');
        li.innerHTML = `
          <div class="history-meta">
            <strong>${new Date(item.date + 'T00:00:00').toLocaleDateString('pt-BR', { timeZone: 'UTC' })} · ${item.type === 'final_mes' ? 'Final do mês' : 'Banco de horas'}</strong>
            <small>${item.start} às ${item.end} · ${formatMinutes(extraMinutes)}</small>
          </div>
          <button class="delete-btn" data-id="${item.id}">Excluir</button>
        `;
        historyList.appendChild(li);
      });
  }

  const resumoSemana = document.getElementById('resumoSemana');
  resumoSemana.innerHTML = '';

  const weekOrder = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const labels = {
    monday: 'Segunda',
    tuesday: 'Terça',
    wednesday: 'Quarta',
    thursday: 'Quinta',
    friday: 'Sexta',
    saturday: 'Sábado',
    sunday: 'Domingo'
  };

  weekOrder.forEach((dayKey) => {
    const item = state.schedule[dayKey];
    const row = document.createElement('div');
    row.className = 'week-item';
    row.innerHTML = `
      <span>${labels[dayKey]}</span>
      <strong>${item.entrada && item.saida ? `${item.entrada} - ${item.saida}` : 'Feriado / livre'}</strong>
    `;
    resumoSemana.appendChild(row);
  });

  const monthSummary = document.getElementById('monthSummary');
  monthSummary.innerHTML = '';

  const fechamentoDia = Number(state.settings.diaFechamentoMes || 30);
  const hoje = new Date();
  const currentMonth = hoje.getMonth();
  const monthRegistrations = state.registrations.filter((item) => {
    const itemDate = new Date(`${item.date}T12:00:00`);
    const itemMonth = itemDate.getMonth();
    const itemDay = itemDate.getDate();

    if (itemDay <= fechamentoDia) {
      return itemMonth === currentMonth;
    }

    return itemMonth === (hoje.getDate() <= fechamentoDia ? currentMonth : (currentMonth + 1) % 12);
  });

  const monthExtra = monthRegistrations.reduce((sum, item) => sum + calculateExtraMinutes(item.date, item.start, item.end, item.lunchStart, item.lunchEnd), 0);
  const monthPaid = monthRegistrations.filter((item) => item.type === 'final_mes').reduce((sum, item) => sum + calculateExtraValue(calculateExtraMinutes(item.date, item.start, item.end, item.lunchStart, item.lunchEnd), item.date), 0);
  const monthBank = monthRegistrations.filter((item) => item.type === 'banco').reduce((sum, item) => sum + calculateExtraValue(calculateExtraMinutes(item.date, item.start, item.end, item.lunchStart, item.lunchEnd), item.date), 0);

  monthSummary.innerHTML = `
    <div class="month-summary-card">
      <strong>Horas extras do mês</strong>
      <span>${formatMinutes(monthExtra)}</span>
    </div>
    <div class="month-summary-card finance-card">
      <strong>Pagamento final</strong>
      <span>${currency(monthPaid)}</span>
    </div>
    <div class="month-summary-card finance-card">
      <strong>Banco</strong>
      <span>${currency(monthBank)}</span>
    </div>
  `;

  const feedbackList = document.getElementById('feedbackList');
  feedbackList.innerHTML = '';

  if (state.feedbacks.length === 0) {
    feedbackList.innerHTML = '<div class="feedback-item"><strong>Nenhum feedback</strong><small>Seu feedback aparecerá aqui.</small></div>';
  } else {
    [...state.feedbacks]
      .slice(-3)
      .reverse()
      .forEach((item) => {
        const card = document.createElement('div');
        card.className = 'feedback-item';
        card.innerHTML = `
          <strong>${item.type} · Nota ${item.note}</strong>
          <small>${item.message}</small>
        `;
        feedbackList.appendChild(card);
      });
  }

  applyFinanceVisibility();

  document.querySelectorAll('.delete-btn').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset.id;
      state.registrations = state.registrations.filter((item) => item.id !== id);
      saveState();
      renderDashboard();
    });
  });
}

function renderScheduleTable() {
  const scheduleMap = {
    monday: 'Segunda-feira',
    tuesday: 'Terça-feira',
    wednesday: 'Quarta-feira',
    thursday: 'Quinta-feira',
    friday: 'Sexta-feira',
    saturday: 'Sábado',
    sunday: 'Domingo'
  };

  scheduleTableBody.innerHTML = Object.entries(scheduleMap)
    .map(([key, label]) => {
      const data = state.schedule[key] || { entrada: '', saida: '', almocoInicio: '', almocoFim: '' };
      return `
        <tr>
          <td>${label}</td>
          <td><input type="time" name="${key}.entrada" value="${data.entrada || ''}" /></td>
          <td><input type="time" name="${key}.saida" value="${data.saida || ''}" /></td>
          <td><input type="time" name="${key}.almocoInicio" value="${data.almocoInicio || ''}" /></td>
          <td><input type="time" name="${key}.almocoFim" value="${data.almocoFim || ''}" /></td>
        </tr>
      `;
    })
    .join('');
}

async function readApiResponse(response) {
  const responseText = await response.text();

  try {
    return JSON.parse(responseText);
  } catch {
    throw new Error('O servidor Flask não está ativo nesta página. Execute .venv/bin/python app.py.');
  }
}

async function loginUser(event) {
  event.preventDefault();
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value.trim();

  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const result = await readApiResponse(response);

    if (!response.ok || !result.ok) {
      throw new Error(result.message || 'Credenciais inválidas.');
    }

    if (result.state && typeof result.state === 'object') {
      state = { ...state, ...result.state };
    }

    state.user = {
      email: result.user.email,
      name: result.user.name
    };

    saveState();
    loginView.classList.add('hidden');
    appView.classList.remove('hidden');
    renderDashboard();
    return;
  } catch (error) {
    alert(error.message || 'Não foi possível entrar.');
  }
}

async function registerUser(event) {
  event.preventDefault();
  const registerStatus = document.getElementById('registerStatus');
  const name = document.getElementById('registerName').value.trim();
  const email = document.getElementById('registerEmail').value.trim();
  const password = document.getElementById('registerPassword').value.trim();

  registerStatus.textContent = 'Cadastrando...';
  registerStatus.className = 'auth-status';

  try {
    const response = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password })
    });

    const result = await readApiResponse(response);

    if (!response.ok || !result.ok) {
      throw new Error(result.message || 'Erro ao cadastrar.');
    }

    document.getElementById('email').value = email;
    document.getElementById('registerForm').reset();
    registerStatus.textContent = 'Cadastro realizado. Volte para o login para entrar.';
    registerStatus.classList.add('success-status');
    document.getElementById('email').value = email;
    showLoginScreen();
  } catch (error) {
    const message = error instanceof TypeError
      ? 'Não foi possível conectar ao servidor. Inicie o Flask com .venv/bin/python app.py.'
      : (error.message || 'Não foi possível cadastrar.');
    registerStatus.textContent = message;
    registerStatus.classList.add('error-status');
  }
}

async function logoutUser() {
  await fetch('/api/logout', { method: 'POST' }).catch(() => {});
  loginView.classList.remove('hidden');
  registerView.classList.add('hidden');
  appView.classList.add('hidden');
  document.getElementById('loginForm').reset();
  state = structuredClone(defaultState);
}

async function deleteAccount() {
  const confirmed = window.confirm('Excluir sua conta e todos os seus dados? Esta ação não pode ser desfeita.');
  if (!confirmed) return;

  const response = await fetch('/api/account', { method: 'DELETE' });
  const result = await readApiResponse(response);
  if (!response.ok || !result.ok) {
    throw new Error(result.message || 'Não foi possível excluir a conta.');
  }

  alert('Conta excluída com sucesso.');
  await logoutUser();
}

function showLoginScreen() {
  loginView.classList.remove('hidden');
  registerView.classList.add('hidden');
}

function showRegisterScreen() {
  loginView.classList.add('hidden');
  registerView.classList.remove('hidden');
}

function switchTab(targetId) {
  tabButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.target === targetId);
  });

  panels.forEach((panel) => {
    panel.classList.toggle('active-panel', panel.id === targetId);
  });
}

function registerExtraHour(event) {
  event.preventDefault();

  const start = document.getElementById('registroInicio').value;
  const end = document.getElementById('registroFim').value;
  const lunchStart = document.getElementById('almocoInicio').value;
  const lunchEnd = document.getElementById('almocoFim').value;
  const date = document.getElementById('registroData').value;
  const type = document.getElementById('registroTipo').value;
  const reason = document.getElementById('registroMotivo').value.trim();

  if (!start || !end || !date) {
    alert('Preencha data, entrada e saída.');
    return;
  }

  const finalMinutes = calculateExtraMinutes(date, start, end, lunchStart, lunchEnd);

  state.registrations.push({
    id: crypto.randomUUID(),
    date,
    type,
    start,
    end,
    lunchStart,
    lunchEnd,
    reason: reason || 'Sem observação',
    durationMinutes: finalMinutes
  });

  saveState();
  renderDashboard();
  registroForm.reset();
  document.getElementById('registroData').value = new Date().toISOString().slice(0, 10);
  alert('Registro salvo com sucesso!');
}

function saveSchedule(event) {
  event.preventDefault();
  const rows = scheduleTableBody.querySelectorAll('tr');

  rows.forEach((row) => {
    const cells = row.querySelectorAll('input');
    const name = cells[0].name.split('.')[0];
    const entry = cells[0].value;
    const exit = cells[1].value;
    const lunchStart = cells[2].value;
    const lunchEnd = cells[3].value;

    state.schedule[name] = {
      entrada: entry,
      saida: exit,
      almocoInicio: lunchStart,
      almocoFim: lunchEnd
    };
  });

  saveState();
  renderDashboard();
  alert('Horários da semana atualizados.');
}

function saveSettings(event) {
  event.preventDefault();
  const salarioMensal = Number(document.getElementById('salarioMensal').value || 0);
  const jornadaDiaria = Number(document.getElementById('jornadaDiaria').value || 8);
  const extraDiaUtil = Number(document.getElementById('extraDiaUtil').value || 0);
  const extraFimSemana = Number(document.getElementById('extraFimSemana').value || 0);
  const diaFechamentoMes = Number(document.getElementById('diaFechamentoMes').value || 30);
  const diaPagamento = Number(document.getElementById('diaPagamento').value || 5);

  state.settings = { salarioMensal, jornadaDiaria, extraDiaUtil, extraFimSemana, diaFechamentoMes, diaPagamento };
  saveState();
  renderDashboard();
  alert('Configurações salvas com sucesso!');
}

function saveFeedback(event) {
  event.preventDefault();
  const type = document.getElementById('feedbackTipo').value;
  const note = document.getElementById('feedbackNota').value;
  const message = document.getElementById('feedbackMensagem').value.trim();

  if (!message) {
    alert('Escreva uma mensagem para enviar o feedback.');
    return;
  }

  state.feedbacks.push({
    id: crypto.randomUUID(),
    type,
    note,
    message,
    createdAt: new Date().toISOString()
  });

  saveState();
  feedbackForm.reset();
  alert('Feedback enviado com sucesso!');
}

loginForm.addEventListener('submit', loginUser);
registerForm.addEventListener('submit', registerUser);
logoutBtn.addEventListener('click', logoutUser);
showRegisterBtn?.addEventListener('click', showRegisterScreen);
showLoginBtn?.addEventListener('click', showLoginScreen);

toggleFinanceVisibilityButton?.addEventListener('click', () => {
  financesHidden = !financesHidden;
  applyFinanceVisibility();
});

tabButtons.forEach((button) => {
  button.addEventListener('click', () => switchTab(button.dataset.target));
});

registroForm.addEventListener('submit', registerExtraHour);
horarioForm.addEventListener('submit', saveSchedule);
configForm.addEventListener('submit', saveSettings);
feedbackForm.addEventListener('submit', saveFeedback);
deleteAccountButton?.addEventListener('click', () => {
  deleteAccount().catch((error) => alert(error.message || 'Não foi possível excluir a conta.'));
});

document.getElementById('registroData').value = new Date().toISOString().slice(0, 10);

document.getElementById('salarioMensal').value = state.settings.salarioMensal;
document.getElementById('jornadaDiaria').value = state.settings.jornadaDiaria;
document.getElementById('extraDiaUtil').value = state.settings.extraDiaUtil;
document.getElementById('extraFimSemana').value = state.settings.extraFimSemana;
document.getElementById('diaFechamentoMes').value = state.settings.diaFechamentoMes || 30;
document.getElementById('diaPagamento').value = state.settings.diaPagamento || 5;

renderScheduleTable();
applyFinanceVisibility();
renderDashboard();
