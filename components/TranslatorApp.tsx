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
  const [showSourceTranscript, setShowSourceTranscript] = useState(true);

  const isRunning =
    status === "connecting" || status === "live" || status === "reconnecting";
  const showChineseScript = targetLanguage === "zh";

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
          <p className="lede">
            Live one-way speech translation powered by OpenAI&apos;s
            gpt-realtime-translate. Pick a target language, start listening, and
            captions follow as you speak.
          </p>
        </header>

        <section className="controls" aria-label="Translation controls">
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
              <button type="button" className="primary" onClick={handleStart}>
                Start translating
              </button>
            ) : (
              <button type="button" className="danger" onClick={handleStop}>
                Stop
              </button>
            )}
          </div>
        </section>

        <section className="live-panel" aria-live="polite">
          <div className="status-row">
            <span className={`status-dot status-${status}`} />
            <span className="status-text">{statusMessage}</span>
          </div>

          {error ? <p className="error-banner">{error}</p> : null}

          {showChineseScript ? (
            <p className="hint">
              Chinese speech still uses the model&apos;s <code>zh</code> output.
              Caption script is converted in the browser (OpenCC) and does not
              change the spoken audio.
            </p>
          ) : null}

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
                value={volume}
                onChange={(event) => setVolume(Number(event.target.value))}
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
              <div className="caption-heading">
                <h2>Translated captions</h2>
              </div>
              <p className="caption-body">
                {outputTranscript ||
                  (isRunning
                    ? "Waiting for speech…"
                    : "Captions will appear here once you start.")}
              </p>
            </div>

            <div className="caption-block">
              <div className="caption-heading">
                <h2>Source transcript</h2>
                <label className="inline-control">
                  <input
                    type="checkbox"
                    checked={showSourceTranscript}
                    onChange={(event) =>
                      setShowSourceTranscript(event.target.checked)
                    }
                  />
                  Show
                </label>
              </div>
              {showSourceTranscript ? (
                <p className="caption-body muted-body">
                  {inputTranscript ||
                    (isRunning
                      ? "Detecting source language…"
                      : "Optional source text from gpt-realtime-whisper.")}
                </p>
              ) : null}
            </div>
          </div>
        </section>

        <audio ref={audioRef} autoPlay playsInline hidden />
      </main>
    </div>
  );
}
