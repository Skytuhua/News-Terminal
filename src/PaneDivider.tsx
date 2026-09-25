import { useRef } from "react";
export default function PaneDivider({
  label,
  value,
  min,
  max,
  onChange,
  onCommit,
  invert = false,
  className = "",
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  onCommit?: (value: number) => void;
  invert?: boolean;
  className?: string;
}) {
  const drag = useRef<{ x: number; value: number; pointerId: number; latest: number } | undefined>(undefined);
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  return (
    <div
      className={`pane-divider ${className}`}
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      title="Drag to resize. Arrow keys adjust; Home and End select minimum and maximum."
      onPointerDown={(e) => {
        if (e.button !== 0 || drag.current) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, value, pointerId: e.pointerId, latest: value };
      }}
      onPointerMove={(e) => {
        if (drag.current?.pointerId === e.pointerId) {
          drag.current.latest = clamp(drag.current.value + (e.clientX - drag.current.x) * (invert ? -1 : 1));
          onChange(drag.current.latest);
        }
      }}
      onPointerUp={(e) => {
        if (drag.current?.pointerId !== e.pointerId) return;
        onCommit?.(drag.current.latest);
        drag.current = undefined;
      }}
      onPointerCancel={() => {
        if (drag.current) onChange(drag.current.value);
        drag.current = undefined;
      }}
      onLostPointerCapture={() => {
        if (drag.current) onChange(drag.current.value);
        drag.current = undefined;
      }}
      onKeyDown={(e) => {
        if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
          e.preventDefault();
          e.stopPropagation();
          const next = e.key === "Home"
              ? min
              : e.key === "End"
                ? max
                : clamp(
                    value +
                      (e.key === "ArrowRight" ? 10 : -10) * (invert ? -1 : 1),
                  );
          onChange(next);
          onCommit?.(next);
        }
      }}
    />
  );
}
