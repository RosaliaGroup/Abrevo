# HVAC Campaigns - Complete Setup Guide

## What's Included

This ZIP contains everything you need to run the HVAC lead generation platform:

```
hvac-export/
├── hvac-campaigns-essex/      # Main React + Express + tRPC application
│   ├── client/                # React frontend
│   ├── server/                # Express backend with tRPC
│   ├── drizzle/               # Database schema & migrations
│   ├── shared/                # Shared types
│   ├── package.json           # Dependencies
│   ├── tsconfig.json          # TypeScript config
│   └── ...
├── hvac-ads/                  # All flyer images (6 flyers + QR codes)
│   ├── hvac-final-qr.jpg
│   ├── oil-final-qr.jpg
│   ├── rebate-final-qr.jpg
│   ├── where-is-your-money-v4-qr.png
│   ├── seller-flyer-v3-qr.jpg
│   └── buyer-flyer-v7.png
└── nextdoor-posts/            # Square format ads for Nextdoor
    ├── where-is-your-money-nj-qr.png
    └── ...
```

## Quick Start

### 1. Extract the ZIP
```bash
unzip hvac-campaigns-complete.zip
cd hvac-export/hvac-campaigns-essex
```

### 2. Install Dependencies
```bash
pnpm install
```

### 3. Set Environment Variables
Create a `.env.local` file in the project root with:
```
DATABASE_URL=your_mysql_connection_string
JWT_SECRET=your_secret_key
VITE_APP_ID=your_manus_app_id
OAUTH_SERVER_URL=https://api.manus.im
VITE_OAUTH_PORTAL_URL=https://portal.manus.im
OWNER_OPEN_ID=your_owner_id
OWNER_NAME=Your Name
META_ACCESS_TOKEN=your_meta_token
GOOGLE_ADS_CLIENT_ID=your_google_client_id
GOOGLE_ADS_CLIENT_SECRET=your_google_client_secret
GOOGLE_ADS_CUSTOMER_ID=your_customer_id
GOOGLE_ADS_DEVELOPER_TOKEN=your_developer_token
BUILT_IN_FORGE_API_KEY=your_forge_key
BUILT_IN_FORGE_API_URL=https://api.manus.im
VITE_FRONTEND_FORGE_API_KEY=your_frontend_key
VITE_FRONTEND_FORGE_API_URL=https://api.manus.im
```

### 4. Sync Database
```bash
pnpm db:push
```

### 5. Start Development Server
```bash
pnpm dev
```

The app will be available at `http://localhost:3000`

## Key Features

✅ **Campaign Management** — Create and manage Meta Ads campaigns
✅ **Lead Capture** — Rebate calculator form with lead collection
✅ **Database** — MySQL with Drizzle ORM
✅ **Authentication** — Manus OAuth integration
✅ **API Integration** — Meta Ads API, Google Ads API
✅ **Responsive Design** — Tailwind CSS + shadcn/ui

## Available Scripts

```bash
pnpm dev              # Start development server
pnpm build            # Build for production
pnpm test             # Run tests
pnpm format           # Format code
pnpm db:push          # Push database migrations
```

## Flyers & Assets

All flyer images are in `hvac-ads/` and `nextdoor-posts/`:

1. **HVAC Replacement** — `hvac-final-qr.jpg`
2. **Oil Replacement** — `oil-final-qr.jpg`
3. **Rebate Hunter** — `rebate-final-qr.jpg`
4. **Where Is YOUR Money** — `where-is-your-money-v4-qr.png`
5. **Seller ($$$$$ home value)** — `seller-flyer-v3-qr.jpg`
6. **Buyer (Monster Hunter)** — `buyer-flyer-v7.png`

All QR codes link to: `https://mechanicalenterprise.com/rebate-calculator`

## Database Schema

Key tables:
- **campaigns** — Meta/Google Ads campaigns
- **leads** — Captured leads from forms
- **users** — User accounts with role-based access
- **notifications** — System notifications

See `drizzle/schema.ts` for full schema.

## Troubleshooting

**Port already in use:**
```bash
lsof -i :3000
kill -9 <PID>
```

**Database connection error:**
- Verify DATABASE_URL is correct
- Ensure MySQL server is running
- Check credentials

**Missing dependencies:**
```bash
pnpm install
pnpm db:push
```

## Support

For issues or questions about the codebase, refer to:
- `server/routers.ts` — tRPC procedures
- `client/src/pages/` — React components
- `drizzle/schema.ts` — Database structure
- `todo.md` — Feature checklist

---

**Last Updated:** March 21, 2026
**Project:** HVAC Lead Generation Campaigns - Essex County, NJ
