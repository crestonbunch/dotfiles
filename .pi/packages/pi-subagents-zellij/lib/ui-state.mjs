import { projectPickerItems } from "./protocol.mjs";

/** A composer owns one target; polling or repeated confirmation cannot retarget or duplicate it. */
export class GuidanceDraft {
  sending = false;
  submitted;

  constructor(item) {
    if (!item?.targetable) throw new Error("Selected item cannot receive individual guidance.");
    this.target = Object.freeze({ id: item.id, runId: item.runId, childId: item.childId });
  }

  begin(item, message, mode) {
    if (this.sending) return undefined;
    if (!item?.targetable || item.id !== this.target.id || item.runId !== this.target.runId || item.childId !== this.target.childId) {
      throw new Error("Guidance cancelled because the selected target changed or became unavailable.");
    }
    this.submitted ??= Object.freeze({ runId: this.target.runId, ...(this.target.childId === undefined ? {} : { childId: this.target.childId }), message, mode });
    this.sending = true;
    return this.submitted;
  }

  finish() {
    this.sending = false;
  }
}

export class DashboardState {
  generation = 0;
  items = [];
  selectedId;
  transcript = "";
  status = "Connecting…";
  receipt = "";

  beginSelectionChange(itemId) {
    this.selectedId = itemId;
    this.transcript = "Loading transcript…";
    return ++this.generation;
  }

  applySnapshot(snapshot) {
    const previous = this.selectedId;
    this.items = projectPickerItems(snapshot);
    this.selectedId = this.items.some((item) => item.id === previous) ? previous : this.items[0]?.id;
    if (this.selectedId !== previous) this.generation += 1;
  }

  selected() {
    return this.items.find((item) => item.id === this.selectedId);
  }

  applyTranscript(generation, text) {
    if (generation !== this.generation) return false;
    this.transcript = text;
    return true;
  }
}
