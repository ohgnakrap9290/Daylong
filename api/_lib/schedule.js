import { readFileSync } from "node:fs";
import { join } from "node:path";

export const dayNames = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];

export function readSchedule() {
  return parseSchedule(readFileSync(join(process.cwd(), "data.txt"), "utf8"));
}

export function parseSchedule(text) {
  const days = [];
  let current = null;

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

      let start = toMinutes(range[1]);
      let end = range[2] ? normalizeEnd(start, toMinutes(range[2])) : start + 10;
      const title = range[3].trim();
      const previousEvent = current.events.at(-1);

      if (previousEvent?.end > 1440 && start < 300) {
        start += 1440;
        end += 1440;
      }

      current.events.push({
        id: `${current.name}-${range[1]}-${range[2] || "single"}-${title}`,
        day: current.index,
        start,
        end,
        startLabel: range[1],
        endLabel: range[2] || "",
        title,
      });
    });

  return removeCarryoverDuplicates(
    dayNames.map((name, index) => days.find((day) => day.index === index) || { name, index, events: [] }),
  );
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

function normalizeTitle(title) {
  return title.replace(/\s*\(.+?\)\s*/g, "").trim();
}
