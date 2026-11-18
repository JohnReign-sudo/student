
const $ = s => document.querySelector(s);

const API_BASE = 'https://studyflow-api-t3p9.onrender.com';

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};

let token = localStorage.getItem('studyflow_token') || '';
let user = localStorage.getItem('studyflow_username') || '';
let tasks = [];
let page = 'dashboard';
let calDate = new Date();
let selectedDate = todayISO();
let isRegistering = false;

const quotes = [
  "You don't have to do everything at once. Just start.",
  "Progress is built one small step at a time.",
  "Your future self will thank you for starting today.",
  "A little effort every day adds up.",
  "Stay focused on the next step, not the whole staircase."
];

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2300);
}

function safeDate(s) {
  return new Date(s + 'T12:00:00');
}

function dateLabel(s) {
  return safeDate(s).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function escapeHTML(s = '') {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;',
    '<':'&lt;',
    '>':'&gt;',
    '"':'&quot;',
    "'":'&#39;'
  }[c]));
}

// API helper
async function api(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(API_BASE + path, {
    ...options,
    headers
  });

  const data = await response.json().catch(() => ({}));

  if (response.status === 401 && path !== '/api/login' && path !== '/api/register') {
    logout(false);
    throw new Error('Your session expired. Please log in again.');
  }

  if (!response.ok) {
    throw new Error(data.error || data.message || 'Something went wrong.');
  }

  return data;
}

// Convert database task into the format used by the website
function formatTask(t) {
  return {
    id: t.id,
    title: t.title || '',
    subject: t.subject || '',
    date: String(t.due_date || t.date || '').slice(0, 10),
    priority: t.priority || 'normal',
    notes: t.description || t.notes || '',
    done: Boolean(t.completed ?? t.done)
  };
}

// Load this account's tasks
async function loadTasks() {
  const data = await api('/api/tasks');
  tasks = (data.tasks || []).map(formatTask);
  render();
}

// Save a task to the database
async function saveTaskOnline(task, isEditing) {
  const body = {
    title: task.title,
    subject: task.subject,
    date: task.date,
    priority: task.priority,
    notes: task.notes,
    done: task.done
  };

  if (isEditing) {
    await api(`/api/tasks/${encodeURIComponent(task.id)}`, {
      method: 'PUT',
      body: JSON.stringify(body)
    });
  } else {
    await api('/api/tasks', {
      method: 'POST',
      body: JSON.stringify(body)
    });
  }

  await loadTasks();
}

// Registration/login screen
function setAuthMode() {
  $('#authSubmit').textContent = isRegistering ? 'Create account' : 'Log in';

  $('#authToggle').textContent = isRegistering
    ? 'Already have an account? Log in'
    : 'Create a new account';

  $('#authMessage').textContent = isRegistering
    ? 'Create an account with a username and password.'
    : 'Log in to access your saved tasks.';

  $('#password').setAttribute(
    'autocomplete',
    isRegistering ? 'new-password' : 'current-password'
  );

  $('#password').minLength = isRegistering ? 10 : 1;
}

$('#authToggle').addEventListener('click', () => {
  isRegistering = !isRegistering;
  setAuthMode();
});

// Log in or register
$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();

  const username = $('#username').value.trim();
  const password = $('#password').value;
  const button = $('#authSubmit');

  if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
    toast('Username must be 3-30 letters, numbers, or underscores.');
    return;
  }

  if (password.length < 10 || password.length > 72) {
    toast('Password must be between 10 and 72 characters.');
    return;
  }

  button.disabled = true;
  button.textContent = 'Please wait...';

  try {
    if (isRegistering) {
      await api('/api/register', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      });
    }

    const data = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });

    token = data.token;
    user = data.user.username;

    localStorage.setItem('studyflow_token', token);
    localStorage.setItem('studyflow_username', user);

    isRegistering = false;
    setAuthMode();
    $('#password').value = '';

    await start();
    toast('Welcome to StudyFlow!');
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
    setAuthMode();
  }
});

// Log out
function logout(showMessage = true) {
  token = '';
  user = '';
  tasks = [];

  localStorage.removeItem('studyflow_token');
  localStorage.removeItem('studyflow_username');

  $('#loginView').classList.remove('hidden');
  $('#appView').classList.add('hidden');
  $('#username').value = '';
  $('#password').value = '';

  if (showMessage) toast('You have logged out.');
}

$('#switchUser').onclick = () => {
  if (confirm('Are you sure you want to log out?')) {
    logout();
  }
};

