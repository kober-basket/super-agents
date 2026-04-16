import clsx from "clsx";
import { Brain, ChevronDown } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from "react";

interface ReasoningContextValue {
  duration: number;
  isOpen: boolean;
  isStreaming: boolean;
  setIsOpen: (open: boolean) => void;
}

const ReasoningContext = createContext<ReasoningContextValue | null>(null);

function useReasoningContext() {
  const context = useContext(ReasoningContext);
  if (!context) {
    throw new Error("Reasoning components must be used within <Reasoning />.");
  }
  return context;
}

function formatThinkingMessage(isStreaming: boolean, duration: number) {
  if (isStreaming) {
    return "思考中...";
  }

  if (duration > 0) {
    return `已思考 ${Math.max(1, Math.round(duration / 1000))} 秒`;
  }

  return "思考过程";
}

export interface ReasoningProps extends HTMLAttributes<HTMLDivElement> {
  defaultOpen?: boolean;
  duration?: number;
  isStreaming?: boolean;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
}

export function Reasoning({
  children,
  className,
  defaultOpen = false,
  duration,
  isStreaming = false,
  onOpenChange,
  open,
  ...props
}: ReasoningProps) {
  const isControlled = open !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const [measuredDuration, setMeasuredDuration] = useState(0);
  const startedAtRef = useRef<number | null>(null);
  const previousStreamingRef = useRef(false);

  const isOpen = isControlled ? open : uncontrolledOpen;
  const setIsOpen = (nextOpen: boolean) => {
    if (!isControlled) {
      setUncontrolledOpen(nextOpen);
    }
    onOpenChange?.(nextOpen);
  };

  useEffect(() => {
    const wasStreaming = previousStreamingRef.current;

    if (isStreaming && !wasStreaming) {
      startedAtRef.current = Date.now();
      setMeasuredDuration(0);
      setIsOpen(true);
    }

    if (!isStreaming && wasStreaming) {
      setIsOpen(false);
      startedAtRef.current = null;
    }

    previousStreamingRef.current = isStreaming;
  }, [isStreaming]);

  useEffect(() => {
    if (!isStreaming || startedAtRef.current === null || duration !== undefined) {
      return undefined;
    }

    const tick = () => {
      if (startedAtRef.current === null) {
        return;
      }
      setMeasuredDuration(Date.now() - startedAtRef.current);
    };

    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [duration, isStreaming]);

  const contextValue = useMemo<ReasoningContextValue>(
    () => ({
      duration: duration ?? measuredDuration,
      isOpen,
      isStreaming,
      setIsOpen,
    }),
    [duration, isOpen, isStreaming, measuredDuration],
  );

  return (
    <ReasoningContext.Provider value={contextValue}>
      <div className={clsx("reasoning-block", isOpen && "open", className)} {...props}>
        {children}
      </div>
    </ReasoningContext.Provider>
  );
}

export interface ReasoningTriggerProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  getThinkingMessage?: (isStreaming: boolean, duration?: number) => ReactNode;
}

export function ReasoningTrigger({
  className,
  getThinkingMessage,
  onClick,
  type,
  ...props
}: ReasoningTriggerProps) {
  const { duration, isOpen, isStreaming, setIsOpen } = useReasoningContext();
  const label = getThinkingMessage?.(isStreaming, duration) ?? formatThinkingMessage(isStreaming, duration);

  return (
    <button
      aria-expanded={isOpen}
      className={clsx("reasoning-trigger", className)}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          setIsOpen(!isOpen);
        }
      }}
      type={type ?? "button"}
      {...props}
    >
      <span className="reasoning-trigger-main">
        <span className="reasoning-dot">
          <Brain size={13} />
        </span>
        <span className="reasoning-trigger-copy">{label}</span>
      </span>
      <ChevronDown size={14} className="reasoning-trigger-chevron" />
    </button>
  );
}

export interface ReasoningContentProps extends HTMLAttributes<HTMLDivElement> {
  children: string;
}

export function ReasoningContent({ children, className, ...props }: ReasoningContentProps) {
  const { isOpen } = useReasoningContext();

  if (!isOpen) {
    return null;
  }

  return (
    <div className={clsx("reasoning-content", className)} {...props}>
      <pre>{children}</pre>
    </div>
  );
}

export function useReasoning() {
  return useReasoningContext();
}
