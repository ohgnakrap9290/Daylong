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
  currentColor: localStorage.getItem("daylong-current-color") || "blue",
  notificationsEnabled: localStorage.getItem("daylong-notifications") === "enabled",
  routineReminderTime: localStorage.getItem("daylong-routine-reminder-time") || "20:00",
  notificationTimers: [],
  checks: JSON.parse(localStorage.getItem("daylong-checks") || "{}"),
  routines: JSON.parse(localStorage.getItem("daylong-routines") || "{}"),
};

const els = {
  dateLabel: document.querySelector("#dateLabel"),
  nowTask: document.querySelector("#nowTask"),
  timeLeft: document.querySelector("#timeLeft"),
  nextTask: document.querySelector("#nextTask"),
  doneCount: document.querySelector("#doneCount"),
  progressFill: document.querySelector("#progressFill"),
  notifyToggle: document.querySelector("#notifyToggle"),
  colorSwatches: document.querySelectorAll(".swatch"),
  tabs: document.querySelectorAll(".tab"),
  views: document.querySelectorAll(".view"),
  todayTitle: document.querySelector("#todayTitle"),
  todayTimeline: document.querySelector("#todayTimeline"),
  routinePanel: document.querySelector("#routinePanel"),
  routineCount: document.querySelector("#routineCount"),
  routineList: document.querySelector("#routineList"),
  routineReminderTime: document.querySelector("#routineReminderTime"),
  weekStrip: document.querySelector("#weekStrip"),
  weekList: document.querySelector("#weekList"),
  scrollTop: document.querySelector("#scrollTop"),
  themeToggle: document.querySelector("#themeToggle"),
  resetToday: document.querySelector("#resetToday"),
};

init();

