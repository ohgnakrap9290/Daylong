const dayNames = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];
const shortDays = ["일", "월", "화", "수", "목", "금", "토"];
const dailyRoutines = [
  { id: "protein", label: "프로틴", type: "check" },
  { id: "chicken", label: "닭가슴살", type: "check" },
  { id: "water", label: "물", type: "counter", target: 4, unit: "잔" },
  { id: "duolingo", label: "듀오링고", type: "check" },
  { id: "voca", label: "매일보카", type: "check" },
];

const state = {
  schedule: [],
  selectedDay: new Date().getDay(),
  activeView: "today",
  checks: JSON.parse(localStorage.getItem("daylong-checks") || "{}"),
  routines: JSON.parse(localStorage.getItem("daylong-routines") || "{}"),
};

const els = {
  dateLabel: document.querySelector("#dateLabel"),
  nowTask: document.querySelector("#nowTask"),
  doneCount: document.querySelector("#doneCount"),
  progressFill: document.querySelector("#progressFill"),
  tabs: document.querySelectorAll(".tab"),
  views: document.querySelectorAll(".view"),
  todayTitle: document.querySelector("#todayTitle"),
  todayTimeline: document.querySelector("#todayTimeline"),
  routinePanel: document.querySelector("#routinePanel"),
  routineCount: document.querySelector("#routineCount"),
  routineList: document.querySelector("#routineList"),
  weekStrip: document.querySelector("#weekStrip"),
  weekList: document.querySelector("#weekList"),
  themeToggle: document.querySelector("#themeToggle"),
  resetToday: document.querySelector("#resetToday"),
};

init();

async function init() {
  setTheme(localStorage.getItem("daylong-theme") || getPreferredTheme());
  bindEvents();

  try {
    const text = await fetch("data.txt", { cache: "no-store" }).then((res) => {
      if (!res.ok) throw new Error("data.txt를 불러오지 못했습니다.");
      return res.text();
    });
    state.schedule = parseSchedule(text);
    if (!hasAnyEvents(state.schedule)) {
      state.schedule = parseSchedule(getFallbackText());
    }
    render();
  } catch (error) {
    state.schedule = parseSchedule(getFallbackText());
    if (hasAnyEvents(state.schedule)) {
      render();
      return;
    }
    els.todayTimeline.innerHTML = `<li class="empty">${error.message}</li>`;
  }
}

function bindEvents() {
  els.tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      state.activeView = tab.dataset.view === "routine" ? "today" : tab.dataset.view;
      render();
      if (tab.dataset.view === "routine") {
        requestAnimationFrame(() => {
          els.routinePanel.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }
    });
  });

  els.themeToggle.addEventListener("click", () => {
    setTheme(document.documentElement.classList.contains("dark") ? "light" : "dark");
  });

  els.resetToday.addEventListener("click", () => {
    getDayEvents(state.selectedDay).forEach((event) => {
      delete state.checks[event.id];
    });
    delete state.routines[getDateKey(new Date())];
    saveChecks();
    saveRoutines();
    render();
  });
}

function parseSchedule(text) {
  const days = [];
  let current = null;

  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const headingName = dayNames.find((name) => line.includes(name));
      if (headingName && !line.match(/^\d{2}:\d{2}/)) {
        current = { name: headingName, index: dayNames.indexOf(headingName), events: [] };
        days.push(current);
        return;
      }

      if (!current) return;
      const range = line.match(/^(\d{2}:\d{2})(?:\s*~\s*(\d{2}:\d{2}))?\s+(.+)$/);
      if (!range) return;

      const start = toMinutes(range[1]);
      const end = range[2] ? normalizeEnd(start, toMinutes(range[2])) : start + 10;
      const title = range[3].trim();
      const id = `${current.name}-${range[1]}-${range[2] || "single"}-${title}`;

      current.events.push({
        id,
        day: current.index,
        start,
        end,
        startLabel: range[1],
        endLabel: range[2] || "",
        title,
      });
    });

  const schedule = removeCarryoverDuplicates(
    dayNames.map((name, index) => days.find((day) => day.index === index) || { name, index, events: [] }),
  );

  return addSleepBlocks(schedule);
}

function render() {
  const now = new Date();
  state.selectedDay = state.activeView === "today" ? now.getDay() : state.selectedDay;
  const dateText = new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(now);

  els.dateLabel.textContent = dateText;
  els.tabs.forEach((tab) => tab.classList.toggle("is-active", tab.dataset.view === state.activeView));
  els.views.forEach((view) => view.classList.toggle("is-active", view.id === `${state.activeView}View`));

  renderToday(now);
  renderWeek();
}

