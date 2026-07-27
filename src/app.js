import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import morgan from "morgan";
import router from "./routes/router.js";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan("dev"));

app.get("/", (req, res) => {
    res.json({
        success: true,
        message: "Data Governance API Running"
    });
});
app.use("/api", router);

app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: "Route not found"
    });
});

app.use((err, req, res, next) => {
    console.error("Request Error:", err);

    const statusCode = err.name === "MulterError" || err.message?.includes("Only CSV") ? 400 : 500;

    res.status(statusCode).json({
        success: false,
        message: err.message
    });
});

export default app;
