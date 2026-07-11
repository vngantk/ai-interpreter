/** Minimal typings for the Document Picture-in-Picture API (Chromium). */
export interface DocumentPictureInPictureOptions {
  width?: number;
  height?: number;
  disallowReturnToOpener?: boolean;
  preferInitialWindowPlacement?: boolean;
}

export interface DocumentPictureInPicture {
  requestWindow(
    options?: DocumentPictureInPictureOptions,
  ): Promise<Window>;
  readonly window: Window | null;
}

declare global {
  interface Window {
    documentPictureInPicture?: DocumentPictureInPicture;
  }
}

export function isDocumentPipSupported(): boolean {
  return typeof window !== "undefined" && "documentPictureInPicture" in window;
}

/** Copy opener stylesheets and font variables into a pop-out window. */
export function copyStylesToPipWindow(pipWindow: Window): void {
  const pipDocument = pipWindow.document;

  for (const styleSheet of Array.from(document.styleSheets)) {
    try {
      const cssText = Array.from(styleSheet.cssRules)
        .map((rule) => rule.cssText)
        .join("\n");
      const style = pipDocument.createElement("style");
      style.textContent = cssText;
      pipDocument.head.appendChild(style);
    } catch {
      if (!styleSheet.href) continue;
      const link = pipDocument.createElement("link");
      link.rel = "stylesheet";
      link.href = styleSheet.href;
      if (styleSheet.media?.mediaText) {
        link.media = styleSheet.media.mediaText;
      }
      pipDocument.head.appendChild(link);
    }
  }

  pipDocument.documentElement.className = document.documentElement.className;
  pipDocument.body.className = `${document.body.className} pip-window-body`.trim();

  const rootStyles = getComputedStyle(document.documentElement);
  for (const name of [
    "--font-display",
    "--font-sans",
    "--bg-deep",
    "--bg-mid",
    "--bg-glow",
    "--ink",
    "--ink-soft",
    "--accent",
    "--accent-strong",
    "--danger",
    "--live",
    "--panel",
    "--line",
  ]) {
    const value = rootStyles.getPropertyValue(name).trim();
    if (value) {
      pipDocument.documentElement.style.setProperty(name, value);
    }
  }
}

function openPopupFallback(
  width: number,
  height: number,
  name: string,
  title: string,
): Window {
  const features = [
    "popup=yes",
    `width=${width}`,
    `height=${height}`,
    "noopener=no",
    "noreferrer=no",
  ].join(",");
  const popup = window.open("", name, features);
  if (!popup) {
    throw new Error(
      "Pop-out was blocked. Allow pop-ups for this site, or try Chrome/Edge for Picture-in-Picture.",
    );
  }
  popup.document.title = title;
  return popup;
}

export interface CaptionPopoutOptions extends DocumentPictureInPictureOptions {
  /** Unique window name for the popup fallback. */
  name: string;
  title: string;
}

/**
 * Opens an always-on-top Document PiP window when available and free,
 * otherwise a regular popup window.
 */
export async function openCaptionPopoutWindow(
  options: CaptionPopoutOptions,
): Promise<{ window: Window; mode: "pip" | "popup" }> {
  const width = options.width ?? 520;
  const height = options.height ?? 300;

  // Document PiP only allows one window; leave it free for whichever opens first.
  const pipApi = window.documentPictureInPicture;
  if (pipApi && !pipApi.window) {
    const pipWindow = await pipApi.requestWindow({ width, height });
    copyStylesToPipWindow(pipWindow);
    pipWindow.document.title = options.title;
    return { window: pipWindow, mode: "pip" };
  }

  const popup = openPopupFallback(width, height, options.name, options.title);
  copyStylesToPipWindow(popup);
  return { window: popup, mode: "popup" };
}
