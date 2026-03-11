const nodemailer = require("nodemailer");

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
      from: '"Alex — Rosalia Group" <alex@useabrevo.co>',
      to: "ana@rosaliagroup.com",
      cc: "listings@rosaliagroup.com",
      subject: `New Showing — ${full_name} — ${type}`,
      text: emailBody,
    });
  } catch (emailErr) {
    console.error("Email error:", emailErr.message);
  }

  // --- SEND TEXT TO ANA VIA TEXTBELT ---
  try {
    const smsBody = `New Showing!\n${full_name}\n${phone}\n${type}\n${preferred_date} at ${preferred_time}`;
    const textbeltRes = await fetch("https://textbelt.com/text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone: "ANA_PHONE_NUMBER_HERE", // Replace with Ana's number e.g. +12015551234
        message: smsBody,
        key: "0672a5cd59b0fa1638624d31dea7505b49a5d146u7lBHeSj1QPHplFQ5B1yKVIYW",
      }),
    });
    const smsResult = await textbeltRes.json();
    console.log("Textbelt result:", smsResult);
  } catch (smsErr) {
    console.error("SMS error:", smsErr.message);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true }),
  };
};
