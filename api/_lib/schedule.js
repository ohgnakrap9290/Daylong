import { readFileSync } from "node:fs";
import { join } from "node:path";

export const dayNames = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];

export function readSchedule() {
  return parseSchedule(readFileSync(join(process.cwd(), "data.txt"), "utf8"));
}

export function parseSchedule(text) {
  const days = [];
  let current = null;
  const carryovers = [];

  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const headingName = dayNames.find((name) => line.includes(name));
      if (headingName && !/^\d{2}:\d{2}/.test(line)) {
        current = { name: headingName, index: dayNames.indexOf(headingName), events: [] };
        days.push(current);
        return;
      }

      if (!current) return;

      const range = line.match(/^(\d{2}:\d{2})(?:\s*~\s*(\d{2}:\d{2}))?\s+(.+)$/);
      if (!range) return;

      const start = toMinutes(range[1]);
      let end = range[2] ? normalizeEnd(start, toMinutes(range[2])) : start + 10;
      const title = range[3].trim();
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
        id: `${current.name}-${range[1]}-${range[2] || "single"}-${title}`,
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
  return schedule;
}

export function getKstNow(date = new Date()) {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return {
    day: kst.getUTCDay(),
    minutes: kst.getUTCHours() * 60 + kst.getUTCMinutes(),
    dateKey: `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, "0")}-${String(kst.getUTCDate()).padStart(2, "0")}`,
  };
}

export function toMinutes(value) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function normalizeEnd(start, end) {
  if (end === 0) return 1440;
  return end <= start ? end + 1440 : end;
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

function toTimeLabel(minutes) {
  const normalized = minutes % 1440;
  const hour = String(Math.floor(normalized / 60)).padStart(2, "0");
  const minute = String(normalized % 60).padStart(2, "0");
  return `${hour}:${minute}`;
}
