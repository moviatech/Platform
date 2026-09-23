import "server-only";
import { notifyInvestor, notifyStaff } from "@/features/notifications/center";
import { sendEmail } from "@/lib/email";
import { renderEmail } from "@/lib/email/template";
import { investorOrigin, opsOrigin } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
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
};

function fill(template: string, params: Record<string, string>) {
  return template.replace(/\{(\w+)\}/g, (_, key) => params[key] ?? "").trim();
}

export async function notifyInvestorEvent(investorId: string, kind: string, params: Record<string, string> = {}, href = "/", options: { dedupeKey?: string; email?: boolean } = {}) {
  await notifyInvestor(investorId, { kind, params, href, dedupeKey: options.dedupeKey ?? null });
  if (options.email === false) return;
  const text = texts[kind];
  if (!text) return;
  if (!(await emailAllowed(investorId, kind))) return;
  const { data: investor } = await createAdminClient().from("investors").select("email, preferred_language").eq("id", investorId).maybeSingle();
  if (!investor?.email) return;
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
  await sendEmail({ to: investor.email, subject: `Movia · ${title}`, text: rendered.text, html: rendered.html });
}

export async function notifyStaffInvestorEvent(kind: string, params: Record<string, string>, href: string, dedupeKey?: string) {
  await notifyStaff({ kind, params, href, dedupeKey: dedupeKey ?? null });
  const to = process.env.NOTIFY_EMAIL;
  if (!to) return;
  const rows = Object.entries(params).map(([key, value]) => [key, value] as [string, string]);
  const rendered = renderEmail({ title: `投资人 · ${kind}`, blocks: [{ type: "rows", rows }, { type: "button", label: "查看", href: `${opsOrigin}${href}` }] });
  await sendEmail({ to, subject: `投资人 · ${kind} · ${params.name ?? ""}`, text: rendered.text, html: rendered.html });
}
