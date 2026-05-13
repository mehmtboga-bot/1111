import { useEffect, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import { Save, RefreshCw, FileCode, CheckCircle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface FileEntry {
  path: string;
  label: string;
}

const FILE_LABELS: Record<string, string> = {
  "server/helius-monitor.ts": "helius-monitor.ts",
  "server/routes.ts":         "routes.ts",
  "server/index.ts":          "index.ts",
  "server/storage.ts":        "storage.ts",
  "shared/schema.ts":         "schema.ts",
};

const DIR_LABELS: Record<string, string> = {
  "server/helius-monitor.ts": "server/",
  "server/routes.ts":         "server/",
  "server/index.ts":          "server/",
  "server/storage.ts":        "server/",
  "shared/schema.ts":         "shared/",
};

export function FileEditor() {
  const [files, setFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [savedContent, setSavedContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ type: "ok" | "error"; msg: string } | null>(null);
  const statusTimerRef = useRef<NodeJS.Timeout>();

  const isDirty = content !== savedContent;

  useEffect(() => {
    fetch("/api/files/list")
      .then((r) => r.json())
      .then((d) => {
        setFiles(d.files ?? []);
        if (d.files?.length) openFile(d.files[0]);
      });
  }, []);

  const openFile = async (filePath: string) => {
    setSelectedFile(filePath);
    setLoading(true);
    setStatus(null);
    try {
      const r = await fetch(`/api/files/read?path=${encodeURIComponent(filePath)}`);
      const d = await r.json();
      setContent(d.content ?? "");
      setSavedContent(d.content ?? "");
    } catch {
      setStatus({ type: "error", msg: "Dosya okunamadı" });
    } finally {
      setLoading(false);
    }
  };

  const saveFile = async () => {
    if (!selectedFile || saving) return;
    setSaving(true);
    setStatus(null);
    try {
      const r = await fetch("/api/files/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: selectedFile, content }),
      });
      const d = await r.json();
      if (d.ok) {
        setSavedContent(content);
        showStatus("ok", "Kaydedildi — sunucu yeniden başlıyor...");
      } else {
        showStatus("error", d.error ?? "Kayıt hatası");
      }
    } catch {
      showStatus("error", "Sunucuya bağlanılamadı");
    } finally {
      setSaving(false);
    }
  };

  const showStatus = (type: "ok" | "error", msg: string) => {
    setStatus({ type, msg });
    clearTimeout(statusTimerRef.current);
    statusTimerRef.current = setTimeout(() => setStatus(null), 4000);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      saveFile();
    }
  };

  return (
    <div className="flex h-full" onKeyDown={handleKeyDown}>
      {/* Sol: dosya listesi */}
      <aside className="w-52 shrink-0 bg-zinc-950 border-r border-zinc-800 flex flex-col">
        <div className="px-3 py-3 border-b border-zinc-800">
          <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
            Sunucu Dosyaları
          </span>
        </div>
        <nav className="flex-1 overflow-y-auto py-2 space-y-0.5 px-1">
          {files.map((f) => (
            <button
              key={f}
              onClick={() => openFile(f)}
              data-testid={`button-file-${f.replace(/\//g, "-")}`}
              className={`w-full text-left rounded px-2 py-1.5 transition-colors group ${
                selectedFile === f
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
              }`}
            >
              <div className="flex items-center gap-1.5">
                <FileCode className="h-3.5 w-3.5 shrink-0 text-zinc-500 group-hover:text-zinc-400" />
                <div className="min-w-0">
                  <div className="text-xs font-medium truncate">{FILE_LABELS[f] ?? f}</div>
                  <div className="text-[10px] text-zinc-600 truncate">{DIR_LABELS[f] ?? ""}</div>
                </div>
              </div>
            </button>
          ))}
        </nav>
      </aside>

      {/* Sağ: editör */}
      <div className="flex-1 flex flex-col min-w-0 bg-zinc-950">
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 bg-zinc-900 shrink-0 flex-wrap">
          {selectedFile && (
            <span className="text-xs font-mono text-zinc-400 truncate">
              {selectedFile}
            </span>
          )}
          {isDirty && (
            <Badge className="text-[10px] bg-yellow-500/15 text-yellow-400 border border-yellow-500/30">
              değiştirildi
            </Badge>
          )}
          <div className="flex items-center gap-2 ml-auto">
            {status && (
              <div className={`flex items-center gap-1 text-xs ${
                status.type === "ok" ? "text-emerald-400" : "text-red-400"
              }`}>
                {status.type === "ok"
                  ? <CheckCircle className="h-3.5 w-3.5" />
                  : <AlertCircle className="h-3.5 w-3.5" />
                }
                {status.msg}
              </div>
            )}
            <Button
              size="icon"
              variant="ghost"
              onClick={() => selectedFile && openFile(selectedFile)}
              disabled={loading}
              title="Yenile"
              data-testid="button-file-refresh"
              className="text-zinc-400"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
            <Button
              size="sm"
              onClick={saveFile}
              disabled={saving || !isDirty}
              data-testid="button-file-save"
              className={isDirty ? "bg-emerald-600 hover:bg-emerald-700 text-white" : ""}
            >
              <Save className="h-3.5 w-3.5 mr-1" />
              {saving ? "Kaydediliyor..." : "Kaydet"}
            </Button>
          </div>
        </div>

        {/* Monaco editör */}
        <div className="flex-1 min-h-0">
          {loading ? (
            <div className="flex items-center justify-center h-full text-zinc-600 text-sm font-mono">
              Yükleniyor...
            </div>
          ) : (
            <Editor
              height="100%"
              language="typescript"
              theme="vs-dark"
              value={content}
              onChange={(val) => setContent(val ?? "")}
              options={{
                fontSize: 13,
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                lineNumbers: "on",
                wordWrap: "on",
                tabSize: 2,
                automaticLayout: true,
              }}
            />
          )}
        </div>

        <div className="px-3 py-1 border-t border-zinc-800 bg-zinc-900 text-[10px] text-zinc-600 font-mono">
          Ctrl+S ile kaydet · Kayıt sonrası sunucu otomatik yenilenir
        </div>
      </div>
    </div>
  );
}
