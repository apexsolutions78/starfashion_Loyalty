# Session Log - UI Redesign (Upscayl Dark Theme)

**Date:** 2026-09-22
**Status:** COMPLETED

## What was implemented

### 1. Dark Theme CSS Redesign (`public/css/style.css`)
Complete rewrite matching Upscayl.org design aesthetic:
- **Colors:** slate-900/800/950 backgrounds, violet-500 accent (`#8b5cf6`), subtle border colors
- **Typography:** Inter font via Google Fonts, -0.02em letter-spacing
- **Components:** Glassmorphism cards with `backdrop-filter: blur`, rounded-xl (16px) corners
- **Buttons:** Rounded-full primary with accent glow, outline secondary variants
- **Badges:** Color-coded with translucent backgrounds and border accents (pending/approved/rejected/active)
- **Auth Pages:** Centered card with animated radial gradient background pulse
- **Upload Area:** Dashed border with drag-over glow effect
- **Stat Cards:** Hover glow effect with accent color
- **Tables:** Subtle row hover with accent tint
- **Forms:** Dark inputs with focus glow ring
- **Custom Scrollbar** styled to match dark theme
- CSS variables defined on `:root` for consistent theming

### 2. express-ejs-layouts Integration
- Registered `express-ejs-layouts` middleware in `src/server.ts`
- Set default layout to `layout.ejs`
- **Root cause fix:** Layout was never loaded — pages rendered standalone without `<head>`, CSS, or fonts, causing white background and unstyled content
- Created `src/types/express-ejs-layouts.d.ts` for TypeScript compatibility

### 3. Template Updates (All 16 EJS Files)
- **Headers:** Logo moved to top-left corner (image only, no text), smaller sizing (36px height)
- **Auth pages:** Logo centered in auth card, max-width constrained
- **Fixed `var(--text-light)` → `var(--text-muted)`** across all templates (old variable didn't exist in new CSS)
- **Layout:** Added Inter font preconnect, favicon set to logo
- **app.js:** Improved `showAlert()` targeting — now looks for `#alert` div first, then `.content`, then `.auth-card`

### 4. Logo Constraints
- `.header .logo img`: `height: 36px; max-width: 120px; object-fit: contain`
- `.auth-card .logo img`: `height: 48px; max-width: 140px; object-fit: contain`
- Prevents the wide banner logo from overflowing its container

### 5. Default Admin User Seeded
- Created `scripts/seed-admin.js` using argon2id hashing
- **Credentials:** `admin@starfashion.com` / `Admin123!`
- Email verified, mobile verified, active status, admin role

## Key Bug Fixed

**Layout not rendering:** `express-ejs-layouts` was in `package.json` but never imported or registered in `server.ts`. This caused:
- No `<head>` tag (no CSS, no fonts, no meta viewport)
- White background instead of dark theme
- Unstyled form elements
- Logo displayed at full image size unconstrained

## Files changed/created

```
public/css/style.css              (full rewrite - dark theme)
public/js/app.js                  (improved alert targeting)
views/layout.ejs                  (added Inter font, favicon)
views/partials/customer-header.ejs (logo top-left, no text)
views/partials/admin-header.ejs    (logo top-left, no text)
views/partials/footer.ejs          (unchanged)
views/auth/login.ejs               (dark theme classes)
views/auth/register.ejs            (dark theme classes)
views/auth/forgot-password.ejs     (dark theme classes)
views/customer/dashboard.ejs       (text-light → text-muted)
views/customer/claims.ejs          (text-light → text-muted)
views/customer/new-claim.ejs       (dark theme classes)
views/customer/points.ejs          (text-light → text-muted)
views/customer/redemptions.ejs     (dark theme, bg-input quote box)
views/customer/offers.ejs          (text-light → text-muted/text-secondary)
views/admin/dashboard.ejs          (text-light → text-muted)
views/admin/review-queue.ejs       (text-light → text-muted)
views/admin/review-detail.ejs      (dark theme, improved spacing)
src/server.ts                      (+import expressLayouts, +middleware)
src/types/express-ejs-layouts.d.ts (new - TypeScript declaration)
scripts/seed-admin.js              (new - admin user seeding)
```

## Verification

- TypeScript: 0 errors
- Server: Running on port 3000, health check OK
- Login page: Now renders with dark theme, CSS loads, layout wraps correctly
- Admin user seeded and login verified working
