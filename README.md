# XenStore Backend — Vercel Setup Guide

## What this does
- Listens for Cashfree payment webhooks
- Auto-assigns a license key from your Firestore keys pool
- Saves the order under `orders/` and `users/{uid}/orders/`
- Customer sees key instantly in their dashboard

---

## Step 1 — Push to GitHub
1. Create a NEW repo on GitHub called `xenstore-backend`
2. Upload all these files to it

---

## Step 2 — Deploy on Vercel
1. Go to https://vercel.com → sign in with GitHub
2. Click **"Add New Project"**
3. Import your `xenstore-backend` repo
4. Click **Deploy**

---

## Step 3 — Add Environment Variables
In Vercel → your project → **Settings → Environment Variables**, add these:

| Variable | Value |
|---|---|
| `CASHFREE_SECRET_KEY` | Your Cashfree secret key |
| `FIREBASE_PROJECT_ID` | `xenshop-e6e68` |
| `FIREBASE_CLIENT_EMAIL` | From Firebase service account (see Step 4) |
| `FIREBASE_PRIVATE_KEY` | From Firebase service account (see Step 4) |

---

## Step 4 — Firebase Service Account
1. Go to Firebase Console → Project Settings → **Service Accounts**
2. Click **"Generate new private key"** → download the JSON file
3. Open the JSON — copy these values into Vercel env vars:
   - `project_id` → `FIREBASE_PROJECT_ID`
   - `client_email` → `FIREBASE_CLIENT_EMAIL`
   - `private_key` → `FIREBASE_PRIVATE_KEY` (copy the entire key including `-----BEGIN...`)

---

## Step 5 — Set Webhook URL in Cashfree
1. Go to Cashfree Dashboard → **Developers → Webhooks**
2. Add webhook URL: `https://your-vercel-app.vercel.app/api/webhook`
3. Select event: **PAYMENT_SUCCESS_WEBHOOK**
4. Save

---

## Step 6 — Add License Keys to Firestore
In Firebase Console → Firestore → create collection `keys_pool`

Each document should have:
```
{
  product: "MEMESENSE CS2",
  days: 14,         // must be a number: 14, 31, 90, or 180
  key: "XKEY-XXXX-XXXX-XXXX",
  used: false
}
```

Add as many keys as you have. When a customer pays, the backend picks one, marks it `used: true`, and saves it to their order.

---

## Step 7 — Verify it works
Visit: `https://your-vercel-app.vercel.app/api/health`
You should see: `{ "status": "ok" }`

---

## Firestore Rules (important!)
Make sure your Firestore rules allow the backend to read/write.
The backend uses Firebase Admin SDK so it bypasses rules — no changes needed.

---

## Flow Summary
```
Customer pays on Cashfree
        ↓
Cashfree sends webhook to Vercel
        ↓
Vercel finds user by email
        ↓
Assigns unused key from keys_pool
        ↓
Saves order to Firestore
        ↓
Customer sees key in Dashboard ✅
```
