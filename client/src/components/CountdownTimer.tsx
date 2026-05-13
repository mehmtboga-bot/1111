import { useEffect, useState } from "react";
import { Clock } from "lucide-react";

interface CountdownTimerProps {
  detectedAt: number;
  className?: string;
}

export function CountdownTimer({ detectedAt, className = "" }: CountdownTimerProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const updateTimer = () => {
      const elapsedTime = Math.max(0, Date.now() - detectedAt);
      setElapsed(elapsedTime);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [detectedAt]);

  const seconds = Math.floor(elapsed / 1000);
  const minutes = Math.floor(seconds / 60);
  const displaySeconds = seconds % 60;

  const getColorClass = () => {
    if (seconds < 30) return "text-chart-4";
    if (seconds < 60) return "text-chart-5";
    return "text-muted-foreground";
  };

  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <Clock className={`h-4 w-4 ${getColorClass()}`} />
      <span className={`text-sm font-mono font-semibold ${getColorClass()}`} data-testid="text-countdown">
        {minutes}:{displaySeconds.toString().padStart(2, "0")}
      </span>
    </div>
  );
}
