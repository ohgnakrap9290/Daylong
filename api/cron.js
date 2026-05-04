import webpush from "web-push";
import { getRedis, getSubscriptionRecords } from "./_lib/redis.js";
import { getKstNow, readSchedule, toMinutes } from "./_lib/schedule.js";

const VAPID_PUBLIC_KEY =
  process.env.VAPID_PUBLIC_KEY || "BN1P6SbaSmQTqJdXpTJEAjHw3MSlgex3iMrdfibjPM4wUZYS_nBQJdOgQFTh7e0bkpsSTQvsCPN209DBbiZIfD8";

export default async function handler(request, response) {
  if (process.env.CRON_SECRET) {
    const auth = request.headers.authorization || "";
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      response.status(401).json({ error: "Unauthorized" });
      return;
    }
  }

  if (!process.env.VAPID_PRIVATE_KEY) {
    response.status(500).json({ error: "VAPID_PRIVATE_KEY is required." });
    return;
  }

  webpush.setVapidDetails("mailto:daylong@example.com", VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);

  try {
    const redis = await getRedis();
    const ids = (await redis.sMembers("push:subscriptions")) || [];
    const records = await getSubscriptionRecords(ids);
    const now = getKstNow();
    const schedule = readSchedule();
    const todayEvents = schedule.find((day) => day.index === now.day)?.events || [];
    const dueEvents = getDueEvents(todayEvents, now.minutes);

    let sent = 0;
    let removed = 0;

    for (const record of records) {
      for (const event of dueEvents) {
        const key = `daylong:sent:${now.dateKey}:${record.id}:event:${event.id}`;
        const firstSend = await markOnce(key);
        if (!firstSend) continue;

        const ok = await sendPush(record, {
          title: `${event.startLabel} ${event.title}`,
          body: `${event.start - now.minutes}분 뒤 시작하는 일정입니다.`,
          url: "/",
        });
        if (ok === "removed") removed += 1;
        else sent += 1;
      }

      const routineSent = await maybeSendRoutineReminder(record, now);
      if (routineSent === "removed") removed += 1;
      else if (routineSent) sent += 1;
    }

    response.status(200).json({ ok: true, subscribers: records.length, dueEvents: dueEvents.length, sent, removed });
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
}

function getDueEvents(events, nowMinutes) {
  return events.filter((event) => {
    if (event.start < 10) return false;
    return event.start > nowMinutes && event.start <= nowMinutes + 10;
  });
}

async function markOnce(key) {
  const redis = await getRedis();
  const result = await redis.set(key, "1", {
    EX: 60 * 60 * 24 * 3,
    NX: true,
  });
  return result === "OK";
}

async function sendPush(record, payload) {
  try {
    await webpush.sendNotification(record.subscription, JSON.stringify(payload));
    return true;
  } catch (error) {
    if (error.statusCode === 404 || error.statusCode === 410) {
      const redis = await getRedis();
      await redis
        .multi()
        .sRem("push:subscriptions", record.id)
        .del(`push:subscription:${record.id}`)
        .exec();
      return "removed";
    }
    return false;
  }
}

async function maybeSendRoutineReminder(record, now) {
  const reminderTime = record.routineReminderTime || "20:00";
  const reminderMinutes = toMinutes(reminderTime);
  if (reminderMinutes > now.minutes || reminderMinutes <= now.minutes - 16) return false;

  const key = `daylong:sent:${now.dateKey}:${record.id}:routine:${reminderTime}`;
  const firstSend = await markOnce(key);
  if (!firstSend) return false;

  const routines = record.routines?.[now.dateKey] || {};
  const missing = getMissingRoutines(routines);
  if (!missing.length) return false;

  return sendPush(record, {
    title: "오늘 루틴 확인",
    body: `남은 루틴: ${missing.join(", ")}`,
    url: "/",
  });
}

function getMissingRoutines(routines) {
  const definitions = [
    ["protein", "프로틴", 1],
    ["chicken", "닭가슴살", 1],
    ["water", "물", 4],
    ["duolingo", "듀오링고", 1],
    ["voca", "매일보카", 1],
  ];

  return definitions
    .filter(([id, , target]) => {
      if (id === "water") return (routines[id] || 0) < target;
      return !routines[id];
    })
    .map(([, label]) => label);
}
