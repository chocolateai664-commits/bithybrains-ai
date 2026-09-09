import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { validateContainerNumber } from "@/lib/iso6346";

export interface TrackingFormProps {
  onTrack: (containerNumber: string) => void;
  pending: boolean;
  creditsRemaining: number;
}

export function TrackingForm({ onTrack, pending, creditsRemaining }: TrackingFormProps) {
  const [value, setValue] = useState("");
  const iso = validateContainerNumber(value);
  const showHint = value.trim().length > 0 && !iso.valid;

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (iso.valid) onTrack(iso.normalized);
      }}
    >
      <label className="label-mono block" htmlFor="container-number">
        Quick track
      </label>
      <div className="flex flex-wrap gap-2">
        <Input
          id="container-number"
          value={value}
          onChange={(e) => setValue(e.target.value.toUpperCase())}
          placeholder="Enter container number, e.g. MSCU1234567"
          className="min-w-[240px] flex-1 font-mono uppercase"
          maxLength={20}
          autoComplete="off"
        />
        <Button type="submit" disabled={!iso.valid || pending || creditsRemaining <= 0}>
          {pending ? "Tracking…" : "Track"}
        </Button>
      </div>
      {showHint ? <p className="text-xs text-destructive">{iso.message}</p> : null}
      {creditsRemaining <= 0 ? (
        <p className="text-xs text-muted-foreground">You have no tracking credits left. Buy credits below to continue.</p>
      ) : null}
    </form>
  );
}
