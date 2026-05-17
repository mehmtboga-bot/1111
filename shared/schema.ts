import { z } from "zod";

export const mintedTokenSchema = z.object({
  id: z.string(),
  mintAddress: z.string(),
  name: z.string(),
  symbol: z.string(),
  detectedAt: z.number(),
  expiresAt: z.number(),
  isLocked: z.boolean().optional(),
  lockDuration: z.string().optional(),
  liquidityAmount: z.number().optional(),
});

export type MintedToken = z.infer<typeof mintedTokenSchema>;

export const lpDetectionSchema = z.object({
  id: z.string(),
  mintAddress: z.string(),
  name: z.string(),
  symbol: z.string(),
  detectedAt: z.number(),
  expiresAt: z.number(),
  raydiumUrl: z.string().optional(),
  jupiterUrl: z.string().optional(),
  dexscreenerUrl: z.string().optional(),
  pumpfunUrl: z.string().optional(),
  isLocked: z.boolean().optional(),
  lockDuration: z.string().optional(),
  liquidityAmount: z.number().optional(),
  platform: z.string().optional(),
  lpMint: z.string().optional(),
});

export type LPDetection = z.infer<typeof lpDetectionSchema>;

export const positionSchema = z.object({
  id: z.string(),
  mintAddress: z.string(),
  name: z.string(),
  symbol: z.string(),
  status: z.enum(["pending_buy", "open", "pending_sell", "closed", "failed"]),
  buyTimestamp: z.number(),
  buySolAmount: z.number(),
  buyTokenAmount: z.number().optional(),
  buyPriceSol: z.number().optional(),
  buyTxSignature: z.string().optional(),
  sellTimestamp: z.number().optional(),
  sellSolAmount: z.number().optional(),
  sellPriceSol: z.number().optional(),
  sellTxSignature: z.string().optional(),
  pnlSol: z.number().optional(),
  pnlPct: z.number().optional(),
  currentPriceUsd: z.number().optional(),
  unrealizedPnlSol: z.number().optional(),
  unrealizedPnlPct: z.number().optional(),
  error: z.string().optional(),
});

export type Position = z.infer<typeof positionSchema>;

export const tradeConfigSchema = z.object({
  solAmount: z.number().min(0.0001),
  slippageBps: z.number().min(50).max(1000000),
  priorityFeeMicroLamports: z.number().min(0).max(100_000_000),
});

export type TradeConfig = z.infer<typeof tradeConfigSchema>;

export const wsMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("mint_detected"),
    data: mintedTokenSchema,
  }),
  z.object({
    type: z.literal("lp_detected"),
    data: lpDetectionSchema,
  }),
  z.object({
    type: z.literal("connection_status"),
    data: z.object({
      connected: z.boolean(),
      message: z.string().optional(),
      isMonitoring: z.boolean().optional(),
    }),
  }),
  z.object({
    type: z.literal("monitoring_state"),
    data: z.object({
      isMonitoring: z.boolean(),
    }),
  }),
  z.object({
    type: z.literal("error"),
    data: z.object({
      message: z.string(),
      type: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal("balance_update"),
    data: z.object({
      balance: z.number(),
      publicKey: z.string(),
    }),
  }),
  z.object({
    type: z.literal("server_log"),
    data: z.object({
      level: z.enum(["info", "warn", "error"]),
      message: z.string(),
      timestamp: z.number(),
    }),
  }),
  z.object({
    type: z.literal("positions_snapshot"),
    data: z.object({
      positions: z.array(positionSchema),
      config: tradeConfigSchema,
      traderPublicKey: z.string().optional(),
      traderReady: z.boolean(),
    }),
  }),
  z.object({
    type: z.literal("position_update"),
    data: positionSchema,
  }),
  z.object({
    type: z.literal("trade_config_update"),
    data: tradeConfigSchema,
  }),
]);

export type WSMessage = z.infer<typeof wsMessageSchema>;
