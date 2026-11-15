import { useCallback, useRef, type MouseEvent, type PointerEvent } from "react";

/**
 * Press-and-hold (phone) or right-click (computer) calls onLongPress; a normal tap still
 * does the card's usual action. One shared timer is enough since only one finger presses.
 *
 * Usage: <button {...bind(id, () => onTap())}>
 */
export function useLongPress(onLongPress: (id: string) => void) {
  const state = useRef({ timer: 0, x: 0, y: 0, fired: false });

  const cancel = useCallback(() => window.clearTimeout(state.current.timer), []);

  return useCallback((id: string, onTap: () => void) => ({
    onPointerDown: (event: PointerEvent) => {
      if (event.button !== 0) return;
      const s = state.current;
      s.fired = false;
      s.x = event.clientX;
      s.y = event.clientY;
      window.clearTimeout(s.timer);
      s.timer = window.setTimeout(() => {
        s.fired = true;
        navigator.vibrate?.(15);
        onLongPress(id);
      }, 450);
    },
    onPointerMove: (event: PointerEvent) => {
      const s = state.current;
      if (Math.hypot(event.clientX - s.x, event.clientY - s.y) > 10) window.clearTimeout(s.timer);
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onContextMenu: (event: MouseEvent) => {
      event.preventDefault(); // no "save image" menu on phones; right-click opens details on computers
      cancel();
      state.current.fired = true;
      onLongPress(id);
    },
    onClick: () => {
      if (state.current.fired) {
        state.current.fired = false; // this click is the end of a long-press, not a tap
        return;
      }
      onTap();
    },
  }), [cancel, onLongPress]);
}
