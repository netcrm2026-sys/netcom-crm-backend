// ============================================================
// AMC REMINDER SERVICE - CORRECT VERSION (v14+)
// ============================================================

const { sendEmail } = require('./emailService');

// ============================================================
// FIRESTORE INSTANCE REFERENCE (SET FROM SERVER)
// ============================================================

let dbInstance = null;

function setAdminInstance(database) {
  dbInstance = database;
  console.log('✅ Firestore instance set in amcReminderService');
}

function getFirestore() {
  if (!dbInstance) {
    throw new Error('Firestore not initialized. Call setAdminInstance first.');
  }
  return dbInstance;
}

// ============================================================
// AMC EXPIRY REMINDER SERVICE
// ============================================================

const REMINDER_DAYS = [30, 20, 15, 10, 5, 3, 2, 1, 0];

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
        
       // Calculate days remaining (excluding today)
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
  // Group by days remaining for better organization
  const grouped = {};
  amcs.forEach(amc => {
    const days = amc.daysUntilExpiry;
    if (!grouped[days]) grouped[days] = [];
    grouped[days].push(amc);
  });

  const sortedDays = Object.keys(grouped).sort((a, b) => a - b);
  
  // Build table rows
  let amcList = '';
  sortedDays.forEach(days => {
    const items = grouped[days];
    const daysNum = parseInt(days);
    
    items.forEach(amc => {
      const daysUntilExpiry = amc.daysUntilExpiry;
      
      // Determine urgency based on days
      let urgencyLabel, urgencyColor, urgencyColorBg, urgencyColorText;
      
      if (daysUntilExpiry === 0) {
        urgencyLabel = '🔴 EXPIRES TODAY!';
        urgencyColor = '#dc2626';
        urgencyColorBg = '#fee2e2';
        urgencyColorText = '#dc2626';
      } else if (daysUntilExpiry <= 3) {
        urgencyLabel = '🔴 URGENT';
        urgencyColor = '#dc2626';
        urgencyColorBg = '#fee2e2';
        urgencyColorText = '#dc2626';
      } else if (daysUntilExpiry <= 7) {
        urgencyLabel = '⚠️ Due Soon';
        urgencyColor = '#f59e0b';
        urgencyColorBg = '#fef3c7';
        urgencyColorText = '#92400e';
      } else {
        urgencyLabel = 'ℹ️ Upcoming';
        urgencyColor = '#3b82f6';
        urgencyColorBg = '#dbeafe';
        urgencyColorText = '#1e40af';
      }
      
      amcList += `
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #e2e8f0; font-weight: 500; color: #0f172a;">${amc.clientName}</td>
          <td style="padding: 10px 14px; border: 1px solid #e2e8f0;">${amc.amcName}</td>
          <td style="padding: 10px 14px; border: 1px solid #e2e8f0; color: #1e293b;">${formatDate(amc.endDate)}</td>
          <td style="padding: 10px 14px; border: 1px solid #e2e8f0; text-align: center;">
            <span style="background: ${urgencyColorBg}; color: ${urgencyColorText}; padding: 3px 12px; border-radius: 14px; font-size: 12px; font-weight: 600; display: inline-block;">
              ${daysUntilExpiry === 0 ? 'Today!' : `${daysUntilExpiry} ${daysUntilExpiry === 1 ? 'day' : 'days'}`}
            </span>
            <br>
            <span style="font-size: 10px; color: ${urgencyColor}; font-weight: 600;">
              ${urgencyLabel}
            </span>
          </td>
        </tr>
      `;
    });
  });

  const totalAMCs = amcs.length;
  const urgentCount = amcs.filter(a => a.daysUntilExpiry <= 3).length;
  const expiringToday = amcs.filter(a => a.daysUntilExpiry === 0).length;
  
  const subject = `[NetCRM] AMC Expiry Reminder - ${totalAMCs} AMC${totalAMCs > 1 ? 's' : ''} expiring soon`;
  
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>AMC Expiry Reminder</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
          margin: 0;
          padding: 0;
          background: #f1f5f9;
          color: #0f172a;
        }
        .container {
          max-width: 680px;
          margin: 20px auto;
          background: #ffffff;
          padding: 32px;
          border-radius: 16px;
          box-shadow: 0 4px 24px rgba(0,0,0,0.06);
        }
        .header {
          border-bottom: 4px solid #3b82f6;
          padding-bottom: 20px;
          margin-bottom: 24px;
        }
        .header h1 {
          font-size: 26px;
          font-weight: 700;
          color: #0f172a;
          margin: 0;
        }
        .header h1 span {
          color: #3b82f6;
        }
        .header .subtitle {
          color: #64748b;
          font-size: 14px;
          margin: 6px 0 0;
        }
        .summary-box {
          background: #f8fafc;
          border-radius: 12px;
          padding: 16px 20px;
          margin-bottom: 24px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          border: 1px solid #e2e8f0;
        }
        .summary-box .stat {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .summary-box .stat .number {
          font-size: 20px;
          font-weight: 700;
        }
        .summary-box .stat .label {
          color: #64748b;
          font-size: 13px;
        }
        .summary-box .stat.urgent .number {
          color: #dc2626;
        }
        .summary-box .stat.today .number {
          color: #dc2626;
        }
        .alert-box {
          background: #fef3c7;
          border-left: 4px solid #f59e0b;
          padding: 14px 18px;
          border-radius: 8px;
          margin-bottom: 24px;
          font-size: 14px;
        }
        .alert-box strong {
          color: #92400e;
        }
        .alert-box.urgent-alert {
          background: #fee2e2;
          border-left-color: #dc2626;
        }
        .alert-box.urgent-alert strong {
          color: #991b1b;
        }
        .alert-box.today-alert {
          background: #fef2f2;
          border-left-color: #dc2626;
        }
        .alert-box.today-alert strong {
          color: #dc2626;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin: 16px 0;
          font-size: 13px;
        }
        th {
          background: #f1f5f9;
          padding: 10px 14px;
          text-align: left;
          font-weight: 600;
          color: #475569;
          text-transform: uppercase;
          font-size: 11px;
          letter-spacing: 0.05em;
          border: 1px solid #e2e8f0;
        }
        td {
          padding: 10px 14px;
          border: 1px solid #e2e8f0;
          vertical-align: middle;
        }
        .footer {
          margin-top: 28px;
          padding-top: 20px;
          border-top: 1px solid #e2e8f0;
          text-align: center;
          font-size: 12px;
          color: #94a3b8;
        }
        .footer .brand {
          font-weight: 600;
          color: #0f172a;
        }
        .footer .meta {
          margin-top: 4px;
          font-size: 11px;
        }
        @media (max-width: 480px) {
          .container { padding: 20px; }
          .summary-box { flex-direction: column; gap: 8px; align-items: stretch; }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🔔 <span>AMC Expiry</span> Reminder</h1>
          <div class="subtitle">${totalAMCs} AMC contract${totalAMCs > 1 ? 's are' : ' is'} expiring soon</div>
        </div>

        <div class="summary-box">
          <div class="stat">
            <span class="number">${totalAMCs}</span>
            <span class="label">Total AMC${totalAMCs > 1 ? 's' : ''}</span>
          </div>
          ${expiringToday > 0 ? `
            <div class="stat today">
              <span class="number">${expiringToday}</span>
              <span class="label">Expiring Today!</span>
            </div>
          ` : ''}
          <div class="stat urgent">
            <span class="number">${urgentCount}</span>
            <span class="label">Expiring within 3 days</span>
          </div>
          <div class="stat">
            <span class="number">${amcs.length - urgentCount}</span>
            <span class="label">Expiring within 30 days</span>
          </div>
        </div>

        ${expiringToday > 0 ? `
          <div class="alert-box today-alert">
            <strong>🚨 ${expiringToday} AMC${expiringToday > 1 ? 's' : ''}</strong> is expiring TODAY! Immediate action required!
          </div>
        ` : urgentCount > 0 ? `
          <div class="alert-box urgent-alert">
            <strong>⚠️ ${urgentCount} AMC${urgentCount > 1 ? 's' : ''}</strong> are expiring within 3 days. Immediate action required!
          </div>
        ` : `
          <div class="alert-box">
            <strong>⚠️ ${totalAMCs} AMC${totalAMCs > 1 ? 's are' : ' is'}</strong> expiring soon. Please take necessary action.
          </div>
        `}

        <table>
          <thead>
            <tr>
              <th>Client</th>
              <th>AMC Name</th>
              <th>Expiry Date</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${amcList}
          </tbody>
        </table>

        <div class="footer">
          <div>This is an automated reminder from <span class="brand">NetCRM</span></div>
          <div class="meta">© ${new Date().getFullYear()} Netcom Systems - NetCRM</div>
          <div class="meta" style="color: #cbd5e1; font-size: 10px;">This is an automated message, please do not reply.</div>
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

module.exports = { 
  checkAMCExpiryAndSendReminders,
  setAdminInstance
};