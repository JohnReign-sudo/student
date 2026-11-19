
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
let isSyncing = false;

const quotes = [
  "You don't have to do everything at once. Just start.",
  "Progress is built one small step at a time.",
  "Your future self will thank you for starting today.",
  "A little effort every day adds up.",
  "Stay focused on the next step, not the whole staircase."
];

// OFFLINE STORAGE

function taskStorageKey() {
  return `studyflow_tasks_${user}`;
}

function queueStorageKey() {
  return `studyflow_queue_${user}`;
}

function loadTasksLocally() {
  if (!user) return [];

  try {
    return JSON.parse(localStorage.getItem(taskStorageKey()) || '[]');
  } catch {
    return [];
  }
}

function saveTasksLocally() {
  if (!user) return;

  localStorage.setItem(taskStorageKey(), JSON.stringify(tasks));
}

function getQueue() {
  if (!user) return [];

  try {
    return JSON.parse(localStorage.getItem(queueStorageKey()) || '[]');
  } catch {
    return [];
  }
}

function saveQueue(queue) {
  if (!user) return;

  localStorage.setItem(queueStorageKey(), JSON.stringify(queue));
}

function addToQueue(action) {
  const queue = getQueue();
  queue.push(action);
  saveQueue(queue);
}

function makeLocalId() {
  return 'local-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
}

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

// API HELPER

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

  if (response.status === 401 &&
      path !== '/api/login' &&
      path !== '/api/register') {
    logout(false);
    throw new Error('Your session expired. Please log in again.');
  }

  if (!response.ok) {
    throw new Error(data.error || data.message || 'Something went wrong.');
  }

  return data;
}

// FORMAT TASKS

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

function taskBody(task) {
  return {
    title: task.title,
    subject: task.subject,
    date: task.date,
    priority: task.priority,
    notes: task.notes,
    done: task.done
  };
}

// LOAD TASKS

async function loadTasks() {
  try {
    const data = await api('/api/tasks');
    const serverTasks = (data.tasks || []).map(formatTask);

    // Keep unsynced local tasks while online tasks are refreshed.
    const localTasks = tasks.filter(t =>
      String(t.id).startsWith('local-')
    );

    tasks = [...serverTasks, ...localTasks];

    saveTasksLocally();
    render();

    return true;
  } catch (error) {
    tasks = loadTasksLocally();
    render();
    throw error;
  }
}

// SAVE TASKS ONLINE

