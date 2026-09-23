import "server-only";
import { notifyInvestor, notifyStaff } from "@/features/notifications/center";
import { sendEmail } from "@/lib/email";
import { renderEmail } from "@/lib/email/template";
import { investorOrigin, opsOrigin } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatMoney } from "@/lib/utils/format";
import { emailAllowed } from "./preferences";

type Text = { zh: string; en: string };

const texts: Record<string, { title: Text; body: Text }> = {
  capital_received: { title: { zh: "资金已到账", en: "Funds received" }, body: { zh: "你的投入资金 {amount} 已确认到账，已计入可提现余额。", en: "Your contribution of {amount} has been received and added to your available balance." } },
  contribution_declined: { title: { zh: "投入申请未通过", en: "Contribution request declined" }, body: { zh: "你的投入申请未通过。{note}", en: "Your contribution request was declined. {note}" } },
  vehicle_onboarded: { title: { zh: "车辆已接入运营", en: "Vehicle onboarded" }, body: { zh: "你的车辆 {vehicle} 已加入 Movia 车队并开始运营。", en: "Your vehicle {vehicle} has joined the Movia fleet and is now in operation." } },
  vehicle_allocated: { title: { zh: "已为你配置车辆", en: "Vehicle allocated" }, body: { zh: "已用你的资金 {amount} 配置车辆 {vehicle}，从 {date} 起开始运营。", en: "{amount} of your capital has been allocated to {vehicle}, in operation from {date}." } },
  allocation_ended: { title: { zh: "车辆已退出运营", en: "Vehicle exited" }, body: { zh: "车辆 {vehicle} 已退出运营，返还 {amount} 已计入可提现余额。", en: "{vehicle} has exited operation. {amount} has been returned to your available balance." } },
  ledger_adjusted: { title: { zh: "账户有一笔调整", en: "Account adjustment" }, body: { zh: "{amount} · {memo}", en: "{amount} · {memo}" } },
  share_settled: { title: { zh: "分成已结算", en: "Earnings settled" }, body: { zh: "{amount} 已结算并转入可提现余额。", en: "{amount} has been settled and moved to your available balance." } },
  hold_placed: { title: { zh: "分成暂缓结算", en: "Settlement on hold" }, body: { zh: "部分分成暂缓结算：{reason}", en: "Some earnings are on hold: {reason}" } },
  hold_released: { title: { zh: "暂缓已解除", en: "Hold released" }, body: { zh: "暂缓的分成将在下次结算时转入可提现余额。", en: "Held earnings will settle at the next settlement run." } },
  withdrawal_approved: { title: { zh: "提现已批准", en: "Withdrawal approved" }, body: { zh: "提现 {amount} 已批准，转账完成后会再通知你。", en: "Your withdrawal of {amount} is approved. We will notify you once the transfer is made." } },
  withdrawal_paid: { title: { zh: "提现已到账", en: "Withdrawal paid" }, body: { zh: "提现 {amount} 已转出至尾号 {last4} 的账户。参考号 {reference}", en: "{amount} has been sent to the account ending {last4}. Reference {reference}" } },
  withdrawal_declined: { title: { zh: "提现未通过", en: "Withdrawal declined" }, body: { zh: "提现 {amount} 未通过，金额已退回可提现余额。{note}", en: "Your withdrawal of {amount} was declined and returned to your available balance. {note}" } },
  bank_account_changed: { title: { zh: "收款账户已变更", en: "Payout account changed" }, body: { zh: "你的账户新增或修改了收款账户（尾号 {last4}）。不是你本人操作的话请立即联系我们。", en: "A payout account ending {last4} was added or changed on your account. Contact us immediately if this wasn't you." } },
  exit_updated: { title: { zh: "退出申请有更新", en: "Exit request updated" }, body: { zh: "车辆 {vehicle} 的退出申请状态：{status}。{note}", en: "Exit request for {vehicle}: {status}. {note}" } },
  document_added: { title: { zh: "新文件", en: "New document" }, body: { zh: "新增文件：{title}", en: "A new document was added: {title}" } },
  new_device_signin: { title: { zh: "新设备登录", en: "New device sign-in" }, body: { zh: "你的账户刚在新设备上完成登录（{ip}）。不是你本人操作的话请立即修改密码并联系我们。", en: "Your account was just signed in on a new device ({ip}). If this wasn't you, change your password and contact us." } },
  statement_issued: { title: { zh: "里程账单已出具", en: "Mileage statement issued" }, body: { zh: "{month} 车辆 {vehicle}：计费里程 {miles} 英里，里程费 {amount}。如有异议，请在 7 天内在账单页提出。", en: "{month} · {vehicle}: {miles} qualifying miles, {amount}. Disputes can be raised on the statement page within 7 days." } },
  statement_revised: { title: { zh: "里程账单已修订", en: "Mileage statement revised" }, body: { zh: "{month} 车辆 {vehicle} 的账单已修订：计费里程 {miles} 英里，里程费 {amount}。", en: "The {month} statement for {vehicle} was revised: {miles} qualifying miles, {amount}." } },
  statement_resolved: { title: { zh: "账单异议已处理", en: "Statement dispute resolved" }, body: { zh: "{month} 车辆 {vehicle}：认可 {miles} 英里，本期里程费 {amount}。{note}", en: "{month} · {vehicle}: {miles} miles accepted, statement total {amount}. {note}" } },
  payout_scheduled: { title: { zh: "已安排付款", en: "Payout scheduled" }, body: { zh: "{amount} 将转至尾号 {last4} 的账户，到账后会再通知你。", en: "{amount} will be sent to the account ending {last4}. We will notify you once the transfer is made." } },
  bank_request_approved: { title: { zh: "收款账户申请已通过", en: "Payout account request approved" }, body: { zh: "尾号 {last4} 的收款账户申请已通过。", en: "Your request for the payout account ending {last4} was approved." } },
  bank_request_declined: { title: { zh: "收款账户申请未通过", en: "Payout account request declined" }, body: { zh: "尾号 {last4} 的收款账户申请未通过。{note}", en: "Your request for the payout account ending {last4} was declined. {note}" } },
  payout_no_account: { title: { zh: "请添加收款账户", en: "Add a payout account" }, body: { zh: "你有 {amount} 待付款。添加收款账户后会自动安排转账。", en: "{amount} is waiting to be paid. Add a payout account and the transfer will be scheduled automatically." } },
};

