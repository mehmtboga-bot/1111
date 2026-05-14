import { useState, useEffect } from "react";

interface MonitorStatus {
  isRunning: boolean;
  solPrice: number;
  message: string;
  timestamp?: string;
}

export default function MonitorControl() {
  const [status, setStatus] = useState<MonitorStatus>({
    isRunning: false,
    solPrice: 0,
    message: "⏹️ Durduruldu",
  });
  const [loading, setLoading] = useState(false);

  // Başlangıçta durum kontrol et
  useEffect(() => {
    checkStatus();
  }, []);

  // Her 5 saniyede durum kontrol et (otomatik senkronizasyon)
  useEffect(() => {
    const interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const checkStatus = async () => {
    try {
      const res = await fetch("/api/monitor/status");
      const data = await res.json();
      setStatus(data);
    } catch (err) {
      console.error("Status kontrol hatası:", err);
    }
  };

  /**
   * Başlat butonuna basınca
   * Backend'de monitor başlasın
   */
  const handleStart = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/monitor/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const result = await res.json();

      if (result.success) {
        setStatus({
          isRunning: true,
          solPrice: status.solPrice,
          message: result.message,
        });
        console.log("✅", result.message);
      } else {
        alert(result.message);
      }
    } catch (err) {
      alert(`❌ Hata: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Durdur butonuna basınca
   * Backend'de monitor tamamen kapansın
   */
  const handleStop = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/monitor/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const result = await res.json();

      if (result.success) {
        setStatus({
          isRunning: false,
          solPrice: 0,
          message: result.message,
        });
        console.log("🛑", result.message);
      } else {
        alert(result.message);
      }
    } catch (err) {
      alert(`❌ Hata: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="monitor-control-container">
      {/* Durum Kartı */}
      <div className="monitor-card">
        <div className="card-header">
          <h2>🔍 Monitor Durumu</h2>
        </div>

        <div className="card-body">
          {/* Durumu Göster */}
          <div className={`status-badge ${status.isRunning ? "running" : "stopped"}`}>
            <span className="status-dot"></span>
            <span className="status-text">
              {status.isRunning ? "✅ ÇALIŞIYOR" : "⏹️ DURDU"}
            </span>
          </div>

          {/* SOL Fiyatı */}
          <div className="sol-price">
            <span className="label">SOL/USD:</span>
            <span className="value">${status.solPrice.toFixed(2)}</span>
          </div>

          {/* Mesaj */}
          <div className="message">
            <p>{status.message}</p>
          </div>
        </div>

        {/* Butonlar */}
        <div className="card-footer">
          <button
            className={`btn btn-start ${
              status.isRunning || loading ? "disabled" : ""
            }`}
            onClick={handleStart}
            disabled={status.isRunning || loading}
            title={status.isRunning ? "Monitor zaten çalışıyor" : "Monitor'ı başlat"}
          >
            {loading ? (
              <>
                <span className="spinner"></span>
                İşleniyor...
              </>
            ) : (
              <>
                <span className="icon">▶️</span>
                Başlat
              </>
            )}
          </button>

          <button
            className={`btn btn-stop ${
              !status.isRunning || loading ? "disabled" : ""
            }`}
            onClick={handleStop}
            disabled={!status.isRunning || loading}
            title={!status.isRunning ? "Monitor zaten durdurulmuş" : "Monitor'ı durdur"}
          >
            {loading ? (
              <>
                <span className="spinner"></span>
                İşleniyor...
              </>
            ) : (
              <>
                <span className="icon">⏹️</span>
                Durdur
              </>
            )}
          </button>
        </div>
      </div>

      {/* Bilgi Kutusu */}
      <div className="info-box">
        <h3>📝 Bilgi</h3>
        <ul>
          <li>
            <strong>Başlat:</strong> LP tespitleri başlar, Telegram bildirimleri gönderilir
          </li>
          <li>
            <strong>Durdur:</strong> Tüm bağlantılar kapanır, arka planda hiçbir şey kalmaz
          </li>
          <li>
            <strong>Durum:</strong> Her 5 saniyede otomatik güncellenir
          </li>
        </ul>
      </div>
    </div>
  );
}
