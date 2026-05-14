import { HeliusMonitor } from "./helius-monitor";

/**
 * Global Monitor Controller
 * UI'deki başlat/durdur butonlarının tam kontrolü burada
 * Singleton pattern - her zaman aynı instance
 */
class MonitorController {
  private static instance: MonitorController;
  private monitor: HeliusMonitor | null = null;
  private eventListeners: Map<string, Function[]> = new Map();

  private constructor() {}

  static getInstance(): MonitorController {
    if (!MonitorController.instance) {
      MonitorController.instance = new MonitorController();
    }
    return MonitorController.instance;
  }

  /**
   * UI'den Başlat butonuna basıldığında
   */
  async startMonitor(): Promise<{
    success: boolean;
    message: string;
    isRunning: boolean;
  }> {
    try {
      // Monitor zaten çalışıyorsa
      if (this.monitor && this.monitor.getState()) {
        return {
          success: false,
          message: "⚠️ Monitor zaten çalışıyor",
          isRunning: true,
        };
      }

      // Yeni monitor instance oluştur
      this.monitor = new HeliusMonitor((event: string, data: any) => {
        this.emitEvent(event, data);
      });

      // Başlat
      await this.monitor.start();

      this.emitEvent("monitoring_state", { isMonitoring: true });

      return {
        success: true,
        message: "✅ Monitor başlatıldı - LP tespitleri başlıyor",
        isRunning: true,
      };
    } catch (err) {
      console.error("❌ Monitor başlatma hatası:", err);
      return {
        success: false,
        message: `❌ Hata: ${(err as Error).message}`,
        isRunning: false,
      };
    }
  }

  /**
   * UI'den Durdur butonuna basıldığında
   * TEMİZ KAPATMA - hiçbir şey arka planda kalmaz
   */
  stopMonitor(): {
    success: boolean;
    message: string;
    isRunning: boolean;
  } {
    try {
      if (!this.monitor || !this.monitor.getState()) {
        return {
          success: false,
          message: "⚠️ Monitor zaten durdurulmuş",
          isRunning: false,
        };
      }

      // Monitor'ı durdur (tüm WebSocket'ler kapanacak)
      this.monitor.stop();

      // Instance'ı sil - arka planda hiçbir şey kalmasın
      this.monitor = null;

      this.emitEvent("monitoring_state", { isMonitoring: false });

      return {
        success: true,
        message: "🛑 Monitor tamamen durduruldu - arka planda hiçbir işlem yok",
        isRunning: false,
      };
    } catch (err) {
      console.error("❌ Monitor durdurma hatası:", err);
      return {
        success: false,
        message: `❌ Hata: ${(err as Error).message}`,
        isRunning: this.monitor?.getState() ?? false,
      };
    }
  }

  /**
   * Şu anki durumu döndür
   */
  getStatus(): {
    isRunning: boolean;
    solPrice: number;
    message: string;
  } {
    const isRunning = this.monitor?.getState() ?? false;
    const solPrice = this.monitor?.getSolPriceUsd() ?? 0;

    return {
      isRunning,
      solPrice,
      message: isRunning ? "✅ Çalışıyor" : "⏹️ Durduruldu",
    };
  }

  /**
   * Event listener ekle (frontend WebSocket için)
   */
  onEvent(eventName: string, callback: Function): void {
    if (!this.eventListeners.has(eventName)) {
      this.eventListeners.set(eventName, []);
    }
    this.eventListeners.get(eventName)!.push(callback);
  }

  /**
   * Event fırla
   */
  private emitEvent(eventName: string, data: any): void {
    const listeners = this.eventListeners.get(eventName) || [];
    listeners.forEach((callback) => {
      try {
        callback(data);
      } catch (err) {
        console.error(`Event callback hatası (${eventName}):`, err);
      }
    });
  }
}

export const monitorController = MonitorController.getInstance();
