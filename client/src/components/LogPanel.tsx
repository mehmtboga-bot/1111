import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface ServerLog {
  id: number;
  level: "info" | "warn" | "error";
  message: string;
  timestamp: number;
}

interface LogPanelProps {
  open: boolean;
  logs: ServerLog[];
  onClose: () => void;
}

const levelStyle: Record<ServerLog["level"], string> = {
  info:  "text-emerald-400",
  warn:  "text-yellow-400",
  error: "text-red-400",
};

const levelPrefix: Record<ServerLog["level"], string> = {
  info:  "",
  warn:  "[WARN] ",
  error: "[ERR]  ",
};

function formatTime(ts: number) {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

export function LogPanel({ open, logs, onClose }: LogPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Yeni log gelince en alta kaydır
  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, open]);

  return (
    <>
      {/* Arka plan overlay — tıklayınca kapanır */}
      <div
        className={`fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity duration-200 ${
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel — üstten, yarı yükseklik, geniş */}
      <div
        className={`fixed top-0 z-50 flex flex-col
          left-[4%] w-[92%] h-[50vh]
          bg-zinc-950 border border-zinc-800 rounded-b-xl shadow-2xl
          transition-transform duration-300 ease-in-out
          ${open ? "translate-y-0" : "-translate-y-full"}
        `}
        data-testid="panel-server-logs"
      >
        {/* Panel başlık çubuğu */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-900 shrink-0">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-sm font-mono font-semibold text-zinc-200">
              Sunucu Logları
            </span>
            <span className="text-xs text-zinc-500 font-mono ml-1">
              ({logs.length} satır)
            </span>
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={onClose}
            className="h-7 w-7 text-zinc-400 hover:text-zinc-100"
            data-testid="button-close-log-panel"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Log alanı */}
        <div className="flex-1 overflow-y-auto px-3 py-2 font-mono text-xs leading-5 space-y-0.5">
          {logs.length === 0 ? (
            <p className="text-zinc-600 pt-4 text-center">
              Sunucu logları bekleniyor...
            </p>
          ) : (
            logs.map((log) => (
              <div key={log.id} className="flex gap-2 items-start">
                <span className="text-zinc-600 shrink-0 select-none">
                  {formatTime(log.timestamp)}
                </span>
                <span className={`${levelStyle[log.level]} break-all whitespace-pre-wrap`}>
                  {levelPrefix[log.level]}{log.message}
                </span>
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </div>
    </>
  );
}
