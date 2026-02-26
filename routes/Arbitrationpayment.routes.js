const express = require("express");
const router = express.Router();
const { ObjectId } = require("mongodb");
const { client } = require("../config/db");
const verifyToken = require("../middleware/verifyToken");
const verifyAdmin = require("../middleware/verifyAdmin");

const paymentPlansCollection = client.db("justiFi").collection("payment_plans");
const paymentsCollection = client.db("justiFi").collection("payments");
const distributionsCollection = client.db("justiFi").collection("payment_distributions");
const arbitrationCollection = client.db("justiFi").collection("arbitrations");

// ── Helpers ───────────────────────────────────────────────────────────────────
const generatePlanId = () =>
    `PLAN-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

const generateInstId = (n) =>
    `INST-${Date.now()}-${n}`;

const generatePaymentId = () =>
    `PAY-${Date.now()}-${Math.random().toString(36).substr(2, 8).toUpperCase()}`;

const generateDistributionId = () =>
    `DIST-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;




router.get('/all_payment_plans',async (req,res)=>{
     try {
    const cursor = paymentPlansCollection.find();
    const result = await cursor.toArray();
    res.send(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
})

router.get('/payments',async (req,res)=>{
     try {
    const cursor = paymentsCollection.find();
    const result = await cursor.toArray();
    res.send(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
})

router.get('/payment_distributions',async (req,res)=>{
     try {
    const cursor = distributionsCollection.find();
    const result = await cursor.toArray();
    res.send(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
})





// ─────────────────────────────────────────────────────────────────────────────
// GET /payment-plans/:arbitrationId
// Fetch payment plan for a specific arbitration (plaintiff / defendant / admin)
// ─────────────────────────────────────────────────────────────────────────────
router.get("/payment-plans/:arbitrationId", verifyToken, async (req, res) => {
    try {
        const { arbitrationId } = req.params;

        const plan = await paymentPlansCollection.findOne({ arbitrationId });

        if (!plan) {
            return res.json({
                success: true,
                data: null,
                message: "No payment plan created yet",
            });
        }

        res.json({ success: true, data: plan });
    } catch (error) {
        console.error("GET payment plan error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});


// ─────────────────────────────────────────────────────────────────────────────
// GET /payment-plans/admin/all
// Admin: get all payment plans
// ─────────────────────────────────────────────────────────────────────────────
router.get("/payment-plans/admin/all", verifyToken, verifyAdmin, async (req, res) => {
    try {
        const plans = await paymentPlansCollection
            .find()
            .sort({ createdAt: -1 })
            .toArray();

        res.json({ success: true, data: plans });
    } catch (error) {
        console.error("GET all payment plans error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});


// ─────────────────────────────────────────────────────────────────────────────
// GET /payments/pending
// Admin: get all payments pending approval
// ─────────────────────────────────────────────────────────────────────────────
router.get("/payments/pending", verifyToken, verifyAdmin, async (req, res) => {
    try {
        const pending = await paymentsCollection
            .find({ "adminApproval.status": "pending" })
            .sort({ paidAt: -1 })
            .toArray();

        res.json({ success: true, data: pending });
    } catch (error) {
        console.error("GET pending payments error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});


// ─────────────────────────────────────────────────────────────────────────────
// GET /payments/arbitration/:arbitrationId
// Get all payments for a specific arbitration
// ─────────────────────────────────────────────────────────────────────────────
router.get("/payments/arbitration/:arbitrationId", verifyToken, async (req, res) => {
    try {
        const { arbitrationId } = req.params;

        const result = await paymentsCollection
            .find({ arbitrationId })
            .sort({ paidAt: -1 })
            .toArray();

        res.json({ success: true, data: result });
    } catch (error) {
        console.error("GET payments by arbitration error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});


// ─────────────────────────────────────────────────────────────────────────────
// POST /payment-plans/create
// Admin creates a payment plan with installments for an arbitration
// Body: {
//   arbitrationId, totalCost, createdBy,
//   installments: [{ totalAmount, dueDate }]
// }
// ─────────────────────────────────────────────────────────────────────────────
router.post("/payment-plans/create", verifyToken, verifyAdmin, async (req, res) => {
    try {
        const { arbitrationId, totalCost, createdBy, installments } = req.body;

        // Basic validation
        if (!arbitrationId || !totalCost || !installments?.length) {
            return res.status(400).json({
                success: false,
                message: "arbitrationId, totalCost, and installments are required",
            });
        }

        // Check plan doesn't already exist
        const existing = await paymentPlansCollection.findOne({ arbitrationId });
        if (existing) {
            return res.status(400).json({
                success: false,
                message: "Payment plan already exists for this arbitration",
            });
        }

        // Validate installment amounts sum matches totalCost
        const installmentSum = installments.reduce(
            (sum, i) => sum + Number(i.totalAmount), 0
        );
        if (installmentSum !== Number(totalCost)) {
            return res.status(400).json({
                success: false,
                message: `Installment total (${installmentSum}) must equal totalCost (${totalCost})`,
            });
        }

        // Fetch arbitration to get plaintiffs & defendants
        const arbitration = await arbitrationCollection.findOne({ arbitrationId });
        if (!arbitration) {
            return res.status(404).json({ success: false, message: "Arbitration not found" });
        }

        const plaintiffs = arbitration.plaintiffs || [];
        const defendants = arbitration.defendants || [];
        const allParties = [
            ...plaintiffs.map((p) => ({ role: "plaintiff", email: p.email, name: p.name })),
            ...defendants.map((d) => ({ role: "defendant", email: d.email, name: d.name })),
        ];

        // Build installments with per-party breakdown
        // Each party pays equally: installment.totalAmount / total party count
        const builtInstallments = installments.map((inst, idx) => {
            const perPartyAmount = Math.ceil(Number(inst.totalAmount) / allParties.length);

            return {
                installmentNumber: idx + 1,
                installmentId: generateInstId(idx + 1),
                totalAmount: Number(inst.totalAmount),
                perPartyAmount,
                dueDate: new Date(inst.dueDate),
                status: "pending",
                partyPayments: allParties.map((party) => ({
                    role: party.role,
                    email: party.email,
                    name: party.name,
                    amountDue: perPartyAmount,
                    status: "unpaid",
                    paymentId: null,
                    paidAt: null,
                })),
            };
        });

        const newPlan = {
            planId: generatePlanId(),
            arbitrationId,
            totalCost: Number(totalCost),
            perPartyCost: Math.ceil(Number(totalCost) / allParties.length),
            currency: "BDT",
            planStatus: "active",
            installments: builtInstallments,
            totalPaid: 0,
            totalPending: Number(totalCost),
            createdBy,
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        const result = await paymentPlansCollection.insertOne(newPlan);

        res.json({
            success: true,
            data: { ...newPlan, _id: result.insertedId },
            message: "Payment plan created successfully",
        });
    } catch (error) {
        console.error("POST create payment plan error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});


// ─────────────────────────────────────────────────────────────────────────────
// POST /payments/pay
// User submits a payment for an installment
// Body: {
//   arbitrationId, planId, installmentId,
//   payerEmail, payerRole, amount,
//   paymentMethod, transactionRef
// }
// ─────────────────────────────────────────────────────────────────────────────
router.post("/payments/pay", verifyToken, async (req, res) => {
    try {
        const {
            arbitrationId,
            planId,
            installmentId,
            payerEmail,
            payerRole,
            amount,
            paymentMethod,
            transactionRef,
        } = req.body;

        // Find the plan
        const plan = await paymentPlansCollection.findOne({ planId, arbitrationId });
        if (!plan) {
            return res.status(404).json({ success: false, message: "Payment plan not found" });
        }

        // Find installment index
        const instIdx = plan.installments.findIndex(
            (i) => i.installmentId === installmentId
        );
        if (instIdx === -1) {
            return res.status(404).json({ success: false, message: "Installment not found" });
        }

        // Find party index
        const partyIdx = plan.installments[instIdx].partyPayments.findIndex(
            (p) => p.email === payerEmail
        );
        if (partyIdx === -1) {
            return res.status(404).json({ success: false, message: "Party not found in this installment" });
        }

        // Check not already paid
        if (plan.installments[instIdx].partyPayments[partyIdx].status === "paid") {
            return res.status(400).json({ success: false, message: "This installment is already paid" });
        }

        // Create payment record
        const paymentId = generatePaymentId();
        const paymentRecord = {
            paymentId,
            arbitrationId,
            planId,
            installmentId,
            paidBy: {
                email: payerEmail,
                role: payerRole,
            },
            amount: Number(amount),
            currency: "BDT",
            paymentMethod,
            transactionRef: transactionRef || null,
            status: "completed",
            paidAt: new Date(),
            adminApproval: {
                status: "pending",
                approvedBy: null,
                approvedAt: null,
                remarks: "",
            },
            distributionId: null,
            createdAt: new Date(),
        };

        await paymentsCollection.insertOne(paymentRecord);

        // Update plan: mark this party's payment as paid
        const updatePath = `installments.${instIdx}.partyPayments.${partyIdx}`;
        await paymentPlansCollection.updateOne(
            { planId },
            {
                $set: {
                    [`${updatePath}.status`]: "paid",
                    [`${updatePath}.paymentId`]: paymentId,
                    [`${updatePath}.paidAt`]: new Date(),
                    updatedAt: new Date(),
                },
                $inc: {
                    totalPaid: Number(amount),
                    totalPending: -Number(amount),
                },
            }
        );

        // Check if ALL parties paid this installment → update installment status
        const updatedPlan = await paymentPlansCollection.findOne({ planId });
        const allPaid = updatedPlan.installments[instIdx].partyPayments.every(
            (p) => p.status === "paid"
        );
        if (allPaid) {
            await paymentPlansCollection.updateOne(
                { planId },
                {
                    $set: {
                        [`installments.${instIdx}.status`]: "fully_paid",
                        updatedAt: new Date(),
                    },
                }
            );
        }

        res.json({
            success: true,
            paymentId,
            message: "Payment submitted successfully. Pending admin approval.",
        });
    } catch (error) {
        console.error("POST pay error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});


// ─────────────────────────────────────────────────────────────────────────────
// POST /payments/admin/approve
// Admin approves a payment → creates distribution record
// Body: {
//   paymentId, approvedBy,
//   platformCutPercentage (default 20),
//   arbitratorSplit: { presidingArbitrator: 50, arbitrator1: 25, arbitrator2: 25 },
//   remarks
// }
// ─────────────────────────────────────────────────────────────────────────────
router.post("/payments/admin/approve", verifyToken, verifyAdmin, async (req, res) => {
    try {
        const {
            paymentId,
            approvedBy,
            platformCutPercentage = 20,
            arbitratorSplit = {
                presidingArbitrator: 50,
                arbitrator1: 25,
                arbitrator2: 25,
            },
            remarks = "",
        } = req.body;

        // Find payment
        const payment = await paymentsCollection.findOne({ paymentId });
        if (!payment) {
            return res.status(404).json({ success: false, message: "Payment not found" });
        }
        if (payment.adminApproval.status === "approved") {
            return res.status(400).json({ success: false, message: "Payment already approved" });
        }

        // Fetch arbitration to get arbitrator info
        const arbitration = await arbitrationCollection.findOne({
            arbitrationId: payment.arbitrationId,
        });

        const arbitratorMap = {
            presidingArbitrator: arbitration?.presidingArbitrator || {},
            arbitrator1: arbitration?.arbitrator1 || {},
            arbitrator2: arbitration?.arbitrator2 || {},
        };

        // Calculate distribution
        const totalAmount = payment.amount;
        const platformAmount = Math.round((totalAmount * platformCutPercentage) / 100);
        const distributable = totalAmount - platformAmount;

        const arbitratorShares = Object.entries(arbitratorSplit).map(([role, pct]) => ({
            role,
            name: arbitratorMap[role]?.name || role,
            email: arbitratorMap[role]?.email || null,
            sharePercentage: pct,
            amount: Math.round((distributable * pct) / 100),
            status: "paid",
            paidAt: new Date(),
        }));

        // Create distribution record
        const distributionId = generateDistributionId();
        const distribution = {
            distributionId,
            paymentId,
            arbitrationId: payment.arbitrationId,
            planId: payment.planId,
            installmentId: payment.installmentId,
            totalCollected: totalAmount,
            currency: "BDT",
            platformCut: {
                percentage: platformCutPercentage,
                amount: platformAmount,
            },
            distributableAmount: distributable,
            arbitratorShares,
            distributedBy: approvedBy,
            distributedAt: new Date(),
            createdAt: new Date(),
        };

        await distributionsCollection.insertOne(distribution);

        // Update payment: mark as approved
        await paymentsCollection.updateOne(
            { paymentId },
            {
                $set: {
                    "adminApproval.status": "approved",
                    "adminApproval.approvedBy": approvedBy,
                    "adminApproval.approvedAt": new Date(),
                    "adminApproval.remarks": remarks,
                    distributionId,
                },
            }
        );

        res.json({
            success: true,
            distributionId,
            message: "Payment approved and distribution created successfully",
        });
    } catch (error) {
        console.error("POST approve payment error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});


// ─────────────────────────────────────────────────────────────────────────────
// POST /payments/admin/reject
// Admin rejects a payment → reverts party status to unpaid
// Body: { paymentId, rejectedBy, remarks }
// ─────────────────────────────────────────────────────────────────────────────
router.post("/payments/admin/reject", verifyToken, verifyAdmin, async (req, res) => {
    try {
        const { paymentId, rejectedBy, remarks } = req.body;

        const payment = await paymentsCollection.findOne({ paymentId });
        if (!payment) {
            return res.status(404).json({ success: false, message: "Payment not found" });
        }
        if (payment.adminApproval.status !== "pending") {
            return res.status(400).json({ success: false, message: "Payment is not in pending state" });
        }

        // Revert the party's status back to unpaid in the plan
        const plan = await paymentPlansCollection.findOne({ planId: payment.planId });
        if (plan) {
            const instIdx = plan.installments.findIndex(
                (i) => i.installmentId === payment.installmentId
            );
            const partyIdx =
                instIdx !== -1
                    ? plan.installments[instIdx].partyPayments.findIndex(
                          (p) => p.email === payment.paidBy.email
                      )
                    : -1;

            if (instIdx !== -1 && partyIdx !== -1) {
                const updatePath = `installments.${instIdx}.partyPayments.${partyIdx}`;
                await paymentPlansCollection.updateOne(
                    { planId: payment.planId },
                    {
                        $set: {
                            [`${updatePath}.status`]: "unpaid",
                            [`${updatePath}.paymentId`]: null,
                            [`${updatePath}.paidAt`]: null,
                            updatedAt: new Date(),
                        },
                        $inc: {
                            totalPaid: -payment.amount,
                            totalPending: payment.amount,
                        },
                    }
                );
            }
        }

        // Update payment
        await paymentsCollection.updateOne(
            { paymentId },
            {
                $set: {
                    "adminApproval.status": "rejected",
                    "adminApproval.approvedBy": rejectedBy,
                    "adminApproval.approvedAt": new Date(),
                    "adminApproval.remarks": remarks || "",
                    status: "failed",
                },
            }
        );

        res.json({ success: true, message: "Payment rejected successfully" });
    } catch (error) {
        console.error("POST reject payment error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});


// ─────────────────────────────────────────────────────────────────────────────
// GET /distributions/:arbitrationId
// Get all distributions for an arbitration
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// GET /distributions/arbitrator/me
// Arbitrator: get ALL distributions across ALL arbitrations where they have a share
// ─────────────────────────────────────────────────────────────────────────────
router.get("/distributions/arbitrator/me", verifyToken, async (req, res) => {
    try {
        const email = req.decoded.email;

        // Find all distributions where this email exists in arbitratorShares
        const result = await distributionsCollection
            .find({ "arbitratorShares.email": email })
            .sort({ createdAt: -1 })
            .toArray();

        res.json({ success: true, data: result });
    } catch (error) {
        console.error("GET arbitrator earnings error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

router.get("/distributions/:arbitrationId", verifyToken, async (req, res) => {
    try {
        const { arbitrationId } = req.params;

        const result = await distributionsCollection
            .find({ arbitrationId })
            .sort({ createdAt: -1 })
            .toArray();

        res.json({ success: true, data: result });
    } catch (error) {
        console.error("GET distributions error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});



// ─────────────────────────────────────────────────────────────────────────────
// GET /payments/user/me
// User: get ALL their own payments across all arbitrations
// email comes from req.decoded.email (verifyToken)
// ─────────────────────────────────────────────────────────────────────────────
router.get("/payments/user/me", verifyToken, async (req, res) => {
    try {
        const email = req.decoded.email;

        const result = await paymentsCollection
            .find({ "paidBy.email": email })
            .sort({ paidAt: -1 })
            .toArray();

        res.json({ success: true, data: result });
    } catch (error) {
        console.error("GET user payments error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;