function renderToday(now) {
  const todayEvents = getDayEvents(state.selectedDay);
  const dayName = dayNames[state.selectedDay];
  els.todayTitle.textContent = `${dayName} 타임라인`;

  if (!todayEvents.length) {
    els.todayTimeline.innerHTML = `<li class="empty">등록된 일정이 없습니다.</li>`;
    updateProgress([]);
    updateNowTask([], now);
    return;
  }

  els.todayTimeline.innerHTML = todayEvents.map((event) => eventTemplate(event, now, "event")).join("");
  els.todayTimeline.querySelectorAll(".check").forEach(bindCheckButton);
  renderRoutines(now);
  updateProgress(todayEvents);
  updateNowTask(todayEvents, now);
}

function renderWeek() {
  els.weekStrip.innerHTML = state.schedule
    .map((day) => {
      const checkable = getCheckableEvents(day.events);
      const done = checkable.filter((event) => state.checks[event.id]).length;
      return `<button class="day-chip ${day.index === state.selectedDay ? "is-active" : ""}" type="button" data-day="${day.index}">
        ${shortDays[day.index]}<span>${done}/${checkable.length}</span>
      </button>`;
    })
    .join("");

  els.weekStrip.querySelectorAll(".day-chip").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedDay = Number(button.dataset.day);
      state.activeView = "week";
      render();
    });
  });

  els.weekList.innerHTML = state.schedule
    .map((day) => {
      const checkable = getCheckableEvents(day.events);
      const done = checkable.filter((event) => state.checks[event.id]).length;
      const events = day.events.map((event) => eventTemplate(event, new Date(), "mini-event")).join("");
      return `<section class="day-block" id="day-${day.index}">
        <div class="day-heading">
          <strong>${day.name}</strong>
          <span class="badge">${done}/${checkable.length}</span>
        </div>
        <div class="mini-list">${events}</div>
      </section>`;
    })
    .join("");

  els.weekList.querySelectorAll(".check").forEach(bindCheckButton);
  if (state.activeView === "week") {
    document.querySelector(`#day-${state.selectedDay}`)?.scrollIntoView({ block: "nearest" });
  }
}

function eventTemplate(event, now, className) {
  const checked = Boolean(state.checks[event.id]);
  const current = isCurrent(event, now);
  const time = event.endLabel
    ? `<span>${event.startLabel}</span><span>${event.endLabel}</span>`
    : `<span>${event.startLabel}</span>`;
  const badge = "";
  const tag = className === "mini-event" ? "div" : "li";
  const checkButton = event.synthetic
    ? `<span class="check-placeholder" aria-hidden="true"></span>`
    : `<button class="check ${checked ? "is-checked" : ""}" type="button" aria-label="${escapeHtml(event.title)} 완료" data-id="${escapeAttr(event.id)}"></button>`;

  return `<${tag} class="${className} ${event.synthetic ? "is-sleep" : ""} ${current ? "is-current" : ""} ${checked ? "is-done" : ""}">
    <span class="time">${time}</span>
    <span class="event-title">${escapeHtml(event.title)}${badge}</span>
    ${checkButton}
  </${tag}>`;
}

function bindCheckButton(button) {
  button.addEventListener("click", () => {
    const id = button.dataset.id;
    state.checks[id] = !state.checks[id];
    if (!state.checks[id]) delete state.checks[id];
    saveChecks();
    render();
  });
}

function renderRoutines(now) {
  const dateKey = getDateKey(now);
  const dayState = getRoutineDayState(dateKey);

  els.routineList.innerHTML = dailyRoutines
    .map((routine) => {
      if (routine.type === "counter") {
        const value = Math.min(dayState[routine.id] || 0, routine.target);
        return `<article class="routine-item routine-water">
          <div>
            <strong>${routine.label}</strong>
            <span>${value}/${routine.target}${routine.unit}</span>
          </div>
          <div class="counter-controls">
            <button class="counter-button" type="button" data-routine="${routine.id}" data-delta="-1" aria-label="${routine.label} 줄이기">−</button>
            <button class="counter-button is-plus" type="button" data-routine="${routine.id}" data-delta="1" aria-label="${routine.label} 늘리기">+</button>
          </div>
        </article>`;
      }

      const checked = Boolean(dayState[routine.id]);
      return `<article class="routine-item">
        <strong>${routine.label}</strong>
        <button class="check routine-check ${checked ? "is-checked" : ""}" type="button" data-routine="${routine.id}" aria-label="${routine.label} 완료"></button>
      </article>`;
    })
    .join("");

  els.routineList.querySelectorAll(".routine-check").forEach((button) => {
    button.addEventListener("click", () => {
      const current = getRoutineDayState(dateKey);
      current[button.dataset.routine] = !current[button.dataset.routine];
      if (!current[button.dataset.routine]) delete current[button.dataset.routine];
      state.routines[dateKey] = current;
      saveRoutines();
      render();
    });
  });

  els.routineList.querySelectorAll(".counter-button").forEach((button) => {
    button.addEventListener("click", () => {
      const routine = dailyRoutines.find((item) => item.id === button.dataset.routine);
      const current = getRoutineDayState(dateKey);
      const next = Math.max(0, Math.min(routine.target, (current[routine.id] || 0) + Number(button.dataset.delta)));
      current[routine.id] = next;
      state.routines[dateKey] = current;
      saveRoutines();
      render();
    });
  });

  const done = getRoutineDoneCount(dateKey);
  els.routineCount.textContent = `${done}/${dailyRoutines.length}`;
}