// Start application
async function start() {
  if (!token) {
    $('#loginView').classList.remove('hidden');
    $('#appView').classList.add('hidden');
    return;
  }

  try {
    const me = await api('/api/me');
    user = me.user.username;

    localStorage.setItem('studyflow_username', user);

    $('#loginView').classList.add('hidden');
    $('#appView').classList.remove('hidden');

    $('#sideUser').textContent = user;
    $('#avatar').textContent = user[0].toUpperCase();
    $('#welcomeTitle').textContent = `Welcome back, ${user}!`;

    $('#todayLabel').textContent = new Date().toLocaleDateString(
      undefined,
      { weekday:'long', month:'long', day:'numeric' }
    ).toUpperCase();

    $('#quoteText').textContent =
      quotes[new Date().getDate() % quotes.length];

    await loadTasks();
  } catch (error) {
    toast(error.message);
  }
}

// Dashboard and task display
function render() {
  renderStats();
  renderUpcoming();
  renderTasks();
  renderCalendar();
}

function renderStats() {
  const active = tasks.filter(t => !t.done);
  const today = todayISO();

  $('#totalCount').textContent = tasks.length;
  $('#doneCount').textContent = tasks.length - active.length;

  $('#soonCount').textContent = active.filter(t => {
    const n = (safeDate(t.date) - safeDate(today)) / 86400000;
    return n >= 0 && n <= 3;
  }).length;

  $('#overdueCount').textContent =
    active.filter(t => t.date < today).length;
}

function taskHTML(t) {
  return `<div class="task-row ${t.done ? 'done' : ''}">
    <input class="task-check" type="checkbox"
      data-done="${t.id}" ${t.done ? 'checked' : ''}
      aria-label="Mark completed">

    <div class="task-info">
      <div class="task-name">${escapeHTML(t.title)}</div>
      <div class="task-meta">
        ${escapeHTML(t.subject || 'No subject')} · ${dateLabel(t.date)}
        ${t.notes ? ' · ' + escapeHTML(t.notes) : ''}
      </div>
    </div>

    <span class="priority ${escapeHTML(t.priority)}">
      ${escapeHTML(t.priority.toUpperCase())}
    </span>

    <div class="row-actions">
      <button class="mini-btn" data-edit="${t.id}"
        aria-label="Edit task">✎</button>
      <button class="mini-btn" data-delete="${t.id}"
        aria-label="Delete task">×</button>
    </div>
  </div>`;
}

function renderUpcoming() {
  const list = tasks
    .filter(t => !t.done && t.date >= todayISO())
    .sort((a,b) => a.date.localeCompare(b.date))
    .slice(0,5);

  $('#upcomingList').innerHTML = list.length
    ? list.map(taskHTML).join('')
    : '<div class="empty">No upcoming tasks. Add one when you are ready!</div>';
}

function renderTasks() {
  const q = $('#searchTasks').value.toLowerCase();
  const f = $('#filterTasks').value;

  const list = tasks
    .filter(t =>
      (t.title + ' ' + t.subject).toLowerCase().includes(q) &&
      (f === 'all' || (f === 'done' ? t.done : !t.done))
    )
    .sort((a,b) => a.date.localeCompare(b.date));

  $('#allTasksList').innerHTML = list.length
    ? list.map(taskHTML).join('')
    : '<div class="empty">No tasks found. Click “Add task” to create your first one.</div>';
}

function showPage(p) {
  page = p;

  ['dashboard','tasks','calendar'].forEach(x => {
    $('#' + x + 'Page').classList.toggle('hidden', x !== p);
    document.querySelector(`[data-page="${x}"]`)
      .classList.toggle('active', x === p);
  });

  $('#pageTitle').textContent = p[0].toUpperCase() + p.slice(1);

  if (p === 'calendar') renderCalendar();
}

function openTask(t) {
  $('#taskForm').reset();
  $('#taskId').value = t?.id ?? '';
  $('#dialogTitle').textContent = t ? 'Edit task' : 'Add a task';
  $('#taskTitle').value = t?.title || '';
  $('#taskSubject').value = t?.subject || '';
  $('#taskDate').value = t?.date || todayISO();
  $('#taskPriority').value = t?.priority || 'normal';
  $('#taskNotes').value = t?.notes || '';
  $('#taskDialog').showModal();
}

// Calendar
function renderCalendar() {
  const y = calDate.getFullYear();
  const m = calDate.getMonth();
  const first = new Date(y,m,1);
  const days = new Date(y,m+1,0).getDate();

  $('#monthName').textContent =
    first.toLocaleDateString(undefined, {month:'long',year:'numeric'});

  let html = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
    .map(x => `<div class="cal-head">${x}</div>`).join('');

  for (let i = 0; i < first.getDay(); i++) {
    html += '<div class="cal-day blank"></div>';
  }

  for (let d = 1; d <= days; d++) {
    const iso = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const has = tasks.some(t => t.date === iso);

    html += `<button class="cal-day ${iso === todayISO() ? 'today' : ''} ${iso === selectedDate ? 'selected' : ''}" data-date="${iso}">
      ${d}${has ? '<span class="dot"></span>' : ''}
    </button>`;
  }

  $('#calendarGrid').innerHTML = html;

  const onDay = tasks.filter(t => t.date === selectedDate);

  $('#selectedDayTasks').innerHTML =
    `<h4>${dateLabel(selectedDate)}</h4>` +
    (onDay.length
      ? onDay.map(taskHTML).join('')
      : '<div class="empty">No tasks due on this day.</div>');
}

