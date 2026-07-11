"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ensureMicrophonePermission,
  formatAudioInputLabel,
  listAudioInputDevices,
  type AudioInputDevice,
} from "@/lib/audio-devices";
import {
  CHINESE_SCRIPTS,
  DEFAULT_CHINESE_SCRIPT,
  formatChineseCaption,
  type ChineseScript,
} from "@/lib/chinese-script";
import { openCaptionPopoutWindow } from "@/lib/document-pip";
import {
  DEFAULT_TARGET_LANGUAGE,
  OUTPUT_LANGUAGES,
  type OutputLanguageCode,
} from "@/lib/languages";
import {
  TranslationSession,
  type AudioSource,
  type SessionStatus,
} from "@/lib/translation-session";

type PopoutConfig = {
  name: string;
  title: string;
};

export default function TranslatorApp() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sessionRef = useRef<TranslationSession | null>(null);
  const chineseScriptRef = useRef<ChineseScript>(DEFAULT_CHINESE_SCRIPT);
  const rawOutputRef = useRef("");
  const outputCaptionRef = useRef<HTMLDivElement | null>(null);
  const inputCaptionRef = useRef<HTMLDivElement | null>(null);

  const outputPipWindowRef = useRef<Window | null>(null);
  const outputPipPollRef = useRef<number | null>(null);
  const inputPipWindowRef = useRef<Window | null>(null);
  const inputPipPollRef = useRef<number | null>(null);

  const [targetLanguage, setTargetLanguage] = useState<OutputLanguageCode>(
    DEFAULT_TARGET_LANGUAGE,
  );
  const [chineseScript, setChineseScript] = useState<ChineseScript>(
    DEFAULT_CHINESE_SCRIPT,
  );
  const [source, setSource] = useState<AudioSource>("microphone");
  const [audioDevices, setAudioDevices] = useState<AudioInputDevice[]>([]);
  const [audioDeviceId, setAudioDeviceId] = useState("default");
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [statusMessage, setStatusMessage] = useState("Ready to translate");
  const [outputTranscript, setOutputTranscript] = useState("");
  const [inputTranscript, setInputTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [translationEnabled, setTranslationEnabled] = useState(true);
  const [volume, setVolume] = useState(1);
  const [originalEnabled, setOriginalEnabled] = useState(false);
  const [sourceVolume, setSourceVolume] = useState(1);
  const [controlsCollapsed, setControlsCollapsed] = useState(false);
  const [livePanelCollapsed, setLivePanelCollapsed] = useState(true);
  const [sourcePanelCollapsed, setSourcePanelCollapsed] = useState(true);
  const [outputPipContainer, setOutputPipContainer] =
    useState<HTMLElement | null>(null);
  const [inputPipContainer, setInputPipContainer] =
    useState<HTMLElement | null>(null);

  const isRunning =
    status === "connecting" || status === "live" || status === "reconnecting";
  const showChineseScript = targetLanguage === "zh";
  const selectedMicLabel =
    audioDevices.find((device) => device.deviceId === audioDeviceId)?.label ??
    "Microphone";
  const outputInPip = outputPipContainer !== null;
  const inputInPip = inputPipContainer !== null;

  const controlsSummary = [
    OUTPUT_LANGUAGES.find((language) => language.code === targetLanguage)
      ?.label ?? targetLanguage,
    source === "microphone" ? selectedMicLabel : "Browser tab",
    showChineseScript
      ? CHINESE_SCRIPTS.find((script) => script.id === chineseScript)?.label
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const refreshAudioDevices = useCallback(async () => {
    try {
      await ensureMicrophonePermission();
      const devices = await listAudioInputDevices();
      setAudioDevices(devices);
      setAudioDeviceId((current) =>
        devices.some((device) => device.deviceId === current)
          ? current
          : (devices[0]?.deviceId ?? "default"),
      );
    } catch (deviceError) {
      setAudioDevices([]);
      setError(
        deviceError instanceof Error
          ? deviceError.message
          : "Could not list audio input devices.",
      );
    }
  }, []);

  useEffect(() => {
    chineseScriptRef.current = chineseScript;
  }, [chineseScript]);

  const clearPipPoll = useCallback((pollRef: { current: number | null }) => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const closePopout = useCallback(
    (
      windowRef: { current: Window | null },
      pollRef: { current: number | null },
      setContainer: (value: HTMLElement | null) => void,
    ) => {
      clearPipPoll(pollRef);
      const popout = windowRef.current;
      windowRef.current = null;
      setContainer(null);
      if (popout && !popout.closed) {
        popout.close();
      }
    },
    [clearPipPoll],
  );

  const closeOutputPip = useCallback(() => {
    closePopout(outputPipWindowRef, outputPipPollRef, setOutputPipContainer);
  }, [closePopout]);

  const closeInputPip = useCallback(() => {
    closePopout(inputPipWindowRef, inputPipPollRef, setInputPipContainer);
  }, [closePopout]);

  const openPopout = useCallback(
    async (
      windowRef: { current: Window | null },
      pollRef: { current: number | null },
      setContainer: (value: HTMLElement | null) => void,
      config: PopoutConfig,
    ) => {
      if (windowRef.current) return;

      try {
        setError(null);
        const { window: popout, mode } = await openCaptionPopoutWindow({
          width: 520,
          height: 300,
          name: config.name,
          title: config.title,
        });
        windowRef.current = popout;

        const container = popout.document.createElement("div");
        container.className = "pip-caption-root";
        popout.document.body.appendChild(container);
        setContainer(container);

        const onPageHide = () => {
          popout.removeEventListener("pagehide", onPageHide);
          if (windowRef.current === popout) {
            clearPipPoll(pollRef);
            windowRef.current = null;
            setContainer(null);
          }
        };
        popout.addEventListener("pagehide", onPageHide);

        if (mode === "popup") {
          pollRef.current = window.setInterval(() => {
            if (windowRef.current?.closed) {
              clearPipPoll(pollRef);
              windowRef.current = null;
              setContainer(null);
            }
          }, 500);
        }
      } catch (pipError) {
        setError(
          pipError instanceof Error
            ? pipError.message
            : "Could not open pop-out window.",
        );
      }
    },
    [clearPipPoll],
  );

  const openOutputPip = useCallback(() => {
    void openPopout(
      outputPipWindowRef,
      outputPipPollRef,
      setOutputPipContainer,
      {
        name: "ai-interpreter-translated-captions",
        title: "Translated captions",
      },
    );
  }, [openPopout]);

  const openInputPip = useCallback(() => {
    void openPopout(inputPipWindowRef, inputPipPollRef, setInputPipContainer, {
      name: "ai-interpreter-source-transcript",
      title: "Source transcript",
    });
  }, [openPopout]);

  useEffect(() => {
    return () => {
      sessionRef.current?.stop();
      sessionRef.current = null;
      clearPipPoll(outputPipPollRef);
      clearPipPoll(inputPipPollRef);
      outputPipWindowRef.current?.close();
      outputPipWindowRef.current = null;
      inputPipWindowRef.current?.close();
      inputPipWindowRef.current = null;
    };
  }, [clearPipPoll]);

  useEffect(() => {
    if (source !== "microphone") return;

    // Defer so the effect only subscribes; device list updates from the timer /
    // devicechange callbacks (avoids synchronous setState-in-effect).
    const timer = window.setTimeout(() => {
      void refreshAudioDevices();
    }, 0);

    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.addEventListener) {
      return () => {
        window.clearTimeout(timer);
      };
    }

    const onDeviceChange = () => {
      void refreshAudioDevices();
    };
    mediaDevices.addEventListener("devicechange", onDeviceChange);
    return () => {
      window.clearTimeout(timer);
      mediaDevices.removeEventListener("devicechange", onDeviceChange);
    };
  }, [source, refreshAudioDevices]);

  useEffect(() => {
    sessionRef.current?.setTranslatedVolume(volume);
  }, [volume]);

  useEffect(() => {
    sessionRef.current?.setTranslatedMuted(!translationEnabled);
  }, [translationEnabled]);

  useEffect(() => {
    sessionRef.current?.setSourceVolume(
      originalEnabled ? sourceVolume : 0,
    );
  }, [originalEnabled, sourceVolume]);

  // Re-render captions when the user toggles script mid-session.
  useEffect(() => {
    if (targetLanguage !== "zh") return;
    setOutputTranscript(
      formatChineseCaption(rawOutputRef.current, chineseScript),
    );
  }, [chineseScript, targetLanguage]);

  useEffect(() => {
    const el = outputCaptionRef.current;
    if (!el) return;

    if (outputInPip) {
      const pipDocument = el.ownerDocument;
      const scroller =
        pipDocument.scrollingElement ?? pipDocument.documentElement;
      scroller.scrollTop = scroller.scrollHeight;
      return;
    }

    el.scrollTop = el.scrollHeight;
  }, [outputTranscript, outputInPip]);

  useEffect(() => {
    const el = inputCaptionRef.current;
    if (!el) return;

    if (inputInPip) {
      const pipDocument = el.ownerDocument;
      const scroller =
        pipDocument.scrollingElement ?? pipDocument.documentElement;
      scroller.scrollTop = scroller.scrollHeight;
      return;
    }

    el.scrollTop = el.scrollHeight;
  }, [inputTranscript, inputInPip]);

  function appendOutputDelta(delta: string) {
    rawOutputRef.current += delta;
    if (targetLanguage === "zh") {
      setOutputTranscript(
        formatChineseCaption(rawOutputRef.current, chineseScriptRef.current),
      );
      return;
    }
    setOutputTranscript((prev) => prev + delta);
  }

  async function handleStart() {
    if (!audioRef.current || isRunning) return;

    setError(null);
    rawOutputRef.current = "";
    setOutputTranscript("");
    setInputTranscript("");
    setControlsCollapsed(true);
    setLivePanelCollapsed(false);

    const session = new TranslationSession({
      targetLanguage,
      source,
      audioDeviceId: source === "microphone" ? audioDeviceId : undefined,
      audioElement: audioRef.current,
      callbacks: {
        onStatus: (next, message) => {
          setStatus(next);
          if (message) setStatusMessage(message);
        },
        onOutputTranscript: (delta) => {
          appendOutputDelta(delta);
        },
        onInputTranscript: (delta) => {
          setInputTranscript((prev) => prev + delta);
        },
        onError: (message) => {
          setError(message);
        },
      },
    });

    sessionRef.current = session;
    session.setTranslatedVolume(volume);
    session.setTranslatedMuted(!translationEnabled);
    session.setSourceVolume(originalEnabled ? sourceVolume : 0);

    try {
      await session.start();
    } catch {
      sessionRef.current = null;
    }
  }

  function handleStop() {
    sessionRef.current?.stop();
    sessionRef.current = null;
  }

  function handleStartAgain() {
    handleStop();
    closeOutputPip();
    closeInputPip();
    rawOutputRef.current = "";
    setOutputTranscript("");
    setInputTranscript("");
    setError(null);
    setStatus("idle");
    setStatusMessage("Ready to translate");
    setControlsCollapsed(false);
    setLivePanelCollapsed(true);
    setSourcePanelCollapsed(true);
  }

  const outputCaptionBody = (
    <p
      className={`caption-body${
        outputTranscript ? " caption-live" : " caption-hint"
      }`}
    >
      {outputTranscript ||
        (isRunning
          ? "Waiting for speech…"
          : "Translated captions will appear here once you start.")}
    </p>
  );

  const inputCaptionBody = (
    <p
      className={`caption-body muted-body${
        inputTranscript ? " caption-live" : " caption-hint"
      }`}
    >
      {inputTranscript ||
        (isRunning
          ? "Detecting source language…"
          : "Source transcript text will appear here once you start.")}
    </p>
  );

  function renderPipToggle(options: {
    active: boolean;
    onOpen: () => void;
    onClose: () => void;
    openLabel: string;
    closeLabel: string;
  }) {
    return (
      <button
        type="button"
        className="panel-toggle panel-pip-toggle"
        aria-pressed={options.active}
        aria-label={options.active ? options.closeLabel : options.openLabel}
        title={options.active ? "Return to main window" : "Pop out (always-on-top in Chrome/Edge)"}
        onClick={() => {
          if (options.active) {
            options.onClose();
          } else {
            options.onOpen();
          }
        }}
      >
        <span
          aria-hidden="true"
          className={`panel-pip-icon${
            options.active ? " panel-pip-icon-active" : ""
          }`}
        />
      </button>
    );
  }

  return (
    <div className="app-shell">
      <div className="atmosphere" aria-hidden="true" />

      <main className="stage">
        <header className="brand-block">
          <h1 className="brand">AI Interpreter</h1>
        </header>

        <section
          className={`controls${controlsCollapsed ? " controls-collapsed" : ""}`}
          aria-label="Translation controls"
        >
          <div className="controls-header">
            <div className="controls-heading">
              <span className="controls-title">Translation controls</span>
              {controlsCollapsed ? (
                <span className="controls-summary">{controlsSummary}</span>
              ) : null}
            </div>
            <div className="controls-header-actions">
              {controlsCollapsed && isRunning ? (
                <button
                  type="button"
                  className="danger controls-stop"
                  onClick={handleStop}
                >
                  Stop
                </button>
              ) : null}
              <button
                type="button"
                className="controls-toggle"
                aria-expanded={!controlsCollapsed}
                aria-label={
                  controlsCollapsed
                    ? "Maximize translation controls"
                    : "Minimize translation controls"
                }
                title={controlsCollapsed ? "Maximize" : "Minimize"}
                onClick={() => setControlsCollapsed((prev) => !prev)}
              >
                <span
                  aria-hidden="true"
                  className={`controls-chevron${
                    controlsCollapsed
                      ? " controls-chevron-down"
                      : " controls-chevron-up"
                  }`}
                />
              </button>
            </div>
          </div>

          {!controlsCollapsed ? (
            <>
              <label className="field">
                <span>Translate into</span>
                <select
                  value={targetLanguage}
                  disabled={isRunning}
                  onChange={(event) =>
                    setTargetLanguage(event.target.value as OutputLanguageCode)
                  }
                >
                  {OUTPUT_LANGUAGES.map((language) => (
                    <option key={language.code} value={language.code}>
                      {language.label}
                    </option>
                  ))}
                </select>
              </label>

              {showChineseScript ? (
                <label className="field">
                  <span>Chinese captions</span>
                  <select
                    value={chineseScript}
                    onChange={(event) =>
                      setChineseScript(event.target.value as ChineseScript)
                    }
                  >
                    {CHINESE_SCRIPTS.map((script) => (
                      <option key={script.id} value={script.id}>
                        {script.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              <fieldset className="source-toggle" disabled={isRunning}>
                <legend>Audio source</legend>
                <label>
                  <input
                    type="radio"
                    name="source"
                    value="microphone"
                    checked={source === "microphone"}
                    onChange={() => {
                      setSource("microphone");
                      void refreshAudioDevices();
                    }}
                  />
                  Microphone / Virtual input
                </label>
                <label>
                  <input
                    type="radio"
                    name="source"
                    value="tab"
                    checked={source === "tab"}
                    onChange={() => setSource("tab")}
                  />
                  Browser tab
                </label>
              </fieldset>

              {source === "microphone" ? (
                <label className="field">
                  <span>Input device</span>
                  <select
                    value={audioDeviceId}
                    disabled={isRunning || audioDevices.length === 0}
                    onFocus={() => {
                      void refreshAudioDevices();
                    }}
                    onChange={(event) => setAudioDeviceId(event.target.value)}
                  >
                    {audioDevices.length === 0 ? (
                      <option value="default">Requesting microphone access…</option>
                    ) : (
                      audioDevices.map((device) => (
                        <option key={device.deviceId} value={device.deviceId}>
                          {formatAudioInputLabel(device)}
                        </option>
                      ))
                    )}
                  </select>
                </label>
              ) : null}

              <div className="actions">
                {!isRunning ? (
                  <button
                    type="button"
                    className="primary"
                    onClick={handleStart}
                  >
                    Start translating
                  </button>
                ) : (
                  <button
                    type="button"
                    className="danger"
                    onClick={handleStop}
                  >
                    Stop
                  </button>
                )}
                <button
                  type="button"
                  className="ghost actions-secondary"
                  onClick={handleStartAgain}
                >
                  Clear & start again
                </button>
              </div>
            </>
          ) : null}
        </section>

        <section
          className={`panel live-panel${
            livePanelCollapsed ? " panel-collapsed" : ""
          }`}
          aria-label="Translated captions"
          aria-live="polite"
        >
          <div className="panel-header">
            <div className="panel-heading">
              <span className="panel-title">Translated captions</span>
              <div className="status-row panel-status">
                <span className={`status-dot status-${status}`} />
                <span className="status-text">{statusMessage}</span>
              </div>
              {livePanelCollapsed && !outputInPip && outputTranscript ? (
                <span className="panel-summary">
                  {outputTranscript.slice(0, 80)}
                  {outputTranscript.length > 80 ? "…" : ""}
                </span>
              ) : null}
            </div>
            <div className="panel-header-actions">
              {renderPipToggle({
                active: outputInPip,
                onOpen: openOutputPip,
                onClose: closeOutputPip,
                openLabel: "Pop out translated captions",
                closeLabel: "Return translated captions to main window",
              })}
              <button
                type="button"
                className="panel-toggle"
                aria-expanded={!livePanelCollapsed}
                aria-label={
                  livePanelCollapsed
                    ? "Maximize translated captions"
                    : "Minimize translated captions"
                }
                title={livePanelCollapsed ? "Maximize" : "Minimize"}
                onClick={() => setLivePanelCollapsed((prev) => !prev)}
              >
                <span
                  aria-hidden="true"
                  className={`panel-chevron${
                    livePanelCollapsed
                      ? " panel-chevron-down"
                      : " panel-chevron-up"
                  }`}
                />
              </button>
            </div>
          </div>

          {!livePanelCollapsed ? (
            <>
              {error ? <p className="error-banner">{error}</p> : null}

              <div className="playback">
                <div className="playback-row">
                  <label className="inline-control playback-label">
                    <input
                      type="checkbox"
                      checked={translationEnabled}
                      onChange={(event) =>
                        setTranslationEnabled(event.target.checked)
                      }
                    />
                    Audio
                  </label>
                  <label className="inline-control playback-slider">
                    <span className="sr-only">Translated speech volume</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={translationEnabled ? volume : 0}
                      aria-valuenow={translationEnabled ? volume : 0}
                      disabled={!translationEnabled}
                      onChange={(event) =>
                        setVolume(Number(event.target.value))
                      }
                    />
                  </label>
                </div>
              </div>

              <div className="captions">
                <div className="caption-block primary-caption">
                  {outputInPip ? (
                    <p className="caption-pip-status">
                      Live captions are open in a pop-out window.
                    </p>
                  ) : (
                    <div ref={outputCaptionRef} className="caption-scroll">
                      {outputCaptionBody}
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : null}
          {outputInPip && outputPipContainer
            ? createPortal(
                <div className="pip-caption-frame">
                  <div
                    ref={outputCaptionRef}
                    className="caption-scroll caption-scroll-pip"
                  >
                    {outputCaptionBody}
                  </div>
                </div>,
                outputPipContainer,
              )
            : null}
        </section>

        <section
          className={`panel source-panel${
            sourcePanelCollapsed ? " panel-collapsed" : ""
          }`}
          aria-label="Source transcript"
        >
          <div className="panel-header">
            <div className="panel-heading">
              <span className="panel-title">Source transcript</span>
              {sourcePanelCollapsed && !inputInPip && inputTranscript ? (
                <span className="panel-summary">
                  {inputTranscript.slice(0, 80)}
                  {inputTranscript.length > 80 ? "…" : ""}
                </span>
              ) : null}
            </div>
            <div className="panel-header-actions">
              {renderPipToggle({
                active: inputInPip,
                onOpen: openInputPip,
                onClose: closeInputPip,
                openLabel: "Pop out source transcript",
                closeLabel: "Return source transcript to main window",
              })}
              <button
                type="button"
                className="panel-toggle"
                aria-expanded={!sourcePanelCollapsed}
                aria-label={
                  sourcePanelCollapsed
                    ? "Maximize source transcript"
                    : "Minimize source transcript"
                }
                title={sourcePanelCollapsed ? "Maximize" : "Minimize"}
                onClick={() => setSourcePanelCollapsed((prev) => !prev)}
              >
                <span
                  aria-hidden="true"
                  className={`panel-chevron${
                    sourcePanelCollapsed
                      ? " panel-chevron-down"
                      : " panel-chevron-up"
                  }`}
                />
              </button>
            </div>
          </div>

          {!sourcePanelCollapsed ? (
            <>
              <div className="playback">
                <div className="playback-row">
                  <label className="inline-control playback-label">
                    <input
                      type="checkbox"
                      checked={originalEnabled}
                      onChange={(event) =>
                        setOriginalEnabled(event.target.checked)
                      }
                    />
                    Audio
                  </label>
                  <label className="inline-control playback-slider">
                    <span className="sr-only">Original speech volume</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={originalEnabled ? sourceVolume : 0}
                      aria-valuenow={originalEnabled ? sourceVolume : 0}
                      disabled={!originalEnabled}
                      onChange={(event) =>
                        setSourceVolume(Number(event.target.value))
                      }
                    />
                  </label>
                </div>
              </div>

              {inputInPip ? (
                <p className="caption-pip-status">
                  Source transcript is open in a pop-out window.
                </p>
              ) : (
                <div ref={inputCaptionRef} className="caption-scroll">
                  {inputCaptionBody}
                </div>
              )}
            </>
          ) : null}
          {inputInPip && inputPipContainer
            ? createPortal(
                <div className="pip-caption-frame">
                  <div
                    ref={inputCaptionRef}
                    className="caption-scroll caption-scroll-pip"
                  >
                    {inputCaptionBody}
                  </div>
                </div>,
                inputPipContainer,
              )
            : null}
        </section>

        <audio ref={audioRef} autoPlay playsInline hidden />
      </main>
    </div>
  );
}
