const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const port = process.env.PORT || 3000;

const stripe = require("stripe")(process.env.STRIPE_SECRET);

//middleware
app.use(express.json());
app.use(cors());

//piZyEPHo1WACuwTX
//city-fix-user
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ekpzegp.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db("city-fix-db");
    const citizenCollection = db.collection("Citezen");

    //citizen api
    app.get("/citizen", async (req, res) => {
      const query = {};

      const { email } = req.query;

      if (email) {
        query.email = email;
      }

      const options = { sort: { createdAt: -1 } };

      const cursor = citizenCollection.find(query, options);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.delete("/citizen/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await citizenCollection.deleteOne(query);
      res.send(result);
    });

    app.post("/citizen", async (req, res) => {
      const { title, description, image, category, location, email } = req.body;

      const issus = {
        title,
        description,
        category,
        location,
        image,
        email,
        status: "pending",
        createdAt: new Date(),
      };

      const result = await citizenCollection.insertOne(issus);
      res.send(result);
    });

    //update subscription
    app.patch("/citizen/:id/subscribe", async (req, res) => {
      const { id } = req.params;
      const { amount } = req.body;

      try {
        if (amount !== 1000) {
          return res
            .status(400)
            .json({ success: false, message: "Invalid amount" });
        }

        // find user by ID
        const user = await citizenCollection.findOne({ _id: new ObjectId(id) });

        if (!user) {
          return res
            .status(404)
            .json({ success: false, message: "User not found" });
        }

        if (user.isBlocked) {
          return res
            .status(403)
            .json({ success: false, message: "User is blocked" });
        }

        // update user
        await citizenCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { isPremium: true } }
        );

        res.json({ success: true, message: "Premium Activated" });
      } catch (error) {
        console.error("Subscribe API Error:", error);
        res.status(500).json({ success: false, message: "Server error" });
      }
    });

    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;

      try {
        const session = await stripe.checkout.sessions.create({
          payment_method_types: ["card"], // required
          line_items: [
            {
              price_data: {
                currency: "usd",
                unit_amount: 1500, // $15.00
                product_data: {
                  name: "Premium Subscription",
                },
              },
              quantity: 1,
            },
          ],
          customer_email: paymentInfo.email, // correct field
          mode: "payment",
          success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success`,
          cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
        });

        res.json({ url: session.url }); // return JSON instead of redirect
      } catch (err) {
        console.log(err);
        res.status(500).json({ error: err.message });
      }
    });
    app.get("/citizen/email/:email", async (req, res) => {
      const email = req.params.email;

      try {
        const user = await citizenCollection.findOne({ email });

        if (!user) {
          return res.status(404).send({ message: "User not found" });
        }

        res.send(user);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("city is fixing fixing!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
