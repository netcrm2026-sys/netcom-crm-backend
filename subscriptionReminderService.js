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
  if (!targetDate) return null;
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
      This is a summary of subscription/license status that requires your attention:
    </div>
  `;
}

// ============================================================
// SUBSCRIPTION PAYMENT REMINDER SERVICE
// ============================================================

// REMINDER DAYS FOR EXPIRY
const SUBSCRIPTION_REMINDER_DAYS = [30, 20, 15, 10, 5, 3, 2, 1, 0];

// REMINDER DAYS FOR PAYMENT DUE
const PAYMENT_REMINDER_DAYS = [10, 5, 3, 2, 1, 0];

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
    
    // 3. Find expiring subscriptions and pending payments
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const expiringSubscriptions = [];
    const pendingPaymentSubscriptions = [];
    
    clients.forEach(client => {
      const payments = client.payments || [];
      payments.forEach(payment => {
        // Skip one-time payments for expiry reminders, but include them for pending payments
        const isOneTime = payment.billingType === 'one-time' || payment.billingType === 'One-Time';
        
        // ========== SECTION 1: CHECK EXPIRY (endDate) - FOR ALL SUBSCRIPTIONS ==========
        if (payment.endDate) {
          const daysUntilExpiry = calculateDaysUntil(payment.endDate);
          
          // Check if expiring in reminder days (including today)
          if (daysUntilExpiry !== null && daysUntilExpiry >= 0 && SUBSCRIPTION_REMINDER_DAYS.includes(daysUntilExpiry)) {
            const endDateObj = new Date(payment.endDate);
            endDateObj.setHours(0, 0, 0, 0);
            
            if (endDateObj >= today) {
              expiringSubscriptions.push({
                clientName: client.name || 'Unknown Client',
                serviceName: payment.productService || 'Unnamed Service',
                endDate: payment.endDate,
                daysUntilExpiry: daysUntilExpiry,
                amount: payment.periodAmount || payment.contractValue || 0,
                billingType: payment.billingType || 'monthly',
                invoiceNumber: payment.invoiceNumber || 'N/A',
                status: payment.currentPeriodPaid ? '✅ Paid' : '❌ Unpaid',
                isOneTime: isOneTime,
              });
            }
          }
        }
        
        // ========== SECTION 2: CHECK PENDING PAYMENTS (ONLY FOR NON-ONE-TIME) ==========
        if (!isOneTime) {
          let isPending = false;
          let pendingData = null;
          
          // CASE 1: First payment pending
          if (payment.firstPaymentPending === true) {
            isPending = true;
            pendingData = {
              clientName: client.name || 'Unknown Client',
              serviceName: payment.productService || 'Unnamed Service',
              dueDate: payment.startDate || '—',
              amount: payment.periodAmount || payment.contractValue || 0,
              billingType: payment.billingType || 'monthly',
              invoiceNumber: payment.invoiceNumber || 'N/A',
              status: '⏳ First Payment Pending',
              isFirstPayment: true,
              daysUntilDue: null,
              priority: 0, // Highest priority
            };
          }
          
          // CASE 2: Not paid and has next billing date
          else if (payment.currentPeriodPaid === false && payment.nextBillingDate) {
            const daysUntilDue = calculateDaysUntil(payment.nextBillingDate);
            
            // Include if within reminder days OR overdue
            if (daysUntilDue !== null && (PAYMENT_REMINDER_DAYS.includes(daysUntilDue) || daysUntilDue < 0)) {
              const isOverdue = daysUntilDue < 0;
              isPending = true;
              pendingData = {
                clientName: client.name || 'Unknown Client',
                serviceName: payment.productService || 'Unnamed Service',
                dueDate: payment.nextBillingDate,
                daysUntilDue: daysUntilDue,
                amount: payment.periodAmount || payment.contractValue || 0,
                billingType: payment.billingType || 'monthly',
                invoiceNumber: payment.invoiceNumber || 'N/A',
                status: isOverdue ? '🔴 Overdue' : '⚠️ Due Soon',
                isFirstPayment: false,
                priority: isOverdue ? 1 : 2, // Overdue first, then due soon
              };
            }
          }
          
          // CASE 3: Check if payment is overdue even if currentPeriodPaid is true (edge case)
          // This catches cases where payment was marked paid but due date passed without new payment
          if (!isPending && payment.nextBillingDate && payment.currentPeriodPaid === true) {
            const daysUntilDue = calculateDaysUntil(payment.nextBillingDate);
            
            // If next billing date has passed but it's marked as paid (shouldn't happen, but just in case)
            if (daysUntilDue !== null && daysUntilDue < 0) {
              isPending = true;
              pendingData = {
                clientName: client.name || 'Unknown Client',
                serviceName: payment.productService || 'Unnamed Service',
                dueDate: payment.nextBillingDate,
                daysUntilDue: daysUntilDue,
                amount: payment.periodAmount || payment.contractValue || 0,
                billingType: payment.billingType || 'monthly',
                invoiceNumber: payment.invoiceNumber || 'N/A',
                status: '🔴 Overdue (Payment needed)',
                isFirstPayment: false,
                priority: 1, // Overdue
              };
            }
          }
          
          if (isPending && pendingData) {
            pendingPaymentSubscriptions.push(pendingData);
          }
        }
      });
    });
    
    // Sort pending payments: Overdue first, then due soon, then first payment pending
    pendingPaymentSubscriptions.sort((a, b) => {
      // Priority: 0 = First Payment, 1 = Overdue, 2 = Due Soon
      return (a.priority || 0) - (b.priority || 0);
    });
    
    // Combine both lists
    const hasExpiring = expiringSubscriptions.length > 0;
    const hasPending = pendingPaymentSubscriptions.length > 0;
    
    if (!hasExpiring && !hasPending) {
      console.log('✅ No expiring subscriptions or pending payments today.');
      console.log(`📊 Stats: ${expiringSubscriptions.length} expiring, ${pendingPaymentSubscriptions.length} pending payments`);
      return { success: true, message: 'No subscriptions to remind about' };
    }
    
    console.log(`📧 Found ${expiringSubscriptions.length} expiring + ${pendingPaymentSubscriptions.length} pending payment(s)`);
    
    // Log pending payments for debugging
    if (pendingPaymentSubscriptions.length > 0) {
      console.log('📋 Pending payments found:');
      pendingPaymentSubscriptions.forEach(p => {
        console.log(`  - ${p.clientName}: ${p.serviceName} (${p.status})`);
      });
    }
    
    // 4. Send email with both sections
    await sendSubscriptionReminderEmail(recipients, expiringSubscriptions, pendingPaymentSubscriptions, db);
    
    console.log(`✅ Sent subscription reminder email`);
    return { success: true, count: expiringSubscriptions.length + pendingPaymentSubscriptions.length };
    
  } catch (error) {
    console.error('❌ Error checking subscription reminders:', error);
    return { success: false, message: error.message };
  }
}

// ============================================================
// SEND SUBSCRIPTION REMINDER EMAIL
// ============================================================

async function sendSubscriptionReminderEmail(recipients, expiringSubscriptions, pendingSubscriptions, db) {
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

  // ========== SECTION 1: EXPIRING SUBSCRIPTIONS TABLE ==========
  let expiringTable = '';
  if (expiringSubscriptions.length > 0) {
    // Sort by days remaining (urgent first)
    expiringSubscriptions.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);
    
    expiringTable = expiringSubscriptions.map(sub => {
      const days = sub.daysUntilExpiry;
      const isUrgent = days <= 3;
      const isToday = days === 0;
      
      let urgencyLabel, bgColor, textColor;
      if (isToday) {
        urgencyLabel = '🔴 EXPIRES TODAY!';
        bgColor = '#fee2e2';
        textColor = '#dc2626';
      } else if (isUrgent) {
        urgencyLabel = '🔴 URGENT';
        bgColor = '#fef3c7';
        textColor = '#92400e';
      } else {
        urgencyLabel = 'ℹ️ Upcoming';
        bgColor = '#dbeafe';
        textColor = '#1e40af';
      }
      
      return `
        <tr>
          <td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: 500;">${sub.clientName}</td>
          <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${sub.serviceName}</td>
          <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${formatDate(sub.endDate)}</td>
          <td style="padding: 8px 12px; border: 1px solid #e2e8f0; text-align: center;">
            <span style="background: ${bgColor}; color: ${textColor}; padding: 2px 10px; border-radius: 12px; font-size: 12px; font-weight: 600;">
              ${isToday ? 'Today!' : `${days} days`}
            </span>
            <br>
            <span style="font-size: 10px; color: ${textColor}; font-weight: 600;">${urgencyLabel}</span>
          </td>
          <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">₹${sub.amount.toLocaleString('en-IN')}</td>
          <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${sub.billingType}</td>
          <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">
            <span style="color: ${sub.status === '✅ Paid' ? '#16a34a' : '#dc2626'}; font-weight: 500;">
              ${sub.status}
            </span>
          </td>
        </tr>
      `;
    }).join('');
  }

  // ========== SECTION 2: PENDING PAYMENTS TABLE ==========
  let pendingTable = '';
  if (pendingSubscriptions.length > 0) {
    // Sort: Overdue first, then due soon
    pendingSubscriptions.sort((a, b) => {
      if (a.isFirstPayment && !b.isFirstPayment) return 1;
      if (!a.isFirstPayment && b.isFirstPayment) return -1;
      if (a.daysUntilDue === null) return 1;
      if (b.daysUntilDue === null) return -1;
      return a.daysUntilDue - b.daysUntilDue;
    });
    
    pendingTable = pendingSubscriptions.map(sub => {
      const days = sub.daysUntilDue;
      let urgencyLabel, bgColor, textColor, urgencyEmoji;
      
      if (sub.isFirstPayment) {
        urgencyEmoji = '⏳';
        urgencyLabel = 'First Payment Pending';
        bgColor = '#fef3c7';
        textColor = '#92400e';
      } else if (days < 0) {
        urgencyEmoji = '🔴';
        urgencyLabel = `Overdue by ${Math.abs(days)} days`;
        bgColor = '#fee2e2';
        textColor = '#dc2626';
      } else if (days === 0) {
        urgencyEmoji = '🔴';
        urgencyLabel = 'Due Today!';
        bgColor = '#fee2e2';
        textColor = '#dc2626';
      } else if (days <= 3) {
        urgencyEmoji = '⚠️';
        urgencyLabel = 'Due in ' + days + ' days';
        bgColor = '#fef3c7';
        textColor = '#92400e';
      } else {
        urgencyEmoji = 'ℹ️';
        urgencyLabel = 'Due in ' + days + ' days';
        bgColor = '#dbeafe';
        textColor = '#1e40af';
      }
      
      const dueDisplay = sub.isFirstPayment ? '1st Payment Pending' : formatDate(sub.dueDate);
      const daysDisplay = sub.isFirstPayment ? '—' : (days < 0 ? `${Math.abs(days)} overdue` : `${days} days`);
      
      return `
        <tr>
          <td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: 500;">${sub.clientName}</td>
          <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${sub.serviceName}</td>
          <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${dueDisplay}</td>
          <td style="padding: 8px 12px; border: 1px solid #e2e8f0; text-align: center;">
            <span style="background: ${bgColor}; color: ${textColor}; padding: 2px 10px; border-radius: 12px; font-size: 12px; font-weight: 600;">
              ${daysDisplay}
            </span>
            <br>
            <span style="font-size: 10px; color: ${textColor}; font-weight: 600;">${urgencyEmoji} ${urgencyLabel}</span>
          </td>
          <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">₹${sub.amount.toLocaleString('en-IN')}</td>
          <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${sub.billingType}</td>
          <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${sub.invoiceNumber}</td>
        </tr>
      `;
    }).join('');
  }

  const totalExpiring = expiringSubscriptions.length;
  const totalPending = pendingSubscriptions.length;
  const urgentExpiring = expiringSubscriptions.filter(s => s.daysUntilExpiry <= 3).length;
  const urgentPending = pendingSubscriptions.filter(s => {
    if (s.isFirstPayment) return true;
    return s.daysUntilDue !== null && s.daysUntilDue <= 3;
  }).length;
  
  // Count overdue payments specifically
  const overdueCount = pendingSubscriptions.filter(s => {
    if (s.isFirstPayment) return false;
    return s.daysUntilDue !== null && s.daysUntilDue < 0;
  }).length;
  
  const subject = `[NetCRM] Subscription Status Summary - ${totalExpiring + totalPending} item(s) need attention`;

  // ========== BUILD FULL HTML ==========
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Subscription Status Summary</title>
      <style>
        body { 
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; 
          margin: 0; 
          padding: 0; 
          background: #f1f5f9; 
          color: #0f172a; 
        }
        .container { 
          max-width: 800px; 
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
        .section-title {
          font-size: 18px;
          font-weight: 600;
          color: #0f172a;
          margin: 24px 0 12px 0;
          padding: 8px 12px;
          background: #f1f5f9;
          border-radius: 8px;
          border-left: 4px solid #8b5cf6;
        }
        .section-title .badge {
          font-size: 12px;
          font-weight: 500;
          background: #8b5cf6;
          color: white;
          padding: 2px 10px;
          border-radius: 12px;
          margin-left: 8px;
        }
        .section-title .badge.overdue-badge {
          background: #dc2626;
        }
        table { 
          width: 100%; 
          border-collapse: collapse; 
          margin: 12px 0; 
          font-size: 13px; 
        }
        th { 
          background: #f1f5f9; 
          padding: 8px 12px; 
          text-align: left; 
          font-weight: 600; 
          color: #475569; 
          text-transform: uppercase; 
          font-size: 10px; 
          letter-spacing: 0.05em; 
          border: 1px solid #e2e8f0; 
        }
        td { 
          padding: 8px 12px; 
          border: 1px solid #e2e8f0; 
          vertical-align: middle; 
        }
        .empty-msg {
          padding: 20px;
          text-align: center;
          color: #94a3b8;
          font-size: 14px;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          background: #f8fafc;
        }
        .alert-box { 
          background: #fef3c7; 
          border-left: 4px solid #f59e0b; 
          padding: 14px 18px; 
          border-radius: 8px; 
          margin: 16px 0; 
          font-size: 14px; 
        }
        .alert-box strong { color: #92400e; }
        .alert-box.urgent-alert { 
          background: #fee2e2; 
          border-left-color: #dc2626; 
        }
        .alert-box.urgent-alert strong { color: #991b1b; }
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
        @media (max-width: 600px) { 
          .container { padding: 16px; } 
          .summary-box { flex-direction: column; gap: 8px; align-items: stretch; }
          table { font-size: 11px; }
          th, td { padding: 6px 8px; }
        }
        .overdue-highlight {
          background: #fee2e2 !important;
        }
        .due-soon-highlight {
          background: #fef3c7 !important;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>📊 <span>Subscription/License</span> Status Summary</h1>
          <div class="subtitle">${totalExpiring + totalPending} item(s) require attention</div>
        </div>

        ${generateGreeting(employeeName)}

        <div class="summary-box">
          <div class="stat">
            <span class="number">${totalExpiring + totalPending}</span>
            <span class="label">Total Items</span>
          </div>
          <div class="stat">
            <span class="number">${totalExpiring}</span>
            <span class="label">Expiring Soon</span>
          </div>
          <div class="stat urgent">
            <span class="number">${totalPending}</span>
            <span class="label">Pending Payments</span>
          </div>
          ${overdueCount > 0 ? `
            <div class="stat urgent">
              <span class="number" style="color: #dc2626;">${overdueCount}</span>
              <span class="label" style="color: #dc2626;">Overdue!</span>
            </div>
          ` : ''}
        </div>

        ${(urgentExpiring > 0 || urgentPending > 0 || overdueCount > 0) ? `
          <div class="alert-box urgent-alert">
            <strong>⚠️ ${urgentExpiring + urgentPending + overdueCount} urgent item(s)</strong> require immediate attention!
            ${overdueCount > 0 ? ` 🔴 ${overdueCount} of these are OVERDUE!` : ''}
          </div>
        ` : `
          <div class="alert-box">
            <strong>ℹ️ ${totalExpiring + totalPending} item(s)</strong> require attention. Please review and take necessary action.
          </div>
        `}

        <!-- ===== SECTION 1: EXPIRING SUBSCRIPTIONS ===== -->
        ${expiringSubscriptions.length > 0 ? `
          <div class="section-title">
            🔔 Subscriptions Expiring Soon <span class="badge">${totalExpiring}</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Client</th>
                <th>Service</th>
                <th>Expiry Date</th>
                <th>Status</th>
                <th>Amount</th>
                <th>Billing Type</th>
                <th>Payment</th>
              </tr>
            </thead>
            <tbody>
              ${expiringTable}
            </tbody>
          </table>
        ` : `
          <div class="section-title">🔔 Subscriptions Expiring Soon <span class="badge">0</span></div>
          <div class="empty-msg">✅ No subscriptions expiring soon</div>
        `}

        <!-- ===== SECTION 2: PENDING PAYMENTS ===== -->
        ${pendingSubscriptions.length > 0 ? `
          <div class="section-title">
            💳 Pending Payments <span class="badge ${overdueCount > 0 ? 'overdue-badge' : ''}">${totalPending}</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Client</th>
                <th>Service</th>
                <th>Due Date</th>
                <th>Status</th>
                <th>Amount</th>
                <th>Billing Type</th>
                <th>Invoice #</th>
              </tr>
            </thead>
            <tbody>
              ${pendingTable}
            </tbody>
          </table>
        ` : `
          <div class="section-title">💳 Pending Payments <span class="badge">0</span></div>
          <div class="empty-msg">✅ All payments are up to date</div>
        `}

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