function updateProgress(events) {
  const checkable = getCheckableEvents(events);
  const routineDone = getRoutineDoneCount(getDateKey(new Date()));
  const done = checkable.filter((event) => state.checks[event.id]).length + routineDone;
  const total = checkable.length + dailyRoutines.length;
  els.doneCount.textContent = `${done}/${total}`;
  els.progressFill.style.width = total ? `${Math.round((done / total) * 100)}%` : "0%";
}

function updateNowTask(events, now) {
  const current = events.find((event) => isCurrent(event, now));
  if (current) {
    els.nowTask.textContent = current.title;
    return;
  }

  const minutes = now.getHours() * 60 + now.getMinutes();
  const next = events.find((event) => event.start > minutes);
  els.nowTask.textContent = next ? `${next.startLabel} ${next.title}` : "오늘 일정 끝";
}

function getDayEvents(dayIndex) {
  return state.schedule.find((day) => day.index === dayIndex)?.events || [];
}

function getCheckableEvents(events) {
  return events.filter((event) => !event.synthetic);
}

function getRoutineDayState(dateKey) {
  return state.routines[dateKey] || {};
}

function getRoutineDoneCount(dateKey) {
  const dayState = getRoutineDayState(dateKey);
  return dailyRoutines.filter((routine) => {
    if (routine.type === "counter") return (dayState[routine.id] || 0) >= routine.target;
    return Boolean(dayState[routine.id]);
  }).length;
}

function getDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function hasAnyEvents(schedule) {
  return schedule.some((day) => day.events.length > 0);
}

function getFallbackText() {
  return document.querySelector("#scheduleFallback")?.textContent || "";
}

function removeCarryoverDuplicates(schedule) {
  return schedule.map((day) => {
    const prevDay = schedule[(day.index + 6) % 7];
    const events = day.events.filter((event) => {
      if (event.title.includes("이어짐")) return false;
      if (event.start !== 0 || !prevDay) return true;

      return !prevDay.events.some((prev) => {
        const sameTitle = normalizeTitle(prev.title) === normalizeTitle(event.title);
        const prevOvernightEnd = prev.end > 1440 ? prev.end - 1440 : 0;
        return sameTitle && prevOvernightEnd >= event.end;
      });
    });

    return { ...day, events };
  });
}

function addSleepBlocks(schedule) {
  return schedule.map((day) => {
    const wakeEvent = day.events.find((event) => event.title.includes("기상"));
    const morningBoundary = wakeEvent?.start ?? day.events.find((event) => event.start >= 300)?.start;
    if (!morningBoundary || morningBoundary <= 0) return day;

    const prevDay = schedule[(day.index + 6) % 7];
    const prevEnd = getPreviousOvernightEnd(prevDay);
    const sleepStart = Math.min(prevEnd, morningBoundary);

    if (morningBoundary - sleepStart < 30) return day;

    const sleepEvent = {
      id: `${day.name}-sleep-${sleepStart}-${morningBoundary}`,
      day: day.index,
      start: sleepStart,
      end: morningBoundary,
      startLabel: toTimeLabel(sleepStart),
      endLabel: toTimeLabel(morningBoundary),
      title: "잠",
      synthetic: true,
    };

    return {
      ...day,
      events: [sleepEvent, ...day.events].sort((a, b) => a.start - b.start),
    };
  });
}

function getPreviousOvernightEnd(day) {
  if (!day) return 0;
  const end = day.events.reduce((latest, event) => (event.end > 1440 ? Math.max(latest, event.end - 1440) : latest), 0);
  return end;
}

function toTimeLabel(minutes) {
  const normalized = minutes % 1440;
  const hour = String(Math.floor(normalized / 60)).padStart(2, "0");
  const minute = String(normalized % 60).padStart(2, "0");
  return `${hour}:${minute}`;
}

function normalizeTitle(title) {
  return title.replace(/\s*\(.+?\)\s*/g, "").trim();
}

function isCurrent(event, now) {
  if (event.day !== now.getDay()) return false;
  const minutes = now.getHours() * 60 + now.getMinutes();
  const compare = event.end > 1440 && minutes < 300 ? minutes + 1440 : minutes;
  return compare >= event.start && compare < event.end;
}

function toMinutes(value) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function normalizeEnd(start, end) {
  if (end === 0) return 1440;
  return end <= start ? end + 1440 : end;
}

function saveChecks() {
  localStorage.setItem("daylong-checks", JSON.stringify(state.checks));
}

function saveRoutines() {
  localStorage.setItem("daylong-routines", JSON.stringify(state.routines));
}

function getPreferredTheme() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function setTheme(theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  localStorage.setItem("daylong-theme", theme);
  document.querySelector('meta[name="theme-color"]').setAttribute("content", theme === "dark" ? "#101418" : "#f8fafc");
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}
