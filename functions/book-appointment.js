const nodemailer = require("nodemailer");
const { sendSMS } = require("./lib/sms");

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let data;
  try {
    data = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: "Invalid JSON" };
  }

  const {
    full_name = "Unknown",
    phone = "Not provided",
    email = "Not provided",
    type = "Apartment Showing",
    preferred_date = "TBD",
    preferred_time = "TBD",
    budget = "Not provided",
    apartment_size = "Not provided",
    preferred_area = "Not provided",
    move_in_date = "Not provided",
    income_qualifies = "Not provided",
    credit_qualifies = "Not provided",
    additional_notes = "",
  } = data;

  const emailBody = `
NEW SHOWING BOOKED
==================

Name: ${full_name}
Phone: ${phone}
Email: ${email}
Property: ${type}
Date: ${preferred_date} at ${preferred_time}

QUALIFICATION
Budget: ${budget}
Apartment Size: ${apartment_size}
Preferred Area: ${preferred_area}
Move-In Date: ${move_in_date}
Income Qualifies: ${income_qualifies}
Credit Qualifies: ${credit_qualifies}

NOTES
${additional_notes}
`;

  // --- SEND EMAIL TO ANA ---
  try {
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      auth: {
        user: "alex@useabrevo.co",
        pass: "kimeapjndjwpfeqw",
      },
    });

    await transporter.sendMail({
      from: '"Alex -- Rosalia Group" <alex@useabrevo.co>',
      to: "ana@rosaliagroup.com",
      cc: "listings@rosaliagroup.com",
      subject: `New Showing -- ${full_name} -- ${type}`,
      text: emailBody,
    });
  } catch (emailErr) {
    console.error("Email error:", emailErr.message);
  }

  // --- SEND TEXT ALERT TO ANA (internal) ---
  // NOTE: recipient is still the "ANA_PHONE_NUMBER_HERE" placeholder from the
  // original code — this alert has never actually delivered. Set a real number
  // to enable it. Left as-is here to avoid changing delivery behavior.
  try {
    const smsBody = `New Showing!\n${full_name}\n${phone}\n${type}\n${preferred_date} at ${preferred_time}`;
    const smsResult = await sendSMS("ANA_PHONE_NUMBER_HERE", smsBody);
    console.log("Ana alert SMS:", smsResult.success ? "sent" : smsResult.error);
  } catch (smsErr) {
    console.error("SMS error:", smsErr.message);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true }),
  };
};
