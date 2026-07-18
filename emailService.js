const { google } = require('googleapis');

// ============================================================
// GMAIL API CONFIGURATION (NO SMTP)
// ============================================================

const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN;
const SENDER_EMAIL = process.env.GMAIL_SENDER_EMAIL || 'netcrm2026@gmail.com';

// Create OAuth2 client
const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  'https://developers.google.com/oauthplayground'
);

oauth2Client.setCredentials({
  refresh_token: REFRESH_TOKEN,
});

// ============================================================
// SEND EMAIL USING GMAIL API
// ============================================================

async function sendEmail(to, subject, htmlContent) {
  try {
    // Get fresh access token
    const accessToken = await oauth2Client.getAccessToken();
    const token = typeof accessToken === 'string' ? accessToken : accessToken.token;
    
    // Create email message (RFC 2822 format)
    const boundary = 'boundary_' + Date.now();
    
    // Plain text version (strip HTML)
    const plainText = htmlContent.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    
    const message = [
      `From: NetCRM <${SENDER_EMAIL}>`,
      `To: ${to}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      plainText,
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      '',
      htmlContent,
      '',
      `--${boundary}--`,
    ].join('\r\n');
    
    // Encode to base64url (Gmail required format)
    const encodedMessage = Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    
    // Send via Gmail API
    const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        raw: encodedMessage,
      }),
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Gmail API error: ${errorData.error?.message || response.statusText}`);
    }
    
    const result = await response.json();
    console.log(`✅ Email sent to ${to}`);
    return result;
    
  } catch (error) {
    console.error('❌ Failed to send email:', error);
    throw error;
  }
}

module.exports = { sendEmail };