async function init() {
  setTheme(localStorage.getItem("daylong-theme") || getPreferredTheme());
  setCurrentColor(state.currentColor);
  registerServiceWorker();
  updateNotifyButton();
  els.routineReminderTime.value = state.routineReminderTime;
  bindEvents();
  preventDoubleTapZoom();

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

  els.scrollTop.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  els.notifyToggle.addEventListener("click", enableNotifications);

  els.routineReminderTime.addEventListener("change", () => {
    state.routineReminderTime = els.routineReminderTime.value || "20:00";
    localStorage.setItem("daylong-routine-reminder-time", state.routineReminderTime);
    scheduleUpcomingNotifications(new Date());
    syncPushSubscription().catch(() => {});
  });

  els.colorSwatches.forEach((button) => {
    button.addEventListener("click", () => {
      setCurrentColor(button.dataset.currentColor);
    });
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
  const carryovers = [];

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

      const rawStart = toMinutes(range[1]);
      const rawEnd = range[2] ? toMinutes(range[2]) : rawStart + 10;
      const start = rawStart;
      let end = range[2] ? normalizeEnd(start, rawEnd) : rawEnd;
      const title = range[3].trim();
      const id = `${current.name}-${range[1]}-${range[2] || "single"}-${title}`;
      let endLabel = range[2] || "";

      if (end > 1440) {
        carryovers.push({
          fromDay: current.index,
          start: 0,
          end: end - 1440,
          startLabel: "00:00",
          endLabel: toTimeLabel(end - 1440),
          title,
          sourceStartLabel: range[1],
        });
        end = 1440;
        endLabel = "24:00";
      }

      current.events.push({
        id,
        day: current.index,
        start,
        end,
        startLabel: range[1],
        endLabel,
        title,
      });
    });

  const schedule = dayNames.map((name, index) => days.find((day) => day.index === index) || { name, index, events: [] });
  applyCarryovers(schedule, carryovers);
  addWeekdayFreeBlocks(schedule, new Set(carryovers.map((carryover) => carryover.fromDay)));

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
  scheduleUpcomingNotifications(now);
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
  const totalDone = state.schedule.reduce((sum, day) => {
    const checkable = getCheckableEvents(day.events);
    return sum + checkable.filter((event) => state.checks[event.id]).length;
  }, 0);
  const totalEvents = state.schedule.reduce((sum, day) => sum + getCheckableEvents(day.events).length, 0);

  els.weekStrip.innerHTML = `<div class="week-summary">
    <div>
      <span>이번 주 완료</span>
      <strong>${totalDone}/${totalEvents}</strong>
    </div>
    <div>
      <span>오늘</span>
      <strong>${shortDays[new Date().getDay()]}</strong>
    </div>
  </div>
  <div class="day-chips">
    ${state.schedule
    .map((day) => {
      const checkable = getCheckableEvents(day.events);
      const done = checkable.filter((event) => state.checks[event.id]).length;
      return `<button class="day-chip ${day.index === state.selectedDay ? "is-active" : ""}" type="button" data-day="${day.index}">
        ${shortDays[day.index]}<span>${done}/${checkable.length}</span>
      </button>`;
    })
    .join("")}
  </div>`;

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
    <span class="timeline-rail" aria-hidden="true"></span>
    <span class="time">${time}</span>
    <span class="event-card">
      <span class="event-title">${escapeHtml(event.title)}${badge}</span>
      ${checkButton}
    </span>
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
      syncPushSubscription().catch(() => {});
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
      syncPushSubscription().catch(() => {});
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
  const next = getNextEvent(events, now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  if (current) {
    els.nowTask.textContent = current.title;
    els.timeLeft.textContent = `${formatDuration(current.end - nowMinutes)} 남음`;
  } else {
    els.nowTask.textContent = next ? "대기 중" : "오늘 일정 끝";
    els.timeLeft.textContent = next ? `${formatDuration(next.start - nowMinutes)} 뒤 시작` : "남은 일정 없음";
  }

  els.nextTask.textContent = next ? `다음 ${next.startLabel} · ${next.title}` : "다음 일정 없음";
}

async function enableNotifications() {
  if (!("Notification" in window)) {
    els.notifyToggle.textContent = "미지원";
    return;
  }

  if (Notification.permission === "denied") {
    els.notifyToggle.textContent = "차단됨";
    return;
  }

  const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") {
    updateNotifyButton();
    return;
  }

  state.notificationsEnabled = true;
  localStorage.setItem("daylong-notifications", "enabled");
  updateNotifyButton();
  scheduleUpcomingNotifications(new Date());

  try {
    await syncPushSubscription();
    showAppNotification("DayLong 알림 켜짐", "앱이 꺼져 있어도 서버가 일정 10분 전에 알려줄게요.");
  } catch (error) {
    showAppNotification("DayLong 알림 켜짐", "앱이 열려 있을 때 일정 10분 전에 알려줄게요.");
  }
}

function updateNotifyButton() {
  if (!("Notification" in window)) {
    els.notifyToggle.textContent = "미지원";
    return;
  }

  if (Notification.permission === "denied") {
    els.notifyToggle.textContent = "차단됨";
    return;
  }

  els.notifyToggle.textContent = state.notificationsEnabled && Notification.permission === "granted" ? "알림 켜짐" : "알림 켜기";
  els.notifyToggle.classList.toggle("is-on", state.notificationsEnabled && Notification.permission === "granted");
}

function scheduleUpcomingNotifications(now) {
  state.notificationTimers.forEach((timer) => clearTimeout(timer));
  state.notificationTimers = [];

  if (!state.notificationsEnabled || !("Notification" in window) || Notification.permission !== "granted") return;

  const events = getCheckableEvents(getDayEvents(now.getDay()));
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const todayKey = getDateKey(now);
  const sent = JSON.parse(localStorage.getItem("daylong-sent-notifications") || "{}");

  events.forEach((event) => {
    if (event.start < nowMinutes) return;

    const notifyAt = event.start - 10;
    const delayMinutes = Math.max(0, notifyAt - nowMinutes);
    const notificationKey = `${todayKey}-${event.id}`;
    if (sent[notificationKey]) return;

    const timer = setTimeout(() => {
      const latestSent = JSON.parse(localStorage.getItem("daylong-sent-notifications") || "{}");
      if (latestSent[notificationKey]) return;

      showAppNotification(`${event.startLabel} ${event.title}`, "10분 뒤 시작하는 일정입니다.");
      latestSent[notificationKey] = true;
      localStorage.setItem("daylong-sent-notifications", JSON.stringify(latestSent));
    }, delayMinutes * 60 * 1000);

    state.notificationTimers.push(timer);
  });

  scheduleRoutineReminder(now, sent);
}