async function saveTaskOnline(task, isEditing) {
  const body = taskBody(task);

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

// OFFLINE TASK CHANGES

async function saveTask(task, isEditing) {
  const oldTasks = [...tasks];
  const oldTask = tasks.find(t => String(t.id) === String(task.id));

  if (isEditing) {
    tasks = tasks.map(t =>
      String(t.id) === String(task.id) ? task : t
    );
  } else {
    task.id = makeLocalId();
    tasks.push(task);
  }

  saveTasksLocally();
  render();

  try {
    if (!navigator.onLine) {
      throw new Error('You are offline.');
    }

    if (String(task.id).startsWith('local-')) {
      const result = await api('/api/tasks', {
        method: 'POST',
        body: JSON.stringify(taskBody(task))
      });

      const serverTask = result.task || result;
      if (serverTask.id) {
        task.id = serverTask.id;
        tasks = tasks.map(t =>
          String(t.id) === String(task.id) ||
          String(t.id).startsWith('local-') &&
          t.title === task.title &&
          t.date === task.date
            ? task
            : t
        );
        saveTasksLocally();
      }

      await loadTasks();
    } else {
      await saveTaskOnline(task, isEditing);
    }

    toast('Task saved successfully!');
  } catch (error) {
    // Queue only changes that still need to reach the server.
    const queue = getQueue();

    if (isEditing) {
      const existing = queue.findIndex(q =>
        String(q.id) === String(task.id)
      );

      if (existing !== -1 && queue[existing].type === 'create') {
        queue[existing].body = taskBody(task);
      } else if (existing !== -1) {
        queue[existing] = {
          type: 'update',
          id: task.id,
          body: taskBody(task)
        };
      } else {
        queue.push({
          type: 'update',
          id: task.id,
          body: taskBody(task)
        });
      }
    } else {
      queue.push({
        type: 'create',
        id: task.id,
        body: taskBody(task)
      });
    }

    saveQueue(queue);
    saveTasksLocally();
    render();

    toast('Saved on this device. Will sync when online.');
  }
}

// SYNC PENDING TASKS

async function syncPendingTasks() {
  if (!token || !user || !navigator.onLine || isSyncing) return;

  const queue = getQueue();
  if (!queue.length) return;

  isSyncing = true;
  const remaining = [];

  try {
    for (const action of queue) {
      try {
        if (action.type === 'create') {
          const result = await api('/api/tasks', {
            method: 'POST',
            body: JSON.stringify(action.body)
          });

          const created = result.task || result;

          if (created.id) {
            tasks = tasks.map(t =>
              String(t.id) === String(action.id)
                ? formatTask(created)
                : t
            );
          }
        }

        if (action.type === 'update') {
          await api(`/api/tasks/${encodeURIComponent(action.id)}`, {
            method: 'PUT',
            body: JSON.stringify(action.body)
          });
        }

        if (action.type === 'delete') {
          await api(`/api/tasks/${encodeURIComponent(action.id)}`, {
            method: 'DELETE'
          });
        }
      } catch (error) {
        remaining.push(action);

        // Keep later operations in order if one fails.
        const index = queue.indexOf(action);
        remaining.push(...queue.slice(index + 1));
        break;
      }
    }

    saveQueue(remaining);

    if (remaining.length === 0) {
      await loadTasks();
      toast('Your offline changes have synced!');
    } else {
      saveTasksLocally();
      render();
    }
  } finally {
    isSyncing = false;
  }
}

// AUTH SCREEN

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

// LOGIN AND REGISTRATION

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
    toast(navigator.onLine
      ? error.message
      : 'Internet required for your first login. Try again when online.');
  } finally {
    button.disabled = false;
    setAuthMode();
  }
});

// LOGOUT

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

// START APP

async function start() {
  if (!token || !user) {
    $('#loginView').classList.remove('hidden');
    $('#appView').classList.add('hidden');
    return;
  }

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

  // Show local tasks immediately.
  tasks = loadTasksLocally();
  render();

  if (navigator.onLine) {
    try {
      await loadTasks();
      await syncPendingTasks();
    } catch (error) {
      console.log('Using offline tasks:', error.message);
    }
  }

  updateConnectionStatus();
}

// CONNECTION STATUS

function updateConnectionStatus() {
  let status = $('#connectionStatus');

  if (!status) {
    status = document.createElement('div');
    status.id = 'connectionStatus';
    status.style.cssText =
      'position:fixed;bottom:12px;right:12px;z-index:9999;padding:8px 12px;border-radius:20px;font-size:12px;background:#333;color:white;';
    document.body.appendChild(status);
  }

  const pending = getQueue().length;

  if (navigator.onLine) {
    status.textContent = pending
      ? `Online · ${pending} pending changes`
      : 'Online';
  } else {
    status.textContent = 'Offline · Changes saved on device';
  }
}

window.addEventListener('online', async () => {
  updateConnectionStatus();
  toast('Internet connection restored. Syncing...');
  await syncPendingTasks();
  updateConnectionStatus();
});

window.addEventListener('offline', () => {
  updateConnectionStatus();
  toast('You are offline. Tasks will be saved locally.');
});

// DASHBOARD

