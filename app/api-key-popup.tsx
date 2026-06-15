"use client";

import { useEffect, useState } from "react";
import ApiKeyPanel from "./api-key-panel";

type ApiKeyPopupProps = {
  variant?: "fixed" | "inline";
};

export default function ApiKeyPopup({ variant = "fixed" }: ApiKeyPopupProps) {
  const [isOpen, setIsOpen] = useState(false);
  const buttonClassName =
    variant === "fixed"
      ? "fixed right-3 top-3 z-[70] inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/24 bg-[#111111]/78 px-3 text-sm font-black text-white shadow-[0_12px_28px_rgba(0,0,0,0.28)] backdrop-blur transition hover:border-white hover:bg-[#111111]/92 sm:right-6 sm:top-5"
      : "inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#111111] px-3 text-sm font-black text-white shadow-[0_10px_24px_rgba(24,24,24,0.12)] transition hover:bg-[#2b2925]";

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <>
      <button
        type="button"
        className={buttonClassName}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(true)}
      >
        <span className="grid h-7 w-7 place-items-center rounded-md bg-[#ffcf3f] text-[0.68rem] font-black text-[#111111]">
          KEY
        </span>
        <span className="hidden sm:inline">API 설정</span>
      </button>

      {isOpen ? (
        <div className="fixed inset-0 z-[90]">
          <button
            type="button"
            className="absolute inset-0 h-full w-full cursor-default bg-black/28 backdrop-blur-[1px]"
            aria-label="API 설정 닫기"
            onClick={() => setIsOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="API 키 설정"
            className="absolute right-3 top-3 w-[min(calc(100vw-1.5rem),44rem)] sm:right-6 sm:top-6"
          >
            <button
              type="button"
              className="mb-2 ml-auto flex min-h-9 items-center justify-center rounded-lg bg-white px-3 text-xs font-black text-[#111111] shadow-[0_12px_28px_rgba(0,0,0,0.25)] transition hover:bg-[#ffcf3f]"
              onClick={() => setIsOpen(false)}
            >
              닫기
            </button>
            <div className="max-h-[calc(100svh-5.5rem)] overflow-auto rounded-lg shadow-[0_24px_80px_rgba(0,0,0,0.42)]">
              <ApiKeyPanel />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
