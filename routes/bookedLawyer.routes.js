const express = require("express");
const router = express.Router();
const { ObjectId } = require("mongodb");
const { client } = require("../config/db");
const verifyToken = require("../middleware/verifyToken");
const verifyAdmin = require("../middleware/verifyAdmin");

const SSLCommerzPayment = require("sslcommerz-lts");
// const { v4: uuidv4 } = require("uuid");

const store_id = process.env.STORE_ID;
const store_passwd = process.env.STORE_PASS;
const is_live = false; // true for live, false for sandbox

const bookedLawyerCollection = client.db("justiFi").collection("bookedLawyers");
const lawyers = client.db("justiFi").collection("lawyers");

router.get("/bookings", async (req, res) => {
    const cursor = bookedLawyerCollection.find();
    const result = await cursor.toArray();
    res.send(result);
});

router.post("/bookings", async (req, res) => {
    try {
        const booking = req.body;

        // 1️⃣ Get lawyer info from DB
        const LawyerInfo = await lawyers.findOne({
            email: booking.lawyer.email,
        });
        if (!LawyerInfo) {
            return res
                .status(404)
                .json({ success: false, message: "Lawyer not found" });
        }

        // 2️⃣ Create a unique transaction ID
        const tran_id = new ObjectId().toHexString();

        // 3️⃣ Prepare SSLCommerz data (all required fields)
        const data = {
            total_amount: LawyerInfo.fee || 4500,
            currency: "BDT",
            tran_id,
            success_url: `http://localhost:5000/payment/success/${tran_id}`,
            fail_url: `http://localhost:5000/payment/fail/${tran_id}`,
            cancel_url: `http://localhost:5000/payment/cancel/${tran_id}`,
            ipn_url: "http://localhost:5000/payment/ipn",
            shipping_method: "Courier",
            product_name: "Lawyer Booking Fee",
            product_category: "Legal Service",
            product_profile: "general",

            // customer info
            cus_name: booking.user?.name || "Customer",
            cus_email: booking.user?.email || "customer@example.com",
            cus_add1: "Dhaka",
            cus_city: "Dhaka",
            cus_state: "Dhaka",
            cus_postcode: "1000",
            cus_country: "Bangladesh",
            cus_phone: booking.user?.phone || "01711111111",
            cus_fax: "01711111111",

            // shipping info (required by SSLCommerz)
            ship_name: booking.user?.name || "Customer",
            ship_add1: "Dhaka",
            ship_add2: "",
            ship_city: "Dhaka",
            ship_state: "Dhaka",
            ship_postcode: "1000",
            ship_country: "Bangladesh",
        };

        // 4️⃣ Initialize SSLCommerz payment
        const sslcz = new SSLCommerzPayment(store_id, store_passwd, is_live);
        const apiResponse = await sslcz.init(data);

        if (!apiResponse?.GatewayPageURL) {
            return res.status(400).json({
                success: false,
                message: "Failed to create payment session",
                error: apiResponse,
            });
        }

        // 5️⃣ Store booking in database with pending payment
        await bookedLawyerCollection.insertOne({
            ...booking,
            tran_id,
            paymentStatus: "pending",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });

        // 6️⃣ Return Gateway URL to frontend
        res.status(200).json({
            success: true,
            url: apiResponse.GatewayPageURL,
        });
    } catch (error) {
        console.error("Booking/Payment error:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
});

router.post("/payment/success/:tran_id", async (req, res) => {
    const { tran_id } = req.params;

    await bookedLawyerCollection.updateOne(
        { tran_id },
        {
            $set: {
                paymentStatus: "success",
                paidAt: new Date(),
            },
        }
    );
    // Redirect the user to frontend success page
    res.redirect(`http://localhost:5173/payment/success/${tran_id}`);
});

router.post("/payment/fail/:tran_id", async (req, res) => {
    const { tran_id } = req.params;

    await bookedLawyerCollection.updateOne(
        { tran_id },
        {
            $set: {
                paymentStatus: "failed",
                failedAt: new Date(),
            },
        }
    );
    // Redirect the user to frontend success page
    res.redirect(`http://localhost:5173/payment/fail/${tran_id}`);
});

router.post("/payment/cancel/:tran_id", async (req, res) => {
    const { tran_id } = req.params;

    await bookedLawyerCollection.updateOne(
        { tran_id },
        {
            $set: {
                paymentStatus: "cancelled",
                cancelledAt: new Date(),
            },
        }
    );
    // Redirect the user to frontend success page
    res.redirect(`http://localhost:5173/payment/cancel/${tran_id}`);
});

// Get appointments for a specific lawyer
router.get("/myAppointments", verifyToken, async (req, res) => {
    const { email } = req.query;
    const query = { "lawyer.email": email };
    const cursor = bookedLawyerCollection.find(query).sort({ createdAt: -1 });
    const result = await cursor.toArray();

    res.send(result);
});

// Get appointments for a specific user
router.get("/userAppointments", verifyToken, async (req, res) => {
    const { email } = req.query;
    const query = { "user.email": email };
    const cursor = bookedLawyerCollection.find(query).sort({ createdAt: -1 });
    const result = await cursor.toArray();

    res.send(result);
});

// Update appointment status and related fields for a specific lawyer
router.patch("/appointments/:id", verifyToken, async (req, res) => {
    const { id } = req.params;
    const { status, updatedAt, meetingLink, cancellationNote } = req.body;

    if (!ObjectId.isValid(id)) {
        return res.status(400).send({
            success: false,
            error: "Invalid appointment ID",
        });
    }

    const validStatuses = [
        "pending",
        "confirmed",
        "completed",
        "cancelled",
        "rejected",
    ];
    if (!status || !validStatuses.includes(status)) {
        return res.status(400).send({
            success: false,
            error:
                "Invalid status. Must be one of: " + validStatuses.join(", "),
        });
    }

    const currentAppointment = await bookedLawyerCollection.findOne({
        _id: new ObjectId(id),
    });

    if (!currentAppointment) {
        return res.status(404).send({
            success: false,
            error: "Appointment not found",
        });
    }

    const updateData = {
        $set: {
            status: status,
            updatedAt: updatedAt || new Date().toISOString(),
        },
    };

    if (status === "confirmed" && meetingLink) {
        updateData.$set["booking.meetingLink"] = meetingLink;
    }

    if (status === "cancelled" && cancellationNote) {
        updateData.$set["booking.cancellationNote"] = cancellationNote;
    }

    const result = await bookedLawyerCollection.updateOne(
        { _id: new ObjectId(id) },
        updateData
    );

    if (result.matchedCount === 0) {
        return res.status(404).send({
            success: false,
            error: "Appointment not found",
        });
    }

    res.send({
        success: true,
        modifiedCount: result.modifiedCount,
        matchedCount: result.matchedCount,
        message: `Appointment status updated to ${status}`,
        data: {
            status,
            meetingLink: status === "confirmed" ? meetingLink : undefined,
            cancellationNote:
                status === "cancelled" ? cancellationNote : undefined,
        },
    });
});

//meeeeeee start code for ssl


// POST /appointments/:id/feedback
// User submits feedback after their appointment
router.post("/appointments/:id/feedback", verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const {
            rating,
            qualities,
            improvements,
            recommend,
            additional,
            lawyerEmail,
            submittedAt,
        } = req.body;

        // Validate
        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid appointment ID" });
        }
        if (!rating || rating < 1 || rating > 5) {
            return res.status(400).json({ success: false, message: "Rating must be 1–5" });
        }
        if (recommend === null || recommend === undefined) {
            return res.status(400).json({ success: false, message: "Recommendation is required" });
        }

        // Check appointment exists
        const appointment = await bookedLawyerCollection.findOne({
            _id: new ObjectId(id),
        });
        if (!appointment) {
            return res.status(404).json({ success: false, message: "Appointment not found" });
        }
        if (!["confirmed", "completed"].includes(appointment.status)) {
            return res.status(400).json({
                success: false,
                message: "Feedback can only be submitted for confirmed or completed appointments",
            });
        }
        if (appointment.feedback) {
            return res.status(400).json({ success: false, message: "Feedback already submitted" });
        }

        // Save feedback inside booking document
        await bookedLawyerCollection.updateOne(
            { _id: new ObjectId(id) },
            {
                $set: {
                    feedback: {
                        rating,
                        qualities:    qualities    || [],
                        improvements: improvements || [],
                        recommend,
                        additional:   additional   || null,
                        submittedAt:  submittedAt  || new Date().toISOString(),
                    },
                    updatedAt: new Date().toISOString(),
                },
            }
        );

        // Update lawyer's rolling average rating
        const lawyerDoc = await lawyers.findOne({ email: lawyerEmail });
        if (lawyerDoc) {
            const oldRating    = lawyerDoc.rating      || 0;
            const reviewCount  = lawyerDoc.reviewCount || 0;
            const newRating    = reviewCount > 0
                ? ((oldRating * reviewCount) + rating) / (reviewCount + 1)
                : rating;

            await lawyers.updateOne(
                { email: lawyerEmail },
                {
                    $set: { rating: Math.round(newRating * 10) / 10 },
                    $inc: { reviewCount: 1 },
                }
            );
        }

        res.json({ success: true, message: "Feedback submitted successfully" });
    } catch (error) {
        console.error("POST feedback error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});


// GET /appointments/:id/feedback
// Get feedback for a specific appointment
router.get("/appointments/:id/feedback", verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        console.log(id); 
        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid appointment ID" });
        }

        const appointment = await bookedLawyerCollection.findOne(
            { _id: new ObjectId(id) },
            { projection: { feedback: 1 } }
        );

        if (!appointment) {
            return res.status(404).json({ success: false, message: "Appointment not found" });
        }
        if (!appointment.feedback) {
            return res.status(404).json({ success: false, message: "No feedback found" });
        }

        res.json({ success: true, data: appointment.feedback });
    } catch (error) {
        console.error("GET feedback error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});
module.exports = router;
