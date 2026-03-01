const express = require("express");
const cors = require("cors");
require("dotenv").config();
const cookieParser = require("cookie-parser");
const app = express();
const port = process.env.PORT || 5000;

// Routes
const authRoutes              = require("./routes/auth.routes");
const userRoutes              = require("./routes/user.routes");
const lawyerRoutes            = require("./routes/lawyer.route");
const arbitratorRoutes        = require("./routes/arbitrator.routes");
const mediatorRoutes          = require("./routes/mediator.routes");
const bookedLawyerRoutes      = require("./routes/bookedLawyer.routes");
const blogRoutes              = require("./routes/blog.routes");
const arbitrationRoutes       = require("./routes/arbitration.routes");
const arbitrationFileRoutes   = require("./routes/arbitrationFile.routes");
const mediationRoutes         = require("./routes/mediation.routes");
const verdictRouter           = require("./routes/Verdict.routes");
const ArbitrationPaymentRoutes = require("./routes/Arbitrationpayment.routes");

const { connectToDatabase } = require("./config/db");

app.use(cors({
    origin: [
        "http://localhost:5173",
        process.env.CLIENT_URL,
    ].filter(Boolean),
    credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.get("/", (req, res) => {
    res.send("justiFi server is running...");
});

app.use("/", authRoutes);
app.use("/", userRoutes);
app.use("/", lawyerRoutes);
app.use("/", arbitratorRoutes);
app.use("/", mediatorRoutes);
app.use("/", bookedLawyerRoutes);
app.use("/", blogRoutes);
app.use("/", arbitrationRoutes);
app.use("/", mediationRoutes);
app.use("/arbitrationFile", arbitrationFileRoutes);
app.use("/uploads", express.static("uploads"));
app.use("/verdict", verdictRouter);
app.use("/payment-plans", ArbitrationPaymentRoutes);

connectToDatabase()
    .then(() => {
        app.listen(port, () => {
            console.log(`Server running on port ${port}`);
        });
    })
    .catch((error) => {
        console.error("Failed to start server:", error);
        process.exit(1);
    });