"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { formatDateTime } from "@/lib/utils/format";
import { addNote, deleteNote, updateNote } from "./actions";

export type NoteItem = { id: string; body: string; author: string | null; at: string };

function NoteRow({ conversationId, note, canEdit }: { conversationId: string; note: NoteItem; canEdit: boolean }) {
  const t = useTranslations("inbox");
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);
  const [pending, start] = useTransition();
  const save = () => {
    const form = new FormData();
    form.set("conversationId", conversationId);
    form.set("id", note.id);
    form.set("body", draft);
    start(async () => {
      await updateNote(form);
      setEditing(false);
      router.refresh();
    });
  };
  const remove = () => {
    if (!confirm(t("notes.confirmDelete"))) return;
    const form = new FormData();
    form.set("conversationId", conversationId);
    form.set("id", note.id);
    start(async () => {
      await deleteNote(form);
      router.refresh();
    });
  };
  return (
    <li className="rounded-xl border border-status-limited/40 bg-status-limited/[0.06] px-3 py-2.5">
      {editing ? (
        <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={3} maxLength={20000} className="w-full resize-y rounded-lg border border-status-limited/40 bg-white px-2.5 py-2 text-[13px] focus:border-status-limited/70 focus:outline-none" />
      ) : (
        <p className="break-words whitespace-pre-wrap text-[13px]">{note.body}</p>
      )}
      <div className="mt-1.5 flex items-center gap-3 text-[11px] text-muted">
        <span className="truncate">
          {note.author ? `${note.author} · ` : ""}
          {formatDateTime(note.at)}
        </span>
        {canEdit && !editing && (
          <>
            <button type="button" onClick={() => setEditing(true)} className="ml-auto hover:text-ink">
              {t("notes.edit")}
            </button>
            <button type="button" onClick={remove} disabled={pending} className="hover:text-status-danger">
              {t("notes.delete")}
            </button>
          </>
        )}
        {editing && (
          <>
            <button type="button" onClick={save} disabled={pending || !draft.trim()} className="ml-auto font-medium text-ink">
              {t("saveNote")}
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(note.body);
                setEditing(false);
              }}
              className="hover:text-ink"
            >
              {t("notes.cancel")}
            </button>
          </>
        )}
      </div>
    </li>
  );
}

export function NotesPanel({ conversationId, notes, canEdit }: { conversationId: string; notes: NoteItem[]; canEdit: boolean }) {
  const t = useTranslations("inbox");
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [pending, start] = useTransition();
  const add = () => {
    if (!draft.trim()) return;
    const form = new FormData();
    form.set("conversationId", conversationId);
    form.set("body", draft);
    start(async () => {
      await addNote(form);
      setDraft("");
      router.refresh();
    });
  };
  return (
    <section className="card p-5 text-[13px]">
      <h2 className="mb-1 text-sm font-semibold">{t("notes.title")}</h2>
      <p className="mb-3 text-[11px] text-muted">{t("noteHint")}</p>
      {notes.length === 0 ? (
        <p className="text-muted">{t("notes.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {notes.map((note) => (
            <NoteRow key={note.id} conversationId={conversationId} note={note} canEdit={canEdit} />
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="mt-3">
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={3} maxLength={20000} placeholder={t("notePlaceholder")} className="w-full resize-y rounded-xl border border-status-limited/40 bg-status-limited/[0.06] px-3 py-2 text-[13px] placeholder:text-muted/70 focus:border-status-limited/70 focus:outline-none" />
          <Button type="button" size="sm" variant="secondary" onClick={add} disabled={pending || !draft.trim()} className="mt-2">
            {t("saveNote")}
          </Button>
        </div>
      )}
    </section>
  );
}