function render() {
  renderStats();
  renderUpcoming();
  renderTasks();
  renderCalendar();
  updateConnectionStatus();
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
      data-done="${escapeHTML(t.id)}" ${t.done ? 'checked' : ''}
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
      <button class="mini-btn" data-edit="${escapeHTML(t.id)}"
        aria-label="Edit task">✎</button>
      <button class="mini-btn" data-delete="${escapeHTML(t.id)}"
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

// CALENDAR

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

// NAVIGATION AND TASK ACTIONS

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
    const id = del.dataset.delete;
    const task = tasks.find(t => String(t.id) === id);

    if (!task) return;

    tasks = tasks.filter(t => String(t.id) !== id);
    saveTasksLocally();
    render();

    const queue = getQueue();

    if (String(id).startsWith('local-')) {
      saveQueue(queue.filter(q => String(q.id) !== id));
      toast('Task deleted');
    } else {
      try {
        if (!navigator.onLine) throw new Error('Offline');

        await api(`/api/tasks/${encodeURIComponent(id)}`, {
          method: 'DELETE'
        });

        toast('Task deleted');
      } catch {
        addToQueue({ type: 'delete', id });
        toast('Deleted locally. Will sync when online.');
      }
    }
  }

  const day = e.target.closest('[data-date]');
  if (day) {
    selectedDate = day.dataset.date;
    renderCalendar();
  }
});

// COMPLETE TASK

document.addEventListener('change', async e => {
  if (!e.target.matches('[data-done]')) return;

  const t = tasks.find(x => String(x.id) === e.target.dataset.done);
  if (!t) return;

  const oldDone = t.done;
  t.done = e.target.checked;

  saveTasksLocally();
  render();

  try {
    if (!navigator.onLine) throw new Error('Offline');

    if (String(t.id).startsWith('local-')) {
      const queue = getQueue();
      const create = queue.find(q =>
        q.type === 'create' && String(q.id) === String(t.id)
      );

      if (create) {
        create.body = taskBody(t);
        saveQueue(queue);
      } else {
        throw new Error('Offline');
      }
    } else {
      await api(`/api/tasks/${encodeURIComponent(t.id)}`, {
        method: 'PUT',
        body: JSON.stringify(taskBody(t))
      });
    }

    toast(t.done ? 'Task completed!' : 'Task reopened');
  } catch {
    const queue = getQueue();
    const existing = queue.find(q =>
      String(q.id) === String(t.id) && q.type !== 'delete'
    );

    if (existing) {
      existing.body = taskBody(t);
    } else if (!String(t.id).startsWith('local-')) {
      queue.push({
        type: 'update',
        id: t.id,
        body: taskBody(t)
      });
    }

    saveQueue(queue);
    toast('Saved on this device. Will sync later.');
  }
});

// ADD OR EDIT TASK

$('#taskForm').addEventListener('submit', async e => {
  e.preventDefault();

  const id = $('#taskId').value;
  const old = tasks.find(t => String(t.id) === id);

  const task = {
    id: id || makeLocalId(),
    title: $('#taskTitle').value.trim(),
    subject: $('#taskSubject').value.trim(),
    date: $('#taskDate').value,
    priority: $('#taskPriority').value,
    notes: $('#taskNotes').value.trim(),
    done: old?.done || false
  };

  if (!task.title || !task.date) {
    toast('Please enter a task title and due date.');
    return;
  }

  await saveTask(task, Boolean(id));

  $('#taskDialog').close();
});

// DIALOG CONTROLS

$('#addTaskBtn').onclick = () => openTask();

$('#closeDialog').onclick = $('#cancelDialog').onclick = () => {
  $('#taskDialog').close();
};

// SEARCH AND FILTERS

$('#searchTasks').oninput = renderTasks;
$('#filterTasks').onchange = renderTasks;

// DARK MODE

$('#themeBtn').onclick = () => {
  document.body.classList.toggle('dark');

  localStorage.setItem(
    'studyflow_dark',
    document.body.classList.contains('dark') ? '1' : '0'
  );
};

// CALENDAR NAVIGATION

$('#prevMonth').onclick = () => {
  calDate.setMonth(calDate.getMonth()-1);
  renderCalendar();
};

$('#nextMonth').onclick = () => {
  calDate.setMonth(calDate.getMonth()+1);
  renderCalendar();
};

// NOTIFICATIONS - WEB PUSH

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

// RESTORE APPEARANCE

if (localStorage.getItem('studyflow_dark') === '1') {
  document.body.classList.add('dark');
}

// SERVICE WORKER

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(error => {
      console.error('Service worker registration failed:', error);
    });
  });
}

// INITIAL SETUP

setAuthMode();
start();
