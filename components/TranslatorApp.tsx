"use client";

import { useEffect, useRef, useState } from "react";
import {
  CHINESE_SCRIPTS,
  DEFAULT_CHINESE_SCRIPT,
  formatChineseCaption,
  type ChineseScript,
} from "@/lib/chinese-script";
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

export default function TranslatorApp() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sessionRef = useRef<TranslationSession | null>(null);
  const chineseScriptRef = useRef<ChineseScript>(DEFAULT_CHINESE_SCRIPT);
  const rawOutputRef = useRef("");
  const outputCaptionRef = useRef<HTMLDivElement | null>(null);
  const inputCaptionRef = useRef<HTMLDivElement | null>(null);

  const [targetLanguage, setTargetLanguage] = useState<OutputLanguageCode>(
    DEFAULT_TARGET_LANGUAGE,
  );
  const [chineseScript, setChineseScript] = useState<ChineseScript>(
    DEFAULT_CHINESE_SCRIPT,
  );
  const [source, setSource] = useState<AudioSource>("microphone");
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [statusMessage, setStatusMessage] = useState("Ready to translate");
  const [outputTranscript, setOutputTranscript] = useState("");
  const [inputTranscript, setInputTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [sourceVolume, setSourceVolume] = useState(0);
  const [controlsCollapsed, setControlsCollapsed] = useState(false);
  const [livePanelCollapsed, setLivePanelCollapsed] = useState(false);
  const [sourcePanelCollapsed, setSourcePanelCollapsed] = useState(false);

  const isRunning =
    status === "connecting" || status === "live" || status === "reconnecting";
  const showChineseScript = targetLanguage === "zh";

  const controlsSummary = [
    OUTPUT_LANGUAGES.find((language) => language.code === targetLanguage)
      ?.label ?? targetLanguage,
    source === "microphone" ? "Microphone" : "Browser tab",
    showChineseScript
      ? CHINESE_SCRIPTS.find((script) => script.id === chineseScript)?.label
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  useEffect(() => {
    chineseScriptRef.current = chineseScript;
  }, [chineseScript]);

  useEffect(() => {
    return () => {
      sessionRef.current?.stop();
      sessionRef.current = null;
    };
  }, []);

  useEffect(() => {
    sessionRef.current?.setTranslatedVolume(volume);
  }, [volume]);

  useEffect(() => {
    sessionRef.current?.setTranslatedMuted(muted);
  }, [muted]);

  useEffect(() => {
    sessionRef.current?.setSourceVolume(sourceVolume);
  }, [sourceVolume]);

  // Re-render captions when the user toggles script mid-session.
  useEffect(() => {
    if (targetLanguage !== "zh") return;
    setOutputTranscript(
      formatChineseCaption(rawOutputRef.current, chineseScript),
    );
  }, [chineseScript, targetLanguage]);

  useEffect(() => {
    const el = outputCaptionRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [outputTranscript]);

  useEffect(() => {
    const el = inputCaptionRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [inputTranscript]);

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

    const session = new TranslationSession({
      targetLanguage,
      source,
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
    session.setTranslatedMuted(muted);
    session.setSourceVolume(sourceVolume);

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

  return (
    <div className="app-shell">
      <div className="atmosphere" aria-hidden="true" />

      <main className="stage">
        <header className="brand-block">
          <p className="brand">EchoLine</p>
          <h1 className="headline">Speak once. Hear it in another language.</h1>
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
                    onChange={() => setSource("microphone")}
                  />
                  Microphone
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
              {livePanelCollapsed && outputTranscript ? (
                <span className="panel-summary">
                  {outputTranscript.slice(0, 80)}
                  {outputTranscript.length > 80 ? "…" : ""}
                </span>
              ) : null}
            </div>
            <div className="panel-header-actions">
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
                <label className="inline-control">
                  <input
                    type="checkbox"
                    checked={muted}
                    onChange={(event) => setMuted(event.target.checked)}
                  />
                  Mute translation
                </label>
                <label className="inline-control grow">
                  <span>Volume</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={muted ? 0 : volume}
                    aria-valuenow={muted ? 0 : volume}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      setVolume(next);
                      if (muted && next > 0) {
                        setMuted(false);
                      }
                    }}
                  />
                </label>
                {source === "tab" ? (
                  <label className="inline-control grow">
                    <span>Original</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={sourceVolume}
                      onChange={(event) =>
                        setSourceVolume(Number(event.target.value))
                      }
                    />
                  </label>
                ) : null}
              </div>

              <div className="captions">
                <div className="caption-block primary-caption">
                  <div ref={outputCaptionRef} className="caption-scroll">
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
                  </div>
                </div>
              </div>
            </>
          ) : null}
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
              {sourcePanelCollapsed && inputTranscript ? (
                <span className="panel-summary">
                  {inputTranscript.slice(0, 80)}
                  {inputTranscript.length > 80 ? "…" : ""}
                </span>
              ) : null}
            </div>
            <div className="panel-header-actions">
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
            <div ref={inputCaptionRef} className="caption-scroll">
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
            </div>
          ) : null}
        </section>

        <audio ref={audioRef} autoPlay playsInline hidden />
      </main>
    </div>
  );
}
