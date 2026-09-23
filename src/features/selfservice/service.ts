import { notifyStaff } from "@/features/notifications/center";
import "server-only";
import { placeSecurityHold, PaymentError } from "@/features/payments/service";
import { sendEmail } from "@/lib/email";
import { renderEmail } from "@/lib/email/template";
import { portalOrigin, rootDomain } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatFullDateTime } from "@/lib/utils/format";
import { selfServicePhotoBucket, startWindowMinutes, type SelfServiceChecklist, type SelfServiceState } from "./types";

export type SelfServiceRow = {
  id: string;
  number: string;
  status: string;
  pickup_method: string;
  pickup_at: string;
  return_at: string;
  rate_plan: "PAY_NOW" | "PAY_LATER";
  payment_state: string;
  verification_state: string;
  agreement_state: string;
  hold_state: string;
  assigned_vehicle_id: string | null;
  delivery_address: string | null;
  self_service_state: SelfServiceState;
  self_service_note: string | null;
  access_link: string | null;
  access_note: string | null;
  self_reminder_2d_at: string | null;
  self_reminder_1d_at: string | null;
  self_started_at: string | null;
  self_returned_at: string | null;
  self_return_key_card: boolean | null;
  customer: { id: string; full_name: string; email: string | null; preferred_language: string; stripe_payment_method_id: string | null } | null;
};

const columns = "id, number, status, pickup_method, pickup_at, return_at, rate_plan, payment_state, verification_state, agreement_state, hold_state, assigned_vehicle_id, delivery_address, self_service_state, self_service_note, access_link, access_note, self_reminder_2d_at, self_reminder_1d_at, self_started_at, self_returned_at, self_return_key_card, customer:customers(id, full_name, email, preferred_language, stripe_payment_method_id)";

export async function loadSelfService(reservationId: string): Promise<SelfServiceRow | null> {
  const { data } = await createAdminClient().from("reservations").select(columns).eq("id", reservationId).maybeSingle();
  return (data as unknown as SelfServiceRow | null) ?? null;
}

export function checklistFor(row: SelfServiceRow): SelfServiceChecklist {
  const paid = ["PAID", "PARTIALLY_REFUNDED"].includes(row.payment_state);
  const payment = row.rate_plan === "PAY_NOW" ? paid : paid || Boolean(row.customer?.stripe_payment_method_id);
  const license = row.verification_state === "VERIFIED";
  const agreement = row.agreement_state === "SIGNED";
  const hold = row.hold_state === "AUTHORIZED";
  return { payment, paid, license, agreement, hold, complete: payment && license && agreement };
}

export function canStartSelfPickup(row: SelfServiceRow, now = Date.now()) {
  const list = checklistFor(row);
  return row.status === "CONFIRMED" && row.self_service_state === "APPROVED" && list.complete && list.hold && Boolean(row.access_link) && Boolean(row.assigned_vehicle_id) && now >= new Date(row.pickup_at).getTime() - startWindowMinutes * 60000;
}

async function audit(action: string, reservationId: string, actor: { userId: string | null; type: "STAFF" | "CUSTOMER" | "SYSTEM"; name?: string }, metadata: Record<string, unknown> = {}) {
  await createAdminClient().from("audit_events").insert({ actor_user_id: actor.userId, actor_type: actor.type, action, entity_type: "reservation", entity_id: reservationId, metadata: { ...(actor.name ? { by: actor.name } : {}), ...metadata } });
}

type EmailKind = "reminder2d" | "reminder1d" | "fallback" | "approved" | "declined" | "started" | "returned";

