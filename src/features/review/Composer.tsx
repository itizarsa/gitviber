import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/api";
import { toast } from "@/lib/app/toast";

/** A new review note, kept here. */
export function Composer({
  label,
  initial = "",
  onDraft,
  onSubmit,
  onCancel,
  bare = false,
}: {
  label: string;
  /** What was typed before it was drawn again; `onDraft` hears each change to it. */
  initial?: string;
  onDraft?: (body: string) => void;
  onSubmit: (body: string) => Promise<void>;
  onCancel: () => void;
  bare?: boolean;
}) {
  const [body, setBody] = useState(initial);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!body.trim() || busy) return;
    setBusy(true);
    try {
      await onSubmit(body);
      setBody("");
      onCancel();
    } catch (e) {
      toast("error", "Could not add the note", errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const input = {
    autoFocus: true,
    value: body,
    "aria-label": label,
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setBody(e.target.value);
      onDraft?.(e.target.value);
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        e.stopPropagation();
        void submit();
      } else if (e.key === "Escape") onCancel();
    },
    rows: 3,
    placeholder: `${label}… (⌘↵ to add)`,
  };
  const box = (
    <div className="flex flex-col gap-2">
      <Textarea {...input} />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" disabled={!body.trim() || busy} onClick={() => void submit()}>
          Add Note
        </Button>
      </div>
    </div>
  );
  return bare ? box : <div className="mx-3 my-1.5 rounded-md border border-border-strong bg-panel p-2 font-sans">{box}</div>;
}
