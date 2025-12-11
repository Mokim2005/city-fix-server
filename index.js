const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const port = process.env.PORT || 3000;

const stripe = require("stripe")(process.env.STRIPE_SECRET);

// middleware
app.use(express.json());
app.use(cors());

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
    await client.connect();

    const db = client.db("city-fix-db");

    // IMPORTANT: issus = citizen collection
    const reportCollection = db.collection("issus");

    // users collection
    const userCollection = db.collection("users");
    const subscribeCollection = db.collection("subscribe");

    // -----------------------
    // issus (ISSUES) API
    // -----------------------

    // Get all reports (or by email)
    app.get("/issus", async (req, res) => {
      const query = {};
      const { email } = req.query;
      if (email) query.email = email;

      const cursor = reportCollection.find(query, {
        sort: { createdAt: -1 },
      });

      const result = await cursor.toArray();
      res.send(result);
    });

    // Delete report
    app.delete("/issus/:id", async (req, res) => {
      const id = req.params.id;
      const result = await reportCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

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
        createdAt: new Date(),
      };

      const result = await reportCollection.insertOne(reportData);
      res.send(result);
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

    app.post("/users", async (req, res) => {
      const user = req.body;

      // Default values
      user.role = "user";
      user.createdAt = new Date();
      user.isPremium = false; // ⬅️ Set default premium status

      console.log("this is user", user);

      const email = user.email;
      const userExist = await userCollection.findOne({ email });

      if (userExist) {
        return res.send({ message: "user exists" });
      }

      const result = await userCollection.insertOne(user);
      res.send(result);
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

    // Stripe checkout
    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      console.log("paymentinfo is hare", paymentInfo);
      const bdtAmount = 1000;
      const usdAmount = Math.round(bdtAmount / 110);
      console.log("paymentinfo is hare", paymentInfo);

      try {
        const session = await stripe.checkout.sessions.create({
          payment_method_types: ["card"],
          line_items: [
            {
              price_data: {
                currency: "usd",
                unit_amount: usdAmount * 100,
                product_data: { name: "Premium Subscription" },
              },
              quantity: 1,
            },
          ],
          customer_email: paymentInfo?.email,
          mode: "payment",
          metadata: {
            amount_bdt: 1000,
            plan: paymentInfo.plan,
          },

          success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
        });

        res.json({ url: session.url });
      } catch (err) {
        console.log(err);
        res.status(500).json({ error: err.message });
      }
    });

    app.post("/payment-success", async (req, res) => {
      try {
        const { sessionId } = req.body;

        if (!sessionId) {
          return res.status(400).send({
            success: false,
            message: "sessionId missing",
          });
        }

        const session = await stripe.checkout.sessions.retrieve(sessionId);

        // Payment verified
        if (session.payment_status === "paid") {
          const orderInfo = {
            transactionId: session.payment_intent,
            customer: session.customer_details.email,
            amount: session.amount_total / 100,
            amount_bdt: session.metadata.amount_bdt,
            plan: session.metadata.plan,
            status: "completed",
          };

          console.log("Saving to DB:", orderInfo);

          const result = await subscribeCollection.insertOne(orderInfo);
          // Example: save to mongo
          // await OrderCollection.insertOne(orderInfo);
        }

        res.send({
          success: true,
          session,
        });
      } catch (error) {
        console.log("Payment success error:", error);
        res.status(500).send({
          success: false,
          message: error.message,
        });
      }
    });

    // app.post("/payment-success", async (req, res) => {
    //   const { sessionId } = req.body;
    //   const session = await stripe.checkout.session.retrieve(sessionId)
    //   console.log(session)
    // });

    // const { ObjectId } = require("mongodb");

    // app.patch("/payment-success", async (req, res) => {
    //   console.log("route hit");
    //   console.log("session_id:", req.query.session_id);

    //   try {
    //     const session = await stripe.checkout.sessions.retrieve(
    //       req.query.session_id
    //     );
    //     console.log("stripe session:", session);
    //   } catch (err) {
    //     console.log("stripe error:", err);
    //     return res.send({ success: false, error: "Invalid session id" });
    //   }
    //   try {
    //     const sessionId = req.query.session_id;
    //     if (!sessionId) {
    //       return res
    //         .status(400)
    //         .send({ success: false, message: "session_id missing" });
    //     }

    //     // 1) Retrieve the Stripe session
    //     const session = await stripe.checkout.sessions.retrieve(sessionId);

    //     // 2) Basic session data
    //     const transactionId = session.payment_intent;
    //     const paymentStatus = session.payment_status; // "paid" expected
    //     const customerEmail =
    //       session.customer_email ||
    //       session.customer_details?.email ||
    //       session.metadata?.email;
    //     const customerName =
    //       session.metadata?.name || session.customer_details?.name || "Unknown";
    //     const amount = session.amount_total ? session.amount_total / 100 : null;
    //     const plan = session.metadata?.plan || "premium";

    //     // 3) Check if payment already logged
    //     const paymentExist = await paymentCollection.findOne({ transactionId });
    //     if (paymentExist) {
    //       return res.send({
    //         success: true,
    //         message: "already exists",
    //         transactionId,
    //         paymentInfo: paymentExist,
    //       });
    //     }

    //     // 4) Only proceed if paid
    //     if (paymentStatus === "paid") {
    //       // Update subscribeCollection: mark that subscription request is paid
    //       // Try to match by sessionId or by email + plan if you didn't save subscribe doc with sessionId
    //       const subscribeQuery = session.metadata?.subscribeId
    //         ? { _id: new ObjectId(session.metadata.subscribeId) }
    //         : { email: customerEmail, plan };

    //       const subscribeUpdate = {
    //         $set: {
    //           isPremium: true,
    //           sessionId,
    //           transactionId,
    //           paidAt: new Date(),
    //           amount,
    //         },
    //       };

    //       const updateSubscribeResult = await subscribeCollection.updateOne(
    //         subscribeQuery,
    //         subscribeUpdate
    //       );

    //       // If subscribe doc didn't exist, optionally create one
    //       if (updateSubscribeResult.matchedCount === 0) {
    //         await subscribeCollection.insertOne({
    //           sessionId,
    //           transactionId,
    //           email: customerEmail,
    //           name: customerName,
    //           plan,
    //           amount,
    //           isPremium: true,
    //           createdAt: new Date(),
    //           paidAt: new Date(),
    //         });
    //       }

    //       // 5) Update user document to set isPremium = true
    //       if (customerEmail) {
    //         await userCollection.updateOne(
    //           { email: customerEmail },
    //           {
    //             $set: {
    //               isPremium: true,
    //               premiumTakenAt: new Date(),
    //               transactionId,
    //               plan,
    //             },
    //           }
    //         );
    //       }

    //       // 6) Insert into paymentCollection (log)
    //       const paymentLog = {
    //         transactionId,
    //         sessionId,
    //         amount,
    //         currency: session.currency,
    //         customerEmail,
    //         customerName,
    //         plan,
    //         paymentStatus,
    //         paidAt: new Date(),
    //         rawSession: session, // optional: store full session for debugging (careful with size)
    //       };

    //       const insertedPayment = await paymentCollection.insertOne(paymentLog);

    //       // 7) Respond success
    //       return res.send({
    //         success: true,
    //         message: "Payment verified and premium activated",
    //         transactionId: transactionId,
    //         email: customerEmail,
    //         amount: amount,
    //         plan: plan,
    //         isPremium: true,
    //       });
    //     }

    //     // If not paid
    //     return res
    //       .status(400)
    //       .send({ success: false, message: "Payment not completed" });
    //   } catch (error) {
    //     console.error("payment-success error:", error);
    //     return res.status(500).send({
    //       success: false,
    //       message: "Server error",
    //       error: error.message,
    //     });
    //   }
    // });

    // ping
    await client.db("admin").command({ ping: 1 });
    console.log("Connected to MongoDB successfully!");
  } finally {
    // keep connection open
  }
}

run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("City Fix Backend Running!");
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