// Navigation and task actions
document.addEventListener('click', async e => {
  const n = e.target.closest('[data-page]');
  if (n) showPage(n.dataset.page);

  const g = e.target.closest('[data-goto]');
  if (g) showPage(g.dataset.goto);

  const edit = e.target.closest('[data-edit]');
  if (edit) {
    const t = tasks.find(x => String(x.id) === edit.dataset.edit);
    if (t) openTask(t);
  }

  const del = e.target.closest('[data-delete]');
  if (del && confirm('Delete this task?')) {
    try {
      await api(`/api/tasks/${encodeURIComponent(del.dataset.delete)}`, {
        method: 'DELETE'
      });

      await loadTasks();
      toast('Task deleted');
    } catch (error) {
      toast(error.message);
    }
  }

  const day = e.target.closest('[data-date]');
  if (day) {
    selectedDate = day.dataset.date;
    renderCalendar();
  }
});

// Complete or reopen a task
document.addEventListener('change', async e => {
  if (!e.target.matches('[data-done]')) return;

  const t = tasks.find(x => String(x.id) === e.target.dataset.done);
  if (!t) return;

  const oldDone = t.done;
  t.done = e.target.checked;

  try {
    await saveTaskOnline(t, true);
    toast(t.done ? 'Task completed!' : 'Task reopened');
  } catch (error) {
    t.done = oldDone;
    render();
    toast(error.message);
  }
});

// Add or edit a task
$('#taskForm').addEventListener('submit', async e => {
  e.preventDefault();

  const id = $('#taskId').value;
  const old = tasks.find(t => String(t.id) === id);

  const task = {
    id,
    title: $('#taskTitle').value.trim(),
    subject: $('#taskSubject').value.trim(),
    date: $('#taskDate').value,
    priority: $('#taskPriority').value,
    notes: $('#taskNotes').value.trim(),
    done: old?.done || false
  };

  try {
    await saveTaskOnline(task, Boolean(id));
    $('#taskDialog').close();
    toast('Task saved successfully!');
  } catch (error) {
    toast(error.message);
  }
});

// Dialog controls
$('#addTaskBtn').onclick = () => openTask();

$('#closeDialog').onclick = $('#cancelDialog').onclick = () => {
  $('#taskDialog').close();
};

// Search and filters
$('#searchTasks').oninput = renderTasks;
$('#filterTasks').onchange = renderTasks;

// Dark mode
$('#themeBtn').onclick = () => {
  document.body.classList.toggle('dark');

  localStorage.setItem(
    'studyflow_dark',
    document.body.classList.contains('dark') ? '1' : '0'
  );
};

// Calendar navigation
$('#prevMonth').onclick = () => {
  calDate.setMonth(calDate.getMonth()-1);
  renderCalendar();
};

$('#nextMonth').onclick = () => {
  calDate.setMonth(calDate.getMonth()+1);
  renderCalendar();
};

// Notifications - Web Push
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = atob(base64);

  return Uint8Array.from(
    [...rawData].map(char => char.charCodeAt(0))
  );
}

$('#notifyBtn').onclick = async () => {
  try {
    if (!token) {
      toast('Please log in first.');
      return;
    }

    if (!('serviceWorker' in navigator) ||
        !('PushManager' in window) ||
        !('Notification' in window)) {
      toast('Web Push is not supported in this browser.');
      return;
    }

    if (!window.isSecureContext) {
      toast('Notifications require a secure HTTPS connection.');
      return;
    }

    const permission = await Notification.requestPermission();

    if (permission !== 'granted') {
      toast('Notification permission was not granted.');
      return;
    }

    toast('Connecting notifications...');

    const registration = await navigator.serviceWorker.ready;

    const keyData = await api('/api/push/public-key');

    if (!keyData.publicKey) {
      throw new Error('The push public key was not returned by the server.');
    }

    const applicationServerKey =
      urlBase64ToUint8Array(keyData.publicKey);

    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey
      });
    }

    await api('/api/push/subscribe', {
      method: 'POST',
      body: JSON.stringify(subscription)
    });

    toast('Notifications enabled! Sending a test...');

    await api('/api/push/test', {
      method: 'POST',
      body: JSON.stringify({})
    });

    toast('Success! Check your notifications.');
  } catch (error) {
    console.error('Push notification error:', error);
    toast(error.message || 'Could not enable notifications.');
  }
};

// Restore saved appearance
if (localStorage.getItem('studyflow_dark') === '1') {
  document.body.classList.add('dark');
}

// Service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(error => {
      console.error('Service worker registration failed:', error);
    });
  });
}

// Initial setup
setAuthMode();
start();
