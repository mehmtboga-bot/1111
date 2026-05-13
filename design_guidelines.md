# Design Guidelines: Solana Token Monitor

## Design Approach

**Selected Approach:** Design System with Crypto Trading Platform Inspiration

This is a utility-focused, real-time monitoring application requiring high information density and instant readability. Drawing inspiration from professional trading platforms like Binance and Coinbase, combined with Material Design principles for structure and feedback systems.

**Key Design Principles:**
- Information clarity over decoration
- Real-time status visibility at a glance
- Efficient action pathways (one-click DEX access)
- Professional crypto trading aesthetic
- Solana brand integration

## Core Design Elements

### A. Color Palette

**Dark Theme (Primary):**
- Background Base: 15 8% 8% (deep charcoal)
- Surface: 15 8% 12% (card backgrounds)
- Surface Elevated: 15 8% 16% (hover states, elevated cards)
- Border: 15 8% 24% (subtle separators)

**Solana Brand Colors:**
- Primary (Gradient Start): 282 87% 65% (Solana purple #9945FF)
- Primary (Gradient End): 167 100% 50% (Solana teal #14F195)
- Use gradient sparingly for key CTAs and status indicators

**Semantic Colors:**
- Success/Active: 142 76% 36% (LP detected, active connections)
- Warning: 45 93% 47% (expiring soon warnings)
- Error: 0 84% 60% (connection errors)
- Info: 217 91% 60% (neutral information)

**Text Colors:**
- Primary Text: 0 0% 98% (high contrast)
- Secondary Text: 0 0% 70% (metadata, timestamps)
- Muted Text: 0 0% 50% (helper text)

### B. Typography

**Font Families:**
- Primary: 'Inter' (Google Fonts) - exceptional legibility for data
- Monospace: 'Roboto Mono' (Google Fonts) - token addresses, numerical data

**Type Scale:**
- Hero/Section Headers: 2xl to 3xl, font-bold (headings)
- Card Titles: lg to xl, font-semibold (token names)
- Body/Data: sm to base, font-medium (metadata, values)
- Labels/Helper: xs to sm, font-normal (timestamps, labels)
- Monospace Data: sm to base, font-mono (addresses, technical data)

### C. Layout System

**Spacing Primitives:** Tailwind units of 2, 4, 6, 8, 12, 16, 24
- Component padding: p-4 to p-6
- Section gaps: gap-4 to gap-6
- Major section spacing: mt-8 to mt-12
- Card spacing: p-4 internally, gap-3 between elements

**Container Structure:**
- Max width: max-w-7xl centered
- Side padding: px-4 on mobile, px-6 on tablet, px-8 on desktop
- Two-section vertical layout (Minted Tokens / LP Logs)

### D. Component Library

**Navigation/Header:**
- Sticky top bar with dark surface background
- Application title with Solana gradient accent
- Live connection status indicator (pulsing green dot)
- WebSocket connection status text
- Optional: Active mints count badge

**Minted Tokens Section (Top):**
- Grid of token cards (1 column mobile, 2-3 columns desktop)
- Each card contains:
  - Token name (large, semibold)
  - Symbol badge (pill style with gradient background)
  - Mint address (truncated, monospace, copyable)
  - Countdown timer (large, prominent, color-coded: green>60s, yellow 30-60s, red<30s)
  - DEX action buttons row (Raydium, Jupiter, Dexscreener as compact icon+text buttons)
- Cards appear with subtle slide-in animation from top
- Newest card highlighted briefly with pulse border
- Maximum 7 cards, auto-removes oldest

**LP Detection Logs Section (Bottom):**
- Table/list layout with striped rows for easy scanning
- Each entry displays:
  - Detection timestamp (relative time: "2s ago")
  - Token name and symbol
  - Mint address (truncated, copyable)
  - Quick DEX links (icon-only buttons)
  - Countdown timer showing time until removal
- Log entries fade out when expiring
- Maximum 10 entries, auto-removes after 2 minutes
- Success green accent on new entries

**Status Indicators:**
- Connection status: Dot indicator + text ("Connected", "Reconnecting...", "Disconnected")
- Timer displays: Color-coded countdown (green/yellow/red)
- Loading states: Skeleton cards while fetching metadata
- Empty states: Illustrated message "Monitoring for new tokens..."

**Buttons:**
- Primary CTA: Solana gradient background, white text, px-4 py-2, rounded-lg
- DEX Links: Outline style with surface background, border, hover:gradient
- Icon buttons: Minimal with hover:surface-elevated
- Copy buttons: Icon-only, hover shows tooltip

**Data Display:**
- Token cards: Rounded-xl, border, p-4 to p-6, hover:surface-elevated
- Log rows: py-3 px-4, border-b, hover:surface
- Badges: px-2 py-1, rounded-md, text-xs font-medium
- Timestamps: Muted text, text-xs, monospace

**Overlays:**
- Toast notifications: Bottom-right, gradient border for LP detections
- Tooltips: Dark surface, white text, text-xs, rounded
- Copy confirmation: Brief checkmark animation

### E. Animations

Use sparingly, only for status feedback:
- New token card: Subtle slide-down fade-in (300ms)
- LP detection: Brief pulse/glow effect on new log entry
- Countdown timers: Smooth numerical updates
- Connection status: Pulsing dot animation when active
- Card removal: Quick fade-out (200ms)
- Hover states: Smooth background transitions (150ms)

## Special Considerations

**Real-Time Feedback:**
- Immediate visual response to WebSocket events
- Clear distinction between new vs. expiring entries
- Live countdown timers updated every second
- Connection status always visible

**Information Density:**
- Compact card layouts that fit 7 tokens comfortably on desktop
- Efficient use of icons for DEX platforms
- Truncated addresses with expand-on-hover or copy functionality
- Tabular log section for high-density scanning

**Responsive Behavior:**
- Mobile: Single column cards, stacked buttons, simplified timestamps
- Tablet: 2-column token grid, compact table
- Desktop: 3-column token grid, full table with all metadata

**Crypto Trading Aesthetic:**
- Professional dark theme throughout
- Subtle Solana brand gradient usage (not overwhelming)
- Monospace fonts for technical data
- High contrast for instant readability
- Trading platform-inspired status indicators

## Images

No hero images required. This is a functional dashboard focused on real-time data monitoring. All visual interest comes from:
- Solana gradient accents
- Live status indicators
- Dynamic content updates
- Color-coded timers

Optional: Small Solana logo in header for branding.