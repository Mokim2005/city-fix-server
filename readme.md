# CityFix - Server Side (Backend API)

This is the backend server for **CityFix** – a Public Infrastructure Issue Reporting System. The server handles authentication, role-based access control, issue management, payments, timeline tracking, and all CRUD operations.

**Live Client Site URL:** [https://your-live-site-url.com](https://your-live-site-url.com) *(Replace with your actual client URL)*

**API Base URL (Deployed):** `https://your-server-url.vercel.app` *(Replace with your actual server URL, e.g., Vercel/Render link)*

**Admin Credentials** (for testing)  
- Email: `admin@cityfix.com`  
- Password: `admin123` *(Update with your actual admin password)*

## Features Implemented on Server
- **Authentication & Authorization**:
  - Firebase email/password & Google login verification
  - JWT token generation and role-based middleware (admin, staff, citizen)
  - Token verification on private routes
- **User Management**:
  - Registration with user data saved in MongoDB
  - Role assignment (default: citizen)
  - Premium subscription status & blocked status handling
  - Admin can block/unblock citizens
- **Issue Management**:
  - Create, read, update, delete issues
  - Upvote system (one upvote per user per issue, cannot upvote own)
  - Boost issue priority (high/normal)
  - Server-side search by title/description/location
  - Server-side filtering by category, status, priority
  - Pagination support on All Issues endpoint
- **Timeline Tracking**:
  - Automatic timeline entry creation on every major action (report, assign, status change, boost, reject, close)
- **Staff Assignment**:
  - Admin-only endpoint to assign staff to issues (one-time assignment only)
- **Staff Management** (Admin only):
  - Add new staff (creates Firebase auth + MongoDB user with role "staff")
  - Update & delete staff
- **Payment Handling**:
  - Records for issue boost (100৳) and premium subscription (1000৳)
  - Payment verification webhook support (SSLCommerz or Stripe)
- **Role-Based Restrictions**:
  - Strict checks for all endpoints (citizen limits, staff only sees assigned issues, etc.)
- **Environment Variables Protection**:
  - All secrets (MongoDB URI, Firebase config, JWT secret, payment keys) stored in `.env`

## API Endpoints Overview

### Auth Routes
- `POST /api/auth/register` – User registration
- `POST /api/auth/login` – Login (returns JWT)
- `POST /api/auth/google-login` – Google login
- `GET /api/auth/me` – Get current user (protected)

### Issues Routes
- `GET /api/issues` – All issues (with search, filter, pagination)
- `GET /api/issues/my-issues` – Citizen's own issues
- `GET /api/issues/:id` – Single issue details
- `POST /api/issues` – Create new issue (with timeline entry)
- `PATCH /api/issues/:id` – Edit issue (only if pending & own)
- `DELETE /api/issues/:id` – Delete issue (only own)
- `POST /api/issues/:id/upvote` – Upvote issue
- `POST /api/issues/:id/boost` – Boost priority (after payment)

### Admin Routes
- `GET /api/admin/issues` – All issues (admin view)
- `POST /api/admin/assign-staff/:id` – Assign staff
- `PATCH /api/admin/reject/:id` – Reject issue
- `GET /api/admin/users` – All citizens
- `PATCH /api/admin/block/:id` – Block/unblock user
- `POST /api/admin/staff` – Add new staff
- `GET /api/admin/staff` – List all staff
- `PATCH /api/admin/staff/:id` – Update staff
- `DELETE /api/admin/staff/:id` – Delete staff
- `GET /api/admin/payments` – All payments

### Staff Routes
- `GET /api/staff/assigned-issues` – Issues assigned to logged-in staff
- `PATCH /api/staff/status/:id` – Change issue status (adds timeline entry)

### Payment Routes
- `POST /api/payment/create` – Initiate payment (boost or subscription)
- `POST /api/payment/verify` – Webhook verification

## Tech Stack
- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: MongoDB (with Mongoose ODM)
- **Authentication**: Firebase Admin SDK + JWT
- **Validation**: Joi or express-validator
- **CORS & Security**: Helmet, CORS middleware
- **Deployment**: Vercel / Render / Railway

## Environment Variables (.env example)
```env
PORT=5000
MONGODB_URI=mongodb+srv://...
JWT_SECRET=your_strong_secret
FIREBASE_SERVICE_ACCOUNT=./firebase-service-account.json
SSL_COMMERZ_STORE_ID=...
SSL_COMMERZ_STORE_PASSWORD=...
CLIENT_URL=https://your-client-url.com