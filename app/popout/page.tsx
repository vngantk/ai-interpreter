"use client";

import { useEffect } from "react";

/** Same-origin shell for caption pop-out fallbacks (avoids about:blank). */
export default function PopoutPage() {
  useEffect(() => {
    const title = new URLSearchParams(window.location.search).get("title");
    if (title) {
      document.title = title;
    }
  }, []);

  return null;
}
