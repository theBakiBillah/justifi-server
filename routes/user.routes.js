const express = require("express");
const router = express.Router();
const { ObjectId } = require("mongodb");
const { client } = require("../config/db");
const verifyToken = require("../middleware/verifyToken");
const verifyAdmin = require("../middleware/verifyAdmin");

const userCollection = client.db("justiFi").collection("users");

router.get("/users", async (req, res) => {
    const cursor = userCollection.find();
    const result = await cursor.toArray();
    res.send(result);
});

router.get("/user", async (req, res) => {
    const { email } = req.query;
    const user = await userCollection.findOne({ email });
    res.json({ exists: !!user });
});

router.get("/currentUser", async (req, res) => {
    const { email } = req.query;
    const user = await userCollection.findOne({ email });
    res.send(user);
});

router.post("/users", async (req, res) => {
    const user = req.body;
    user.role = "user";
    const result = await userCollection.insertOne(user);
    res.send(result);
});

router.get("/userProfile", verifyToken, async (req, res) => {
    const { email } = req.query;
    const user = await userCollection.findOne({ email });
    res.send(user);
});


// PATCH: update user profile info by email 
router.patch("/userProfile/:id",verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { email, ...updateData } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Email is required to update the user profile",
      });
    }

    const result = await userCollection.updateOne(
      { email },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    res.status(200).json({
      success: true,
      message: `User (${id}) profile updated successfully`,
    });
  } catch (error) {
    console.error("Error updating user profile:", error);
    res.status(500).json({
      success: false,
      error: "Server error while updating user profile",
    });
  }
});
module.exports = router;