export async function sendSelfServiceEmail(row: SelfServiceRow, kind: EmailKind) {
  const email = row.customer?.email;
  if (!email) return;
  const zh = row.customer?.preferred_language === "zh";
  const url = `${portalOrigin}/trips/${row.number}`;
  const when = formatFullDateTime(row.pickup_at);
  const list = checklistFor(row);
  const missing = [!list.payment && (zh ? "付款或绑卡" : "payment or card on file"), !list.license && (zh ? "驾照核验" : "license verification"), !list.agreement && (zh ? "签署合同" : "signing the agreement")].filter(Boolean).join(zh ? "、" : ", ");
  const copy: Record<EmailKind, { title: string; subject: string; body: string; button: string }> = {
    reminder2d: {
      title: zh ? "自助取车准备" : "Self-service pickup",
      subject: zh ? `自助取车提醒 · ${row.number}` : `Self-service pickup reminder · ${row.number}`,
      body: zh ? `你预约了 ${when} 自助取车。请在取车前 24 小时完成：${missing || "全部事项"}。未按时完成的话，只能在营业时间到店由工作人员交车。` : `Your self-service pickup is set for ${when}. Please finish ${missing || "everything"} at least 24 hours before pickup. Otherwise the car can only be handed over by staff during business hours.`,
      button: zh ? "去完成" : "Finish now",
    },
    reminder1d: {
      title: zh ? "明天自助取车" : "Self-service pickup tomorrow",
      subject: zh ? `明天取车，还差一步 · ${row.number}` : `Pickup tomorrow, one step left · ${row.number}`,
      body: zh ? `${when} 自助取车前还差：${missing || "全部事项"}。取车前 24 小时未完成会自动改为到店人工取车。` : `Before your ${when} self-service pickup you still need: ${missing || "everything"}. If it is not done 24 hours before pickup, we will switch you to a staffed pickup.`,
      button: zh ? "去完成" : "Finish now",
    },
    fallback: {
      title: zh ? "改为到店取车" : "Switched to staffed pickup",
      subject: zh ? `取车方式已改为到店取车 · ${row.number}` : `Pickup changed to staffed pickup · ${row.number}`,
      body: zh ? `因为自助取车所需事项未在取车前 24 小时完成，${when} 请在营业时间到店，由工作人员为你交车。有问题随时联系我们。` : `The self-service requirements were not completed 24 hours before pickup, so please come to the store during business hours on ${when} and our staff will hand over the car. Contact us with any questions.`,
      button: zh ? "查看行程" : "View trip",
    },
    approved: {
      title: zh ? "自助取车已通过" : "Self-service pickup approved",
      subject: zh ? `自助取车已通过 · ${row.number}` : `Self-service pickup approved · ${row.number}`,
      body: zh ? `你的自助取车申请已通过。${when} 当天在客户中心点「开始自助取车」，拍几张车身照片后就会显示用车授权和停车位置。` : `Your self-service pickup is approved. On ${when} open your trip in the customer portal, tap “Start self-service pickup”, take a few photos of the car, and the access details will appear.`,
      button: zh ? "查看行程" : "View trip",
    },
    declined: {
      title: zh ? "自助取车未通过" : "Self-service pickup not available",
      subject: zh ? `本次需到店取车 · ${row.number}` : `Staffed pickup for this trip · ${row.number}`,
      body: zh ? `本次订单无法安排自助取车，请在 ${when} 营业时间到店，由工作人员交车。${row.self_service_note ? `备注：${row.self_service_note}` : ""}` : `We cannot offer self-service pickup for this booking. Please come to the store during business hours on ${when}. ${row.self_service_note ? `Note: ${row.self_service_note}` : ""}`,
      button: zh ? "查看行程" : "View trip",
    },
    started: {
      title: zh ? "用车授权" : "Your vehicle access",
      subject: zh ? `用车授权与停车位置 · ${row.number}` : `Vehicle access and parking · ${row.number}`,
      body: zh ? `你已开始自助取车。请在 Tesla App 中接受驾驶邀请后用车。${row.access_note ? `停车位置 / 说明：${row.access_note}` : ""}` : `Your self-service pickup has started. Accept the driver invitation in the Tesla app to use the car. ${row.access_note ? `Parking / notes: ${row.access_note}` : ""}`,
      button: zh ? "打开驾驶邀请" : "Open driver invitation",
    },
    returned: {
      title: zh ? "已收到还车" : "Return received",
      subject: zh ? `已收到你的还车提交 · ${row.number}` : `Return received · ${row.number}`,
      body: zh ? "我们已收到你的还车照片，工作人员验车后会完成结算并发送账单。感谢使用 Movia。" : "We received your return photos. Our team will inspect the car, close out the rental and send the statement. Thank you for renting with Movia.",
      button: zh ? "查看行程" : "View trip",
    },
  };
  const item = copy[kind];
  const rendered = renderEmail({ title: item.title, preheader: item.body.slice(0, 90), blocks: [{ type: "paragraph", text: item.body }, { type: "button", label: item.button, href: kind === "started" && row.access_link ? row.access_link : url }] });
  await sendEmail({ to: email, subject: `Movia · ${item.subject}`, text: rendered.text, html: rendered.html }).catch(() => undefined);
}