const ownerTexts: Record<string, { title: Text; body: Text }> = {
  share_settled: { title: { zh: "里程费已结算", en: "Mileage fee settled" }, body: { zh: "{amount} 已结算并转入可提现余额。", en: "{amount} has been settled and moved to your available balance." } },
  hold_placed: { title: { zh: "里程费暂缓结算", en: "Settlement on hold" }, body: { zh: "部分里程费暂缓结算：{reason}", en: "Part of your mileage fee is on hold: {reason}" } },
  hold_released: { title: { zh: "暂缓已解除", en: "Hold released" }, body: { zh: "暂缓的里程费将在下次结算时转入可提现余额。", en: "Held mileage fees will settle at the next settlement run." } },
};

function fill(template: string, params: Record<string, string>) {
  return template.replace(/\{(\w+)\}/g, (_, key) => params[key] ?? "").trim();
}

export type NotifyOptions = { dedupeKey?: string; email?: boolean; to?: string | null; entryIds?: string[]; cents?: Record<string, number> };

const memberKinds = new Set(["share_posted", "share_settled", "vehicle_onboarded", "vehicle_allocated", "allocation_ended", "hold_placed", "hold_released", "ledger_adjusted", "bank_account_changed", "document_added"]);

async function memberParams(memberId: string, params: Record<string, string>, options: NotifyOptions): Promise<Record<string, string> | null> {
  if (!("amount" in params)) return params;
  const admin = createAdminClient();
  if (options.entryIds?.length) {
    let cents = 0;
    for (let index = 0; index < options.entryIds.length; index += 100) {
      const { data } = await admin.from("investor_member_ledger").select("amount_cents").eq("member_id", memberId).in("id", options.entryIds.slice(index, index + 100));
      cents += ((data ?? []) as Array<{ amount_cents: number }>).reduce((sum, row) => sum + row.amount_cents, 0);
    }
    return cents === 0 ? null : { ...params, amount: formatMoney(cents) };
  }
  if (options.cents?.amount !== undefined) {
    const { data } = await admin.from("investor_member_balances").select("ratio").eq("member_id", memberId).maybeSingle();
    const cents = Math.round(options.cents.amount * Number(data?.ratio ?? 0));
    return cents === 0 ? null : { ...params, amount: formatMoney(cents) };
  }
  return null;
}

export async function notifyInvestorEvent(investorId: string, kind: string, params: Record<string, string> = {}, href = "/", options: NotifyOptions = {}) {
  if (options.to) {
    await deliver(options.to, kind, params, href, options);
    return;
  }
  await deliver(investorId, kind, params, href, options);
  if (!memberKinds.has(kind)) return;
  const { data: members } = await createAdminClient().from("investors").select("id").eq("company_id", investorId).eq("status", "ACTIVE");
  for (const member of (members ?? []) as Array<{ id: string }>) {
    const scaled = await memberParams(member.id, params, options);
    if (scaled) await deliver(member.id, kind, scaled, href, { email: options.email, dedupeKey: options.dedupeKey ? `${options.dedupeKey}:${member.id}` : undefined });
  }
}

async function deliver(investorId: string, kind: string, params: Record<string, string>, href: string, options: { dedupeKey?: string; email?: boolean }) {
  const fresh = await notifyInvestor(investorId, { kind, params, href, dedupeKey: options.dedupeKey ?? null });
  if (options.email === false || (options.dedupeKey && !fresh)) return;
  if (!texts[kind]) return;
  if (!(await emailAllowed(investorId, kind))) return;
  const { data: investor } = await createAdminClient().from("investors").select("email, preferred_language, compensation").eq("id", investorId).maybeSingle();
  if (!investor?.email) return;
  const text = (investor.compensation === "PER_MILE" ? ownerTexts[kind] : undefined) ?? texts[kind];
  const zh = investor.preferred_language !== "en";
  const title = zh ? text.title.zh : text.title.en;
  const body = fill(zh ? text.body.zh : text.body.en, params);
  const rendered = renderEmail({
    title,
    blocks: [
      { type: "paragraph", text: body },
      { type: "button", label: zh ? "查看" : "View", href: `${investorOrigin}${href}` },
    ],
  });
  await sendEmail({ log: "investor", to: investor.email, subject: `Movia · ${title}`, text: rendered.text, html: rendered.html });
}

export async function notifyStaffInvestorEvent(kind: string, params: Record<string, string>, href: string, dedupeKey?: string) {
  await notifyStaff({ kind, params, href, dedupeKey: dedupeKey ?? null });
  const to = process.env.NOTIFY_EMAIL;
  if (!to) return;
  const rows = Object.entries(params).map(([key, value]) => [key, value] as [string, string]);
  const rendered = renderEmail({ title: `投资人 · ${kind}`, blocks: [{ type: "rows", rows }, { type: "button", label: "查看", href: `${opsOrigin}${href}` }] });
  await sendEmail({ log: "staff", to, subject: `投资人 · ${kind} · ${params.name ?? ""}`, text: rendered.text, html: rendered.html });
}
