import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Transient confirmation messages for CRUD actions.
 *
 * const { toast, showToast, dismissToast } = useToast();
 * showToast("Event deleted.");
 * showToast("Could not delete.", "danger");
 *
 * Render `{toast && <Toast {...toast} onDismiss={dismissToast} />}` in the page.
 */
export function useToast(duration = 3200) {
  const [toast, setToast] = useState(null);
  const timer = useRef(null);

  const showToast = useCallback(
    (message, tone = "success") => {
      window.clearTimeout(timer.current);
      setToast({ message, tone });
      timer.current = window.setTimeout(() => setToast(null), duration);
    },
    [duration]
  );

  const dismissToast = useCallback(() => {
    window.clearTimeout(timer.current);
    setToast(null);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return { toast, showToast, dismissToast };
}