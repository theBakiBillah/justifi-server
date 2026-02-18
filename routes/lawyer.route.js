const express = require("express");
const router = express.Router();
const { ObjectId } = require("mongodb");
const { client } = require("../config/db");
const verifyToken = require("../middleware/verifyToken");
const verifyAdmin = require("../middleware/verifyAdmin");

const lawyerCollection = client.db("justiFi").collection("lawyers");

router.get("/lawyers", async (req, res) => {
    const cursor = lawyerCollection.find();
    const result = await cursor.toArray();
    res.send(result);
});

router.get("/lawyerProfile", verifyToken, async (req, res) => {
    const { email } = req.query;
    const lawyer = await lawyerCollection.findOne({ email });
    res.send(lawyer);
});

// Get All Lawyers from admin panel: DONE
router.get("/all-lawyers", verifyToken, verifyAdmin, async (req, res) => {
    const cursor = lawyerCollection.find();
    const result = (await cursor.toArray());
    res.send(result);
});

// Add a new lawyer by admin: DONE
router.post("/add-lawyer", verifyToken, verifyAdmin, async (req, res) => {
    const lawyerData = req.body;
    const result = await lawyerCollection.insertOne(lawyerData);
    res.send(result);
});

// Delete a lawyer by email from admin panel: DONE
router.delete("/remove-lawyer/:email", verifyToken, verifyAdmin, async (req, res) => {
    const { email } = req.params;
    const result = await lawyerCollection.deleteOne({ email: email });

    if (result.deletedCount === 0) {
        return res.status(404).send({
            success: false,
            error: "Lawyer not found",
        });
    }

    res.send({
        success: true,
        message: "Lawyer deleted successfully",
    });
});

// update lawyer profile
router.patch("/lawyerProfile/:email", verifyToken, async (req, res) => {
    const { email } = req.params;
    const data = req.body;

    // Remove _id from the update data to prevent immutable field modification
    const { _id, ...updateData } = data;

    // If there's nothing left to update after removing _id
    if (Object.keys(updateData).length === 0) {
        return res.status(400).send({
            success: false,
            error: "No valid fields to update",
        });
    }

    const result = await lawyerCollection.updateOne(
        { email: email },
        { $set: updateData }
    );

    if (result.matchedCount === 0) {
        return res.status(404).send({
            success: false,
            error: "Lawyer not found",
        });
    }

    res.send({
        success: true,
        message: "Lawyer profile updated successfully",
    });
});

module.exports = router;
