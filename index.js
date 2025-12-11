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

        const session = await stripe.checkout.sessions.retrieve(sessionId);

        if (session.payment_status !== "paid") {
          return res.send({ success: false, message: "Payment not completed" });
        }

        // Update user premium
        await userCollection.updateOne(
          { email: session.customer_details.email },
          {
            $set: {
              isPremium: true,
              premiumDate: new Date(),
            },
          }
        );

        // Save order in DB
        const orderInfo = {
          transactionId: session.payment_intent,
          email: session.customer_details.email,
          amount_usd: session.amount_total / 100,
          amount_bdt: session.metadata.amount_bdt,
          plan: session.metadata.plan,
          status: "completed",
        };

        await subscribeCollection.insertOne(orderInfo);

        res.send({ success: true });
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });


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