function scheduleRoutineReminder(now, sent) {
  const reminderMinutes = toMinutes(state.routineReminderTime);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const todayKey = getDateKey(now);
  const notificationKey = `${todayKey}-routine-reminder-${state.routineReminderTime}`;

  if (sent[notificationKey] || reminderMinutes < nowMinutes) return;

  const timer = setTimeout(() => {
    const latestSent = JSON.parse(localStorage.getItem("daylong-sent-notifications") || "{}");
    if (latestSent[notificationKey]) return;

    const missing = getMissingRoutines(todayKey);
    if (!missing.length) return;

    showAppNotification("오늘 루틴 확인", `남은 루틴: ${missing.join(", ")}`);
    latestSent[notificationKey] = true;
    localStorage.setItem("daylong-sent-notifications", JSON.stringify(latestSent));
  }, (reminderMinutes - nowMinutes) * 60 * 1000);

  state.notificationTimers.push(timer);
}

async function showAppNotification(title, body) {
  if ("serviceWorker" in navigator) {
    const registration = await navigator.serviceWorker.ready;
    registration.showNotification(title, {
      body,
      icon: "images.png?v=1",
      badge: "images.png?v=1",
      tag: `daylong-${title}`,
    });
    return;
  }

  new Notification(title, { body, icon: "images.png?v=1" });
}

async function syncPushSubscription() {
  if (!state.notificationsEnabled || !("serviceWorker" in navigator) || !("PushManager" in window)) return;
  if (Notification.permission !== "granted") return;

  const config = await fetch("/api/config", { cache: "no-store" }).then((response) => response.json());
  if (!config.vapidPublicKey || !config.pushConfigured) {
    throw new Error("Server push is not configured.");
  }

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ||
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(config.vapidPublicKey),
    }));

  const response = await fetch("/api/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subscription,
      timezone: "Asia/Seoul",
      routineReminderTime: state.routineReminderTime,
      routines: state.routines,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Subscription sync failed.");
  }
}

function urlBase64ToUint8Array(value) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const output = new Uint8Array(rawData.length);

  for (let index = 0; index < rawData.length; index += 1) {
    output[index] = rawData.charCodeAt(index);
  }

  return output;
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || location.protocol !== "https:") return;
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

