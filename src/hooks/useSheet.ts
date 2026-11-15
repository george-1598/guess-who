import { useEffect, useRef } from "react";

/**
 * Shared behaviour for pop-up panels: focus the close button, close on Escape,
 * and stop the page behind from scrolling while the panel is open.
 * Returns a ref to put on the panel's close button.
 */
export function useSheet(onClose: () => void) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return closeRef;
}
