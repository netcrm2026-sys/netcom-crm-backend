// ============================================================
// AMC REMINDER SERVICE - FIXED
// ============================================================

const admin = require('firebase-admin');
const { sendEmail } = require('./emailService');

// ============================================================
// ENSURE FIREBASE ADMIN IS INITIALIZED
// ============================================================

function getFirestore() {
  // If Firebase Admin is not initialized, initialize it
  if (!admin.apps || admin.apps.length === 0) {
    try {
      admin.initializeApp({
        projectId: 'netcoms-crm',
      });
      console.log('✅ Firebase Admin initialized from amcReminderService');
    } catch (error) {
      console.error('❌ Failed to initialize Firebase Admin:', error);
      throw error;
    }
  }
  return admin.firestore();
}

// ============================================================
// AMC EXPIRY REMINDER SERVICE
// ============================================================

const REMINDER_DAYS = [30, 20, 15, 10, 5, 3, 2, 1];

function formatDate(dateString) {
  if (!dateString) return '—';
  const date = new Date(dateString);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}-${month}-${year}`;
}

async function checkAMCExpiryAndSendReminders() {
  console.log('🔍 Checking AMC expiry reminders...');
  
  try {
    // Get Firestore instance using the helper function
    const db = getFirestore();
    
    // 1. Get all clients from Firestore
    const clientsSnapshot = await db.collection('clients').get();
    const clients = clientsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));
    
    console.log(`📋 Found ${clients.length} clients`);
    
    // 2. Get email recipients from settings
    const settingsDoc = await db.doc('settings/emailNotifications').get();
    let recipients = [];
    
    if (settingsDoc.exists) {
      const data = settingsDoc.data();
      recipients = data.amcExpiryRecipients || [];
    }
    
    if (recipients.length === 0) {
      console.log('⚠️ No recipients configured');
      return { success: false, message: 'No recipients configured' };
    }
    
    console.log(`👤 Found ${recipients.length} recipient(s)`);
    
    // 3. Find expiring AMCs
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const expiringAMCs = [];
    
    clients.forEach(client => {
      const amcs = client.amcs || [];
      amcs.forEach(amc => {
        if (!amc.endDate) return;
        
        const endDate = new Date(amc.endDate);
        endDate.setHours(0, 0, 0, 0);
        
        const daysUntilExpiry = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));
        
        if (REMINDER_DAYS.includes(daysUntilExpiry) && daysUntilExpiry >= 0) {
          expiringAMCs.push({
            clientName: client.name || 'Unknown Client',
            amcName: amc.amcName || 'Unnamed AMC',
            endDate: amc.endDate,
            daysUntilExpiry: daysUntilExpiry,
          });
        }
      });
    });
    
    if (expiringAMCs.length === 0) {
      console.log('✅ No AMCs expiring on reminder days today.');
      return { success: true, message: 'No AMCs to remind about' };
    }
    
    console.log(`📧 Found ${expiringAMCs.length} AMC(s) to remind about`);
    
    // 4. Send email
    await sendAMCExpiryEmail(recipients, expiringAMCs);
    
    console.log(`✅ Sent AMC reminder email`);
    return { success: true, count: expiringAMCs.length };
    
  } catch (error) {
    console.error('❌ Error checking AMC reminders:', error);
    return { success: false, message: error.message };
  }
}

// ============================================================
// SEND AMC EXPIRY EMAIL
// ============================================================

async function sendAMCExpiryEmail(recipients, amcs) {
  const amcList = amcs.map(amc => `
    <tr>
      <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${amc.clientName}</td>
      <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${amc.amcName}</td>
      <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${formatDate(amc.endDate)}</td>
      <td style="padding: 8px 12px; border: 1px solid #e2e8f0; text-align: center;">
        <span style="background: #fef3c7; color: #92400e; padding: 2px 10px; border-radius: 12px; font-size: 12px; font-weight: 600;">
          ${amc.daysUntilExpiry} days
        </span>
      </td>
    </tr>
  `).join('');

  const subject = `🔔 AMC Expiry Reminder - ${amcs.length} AMCs expiring soon`;
  
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; margin: 0; padding: 0; background: #f8fafc; }
        .container { max-width: 700px; margin: 0 auto; background: white; padding: 30px; border-radius: 12px; }
        .header { border-bottom: 3px solid #3b82f6; padding-bottom: 16px; margin-bottom: 20px; }
        .header h1 { font-size: 24px; color: #0f172a; margin: 0; }
        .header p { color: #64748b; margin: 4px 0 0; }
        .alert-box { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 12px 16px; border-radius: 8px; margin-bottom: 20px; }
        .alert-box strong { color: #92400e; }
        table { width: 100%; border-collapse: collapse; margin: 16px 0; }
        th { background: #f1f5f9; padding: 10px 12px; text-align: left; font-size: 12px; font-weight: 600; color: #475569; text-transform: uppercase; border: 1px solid #e2e8f0; }
        td { padding: 8px 12px; border: 1px solid #e2e8f0; font-size: 13px; }
        .footer { margin-top: 24px; padding-top: 16px; border-top: 1px solid #e2e8f0; text-align: center; font-size: 12px; color: #94a3b8; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🔔 AMC Expiry Reminder</h1>
          <p>${amcs.length} AMC contracts are expiring soon</p>
        </div>
        
        <div class="alert-box">
          <strong>⚠️ ${amcs.length} AMC(s)</strong> are expiring soon. Please take necessary action.
        </div>
        
        <table>
          <thead>
            <tr>
              <th>Client</th>
              <th>AMC Name</th>
              <th>Expiry Date</th>
              <th>Days Left</th>
            </tr>
          </thead>
          <tbody>
            ${amcList}
          </tbody>
        </table>
        
        <div class="footer">
          <p>This is an automated reminder from <strong>NetCRM</strong>.</p>
          <p>© ${new Date().getFullYear()} Netcom Systems - NetCRM</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const toEmail = recipients.join(', ');
  await sendEmail(toEmail, subject, htmlContent);
}

// ============================================================
// EXPORT
// ============================================================

module.exports = { checkAMCExpiryAndSendReminders };