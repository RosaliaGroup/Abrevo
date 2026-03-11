# ABREVO AI CALLING SYSTEM - FINAL BACKUP
**Date:** March 9, 2026
**Status:** ✅ Production Ready

## System Overview
AI-powered appointment booking and rescheduling system for Rosalia Group luxury rentals.

## What's Working
✅ VAPI AI assistant (Alex) - books and reschedules appointments via phone
✅ Booking function - saves to Supabase + Google Calendar
✅ Reschedule function - updates appointments (manual calendar cleanup needed)
✅ Phone normalization - consistent +1 format
✅ Timezone handling - correct EDT/EST
✅ Email confirmations - sent to caller + CC inquiries@rosaliagroup.com
✅ SMS notifications - via TextBelt (daily limit reached, needs upgrade)

## Known Issues
⚠️ Old calendar events not auto-deleted on reschedule (manual cleanup required)
⚠️ Alex repeats confirmations twice (VAPI behavior, cosmetic only)
⚠️ TextBelt daily SMS limit - need to upgrade account

## Deployment
- **GitHub:** https://github.com/RosaliaGroup/Abrevo
- **Netlify:** https://silver-ganache-1ee2ca.netlify.app
- **Supabase:** https://fhkgpepkwibxbxsepetd.supabase.co
- **Latest Commit:** dff9411 - Add detailed debug logging

## Key Files
- `functions/book.js` - Booking endpoint
- `functions/reschedule.js` - Reschedule endpoint  
- `functions/lookup.js` - Caller info lookup

## Environment Variables (Netlify)
- GOOGLE_CREDENTIALS
- GMAIL_USER
- GMAIL_PASS
- SUPABASE_SERVICE_KEY

## Database
**Supabase Table:** bookings
**Schema:** id, full_name, phone, email, type, preferred_date, preferred_time, budget, apartment_size, move_in_date, income_qualifies, credit_qualifies, calendar_event_id

## Restore Instructions
```bash
git clone https://github.com/RosaliaGroup/Abrevo.git
cd Abrevo
git checkout dff9411
npm install
```

Or copy files from this backup to new location.

## Contact
- Ana Haynes - (201) 449-6850
- inquiries@rosaliagroup.com