async function notifyOps(subject: string, lines: string[]) {
  const notify = process.env.NOTIFY_EMAIL;
  if (!notify) return;
  await sendEmail({ to: notify.split(",").map((item) => item.trim()).filter(Boolean), subject: `[Movia] ${subject}`, text: lines.join("\n") }).catch(() => undefined);
}

export async function setSelfServiceState(reservationId: string, state: SelfServiceState, patch: Record<string, unknown> = {}) {
  await createAdminClient().from("reservations").update({ self_service_state: state, ...patch }).eq("id", reservationId);
}

export async function ensureHold(row: SelfServiceRow): Promise<{ ok: boolean; error?: string }> {
  if (row.hold_state === "AUTHORIZED") return { ok: true };
  try {
    await placeSecurityHold(row.id, null);
    await audit("security_hold.authorized", row.id, { userId: null, type: "SYSTEM" }, { reason: "self_service" });
    return { ok: true };
  } catch (cause) {
    const error = cause instanceof PaymentError ? cause.code : "failed";
    await audit("security_hold.failed", row.id, { userId: null, type: "SYSTEM" }, { reason: "self_service", code: error });
    return { ok: false, error };
  }
}

export async function reviewSelfService(reservationId: string, decision: "approve" | "decline", note: string, actor: { userId: string; name: string }) {
  const row = await loadSelfService(reservationId);
  if (!row || row.pickup_method !== "SELF_SERVICE") return { error: "not_found" };
  if (!["REQUESTED", "APPROVED", "DECLINED", "FALLBACK"].includes(row.self_service_state)) return { error: "invalid_transition" };
  const state: SelfServiceState = decision === "approve" ? "APPROVED" : "DECLINED";
  await setSelfServiceState(reservationId, state, { self_service_note: note || null, self_service_reviewed_by: actor.userId, self_service_reviewed_at: new Date().toISOString() });
  await audit(`self_service.${decision === "approve" ? "approved" : "declined"}`, reservationId, { userId: actor.userId, type: "STAFF", name: actor.name }, { note: note || undefined });
  const updated = { ...row, self_service_state: state, self_service_note: note || null };
  await sendSelfServiceEmail(updated, decision === "approve" ? "approved" : "declined");
  if (state === "APPROVED" && checklistFor(updated).complete && new Date(row.pickup_at).getTime() - Date.now() <= 24 * 3600000) await ensureHold(updated);
  return { ok: true };
}

export async function saveAccess(reservationId: string, link: string, note: string, actor: { userId: string; name: string }) {
  await createAdminClient().from("reservations").update({ access_link: link || null, access_note: note || null }).eq("id", reservationId);
  await audit("self_service.access_saved", reservationId, { userId: actor.userId, type: "STAFF", name: actor.name }, { hasLink: Boolean(link) });
}

