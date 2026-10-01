const STORAGE_KEY = "small-wins-v1";
const localMessages = [
  "Nice. One less thing on your mind.",
  "Handled. That counts.",
  "Small win, real progress.",
  "Done. Keep the momentum.",
  "You showed up. Keep going.",
  "Another thing moved forward.",
  "Good work. Let that feel good.",
  "Future you appreciates that.",
  "One step lighter.",
  "Progress looks good on you.",
  "That moved the day forward.",
  "Done is a good feeling.",
  "A little lighter now.",
  "Another promise kept.",
  "Momentum, one step at a time.",
  "You made progress today.",
  "That one is behind you now.",
  "Good. Keep choosing forward.",
  "One more thing handled.",
  "That effort counted.",
  "Clearer list. Clearer mind.",
  "You got it done.",
  "Quiet progress is still progress.",
  "Nice follow-through.",
  "Keep stacking small wins."
];

let state = { tasks: [], xp: 0 };
let toastTimer = null;
let reminderLoop = null;
let editingId = null;
let lastCompletedId = null;

const $ = (id) => document.getElementById(id);
const els = {
  dateLabel: $("dateLabel"), greeting: $("greeting"), xpValue: $("xpValue"),
  openCount: $("openCount"), doneTodayCount: $("doneTodayCount"),
  taskForm: $("taskForm"), taskInput: $("taskInput"), remindToggle: $("remindToggle"),
  remindToggleText: $("remindToggleText"), clearDraftReminder: $("clearDraftReminder"),
  reminderPanel: $("reminderPanel"), reminderInput: $("reminderInput"),
  taskList: $("taskList"), completedList: $("completedList"), emptyState: $("emptyState"),
  completedSection: $("completedSection"), completedToggle: $("completedToggle"),
  completedBody: $("completedBody"), completedCount: $("completedCount"), clearCompleted: $("clearCompleted"),
  toast: $("toast"), toastTitle: $("toastTitle"), toastMessage: $("toastMessage"),
  toastXp: $("toastXp"), undoButton: $("undoButton"), confetti: $("confetti"),
  editDialog: $("editDialog"), editForm: $("editForm"), editTitle: $("editTitle"), editReminder: $("editReminder"),
  closeEdit: $("closeEdit"), cancelEdit: $("cancelEdit"), deleteFromEdit: $("deleteFromEdit"),
  settingsButton: $("settingsButton"), settingsDialog: $("settingsDialog"), closeSettings: $("closeSettings"),
};

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  }[ch]));
}

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function setDateAndGreeting() {
  const now = new Date();
  els.dateLabel.textContent = new Intl.DateTimeFormat(undefined, {
    weekday: "long", month: "long", day: "numeric"
  }).format(now);
  const hour = now.getHours();
  els.greeting.textContent = hour < 12 ? "Good morning." : hour < 18 ? "Good afternoon." : "Good evening.";
}

