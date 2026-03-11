# Abrevo Production-Ready Backup - May 2026

**Date:** March 8, 2026
**Git Commit:** 877b3fb
**Git Tag:** v1.0-production-ready
**Status:** ✅ Fully tested and production-ready

## What's Included
- All Netlify serverless functions (book.js, reschedule.js, etc.)
- Package dependencies
- Configuration files

## System Status
✅ Booking function - correct EDT timezone
✅ Reschedule function - correct EDT timezone
✅ Phone normalization (+1 format)
✅ Supabase integration
✅ Google Calendar API
✅ SMS notifications (TextBelt)
✅ Email notifications (Gmail)

## Key Functions
- `book.js` - Creates appointments, saves to Supabase, sends notifications
- `reschedule.js` - Updates appointments with property matching, deletes old events

## Environment Variables Required (Netlify)
- GOOGLE_CREDENTIALS
- GMAIL_USER
- GMAIL_PASS
- SUPABASE_SERVICE_KEY

## Deployment
- GitHub: https://github.com/RosaliaGroup/Abrevo
- Netlify: https://silver-ganache-1ee2ca.netlify.app
- Supabase: https://fhkgpepkwibxbxsepetd.supabase.co

## Restore Instructions
To restore this version:
```bash
git checkout v1.0-production-ready
```

Or copy files from this backup folder.