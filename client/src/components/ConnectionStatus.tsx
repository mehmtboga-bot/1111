import { Activity, WifiOff, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ConnectionStatusProps {
  isConnected: boolean;
  message?: string;
  isMonitoring: boolean;
  onToggleMonitoring: () => void;
}

export function ConnectionStatus({ isConnected, message, isMonitoring, onToggleMonitoring }: ConnectionStatusProps) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2">
        {isConnected ? (
          <>
            <div className="relative">
              <Activity className="h-4 w-4 text-chart-4" data-testid="icon-connected" />
              <div className="absolute inset-0 bg-chart-4 rounded-full blur-sm opacity-50 animate-pulse" />
            </div>
            <span className="text-sm font-medium text-foreground" data-testid="text-status">
              Bağlı
            </span>
          </>
        ) : (
          <>
            <WifiOff className="h-4 w-4 text-destructive" data-testid="icon-disconnected" />
            <span className="text-sm font-medium text-muted-foreground" data-testid="text-status">
              {message || "Bağlantı Kesildi"}
            </span>
          </>
        )}
      </div>
      
      <Button
        size="sm"
        variant={isMonitoring ? "destructive" : "default"}
        onClick={onToggleMonitoring}
        className="gap-1.5"
        data-testid="button-toggle-monitoring"
      >
        {isMonitoring ? (
          <>
            <Square className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Durdur</span>
          </>
        ) : (
          <>
            <Play className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Başlat</span>
          </>
        )}
      </Button>
    </div>
  );
}
