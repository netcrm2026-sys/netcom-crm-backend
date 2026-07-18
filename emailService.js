const nodemailer = require('nodemailer');
const { google } = require('googleapis');

// ============================================================
// GMAIL OAuth Configuration
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
// CREATE TRANSPORTER
// ============================================================

async function createTransporter() {
  try {
    const accessToken = await oauth2Client.getAccessToken();
    const token = typeof accessToken === 'string' ? accessToken : accessToken.token;
    
   const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    type: 'OAuth2',
    user: SENDER_EMAIL,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    refreshToken: REFRESH_TOKEN,
    accessToken: token,
  },
  timeout: 30000,
  connectionTimeout: 30000,
  socketTimeout: 30000,
  family: 4,  // Force IPv4
});
    
    return transporter;
  } catch (error) {
    console.error('Error creating transporter:', error);
    throw error;
  }
}

// ============================================================
// SEND EMAIL FUNCTION
// ============================================================

async function sendEmail(to, subject, htmlContent) {
  try {
    const transporter = await createTransporter();
    
    const mailOptions = {
      from: `NetCRM <${SENDER_EMAIL}>`,
      to: to,
      subject: subject,
      html: htmlContent,
    };
    
    const result = await transporter.sendMail(mailOptions);
    console.log(`✅ Email sent to ${to}`);
    return result;
    
  } catch (error) {
    console.error('❌ Failed to send email:', error);
    throw error;
  }
}

module.exports = { sendEmail };