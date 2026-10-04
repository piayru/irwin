import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useUi } from "./ui";

export function AssistantDock({
  children,
  assistant,
}: {
  children: ReactNode;
  assistant?: ReactNode;
}) {
  const { t } = useUi();
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; width: number } | undefined>(undefined);
  const id = useId();
  const [narrow, setNarrow] = useState(false);
  const [width, setWidth] = useState(380);
  const [view, setView] = useState<"query" | "assistant">("query");
  const open = !!assistant;
  const resize = (next: number) => setWidth(Math.max(320, Math.min(480, next)));
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setNarrow(entry.contentRect.width < 1000),
    );
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (open && narrow) setView("assistant");
    if (!open) {
      setView("query");
      drag.current = undefined;
    }
  }, [open, narrow]);
  return (
    <div
      ref={root}
      className={`assistant-dock${open ? " is-open" : ""}${narrow ? " narrow" : ""}`}
    >
      {open && narrow && (
        <nav
          className="assistant-dock-switcher"
          aria-label={t("切換查詢與 AI", "Switch query and AI")}
        >
          <button
            type="button"
            aria-pressed={view === "query"}
            onClick={() => setView("query")}
          >
            {t("查詢與結果", "Query and results")}
          </button>
          <button
            type="button"
            aria-pressed={view === "assistant"}
            onClick={() => setView("assistant")}
          >
            {t("AI 助理", "AI assistant")}
          </button>
        </nav>
      )}
      <div
        className="assistant-dock-main"
        hidden={open && narrow && view !== "query"}
      >
        {children}
      </div>
      {open && (
        <>
          {!narrow && (
            <div
              className="assistant-dock-resizer"
              role="separator"
              tabIndex={0}
              aria-label={t("調整 AI 側欄寬度", "Resize AI sidebar")}
              aria-orientation="vertical"
              aria-controls={`${id}-assistant`}
              aria-valuemin={320}
              aria-valuemax={480}
              aria-valuenow={width}
              onPointerDown={(event) => {
                event.preventDefault();
                event.currentTarget.focus();
                event.currentTarget.setPointerCapture(event.pointerId);
                drag.current = { x: event.clientX, width };
              }}
              onPointerMove={(event) => {
                if (drag.current)
                  resize(drag.current.width - (event.clientX - drag.current.x));
              }}
              onPointerUp={() => {
                drag.current = undefined;
              }}
              onPointerCancel={() => {
                drag.current = undefined;
              }}
              onLostPointerCapture={() => {
                drag.current = undefined;
              }}
              onKeyDown={(event) => {
                if (
                  ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
                ) {
                  event.preventDefault();
                  resize(
                    event.key === "Home"
                      ? 320
                      : event.key === "End"
                        ? 480
                        : width + (event.key === "ArrowLeft" ? 24 : -24),
                  );
                }
              }}
            />
          )}
          <div
            id={`${id}-assistant`}
            className="assistant-dock-panel"
            style={{ width: narrow ? "100%" : width }}
            hidden={narrow && view !== "assistant"}
          >
            {assistant}
          </div>
        </>
      )}
    </div>
  );
}
