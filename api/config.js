const VAPID_PUBLIC_KEY =
  process.env.VAPID_PUBLIC_KEY || "BN1P6SbaSmQTqJdXpTJEAjHw3MSlgex3iMrdfibjPM4wUZYS_nBQJdOgQFTh7e0bkpsSTQvsCPN209DBbiZIfD8";

export default function handler(request, response) {
  response.status(200).json({
    vapidPublicKey: VAPID_PUBLIC_KEY,
    pushConfigured: Boolean(process.env.VAPID_PRIVATE_KEY && process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN),
  });
}