function preventDoubleTapZoom() {
  let lastTouchEnd = 0;

  document.addEventListener(
    "touchend",
    (event) => {
      const now = Date.now();
      if (now - lastTouchEnd <= 350) {
        event.preventDefault();
      }
      lastTouchEnd = now;
    },
    { passive: false },
  );
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

function getMissingRoutines(dateKey) {
  const dayState = getRoutineDayState(dateKey);
  return dailyRoutines
    .filter((routine) => {
      if (routine.type === "counter") return (dayState[routine.id] || 0) < routine.target;
      return !dayState[routine.id];
    })
    .map((routine) => routine.label);
}

function getNextEvent(events, now) {
  const minutes = now.getHours() * 60 + now.getMinutes();
  return events.find((event) => event.start > minutes);
}

function formatDuration(minutes) {
  const safeMinutes = Math.max(0, minutes);
  const hours = Math.floor(safeMinutes / 60);
  const mins = safeMinutes % 60;
  if (hours > 0 && mins > 0) return `${hours}시간 ${mins}분`;
  if (hours > 0) return `${hours}시간`;
  return `${mins}분`;
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

function addSleepBlocks(schedule) {
  return schedule.map((day) => {
    const wakeEvent = day.events.find((event) => event.title.includes("기상"));
    const morningBoundary = wakeEvent?.start ?? day.events.find((event) => event.start >= 300)?.start;
    if (!morningBoundary || morningBoundary <= 0) return day;

    const prevDay = schedule[(day.index + 6) % 7];
    const prevEnd = getPreviousOvernightEnd(prevDay);
    const earlyEnd = getEarlyDayEnd(day);
    const sleepStart = Math.min(Math.max(prevEnd, earlyEnd), morningBoundary);

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

function applyCarryovers(schedule, carryovers) {
  carryovers.forEach((carryover) => {
    const dayIndex = (carryover.fromDay + 1) % 7;
    const day = schedule[dayIndex];

    day.events.unshift({
      id: `${day.name}-carry-${carryover.sourceStartLabel}-${carryover.endLabel}-${carryover.title}`,
      day: day.index,
      start: carryover.start,
      end: carryover.end,
      startLabel: carryover.startLabel,
      endLabel: carryover.endLabel,
      title: carryover.title,
    });

    const freeStart = carryover.end;
    const freeEnd = Math.min(1440, freeStart + 30);
    if (isWeekday(carryover.fromDay) && freeEnd > freeStart) {
      day.events.push({
        id: `${day.name}-free-${freeStart}-${freeEnd}`,
        day: day.index,
        start: freeStart,
        end: freeEnd,
        startLabel: toTimeLabel(freeStart),
        endLabel: toTimeLabel(freeEnd),
        title: "자유시간",
      });
    }

    day.events.sort((a, b) => a.start - b.start);
  });
}

function addWeekdayFreeBlocks(schedule, carryoverSourceDays) {
  schedule.forEach((day) => {
    if (!isWeekday(day.index) || carryoverSourceDays.has(day.index)) return;

    const latest = day.events.reduce((candidate, event) => (!candidate || event.end > candidate.end ? event : candidate), null);
    if (!latest || latest.title === "자유시간") return;

    const targetDay = latest.end >= 1440 ? schedule[(day.index + 1) % 7] : day;
    const freeStart = latest.end >= 1440 ? 0 : latest.end;
    const freeEnd = Math.min(1440, freeStart + 30);
    const exists = targetDay.events.some((event) => event.title === "자유시간" && event.start === freeStart);
    if (exists || freeEnd <= freeStart) return;

    targetDay.events.push({
      id: `${targetDay.name}-free-${freeStart}-${freeEnd}`,
      day: targetDay.index,
      start: freeStart,
      end: freeEnd,
      startLabel: toTimeLabel(freeStart),
      endLabel: toTimeLabel(freeEnd),
      title: "자유시간",
    });
    targetDay.events.sort((a, b) => a.start - b.start);
  });
}

function isWeekday(dayIndex) {
  return dayIndex >= 1 && dayIndex <= 5;
}

function getPreviousOvernightEnd(day) {
  if (!day) return 0;
  return day.events.reduce((latest, event) => (event.start < 300 ? Math.max(latest, event.end) : latest), 0);
}

function getEarlyDayEnd(day) {
  return day.events.reduce((latest, event) => (event.start < 300 ? Math.max(latest, event.end) : latest), 0);
}

function toTimeLabel(minutes) {
  const normalized = minutes % 1440;
  const hour = String(Math.floor(normalized / 60)).padStart(2, "0");
  const minute = String(normalized % 60).padStart(2, "0");
  return `${hour}:${minute}`;
}

function isCurrent(event, now) {
  if (event.day !== now.getDay()) return false;
  const minutes = now.getHours() * 60 + now.getMinutes();
  return minutes >= event.start && minutes < event.end;
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

function setCurrentColor(color) {
  state.currentColor = color;
  document.documentElement.dataset.currentColor = color;
  localStorage.setItem("daylong-current-color", color);
  els.colorSwatches.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.currentColor === color);
  });
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}
