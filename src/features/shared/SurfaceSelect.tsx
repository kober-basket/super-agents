import { useEffect, useId, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Check, ChevronDown } from "lucide-react";

export interface SurfaceSelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

interface SurfaceSelectProps {
  value: string;
  options: SurfaceSelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  disabled?: boolean;
  placeholder?: string;
  emptyLabel?: string;
  className?: string;
  triggerClassName?: string;
  panelClassName?: string;
  listClassName?: string;
  optionClassName?: string;
  align?: "left" | "right";
  fullWidth?: boolean;
}

export function SurfaceSelect({
  value,
  options,
  onChange,
  ariaLabel,
  disabled = false,
  placeholder,
  emptyLabel = "暂无可选项",
  className,
  triggerClassName,
  panelClassName,
  listClassName,
  optionClassName,
  align = "left",
  fullWidth = false,
}: SurfaceSelectProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();
  const [open, setOpen] = useState(false);

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value],
  );
  const hasEnabledOption = options.some((option) => option.disabled !== true);
  const triggerDisabled = disabled || !hasEnabledOption;
  const displayLabel = selectedOption?.label ?? placeholder ?? emptyLabel;

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current && !rootRef.current.contains(target)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (triggerDisabled && open) {
      setOpen(false);
    }
  }, [open, triggerDisabled]);

  return (
    <div ref={rootRef} className={clsx("surface-select", fullWidth && "full-width", className)}>
      <button
        aria-controls={open ? listboxId : undefined}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        className={clsx("surface-select-trigger", open && "open", triggerClassName)}
        disabled={triggerDisabled}
        onClick={() => {
          if (triggerDisabled) return;
          setOpen((current) => !current);
        }}
        title={displayLabel}
        type="button"
      >
        <span className="surface-select-trigger-value">{displayLabel}</span>
        <ChevronDown className="surface-select-trigger-icon" size={16} />
      </button>

      {open ? (
        <div className={clsx("surface-select-panel", align === "right" && "align-right", panelClassName)}>
          <div aria-label={ariaLabel} className={clsx("surface-select-list", listClassName)} id={listboxId} role="listbox">
            {options.map((option) => {
              const selected = option.value === selectedOption?.value;
              return (
                <button
                  key={option.value}
                  aria-selected={selected}
                  className={clsx(
                    "surface-select-option",
                    selected && "selected",
                    option.disabled && "disabled",
                    optionClassName,
                  )}
                  disabled={option.disabled}
                  onClick={() => {
                    if (option.disabled) return;
                    onChange(option.value);
                    setOpen(false);
                  }}
                  role="option"
                  type="button"
                >
                  <span className="surface-select-option-copy">
                    <strong title={option.label}>{option.label}</strong>
                    {option.description ? <span>{option.description}</span> : null}
                  </span>
                  <span className={clsx("surface-select-check", selected && "selected")}>
                    <Check size={13} />
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
