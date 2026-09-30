const lockedDialogs = new Map<HTMLElement, boolean>();
function blockRestartInput(event: Event) {
  event.preventDefault();
  event.stopImmediatePropagation();
}

// Lock before acknowledging readiness, not after native installation starts.
// showModal dialogs escape ancestor inertness, so lock those explicitly too.
export function setUpdateRestartLock(locked: boolean) {
  document.body.inert = locked;
  if (locked) {
    for (const dialog of document.querySelectorAll<HTMLElement>(
      "dialog[open]",
    )) {
      if (!lockedDialogs.has(dialog)) lockedDialogs.set(dialog, dialog.inert);
      dialog.inert = true;
    }
  } else {
    for (const [dialog, previous] of lockedDialogs) dialog.inert = previous;
    lockedDialogs.clear();
  }
  for (const event of ["keydown", "pointerdown", "click"]) {
    if (locked)
      window.addEventListener(event, blockRestartInput, { capture: true });
    else
      window.removeEventListener(event, blockRestartInput, { capture: true });
  }
}
