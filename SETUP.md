# Abrevo Booking Engine — Setup Guide

## Files
- `functions/book.js` — Main booking function
- `netlify.toml` — Netlify config
- `package.json` — Dependencies

## How It Works
1. Vapi calls `https://abrevo.co/api/book?client=rosalia` with booking data
2. Function creates Google Calendar event with full client notes
3. Texts caller a confirmation via Textbelt
4. Texts Ana with full booking details

## Endpoint
POST `https://abrevo.co/api/book?client=rosalia`

## Body (sent by Vapi)
```json
{
  "full_name": "John Smith",
  "phone": "6462269189",
  "email": "john@email.com",
  "type": "In Person Tour - 276 Duncan St Jersey City",
  "preferred_date": "2026-03-10",
  "preferred_time": "10:00 AM",
  "budget": "$2,500-$3,000",
  "apartment_size": "2 Bedroom",
  "preferred_area": "Jersey City",
  "move_in_date": "March 15 2026",
  "income_qualifies": "yes",
  "credit_qualifies": "yes",
  "additional_notes": "Has a small dog. Prefers higher floors."
}
```

## Deploy to Netlify
1. Add these files to your abrevo.co repo
2. In Netlify dashboard → Environment Variables → add:
   - `GOOGLE_CREDENTIALS` — paste your Google service account JSON
3. Deploy

## Google Service Account Setup
1. Go to console.cloud.google.com
2. Create a new project or use existing
3. Enable Google Calendar API
4. Create Service Account → download JSON key
5. Share `inquiries@rosaliagroup.com` calendar with the service account email
6. Paste the entire JSON as GOOGLE_CREDENTIALS in Netlify env vars

## Adding More Clients
In `functions/book.js` add to CLIENTS object:
```js
mechanical: {
  calendarId: 'calendar@mechanicalenterprise.com',
  notifyPhone: '+1XXXXXXXXXX',
  notifyName: 'Manager',
  teamName: 'Mechanical Enterprise',
  googleCredentials: JSON.parse(process.env.GOOGLE_CREDENTIALS || '{}'),
}
```
Then use: `https://abrevo.co/api/book?client=mechanical`

## Vapi Setup
In each assistant → Tools → API Request:
- URL: `https://abrevo.co/api/book?client=rosalia`
- Method: POST
- Add all 13 parameters as properties