export async function listSelfServicePhotos(reservationId: string) {
  const supabase = createAdminClient();
  const { data } = await supabase.from("self_service_photos").select("id, phase, storage_path, created_at").eq("reservation_id", reservationId).order("created_at");
  const rows = data ?? [];
  if (!rows.length) return [] as Array<{ id: string; phase: "PICKUP" | "RETURN"; url: string; created_at: string }>;
  const { data: signed } = await supabase.storage.from(selfServicePhotoBucket).createSignedUrls(rows.map((row) => row.storage_path), 600);
  const urls = new Map((signed ?? []).filter((item) => item.path && item.signedUrl).map((item) => [item.path as string, item.signedUrl]));
  return rows.map((row) => ({ id: row.id, phase: row.phase as "PICKUP" | "RETURN", url: urls.get(row.storage_path) ?? "", created_at: row.created_at })).filter((row) => row.url);
}

export async function startSelfPickup(row: SelfServiceRow, photos: Array<{ path: string; type: string; size: number }>, actor: { userId: string; name: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!canStartSelfPickup(row)) return { ok: false, error: "not_ready" };
  const supabase = createAdminClient();
  const { data: vehicle } = await supabase.from("vehicles").select("odometer, battery_level").eq("id", row.assigned_vehicle_id as string).maybeSingle();
  if (photos.length) await supabase.from("self_service_photos").insert(photos.map((photo) => ({ reservation_id: row.id, phase: "PICKUP", storage_path: photo.path, mime_type: photo.type, size_bytes: photo.size })));
  const { data: inspection } = await supabase
    .from("inspections")
    .insert({ reservation_id: row.id, vehicle_id: row.assigned_vehicle_id, kind: "PICKUP", odometer: vehicle?.odometer ?? 0, battery_level: vehicle?.battery_level ?? 0, accessories: { keyCard: true, charger: true }, checklist: { selfService: true, license: "online", photosByCustomer: photos.length }, charges: [], performed_by: null })
    .select("id")
    .maybeSingle();
  const { error } = await supabase.rpc("set_reservation_status", { p_reservation_id: row.id, p_status: "ACTIVE", p_reason: "self_service" });
  if (error) return { ok: false, error: "invalid_transition" };
  const startedAt = new Date().toISOString();
  await supabase.from("reservations").update({ self_service_state: "STARTED", self_started_at: startedAt, start_odometer: vehicle?.odometer ?? null }).eq("id", row.id);
  await audit("reservation.status_changed", row.id, { userId: actor.userId, type: "CUSTOMER", name: actor.name }, { from: "CONFIRMED", to: "ACTIVE", selfService: true });
  await audit("self_service.started", row.id, { userId: actor.userId, type: "CUSTOMER", name: actor.name }, { inspectionId: inspection?.id ?? null, photos: photos.length });
  await sendSelfServiceEmail({ ...row, self_service_state: "STARTED" }, "started");
  await notifyStaff({ kind: "self_service.started", reservationId: row.id, href: `/reservations/${row.id}`, params: { number: row.number, name: row.customer?.full_name ?? "" } });
  return { ok: true };
}

