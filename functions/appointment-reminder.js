const nodemailer = require('nodemailer');

const SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const GMAIL_USER = 'inquiries@rosaliagroup.com';
const GMAIL_PASS = process.env.GMAIL_PASS_INQUIRIES;

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: GMAIL_USER, pass: GMAIL_PASS },
});

function formatPhone(raw) {
  if (!raw) return '';
  const digits = raw.toString().replace(/\D/g, '');
  const d = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return raw;
}

function isIron65(property) {
  if (!property) return false;
  const p = property.toLowerCase();
  return p.includes('iron 65') || p.includes('mcwhorter') || p.includes('65 mcwhorter');
}

// Parse preferred_time "3:00 PM" into hours (24h) and minutes
function parseTime(timeStr) {
  const m = (timeStr || '').match(/(\d+):?(\d*)?\s*(AM|PM)/i);
  if (!m) return { hours: 12, minutes: 0 };
  let hours = parseInt(m[1]);
  const minutes = parseInt(m[2] || '0');
  const period = m[3].toUpperCase();
  if (period === 'PM' && hours !== 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;
  return { hours, minutes };
}

// Format hours/minutes back to "12:00 PM" display
function formatTime(hours, minutes) {
  const period = hours >= 12 ? 'PM' : 'AM';
  const h = hours > 12 ? hours - 12 : (hours === 0 ? 12 : hours);
  return `${h}:${String(minutes).padStart(2, '0')} ${period}`;
}

exports.handler = async () => {
  const headers = { 'Content-Type': 'application/json' };
  if (!GMAIL_PASS || !SUPABASE_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Missing env vars' }) };
  }

  try {
    // Compute tomorrow's date in ET
    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const tomorrow = new Date(nowET);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const pad = n => String(n).padStart(2, '0');
    const tomorrowISO = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`;

    console.log('Checking for appointments on:', tomorrowISO);

    // Query bookings for tomorrow that haven't been reminded
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?preferred_date=eq.${tomorrowISO}&reminder_sent_at=is.null&select=*`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    const bookings = await res.json();
    if (!Array.isArray(bookings) || bookings.length === 0) {
      console.log('No appointments tomorrow needing reminders');
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, reminders: 0 }) };
    }

    console.log(`Found ${bookings.length} appointments for tomorrow`);

    let sent = 0;
    let errors = 0;

    for (const booking of bookings) {
      try {
        const firstName = (booking.full_name || '').split(' ')[0] || 'there';
        const propertyAddress = booking.type || 'your appointment';
        const propertyShort = isIron65(propertyAddress) ? 'Iron 65' : propertyAddress.split(',')[0].trim();
        const displayTime = booking.preferred_time || 'TBD';

        // Format display date
        const tomorrowDate = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate());
        const displayDate = tomorrowDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

        // Compute confirmation deadline = appointment time - 3 hours
        const { hours: apptHours, minutes: apptMinutes } = parseTime(booking.preferred_time);
        let deadlineHours = apptHours - 3;
        let deadlineDay = 'tomorrow';
        if (deadlineHours < 0) {
          deadlineHours += 24;
          deadlineDay = 'tonight';
        }
        const deadlineDisplay = `${formatTime(deadlineHours, apptMinutes)} ${deadlineDay}`;

        // Manage Appointment URL
        const manageUrl = isIron65(propertyAddress)
          ? 'https://book.rosaliagroup.com/iron65-reschedule'
          : 'https://book.rosaliagroup.com/reschedule';

        // Build email HTML — same dark gold styling as book.js
        const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#0A0A0A;font-family:'Georgia',serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0A0A0A;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#111111;border:1px solid #C9A84C;border-radius:4px;overflow:hidden;">
        <!-- Header -->
        <tr>
          <td style="background:#0A0A0A;padding:30px 40px;text-align:center;border-bottom:1px solid #C9A84C;">
            <div style="color:#C9A84C;font-size:11px;letter-spacing:4px;text-transform:uppercase;">Rosalia Group</div>
            <div style="color:#C9A84C;font-size:18px;margin-top:6px;">&#9670;</div>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:40px;">
            <h1 style="color:#C9A84C;font-size:22px;font-weight:normal;letter-spacing:2px;text-transform:uppercase;margin:0 0 24px 0;">Tour Reminder</h1>
            <p style="color:#E8E8E8;font-size:15px;line-height:1.7;margin:0 0 24px 0;">Hi ${firstName},</p>
            <p style="color:#E8E8E8;font-size:15px;line-height:1.7;margin:0 0 30px 0;">Your tour at ${propertyShort} is tomorrow:</p>
            <!-- Details Box -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#0A0A0A;border:1px solid #333;border-radius:4px;margin-bottom:30px;">
              <tr><td style="padding:24px 28px;">
                <div style="color:#C9A84C;font-size:10px;letter-spacing:3px;text-transform:uppercase;margin-bottom:16px;">Tour Details</div>
                <div style="color:#E8E8E8;font-size:15px;margin-bottom:10px;">📅 ${displayDate}</div>
                <div style="color:#E8E8E8;font-size:15px;margin-bottom:10px;">🕒 ${displayTime}</div>
                <div style="color:#E8E8E8;font-size:15px;margin-bottom:10px;">📍 <strong style="color:#C9A84C;">${propertyAddress}</strong></div>
              </td></tr>
            </table>
            <!-- Confirmation Warning -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1200;border:1px solid #C9A84C;border-radius:4px;margin-bottom:30px;">
              <tr><td style="padding:20px 28px;">
                <div style="color:#C9A84C;font-size:14px;line-height:1.7;">⚠️ Please confirm your tour at least 3 hours before your appointment time.</div>
                <div style="color:#999;font-size:13px;line-height:1.7;margin-top:8px;">If we don't hear from you by <strong style="color:#E8E8E8;">${deadlineDisplay}</strong>, we may need to cancel and offer your slot to another prospective tenant.</div>
                <div style="color:#E8E8E8;font-size:14px;line-height:1.7;margin-top:12px;">To confirm: simply reply <strong style="color:#C9A84C;">YES</strong> to this email, or call us at <strong>(862) 419-1763</strong>.</div>
              </td></tr>
            </table>
            <p style="color:#999;font-size:13px;line-height:1.7;margin:0 0 30px 0;">Need to reschedule? Reply to this email or use the link below.</p>
            <!-- CTA -->
            <div style="text-align:center;margin-bottom:30px;">
              <a href="${manageUrl}" style="display:inline-block;background:#C9A84C;color:#0A0A0A;font-size:12px;letter-spacing:3px;text-transform:uppercase;padding:14px 32px;text-decoration:none;font-weight:bold;border-radius:2px;">Manage Appointment</a>
            </div>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#0A0A0A;padding:20px 40px;text-align:center;border-top:1px solid #222;">
            <div style="color:#555;font-size:11px;letter-spacing:2px;text-transform:uppercase;">Rosalia Group &nbsp;|&nbsp; rosaliagroup.com</div>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

        // a. Send reminder email to lead
        await transporter.sendMail({
          from: '"Rosalia Group" <inquiries@rosaliagroup.com>',
          to: booking.email,
          cc: 'inquiries@rosaliagroup.com',
          subject: `Confirm your tour tomorrow at ${propertyShort} — ${displayTime}`,
          html: emailHtml,
        });
        console.log('Reminder sent to:', booking.email);

        // b. Create task for team
        await fetch(`${SUPABASE_URL}/rest/v1/tasks`, {
          method: 'POST',
          headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({
            lead_name: booking.full_name,
            lead_email: booking.email,
            lead_phone: booking.phone,
            task_type: 'appointment_verification',
            description: `Tour tomorrow: ${propertyAddress}, ${displayDate} at ${displayTime}. Lead: ${booking.full_name} — ${booking.email} — ${formatPhone(booking.phone)}. Confirmation deadline: ${deadlineDisplay} (3 hours before tour). Action: If lead has not confirmed by deadline, call them OR cancel and rebook the slot.`,
            status: 'open',
          }),
        });
        console.log('Task created for:', booking.full_name);

        // c. Send team notification email
        await transporter.sendMail({
          from: `"Rosalia AI System" <${GMAIL_USER}>`,
          to: GMAIL_USER,
          subject: `Tour Tomorrow: ${booking.full_name} — ${propertyShort} at ${displayTime}`,
          text: `Tour reminder sent for tomorrow's appointment.\n\nLead: ${booking.full_name}\nEmail: ${booking.email}\nPhone: ${formatPhone(booking.phone)}\nProperty: ${propertyAddress}\nTime: ${displayTime}\n\nConfirmation deadline: ${deadlineDisplay}\nAction: If no confirmation by deadline, call the lead or cancel and rebook.\n\nTask created in dashboard.`,
        });

        // d. Mark reminder as sent
        await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${booking.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
          body: JSON.stringify({ reminder_sent_at: new Date().toISOString() }),
        });

        sent++;
      } catch (err) {
        console.error('Error processing reminder for:', booking.full_name, err.message);
        errors++;
      }
    }

    console.log(`Reminders sent: ${sent} | Tasks created: ${sent} | Errors: ${errors}`);
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, reminders: sent, errors }) };

  } catch (err) {
    console.error('appointment-reminder error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
