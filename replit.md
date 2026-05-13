# Solana Token Monitor + Otomatik Trader

Solana blockchain üzerinde gerçek zamanlı token mint ve likidite pool (LP) tespiti yapan ve Jupiter v6 üzerinden otomatik alım/satım yapabilen web uygulaması.

## Otomatik Trading (Trade sekmesi)

- Üst menüde **+** ikonlu **Trade** sekmesi (Dashboard'ın yanında).
- Her tokenin yanında **Al** butonu (Mintlenen Tokenler kartlarında ve LP listesinde).
- Trade panelinde her açık pozisyon için **Sat** butonu, alış fiyatı, alış miktarı ve durum.
- Cüzdan: `TRADER_PRIVATE_KEY` secret'ından bs58 olarak yüklenir.
- Konfigürasyon: işlem başına SOL miktarı, slippage (bps), priority fee (µLamports). `data/trades.json` içinde kalıcı.
- Pozisyonlar yeniden başlatmalar arasında korunur (`data/trades.json`).
- Jupiter v6: taze quote, yüksek slippage (varsayılan %50), `skipPreflight=true`, `veryHigh` priority, dinamik compute units.

### Trade için ek environment variables
```
TRADER_PRIVATE_KEY=base58_encoded_private_key
```

## Özellikler

### Mintlenen Tokenler
- En fazla 7 token aynı anda görüntülenir
- Her token 3 dakika boyunca ekranda kalır
- Yeni mintlenen tokenler listenin en üstüne eklenir
- En eski token otomatik olarak silinir
- Her token için:
  - Token adı ve sembolü
  - Mint adresi (kopyalanabilir)
  - Geriye sayım sayacı (kalan süre)
  - DEX linkleri (Raydium, Jupiter, Dexscreener)

### LP Tespitleri
- En fazla 10 LP kaydı tutulur
- Her kayıt 2 dakika sonra otomatik silinir
- Tespit edilen her LP için:
  - Token bilgileri
  - Tespit zamanı
  - DEX linkleri
  - Kalan süre göstergesi

### Kontroller
- **Başlat/Durdur butonu**: Monitor'u manuel olarak durdurabilir veya başlatabilirsiniz
- **Bağlantı durumu**: Helius API bağlantı durumu canlı gösterilir
- **Otomatik yeniden bağlanma**: Bağlantı kesilirse 3 saniye sonra otomatik yeniden bağlanır

## Teknik Detaylar

### Backend
- **Helius API**: Solana blockchain verilerini gerçek zamanlı takip eder
- **WebSocket Server**: Frontend ile gerçek zamanlı veri iletişimi
- **Otomatik Yönetim**: Token ve LP kayıtlarını otomatik olarak yönetir

### Frontend
- **React**: Modern, responsive kullanıcı arayüzü
- **Tailwind CSS**: Solana temalı koyu tema tasarımı
- **WebSocket Client**: Gerçek zamanlı veri güncellemeleri
- **Otomatik Temizlik**: Süresi dolan kayıtları otomatik siler

## Kurulum

### Gereksinimler
- Node.js 20+
- Helius API anahtarı

### Environment Variables
```
HELIUS_API_KEY=your_api_key_here
```

**Önemli**: Helius API anahtarınızın geçerli olduğundan emin olun. 401 hatası alıyorsanız, API anahtarınızı kontrol edin.

### Helius API Anahtarı Alma
1. [Helius](https://www.helius.dev/) sitesine gidin
2. Ücretsiz bir hesap oluşturun
3. Dashboard'dan yeni bir API anahtarı oluşturun
4. API anahtarını Replit Secrets'a `HELIUS_API_KEY` olarak ekleyin

## Kullanım

1. Uygulama otomatik olarak başlar
2. Sağ üstteki **Başlat/Durdur** butonu ile monitor'u kontrol edebilirsiniz
3. Yeni mintlenen tokenler üst kısımda görünür
4. LP tespit edildiğinde alt kısımda loglanır
5. Token kartlarındaki DEX linklerine tıklayarak token'ı inceleyebilirsiniz

## Sorun Giderme

### "API anahtarı hatası" mesajı alıyorum
- `HELIUS_API_KEY` environment variable'ının doğru ayarlandığından emin olun
- API anahtarınızın geçerli olduğunu Helius dashboard'dan kontrol edin
- Ücretsiz plan limitinizi aşmadığınızdan emin olun

### Bağlantı sürekli kopuyor
- İnternet bağlantınızı kontrol edin
- Helius servisinin durumunu kontrol edin
- Tarayıcı console'unu açıp hata mesajlarına bakın

### Tokenler görünmüyor
- Monitor'un çalıştığından emin olun (Başlat butonuna basın)
- Helius API bağlantısının kurulu olduğunu kontrol edin
- Solana ağında yeni token mint'lerinin olması gerekir

## Proje Yapısı

```
/
├── client/               # Frontend (React)
│   ├── src/
│   │   ├── components/  # UI bileşenleri
│   │   ├── pages/       # Sayfa bileşenleri
│   │   └── App.tsx      # Ana uygulama
│   └── index.html
├── server/              # Backend (Express)
│   ├── helius-monitor.ts # Helius API entegrasyonu
│   └── routes.ts        # WebSocket server
└── shared/              # Ortak tipler
    └── schema.ts        # TypeScript şemaları
```

## Teknoloji Stack

- **Frontend**: React, TypeScript, Tailwind CSS, Shadcn UI
- **Backend**: Node.js, Express, TypeScript
- **Real-time**: WebSocket (ws)
- **Blockchain**: Solana, Helius API

## Lisans

Bu proje eğitim amaçlıdır.
