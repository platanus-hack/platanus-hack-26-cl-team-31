"use client";

import { useEffect, useEffectEvent, useState } from "react";

export function useUndoWindow(onExpire: () => void) {
  const [scheduled, setScheduled] = useState(false);
  const expire = useEffectEvent(onExpire);

  useEffect(() => {
    if (!scheduled) return;
    const timer = setTimeout(() => {
      setScheduled(false);
      expire();
    }, 5000);
    return () => clearTimeout(timer);
  }, [scheduled]);

  return { scheduled, schedule: () => setScheduled(true), undo: () => setScheduled(false) };
}
