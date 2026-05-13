import { useState, useEffect } from "react";
import { Wallet, Check, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface WalletBalanceProps {
  onGetBalance: (publicKey: string) => void;
  balance: number | null;
  lastPublicKey: string | null;
  setWalletBalance: (balance: number | null) => void;
}

export function WalletBalance({ onGetBalance, balance, lastPublicKey, setWalletBalance }: WalletBalanceProps) {
  const [address, setAddress] = useState(() => {
    return localStorage.getItem("solana_wallet_address") || "";
  });
  const [loading, setLoading] = useState(false);
  const SOL_PRICE_USD = 124.50; // Örnek fiyat (gerçek API eklenebilir)

  // İlk yüklemede kaydedilmiş adres varsa bakiye sorgula
  useEffect(() => {
    const savedAddress = localStorage.getItem("solana_wallet_address");
    // onGetBalance referansı değiştiği için gereksiz tetiklenmeyi önlemek için check
    if (savedAddress && onGetBalance && !loading && balance === null) {
      console.log("🚀 Sayfa yüklendi, kayıtlı adres sorgulanıyor:", savedAddress);
      
      // WebSocket bağlantısının tam olarak oturmasını bekleyelim
      const checkAndFetch = () => {
        onGetBalance(savedAddress);
        setLoading(true);
      };

      const timer = setTimeout(checkAndFetch, 2000);
      return () => clearTimeout(timer);
    }
  }, [onGetBalance, balance]); // balance null ise sorgula

  useEffect(() => {
    if (balance !== null) {
      console.log("💰 Bakiye güncellendi UI:", balance, "Last PK:", lastPublicKey);
      setLoading(false);
    }
  }, [balance, lastPublicKey]);

  // Watchdog: cevap 12 sn içinde gelmezse yükleme durumunu temizle
  useEffect(() => {
    if (!loading) return;
    const watchdog = setTimeout(() => {
      console.warn("⏱️ Bakiye sorgusu zaman aşımı, yükleme durumu temizleniyor");
      setLoading(false);
    }, 12000);
    return () => clearTimeout(watchdog);
  }, [loading]);

  // Otomatik güncelleme için interval
  useEffect(() => {
    if (!address.trim() || loading) return;

    const interval = setInterval(() => {
      console.log("🔄 Otomatik bakiye güncellemesi tetiklendi:", address);
      onGetBalance(address.trim());
    }, 30000); // 30 saniyede bir

    return () => clearInterval(interval);
  }, [address, onGetBalance, loading]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanAddress = address.trim();
    if (!cleanAddress) return;
    
    // Adresi yerel depolamaya kaydet
    localStorage.setItem("solana_wallet_address", cleanAddress);
    
    console.log("🔍 Bakiye sorgusu gönderiliyor:", cleanAddress);
    setLoading(true);
    setWalletBalance(null);
    onGetBalance(cleanAddress);
  };

  return (
    <Card className="bg-card/50 border-card-border backdrop-blur-sm">
      <CardContent className="p-4">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">Cüzdan Bakiyesi</span>
          </div>
          
          <div className="flex gap-2">
            <Input
              placeholder="Solana cüzdan adresi..."
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="h-9 text-xs bg-background/50"
              data-testid="input-wallet-address"
            />
            <Button 
              type="submit" 
              size="icon" 
              disabled={loading}
              className="h-9 w-9 shrink-0"
              data-testid="button-get-balance"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
            </Button>
          </div>

          {(balance !== null || loading) && (
            <div className="pt-2 border-t border-card-border/50 animate-in fade-in slide-in-from-top-1">
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Bakiye:</span>
                {loading ? (
                  <span className="text-xs animate-pulse text-muted-foreground">Yükleniyor...</span>
                ) : (
                  <div className="flex flex-col items-end">
                    <span className="text-sm font-bold text-primary" data-testid="text-wallet-balance">
                      {balance?.toLocaleString(undefined, { minimumFractionDigits: 4 })} SOL
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      ≈ ${((balance || 0) * SOL_PRICE_USD).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
