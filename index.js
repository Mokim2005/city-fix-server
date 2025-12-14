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

const verifyFBToken = async (req, res, next) => {
  // console.log("headers in the middleware", req.headers.authorization);
  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }

  try {
    const idToken = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    console.log("decoded id the token", decoded);
    req.decoded_email = decoded.email;
    next();
  } catch (err) {
    return res.status(401).send({ message: "unauthorize access" });
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
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email };
      const user = await userCollection.findOne(query);

      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };
    const verifyStuff = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email };
      const user = await userCollection.findOne(query);

      if (!user || user.role !== "stuff") {
        return res.status(403).send({ message: "forbidden access" });
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
