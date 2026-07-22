// ============================================================
// SUBSCRIPTION PAYMENT REMINDER SERVICE
// FULLY SELF-CONTAINED - No shared utils
// ============================================================

const { sendEmail } = require('./emailService');

// ============================================================
// FIRESTORE INSTANCE REFERENCE
// ============================================================

let dbInstance = null;

function setAdminInstance(database) {
  dbInstance = database;
  console.log('✅ Firestore instance set in subscriptionReminderService');
}

function getFirestore() {
  if (!dbInstance) {
    throw new Error('Firestore not initialized. Call setAdminInstance first.');
  }
  return dbInstance;
}

// ============================================================
// UTILITY FUNCTIONS (Self-contained)
// ============================================================

function formatDate(dateString) {
  if (!dateString) return '—';
  const date = new Date(dateString);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}-${month}-${year}`;
}

function calculateDaysUntil(targetDate) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const date = new Date(targetDate);
  date.setHours(0, 0, 0, 0);
  
  return Math.ceil((date - today) / (1000 * 60 * 60 * 24));
}

function generateGreeting(employeeName = 'Team') {
  return `
    <div style="font-size: 16px; color: #1e293b; margin-bottom: 16px; padding: 12px 16px; background: #f8fafc; border-radius: 8px;">
      Dear ${employeeName},<br><br>
      This is a reminder for the following subscription payments that are due soon:
    </div>
  `;
}

// ============================================================
// SUBSCRIPTION PAYMENT REMINDER SERVICE
// ============================================================

const SUBSCRIPTION_REMINDER_DAYS = [10, 5, 3, 2, 1, 0];

async function checkSubscriptionAndSendReminders() {
  console.log('🔍 Checking subscription payment reminders...');
  
  try {
    const db = getFirestore();
    
    // 1. Get all clients
    const clientsSnapshot = await db.collection('clients').get();
    const clients = clientsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));
    
    console.log(`📋 Found ${clients.length} clients`);
    
    // 2. Get email recipients
    const settingsDoc = await db.doc('settings/emailNotifications').get();
    let recipients = [];
    
    if (settingsDoc.exists) {
      const data = settingsDoc.data();
      recipients = data.subscriptionReminderRecipients || [];
    }
    
    if (recipients.length === 0) {
      console.log('⚠️ No recipients configured for subscription reminders');
      return { success: false, message: 'No recipients configured' };
    }
    
    console.log(`👤 Found ${recipients.length} recipient(s)`);
    
    // 3. Find upcoming payment due subscriptions
    const expiringSubscriptions = [];
    
    clients.forEach(client => {
      const payments = client.payments || [];
      payments.forEach(payment => {
        // Skip if no next billing date
        if (!payment.nextBillingDate) return;
        
        // Skip one-time payments
        if (payment.billingType === 'one-time' || payment.billingType === 'One-Time') return;
        
        // Skip if first payment is pending
        if (payment.firstPaymentPending) return;
        
        // Skip if current period is already paid
        if (payment.currentPeriodPaid) return;
        
        const daysUntilDue = calculateDaysUntil(payment.nextBillingDate);
        
        if (SUBSCRIPTION_REMINDER_DAYS.includes(daysUntilDue) && daysUntilDue >= 0) {
          expiringSubscriptions.push({
            clientName: client.name || 'Unknown Client',
            serviceName: payment.productService || 'Unnamed Service',
            dueDate: payment.nextBillingDate,
            daysUntilDue: daysUntilDue,
            amount: payment.periodAmount || 0,
            billingType: payment.billingType || 'monthly',
          });
        }
      });
    });
    
    if (expiringSubscriptions.length === 0) {
      console.log('✅ No subscriptions due for reminder today.');
      return { success: true, message: 'No subscriptions to remind about' };
    }
    
    console.log(`📧 Found ${expiringSubscriptions.length} subscription(s) to remind about`);
    
    // 4. Send email
    await sendSubscriptionReminderEmail(recipients, expiringSubscriptions, db);
    
    console.log(`✅ Sent subscription reminder email`);
    return { success: true, count: expiringSubscriptions.length };
    
  } catch (error) {
    console.error('❌ Error checking subscription reminders:', error);
    return { success: false, message: error.message };
  }
}

// ============================================================
// SEND SUBSCRIPTION REMINDER EMAIL
// ============================================================

async function sendSubscriptionReminderEmail(recipients, subscriptions, db) {
  // Get employee name for personalized greeting
  let employeeName = 'Team';
  try {
    if (recipients.length > 0) {
      const firstEmail = recipients[0];
      const employeesSnapshot = await db.collection('employees')
        .where('email', '==', firstEmail)
        .limit(1)
        .get();
      
      if (!employeesSnapshot.empty) {
        const empData = employeesSnapshot.docs[0].data();
        employeeName = empData.name || 'Team';
      }
    }
  } catch (error) {
    console.warn('Could not fetch employee name, using default greeting');
  }

  // Build subscription table rows
  const subList = subscriptions.map(sub => `
    <tr>
      <td style="padding: 10px 14px; border: 1px solid #e2e8f0; font-weight: 500; color: #0f172a;">${sub.clientName}</td>
      <td style="padding: 10px 14px; border: 1px solid #e2e8f0;">${sub.serviceName}</td>
      <td style="padding: 10px 14px; border: 1px solid #e2e8f0;">${formatDate(sub.dueDate)}</td>
      <td style="padding: 10px 14px; border: 1px solid #e2e8f0;">₹${sub.amount.toLocaleString('en-IN')}</td>
      <td style="padding: 10px 14px; border: 1px solid #e2e8f0; text-align: center;">
        <span style="background: ${sub.daysUntilDue <= 3 ? '#fee2e2' : '#fef3c7'}; color: ${sub.daysUntilDue <= 3 ? '#dc2626' : '#92400e'}; padding: 3px 12px; border-radius: 14px; font-size: 12px; font-weight: 600; display: inline-block;">
          ${sub.daysUntilDue === 0 ? 'Due Today!' : `${sub.daysUntilDue} days`}
        </span>
      </td>
    </tr>
  `).join('');

  const totalSubs = subscriptions.length;
  const urgentCount = subscriptions.filter(s => s.daysUntilDue <= 3).length;
  const dueToday = subscriptions.filter(s => s.daysUntilDue === 0).length;
  
  const subject = `[NetCRM] Subscription Payment Reminder - ${totalSubs} payment${totalSubs > 1 ? 's' : ''} due soon`;
  
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Subscription Payment Reminder</title>
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
          border-bottom: 4px solid #8b5cf6; 
          padding-bottom: 20px; 
          margin-bottom: 24px; 
        }
        .header h1 { 
          font-size: 26px; 
          font-weight: 700; 
          color: #0f172a; 
          margin: 0; 
        }
        .header h1 span { color: #8b5cf6; }
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
        .summary-box .stat.urgent .number { color: #dc2626; }
        .summary-box .stat.today .number { color: #dc2626; }
        .alert-box { 
          background: #fef3c7; 
          border-left: 4px solid #f59e0b; 
          padding: 14px 18px; 
          border-radius: 8px; 
          margin-bottom: 24px; 
          font-size: 14px; 
        }
        .alert-box strong { color: #92400e; }
        .alert-box.urgent-alert { 
          background: #fee2e2; 
          border-left-color: #dc2626; 
        }
        .alert-box.urgent-alert strong { color: #991b1b; }
        .alert-box.today-alert { 
          background: #fef2f2; 
          border-left-color: #dc2626; 
        }
        .alert-box.today-alert strong { color: #dc2626; }
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
        .footer .brand { font-weight: 600; color: #0f172a; }
        .footer .meta { margin-top: 4px; font-size: 11px; }
        @media (max-width: 480px) { 
          .container { padding: 20px; } 
          .summary-box { flex-direction: column; gap: 8px; align-items: stretch; } 
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>💳 <span>Subscription Payment</span> Reminder</h1>
          <div class="subtitle">${totalSubs} payment${totalSubs > 1 ? 's are' : ' is'} due soon</div>
        </div>

        <!-- PERSONALIZED GREETING -->
        ${generateGreeting(employeeName)}

        <div class="summary-box">
          <div class="stat">
            <span class="number">${totalSubs}</span>
            <span class="label">Total Payment${totalSubs > 1 ? 's' : ''}</span>
          </div>
          ${dueToday > 0 ? `
            <div class="stat today">
              <span class="number">${dueToday}</span>
              <span class="label">Due Today!</span>
            </div>
          ` : ''}
          <div class="stat urgent">
            <span class="number">${urgentCount}</span>
            <span class="label">Due within 3 days</span>
          </div>
        </div>

        ${dueToday > 0 ? `
          <div class="alert-box today-alert">
            <strong>🚨 ${dueToday} payment${dueToday > 1 ? 's' : ''}</strong> is due TODAY! Immediate action required!
          </div>
        ` : urgentCount > 0 ? `
          <div class="alert-box urgent-alert">
            <strong>⚠️ ${urgentCount} payment${urgentCount > 1 ? 's' : ''}</strong> are due within 3 days. Immediate action required!
          </div>
        ` : `
          <div class="alert-box">
            <strong>⚠️ ${totalSubs} payment${totalSubs > 1 ? 's are' : ' is'}</strong> due soon. Please take necessary action.
          </div>
        `}

        <table>
          <thead>
            <tr>
              <th>Client</th>
              <th>Service</th>
              <th>Due Date</th>
              <th>Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${subList}
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
  checkSubscriptionAndSendReminders,
  setAdminInstance
};