export async function finishSelfReturn(row: SelfServiceRow, input: { photos: Array<{ path: string; type: string; size: number }>; keyCard: boolean; note: string }, actor: { userId: string; name: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  if (row.status !== "ACTIVE" || row.self_service_state !== "STARTED") return { ok: false, error: "not_ready" };
  const supabase = createAdminClient();
  if (input.photos.length) await supabase.from("self_service_photos").insert(input.photos.map((photo) => ({ reservation_id: row.id, phase: "RETURN", storage_path: photo.path, mime_type: photo.type, size_bytes: photo.size })));
  const returnedAt = new Date().toISOString();
  await supabase.from("reservations").update({ self_service_state: "RETURNED", self_returned_at: returnedAt, self_return_key_card: input.keyCard }).eq("id", row.id);
  await audit("self_service.returned", row.id, { userId: actor.userId, type: "CUSTOMER", name: actor.name }, { photos: input.photos.length, keyCard: input.keyCard, note: input.note || undefined });
  await sendSelfServiceEmail(row, "returned");
  await notifyStaff({ kind: "self_service.returned", reservationId: row.id, href: `/reservations/${row.id}/return`, params: { number: row.number, name: row.customer?.full_name ?? "" } });
  await notifyOps(`自助还车待验车 / Self-service return · ${row.number}`, [`${row.number} · ${row.customer?.full_name ?? ""}`, input.keyCard ? "Key card: in vehicle" : "Key card: NOT confirmed", input.note, `https://ops.${rootDomain}/reservations/${row.id}/return`].filter(Boolean));
  return { ok: true };
}

export async function runSelfServiceTick() {
  const supabase = createAdminClient();
  const now = Date.now();
  const { data } = await supabase
    .from("reservations")
    .select(columns)
    .eq("pickup_method", "SELF_SERVICE")
    .in("self_service_state", ["REQUESTED", "APPROVED"])
    .in("status", ["REQUESTED", "PENDING_PAYMENT", "CONFIRMED"])
    .gt("pickup_at", new Date(now - 6 * 3600000).toISOString())
    .lt("pickup_at", new Date(now + 60 * 3600000).toISOString());
  const rows = (data ?? []) as unknown as SelfServiceRow[];
  const result = { checked: rows.length, reminders: 0, fallbacks: 0, holds: 0, alerts: 0 };
  for (const row of rows) {
    const hours = (new Date(row.pickup_at).getTime() - now) / 3600000;
    const list = checklistFor(row);
    if (hours <= 54 && hours > 24 && !row.self_reminder_2d_at && !list.complete) {
      await sendSelfServiceEmail(row, "reminder2d");
      await supabase.from("reservations").update({ self_reminder_2d_at: new Date().toISOString() }).eq("id", row.id);
      result.reminders += 1;
    }
    if (hours <= 30 && hours > 24 && !row.self_reminder_1d_at && !list.complete) {
      await sendSelfServiceEmail(row, "reminder1d");
      await supabase.from("reservations").update({ self_reminder_1d_at: new Date().toISOString() }).eq("id", row.id);
      result.reminders += 1;
    }
    if (hours <= 24 && !list.complete) {
      await setSelfServiceState(row.id, "FALLBACK");
      await audit("self_service.fallback", row.id, { userId: null, type: "SYSTEM" }, { reason: "checklist_incomplete" });
      await sendSelfServiceEmail(row, "fallback");
      result.fallbacks += 1;
      continue;
    }
    if (hours <= 12 && row.self_service_state === "REQUESTED") {
      await setSelfServiceState(row.id, "FALLBACK");
      await audit("self_service.fallback", row.id, { userId: null, type: "SYSTEM" }, { reason: "not_reviewed" });
      await sendSelfServiceEmail(row, "fallback");
      await notifyOps(`自助取车未审核已改人工 · ${row.number}`, [`${row.number} · ${row.customer?.full_name ?? ""}`, `https://ops.${rootDomain}/reservations/${row.id}`]);
      result.fallbacks += 1;
      continue;
    }
    if (hours <= 24 && row.self_service_state === "APPROVED" && list.complete && !list.hold) {
      const hold = await ensureHold(row);
      if (hold.ok) result.holds += 1;
      else {
        await setSelfServiceState(row.id, "FALLBACK");
        await sendSelfServiceEmail(row, "fallback");
        await notifyOps(`自助取车押金预授权失败 · ${row.number}`, [`${row.number} · ${row.customer?.full_name ?? ""} · ${hold.error}`, `https://ops.${rootDomain}/reservations/${row.id}`]);
        result.fallbacks += 1;
        continue;
      }
    }
    if (hours <= 12 && hours > 11 && row.self_service_state === "APPROVED" && !row.access_link) {
      await notifyOps(`自助取车缺少用车邀请链接 · ${row.number}`, [`${row.number} · ${row.customer?.full_name ?? ""} · pickup ${row.pickup_at}`, `https://ops.${rootDomain}/reservations/${row.id}`]);
      result.alerts += 1;
    }
  }
  return result;
}
