const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const admin = require("firebase-admin");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const serviceAccount = require("./city-fix-firebase-adminsdk-fbsvc-822010d878.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const port = process.env.PORT || 5000;

const stripe = require("stripe")(process.env.STRIPE_SECRET);

// middleware
app.use(express.json());
app.use(cors());

const verifyFBToken = async (req, res, next) => {
  const authHeader = req.headers.authorization || req.headers.Authorization;

  console.log("Raw Authorization header:", authHeader); // ডিবাগ

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res
      .status(401)
      .json({ message: "No token provided or invalid format" });
  }

  const idToken = authHeader.split("Bearer ")[1].trim(); // trim দিয়ে extra space সরাও

  console.log(
    "Extracted token (first 30 chars):",
    idToken.substring(0, 30) + "..."
  );

  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    console.log("✅ Token verified:", decoded.uid, decoded.email);

    // এখানে দুইটা জিনিস সেট করো
    req.decoded_email = decoded.email; // verifyAdmin/verifyStaff এর জন্য
    req.user = decoded; // অন্যান্য কাজের জন্য (optional)

    next();
  } catch (error) {
    console.error("❌ Token verification failed:", error.code, error.message);
    return res.status(401).json({
      message: "Invalid or expired token",
      error: error.message,
    });
  }
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ekpzegp.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // await client.connect();

    const db = client.db("city-fix-db");

    // IMPORTANT: issus = citizen collection
    const reportCollection = db.collection("issus");

    // users collection
    const userCollection = db.collection("users");
    const subscribeCollection = db.collection("subscribe");

    //middl admin before allowing admin activity
    //must be used verifyFBToken middleware
    // Admin Verification
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded_email;
      if (!email) {
        return res.status(401).send({ message: "Unauthorized" });
      }

      const user = await userCollection.findOne({ email });
      if (user?.role !== "admin") {
        return res
          .status(403)
          .send({ message: "Forbidden: Admin access required" });
      }
      next();
    };

    // Staff Verification
    const verifyStaff = async (req, res, next) => {
      const email = req.decoded_email;
      if (!email) {
        return res.status(401).send({ message: "Unauthorized" });
      }

      const user = await userCollection.findOne({ email });
      if (user?.role !== "staff") {
        return res
          .status(403)
          .send({ message: "Forbidden: Staff access required" });
      }
      next();
    };
    // -----------------------
    // issus (ISSUES) API
    // -----------------------

    // Get all reports (or by email)
    app.get("/issus", async (req, res) => {
      const query = {};
      const { email } = req.query;
      if (email) query.email = email;

      const cursor = reportCollection.find(query).sort({
        priority: -1,
        createdAt: -1,
      });

      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/issus/:id", async (req, res) => {
      const id = req.params.id;
      console.log("this is id", id);
      const issue = await reportCollection.findOne({ _id: new ObjectId(id) });
      res.send(issue);
    });

    // Delete report
    app.delete("/issus/:id", async (req, res) => {
      const id = req.params.id;
      const result = await reportCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    app.patch("/issus/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const updateData = req.body;

        const issue = await reportCollection.findOne({ _id: new ObjectId(id) });
        if (!issue) {
          return res
            .status(404)
            .send({ success: false, message: "Issue not found" });
        }

        if (issue.status !== "pending") {
          return res.status(400).send({
            success: false,
            message: "Only pending issues can be edited",
          });
        }

        const result = await reportCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateData }
        );

        res.send({ success: true, message: "Issue updated successfully" });
      } catch (error) {
        console.error(error);
        res.status(500).send({ success: false, message: "Server Error" });
      }
    });

    // User Profile Update (for all roles: user, staff, admin) - FIXED
    app.patch("/users/profile", verifyFBToken, async (req, res) => {
      const email = req.decoded_email;
      const { displayName, photoURL } = req.body;

      // কোনোটাই না থাকলে error
      if (!displayName && !photoURL) {
        return res
          .status(400)
          .json({ success: false, message: "Nothing to update" });
      }

      const updateFields = {};
      if (displayName !== undefined)
        updateFields.displayName = displayName?.trim();
      if (photoURL !== undefined) updateFields.photoURL = photoURL;

      try {
        // MongoDB update
        const result = await userCollection.updateOne(
          { email },
          { $set: updateFields }
        );

        if (result.matchedCount === 0) {
          return res
            .status(404)
            .json({ success: false, message: "User not found" });
        }

        // Firebase Auth sync - শুধু যেটা পাঠানো হয়েছে সেটা update করুন
        const userRecord = await admin.auth().getUserByEmail(email);

        const fbUpdate = {};
        if (displayName !== undefined)
          fbUpdate.displayName = displayName?.trim() || userRecord.displayName;
        if (photoURL !== undefined)
          fbUpdate.photoURL = photoURL || userRecord.photoURL;

        await admin.auth().updateUser(userRecord.uid, fbUpdate);

        res.json({ success: true, message: "Profile updated successfully" });
      } catch (error) {
        console.error("Profile update error:", error);
        res.status(500).json({ success: false, message: "Server error" });
      }
    });l

    // Create new report
    app.post("/issus", async (req, res) => {
      const { title, description, image, category, location, email } = req.body;

      const reportData = {
        title,
        description,
        image,
        category,
        location,
        email,
        status: "pending",
        priority: "Normal",
        upvote: 0,
        upvotedUsers: [],
        timeline: [
          {
            text: "Issue reported",
            date: new Date(),
          },
        ],
        createdAt: new Date(),
      };

      const result = await reportCollection.insertOne(reportData);
      res.send(result);
    });

    app.patch("/issus/upvote/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const userEmail = req.body?.email;

        if (!userEmail) {
          return res
            .status(401)
            .send({ success: false, message: "User email missing" });
        }

        // 1) Get issue
        const issue = await reportCollection.findOne({ _id: new ObjectId(id) });

        if (!issue) {
          return res
            .status(404)
            .send({ success: false, message: "Issue not found" });
        }

        if (issue.email === userEmail) {
          return res.status(400).send({
            success: false,
            message: "You cannot upvote your own issue",
          });
        }

        const alreadyUpvoted =
          Array.isArray(issue.upvotedUsers) &&
          issue.upvotedUsers.includes(userEmail);

        if (alreadyUpvoted) {
          return res
            .status(400)
            .send({ success: false, message: "You already upvoted" });
        }

        const updateResult = await reportCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $inc: { upvote: 1 },
            $addToSet: { upvotedUsers: userEmail },
          }
        );

        if (updateResult.modifiedCount > 0) {
          return res.send({ success: true, message: "Upvoted Successfully!" });
        }

        return res
          .status(500)
          .send({ success: false, message: "Upvote failed" });
      } catch (err) {
        console.error(err);
        res.status(500).send({ success: false, message: "Server error" });
      }
    });

    //report count api
    app.get("/admin/stats", verifyFBToken, verifyAdmin, async (req, res) => {
      // Total issues
      const totalIssues = await reportCollection.countDocuments();

      // Resolved count
      const resolvedCount = await reportCollection.countDocuments({
        status: "Resolved",
      });

      // Pending count
      const pendingCount = await reportCollection.countDocuments({
        status: "pending",
      });

      // Rejected count (ধরে নিচ্ছি তুমি rejected status যোগ করবে DB-এ)
      const rejectedCount = await reportCollection.countDocuments({
        status: "rejected",
      });

      // Total payments (subscribeCollection থেকে sum)
      const totalPayments = await subscribeCollection
        .aggregate([{ $group: { _id: null, total: { $sum: "$amount_bdt" } } }])
        .toArray();
      const totalPaymentAmount = totalPayments[0]?.total || 0;

      // Latest 5 issues
      const latestIssues = await reportCollection
        .find()
        .sort({ createdAt: -1 })
        .limit(5)
        .toArray();

      // Latest 5 payments
      const latestPayments = await subscribeCollection
        .find()
        .sort({ createdAt: -1 })
        .limit(5)
        .toArray();

      // Latest 5 users
      const latestUsers = await userCollection
        .find()
        .sort({ createdAt: -1 })
        .limit(5)
        .toArray();

      // Chart data (status wise)
      const statusStats = await reportCollection
        .aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }])
        .toArray();

      res.send({
        totalIssues,
        resolvedCount,
        pendingCount,
        rejectedCount,
        totalPaymentAmount,
        latestIssues,
        latestPayments,
        latestUsers,
        statusStats,
      });
    });
    app.patch(
      "/admin/reject-issue/:id",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const result = await reportCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status: "rejected" } }
        );
        res.send(result);
      }
    );

    app.get("/staff/list", verifyFBToken, verifyAdmin, async (req, res) => {
      const staff = await userCollection.find({ role: "staff" }).toArray();
      res.send(staff);
    });
    app.patch(
      "/admin/user-block/:id",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const { blocked } = req.body; // true/false
        const result = await userCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { blocked } }
        );
        res.send(result);
      }
    );

    // app.get("/latest-resolved", async (req, res) => {
    //   try {
    //     const limit = parseInt(req.query.limit) || 6;

    //     const cursor = reportCollection.find({ status: "resolved" });
    //     const count = await cursor.count();
    //     console.log("Total resolved issues:", count);

    //     const latestResolved = await cursor
    //       .sort({ createdAt: -1 })
    //       .limit(limit)
    //       .toArray();

    //     console.log("Fetched issues:", latestResolved.length);
    //     res.send(latestResolved);
    //   } catch (err) {
    //     console.error("Latest Resolved Issues Error:", err);
    //     res
    //       .status(500)
    //       .send({ message: "Failed to fetch latest resolved issues" });
    //   }
    // });

    app.patch("/issus/boost/:id", async (req, res) => {
      try {
        const id = req.params.id;
        console.log("upvote", id);
        const result = await reportCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: { priority: "High" },
            $push: {
              timeline: {
                text: "Priority boosted",
                date: new Date(),
              },
            },
          }
        );

        if (result.modifiedCount === 0) {
          return res.status(404).send({ message: "Issue not found" });
        }

        res.send({ success: true, message: "Issue boosted successfully" });
      } catch (error) {
        console.error("Boost error:", error);
        res.status(500).send({ message: "Failed to boost issue" });
      }
    });
    app.patch("/issus/status/:id", async (req, res) => {
      const { status } = req.body;
      const id = req.params.id;
      console.log("status id", id);
      await reportCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: { status },
          $push: {
            timeline: {
              text: `Status changed to ${status}`,
              date: new Date(),
            },
          },
        }
      );

      res.send({ success: true });
    });

    // 1. Staff er kache assign kora sob issue gulo dekha
    // Staff assigned issues
    app.get(
      "/staff/assigned-issues",
      verifyFBToken,
      verifyStaff,
      async (req, res) => {
        const email = req.decoded_email; // এখন ঠিক আছে
        const query = { assignedStaffEmail: email };
        const result = await reportCollection.find(query).toArray();
        res.send(result);
      }
    );

    // Staff progress update
    app.patch(
      "/staff/update-progress/:id",
      verifyFBToken,
      verifyStaff,
      async (req, res) => {
        const id = req.params.id;
        const { progressNote, status } = req.body;

        const updateDoc = {
          $set: { status },
          $push: {
            timeline: {
              text: progressNote,
              date: new Date(),
              updatedBy: req.decoded_email,
            },
          },
        };

        const result = await reportCollection.updateOne(
          { _id: new ObjectId(id) },
          updateDoc
        );
        res.send(result);
      }
    );
    app.get("/staff/stats", verifyFBToken, verifyStaff, async (req, res) => {
      const email = req.decoded_email;
      const today = new Date();
      const todayStart = new Date(today.setHours(0, 0, 0, 0));

      // Assigned issues count
      const assignedCount = await reportCollection.countDocuments({
        assignedStaffEmail: email,
      });

      // Resolved issues count (all time)
      const resolvedCount = await reportCollection.countDocuments({
        assignedStaffEmail: email,
        status: "Resolved",
      });

      // Today's tasks (pending/in-progress/working today)
      const todaysTasks = await reportCollection
        .find({
          assignedStaffEmail: email,
          createdAt: { $gte: todayStart },
          status: { $in: ["pending", "assigned", "In Progress", "Working"] },
        })
        .toArray();

      // Stats for charts (e.g., status wise count)
      const statusStats = await reportCollection
        .aggregate([
          { $match: { assignedStaffEmail: email } },
          { $group: { _id: "$status", count: { $sum: 1 } } },
        ])
        .toArray();

      // More stats (e.g., priority wise)
      const priorityStats = await reportCollection
        .aggregate([
          { $match: { assignedStaffEmail: email } },
          { $group: { _id: "$priority", count: { $sum: 1 } } },
        ])
        .toArray();

      res.send({
        assignedCount,
        resolvedCount,
        todaysTasks,
        statusStats,
        priorityStats,
      });
    });

    // ==================== ADMIN APIs ====================

    // Add new staff
    app.post(
      "/admin/add-staff",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const { displayName, email, phone, photoURL, password } = req.body;

        // Basic validation
        if (!displayName || !email || !password) {
          return res.status(400).json({
            success: false,
            message: "Name, email and password are required",
          });
        }

        try {
          const fbUser = await admin.auth().createUser({
            email,
            password,
            displayName,
            photoURL: photoURL || null,
          });

          const dbUser = {
            uid: fbUser.uid,
            displayName,
            email,
            phone: phone || null,
            photoURL: photoURL || null,
            role: "staff",
            createdAt: new Date(),
          };

          await userCollection.insertOne(dbUser);

          res.json({ success: true, message: "Staff created successfully" });
        } catch (error) {
          console.error("Add staff error:", error);

          // Firebase specific common errors
          if (error.code === "auth/email-already-exists") {
            return res
              .status(400)
              .json({ success: false, message: "Email already in use" });
          }

          res
            .status(500)
            .json({ success: false, message: "Failed to create staff" });
        }
      }
    );

    // Update staff (name, phone, photo)
    app.patch(
      "/admin/update-staff/:id",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const { displayName, phone, photoURL } = req.body;

        if (!ObjectId.isValid(id)) {
          return res
            .status(400)
            .json({ success: false, message: "Invalid staff ID" });
        }

        try {
          const result = await userCollection.updateOne(
            { _id: new ObjectId(id), role: "staff" }, // extra safety: only update staff
            { $set: { displayName, phone, photoURL } }
          );

          if (result.matchedCount === 0) {
            return res
              .status(404)
              .json({ success: false, message: "Staff not found" });
          }

          res.json({ success: true, message: "Staff updated successfully" });
        } catch (error) {
          console.error("Update staff error:", error);
          res.status(500).json({ success: false, message: "Server error" });
        }
      }
    );

    // Assign staff to issue (আপনার দেওয়া কোডটা খুব ভালো, শুধু কিছু polish করলাম)
    app.patch(
      "/admin/assign-staff/:id",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const id = req.params.id;
          const { staffEmail } = req.body;

          if (!staffEmail) {
            return res.status(400).json({
              success: false,
              message: "Staff email is required",
            });
          }

          if (!ObjectId.isValid(id)) {
            return res
              .status(400)
              .json({ success: false, message: "Invalid issue ID" });
          }

          // Verify staff exists
          const staffUser = await userCollection.findOne({
            email: staffEmail,
            role: "staff",
          });

          if (!staffUser) {
            return res.status(404).json({
              success: false,
              message: "Staff member not found or not a staff",
            });
          }

          // Get issue
          const issue = await reportCollection.findOne({
            _id: new ObjectId(id),
          });

          if (!issue) {
            return res.status(404).json({
              success: false,
              message: "Issue not found",
            });
          }

          // Prevent re-assignment
          if (issue.assignedStaffEmail) {
            return res.status(400).json({
              success: false,
              message: "Issue already assigned. Re-assignment not allowed.",
            });
          }

          // Assign
          const result = await reportCollection.updateOne(
            { _id: new ObjectId(id) },
            {
              $set: { assignedStaffEmail: staffEmail },
              $push: {
                timeline: {
                  text: `Assigned to staff: ${
                    staffUser.displayName || staffEmail
                  }`,
                  date: new Date(),
                  updatedBy: req.decoded_email, // admin who assigned
                },
              },
            }
          );

          if (result.modifiedCount === 0) {
            return res.status(500).json({
              success: false,
              message: "Failed to assign staff",
            });
          }

          res.json({
            success: true,
            message: "Staff assigned successfully",
            assignedStaffEmail: staffEmail,
          });
        } catch (error) {
          console.error("Assign staff error:", error);
          res.status(500).json({ success: false, message: "Server error" });
        }
      }
    );

    // Delete staff
    app.delete(
      "/admin/delete-staff/:id",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;

        if (!ObjectId.isValid(id)) {
          return res
            .status(400)
            .json({ success: false, message: "Invalid staff ID" });
        }

        try {
          const user = await userCollection.findOne({
            _id: new ObjectId(id),
            role: "staff",
          });

          if (!user) {
            return res
              .status(404)
              .json({ success: false, message: "Staff not found" });
          }

          // Delete from Firebase Auth
          await admin.auth().deleteUser(user.uid);

          // Delete from MongoDB
          await userCollection.deleteOne({ _id: new ObjectId(id) });

          res.json({ success: true, message: "Staff deleted successfully" });
        } catch (error) {
          console.error("Delete staff error:", error);
          res
            .status(500)
            .json({ success: false, message: "Failed to delete staff" });
        }
      }
    );

    // Get all payments (already good, just small improvement)
    app.get("/admin/payments", verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        const { purpose, month } = req.query;

        let query = {};

        if (purpose) query.purpose = purpose;
        if (month) {
          const start = new Date(`${month}-01`);
          const end = new Date(start);
          end.setMonth(end.getMonth() + 1);
          query.createdAt = { $gte: start, $lt: end };
        }

        const payments = await subscribeCollection
          .find(query)
          .sort({ createdAt: -1 })
          .toArray();

        res.json(payments);
      } catch (error) {
        console.error("Fetch payments error:", error);
        res
          .status(500)
          .json({ success: false, message: "Failed to fetch payments" });
      }
    });

    // -----------------------
    // USERS API
    // -----------------------

    // get user by email
    app.get("/users/email/:email", async (req, res) => {
      const email = req.params.email;
      try {
        const user = await userCollection.findOne({ email });
        if (!user) return res.status(404).send({ message: "User not found" });

        res.send(user);
      } catch (error) {
        console.error("GET /users/email error:", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    app.get("/users", verifyFBToken, async (req, res) => {
      const searchText = req.query.searchText || "";

      let query = {};
      if (searchText) {
        query = {
          $or: [
            { displayName: { $regex: searchText, $options: "i" } },
            { email: { $regex: searchText, $options: "i" } },
          ],
        };
      }

      const users = await userCollection.find(query).toArray();
      res.send(users);
    });

    app.post("/users", async (req, res) => {
      const user = req.body;

      // Default values
      user.role = "user";
      user.createdAt = new Date();
      user.isPremium = false;

      console.log("this is user", user);

      const email = user.email;
      const userExist = await userCollection.findOne({ email });

      if (userExist) {
        return res.send({ message: "user exists" });
      }

      const result = await userCollection.insertOne(user);
      res.send(result);
    });
    app.get("/users/:email/role", async (req, res) => {
      const email = req.params.email;

      try {
        const user = await userCollection.findOne({ email });

        if (!user) {
          return res
            .status(404)
            .send({ role: null, message: "User not found" });
        }

        res.send({
          role: user.role || "user", // fallback safety
        });
      } catch (error) {
        res.status(500).send({ message: "Failed to get user role" });
      }
    });

    app.post("/subscribe", async (req, res) => {
      const { sessionId, email, name, amount } = req.body;
      if (!sessionId) {
        return res.send({ message: "session id invalied" });
      }
      if (!email) {
        return res.send({ message: "session email invalied" });
      }
      if (!name) {
        return res.send({ message: "session name invalied" });
      }
      if (!amount) {
        return res.send({ message: "session amount invalied" });
      }

      if (!sessionId || !email || !name || !amount) {
        return res.status(400).send({ message: "Invalid request" });
      }

      try {
        const subscribeData = {
          sessionId,
          email,
          name,
          amount,
          isPremium: false, // <-- default
          createdAt: new Date(), // optional but useful
        };

        const result = await subscribeCollection.insertOne(subscribeData);

        res.send({
          success: true,
          message: "Subscription request saved!",
          result,
        });
      } catch (error) {
        console.log(error);
        res.status(500).send({ message: "Failed to save subscription" });
      }
    });

    app.patch("/users/:id/role", async (req, res) => {
      const id = req.params.id;
      const { role } = req.body;

      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: { role },
      };

      const result = await userCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    // Stripe checkout
    app.post("/create-checkout-session", async (req, res) => {
      const { email, plan, issueId, purpose } = req.body; // purpose: "subscribe" or "boost"

      try {
        let amountBDT = 0;
        let productName = "";

        if (purpose === "subscribe") {
          amountBDT = 1000; // Premium subscription
          productName = "Premium Subscription";
        } else if (purpose === "boost") {
          amountBDT = 100; // Boost issue priority
          productName = "Issue Priority Boost";
        } else {
          return res.status(400).json({ error: "Invalid payment purpose" });
        }

        const usdAmount = Math.round(amountBDT / 110); // convert to USD
        const session = await stripe.checkout.sessions.create({
          payment_method_types: ["card"],
          mode: "payment",
          customer_email: email,

          line_items: [
            {
              price_data: {
                currency: "usd",
                unit_amount: usdAmount * 100,
                product_data: {
                  name: productName,
                },
              },
              quantity: 1,
            },
          ],

          metadata: {
            purpose,
            plan: plan || null, // only for subscription
            issueId: issueId || null, // only for boost
          },

          success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
        });

        res.json({ url: session.url });
      } catch (err) {
        console.error("Stripe error:", err);
        res.status(500).json({ error: err.message });
      }
    });
    // app.patch("/payment-success", async (req, res) => {
    //   try {
    //     const { sessionId } = req.body;
    //    console.log('this is session id',sessionId)
    //     const session = await stripe.checkout.sessions.retrieve(sessionId);

    //     if (session.payment_status !== "paid") {
    //       return res
    //         .status(400)
    //         .send({ success: false, message: "Payment not completed" });
    //     }

    //     const purpose = session.metadata.purpose;

    //     //boost
    //     if (purpose === "boost") {
    //       const issueId = session.metadata.issueId;
    //       console.log(issueId)

    //       await reportCollection.updateOne(
    //         { _id: (issueId) },
    //         {
    //           $set: { priority: "High" },
    //           $push: {
    //             timeline: {
    //               text: "Priority boosted (100 BDT payment)",
    //               date: new Date(),
    //             },
    //           },
    //         }
    //       );

    //       return res.send({
    //         success: true,
    //         purpose: "boost",
    //         issueId,
    //       });
    //     }

    //     //subscribe

    //     if (purpose === "subscribe") {
    //       await userCollection.updateOne(
    //         { email: session.customer_details.email },
    //         {
    //           $set: {
    //             isPremium: true,
    //             premiumDate: new Date(),
    //           },
    //         }
    //       );

    //       await subscribeCollection.insertOne({
    //         transactionId: session.payment_intent,
    //         email: session.customer_details.email,
    //         amount_usd: session.amount_total / 100,
    //         amount_bdt: session.metadata.amount_bdt,
    //         plan: session.metadata.plan,
    //         status: "completed",
    //         createdAt: new Date(),
    //       });

    //       return res.send({
    //         success: true,
    //         purpose: "subscribe",
    //       });
    //     }

    //     res.status(400).send({ message: "Unknown payment purpose" });
    //   } catch (err) {
    //     console.error(err);
    //     res.status(500).send({ error: err.message });
    //   }
    // });

    app.post("/payment-success", async (req, res) => {
      try {
        const { sessionId } = req.body;

        const session = await stripe.checkout.sessions.retrieve(sessionId);

        if (session.payment_status !== "paid") {
          return res.status(400).json({
            success: false,
            message: "Payment not completed",
          });
        }

        const { purpose, issueId, plan } = session.metadata;
        const email = session.customer_details.email;

        // 🔥 SUBSCRIPTION LOGIC
        if (purpose === "subscribe") {
          await userCollection.updateOne(
            { email },
            {
              $set: {
                isPremium: true,
                premiumDate: new Date(),
              },
            }
          );

          await subscribeCollection.insertOne({
            transactionId: session.payment_intent,
            email,
            plan,
            amount_bdt: session.amount_total / 100,
            purpose: "subscribe",
            createdAt: new Date(),
          });

          return res.json({
            success: true,
            purpose: "subscribe",
          });
        }

        // 🚀 BOOST LOGIC
        if (purpose === "boost") {
          await reportCollection.updateOne(
            { _id: new ObjectId(issueId) },
            {
              $set: {
                priority: "High",
                boostedAt: new Date(),
              },
            }
          );

          await subscribeCollection.insertOne({
            transactionId: session.payment_intent,
            email,
            issueId,
            purpose: "boost",
            amount_bdt: session.amount_total / 100,
            createdAt: new Date(),
          });

          return res.json({
            success: true,
            purpose: "boost",
            issueId,
          });
        }

        res
          .status(400)
          .json({ success: false, message: "Invalid payment purpose" });
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
      }
    });
    // ping
    await client.db("admin").command({ ping: 1 });
    console.log("Connected to MongoDB successfully!");
  } finally {
  }
}

run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("City Fix Backend Running!");
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