function sameLocalDay(timestamp, reference = Date.now()) {
  if (!timestamp) return false;
  const a = new Date(timestamp);
  const b = new Date(reference);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function toLocalInputValue(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return shifted.toISOString().slice(0, 16);
}

function fromLocalInputValue(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function reminderLabel(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const day = sameLocalDay(date.getTime(), now.getTime())
    ? "Today"
    : sameLocalDay(date.getTime(), tomorrow.getTime())
      ? "Tomorrow"
      : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
  const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
  return `${day}, ${time}`;
}

function normalizeState(raw) {
  return {
    tasks: Array.isArray(raw?.tasks) ? raw.tasks.map((t) => ({
      id: String(t.id || uid()),
      title: String(t.title || "Untitled task").slice(0, 160),
      createdAt: Number(t.createdAt) || Date.now(),
      completed: Boolean(t.completed),
      completedAt: t.completedAt ? Number(t.completedAt) : null,
      xpAwarded: Boolean(t.xpAwarded),
      reminderAt: t.reminderAt || null,
      remindedAt: t.remindedAt || null
    })) : [],
    xp: Number.isFinite(Number(raw?.xp)) ? Number(raw.xp) : 0
  };
}

function loadState() {
  try {
    state = normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY)));
  } catch {
    state = { tasks: [], xp: 0 };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function render() {
  const open = state.tasks.filter(t => !t.completed).sort((a, b) => a.createdAt - b.createdAt);
  const done = state.tasks.filter(t => t.completed).sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
  const doneToday = done.filter(t => sameLocalDay(t.completedAt)).length;

  els.xpValue.textContent = String(state.xp);
  els.openCount.textContent = String(open.length);
  els.doneTodayCount.textContent = String(doneToday);
  els.emptyState.hidden = open.length > 0;
  els.completedSection.hidden = done.length === 0;
  els.completedCount.textContent = String(done.length);

  els.taskList.innerHTML = open.map(taskHtml).join("");
  els.completedList.innerHTML = done.map(taskHtml).join("");
  bindTaskEvents();
  updateNotificationUI();
}

function taskHtml(task) {
  const due = task.reminderAt ? new Date(task.reminderAt).getTime() : null;
  const overdue = Boolean(due && due <= Date.now() && !task.completed);
  return `
    <li class="task-item" data-id="${escapeHtml(task.id)}">
      <button class="check ${task.completed ? "done" : ""}" type="button" aria-label="${task.completed ? "Mark incomplete" : "Complete task"}">${task.completed ? "✓" : ""}</button>
      <div class="task-main">
        <span class="task-title">${escapeHtml(task.title)}</span>
        ${task.reminderAt ? `<span class="task-meta ${overdue ? "overdue" : ""}">◷ ${overdue ? "Due · " : ""}${escapeHtml(reminderLabel(task.reminderAt))}</span>` : ""}
      </div>
      <div class="task-actions">
        <button class="task-action edit" type="button">Edit</button>
        <button class="task-action delete" type="button" aria-label="Delete task">×</button>
      </div>
    </li>`;
}

function bindTaskEvents() {
  document.querySelectorAll(".task-item").forEach((row) => {
    const id = row.dataset.id;
    row.querySelector(".check")?.addEventListener("click", () => toggleTask(id));
    row.querySelector(".edit")?.addEventListener("click", () => openEdit(id));
    row.querySelector(".delete")?.addEventListener("click", () => deleteTask(id));
  });
}

function addTask(title, reminderAt) {
  state.tasks.unshift({
    id: uid(), title, createdAt: Date.now(), completed: false, completedAt: null,
    xpAwarded: false, reminderAt: reminderAt || null, remindedAt: null
  });
  saveState();
  render();
}

function toggleTask(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;

  if (!task.completed) {
    task.completed = true;
    task.completedAt = Date.now();
    let earned = 0;
    if (!task.xpAwarded) {
      task.xpAwarded = true;
      state.xp += 10;
      earned = 10;
    }
    lastCompletedId = task.id;
    saveState();
    render();
    celebrate(task, earned);
  } else {
    task.completed = false;
    task.completedAt = null;
    lastCompletedId = null;
    saveState();
    render();
  }
}

function deleteTask(id) {
  state.tasks = state.tasks.filter(t => t.id !== id);
  saveState();
  render();
}

function undoLastCompletion() {
  if (!lastCompletedId) return;
  const task = state.tasks.find(t => t.id === lastCompletedId);
  if (!task || !task.completed) return;
  task.completed = false;
  task.completedAt = null;
  lastCompletedId = null;
  saveState();
  render();
  hideToast();
}

function randomLocalMessage() {
  return localMessages[Math.floor(Math.random() * localMessages.length)];
}

function showToast(title, message, xpText = "", allowUndo = false) {
  clearTimeout(toastTimer);
  els.toast.hidden = false;
  els.toast.classList.remove("hide", "show");
  void els.toast.offsetWidth;
  els.toastTitle.textContent = title;
  els.toastMessage.textContent = message;
  els.toastXp.textContent = xpText;
  els.undoButton.hidden = !allowUndo;
  els.toast.classList.add("show");
  toastTimer = setTimeout(hideToast, 4400);
}

function hideToast() {
  clearTimeout(toastTimer);
  if (els.toast.hidden) return;
  els.toast.classList.remove("show");
  els.toast.classList.add("hide");
  setTimeout(() => { els.toast.hidden = true; }, 220);
}

function celebrate(task, earned) {
  showToast("Nice work.", randomLocalMessage(), earned ? `+${earned} XP` : "Done ✓", true);
  burstConfetti();
}

function burstConfetti() {
  const colors = ["#6d5dfc", "#9d8cff", "#f2bd4c", "#48b583", "#ef7a78"];
  els.confetti.innerHTML = "";
  for (let i = 0; i < 14; i++) {
    const piece = document.createElement("span");
    piece.className = "confetti-piece";
    const angle = (Math.PI * 2 * i) / 14 + (Math.random() * .4 - .2);
    const distance = 60 + Math.random() * 100;
    piece.style.setProperty("--x", `${Math.cos(angle) * distance}px`);
    piece.style.setProperty("--y", `${Math.sin(angle) * distance}px`);
    piece.style.setProperty("--r", `${Math.random() * 360 - 180}deg`);
    piece.style.background = colors[i % colors.length];
    piece.style.animationDelay = `${Math.random() * 70}ms`;
    els.confetti.appendChild(piece);
  }
  setTimeout(() => { els.confetti.innerHTML = ""; }, 1000);
}


function presetReminder(kind) {
  const now = new Date();
  let target;
  if (kind === "hour") {
    target = new Date(now.getTime() + 60 * 60 * 1000);
  } else if (kind === "tonight") {
    target = new Date(now);
    target.setHours(19, 0, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
  } else {
    target = new Date(now);
    target.setDate(target.getDate() + 1);
    target.setHours(9, 0, 0, 0);
  }
  els.reminderInput.value = toLocalInputValue(target.getTime());
  updateDraftReminderLabel();
}

function updateDraftReminderLabel() {
  const reminder = fromLocalInputValue(els.reminderInput.value);
  if (reminder) {
    els.remindToggleText.textContent = reminderLabel(reminder);
    els.remindToggle.classList.add("active");
    els.clearDraftReminder.hidden = false;
  } else {
    els.remindToggleText.textContent = "Add reminder";
    els.remindToggle.classList.remove("active");
    els.clearDraftReminder.hidden = true;
  }
}

function clearDraftReminder() {
  els.reminderInput.value = "";
  els.reminderPanel.hidden = true;
  els.remindToggle.setAttribute("aria-expanded", "false");
  updateDraftReminderLabel();
}

function openEdit(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  editingId = id;
  els.editTitle.value = task.title;
  els.editReminder.value = toLocalInputValue(task.reminderAt);
  els.editDialog.showModal();
  setTimeout(() => els.editTitle.focus(), 0);
}

function closeEdit() {
  editingId = null;
  if (els.editDialog.open) els.editDialog.close();
}

function saveEdit() {
  const task = state.tasks.find(t => t.id === editingId);
  const title = els.editTitle.value.trim();
  if (!task || !title) return;
  task.title = title;
  const nextReminder = fromLocalInputValue(els.editReminder.value);
  if (task.reminderAt !== nextReminder) task.remindedAt = null;
  task.reminderAt = nextReminder;
  saveState();
  render();
  closeEdit();
}

function checkReminders() {
  const now = Date.now();
  const due = state.tasks
    .filter((task) => !task.completed && task.reminderAt && !task.remindedAt)
    .filter((task) => {
      const when = new Date(task.reminderAt).getTime();
      return !Number.isNaN(when) && when <= now;
    })
    .sort((a, b) => new Date(a.reminderAt) - new Date(b.reminderAt));

  if (!due.length) return;

  due.forEach((task) => { task.remindedAt = now; });
  saveState();
  render();

  const latest = due[due.length - 1];
  const extra = due.length > 1 ? ` +${due.length - 1} more` : "";
  showToast("Reminder", `${latest.title}${extra}`, "", false);
}


els.taskForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const title = els.taskInput.value.trim();
  if (!title) return;
  const reminderAt = fromLocalInputValue(els.reminderInput.value);
  addTask(title, reminderAt);
  els.taskInput.value = "";
  clearDraftReminder();
  els.taskInput.focus();
});

