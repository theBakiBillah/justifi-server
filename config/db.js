const { MongoClient, ServerApiVersion } = require("mongodb");
require("dotenv").config();

// const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.edbcjh0.mongodb.net/?appName=Cluster0`;

//! For local MongoDB connection (Only For Baki)
//TODO: Comment this line and uncomment the above line if you want to connect to MongoDB Atlas
const uri = `mongodb://localhost:27017/justiFi`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    },
});

async function connectToDatabase() {
    try {
        console.log("Trying to connect to MongoDB...");
        await client.connect();
        console.log("Connected to MongoDB");
        return client;
    } catch (error) {
        console.error("Error connecting to MongoDB:", error);
        throw error;
    }
}

module.exports = { connectToDatabase, client };