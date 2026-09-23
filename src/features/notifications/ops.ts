import "server-only";
import { sendEmail } from "@/lib/email";

export async function notifyOpsEmail(subject: string, lines: string[]) {
  const notify = process.env.NOTIFY_EMAIL;
  if (!notify) return;
  await sendEmail({ to: notify.split(",").map((item) => item.trim()).filter(Boolean), subject: `[Movia] ${subject}`, text: lines.filter(Boolean).join("\n") }).catch(() => undefined);
}
