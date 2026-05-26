// api/webhook.js
// Cashfree will POST to: https://your-vercel-app.vercel.app/api/webhook
// Set this URL in Cashfree Dashboard → Developers → Webhooks

const admin = require('firebase-admin');
const crypto = require('crypto');

// ── Init Firebase Admin (only once) ──
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // Vercel stores private key as a string with literal \n — replace them
      privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

const db = admin.firestore();

// ── Verify Cashfree webhook signature ──
function verifySignature(rawBody, signature, secret) {
  const computed = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('base64');
  return computed === signature;
}

// ── Pull a license key from the keys pool in Firestore ──
async function assignKey(productName, days) {
  const keysRef = db.collection('keys_pool');
  // Find an unused key for this product+plan
  const snap = await keysRef
    .where('product', '==', productName)
    .where('days', '==', Number(days))
    .where('used', '==', false)
    .limit(1)
    .get();

  if (snap.empty) return null;

  const keyDoc = snap.docs[0];
  // Mark key as used
  await keyDoc.ref.update({ used: true, usedAt: new Date().toISOString() });
  return keyDoc.data().key;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // ── Verify signature ──
    const signature = req.headers['x-webhook-signature'];
    const rawBody = JSON.stringify(req.body);
    const secret = process.env.CASHFREE_SECRET_KEY;

    if (signature && secret) {
      const valid = verifySignature(rawBody, signature, secret);
      if (!valid) {
        console.error('[XenStore] Invalid webhook signature');
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const event = req.body;
    console.log('[XenStore] Webhook received:', event?.type);

    // ── Only handle successful payments ──
    if (event?.type !== 'PAYMENT_SUCCESS_WEBHOOK') {
      return res.status(200).json({ message: 'Event ignored' });
    }

    const data = event?.data;
    const order = data?.order;
    const payment = data?.payment;

    if (!order || payment?.payment_status !== 'SUCCESS') {
      return res.status(200).json({ message: 'Payment not successful, ignored' });
    }

    const orderId    = order.order_id;
    const orderNote  = order.order_note || ''; // e.g. "14" (days)
    const customerEmail = data?.customer_details?.customer_email || '';
    const customerPhone = data?.customer_details?.customer_phone || '';
    const amountPaid    = payment?.payment_amount || 0;

    // ── Derive plan from order note or amount ──
    const PLAN_MAP = {
      '450':  { days: 14,  product: 'MEMESENSE CS2' },
      '650':  { days: 31,  product: 'MEMESENSE CS2' },
      '1550': { days: 90,  product: 'MEMESENSE CS2' },
      '2550': { days: 180, product: 'MEMESENSE CS2' },
    };
    const plan = PLAN_MAP[String(Math.round(amountPaid))] || { days: 14, product: 'MEMESENSE CS2' };

    // ── Check if this order was already processed (idempotency) ──
    const existingOrder = await db.collection('orders')
      .where('cashfreeOrderId', '==', orderId)
      .limit(1)
      .get();

    if (!existingOrder.empty) {
      console.log('[XenStore] Order already processed:', orderId);
      return res.status(200).json({ message: 'Already processed' });
    }

    // ── Assign a license key ──
    const licenseKey = await assignKey(plan.product, plan.days);
    if (!licenseKey) {
      console.error('[XenStore] No keys available for plan:', plan);
      // Save order anyway with a placeholder — you can assign key manually later
    }

    const expiry = new Date(Date.now() + plan.days * 86400000)
      .toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

    // ── Find user by email in Firestore ──
    let uid = null;
    if (customerEmail) {
      const userSnap = await db.collection('users')
        .where('email', '==', customerEmail)
        .limit(1)
        .get();
      if (!userSnap.empty) uid = userSnap.docs[0].id;
    }

    const orderData = {
      cashfreeOrderId: orderId,
      uid:             uid,
      email:           customerEmail,
      phone:           customerPhone,
      paymentMethod:   'upi',
      product:         plan.product,
      key:             licenseKey || 'PENDING-MANUAL-ASSIGNMENT',
      plan:            plan.days + ' Days',
      days:            plan.days,
      expires:         expiry,
      status:          licenseKey ? 'active' : 'pending_key',
      inrPrice:        amountPaid,
      paidAt:          new Date().toISOString(),
      paidAtISO:       new Date().toISOString(),
    };

    // ── Save to top-level orders collection ──
    await db.collection('orders').add(orderData);

    // ── Also save under users/{uid}/orders if user found ──
    if (uid) {
      await db.collection('users').doc(uid).collection('orders').add(orderData);
    }

    console.log('[XenStore] Order saved:', orderId, '| Key:', licenseKey || 'PENDING');
    return res.status(200).json({ success: true, key: licenseKey || 'pending' });

  } catch (err) {
    console.error('[XenStore] Webhook error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