els.remindToggle.addEventListener("click", () => {
  const opening = els.reminderPanel.hidden;
  els.reminderPanel.hidden = !opening;
  els.remindToggle.setAttribute("aria-expanded", String(opening));
});

document.querySelectorAll(".preset").forEach(button => {
  button.addEventListener("click", () => presetReminder(button.dataset.preset));
});
els.reminderInput.addEventListener("change", updateDraftReminderLabel);
els.clearDraftReminder.addEventListener("click", clearDraftReminder);

els.completedToggle.addEventListener("click", () => {
  const opening = els.completedBody.hidden;
  els.completedBody.hidden = !opening;
  els.completedToggle.setAttribute("aria-expanded", String(opening));
});
els.clearCompleted.addEventListener("click", () => {
  state.tasks = state.tasks.filter(t => !t.completed);
  saveState();
  render();
});

els.undoButton.addEventListener("click", undoLastCompletion);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") checkReminders();
});

els.editForm.addEventListener("submit", (event) => { event.preventDefault(); saveEdit(); });
els.closeEdit.addEventListener("click", closeEdit);
els.cancelEdit.addEventListener("click", closeEdit);
els.deleteFromEdit.addEventListener("click", () => {
  if (editingId) deleteTask(editingId);
  closeEdit();
});

els.settingsButton.addEventListener("click", () => {
  els.settingsDialog.showModal();
});
els.closeSettings.addEventListener("click", () => els.settingsDialog.close());

// Escape/backdrop clicks behave naturally on dialogs.
[els.editDialog, els.settingsDialog].forEach(dialog => {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
});

function init() {
  setDateAndGreeting();
  loadState();
  render();
  checkReminders();
  reminderLoop = setInterval(checkReminders, 15000);
  els.taskInput.focus();
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {});
  });
}

init();
