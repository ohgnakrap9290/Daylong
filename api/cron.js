import webpush from "web-push";
import { kvCommand, kvPipeline } from "./_lib/kv.js";
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
    const ids = (await kvCommand(["SMEMBERS", "daylong:subscriptions"])) || [];
    const records = await loadSubscriptionRecords(ids);
    const now = getKstNow();
    const schedule = readSchedule();
    const todayEvents = schedule.find((day) => day.index === now.day)?.events || [];
    const dueEvents = todayEvents.filter((event) => {
      const notifyAt = event.start - 10;
      return notifyAt <= now.minutes && notifyAt > now.minutes - 2;
    });

    let sent = 0;
    let removed = 0;

    for (const record of records) {
      for (const event of dueEvents) {
        const key = `daylong:sent:${now.dateKey}:${record.id}:event:${event.id}`;
        const firstSend = await markOnce(key);
        if (!firstSend) continue;

        const ok = await sendPush(record, {
          title: `${event.startLabel} ${event.title}`,
          body: "10분 뒤 시작하는 일정입니다.",
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

async function loadSubscriptionRecords(ids) {
  if (!ids.length) return [];
  const values = await kvPipeline(ids.map((id) => ["GET", `daylong:subscription:${id}`]));
  return values.filter(Boolean).map((value) => JSON.parse(value));
}

async function markOnce(key) {
  const result = await kvCommand(["SET", key, "1", "EX", 60 * 60 * 24 * 3, "NX"]);
  return result === "OK";
}

async function sendPush(record, payload) {
  try {
    await webpush.sendNotification(record.subscription, JSON.stringify(payload));
    return true;
  } catch (error) {
    if (error.statusCode === 404 || error.statusCode === 410) {
      await kvPipeline([
        ["SREM", "daylong:subscriptions", record.id],
        ["DEL", `daylong:subscription:${record.id}`],
      ]);
      return "removed";
    }
    return false;
  }
}

async function maybeSendRoutineReminder(record, now) {
  const reminderTime = record.routineReminderTime || "20:00";
  const reminderMinutes = toMinutes(reminderTime);
  if (reminderMinutes > now.minutes || reminderMinutes <= now.minutes - 2) return false;

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
