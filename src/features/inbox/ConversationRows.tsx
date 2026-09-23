"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cn } from "@/lib/utils/cn";
import { bulkConversations } from "./actions";

export type RowItem = { id: string; href: string; title: string; subject: string; meta: string; preview: string; time: string; unread: boolean; active: boolean };
type Labels = { select: string; cancel: string; selectAll: string; selected: string; status: string; assign: string; unassigned: string; apply: string; applying: string };

export function ConversationRows({ rows, labels, statuses, staff, canManage }: { rows: RowItem[]; labels: Labels; statuses: Array<{ value: string; label: string }>; staff: Array<{ user_id: string; display_name: string }>; canManage: boolean }) {
  const router = useRouter();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [assignee, setAssignee] = useState("");
  const [pending, start] = useTransition();
  const toggle = (id: string) => setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  const allSelected = rows.length > 0 && selected.length === rows.length;
  const apply = () => {
    if (!selected.length || (!status && !assignee)) return;
    const form = new FormData();
    selected.forEach((id) => form.append("ids", id));
    form.set("status", status);
    form.set("assignedTo", assignee);
    start(async () => {
      await bulkConversations(form);
      setSelected([]);
      setSelecting(false);
      setStatus("");
      setAssignee("");
      router.refresh();
    });
  };
  const field = "h-7 rounded-pill border border-ink/10 bg-white px-2 text-xs text-charcoal";
  return (
    <>
      {canManage && (
        <div className="flex items-center gap-3 border-b border-ink/[0.07] px-3 py-1.5 text-[12px]">
          <button
            type="button"
            onClick={() => {
              setSelecting((value) => !value);
              setSelected([]);
            }}
            className={cn("rounded-pill px-2 py-0.5", selecting ? "bg-ink text-white" : "text-charcoal hover:bg-ink/5")}
          >
            {selecting ? labels.cancel : labels.select}
          </button>
          {selecting && (
            <label className="flex items-center gap-1.5 text-charcoal">
              <input type="checkbox" checked={allSelected} onChange={(event) => setSelected(event.target.checked ? rows.map((row) => row.id) : [])} className="size-3.5 accent-[#b58b4b]" />
              {labels.selectAll}
            </label>
          )}
          {selecting && selected.length > 0 && <span className="text-muted">{`${labels.selected} ${selected.length}`}</span>}
        </div>
      )}
      <ul className="min-h-0 flex-1 divide-y divide-ink/[0.06] overflow-y-auto">
        {rows.map((item) => (
          <li key={item.id} className="relative">
            {selecting && <input type="checkbox" checked={selected.includes(item.id)} onChange={() => toggle(item.id)} aria-label={item.title} className="absolute top-4 left-3 z-10 size-3.5 accent-[#b58b4b]" />}
            <Link
              href={item.href}
              aria-current={item.active ? "page" : undefined}
              onClick={
                selecting
                  ? (event) => {
                      event.preventDefault();
                      toggle(item.id);
                    }
                  : undefined
              }
              className={cn("relative block py-3 pr-4 transition-colors", selecting ? "pl-9" : "pl-4", item.active ? "bg-gold/[0.07]" : "hover:bg-ink/[0.025]")}
            >
              {item.unread && !selecting && <span aria-hidden="true" className="absolute top-[1.15rem] left-1.5 size-1.5 rounded-full bg-gold" />}
              <div className="flex items-baseline justify-between gap-3">
                <span className={cn("truncate text-sm", item.unread ? "font-semibold" : "font-medium")}>{item.title}</span>
                <span className="shrink-0 text-[11px] text-muted">{item.time}</span>
              </div>
              <p className="mt-0.5 truncate text-[11px] text-gold">{item.meta}</p>
              <p className={cn("mt-0.5 truncate text-[13px]", item.unread ? "text-ink" : "text-charcoal")}>{item.subject}</p>
              <p className="mt-0.5 truncate text-xs text-muted">{item.preview}</p>
            </Link>
          </li>
        ))}
      </ul>
      {selecting && selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-ink/[0.07] bg-pearl/60 px-3 py-2 text-[12px]">
          <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label={labels.status} className={field}>
            <option value="">{labels.status}</option>
            {statuses.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <select value={assignee} onChange={(event) => setAssignee(event.target.value)} aria-label={labels.assign} className={field}>
            <option value="">{labels.assign}</option>
            <option value="none">{labels.unassigned}</option>
            {staff.map((member) => (
              <option key={member.user_id} value={member.user_id}>
                {member.display_name}
              </option>
            ))}
          </select>
          <button type="button" onClick={apply} disabled={pending || (!status && !assignee)} className="ml-auto h-7 rounded-pill bg-ink px-3 text-xs font-medium text-white disabled:opacity-40">
            {pending ? labels.applying : labels.apply}
          </button>
        </div>
      )}
    </>
  );
}
