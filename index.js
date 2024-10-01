const express = require("express");
require("dotenv").config();
const cors = require("cors");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const app = express();
const port = process.env.PORT || 5000;

// middleware
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://solosphere-client-7bcc2.web.app",
    ],
    credentials: true,
    optionsSuccessStatus: 200,
  })
);
app.use(express.json());
app.use(cookieParser());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.wrhbune.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// verification middleware
const verifyToken = async (req, res, next) => {
  const token = req.cookies?.token;
  console.log("verifyToken", token);
  if (!token) {
    return res.status(401).send({ message: "Unauthorized Access" });
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      console.log(err);
      return res.status(401).send({ message: "Unauthorized Access" });
    }
    req.user = decoded;
    console.log("value in the decoded ", decoded);
    next();
  });
};

const cookieOptions = {
  httpOnly: true,
  sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
  secure: process.env.NODE_ENV === "production" ? true : "strict",
};

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    // JWT
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      // console.log(user);
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "360d",
      });
      res.cookie("token", token, cookieOptions).send({ success: true });
    });
    app.post("/logOut", async (req, res) => {
      const user = req.body;
      console.log("logOuted User", user);
      res
        .clearCookie("token", { ...cookieOptions, maxAge: 0 })
        .send({ success: true });
    });

    const jobsCollection = client.db("soloSphere").collection("jobs");
    const bidsCollection = client.db("soloSphere").collection("bids");

    // jobs related api
    app.post("/jobs", async (req, res) => {
      const jobs = req.body;
      const result = await jobsCollection.insertOne(jobs);
      res.send(result);
    });
    app.get("/jobs/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      if (req.params.email !== req.user.email) {
        return res.status(403).send({ message: "Forbidden Access" });
      }
      const query = { "buyer.email": email };
      const result = await jobsCollection.find(query).toArray();
      res.send(result);
    });

    app.get("/jobs", async (req, res) => {
      const result = await jobsCollection.find().toArray();
      res.send(result);
    });
    app.get("/job/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await jobsCollection.findOne(query);
      res.send(result);
    });
    app.put("/job/:id", async (req, res) => {
      const id = req.params.id;
      const jobData = req.body;
      const query = { _id: new ObjectId(id) };
      const options = { upsert: true };
      const updateDoc = {
        $set: {
          ...jobData,
        },
      };
      const result = await jobsCollection.updateOne(query, updateDoc, options);
      res.send(result);
    });
    app.delete("/job/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await jobsCollection.deleteOne(query);
      res.send(result);
    });

    // bids related api
    app.post("/bids", async (req, res) => {
      const bidData = req.body;
      const query = {
        email: bidData.email,
        jobId: bidData.jobId,
      };
      const alreadyApplied = await bidsCollection.findOne(query);
      if (alreadyApplied) {
        return res.status(400).send("You are already this job");
      }

      const result = await bidsCollection.insertOne(bidData);

      // update bid count in job collection
      const updateDoc = {
        $inc: { bid_count: 1 },
      };
      const jobQuery = { _id: new ObjectId(bidData.jobId) };

      const updateBidCount = await jobsCollection.updateOne(
        jobQuery,
        updateDoc
      );
      console.log(updateBidCount);

      res.send(result);
    });
    app.get("/myBids/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      // const query = {email}
      const result = await bidsCollection.find(query).toArray();
      res.send(result);
    });
    app.get("/bidRequests/:email", async (req, res) => {
      const email = req.params.email;
      const query = { buyer_email: email };
      const result = await bidsCollection.find(query).toArray();
      res.send(result);
    });
    app.patch("/bid/:id", async (req, res) => {
      const id = req.params.id;
      const status = req.body;
      const query = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: status,
      };
      const result = await bidsCollection.updateOne(query, updateDoc);
      res.send(result);
    });

    // pagination
    app.get("/allJobs", async (req, res) => {
      const page = parseInt(req.query.page);
      const size = parseInt(req.query.size);
      const filter = req.query.filter;
      const sort = req.query.sort;
      const search = req.query.search;
      console.log(sort);

      let query = {
        job_title: { $regex: search, $options: "i" },
      };
      if (filter) {
        query.job_category = filter;
      }
      // if (filter) {
      //   query = { ...query, job_category: filter };
      // }
      let option = {};
      if (sort) {
        option = { sort: { deadline: sort === "asc" ? 1 : -1 } };
      }
      // console.log(page, size, filter, query);
      const result = await jobsCollection
        .find(query, option)
        .skip(page * size)
        .limit(size)
        .toArray();
      res.send(result);
    });
    app.get("/jobsCount", async (req, res) => {
      const filter = req.query.filter;
      const search = req.query.search;
      let query = {
        job_title: { $regex: search, $options: "i" },
      };
      if (filter) {
        query.job_category = filter;
      }
      console.log(filter, query);
      const count = await jobsCollection.countDocuments(query);
      res.send({ count });
    });

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
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
  res.send("Hello World!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
