import { Router } from "express";
import { monitorController } from "./monitor-controller";

const router = Router();

/**
 * POST /api/monitor/start
 * UI'deki "Başlat" butonunun API endpoint'i
 */
router.post("/monitor/start", async (req, res) => {
  try {
    const result = await monitorController.startMonitor();

    res.status(result.success ? 200 : 400).json(result);
  } catch (err) {
    res.status(500).json({
      success: false,
      message: `Sunucu hatası: ${(err as Error).message}`,
      isRunning: false,
    });
  }
});

/**
 * POST /api/monitor/stop
 * UI'deki "Durdur" butonunun API endpoint'i
 * TAM KAPATMA - arka planda hiçbir şey kalmaz
 */
router.post("/monitor/stop", (req, res) => {
  try {
    const result = monitorController.stopMonitor();

    res.status(result.success ? 200 : 400).json(result);
  } catch (err) {
    res.status(500).json({
      success: false,
      message: `Sunucu hatası: ${(err as Error).message}`,
      isRunning: false,
    });
  }
});

/**
 * GET /api/monitor/status
 * Şu anki monitor durumunu döndür
 * Frontend'in UI state'ini güncellemesi için
 */
router.get("/monitor/status", (req, res) => {
  try {
    const status = monitorController.getStatus();

    res.json({
      ...status,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: `Sunucu hatası: ${(err as Error).message}`,
    });
  }
});

export default router;
